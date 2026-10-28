import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

    // Consultar Job Runs con Agent Runs y Steps. Si el join anidado falla
    // (p. ej. RLS sobre agent_runs), la consulta anterior devolvía data null
    // y la página mostraba 0 runs aunque el job sí los tuviera: en ese caso
    // se reintenta con un select plano, que es el mismo que usa la lista.
    let { data: runs, error: runsErr } = await (supabase.from("job_runs") as any)
      .select("*, agent_runs(*, agent_run_steps(*))")
      .eq("job_id", job.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (runsErr || !runs) {
      const plain = await (supabase.from("job_runs") as any)
        .select("*")
        .eq("job_id", job.id)
        .order("created_at", { ascending: false })
        .limit(20);
      runs = plain.data || [];
    }

    return NextResponse.json({
      job,
      runs: runs || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } },
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
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/control-plane/jobs/[id]
 * Borrado permanente SOLO de jobs archivados (un job activo nunca se borra
 * por esta vía: primero se archiva). Cascada: auditoría de sus runs,
 * pasos y runs de agente, runs del job y finalmente el job. La auditoría
 * global de otros jobs queda intacta.
 */
export async function DELETE(
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
      .select("id, workspace_id, status")
      .eq("id", params.id)
      .maybeSingle();

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

    if (job.status !== "archived") {
      return NextResponse.json(
        { error: { code: "JOB_NOT_ARCHIVED", message: "Solo se pueden eliminar jobs archivados. Archiva primero el job.", statusCode: 409 } },
        { status: 409 }
      );
    }

    // La auditoría de jobs es append-only por trigger (JOB_AUDIT_LOG_IMMUTABLE):
    // ni el cliente de servicio puede borrar sus filas, y borrar el job
    // cascada hacia ellas vía job_id. Si el job tiene auditoría, el borrado
    // es imposible por diseño: se rechaza con un 409 claro en vez de un
    // error críptico de RLS/trigger. Borrar sus runs tampoco sirve: las
    // filas de auditoría que los referencian se actualizarían a NULL y el
    // trigger también lo bloquea.
    const serviceClient = createServiceClient();
    const { data: runs } = await (serviceClient.from("job_runs") as any)
      .select("id")
      .eq("job_id", job.id);
    const runIds: string[] = (runs || []).map((r: any) => r.id);

    let auditQuery = (serviceClient.from("job_audit_log") as any)
      .select("id", { count: "exact", head: true })
      .eq("job_id", job.id);
    if (runIds.length > 0) {
      const { count: runAuditCount } = await (serviceClient.from("job_audit_log") as any)
        .select("id", { count: "exact", head: true })
        .in("job_run_id", runIds);
      if (runAuditCount && runAuditCount > 0) {
        return NextResponse.json(
          { error: { code: "JOB_HAS_IMMUTABLE_AUDIT", message: "No se puede eliminar: el job tiene historial de auditoría inmutable (append-only). Déjalo archivado y oculto con el filtro de pruebas.", statusCode: 409 } },
          { status: 409 }
        );
      }
    }
    const { count: jobAuditCount } = await auditQuery;
    if (jobAuditCount && jobAuditCount > 0) {
      return NextResponse.json(
        { error: { code: "JOB_HAS_IMMUTABLE_AUDIT", message: "No se puede eliminar: el job tiene historial de auditoría inmutable (append-only). Déjalo archivado y oculto con el filtro de pruebas.", statusCode: 409 } },
        { status: 409 }
      );
    }

    // Sin auditoría: cascada con cliente de servicio (las comprobaciones de
    // miembro, workspace y archivado ya se hicieron arriba).
    if (runIds.length > 0) {
      const { data: agentRuns } = await (serviceClient.from("agent_runs") as any)
        .select("id")
        .in("job_run_id", runIds);
      const agentRunIds: string[] = (agentRuns || []).map((r: any) => r.id);
      if (agentRunIds.length > 0) {
        const { error: stepsErr } = await (serviceClient.from("agent_run_steps") as any)
          .delete()
          .in("agent_run_id", agentRunIds);
        if (stepsErr) throw stepsErr;
        const { error: agentErr } = await (serviceClient.from("agent_runs") as any)
          .delete()
          .in("id", agentRunIds);
        if (agentErr) throw agentErr;
      }

      const { error: runsErr } = await (serviceClient.from("job_runs") as any)
        .delete()
        .eq("job_id", job.id);
      if (runsErr) throw runsErr;
    }

    const { error: jobErr } = await (serviceClient.from("jobs") as any)
      .delete()
      .eq("id", job.id)
      .eq("workspace_id", member.workspace_id);
    if (jobErr) throw jobErr;

    return NextResponse.json({ success: true, message: "Job eliminado exitosamente.", deletedRuns: runIds.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } },
      { status: 500 }
    );
  }
}
