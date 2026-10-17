import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; bindingId: string } }
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

    const { id: clientId, bindingId } = params;
    const serviceClient = createServiceClient();

    // 1. Verificar existencia
    const { data: existing, error: fetchErr } = await (serviceClient.from("client_id_bindings") as any)
      .select("id")
      .eq("id", bindingId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Binding no encontrado para este cliente." } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { phone, is_active } = body;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (phone !== undefined) {
      updates.phone = phone ? String(phone).trim() : null;
    }

    if (is_active !== undefined) {
      updates.is_active = Boolean(is_active);
    }

    const { data: updatedBinding, error: updateErr } = await (serviceClient.from("client_id_bindings") as any)
      .update(updates)
      .eq("id", bindingId)
      .eq("client_id", clientId)
      .select("id, client_id, external_id, phone, channel, is_active, created_at, updated_at")
      .single();

    if (updateErr || !updatedBinding) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr?.message || "Error al actualizar binding." } },
        { status: 500 }
      );
    }

    return NextResponse.json(updatedBinding, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al actualizar binding." } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; bindingId: string } }
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

    const { id: clientId, bindingId } = params;
    const serviceClient = createServiceClient();

    // Borrado definitivo (libera el ID en la restricción UNIQUE)
    const { data: deleted, error } = await (serviceClient.from("client_id_bindings") as any)
      .delete()
      .eq("id", bindingId)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    if (!deleted) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Binding no encontrado para este cliente." } },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al eliminar binding." } },
      { status: 500 }
    );
  }
}
