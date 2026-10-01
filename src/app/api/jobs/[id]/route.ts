import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultJobEngine } from "@/lib/jobs/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]
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

    const { data: job, error } = await (supabase.from("jobs") as any)
      .select("*, agents(id, name, model_id, status)")
      .eq("id", params.id)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Job no encontrado o sin acceso.", statusCode: 404 } }, { status: 404 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, job.workspace_id, "jobs.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * PATCH /api/jobs/[id]
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: currentJob } = await (supabase.from("jobs") as any)
      .select("workspace_id")
      .eq("id", params.id)
      .single();

    if (!currentJob) {
      return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Job no encontrado.", statusCode: 404 } }, { status: 404 });
    }

    const canUpdate = await defaultPermissionEngine.can(user.id, currentJob.workspace_id, "jobs.update", { supabaseClient: supabase });
    if (!canUpdate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canUpdate.reason, statusCode: 403 } }, { status: 403 });
    }

    const body = await req.json();
    const updated = await defaultJobEngine.updateJob(params.id, currentJob.workspace_id, body, supabase);

    return NextResponse.json({ job: updated });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
