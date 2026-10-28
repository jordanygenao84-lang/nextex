import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/[id]/widgets
 * Lista todos los widgets configurados para un cliente (con auth).
 * El embed_key sí se muestra porque es el propietario/administrador.
 */
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

    // 2. Consultar widgets del cliente
    const { data: widgets, error } = await (serviceClient.from("client_widgets") as any)
      .select("id, client_id, name, embed_key, allowed_sources, theme, greeting, is_active, created_at, updated_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(widgets || []);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/clients/[id]/widgets
 * Crea un nuevo widget para el cliente y genera su embed_key aleatorio único (wdg_<32 hex>).
 */
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
    const { name, greeting, theme, allowed_sources } = body;

    // 2. Generar embed_key aleatorio con formato wdg_<32 hex>
    const randomHex = randomBytes(16).toString("hex").toLowerCase(); // 32 hex chars
    const embedKey = `wdg_${randomHex}`;

    const widgetName = name?.trim() || "Widget Web";
    const widgetGreeting = greeting?.trim() || "¡Hola! ¿En qué podemos ayudarte hoy?";
    const widgetTheme = theme && typeof theme === "object" ? theme : { primaryColor: "#4f46e5" };
    const widgetSources = Array.isArray(allowed_sources) ? allowed_sources : ["web"];

    // 3. Insertar widget
    const { data: newWidget, error: insertErr } = await (serviceClient.from("client_widgets") as any)
      .insert({
        client_id: clientId,
        name: widgetName,
        embed_key: embedKey,
        greeting: widgetGreeting,
        theme: widgetTheme,
        allowed_sources: widgetSources,
        is_active: true,
      })
      .select("id, client_id, name, embed_key, allowed_sources, theme, greeting, is_active, created_at, updated_at")
      .single();

    if (insertErr || !newWidget) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(newWidget, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
