/**
 * NEXTEХ Integration Engine (Fase 4.7.1)
 * Orquestación central de integraciones, endpoints opacos, cifrado con AAD, ingestión atómica y reintentos.
 */

import { randomBytes, randomUUID } from "crypto";
import {
  Integration,
  IntegrationEndpoint,
  CreateIntegrationDTO,
  UpdateIntegrationDTO,
  CreateEndpointDTO,
  UpdateEndpointDTO,
  IntegrationStatus,
} from "./types";
import { SecretVault } from "./crypto/secret-vault";

export class IntegrationEngine {
  /**
   * Genera un endpoint_key criptográficamente impredecible (32 bytes CSPRNG hex, 64 chars).
   */
  public generateEndpointKey(): string {
    return randomBytes(32).toString("hex").toLowerCase();
  }

  /**
   * Valida en la base de datos que todos los jobs mapeados sean válidos y elegibles para webhook.
   */
  public async validateJobMappings(
    eventTypes: Record<string, string> | undefined,
    workspaceId: string,
    supabase: any
  ): Promise<void> {
    if (!eventTypes || Object.keys(eventTypes).length === 0) return;

    for (const [eventType, jobId] of Object.entries(eventTypes)) {
      if (!jobId || typeof jobId !== "string") continue;

      const { data: job, error } = await supabase
        .from("jobs")
        .select("id, workspace_id, trigger_type, status")
        .eq("id", jobId.trim())
        .maybeSingle();

      if (error || !job) {
        throw new Error(
          `INVALID_JOB_MAPPING: El job asignado "${jobId}" para el evento "${eventType}" no existe.`
        );
      }
      if (job.workspace_id !== workspaceId) {
        throw new Error(
          `CROSS_TENANT_MAPPING_VIOLATION: El job "${jobId}" pertenece a otro workspace.`
        );
      }
      if (job.trigger_type !== "webhook") {
        throw new Error(
          `INVALID_JOB_TRIGGER_TYPE: El job "${jobId}" tiene trigger_type = "${job.trigger_type}". Solo se permiten jobs con trigger_type = "webhook".`
        );
      }
      if (job.status !== "active") {
        throw new Error(
          `MAPPED_JOB_NOT_ACTIVE: El job "${jobId}" no se encuentra en estado activo (estado actual: "${job.status}").`
        );
      }
    }
  }

