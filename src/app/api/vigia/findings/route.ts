import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 1,
  warning: 2,
  info: 3,
};

/**
 * GET /api/vigia/findings
 * Retorna todos los hallazgos de seguridad con el nombre del cliente,
 * ordenados por severidad (critical, warning, info) y luego por fecha desc.
 * Filtros opcionales por query params: ?status=open|fixed|...&client_id=UUID
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

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const clientIdParam = searchParams.get("client_id");

    const serviceClient = createServiceClient();

    let query = (serviceClient.from("security_findings") as any).select(`
      id,
      client_id,
      source,
      type,
      severity,
      title,
      evidence,
      fix_prompt,
      status,
      created_at,
      resolved_at,
      client:clients (
        id,
        display_name
      )
    `);

    if (statusParam) {
      query = query.eq("status", statusParam);
    }
    if (clientIdParam) {
      query = query.eq("client_id", clientIdParam);
    }

    const { data: rows, error: dbErr } = await query;

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    const findings = (rows || []).map((row: any) => ({
      id: row.id,
      client_id: row.client_id,
      client_name: row.client?.display_name || "Cliente Desconocido",
      source: row.source,
      type: row.type,
      severity: row.severity,
      title: row.title,
      evidence: row.evidence,
      fix_prompt: row.fix_prompt,
      status: row.status,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
    }));

    // Ordenar por severidad (critical -> warning -> info) y luego fecha desc
    findings.sort((a: any, b: any) => {
      const orderA = SEVERITY_ORDER[a.severity] ?? 99;
      const orderB = SEVERITY_ORDER[b.severity] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ findings });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
