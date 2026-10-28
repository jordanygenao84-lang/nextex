import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";
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

    // Consulta de site keys (NUNCA devolver la clave completa ni encrypted_key)
    const { data: siteKeys, error } = await (serviceClient.from("client_site_keys") as any)
      .select("id, name, key_prefix, is_active, last_used_at, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json(siteKeys || []);
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
    const keyName = body.name?.trim() || "Default Site Key";

    // 1. Generar clave de 48 caracteres hexadecimales con prefijo ntx_
    const rawHex = randomBytes(24).toString("hex").toLowerCase(); // 48 chars hex
    const fullKey = `ntx_${rawHex}`;
    const keyPrefix = fullKey.slice(0, 12); // e.g., ntx_a1b2c3d4

    // 2. Cifrar con SecretVault autenticado con AAD del cliente
    const aad = `nextex:site-key:${clientId}`;
    const encrypted = SecretVault.encryptValue(fullKey, aad);

    const encryptedKeyJson = JSON.stringify({
      encryptedSecret: encrypted.encryptedSecret,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    // 3. Guardar en base de datos
    const { data: newKey, error: insertErr } = await (serviceClient.from("client_site_keys") as any)
      .insert({
        client_id: clientId,
        name: keyName,
        key_prefix: keyPrefix,
        encrypted_key: encryptedKeyJson,
        is_active: true,
      })
      .select("id, name, key_prefix, is_active, created_at")
      .single();

    if (insertErr || !newKey) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: insertErr?.message || "Error al crear site key." } },
        { status: 500 }
      );
    }

    // 4. Responder con la clave en texto plano SOLO ESTA VEZ
    return NextResponse.json(
      {
        id: newKey.id,
        name: newKey.name,
        key: fullKey,
        key_prefix: newKey.key_prefix,
        warning: "Guárdala ahora, no se mostrará de nuevo",
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
