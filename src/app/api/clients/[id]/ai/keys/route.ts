import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";

export const dynamic = "force-dynamic";

async function validateProviderApiKey(provider: "openai" | "google" | "anthropic", apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });
      return res.status === 200;
    }

    if (provider === "google") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
        method: "GET",
        signal: controller.signal,
      });
      return res.status === 200;
    }

    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
        signal: controller.signal,
      });
      return res.status === 200;
    }

    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
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
    const serviceClient = createServiceClient();

    const { data: client, error: clientErr } = await (serviceClient.from("clients") as any)
      .select("id")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { provider, label, api_key } = body;

    if (!provider || !["openai", "google", "anthropic"].includes(provider)) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El proveedor debe ser 'openai', 'google' o 'anthropic'." } },
        { status: 400 }
      );
    }

    if (!api_key || typeof api_key !== "string" || !api_key.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'api_key' es requerido." } },
        { status: 400 }
      );
    }

    const cleanApiKey = api_key.trim();

    // 1. Validar la key contra la API externa (timeout 15s)
    const isValid = await validateProviderApiKey(provider, cleanApiKey);
    if (!isValid) {
      return NextResponse.json(
        { error: `La clave no es válida para ${provider}` },
        { status: 400 }
      );
    }

    // 2. Cifrar con SecretVault.encryptValue
    const aad = `nextex:client-key:${clientId}:${provider}`;
    const encrypted = SecretVault.encryptValue(cleanApiKey, aad);

    const encryptedKeyJson = JSON.stringify({
      encryptedSecret: encrypted.encryptedSecret,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    const keyHint = cleanApiKey.slice(-4);
    const keyLabel = label?.trim() || `${provider.toUpperCase()} Key`;

    const { data: newKey, error: insertErr } = await (serviceClient.from("client_api_keys") as any)
      .insert({
        client_id: clientId,
        provider,
        label: keyLabel,
        encrypted_key: encryptedKeyJson,
        key_hint: keyHint,
        is_active: true,
      })
      .select("id, provider, label, key_hint, is_active, created_at")
      .single();

    if (insertErr || !newKey) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al registrar la clave." } },
        { status: 500 }
      );
    }

    // 3. Registrar auditoría 'key_added'
    await (serviceClient.from("client_ai_audit") as any).insert({
      client_id: clientId,
      changed_by: user.id,
      action: "key_added",
      details: {
        key_id: newKey.id,
        provider,
        label: newKey.label,
        key_hint: keyHint,
      },
    });

    return NextResponse.json(
      {
        id: newKey.id,
        provider: newKey.provider,
        label: newKey.label,
        key_hint: newKey.key_hint,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al registrar clave de API." } },
      { status: 500 }
    );
  }
}
