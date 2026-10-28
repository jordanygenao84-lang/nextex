import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/clients/[id]/widgets/[widgetId]
 * Actualiza campos parciales de un widget existente.
 * Body parcial: { name?, greeting?, theme?, allowed_sources?, is_active? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; widgetId: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const { id: clientId, widgetId } = params;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const { name, greeting, theme, allowed_sources, is_active } = body;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json(
          { error: { code: "INVALID_PARAMETERS", message: "El nombre no puede estar vacío." } },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }

    if (greeting !== undefined) {
      updates.greeting = typeof greeting === "string" ? greeting.trim() : null;
    }

    if (theme !== undefined) {
      if (theme && typeof theme === "object") {
        updates.theme = theme;
      }
    }

    if (allowed_sources !== undefined) {
      if (Array.isArray(allowed_sources)) {
        updates.allowed_sources = allowed_sources;
      }
    }

    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    const { data: updatedWidget, error: updateErr } = await (serviceClient.from("client_widgets") as any)
      .update(updates)
      .eq("id", widgetId)
      .eq("client_id", clientId)
      .select("id, client_id, name, embed_key, allowed_sources, theme, greeting, is_active, created_at, updated_at")
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updatedWidget) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Widget no encontrado para este cliente." } },
        { status: 404 }
      );
    }

    return NextResponse.json(updatedWidget, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[id]/widgets/[widgetId]
 * Desactiva un widget para el cliente (soft delete: is_active = false).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; widgetId: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const { id: clientId, widgetId } = params;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Widget no encontrado para este cliente." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // Soft delete: marcar is_active = false
    const { data: updated, error } = await (serviceClient.from("client_widgets") as any)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", widgetId)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Widget no encontrado para este cliente." } },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
