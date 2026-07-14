import {
  createAccountAuthenticatorForEthereumTransaction,
  createMessageForEthereumTransaction,
  defaultEthereumAuthenticationFunction,
  EIP1193DerivedPublicKey,
  type EthereumAddress,
} from "@aptos-labs/derived-wallet-ethereum";
import type { InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";
import { AccountAddress, AptosApiError } from "@aptos-labs/ts-sdk";
import { BrowserProvider, getAddress } from "ethers";
import { aptos } from "@/lib/aptos";
import { getEvmProvider, type Eip1193Provider } from "@/lib/evm-cctp";

export const DECIBEL_APP_DERIVED_DOMAIN = "app.decibel.trade";
export const DECIBEL_APP_DERIVED_URI = "https://app.decibel.trade";

function normalizeAptosAddress(address: string) {
  return AccountAddress.fromString(address).toStringLong();
}

function toEthereumAddress(address: string): EthereumAddress {
  return getAddress(address) as EthereumAddress;
}

async function getEvmSigner(provider: Eip1193Provider) {
  const browserProvider = new BrowserProvider(provider);
  await browserProvider.send("eth_requestAccounts", []);
  const signer = await browserProvider.getSigner();
  const ethereumAddress = toEthereumAddress(await signer.getAddress());
  return { ethereumAddress, signer };
}

export function deriveEvmAptosAddress(args: {
  domain: string;
  evmAddress: string;
}) {
  const publicKey = new EIP1193DerivedPublicKey({
    authenticationFunction: defaultEthereumAuthenticationFunction,
    domain: args.domain,
    ethereumAddress: toEthereumAddress(args.evmAddress),
  });
  return publicKey.authKey().derivedAddress().toStringLong();
}

/**
 * A derived account that only ever received bridged USDC has no APT, so it
 * cannot pay gas itself. Below this balance we route the transaction through
 * the server fee-payer instead of letting the wallet signature fail on
 * INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE.
 */
const MIN_SELF_GAS_OCTAS = 1_000_000n; // 0.01 APT
const SEQUENCE_LOOKUP_ATTEMPTS = 3;

export async function needsSponsoredGas(accountAddress: string): Promise<boolean> {
  try {
    const octas = await aptos.getAccountAPTAmount({
      accountAddress: normalizeAptosAddress(accountAddress),
    });
    return BigInt(octas) < MIN_SELF_GAS_OCTAS;
  } catch {
    // Account not found on chain yet — it certainly has no APT.
    return true;
  }
}

async function getSponsoredAccountSequenceNumber(accountAddress: string): Promise<bigint> {
  for (let attempt = 0; attempt < SEQUENCE_LOOKUP_ATTEMPTS; attempt += 1) {
    try {
      const account = await aptos.getAccountInfo({
        accountAddress: normalizeAptosAddress(accountAddress),
      });
      return BigInt(account.sequence_number);
    } catch (error) {
      // A brand-new derived account legitimately starts at sequence zero.
      if (error instanceof AptosApiError && error.status === 404) return 0n;
      if (attempt === SEQUENCE_LOOKUP_ATTEMPTS - 1) {
        throw new Error("Could not verify the Aptos account sequence. Please try the claim again.");
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error("Could not verify the Aptos account sequence. Please try the claim again.");
}

export async function submitEvmDerivedAptosPayload(args: {
  domain: string;
  expectedSenderAddress?: string;
  payload: InputGenerateTransactionPayloadData;
  preferredWalletName?: string;
  scheme?: string;
  /** Route through /api/decibel/sponsor-submit so a server fee-payer covers gas. */
  sponsored?: boolean;
  uri: string;
  onStep?: (message: string) => void;
}): Promise<{ hash: string }> {
  const provider = await getEvmProvider(args.preferredWalletName);
  if (!provider) {
    throw new Error("No EVM wallet provider found. Open Rainbow, MetaMask, or Coinbase Wallet.");
  }

  const { ethereumAddress, signer } = await getEvmSigner(provider);
  const derivedSender = deriveEvmAptosAddress({
    domain: args.domain,
    evmAddress: ethereumAddress,
  });
  const sender = args.expectedSenderAddress
    ? normalizeAptosAddress(args.expectedSenderAddress)
    : derivedSender;

  if (normalizeAptosAddress(derivedSender) !== sender) {
    throw new Error(
      `This ${args.domain} derived account is ${sender.slice(0, 6)}...${sender.slice(-4)}, but the connected EVM wallet derives ${derivedSender.slice(0, 6)}...${derivedSender.slice(-4)}.`
    );
  }

  args.onStep?.(`Build Aptos transaction for ${args.domain}...`);
  // The SDK treats any sponsored-account lookup failure as "account does not
  // exist" and silently builds sequence 0. Existing derived accounts then
  // fail sponsor simulation with SEQUENCE_NUMBER_TOO_OLD. Resolve it first,
  // retry transient RPC failures, and pass the verified value explicitly.
  const accountSequenceNumber = args.sponsored
    ? await getSponsoredAccountSequenceNumber(sender)
    : undefined;
  const transaction = await aptos.transaction.build.simple({
    sender,
    data: args.payload,
    withFeePayer: args.sponsored === true,
    // The sponsor route caps max_gas_amount * gas_unit_price at 0.05 APT;
    // the SDK's 200k-unit default would blow through that, and these claim/
    // deposit transactions use well under 20k units.
    options: args.sponsored
      ? { maxGasAmount: 20_000, accountSequenceNumber }
      : undefined,
  });

  const issuedAt = new Date();
  const { siweMessage, signingMessageDigest } =
    createMessageForEthereumTransaction({
      authenticationFunction: defaultEthereumAuthenticationFunction,
      domain: args.domain,
      ethereumAddress,
      issuedAt,
      rawTransaction: transaction,
      uri: args.uri,
    });

  args.onStep?.(`Sign ${args.domain} derived Aptos transaction in your EVM wallet...`);
  const siweSignature = await signer.signMessage(siweMessage);
  const senderAuthenticator = createAccountAuthenticatorForEthereumTransaction(
    siweSignature,
    ethereumAddress,
    args.domain,
    args.scheme ?? "https",
    defaultEthereumAuthenticationFunction,
    signingMessageDigest,
    issuedAt
  );

  if (args.sponsored) {
    args.onStep?.("Submit via gas sponsor...");
    const res = await fetch("/api/decibel/sponsor-submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionHex: transaction.bcsToHex().toString(),
        senderAuthenticatorHex: senderAuthenticator.bcsToHex().toString(),
      }),
    });
    const data = (await res.json().catch(() => null)) as
      | { hash?: string; error?: string; reason?: string; vmStatus?: string }
      | null;
    if (!res.ok || !data?.hash) {
      const reason = data?.error || data?.reason || `Gas sponsor rejected the transaction (${res.status}).`;
      throw new Error(
        data?.vmStatus ? `${reason}: ${data.vmStatus}` : reason,
      );
    }
    return { hash: data.hash };
  }

  args.onStep?.("Submit Aptos transaction...");
  return aptos.transaction.submit.simple({
    senderAuthenticator,
    transaction,
  });
}
