"use client";

import { cn } from "@/lib/utils";

interface TetherLoaderProps {
  className?: string;
  label?: string;
  labelClassName?: string;
  size?: number;
}

export function TetherLoader({
  className,
  label,
  labelClassName,
  size = 56,
}: TetherLoaderProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3", className)}
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full border border-white/8" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#26A17B] border-r-[#3CD2A5]/70 animate-spin" />
        <div className="absolute inset-[14%] rounded-full border border-white/6" />
        <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-[#0b1110] ring-1 ring-white/8">
          <img
            src="/usdt.svg"
            alt=""
            aria-hidden="true"
            className="size-[68%] rounded-full"
          />
        </div>
      </div>
      {label ? (
        <span className={cn("text-[11px] font-mono text-zinc-500", labelClassName)}>
          {label}
        </span>
      ) : null}
    </div>
  );
}
