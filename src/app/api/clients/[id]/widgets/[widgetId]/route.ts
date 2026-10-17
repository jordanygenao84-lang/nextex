import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
        { error: { code: "DB_ERROR", message: error.message } },
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
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al desactivar widget." } },
      { status: 500 }
    );
  }
}
