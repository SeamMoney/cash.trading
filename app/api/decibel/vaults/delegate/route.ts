import { NextRequest, NextResponse } from "next/server";

import { buildDelegateDecibelVaultPayload } from "@/lib/decibel-vaults";
import {
  buildDecibelVaultPayloadResponse,
  DECIBEL_VAULT_NO_STORE_HEADERS,
} from "@/lib/decibel-vault-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        error: "Vault automation delegation is not enabled",
        reason: "launchpad_automation_not_enabled",
      },
      { status: 501, headers: DECIBEL_VAULT_NO_STORE_HEADERS },
    );
  }

  return buildDecibelVaultPayloadResponse(
    req,
    "decibel-vault-delegate",
    buildDelegateDecibelVaultPayload,
  );
}
