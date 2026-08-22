"use client";

import { useEffect, useState } from "react";

interface SwapQuoteAmountProps {
  announcement: string;
  className: string;
  display: string;
}

/**
 * Keeps visual quote updates immediate while coalescing screen-reader speech.
 * Fast input should never queue a stack of number animations or announcements.
 */
export function SwapQuoteAmount({
  announcement,
  className,
  display,
}: SwapQuoteAmountProps) {
  const [spokenQuote, setSpokenQuote] = useState("");

  useEffect(() => {
    if (!announcement) {
      setSpokenQuote("");
      return;
    }
    const timer = window.setTimeout(() => setSpokenQuote(announcement), 320);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {spokenQuote}
      </span>
      <p title={display} className={className}>
        {display}
      </p>
    </>
  );
}
