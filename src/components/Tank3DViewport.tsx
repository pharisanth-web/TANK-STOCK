import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  TankStockSummary,
  TankVolumetricProfile,
} from '../lib/tankMath.ts';
import {
  Eye,
  Layers,
  RotateCcw,
  Ruler,
  ChevronDown,
  ChevronUp,
  Box,
} from 'lucide-react';

// Detect software WebGL once at module load per Three.js skill guidelines
const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return false;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

// Pre-allocated math helpers outside render loop (zero GC in loop)
const _targetPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();

export type TankViewStyle = 'cutaway' | 'xray' | 'solid';

interface Tank3DViewportProps {
  mode?: 'single' | 'factory';
  summary?: TankStockSummary;
  summaries?: TankStockSummary[];
  customProfile?: TankVolumetricProfile;
  customFillPercent?: number;
  customMaterialColor?: string;
  customTankName?: string;
  selectedTankId?: number | null;
  onSelectTank?: (tankId: number) => void;
  heightClass?: string;
}

/**
 * Generates a procedural rice/grain albedo texture on an HTML5 2D canvas
 * with zero external file dependencies.
 */
function createProceduralGrainTexture(
  baseHex: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = baseHex || '#d97706';
  ctx.fillRect(0, 0, 256, 256);

  const baseColor = new THREE.Color(baseHex || '#d97706');
  const lightGrain = baseColor.clone().offsetHSL(0.01, 0.05, 0.14).getStyle();
  const darkGrain = baseColor.clone().offsetHSL(-0.01, 0.05, -0.12).getStyle();

  // Draw hundreds of tiny rice grain ellipses
  for (let i = 0; i < 950; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    const angle = ((i * 29) % 180) * (Math.PI / 180);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = i % 2 === 0 ? lightGrain : darkGrain;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.2, 1.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Creates a procedural tank label badge texture for 3D identification.
 */
function createTankBadgeTexture(
  name: string,
  subtitle: string,
  statusColor: string,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 256, 128);

  ctx.strokeStyle = statusColor;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 120);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 48px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`TANK ${name}`, 128, 62);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '600 26px "JetBrains Mono", monospace';
  ctx.fillText(subtitle, 128, 102);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Builds a lofted BufferGeometry from the 1 cm slice profile from yStartCm to yEndCm.
 * Uses 1 cm = 0.01 Three.js world units (meters), centered horizontally around X=0, Z=0,
 * and offset upward by legClearanceMeters so the outlet sits above the conveyor belt.
 */
