import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; keyId: string } }
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

    const { id: clientId, keyId } = params;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const { data: updatedKey, error } = await (serviceClient.from("client_api_keys") as any)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", keyId)
      .eq("client_id", clientId)
      .select("id, provider, label, key_hint, is_active")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    if (!updatedKey) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Clave no encontrada para este cliente." } },
        { status: 404 }
      );
    }

    await (serviceClient.from("client_ai_audit") as any).insert({
      client_id: clientId,
      changed_by: user.id,
      action: "key_removed",
      details: {
        key_id: keyId,
        provider: updatedKey.provider,
        label: updatedKey.label,
        key_hint: updatedKey.key_hint,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
