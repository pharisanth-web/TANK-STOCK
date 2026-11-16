import React, { useState, useRef, useMemo } from 'react';
import {
  Point2D,
  MaterialRecord,
  TankRecord,
  buildTankVolumetricProfile,
  getLitresAtFilledHeightCm,
} from '../lib/tankMath.ts';
import { Tank3DViewport } from './Tank3DViewport.tsx';
import {
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Calculator,
  Layers,
  CheckCircle2,
  Move,
  MousePointerClick,
} from 'lucide-react';

interface TankGeometryEditorProps {
  tanks: TankRecord[];
  materials: MaterialRecord[];
  selectedTank: TankRecord | null;
  onSaveTank: (
    tankData: Omit<TankRecord, 'id'>,
    existingId?: number
  ) => Promise<void>;
  onDeleteTank: (tankId: number) => Promise<void>;
}

const PRESET_SHAPES: Record<string, { label: string; points: Point2D[]; straightDepth: number; outletDepth: number }> = {
  standard: {
    label: 'Standard Hopper (260×450 cm)',
    straightDepth: 260,
    outletDepth: 40,
    points: [
      { x: 110, y: 0 },
      { x: 150, y: 0 },
      { x: 260, y: 130 },
      { x: 260, y: 450 },
      { x: 0, y: 450 },
      { x: 0, y: 130 },
    ],
  },
  compact: {
    label: 'Compact Hopper (200×380 cm)',
    straightDepth: 200,
    outletDepth: 35,
    points: [
      { x: 80, y: 0 },
      { x: 120, y: 0 },
      { x: 200, y: 110 },
      { x: 200, y: 380 },
      { x: 0, y: 380 },
      { x: 0, y: 110 },
    ],
  },
  asymmetric: {
    label: 'Side-Outlet Hopper (220×420 cm)',
    straightDepth: 220,
    outletDepth: 40,
    points: [
      { x: 30, y: 0 },
      { x: 70, y: 0 },
      { x: 220, y: 140 },
      { x: 220, y: 420 },
      { x: 0, y: 420 },
      { x: 0, y: 140 },
    ],
  },
  steep: {
    label: 'Tall Steep Cone (240×520 cm)',
    straightDepth: 240,
    outletDepth: 35,
    points: [
      { x: 102, y: 0 },
      { x: 138, y: 0 },
      { x: 240, y: 180 },
      { x: 240, y: 520 },
      { x: 0, y: 520 },
      { x: 0, y: 180 },
    ],
  },
};

