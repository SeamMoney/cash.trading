"use client"

import { useMemo, useState, useCallback, useRef, useEffect } from "react"
import { ParentSize } from "@visx/responsive"
import { scaleBand, scaleLinear } from "@visx/scale"
import { Bar } from "@visx/shape"
import { GridRows } from "@visx/grid"
import { AxisBottom, AxisLeft } from "@visx/axis"
import { localPoint } from "@visx/event"
import { motion, AnimatePresence } from "framer-motion"

// Types
export interface BarDataPoint {
  label: string
  value: number
  color?: string
}

interface BarChartProps {
  data: BarDataPoint[]
  height?: number
  showGrid?: boolean
  showAxis?: boolean
  showTooltip?: boolean
  animationDuration?: number
  barColor?: string
  className?: string
  valueFormatter?: (value: number) => string
}

// Chart margins
const margin = { top: 20, right: 20, bottom: 40, left: 50 }

// Tooltip component
function ChartTooltip({
  x,
  y,
  data,
  visible,
  formatter,
}: {
  x: number
  y: number
  data: BarDataPoint | null
  visible: boolean
  formatter?: (value: number) => string
}) {
  if (!visible || !data) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="absolute pointer-events-none z-10 backdrop-blur-md rounded-lg px-3 py-2"
        style={{
          left: x,
          top: y - 60,
          transform: "translateX(-50%)",
          background: "var(--chart-tooltip-background)",
        }}
      >
        <p className="text-xs font-mono text-muted-foreground">
          {data.label}
        </p>
        <p className="text-lg font-mono font-bold text-primary tabular-nums">
          {formatter ? formatter(data.value) : data.value.toLocaleString()}
        </p>
      </motion.div>
    </AnimatePresence>
  )
}

// Inner chart component
function ChartInner({
  data,
  width,
  height,
  showGrid = true,
  showAxis = true,
  showTooltip = true,
  animationDuration = 800,
  barColor,
  valueFormatter,
}: BarChartProps & { width: number; height: number }) {
  const [tooltipData, setTooltipData] = useState<{
    x: number
    y: number
    data: BarDataPoint | null
  } | null>(null)
  const [animationComplete, setAnimationComplete] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationComplete(true)
    }, animationDuration)
    return () => clearTimeout(timer)
  }, [animationDuration])

  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: data.map((d) => d.label),
        range: [0, innerWidth],
        padding: 0.3,
      }),
    [data, innerWidth]
  )

  const yScale = useMemo(
    () =>
      scaleLinear({
        domain: [0, Math.max(...data.map((d) => d.value)) * 1.1],
        range: [innerHeight, 0],
        nice: true,
      }),
    [data, innerHeight]
  )

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!animationComplete || !showTooltip) return

      const point = localPoint(event)
      if (!point) return

      const x = point.x - margin.left

      // Find which bar we're hovering over
      const bandwidth = xScale.bandwidth()
      const step = xScale.step()
      const index = Math.floor(x / step)

      if (index >= 0 && index < data.length) {
        const d = data[index]
        const barX = xScale(d.label) || 0
        setTooltipData({
          x: barX + bandwidth / 2 + margin.left,
          y: yScale(d.value) + margin.top,
          data: d,
        })
      }
    },
    [animationComplete, showTooltip, xScale, yScale, data]
  )

  const handleMouseLeave = useCallback(() => {
    setTooltipData(null)
  }, [])

  const primaryBar = barColor || "var(--chart-3)"
  const gridColor = "var(--chart-grid)"
  const textColor = "var(--chart-foreground)"

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ overflow: "visible" }}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Grid */}
          {showGrid && (
            <GridRows
              scale={yScale}
              width={innerWidth}
              stroke={gridColor}
              strokeOpacity={0.5}
              strokeDasharray="2,4"
              numTicks={5}
            />
          )}

          {/* Bars */}
          {data.map((d, i) => {
            const barX = xScale(d.label) || 0
            const barHeight = innerHeight - yScale(d.value)
            const barY = yScale(d.value)

            return (
              <motion.g key={d.label}>
                <motion.rect
                  x={barX}
                  y={innerHeight}
                  width={xScale.bandwidth()}
                  height={0}
                  fill={d.color || primaryBar}
                  rx={4}
                  initial={{ y: innerHeight, height: 0 }}
                  animate={{ y: barY, height: barHeight }}
                  transition={{
                    duration: animationDuration / 1000,
                    delay: (i * animationDuration) / (data.length * 1000),
                    ease: "easeOut",
                  }}
                />
              </motion.g>
            )
          })}

          {/* X Axis */}
          {showAxis && (
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              stroke={gridColor}
              tickStroke={gridColor}
              tickLabelProps={() => ({
                fill: textColor,
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                textAnchor: "middle",
              })}
              hideAxisLine
              hideTicks
            />
          )}

          {/* Y Axis */}
          {showAxis && (
            <AxisLeft
              scale={yScale}
              stroke={gridColor}
              tickStroke={gridColor}
              tickLabelProps={() => ({
                fill: textColor,
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                textAnchor: "end",
                dx: -4,
              })}
              numTicks={5}
              tickFormat={(v) => {
                const num = v as number
                if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
                if (num >= 1000) return `${(num / 1000).toFixed(0)}K`
                return num.toString()
              }}
            />
          )}
        </g>
      </svg>

      {/* Tooltip */}
      {showTooltip && (
        <ChartTooltip
          x={tooltipData?.x || 0}
          y={tooltipData?.y || 0}
          data={tooltipData?.data || null}
          visible={!!tooltipData}
          formatter={valueFormatter}
        />
      )}
    </div>
  )
}

// Main export with responsive wrapper
export function BarChart({
  data,
  height = 200,
  className = "",
  ...props
}: BarChartProps) {
  return (
    <div className={`w-full ${className}`} style={{ height }}>
      <ParentSize debounceTime={10}>
        {({ width }) => (
          <ChartInner
            data={data}
            width={width}
            height={height}
            {...props}
          />
        )}
      </ParentSize>
    </div>
  )
}
