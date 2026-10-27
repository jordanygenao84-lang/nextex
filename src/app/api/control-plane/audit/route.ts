import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AuditManager, sanitizeAuditMetadata } from "@/lib/control-plane";

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
    const requestedWorkspaceId = searchParams.get("workspaceId");

    // Aislamiento Multi-Tenant Estricto (H14, H16, H46)
    if (requestedWorkspaceId && requestedWorkspaceId !== member.workspace_id) {
      return NextResponse.json(
        {
          error: {
            code: "TENANT_MISMATCH",
            message: "Acceso denegado: No está autorizado para consultar la auditoría de otro workspace.",
            statusCode: 403,
          },
        },
        { status: 403 }
      );
    }

    const correlationId = searchParams.get("correlationId");
    const traceId = searchParams.get("traceId");
    const resourceType = searchParams.get("resourceType");
    const resourceId = searchParams.get("resourceId");
    const decision = searchParams.get("decision");
    const action = searchParams.get("action");
    const limit = Math.min(Number(searchParams.get("limit") || 100), 200);

    // Ambas fuentes se consultan SIEMPRE y se mezclan: antes solo se leía
    // job_audit_log cuando control_plane_audit_log daba ERROR; como esa
    // tabla devolvía 0 filas sin error (gobernanza en 0), la página quedaba
    // vacía aunque los runs sí tuvieran auditoría.
    let query = (supabase.from("control_plane_audit_log") as any)
      .select("*")
      .eq("workspace_id", member.workspace_id);

    if (correlationId) query = query.eq("correlation_id", correlationId);
    if (traceId) query = query.eq("trace_id", traceId);
    if (resourceType) query = query.eq("resource_type", resourceType);
    if (resourceId) query = query.eq("resource_id", resourceId);
    if (decision) query = query.eq("decision", decision);
    if (action) query = query.eq("action", action);

    const { data: events } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    // job_audit_log no tiene correlation_id/trace_id/resource_type: solo se
    // mezcla cuando esos filtros no están activos; el filtro de decisión
    // aplica porque estos eventos se exponen como "allow".
    const includeJobAudit =
      !correlationId &&
      !traceId &&
      !resourceType &&
      (!decision || decision.toLowerCase() === "allow");

    let jobEvents: any[] = [];
    if (includeJobAudit) {
      let jobQuery = (supabase.from("job_audit_log") as any)
        .select("*")
        .eq("workspace_id", member.workspace_id);
      if (action) jobQuery = jobQuery.eq("action", action);
      if (resourceId) jobQuery = jobQuery.eq("job_run_id", resourceId);
      const { data: jobAudit } = await jobQuery
        .order("created_at", { ascending: false })
        .limit(limit);
      jobEvents = (jobAudit || []).map((e: any) => ({
        event_id: e.id,
        workspace_id: e.workspace_id,
        actor_id: e.actor_id,
        actor_type: e.actor_type,
        action: e.action,
        resource_type: "job_run",
        resource_id: e.job_run_id || e.id,
        decision: "allow",
        metadata: sanitizeAuditMetadata(e.details || {}),
        created_at: e.created_at,
      }));
    }

    // Sanitización activa antes de entregar al cliente (H6, H17-H20)
    const sanitizedEvents = (events || []).map((e: any) => ({
      ...e,
      metadata: sanitizeAuditMetadata(e.metadata || {}),
    }));

    const merged = [...sanitizedEvents, ...jobEvents].sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({
      events: merged.slice(0, limit),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
