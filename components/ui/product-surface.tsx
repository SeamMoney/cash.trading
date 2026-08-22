import * as React from "react";
import { Badge, Button, Card } from "frosted-ui";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { PRESSABLE_CONTROL } from "@/lib/surface";

/**
 * Product-surface primitives for dense cash.trading workflows.
 *
 * These components intentionally consume the semantic tokens owned by
 * `.cash-trade-theme`. Feature code should compose these primitives instead of
 * choosing its own black, border opacity, radius, or selected-state green.
 */

export const PRODUCT_PANEL_CLASS =
  "rounded-[var(--radius)] border border-card-border bg-background-secondary";

export const PRODUCT_CONTROL_CLASS =
  "rounded-[var(--radius-sm)] border border-card-border bg-background-tertiary";

/**
 * Shared tactile feedback for product controls. Keep this transform-only so a
 * press never changes layout, and keep the duration short enough to feel like
 * direct manipulation rather than an entrance animation.
 */
export const PRODUCT_PRESSABLE_CLASS =
  PRESSABLE_CONTROL;

export const PRODUCT_MODAL_CLASS =
  "overflow-hidden border-card-border bg-background-secondary p-0 text-foreground";

export function ProductPanel({
  className,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      data-slot="product-panel"
      size="1"
      variant="surface"
      className={cn(
        PRODUCT_PANEL_CLASS,
        "!p-0",
        "[&>[data-slot=product-section]+[data-slot=product-section]]:border-t [&>[data-slot=product-section]+[data-slot=product-section]]:border-card-border",
        className,
      )}
      {...props}
    />
  );
}

export function ProductSection({
  action,
  children,
  className,
  contentClassName,
  description,
  title,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  action?: React.ReactNode;
  contentClassName?: string;
  description?: React.ReactNode;
  title?: React.ReactNode;
}) {
  return (
    <section
      data-slot="product-section"
      className={cn("min-w-0 px-4 py-3.5", className)}
      {...props}
    >
      {(title || description || action) && (
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div className="font-display text-[13px] font-semibold leading-5 text-foreground">
                {title}
              </div>
            )}
            {description && (
              <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn((title || description || action) && "mt-2.5", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

export function ProductSelectorButton({
  detail,
  icon,
  label,
  trailing,
  value,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "value"> & {
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  label: React.ReactNode;
  trailing?: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="2"
      variant="ghost"
      data-slot="product-selector"
      className={cn(
        "!inline-flex !h-10 min-w-0 !justify-start gap-2 !rounded-[8px] !border !border-transparent !bg-transparent !px-2 !py-1.5 text-left hover:!border-card-border hover:!bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40",
        PRODUCT_PRESSABLE_CLASS,
        className,
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="sr-only">{label}</span>
      <span className="min-w-0 truncate font-display text-[13px] font-semibold text-foreground">
        {value}
      </span>
      {detail && (
        <span className="hidden shrink-0 rounded-[6px] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground sm:inline-flex">
          {detail}
        </span>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground">
        {trailing ?? <ChevronDown className="size-3" aria-hidden="true" />}
      </span>
    </Button>
  );
}

export function ProductSegmented({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Card>) {
  return (
    <Card
      data-slot="product-segmented"
      size="1"
      variant="soft"
      className={cn(PRODUCT_CONTROL_CLASS, "flex gap-1 !p-1", className)}
      {...props}
    >
      {children}
    </Card>
  );
}

export function ProductBadge({
  className,
  ...props
}: React.ComponentProps<typeof Badge>) {
  return (
    <Badge
      data-slot="product-badge"
      size="1"
      variant="surface"
      className={cn(
        "inline-flex items-center rounded-[var(--radius-xs)] border border-card-border bg-card px-2 py-1 font-mono text-[9px] font-semibold uppercase text-foreground-secondary",
        className,
      )}
      {...props}
    />
  );
}
