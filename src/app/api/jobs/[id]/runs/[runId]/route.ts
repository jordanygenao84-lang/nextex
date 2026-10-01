import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]/runs/[runId]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; runId: string } }
) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: run, error } = await (supabase.from("job_runs") as any)
      .select("*, agent_runs(*, agent_run_steps(*))")
      .eq("id", params.runId)
      .eq("job_id", params.id)
      .single();

    if (error || !run) {
      return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Job Run no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, run.workspace_id, "jobs.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    return NextResponse.json({ run });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
