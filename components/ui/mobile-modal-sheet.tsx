"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import {
  animateMobileSheetSpring,
  MOBILE_SHEET_MID_VH,
  MOBILE_SHEET_RUBBER_BAND_K,
  MOBILE_SHEET_VELOCITY_THRESHOLD,
  mobileSheetRubberBand,
} from "@/lib/mobile-sheet-motion";

interface MobileModalSheetProps {
  children: ReactNode;
  description?: string;
  initialSnap?: "compact" | "mid";
  onClose: () => void;
  open: boolean;
  title: string;
  titleId: string;
}

/**
 * Modal variant of the trade page's persistent Portfolio sheet. It deliberately
 * shares the same spring, fling threshold, rubber band, radii, backdrop, and
 * native-scroll handoff so mobile overlays feel like one component family.
 */
export function MobileModalSheet({
  children,
  description,
  initialSnap = "mid",
  onClose,
  open,
  title,
  titleId,
}: MobileModalSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const stableVh = useRef(0);
  const safeInsetTop = useRef(0);
  const inputFocused = useRef(false);
  const reducedMotion = useRef(false);
  const suppressClickUntil = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialVisibleRatio = initialSnap === "compact" ? 0.42 : MOBILE_SHEET_MID_VH;

  const drag = useRef({
    active: false,
    cancelSpring: null as (() => void) | null,
    currentTop: 0,
    didMove: false,
    lastTime: 0,
    lastY: 0,
    pendingClientY: 0,
    rafId: null as number | null,
    snapIndex: 0,
    startTop: 0,
    startY: 0,
    startedInScrollArea: false,
    velocityY: 0,
  });

  const getSnaps = useCallback(() => {
    const vh = stableVh.current || window.innerHeight;
    return [vh, vh * (1 - initialVisibleRatio), safeInsetTop.current];
  }, [initialVisibleRatio]);

  const applyPosition = useCallback((top: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.transform = `translate3d(0, ${top}px, 0)`;

    const vh = stableVh.current || window.innerHeight;
    const midTop = vh * (1 - initialVisibleRatio);
    const fullTop = safeInsetTop.current;
    const progress = Math.max(0, Math.min(1, (vh - top) / (vh - fullTop)));
    if (overlayRef.current) {
      overlayRef.current.style.opacity = `${progress * 0.6}`;
      overlayRef.current.style.pointerEvents = progress > 0.03 ? "auto" : "none";
    }
    if (innerRef.current) {
      const radiusProgress = Math.max(0, Math.min(1, top / midTop));
      innerRef.current.style.borderRadius = `${radiusProgress * 20}px ${radiusProgress * 20}px 0 0`;
      innerRef.current.style.borderColor = `rgba(255,255,255,${radiusProgress * 0.08})`;
    }
    if (contentRef.current) {
      contentRef.current.style.opacity = `${Math.max(0, Math.min(1, progress / 0.2))}`;
    }
  }, [initialVisibleRatio]);

  const snapTo = useCallback((index: number, velocityPxMs = 0, closeWhenDone = false) => {
    const snaps = getSnaps();
    const safeIndex = Math.max(0, Math.min(index, snaps.length - 1));
    const target = snaps[safeIndex];
    const finish = () => {
      drag.current.snapIndex = safeIndex;
      drag.current.currentTop = target;
      if (closeWhenDone) onCloseRef.current();
    };

    drag.current.cancelSpring?.();
    if (reducedMotion.current) {
      applyPosition(target);
      finish();
      return;
    }
    drag.current.cancelSpring = animateMobileSheetSpring(
      drag.current.currentTop,
      target,
      velocityPxMs * 1000,
      (value) => {
        drag.current.currentTop = value;
        applyPosition(value);
      },
      finish,
    );
  }, [applyPosition, getSnaps]);

  const closeSheet = useCallback(() => {
    snapTo(0, 0, true);
  }, [snapTo]);

  useEffect(() => {
    if (!open) return;
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stableVh.current = window.visualViewport
      ? window.visualViewport.height + window.visualViewport.offsetTop
      : window.innerHeight;
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;top:0;height:env(safe-area-inset-top,0px);pointer-events:none;";
    document.body.appendChild(probe);
    safeInsetTop.current = probe.offsetHeight || 0;
    document.body.removeChild(probe);

    const vh = stableVh.current;
    if (sheetRef.current) sheetRef.current.style.height = `${vh}px`;
    drag.current.currentTop = vh;
    drag.current.snapIndex = 0;
    applyPosition(vh);
    const frame = requestAnimationFrame(() => {
      sheetRef.current?.focus({ preventScroll: true });
      snapTo(1);
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      drag.current.cancelSpring?.();
      document.body.style.overflow = previousOverflow;
    };
  }, [applyPosition, open, snapTo]);

  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      inputFocused.current = tag === "INPUT" || tag === "TEXTAREA";
    };
    const onFocusOut = () => {
      inputFocused.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSheet, open]);

  const handleDragStart = useCallback((clientY: number, target: HTMLElement) => {
    if (inputFocused.current) return false;
    if (
      target.closest(
        "button, a, input, textarea, select, label, [contenteditable='true'], [data-mobile-sheet-no-drag='true']",
      )
    ) {
      return false;
    }
    const scrollArea = scrollAreaRef.current;
    const isInScrollArea = scrollArea?.contains(target);
    if (
      isInScrollArea &&
      (scrollArea?.scrollTop ?? 0) > 0 &&
      drag.current.snapIndex > 0
    ) {
      return false;
    }
    drag.current.cancelSpring?.();
    drag.current.active = true;
    drag.current.startY = clientY;
    drag.current.startTop = drag.current.currentTop;
    drag.current.lastY = clientY;
    drag.current.lastTime = performance.now();
    drag.current.velocityY = 0;
    drag.current.didMove = false;
    drag.current.startedInScrollArea = Boolean(isInScrollArea);
    return true;
  }, []);

  const processDragMove = useCallback((clientY: number) => {
    const now = performance.now();
    const elapsed = now - drag.current.lastTime;
    if (Math.abs(clientY - drag.current.startY) > 3) {
      drag.current.didMove = true;
    }
    if (elapsed > 0) {
      const instantVelocity = (clientY - drag.current.lastY) / elapsed;
      drag.current.velocityY =
        0.7 * instantVelocity + 0.3 * drag.current.velocityY;
    }
    drag.current.lastY = clientY;
    drag.current.lastTime = now;

    const snaps = getSnaps();
    const maxTop = snaps[0];
    const minTop = snaps[snaps.length - 1];
    let nextTop = drag.current.startTop + (clientY - drag.current.startY);
    if (nextTop < minTop) {
      nextTop = minTop + mobileSheetRubberBand(nextTop - minTop);
    } else if (nextTop > maxTop) {
      nextTop = maxTop + (nextTop - maxTop) * MOBILE_SHEET_RUBBER_BAND_K;
    }
    drag.current.currentTop = nextTop;
    applyPosition(nextTop);
  }, [applyPosition, getSnaps]);

  const handleDragMove = useCallback((clientY: number) => {
    if (!drag.current.active) return;
    drag.current.pendingClientY = clientY;
    if (drag.current.rafId === null) {
      drag.current.rafId = requestAnimationFrame(() => {
        drag.current.rafId = null;
        if (drag.current.active) processDragMove(drag.current.pendingClientY);
      });
    }
  }, [processDragMove]);

  const handleDragEnd = useCallback(() => {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (drag.current.rafId !== null) {
      cancelAnimationFrame(drag.current.rafId);
      drag.current.rafId = null;
    }
    if (drag.current.didMove) {
      suppressClickUntil.current = performance.now() + 250;
    }
    const snaps = getSnaps();
    const velocity = drag.current.velocityY;
    let targetIndex = drag.current.snapIndex;
    if (Math.abs(velocity) > MOBILE_SHEET_VELOCITY_THRESHOLD) {
      targetIndex = velocity < 0
        ? Math.min(targetIndex + 1, snaps.length - 1)
        : Math.max(targetIndex - 1, 0);
    } else {
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < snaps.length; index += 1) {
        const nextDistance = Math.abs(drag.current.currentTop - snaps[index]);
        if (nextDistance < distance) {
          distance = nextDistance;
          targetIndex = index;
        }
      }
    }
    snapTo(targetIndex, velocity, targetIndex === 0);
  }, [getSnaps, snapTo]);

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      handleDragStart(touch.clientY, event.target as HTMLElement);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!drag.current.active) return;
      const touch = event.touches[0];
      if (!touch) return;

      // At the full-height snap, an upward gesture inside the content belongs
      // to the native scroller. A downward gesture at scrollTop=0 belongs to
      // the sheet. This is the same scroll-to-drag handoff users expect from
      // the persistent Portfolio surface.
      const deltaY = touch.clientY - drag.current.startY;
      const fullSnapIndex = getSnaps().length - 1;
      if (
        drag.current.startedInScrollArea &&
        drag.current.snapIndex === fullSnapIndex &&
        deltaY < -3
      ) {
        drag.current.active = false;
        if (drag.current.rafId !== null) {
          cancelAnimationFrame(drag.current.rafId);
          drag.current.rafId = null;
        }
        return;
      }
      if (
        drag.current.startedInScrollArea &&
        drag.current.snapIndex === fullSnapIndex &&
        Math.abs(deltaY) <= 3
      ) {
        return;
      }
      event.preventDefault();
      handleDragMove(touch.clientY);
    };
    const onTouchEnd = () => handleDragEnd();
    const onTouchCancel = () => handleDragEnd();
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (handleDragStart(event.clientY, event.target as HTMLElement)) {
        event.preventDefault();
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!drag.current.active) return;
      event.preventDefault();
      handleDragMove(event.clientY);
    };
    const onMouseUp = () => {
      handleDragEnd();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });
    sheet.addEventListener("touchcancel", onTouchCancel, { passive: true });
    sheet.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      sheet.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [getSnaps, handleDragEnd, handleDragMove, handleDragStart, open]);

  const handleSheetClickCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (performance.now() < suppressClickUntil.current) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const handleHeaderClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (drag.current.didMove) return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    snapTo(drag.current.snapIndex === 2 ? 1 : 2);
  }, [snapTo]);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onResize = () => {
      if (inputFocused.current || drag.current.active) return;
      stableVh.current = viewport.height + viewport.offsetTop;
      if (sheetRef.current) sheetRef.current.style.height = `${stableVh.current}px`;
      const snaps = getSnaps();
      const target = snaps[drag.current.snapIndex];
      drag.current.currentTop = target;
      applyPosition(target);
    };
    viewport.addEventListener("resize", onResize);
    return () => viewport.removeEventListener("resize", onResize);
  }, [applyPosition, getSnaps, open]);

  if (!open) return null;

  return (
    <>
      <div
        ref={overlayRef}
        aria-hidden="true"
        className="fixed inset-0 z-[9998] bg-black sm:hidden"
        style={{ opacity: 0, pointerEvents: "none" }}
        onClick={closeSheet}
      />
      <div
        ref={sheetRef}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        data-mobile-sheet-drag-surface="true"
        onClickCapture={handleSheetClickCapture}
        className="fixed inset-x-0 bottom-0 z-[9999] outline-none sm:hidden"
        style={{
          height: "100dvh",
          transform: "translate3d(0, 100dvh, 0)",
          willChange: "transform",
          // Header opts out with `none`; the content keeps `pan-y` so the
          // browser can own scrolling once the sheet reaches its full snap.
          touchAction: "pan-y",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: "grab",
        }}
      >
        <div
          ref={innerRef}
          className="flex h-full flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-white/[0.08] bg-[#101010]"
          style={{
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div
            className="shrink-0"
            data-mobile-sheet-drag-handle="true"
            onClick={handleHeaderClick}
            style={{ touchAction: "none" }}
          >
            <div className="flex justify-center pb-1.5 pt-2.5">
              <div className="h-1 w-9 rounded-full bg-white/[0.15]" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3">
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="truncate font-display text-[13px] font-semibold text-zinc-100"
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeSheet}
                aria-label={`Close ${title}`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 active:scale-95"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div
            ref={contentRef}
            className="flex min-h-0 flex-1 flex-col border-t border-white/[0.06]"
            style={{ opacity: 0 }}
          >
            <div
              ref={scrollAreaRef}
              data-mobile-sheet-scroll-area="true"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
