import assert from "node:assert/strict";

import { NextRequest } from "next/server";

const sealedPackage = `0x${"a".repeat(64)}`;
const strategyVault = `0x${"b".repeat(64)}`;
const decibelVault = `0x${"c".repeat(64)}`;
const forgedPackage = `0x${"d".repeat(64)}`;
const mainnetDecibel = "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";

async function main() {
  process.env.SEALED_VAULT_PACKAGE = sealedPackage;
  process.env.NEXT_PUBLIC_SEALED_VAULT_PACKAGE = sealedPackage;
  process.env.DECIBEL_NETWORK = "mainnet";
  process.env.NEXT_PUBLIC_DECIBEL_NETWORK = "mainnet";

  const { POST } = await import("../app/api/sealed/payload/route");

  async function post(body: Record<string, unknown>) {
    const response = await POST(
      new NextRequest("http://localhost/api/sealed/payload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }

  const pause = await post({ kind: "pause", strategyVaultAddr: strategyVault, paused: true });
  assert.equal(pause.status, 200);
  assert.equal(
    (pause.json.payload as { function: string }).function,
    `${sealedPackage}::sealed_vault::set_paused`,
  );

  const forgedSealed = await post({
    kind: "pause",
    packageAddress: forgedPackage,
    strategyVaultAddr: strategyVault,
    paused: true,
  });
  assert.equal(forgedSealed.status, 400);
  assert.match(String(forgedSealed.json.error), /configured sealed-vault package/);

  const forgedDecibel = await post({
    kind: "delegate",
    decibelPackage: forgedPackage,
    strategyVaultAddr: strategyVault,
    decibelVaultAddr: decibelVault,
  });
  assert.equal(forgedDecibel.status, 400);
  assert.match(String(forgedDecibel.json.error), /configured Decibel deployment/);

  const wrongNetwork = await post({
    kind: "delegate",
    network: "testnet",
    strategyVaultAddr: strategyVault,
    decibelVaultAddr: decibelVault,
  });
  assert.equal(wrongNetwork.status, 400);
  assert.match(String(wrongNetwork.json.error), /configured mainnet deployment/);

  const badExpiry = await post({
    kind: "delegate",
    strategyVaultAddr: strategyVault,
    decibelVaultAddr: decibelVault,
    expiryDays: "forever",
  });
  assert.equal(badExpiry.status, 400);
  assert.match(String(badExpiry.json.error), /expiryDays/);

  const delegate = await post({
    kind: "delegate",
    strategyVaultAddr: strategyVault,
    decibelVaultAddr: decibelVault,
    expiryDays: 30,
  });
  assert.equal(delegate.status, 200);
  assert.match(
    (delegate.json.payload as { function: string }).function,
    new RegExp(`^${mainnetDecibel}::`),
  );

  const unknown = await post({ kind: "not-a-kind" });
  assert.equal(unknown.status, 400);
  assert.match(String(unknown.json.error), /create-portfolio/);

  console.log("sealed payload policy: package, network, and expiry targets are server-pinned");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
