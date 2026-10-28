import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

const VALID_CHANNELS = ["web", "whatsapp", "instagram", "other"] as const;
type Channel = (typeof VALID_CHANNELS)[number];

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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

    const clientId = params.id;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const { data: bindings, error } = await (serviceClient.from("client_id_bindings") as any)
      .select("id, client_id, external_id, phone, channel, is_active, created_at, updated_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(bindings || []);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    const clientId = params.id;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    const body = await req.json().catch(() => ({}));
    const { external_id, phone, channel } = body;

    if (!external_id || typeof external_id !== "string" || !external_id.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'external_id' es requerido." } },
        { status: 400 }
      );
    }

    const cleanExternalId = external_id.trim();
    const cleanChannel: Channel = channel ? (String(channel).trim().toLowerCase() as Channel) : "web";

    if (!VALID_CHANNELS.includes(cleanChannel)) {
      return NextResponse.json(
        {
          error: {
            code: "INVALID_CHANNEL",
            message: `Canal inválido. Debe ser uno de: ${VALID_CHANNELS.join(", ")}.`,
          },
        },
        { status: 400 }
      );
    }

    const cleanPhone = phone ? String(phone).trim() : null;

    // 1. Verificar si ya existe binding con mismo client_id, external_id y channel
    const { data: existingBinding } = await (serviceClient.from("client_id_bindings") as any)
      .select("id, is_active")
      .eq("client_id", clientId)
      .eq("external_id", cleanExternalId)
      .eq("channel", cleanChannel)
      .maybeSingle();

    if (existingBinding) {
      // Regla: Si ya existe el mismo external_id+channel activo → 409
      if (existingBinding.is_active) {
        return NextResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: `Ya existe un binding activo para external_id '${cleanExternalId}' en el canal '${cleanChannel}'.`,
            },
          },
          { status: 409 }
        );
      }

      // Si existía inactivo, reactivarlo con los datos actualizados
      const { data: reactivated, error: reactivateErr } = await (serviceClient.from("client_id_bindings") as any)
        .update({
          phone: cleanPhone,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingBinding.id)
        .select("id, client_id, external_id, phone, channel, is_active, created_at, updated_at")
        .single();

      if (reactivateErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: reactivateErr.message } },
          { status: 500 }
        );
      }

      return NextResponse.json(reactivated, { status: 201 });
    }

    // 2. Si no existe, insertar nuevo binding
    const { data: newBinding, error: insertErr } = await (serviceClient.from("client_id_bindings") as any)
      .insert({
        client_id: clientId,
        external_id: cleanExternalId,
        phone: cleanPhone,
        channel: cleanChannel,
        is_active: true,
      })
      .select("id, client_id, external_id, phone, channel, is_active, created_at, updated_at")
      .single();

    if (insertErr || !newBinding) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al registrar ID binding." } },
        { status: 500 }
      );
    }

    return NextResponse.json(newBinding, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
