/**
 * In-app Circle CCTP burn on Solana — the "one click" half of Solana → Aptos.
 *
 * Builds the TokenMessengerMinter `deposit_for_burn` transaction directly so
 * the connected wallet (Backpack/Phantom in-app or extension) signs it without
 * the user ever leaving cash.trading. The resulting signature feeds the
 * existing attestation → claim → deposit rail, which is already domain-generic.
 *
 * Program IDs and account layout come from Circle's published IDL
 * (circlefin/solana-cctp-contracts, examples/target/idl/*_031.json) and were
 * verified two ways before shipping: both programs exist as executable
 * accounts on mainnet, and a fully-built transaction for a real USDC holder
 * passes `simulateTransaction` against mainnet RPC.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";

/** Circle CCTP v1 programs on Solana mainnet (same IDs on devnet). */
export const TOKEN_MESSENGER_MINTER_PROGRAM = new PublicKey(
  "CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3",
);
export const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey(
  "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
);
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** CCTP destination domain for Aptos. */
const APTOS_DOMAIN = 9;

/** Anchor discriminator for `deposit_for_burn`, from Circle's IDL. */
const DEPOSIT_FOR_BURN_DISCRIMINATOR = Uint8Array.from([215, 60, 61, 46, 114, 55, 128, 176]);

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (${res.status})`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || `Solana RPC ${method} error`);
  return body.result as T;
}

/** The owner's largest USDC token account — source of the burn. */
export async function findUsdcTokenAccount(
  owner: string,
): Promise<{ address: string; balance: number } | null> {
  const result = await rpc<{
    value?: Array<{
      pubkey: string;
      account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } };
    }>;
  }>("getTokenAccountsByOwner", [
    owner,
    { mint: SOLANA_USDC_MINT.toBase58() },
    { encoding: "jsonParsed" },
  ]);
  const accounts = result?.value ?? [];
  let best: { address: string; balance: number } | null = null;
  for (const entry of accounts) {
    const balance = entry.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    if (typeof balance === "number" && (!best || balance > best.balance)) {
      best = { address: entry.pubkey, balance };
    }
  }
  return best;
}

function findPda(programId: PublicKey, seeds: Array<Uint8Array | Buffer>): PublicKey {
  return PublicKey.findProgramAddressSync(seeds as Buffer[], programId)[0];
}

function aptosAddressToMintRecipient(aptosAddress: string): PublicKey {
  const hex = aptosAddress.replace(/^0x/, "").padStart(64, "0");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Invalid Aptos recipient address");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new PublicKey(bytes);
}

/**
 * Build the burn transaction. `eventKeypair` is the rent-paying account Circle
 * requires for the emitted message; it must co-sign, so it is partial-signed
 * onto the transaction before the wallet adds the owner's signature.
 */
export async function buildDepositForBurnTransaction(args: {
  /** Base58 Solana owner (fee payer and burn authority). */
  owner: string;
  /** Base58 USDC token account to burn from. */
  tokenAccount: string;
  /** Amount in USDC base units (6 decimals). */
  amountBaseUnits: bigint;
  /** 0x… Aptos address that receives the minted USDC. */
  aptosRecipient: string;
}): Promise<{ transaction: Transaction; eventKeypair: Keypair }> {
  const owner = new PublicKey(args.owner);
  const burnTokenAccount = new PublicKey(args.tokenAccount);
  const mintRecipient = aptosAddressToMintRecipient(args.aptosRecipient);
  const eventKeypair = Keypair.generate();

  const utf8 = (value: string) => new TextEncoder().encode(value);
  // PDA labels verified against circlefin/solana-cctp-contracts examples/utils.ts.
  const messageTransmitter = findPda(MESSAGE_TRANSMITTER_PROGRAM, [utf8("message_transmitter")]);
  const tokenMessenger = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [utf8("token_messenger")]);
  const tokenMinter = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [utf8("token_minter")]);
  const localToken = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [
    utf8("local_token"),
    SOLANA_USDC_MINT.toBytes(),
  ]);
  const remoteTokenMessenger = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [
    utf8("remote_token_messenger"),
    utf8(String(APTOS_DOMAIN)),
  ]);
  const senderAuthority = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [utf8("sender_authority")]);
  const eventAuthority = findPda(TOKEN_MESSENGER_MINTER_PROGRAM, [utf8("__event_authority")]);

  // deposit_for_burn(params { amount: u64, destination_domain: u32, mint_recipient: pubkey })
  const data = new Uint8Array(8 + 8 + 4 + 32);
  data.set(DEPOSIT_FOR_BURN_DISCRIMINATOR, 0);
  new DataView(data.buffer).setBigUint64(8, args.amountBaseUnits, true);
  new DataView(data.buffer).setUint32(16, APTOS_DOMAIN, true);
  data.set(mintRecipient.toBytes(), 20);

  // Account order exactly as in the IDL's deposit_for_burn context.
  const instruction = new TransactionInstruction({
    programId: TOKEN_MESSENGER_MINTER_PROGRAM,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: owner, isSigner: true, isWritable: true }, // event_rent_payer
      { pubkey: senderAuthority, isSigner: false, isWritable: false },
      { pubkey: burnTokenAccount, isSigner: false, isWritable: true },
      { pubkey: messageTransmitter, isSigner: false, isWritable: true },
      { pubkey: tokenMessenger, isSigner: false, isWritable: false },
      { pubkey: remoteTokenMessenger, isSigner: false, isWritable: false },
      { pubkey: tokenMinter, isSigner: false, isWritable: false },
      { pubkey: localToken, isSigner: false, isWritable: true },
      { pubkey: SOLANA_USDC_MINT, isSigner: false, isWritable: true },
      { pubkey: eventKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: MESSAGE_TRANSMITTER_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const latest = await rpc<{ value?: { blockhash?: string } }>("getLatestBlockhash", [
    { commitment: "confirmed" },
  ]);
  const blockhash = latest?.value?.blockhash;
  if (!blockhash) throw new Error("Could not fetch a Solana blockhash");

  const transaction = new Transaction();
  transaction.feePayer = owner;
  transaction.recentBlockhash = blockhash;
  transaction.add(instruction);
  transaction.partialSign(eventKeypair);
  return { transaction, eventKeypair };
}

type InjectedSolanaProvider = {
  signAndSendTransaction: (
    transaction: Transaction,
  ) => Promise<{ signature: string } | string>;
  connect?: () => Promise<unknown>;
  isConnected?: boolean;
};

/** The wallet's injected Solana provider (Backpack in-app, Phantom, …). */
export function getInjectedSolanaProvider(): InjectedSolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    backpack?: { solana?: InjectedSolanaProvider };
    phantom?: { solana?: InjectedSolanaProvider };
    solana?: InjectedSolanaProvider;
  };
  const candidate = w.backpack?.solana ?? w.phantom?.solana ?? w.solana ?? null;
  return candidate && typeof candidate.signAndSendTransaction === "function" ? candidate : null;
}

/** Sign and send via the injected provider; returns the base58 signature. */
export async function signAndSendWithProvider(
  provider: InjectedSolanaProvider,
  transaction: Transaction,
): Promise<string> {
  if (provider.connect && provider.isConnected === false) {
    await provider.connect();
  }
  const result = await provider.signAndSendTransaction(transaction);
  const signature = typeof result === "string" ? result : result?.signature;
  if (!signature) throw new Error("Wallet did not return a transaction signature.");
  return signature;
}
