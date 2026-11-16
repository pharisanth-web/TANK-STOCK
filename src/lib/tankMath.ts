export interface Point2D {
  x: number; // Across from left (cm)
  y: number; // Up from outlet (cm)
}

export interface WallSegmentInfo {
  index: number;
  from: Point2D;
  to: Point2D;
  lengthCm: number;
  midX: number;
  midY: number;
  isVertical: boolean;
  isHorizontal: boolean;
}

export interface SliceLayer1Cm {
  yCm: number; // Bottom of this 1 cm layer (0, 1, 2, ... H-1)
  yMidCm: number; // Center of layer (y + 0.5)
  xLeftCm: number;
  xRightCm: number;
  widthCm: number; // Front-view width at this layer
  depthCm: number; // Front-to-back depth at this layer
  rawLitres: number; // width * depth * 1 / 1000
  litres: number; // rawLitres * correctionFactor
  cumulativeLitres: number; // Total litres from y=0 up to y+1 cm
}

export interface TankVolumetricProfile {
  normalizedPoints: Point2D[];
  totalHeightCm: number;
  maxWidthCm: number;
  minXCm: number;
  maxXCm: number;
  outletWidthCm: number;
  hopperTopHeightCm: number; // Auto-detected height where sloped hopper meets vertical walls
  straightDepthCm: number;
  outletDepthCm: number;
  correctionFactor: number;
  totalCapacityLitres: number;
  hopperCapacityLitres: number;
  wallSegments: WallSegmentInfo[];
  slices: SliceLayer1Cm[];
}

export interface MaterialRecord {
  id: number;
  name: string;
  code: string;
  lotNumber: string;
  kgPerLitre: number;
  colorHex: string;
}

export interface TankRecord {
  id: number;
  name: string;
  materialId: number | null;
  points: Point2D[];
  straightDepthCm: number;
  outletDepthCm: number;
  correctionFactor: number;
  lowWarningPercent: number;
  highWarningPercent: number;
}

export interface TankEntryRecord {
  id: number;
  clientEntryId: string;
  tankId: number;
  materialId: number | null;
  type: 'load' | 'use' | 'reading';
  entryTimestamp: string;
  userUid: string;
  userName: string;
  note: string;
  source: 'manual' | 'sensor';
  kg: number;
  kgPerLitre: number;
  supplierBillLot: string;
  productBatch: string;
  gapCenterCm: number;
  gapWallCm: number;
  gapAvgCm: number;
  filledHeightCm: number;
  calculatedLitres: number;
  previousBookKg: number;
  discrepancyKg: number;
}

export interface TankStockSummary {
  tank: TankRecord;
  material: MaterialRecord | null;
  profile: TankVolumetricProfile;
  stockNowKg: number;
  bookStockOnlyKg: number; // Total loaded - total used across all history
  lastReadingEntry: TankEntryRecord | null;
  loadedSinceReadingKg: number;
  usedSinceReadingKg: number;
  totalLoadedAllTimeKg: number;
  totalUsedAllTimeKg: number;
  activeKgPerLitre: number;
  currentLitres: number;
  maxCapacityKg: number;
  fillPercent: number;
  filledHeightCm: number;
  emptyGapCm: number;
  lastDiscrepancyKg: number; // Difference between last reading and book stock at that time
  isLowWarning: boolean;
  isHighWarning: boolean;
  lastActivityAt: string | null;
}

/**
 * Auto-detects the height (Y cm up from outlet) where the sloped hopper walls
 * become vertical straight walls.
 */
export function detectHopperTopHeightCm(points: Point2D[], totalHeightCm: number): number {
  if (points.length < 3 || totalHeightCm <= 0) return 0;

  // Find segments that are nearly vertical (|dx| <= 2 cm and dy >= 15 cm)
  const verticalBottomYs: number[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dy = Math.abs(b.y - a.y);
    const dx = Math.abs(b.x - a.x);

    if (dy >= 15 && dx / dy < 0.04) {
      const bottomY = Math.min(a.y, b.y);
      if (bottomY > 1 && bottomY < totalHeightCm - 1) {
        verticalBottomYs.push(bottomY);
      }
    }
  }

  if (verticalBottomYs.length > 0) {
    // Use the average or minimum bottom Y of the vertical main body walls
    const avg =
      verticalBottomYs.reduce((acc, v) => acc + v, 0) / verticalBottomYs.length;
    return Math.round(avg);
  }

  // Fallback: look for intermediate vertices between y=0 and y=totalHeightCm
  const interiorYs = points
    .map((p) => p.y)
    .filter((y) => y > 5 && y < totalHeightCm - 5)
    .sort((a, b) => a - b);

  if (interiorYs.length > 0) {
    return Math.round(interiorYs[interiorYs.length - 1]);
  }

  // If the entire tank is a pyramid/hopper with no vertical wall section
  return Math.round(totalHeightCm * 0.35);
}

