import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

import {
  CASH_LEGACY_COIN_TYPE,
  CASH_METADATA_ADDRESS,
  CASH_ORDERBOOK_PAIR_ID,
  USDC_METADATA_ADDRESS,
} from "./cash-orderbook";

const mainnetAptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
const APTOS_TRANSACTION_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function isAptosTransactionHash(value: unknown): value is string {
  return typeof value === "string" && APTOS_TRANSACTION_HASH_PATTERN.test(value);
}

export type CashSwapConfirmation =
  | {
      status: "success";
      execution: {
        baseAmountAtomic: string;
        quoteAmountAtomic: string;
        takerFeeAtomic: string;
      };
    }
  | { status: "unverified"; reason: string }
  | { status: "failed"; vmStatus: string };

export type CashMigrationConfirmation =
  | { status: "success" }
  | { status: "unverified"; reason: string }
  | { status: "failed"; vmStatus: string };

function normalizedAddress(value: unknown) {
  const text = String(value ?? "");
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(text)) return "";
  return `0x${BigInt(text).toString(16).padStart(64, "0")}`;
}

function normalizedTypeTag(value: unknown) {
  const [address, moduleName, structName, ...extra] = String(value ?? "").split("::");
  const normalized = normalizedAddress(address);
  if (!normalized || !moduleName || !structName || extra.length > 0) return "";
  return `${normalized}::${moduleName}::${structName}`;
}

export function isExpectedCashMigrationTransaction(
  transaction: unknown,
  ownerAddress: string,
) {
  const response = transaction as {
    payload?: { arguments?: unknown; function?: unknown; type_arguments?: unknown };
    sender?: unknown;
  };
  const owner = normalizedAddress(ownerAddress);
  if (!owner || normalizedAddress(response.sender) !== owner) return false;

  const [address, moduleName, entryName, ...extra] = String(
    response.payload?.function ?? "",
  ).split("::");
  if (
    extra.length > 0
    || normalizedAddress(address) !== normalizedAddress("0x1")
    || moduleName !== "coin"
    || entryName !== "migrate_to_fungible_store"
  ) return false;

  const typeArguments = response.payload?.type_arguments;
  return Array.isArray(typeArguments)
    && typeArguments.length === 1
    && normalizedTypeTag(typeArguments[0]) === normalizedTypeTag(CASH_LEGACY_COIN_TYPE)
    && Array.isArray(response.payload?.arguments)
    && response.payload.arguments.length === 0;
}

export function isExpectedCashSwapTransaction(
  transaction: unknown,
  ownerAddress: string,
  direction: "buy" | "sell",
  expectedContractAddress: string,
  expectedFunctionArguments?: readonly string[],
) {
  const response = transaction as {
    payload?: { arguments?: unknown; function?: unknown; type_arguments?: unknown };
    sender?: unknown;
  };
  const owner = normalizedAddress(ownerAddress);
  const expectedContract = normalizedAddress(expectedContractAddress);
  if (
    !owner
    || !expectedContract
    || normalizedAddress(response.sender) !== owner
  ) return false;

  const [address, moduleName, entryName, ...extra] = String(
    response.payload?.function ?? "",
  ).split("::");
  if (
    extra.length > 0
    || normalizedAddress(address) !== expectedContract
    || moduleName !== "order_placement"
    || entryName !== (direction === "buy" ? "buy_from_wallet" : "sell_from_wallet")
  ) return false;

  const typeArguments = response.payload?.type_arguments;
  if (!Array.isArray(typeArguments) || typeArguments.length !== 0) return false;
  const args = response.payload?.arguments;
  const expectedLength = direction === "buy" ? 6 : 5;
  if (!Array.isArray(args) || args.length !== expectedLength) return false;
  if (
    String(args[0]) !== String(CASH_ORDERBOOK_PAIR_ID)
    || normalizedAddress(args[1]) !== normalizedAddress(USDC_METADATA_ADDRESS)
    || normalizedAddress(args[2]) !== normalizedAddress(CASH_METADATA_ADDRESS)
  ) return false;
  if (!args.slice(3).every((value) => /^\d+$/.test(String(value)) && BigInt(String(value)) > 0n)) {
    return false;
  }
  if (expectedFunctionArguments) {
    if (expectedFunctionArguments.length !== expectedLength) return false;
    return expectedFunctionArguments.every((expected, index) => (
      index === 1 || index === 2
        ? normalizedAddress(args[index]) === normalizedAddress(expected)
        : String(args[index]) === String(expected)
    ));
  }
  return true;
}

