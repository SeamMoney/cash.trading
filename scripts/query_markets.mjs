// Query available Decibel markets
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x9f830083a19fb8b87395983ca9edaea2b0379c97be6dfe234bb914e6c6672844";

async function callViewFunction(functionName, typeArgs, args) {
  const url = `${APTOS_NODE}/view`;
  const payload = {
    function: functionName,
    type_arguments: typeArgs,
    arguments: args,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error calling ${functionName}:`, error.message);
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

// Try to find market registry or list of markets
console.log("=== Searching for Market Resources ===\n");

// Common market addresses from Decibel docs
const knownMarkets = {
  "BTC-PERP": "0xc1a8bcaa4b8c548e415061b50888ac7ba02e6eda3bdfc9bd6bd4be3ed5e4a8c8",
  "ETH-PERP": "0x9c28c1f1c19c8697e3c8c0b4b18a27a6c6e0e9f8f0f2f8e8c0c0c0c0c0c0c0c0", // placeholder
};

for (const [name, address] of Object.entries(knownMarkets)) {
  console.log(`\n📊 Checking ${name} at ${address}`);

  // Try to get market resource
  const market = await getAccountResource(
    address,
    `${DECIBEL_PACKAGE}::perp_market::PerpMarket`
  );

  if (market) {
    console.log(`✅ Found market!`);
    console.log(JSON.stringify(market, null, 2));
  }
}

// Try to query market registry if it exists
console.log("\n\n=== Checking for Market Registry ===\n");
const registry = await getAccountResource(
  DECIBEL_PACKAGE,
  `${DECIBEL_PACKAGE}::perp_market::MarketRegistry`
);

if (registry) {
  console.log("✅ Found registry:");
  console.log(JSON.stringify(registry, null, 2));
} else {
  console.log("❌ No market registry resource found");
}

// Check if there's a view function to list markets
console.log("\n\n=== Trying to Query Market List View Function ===\n");
const markets = await callViewFunction(
  `${DECIBEL_PACKAGE}::perp_market::all_markets`,
  [],
  []
);

if (markets) {
  console.log("✅ Found markets:");
  console.log(JSON.stringify(markets, null, 2));
} else {
  console.log("❌ No all_markets view function");
}
