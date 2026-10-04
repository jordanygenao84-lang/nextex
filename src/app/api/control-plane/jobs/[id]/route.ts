import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GovernanceManager, AuditManager, CancellationManager } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { data: job, error: jobErr } = await (supabase.from("jobs") as any)
      .select("*, automations(id, name)")
      .eq("id", params.id)
      .maybeSingle();

    if (jobErr) throw jobErr;
    if (!job) {
      return NextResponse.json(
        { error: { code: "JOB_NOT_FOUND", message: "Job no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    if (job.workspace_id !== member.workspace_id) {
      return NextResponse.json(
        { error: { code: "TENANT_MISMATCH", message: "Acceso denegado a recurso de otro workspace.", statusCode: 403 } },
        { status: 403 }
      );
    }

    // Consultar Job Runs con Agent Runs y Steps
    const { data: runs } = await (supabase.from("job_runs") as any)
      .select("*, agent_runs(*, agent_steps(*))")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(20);

    return NextResponse.json({
      job,
      runs: runs || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { data: job } = await (supabase.from("jobs") as any)
      .select("*")
      .eq("id", params.id)
      .maybeSingle();

    if (!job) {
      return NextResponse.json(
        { error: { code: "JOB_NOT_FOUND", message: "Job no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { action, reason } = body;

    const audit = new AuditManager({ workspaceId: member.workspace_id, supabaseClient: supabase });
    const governance = new GovernanceManager({
      workspaceId: member.workspace_id,
      supabaseClient: supabase,
      auditManager: audit,
    });

    // Validar autorización por Gobernanza
    const decision = await governance.evaluateAuthority({
      actorId: user.id,
      actorType: "user",
      workspaceId: member.workspace_id,
      resourceType: "job",
      resourceId: job.id,
      action: action === "cancel" ? "jobs.update" : action,
      role: member.role,
      targetWorkspaceId: job.workspace_id,
    });

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
      const cancelRes = await cm.cancelJob(job.id, member.workspace_id, user.id, reason);
      return NextResponse.json({ success: true, result: cancelRes });
    }

    return NextResponse.json({ success: true, message: `Acción '${action}' ejecutada con éxito.` });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
