import { NextRequest, NextResponse } from "next/server";

import { buildDelegateDecibelVaultPayload } from "@/lib/decibel-vaults";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = buildDelegateDecibelVaultPayload(body);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build Decibel vault delegate payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
