import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultJobEngine } from "@/lib/jobs/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/automations
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: { code: "WORKSPACE_REQUIRED", message: "workspaceId es obligatorio.", statusCode: 400 } }, { status: 400 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, workspaceId, "automations.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { data: automations, error } = await (supabase.from("automations") as any)
      .select("*, jobs(name, agent_id, status)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ automations: automations || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * POST /api/automations
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const body = await req.json();
    const { workspaceId, jobId, name, description, cronExpression, timezone, concurrencyPolicy, catchUpPolicy, maxCatchUpOccurrences } = body;

    if (!workspaceId || !jobId || !name || !cronExpression) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "workspaceId, jobId, name y cronExpression son obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const canCreate = await defaultPermissionEngine.can(user.id, workspaceId, "automations.create", { supabaseClient: supabase });
    if (!canCreate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canCreate.reason, statusCode: 403 } }, { status: 403 });
    }

    const automation = await defaultJobEngine.createAutomation(
      workspaceId,
      user.id,
      {
        job_id: jobId,
        name,
        description,
        cron_expression: cronExpression,
        timezone: timezone || "UTC",
        concurrency_policy: concurrencyPolicy,
        catch_up_policy: catchUpPolicy,
        max_catch_up_occurrences: maxCatchUpOccurrences,
      },
      supabase
    );

    return NextResponse.json({ automation }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