/**
 * Slices a 2D front-view polygon into 1 cm horizontal layers from y = 0 (outlet)
 * up to the top of the tank.
 * Formula: litres = width_cm * depth_cm * 1 cm / 1000 * correctionFactor
 * Depth narrows evenly from the top of the sloped part (hopperTopHeightCm) down to the outlet.
 */
export function buildTankVolumetricProfile(
  rawPoints: Point2D[],
  straightDepthCm: number,
  outletDepthCm: number,
  correctionFactor: number = 1.0
): TankVolumetricProfile {
  const safePoints =
    rawPoints && rawPoints.length >= 3
      ? rawPoints
      : [
          { x: 90, y: 0 },
          { x: 150, y: 0 },
          { x: 240, y: 120 },
          { x: 240, y: 420 },
          { x: 0, y: 420 },
          { x: 0, y: 120 },
        ];

  const minY = Math.min(...safePoints.map((p) => p.y));
  const minX = Math.min(...safePoints.map((p) => p.x));
  const maxX = Math.max(...safePoints.map((p) => p.x));

  // Normalize Y so the lowest outlet point sits at y = 0 cm
  const normalizedPoints = safePoints.map((p) => ({
    x: Number(p.x.toFixed(1)),
    y: Number((p.y - minY).toFixed(1)),
  }));

  const totalHeightCm = Math.max(
    1,
    Math.round(Math.max(...normalizedPoints.map((p) => p.y)))
  );
  const maxWidthCm = Math.max(1, Number((maxX - minX).toFixed(1)));

  // Calculate wall segment lengths for the 2D drawing editor
  const wallSegments: WallSegmentInfo[] = [];
  for (let i = 0; i < normalizedPoints.length; i++) {
    const from = normalizedPoints[i];
    const to = normalizedPoints[(i + 1) % normalizedPoints.length];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthCm = Number(Math.hypot(dx, dy).toFixed(1));
    wallSegments.push({
      index: i,
      from,
      to,
      lengthCm,
      midX: (from.x + to.x) / 2,
      midY: (from.y + to.y) / 2,
      isVertical: Math.abs(dx) < 1 && Math.abs(dy) > 5,
      isHorizontal: Math.abs(dy) < 1 && Math.abs(dx) > 5,
    });
  }

  const hopperTopHeightCm = detectHopperTopHeightCm(normalizedPoints, totalHeightCm);

  const safeStraightDepth = Math.max(1, straightDepthCm || 200);
  const safeOutletDepth = Math.max(1, outletDepthCm || safeStraightDepth);
  const safeFactor = correctionFactor > 0 ? correctionFactor : 1.0;

  const slices: SliceLayer1Cm[] = [];
  let cumulativeLitres = 0;
  let hopperCapacityLitres = 0;

  for (let y = 0; y < totalHeightCm; y++) {
    const yMid = y + 0.5;
    const xIntersections: number[] = [];

    for (let i = 0; i < normalizedPoints.length; i++) {
      const p1 = normalizedPoints[i];
      const p2 = normalizedPoints[(i + 1) % normalizedPoints.length];

      // Check if horizontal line Y = yMid crosses edge (p1, p2)
      if ((p1.y <= yMid && p2.y > yMid) || (p2.y <= yMid && p1.y > yMid)) {
        const t = (yMid - p1.y) / (p2.y - p1.y);
        const xAtY = p1.x + t * (p2.x - p1.x);
        xIntersections.push(xAtY);
      }
    }

    let xLeftCm = minX;
    let xRightCm = maxX;
    if (xIntersections.length >= 2) {
      xLeftCm = Math.min(...xIntersections);
      xRightCm = Math.max(...xIntersections);
    }

    const widthCm = Math.max(0, xRightCm - xLeftCm);

    // Depth narrows evenly from the top of the sloped part down to the outlet
    let depthCm = safeStraightDepth;
    if (hopperTopHeightCm > 0 && yMid < hopperTopHeightCm) {
      const ratio = Math.max(0, Math.min(1, yMid / hopperTopHeightCm));
      depthCm = safeOutletDepth + (safeStraightDepth - safeOutletDepth) * ratio;
    }

    // 1 cm slice formula: litres = width * depth * 1 cm / 1000
    const rawLitres = (widthCm * depthCm * 1.0) / 1000.0;
    const litres = rawLitres * safeFactor;
    cumulativeLitres += litres;

    if (yMid <= hopperTopHeightCm) {
      hopperCapacityLitres += litres;
    }

    slices.push({
      yCm: y,
      yMidCm: yMid,
      xLeftCm: Number(xLeftCm.toFixed(2)),
      xRightCm: Number(xRightCm.toFixed(2)),
      widthCm: Number(widthCm.toFixed(2)),
      depthCm: Number(depthCm.toFixed(2)),
      rawLitres: Number(rawLitres.toFixed(4)),
      litres: Number(litres.toFixed(4)),
      cumulativeLitres: Number(cumulativeLitres.toFixed(2)),
    });
  }

  const outletWidthCm = slices.length > 0 ? slices[0].widthCm : 40;

  return {
    normalizedPoints,
    totalHeightCm,
    maxWidthCm,
    minXCm: minX,
    maxXCm: maxX,
    outletWidthCm,
    hopperTopHeightCm,
    straightDepthCm: safeStraightDepth,
    outletDepthCm: safeOutletDepth,
    correctionFactor: safeFactor,
    totalCapacityLitres: Number(cumulativeLitres.toFixed(1)),
    hopperCapacityLitres: Number(hopperCapacityLitres.toFixed(1)),
    wallSegments,
    slices,
  };
}

