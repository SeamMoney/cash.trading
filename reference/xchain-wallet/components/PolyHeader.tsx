import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { ChevronDown, LogOut, Copy, Check, Loader2, RefreshCw } from "lucide-react";
import { WalletSelector, getWalletIcon } from "../components/WalletSelector";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { useAutoFundApt, ensureAptForGas } from "../hooks/useAutoFundApt";

// Polymarket P logo without background (white version)
function PolymarketLogo() {
  return (
    <svg width="42" height="42" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
      <path d="M375.84 389.422C375.84 403.572 375.84 410.647 371.212 414.154C366.585 417.662 359.773 415.75 346.15 411.927L127.22 350.493C119.012 348.19 114.907 347.038 112.534 343.907C110.161 340.776 110.161 336.513 110.161 327.988V184.012C110.161 175.487 110.161 171.224 112.534 168.093C114.907 164.962 119.012 163.81 127.22 161.507L346.15 100.072C359.773 96.2495 366.585 94.338 371.212 97.8455C375.84 101.353 375.84 108.428 375.84 122.578V389.422ZM164.761 330.463L346.035 381.337V279.595L164.761 330.463ZM139.963 306.862L321.201 256L139.963 205.138V306.862ZM164.759 181.537L346.035 232.406V130.663L164.759 181.537Z" fill="white"/>
    </svg>
  );
}

