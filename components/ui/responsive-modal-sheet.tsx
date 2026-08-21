"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MobileModalSheet,
  type MobileModalSheetHandle,
} from "@/components/ui/mobile-modal-sheet";
import { PRESSABLE_CONTROL } from "@/lib/surface";

type ViewportMode = "mobile" | "desktop" | null;

interface ResponsiveModalSheetProps {
  badge?: ReactNode;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
  description?: string;
  desktopClassName?: string;
  desktopContentClassName?: string;
  desktopMaxWidthClassName?: string;
  initialSnap?: "compact" | "mid";
  mobileContentClassName?: string;
  onClose: () => void;
  open: boolean;
  title: string;
  titleId: string;
}

/**
 * The single overlay shell used across cash.trading.
 *
 * Desktop intentionally matches the market selector and account dialog. Mobile
 * delegates to the same spring sheet as Portfolio, so every feature gets the
 * same drag, fling, safe-area, scroll handoff, and close behavior by default.
 */
export function ResponsiveModalSheet({
  badge,
  children,
  description,
  desktopClassName,
  desktopContentClassName,
  desktopMaxWidthClassName = "sm:!max-w-[900px]",
  initialSnap = "mid",
  mobileContentClassName,
  onClose,
  open,
  title,
  titleId,
}: ResponsiveModalSheetProps) {
  const [viewport, setViewport] = useState<ViewportMode>(null);
  const mobileSheetRef = useRef<MobileModalSheetHandle>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setViewport(media.matches ? "mobile" : "desktop");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const requestClose = useCallback(() => {
    if (viewport === "mobile") {
      const sheet = mobileSheetRef.current;
      if (sheet) {
        sheet.close();
        return;
      }
    }
    onClose();
  }, [onClose, viewport]);

  if (!open || viewport === null) return null;

  const content = typeof children === "function" ? children(requestClose) : children;

  if (viewport === "mobile") {
    return createPortal(
      <div className="cash-trade-theme">
        <MobileModalSheet
          ref={mobileSheetRef}
          contentClassName={mobileContentClassName}
          initialSnap={initialSnap}
          onClose={onClose}
          open={open}
          title={title}
          description={description}
          titleId={`${titleId}-mobile`}
        >
          {content}
        </MobileModalSheet>
      </div>,
      document.body,
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/85"
        className={cn(
          "cash-trade-theme !flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] !flex-col !gap-0 overflow-hidden rounded-[12px] border-white/[0.08] bg-[#101010] !p-0 shadow-2xl shadow-black/70 outline-none",
          desktopMaxWidthClassName,
          desktopClassName,
        )}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#171717] px-5 py-3 font-mono text-[13px] font-semibold text-[#888]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <DialogTitle className="truncate font-mono text-[13px] font-semibold uppercase leading-none text-[#888]">
              {title}
            </DialogTitle>
            {badge ? (
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-accent">
                {badge}
              </span>
            ) : null}
            {description ? (
              <DialogDescription className="sr-only">
                {description}
              </DialogDescription>
            ) : null}
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={`Close ${title}`}
              className={cn(
                PRESSABLE_CONTROL,
                "rounded-[var(--radius-sm)] p-2 text-[#666] outline-none transition-[transform,opacity] hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </DialogClose>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 scrollbar-thin",
            desktopContentClassName,
          )}
        >
          {content}
        </div>
      </DialogContent>
    </Dialog>
  );
}
