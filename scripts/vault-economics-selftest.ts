/**
 * Re-reads Decibel's GlobalVaultConfig from BOTH chains and fails if any limit
 * drifts from lib/vault-economics.ts. These are consensus-enforced: a stale
 * value here means vault creation aborts in production.
 *
 *   pnpm test:economics
 */
import assert from "node:assert/strict";
import { DECIBEL_VAULT_LIMITS, computeFeeBreakdown, validateVaultConfig, launchCostUsdc } from "../lib/vault-economics";
import { deriveShareSymbol, truncateDisplayName } from "../lib/sealed-vaults";

const PKGS = {
  testnet: { url: "https://api.testnet.aptoslabs.com/v1", pkg: "0xe7da2794b1d8af76532ed95f38bfdf1136abfd8ea3a240189971988a83101b7f" },
  mainnet: { url: "https://api.mainnet.aptoslabs.com/v1", pkg: "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06" },
};

let failures = 0;
const check = (n: string, ok: boolean, d?: unknown) => {
  if (ok) console.log(`  ok   ${n}`);
  else { failures++; console.error(`  FAIL ${n}`, d ?? ""); }
};

async function main() {
  for (const [net, { url, pkg }] of Object.entries(PKGS)) {
    console.log(`\n${net}`);
    const res = await fetch(`${url}/accounts/${pkg}/resources?limit=200`);
    const rows = (await res.json()) as Array<{ type: string; data: Record<string, never> }>;
    const cfg = rows.find((r) => r.type.includes("vault_global_config") && r.type.includes("GlobalVaultConfig"));
    if (!cfg) { check(`${net}: GlobalVaultConfig present`, false); continue; }
    const d = cfg.data as unknown as {
      fee_config: { creation_fee: string; max_fee_bps: string; min_fee_interval: string; max_fee_interval: string };
      requirements: { min_funds_for_activation: string; min_contribution_amount: string; min_redemption_amount: string; min_manager_funds_amount: string; min_manager_funds_fraction_bps: string };
      share_config: { max_contribution_lockup_seconds: string };
      state: { mode: { __variant__: string } };
    };
    const L = DECIBEL_VAULT_LIMITS;
    check(`${net} permissionless (mode=Open)`, d.state.mode.__variant__ === "Open", d.state.mode.__variant__);
    check(`${net} creation fee ${L.creationFeeUsdc} USDC`, BigInt(d.fee_config.creation_fee) === L.creationFeeRaw, d.fee_config.creation_fee);
    check(`${net} max fee ${L.maxFeeBps} bps`, Number(d.fee_config.max_fee_bps) === L.maxFeeBps, d.fee_config.max_fee_bps);
    check(`${net} fee interval ${L.minFeeIntervalS}..${L.maxFeeIntervalS}`,
      Number(d.fee_config.min_fee_interval) === L.minFeeIntervalS && Number(d.fee_config.max_fee_interval) === L.maxFeeIntervalS,
      `${d.fee_config.min_fee_interval}..${d.fee_config.max_fee_interval}`);
    check(`${net} activation min ${L.minFundsForActivationUsdc} USDC`, BigInt(d.requirements.min_funds_for_activation) === L.minFundsForActivationRaw, d.requirements.min_funds_for_activation);
    check(`${net} manager min ${L.minManagerFundsUsdc} USDC / ${L.minManagerFundsFractionBps}bps`,
      Number(d.requirements.min_manager_funds_amount) === L.minManagerFundsUsdc * 1e6 &&
      Number(d.requirements.min_manager_funds_fraction_bps) === L.minManagerFundsFractionBps,
      `${d.requirements.min_manager_funds_amount}/${d.requirements.min_manager_funds_fraction_bps}`);
    check(`${net} max lockup ${L.maxContributionLockupS}s`, Number(d.share_config.max_contribution_lockup_seconds) === L.maxContributionLockupS, d.share_config.max_contribution_lockup_seconds);
  }

  console.log("\nfee model");
  const b = computeFeeBreakdown();
  check("total fee is within Decibel's cap", b.depositorPaysPct * 100 <= DECIBEL_VAULT_LIMITS.maxFeeBps, b);
  check("creator + platform == depositor pays", Math.abs(b.creatorKeepsPct + b.platformTakesPct - b.depositorPaysPct) < 1e-9, b);
  console.log(`       ${b.summary}`);
  console.log(`       launch cost: ${launchCostUsdc(100)} USDC (100 fee + 100 funding)`);

  console.log("\nconfig validation");
  check("rejects a 1-day fee interval (below Decibel's 30-day floor)",
    validateVaultConfig({ feeBps: 1000, feeIntervalS: 86_400, initialFundingUsdc: 100, lockupS: 0 }).length > 0);
  check("rejects >10% profit share",
    validateVaultConfig({ feeBps: 1500, feeIntervalS: 2_592_000, initialFundingUsdc: 100, lockupS: 0 }).length > 0);
  check("rejects underfunded activation",
    validateVaultConfig({ feeBps: 1000, feeIntervalS: 2_592_000, initialFundingUsdc: 50, lockupS: 0 }).length > 0);
  check("accepts a valid config",
    validateVaultConfig({ feeBps: 1000, feeIntervalS: 2_592_000, initialFundingUsdc: 100, lockupS: 0 }).length === 0);


  console.log("\nemoji-safe display names");
  // ── Emoji-safe display names ────────────────────────────────────────────────
  // Vault titles are Move `String`s — arbitrary UTF-8 — so emoji work end to end and a vault
  // named "🚀 Moon Bot 📈" round-trips byte-for-byte on chain (verified on testnet). What does
  // NOT work is truncating one with String.slice: it cuts on UTF-16 code units, splits the
  // surrogate pair and stores a replacement character in a name that can never be edited.
  {
    const loneSurrogate = /[\uD800-\uDFFF]/;
    const stripPairs = (s: string) => s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "");
  
    for (const name of ["🚀🚀🚀 Moon", "🚀".repeat(80), "日本語ボット", "Plain Ascii", "👨‍👩‍👧‍👦 Family"]) {
      const out = truncateDisplayName(name, 8, 24);
      assert.ok(!loneSurrogate.test(stripPairs(out)), `truncation split a character in ${name}`);
      assert.ok(out.length <= 8, `truncation exceeded the unit budget for ${name}`);
      assert.ok(
        new TextEncoder().encode(out).length <= 24,
        `truncation exceeded the byte budget for ${name}`,
      );
    }
    assert.equal(truncateDisplayName("🚀 Moon Bot 📈"), "🚀 Moon Bot 📈", "short emoji names must pass through untouched");
    assert.equal(truncateDisplayName("  spaced  "), "spaced");
  
    // Emoji-only names strip to nothing alphanumerically; they must not all collide on one symbol.
    assert.notEqual(deriveShareSymbol("🚀"), deriveShareSymbol("📈"), "emoji-only names must not share a share symbol");
    assert.equal(deriveShareSymbol("Momentum Alpha"), "sMOMENTUMALPH");
    for (const n of ["🚀", "📈", "日本語", "Momentum Alpha", ""]) {
      assert.ok(/^s[A-Z0-9]{1,15}$/.test(deriveShareSymbol(n)), `share symbol not alphanumeric for ${n}: ${deriveShareSymbol(n)}`);
    }
  }
  check("emoji names truncate and derive symbols safely", true);

  console.log(failures === 0 ? "\nEconomics match both chains.\n" : `\n${failures} FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
export {};
