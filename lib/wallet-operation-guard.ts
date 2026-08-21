import {
  CASH_AMBIGUITY_QUARANTINE_STORAGE_PREFIX,
  CASH_AMBIGUITY_STORAGE_PREFIX,
  CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX,
  CASH_LEGACY_PENDING_MIGRATION_STORAGE_PREFIX,
  CASH_LEGACY_PENDING_SWAP_STORAGE_PREFIX,
  normalizeCashAmbiguityOwner,
} from "./cash-orderbook-ambiguity";
import {
  DECIBEL_SPOT_AMBIGUITY_STORAGE_PREFIX,
  DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX,
  DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX,
  DECIBEL_SPOT_PENDING_STORAGE_PREFIX,
  DECIBEL_SPOT_QUARANTINE_STORAGE_PREFIX,
  normalizeDecibelSpotOwnerKey,
} from "./decibel-spot-ambiguity";

export interface WalletOperationStorage {
  getItem(key: string): string | null;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hasAnyStoredValue(storage: WalletOperationStorage, keys: string[]) {
  try {
    return unique(keys).some((key) => storage.getItem(key) !== null);
  } catch {
    // If storage cannot be inspected, another transaction cannot be ruled out.
    return true;
  }
}

export function hasCashWalletOperationEvidence(
  storage: WalletOperationStorage,
  owner: string,
) {
  const normalizedOwner = normalizeCashAmbiguityOwner(owner);
  const ownerKeys = unique([owner.toLowerCase(), normalizedOwner]);
  return hasAnyStoredValue(storage, [
    `${CASH_AMBIGUITY_STORAGE_PREFIX}:${normalizedOwner}`,
    `${CASH_AMBIGUITY_QUARANTINE_STORAGE_PREFIX}:${normalizedOwner}`,
    ...ownerKeys.flatMap((ownerKey) => [
      `${CASH_LEGACY_PENDING_SWAP_STORAGE_PREFIX}:${ownerKey}`,
      `${CASH_LEGACY_PENDING_MIGRATION_STORAGE_PREFIX}:${ownerKey}`,
      `${CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${ownerKey}:swap`,
      `${CASH_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${ownerKey}:migration`,
    ]),
  ]);
}

export function hasDecibelSpotWalletOperationEvidence(
  storage: WalletOperationStorage,
  owner: string,
) {
  const normalizedOwner = normalizeDecibelSpotOwnerKey(owner);
  const ownerKeys = unique([owner.toLowerCase(), normalizedOwner]);
  return hasAnyStoredValue(storage, [
    `${DECIBEL_SPOT_PENDING_STORAGE_PREFIX}:${normalizedOwner}`,
    `${DECIBEL_SPOT_AMBIGUITY_STORAGE_PREFIX}:${normalizedOwner}`,
    `${DECIBEL_SPOT_QUARANTINE_STORAGE_PREFIX}:${normalizedOwner}`,
    ...ownerKeys.flatMap((ownerKey) => [
      `${DECIBEL_SPOT_LEGACY_PENDING_STORAGE_PREFIX}:${ownerKey}`,
      `${DECIBEL_SPOT_LEGACY_AMBIGUITY_STORAGE_PREFIX}:${ownerKey}`,
    ]),
  ]);
}
