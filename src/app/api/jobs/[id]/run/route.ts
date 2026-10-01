import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { defaultJobEngine } from "@/lib/jobs/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: job } = await (supabase.from("jobs") as any).select("workspace_id, status").eq("id", params.id).single();
    if (!job) return NextResponse.json({ error: { code: "JOB_NOT_FOUND", message: "Job no encontrado.", statusCode: 404 } }, { status: 404 });

    const canRun = await defaultPermissionEngine.can(user.id, job.workspace_id, "jobs.run", { supabaseClient: supabase });
    if (!canRun.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRun.reason, statusCode: 403 } }, { status: 403 });
    }

    const run = await defaultJobEngine.triggerManualRun(params.id, job.workspace_id, user.id, supabase);
    return NextResponse.json({ run }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
