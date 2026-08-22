"use client";

import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { OrderBook } from "@/components/trade/OrderBook";

type ResponsiveOrderBookProps = Omit<
  ComponentProps<typeof OrderBook>,
  "className" | "rowCount"
>;

interface SwapMarketLayoutProps {
  children: ReactNode;
  orderBookProps: ResponsiveOrderBookProps;
}

const DESKTOP_MARKET_QUERY = "(min-width: 1024px)";

/**
 * Renders the swap card above (or, where there is room, beside) the Trade
 * page's shared OrderBook component.
 *
 * The split starts at `lg`. Holding it back to `2xl` meant a 576px card alone
 * in the middle of a 1440px laptop with the book pushed below the fold and two
 * thirds of the screen left black. From `lg` the row takes the page shell's
 * full measure (`lg:max-w-none` releases the `max-w-xl` that caps the stacked
 * form) — it used to impose a private 1120px frame inside a wider `<main>`,
 * which put ~136px of black down each side of the swap and made the content's
 * left edge jump when you moved between /swap and /trade. Below `lg` both
 * stack in that one `max-w-xl` column, swap first.
 *
 * The book declares its own height at every width: the 452/572px it already
 * used stacked, and from `xl` the 672px /trade gives this same component. It
 * used to be pinned to the swap card instead (`absolute inset-0`), which made
 * a 424px ticket the whole page — the ladder was left 347px for 15 rows that
 * cannot go under 24px each (368px), so it overflowed and the last row was cut
 * mid-glyph, and the page ended 37% of the way up a 900px viewport. A declared
 * height ends both: 490px of ladder at `sm`, 598px at `xl`, against a hard
 * ceiling of 17 rows x 24px = 408px, so `minmax(24px, 1fr)` always has room to
 * stretch to an exact fit and never has to overflow. The trades list still
 * scrolls inside that height.
 */
export function SwapMarketLayout({
  children,
  orderBookProps,
}: SwapMarketLayoutProps) {
  const [desktopMarketLayout, setDesktopMarketLayout] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_MARKET_QUERY);
    const update = () => setDesktopMarketLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)] gap-3 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch lg:gap-4">
      <div className="min-w-0 lg:order-2">
        {children}
      </div>

      <OrderBook
        {...orderBookProps}
        rowCount={desktopMarketLayout ? 17 : 11}
        className="min-w-0 h-[452px] sm:h-[572px] lg:order-1 xl:h-[672px]"
      />
    </div>
  );
}
