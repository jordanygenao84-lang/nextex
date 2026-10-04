import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

    const { data: run, error: runErr } = await (supabase.from("job_runs") as any)
      .select("*, jobs(id, name, automation_id), workers(id, worker_identity, instance_identity)")
      .eq("id", params.id)
      .maybeSingle();

    if (runErr) throw runErr;
    if (!run) {
      return NextResponse.json(
        { error: { code: "RUN_NOT_FOUND", message: "Job Run no encontrado.", statusCode: 404 } },
        { status: 404 }
      );
    }

    if (run.workspace_id !== member.workspace_id) {
      return NextResponse.json(
        { error: { code: "TENANT_MISMATCH", message: "Acceso denegado a recurso de otro workspace.", statusCode: 403 } },
        { status: 403 }
      );
    }

    // Consultar Agent Runs vinculados
    const { data: agentRuns } = await (supabase.from("agent_runs") as any)
      .select("*, agent_steps(*)")
      .eq("job_run_id", run.id);

    // Consultar Auditoría histórica del run
    const { data: auditEvents } = await (supabase.from("job_audit_log") as any)
      .select("*")
      .eq("job_run_id", run.id)
      .order("created_at", { ascending: true });

    // Consultar Leases del run
    const { data: leases } = await (supabase.from("worker_leases") as any)
      .select("*")
      .eq("job_run_id", run.id)
      .order("leased_at", { ascending: true });

    // Construir Timeline
    const timeline = [];
    if (run.queued_at) {
      timeline.push({ stage: "queued", timestamp: run.queued_at, status: "completed", description: "Encolado en scheduler" });
    }
    if (run.started_at) {
      timeline.push({ stage: "claimed", timestamp: run.started_at, status: "completed", description: `Reclamado por worker ${run.worker_id || "N/A"}` });
      timeline.push({ stage: "running", timestamp: run.started_at, status: "completed", description: "Inicio de ejecución" });
    }

    // Agregar pasos del agente
    const steps = (agentRuns || []).flatMap((ar: any) => ar.agent_steps || []);
    steps.sort((a: any, b: any) => a.step_number - b.step_number);

    for (const st of steps) {
      timeline.push({
        stage: `step_${st.step_number}`,
        stepType: st.step_type,
        timestamp: st.created_at,
        status: st.status,
        description: `Paso ${st.step_number}: ${st.step_type} (${st.status})`,
      });
    }

    if (run.completed_at) {
      timeline.push({
        stage: "completion",
        timestamp: run.completed_at,
        status: run.status,
        description: `Finalizado con estado: ${run.status}`,
      });
    }

    return NextResponse.json({
      run,
      agentRuns: agentRuns || [],
      auditEvents: auditEvents || [],
      leases: leases || [],
      timeline,
      fencingHistory: {
        currentToken: run.fencing_token,
        leaseExpiresAt: run.lease_expires_at,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
