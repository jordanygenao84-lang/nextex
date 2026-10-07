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
      .select("id, workspace_id, status")
      .eq("id", params.runId)
      .eq("job_id", params.id)
      .single();

    if (!run) {
      return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Job Run no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canCancel = await defaultPermissionEngine.can(user.id, run.workspace_id, "runs.cancel", { supabaseClient: supabase });
    if (!canCancel.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canCancel.reason, statusCode: 403 } }, { status: 403 });
    }

    if (["completed", "failed", "cancelled", "dead_letter"].includes(run.status)) {
      return NextResponse.json(
        { error: { code: "CANNOT_CANCEL", message: `El run ya está en estado final '${run.status}'.`, statusCode: 400 } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: updated, error } = await (serviceClient.from("job_runs") as any)
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.runId)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ run: updated });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
