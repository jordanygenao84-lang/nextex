/**
 * NEXTEХ OmniEngine — Códigos de error canónicos y clases de excepción
 */

export const OmniErrorCodes = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  WORKSPACE_FORBIDDEN: "WORKSPACE_FORBIDDEN",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  MODEL_NOT_FOUND: "MODEL_NOT_FOUND",
  MODEL_NOT_CONFIGURED: "MODEL_NOT_CONFIGURED",
  CAPABILITY_UNSUPPORTED: "CAPABILITY_UNSUPPORTED",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  INVALID_REQUEST: "INVALID_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type OmniErrorCode = (typeof OmniErrorCodes)[keyof typeof OmniErrorCodes];

export interface OmniErrorDetails {
  code: OmniErrorCode;
  message: string;
  statusCode: number;
  provider?: string;
  model?: string;
  retryable?: boolean;
}

export class OmniEngineError extends Error {
  public readonly code: OmniErrorCode;
  public readonly statusCode: number;
  public readonly provider?: string;
  public readonly model?: string;
  public readonly retryable: boolean;

  constructor(details: OmniErrorDetails) {
    super(details.message);
    this.name = "OmniEngineError";
    this.code = details.code;
    this.statusCode = details.statusCode;
    this.provider = details.provider;
    this.model = details.model;
    this.retryable = details.retryable ?? false;

    // Prevenir fuga de stack traces sensibles en producción
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OmniEngineError);
    }
  }

  public toJSON(): OmniErrorDetails {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      provider: this.provider,
      model: this.model,
      retryable: this.retryable,
    };
  }
}
