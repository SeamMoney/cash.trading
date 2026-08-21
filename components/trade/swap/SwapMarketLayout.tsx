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
 * Renders the swap card beside the Trade page's shared OrderBook component.
 *
 * The swap card is the only thing that sets the row height: it is never
 * padded, stretched or scrolled. On desktop the book is taken out of flow
 * (`absolute inset-0`) so it matches that height exactly without ever adding
 * to it — its ladder stretches to fill and its trades list scrolls inside.
 * Below `lg` both stack at their natural heights, swap first, and the book
 * keeps the Trade page's mobile heights.
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
    <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)] gap-3 lg:max-w-[1120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-stretch 2xl:gap-4">
      <div className="min-w-0 lg:order-2">
        {children}
      </div>

      <div className="relative min-w-0 lg:order-1">
        <OrderBook
          {...orderBookProps}
          rowCount={desktopMarketLayout ? 17 : 11}
          className="h-[452px] sm:h-[572px] lg:absolute lg:inset-0 lg:h-auto"
        />
      </div>
    </div>
  );
}
