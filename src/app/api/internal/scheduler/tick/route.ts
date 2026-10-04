import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultSchedulerEngine } from "@/lib/jobs/scheduler/scheduler";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/scheduler/tick
 * Endpoint interno para ejecución periódica del scheduler.
 * Requiere encabezado: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized: Missing Bearer token" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return NextResponse.json({ error: "Server Configuration Error: CRON_SECRET not configured" }, { status: 500 });
    }

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return NextResponse.json({ error: "Forbidden: Invalid authorization token" }, { status: 403 });
    }

    const supabase = createClient();
    const result = await defaultSchedulerEngine.triggerTick(supabase);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      spawnedCount: result.spawnedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Internal Scheduler Error" }, { status: 500 });
  }
}

/** Vercel Cron dispatches scheduled invocations as GET requests. */
export async function GET(req: NextRequest) {
  return POST(req);
}
