import { NextRequest, NextResponse } from "next/server";

import { buildActivateDecibelVaultPayload } from "@/lib/decibel-vaults";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = buildActivateDecibelVaultPayload(body);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build Decibel vault activate payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
