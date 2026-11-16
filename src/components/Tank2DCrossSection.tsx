import React, { useId } from 'react';
import { TankVolumetricProfile } from '../lib/tankMath.ts';

interface Tank2DCrossSectionProps {
  profile: TankVolumetricProfile;
  filledHeightCm: number;
  fillPercent: number;
  materialColor?: string;
  isLowWarning?: boolean;
  isHighWarning?: boolean;
  showDimensions?: boolean;
  className?: string;
}

export const Tank2DCrossSection: React.FC<Tank2DCrossSectionProps> = ({
  profile,
  filledHeightCm,
  fillPercent,
  materialColor = '#d97706',
  isLowWarning = false,
  isHighWarning = false,
  showDimensions = false,
  className = 'w-24 h-32',
}) => {
  const rawUid = useId().replace(/:/g, '');
  const clipId = `tank-clip-${rawUid}`;
  const gradId = `grain-grad-${rawUid}`;

  const padX = showDimensions ? 38 : 16;
  const padTop = showDimensions ? 24 : 14;
  const padBottom = showDimensions ? 28 : 20;

  const w = Math.max(100, profile.maxWidthCm);
  const h = Math.max(100, profile.totalHeightCm);

  const viewW = w + padX * 2;
  const viewH = h + padTop + padBottom;

  // Convert tank cm (x from left, y up from outlet) to SVG coordinates (y down from top)
  const toSvgX = (xCm: number) => padX + (xCm - profile.minXCm);
  const toSvgY = (yCm: number) => padTop + (h - yCm);

  const polygonPointsStr = profile.normalizedPoints
    .map((p) => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`)
    .join(' ');

  const clampedFillCm = Math.max(0, Math.min(h, filledHeightCm));
  const fillTopSvgY = toSvgY(clampedFillCm);
  const outletSvgY = toSvgY(0);
  const hopperTopSvgY = toSvgY(profile.hopperTopHeightCm);

  const fillColor = isLowWarning
    ? '#dc2626'
    : isHighWarning
    ? '#ea580c'
    : materialColor;

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className={className}
      aria-label={`Tank cross section ${fillPercent.toFixed(0)}% full`}
    >
      <defs>
        <clipPath id={clipId}>
          <polygon points={polygonPointsStr} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.95" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.72" />
        </linearGradient>
      </defs>

      {/* Tank Interior Background */}
      <polygon
        points={polygonPointsStr}
        fill="#0f172a"
        stroke="#475569"
        strokeWidth={Math.max(3, w * 0.018)}
        strokeLinejoin="round"
      />

      {/* Clipped Grain Fill Layer */}
      <g clipPath={`url(#${clipId})`}>
        {/* Subtle 50 cm horizontal internal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => {
          const yLine = toSvgY(h * frac);
          return (
            <line
              key={frac}
              x1={padX}
              y1={yLine}
              x2={padX + w}
              y2={yLine}
              stroke="#334155"
              strokeWidth={Math.max(1.5, w * 0.008)}
              strokeDasharray="6 6"
            />
          );
        })}

        {/* Hopper slope transition line */}
        {profile.hopperTopHeightCm > 0 && profile.hopperTopHeightCm < h && (
          <line
            x1={padX}
            y1={hopperTopSvgY}
            x2={padX + w}
            y2={hopperTopSvgY}
            stroke="#64748b"
            strokeWidth={Math.max(2, w * 0.01)}
            strokeDasharray="8 5"
          />
        )}

        {/* Grain Filled Area */}
        {clampedFillCm > 0 && (
          <>
            <rect
              x={padX - 10}
              y={fillTopSvgY}
              width={w + 20}
              height={outletSvgY - fillTopSvgY + 10}
              fill={`url(#${gradId})`}
            />
            <line
              x1={padX - 10}
              y1={fillTopSvgY}
              x2={padX + w + 10}
              y2={fillTopSvgY}
              stroke="#fde68a"
              strokeWidth={Math.max(3, w * 0.018)}
            />
          </>
        )}
      </g>

      {/* Outer Steel Wall Outline */}
      <polygon
        points={polygonPointsStr}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={Math.max(4, w * 0.022)}
        strokeLinejoin="round"
      />

      {/* Conveyor Belt & Rollers at Bottom Outlet */}
      <line
        x1={padX + w * 0.12}
        y1={outletSvgY + padBottom * 0.52}
        x2={padX + w * 0.88}
        y2={outletSvgY + padBottom * 0.52}
        stroke="#f59e0b"
        strokeWidth={Math.max(3.5, w * 0.018)}
        strokeLinecap="round"
        strokeDasharray="10 8"
      />

      {/* Optional Dimension & Gap Callouts */}
      {showDimensions && (
        <>
          <text
            x={padX + w / 2}
            y={padTop - 7}
            textAnchor="middle"
            fill="#475569"
            fontSize={Math.max(12, w * 0.055)}
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            Gap: {Math.max(0, h - clampedFillCm).toFixed(0)} cm
          </text>
          <text
            x={padX + w / 2}
            y={outletSvgY + padBottom * 0.9}
            textAnchor="middle"
            fill="#64748b"
            fontSize={Math.max(11, w * 0.048)}
            fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >
            H: {h}cm · D: {profile.straightDepthCm}/{profile.outletDepthCm}cm
          </text>
        </>
      )}
    </svg>
  );
};
