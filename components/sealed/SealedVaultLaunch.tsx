"use client";

/**
 * Sealed-vault launch rail (creator side) — docs/SEALED-INDICATOR.md.
 *
 * The Pine source is sent to /api/sealed/commit to be hashed and is never
 * stored. Everything after that is wallet-signed by the creator, except the
 * Decibel delegation, which the VAULT ADMIN must sign.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

import { cn } from "@/lib/utils";
import { waitForTransactionConfirmation } from "@/lib/tx-utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => <div className="h-full min-h-[280px] animate-pulse bg-[#1e1e1e]" />,
});

/** Monaco loads from a CDN; when that fails (offline, blocked CDN) the raw
 *  loader error would surface as an unhandled rejection. Fall back to a plain
 *  textarea — committing a strategy must never depend on jsdelivr being up. */
function PineEditor({
  value, onChange, readOnly,
}: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const [monacoFailed, setMonacoFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // A blocked CDN can hang rather than reject — race it with a deadline so
    // the strategy editor always becomes usable.
    const timer = setTimeout(() => { if (!cancelled) setMonacoFailed(true); }, 8000);
    import("@monaco-editor/react")
      .then((m) => m.loader.init())
      .then(() => { if (!cancelled) clearTimeout(timer); })
      .catch(() => { if (!cancelled) setMonacoFailed(true); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);
  if (monacoFailed) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
        aria-label="PineScript source"
        className="h-[280px] w-full resize-none bg-[#1e1e1e] p-3 font-mono text-[12px] leading-relaxed text-zinc-200 focus:outline-none"
      />
    );
  }
  return (
    <MonacoEditor
      height="280px"
      defaultLanguage="javascript"
      theme="vs-dark"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        readOnly,
      }}
    />
  );
}

const STARTER_PINE = `//@version=5
strategy("My Sealed Strategy", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.ema(close, fastLen)
slow = ta.ema(close, slowLen)
if (ta.crossover(fast, slow))
    strategy.entry("Long", strategy.long)
if (ta.crossunder(fast, slow))
    strategy.entry("Short", strategy.short)
`;

type StepId = "commit" | "create" | "delegate" | "seal";

/** Server-built entry-function payloads carry `unknown[]` arguments; the wallet
 *  adapter wants concrete simple types. Every sealed payload uses only strings,
 *  numbers and booleans. */
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

const STEPS: Array<{ id: StepId; label: string; hint: string }> = [
  { id: "commit", label: "Commit", hint: "Hash the strategy. Source never leaves your browser session." },
  { id: "create", label: "Create", hint: "Deploy the sealed vault object. You sign." },
  { id: "delegate", label: "Delegate", hint: "Decibel vault admin grants trading to the module." },
  { id: "seal", label: "Seal", hint: "One-way. Freezes the commitment and every rule." },
];

interface CommitInfo {
  commitment: string;
  manifestJson: string;
  moduleName: string;
  warmupBars: number;
  warnings: string[];
  market: { name: string; addr: string };
}

