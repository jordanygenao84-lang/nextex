import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GovernanceManager, AuditManager, CancellationManager } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const { data: member } = await (supabase.from("workspace_members") as any)
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!member?.workspace_id) {
      return NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "Usuario sin workspace activo.", statusCode: 403 } },
        { status: 403 }
      );
    }

    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get("status");
    const jobId = searchParams.get("jobId");
    const workerId = searchParams.get("workerId");
    const limit = Number(searchParams.get("limit") || 50);

    let query = (supabase.from("job_runs") as any)
      .select("*, jobs(id, name, automation_id)")
      .eq("workspace_id", member.workspace_id);

    if (status) query = query.eq("status", status);
    if (jobId) query = query.eq("job_id", jobId);
    if (workerId) query = query.eq("worker_id", workerId);

    const { data: runs, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json({
      runs: (runs || []).map((r: any) => {
        let durationMs = null;
        if (r.started_at && r.completed_at) {
          durationMs = new Date(r.completed_at).getTime() - new Date(r.started_at).getTime();
        }
        return {
          ...r,
          durationMs,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } },
        { status: 401 }
      );
    }

    const { data: member } = await (supabase.from("workspace_members") as any)
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (!member?.workspace_id) {
      return NextResponse.json(
        { error: { code: "NO_WORKSPACE", message: "Usuario sin workspace activo.", statusCode: 403 } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { runId, action, reason } = body;

    if (!runId || !action) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "runId y action son obligatorios.", statusCode: 400 } },
        { status: 400 }
      );
    }

    const { data: run } = await (supabase.from("job_runs") as any)
      .select("*")
      .eq("id", runId)
      .maybeSingle();

    if (!run) {
      return NextResponse.json(
        { error: { code: "RUN_NOT_FOUND", message: "Job Run no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    let decision;
    if (action === "cancel") {
      decision = await governance.evaluateJobCancel({
        jobRunId: run.id,
        actorId: user.id,
        role: member.role,
        workspaceId: member.workspace_id,
        runWorkspaceId: run.workspace_id,
      });
    } else if (action === "retry") {
      decision = await governance.evaluateJobRetry({
        jobRunId: run.id,
        actorId: user.id,
        role: member.role,
        workspaceId: member.workspace_id,
        runWorkspaceId: run.workspace_id,
        targetRun: run,
      });
    } else {
      decision = await governance.evaluateAuthority({
        actorId: user.id,
        actorType: "user",
        workspaceId: member.workspace_id,
        resourceType: "job_run",
        resourceId: run.id,
        action,
        role: member.role,
        targetWorkspaceId: run.workspace_id,
        targetResource: run,
      });
    }

    if (!decision.allowed) {
      return NextResponse.json(
        {
          decision: decision.decision,
          error: {
            code: decision.errorCode || "AUTHORIZATION_DENIED",
            message: `Acción no autorizada: ${decision.reason}`,
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    if (action === "cancel") {
      const cm = new CancellationManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
      const cancelRes = await cm.requestCancellation({
        workspaceId: member.workspace_id,
        jobRunId: run.id,
        source: "user",
        actorId: user.id,
        reason: reason || "Cancelación solicitada desde Control Plane UI",
      });
      return NextResponse.json({ success: true, result: cancelRes });
    } else if (action === "retry") {
      // Re-encolar el run
      const { data: updated, error } = await (supabase.from("job_runs") as any)
        .update({
          status: "queued",
          worker_id: null,
          lease_expires_at: null,
          fencing_token: Number(run.fencing_token || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .select()
        .single();

      if (error) throw error;
      return NextResponse.json({ success: true, run: updated });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
