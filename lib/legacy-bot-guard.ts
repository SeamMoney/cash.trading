import { NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
};

export function legacyBotAutomationEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function legacyBotAutomationUnavailable() {
  if (legacyBotAutomationEnabled()) return null;

  return NextResponse.json(
    {
      unavailable: true,
      reason: "legacy_bot_api_not_enabled",
      error:
        "Automated bot execution is unavailable until wallet-signed authorization is implemented. Manual trading is unaffected.",
    },
    { status: 501, headers: NO_STORE_HEADERS },
  );
}
