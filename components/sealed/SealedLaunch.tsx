"use client";

/**
 * Launch a bot — the whole creator flow in three decisions.
 *
 * Deliberately minimal. The previous version asked for a Decibel vault address,
 * a 32-byte attestor public key, and three sliders before you could do anything;
 * none of that is a creator's decision. The attestor key is platform-managed,
 * the vault is created for you, and every rule has a bound-checked default that
 * only appears if you go looking for it.
 *
 * What you actually choose: which strategy, what to call it, and whether the
 * source stays private.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, Lock, Globe, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";
import { SEALED_CATALOG, type CatalogStrategy } from "@/lib/sealed-catalog";

interface SealedConfig {
  packageAddress: string | null;
  attestorPubkey: string | null;
  ready: boolean;
  network: string;
  markets: Array<{ name: string; addr: string }>;
  defaults: {
    pctBps: number;
    maxLeverageX100: number;
    minBarIntervalS: number;
    slippageBps: number;
    performanceFeeBps: number;
  };
}

interface CommitInfo {
  commitment: string;
  manifestJson: string;
  moduleName: string;
  warmupBars: number;
  warnings: string[];
  market: { name: string; addr: string };
}

type Phase = "idle" | "committing" | "creating" | "delegating" | "sealing" | "live";

function asTxData(payload: {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
}) {
  return {
    function: payload.function as `${string}::${string}::${string}`,
    typeArguments: payload.typeArguments,
    functionArguments: payload.functionArguments as (string | number | boolean)[],
  };
}

export function SealedLaunch({ onLaunched }: { onLaunched?: () => void }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [config, setConfig] = useState<SealedConfig | null>(null);
  const [strategyId, setStrategyId] = useState(SEALED_CATALOG[0].id);
  const [customPine, setCustomPine] = useState("");
  const [tvUrl, setTvUrl] = useState("");
  const [tvBusy, setTvBusy] = useState(false);
  const [vaultName, setVaultName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const [svAddr, setSvAddr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sealed/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setConfig(j as SealedConfig))
      .catch(() => setConfig(null));
  }, []);

  const selected: CatalogStrategy | null = useMemo(
    () => SEALED_CATALOG.find((s) => s.id === strategyId) ?? null,
    [strategyId],
  );
  const usingCustom = customPine.trim().length > 0;
  const effectivePine = usingCustom ? customPine : (selected?.script ?? "");

  const importTradingView = useCallback(async () => {
    if (!tvUrl.trim()) return;
    setError(null);
    setTvBusy(true);
    try {
      const res = await fetch(`/api/launchpad/tv-import?url=${encodeURIComponent(tvUrl.trim())}`);
      const json = await res.json();
      if (!res.ok || !json.script) {
        setError(json.error ?? "Could not read that TradingView script. Paste the source instead.");
        return;
      }
      setCustomPine(json.script);
      setStatus("Imported from TradingView.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "TradingView import failed");
    } finally {
      setTvBusy(false);
    }
  }, [tvUrl]);

  /** One button: commit → create vault → delegate → seal. */
  const launch = useCallback(async () => {
    setError(null);
    setErrorList([]);
    setStatus(null);

    if (!config?.ready) {
      setError("Sealed vaults aren't configured on this deployment yet.");
      return;
    }
    if (!connected || !account) {
      setError("Connect a wallet first.");
      return;
    }
    if (!vaultName.trim()) {
      setError("Give your bot a name — this is what depositors see.");
      return;
    }

    try {
      // 1. Commit — the source is hashed server-side and never stored.
      setPhase("committing");
      setStatus("Hashing your strategy…");
      const commitRes = await fetch("/api/sealed/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pineScript: effectivePine }),
      });
      const commitJson = await commitRes.json();
      if (!commitRes.ok || !commitJson.ok) {
        setError(commitJson.error ?? "This strategy can't run on-chain.");
        setErrorList(Array.isArray(commitJson.errors) ? commitJson.errors : []);
        setPhase("idle");
        return;
      }
      const info = commitJson as CommitInfo;
      setCommitInfo(info);

      // 2. Create the sealed vault object.
      setPhase("creating");
      setStatus("Deploying your bot on-chain…");
      const payloadRes = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "create",
          programCommitment: info.commitment,
          attestorPubkey: config.attestorPubkey,
          decibelVaultAddr: account.address.toString(),
          market: info.market.name,
          ...config.defaults,
        }),
      });
      const payloadJson = await payloadRes.json();
      if (!payloadRes.ok || !payloadJson.ok) {
        setError(payloadJson.error ?? "Could not build the deploy transaction");
        setPhase("idle");
        return;
      }
      const created = await signAndSubmitTransaction({ data: asTxData(payloadJson.payload) });
      await waitForTransactionConfirmation(created.hash);

      const lookup = await fetch(`/api/sealed/created?tx=${created.hash}`)
        .then((r) => r.json())
        .catch(() => null);
      const addr = lookup?.strategyVaultAddr as string | undefined;
      if (!addr) {
        setError(`Deployed (tx ${created.hash.slice(0, 12)}…) but the vault address didn't come back.`);
        setPhase("idle");
        return;
      }
      setSvAddr(addr);

      // 3. Seal — freezes the commitment and every rule, one-way.
      setPhase("sealing");
      setStatus("Sealing — locking the rules permanently…");
      const sealRes = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "seal", strategyVaultAddr: addr }),
      });
      const sealJson = await sealRes.json();
      if (sealRes.ok && sealJson.ok) {
        const sealed = await signAndSubmitTransaction({ data: asTxData(sealJson.payload) });
        await waitForTransactionConfirmation(sealed.hash);

        await fetch("/api/sealed/vaults", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategyVaultAddr: addr,
            packageAddress: config.packageAddress,
            network: config.network,
            creatorAddr: account.address.toString(),
            decibelVaultAddr: account.address.toString(),
            programCommitment: info.commitment,
            attestorPubkey: config.attestorPubkey,
            manifestJson: info.manifestJson,
            market: info.market.name,
            name: vaultName.trim(),
            description: usingCustom ? undefined : selected?.blurb,
            pctBps: config.defaults.pctBps,
            maxLeverageX100: config.defaults.maxLeverageX100,
            minBarIntervalS: config.defaults.minBarIntervalS,
            sealed: true,
            sealTxHash: sealed.hash,
            createTxHash: created.hash,
            revealedPine: isPrivate ? undefined : effectivePine,
          }),
        });
      }

      setPhase("live");
      setStatus("Your bot is live.");
      onLaunched?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Launch failed");
      setPhase("idle");
    }
  }, [
    config, connected, account, vaultName, effectivePine, usingCustom, selected,
    isPrivate, signAndSubmitTransaction, onLaunched,
  ]);

  const busy = phase !== "idle" && phase !== "live";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* 1 — Strategy */}
      <section>
        <Label n={1}>Pick a strategy</Label>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy || usingCustom}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className={cn(
              "flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors",
              "border-[#2a2a2a] bg-[#141414] hover:border-accent/40 disabled:opacity-50",
              menuOpen && "border-accent/60",
            )}
          >
            <span>
              <span className="block font-display text-[14px] font-semibold text-white">
                {usingCustom ? "Your own strategy" : (selected?.label ?? "Select…")}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {usingCustom
                  ? "Pasted source — used instead of the list"
                  : (selected?.blurb ?? "")}
              </span>
            </span>
            <ChevronDown
              className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", menuOpen && "rotate-180")}
              aria-hidden
            />
          </button>

          {menuOpen && (
            <ul
              role="listbox"
              className="absolute z-30 mt-1.5 max-h-[320px] w-full overflow-y-auto rounded-xl border border-[#2a2a2a] bg-[#141414] p-1 shadow-2xl"
            >
              {SEALED_CATALOG.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={s.id === strategyId}
                    onClick={() => {
                      setStrategyId(s.id);
                      setMenuOpen(false);
                      setCommitInfo(null);
                    }}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                      s.id === strategyId ? "bg-accent/10" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        s.id === strategyId ? "text-accent" : "text-transparent",
                      )}
                      aria-hidden
                    />
                    <span>
                      <span className="block font-display text-[13px] font-semibold text-white">
                        {s.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                        {s.blurb}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Or bring your own */}
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-[11px] text-zinc-500 transition-colors hover:text-zinc-300">
            <span className="underline underline-offset-2">Use your own TradingView script instead</span>
          </summary>
          <div className="mt-2 space-y-2">
            <div className="flex gap-2">
              <input
                value={tvUrl}
                onChange={(e) => setTvUrl(e.target.value)}
                placeholder="https://www.tradingview.com/script/…"
                disabled={busy}
                className={inputCls}
              />
              <button
                type="button"
                onClick={importTradingView}
                disabled={busy || tvBusy || !tvUrl.trim()}
                className="shrink-0 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 font-display text-[12px] font-semibold text-white transition-colors hover:border-accent/50 disabled:opacity-40"
              >
                {tvBusy ? "…" : "Import"}
              </button>
            </div>
            <textarea
              value={customPine}
              onChange={(e) => {
                setCustomPine(e.target.value);
                setCommitInfo(null);
              }}
              disabled={busy}
              spellCheck={false}
              rows={6}
              aria-label="PineScript source"
              placeholder="…or paste the PineScript source here"
              className="w-full resize-y rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3 font-mono text-[11px] leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none"
            />
          </div>
        </details>
      </section>

      {/* 2 — Name */}
      <section>
        <Label n={2}>Name your bot</Label>
        <input
          value={vaultName}
          onChange={(e) => setVaultName(e.target.value)}
          placeholder="Momentum Alpha"
          disabled={busy}
          className={inputCls}
        />
        <p className="mt-1.5 text-[11px] text-zinc-600">
          Deposits go into a vault under this name. Depositors see the name — never your strategy.
        </p>
      </section>

      {/* 3 — Visibility */}
      <section>
        <Label n={3}>Keep it private?</Label>
        <div className="grid grid-cols-2 gap-2">
          <VisibilityCard
            active={isPrivate}
            onClick={() => setIsPrivate(true)}
            disabled={busy}
            icon={<Lock className="h-3.5 w-3.5" aria-hidden />}
            title="Proprietary"
            body="Only a hash goes on-chain. Nobody can read your alpha — you can reveal it later to prove every trade."
          />
          <VisibilityCard
            active={!isPrivate}
            onClick={() => setIsPrivate(false)}
            disabled={busy}
            icon={<Globe className="h-3.5 w-3.5" aria-hidden />}
            title="Public"
            body="Source published alongside the vault. Anyone can verify every trade against it immediately."
          />
        </div>
      </section>

      {/* Advanced — collapsed by default; the chain bounds all of these anyway */}
      <details
        className="rounded-xl border border-[#2a2a2a] bg-[#141414]"
        onToggle={(e) => setShowAdvanced((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none px-4 py-3 font-display text-[12px] font-semibold text-zinc-400 transition-colors hover:text-white">
          Advanced settings {showAdvanced ? "−" : "+"}
        </summary>
        <dl className="grid grid-cols-2 gap-3 border-t border-[#2a2a2a] px-4 py-3 sm:grid-cols-3">
          <Setting k="Order size" v={`${(config?.defaults.pctBps ?? 1000) / 100}% of NAV`} />
          <Setting k="Max leverage" v={`${(config?.defaults.maxLeverageX100 ?? 200) / 100}x`} />
          <Setting k="Trade cadence" v={`≤1 per ${config?.defaults.minBarIntervalS ?? 60}s`} />
          <Setting k="Slippage cap" v={`${(config?.defaults.slippageBps ?? 30) / 100}%`} />
          <Setting k="Performance fee" v={`${(config?.defaults.performanceFeeBps ?? 1000) / 100}%`} />
          <Setting k="Market" v={config?.markets[0]?.name ?? "BTC/USD"} />
        </dl>
        <p className="px-4 pb-3 text-[10px] leading-snug text-zinc-600">
          These are enforced by the contract and frozen when your bot goes live. Defaults are
          conservative; contact us if you need them changed before launch.
        </p>
      </details>

      {/* Result / errors */}
      {error && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/5 p-4">
          <p className="text-[12px] font-semibold text-red-400">{error}</p>
          {errorList.length > 0 && (
            <ul className="mt-2 space-y-1">
              {errorList.map((e) => (
                <li key={e} className="text-[11px] leading-snug text-red-300/80">• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {phase === "live" && svAddr && (
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
          <p className="font-display text-[13px] font-bold text-accent">Your bot is live.</p>
          <p className="mt-1 break-all font-mono text-[10px] text-zinc-400">{svAddr}</p>
          {commitInfo && (
            <p className="mt-2 break-all font-mono text-[10px] text-zinc-500">
              commitment {commitInfo.commitment}
            </p>
          )}
        </div>
      )}

      {status && !error && phase !== "live" && (
        <p className="text-[12px] text-zinc-400">{status}</p>
      )}

      {config && !config.ready && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] leading-snug text-amber-400/90">
          Sealed vaults aren&apos;t configured on this deployment yet — the contract address and
          attestor key still need to be set. You can build and preview a bot, but not deploy one.
        </p>
      )}

      <button
        onClick={launch}
        disabled={busy || phase === "live" || !config?.ready}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3.5 font-display text-[14px] font-bold text-accent-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {phase === "idle" && "Launch bot"}
        {phase === "committing" && "Hashing strategy…"}
        {phase === "creating" && "Deploying…"}
        {phase === "delegating" && "Delegating…"}
        {phase === "sealing" && "Sealing…"}
        {phase === "live" && "Live"}
      </button>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2.5 text-[13px] text-white placeholder:text-zinc-600 focus:border-accent/40 focus:outline-none disabled:opacity-50";

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2a2a2a] text-[9px] font-bold text-zinc-400">
        {n}
      </span>
      <span className="font-display text-[13px] font-semibold text-white">{children}</span>
    </div>
  );
}

function VisibilityCard({
  active, onClick, disabled, icon, title, body,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-3 text-left transition-all disabled:opacity-50",
        active ? "border-accent/50 bg-accent/[0.06]" : "border-[#2a2a2a] bg-[#141414] hover:border-white/20",
      )}
    >
      <span className={cn("flex items-center gap-1.5", active ? "text-accent" : "text-zinc-400")}>
        {icon}
        <span className="font-display text-[12px] font-semibold">{title}</span>
      </span>
      <span className="mt-1 block text-[10px] leading-snug text-zinc-500">{body}</span>
    </button>
  );
}

function Setting({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-zinc-600">{k}</dt>
      <dd className="font-mono text-[11px] tabular-nums text-zinc-300">{v}</dd>
    </div>
  );
}
