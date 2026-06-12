"use client";

import { cn } from "@/lib/utils";

/**
 * Progress rail for the deploy-from-UI flow (docs/DEPLOY-FROM-UI.md):
 * transpile → compile → publish → vault → delegate → live.
 *
 * Purely presentational — drive it with a DeployVaultStatus from the deploy
 * service. Mirrors the CCTP BridgeStepsRail pattern users already know.
 */

export const DEPLOY_VAULT_STEPS = [
  "Transpile",
  "Compile",
  "Publish",
  "Vault",
  "Delegate",
  "Live",
] as const;

export type DeployVaultStep = (typeof DEPLOY_VAULT_STEPS)[number];

export interface DeployVaultStatus {
  /** Index into DEPLOY_VAULT_STEPS of the step currently in progress;
   *  steps before it render as done. Equal to length = all done. */
  activeIndex: number;
  /** Marks the active step failed (message shown below by the caller). */
  errored?: boolean;
}

export function DeployVaultRail({ status }: { status: DeployVaultStatus }) {
  const { activeIndex, errored } = status;

  return (
    <div className="flex items-center gap-1.5 pb-1">
      {DEPLOY_VAULT_STEPS.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <div key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold",
                done && "bg-emerald-500/20 text-emerald-400",
                active && !errored && "bg-emerald-400 text-black",
                active && errored && "bg-red-500/80 text-black",
                !done && !active && "bg-white/[0.06] text-zinc-600",
              )}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                "truncate font-mono text-[9px] uppercase tracking-wide",
                done && "text-emerald-400/80",
                active && !errored && "text-zinc-100",
                active && errored && "text-red-300",
                !done && !active && "text-zinc-600",
              )}
            >
              {label}
            </span>
            {i < DEPLOY_VAULT_STEPS.length - 1 && (
              <span className={cn("h-px flex-1", i < activeIndex ? "bg-emerald-500/30" : "bg-white/[0.07]")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
