import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { defaultGatewayVerifier } from "@/lib/integrations/gateway/verifier";
import { defaultGatewayLimiter } from "@/lib/integrations/gateway/limiter";
import { defaultIntegrationEngine } from "@/lib/integrations/engine";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";
import { GLOBAL_MAX_PAYLOAD } from "@/lib/integrations/types";
import { tracer } from "@/lib/observability/tracer";

export const dynamic = "force-dynamic";

/**
 * Lee el cuerpo HTTP de forma acotada (bounded stream reader) para prevenir DoS por memoria.
 */
async function readBoundedBody(
  req: NextRequest,
  maxBytes: number
): Promise<{ buffer: Buffer; error?: string }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return { buffer: Buffer.alloc(0), error: "PAYLOAD_TOO_LARGE" };
  }

  if (!req.body) {
    return { buffer: Buffer.alloc(0) };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          return { buffer: Buffer.alloc(0), error: "PAYLOAD_TOO_LARGE" };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { buffer: Buffer.alloc(0), error: "STREAM_READ_ERROR" };
  }

  return { buffer: Buffer.concat(chunks) };
}

/**
 * POST /api/inbound/[endpointKey]
 * Gateway público server-side para ingestión segura y duradera de eventos externos.
 * Instrumentado con telemetría fail-safe (Fase 4.8).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { endpointKey: string } }
) {
  let inboundSpan: any = null;

  try {
    const { endpointKey } = params;

    // 1. Validar formato de endpoint_key (64 chars hex)
    if (!endpointKey || endpointKey.length !== 64 || !/^[0-9a-f]{64}$/i.test(endpointKey)) {
      return NextResponse.json({ error: "Endpoint no encontrado o inválido." }, { status: 404 });
    }

    // 2. Fast-drop por rate limiting en memoria
    const rateLimit = defaultGatewayLimiter.checkRateLimit(`ep_${endpointKey}`);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too Many Requests: Límite de tasa excedido para este endpoint." },
        {
          status: 429,
          headers: { "Retry-After": rateLimit.resetSeconds.toString() },
        }
      );
    }

    // 3. Inicializar cliente y resolver endpoint
    const supabase = createServiceClient();
    const endpoint = await defaultIntegrationEngine.getEndpointByKey(endpointKey, supabase);

    if (!endpoint || endpoint.status !== "active") {
      return NextResponse.json({ error: "Endpoint no disponible o inactivo." }, { status: 404 });
    }

    // Iniciar Span de Telemetría Fail-Safe (Fase 4.8)
    const externalTraceHeader = req.headers.get("x-trace-id") || req.headers.get("traceparent");
    inboundSpan = tracer.startSpan({
      name: "webhook.inbound_reception",
      component: "gateway",
      spanType: "integration",
      workspaceId: endpoint.workspace_id,
      integrationId: endpoint.integration_id,
      attributes: {
        endpoint_key_prefix: endpointKey.substring(0, 8),
        external_trace_id_untrusted: externalTraceHeader ? externalTraceHeader.slice(0, 100) : null,
      },
    });

    // 4. Lectura Bounded del Socket HTTP con límite duro
    const effectiveLimit = Math.min(endpoint.max_payload_bytes || 262144, GLOBAL_MAX_PAYLOAD);
    const { buffer: rawBuffer, error: readError } = await readBoundedBody(req, effectiveLimit);

    if (readError === "PAYLOAD_TOO_LARGE") {
      inboundSpan?.end({ status: "failed", error: "PAYLOAD_TOO_LARGE" });
      return NextResponse.json(
        { error: "Payload Too Large: El tamaño excede el límite configurado para el endpoint." },
        { status: 413 }
      );
    }
    if (readError) {
      inboundSpan?.end({ status: "failed", error: "STREAM_READ_ERROR" });
      return NextResponse.json({ error: "Bad Request: Error al procesar el stream del cuerpo." }, { status: 400 });
    }

    // 5. Extraer y validar cabeceras del protocolo formal
    const timestampHeader = req.headers.get("x-nextex-timestamp");
    const signatureHeader = req.headers.get("x-nextex-signature");
    const rawEventId = req.headers.get("x-nextex-event-id");
    const safeHeaders = defaultGatewayLimiter.sanitizeHeaders(req.headers);

    // Validación estricta de X-Nextex-Event-Id
    let eventId = rawEventId?.trim();
    let isEventIdValid = true;

    if (!eventId || !/^[A-Za-z0-9_.:-]{1,255}$/.test(eventId)) {
      isEventIdValid = false;
      eventId = `invalid-evt-${randomUUID()}`;
    }

    const payloadHash = defaultGatewayVerifier.computePayloadHash(rawBuffer);

    // Si el Event ID original es inválido, enviar a cuarentena de inmediato
    if (!isEventIdValid) {
      await defaultIntegrationEngine.quarantineEvent(
        {
          endpointKey,
          externalEventId: eventId,
          eventType: req.headers.get("x-nextex-event-type") || "unknown",
          provider: "webhook",
          headersMetadata: {
            ...safeHeaders,
            invalid_event_id_detected: (rawEventId || "").substring(0, 100),
          },
          payloadHash,
          quarantineReason: "INVALID_EVENT_ID_FORMAT",
        },
        supabase
      );

      inboundSpan?.end({ status: "failed", error: "INVALID_EVENT_ID_FORMAT" });
      return NextResponse.json(
        { error: "Bad Request: Cabecera X-Nextex-Event-Id inválida o ausente." },
        { status: 400 }
      );
    }

    // 6. Descifrado de secreto HMAC con AAD vinculado al endpoint
    let primarySecretHex: string | null = null;
    try {
      primarySecretHex = SecretVault.decryptSecret(
        endpoint.id,
        endpoint.encrypted_secret,
        endpoint.encryption_iv,
        endpoint.encryption_auth_tag
      );
    } catch {
      inboundSpan?.end({ status: "failed", error: "VAULT_DECRYPTION_ERROR" });
      return NextResponse.json({ error: "Internal Gateway Error: Fallo en almacenamiento de credenciales." }, { status: 500 });
    }

    // 7. Verificación criptográfica HMAC-SHA256
    let verification = defaultGatewayVerifier.verifyHMAC({
      secretHex: primarySecretHex,
      timestampHeader,
      signatureHeader,
      eventIdHeader: eventId,
      rawBodyBytes: rawBuffer,
      replayWindowSeconds: endpoint.replay_window_seconds,
    });

    // Soporte para Secreto Secundario durante período de gracia de rotación
    if (
      !verification.valid &&
      verification.errorCode === "INVALID_SIGNATURE" &&
      endpoint.secondary_encrypted_secret &&
      endpoint.secondary_encryption_iv &&
      endpoint.secondary_encryption_auth_tag &&
      endpoint.secondary_secret_expires_at
    ) {
      const expiresAt = new Date(endpoint.secondary_secret_expires_at).getTime();
      if (expiresAt > Date.now()) {
        try {
          const secondarySecretHex = SecretVault.decryptSecret(
            endpoint.id,
            endpoint.secondary_encrypted_secret,
            endpoint.secondary_encryption_iv,
            endpoint.secondary_encryption_auth_tag
          );

          verification = defaultGatewayVerifier.verifyHMAC({
            secretHex: secondarySecretHex,
            timestampHeader,
            signatureHeader,
            eventIdHeader: eventId,
            rawBodyBytes: rawBuffer,
            replayWindowSeconds: endpoint.replay_window_seconds,
          });
        } catch {
          // Ignora fallo secundario y mantiene resultado inicial
        }
      }
    }

    // 8. RUTA DE CUARENTENA si la firma o timestamp fallan
    if (!verification.valid) {
      try {
        await defaultIntegrationEngine.quarantineEvent(
          {
            endpointKey,
            externalEventId: eventId,
            eventType: req.headers.get("x-nextex-event-type") || "unknown",
            provider: "webhook",
            headersMetadata: safeHeaders,
            payloadHash,
            quarantineReason: verification.errorCode || "INVALID_SIGNATURE",
          },
          supabase
        );
      } catch {
        // Fallo en cuarentena silenciado
      }

      inboundSpan?.end({ status: "failed", error: verification.errorCode || "INVALID_SIGNATURE" });
      return NextResponse.json(
        { error: "Unauthorized: Firma o timestamp de evento inválido." },
        { status: 401 }
      );
    }

    // 9. Parsear JSON de forma segura tras validar firma
    let payload: Record<string, any> = {};
    try {
      payload = JSON.parse(rawBuffer.toString("utf8"));
    } catch {
      payload = { raw: rawBuffer.toString("utf8") };
    }

    const eventType =
      req.headers.get("x-nextex-event-type") ||
      payload.type ||
      payload.event ||
      payload.action ||
      "generic.event";

    // 10. Ingestión Atómica: Evento + Deduplicación + Encolamiento de JobRun
    const ingestResult = await defaultIntegrationEngine.ingestEvent(
      {
        endpointKey,
        externalEventId: eventId,
        eventType,
        provider: "webhook",
        payload,
        headersMetadata: safeHeaders,
        payloadHash,
      },
      supabase
    );

    if (inboundSpan) {
      inboundSpan.setAttribute("event_id", ingestResult.event_id || null);
      inboundSpan.setAttribute("job_run_id", ingestResult.job_run_id || null);
      inboundSpan.setAttribute("ingest_status", ingestResult.status);
    }

    if (!ingestResult.success && ingestResult.status === "duplicate_conflict") {
      inboundSpan?.end({ status: "failed", error: "DUPLICATE_PAYLOAD_MISMATCH" });
      return NextResponse.json(
        {
          error: "Conflict: Event ID ya recibido con carga útil diferente (DUPLICATE_PAYLOAD_MISMATCH).",
          errorCode: "DUPLICATE_PAYLOAD_MISMATCH",
        },
        { status: 409 }
      );
    }

    if (!ingestResult.success && ingestResult.status === "quarantined") {
      inboundSpan?.end({ status: "failed", error: ingestResult.error_code || "QUARANTINED" });
      return NextResponse.json(
        { error: ingestResult.message, errorCode: ingestResult.error_code },
        { status: 403 }
      );
    }

    inboundSpan?.end({ status: "completed" });

    if (ingestResult.status === "duplicate") {
      return NextResponse.json(
        {
          status: "duplicate",
          eventId: ingestResult.event_id,
          jobRunId: ingestResult.job_run_id,
          message: "Evento duplicado recibido e ignorado de forma idempotente.",
        },
        { status: 200 }
      );
    }

    if (ingestResult.status === "queued") {
      return NextResponse.json(
        {
          status: "queued",
          eventId: ingestResult.event_id,
          jobRunId: ingestResult.job_run_id,
          message: "Evento verificado y encolado para ejecución.",
        },
        { status: 202 }
      );
    }

    return NextResponse.json(
      {
        status: ingestResult.status,
        eventId: ingestResult.event_id,
        message: ingestResult.message,
      },
      { status: 200 }
    );
  } catch (err: any) {
    inboundSpan?.end({ status: "failed", error: err });
    return NextResponse.json(
      { error: "Internal Gateway Error: Fallo durante la ingestión del evento." },
      { status: 500 }
    );
  }
}
