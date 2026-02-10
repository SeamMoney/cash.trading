import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { X, Loader2, AlertCircle } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";

// Polymarket Logo SVG
function PolymarketLogo() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 12C0 5.37258 5.37258 0 12 0H36C42.6274 0 48 5.37258 48 12V36C48 42.6274 42.6274 48 36 48H12C5.37258 48 0 42.6274 0 36V12Z" fill="#0060FF" />
      <path fillRule="evenodd" clipRule="evenodd" d="M34.6148 9.94128V38.0587L11.8853 31.2882V16.7118L34.6148 9.94128ZM13.8921 18.8288V29.1712L30.2773 24L13.8921 18.8288ZM32.6079 25.3689L16.3106 30.5124L32.6079 35.3669V25.3689ZM32.6079 22.6311L16.3106 17.4876L32.6079 12.6331V22.6311Z" fill="white" />
    </svg>
  );
}

// Wallet button component
function WalletButton({
  children,
  onClick,
  label,
  sublabel,
  isXChain,
  isLoading,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label?: string;
  sublabel?: string;
  isXChain?: boolean;
  isLoading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className="flex items-center gap-3 w-full p-3 rounded-xl border border-[#3a4f60] bg-[#2a3d4e] hover:bg-[#3a4f60] hover:border-[#4a5f70] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="w-10 h-10 flex items-center justify-center shrink-0">{children}</div>
      <div className="flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-white font-medium">{label}</span>
          {isXChain && (
            <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-semibold rounded-full">
              X-CHAIN
            </span>
          )}
        </div>
        {sublabel && <span className="text-[#6b7a8a] text-xs">{sublabel}</span>}
      </div>
      {isLoading && <Loader2 size={18} className="text-[#60a5fa] animate-spin" />}
    </button>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const { connected, connect, wallets } = useWallet();
  const [connecting, setConnecting] = useState(false);

  // Redirect if already connected
  useEffect(() => {
    if (connected) {
      navigate("/polymarket");
    }
  }, [connected, navigate]);

  const handleWalletConnect = async (walletName: string) => {
    try {
      setConnecting(true);
      await connect(walletName);
      // Navigation will happen via the useEffect above when connected becomes true
    } catch (error) {
      console.error(`Failed to connect ${walletName}:`, error);
    } finally {
      setConnecting(false);
    }
  };

  const handleClose = () => {
    navigate(-1);
  };

  // Filter wallets by installed status
  const installedWallets = wallets?.filter(w => w.readyState === 'Installed') || [];
  const notInstalledWallets = wallets?.filter(w => w.readyState !== 'Installed') || [];

  // Check if wallet is X-Chain (EVM/Solana)
  const isXChainWallet = (name: string) => {
    const lowerName = name.toLowerCase();
    return lowerName.includes('ethereum') ||
           lowerName.includes('metamask') ||
           lowerName.includes('phantom') ||
           lowerName.includes('solana');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="min-h-screen bg-[#1c2b3a] flex flex-col"
    >
      {/* Close button */}
      <div className="p-4">
        <button
          onClick={handleClose}
          className="p-2 -ml-2 hover:opacity-70 transition-opacity"
        >
          <X size={24} color="#8B949E" strokeWidth={2.5} />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center w-full gap-6">
            {/* Logo and title */}
            <div className="flex flex-col items-center gap-4">
              <PolymarketLogo />
              <div className="text-center">
                <h1 className="font-semibold text-xl text-white mb-2">
                  Connect to Polymarket
                </h1>
                <p className="text-[#8297a3] text-sm">
                  Connect your wallet to start trading on Aptos
                </p>
              </div>
            </div>

            {/* X-Chain Info Banner */}
            <div className="w-full p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
                  <span className="text-lg">🔗</span>
                </div>
                <div>
                  <div className="text-orange-400 text-sm font-semibold mb-1">
                    X-Chain Accounts Supported
                  </div>
                  <div className="text-[#8297a3] text-xs leading-relaxed">
                    Use your existing MetaMask or Phantom wallet to connect to Aptos. No bridging or new wallet setup needed!
                  </div>
                </div>
              </div>
            </div>

            {/* Installed Wallets */}
            {installedWallets.length > 0 ? (
              <div className="w-full space-y-3">
                <div className="text-[#6b7a8a] text-xs font-medium uppercase tracking-wider px-1">
                  Available Wallets
                </div>
                {installedWallets.map((wallet) => (
                  <WalletButton
                    key={wallet.name}
                    onClick={() => handleWalletConnect(wallet.name)}
                    label={wallet.name}
                    sublabel={isXChainWallet(wallet.name) ? "Connect via Aptos X-Chain" : "Native Aptos wallet"}
                    isXChain={isXChainWallet(wallet.name)}
                    isLoading={connecting}
                  >
                    {wallet.icon ? (
                      <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded-lg" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-[#3a4f60] flex items-center justify-center">
                        <span className="text-white text-sm font-bold">{wallet.name[0]}</span>
                      </div>
                    )}
                  </WalletButton>
                ))}
              </div>
            ) : (
              <div className="w-full p-4 bg-[#2a3d4e] border border-[#3a4f60] rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <AlertCircle size={20} className="text-[#f59e0b]" />
                  <span className="text-white font-medium">No Wallets Detected</span>
                </div>
                <p className="text-[#8297a3] text-sm mb-4">
                  Install a wallet extension to continue. We recommend:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href="https://petra.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 bg-[#1c2b3a] rounded-lg hover:bg-[#3a4f60] transition-colors"
                  >
                    <img src="https://petra.app/favicon.ico" alt="Petra" className="w-5 h-5" />
                    <span className="text-white text-sm">Petra</span>
                  </a>
                  <a
                    href="https://metamask.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 bg-[#1c2b3a] rounded-lg hover:bg-[#3a4f60] transition-colors"
                  >
                    <img src="https://metamask.io/favicon.ico" alt="MetaMask" className="w-5 h-5" />
                    <span className="text-white text-sm">MetaMask</span>
                  </a>
                </div>
              </div>
            )}

            {/* Other Wallets (not installed) */}
            {notInstalledWallets.length > 0 && installedWallets.length > 0 && (
              <div className="w-full">
                <details className="group">
                  <summary className="flex items-center justify-between cursor-pointer text-[#6b7a8a] text-xs font-medium uppercase tracking-wider px-1 py-2 hover:text-[#8297a3]">
                    <span>More Wallets</span>
                    <svg className="w-4 h-4 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {notInstalledWallets.slice(0, 6).map((wallet) => (
                      <WalletButton
                        key={wallet.name}
                        onClick={() => handleWalletConnect(wallet.name)}
                        label={wallet.name}
                        sublabel="Not installed"
                        isXChain={isXChainWallet(wallet.name)}
                        disabled
                      >
                        {wallet.icon ? (
                          <img src={wallet.icon} alt={wallet.name} className="w-8 h-8 rounded-lg opacity-50" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-[#3a4f60] flex items-center justify-center opacity-50">
                            <span className="text-white text-sm font-bold">{wallet.name[0]}</span>
                          </div>
                        )}
                      </WalletButton>
                    ))}
                  </div>
                </details>
              </div>
            )}

            {/* Aptos Info */}
            <div className="w-full pt-4 border-t border-[#3a4f60]">
              <div className="flex items-center justify-center gap-2 mb-3">
                <div className="w-5 h-5 rounded bg-gradient-to-br from-[#00d4aa] to-[#00a0ff] flex items-center justify-center">
                  <span className="text-[9px] font-bold text-black">A</span>
                </div>
                <span className="text-[#8297a3] text-xs">Powered by Aptos Testnet</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-[#2a3d4e]/50 rounded-lg">
                  <div className="text-[#22c55e] text-sm font-bold">~470ms</div>
                  <div className="text-[#6b7a8a] text-[10px]">Finality</div>
                </div>
                <div className="p-2 bg-[#2a3d4e]/50 rounded-lg">
                  <div className="text-[#60a5fa] text-sm font-bold">160k+</div>
                  <div className="text-[#6b7a8a] text-[10px]">Peak TPS</div>
                </div>
                <div className="p-2 bg-[#2a3d4e]/50 rounded-lg">
                  <div className="text-[#fbbf24] text-sm font-bold">&lt;$0.001</div>
                  <div className="text-[#6b7a8a] text-[10px]">Avg Fee</div>
                </div>
              </div>
            </div>

            {/* Terms and Privacy */}
            <div className="w-full flex justify-center items-center gap-2 pt-2">
              <a
                href="/tos"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6b7a8a] text-xs font-medium transition-all duration-200 hover:underline hover:text-[#8297a3]"
              >
                Terms
              </a>
              <span className="text-[#6b7a8a] text-xs">•</span>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#6b7a8a] text-xs font-medium transition-all duration-200 hover:underline hover:text-[#8297a3]"
              >
                Privacy
              </a>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