// Aptos logo with Polymarket blue ring
function AptosKeylessIcon() {
  return (
    <div className="relative w-6 h-6">
      {/* Blue ring - thinner, matching sign up button color */}
      <div className="absolute inset-0 rounded-full border border-[#289cdd]" />
      {/* Official Aptos logo centered - slightly bigger */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 600 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <path d="M30.6608 171.033C18.0837 197.498 9.30164 226.119 5 256.181H255.339L309.999 171.033H30.6608Z" fill="white"/>
        <path d="M594.999 256.182C590.687 226.111 581.915 197.499 569.338 171.034H419.288L364.648 85.8753H508.549C454.803 33.2026 381.199 0.716797 299.994 0.716797C218.79 0.716797 145.195 33.2026 91.4395 85.8653H364.648L309.988 171.024L364.648 256.172H594.989L594.999 256.182Z" fill="white"/>
        <path d="M146.04 426.5L91.3809 511.648C145.136 564.311 218.601 597.284 299.805 597.284C381.01 597.284 455.718 565.99 509.672 511.648H200.7L146.04 426.5Z" fill="white"/>
        <path d="M200.68 341.331H5C9.31157 371.412 18.0837 400.024 30.6608 426.489H146.04L200.68 341.331Z" fill="white"/>
        <path d="M255.339 426.499H569.339C581.916 400.034 590.698 371.413 595 341.351H309.999L255.339 256.192L200.68 341.341" fill="white"/>
      </svg>
    </div>
  );
}

// USD1 Contract addresses - use env vars to match deployed contracts
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "0x1bd17a9cb5a55a414de956128e332f7744ef260bbdc49303a08105c986adbda3";
const USD1_METADATA = import.meta.env.VITE_USD1_METADATA || "0xa89bf8c3480600cf0b30914b3370fed8ebfd7a638df6a6edee0e45b2a1dfff82";
const FUND_AMOUNT_USD1 = 1000; // $1000 worth of USD1 (8 decimals)

// ensureAptForGas is now imported from useAutoFundApt hook

export function PolyHeader() {
  const navigate = useNavigate();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showWalletSelector, setShowWalletSelector] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [fundStatus, setFundStatus] = useState<"idle" | "funding_apt" | "minting" | "success" | "error">("idle");
  const [balance, setBalance] = useState<number>(0);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  // Use Aptos wallet adapter
  const { account, connected, disconnect, wallet, signAndSubmitTransaction } = useWallet();

  // Auto-fund APT for new users (runs on wallet connect)
  useAutoFundApt();

  // Check if connected via X-Chain (derived wallet from EVM/Solana)
  const isXChainWallet = wallet?.name?.toLowerCase().includes('ethereum') ||
                          wallet?.name?.toLowerCase().includes('metamask') ||
                          wallet?.name?.toLowerCase().includes('phantom') ||
                          wallet?.name?.toLowerCase().includes('solana');

  // Check if connected via Aptos Keyless (Google/Apple social login)
  const isKeylessWallet = wallet?.name?.toLowerCase().includes('google') ||
                          wallet?.name?.toLowerCase().includes('apple') ||
                          wallet?.url?.includes('web.petra.app');

  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Determine which icon to show based on login method
  const isGoogleLogin = wallet?.name?.toLowerCase().includes('google');
  const isAppleLogin = wallet?.name?.toLowerCase().includes('apple');

  const walletDisplayName = isGoogleLogin
    ? 'Aptos'
    : isAppleLogin
    ? 'Aptos'
    : isKeylessWallet
    ? 'Aptos'
    : wallet?.name?.replace(' (Solana)', '').replace(' (Ethereum)', '') || 'Wallet';

  // Fetch USD1 balance from fungible asset
  const fetchBalance = useCallback(async () => {
    if (!connected || !account?.address) {
      setBalance(0);
      return;
    }
    try {
      setIsRefreshingBalance(true);
      const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
      const address = account.address.toString();

      // Fetch USD1 fungible asset balance
      try {
        const balances = await aptos.getCurrentFungibleAssetBalances({
          options: {
            where: {
              owner_address: { _eq: address },
              asset_type: { _eq: USD1_METADATA },
            },
          },
        });

        if (balances.length > 0 && balances[0].amount) {
          // USD1 has 8 decimals
          setBalance(Number(balances[0].amount) / 100_000_000);
          return;
        }
      } catch (err) {
        console.log("Fungible asset query failed, trying view function:", err);
      }

      // Fallback: call view function directly
      try {
        const result = await aptos.view({
          payload: {
            function: `${CONTRACT_ADDRESS}::usd1::balance`,
            functionArguments: [address],
          },
        });
        if (result && result[0]) {
          setBalance(Number(result[0]) / 100_000_000);
          return;
        }
      } catch {
        // No USD1 balance
      }

      setBalance(0);
    } catch (error) {
      console.error("Error fetching USD1 balance:", error);
      setBalance(0);
    } finally {
      setIsRefreshingBalance(false);
    }
  }, [connected, account?.address]);

  // Fetch balance on connect and when dropdown opens
  useEffect(() => {
    if (connected && account?.address) {
      fetchBalance();
    }
  }, [connected, account?.address, fetchBalance]);

  // Refresh balance when dropdown opens
  useEffect(() => {
    if (showDropdown && connected) {
      fetchBalance();
    }
  }, [showDropdown, connected, fetchBalance]);

  // Listen for wallet-funded event to refresh balance
  useEffect(() => {
    const handleWalletFunded = () => {
      fetchBalance();
    };
    window.addEventListener('wallet-funded', handleWalletFunded);
    return () => window.removeEventListener('wallet-funded', handleWalletFunded);
  }, [fetchBalance]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogin = () => {
    setShowWalletSelector(true);
  };

  const handleLogout = () => {
    disconnect();
    setShowDropdown(false);
  };

  const copyAddress = () => {
    if (account?.address) {
      navigator.clipboard.writeText(account.address.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Mint USD1 tokens to user's wallet (open minting for demo)
  const handleFundWallet = async () => {
    if (!account?.address || isFunding) return;

    setIsFunding(true);
    setFundStatus("idle");

    try {
      const aptos = new Aptos(new AptosConfig({ network: Network.TESTNET }));
      const address = account.address.toString();

      // USD1 has 8 decimals, mint 1000 USD1
      const amountUnits = Math.floor(FUND_AMOUNT_USD1 * 100_000_000);

      // Check if this is an X-Chain wallet (needs gas funding from faucet)
      // X-Chain wallets derive Aptos addresses from Ethereum/Solana keys via AIP-113
      const walletNameLower = wallet?.name?.toLowerCase() || '';
      const isXChain = walletNameLower.includes('ethereum') ||
                       walletNameLower.includes('solana') ||
                       walletNameLower.includes('metamask') ||
                       walletNameLower.includes('phantom') ||
                       walletNameLower.includes('backpack') ||
                       walletNameLower.includes('rainbow') ||
                       walletNameLower.includes('coinbase') ||
                       walletNameLower.includes('trust') ||
                       // Also detect by the X-CHAIN badge presence (all non-native Aptos wallets)
                       (account?.ansName === undefined && !walletNameLower.includes('petra') &&
                        !walletNameLower.includes('martian') && !walletNameLower.includes('pontem') &&
                        !walletNameLower.includes('fewcha') && !walletNameLower.includes('rise'));

      console.log("[USD1 Mint] Starting mint for address:", address);
      console.log("[USD1 Mint] Amount units:", amountUnits);
      console.log("[USD1 Mint] Wallet type:", wallet?.name);
      console.log("[USD1 Mint] Is X-Chain:", isXChain);

      // Check if mobile Safari - we must call signAndSubmitTransaction IMMEDIATELY
      // after user click, or Safari blocks the popup
      const isMobileSafari = /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
                             /Safari/i.test(navigator.userAgent) &&
                             !/CriOS|FxiOS/i.test(navigator.userAgent);

      // For X-Chain wallets, ensure they have APT for gas fees
      // BUT skip this on mobile Safari to preserve the direct click chain
      if (isXChain && !isMobileSafari) {
        console.log("[USD1 Mint] X-Chain wallet detected, checking APT for gas...");
        setFundStatus("funding_apt");
        const hasGas = await ensureAptForGas(address);
        if (!hasGas) {
          console.error("[USD1 Mint] Failed to ensure APT for gas");
          // Continue anyway - the transaction will fail with a clear error
        }
      }

      // Now mint USD1 - MUST be called immediately after click on mobile Safari
      setFundStatus("minting");

      // Call mint_to_self - anyone can mint in demo mode
      const response = await signAndSubmitTransaction({
        data: {
          function: `${CONTRACT_ADDRESS}::usd1::mint_to_self`,
          functionArguments: [amountUnits],
        },
      });

      console.log("[USD1 Mint] Transaction submitted, hash:", response.hash);

      // Wait for transaction confirmation
      const result = await aptos.waitForTransaction({
        transactionHash: response.hash,
      });

      console.log("[USD1 Mint] Transaction result:", result.success, result);

      if (result.success) {
        setFundStatus("success");
        // Dispatch event for portfolio page to refresh balance
        window.dispatchEvent(new CustomEvent('wallet-funded', { detail: { amount: FUND_AMOUNT_USD1 } }));
        // Refresh balance after successful mint
        setTimeout(() => {
          fetchBalance();
          setFundStatus("idle");
        }, 2000);
      } else {
        console.error("[USD1 Mint] Transaction failed on-chain:", result);
        setFundStatus("error");
        setTimeout(() => setFundStatus("idle"), 3000);
      }
    } catch (error) {
      // Enhanced error logging for X-Chain debugging
      console.error("[USD1 Mint] Error details:", {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        walletName: wallet?.name,
        accountAddress: account?.address?.toString(),
      });

      // Check for specific X-Chain errors
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('rejected') || errorMsg.includes('cancelled') || errorMsg.includes('denied')) {
        console.log("[USD1 Mint] User rejected the transaction");
      } else if (errorMsg.includes('insufficient') || errorMsg.includes('gas')) {
        console.log("[USD1 Mint] Gas/fee issue - X-Chain wallets need APT for gas on Aptos");
      }

      setFundStatus("error");
      setTimeout(() => setFundStatus("idle"), 3000);
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <header
      className="sticky top-0 z-[60] px-4 py-2 flex items-center justify-between"
      style={{
        backgroundColor: '#1c2b3a',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)'
      }}
    >
        {/* Logo */}
        <button
          onClick={() => navigate("/polymarket")}
          className="flex items-center hover:opacity-90 transition-opacity"
      >
        <PolymarketLogo />
        <span className="text-white tracking-tight" style={{ fontSize: '20px', fontWeight: 700, fontFamily: '"Open Sauce One", sans-serif' }}>
          Polymarket
        </span>
      </button>

      {/* Auth buttons or logged-in state */}
      {connected && account ? (
        <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#2a3d4e] hover:bg-[#3a4f60] transition-colors"
            >
            {/* Wallet icon - Aptos logo with blue ring for keyless */}
            {isKeylessWallet ? (
              <AptosKeylessIcon />
            ) : (
              getWalletIcon(wallet?.name || '', wallet?.icon) ? (
                <img src={getWalletIcon(wallet?.name || '', wallet?.icon)} alt={walletDisplayName} className="w-6 h-6 rounded-lg" />
              ) : (
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-green-500" />
              )
            )}
            {/* Address */}
            <span className="text-white text-sm font-medium">
              {formatAddress(account.address.toString())}
            </span>
            {/* X-Chain Badge only */}
            {isXChainWallet && (
              <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-semibold rounded">
                X-CHAIN
              </span>
            )}
            <ChevronDown
              size={16}
              className={`text-[#8297a3] transition-transform ${showDropdown ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Clean Dropdown Menu */}
          {showDropdown && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-[#1c2b3a] border border-[#3a4f60] rounded-xl shadow-2xl overflow-hidden z-50">
              {/* Wallet Info */}
              <div className="p-4 border-b border-[#3a4f60]">
                <div className="flex items-center gap-3 mb-3">
                  {isKeylessWallet ? (
                    <div className="w-10 h-10 flex items-center justify-center">
                      <div className="relative w-10 h-10">
                        <div className="absolute inset-0 rounded-full border-2 border-[#289cdd]" />
                        <svg
                          width="26"
                          height="26"
                          viewBox="0 0 600 600"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                        >
                          <path d="M30.6608 171.033C18.0837 197.498 9.30164 226.119 5 256.181H255.339L309.999 171.033H30.6608Z" fill="white"/>
                          <path d="M594.999 256.182C590.687 226.111 581.915 197.499 569.338 171.034H419.288L364.648 85.8753H508.549C454.803 33.2026 381.199 0.716797 299.994 0.716797C218.79 0.716797 145.195 33.2026 91.4395 85.8653H364.648L309.988 171.024L364.648 256.172H594.989L594.999 256.182Z" fill="white"/>
                          <path d="M146.04 426.5L91.3809 511.648C145.136 564.311 218.601 597.284 299.805 597.284C381.01 597.284 455.718 565.99 509.672 511.648H200.7L146.04 426.5Z" fill="white"/>
                          <path d="M200.68 341.331H5C9.31157 371.412 18.0837 400.024 30.6608 426.489H146.04L200.68 341.331Z" fill="white"/>
                          <path d="M255.339 426.499H569.339C581.916 400.034 590.698 371.413 595 341.351H309.999L255.339 256.192L200.68 341.341" fill="white"/>
                        </svg>
                      </div>
                    </div>
                  ) : (
                    getWalletIcon(wallet?.name || '', wallet?.icon) ? (
                      <img src={getWalletIcon(wallet?.name || '', wallet?.icon)} alt={walletDisplayName} className="w-10 h-10 rounded-xl" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-green-500" />
                    )
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-semibold">{walletDisplayName}</span>
                      {isXChainWallet && (
                        <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-semibold rounded">
                          X-CHAIN
                        </span>
                      )}
                    </div>
                    <button
                      onClick={copyAddress}
                      className="flex items-center gap-1 text-[#8297a3] text-xs font-mono hover:text-white transition-colors"
                    >
                      {formatAddress(account.address.toString())}
                      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                </div>

                {/* Keyless Info */}
                {isKeylessWallet && (
                  <div className="p-2.5 bg-[#3b82f6]/10 border border-[#3b82f6]/30 rounded-lg mb-3">
                    <div className="text-[#60a5fa] text-xs">
                      Aptos Keyless via {wallet?.name?.includes('Google') ? 'Google' : 'Apple'}
                    </div>
                  </div>
                )}

                {/* X-Chain Info */}
                {isXChainWallet && (
                  <div className="p-2.5 bg-orange-500/10 border border-orange-500/30 rounded-lg mb-3">
                    <div className="text-orange-400 text-xs">
                      Connected via X-Chain (AIP-113)
                    </div>
                  </div>
                )}

                {/* Balance Display */}
                <div className="p-3 bg-[#0d1a24] rounded-lg mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* USD1 Logo */}
                      <img
                        src="/usd1.png"
                        alt="USD1"
                        className="w-10 h-10 rounded-full"
                      />
                      <div>
                        <p className="text-[#8297a3] text-xs mb-0.5">USD1 Balance</p>
                        <p className="text-white text-2xl font-bold">
                          ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchBalance();
                      }}
                      className="p-2 rounded-lg hover:bg-[#2a3d4e] transition-colors"
                      title="Refresh balance"
                    >
                      <RefreshCw
                        size={16}
                        className={`text-[#8297a3] ${isRefreshingBalance ? 'animate-spin' : ''}`}
                      />
                    </button>
                  </div>
                </div>

                {/* Fund Button */}
                <button
                  onClick={handleFundWallet}
                  disabled={isFunding}
                  className={`flex items-center justify-center gap-2 w-full py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
                    fundStatus === "success"
                      ? "bg-green-600"
                      : fundStatus === "error"
                      ? "bg-red-600"
                      : isFunding
                      ? "bg-[#3b82f6]/50 cursor-not-allowed"
                      : "bg-[#3b82f6] hover:bg-[#2563eb]"
                  }`}
                >
                  {isFunding ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : fundStatus === "success" ? (
                    <Check size={16} />
                  ) : null}
                  {fundStatus === "success"
                    ? "+$1,000 USD1 Minted!"
                    : fundStatus === "error"
                    ? "Failed - Try Again"
                    : fundStatus === "funding_apt"
                    ? "Funding APT for gas..."
                    : fundStatus === "minting"
                    ? "Minting USD1..."
                    : isFunding
                    ? "Preparing..."
                    : "Mint $1,000"}
                </button>
              </div>

              {/* Disconnect */}
              <div className="p-2">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={18} />
                  <span className="font-medium">Disconnect</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogin}
            className="hover:opacity-80 transition-colors"
            style={{ color: '#2c9cdb', fontSize: '14px', fontWeight: 500, padding: '8px 16px', fontFamily: '"Open Sauce One", sans-serif' }}
          >
            Log In
          </button>
          <button
            onClick={handleLogin}
            className="hover:opacity-90 transition-colors text-white"
            style={{ backgroundColor: '#2c9cdb', borderRadius: '5.6px', padding: '8px 16px', fontSize: '14px', fontWeight: 500, fontFamily: '"Open Sauce One", sans-serif' }}
          >
            Sign Up
          </button>
        </div>
      )}

      {/* Wallet Selector Modal */}
      <WalletSelector
        isOpen={showWalletSelector}
        onClose={() => setShowWalletSelector(false)}
      />
    </header>
  );
}

// Export for use in other components
export { PolymarketLogo };
