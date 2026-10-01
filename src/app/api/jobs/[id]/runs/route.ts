import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]/runs
 * Lista el historial de ejecuciones de un job.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: job } = await (supabase.from("jobs") as any).select("workspace_id").eq("id", params.id).single();
    if (!job) return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Job no encontrado.", statusCode: 404 } }, { status: 404 });

    const canRead = await defaultPermissionEngine.can(user.id, job.workspace_id, "jobs.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    const { data: runs, error } = await (supabase.from("job_runs") as any)
      .select("*")
      .eq("job_id", params.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json({ runs: runs || [] });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
