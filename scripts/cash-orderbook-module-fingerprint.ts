import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const requiredModules = [
  "accounts",
  "admin",
  "cancel",
  "fees",
  "market",
  "matching",
  "order_placement",
  "settlement",
  "subaccounts",
  "types",
  "views",
];

const contractAddress = (process.argv[2] ?? process.env.CASH_ORDERBOOK_CONTRACT_ADDRESS ?? "").trim();
if (!/^0x[0-9a-fA-F]{1,64}$/.test(contractAddress)) {
  throw new Error("Pass the audited mainnet package address as the first argument");
}
const localModulesDirectory = process.argv[3]?.trim();
if (!localModulesDirectory) {
  throw new Error("Pass the auditor-approved local bytecode_modules directory as the second argument");
}

const packageResourceType = encodeURIComponent("0x1::code::PackageRegistry");
const [ledgerResponse, response, packageResponse] = await Promise.all([
  fetch("https://api.mainnet.aptoslabs.com/v1", { signal: AbortSignal.timeout(10_000) }),
  fetch(
    `https://api.mainnet.aptoslabs.com/v1/accounts/${contractAddress}/modules`,
    { signal: AbortSignal.timeout(10_000) },
  ),
  fetch(
    `https://api.mainnet.aptoslabs.com/v1/accounts/${contractAddress}/resource/${packageResourceType}`,
    { signal: AbortSignal.timeout(10_000) },
  ),
]);
if (!ledgerResponse.ok) throw new Error(`Mainnet ledger lookup failed (${ledgerResponse.status})`);
const ledger = await ledgerResponse.json() as { chain_id?: unknown };
if (String(ledger.chain_id) !== "1") throw new Error("The fullnode is not Aptos mainnet");
if (!response.ok) throw new Error(`Module lookup failed (${response.status})`);
if (!packageResponse.ok) throw new Error(`Package metadata lookup failed (${packageResponse.status})`);

const modules = await response.json() as Array<{
  bytecode?: string;
  abi?: { name?: string } | null;
}>;
const selected = modules
  .map((module) => ({ name: module.abi?.name ?? "", bytecode: module.bytecode ?? "" }))
  .filter((module) => requiredModules.includes(module.name))
  .sort((a, b) => a.name.localeCompare(b.name));
const expectedNames = [...requiredModules].sort();
if (
  selected.length !== expectedNames.length
  || selected.some((module, index) => !module.bytecode || module.name !== expectedNames[index])
) {
  throw new Error("The deployed package is missing an audited module");
}

const packageRegistry = await packageResponse.json() as {
  data?: {
    packages?: Array<{
      name?: unknown;
      upgrade_policy?: { policy?: unknown } | null;
      upgrade_number?: unknown;
      modules?: Array<{ name?: unknown }> | null;
    }>;
  };
};
const matchingPackages = (packageRegistry.data?.packages ?? [])
  .filter((candidate) => candidate.name === "cash_orderbook");
if (matchingPackages.length !== 1) throw new Error("The cash_orderbook package identity is ambiguous");
const packageMetadata = matchingPackages[0];
const packageModuleNames = (packageMetadata.modules ?? [])
  .map((module) => String(module.name ?? ""))
  .sort();
if (
  String(packageMetadata.upgrade_policy?.policy) !== "2"
  || String(packageMetadata.upgrade_number) !== "0"
  || JSON.stringify(packageModuleNames) !== JSON.stringify(expectedNames)
) {
  throw new Error("The deployment is not the immutable first-publish audited module set");
}

const localDirectory = resolve(localModulesDirectory);
const localNames = (await readdir(localDirectory))
  .filter((name) => name.endsWith(".mv"))
  .map((name) => name.slice(0, -3))
  .sort();
if (JSON.stringify(localNames) !== JSON.stringify(expectedNames)) {
  throw new Error("The local build does not contain exactly the audited production module set");
}
for (const deployed of selected) {
  const local = await readFile(resolve(localDirectory, `${deployed.name}.mv`));
  if (`0x${local.toString("hex")}`.toLowerCase() !== deployed.bytecode.toLowerCase()) {
    throw new Error(`Deployed ${deployed.name} bytecode does not match the approved local build`);
  }
}

const fingerprint = createHash("sha256")
  .update(selected.map((module) => `${module.name}:${module.bytecode}`).join("\n"))
  .digest("hex");

console.log(fingerprint);