function buildLoftedTankBufferGeometry(
  profile: TankVolumetricProfile,
  yStartCm: number,
  yEndCm: number,
  insetCm: number,
  legClearanceM: number,
  includeFrontFace: boolean,
  includeTopCap: boolean,
  includeBottomCap: boolean
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const totalSlices = profile.slices.length;
  if (totalSlices === 0 || yEndCm <= yStartCm) {
    return geom;
  }

  const centerXCm = (profile.minXCm + profile.maxXCm) / 2;
  const stepCm = Math.max(2, Math.floor(totalSlices / 45));

  // Sample heights from yStartCm to yEndCm
  const sampleYs: number[] = [yStartCm];
  for (let y = Math.ceil(yStartCm / stepCm) * stepCm; y < yEndCm; y += stepCm) {
    if (y > yStartCm && y < yEndCm) {
      sampleYs.push(y);
    }
  }
  // Ensure hopper transition height is explicitly sampled for crisp edge
  if (
    profile.hopperTopHeightCm > yStartCm &&
    profile.hopperTopHeightCm < yEndCm &&
    !sampleYs.includes(profile.hopperTopHeightCm)
  ) {
    sampleYs.push(profile.hopperTopHeightCm);
  }
  sampleYs.push(yEndCm);
  sampleYs.sort((a, b) => a - b);

  // Compute cross-section rectangle at each sampled height
  const rings = sampleYs.map((yCm) => {
    const idx = Math.min(
      totalSlices - 1,
      Math.max(0, Math.floor(yCm))
    );
    const slice = profile.slices[idx];
    const xL = (slice.xLeftCm + insetCm - centerXCm) * 0.01;
    const xR = (slice.xRightCm - insetCm - centerXCm) * 0.01;
    const halfD = Math.max(0.04, (slice.depthCm / 2 - insetCm) * 0.01);
    const yM = legClearanceM + yCm * 0.01;
    return { xL, xR, zBack: -halfD, zFront: halfD, yM };
  });

  const positions: number[] = [];
  const uvs: number[] = [];

  function pushQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number]
  ) {
    positions.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];

    // Back wall (-Z)
    pushQuad(
      [r0.xR, r0.yM, r0.zBack],
      [r0.xL, r0.yM, r0.zBack],
      [r1.xL, r1.yM, r1.zBack],
      [r1.xR, r1.yM, r1.zBack]
    );

    // Left wall (xL)
    pushQuad(
      [r0.xL, r0.yM, r0.zBack],
      [r0.xL, r0.yM, r0.zFront],
      [r1.xL, r1.yM, r1.zFront],
      [r1.xL, r1.yM, r1.zBack]
    );

    // Right wall (xR)
    pushQuad(
      [r0.xR, r0.yM, r0.zFront],
      [r0.xR, r0.yM, r0.zBack],
      [r1.xR, r1.yM, r1.zBack],
      [r1.xR, r1.yM, r1.zFront]
    );

    // Front wall (+Z)
    if (includeFrontFace) {
      pushQuad(
        [r0.xL, r0.yM, r0.zFront],
        [r0.xR, r0.yM, r0.zFront],
        [r1.xR, r1.yM, r1.zFront],
        [r1.xL, r1.yM, r1.zFront]
      );
    }
  }

  // Top Cap (e.g. sculpted grain surface or roof)
  if (includeTopCap && rings.length > 0) {
    const top = rings[rings.length - 1];
    pushQuad(
      [top.xL, top.yM, top.zFront],
      [top.xR, top.yM, top.zFront],
      [top.xR, top.yM, top.zBack],
      [top.xL, top.yM, top.zBack]
    );
  }

  // Bottom Cap
  if (includeBottomCap && rings.length > 0) {
    const bot = rings[0];
    pushQuad(
      [bot.xL, bot.yM, bot.zBack],
      [bot.xR, bot.yM, bot.zBack],
      [bot.xR, bot.yM, bot.zFront],
      [bot.xL, bot.yM, bot.zFront]
    );
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Constructs a composite 8-part procedural 3D Hopper-Bottom Tank assembly (`THREE.Group`).
 */
function buildCompositeHopperTankGroup(params: {
  tankId: number;
  tankName: string;
  profile: TankVolumetricProfile;
  filledHeightCm: number;
  fillPercent: number;
  materialColor: string;
  viewStyle: TankViewStyle;
  showGapBeam: boolean;
  isSelected: boolean;
  isLowWarning: boolean;
  isHighWarning: boolean;
  maxAnisotropy: number;
}): THREE.Group {
  const {
    tankId,
    tankName,
    profile,
    filledHeightCm,
    fillPercent,
    materialColor,
    viewStyle,
    showGapBeam,
    isSelected,
    isLowWarning,
    isHighWarning,
    maxAnisotropy,
  } = params;

  const group = new THREE.Group();
  group.userData = { tankId, tankName };

  const legClearanceM = 0.72; // 72 cm clearance beneath outlet for conveyor belt
  const centerXCm = (profile.minXCm + profile.maxXCm) / 2;
  const totalHeightM = profile.totalHeightCm * 0.01;
  const hopperTopM = legClearanceM + profile.hopperTopHeightCm * 0.01;

  // 1. Primary Metallic Tank Body & Hopper Shell
  const steelMat = new THREE.MeshStandardMaterial({
    color: isSelected ? 0xe2e8f0 : 0xcbd5e1,
    metalness: 0.82,
    roughness: 0.28,
    side: THREE.DoubleSide,
  });

  const shellGeom = buildLoftedTankBufferGeometry(
    profile,
    0,
    profile.totalHeightCm,
    0,
    legClearanceM,
    viewStyle === 'solid',
    false,
    false
  );
  const shellMesh = new THREE.Mesh(shellGeom, steelMat);
  shellMesh.castShadow = !isSoftwareGl;
  shellMesh.receiveShadow = !isSoftwareGl;
  shellMesh.userData = { tankId };
  group.add(shellMesh);

  // Front inspection glass window when in cutaway or xray mode
  if (viewStyle !== 'solid') {
    const frontWindowGeom = buildLoftedTankBufferGeometry(
      profile,
      0,
      profile.totalHeightCm,
      0,
      legClearanceM,
      true,
      false,
      false
    );
    const windowMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      metalness: 0.1,
      roughness: 0.15,
      transparent: true,
      opacity: viewStyle === 'xray' ? 0.18 : 0.12,
      depthWrite: false,
    });
    const windowMesh = new THREE.Mesh(frontWindowGeom, windowMat);
    windowMesh.renderOrder = 3;
    windowMesh.userData = { tankId };
    group.add(windowMesh);
  }

  // Structural Wireframe / Edge Ribs for clear engineering definition
  const fullBoxGeom = buildLoftedTankBufferGeometry(
    profile,
    0,
    profile.totalHeightCm,
    0,
    legClearanceM,
    true,
    true,
    true
  );
  const edgeGeom = new THREE.EdgesGeometry(fullBoxGeom, 12);
  const edgeMat = new THREE.LineBasicMaterial({
    color: isLowWarning
      ? 0xef4444
      : isHighWarning
      ? 0xf97316
      : isSelected
      ? 0xf59e0b
      : 0x64748b,
  });
  const edgeLines = new THREE.LineSegments(edgeGeom, edgeMat);
  group.add(edgeLines);

  // 2. Interior Rice / Grain 3D Fill Volume
  const clampedFillCm = Math.max(
    0,
    Math.min(profile.totalHeightCm, filledHeightCm)
  );
  if (clampedFillCm > 1) {
    const grainTexture = createProceduralGrainTexture(
      materialColor,
      maxAnisotropy
    );
    const grainMat = new THREE.MeshStandardMaterial({
      map: grainTexture,
      roughness: 0.78,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const grainGeom = buildLoftedTankBufferGeometry(
      profile,
      0,
      clampedFillCm,
      1.8, // 1.8 cm inset inside steel walls to avoid Z-fighting
      legClearanceM,
      true,
      true,
      true
    );
    const grainMesh = new THREE.Mesh(grainGeom, grainMat);
    grainMesh.renderOrder = 2;
    grainMesh.userData = { tankId };
    group.add(grainMesh);
  }

  // 3. Hopper Transition Collar Frame & 4 Heavy-Duty Support Columns
  const hopSliceIdx = Math.min(
    profile.slices.length - 1,
    Math.max(0, Math.floor(profile.hopperTopHeightCm))
  );
  const hopSlice = profile.slices[hopSliceIdx] || {
    xLeftCm: profile.minXCm,
    xRightCm: profile.maxXCm,
    depthCm: profile.straightDepthCm,
  };
  const colXL = (hopSlice.xLeftCm - centerXCm) * 0.01;
  const colXR = (hopSlice.xRightCm - centerXCm) * 0.01;
  const colHalfD = (hopSlice.depthCm / 2) * 0.01;

  const legMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.45,
  });

  const legCorners: [number, number][] = [
    [colXL + 0.05, -colHalfD + 0.05],
    [colXR - 0.05, -colHalfD + 0.05],
    [colXL + 0.05, colHalfD - 0.05],
    [colXR - 0.05, colHalfD - 0.05],
  ];

  const legHeight = Math.max(0.75, hopperTopM);
  const legGeom = new THREE.BoxGeometry(0.11, legHeight, 0.11);
  const footGeom = new THREE.BoxGeometry(0.24, 0.04, 0.24);

  for (const [lx, lz] of legCorners) {
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(lx, legHeight / 2, lz);
    leg.castShadow = !isSoftwareGl;
    group.add(leg);

    const foot = new THREE.Mesh(footGeom, legMat);
    foot.position.set(lx, 0.02, lz);
    group.add(foot);
  }

  // Hopper Top Transition Ring Beam (marks where sloped part meets straight body)
  const collarW = Math.max(0.4, colXR - colXL + 0.08);
  const collarD = Math.max(0.4, colHalfD * 2 + 0.08);
  const collarGeom = new THREE.BoxGeometry(collarW, 0.07, collarD);
  const collarEdges = new THREE.EdgesGeometry(collarGeom);
  const collarLine = new THREE.LineSegments(
    collarEdges,
    new THREE.LineBasicMaterial({ color: 0xf59e0b })
  );
  collarLine.position.set((colXL + colXR) / 2, hopperTopM, 0);
  group.add(collarLine);

  // 4. Bottom Outlet Slide-Gate Valve & Flange at y = 0 cm (world Y = legClearanceM)
  const outSlice = profile.slices[0] || {
    xLeftCm: -20,
    xRightCm: 20,
    depthCm: profile.outletDepthCm,
  };
  const outXCenter =
    ((outSlice.xLeftCm + outSlice.xRightCm) / 2 - centerXCm) * 0.01;
  const outW = Math.max(0.24, outSlice.widthCm * 0.01);
  const outD = Math.max(0.24, outSlice.depthCm * 0.01);

  const gateMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.2,
  });
  const gateFlange = new THREE.Mesh(
    new THREE.BoxGeometry(outW + 0.12, 0.1, outD + 0.12),
    gateMat
  );
  gateFlange.position.set(outXCenter, legClearanceM - 0.04, 0);
  group.add(gateFlange);

  // Slide-gate handwheel actuator on the front of the outlet
  const wheelMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.03, 16),
    new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.5,
      roughness: 0.3,
    })
  );
  wheelMesh.rotation.x = Math.PI / 2;
  wheelMesh.position.set(outXCenter, legClearanceM - 0.04, outD / 2 + 0.12);
  group.add(wheelMesh);

  // 5. Under-Tank Conveyor Belt & Instanced Rollers
  const convLength = Math.max(2.6, collarW + 0.9);
  const convWidth = Math.max(0.45, outD + 0.16);
  const convFrameMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.65,
    roughness: 0.4,
  });
  const convBelt = new THREE.Mesh(
    new THREE.BoxGeometry(convLength, 0.06, convWidth),
    convFrameMat
  );
  convBelt.position.set(0, 0.28, 0);
  group.add(convBelt);

  // Instanced steel conveyor rollers
  const rollerCount = 14;
  const rollerGeom = new THREE.CylinderGeometry(0.025, 0.025, convWidth * 0.92, 10);
  rollerGeom.rotateX(Math.PI / 2);
  const rollerMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.9,
    roughness: 0.2,
  });
  const rollersInstanced = new THREE.InstancedMesh(
    rollerGeom,
    rollerMat,
    rollerCount
  );
  for (let i = 0; i < rollerCount; i++) {
    const rx =
      -convLength / 2 + 0.15 + (i / (rollerCount - 1)) * (convLength - 0.3);
    _dummyObj.position.set(rx, 0.32, 0);
    _dummyObj.rotation.set(0, 0, 0);
    _dummyObj.scale.set(1, 1, 1);
    _dummyObj.updateMatrix();
    rollersInstanced.setMatrixAt(i, _dummyObj.matrix);
  }
  rollersInstanced.instanceMatrix.needsUpdate = true;
  rollersInstanced.computeBoundingSphere();
  group.add(rollersInstanced);

  // 6. Roof Hatch, Ultrasonic Sensor & Empty Gap Laser Line
  const topSlice = profile.slices[profile.slices.length - 1] || hopSlice;
  const roofY = legClearanceM + totalHeightM;
  const roofCenterX =
    ((topSlice.xLeftCm + topSlice.xRightCm) / 2 - centerXCm) * 0.01;

  const sensorPod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.16, 0.12, 16),
    new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.6,
      roughness: 0.3,
    })
  );
  sensorPod.position.set(roofCenterX, roofY + 0.06, 0);
  group.add(sensorPod);

  // Empty Gap Measurement Laser Beam from top down to grain surface
  if (showGapBeam) {
    const fillSurfaceY = legClearanceM + clampedFillCm * 0.01;
    const beamPoints = [
      new THREE.Vector3(roofCenterX, roofY, 0),
      new THREE.Vector3(roofCenterX, fillSurfaceY, 0),
    ];
    const beamGeom = new THREE.BufferGeometry().setFromPoints(beamPoints);
    const beamLine = new THREE.Line(
      beamGeom,
      new THREE.LineBasicMaterial({ color: 0x38bdf8 })
    );
    group.add(beamLine);

    // Target ring on grain surface
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.14, 24),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        side: THREE.DoubleSide,
      })
    );
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.set(roofCenterX, fillSurfaceY + 0.01, 0);
    group.add(targetRing);
  }

  // 7. 3D Tank Nameplate Badge above Roof
  const badgeColor = isLowWarning
    ? '#ef4444'
    : isHighWarning
    ? '#f97316'
    : '#f59e0b';
  const badgeTex = createTankBadgeTexture(
    tankName,
    `${fillPercent.toFixed(0)}% FULL`,
    badgeColor,
    maxAnisotropy
  );
  const badgePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.55),
    new THREE.MeshBasicMaterial({
      map: badgeTex,
      side: THREE.DoubleSide,
    })
  );
  badgePlane.position.set(roofCenterX, roofY + 0.48, 0);
  badgePlane.userData = { tankId };
  group.add(badgePlane);

  return group;
}

