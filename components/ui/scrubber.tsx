"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ScrubberProps {
  label?: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  ticks?: number;
  className?: string;
  unit?: string;
}

const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

const roundToStep = (val: number, step: number, min: number) =>
  Math.round((val - min) / step) * step + min;

const Scrubber = ({
  label = "Value",
  value: controlledValue,
  defaultValue = 0,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.01,
  decimals = 2,
  ticks = 9,
  className,
  unit,
}: ScrubberProps) => {
  const shouldReduceMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isHoverDevice, setIsHoverDevice] = useState(false);

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;
  const range = max - min;
  const percentage = range > 0 ? ((value - min) / range) * 100 : 0;
  const isActive = isDragging || (isHoverDevice && isHovering);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    setIsHoverDevice(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsHoverDevice(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setValue = useCallback(
    (newValue: number) => {
      const clamped = clamp(roundToStep(newValue, step, min), min, max);
      if (!isControlled) setInternalValue(clamped);
      onValueChange?.(clamped);
    },
    [step, min, max, isControlled, onValueChange]
  );

  const getValueFromPointer = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return value;
      const rect = track.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      return min + ratio * range;
    },
    [min, range, value]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      trackRef.current?.setPointerCapture(e.pointerId);
      setIsDragging(true);
      setValue(getValueFromPointer(e.clientX));
    },
    [getValueFromPointer, setValue]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging) return;
      setValue(getValueFromPointer(e.clientX));
    },
    [isDragging, getValueFromPointer, setValue]
  );

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next: number | undefined;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          next = value + step;
          break;
        case "ArrowLeft":
        case "ArrowDown":
          next = value - step;
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        default:
          return;
      }
      e.preventDefault();
      setValue(next);
    },
    [value, step, min, max, setValue]
  );

  const springConfig = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.25, bounce: 0.1 };

  return (
    <div className={cn("relative w-full select-none", className)}>
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={Number(value.toFixed(decimals))}
        className="relative cursor-pointer overflow-hidden bg-white/[0.04] outline-offset-2 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={trackRef}
        role="slider"
        style={{
          height: 36,
          borderRadius: 8,
          touchAction: "none",
        }}
        tabIndex={0}
      >
        {/* Fill */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            background: "rgba(168,85,247,0.12)",
            borderRadius: 8,
            width: `${percentage}%`,
            transition: isDragging
              ? "none"
              : "width 150ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        />

        {/* Tick marks */}
        {ticks > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {Array.from({ length: ticks }, (_, i) => {
              const pos = ((i + 1) / (ticks + 1)) * 100;
              return (
                <div
                  className="absolute top-1/2 bg-white/10"
                  key={pos}
                  style={{
                    left: `${pos}%`,
                    width: 1,
                    height: 5,
                    borderRadius: 999,
                    transform: "translateX(-50%) translateY(-50%)",
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Capsule thumb */}
        <div
          className="pointer-events-none absolute"
          style={{
            top: "50%",
            left: `${percentage}%`,
            transform: "translateX(-50%) translateY(-50%)",
            marginLeft: -6,
            zIndex: 3,
            transition: isDragging
              ? "none"
              : "left 150ms cubic-bezier(0.23, 1, 0.32, 1)",
          }}
        >
          <motion.div
            animate={{
              opacity: isActive ? 0.9 : 0.25,
              scaleX: isActive ? 1 : 0.7,
              scaleY: isActive ? 1 : 0.7,
            }}
            style={{
              width: 3,
              height: 22,
              borderRadius: 999,
              background: "#a855f7",
            }}
            transition={springConfig}
          />
        </div>

        {/* Label */}
        <div
          className="pointer-events-none absolute top-1/2 left-[14px] -translate-y-1/2 whitespace-nowrap text-zinc-400"
          style={{ fontSize: 12, zIndex: 4, fontWeight: 500 }}
        >
          {label}
        </div>

        {/* Value display */}
        <div
          className="pointer-events-none absolute top-1/2 right-[12px] -translate-y-1/2 text-white"
          style={{
            zIndex: 4,
            fontFamily: "ui-monospace, monospace",
            fontVariantNumeric: "tabular-nums",
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {value.toFixed(decimals)}
          {unit && (
            <span className="text-zinc-600 font-normal ml-0.5 text-[10px]">
              {unit}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default Scrubber;
