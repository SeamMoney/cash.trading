/**
 * Every catalog strategy must actually commit. Offering one the commit step
 * rejects is a dead end the user cannot debug, so this is a hard gate.
 *
 *   pnpm test:catalog
 */
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

console.log(failures === 0 ? "\nAll catalog strategies commit.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);

export {};
