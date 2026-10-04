/**
 * NEXTEХ (Nexora Texter) — Audit Subsystem & Immutability Manager (Fase 4.10-H)
 * Autoridad canónica de auditoría inmutable, append-only y sanitización profunda
 * para todas las entidades del Control Plane.
 */

import { randomUUID } from "crypto";
import {
  AuditEvent,
  GovernanceActorType,
  GovernanceResourceType,
  ControlPlaneDecision,
  ControlPlaneError,
} from "./types";

/**
 * Determina si una clave de metadatos representa un secreto que debe redactarse.
 * Protege campos legítimos como 'normal_key', 'sort_key', 'key_id', 'cache_key'.
 */
export function isSensitiveKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;

  // Normalizar camelCase a snake_case y reemplazar guiones medios por guiones bajos
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/-/g, "_");

  const exactSensitive = new Set([
    "password",
    "passwd",
    "pwd",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "api_key",
    "apikey",
    "service_role",
    "authorization",
    "auth_header",
    "cookie",
    "session",
    "credential",
    "credentials",
    "private_key",
    "webhook_secret",
    "encryption_key",
    "secret_key",
    "access_key",
    "client_secret",
    "api_secret",
    "signing_key",
    "signing_secret",
  ]);

  if (exactSensitive.has(normalized)) return true;

  if (
    normalized.endsWith("_password") ||
    normalized.endsWith("_secret") ||
    normalized.endsWith("_token") ||
    normalized.startsWith("api_key") ||
    normalized.startsWith("apikey") ||
    normalized.endsWith("_key_secret") ||
    normalized.includes("private_key") ||
    normalized.includes("encryption_key") ||
    normalized.includes("webhook_secret") ||
    normalized.includes("service_role")
  ) {
    return true;
  }

  return false;
}

/**
 * Sanitiza recursivamente cualquier estructura de datos (objetos, arrays, primitivos).
 * Redacta credenciales independientemente del formato (camelCase, snake_case, kebab-case).
 */
