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

const DESKTOP_MARKET_QUERY = "(min-width: 1536px)";

/**
 * Renders the swap card above (or, where there is room, beside) the Trade
 * page's shared OrderBook component.
 *
 * The split used to start at `lg`, which stretched a 1120px frame across a
 * 1440px viewport and left the bottom half of the page black. One centred
 * column is the resting shape: the card sits in the middle of the frame at
 * its own width and the book follows it, and only at `2xl` — where two
 * columns genuinely fit — does the book move alongside.
 *
 * The swap card is the only thing that sets the row height: it is never
 * padded, stretched or scrolled. In the two-column form the book is taken out
 * of flow (`absolute inset-0`) so it matches that height exactly without ever
 * adding to it — its ladder stretches to fill and its trades list scrolls
 * inside. Stacked, both keep their natural heights, swap first.
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
    <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)] gap-3 2xl:max-w-[1120px] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:items-stretch 2xl:gap-4">
      <div className="min-w-0 2xl:order-2">
        {children}
      </div>

      <div className="relative min-w-0 2xl:order-1">
        <OrderBook
          {...orderBookProps}
          rowCount={desktopMarketLayout ? 17 : 11}
          className="h-[452px] sm:h-[572px] 2xl:absolute 2xl:inset-0 2xl:h-auto"
        />
      </div>
    </div>
  );
}