/**
 * Converts a filled height in cm (measured up from the outlet) into exact litres
 * using the 1 cm slice lookup table.
 */
export function getLitresAtFilledHeightCm(
  profile: TankVolumetricProfile,
  filledHeightCm: number
): number {
  if (filledHeightCm <= 0 || profile.slices.length === 0) return 0;
  if (filledHeightCm >= profile.totalHeightCm) return profile.totalCapacityLitres;

  const wholeCm = Math.floor(filledHeightCm);
  const fraction = filledHeightCm - wholeCm;

  let litres = wholeCm > 0 ? profile.slices[wholeCm - 1].cumulativeLitres : 0;
  if (fraction > 0 && wholeCm < profile.slices.length) {
    litres += profile.slices[wholeCm].litres * fraction;
  }
  return Number(litres.toFixed(2));
}

/**
 * Converts an empty gap from the top of the tank (centre & wall in cm) and kg/litre
 * into filled height, litres, and physical stock in kg.
 */
export function calculateLevelReadingFromGap(
  profile: TankVolumetricProfile,
  gapCenterCm: number,
  gapWallCm: number,
  kgPerLitre: number
): {
  gapAvgCm: number;
  filledHeightCm: number;
  litres: number;
  kg: number;
  fillPercent: number;
} {
  const safeCenter = Math.max(0, gapCenterCm || 0);
  const safeWall = Math.max(0, gapWallCm || 0);
  const gapAvgCm = Number(((safeCenter + safeWall) / 2).toFixed(2));
  const filledHeightCm = Number(
    Math.max(0, Math.min(profile.totalHeightCm, profile.totalHeightCm - gapAvgCm)).toFixed(2)
  );
  const litres = getLitresAtFilledHeightCm(profile, filledHeightCm);
  const safeDensity = kgPerLitre > 0 ? kgPerLitre : 0.78;
  const kg = Number((litres * safeDensity).toFixed(1));
  const fillPercent =
    profile.totalCapacityLitres > 0
      ? Number(Math.min(100, (litres / profile.totalCapacityLitres) * 100).toFixed(1))
      : 0;

  return {
    gapAvgCm,
    filledHeightCm,
    litres,
    kg,
    fillPercent,
  };
}

/**
 * Inverse lookup: Given a volume in litres, finds the corresponding filled height in cm
 * so the 2D and 3D tank views reflect live loads and production uses accurately.
 */
export function getFilledHeightCmFromLitres(
  profile: TankVolumetricProfile,
  targetLitres: number
): number {
  if (targetLitres <= 0 || profile.slices.length === 0) return 0;
  if (targetLitres >= profile.totalCapacityLitres) return profile.totalHeightCm;

  for (let i = 0; i < profile.slices.length; i++) {
    const slice = profile.slices[i];
    if (slice.cumulativeLitres >= targetLitres) {
      const prevCum = i > 0 ? profile.slices[i - 1].cumulativeLitres : 0;
      const sliceVol = slice.litres > 0 ? slice.litres : 1;
      const frac = Math.max(0, Math.min(1, (targetLitres - prevCum) / sliceVol));
      return Number((i + frac).toFixed(1));
    }
  }
  return profile.totalHeightCm;
}

