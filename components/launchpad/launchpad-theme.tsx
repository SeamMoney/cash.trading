"use client";

import type { ReactNode } from "react";
import { Theme } from "frosted-ui";

import { useThemeName } from "@/components/layout/theme-toggle";

/**
 * frosted-ui resolves its own token set from the `appearance` prop, so a
 * hardcoded "dark" would leave every frosted Card, Button and Badge on this
 * route dark on a light page. CSS cannot reach those tokens — the prop has to
 * follow the document theme, which is why this wrapper is a client component.
 */
export function LaunchpadTheme({ children }: { children: ReactNode }) {
  const theme = useThemeName();

  return (
    <Theme
      appearance={theme}
      accentColor="lime"
      grayColor="gray"
      successColor="green"
      hasBackground={false}
      className="cash-trade-theme"
    >
      {children}
    </Theme>
  );
}
