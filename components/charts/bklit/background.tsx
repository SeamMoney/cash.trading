"use client";

import { useId } from "react";

import { useChartStable } from "./chart-context";

interface BackgroundProps {
  color?: string;
  /** Extend the pattern into the chart's reserved top margin. */
  extendTop?: number;
  opacity?: number;
  pattern?: "dots";
  radius?: number;
  scale?: number;
}

/** A lightweight bklit plot background. Only the dotted treatment used here is exposed. */
export function Background({
  color = "var(--chart-grid)",
  extendTop = 0,
  opacity = 1,
  pattern = "dots",
  radius = 1.5,
  scale = 1,
}: BackgroundProps) {
  const { innerHeight, innerWidth } = useChartStable();
  const patternId = `chart-dots-${useId().replace(/:/g, "")}`;

  if (pattern !== "dots" || innerWidth <= 0 || innerHeight <= 0) return null;

  const tileSize = 10 * scale;
  const safeExtendTop = Number.isFinite(extendTop) ? Math.max(0, extendTop) : 0;

  return (
    <g aria-hidden="true" className="chart-background" opacity={opacity}>
      <defs>
        <pattern
          height={tileSize}
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={tileSize}
        >
          <circle cx={tileSize / 2} cy={tileSize / 2} fill={color} r={radius * scale} />
        </pattern>
      </defs>
      <rect
        fill={`url(#${patternId})`}
        height={innerHeight + safeExtendTop}
        width={innerWidth}
        x={0}
        y={-safeExtendTop}
      />
    </g>
  );
}

Background.displayName = "Background";
