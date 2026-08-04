/**
 * Every catalog strategy must actually commit. Offering one the commit step
 * rejects is a dead end the user cannot debug, so this is a hard gate.
 *
 *   pnpm test:catalog
 */
import assert from "node:assert/strict";
import { SEALED_CATALOG } from "../lib/sealed-catalog";
import { commitProgram, SEALED_MARKETS } from "../lib/sealed-vaults";

let failures = 0;
const market = SEALED_MARKETS[0];
console.log(`\ncatalog: ${SEALED_CATALOG.length} strategies, market ${market.name}\n`);

const seen = new Set<string>();
for (const s of SEALED_CATALOG) {
  if (seen.has(s.id)) {
    console.error(`  FAIL duplicate id ${s.id}`);
    failures++;
  }
  seen.add(s.id);
  const r = commitProgram({ pine: s.script, marketAddr: market.addr });
  if (r.ok) {
    console.log(`  ok   ${s.label.padEnd(26)} ${r.commitment.slice(0, 18)}… (${r.warmupBars} bar warmup)`);
  } else {
    failures++;
    console.error(`  FAIL ${s.label}: ${r.error}`);
    for (const e of r.errors ?? []) console.error(`         • ${e}`);
  }
  if (!s.blurb || s.blurb.length > 90) {
    failures++;
    console.error(`  FAIL ${s.label}: blurb must be present and <= 90 chars`);
  }
}


// ── Blurbs must match the code ──────────────────────────────────────────────
// Every catalog script calls strategy.entry(..., strategy.short), but the blurbs originally
// described only the long leg — "goes long when the fast average crosses above the slow one".
// A creator commits capital on the strength of that sentence, so an incomplete one understates
// the risk of the product. This fails the build if the two ever drift apart again.
for (const s of SEALED_CATALOG) {
  const takesLong = /strategy\.long/.test(s.script);
  const takesShort = /strategy\.short/.test(s.script);
  const claimed =
    takesLong && takesShort ? "Long/short" : takesShort ? "Short only" : "Long only";
  assert.equal(
    s.direction,
    claimed,
    `${s.id}: declares "${s.direction}" but the script takes ${claimed.toLowerCase()}`,
  );
  if (takesShort) {
    assert.ok(
      /short/i.test(s.blurb),
      `${s.id}: the script enters shorts but the blurb never says so — "${s.blurb}"`,
    );
  }
  assert.ok(s.blurb.length <= 90, `${s.id}: blurb too long for the dropdown`);
  assert.ok(s.category && s.turnover, `${s.id}: missing category/turnover metadata`);
}
console.log(`catalog metadata: ${SEALED_CATALOG.length} strategies, blurbs match their scripts`);

console.log(failures === 0 ? "\nAll catalog strategies commit." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
export {};
