import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  proveSealedVaultRegistration,
  SealedRegistryProofError,
  type SealedRegistrationClaim,
  verifySealedVaultResource,
} from "../lib/sealed-registry-proof";
import { normalizeAddress, SEALED_MARKETS_BY_NETWORK } from "../lib/sealed-vaults";

async function main() {
const markets = SEALED_MARKETS_BY_NETWORK.testnet;
const commitment = `0x${"11".repeat(32)}`;
const attestor = `0x${"22".repeat(32)}`;

function marketSpec(index: number) {
  const market = markets[index];
  return {
    market: { inner: market.addr },
    size_decimals_pow: market.sizeDecimalsPow,
    lot_size: market.lotSize,
    min_size: market.minSize,
    ticker_size: market.tickerSize,
  };
}

function claim(kind: "single" | "portfolio"): SealedRegistrationClaim {
  return {
    network: "testnet",
    packageAddress: "0xa",
    strategyVaultAddr: "0xb",
    creatorAddr: "0xc",
    decibelVaultAddr: "0xd",
    programCommitment: commitment,
    attestorPubkey: attestor,
    vaultKind: kind,
    markets: kind === "single" ? [markets[0]] : [markets[0], markets[1]],
    pctBps: kind === "single" ? 1000 : 2500,
    maxLeverageX100: 200,
    minBarIntervalS: 60,
  };
}

function commonData() {
  return {
    creator: "0xc",
    decibel_vault_addr: "0xd",
    program_commitment: commitment,
    attestor_pubkey: Array.from(Buffer.from(attestor.slice(2), "hex")),
    enclave_measurement: "0x",
    max_leverage_x100: "200",
    min_bar_interval_s: "60",
    sealed: true,
  };
}

const singleResource = {
  type: "0xa::sealed_vault::SealedVault",
  data: {
    ...commonData(),
    ...marketSpec(0),
    pct_bps: "1000",
  },
};
const verifiedSingle = verifySealedVaultResource(claim("single"), singleResource);
assert.equal(verifiedSingle.creatorAddr, normalizeAddress("0xc"));
assert.equal(verifiedSingle.decibelVaultAddr, normalizeAddress("0xd"));
assert.equal(verifiedSingle.programCommitment, commitment);
assert.equal(verifiedSingle.attestorPubkey, attestor);
assert.equal(verifiedSingle.enclaveMeasurement, null);

const portfolioResource = {
  type: "0xa::portfolio_vault::PortfolioVault",
  data: {
    ...commonData(),
    markets: [marketSpec(0), marketSpec(1)],
    max_pct_bps: "2500",
  },
};
const verifiedPortfolio = verifySealedVaultResource(claim("portfolio"), portfolioResource);
assert.equal(verifiedPortfolio.strategyVaultAddr, normalizeAddress("0xb"));

assert.throws(
  () =>
    verifySealedVaultResource(claim("single"), {
      ...singleResource,
      data: { ...singleResource.data, creator: "0xe" },
    }),
  /creator does not match/,
  "a client must not be able to register someone else's creator address",
);

assert.throws(
  () =>
    verifySealedVaultResource(claim("portfolio"), {
      ...portfolioResource,
      data: { ...portfolioResource.data, markets: [marketSpec(1), marketSpec(0)] },
    }),
  /market 1 address does not match/,
  "portfolio market order is part of the strategy's on-chain identity",
);

assert.throws(
  () =>
    verifySealedVaultResource(claim("single"), {
      ...singleResource,
      data: { ...singleResource.data, sealed: false },
    }),
  /not sealed/,
  "an unsealed strategy must never enter the executor registry",
);

let requestedUrl = "";
await proveSealedVaultRegistration(claim("single"), {
  fullnodeBaseUrl: "https://aptos.example/v1/",
  fetchImpl: (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(singleResource), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch,
});
assert.match(requestedUrl, /\/accounts\/0xb\/resource\//);
assert.match(requestedUrl, /sealed_vault/);

await assert.rejects(
  proveSealedVaultRegistration(claim("single"), {
    fetchImpl: (async () => new Response("not found", { status: 404 })) as typeof fetch,
  }),
  (error: unknown) =>
    error instanceof SealedRegistryProofError &&
    error.status === 422 &&
    /not found/.test(error.message),
  "a missing Move resource must be a hard registration failure",
);

const route = readFileSync("app/api/sealed/vaults/route.ts", "utf8");
assert.ok(
  route.indexOf("proveSealedVaultRegistration") < route.indexOf("encryptSource(body.managedPine"),
  "the chain proof must happen before managed source encryption",
);
assert.match(route, /body\.network !== network/);
assert.match(route, /requestedPackage !== configuredPackage/);

console.log("sealed registry proof self-test passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
