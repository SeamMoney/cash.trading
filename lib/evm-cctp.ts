import type { DecibelNetwork } from "@/lib/decibel";

export type EvmCctpSourceChain = "Ethereum" | "Arbitrum" | "Base";

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
};

type Eip6963ProviderDetail = {
  info: {
    name: string;
    rdns?: string;
  };
  provider: Eip1193Provider;
};

type EvmChainConfig = {
  blockExplorerUrl: string;
  chainId: string;
  chainName: string;
  nativeCurrency: {
    decimals: 18;
    name: string;
    symbol: string;
  };
  rpcUrl: string;
  sourceChain: EvmCctpSourceChain;
  sourceDomain: number;
  tokenMessenger: `0x${string}`;
  usdc: `0x${string}`;
};

export type EvmCctpTransferResult = {
  explorerUrl: string;
  from: string;
  sourceChain: EvmCctpSourceChain;
  txHash: string;
};

const ERC20_APPROVE_SELECTOR = "095ea7b3";
const ERC20_ALLOWANCE_SELECTOR = "dd62ed3e";
const ERC20_BALANCE_OF_SELECTOR = "70a08231";
const CCTP_DEPOSIT_FOR_BURN_SELECTOR = "6fd3504e";
const APTOS_CCTP_DOMAIN = 9;

const EVM_CCTP_CHAINS: Record<
  DecibelNetwork,
  Record<EvmCctpSourceChain, EvmChainConfig>
> = {
  mainnet: {
    Ethereum: {
      blockExplorerUrl: "https://etherscan.io",
      chainId: "0x1",
      chainName: "Ethereum",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrl: "https://ethereum-rpc.publicnode.com",
      sourceChain: "Ethereum",
      sourceDomain: 0,
      tokenMessenger: "0xbd3fa81b58ba92a82136038b25adec7066af3155",
      usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    Arbitrum: {
      blockExplorerUrl: "https://arbiscan.io",
      chainId: "0xa4b1",
      chainName: "Arbitrum One",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrl: "https://arb1.arbitrum.io/rpc",
      sourceChain: "Arbitrum",
      sourceDomain: 3,
      tokenMessenger: "0x19330d10D9Cc8751218eaf51E8885D058642E08A",
      usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    },
    Base: {
      blockExplorerUrl: "https://basescan.org",
      chainId: "0x2105",
      chainName: "Base",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrl: "https://mainnet.base.org",
      sourceChain: "Base",
      sourceDomain: 6,
      tokenMessenger: "0x1682Ae6375C4E4A97e4B583BC394c861A46D8962",
      usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    },
  },
  testnet: {
    Ethereum: {
      blockExplorerUrl: "https://sepolia.etherscan.io",
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
      rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
      sourceChain: "Ethereum",
      sourceDomain: 0,
      tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    },
    Arbitrum: {
      blockExplorerUrl: "https://sepolia.arbiscan.io",
      chainId: "0x66eee",
      chainName: "Arbitrum Sepolia",
      nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
      rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
      sourceChain: "Arbitrum",
      sourceDomain: 3,
      tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    },
    Base: {
      blockExplorerUrl: "https://sepolia.basescan.org",
      chainId: "0x14a34",
      chainName: "Base Sepolia",
      nativeCurrency: { decimals: 18, name: "Sepolia Ether", symbol: "ETH" },
      rpcUrl: "https://sepolia.base.org",
      sourceChain: "Base",
      sourceDomain: 6,
      tokenMessenger: "0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5",
      usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
  },
};

function stripHexPrefix(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function toHexQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function encodeUint(value: bigint | number) {
  const bigint = typeof value === "bigint" ? value : BigInt(value);
  return bigint.toString(16).padStart(64, "0");
}

function encodeAddress(address: string) {
  return stripHexPrefix(address).toLowerCase().padStart(64, "0");
}

function encodeBytes32(hex: string) {
  const normalized = stripHexPrefix(hex).toLowerCase();
  if (!/^[0-9a-f]{1,64}$/.test(normalized)) {
    throw new Error("Invalid Aptos recipient address.");
  }
  return normalized.padStart(64, "0");
}

function formatEvmProviderName(name: string) {
  return name.toLowerCase().replace(/\s*\(ethereum\)\s*$/, "").trim();
}

function providerMatches(detail: Eip6963ProviderDetail, preferredWalletName?: string) {
  if (!preferredWalletName) return false;
  const preferred = formatEvmProviderName(preferredWalletName);
  const name = detail.info.name.toLowerCase();
  const rdns = detail.info.rdns?.toLowerCase() ?? "";
  return name.includes(preferred) || rdns.includes(preferred);
}

async function getAnnouncedEip6963Providers() {
  if (typeof window === "undefined") return [];
  const providers: Eip6963ProviderDetail[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.provider && !providers.includes(detail)) providers.push(detail);
  };
  window.addEventListener("eip6963:announceProvider", handler as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  window.removeEventListener("eip6963:announceProvider", handler as EventListener);
  return providers;
}

export async function getEvmProvider(preferredWalletName?: string) {
  if (typeof window === "undefined") return null;

  const providers = await getAnnouncedEip6963Providers();
  const preferred = providers.find((detail) =>
    providerMatches(detail, preferredWalletName)
  );
  if (preferred) return preferred.provider;

  const injected = (window as unknown as {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  }).ethereum;
  if (!injected) return null;

  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers[0];
  }
  return injected;
}

async function requestStringArray(
  provider: Eip1193Provider,
  method: string,
  params?: unknown[]
) {
  const result = await provider.request({ method, params });
  return Array.isArray(result) ? result.filter((item) => typeof item === "string") : [];
}

async function getConnectedAccounts(provider: Eip1193Provider) {
  return requestStringArray(provider, "eth_accounts");
}

async function requestAccounts(provider: Eip1193Provider) {
  return requestStringArray(provider, "eth_requestAccounts");
}

async function switchEvmChain(provider: Eip1193Provider, config: EvmChainConfig) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainId }],
    });
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? (err as { code?: unknown }).code : null;
    if (code !== 4902 && code !== "4902") throw err;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: config.chainId,
          chainName: config.chainName,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.blockExplorerUrl],
        },
      ],
    });
  }
}

