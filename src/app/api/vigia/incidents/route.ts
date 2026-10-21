import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/vigia/incidents
 * Retorna los últimos 20 incidentes registrados en incident_log
 * y el contador de hallazgos de seguridad abiertos por severidad.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Consultar últimos 20 incidentes
    const { data: incidentRows, error: incErr } = await (serviceClient.from("incident_log") as any)
      .select(`
        id,
        client_id,
        kind,
        title,
        detail,
        created_at,
        client:clients (
          id,
          display_name
        )
      `)
      .order("created_at", { ascending: false })
      .limit(20);

    if (incErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: incErr.message } },
        { status: 500 }
      );
    }

    const incidents = (incidentRows || []).map((row: any) => ({
      id: row.id,
      client_id: row.client_id,
      client_name: row.client?.display_name || "Sistema Global",
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      created_at: row.created_at,
    }));

    // 2. Consultar hallazgos de seguridad abiertos por severidad
    const { data: openFindings, error: findErr } = await (serviceClient.from("security_findings") as any)
      .select("severity")
      .eq("status", "open");

    const findings_count = {
      critical: 0,
      warning: 0,
      info: 0,
      total: 0,
    };

    if (!findErr && Array.isArray(openFindings)) {
      for (const f of openFindings) {
        findings_count.total++;
        if (f.severity === "critical") findings_count.critical++;
        else if (f.severity === "warning") findings_count.warning++;
        else if (f.severity === "info") findings_count.info++;
      }
    }

    return NextResponse.json({
      incidents,
      findings_count,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al obtener incidentes de VIGÍA." } },
      { status: 500 }
    );
  }
}
