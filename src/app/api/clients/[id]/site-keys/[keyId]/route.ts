import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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
    const serviceClient = createServiceClient();

    // 1. Buscar la llave por id + client_id
    const { data: existingKey, error: findErr } = await (
      serviceClient.from("client_site_keys") as any
    )
      .select("id, client_id, is_active")
      .eq("id", keyId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (findErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: findErr.message } },
        { status: 500 }
      );
    }

    if (!existingKey) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Site key no encontrada para este cliente." } },
        { status: 404 }
      );
    }

    // 2. Si is_active=true → soft-revoke (is_active=false, updated_at=now)
    if (existingKey.is_active) {
      const { error: updateErr } = await (serviceClient.from("client_site_keys") as any)
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", keyId)
        .eq("client_id", clientId);

      if (updateErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: updateErr.message } },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, action: "revoked" }, { status: 200 });
    }

    // 3. Si is_active=false → borrado físico definitivo
    const { error: deleteErr } = await (serviceClient.from("client_site_keys") as any)
      .delete()
      .eq("id", keyId)
      .eq("client_id", clientId);

    if (deleteErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: deleteErr.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, action: "deleted" }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al procesar site key." } },
      { status: 500 }
    );
  }
}
