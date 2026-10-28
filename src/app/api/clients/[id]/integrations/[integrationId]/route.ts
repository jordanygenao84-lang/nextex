import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; integrationId: string } }
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

    const { id: clientId, integrationId } = params;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // Soft delete: marcar is_active = false
    const { data: updated, error } = await (serviceClient.from("client_integrations") as any)
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId)
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
        { error: { code: "NOT_FOUND", message: "Integración no encontrada para este cliente." } },
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
