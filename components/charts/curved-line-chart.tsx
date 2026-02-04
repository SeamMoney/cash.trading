"use client"

import { useMemo, useState, useCallback, useRef, useEffect } from "react"
import { ParentSize } from "@visx/responsive"
import { scaleTime, scaleLinear } from "@visx/scale"
import { LinePath, AreaClosed } from "@visx/shape"
import { curveMonotoneX } from "@visx/curve"
import { GridRows } from "@visx/grid"
import { AxisBottom, AxisLeft } from "@visx/axis"
import { localPoint } from "@visx/event"
import { bisector } from "d3-array"
import { motion, AnimatePresence } from "framer-motion"

// Types
export interface DataPoint {
  date: Date
  value: number
  value2?: number
}

export interface ChartMarker {
  date: Date
  label: string
  color?: string
}

interface CurvedLineChartProps {
  data: DataPoint[]
  height?: number
  showGrid?: boolean
  showAxis?: boolean
  showArea?: boolean
  showTooltip?: boolean
  animationDuration?: number
  markers?: ChartMarker[]
  lineColor?: string
  areaColor?: string
  className?: string
}

// Chart margins - tiny space for minimal axis labels
const margin = { top: 2, right: 2, bottom: 18, left: 32 }

// Bisector for finding data point
const bisectDate = bisector<DataPoint, Date>((d) => d.date).left

// Tooltip component
function ChartTooltip({
  x,
  y,
  data,
  visible,
}: {
  x: number
  y: number
  data: DataPoint | null
  visible: boolean
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
          {data.date.toLocaleDateString()}
        </p>
        <p className="text-lg font-mono font-bold text-primary tabular-nums">
          {data.value.toLocaleString()}
        </p>
      </motion.div>
    </AnimatePresence>
  )
}

