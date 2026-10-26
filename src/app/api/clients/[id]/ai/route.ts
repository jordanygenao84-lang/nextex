import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

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

    let { data: config } = await (serviceClient.from("client_ai_config") as any)
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (!config) {
      const { data: newConfig, error: insertErr } = await (serviceClient.from("client_ai_config") as any)
        .insert({
          client_id: clientId,
          mode: "nextex_keys",
          default_model: "gemini-1.5-flash",
          model_allowlist: ["gemini-1.5-flash", "gemini-1.5-pro"],
          monthly_token_cap: null,
        })
        .select()
        .single();

      if (insertErr) {
        return NextResponse.json(
          { error: { code: "DB_ERROR", message: insertErr.message } },
          { status: 500 }
        );
      }
      config = newConfig;
    }

    const { data: keys, error: keysErr } = await (serviceClient.from("client_api_keys") as any)
      .select("id, provider, label, key_hint, is_active, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (keysErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: keysErr.message } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      config,
      keys: keys || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al obtener configuración de IA." } },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
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
    const { mode, default_model, model_allowlist, monthly_token_cap } = body;

    if (mode !== undefined && mode !== "nextex_keys" && mode !== "byok") {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El modo debe ser 'nextex_keys' o 'byok'." } },
        { status: 400 }
      );
    }

    let { data: existingConfig } = await (serviceClient.from("client_ai_config") as any)
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (!existingConfig) {
      const { data: initialConfig } = await (serviceClient.from("client_ai_config") as any)
        .insert({
          client_id: clientId,
          mode: "nextex_keys",
          default_model: "gemini-1.5-flash",
          model_allowlist: ["gemini-1.5-flash", "gemini-1.5-pro"],
          monthly_token_cap: null,
        })
        .select()
        .single();
      existingConfig = initialConfig;
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (mode !== undefined) updates.mode = mode;
    if (default_model !== undefined) updates.default_model = default_model;
    if (model_allowlist !== undefined) updates.model_allowlist = model_allowlist;
    if (monthly_token_cap !== undefined) updates.monthly_token_cap = monthly_token_cap;

    const { data: updatedConfig, error: updateErr } = await (serviceClient.from("client_ai_config") as any)
      .update(updates)
      .eq("client_id", clientId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    const auditAction = mode !== undefined && mode !== existingConfig?.mode ? "mode_changed" : "config_updated";

    await (serviceClient.from("client_ai_audit") as any).insert({
      client_id: clientId,
      changed_by: user.id,
      action: auditAction,
      details: {
        antes: existingConfig,
        después: updatedConfig,
        despues: updatedConfig,
      },
    });

    return NextResponse.json(updatedConfig);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al actualizar configuración de IA." } },
      { status: 500 }
    );
  }
}
