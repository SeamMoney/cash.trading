import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vaultRoute = readFileSync("app/api/decibel/vaults/route.ts", "utf8");
const tradePage = readFileSync("components/trade/TradePageClient.tsx", "utf8");
const cronRoute = readFileSync("app/api/cron/bot-tick/route.ts", "utf8");
const keeperRoute = readFileSync("app/api/launchpad/keeper/route.ts", "utf8");
const marketRefreshRoute = readFileSync("app/api/markets/refresh/route.ts", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>;
  pnpm?: { overrides?: Record<string, string> };
};

assert.match(vaultRoute, /const VAULT_PAGE_SIZE = 1_000;/);
assert.match(vaultRoute, /status: "active"/);
assert.match(vaultRoute, /remainingOffsets\.map\(fetchPage\)/);
assert.ok(!vaultRoute.includes("/vaults?limit=50"), "vault discovery must not stop at 50");
assert.ok(
  !vaultRoute.includes("v.status === \"active\" && (v.tvl ?? 0) > 0"),
  "zero-TVL active vaults must not be hidden after Decibel returns them",
);

assert.ok(!tradePage.includes("GUILD_OVERRIDES"), "real vault identities must not be replaced with demo guilds");
assert.ok(!tradePage.includes("buildPnlCurve"), "vault charts must not fabricate PnL history");
assert.match(tradePage, /const displayVaults = \[\.\.\.vaults\]/);
assert.ok(
  !tradePage.includes(".filter((v) => v.vault_type === \"protocol\""),
  "the vault carousel must show every active vault returned by Decibel",
);

assert.match(cronRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /if \(!cronSecret\)/);
assert.match(keeperRoute, /LAUNCHPAD_KEEPER_API_SECRET/);
assert.match(marketRefreshRoute, /function authorizeRefresh/);
assert.match(marketRefreshRoute, /if \(!secret\)/);

for (const removedDependency of [
  "@blocto/aptos-wallet-adapter-plugin",
  "@keyv/etcd",
  "@keyv/sqlite",
  "@telegram-apps/bridge",
  "keyv",
  "petra-plugin-wallet-adapter",
]) {
  assert.ok(
    !(removedDependency in packageJson.dependencies),
    `${removedDependency} must not return as an unused production dependency`,
  );
}

assert.equal(packageJson.dependencies.next, "^16.2.10");
assert.equal(packageJson.dependencies.ws, "^8.21.0");
assert.equal(packageJson.pnpm?.overrides?.["uuid@<11.1.1"], "11.1.1");

console.log("app reliability self-test: passed");