export const TankGeometryEditor: React.FC<TankGeometryEditorProps> = ({
  tanks,
  materials,
  selectedTank,
  onSaveTank,
  onDeleteTank,
}) => {
  const [editingId, setEditingId] = useState<number | undefined>(
    selectedTank?.id
  );
  const [name, setName] = useState<string>(selectedTank?.name || 'E');
  const [materialId, setMaterialId] = useState<number | null>(
    selectedTank?.materialId ?? (materials[0]?.id || null)
  );
  const [points, setPoints] = useState<Point2D[]>(
    selectedTank?.points || PRESET_SHAPES.standard.points
  );
  const [straightDepthCm, setStraightDepthCm] = useState<number>(
    selectedTank?.straightDepthCm || 260
  );
  const [outletDepthCm, setOutletDepthCm] = useState<number>(
    selectedTank?.outletDepthCm || 40
  );
  const [correctionFactor, setCorrectionFactor] = useState<number>(
    selectedTank?.correctionFactor || 1.0
  );
  const [lowWarningPercent, setLowWarningPercent] = useState<number>(
    selectedTank?.lowWarningPercent ?? 15
  );
  const [highWarningPercent, setHighWarningPercent] = useState<number>(
    selectedTank?.highWarningPercent ?? 90
  );

  // Interactive Canvas state
  const [canvasMode, setCanvasMode] = useState<'drag' | 'tap-add'>('drag');
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [previewFillPct, setPreviewFillPct] = useState<number>(65);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Weighed Test Load Calibration Helper state
  const [showTestHelper, setShowTestHelper] = useState(false);
  const [testWeighedKg, setTestWeighedKg] = useState<string>('5000');
  const [testGapCm, setTestGapCm] = useState<string>('210');
  const [testDensity, setTestDensity] = useState<string>('0.78');

  // 1 cm Strapping Table search height
  const [inspectHeightCm, setInspectHeightCm] = useState<string>('150');

  const svgRef = useRef<SVGSVGElement | null>(null);

  const loadTankIntoEditor = (t: TankRecord | null) => {
    setConfirmDelete(false);
    if (!t) {
      // Suggest next tank name (E, F, G, H, etc.)
      const existingNames = new Set(tanks.map((x) => x.name.toUpperCase()));
      const candidates = ['A', 'B', 'C', 'D', 'A1', 'B1', 'C1', 'D1', 'E', 'F', 'G', 'H'];
      const nextName =
        candidates.find((c) => !existingNames.has(c)) || `T${tanks.length + 1}`;
      setEditingId(undefined);
      setName(nextName);
      setMaterialId(materials[0]?.id || null);
      setPoints(PRESET_SHAPES.standard.points);
      setStraightDepthCm(260);
      setOutletDepthCm(40);
      setCorrectionFactor(1.0);
      setLowWarningPercent(15);
      setHighWarningPercent(90);
      return;
    }
    setEditingId(t.id);
    setName(t.name);
    setMaterialId(t.materialId);
    setPoints(t.points.map((p) => ({ ...p })));
    setStraightDepthCm(t.straightDepthCm);
    setOutletDepthCm(t.outletDepthCm);
    setCorrectionFactor(t.correctionFactor);
    setLowWarningPercent(t.lowWarningPercent);
    setHighWarningPercent(t.highWarningPercent);
  };

  const profile = useMemo(
    () =>
      buildTankVolumetricProfile(
        points,
        straightDepthCm,
        outletDepthCm,
        correctionFactor
      ),
    [points, straightDepthCm, outletDepthCm, correctionFactor]
  );

  const selectedMaterial = useMemo(
    () => materials.find((m) => m.id === materialId) || null,
    [materials, materialId]
  );

  // Coordinate System for 2D Drawing Grid
  const gridMaxX = Math.max(320, Math.ceil((profile.maxXCm + 60) / 50) * 50);
  const gridMaxY = Math.max(520, Math.ceil((profile.totalHeightCm + 60) / 50) * 50);
  const padLeft = 56;
  const padRight = 36;
  const padTop = 36;
  const padBottom = 52;
  const viewW = gridMaxX + padLeft + padRight;
  const viewH = gridMaxY + padTop + padBottom;

  const cmToSvgX = (xCm: number) => padLeft + xCm;
  const cmToSvgY = (yCm: number) => padTop + (gridMaxY - yCm);

  const svgEventToCm = (e: React.PointerEvent<SVGSVGElement>): Point2D => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = viewW / rect.width;
    const scaleY = viewH / rect.height;
    const svgX = (e.clientX - rect.left) * scaleX;
    const svgY = (e.clientY - rect.top) * scaleY;

    // Snap to 5 cm grid when dragging, or 1 cm precision
    const rawX = Math.max(0, Math.min(gridMaxX, svgX - padLeft));
    const rawY = Math.max(0, Math.min(gridMaxY, gridMaxY - (svgY - padTop)));
    return {
      x: Math.round(rawX / 5) * 5,
      y: Math.round(rawY / 5) * 5,
    };
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (canvasMode === 'tap-add') {
      const pt = svgEventToCm(e);
      // Insert the new point along the closest polygon edge so polygon doesn't self-intersect
      let bestInsertIdx = points.length;
      let bestDist = Infinity;

      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const d = Math.hypot(pt.x - mx, pt.y - my);
        if (d < bestDist) {
          bestDist = d;
          bestInsertIdx = i + 1;
        }
      }

      const next = [...points];
      next.splice(bestInsertIdx, 0, pt);
      setPoints(next);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingIdx === null) return;
    const pt = svgEventToCm(e);
    setPoints((prev) =>
      prev.map((p, idx) => (idx === draggingIdx ? pt : p))
    );
  };

  const handleSvgPointerUp = () => {
    setDraggingIdx(null);
  };

  const updatePointCoord = (idx: number, field: 'x' | 'y', val: string) => {
    const num = Math.max(0, Number(val) || 0);
    setPoints((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: num } : p))
    );
  };

  const removePoint = (idx: number) => {
    if (points.length <= 3) return;
    setPoints((prev) => prev.filter((_, i) => i !== idx));
  };

  const applyWeighedTestCalibration = () => {
    const weighedKg = Number(testWeighedKg) || 0;
    const gapCm = Number(testGapCm) || 0;
    const dens = Number(testDensity) || 0.78;
    if (weighedKg <= 0 || dens <= 0) return;

    // Build uncalibrated profile (factor = 1.0)
    const rawProfile = buildTankVolumetricProfile(
      points,
      straightDepthCm,
      outletDepthCm,
      1.0
    );
    const filledCm = Math.max(0, rawProfile.totalHeightCm - gapCm);
    const rawLitres = getLitresAtFilledHeightCm(rawProfile, filledCm);
    const expectedRawKg = rawLitres * dens;
    if (expectedRawKg > 0) {
      const factor = Number((weighedKg / expectedRawKg).toFixed(4));
      setCorrectionFactor(factor);
      setShowTestHelper(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    try {
      await onSaveTank(
        {
          name: name.trim().toUpperCase(),
          materialId,
          points: profile.normalizedPoints,
          straightDepthCm,
          outletDepthCm,
          correctionFactor,
          lowWarningPercent,
          highWarningPercent,
        },
        editingId
      );
      setSaveMessage(`Tank ${name.toUpperCase()} saved & synced across all phones.`);
      setTimeout(() => setSaveMessage(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  const inspectedSliceIdx = Math.min(
    profile.slices.length - 1,
    Math.max(0, Math.floor(Number(inspectHeightCm) || 0))
  );
  const inspectedSlice = profile.slices[inspectedSliceIdx];

  return (
    <div className="space-y-6">
      {/* Top Selector Bar: Pick Existing Tank or Add New Tank */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Tank Shape & 1 cm Volumetric Calibration Studio
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Draw front-view corner points on the cm grid, drag corners, or type exact cm (across from left, up from outlet).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {tanks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => loadTankIntoEditor(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  editingId === t.id
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tank {t.name}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => loadTankIntoEditor(null)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>New Tank</span>
          </button>
        </div>
      </div>

      {/* Main Split Workspace: Left = 2D cm Grid Drawing + Coordinates, Right = 3D Preview + Tank Specs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (7 cols): Interactive 2D Front-View Drawing Grid + Exact Point Table */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. Front-View Shape Drawing (cm Grid)
                </h3>
                <p className="text-xs text-slate-500">
                  Each side&apos;s length is shown in cm. Dashed orange line marks auto-detected Hopper Slope Top ({profile.hopperTopHeightCm} cm).
                </p>
              </div>

              {/* Mode Switcher: Drag Points vs Tap to Add Point */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCanvasMode('drag')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    canvasMode === 'drag'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Move className="w-3.5 h-3.5" />
                  <span>Drag Points</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasMode('tap-add')}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    canvasMode === 'tap-add'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MousePointerClick className="w-3.5 h-3.5" />
                  <span>Tap to Add Point</span>
                </button>
              </div>
            </div>

            {/* Quick Template Presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-medium mr-1">Quick Shapes:</span>
              {Object.entries(PRESET_SHAPES).map(([key, preset]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setPoints(preset.points.map((p) => ({ ...p })));
                    setStraightDepthCm(preset.straightDepth);
                    setOutletDepthCm(preset.outletDepth);
                  }}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Interactive SVG Centimetre Grid */}
            <div className="relative rounded-xl overflow-hidden border border-slate-300 bg-slate-950 select-none">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${viewW} ${viewH}`}
                onPointerDown={handleSvgPointerDown}
                onPointerMove={handleSvgPointerMove}
                onPointerUp={handleSvgPointerUp}
                onPointerLeave={handleSvgPointerUp}
                className={`w-full h-[380px] sm:h-[430px] touch-none ${
                  canvasMode === 'tap-add' ? 'cursor-crosshair' : 'cursor-default'
                }`}
              >
                {/* 50 cm Major Grid Lines & Axis Labels */}
                {Array.from({ length: Math.floor(gridMaxX / 50) + 1 }).map((_, idx) => {
                  const xCm = idx * 50;
                  const sx = cmToSvgX(xCm);
                  return (
                    <g key={`gx-${xCm}`}>
                      <line
                        x1={sx}
                        y1={padTop}
                        x2={sx}
                        y2={padTop + gridMaxY}
                        stroke={xCm % 100 === 0 ? '#334155' : '#1e293b'}
                        strokeWidth={xCm % 100 === 0 ? 1.5 : 1}
                      />
                      {xCm % 50 === 0 && (
                        <text
                          x={sx}
                          y={padTop + gridMaxY + 20}
                          textAnchor="middle"
                          fill="#94a3b8"
                          fontSize="12"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {xCm}
                        </text>
                      )}
                    </g>
                  );
                })}

                {Array.from({ length: Math.floor(gridMaxY / 50) + 1 }).map((_, idx) => {
                  const yCm = idx * 50;
                  const sy = cmToSvgY(yCm);
                  return (
                    <g key={`gy-${yCm}`}>
                      <line
                        x1={padLeft}
                        y1={sy}
                        x2={padLeft + gridMaxX}
                        y2={sy}
                        stroke={yCm % 100 === 0 ? '#334155' : '#1e293b'}
                        strokeWidth={yCm % 100 === 0 ? 1.5 : 1}
                      />
                      {yCm % 50 === 0 && (
                        <text
                          x={padLeft - 10}
                          y={sy + 4}
                          textAnchor="end"
                          fill="#94a3b8"
                          fontSize="12"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {yCm}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Axis Titles */}
                <text
                  x={padLeft + gridMaxX / 2}
                  y={viewH - 8}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="13"
                  fontWeight="600"
                >
                  Across from Left (X cm) →
                </text>
                <text
                  x={16}
                  y={padTop + gridMaxY / 2}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="13"
                  fontWeight="600"
                  transform={`rotate(-90 16 ${padTop + gridMaxY / 2})`}
                >
                  ↑ Up from Conveyor Outlet (Y cm)
                </text>

                {/* Filled Polygon Shape */}
                <polygon
                  points={points
                    .map((p) => `${cmToSvgX(p.x)},${cmToSvgY(p.y)}`)
                    .join(' ')}
                  fill="rgba(217, 119, 6, 0.22)"
                  stroke="#f59e0b"
                  strokeWidth="3"
                  strokeLinejoin="round"
                />

                {/* Auto-Detected Hopper Slope Top Line */}
                {profile.hopperTopHeightCm > 0 && (
                  <g>
                    <line
                      x1={padLeft}
                      y1={cmToSvgY(profile.hopperTopHeightCm)}
                      x2={padLeft + gridMaxX}
                      y2={cmToSvgY(profile.hopperTopHeightCm)}
                      stroke="#38bdf8"
                      strokeWidth="2"
                      strokeDasharray="8 6"
                    />
                    <text
                      x={padLeft + gridMaxX - 8}
                      y={cmToSvgY(profile.hopperTopHeightCm) - 6}
                      textAnchor="end"
                      fill="#38bdf8"
                      fontSize="12"
                      fontWeight="700"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      Slope Top: {profile.hopperTopHeightCm} cm (Depth {straightDepthCm}→{outletDepthCm} cm)
                    </text>
                  </g>
                )}

                {/* Each Side's Length Label in cm */}
                {profile.wallSegments.map((seg) => {
                  const sx = cmToSvgX(seg.midX);
                  const sy = cmToSvgY(seg.midY);
                  return (
                    <g key={`seg-${seg.index}`}>
                      <rect
                        x={sx - 34}
                        y={sy - 11}
                        width="68"
                        height="22"
                        rx="5"
                        fill="#0f172a"
                        stroke="#475569"
                        strokeWidth="1.2"
                      />
                      <text
                        x={sx}
                        y={sy + 4}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize="11.5"
                        fontWeight="700"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {seg.lengthCm} cm
                      </text>
                    </g>
                  );
                })}

                {/* Draggable Corner Points */}
                {points.map((pt, idx) => {
                  const cx = cmToSvgX(pt.x);
                  const cy = cmToSvgY(pt.y);
                  const isActive = draggingIdx === idx;
                  return (
                    <g
                      key={`pt-${idx}`}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setDraggingIdx(idx);
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <circle
                        cx={cx}
                        cy={cy}
                        r={isActive ? 14 : 10}
                        fill={isActive ? '#f59e0b' : '#ffffff'}
                        stroke="#0f172a"
                        strokeWidth="3"
                      />
                      <text
                        x={cx}
                        y={cy + 4}
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="10"
                        fontWeight="800"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {idx + 1}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Exact Centimetre Coordinate Table for Corner Points */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-800">
                  Corner Points — Type Exact cm (Across from Left, Up from Outlet)
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    setPoints((prev) => [
                      ...prev,
                      { x: Math.round(profile.maxWidthCm / 2), y: Math.round(profile.totalHeightCm / 2) },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-200 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Point</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <th className="py-2 px-3 font-semibold">Corner #</th>
                      <th className="py-2 px-3 font-semibold">Across from Left (X cm)</th>
                      <th className="py-2 px-3 font-semibold">Up from Outlet (Y cm)</th>
                      <th className="py-2 px-3 font-semibold">Next Side Length</th>
                      <th className="py-2 px-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {points.map((pt, idx) => {
                      const seg = profile.wallSegments[idx];
                      return (
                        <tr key={idx} className="hover:bg-slate-50/80">
                          <td className="py-1.5 px-3 font-bold text-slate-900">
                            Point {idx + 1}
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="number"
                              value={pt.x}
                              onChange={(e) =>
                                updatePointCoord(idx, 'x', e.target.value)
                              }
                              className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3">
                            <input
                              type="number"
                              value={pt.y}
                              onChange={(e) =>
                                updatePointCoord(idx, 'y', e.target.value)
                              }
                              className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                            />
                          </td>
                          <td className="py-1.5 px-3 text-slate-600">
                            {seg ? `${seg.lengthCm} cm` : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <button
                              type="button"
                              disabled={points.length <= 3}
                              onClick={() => removePoint(idx)}
                              className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30 cursor-pointer"
                              title="Remove Corner Point"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): Tank Parameters Form + 3D Live Preview + 1 cm Slice Inspector */}
        <div className="lg:col-span-5 space-y-6">
          {/* Live 3D Hopper Preview */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                2. Live 3D Hopper Tank Preview
              </h3>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Test Fill:</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={previewFillPct}
                  onChange={(e) => setPreviewFillPct(Number(e.target.value))}
                  className="w-24 accent-amber-600"
                />
                <span className="font-mono font-bold text-slate-800 w-9 text-right">
                  {previewFillPct}%
                </span>
              </div>
            </div>

            <Tank3DViewport
              mode="single"
              customProfile={profile}
              customFillPercent={previewFillPct}
              customMaterialColor={selectedMaterial?.colorHex || '#d97706'}
              customTankName={name || 'NEW'}
              heightClass="h-[310px]"
            />
          </div>

          {/* Tank Parameters & Depth Form */}
          <form
            onSubmit={handleSave}
            className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900">
              3. Tank Name, Front-to-Back Depths & Calibration
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tank Name (e.g. A, B, A1, E)
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value.toUpperCase())}
                  placeholder="e.g. A1"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Current Material Inside
                </label>
                <select
                  value={materialId ?? ''}
                  onChange={(e) =>
                    setMaterialId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white focus:border-amber-500 focus:outline-none"
                >
                  <option value="">-- Empty / Unassigned --</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.kgPerLitre} kg/L)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Depth Front-to-Back (Straight Part cm)
                </label>
                <input
                  type="number"
                  required
                  min={10}
                  max={2000}
                  value={straightDepthCm}
                  onChange={(e) => setStraightDepthCm(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Depth at Outlet (Front-to-Back cm)
                </label>
                <input
                  type="number"
                  required
                  min={5}
                  max={2000}
                  value={outletDepthCm}
                  onChange={(e) => setOutletDepthCm(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Correction Factor (Default 1.00)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowTestHelper((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
                  >
                    <Calculator className="w-3 h-3" />
                    <span>Test Load Calc</span>
                  </button>
                </div>
                <input
                  type="number"
                  step="0.001"
                  required
                  min={0.1}
                  max={3.0}
                  value={correctionFactor}
                  onChange={(e) => setCorrectionFactor(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Low Alert (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={80}
                    value={lowWarningPercent}
                    onChange={(e) => setLowWarningPercent(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Alert (%)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={99}
                    value={highWarningPercent}
                    onChange={(e) => setHighWarningPercent(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-2.5 py-2 text-sm font-mono text-slate-900 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Optional Weighed Test Load Calibration Helper */}
            {showTestHelper && (
              <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-3.5 space-y-2.5">
                <p className="text-xs font-bold text-amber-950">
                  Compute Correction Factor from 1 Weighed Test Load:
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-amber-900">
                      Weighed Load (kg)
                    </label>
                    <input
                      type="number"
                      value={testWeighedKg}
                      onChange={(e) => setTestWeighedKg(e.target.value)}
                      className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-amber-900">
                      Top Gap (cm)
                    </label>
                    <input
                      type="number"
                      value={testGapCm}
                      onChange={(e) => setTestGapCm(e.target.value)}
                      className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-amber-900">
                      Density (kg/L)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={testDensity}
                      onChange={(e) => setTestDensity(e.target.value)}
                      className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs font-mono"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={applyWeighedTestCalibration}
                  className="w-full rounded-lg bg-amber-700 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 cursor-pointer"
                >
                  Apply Calculated Correction Factor
                </button>
              </div>
            )}

            {/* Volumetric Summary Metrics */}
            <div className="grid grid-cols-3 gap-2.5 rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
              <div>
                <div className="text-[11px] text-slate-500">Total Capacity</div>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                  {profile.totalCapacityLitres.toLocaleString()} L
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">Hopper Cone</div>
                <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                  {profile.hopperCapacityLitres.toLocaleString()} L
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500">
                  Est. Rice ({selectedMaterial?.kgPerLitre || 0.78} kg/L)
                </div>
                <div className="text-sm font-bold font-mono tabular-nums text-amber-700">
                  {Math.round(
                    profile.totalCapacityLitres *
                      (selectedMaterial?.kgPerLitre || 0.78)
                  ).toLocaleString()}{' '}
                  kg
                </div>
              </div>
            </div>

            {saveMessage && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveMessage}</span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              {editingId !== undefined && (
                <div>
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Tank</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await onDeleteTank(editingId);
                          loadTankIntoEditor(tanks[0] || null);
                        }}
                        className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="rounded-xl bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Save className="w-4 h-4" />
                <span>
                  {saving
                    ? 'Saving...'
                    : editingId !== undefined
                    ? `Save Changes to Tank ${name}`
                    : `Create Tank ${name}`}
                </span>
              </button>
            </div>
          </form>

          {/* 1 cm Layer Slicer Verification Box */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-600" />
                <h4 className="text-xs font-bold text-slate-900">
                  1 cm Slice Formula Inspector (Width × Depth × 1 cm / 1000)
                </h4>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {profile.slices.length} slices
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="text-xs text-slate-600 whitespace-nowrap">
                Inspect Slice at Height (cm):
              </label>
              <input
                type="number"
                min={0}
                max={profile.totalHeightCm - 1}
                value={inspectHeightCm}
                onChange={(e) => setInspectHeightCm(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-mono text-slate-900"
              />
            </div>

            {inspectedSlice && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs font-mono tabular-nums space-y-1 text-slate-700">
                <div className="flex justify-between">
                  <span>Layer Height Band:</span>
                  <span className="font-bold text-slate-900">
                    {inspectedSlice.yCm} cm → {inspectedSlice.yCm + 1} cm
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Width × Depth at {inspectedSlice.yMidCm} cm:</span>
                  <span className="font-bold text-slate-900">
                    {inspectedSlice.widthCm} cm × {inspectedSlice.depthCm} cm
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>1 cm Layer Volume (× {profile.correctionFactor} factor):</span>
                  <span className="font-bold text-amber-700">
                    {inspectedSlice.litres.toFixed(2)} Litres
                  </span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1">
                  <span>Cumulative Volume (0 to {inspectedSlice.yCm + 1} cm):</span>
                  <span className="font-bold text-emerald-700">
                    {inspectedSlice.cumulativeLitres.toLocaleString()} Litres
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
