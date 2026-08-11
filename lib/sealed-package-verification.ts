import { createHash } from "node:crypto";

export const SEALED_PACKAGE_MODULES = [
  "math_lib",
  "indicator",
  "sealed_vault",
  "strategy_vault",
  "portfolio_vault",
] as const;

export type SealedPackageModule = (typeof SEALED_PACKAGE_MODULES)[number];
export type BytecodeByModule = Partial<Record<SealedPackageModule, string>>;

export type BytecodeComparison = {
  module: SealedPackageModule;
  status: "match" | "mismatch" | "missing-local" | "missing-on-chain";
  localSha256?: string;
  onChainSha256?: string;
};

export function normalizeBytecodeHex(value: string): string {
  const normalized = value.trim().replace(/^0x/i, "").toLowerCase();
  if (!normalized || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error("module bytecode must be a non-empty, even-length hex string");
  }
  return normalized;
}

export function bytecodeSha256(value: string): string {
  return createHash("sha256")
    .update(Buffer.from(normalizeBytecodeHex(value), "hex"))
    .digest("hex");
}

export function compareSealedPackageBytecode(
  local: BytecodeByModule,
  onChain: BytecodeByModule,
): BytecodeComparison[] {
  return SEALED_PACKAGE_MODULES.map((module) => {
    const localBytecode = local[module];
    const onChainBytecode = onChain[module];
    if (!localBytecode) return { module, status: "missing-local" };
    if (!onChainBytecode) {
      return {
        module,
        status: "missing-on-chain",
        localSha256: bytecodeSha256(localBytecode),
      };
    }

    const normalizedLocal = normalizeBytecodeHex(localBytecode);
    const normalizedOnChain = normalizeBytecodeHex(onChainBytecode);
    return {
      module,
      status: normalizedLocal === normalizedOnChain ? "match" : "mismatch",
      localSha256: bytecodeSha256(normalizedLocal),
      onChainSha256: bytecodeSha256(normalizedOnChain),
    };
  });
}

export function sealedPackageBytecodeMatches(comparisons: BytecodeComparison[]): boolean {
  return comparisons.every(({ status }) => status === "match");
}
