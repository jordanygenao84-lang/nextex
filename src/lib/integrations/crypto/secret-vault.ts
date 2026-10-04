/**
 * NEXTEХ Integration Gateway — Secret Vault (Fase 4.7.1)
 * Cifrado simétrico autenticado AES-256-GCM con AAD por endpoint.
 * El secreto HMAC jamás se almacena en texto plano en PostgreSQL.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";

export interface EncryptedSecretPayload {
  encryptedSecret: string;
  iv: string;
  authTag: string;
  secretReference: string;
  displaySecret: string;
}

export class SecretVault {
  /**
   * Obtiene y valida la clave maestra del entorno server-side (256 bits / 64 hex chars).
   */
  public static getMasterKey(): Buffer {
    const rawKey = process.env.INTEGRATION_KEY_ENCRYPTION_SECRET;
    if (!rawKey) {
      throw new Error("FATAL: Variable de entorno INTEGRATION_KEY_ENCRYPTION_SECRET no configurada.");
    }
    if (!/^[0-9a-fA-F]{64}$/.test(rawKey.trim())) {
      throw new Error(
        "FATAL: INTEGRATION_KEY_ENCRYPTION_SECRET debe ser una cadena hexadecimal válida de exactamente 64 caracteres (256 bits)."
      );
    }
    return Buffer.from(rawKey.trim(), "hex");
  }

  /**
   * Genera un secreto HMAC de 32 bytes CSPRNG y lo cifra con AES-256-GCM y AAD.
   */
  public static generateAndEncryptSecret(endpointId: string): EncryptedSecretPayload {
    if (!endpointId || !/^[0-9a-fA-F-]{36}$/.test(endpointId.trim())) {
      throw new Error("INVALID_ENDPOINT_ID: Se requiere un UUID válido para vincular el AAD.");
    }

    const masterKey = this.getMasterKey();
    const rawSecret = randomBytes(32);
    const displaySecret = rawSecret.toString("hex").toLowerCase();
    const iv = randomBytes(12); // 96 bits recomendado para GCM

    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const aad = `nextex:integration-endpoint:${endpointId.trim()}`;
    cipher.setAAD(Buffer.from(aad, "utf8"));

    let encrypted = cipher.update(displaySecret, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const secretReference = `sec_ref_${createHash("sha256").update(displaySecret).digest("hex").substring(0, 24)}`;

    return {
      encryptedSecret: encrypted,
      iv: iv.toString("hex"),
      authTag,
      secretReference,
      displaySecret,
    };
  }

  /**
   * Descifra el secreto en memoria para verificación temporal en el gateway.
   */
  public static decryptSecret(
    endpointId: string,
    encryptedSecret: string,
    ivHex: string,
    authTagHex: string
  ): string {
    if (!endpointId || !/^[0-9a-fA-F-]{36}$/.test(endpointId.trim())) {
      throw new Error("INVALID_ENDPOINT_ID: UUID inválido para AAD de descifrado.");
    }
    if (!ivHex || !/^[0-9a-fA-F]{24}$/.test(ivHex.trim())) {
      throw new Error("INVALID_IV: El vector de inicialización debe ser exactamente 24 caracteres hex (12 bytes).");
    }
    if (!authTagHex || !/^[0-9a-fA-F]{32}$/.test(authTagHex.trim())) {
      throw new Error("INVALID_AUTH_TAG: El auth tag de autenticación debe ser exactamente 32 caracteres hex (16 bytes).");
    }
    if (!encryptedSecret || encryptedSecret.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encryptedSecret.trim())) {
      throw new Error("INVALID_CIPHERTEXT: El texto cifrado debe ser una cadena hexadecimal no vacía de longitud par.");
    }

    const masterKey = this.getMasterKey();
    const iv = Buffer.from(ivHex.trim(), "hex");
    const authTag = Buffer.from(authTagHex.trim(), "hex");

    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    const aad = `nextex:integration-endpoint:${endpointId.trim()}`;
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedSecret.trim(), "hex", "utf8");
    decrypted += decipher.final("utf8");

    if (!/^[0-9a-fA-F]{64}$/.test(decrypted)) {
      throw new Error("CORRUPTED_SECRET: El secreto descifrado no tiene el formato canónico esperado de 64 caracteres hex.");
    }

    return decrypted;
  }
}
