// Query the Decibel module ABI to find actual view functions
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";
// Example subaccount - not used in this query script
const subaccount = "0x<EXAMPLE_SUBACCOUNT_ADDRESS>";

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

async function getAccountResource(address, resourceType) {
  const url = `${APTOS_NODE}/accounts/${address}/resource/${resourceType}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching resource ${resourceType}:`, error.message);
    return null;
  }
}

// Check the GlobalAccountStates resource
console.log("=== GlobalAccountStates Resource ===");
const globalStates = await getAccountResource(
  DECIBEL_PACKAGE,
  `${DECIBEL_PACKAGE}::accounts_collateral::GlobalAccountStates`
);
if (globalStates) {
  console.log(JSON.stringify(globalStates, null, 2));
}

// Get module ABIs for key modules
const modules = [
  'accounts_collateral',
  'collateral_balance_sheet',
  'dex_accounts',
  'perp_positions'
];

for (const moduleName of modules) {
  console.log(`\n=== Module: ${moduleName} ===`);
  const module = await getAccountModule(DECIBEL_PACKAGE, moduleName);

  if (module && module.abi) {
    // Find view functions
    const viewFunctions = module.abi.exposed_functions.filter(f => f.is_view);
    console.log(`\nView Functions (${viewFunctions.length}):`);
    viewFunctions.forEach(f => {
      console.log(`  - ${f.name}`);
      console.log(`    Params: ${f.params.join(', ')}`);
      console.log(`    Type params: ${f.generic_type_params.length}`);
      console.log(`    Returns: ${JSON.stringify(f.return)}`);
    });
  }
}
