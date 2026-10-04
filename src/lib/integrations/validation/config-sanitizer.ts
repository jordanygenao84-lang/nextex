/**
 * NEXTEХ Integration Config Sanitizer (Fase 4.7.1 Hardened)
 * Validación recursiva estricta que impide almacenar credenciales o secretos en integrations.config.
 * Normalización canónica de claves: minúsculas sin guiones, guiones bajos ni espacios.
 */

const FORBIDDEN_CANONICAL_KEYS = new Set([
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey",
  "secret",
  "secrets",
  "password",
  "passwd",
  "credential",
  "credentials",
  "webhooksecret",
  "signingsecret",
  "encryptionkey",
  "masterkey",
  "authorization",
  "bearertoken",
  "token",
  "tokens",
  "cookie",
  "sessiontoken",
  "hmacsecret",
  "signingkey",
  "encryptionsecret",
]);

const FORBIDDEN_STEMS = [
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "bearertoken",
  "webhooksecret",
  "signingsecret",
  "encryptionkey",
  "masterkey",
  "privatekey",
  "hmacsecret",
  "signingkey",
  "encryptionsecret",
  "sessiontoken",
];

export interface ConfigValidationResult {
  valid: boolean;
  violationKey?: string;
  errorMessage?: string;
}

export class ConfigSanitizer {
  /**
   * Normaliza una clave a su forma canónica: minúsculas, sin guiones, guiones bajos ni espacios.
   */
  public static canonicalizeKey(key: string): string {
    return key.toLowerCase().replace(/[-_\s]/g, "");
  }

  /**
   * Evalúa si una clave normalizada infringe las políticas de seguridad.
   */
  public static isForbiddenKey(rawKey: string): boolean {
    const canonical = this.canonicalizeKey(rawKey);

    if (FORBIDDEN_CANONICAL_KEYS.has(canonical)) {
      return true;
    }

    // Detección por subcadenas sensibles (e.g. "my_api_key", "github_webhook_secret")
    for (const stem of FORBIDDEN_STEMS) {
      if (canonical.includes(stem)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Inspecciona recursivamente un objeto o array en búsqueda de claves prohibidas.
   */
  public static validate(config: unknown): ConfigValidationResult {
    if (!config || typeof config !== "object") {
      return { valid: true };
    }

    if (Array.isArray(config)) {
      for (const item of config) {
        const res = this.validate(item);
        if (!res.valid) return res;
      }
      return { valid: true };
    }

    const record = config as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (this.isForbiddenKey(key)) {
        return {
          valid: false,
          violationKey: key,
          errorMessage: `CONFIG_CONTAINS_FORBIDDEN_KEYS: La clave "${key}" está prohibida en integrations.config por políticas de seguridad.`,
        };
      }

      if (value && typeof value === "object") {
        const nestedRes = this.validate(value);
        if (!nestedRes.valid) return nestedRes;
      }
    }

    return { valid: true };
  }
}
