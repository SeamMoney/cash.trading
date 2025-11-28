// Decibel API script
const API_BASE = "https://api.netna.aptoslabs.com/decibel";

// Example addresses - replace with your own wallet and subaccount
const mainWallet = "0x<YOUR_WALLET_ADDRESS_HERE>";

// Example subaccount address
const subaccount = "0x<YOUR_SUBACCOUNT_ADDRESS_HERE>";

async function getAccountOverview(user) {
  const url = `${API_BASE}/api/v1/account_overviews?user=${user}&include_performance=true&performance_lookback_days=90`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching account overview for ${user}:`, error.message);
    return null;
  }
}

async function checkAllEndpoints() {
  // Try different potential endpoints
  const endpoints = [
    `/api/v1/account_overviews?user=${mainWallet}`,
    `/api/v1/account_overviews?user=${subaccount}`,
  ];

  for (const endpoint of endpoints) {
    console.log(`\n=== Testing: ${endpoint} ===`);
    try {
      const response = await fetch(`${API_BASE}${endpoint}`);
      const data = await response.json();
      console.log(JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error:", error.message);
    }
  }
}

// Get main wallet overview
console.log("=== Main Wallet Overview ===");
const mainOverview = await getAccountOverview(mainWallet);
console.log(JSON.stringify(mainOverview, null, 2));

console.log("\n=== Subaccount Overview ===");
const subaccountOverview = await getAccountOverview(subaccount);
console.log(JSON.stringify(subaccountOverview, null, 2));

// Also check response headers and status
console.log("\n=== Checking API Response Details ===");
const testUrl = `${API_BASE}/api/v1/account_overviews?user=${subaccount}`;
console.log("URL:", testUrl);
const testResponse = await fetch(testUrl);
console.log("Status:", testResponse.status);
console.log("Headers:", Object.fromEntries(testResponse.headers.entries()));
