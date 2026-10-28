import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { defaultPermissionEngine } from "@/lib/agents/governance/permissions";
import { ConfigSanitizer } from "@/lib/integrations/validation/config-sanitizer";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/[id]
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: integration, error } = await (supabase.from("integrations") as any)
      .select("*, integration_endpoints(*)")
      .eq("id", params.id)
      .single();

    if (error || !integration) {
      return NextResponse.json({ error: { code: "INTEGRATION_NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });
    }

    const canRead = await defaultPermissionEngine.can(user.id, integration.workspace_id, "integrations.read", { supabaseClient: supabase });
    if (!canRead.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canRead.reason, statusCode: 403 } }, { status: 403 });
    }

    return NextResponse.json({ integration });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } }, { status: 500 });
  }
}

/**
 * PATCH /api/integrations/[id]
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: currentIntegration } = await (supabase.from("integrations") as any)
      .select("workspace_id")
      .eq("id", params.id)
      .single();

    if (!currentIntegration) {
      return NextResponse.json({ error: { code: "INTEGRATION_NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });
    }

    const canUpdate = await defaultPermissionEngine.can(user.id, currentIntegration.workspace_id, "integrations.update", { supabaseClient: supabase });
    if (!canUpdate.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canUpdate.reason, statusCode: 403 } }, { status: 403 });
    }

    const body = await req.json();

    if (body.config) {
      const configValidation = ConfigSanitizer.validate(body.config);
      if (!configValidation.valid) {
        return NextResponse.json(
          { error: { code: "CONFIG_CONTAINS_FORBIDDEN_KEYS", message: configValidation.errorMessage, statusCode: 400 } },
          { status: 400 }
        );
      }
    }

    const updated = await defaultIntegrationEngine.updateIntegration(params.id, currentIntegration.workspace_id, body, supabase);

    return NextResponse.json({ integration: updated });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/[id]
 * Protegido: Si existen eventos históricos, rechaza la eliminación con HTTP 409 y exige archivar,
 * SALVO ?force=true, que solo acepta un super_admin y borra en cascada eventos + endpoints
 * antes que la integración (uso previsto: limpieza de integraciones de prueba revocadas).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: { code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 } }, { status: 401 });
    }

    const { data: currentIntegration } = await (supabase.from("integrations") as any)
      .select("workspace_id")
      .eq("id", params.id)
      .single();

    if (!currentIntegration) {
      return NextResponse.json({ error: { code: "INTEGRATION_NOT_FOUND", message: "Integración no encontrada.", statusCode: 404 } }, { status: 404 });
    }

    const canDelete = await defaultPermissionEngine.can(user.id, currentIntegration.workspace_id, "integrations.delete", { supabaseClient: supabase });
    if (!canDelete.allowed) {
      return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: canDelete.reason, statusCode: 403 } }, { status: 403 });
    }

    // Comprobar si existen eventos asociados
    const { count, error: countErr } = await (supabase.from("integration_events") as any)
      .select("id", { count: "exact", head: true })
      .eq("integration_id", params.id);

    if (countErr) throw countErr;

    const force = req.nextUrl.searchParams.get("force") === "true";
    if (count && count > 0 && !force) {
      return NextResponse.json(
        {
          error: {
            code: "INTEGRATION_HAS_EVENTS_USE_ARCHIVE",
            message: "No se puede eliminar una integración con historial de eventos. Use la acción de archivar.",
            statusCode: 409,
          },
        },
        { status: 409 }
      );
    }

    // Borrado en cascada solo con force (super_admin): eventos + endpoints
    // son hijos de la integración; sin force, un 409 previo ya frenó el caso
    // con eventos, y los endpoints se borran igual para no dejar huérfanos.
    if (force) {
      const superAdmin = await isSuperAdmin(user.id);
      if (!superAdmin) {
        return NextResponse.json({ error: { code: "PERMISSION_DENIED", message: "El borrado forzado es solo para superadministradores.", statusCode: 403 } }, { status: 403 });
      }
      // La cascada usa el cliente de servicio (el borrado forzado ya está
      // gated a super_admin arriba) para no chocar con RLS en los hijos.
      const serviceClient = createServiceClient();
      // La auditoría de eventos es append-only por trigger
      // (INTEGRATION_AUDIT_LOG_IMMUTABLE): borrar un evento que tiene
      // entradas de auditoría intentaría poner su event_id a NULL y el
      // trigger lo bloquea. Se rechaza con un 409 claro antes de tocar nada.
      const { data: eventRows } = await (serviceClient.from("integration_events") as any)
        .select("id")
        .eq("integration_id", params.id);
      const eventIds: string[] = (eventRows || []).map((e: any) => e.id);
      if (eventIds.length > 0) {
        const { count: auditCount } = await (serviceClient.from("integration_event_audit_log") as any)
          .select("id", { count: "exact", head: true })
          .in("event_id", eventIds);
        if (auditCount && auditCount > 0) {
          return NextResponse.json(
            { error: { code: "INTEGRATION_HAS_IMMUTABLE_AUDIT", message: "No se puede eliminar: la integración tiene historial de auditoría inmutable (append-only). Déjala revocada y oculta con el filtro de pruebas.", statusCode: 409 } },
            { status: 409 }
          );
        }
      }
      const { error: eventsErr } = await (serviceClient.from("integration_events") as any)
        .delete()
        .eq("integration_id", params.id);
      if (eventsErr) throw eventsErr;
      const { error: endpointsErr } = await (serviceClient.from("integration_endpoints") as any)
        .delete()
        .eq("integration_id", params.id);
      if (endpointsErr) throw endpointsErr;
    }

    const { error: deleteErr } = await (supabase.from("integrations") as any)
      .delete()
      .eq("id", params.id)
      .eq("workspace_id", currentIntegration.workspace_id);

    if (deleteErr) throw deleteErr;

    return NextResponse.json({ success: true, message: "Integración eliminada exitosamente." });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor.", statusCode: 500 } }, { status: 500 });
  }
}