export function sanitizeAuditMetadata(val: any): any {
  if (val === null || val === undefined) return val;

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeAuditMetadata(item));
  }

  if (typeof val === "object" && !(val instanceof Date)) {
    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (isSensitiveKey(k)) {
        sanitized[k] = "[REDACTED]";
      } else if (v && typeof v === "object") {
        sanitized[k] = sanitizeAuditMetadata(v);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  return val;
}

export interface AuditManagerConfig {
  workspaceId?: string;
  supabaseClient?: any;
}

export class AuditManager {
  private readonly workspaceId?: string;
  private readonly supabaseClient?: any;

  // Almacén in-memory determinista para auditoría append-only
  private readonly events: Map<string, AuditEvent> = new Map();
  private readonly idempotencyIndex: Map<string, string> = new Map(); // key: `${workspaceId}:${idempotencyKey}` -> event_id
  private readonly rateLimitTracker: Map<string, number[]> = new Map(); // key: `${workspaceId}:${actorId}` -> timestamps[]

  constructor(config: AuditManagerConfig = {}) {
    this.workspaceId = config.workspaceId;
    this.supabaseClient = config.supabaseClient;
  }

  /**
   * Sanitiza metadatos de auditoría antes de persistir.
   */
  public sanitize(data: any): any {
    return sanitizeAuditMetadata(data);
  }

  /**
   * Registra un evento de auditoría canónico de forma estrictamente append-only.
   * Garantiza idempotencia basada en idempotency_key.
   */
  public async recordEvent(params: {
    eventId?: string;
    workspaceId: string;
    actorId: string;
    actorType: GovernanceActorType;
    action: string;
    resourceType: GovernanceResourceType;
    resourceId: string;
    decision: ControlPlaneDecision;
    reason?: string;
    correlationId?: string;
    traceId?: string;
    fencingToken?: bigint | number | string;
    idempotencyKey?: string;
    metadata?: Record<string, any>;
    createdAt?: string;
  }): Promise<AuditEvent> {
    const {
      eventId = randomUUID(),
      workspaceId,
      actorId,
      actorType,
      action,
      resourceType,
      resourceId,
      decision,
      reason,
      correlationId,
      traceId,
      fencingToken,
      idempotencyKey,
      metadata = {},
      createdAt = new Date().toISOString(),
    } = params;

    if (!workspaceId) {
      throw new ControlPlaneError("workspaceId es obligatorio para registrar auditoría", "AUTHORIZATION");
    }

    if (this.workspaceId && this.workspaceId !== workspaceId) {
      throw new ControlPlaneError(
        `Violación de frontera de tenant (AuditManager ws: '${this.workspaceId}' vs Params ws: '${workspaceId}')`,
        "AUTHORIZATION"
      );
    }

    // Idempotencia: si ya existe un evento para esta clave de idempotencia, retornar snapshot sellado
    if (idempotencyKey) {
      const idxKey = `${workspaceId}:${idempotencyKey}`;
      const existingId = this.idempotencyIndex.get(idxKey);
      if (existingId) {
        const existingEvent = this.events.get(existingId);
        if (existingEvent) {
          return existingEvent;
        }
      }
    }

    // Rate limiting tracking
    this.recordRateLimitActivity(workspaceId, actorId);

    const sanitizedMeta = sanitizeAuditMetadata(metadata);

    const auditEvent: AuditEvent = Object.freeze({
      event_id: eventId,
      workspace_id: workspaceId,
      actor_id: actorId,
      actor_type: actorType,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      decision,
      reason,
      correlation_id: correlationId,
      trace_id: traceId,
      fencing_token: fencingToken,
      idempotency_key: idempotencyKey,
      metadata: sanitizedMeta,
      created_at: createdAt,
    });

    this.events.set(eventId, auditEvent);

    if (idempotencyKey) {
      this.idempotencyIndex.set(`${workspaceId}:${idempotencyKey}`, eventId);
    }

    // Persistir en Supabase si el cliente está disponible
    if (this.supabaseClient) {
      try {
        await (this.supabaseClient.from("control_plane_audit_log") as any).insert({
          event_id: auditEvent.event_id,
          workspace_id: auditEvent.workspace_id,
          actor_id: auditEvent.actor_id,
          actor_type: auditEvent.actor_type,
          action: auditEvent.action,
          resource_type: auditEvent.resource_type,
          resource_id: auditEvent.resource_id,
          decision: auditEvent.decision,
          reason: auditEvent.reason || null,
          correlation_id: auditEvent.correlation_id || null,
          trace_id: auditEvent.trace_id || null,
          fencing_token: auditEvent.fencing_token !== undefined ? Number(auditEvent.fencing_token) : null,
          idempotency_key: auditEvent.idempotency_key || null,
          metadata: auditEvent.metadata,
          created_at: auditEvent.created_at,
        });
      } catch {
        // Fallback silencioso para persistencia remota
      }
    }

    return auditEvent;
  }

  /**
   * Intento de mutación (UPDATE): Estrictamente rechazado (H12).
   */
  public async updateEvent(eventId: string, updates: any): Promise<never> {
    throw new ControlPlaneError(
      "UPDATE rejected on audit event: audit log is strictly append-only (Error 55000)",
      "AUTHORIZATION"
    );
  }

  /**
   * Intento de eliminación (DELETE): Estrictamente rechazado (H13).
   */
  public async deleteEvent(eventId: string): Promise<never> {
    throw new ControlPlaneError(
      "DELETE rejected on audit event: audit log is strictly append-only (Error 55000)",
      "AUTHORIZATION"
    );
  }

  /**
   * Intento de reabrir evento terminal: Estrictamente rechazado (H14).
   */
  public async reopenTerminalEvent(eventId: string): Promise<never> {
    throw new ControlPlaneError(
      "Cannot reopen terminal audit event: terminal events are immutable",
      "AUTHORIZATION"
    );
  }

  /**
   * Intento de modificar actor retrospectivamente: Rechazado (H15).
   */
  public async modifyActor(eventId: string, newActorId: string): Promise<never> {
    throw new ControlPlaneError(
      "Modifying actor retrospectively is strictly prohibited",
      "AUTHORIZATION"
    );
  }

  /**
   * Consulta eventos de auditoría con validación rigurosa de frontera de tenant (H14, H16, H46).
   */
  public async queryAuditEvents(params: {
    callerWorkspaceId: string;
    targetWorkspaceId: string;
    callerRole?: string;
    callerId?: string;
    correlationId?: string;
    traceId?: string;
    resourceType?: GovernanceResourceType;
    resourceId?: string;
    action?: string;
    limit?: number;
  }): Promise<AuditEvent[]> {
    const {
      callerWorkspaceId,
      targetWorkspaceId,
      callerRole = "member",
      callerId,
      correlationId,
      traceId,
      resourceType,
      resourceId,
      action,
      limit = 100,
    } = params;

    if (!callerWorkspaceId || !targetWorkspaceId) {
      throw new ControlPlaneError("Identificadores de workspace requeridos para consulta de auditoría", "AUTHORIZATION");
    }

    // Aislamiento Multi-Tenant Estricto (H14, H16, H46)
    if (callerWorkspaceId !== targetWorkspaceId) {
      throw new ControlPlaneError(
        `TENANT_MISMATCH: Usuario de workspace '${callerWorkspaceId}' no puede consultar auditoría de workspace '${targetWorkspaceId}'`,
        "AUTHORIZATION"
      );
    }

    // Autoridad de Rol (H14): Owner y Admin tienen acceso completo; Member restringido a sus propios eventos
    const isPrivileged = callerRole === "owner" || callerRole === "admin";

    let results = Array.from(this.events.values()).filter(
      (e) => e.workspace_id === targetWorkspaceId
    );

    if (!isPrivileged && callerId) {
      results = results.filter((e) => e.actor_id === callerId);
    }

    if (correlationId) {
      results = results.filter((e) => e.correlation_id === correlationId);
    }

    if (traceId) {
      results = results.filter((e) => e.trace_id === traceId);
    }

    if (resourceType) {
      results = results.filter((e) => e.resource_type === resourceType);
    }

    if (resourceId) {
      results = results.filter((e) => e.resource_id === resourceId);
    }

    if (action) {
      results = results.filter((e) => e.action === action);
    }

    results.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return results.slice(0, limit);
  }

  /**
   * Reconstruye la cadena forense completa de una operación por correlation_id (H21, H47).
   */
  public async reconstructForensicChain(
    correlationId: string,
    workspaceId: string
  ): Promise<AuditEvent[]> {
    if (!correlationId || !workspaceId) return [];

    const chain = Array.from(this.events.values())
      .filter((e) => e.workspace_id === workspaceId && e.correlation_id === correlationId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    return chain;
  }

  /**
   * Evalúa y registra actividad para control de tasa y abuso (H15).
   */
  public checkRateLimit(workspaceId: string, actorId: string, limit: number = 100): boolean {
    const key = `${workspaceId}:${actorId}`;
    const now = Date.now();
    const windowMs = 60_000;

    let timestamps = this.rateLimitTracker.get(key) || [];
    timestamps = timestamps.filter((t) => now - t < windowMs);
    this.rateLimitTracker.set(key, timestamps);

    return timestamps.length <= limit;
  }

  private recordRateLimitActivity(workspaceId: string, actorId: string): void {
    const key = `${workspaceId}:${actorId}`;
    const now = Date.now();
    const timestamps = this.rateLimitTracker.get(key) || [];
    timestamps.push(now);
    this.rateLimitTracker.set(key, timestamps);
  }
}
