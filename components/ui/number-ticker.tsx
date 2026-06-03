"use client";

import NumberFlow, { type Format, usePrefersReducedMotion } from "@number-flow/react";
import { cn } from "@/lib/utils";

type NumberTickerProps = {
  value: number | null | undefined;
  className?: string;
  format?: Intl.NumberFormatOptions;
  locales?: Intl.LocalesArgument;
  prefix?: string;
  suffix?: string;
  fallback?: string;
};

export function NumberTicker({
  value,
  className,
  format,
  locales = "en-US",
  prefix = "",
  suffix = "",
  fallback = "—",
}: NumberTickerProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>{fallback}</span>;
  }

  if (reducedMotion) {
    const formatter = new Intl.NumberFormat(locales, format);
    return (
      <span className={cn("tabular-nums", className)}>
        {prefix}
        {formatter.format(value)}
        {suffix}
      </span>
    );
  }

  return (
    <NumberFlow
      value={value}
      locales={locales}
      format={format as Format | undefined}
      prefix={prefix}
      suffix={suffix}
      className={cn("tabular-nums", className)}
      willChange
      respectMotionPreference
    />
  );
}