async function ethCall(provider: Eip1193Provider, to: string, data: string) {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  });
  return typeof result === "string" ? result : "0x0";
}

async function rpcEthCall(config: EvmChainConfig, to: string, data: string) {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
    }),
  });
  const body = (await res.json()) as { error?: { message?: string }; result?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message || `EVM RPC call failed (${res.status})`);
  }
  return typeof body.result === "string" ? body.result : "0x0";
}

async function sendTransaction(
  provider: Eip1193Provider,
  from: string,
  to: string,
  data: string
) {
  const result = await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: "0x0" }],
  });
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error("Wallet did not return an EVM transaction hash.");
  }
  return result;
}

async function waitForEvmReceipt(provider: Eip1193Provider, txHash: string) {
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash],
    });
    if (receipt && typeof receipt === "object") {
      const status = (receipt as { status?: unknown }).status;
      if (status === "0x1") return receipt;
      if (status === "0x0") throw new Error("EVM transaction reverted.");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for EVM transaction confirmation.");
}

function parseHexBigInt(value: string) {
  return BigInt(value && value !== "0x" ? value : "0x0");
}

function usdcAmountToRaw(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Enter a USDC amount before bridging.");
  }
  return BigInt(Math.floor(amount * 1_000_000));
}

export function getEvmCctpConfig(
  network: DecibelNetwork,
  sourceChain: EvmCctpSourceChain
) {
  return EVM_CCTP_CHAINS[network][sourceChain];
}

export function getEvmSourceExplorerUrl(
  network: DecibelNetwork,
  sourceChain: EvmCctpSourceChain,
  txHash: string
) {
  const config = getEvmCctpConfig(network, sourceChain);
  return `${config.blockExplorerUrl}/tx/${txHash}`;
}

export async function fetchEvmUsdcBalance(args: {
  network: DecibelNetwork;
  preferredWalletName?: string;
  sourceChain: EvmCctpSourceChain;
}) {
  const provider = await getEvmProvider(args.preferredWalletName);
  if (!provider) return null;
  const [from] = await getConnectedAccounts(provider);
  if (!from) return null;
  const config = getEvmCctpConfig(args.network, args.sourceChain);
  const data = `0x${ERC20_BALANCE_OF_SELECTOR}${encodeAddress(from)}`;
  const raw = parseHexBigInt(await rpcEthCall(config, config.usdc, data));
  return {
    address: from,
    balance: Number(raw) / 1_000_000,
  };
}

export async function startEvmCctpDeposit(args: {
  amount: number;
  aptosRecipientAddress: string;
  network: DecibelNetwork;
  onStep?: (message: string) => void;
  preferredWalletName?: string;
  sourceChain: EvmCctpSourceChain;
}): Promise<EvmCctpTransferResult> {
  const provider = await getEvmProvider(args.preferredWalletName);
  if (!provider) {
    throw new Error("No EVM wallet provider found. Open Rainbow, MetaMask, or Coinbase Wallet.");
  }

  const config = getEvmCctpConfig(args.network, args.sourceChain);
  const rawAmount = usdcAmountToRaw(args.amount);

  args.onStep?.(`Switch ${config.chainName} in your wallet...`);
  await switchEvmChain(provider, config);

  const [from] = await requestAccounts(provider);
  if (!from) throw new Error("Connect the EVM source wallet before bridging.");

  const balanceData = `0x${ERC20_BALANCE_OF_SELECTOR}${encodeAddress(from)}`;
  const sourceBalance = parseHexBigInt(await ethCall(provider, config.usdc, balanceData));
  if (sourceBalance < rawAmount) {
    throw new Error(`Insufficient ${config.chainName} USDC balance.`);
  }

  const allowanceData = `0x${ERC20_ALLOWANCE_SELECTOR}${encodeAddress(from)}${encodeAddress(config.tokenMessenger)}`;
  const allowance = parseHexBigInt(await ethCall(provider, config.usdc, allowanceData));
  if (allowance < rawAmount) {
    args.onStep?.("Approve USDC for Circle CCTP...");
    const approveData = `0x${ERC20_APPROVE_SELECTOR}${encodeAddress(config.tokenMessenger)}${encodeUint(rawAmount)}`;
    const approveHash = await sendTransaction(provider, from, config.usdc, approveData);
    args.onStep?.("USDC approval submitted. Waiting for confirmation...");
    await waitForEvmReceipt(provider, approveHash);
  }

  args.onStep?.("Burn USDC through Circle CCTP to Aptos...");
  const depositData =
    `0x${CCTP_DEPOSIT_FOR_BURN_SELECTOR}` +
    encodeUint(rawAmount) +
    encodeUint(APTOS_CCTP_DOMAIN) +
    encodeBytes32(args.aptosRecipientAddress) +
    encodeAddress(config.usdc);
  const txHash = await sendTransaction(provider, from, config.tokenMessenger, depositData);
  args.onStep?.("Source transfer submitted. Waiting for confirmation...");
  await waitForEvmReceipt(provider, txHash);

  return {
    explorerUrl: getEvmSourceExplorerUrl(args.network, args.sourceChain, txHash),
    from,
    sourceChain: args.sourceChain,
    txHash,
  };
}