export function parseCashSwapExecution(
  transaction: unknown,
  ownerAddress: string,
  direction: "buy" | "sell",
  expectedContractAddress: string,
) {
  const response = transaction as {
    events?: unknown;
  };
  const events = response.events;
  if (!Array.isArray(events)) return null;
  const owner = normalizedAddress(ownerAddress);
  if (!owner) return null;
  if (!isExpectedCashSwapTransaction(
    transaction,
    ownerAddress,
    direction,
    expectedContractAddress,
  )) return null;
  const contractAddress = normalizedAddress(expectedContractAddress);

  const isContractEvent = (eventType: string, moduleName: string, eventName: string) => {
    const [address, module, name, ...extra] = eventType.split("::");
    return extra.length === 0
      && normalizedAddress(address) === contractAddress
      && module === moduleName
      && name === eventName;
  };

  let baseAmount = 0n;
  let quoteAmount = 0n;
  let takerFee = 0n;
  for (const rawEvent of events) {
    if (!rawEvent || typeof rawEvent !== "object") continue;
    const event = rawEvent as { type?: unknown; data?: unknown };
    if (typeof event.type !== "string" || !event.data || typeof event.data !== "object") continue;
    const data = event.data as Record<string, unknown>;

    if (isContractEvent(event.type, "settlement", "TradeEvent")) {
      const taker = direction === "buy" ? data.buyer : data.seller;
      const expectedSide = direction === "buy";
      if (
        String(data.pair_id) !== "0"
        || normalizedAddress(taker) !== owner
        || data.taker_is_bid !== expectedSide
        || !/^\d+$/.test(String(data.quantity))
        || !/^\d+$/.test(String(data.quote_amount))
      ) continue;
      baseAmount += BigInt(String(data.quantity));
      quoteAmount += BigInt(String(data.quote_amount));
    }

    if (isContractEvent(event.type, "fees", "FeeCollected")) {
      if (
        data.is_maker_fee !== false
        || normalizedAddress(data.trader) !== owner
        || !/^\d+$/.test(String(data.amount))
      ) continue;
      takerFee += BigInt(String(data.amount));
    }
  }

  if (baseAmount <= 0n || quoteAmount <= 0n) return null;
  return {
    baseAmountAtomic: baseAmount.toString(),
    quoteAmountAtomic: quoteAmount.toString(),
    takerFeeAtomic: takerFee.toString(),
  };
}

export async function confirmCashSwapTransaction(
  transactionHash: string,
  ownerAddress: string,
  direction: "buy" | "sell",
  expectedContractAddress: string,
  expectedFunctionArguments?: readonly string[],
): Promise<CashSwapConfirmation> {
  if (!isAptosTransactionHash(transactionHash)) {
    throw new Error("Invalid Aptos transaction hash");
  }

  const transaction = await mainnetAptos.waitForTransaction({
    transactionHash,
    options: { checkSuccess: false },
  });
  if (!isExpectedCashSwapTransaction(
    transaction,
    ownerAddress,
    direction,
    expectedContractAddress,
    expectedFunctionArguments,
  )) {
    return {
      status: "unverified",
      reason: "The confirmed transaction was not this wallet’s reviewed CASH/USDC swap",
    };
  }
  if ("success" in transaction && transaction.success === false) {
    return {
      status: "failed",
      vmStatus: transaction.vm_status || "Transaction failed on Aptos",
    };
  }
  const execution = parseCashSwapExecution(
    transaction,
    ownerAddress,
    direction,
    expectedContractAddress,
  );
  if (!execution) {
    return {
      status: "unverified",
      reason: "The confirmed transaction did not contain a verifiable CASH/USDC fill from the reviewed contract",
    };
  }
  return {
    status: "success",
    execution,
  };
}

export async function confirmCashMigrationTransaction(
  transactionHash: string,
  ownerAddress: string,
): Promise<CashMigrationConfirmation> {
  if (!isAptosTransactionHash(transactionHash)) {
    throw new Error("Invalid Aptos transaction hash");
  }

  const transaction = await mainnetAptos.waitForTransaction({
    transactionHash,
    options: { checkSuccess: false },
  });
  if (!isExpectedCashMigrationTransaction(transaction, ownerAddress)) {
    return {
      status: "unverified",
      reason: "The confirmed transaction was not the reviewed legacy CASH migration from this wallet",
    };
  }
  if ("success" in transaction && transaction.success === false) {
    return {
      status: "failed",
      vmStatus: transaction.vm_status || "CASH migration failed on Aptos",
    };
  }
  return { status: "success" };
}
