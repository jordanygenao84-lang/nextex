import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST(
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
        { error: { code: "NOT_FOUND", message: "Site key no encontrada para este cliente." } },
        { status: 404 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Verificar existencia de la site key perteneciente a este cliente
    const { data: existingKey, error: fetchErr } = await (serviceClient.from("client_site_keys") as any)
      .select("id, name, client_id")
      .eq("id", keyId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (fetchErr || !existingKey) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Site key no encontrada para este cliente." } },
        { status: 404 }
      );
    }

    // 2. Generar nueva clave de 48 caracteres hexadecimales con prefijo ntx_
    const rawHex = randomBytes(24).toString("hex").toLowerCase();
    const fullKey = `ntx_${rawHex}`;
    const keyPrefix = fullKey.slice(0, 12); // e.g., ntx_a1b2c3d4

    // 3. Cifrar con SecretVault autenticado con AAD del cliente
    const aad = `nextex:site-key:${clientId}`;
    const encrypted = SecretVault.encryptValue(fullKey, aad);

    const encryptedKeyJson = JSON.stringify({
      encryptedSecret: encrypted.encryptedSecret,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    });

    // 4. Actualizar registro y asegurar is_active=true
    const { data: updatedKey, error: updateErr } = await (serviceClient.from("client_site_keys") as any)
      .update({
        key_prefix: keyPrefix,
        encrypted_key: encryptedKeyJson,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", keyId)
      .eq("client_id", clientId)
      .select("id, name, key_prefix, is_active, updated_at")
      .single();

    if (updateErr || !updatedKey) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    // 5. Devolver la nueva clave en texto plano SOLO ESTA VEZ
    return NextResponse.json(
      {
        id: updatedKey.id,
        name: updatedKey.name,
        key: fullKey,
        key_prefix: updatedKey.key_prefix,
        warning: "Guárdala ahora, no se mostrará de nuevo",
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." } },
      { status: 500 }
    );
  }
}
