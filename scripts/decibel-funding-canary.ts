/**
 * Confirm Decibel's funding sign convention against live positions.
 *
 *   pnpm exec tsx scripts/decibel-funding-canary.ts --network mainnet
 *
 * ## Why this is a release gate, not a nicety
 *
 * `portfolio_vault::funding_exceeded` force-closes a position whose accrued funding has eaten
 * more than `max_adverse_funding_bps` of its notional. It decides "adverse" from the SIGN of
 * `position_view_types::get_position_info_unrealized_funding_amount_before_last_update`, reading
 * negative as "this position owes funding".
 *
 * That reading is an inference from the accessor's name. The ABI does not state it, Decibel's
 * source is not public, and it is exactly the kind of assumption that looks obviously right
 * until it is inverted. So it gets checked against reality before any mainnet publish.
 *
 * ## What the check is
 *
 * Perpetual funding flows from the crowded side to the thin side. Across a large enough sample
 * of live positions, longs and shorts on the same market must show funding of OPPOSITE signs —
 * one side is paying the other. If the convention were "magnitude only" or "always positive",
 * that separation would not appear. This does not prove which sign means "owes" on its own, so
 * the script also reports the sign that correlates with the majority side, which is the side
 * that pays in the overwhelmingly common contango case.
 *
 * ## If it disagrees
 *
 * Flip the comparison in `funding_exceeded` and update the convention note in
 * deps/decibel_perp_dex/sources/position_view_types.move. Do NOT publish first and fix later:
 * the inverted behaviour force-closes positions that are being PAID to stay open, which is a
 * silent, continuous drain that looks like a bad strategy rather than a bug.
 */
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const network = process.argv.includes("--network")
  ? process.argv[process.argv.indexOf("--network") + 1]
  : "mainnet";
const isMainnet = network === "mainnet";

const PACKAGE = isMainnet
  ? "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06"
  : "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f";

const aptos = new Aptos(
  new AptosConfig({ network: isMainnet ? Network.MAINNET : Network.TESTNET }),
);

/** Accounts to sample. Pass any number of addresses; each is inspected for open positions. */
const accounts = process.argv.filter((a) => /^0x[0-9a-fA-F]{1,64}$/.test(a));

if (accounts.length === 0) {
  console.error(
    "Pass one or more account addresses with open positions, e.g.\n"
    + "  pnpm exec tsx scripts/decibel-funding-canary.ts --network mainnet 0xabc… 0xdef…\n\n"
    + "Any account works — a whale, your own subaccount, anything with live perp exposure.\n"
    + "The check needs both a long and a short on the same market to be conclusive.",
  );
  process.exit(2);
}

interface Sample {
  account: string;
  market: string;
  isLong: boolean;
  size: string;
  funding: number;
}

const samples: Sample[] = [];

for (const account of accounts) {
  let rows: unknown[];
  try {
    [rows] = (await aptos.view({
      payload: {
        function: `${PACKAGE}::public_read_api::list_positions`,
        functionArguments: [account],
      },
    })) as [unknown[]];
  } catch (err) {
    console.error(`  ${account}: read failed — ${err instanceof Error ? err.message : err}`);
    continue;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`  ${account}: no open positions`);
    continue;
  }
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    // Field names come from the on-chain struct; read defensively, since a renamed field
    // should surface as "could not read" rather than as a confident wrong answer.
    const fundingRaw =
      r.unrealized_funding_amount_before_last_update ?? r.unrealized_funding_amount;
    const funding = Number(
      typeof fundingRaw === "object" && fundingRaw !== null
        ? (fundingRaw as { value?: unknown }).value ?? NaN
        : fundingRaw ?? NaN,
    );
    if (!Number.isFinite(funding)) continue;
    samples.push({
      account,
      market: String((r.market as { inner?: string })?.inner ?? r.market ?? "?"),
      isLong: Boolean(r.is_long),
      size: String(r.size ?? "?"),
      funding,
    });
  }
}

console.log(`\nSampled ${samples.length} live position(s) on ${network}.\n`);
for (const s of samples) {
  console.log(
    `  ${s.isLong ? "LONG " : "SHORT"} ${s.market.slice(0, 12)}… size=${s.size} funding=${s.funding}`,
  );
}

const longs = samples.filter((s) => s.isLong);
const shorts = samples.filter((s) => !s.isLong);
const nonZero = samples.filter((s) => s.funding !== 0);

console.log("");
if (nonZero.length === 0) {
  console.log("INCONCLUSIVE — every sampled position reports zero accrued funding.");
  console.log("Sample accounts with older positions; funding accrues over hours, not seconds.");
  process.exit(1);
}

const byMarket = new Map<string, Sample[]>();
for (const s of nonZero) {
  byMarket.set(s.market, [...(byMarket.get(s.market) ?? []), s]);
}
let opposed = 0;
for (const [market, rows] of byMarket) {
  const l = rows.filter((r) => r.isLong);
  const sh = rows.filter((r) => !r.isLong);
  if (l.length === 0 || sh.length === 0) continue;
  const lSign = Math.sign(l[0].funding);
  const sSign = Math.sign(sh[0].funding);
  if (lSign !== 0 && sSign !== 0 && lSign !== sSign) {
    opposed++;
    console.log(
      `  ${market.slice(0, 12)}…  longs ${lSign > 0 ? "+" : "-"}  shorts ${sSign > 0 ? "+" : "-"}`
      + `  →  ${lSign < 0 ? "longs pay" : "shorts pay"} under the negative-is-cost reading`,
    );
  }
}

if (opposed === 0) {
  console.log("INCONCLUSIVE — no market in the sample had both a long and a short with funding.");
  console.log("Add accounts on the other side of a market you already sampled.");
  process.exit(1);
}

console.log(
  `\nCONFIRMED SEPARATION on ${opposed} market(s): longs and shorts carry opposite signs, so the`
  + `\nfield is directional rather than a magnitude. Under the negative-is-cost reading that`
  + `\nportfolio_vault acts on, the side showing NEGATIVE funding is the one paying.`,
);
console.log(
  `\nSanity: in the usual contango regime longs pay shorts. ${longs.length} long / ${shorts.length}`
  + ` short sampled. If the longs above show POSITIVE funding, the convention is inverted —`
  + `\nflip the comparison in portfolio_vault::funding_exceeded before publishing.`,
);
export {};
