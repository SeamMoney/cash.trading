"use client";

import {
  forwardRef,
  type ReactNode,
} from "react";
import { motion } from "motion/react";

interface SwapFlowScreenProps {
  children: ReactNode;
  className?: string;
  reducedMotion: boolean;
}

const SWAP_EASE = [0.23, 1, 0.32, 1] as const;

/**
 * One restrained transition shared by form, review, and transaction screens.
 * It only animates compositor-safe properties and becomes instant when the
 * user asks for reduced motion.
 */
export const SwapFlowScreen = forwardRef<HTMLDivElement, SwapFlowScreenProps>(
  function SwapFlowScreen({ children, className, reducedMotion }, ref) {
    return (
      <motion.div
        ref={ref}
        initial={reducedMotion
          ? false
          : {
              opacity: 0,
              transform: "translate3d(0, 6px, 0) scale(0.995)",
            }}
        animate={{
          opacity: 1,
          transform: "translate3d(0, 0, 0) scale(1)",
        }}
        exit={reducedMotion
          ? undefined
          : {
              opacity: 0,
              transform: "translate3d(0, -4px, 0) scale(0.997)",
            }}
        transition={{
          duration: reducedMotion ? 0 : 0.18,
          ease: SWAP_EASE,
        }}
        className={className}
      >
        {children}
      </motion.div>
    );
  },
);
