import assert from "node:assert/strict";

import {
  fetchMainnetAptos,
  getMainnetAptosFullnodeBase,
  mainnetAptosStatePath,
  readFreshMainnetAptosLedger,
  requireMainnetAptosResponse,
} from "../lib/aptos-server-lite";

const saved = {
  nodeUrl: process.env.APTOS_NODE_URL_MAINNET,
  trustedOrigin: process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN,
  trustedApiKey: process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY,
  apiKey: process.env.APTOS_API_KEY_MAINNET,
};
const originalFetch = globalThis.fetch;

function restoreEnvironment() {
  const entries = [
    ["APTOS_NODE_URL_MAINNET", saved.nodeUrl],
    ["CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN", saved.trustedOrigin],
    ["CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY", saved.trustedApiKey],
    ["APTOS_API_KEY_MAINNET", saved.apiKey],
  ] as const;
  for (const [key, value] of entries) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
}

async function main() {
  process.env.APTOS_NODE_URL_MAINNET = "https://api.mainnet.aptoslabs.com/v1/";
  delete process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN;
  process.env.APTOS_API_KEY_MAINNET = "runtime-secret";

  assert.equal(getMainnetAptosFullnodeBase(), "https://api.mainnet.aptoslabs.com/v1");
  assert.equal(mainnetAptosStatePath("/view", "123"), "/view?ledger_version=123");
  assert.throws(
    () => mainnetAptosStatePath("/view?ledger_version=122", "123"),
    /different ledger version/,
  );
  await assert.rejects(fetchMainnetAptos("/../decibel/api/v1/markets"), /escaped/);

  const requests: Array<{
    url: string;
    authorization: string | null;
    redirect: RequestRedirect | undefined;
  }> = [];
  let responseIndex = 0;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      redirect: init?.redirect,
    });
    responseIndex += 1;
    if (responseIndex === 1) return new Response("unauthorized", { status: 401 });
    return new Response(JSON.stringify({
      chain_id: 1,
      ledger_version: "999",
      ledger_timestamp: String(1_800_000_000_000_000n),
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const response = await fetchMainnetAptos("/", {
    headers: { Authorization: "Bearer attacker-selected-value" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(requests, [
    {
      url: "https://api.mainnet.aptoslabs.com/v1/",
      authorization: "Bearer runtime-secret",
      redirect: "error",
    },
    {
      url: "https://api.mainnet.aptoslabs.com/v1/",
      authorization: null,
      redirect: "error",
    },
  ]);

  const nowMs = 1_800_000_000_000;
  const ledger = await readFreshMainnetAptosLedger({ nowMs });
  assert.deepEqual(ledger, {
    chainId: 1,
    version: "999",
    timestampUsec: "1800000000000000",
    observedAtMs: nowMs,
  });

  const pinnedHeaders = {
    "x-aptos-chain-id": "1",
    "x-aptos-ledger-version": "123",
    "x-aptos-ledger-timestampusec": String(BigInt(nowMs) * 1_000n),
  };
  assert.deepEqual(
    await requireMainnetAptosResponse(new Response(null, { headers: pinnedHeaders }), "123", nowMs),
    {
      chainId: 1,
      version: "123",
      timestampUsec: "1800000000000000",
    },
  );
  await assert.rejects(
    requireMainnetAptosResponse(new Response(null, {
      headers: { ...pinnedHeaders, "x-aptos-chain-id": "2" },
    }), "123", nowMs),
    /canonical mainnet ledger headers/,
  );
  await assert.rejects(
    requireMainnetAptosResponse(new Response(null, {
      headers: { ...pinnedHeaders, "x-aptos-ledger-version": "122" },
    }), "123", nowMs),
    /predates the pinned ledger/,
  );

  globalThis.fetch = (async () => new Response(JSON.stringify({
    chain_id: 1,
    ledger_version: "1000",
    ledger_timestamp: String(BigInt(nowMs - 60_001) * 1_000n),
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(readFreshMainnetAptosLedger({ nowMs }), /stale or time-skewed/);

  process.env.APTOS_NODE_URL_MAINNET = "https://rpc.example.com/v1";
  delete process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN;
  assert.throws(getMainnetAptosFullnodeBase, /requires CASH_ORDERBOOK_TRUSTED/);
  process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN = "http://rpc.example.com";
  assert.throws(getMainnetAptosFullnodeBase, /exact HTTPS origin/);
  process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_ORIGIN = "https://rpc.example.com";
  assert.equal(getMainnetAptosFullnodeBase(), "https://rpc.example.com/v1");
  const customRequests: Array<string | null> = [];
  globalThis.fetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    customRequests.push(new Headers(init?.headers).get("authorization"));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  delete process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY;
  await fetchMainnetAptos("/");
  process.env.CASH_ORDERBOOK_TRUSTED_APTOS_MAINNET_API_KEY = "custom-rpc-only-secret";
  await fetchMainnetAptos("/");
  assert.deepEqual(customRequests, [null, "Bearer custom-rpc-only-secret"]);
  process.env.APTOS_NODE_URL_MAINNET = "https://rpc.example.com";
  assert.equal(mainnetAptosStatePath("/view", "456"), "/view?ledger_version=456");

  console.log("Aptos mainnet runtime trust checks passed.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(restoreEnvironment);
