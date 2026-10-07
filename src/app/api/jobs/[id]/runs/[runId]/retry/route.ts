import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

export async function POST(
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

    const { data: run } = await (supabase.from("job_runs") as any)
      .select("*")
      .eq("id", params.runId)
      .eq("job_id", params.id)
      .single();

    if (!run) {
      return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Job Run no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canRun = await defaultPermissionEngine.can(user.id, run.workspace_id, "jobs.run", { supabaseClient: supabase });
    if (!canRun.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRun.reason, statusCode: 403 } }, { status: 403 });
    }

    // Iniciar nuevo run conservando linaje usando serviceClient
    const serviceClient = createServiceClient();
    const { data: newRun, error } = await (serviceClient.from("job_runs") as any)
      .insert({
        workspace_id: run.workspace_id,
        job_id: run.job_id,
        automation_id: run.automation_id,
        occurrence_id: run.occurrence_id,
        agent_id: run.agent_id,
        priority: "high",
        status: "queued",
        input: run.input,
        attempt: (run.attempt || 1) + 1,
        max_attempts: run.max_attempts,
        retry_of_run_id: run.id,
        configuration_version: run.configuration_version,
        configuration_hash: run.configuration_hash,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ run: newRun }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