  /**
   * Crea una nueva integración en el workspace.
   */
  public async createIntegration(
    workspaceId: string,
    userId: string,
    dto: CreateIntegrationDTO,
    supabase: any
  ): Promise<Integration> {
    const { data, error } = await supabase
      .from("integrations")
      .insert({
        workspace_id: workspaceId,
        name: dto.name.trim(),
        provider: dto.provider?.trim() || "generic",
        integration_type: dto.integration_type || "inbound_webhook",
        status: "draft",
        config: dto.config || {},
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Integration;
  }

  /**
   * Actualiza metadatos de una integración.
   */
  public async updateIntegration(
    integrationId: string,
    workspaceId: string,
    dto: UpdateIntegrationDTO,
    supabase: any
  ): Promise<Integration> {
    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.config !== undefined) updatePayload.config = dto.config;

    const { data, error } = await supabase
      .from("integrations")
      .update(updatePayload)
      .eq("id", integrationId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as Integration;
  }

  /**
   * Transiciona el estado de una integración (active, paused, revoked, archived).
   */
  public async setIntegrationStatus(
    integrationId: string,
    workspaceId: string,
    status: IntegrationStatus,
    supabase: any
  ): Promise<Integration> {
    const { data, error } = await supabase
      .from("integrations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", integrationId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as Integration;
  }

  /**
   * Registra un nuevo endpoint con cifrado AES-256-GCM y AAD vinculado a su ID.
   */
  public async createEndpoint(
    integrationId: string,
    workspaceId: string,
    dto: CreateEndpointDTO,
    supabase: any
  ): Promise<{ endpoint: IntegrationEndpoint; plainSecret: string }> {
    // 1. Validar jobs mapeados
    await this.validateJobMappings(dto.event_types, workspaceId, supabase);

    const endpointId = randomUUID();
    const endpointKey = this.generateEndpointKey();

    // 2. Generar y cifrar secreto con AAD
    const encryptedPayload = SecretVault.generateAndEncryptSecret(endpointId);

    const { data, error } = await supabase
      .from("integration_endpoints")
      .insert({
        id: endpointId,
        integration_id: integrationId,
        workspace_id: workspaceId,
        name: dto.name.trim(),
        endpoint_key: endpointKey,
        event_types: dto.event_types || {},
        verification_method: dto.verification_method || "hmac_sha256",
        secret_reference: encryptedPayload.secretReference,
        encrypted_secret: encryptedPayload.encryptedSecret,
        encryption_iv: encryptedPayload.iv,
        encryption_auth_tag: encryptedPayload.authTag,
        status: "active",
        replay_window_seconds: dto.replay_window_seconds || 300,
        max_payload_bytes: dto.max_payload_bytes || 262144,
      })
      .select()
      .single();

    if (error) throw error;
    return { endpoint: data as IntegrationEndpoint, plainSecret: encryptedPayload.displaySecret };
  }

  /**
   * Actualiza la configuración de un endpoint.
   */
  public async updateEndpoint(
    endpointId: string,
    workspaceId: string,
    dto: UpdateEndpointDTO,
    supabase: any
  ): Promise<IntegrationEndpoint> {
    if (dto.event_types !== undefined) {
      await this.validateJobMappings(dto.event_types, workspaceId, supabase);
    }

    const updatePayload: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updatePayload.name = dto.name.trim();
    if (dto.event_types !== undefined) updatePayload.event_types = dto.event_types;
    if (dto.status !== undefined) updatePayload.status = dto.status;
    if (dto.replay_window_seconds !== undefined) updatePayload.replay_window_seconds = dto.replay_window_seconds;
    if (dto.max_payload_bytes !== undefined) updatePayload.max_payload_bytes = dto.max_payload_bytes;

    const { data, error } = await supabase
      .from("integration_endpoints")
      .update(updatePayload)
      .eq("id", endpointId)
      .eq("workspace_id", workspaceId)
      .select()
      .single();

    if (error) throw error;
    return data as IntegrationEndpoint;
  }

  /**
   * Rota transaccionalmente el secreto de un endpoint.
   */
  public async rotateEndpointSecret(
    endpointId: string,
    workspaceId: string,
    gracePeriodSeconds: number = 86400,
    supabase: any
  ): Promise<{ newPlainSecret: string; secretReference: string }> {
    const encryptedPayload = SecretVault.generateAndEncryptSecret(endpointId);

    const { data, error } = await supabase.rpc("rotate_integration_endpoint_secret", {
      p_endpoint_id: endpointId,
      p_new_encrypted_secret: encryptedPayload.encryptedSecret,
      p_new_iv: encryptedPayload.iv,
      p_new_auth_tag: encryptedPayload.authTag,
      p_new_secret_reference: encryptedPayload.secretReference,
      p_grace_period_seconds: gracePeriodSeconds,
    });

    if (error) throw error;
    if (!data.success) {
      throw new Error(data.message || "Error al rotar credencial.");
    }

    return {
      newPlainSecret: encryptedPayload.displaySecret,
      secretReference: encryptedPayload.secretReference,
    };
  }

  /**
   * Resuelve los datos de un endpoint a partir de su clave pública en el gateway.
   */
  public async getEndpointByKey(endpointKey: string, supabase: any): Promise<IntegrationEndpoint | null> {
    const { data, error } = await supabase
      .from("integration_endpoints")
      .select("*")
      .eq("endpoint_key", endpointKey)
      .maybeSingle();

    if (error || !data) return null;
    return data as IntegrationEndpoint;
  }

  /**
   * Ingestión Atómica: Invoca la RPC privada service_role sin p_signature_verified.
   */
  public async ingestEvent(
    params: {
      endpointKey: string;
      externalEventId: string;
      eventType: string;
      provider: string;
      payload: Record<string, any>;
      headersMetadata: Record<string, any>;
      payloadHash: string;
    },
    supabase: any
  ): Promise<any> {
    const { data, error } = await supabase.rpc("ingest_integration_event_atomic", {
      p_endpoint_key: params.endpointKey,
      p_external_event_id: params.externalEventId,
      p_event_type: params.eventType,
      p_provider: params.provider,
      p_payload: params.payload,
      p_headers_metadata: params.headersMetadata,
      p_payload_hash: params.payloadHash,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Cuarentena Atómica: Persiste eventos rechazados sin crear JobRun.
   */
  public async quarantineEvent(
    params: {
      endpointKey: string;
      externalEventId: string;
      eventType: string;
      provider: string;
      headersMetadata: Record<string, any>;
      payloadHash: string;
      quarantineReason: string;
    },
    supabase: any
  ): Promise<any> {
    const { data, error } = await supabase.rpc("quarantine_inbound_event_atomic", {
      p_endpoint_key: params.endpointKey,
      p_external_event_id: params.externalEventId,
      p_event_type: params.eventType,
      p_provider: params.provider,
      p_headers_metadata: params.headersMetadata,
      p_payload_hash: params.payloadHash,
      p_quarantine_reason: params.quarantineReason,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Reintento Atómico: Exclusivo para eventos con status = 'failed'.
   */
  public async retryEvent(eventId: string, supabase: any): Promise<any> {
    const { data, error } = await supabase.rpc("retry_integration_event", {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Reprocesamiento Atómico: Exclusivo para eventos con status in ('received', 'verified').
   */
  public async reprocessEvent(eventId: string, supabase: any): Promise<any> {
    const { data, error } = await supabase.rpc("reprocess_integration_event", {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data;
  }
}

export const defaultIntegrationEngine = new IntegrationEngine();
