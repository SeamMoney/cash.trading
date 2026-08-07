"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, Switch } from "frosted-ui";
import { Eye } from "lucide-react";

import { ResponsiveModalSheet } from "@/components/ui/responsive-modal-sheet";
import { PRODUCT_PRESSABLE_CLASS } from "@/components/ui/product-surface";
import { MarketLogo, type Market } from "@/components/trade/BTCChart";
import { cn } from "@/lib/utils";

type MarketCategory = "all" | "crypto" | "stocks" | "commodities";

const CATEGORY_LABELS: Array<{ id: MarketCategory; label: string }> = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "stocks", label: "Stocks" },
  { id: "commodities", label: "Commodities" },
];

interface MarketPermissionsModalProps {
  busy?: boolean;
  loading?: boolean;
  markets: Market[];
  onClose: () => void;
  onPreview: (market: string) => void;
  onToggle: (market: string) => void;
  onToggleAll: (checked: boolean) => void;
  open: boolean;
  previewMarket: string;
  selectedIds: string[];
}

function normalizedCategory(category: string): Exclude<MarketCategory, "all"> {
  if (category === "stocks" || category === "equity") return "stocks";
  if (category === "commodities" || category === "commodity") return "commodities";
  return "crypto";
}

/**
 * Launchpad-specific market access. This is deliberately not the trade-page
 * market table: the question here is permission, so every row is a switch and
 * the master control grants access to every verified executor in one action.
 */
export function MarketPermissionsModal({
  busy = false,
  loading = false,
  markets,
  onClose,
  onPreview,
  onToggle,
  onToggleAll,
  open,
  previewMarket,
  selectedIds,
}: MarketPermissionsModalProps) {
  const [category, setCategory] = useState<MarketCategory>("all");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = markets.length > 0 && markets.every((market) => selected.has(market.id));
  const visibleCategories = useMemo(
    () => CATEGORY_LABELS.filter(({ id }) => (
      id === "all" || markets.some((market) => normalizedCategory(market.category) === id)
    )),
    [markets],
  );
  const visibleMarkets = useMemo(
    () => markets.filter((market) => (
      category === "all" || normalizedCategory(market.category) === category
    )),
    [category, markets],
  );

  return (
    <ResponsiveModalSheet
      badge={loading ? "Loading markets" : `${selectedIds.length}/${markets.length} approved`}
      desktopClassName="h-[min(720px,calc(100dvh-2rem))]"
      desktopContentClassName="p-0"
      desktopMaxWidthClassName="sm:!max-w-[760px]"
      initialSnap="mid"
      mobileContentClassName="px-0 pb-[env(safe-area-inset-bottom)]"
      onClose={onClose}
      open={open}
      title="Bot market access"
      description="Choose the Decibel markets this bot is allowed to trade"
      titleId="launchpad-market-access-title"
    >
      <div className="sticky top-0 z-10 border-b border-card-border bg-background-secondary/95 px-3 pb-3 pt-3 backdrop-blur-xl sm:px-4">
        <Card
          size="2"
          variant="soft"
          className="!flex !items-center !justify-between !gap-4 !rounded-[var(--radius-sm)] !border !border-card-border !bg-background-tertiary !p-3"
        >
          <div className="min-w-0">
            <p className="text-balance font-display text-[13px] font-semibold text-foreground">
              Allow all launch-ready markets
            </p>
            <p className="mt-0.5 text-pretty text-[11px] leading-4 text-muted-foreground">
              Grant this bot access to every market with a verified executor.
            </p>
          </div>
          <Switch
            aria-label="Allow all launch-ready markets"
            checked={allSelected}
            color="lime"
            disabled={busy || loading || markets.length === 0}
            onCheckedChange={onToggleAll}
            size="3"
          />
        </Card>

        {visibleCategories.length > 2 ? (
          <div className="mt-2.5 flex gap-1 overflow-x-auto pb-0.5 scrollbar-none" aria-label="Market categories">
            {visibleCategories.map((item) => (
              <Button
                key={item.id}
                type="button"
                size="1"
                variant={category === item.id ? "solid" : "surface"}
                color={category === item.id ? "lime" : "gray"}
                highContrast={category === item.id}
                onClick={() => setCategory(item.id)}
                className={cn("shrink-0", PRODUCT_PRESSABLE_CLASS)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 p-3 sm:p-4" aria-busy={loading} aria-live="polite">
        {loading ? (
          <output className="block space-y-2" aria-label="Loading launch-ready markets">
            {Array.from({ length: 6 }, (_, index) => (
              <Card
                key={index}
                aria-hidden="true"
                size="2"
                variant="surface"
                className="!h-16 !animate-pulse !rounded-[var(--radius-sm)] !border !border-card-border !bg-background-tertiary motion-reduce:!animate-none"
              />
            ))}
          </output>
        ) : visibleMarkets.map((market) => {
          const approved = selected.has(market.id);
          const isPreview = previewMarket === market.id;
          const cannotRemove = approved && selectedIds.length === 1;

          return (
            <Card
              key={market.id}
              size="2"
              variant="surface"
              className={cn(
                "!flex !min-h-16 !items-center !gap-3 !rounded-[var(--radius-sm)] !border !p-3 transition-colors",
                approved
                  ? "!border-accent/30 !bg-accent/[0.035]"
                  : "!border-card-border !bg-background-tertiary",
              )}
            >
              <MarketLogo market={market.id} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-display text-[13px] font-semibold text-foreground">
                    {market.pair}
                  </span>
                  {isPreview ? (
                    <Badge size="1" variant="soft" color="lime" className="shrink-0">
                      Previewing
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {market.label}{market.leverage > 0 ? ` · up to ${market.leverage}x` : ""}
                </p>
              </div>

              {approved && !isPreview ? (
                <Button
                  type="button"
                  aria-label={`Preview ${market.pair} on the chart`}
                  color="gray"
                  onClick={() => onPreview(market.id)}
                  size="1"
                  variant="ghost"
                  className={cn("shrink-0", PRODUCT_PRESSABLE_CLASS)}
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Preview</span>
                </Button>
              ) : null}

              <Switch
                aria-label={`${approved ? "Remove" : "Allow"} ${market.pair}`}
                checked={approved}
                color="lime"
                disabled={busy || cannotRemove}
                onCheckedChange={() => onToggle(market.id)}
                size="3"
              />
            </Card>
          );
        })}

        {!loading && visibleMarkets.length === 0 ? (
          <Card size="3" variant="outline" className="!py-10 text-center text-[12px] text-muted-foreground">
            No launch-ready markets in this category.
          </Card>
        ) : null}
      </div>

      <div className="sticky bottom-0 border-t border-card-border bg-background-secondary/95 p-3 backdrop-blur-xl sm:px-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-pretty text-[11px] leading-4 text-muted-foreground">
            At least one market stays approved. The chart previews the market marked above.
          </p>
          <Button
            type="button"
            color="lime"
            highContrast
            onClick={onClose}
            size="2"
            variant="solid"
            className={cn("shrink-0", PRODUCT_PRESSABLE_CLASS)}
          >
            Save access
          </Button>
        </div>
      </div>
    </ResponsiveModalSheet>
  );
}
