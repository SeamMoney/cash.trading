"use client";

import type { ReactNode } from "react";
import { Theme } from "frosted-ui";

import { useThemeName } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * frosted-ui resolves its own token set from the `appearance` prop, so a
 * hardcoded "dark" would leave every frosted Card, Button and Badge on this
 * route dark on a light page. CSS cannot reach those tokens — the prop has to
 * follow the document theme, which is why this wrapper is a client component.
 *
 * `appearance` is deliberately NOT passed. An explicit appearance makes this a
 * frosted "root" theme, which ships an inline <script> into the SSR stream that
 * runs `documentElement.classList.remove('light','dark')`, re-adds one of them
 * and overwrites `style.color-scheme` — before hydration and on every render.
 * On /launchpad only, that fought the boot script in app/layout.tsx (a light
 * user got color-scheme:dark until React's effect undid it), switched on every
 * `dark:` utility document-wide, and left the class behind on <html> after a
 * client-side navigation to another route. frosted resolves its tokens from a
 * `.light` / `.dark` class just as well, so the theme is named on this element
 * and never touches the document.
 */
export function LaunchpadTheme({ children }: { children: ReactNode }) {
  const theme = useThemeName();

  return (
    <Theme
      accentColor="lime"
      grayColor="gray"
      successColor="green"
      hasBackground={false}
      className={cn("cash-trade-theme", theme)}
    >
      {children}
    </Theme>
  );
}
