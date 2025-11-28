import { DecibelReadDex, NETNA_CONFIG } from "@decibel/sdk";

const read = new DecibelReadDex(NETNA_CONFIG);

// Example addresses - replace with your own wallet and subaccount
const mainWallet = "0x<YOUR_WALLET_ADDRESS_HERE>";

// Example subaccount address
const subaccount = "0x<YOUR_SUBACCOUNT_ADDRESS_HERE>";

// Check both
const overview = await read.accountOverview.getByAddr(mainWallet);
console.log("Main wallet overview:", JSON.stringify(overview, null, 2));

const subaccounts = await read.userSubaccounts.getByOwner(mainWallet);
console.log("Subaccounts:", JSON.stringify(subaccounts, null, 2));
