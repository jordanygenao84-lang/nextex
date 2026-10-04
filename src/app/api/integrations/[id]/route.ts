import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
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
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}

/**
 * DELETE /api/integrations/[id]
 * Protegido: Si existen eventos históricos, rechaza la eliminación con HTTP 409 y exige archivar.
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

    if (count && count > 0) {
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

    const { error: deleteErr } = await (supabase.from("integrations") as any)
      .delete()
      .eq("id", params.id)
      .eq("workspace_id", currentIntegration.workspace_id);

    if (deleteErr) throw deleteErr;

    return NextResponse.json({ success: true, message: "Integración eliminada exitosamente." });
  } catch (err: any) {
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: err?.message, statusCode: 500 } }, { status: 500 });
  }
}
