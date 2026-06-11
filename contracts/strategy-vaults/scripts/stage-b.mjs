// Stage B — drive the Decibel vault flow on testnet via @aptos-labs/ts-sdk.
// Usage: node scripts/stage-b.mjs <step>  where step ∈ {vault, bind, delegate, tick}
// Reads the deployer key from EXPOSED_TESTNET_KEY in ../../.env.
import { readFileSync } from "node:fs";
import {
  Aptos, AptosConfig, Network, Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants,
  MoveOption, U64,
} from "@aptos-labs/ts-sdk";

const DECIBEL = "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f";
const PKG     = "0x44bccd01a872341d7c74baf3497501ceb0b768a83a5ed9675799bfbac86e0ed3";
const SUB     = "0xef3b9ec507310d0edc12624868e77b11f683b8064c952561bb64e9237fce54d5";
const USDC    = "0xbdabb88aa9a875f3a2ebe0974e24f3ae5e57cfd17c6abdfef8a8111f43681b7e";
const MARKET  = "0x6e9c93c836abebdcf998a7defdd56cd067b6db50127db5d51b000ccfc483b90a"; // BTC/USD
const INDICATOR = "0xc3816b44937eb90860f5424f28d1506e58c9be5b582718ea95413cffb637d180";

const env = readFileSync(new URL("../../../.env", import.meta.url), "utf8");
const pick = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
const rawKey = pick("EXPOSED_TESTNET_KEY");
const apiKey = pick("GEOMI_API_KEY_TESTNET") || pick("APTOS_API_KEY_TESTNET");
const key = PrivateKey.formatPrivateKey(rawKey, PrivateKeyVariants.Ed25519);
const account = Account.fromPrivateKey({ privateKey: new Ed25519PrivateKey(key) });
const aptos = new Aptos(new AptosConfig({
  network: Network.TESTNET,
  ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
}));

async function run(fn, args) {
  const name = fn.split("::").slice(-1)[0];
  try {
    const txn = await aptos.transaction.build.simple({
      sender: account.accountAddress, data: { function: fn, functionArguments: args },
    });
    const sub = await aptos.signAndSubmitTransaction({ signer: account, transaction: txn });
    const res = await aptos.waitForTransaction({ transactionHash: sub.hash });
    console.log(name, "->", res.success ? "OK" : "FAIL", res.vm_status, sub.hash);
    return res;
  } catch (e) {
    console.log(name, "-> ERROR:", e?.transaction?.vm_status || e?.message?.split("\n")[0] || String(e).slice(0, 200));
    process.exit(1);
  }
}
function objWritten(res, typeSuffix) {
  for (const c of res.changes ?? [])
    if ((c.data?.type ?? "").endsWith(typeSuffix)) return c.address;
  return null;
}

const step = process.argv[2];
if (step === "vault") {
  const res = await run(`${DECIBEL}::vault_api::create_and_fund_vault`, [
    SUB, USDC, "SMA Strategy Vault", "Trustless SMA crossover vault enforced on-chain",
    [], "SMAV", "", "", "100", "2592000", "0", "100000000", true, false,
  ]);
  console.log("VAULT:", objWritten(res, "vault::Vault"));
} else if (step === "bind") {
  const vault = process.argv[3];
  const res = await run(`${PKG}::strategy_vault::create_strategy_vault`,
    [INDICATOR, vault, MARKET, "10"]);
  console.log("STRATEGY_VAULT:", objWritten(res, "strategy_vault::StrategyVault"));
} else if (step === "delegate") {
  const [vault, sv] = [process.argv[3], process.argv[4]];
  // expiry = Some(year 2096) — typed MoveOption avoids None simple-arg encoding issues.
  await run(`${DECIBEL}::vault_admin_api::delegate_dex_actions_to`,
    [vault, sv, new MoveOption(new U64(4000000000n))]);
} else if (step === "state") {
  const sv = process.argv[3];
  const view = (fn, args) => aptos.view({ payload: { function: fn, functionArguments: args } });
  const st = await view(`${PKG}::strategy_vault::get_state`, [sv]);
  console.log("STATE [ind,vault,size,in_position,is_long,paused,trades]:", JSON.stringify(st));
  const sig = await view(`${PKG}::indicator::get_signal_view`, [INDICATOR]);
  console.log("INDICATOR [signal,fast,slow,last,ts]:", JSON.stringify(sig));
} else if (step === "size") {
  await run(`${PKG}::strategy_vault::set_order_size`, [process.argv[3], process.argv[4]]);
} else if (step === "tick") {
  const sv = process.argv[3];
  // Marketable BTC price (~$95k, priceDecimals=6, multiple of tickSize=100000). Keeps indicator BUY.
  const res = await run(`${PKG}::strategy_vault::tick`, [sv, "95000000000", String(1781000200)]);
  for (const e of res.events ?? [])
    if (e.type.includes("VaultTraded") || e.type.includes("OrderPlaced") || e.type.toLowerCase().includes("order"))
      console.log("EVENT", e.type.split("::").slice(-1)[0], JSON.stringify(e.data).slice(0, 240));
} else {
  console.log("step must be one of: vault | bind <vault> | delegate <vault> <sv> | tick <sv>");
}
