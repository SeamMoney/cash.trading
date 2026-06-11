"use client";

/**
 * Physics-based mobile bottom sheet — ported from whop.finance's PortfolioSheet.
 *
 * Three snap points (peek / 60% / full) with a critically-damped spring,
 * velocity-based flings, rubber-banding past the extremes, and progressive
 * choreography while dragging (backdrop fade, corner-radius morph, content
 * cross-fade). Includes the whop.finance niceties: zero-re-render drag via
 * refs + direct style writes, keyboard-aware hiding, and iOS visualViewport
 * sync so the sheet tracks the URL-bar collapse 1:1.
 *
 * cash.trading adaptations: the sheet hosts the portfolio content passed as
 * children and a bottom nav (lucide icons — no inline SVGs), and the peek
 * header stays honest: no fabricated balance/earnings numbers.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, CandlestickChart, Rocket, Trophy } from "lucide-react";

const PEEK_FROM_BOTTOM = 72;
const INITIAL_SHEET_OFFSET = 800;
const MID_VH = 0.6;
const RUBBER_BAND_K = 0.35;
const VELOCITY_THRESHOLD = 0.4;
const SPRING_STIFFNESS = 300;
const SPRING_DAMPING = 30;
const SPRING_MASS = 1;
const SPRING_REST_THRESHOLD = 0.5;

const NAV_ITEMS = [
  { href: "/", label: "Trade", icon: CandlestickChart },
  { href: "/portfolio", label: "Portfolio", icon: BarChart3 },
  { href: "/launchpad", label: "Launchpad", icon: Rocket },
  { href: "/automation", label: "Bots", icon: Bot },
  { href: "/points", label: "Points", icon: Trophy },
] as const;

function springAnimate(
  from: number,
  to: number,
  velocity: number,
  onUpdate: (v: number) => void,
  onDone: () => void,
) {
  let position = from;
  let vel = velocity;
  let lastTime = performance.now();
  let raf: number;

  const tick = (now: number) => {
    const dt = Math.min((now - lastTime) / 1000, 0.064);
    lastTime = now;

    const displacement = position - to;
    const springForce = -SPRING_STIFFNESS * displacement;
    const dampingForce = -SPRING_DAMPING * vel;
    const acceleration = (springForce + dampingForce) / SPRING_MASS;

    vel += acceleration * dt;
    position += vel * dt;

    onUpdate(position);

    if (Math.abs(position - to) < SPRING_REST_THRESHOLD && Math.abs(vel) < SPRING_REST_THRESHOLD) {
      onUpdate(to);
      onDone();
      return;
    }

    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

function rubberBand(offset: number): number {
  if (offset >= 0) return offset;
  return offset * RUBBER_BAND_K;
}

export function MobilePortfolioSheet({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [snapIndex, setSnapIndex] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const drag = useRef({
    active: false,
    startY: 0,
    startTop: 0,
    currentTop: 0,
    velocityY: 0,
    lastY: 0,
    lastTime: 0,
    snapIndex: 0,
    didMove: false,
    cancelSpring: null as (() => void) | null,
    rafId: null as number | null,
    pendingClientY: 0,
  });

  // Hide the sheet while the keyboard is open (an input is focused).
  const inputFocused = useRef(false);
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        inputFocused.current = true;
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = (e: FocusEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        inputFocused.current = false;
        setTimeout(() => {
          if (!inputFocused.current) setKeyboardOpen(false);
        }, 100);
      }
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Stable viewport height + safe-area top, untouched by keyboard resizes.
  const stableVh = useRef(0);
  const safeInsetTop = useRef(0);
  useEffect(() => {
    stableVh.current = window.innerHeight;
    if (sheetRef.current) sheetRef.current.style.height = `${window.innerHeight}px`;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;height:env(safe-area-inset-top,0px);pointer-events:none;";
    document.body.appendChild(probe);
    safeInsetTop.current = probe.offsetHeight || 0;
    document.body.removeChild(probe);
    const onOrientation = () => {
      setTimeout(() => { stableVh.current = window.innerHeight; }, 500);
    };
    window.addEventListener("orientationchange", onOrientation);
    return () => window.removeEventListener("orientationchange", onOrientation);
  }, []);

  const getSnaps = useCallback(() => {
    const vh = stableVh.current || window.innerHeight;
    return [vh - PEEK_FROM_BOTTOM, vh * (1 - MID_VH), safeInsetTop.current];
  }, []);

  const applyPosition = useCallback((top: number) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = `translate3d(0, ${top}px, 0)`;

    const vh = stableVh.current || window.innerHeight;
    const peekTop = vh - PEEK_FROM_BOTTOM;
    const midTop = vh * (1 - MID_VH);
    const progress = Math.max(0, Math.min(1, 1 - top / peekTop));

    if (overlayRef.current) {
      overlayRef.current.style.opacity = `${progress * 0.6}`;
      overlayRef.current.style.pointerEvents = progress > 0.05 ? "auto" : "none";
    }

    const radiusProgress = Math.max(0, Math.min(1, top / midTop));
    const radius = radiusProgress * 20;
    if (innerRef.current) {
      innerRef.current.style.borderRadius = `${radius}px ${radius}px 0 0`;
      innerRef.current.style.borderColor = `rgba(255,255,255,${radiusProgress * 0.08})`;
    }

    const contentProgress = Math.max(0, Math.min(1, (progress - 0.08) / 0.25));
    if (contentRef.current) contentRef.current.style.opacity = `${contentProgress}`;
  }, []);

  const snapTo = useCallback((index: number, velocityPxMs = 0) => {
    const snaps = getSnaps();
    const target = snaps[Math.max(0, Math.min(index, snaps.length - 1))];
    const from = drag.current.currentTop;

    drag.current.cancelSpring?.();
    drag.current.cancelSpring = springAnimate(
      from,
      target,
      velocityPxMs * 1000,
      (v) => {
        drag.current.currentTop = v;
        applyPosition(v);
      },
      () => {
        drag.current.snapIndex = index;
        drag.current.currentTop = target;
        setSnapIndex(index);
      },
    );
  }, [getSnaps, applyPosition]);

  const handleDragStart = useCallback((clientY: number, target: HTMLElement) => {
    if (inputFocused.current) {
      drag.current.active = false;
      return false;
    }
    // Let the inner list scroll normally once it has scrolled, when expanded.
    const scrollArea = scrollAreaRef.current;
    const isInScrollArea = scrollArea?.contains(target);
    const scrollTop = scrollArea?.scrollTop ?? 0;
    if (isInScrollArea && scrollTop > 0 && drag.current.snapIndex > 0) {
      drag.current.active = false;
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
    return true;
  }, []);

  const processDragMove = useCallback((clientY: number) => {
    const now = performance.now();
    const dt = now - drag.current.lastTime;
    if (Math.abs(clientY - drag.current.startY) > 3) drag.current.didMove = true;
    if (dt > 0) {
      const instantV = (clientY - drag.current.lastY) / dt;
      drag.current.velocityY = 0.7 * instantV + 0.3 * drag.current.velocityY;
    }
    drag.current.lastY = clientY;
    drag.current.lastTime = now;

    const snaps = getSnaps();
    const maxTop = snaps[0];
    const minTop = snaps[snaps.length - 1];
    let rawTop = drag.current.startTop + (clientY - drag.current.startY);
    if (rawTop < minTop) rawTop = minTop + rubberBand(rawTop - minTop);
    else if (rawTop > maxTop) rawTop = maxTop + (rawTop - maxTop) * RUBBER_BAND_K;

    drag.current.currentTop = rawTop;
    applyPosition(rawTop);
  }, [getSnaps, applyPosition]);

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

    const snaps = getSnaps();
    const v = drag.current.velocityY;
    const top = drag.current.currentTop;
    const currentSnap = drag.current.snapIndex;
    let targetSnap: number;

    if (Math.abs(v) > VELOCITY_THRESHOLD) {
      targetSnap = v < 0
        ? Math.min(currentSnap + 1, snaps.length - 1)
        : Math.max(currentSnap - 1, 0);
    } else {
      let minDist = Infinity;
      targetSnap = currentSnap;
      for (let i = 0; i < snaps.length; i++) {
        const d = Math.abs(top - snaps[i]);
        if (d < minDist) { minDist = d; targetSnap = i; }
      }
    }

    snapTo(targetSnap, v);
  }, [getSnaps, snapTo]);

  const onTouchStart = useCallback((e: TouchEvent) => {
    handleDragStart(e.touches[0].clientY, e.target as HTMLElement);
  }, [handleDragStart]);
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!drag.current.active) return;
    e.preventDefault();
    handleDragMove(e.touches[0].clientY);
  }, [handleDragMove]);
  const onTouchEnd = useCallback(() => { handleDragEnd(); }, [handleDragEnd]);

  const onMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return;
    if (handleDragStart(e.clientY, e.target as HTMLElement)) {
      e.preventDefault();
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
    }
  }, [handleDragStart]);
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!drag.current.active) return;
    e.preventDefault();
    handleDragMove(e.clientY);
  }, [handleDragMove]);
  const onMouseUp = useCallback(() => {
    handleDragEnd();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, [handleDragEnd]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });
    sheet.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd, onMouseDown, onMouseMove, onMouseUp]);

  useEffect(() => {
    const snaps = getSnaps();
    drag.current.currentTop = snaps[0];
    drag.current.snapIndex = 0;
    applyPosition(snaps[0]);
    const onOrientation = () => {
      setTimeout(() => {
        const s = getSnaps();
        const target = s[drag.current.snapIndex];
        drag.current.currentTop = target;
        applyPosition(target);
      }, 500);
    };
    window.addEventListener("orientationchange", onOrientation);
    return () => window.removeEventListener("orientationchange", onOrientation);
  }, [getSnaps, applyPosition]);

  // Track iOS Safari visual-viewport changes (URL bar) at 60fps for zero jitter.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onViewportResize = () => {
      if (inputFocused.current || drag.current.active) return;
      const currentVh = vv.height + vv.offsetTop;
      stableVh.current = currentVh;
      if (sheetRef.current) sheetRef.current.style.height = `${currentVh}px`;
      drag.current.cancelSpring?.();
      const snaps = getSnaps();
      const idx = drag.current.snapIndex;
      const target = snaps[Math.max(0, Math.min(idx, snaps.length - 1))];
      drag.current.currentTop = target;
      applyPosition(target);
    };
    vv.addEventListener("resize", onViewportResize);
    return () => vv.removeEventListener("resize", onViewportResize);
  }, [getSnaps, applyPosition]);

  // Collapse on route change.
  useEffect(() => { snapTo(0); }, [pathname, snapTo]);

  const handleTap = useCallback(() => {
    if (drag.current.didMove) return;
    snapTo(drag.current.snapIndex === 0 ? 1 : 0);
  }, [snapTo]);

  const isOpen = snapIndex > 0;

  return (
    <>
      {/* Overlay */}
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[90] bg-black lg:hidden"
        style={{ opacity: 0, pointerEvents: "none", visibility: keyboardOpen ? "hidden" : undefined }}
        onClick={() => snapTo(0)}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="fixed left-0 right-0 z-[100] lg:hidden"
        style={{
          visibility: keyboardOpen ? "hidden" : undefined,
          pointerEvents: keyboardOpen ? "none" : undefined,
          bottom: 0,
          top: "auto",
          height: "100dvh",
          transform: `translate3d(0, ${INITIAL_SHEET_OFFSET}px, 0)`,
          willChange: "transform",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          cursor: "grab",
        }}
      >
        <div
          ref={innerRef}
          className="flex h-full flex-col overflow-hidden rounded-t-[20px] border border-b-0 border-white/[0.08] bg-[#101010]"
          style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
        >
          {/* Peek header */}
          <div className="shrink-0" style={{ touchAction: "none" }}>
            <div className="flex justify-center pb-1.5 pt-2.5">
              <div className="h-[4px] w-9 rounded-full bg-white/[0.15]" />
            </div>
            <button className="w-full px-5 pb-2.5 text-left" onClick={handleTap}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-[13px] font-semibold text-zinc-100">Portfolio</div>
                  <div className="text-[11px] text-zinc-500">Positions, orders, and account state</div>
                </div>
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
                  <svg
                    className={`h-3 w-3 text-zinc-400 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </div>
              </div>
            </button>
          </div>

          {/* Content (fades in as the sheet opens) */}
          <div ref={contentRef} className="flex min-h-0 flex-1 flex-col" style={{ opacity: 0 }}>
            <div
              ref={scrollAreaRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {children}
            </div>
          </div>

          {/* Bottom nav */}
          <div className="shrink-0 border-t border-white/[0.06]">
            <div className="flex items-center justify-around px-2 py-2">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => snapTo(0)}
                    className={`relative flex flex-col items-center gap-1 rounded-xl px-3 py-2 transition-all duration-200 ease-out ${
                      isActive ? "text-accent" : "text-zinc-500 active:scale-95"
                    }`}
                  >
                    {isActive && (
                      <span className="absolute -top-0.5 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-accent" />
                    )}
                    <Icon className="h-[20px] w-[20px]" strokeWidth={1.8} />
                    <span className={`text-[10px] font-medium leading-none ${isActive ? "text-accent" : "text-zinc-600"}`}>
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
            <div className="pb-[env(safe-area-inset-bottom)]" />
          </div>
        </div>
      </div>
    </>
  );
}
