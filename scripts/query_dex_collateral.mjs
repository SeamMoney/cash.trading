// Query Decibel DEX collateral system
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";

// Decibel package address
const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

// Example addresses - replace with your own wallet and subaccount
const mainWallet = "0x<YOUR_WALLET_ADDRESS_HERE>";
const subaccount = "0x<YOUR_SUBACCOUNT_ADDRESS_HERE>";

// USDC metadata object address (from transaction)
const USDC_METADATA = "0x8bc4c7c2180b05fcc5ed7802c62cbcabdf2a2dfd7cb19f5fce8beb7cdfab01c2";

// Collateral store address (from transaction)
const COLLATERAL_STORE = "0x86aef2ef85b617efc54d6ecb16382e3c477801aef86efeb15b2ad7b3e949cc9b";

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

async function callViewFunction(functionName, typeArgs, args) {
  const url = `${APTOS_NODE}/view`;
  const payload = {
    function: functionName,
    type_arguments: typeArgs,
    arguments: args
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error calling view function ${functionName}:`, error.message);
    return null;
  }
}

// First, let's explore what resources are on the Decibel package address
console.log("=== Decibel Package Resources ===");
const packageResources = await getAccountResources(DECIBEL_PACKAGE);
if (packageResources) {
  console.log(`Found ${packageResources.length} resources on Decibel package`);
  packageResources.forEach(r => console.log(`  - ${r.type}`));
}

// Check the collateral store address
console.log("\n=== Collateral Store Resources ===");
const collateralResources = await getAccountResources(COLLATERAL_STORE);
if (collateralResources) {
  console.log(`Found ${collateralResources.length} resources`);
  collateralResources.forEach(resource => {
    console.log(JSON.stringify(resource, null, 2));
  });
}

// Check USDC metadata
console.log("\n=== USDC Metadata ===");
const usdcResources = await getAccountResources(USDC_METADATA);
if (usdcResources) {
  console.log(`Found ${usdcResources.length} resources`);
  usdcResources.forEach(r => console.log(`  - ${r.type}`));
}

// Try to call view functions - we need to guess the function names
console.log("\n=== Attempting View Function Calls ===");

// Common view function patterns
const viewFunctions = [
  `${DECIBEL_PACKAGE}::collateral_balance_sheet::get_balance`,
  `${DECIBEL_PACKAGE}::collateral_balance_sheet::get_cross_balance`,
  `${DECIBEL_PACKAGE}::collateral_balance_sheet::get_account_balance`,
  `${DECIBEL_PACKAGE}::dex_accounts::get_subaccount_balance`,
  `${DECIBEL_PACKAGE}::perp_positions::get_account_equity`,
];

for (const func of viewFunctions) {
  console.log(`\nTrying: ${func}`);
  // Try with subaccount address
  let result = await callViewFunction(func, [], [subaccount]);
  if (result) {
    console.log("Result:", JSON.stringify(result, null, 2));
  }

  // Also try with USDC metadata as type argument
  result = await callViewFunction(func, [USDC_METADATA], [subaccount]);
  if (result) {
    console.log("Result (with type arg):", JSON.stringify(result, null, 2));
  }
}
