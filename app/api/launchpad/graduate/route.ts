import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/launchpad/graduate
 * Trigger graduation of an indicator that meets thresholds.
 * Deploys Decibel Vault + registers Builder Code.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { indicatorAddr, creatorAddr, performanceFeeBps = 500 } = body;

    if (!indicatorAddr || !creatorAddr) {
      return NextResponse.json({ error: "Missing indicatorAddr or creatorAddr" }, { status: 400 });
    }

    // In production:
    // 1. Check backtester::meets_graduation_threshold() view function
    // 2. Call bonding_curve graduation (if not auto-triggered)
    // 3. Deploy Decibel Vault via SDK:
    //    - DecibelWriteDex.createAndFundVault(...)
    //    - DecibelWriteDex.activateVault(...)
    // 4. Register Builder Code (user approves builder fee)
    // 5. Update indicator state: indicator::set_graduated(addr, vault_addr)

    const DECIBEL_PACKAGE = process.env.DECIBEL_PACKAGE ||
      "0x952535c3049e52f195f26798c2f1340d7dd5100edbe0f464e520a974d16fbe9f";

    return NextResponse.json({
      success: true,
      steps: [
        {
          name: "Check graduation threshold",
          payload: {
            function: `${process.env.LAUNCHPAD_PACKAGE || "0x1"}::backtester::meets_graduation_threshold`,
            type_arguments: [],
            arguments: [indicatorAddr, "1500", "80", "10000", "70"],
          },
        },
        {
          name: "Create Decibel Vault",
          payload: {
            function: `${DECIBEL_PACKAGE}::vault::create_and_fund_vault`,
            type_arguments: [],
            arguments: [
              "WhopSignals Vault",       // name
              performanceFeeBps.toString(), // fee
              "30",                        // fee interval days
            ],
          },
        },
        {
          name: "Activate Vault",
          payload: {
            function: `${DECIBEL_PACKAGE}::vault::activate`,
            type_arguments: [],
            arguments: [],
          },
        },
        {
          name: "Register Builder Code",
          description: "Users must approve your builder address to collect fees on their trades",
          builderAddr: creatorAddr,
          maxFeeBps: 10,
        },
        {
          name: "Set indicator graduated",
          payload: {
            function: `${process.env.LAUNCHPAD_PACKAGE || "0x1"}::indicator::set_graduated`,
            type_arguments: [],
            arguments: [indicatorAddr, "VAULT_ADDR_PLACEHOLDER"],
          },
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Graduation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