export function SealedVaultLaunch({ onLaunched }: { onLaunched?: () => void }) {
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [pine, setPine] = useState(STARTER_PINE);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [decibelVault, setDecibelVault] = useState("");
  const [attestorPubkey, setAttestorPubkey] = useState("");
  const [pctBps, setPctBps] = useState(1000);
  const [maxLevX100, setMaxLevX100] = useState(200);
  const [minBarS, setMinBarS] = useState(60);

  const [commitInfo, setCommitInfo] = useState<CommitInfo | null>(null);
  const [svAddr, setSvAddr] = useState<string | null>(null);
  const [sealed, setSealed] = useState(false);
  const [delegated, setDelegated] = useState(false);

  const [busy, setBusy] = useState<StepId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorList, setErrorList] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const activeStep: StepId = sealed
    ? "seal"
    : delegated
      ? "seal"
      : svAddr
        ? "delegate"
        : commitInfo
          ? "create"
          : "commit";

  const reset = () => {
    setError(null);
    setErrorList([]);
    setNotice(null);
  };

  // ── Step 1: commit ─────────────────────────────────────────────────────────
  const doCommit = useCallback(async () => {
    reset();
    setBusy("commit");
    try {
      const res = await fetch("/api/sealed/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pineScript: pine }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Commit failed");
        setErrorList(Array.isArray(json.errors) ? json.errors : []);
        return;
      }
      setCommitInfo(json as CommitInfo);
      setNotice("Strategy committed. Only the hash goes on chain.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Commit request failed");
    } finally {
      setBusy(null);
    }
  }, [pine]);

  // ── Step 2: create ─────────────────────────────────────────────────────────
  const doCreate = useCallback(async () => {
    reset();
    if (!commitInfo) return;
    if (!connected || !account) {
      setError("Connect a wallet first.");
      return;
    }
    if (!name.trim()) {
      setError("Give the vault a name — depositors see this, not your strategy.");
      return;
    }
    setBusy("create");
    try {
      const payloadRes = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "create",
          programCommitment: commitInfo.commitment,
          attestorPubkey: attestorPubkey.trim(),
          decibelVaultAddr: decibelVault.trim(),
          market: commitInfo.market.name,
          pctBps,
          maxLeverageX100: maxLevX100,
          minBarIntervalS: minBarS,
        }),
      });
      const payloadJson = await payloadRes.json();
      if (!payloadRes.ok || !payloadJson.ok) {
        setError(payloadJson.error ?? "Could not build the create payload");
        return;
      }

      const submitted = await signAndSubmitTransaction({ data: asTxData(payloadJson.payload) });
      await waitForTransactionConfirmation(submitted.hash);

      // The object address is emitted in SealedVaultCreated; read it back from
      // the transaction rather than guessing at a derivation.
      const created = await fetch(`/api/sealed/created?tx=${submitted.hash}`)
        .then((r) => r.json())
        .catch(() => null);
      const addr = created?.strategyVaultAddr as string | undefined;
      if (!addr) {
        setError(
          `Vault created (tx ${submitted.hash}) but the object address could not be read back. Check the explorer and register manually.`,
        );
        return;
      }
      setSvAddr(addr);

      await fetch("/api/sealed/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVaultAddr: addr,
          packageAddress: payloadJson.payload.function.split("::")[0],
          creatorAddr: account.address.toString(),
          decibelVaultAddr: decibelVault.trim(),
          programCommitment: commitInfo.commitment,
          attestorPubkey: attestorPubkey.trim(),
          manifestJson: commitInfo.manifestJson,
          market: commitInfo.market.name,
          name: name.trim(),
          description: description.trim() || undefined,
          pctBps,
          maxLeverageX100: maxLevX100,
          minBarIntervalS: minBarS,
          createTxHash: submitted.hash,
        }),
      });
      setNotice("Sealed vault created and registered.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(null);
    }
  }, [
    commitInfo, connected, account, name, description, attestorPubkey, decibelVault,
    pctBps, maxLevX100, minBarS, signAndSubmitTransaction,
  ]);

  // ── Step 3: delegate ───────────────────────────────────────────────────────
  const doDelegate = useCallback(async () => {
    reset();
    if (!svAddr) return;
    setBusy("delegate");
    try {
      const res = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "delegate",
          strategyVaultAddr: svAddr,
          decibelVaultAddr: decibelVault.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not build the delegate payload");
        return;
      }
      const submitted = await signAndSubmitTransaction({ data: asTxData(json.payload) });
      await waitForTransactionConfirmation(submitted.hash);
      setDelegated(true);
      setNotice("Trading delegated to the sealed module.");
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "Delegate failed") +
          " — this must be signed by the Decibel vault admin.",
      );
    } finally {
      setBusy(null);
    }
  }, [svAddr, decibelVault, signAndSubmitTransaction]);

  // ── Step 4: seal ───────────────────────────────────────────────────────────
  const doSeal = useCallback(async () => {
    reset();
    if (!svAddr || !commitInfo) return;
    setBusy("seal");
    try {
      const res = await fetch("/api/sealed/payload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "seal", strategyVaultAddr: svAddr }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Could not build the seal payload");
        return;
      }
      const submitted = await signAndSubmitTransaction({ data: asTxData(json.payload) });
      await waitForTransactionConfirmation(submitted.hash);

      await fetch("/api/sealed/vaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVaultAddr: svAddr,
          packageAddress: json.payload.function.split("::")[0],
          creatorAddr: account?.address?.toString(),
          decibelVaultAddr: decibelVault.trim(),
          programCommitment: commitInfo.commitment,
          attestorPubkey: attestorPubkey.trim(),
          manifestJson: commitInfo.manifestJson,
          market: commitInfo.market.name,
          name: name.trim(),
          pctBps,
          maxLeverageX100: maxLevX100,
          minBarIntervalS: minBarS,
          sealed: true,
          sealTxHash: submitted.hash,
        }),
      });
      setSealed(true);
      setNotice("Sealed. The vault is live and its configuration is now immutable.");
      onLaunched?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seal failed");
    } finally {
      setBusy(null);
    }
  }, [
    svAddr, commitInfo, account, decibelVault, attestorPubkey, name,
    pctBps, maxLevX100, minBarS, signAndSubmitTransaction, onLaunched,
  ]);

  const stepIndex = useMemo(() => STEPS.findIndex((s) => s.id === activeStep), [activeStep]);

  return (
    <div className="space-y-4">
      {/* Rail */}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const done =
            (s.id === "commit" && commitInfo) ||
            (s.id === "create" && svAddr) ||
            (s.id === "delegate" && delegated) ||
            (s.id === "seal" && sealed);
          return (
            <li
              key={s.id}
              className={cn(
                "rounded-xl border px-3 py-2.5",
                done
                  ? "border-accent/40 bg-accent/5"
                  : i === stepIndex
                    ? "border-white/30 bg-white/[0.03]"
                    : "border-[#2a2a2a] bg-[#141414]",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold",
                    done ? "bg-accent text-accent-foreground" : "bg-[#2a2a2a] text-[#888]",
                  )}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="font-display text-[12px] font-semibold text-white">{s.label}</span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-zinc-500">{s.hint}</p>
            </li>
          );
        })}
      </ol>

      {/* Editor */}
      <div className="overflow-hidden rounded-xl border border-[#2a2a2a]">
        <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#202020] px-4 py-2.5">
          <span className="font-mono text-[12px] font-semibold text-[#888]">strategy.pine</span>
          <span className="text-[10px] text-zinc-600">
            never stored · never returned · only hashed
          </span>
        </div>
        <div className="h-[280px]">
          <PineEditor
            value={pine}
            onChange={(v) => {
              setPine(v);
              setCommitInfo(null);
            }}
            readOnly={Boolean(svAddr)}
          />
        </div>
      </div>

      {/* Config */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Vault name" hint="What depositors see">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Momentum Alpha"
            className={inputCls}
            disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Description" hint="Optional, public">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Trend-following on BTC perps"
            className={inputCls}
            disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Decibel vault address" hint="Holds depositor funds">
          <input
            value={decibelVault}
            onChange={(e) => setDecibelVault(e.target.value)}
            placeholder="0x…"
            className={cn(inputCls, "font-mono text-[11px]")}
            disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Attestor public key" hint="ed25519, 32 bytes — signs each bar">
          <input
            value={attestorPubkey}
            onChange={(e) => setAttestorPubkey(e.target.value)}
            placeholder="0x…"
            className={cn(inputCls, "font-mono text-[11px]")}
            disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Order size" hint={`${(pctBps / 100).toFixed(1)}% of NAV per order`}>
          <input
            type="range" min={100} max={10000} step={100} value={pctBps}
            onChange={(e) => setPctBps(Number(e.target.value))}
            className="w-full accent-[#39ff14]" disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Max leverage" hint={`${(maxLevX100 / 100).toFixed(2)}x hard cap`}>
          <input
            type="range" min={50} max={1000} step={25} value={maxLevX100}
            onChange={(e) => setMaxLevX100(Number(e.target.value))}
            className="w-full accent-[#39ff14]" disabled={Boolean(svAddr)}
          />
        </Field>
        <Field label="Min bar interval" hint={`${minBarS}s — bounds attestor timing discretion`}>
          <input
            type="range" min={15} max={600} step={15} value={minBarS}
            onChange={(e) => setMinBarS(Number(e.target.value))}
            className="w-full accent-[#39ff14]" disabled={Boolean(svAddr)}
          />
        </Field>
      </div>

      {/* Commit result */}
      {commitInfo && (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
          <p className="mb-2 font-display text-[12px] font-semibold text-white">
            Program commitment
          </p>
          <p className="break-all font-mono text-[11px] text-accent">{commitInfo.commitment}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
            <Meta k="Market" v={commitInfo.market.name} />
            <Meta k="Warmup" v={`${commitInfo.warmupBars} bars`} />
            <Meta k="Module" v={commitInfo.moduleName} />
          </dl>
          {commitInfo.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {commitInfo.warnings.map((w) => (
                <li key={w} className="text-[10px] text-amber-500/80">• {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {svAddr && (
        <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-4">
          <p className="mb-1 font-display text-[12px] font-semibold text-white">
            Strategy vault (the delegated trader)
          </p>
          <p className="break-all font-mono text-[11px] text-white">{svAddr}</p>
        </div>
      )}

      {/* Messages */}
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
      {notice && !error && (
        <p className="rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12px] text-accent">
          {notice}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Action onClick={doCommit} busy={busy === "commit"} disabled={busy !== null || Boolean(svAddr)}>
          1 · Commit strategy
        </Action>
        <Action
          onClick={doCreate}
          busy={busy === "create"}
          disabled={busy !== null || !commitInfo || Boolean(svAddr)}
        >
          2 · Create vault
        </Action>
        <Action
          onClick={doDelegate}
          busy={busy === "delegate"}
          disabled={busy !== null || !svAddr || delegated}
        >
          3 · Delegate trading
        </Action>
        <Action
          onClick={doSeal}
          busy={busy === "seal"}
          disabled={busy !== null || !svAddr || sealed}
          primary
        >
          4 · Seal &amp; go live
        </Action>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-600">
        Sealing is one-way. After it, the commitment, attestor key, market binding and rule set can
        never change — pause remains available as a safety valve. Without a TEE measurement this is
        tier-1 attestation: the chain proves the signal came from the sealed attestor key on inputs
        it verified, not that the committed program produced it.
      </p>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[12px] text-white placeholder:text-zinc-600 focus:border-white/30 focus:outline-none disabled:opacity-50";

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="font-display text-[11px] font-semibold text-zinc-300">{label}</span>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-zinc-600">{k}</dt>
      <dd className="font-mono text-[11px] text-zinc-300">{v}</dd>
    </div>
  );
}

function Action({
  onClick, busy, disabled, primary, children,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "rounded-lg px-4 py-2 font-display text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40",
        primary
          ? "bg-accent text-accent-foreground hover:opacity-90"
          : "border border-[#2a2a2a] bg-[#1a1a1a] text-white hover:border-accent/60",
      )}
    >
      {busy ? "Working…" : children}
    </button>
  );
}
