"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { PRESSABLE_CONTROL } from "@/lib/surface";
import { cn } from "@/lib/utils";

export type ThemeName = "dark" | "light";

export const THEME_STORAGE_KEY = "cash-trading-theme";

/**
 * Applied by the inline boot script in `app/layout.tsx` before first paint and
 * re-applied here on every change, so the theme never flashes.
 */
export function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

function readStoredTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Private browsing or blocked storage — fall through to the default.
  }
  return "dark";
}

/**
 * Reads the live theme off the document rather than a context, so components
 * that need it (frosted-ui's `<Theme appearance>`, for one) do not have to be
 * wrapped in a provider — the boot script and the toggle both write the same
 * attribute, and this observes it.
 */
export function useThemeName(): ThemeName {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      return () => observer.disconnect();
    },
    () => (document.documentElement.dataset.theme === "light" ? "light" : "dark"),
    () => "dark",
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  // Always render the dark icon on the server: the boot script may have already
  // switched the document, but the markup has to match what React rendered.
  const [theme, setTheme] = useState<ThemeName>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readStoredTheme());
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: ThemeName = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Preference is best-effort; the toggle still works for this session.
      }
      return next;
    });
  }, []);

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light theme" : "Dark theme"}
      // cn(), not a plain join: a caller passing `hidden md:inline-flex` was
      // losing to the base `inline-flex` in the compiled CSS, so the toggle
      // stayed visible on mobile. twMerge resolves the display conflict in
      // the caller's favour.
      className={cn(
        PRESSABLE_CONTROL,
        // 44px hit area in the mobile nav sheet, compact in the desktop header.
        "inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] md:size-8",
        "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className="h-[15px] w-[15px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {mounted && !isDark ? (
          // Sun — shown while light is active, i.e. clicking returns to dark.
          <>
            <circle cx="10" cy="10" r="3.5" />
            <path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M16 4l-1.4 1.4M5.4 14.6L4 16M16 16l-1.4-1.4M5.4 5.4L4 4" />
          </>
        ) : (
          // Moon — shown while dark is active.
          <path d="M16.5 11.4A7 7 0 1 1 8.6 3.5a5.6 5.6 0 0 0 7.9 7.9Z" />
        )}
      </svg>
    </button>
  );
}
