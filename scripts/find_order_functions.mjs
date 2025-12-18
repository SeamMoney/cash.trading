// Find order placement entry functions in Decibel
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

async function getAccountModule(address, moduleName) {
  const url = `${APTOS_NODE}/accounts/${address}/module/${moduleName}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching module ${moduleName}:`, error.message);
    return null;
  }
}

// Look for order-related modules
const orderModules = [
  'orders',
  'order_book',
  'place_order',
  'perp_orders',
  'dex_orders',
  'limit_orders',
  'market_orders'
];

console.log("=== Searching for Order Placement Functions ===\n");

for (const moduleName of orderModules) {
  const module = await getAccountModule(DECIBEL_PACKAGE, moduleName);

  if (module && module.abi) {
    console.log(`✅ Found module: ${moduleName}`);
    console.log(`\nEntry Functions:`);

    const entryFunctions = module.abi.exposed_functions.filter(f => f.is_entry);
    entryFunctions.forEach(f => {
      console.log(`\n  📝 ${f.name}`);
      console.log(`     Params: ${f.params.join(', ')}`);
      console.log(`     Type params: ${f.generic_type_params.map(p => p.constraints.join(', ')).join(' | ')}`);
      console.log(`     Visibility: ${f.visibility}`);
    });

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

// Also check dex_accounts for subaccount-based order placement
console.log("=== Checking dex_accounts Module ===\n");
const dexAccounts = await getAccountModule(DECIBEL_PACKAGE, 'dex_accounts');
if (dexAccounts && dexAccounts.abi) {
  const entryFunctions = dexAccounts.abi.exposed_functions.filter(f => f.is_entry);
  console.log(`Entry Functions (${entryFunctions.length}):`);
  entryFunctions.forEach(f => {
    if (f.name.toLowerCase().includes('order') || f.name.toLowerCase().includes('place')) {
      console.log(`\n  📝 ${f.name}`);
      console.log(`     Params: ${f.params.join(', ')}`);
      console.log(`     Type params: ${f.generic_type_params.map(p => p.constraints.join(', ')).join(' | ')}`);
    }
  });
}
