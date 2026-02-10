/**
 * useAutoFundApt - Automatically fund new users with APT for gas fees
 *
 * Detects when a user connects (any wallet type) and sends them APT
 * from a pre-funded account if they don't have any.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import {
  Aptos,
  AptosConfig,
  Network,
  Ed25519PrivateKey,
  Account,
  AccountAddress,
} from '@aptos-labs/ts-sdk';

// Funded account for sending APT to new users
// This account should have sufficient APT balance
const FUNDER_PRIVATE_KEY = import.meta.env.VITE_FUNDER_PRIVATE_KEY ||
  '0x6ceeeb36800665f36af48c88ecd8afdc4d34cfbe3793202b6313f6741866ab50';
const FUNDER_ADDRESS = '0x20a30d83eec219a31e4d4a6aec1787bbaab089c99a8d263df03147782a0d490c';

// Amount to send to new users (0.1 APT = 10_000_000 octas)
const FUNDING_AMOUNT = 10_000_000; // 0.1 APT - enough for many transactions

// Minimum balance before we consider funding (0.01 APT)
const MIN_BALANCE_THRESHOLD = 1_000_000;

// LocalStorage key for tracking funded addresses
const FUNDED_ADDRESSES_KEY = 'aptos_funded_addresses';

// Create Aptos client
const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));

// Create funder account from private key
function getFunderAccount(): Account {
  const privateKey = new Ed25519PrivateKey(FUNDER_PRIVATE_KEY);
  return Account.fromPrivateKey({ privateKey });
}

// Check if address has been funded before (localStorage)
function hasBeenFunded(address: string): boolean {
  try {
    const funded = localStorage.getItem(FUNDED_ADDRESSES_KEY);
    if (!funded) return false;
    const addresses: string[] = JSON.parse(funded);
    return addresses.includes(address.toLowerCase());
  } catch {
    return false;
  }
}

// Mark address as funded (localStorage)
function markAsFunded(address: string): void {
  try {
    const funded = localStorage.getItem(FUNDED_ADDRESSES_KEY);
    const addresses: string[] = funded ? JSON.parse(funded) : [];
    if (!addresses.includes(address.toLowerCase())) {
      addresses.push(address.toLowerCase());
      // Keep only last 1000 addresses to prevent localStorage overflow
      const trimmed = addresses.slice(-1000);
      localStorage.setItem(FUNDED_ADDRESSES_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // localStorage error - ignore
  }
}

// Check APT balance
async function getAptBalance(address: string): Promise<number> {
  try {
    const resources = await aptos.getAccountResource({
      accountAddress: address,
      resourceType: '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>',
    });
    return Number((resources as { coin: { value: string } }).coin.value);
  } catch {
    // Account doesn't exist or has no APT
    return 0;
  }
}

// Send APT from funder account to recipient
async function sendApt(recipientAddress: string, amount: number): Promise<boolean> {
  try {
    const funder = getFunderAccount();

    console.log(`[AutoFund] Sending ${amount / 100_000_000} APT to ${recipientAddress}`);
    console.log(`[AutoFund] From funder: ${funder.accountAddress.toString()}`);

    // Build and submit transaction
    const transaction = await aptos.transaction.build.simple({
      sender: funder.accountAddress,
      data: {
        function: '0x1::aptos_account::transfer',
        functionArguments: [AccountAddress.from(recipientAddress), amount],
      },
    });

    const pendingTx = await aptos.signAndSubmitTransaction({
      signer: funder,
      transaction,
    });

    // Wait for confirmation
    const result = await aptos.waitForTransaction({
      transactionHash: pendingTx.hash,
    });

    if (result.success) {
      console.log(`[AutoFund] Successfully sent APT. Tx: ${pendingTx.hash}`);
      return true;
    } else {
      console.error('[AutoFund] Transaction failed:', result);
      return false;
    }
  } catch (error) {
    console.error('[AutoFund] Error sending APT:', error);
    return false;
  }
}

/**
 * Hook to automatically fund connected wallets with APT
 */
export function useAutoFundApt() {
  const { connected, account } = useWallet();
  const fundingInProgressRef = useRef<string | null>(null);
  const lastFundedRef = useRef<string | null>(null);

  const checkAndFund = useCallback(async (address: string) => {
    // Skip if already funding this address
    if (fundingInProgressRef.current === address) {
      return;
    }

    // Skip if we just funded this address (prevent rapid re-triggers)
    if (lastFundedRef.current === address) {
      return;
    }

    // Skip funder's own address
    if (address.toLowerCase() === FUNDER_ADDRESS.toLowerCase()) {
      console.log('[AutoFund] Skipping funder account');
      return;
    }

    fundingInProgressRef.current = address;

    try {
      // Check if already funded via localStorage (quick check)
      if (hasBeenFunded(address)) {
        console.log('[AutoFund] Address already funded (localStorage):', address.slice(0, 10));
        fundingInProgressRef.current = null;
        return;
      }

      // Check actual APT balance
      const balance = await getAptBalance(address);
      console.log(`[AutoFund] APT balance for ${address.slice(0, 10)}...: ${balance / 100_000_000} APT`);

      // If balance is sufficient, mark as funded and skip
      if (balance >= MIN_BALANCE_THRESHOLD) {
        console.log('[AutoFund] Balance sufficient, marking as funded');
        markAsFunded(address);
        fundingInProgressRef.current = null;
        return;
      }

      // Need to fund - send APT
      console.log('[AutoFund] Funding new user with APT...');
      const success = await sendApt(address, FUNDING_AMOUNT);

      if (success) {
        markAsFunded(address);
        lastFundedRef.current = address;

        // Dispatch event so UI can show notification
        window.dispatchEvent(new CustomEvent('apt-funded', {
          detail: { address, amount: FUNDING_AMOUNT / 100_000_000 }
        }));
      }
    } catch (error) {
      console.error('[AutoFund] Error in checkAndFund:', error);
    } finally {
      fundingInProgressRef.current = null;
    }
  }, []);

  // Trigger funding check when wallet connects
  useEffect(() => {
    if (connected && account?.address) {
      const address = account.address.toString();
      console.log('[AutoFund] Wallet connected, checking funding:', address.slice(0, 10));

      // Small delay to let wallet fully initialize
      const timer = setTimeout(() => {
        checkAndFund(address);
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [connected, account?.address, checkAndFund]);

  return {
    checkAndFund,
  };
}

/**
 * Manually trigger APT funding for an address
 * Can be called from components that need to ensure user has gas
 */
export async function ensureAptForGas(address: string): Promise<boolean> {
  // Skip funder's own address
  if (address.toLowerCase() === FUNDER_ADDRESS.toLowerCase()) {
    return true;
  }

  try {
    const balance = await getAptBalance(address);

    if (balance >= MIN_BALANCE_THRESHOLD) {
      return true;
    }

    // Check localStorage - if funded before but balance is 0, might need more
    // (user spent all their APT)
    console.log('[ensureAptForGas] Low balance, sending APT...');
    return await sendApt(address, FUNDING_AMOUNT);
  } catch (error) {
    console.error('[ensureAptForGas] Error:', error);
    return false;
  }
}
