// Query Aptos blockchain directly for account resources
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";

// Example addresses - replace with your own wallet and subaccount
const mainWallet = "0x<YOUR_WALLET_ADDRESS_HERE>";
const subaccount = "0x<YOUR_SUBACCOUNT_ADDRESS_HERE>";

async function getAccountResources(address) {
  const url = `${APTOS_NODE}/accounts/${address}/resources`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching resources for ${address}:`, error.message);
    return null;
  }
}

async function getAccount(address) {
  const url = `${APTOS_NODE}/accounts/${address}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching account ${address}:`, error.message);
    return null;
  }
}

console.log("=== Main Wallet Account Info ===");
const mainAccount = await getAccount(mainWallet);
console.log(JSON.stringify(mainAccount, null, 2));

console.log("\n=== Main Wallet Resources ===");
const mainResources = await getAccountResources(mainWallet);
console.log(`Found ${mainResources?.length || 0} resources`);
if (mainResources) {
  // Print resource types
  console.log("\nResource types:");
  mainResources.forEach(r => console.log(`  - ${r.type}`));

  // Look for USDC or balance related resources
  console.log("\n=== Fungible Asset Stores ===");
  const fungibleStores = mainResources.filter(r => r.type.includes("fungible_asset"));
  fungibleStores.forEach(store => {
    console.log(JSON.stringify(store, null, 2));
  });
}

console.log("\n\n=== Subaccount Account Info ===");
const subAccount = await getAccount(subaccount);
console.log(JSON.stringify(subAccount, null, 2));

console.log("\n=== Subaccount Resources ===");
const subResources = await getAccountResources(subaccount);
console.log(`Found ${subResources?.length || 0} resources`);
if (subResources) {
  console.log("\nResource types:");
  subResources.forEach(r => console.log(`  - ${r.type}`));

  // Print all resources for subaccount to see what's there
  console.log("\n=== All Subaccount Resources ===");
  subResources.forEach(resource => {
    console.log(JSON.stringify(resource, null, 2));
  });
}
