"use client";

import { RefObject, useEffect, useState } from "react";

interface UseInViewportOptions {
  rootMargin?: string;
  threshold?: number;
}

export function useInViewport<T extends Element>(
  ref: RefObject<T | null>,
  options: UseInViewportOptions = {},
) {
  const [isInViewport, setIsInViewport] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsInViewport(entry.isIntersecting),
      {
        rootMargin: options.rootMargin ?? "0px",
        threshold: options.threshold ?? 0,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, options.rootMargin, options.threshold]);

  return isInViewport;
}
