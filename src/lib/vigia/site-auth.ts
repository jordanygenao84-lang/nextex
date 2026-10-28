import { timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";

/**
 * NEXTEХ VIGÍA — Autenticación de Sitios Satélite (VIG-4)
 * Resuelve el client_id validando una clave de sitio (ntx_...)
 * provista en el header `Authorization: Bearer <clave>`.
 *
 * Utiliza el mismo mecanismo del módulo de Conexiones:
 * Clave de 52 caracteres con prefijo de 12 caracteres (ntx_ + 8 hex),
 * almacenada cifrada con AES-256-GCM y AAD `nextex:site-key:${clientId}`.
 */
export async function resolveClientFromSiteKey(
  authHeader: string | null
): Promise<string | null> {
  if (!authHeader || typeof authHeader !== "string") {
    return null;
  }

  // 1. Extraer token Bearer
  const match = authHeader.match(/^Bearer\s+(ntx_[a-f0-9]+)$/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim();
  if (token.length < 16) {
    return null;
  }

  // 2. Extraer prefijo de búsqueda (12 caracteres)
  const keyPrefix = token.slice(0, 12);
  const serviceClient = createServiceClient();

  // 3. Buscar claves activas con ese prefijo
  const { data: keys, error } = await (serviceClient.from("client_site_keys") as any)
    .select("id, client_id, key_prefix, encrypted_key, is_active")
    .eq("key_prefix", keyPrefix)
    .eq("is_active", true);

  if (error || !Array.isArray(keys) || keys.length === 0) {
    return null;
  }

  // 4. Descifrar y validar cada candidato
  for (const keyRecord of keys) {
    try {
      const enc =
        typeof keyRecord.encrypted_key === "string"
          ? JSON.parse(keyRecord.encrypted_key)
          : keyRecord.encrypted_key;

      if (!enc || !enc.encryptedSecret || !enc.iv || !enc.authTag) {
        continue;
      }

      const aad = `nextex:site-key:${keyRecord.client_id}`;
      const decrypted = SecretVault.decryptValue(
        enc.encryptedSecret,
        enc.iv,
        enc.authTag,
        aad
      );

      // BAJO 2026-10-28: comparación en tiempo constante (antes ===).
      if (
        decrypted.length === token.length &&
        timingSafeEqual(Buffer.from(decrypted), Buffer.from(token))
      ) {
        // Actualizar último uso sin bloquear
        (serviceClient.from("client_site_keys") as any)
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", keyRecord.id)
          .then(() => {})
          .catch(() => {});

        return keyRecord.client_id;
      }
    } catch {
      continue;
    }
  }

  return null;
}
