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

    let query = (supabase.from("control_plane_audit_log") as any)
      .select("*")
      .eq("workspace_id", member.workspace_id);

    if (correlationId) query = query.eq("correlation_id", correlationId);
    if (traceId) query = query.eq("trace_id", traceId);
    if (resourceType) query = query.eq("resource_type", resourceType);
    if (resourceId) query = query.eq("resource_id", resourceId);
    if (decision) query = query.eq("decision", decision);
    if (action) query = query.eq("action", action);

    const { data: events, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      // Fallback a job_audit_log si control_plane_audit_log no tuviera filas todavía
      const { data: jobAudit } = await (supabase.from("job_audit_log") as any)
        .select("*")
        .eq("workspace_id", member.workspace_id)
        .order("created_at", { ascending: false })
        .limit(limit);

      return NextResponse.json({
        events: (jobAudit || []).map((e: any) => ({
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
        })),
      });
    }

    // Sanitización activa antes de entregar al cliente (H6, H17-H20)
    const sanitizedEvents = (events || []).map((e: any) => ({
      ...e,
      metadata: sanitizeAuditMetadata(e.metadata || {}),
    }));

    return NextResponse.json({
      events: sanitizedEvents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } },
      { status: 500 }
    );
  }
}
