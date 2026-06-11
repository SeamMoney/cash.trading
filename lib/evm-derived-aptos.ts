import {
  createAccountAuthenticatorForEthereumTransaction,
  createMessageForEthereumTransaction,
  defaultEthereumAuthenticationFunction,
  EIP1193DerivedPublicKey,
  type EthereumAddress,
} from "@aptos-labs/derived-wallet-ethereum";
import type { InputGenerateTransactionPayloadData } from "@aptos-labs/ts-sdk";
import { AccountAddress } from "@aptos-labs/ts-sdk";
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

export async function submitEvmDerivedAptosPayload(args: {
  domain: string;
  expectedSenderAddress?: string;
  payload: InputGenerateTransactionPayloadData;
  preferredWalletName?: string;
  scheme?: string;
  uri: string;
  onStep?: (message: string) => void;
}) {
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
  const transaction = await aptos.transaction.build.simple({
    sender,
    data: args.payload,
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

  args.onStep?.("Submit Aptos transaction...");
  return aptos.transaction.submit.simple({
    senderAuthenticator,
    transaction,
  });
}
