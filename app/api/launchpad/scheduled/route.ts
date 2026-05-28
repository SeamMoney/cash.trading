/**
 * Scheduled Job Registry — in-memory store for time/signal/price-triggered auto-trade jobs.
 *
 * GET    /api/launchpad/scheduled?owner=<addr>&indicator=<addr>  — list jobs
 * POST   /api/launchpad/scheduled                                — create a job
 * DELETE /api/launchpad/scheduled?jobId=<n>                      — cancel a job
 */
import { NextResponse } from "next/server";
import { ScheduledJob } from "@/lib/launchpad/types";
import { loadState, saveState } from "@/lib/launchpad/persist";

export const runtime = "nodejs";

export const scheduledJobRegistry: ScheduledJob[] = loadState<ScheduledJob[]>("scheduled-jobs", []);
let nextJobId = scheduledJobRegistry.length > 0
  ? Math.max(...scheduledJobRegistry.map(j => j.jobId)) + 1
  : 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const owner = url.searchParams.get("owner");
  const indicator = url.searchParams.get("indicator");

  let jobs = [...scheduledJobRegistry];

  if (owner) {
    jobs = jobs.filter(j => j.owner.toLowerCase() === owner.toLowerCase());
  }
  if (indicator) {
    jobs = jobs.filter(j => j.indicatorAddr.toLowerCase() === indicator.toLowerCase());
  }

  return NextResponse.json({ jobs, total: jobs.length });
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      owner: string;
      triggerType: ScheduledJob["triggerType"];
      indicatorAddr: string;
      expectedSignal?: 0 | 1 | 2;
      scheduledTimeMs?: number;
      priceThreshold?: number;
      isPriceAbove?: boolean;
      actionType: ScheduledJob["actionType"];
      actionData?: string;
      actionAmount?: number;
      gasDeposit?: number;
      recurring?: boolean;
    };

    const {
      owner,
      triggerType,
      indicatorAddr,
      expectedSignal,
      scheduledTimeMs,
      priceThreshold,
      isPriceAbove,
      actionType,
      actionData,
      actionAmount = 0,
      gasDeposit = 0,
      recurring,
    } = body;

    // Validate required fields
    if (!owner) {
      return NextResponse.json({ error: "owner is required" }, { status: 400 });
    }
    if (!triggerType || !["time", "signal", "price"].includes(triggerType)) {
      return NextResponse.json({ error: "triggerType must be 'time', 'signal', or 'price'" }, { status: 400 });
    }
    if (!actionType || !["apt_transfer", "record_signal"].includes(actionType)) {
      return NextResponse.json({ error: "actionType must be 'apt_transfer' or 'record_signal'" }, { status: 400 });
    }

    // Trigger-specific validation
    if (triggerType === "time" && !scheduledTimeMs) {
      return NextResponse.json({ error: "scheduledTimeMs required for time trigger" }, { status: 400 });
    }
    if (triggerType === "signal" && !indicatorAddr) {
      return NextResponse.json({ error: "indicatorAddr required for signal trigger" }, { status: 400 });
    }
    if (triggerType === "price" && (priceThreshold === undefined || !indicatorAddr)) {
      return NextResponse.json({ error: "priceThreshold and indicatorAddr required for price trigger" }, { status: 400 });
    }

    const job: ScheduledJob = {
      jobId: nextJobId++,
      owner,
      triggerType,
      indicatorAddr: indicatorAddr ?? "",
      expectedSignal: expectedSignal ?? 0,
      scheduledTimeMs,
      priceThreshold,
      isPriceAbove: isPriceAbove ?? false,
      actionType,
      actionData,
      gasDeposit,
      actionAmount,
      status: "pending",
      createdAt: Date.now(),
      recurring: recurring ?? false,
    };

    scheduledJobRegistry.push(job);
    saveState("scheduled-jobs", scheduledJobRegistry);
    console.log(`[scheduled] created job #${job.jobId}: triggerType=${triggerType} owner=${owner.slice(0, 10)}...`);

    return NextResponse.json({ success: true, job });
  } catch (err) {
    console.error("[scheduled] POST error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as {
      jobId: number;
      status: "executed" | "pending";
      executedAt?: number;
    };

    const { jobId, status, executedAt } = body;

    if (jobId === undefined || jobId === null) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }
    if (!status || !["executed", "pending"].includes(status)) {
      return NextResponse.json({ error: "status must be 'executed' or 'pending'" }, { status: 400 });
    }

    const job = scheduledJobRegistry.find(j => j.jobId === jobId);
    if (!job) {
      return NextResponse.json({ error: `Job #${jobId} not found` }, { status: 404 });
    }

    job.status = status;
    if (status === "executed" && executedAt) {
      job.executedAt = executedAt;
    }

    saveState("scheduled-jobs", scheduledJobRegistry);
    console.log(`[scheduled] PATCH job #${jobId} → status=${status}${executedAt ? ` executedAt=${executedAt}` : ""}`);

    return NextResponse.json({ success: true, job });
  } catch (err) {
    console.error("[scheduled] PATCH error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const jobIdParam = url.searchParams.get("jobId");

  if (jobIdParam === null) {
    return NextResponse.json({ error: "jobId query parameter required" }, { status: 400 });
  }

  const jobId = Number(jobIdParam);
  if (isNaN(jobId)) {
    return NextResponse.json({ error: "jobId must be a number" }, { status: 400 });
  }

  const job = scheduledJobRegistry.find(j => j.jobId === jobId);
  if (!job) {
    return NextResponse.json({ error: `Job #${jobId} not found` }, { status: 404 });
  }
  if (job.status !== "pending") {
    return NextResponse.json({ error: `Job #${jobId} is already ${job.status}` }, { status: 400 });
  }

  job.status = "cancelled";
  saveState("scheduled-jobs", scheduledJobRegistry);
  console.log(`[scheduled] cancelled job #${jobId}`);

  return NextResponse.json({ success: true, job });
}
