import { NextRequest } from "next/server";

import { buildDepositDecibelVaultPayload } from "@/lib/decibel-vaults";
import { buildDecibelVaultPayloadResponse } from "@/lib/decibel-vault-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return buildDecibelVaultPayloadResponse(
    req,
    "decibel-vault-deposit",
    buildDepositDecibelVaultPayload,
  );
}
