/**
 * POST /api/sealed/payload
 *
 * Builds the wallet-signed entry-function payloads for the sealed-vault launch
 * rail. The server holds no user key and never submits these — the UI signs.
 *
 * kinds: decibel-vault | create | create-portfolio | delegate | revoke | announce-swap | pause
 *
 * Launch order is decibel-vault → create → delegate, three wallet signatures. It cannot be
 * fewer: Decibel declares both `create_and_fund_vault` and `delegate_dex_actions_to` as
 * `private entry`, so neither is callable from a Move module or a transaction script, and the
 * vault address that step 2 and 3 need only exists once step 1 has landed. There is no `seal`
 * kind — vaults are sealed by `create_sealed_vault` itself.
 */
import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit } from "@/lib/api-rate-limit";
import {
  DECIBEL_PACKAGE_BY_NETWORK,
  SEALED_PACKAGE,
  USDC_METADATA_BY_NETWORK,
  buildAnnounceSwapPayload,
  buildCreatePortfolioVaultPayload,
  buildCreateSealedVaultPayload,
  buildRevokeDelegationPayload,
  buildSetPausedPayload,
  derivePrimarySubaccount,
  deriveShareSymbol,
  findSealedMarket,
  isHex32,
  isHexAddress,
  PORTFOLIO_DEFAULTS,
  sealedNetwork,
  truncateDisplayName,
} from "@/lib/sealed-vaults";
import {
  buildCreateDecibelVaultPayload,
  buildDelegateDecibelVaultPayload,
} from "@/lib/decibel-vaults";
import { DECIBEL_VAULT_LIMITS, PLATFORM_FEE, validateVaultConfig } from "@/lib/vault-economics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const rate = checkApiRateLimit(request, "sealed-payload", 60, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate limited", retryAfterS: rate.retryAfterS },
      { status: 429, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_STORE });
  }

  const pkg = typeof body.packageAddress === "string" ? body.packageAddress : SEALED_PACKAGE;
  if (!pkg) {
    return NextResponse.json(
      { error: "sealed vault module is not configured — set SEALED_VAULT_PACKAGE" },
      { status: 501, headers: NO_STORE },
    );
  }
  if (!isHexAddress(pkg)) {
    return NextResponse.json({ error: "invalid packageAddress" }, { status: 400, headers: NO_STORE });
  }

  const kind = body.kind;
  const network = sealedNetwork();

  // Step 1 of the launch: the Decibel vault that actually holds depositor capital.
  if (kind === "decibel-vault") {
    if (!isHexAddress(body.creatorAddr)) {
      return NextResponse.json(
        { error: "creatorAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    // Code-point-safe: a plain .slice() would split an emoji and store a replacement char.
    const name = typeof body.name === "string" ? truncateDisplayName(body.name) : "";
    if (!name) {
      return NextResponse.json({ error: "name required" }, { status: 400, headers: NO_STORE });
    }
    const fundingUsdc = Number(body.fundingUsdc ?? DECIBEL_VAULT_LIMITS.minFundsForActivationUsdc);
    const violations = validateVaultConfig({
      feeBps: PLATFORM_FEE.totalFeeBps,
      feeIntervalS: DECIBEL_VAULT_LIMITS.minFeeIntervalS,
      initialFundingUsdc: fundingUsdc,
      lockupS: 0,
    });
    if (violations.length > 0) {
      return NextResponse.json(
        { error: violations[0], errors: violations },
        { status: 400, headers: NO_STORE },
      );
    }

    // Both the package and the subaccount are pinned to the sealed rail's own table rather
    // than resolved from lib/decibel.ts, whose TESTNET package is the abandoned 0x952535c3….
    const decibelPackage =
      typeof body.decibelPackage === "string" ? body.decibelPackage : DECIBEL_PACKAGE_BY_NETWORK[network];
    const subaccountAddr = derivePrimarySubaccount(body.creatorAddr as string, network);
    const built = buildCreateDecibelVaultPayload({
      packageAddress: decibelPackage,
      subaccount: subaccountAddr,
      contributionAsset: USDC_METADATA_BY_NETWORK[network],
      name,
      description:
        typeof body.description === "string"
          ? truncateDisplayName(body.description, 500, 1500)
          : "Private strategy enforced on-chain by cash_strategy::sealed_vault",
      // Derived, never asked for. Emoji-only names strip to nothing, so deriveShareSymbol
      // falls back to a hash of the name rather than giving every such vault "sSEAL".
      shareSymbol: deriveShareSymbol(name),
      // This is where the platform fee stops being a display number: 10% total profit
      // share, split per lib/vault-economics.ts. 30 days is Decibel's floor — a shorter
      // interval aborts the transaction.
      feeBps: PLATFORM_FEE.totalFeeBps,
      feeIntervalS: DECIBEL_VAULT_LIMITS.minFeeIntervalS,
      contributionLockupDurationS: 0,
      initialFundingRaw: String(Math.round(fundingUsdc * 1e6)),
      acceptsContributions: true,
      // The ONLY delegate will be the sealed module, so no human can ever place an
      // order on this vault's behalf.
      delegateToCreator: false,
      network,
    });
    return NextResponse.json(
      {
        ok: true,
        subaccountAddr,
        payload: built.payload,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  if (kind === "create") {
    const { programCommitment, attestorPubkey, decibelVaultAddr } = body as {
      programCommitment?: unknown;
      attestorPubkey?: unknown;
      decibelVaultAddr?: unknown;
    };
    if (!isHex32(programCommitment)) {
      return NextResponse.json(
        { error: "programCommitment must be 32 bytes of hex" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHex32(attestorPubkey)) {
      return NextResponse.json(
        { error: "attestorPubkey must be a 32-byte ed25519 key" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHexAddress(decibelVaultAddr)) {
      return NextResponse.json(
        { error: "decibelVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    const market = findSealedMarket(typeof body.market === "string" ? body.market : "BTC/USD");
    if (!market) {
      return NextResponse.json({ error: "unknown market" }, { status: 400, headers: NO_STORE });
    }

    // Rule bounds are enforced on-chain too; validating here gives a readable
    // error instead of a Move abort code.
    const pctBps = Number(body.pctBps ?? 1000);
    const maxLeverageX100 = Number(body.maxLeverageX100 ?? 200);
    const minBarIntervalS = Number(body.minBarIntervalS ?? 60);
    const traceCapacity = Number(body.traceCapacity ?? 500);
    // 0.30% default: comfortably crosses a normal BTC spread without chasing.
    const slippageBps = Number(body.slippageBps ?? 30);
    if (!Number.isInteger(pctBps) || pctBps < 1 || pctBps > 10000) {
      return NextResponse.json(
        { error: "pctBps must be 1..10000 (bps of NAV per order)" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(maxLeverageX100) || maxLeverageX100 < 1 || maxLeverageX100 > 2000) {
      return NextResponse.json(
        { error: "maxLeverageX100 must be 1..2000 (200 = 2x)" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(minBarIntervalS) || minBarIntervalS < 1) {
      return NextResponse.json(
        { error: "minBarIntervalS must be >= 1" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!Number.isInteger(traceCapacity) || traceCapacity < 30 || traceCapacity > 2000) {
      return NextResponse.json(
        { error: "traceCapacity must be 30..2000" },
        { status: 400, headers: NO_STORE },
      );
    }
    // Mirrors MAX_SLIPPAGE_BPS in sealed_vault.move.
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) {
      return NextResponse.json(
        { error: "slippageBps must be 0..500 (5% ceiling)" },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        payload: buildCreateSealedVaultPayload({
          packageAddress: pkg,
          programCommitment,
          attestorPubkey,
          decibelVaultAddr,
          market,
          pctBps,
          maxLeverageX100,
          minBarIntervalS,
          slippageBps,
          traceCapacity,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // Portfolio mode: one program, an allowlist of markets, several legs at once.
  //
  // A separate kind rather than an option on `create`, because it targets a DIFFERENT MODULE
  // with different bounds. Overloading `create` would mean one endpoint whose validation rules
  // change shape based on how many markets came in — the shape where a missing check on one
  // branch is easy to miss.
  if (kind === "create-portfolio") {
    const { programCommitment, attestorPubkey, decibelVaultAddr } = body as {
      programCommitment?: unknown;
      attestorPubkey?: unknown;
      decibelVaultAddr?: unknown;
    };
    if (!isHex32(programCommitment)) {
      return NextResponse.json(
        { error: "programCommitment must be 32 bytes of hex" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHex32(attestorPubkey)) {
      return NextResponse.json(
        { error: "attestorPubkey must be a 32-byte ed25519 key" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (!isHexAddress(decibelVaultAddr)) {
      return NextResponse.json(
        { error: "decibelVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }

    const names = Array.isArray(body.markets) ? body.markets : [];
    if (names.length < 1 || names.length > 16) {
      return NextResponse.json(
        { error: "markets must be a list of 1..16 market names" },
        { status: 400, headers: NO_STORE },
      );
    }
    const markets = [];
    const seen = new Set<string>();
    for (const n of names) {
      const m = findSealedMarket(typeof n === "string" ? n : "");
      if (!m) {
        return NextResponse.json(
          { error: `unknown market: ${String(n)}` },
          { status: 400, headers: NO_STORE },
        );
      }
      // The allowlist order defines `market_idx` forever, and a repeat would make two indices
      // address one book — the pyramiding path the per-bar duplicate check exists to close.
      if (seen.has(m.addr)) {
        return NextResponse.json(
          { error: `market ${m.name} listed twice` },
          { status: 400, headers: NO_STORE },
        );
      }
      seen.add(m.addr);
      markets.push(m);
    }

    const num = (v: unknown, d: number) => Number(v ?? d);
    const maxPctBps = num(body.maxPctBps, PORTFOLIO_DEFAULTS.maxPctBps);
    const maxLeverageX100 = num(body.maxLeverageX100, PORTFOLIO_DEFAULTS.maxLeverageX100);
    const maxPortfolioLeverageX100 = num(
      body.maxPortfolioLeverageX100,
      PORTFOLIO_DEFAULTS.maxPortfolioLeverageX100,
    );
    const maxPositions = num(body.maxPositions, PORTFOLIO_DEFAULTS.maxPositions);
    const maxHoldBars = num(body.maxHoldBars, PORTFOLIO_DEFAULTS.maxHoldBars);
    const maxAdverseFundingBps = num(
      body.maxAdverseFundingBps,
      PORTFOLIO_DEFAULTS.maxAdverseFundingBps,
    );
    const minBarIntervalS = num(body.minBarIntervalS, 60);
    const slippageBps = num(body.slippageBps, 30);
    const traceCapacity = num(body.traceCapacity, 500);

    // Every bound below is also checked in Move. Duplicating them here is not redundancy:
    // an abort code arrives AFTER the creator has paid to create the Decibel vault, at which
    // point the only remedy is relaunching. These say which field is wrong, before that.
    const bad = (msg: string) =>
      NextResponse.json({ error: msg }, { status: 400, headers: NO_STORE });
    const int = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!int(maxPctBps, 1, 10000)) return bad("maxPctBps must be 1..10000");
    if (!int(maxLeverageX100, 100, 2000)) return bad("maxLeverageX100 must be 100..2000");
    // MAX_PORTFOLIO_LEVERAGE_X100 in portfolio_vault.move.
    if (!int(maxPortfolioLeverageX100, 100, 1000)) {
      return bad("maxPortfolioLeverageX100 must be 100..1000 (10x ceiling)");
    }
    // MAX_OPEN_POSITIONS.
    if (!int(maxPositions, 1, 8)) return bad("maxPositions must be 1..8");
    // MAX_HOLD_BARS. Zero is rejected on purpose: it would mean "hold forever", which is the
    // failure the field exists to prevent.
    if (!int(maxHoldBars, 1, 14400)) return bad("maxHoldBars must be 1..14400");
    if (!int(maxAdverseFundingBps, 1, 10000)) return bad("maxAdverseFundingBps must be 1..10000");
    if (!int(minBarIntervalS, 1, 86400)) return bad("minBarIntervalS must be 1..86400");
    if (!int(slippageBps, 0, 500)) return bad("slippageBps must be 0..500 (5% ceiling)");
    if (!int(traceCapacity, 30, 2000)) return bad("traceCapacity must be 30..2000");
    if (maxPositions > markets.length) {
      return bad(
        `maxPositions (${maxPositions}) exceeds the ${markets.length} market(s) in the allowlist`,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        markets: markets.map((m) => ({ name: m.name, addr: m.addr })),
        payload: buildCreatePortfolioVaultPayload({
          packageAddress: pkg,
          programCommitment,
          attestorPubkey,
          decibelVaultAddr,
          markets,
          maxPctBps,
          maxLeverageX100,
          maxPortfolioLeverageX100,
          maxPositions,
          maxHoldBars,
          maxAdverseFundingBps,
          minBarIntervalS,
          slippageBps,
          traceCapacity,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // Swapping the algo: revoke the old strategy's trading rights. Pair it with a fresh
  // `create` (free on a licensed vault) and a `delegate` to the new strategy address.
  //
  // `strategyVaultAddrs` is optional and normally omitted: with no list this builds
  // `revoke_all_dex_actions_delegations`, which disarms the vault completely before the
  // replacement is delegated. That is the only form that cannot leave a second strategy
  // trading the same subaccount, because it needs no knowledge of who the delegates are.
  if (kind === "revoke") {
    const addrs = Array.isArray(body.strategyVaultAddrs) ? body.strategyVaultAddrs : [];
    if (!isHexAddress(body.decibelVaultAddr) || !addrs.every(isHexAddress)) {
      return NextResponse.json(
        {
          error:
            "decibelVaultAddr is required, and strategyVaultAddrs[] (optional — omit to revoke " +
            "every delegation) must contain only addresses",
        },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        payload: buildRevokeDelegationPayload({
          decibelPackage:
            typeof body.decibelPackage === "string"
              ? body.decibelPackage
              : DECIBEL_PACKAGE_BY_NETWORK[network],
          decibelVaultAddr: body.decibelVaultAddr as string,
          strategyVaultAddrs: addrs as string[],
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  // Start the depositor-notice clock on a replacement strategy.
  if (kind === "announce-swap") {
    if (!isHexAddress(body.strategyVaultAddr)) {
      return NextResponse.json(
        { error: "strategyVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        payload: buildAnnounceSwapPayload({
          packageAddress: pkg,
          strategyVaultAddr: body.strategyVaultAddr as string,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  if (kind === "pause") {
    if (!isHexAddress(body.strategyVaultAddr)) {
      return NextResponse.json(
        { error: "strategyVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        payload: buildSetPausedPayload({
          packageAddress: pkg,
          strategyVaultAddr: body.strategyVaultAddr as string,
          paused: body.paused === true,
        }),
      },
      { status: 200, headers: NO_STORE },
    );
  }

  if (kind === "delegate") {
    if (!isHexAddress(body.strategyVaultAddr) || !isHexAddress(body.decibelVaultAddr)) {
      return NextResponse.json(
        { error: "strategyVaultAddr and decibelVaultAddr required" },
        { status: 400, headers: NO_STORE },
      );
    }
    // Always bound the delegation. An unbounded grant on the old Decibel package
    // could never be revoked (docs/CURATOR-RULES.md §2).
    const days = Number(body.expiryDays ?? 365);
    const expirySecs = Math.floor(Date.now() / 1000) + Math.max(1, days) * 86_400;
    const built = buildDelegateDecibelVaultPayload({
      packageAddress:
        typeof body.decibelPackage === "string"
          ? body.decibelPackage
          : DECIBEL_PACKAGE_BY_NETWORK[network],
      vaultAddress: body.decibelVaultAddr,
      delegate: body.strategyVaultAddr,
      expirationTimestampSecs: expirySecs,
      network,
    });
    return NextResponse.json(
      {
        ok: true,
        signer: "decibel-vault-admin",
        note: "This must be signed by the Decibel vault ADMIN, not the strategy creator.",
        payload: built.payload,
      },
      { status: 200, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      error:
        'kind must be one of "decibel-vault" | "create" | "delegate" | "revoke" | ' +
        '"announce-swap" | "pause"',
    },
    { status: 400, headers: NO_STORE },
  );
}
