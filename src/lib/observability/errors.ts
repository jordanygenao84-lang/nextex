/**
 * NEXTEХ Observability — Clasificación y Sanitización de Errores
 * Mapeo de excepciones técnicas a códigos y categorías seguras sin fugas de secretos.
 */

import { ErrorCategory } from "./types";

export interface SafeErrorDetails {
  errorCode: string;
  errorCategory: ErrorCategory;
  errorMessageSafe: string;
}

export class ObservabilityErrorClassifier {
  /**
   * Transforma cualquier error en una estructura de diagnóstico segura.
   */
  public static classify(error: unknown): SafeErrorDetails {
    if (!error) {
      return {
        errorCode: "UNKNOWN_ERROR",
        errorCategory: "SYSTEM",
        errorMessageSafe: "Ha ocurrido un error no determinado",
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code || "ERROR";

    // 1. Errores de Seguridad y Autorización
    if (/unauthorized|forbidden|jwt|permission|denied|auth/i.test(message) || code === "401" || code === "403") {
      return {
        errorCode: "AUTHORIZATION_DENIED",
        errorCategory: "SECURITY",
        errorMessageSafe: "Acceso o permiso denegado durante la ejecución",
      };
    }

    // 2. Errores de Validación de Entrada
    if (/validation|invalid|schema|missing parameter|format/i.test(message)) {
      return {
        errorCode: "VALIDATION_ERROR",
        errorCategory: "VALIDATION",
        errorMessageSafe: "Parámetros o payload de entrada inválidos",
      };
    }

    // 3. Timeouts
    if (/timeout|timed out|deadline|exceeded/i.test(message) || code === "ETIMEDOUT") {
      return {
        errorCode: "OPERATION_TIMEOUT",
        errorCategory: "TIMEOUT",
        errorMessageSafe: "Tiempo de espera límite excedido para la operación",
      };
    }

    // 4. Rate Limiting y Cuotas
    if (/rate limit|quota|too many requests|429/i.test(message)) {
      return {
        errorCode: "RATE_LIMIT_EXCEEDED",
        errorCategory: "RATE_LIMIT",
        errorMessageSafe: "Cuota de peticiones o tasa límite excedida",
      };
    }

    // 5. Proveedores Externos (IA / Webhooks / APIs)
    if (/provider|anthropic|openai|google|gemini|bad gateway|502|503/i.test(message)) {
      return {
        errorCode: "PROVIDER_ERROR",
        errorCategory: "PROVIDER",
        errorMessageSafe: "Fallo transitorio en el proveedor de servicio externo",
      };
    }

    // 6. Fencing y Concurrencia de Workers
    if (/fencing|lease lost|lease expired|worker lost/i.test(message)) {
      return {
        errorCode: "JOB_FENCING_REJECTED",
        errorCategory: "GOVERNANCE",
        errorMessageSafe: "Ejecución cancelada por pérdida de lease o cerco de concurrencia",
      };
    }

    // 7. Base de datos
    if (/database|connection|pg_|postgres|sql/i.test(message)) {
      return {
        errorCode: "DATABASE_ERROR",
        errorCategory: "SYSTEM",
        errorMessageSafe: "Error en la persistencia o consulta de base de datos",
      };
    }

    // Fallback general seguro (evitando stack traces crudos)
    const sanitizedSnippet = message
      .replace(/[a-zA-Z0-9_-]{20,}/g, "[REDACTED_TOKEN]")
      .slice(0, 200);

    return {
      errorCode: code !== "ERROR" ? code : "EXECUTION_FAILURE",
      errorCategory: "SYSTEM",
      errorMessageSafe: sanitizedSnippet,
    };
  }
}
