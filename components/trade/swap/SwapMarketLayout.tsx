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
 * Keeps every spot swap surface aligned with the Trade page's responsive
 * market rails while rendering the same shared OrderBook component.
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
    <div className="mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)] gap-3 lg:max-w-[1120px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start 2xl:gap-4">
      <div className="min-w-0 lg:order-2 lg:h-[672px] lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-y-auto lg:[&>*]:overscroll-contain lg:[&>*]:scrollbar-thin">
        {children}
      </div>

      <div className="min-w-0 lg:order-1">
        <OrderBook
          {...orderBookProps}
          rowCount={desktopMarketLayout ? 21 : 11}
          className="h-[452px] sm:h-[572px] lg:h-[672px]"
        />
      </div>
    </div>
  );
}
