/**
 * Self-test for lib/strategy-artifacts.ts diffReEmission — the pure
 * re-emission diff behind verifyArtifact. Runs WITHOUT a database:
 * a placeholder DATABASE_URL satisfies PrismaClient construction (no
 * connection is ever opened; diffReEmission never touches Prisma).
 *
 *   pnpm exec tsx scripts/strategy-artifacts-selftest.ts
 */
process.env.DATABASE_URL ??= "postgresql://selftest:selftest@localhost:5432/selftest";

const MARKET_ADDR = "0x" + "ab".repeat(32);

const PINE = `//@version=5
strategy("SMA Cross Selftest", overlay=true)
fastLen = input.int(9, "Fast")
slowLen = input.int(21, "Slow")
fast = ta.sma(close, fastLen)
slow = ta.sma(close, slowLen)
longCondition = ta.crossover(fast, slow)
shortCondition = ta.crossunder(fast, slow)
if (longCondition)
    strategy.entry("Long", strategy.long)
if (shortCondition)
    strategy.entry("Short", strategy.short)
`;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const { diffReEmission, sha3_256Hex } = await import("../lib/strategy-artifacts");
  const { transpileV3 } = await import("../lib/launchpad/transpiler-v3");

  // Produce the "deploy-time" artifact the same way compilePineVault does.
  const emitted = transpileV3(PINE, undefined, { target: "vault", marketAddr: MARKET_ADDR });
  if (emitted.errors?.length) {
    console.error("sample Pine failed to transpile:", emitted.errors);
    process.exit(1);
  }
  const artifact = {
    sourceHash: sha3_256Hex(PINE),
    pineScript: PINE,
    moveSource: emitted.moveSource,
    marketAddr: MARKET_ADDR,
  };

  // 1. Untampered artifact verifies clean.
  const clean = diffReEmission(artifact);
  check("clean: emissionMatches", clean.emissionMatches === true, clean);
  check("clean: hashMatches", clean.hashMatches === true, clean);
  check("clean: no firstDiffLine", clean.firstDiffLine === undefined, clean);
  check(
    "clean: recomputedHash is 0x-prefixed sha3-256",
    /^0x[0-9a-f]{64}$/.test(clean.recomputedHash),
    clean.recomputedHash,
  );

  // 2. Tampered Move source is caught at the exact line.
  const lines = emitted.moveSource.split("\n");
  const target = Math.min(42, lines.length - 1); // 0-based index of the line we corrupt
  const tamperedLines = [...lines];
  tamperedLines[target] = tamperedLines[target] + " // backdoor";
  const tampered = diffReEmission({ ...artifact, moveSource: tamperedLines.join("\n") });
  check("tampered move: emissionMatches=false", tampered.emissionMatches === false, tampered);
  check("tampered move: firstDiffLine is 1-based tamper line", tampered.firstDiffLine === target + 1, tampered);
  check("tampered move: hash still matches (pine untouched)", tampered.hashMatches === true, tampered);

  // 3. Stored Move with extra trailing lines diffs at length boundary.
  const padded = diffReEmission({ ...artifact, moveSource: emitted.moveSource + "\n// extra\n" });
  check("padded move: emissionMatches=false", padded.emissionMatches === false, padded);
  check("padded move: firstDiffLine = first extra line", padded.firstDiffLine === lines.length + 1, padded);

  // 4. Tampered Pine fails the hash check AND the emission diff.
  const tamperedPine = PINE.replace("input.int(9", "input.int(10");
  const swapped = diffReEmission({ ...artifact, pineScript: tamperedPine });
  check("tampered pine: hashMatches=false", swapped.hashMatches === false, swapped);
  check("tampered pine: emissionMatches=false", swapped.emissionMatches === false, swapped);
  check(
    "tampered pine: recomputedHash matches the tampered source",
    swapped.recomputedHash === sha3_256Hex(tamperedPine),
    swapped,
  );

  // 5. marketAddr selects the vault target but is NOT baked into the emitted
  //    source (the market binds at vault init) — emission is market-independent.
  const otherMarket = diffReEmission({ ...artifact, marketAddr: "0x" + "cd".repeat(32) });
  check("different market: emission unchanged", otherMarket.emissionMatches === true, otherMarket);

  // 6. Sizing options change the emitted vault constants (diff when they differ).
  const sized = diffReEmission(artifact, { lotSize: 100 });
  check("non-default lotSize vs default-stored: emissionMatches=false", sized.emissionMatches === false, sized);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