export const Tank3DViewport: React.FC<Tank3DViewportProps> = ({
  mode = 'single',
  summary,
  summaries = [],
  customProfile,
  customFillPercent = 65,
  customMaterialColor = '#d97706',
  customTankName = 'PREVIEW',
  selectedTankId = null,
  onSelectTank,
  heightClass = 'h-[400px] sm:h-[460px]',
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [viewStyle, setViewStyle] = useState<TankViewStyle>('cutaway');
  const [showGapBeam, setShowGapBeam] = useState<boolean>(true);
  const [hudCollapsed, setHudCollapsed] = useState<boolean>(false);

  // Store callbacks and state in ref so WebGL lifecycle never tears down on UI updates
  const onSelectRef = useRef(onSelectTank);
  onSelectRef.current = onSelectTank;

  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    tanksRoot: THREE.Group;
    requestRender: () => void;
    flyToPreset: (preset: 'iso' | 'front' | 'top') => void;
    maxAnisotropy: number;
  } | null>(null);

  // 1. Initialize WebGLRenderer & Studio Scene Once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const width = Math.max(300, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.FogExp2(0x0f172a, 0.032);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 150);
    camera.position.set(4.5, 4.2, 6.8);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.85);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 1.65);
    keyLight.position.set(8, 14, 10);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      const d = 14;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
    rimLight.position.set(-10, 8, -8);
    scene.add(rimLight);

    // Grounded Factory Floor & Non-Z-Fighting Grid
    const floorGeom = new THREE.PlaneGeometry(60, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.88,
      metalness: 0.15,
    });
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = !isSoftwareGl;
    scene.add(floorMesh);

    const gridHelper = new THREE.GridHelper(36, 36, 0x334155, 0x1e293b);
    gridHelper.position.y = 0.015; // Offset >= 0.015 on Y so coplanar faces never Z-fight
    scene.add(gridHelper);

    const tanksRoot = new THREE.Group();
    scene.add(tanksRoot);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.minDistance = 2.2;
    controls.maxDistance = 32;
    controls.target.set(0, 2.2, 0);

    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let activeTransition = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || !gl.fenceSync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        renderDirty = false;
        const dt = Math.min(0.1, clock.getDelta());

        if (activeTransition) {
          const k = 1 - Math.exp(-8 * dt);
          camera.position.lerp(_targetPos, k);
          controls.target.lerp(_targetLook, k);
          if (
            camera.position.distanceToSquared(_targetPos) < 0.01 &&
            controls.target.distanceToSquared(_targetLook) < 0.01
          ) {
            activeTransition = false;
          } else {
            renderDirty = true;
          }
        }

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (renderDirty || activeTransition) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    controls.addEventListener('start', () => {
      activeTransition = false;
    });
    controls.addEventListener('change', requestRender);

    function flyToPreset(preset: 'iso' | 'front' | 'top') {
      const span = mode === 'factory' ? 11 : 6.2;
      const centerY = 2.3;
      _targetLook.set(0, centerY, 0);
      if (preset === 'front') {
        _targetPos.set(0, centerY + 0.3, span * 1.18);
      } else if (preset === 'top') {
        _targetPos.set(0, span * 1.45, 0.8);
      } else {
        _targetPos.set(span * 0.72, centerY + 2.1, span * 1.05);
      }
      activeTransition = true;
      requestRender();
    }

    // Raycasting for clicking a tank in 3D factory overview
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      if (!onSelectRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(tanksRoot.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj) {
          if (obj.userData?.tankId) {
            onSelectRef.current(obj.userData.tankId);
            return;
          }
          obj = obj.parent;
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = Math.max(280, container.clientWidth);
      const h = Math.max(240, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObserver.observe(container);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      tanksRoot,
      requestRender,
      flyToPreset,
      maxAnisotropy,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    requestRender();

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
  }, [mode]);

  // 2. Rebuild 3D Hopper Tank Geometries when tank data or view options change
  useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;

    const { tanksRoot, camera, controls, requestRender, maxAnisotropy } = ctx;

    // Dispose previous geometries & materials cleanly
    tanksRoot.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach((mat) => mat.dispose());
        } else {
          m.material?.dispose();
        }
      }
    });
    tanksRoot.clear();

    if (mode === 'factory' && summaries.length > 0) {
      // Arrange tanks in 2 neat industrial rows (Row 1: Main Tanks A-D, Row 2: Aux Tanks A1-D1+)
      const cols = Math.min(4, Math.ceil(summaries.length / 2));
      const spacingX = 3.8;
      const spacingZ = 4.4;

      summaries.forEach((item, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const xOffset = (col - (cols - 1) / 2) * spacingX;
        const zOffset = (row - 0.5) * spacingZ;

        const tankGroup = buildCompositeHopperTankGroup({
          tankId: item.tank.id,
          tankName: item.tank.name,
          profile: item.profile,
          filledHeightCm: item.filledHeightCm,
          fillPercent: item.fillPercent,
          materialColor: item.material?.colorHex || '#d97706',
          viewStyle,
          showGapBeam,
          isSelected: selectedTankId === item.tank.id,
          isLowWarning: item.isLowWarning,
          isHighWarning: item.isHighWarning,
          maxAnisotropy,
        });
        tankGroup.position.set(xOffset, 0, zOffset);
        tanksRoot.add(tankGroup);
      });

      controls.target.set(0, 2.2, 0);
      if (camera.position.length() < 8) {
        camera.position.set(8.5, 6.8, 12.2);
      }
    } else {
      // Single tank high-detail view
      const activeProfile =
        customProfile ||
        summary?.profile;
      if (!activeProfile) return;

      const fillPct = summary ? summary.fillPercent : customFillPercent;
      const filledCm = summary
        ? summary.filledHeightCm
        : (activeProfile.totalHeightCm * fillPct) / 100;
      const matColor = summary
        ? summary.material?.colorHex || '#d97706'
        : customMaterialColor;
      const tName = summary ? summary.tank.name : customTankName;

      const tankGroup = buildCompositeHopperTankGroup({
        tankId: summary?.tank.id || 1,
        tankName: tName,
        profile: activeProfile,
        filledHeightCm: filledCm,
        fillPercent: fillPct,
        materialColor: matColor,
        viewStyle,
        showGapBeam,
        isSelected: true,
        isLowWarning: summary?.isLowWarning || false,
        isHighWarning: summary?.isHighWarning || false,
        maxAnisotropy,
      });
      tanksRoot.add(tankGroup);

      const midY = 0.72 + (activeProfile.totalHeightCm * 0.01) / 2;
      controls.target.set(0, midY, 0);
    }

    requestRender();
  }, [
    mode,
    summary,
    summaries,
    customProfile,
    customFillPercent,
    customMaterialColor,
    customTankName,
    selectedTankId,
    viewStyle,
    showGapBeam,
  ]);

  const activeTitle =
    mode === 'factory'
      ? `3D Factory Silo Bay (${summaries.length} Hopper Tanks)`
      : summary
      ? `Tank ${summary.tank.name} — ${summary.material?.name || 'Unassigned'}`
      : `Tank ${customTankName} — 3D Volumetric Preview`;

  const activeSpec =
    mode === 'factory'
      ? 'Tap any 3D tank to open · Drag to orbit'
      : summary
      ? `${summary.stockNowKg.toLocaleString()} kg (${summary.fillPercent.toFixed(
          1
        )}%) · Gap: ${summary.emptyGapCm.toFixed(0)} cm`
      : customProfile
      ? `Capacity: ${customProfile.totalCapacityLitres.toLocaleString()} L · Hopper Top: ${
          customProfile.hopperTopHeightCm
        } cm`
      : '';

  return (
    <div
      className={`relative w-full ${heightClass} rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 select-none`}
    >
      {/* Dedicated Empty WebGL Mount Container */}
      <div ref={canvasMountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

      {/* Top-Left Minimal Spec Badge (100% Unobstructed Center) */}
      <div className="absolute top-3 left-3 z-10 pointer-events-none flex flex-col gap-0.5 bg-slate-900/95 border border-slate-700/80 rounded-xl px-3.5 py-2">
        <div className="flex items-center gap-2">
          <Box className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-bold text-white tracking-tight">
            {activeTitle}
          </span>
        </div>
        {activeSpec && (
          <span className="text-[11px] font-mono tabular-nums text-slate-300">
            {activeSpec}
          </span>
        )}
      </div>

      {/* Unified Collapsible Bottom Control Dock (Zero Side-Panel Clutter, No backdrop-filter) */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 flex flex-col items-center transition-transform duration-200"
        style={{
          bottom: '12px',
          maxWidth: 'min(940px, 94vw)',
        }}
      >
        <button
          type="button"
          onClick={() => setHudCollapsed((prev) => !prev)}
          className="flex items-center gap-1 rounded-t-lg bg-slate-900 border border-b-0 border-slate-700 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
        >
          {hudCollapsed ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Show 3D Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {!hudCollapsed && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 shadow-xl">
            {/* View Mode Selector */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {(
                [
                  { id: 'cutaway', label: 'Cutaway' },
                  { id: 'xray', label: 'X-Ray' },
                  { id: 'solid', label: 'Solid Steel' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setViewStyle(opt.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    viewStyle === opt.id
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Laser Gap Beam Toggle */}
            <button
              type="button"
              onClick={() => setShowGapBeam((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showGapBeam
                  ? 'bg-sky-950 border-sky-700 text-sky-200'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              <Ruler className="w-3.5 h-3.5" />
              <span>Top Gap Laser</span>
            </button>

            {/* Camera Angle Presets */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => sceneRef.current?.flyToPreset('iso')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>3D Iso</span>
              </button>
              <button
                type="button"
                onClick={() => sceneRef.current?.flyToPreset('front')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eye className="w-3 h-3" />
                <span>Front</span>
              </button>
              <button
                type="button"
                onClick={() => sceneRef.current?.flyToPreset('top')}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Layers className="w-3 h-3" />
                <span>Top</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