/**
 * Computes the complete real-time stock status for a tank:
 * - Stock now = last level reading + loaded since then - used since.
 * - If there is no reading yet, use loaded - used.
 * - Tracks discrepancy between book stock and level readings.
 */
export function computeTankStockSummary(
  tank: TankRecord,
  material: MaterialRecord | null,
  tankEntries: TankEntryRecord[]
): TankStockSummary {
  const profile = buildTankVolumetricProfile(
    tank.points,
    tank.straightDepthCm,
    tank.outletDepthCm,
    tank.correctionFactor
  );

  // Sort oldest to newest
  const sorted = [...tankEntries].sort((a, b) => {
    const tA = new Date(a.entryTimestamp).getTime();
    const tB = new Date(b.entryTimestamp).getTime();
    if (tA !== tB) return tA - tB;
    return a.id - b.id;
  });

  let lastReadingIndex = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].type === 'reading') {
      lastReadingIndex = i;
      break;
    }
  }

  let totalLoadedAllTimeKg = 0;
  let totalUsedAllTimeKg = 0;
  let loadedSinceReadingKg = 0;
  let usedSinceReadingKg = 0;
  let activeKgPerLitre = material?.kgPerLitre || 0.78;

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if ((e.type === 'load' || e.type === 'reading') && e.kgPerLitre > 0) {
      activeKgPerLitre = e.kgPerLitre;
    }
    if (e.type === 'load') {
      totalLoadedAllTimeKg += e.kg;
      if (i > lastReadingIndex) {
        loadedSinceReadingKg += e.kg;
      }
    } else if (e.type === 'use') {
      totalUsedAllTimeKg += e.kg;
      if (i > lastReadingIndex) {
        usedSinceReadingKg += e.kg;
      }
    }
  }

  const lastReadingEntry = lastReadingIndex >= 0 ? sorted[lastReadingIndex] : null;
  const bookStockOnlyKg = Number(Math.max(0, totalLoadedAllTimeKg - totalUsedAllTimeKg).toFixed(1));

  let stockNowKg = 0;
  if (lastReadingEntry) {
    stockNowKg = lastReadingEntry.kg + loadedSinceReadingKg - usedSinceReadingKg;
  } else {
    stockNowKg = totalLoadedAllTimeKg - totalUsedAllTimeKg;
  }
  stockNowKg = Number(Math.max(0, stockNowKg).toFixed(1));

  const maxCapacityKg = Number((profile.totalCapacityLitres * activeKgPerLitre).toFixed(0));
  const currentLitres = Number(
    Math.min(
      profile.totalCapacityLitres,
      Math.max(0, stockNowKg / (activeKgPerLitre > 0 ? activeKgPerLitre : 0.78))
    ).toFixed(1)
  );
  const fillPercent =
    profile.totalCapacityLitres > 0
      ? Number(Math.min(100, (currentLitres / profile.totalCapacityLitres) * 100).toFixed(1))
      : 0;

  const filledHeightCm = getFilledHeightCmFromLitres(profile, currentLitres);
  const emptyGapCm = Number(Math.max(0, profile.totalHeightCm - filledHeightCm).toFixed(1));
  const lastDiscrepancyKg = lastReadingEntry
    ? Number(lastReadingEntry.discrepancyKg.toFixed(1))
    : 0;

  const isLowWarning = fillPercent <= tank.lowWarningPercent;
  const isHighWarning = fillPercent >= tank.highWarningPercent;
  const lastActivityAt =
    sorted.length > 0 ? sorted[sorted.length - 1].entryTimestamp : null;

  return {
    tank,
    material,
    profile,
    stockNowKg,
    bookStockOnlyKg,
    lastReadingEntry,
    loadedSinceReadingKg: Number(loadedSinceReadingKg.toFixed(1)),
    usedSinceReadingKg: Number(usedSinceReadingKg.toFixed(1)),
    totalLoadedAllTimeKg: Number(totalLoadedAllTimeKg.toFixed(1)),
    totalUsedAllTimeKg: Number(totalUsedAllTimeKg.toFixed(1)),
    activeKgPerLitre: Number(activeKgPerLitre.toFixed(3)),
    currentLitres,
    maxCapacityKg,
    fillPercent,
    filledHeightCm,
    emptyGapCm,
    lastDiscrepancyKg,
    isLowWarning,
    isHighWarning,
    lastActivityAt,
  };
}