// Inner chart component (receives dimensions from ParentSize)
function ChartInner({
  data,
  width,
  height,
  showGrid = true,
  showAxis = true,
  showArea = true,
  showTooltip = true,
  animationDuration = 1500,
  markers = [],
  lineColor,
  areaColor,
}: CurvedLineChartProps & { width: number; height: number }) {
  const [tooltipData, setTooltipData] = useState<{
    x: number
    y: number
    data: DataPoint | null
  } | null>(null)
  const [animationComplete, setAnimationComplete] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)

  // Animation timer
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationComplete(true)
    }, animationDuration)
    return () => clearTimeout(timer)
  }, [animationDuration])

  // Chart dimensions
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom

  // Scales
  const xScale = useMemo(
    () =>
      scaleTime({
        domain: [
          Math.min(...data.map((d) => d.date.getTime())),
          Math.max(...data.map((d) => d.date.getTime())),
        ],
        range: [0, innerWidth],
      }),
    [data, innerWidth]
  )

  const yScale = useMemo(
    () => {
      const values = data.map((d) => d.value)
      const minValue = Math.min(...values)
      const maxValue = Math.max(...values)
      const padding = (maxValue - minValue) * 0.1

      return scaleLinear({
        domain: [Math.max(0, minValue - padding), maxValue + padding],
        range: [innerHeight, 0],
        nice: true,
      })
    },
    [data, innerHeight]
  )

  // Mouse handler
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!animationComplete || !showTooltip) return

      const point = localPoint(event)
      if (!point) return

      const x = point.x - margin.left
      const x0 = xScale.invert(x)
      const index = bisectDate(data, x0, 1)
      const d0 = data[index - 1]
      const d1 = data[index]
      const d =
        d0 && d1
          ? x0.getTime() - d0.date.getTime() > d1.date.getTime() - x0.getTime()
            ? d1
            : d0
          : d0

      if (d) {
        setTooltipData({
          x: xScale(d.date) + margin.left,
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

  // Colors from CSS variables
  const primaryLine = lineColor || "var(--chart-line-primary)"
  const primaryArea = areaColor || "var(--chart-area-fill)"
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
        <defs>
          {/* Gradient for area fill */}
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryLine} stopOpacity={0.3} />
            <stop offset="100%" stopColor={primaryLine} stopOpacity={0} />
          </linearGradient>

          {/* Clip path for animation */}
          <clipPath id="chartClip">
            <motion.rect
              initial={{ width: 0 }}
              animate={{ width: innerWidth }}
              transition={{ duration: animationDuration / 1000, ease: "easeOut" }}
              x={0}
              y={0}
              height={innerHeight}
            />
          </clipPath>
        </defs>

        <g transform={`translate(${margin.left},${margin.top})`}>
          {/* Grid */}
          {showGrid && (
            <GridRows
              scale={yScale}
              width={innerWidth}
              stroke="rgba(255,255,255,0.2)"
              strokeOpacity={1}
              strokeDasharray="4,4"
              numTicks={5}
            />
          )}

          {/* Area */}
          {showArea && (
            <g clipPath="url(#chartClip)">
              <AreaClosed
                data={data}
                x={(d) => xScale(d.date)}
                y={(d) => yScale(d.value)}
                yScale={yScale}
                curve={curveMonotoneX}
                fill="url(#areaGradient)"
              />
            </g>
          )}

          {/* Line */}
          <g clipPath="url(#chartClip)">
            <LinePath
              data={data}
              x={(d) => xScale(d.date)}
              y={(d) => yScale(d.value)}
              curve={curveMonotoneX}
              stroke={primaryLine}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </g>

          {/* Crosshair */}
          {tooltipData && (
            <>
              <line
                x1={tooltipData.x - margin.left}
                y1={0}
                x2={tooltipData.x - margin.left}
                y2={innerHeight}
                stroke="var(--chart-crosshair)"
                strokeDasharray="4,4"
                strokeWidth={1}
              />
              <circle
                cx={tooltipData.x - margin.left}
                cy={tooltipData.y - margin.top}
                r={6}
                fill={primaryLine}
                stroke="black"
                strokeWidth={2}
              />
            </>
          )}

          {/* Markers */}
          {markers.map((marker, i) => {
            const x = xScale(marker.date)
            return (
              <g key={i} transform={`translate(${x},0)`}>
                <line
                  y1={0}
                  y2={innerHeight}
                  stroke={marker.color || "var(--chart-2)"}
                  strokeWidth={1}
                  strokeDasharray="4,4"
                />
                <text
                  y={-8}
                  textAnchor="middle"
                  fill={marker.color || "var(--chart-2)"}
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {marker.label}
                </text>
              </g>
            )
          })}

          {/* X Axis */}
          {showAxis && (
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              stroke="transparent"
              tickStroke="transparent"
              tickLabelProps={() => ({
                fill: textColor,
                fontSize: 8,
                fontFamily: "var(--font-mono)",
                textAnchor: "middle",
                dy: -2,
              })}
              numTicks={4}
              tickLength={0}
            />
          )}

          {/* Y Axis */}
          {showAxis && (
            <AxisLeft
              scale={yScale}
              stroke="transparent"
              tickStroke="transparent"
              tickLabelProps={() => ({
                fill: textColor,
                fontSize: 8,
                fontFamily: "var(--font-mono)",
                textAnchor: "end",
                dx: -2,
                dy: 3,
              })}
              numTicks={4}
              tickLength={0}
              tickFormat={(v) => {
                const num = v as number
                if (num >= 1000000) return `${(num / 1000000).toFixed(0)}M`
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
        />
      )}
    </div>
  )
}

// Main export with responsive wrapper
export function CurvedLineChart({
  data,
  height = 300,
  className = "",
  ...props
}: CurvedLineChartProps) {
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

// Demo data generator
export function generateMockData(days: number = 30): DataPoint[] {
  const data: DataPoint[] = []
  const now = new Date()
  let value = 1000

  for (let i = days; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)

    // Add some randomness with upward trend
    value = value + (Math.random() - 0.4) * 100
    value = Math.max(100, value)

    data.push({
      date,
      value: Math.round(value),
    })
  }

  return data
}
