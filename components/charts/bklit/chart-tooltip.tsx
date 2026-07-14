"use client";

import {
  ChartTooltipRenderer,
  type ChartTooltipProps,
} from "@/components/charts/tooltip/chart-tooltip";
import { useChart } from "./chart-context";

/** Binds the shared tooltip presentation to bklit's split chart context. */
export function ChartTooltip(props: ChartTooltipProps) {
  const chart = useChart();
  return <ChartTooltipRenderer {...props} chart={chart} />;
}

ChartTooltip.displayName = "ChartTooltip";

export type { ChartTooltipProps };
export default ChartTooltip;
