import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultJobEngine } from "@/lib/jobs/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs
 * Lista los jobs del workspace.
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

    const canRead = await defaultPermissionEngine.can(user.id, workspaceId, "jobs.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { data: jobs, error } = await (supabase.from("jobs") as any)
      .select("*, agents(name, model_id)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ jobs: jobs || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * POST /api/jobs
 * Registra un nuevo Job autónomo durable.
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
    const { workspaceId, agentId, name, description, input, triggerType, timeoutSeconds, maxConcurrentRuns, retryPolicy } = body;

    if (!workspaceId || !agentId || !name || !input) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "workspaceId, agentId, name e input son campos obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const canCreate = await defaultPermissionEngine.can(user.id, workspaceId, "jobs.create", { supabaseClient: supabase });
    if (!canCreate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canCreate.reason, statusCode: 403 } }, { status: 403 });
    }

    const job = await defaultJobEngine.createJob(
      workspaceId,
      user.id,
      {
        agent_id: agentId,
        name,
        description,
        input,
        trigger_type: triggerType || "manual",
        timeout_seconds: timeoutSeconds,
        max_concurrent_runs: maxConcurrentRuns,
        retry_policy: retryPolicy,
      },
      supabase
    );

    return NextResponse.json({ job }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
