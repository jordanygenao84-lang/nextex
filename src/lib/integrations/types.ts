/**
 * NEXTEХ Integration Gateway & External Event Engine — Tipos Formales (Fase 4.7.1)
 * Contrato estricto de entidades, estados, verificación HMAC y trazabilidad.
 */

export type IntegrationStatus = "draft" | "active" | "paused" | "revoked" | "archived";
export type IntegrationType = "inbound_webhook";

export const GLOBAL_MAX_PAYLOAD = 1048576; // 1 MB límite máximo absoluto
export const MAX_PAYLOAD_BYTES = 1048576; // 1 MB límite máximo estricto
export const DEFAULT_PAYLOAD_LIMIT = 262144; // 256 KB límite por defecto
export const DEFAULT_REPLAY_WINDOW_SECONDS = 300; // 300 segundos (5 min) por defecto

export interface Integration {
  id: string;
  workspace_id: string;
  name: string;
  provider: string;
  integration_type: IntegrationType;
  status: IntegrationStatus;
  config: Record<string, any>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type EndpointStatus = "active" | "disabled";
export type VerificationMethod = "hmac_sha256";

export interface IntegrationEndpoint {
  id: string;
  integration_id: string;
  workspace_id: string;
  name: string;
  endpoint_key: string; // 64 chars hex (32 bytes CSPRNG)
  event_types: Record<string, string>; // Mapeo server-side: { [eventType: string]: string (job_id) }
  verification_method: VerificationMethod;
  secret_reference: string; // Referencia opaca de credencial, nunca el secreto en plano
  encrypted_secret: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  secondary_encrypted_secret: string | null;
  secondary_encryption_iv: string | null;
  secondary_encryption_auth_tag: string | null;
  secondary_secret_expires_at: string | null;
  status: EndpointStatus;
  replay_window_seconds: number;
  max_payload_bytes: number;
  created_at: string;
  updated_at: string;
}

export type EventStatus =
  | "received"
  | "verified"
  | "rejected"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "duplicate"
  | "quarantined";

export interface IntegrationEvent {
  id: string;
  workspace_id: string;
  integration_id: string;
  endpoint_id: string;
  external_event_id: string;
  event_type: string;
  provider: string;
  payload: Record<string, any>;
  headers_metadata: Record<string, any>;
  payload_hash: string;
  signature_verified: boolean;
  status: EventStatus;
  job_id: string | null;
  job_run_id: string | null; // Job Run más reciente / actual
  quarantine_reason: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationEventAttempt {
  id: string;
  event_id: string;
  attempt: number;
  job_run_id: string | null;
  status: "started" | "succeeded" | "failed" | "skipped";
  error_code: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export type IntegrationAuditActorType = "system" | "gateway" | "user" | "worker";

export interface IntegrationEventAuditLog {
  id: string;
  workspace_id: string;
  event_id: string | null;
  operation: string;
  actor_type: IntegrationAuditActorType;
  actor_id: string;
  metadata: Record<string, any>;
  created_at: string;
}

// Inbound Headers & Protocol
export interface InboundHeaders {
  timestamp: string;
  signature: string;
  eventId: string;
}

export interface HMACVerificationResult {
  valid: boolean;
  errorCode?: "MISSING_HEADERS" | "INVALID_TIMESTAMP" | "TIMESTAMP_OUT_OF_WINDOW" | "INVALID_SIGNATURE";
  errorMessage?: string;
  payloadHash?: string;
  signedPayload?: string;
}

// DTOs
export interface CreateIntegrationDTO {
  name: string;
  provider?: string;
  integration_type?: IntegrationType;
  config?: Record<string, any>;
}

export interface UpdateIntegrationDTO {
  name?: string;
  config?: Record<string, any>;
}

export interface CreateEndpointDTO {
  name: string;
  event_types?: Record<string, string>;
  verification_method?: VerificationMethod;
  replay_window_seconds?: number;
  max_payload_bytes?: number;
}

export interface UpdateEndpointDTO {
  name?: string;
  event_types?: Record<string, string>;
  status?: EndpointStatus;
  replay_window_seconds?: number;
  max_payload_bytes?: number;
}

export interface RotateEndpointSecretDTO {
  grace_period_seconds?: number;
}
