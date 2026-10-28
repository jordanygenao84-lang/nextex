import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type FindingStatus = "open" | "fix_sent" | "accepted" | "fixed";

const VALID_STATUSES: FindingStatus[] = ["open", "fix_sent", "accepted", "fixed"];

/**
 * Valida si la transición de estado solicitada está permitida según las reglas de VIG-6:
 * - open -> fix_sent
 * - open -> accepted
 * - fix_sent -> accepted
 * - cualquiera -> fixed (cierre manual)
 */
function isValidTransition(current: string, next: FindingStatus): boolean {
  if (current === next) return true;
  // Cualquiera puede pasar a 'fixed'
  if (next === "fixed") return true;

  if (current === "open") {
    return next === "fix_sent" || next === "accepted";
  }

  if (current === "fix_sent") {
    return next === "accepted";
  }

  return false;
}

/**
 * PATCH /api/vigia/findings/[id]
 * Modifica el estado de un hallazgo de seguridad aplicando reglas estrictas de transición.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const findingId = params?.id;
    if (!findingId) {
      return NextResponse.json(
        { error: { code: "MISSING_ID", message: "ID de hallazgo requerido." } },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || !body.status) {
      return NextResponse.json(
        { error: { code: "INVALID_BODY", message: "Se requiere { status } en el cuerpo JSON." } },
        { status: 400 }
      );
    }

    const targetStatus = body.status as FindingStatus;
    if (!VALID_STATUSES.includes(targetStatus)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_STATUS",
            message: `Estado no válido. Opciones: ${VALID_STATUSES.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Obtener hallazgo actual
    const { data: finding, error: fetchErr } = await (
      serviceClient.from("security_findings") as any
    )
      .select("id, client_id, status, title, type")
      .eq("id", findingId)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: fetchErr.message } },
        { status: 500 }
      );
    }

    if (!finding) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Hallazgo de seguridad no encontrado." } },
        { status: 404 }
      );
    }

    // 2. Validar transición de estado
    if (!isValidTransition(finding.status, targetStatus)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_TRANSITION",
            message: `Transición no permitida de '${finding.status}' a '${targetStatus}'.`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Preparar actualización
    const updatePayload: Record<string, any> = {
      status: targetStatus,
    };

    if (targetStatus === "fixed") {
      updatePayload.resolved_at = new Date().toISOString();
    }

    const { data: updated, error: updateErr } = await (
      serviceClient.from("security_findings") as any
    )
      .update(updatePayload)
      .eq("id", findingId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    // 4. Si se marcó como 'fixed', registrar en incident_log
    if (targetStatus === "fixed" && finding.status !== "fixed") {
      await (serviceClient.from("incident_log") as any).insert({
        client_id: finding.client_id,
        kind: "finding_fixed",
        title: `Hallazgo resuelto manualmente: ${finding.title}`,
        detail: {
          finding_id: finding.id,
          type: finding.type,
          resolved_by: user.email || user.id,
          resolved_at: updatePayload.resolved_at,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      finding: updated,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
