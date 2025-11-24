// Get actual balance from Decibel DEX
const APTOS_NODE = "https://api.testnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE = "0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75";

const mainWallet = "0xb08272acfe3148974e92d3fee0402309abc4efa95f641d33be6d49ceb76d19cd";
const subaccount = "0xb9327b35f0acc8542559ac931f0c150a4be6a900cb914f1075758b1676665465";

// Table handle for balances
const PRIMARY_BALANCE_TABLE = "0xc8a1388ac9979097370bda9b5931b901d3b1d5e0de8f33e50b5d02392f32506";

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
    console.error(`Error calling view function:`, error.message);
    return null;
  }
}

async function getTableItem(tableHandle, keyType, valueType, key) {
  const url = `${APTOS_NODE}/tables/${tableHandle}/item`;
  const payload = {
    key_type: keyType,
    value_type: valueType,
    key: key
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
      console.error(`Table lookup failed: ${errorText}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Error getting table item:`, error.message);
    return null;
  }
}

// Call the available_order_margin view function
console.log("=== Available Order Margin (Subaccount) ===");
const margin = await callViewFunction(
  `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
  [],
  [subaccount]
);
console.log("Result:", margin);
if (margin && margin[0]) {
  const marginValue = parseInt(margin[0]);
  console.log(`Margin (raw): ${marginValue}`);
  console.log(`Margin (USDC): $${(marginValue / 1000000).toFixed(2)}`);
}

// Try to read from the balance table
console.log("\n=== Reading from Primary Balance Table ===");

// The table maps addresses to balances
// Try different key formats
const keyFormats = [
  { type: "address", value: subaccount },
  { type: "0x1::object::Object<0x1f513904b7568445e3c291a6c58cb272db017d8a72aea563d5664666221d5f75::dex_accounts::Subaccount>", value: subaccount },
];

for (const keyFormat of keyFormats) {
  console.log(`\nTrying key type: ${keyFormat.type}`);
  const balance = await getTableItem(
    PRIMARY_BALANCE_TABLE,
    keyFormat.type,
    "u128", // Assuming balance is u128 based on the offset pattern
    keyFormat.value
  );

  if (balance) {
    console.log("Balance found:", balance);
  }
}

// Also check main wallet
console.log("\n=== Available Order Margin (Main Wallet) ===");
const mainMargin = await callViewFunction(
  `${DECIBEL_PACKAGE}::accounts_collateral::available_order_margin`,
  [],
  [mainWallet]
);
console.log("Result:", mainMargin);
