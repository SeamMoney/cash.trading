import { DecibelReadDex, NETNA_CONFIG } from "@decibel/sdk";

const read = new DecibelReadDex(NETNA_CONFIG);

// Your main wallet address
const mainWallet = "0xb08272acfe3148974e92d3fee0402309abc4efa95f641d33be6d49ceb76d19cd";

// Your subaccount address
const subaccount = "0xb9327b35f0acc8542559ac931f0c150a4be6a900cb914f1075758b1676665465";

// Check both
const overview = await read.accountOverview.getByAddr(mainWallet);
console.log("Main wallet overview:", JSON.stringify(overview, null, 2));

const subaccounts = await read.userSubaccounts.getByOwner(mainWallet);
console.log("Subaccounts:", JSON.stringify(subaccounts, null, 2));
