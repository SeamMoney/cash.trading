import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { StrategyRunner } from "@/components/automation/StrategyRunner"
import { botOwnerAllowlistConfigured } from "@/lib/bot-owner-guard"

export const metadata: Metadata = {
  title: "cash.trading - Strategy runner",
  description:
    "Run one ready-made strategy on your own Decibel account. No vault, no shares.",
}

export default function AutomationPage() {
  // The page used to be hidden in production because the API behind it had no
  // authorization at all. It is now authorized per request (owner allowlist +
  // on-chain subaccount ownership), so the page is available wherever an owner
  // is configured — and still hidden when nobody is, so an unconfigured
  // deployment does not advertise a control surface that will only 503.
  if (!botOwnerAllowlistConfigured()) {
    redirect("/portfolio")
  }

  return <StrategyRunner />
}
