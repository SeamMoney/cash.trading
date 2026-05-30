import { NextRequest, NextResponse } from "next/server";

import { buildCreateDecibelVaultPayload } from "@/lib/decibel-vaults";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = buildCreateDecibelVaultPayload(body);
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to build Decibel vault create payload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
