/**
 * NEXTEХ OmniEngine — AI Gateway Central (Backend-Only)
 * Coordina autenticación, autorización de workspace, cuotas, enrutamiento, ejecución, telemetría y RLS.
 */

import {
  AIRequestPayload,
  NormalizedAIResponse,
  StreamChunk,
  TokenUsage,
} from "../types";
import { defaultModelRouter } from "../router/router";
import { defaultQuotaManager } from "../quotas/quota-manager";
import { defaultRateLimiter } from "../security/rate-limiter";
import { omniLogger } from "../observability/logger";
import { OmniEngineError, OmniErrorCodes } from "../types/errors";
import { sanitizeText } from "../security/sanitizer";

export class AIGateway {
  /**
   * Ejecuta una petición estándar (no-streaming).
   */
  public async execute(
    payload: AIRequestPayload,
    supabase?: any
  ): Promise<NormalizedAIResponse> {
    const startTime = Date.now();
    this.validatePayload(payload);

    // 1. Rate Limiting por workspace y usuario
    defaultRateLimiter.checkLimit(`${payload.workspaceId}:${payload.userId}`);

    // 2. Validación de autorización en el workspace y obtención del plan
    const { userPlan } = await this.verifyWorkspaceAndPlan(payload, supabase);

    // 3. Estimación inicial de tokens para cuotas
    const estimatedInputTokens = payload.messages.reduce(
      (acc, m) => acc + Math.ceil(m.content.length / 4),
      0
    );

    // 4. Verificación de cuotas del plan
    await this.verifyQuotas(payload, userPlan, estimatedInputTokens, supabase);

    // 5. Enrutamiento del modelo y selección del proveedor
    const quotaPolicy = defaultQuotaManager.getPolicy(userPlan);
    const { model, provider } = defaultModelRouter.route({
      requestedModelId: payload.model,
      requestedProvider: payload.provider,
      requiredCapabilities: payload.requiredCapabilities,
      userPlan,
      quotaPolicy,
    });

    // 6. Registro de auditoría inicial en ai_requests
    await this.recordRequestStart(payload, model.id, provider.id, supabase);

    // 7. Ejecución con reintentos controlados
    let lastError: any = null;
    const maxRetries = 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await provider.generate(model, payload.messages, payload.options);
        const latencyMs = Date.now() - startTime;

        // 8. Registrar consumo en ai_usage y actualizar ai_requests
        await this.recordUsageSuccess(
          payload,
          provider.id,
          model.id,
          response.usage,
          latencyMs,
          supabase
        );

        omniLogger.info("AI Gateway Request Completed", {
          requestId: payload.requestId,
          workspaceId: payload.workspaceId,
          userId: payload.userId,
          provider: provider.id,
          model: model.id,
          status: "completed",
          latencyMs,
          usage: response.usage,
        });

        return response;
      } catch (err: any) {
        lastError = err;
        const isRetryable = err instanceof OmniEngineError && err.retryable && attempt < maxRetries;

        omniLogger.warn(`AI Gateway Intento ${attempt}/${maxRetries} fallido`, {
          requestId: payload.requestId,
          error: sanitizeText(err?.message || "Error desconocido"),
          retryable: isRetryable,
        });

        if (!isRetryable) break;
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }

    // 9. Manejo y registro de error final
    const finalError = this.normalizeError(lastError, model.id, provider.id);
    const latencyMs = Date.now() - startTime;

    await this.recordUsageFailure(
      payload,
      provider.id,
      model.id,
      finalError.code,
      latencyMs,
      supabase
    );

    omniLogger.error("AI Gateway Request Failed", {
      requestId: payload.requestId,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      provider: provider.id,
      model: model.id,
      status: "failed",
      errorCode: finalError.code,
      latencyMs,
    });

    throw finalError;
  }

  /**
   * Ejecuta una petición en Streaming progresivo.
   */
  public async *executeStream(
    payload: AIRequestPayload,
    supabase?: any
  ): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    this.validatePayload(payload);

    defaultRateLimiter.checkLimit(`${payload.workspaceId}:${payload.userId}`);
    const { userPlan } = await this.verifyWorkspaceAndPlan(payload, supabase);

    const estimatedInputTokens = payload.messages.reduce(
      (acc, m) => acc + Math.ceil(m.content.length / 4),
      0
    );

    await this.verifyQuotas(payload, userPlan, estimatedInputTokens, supabase);

    const quotaPolicy = defaultQuotaManager.getPolicy(userPlan);
    const { model, provider } = defaultModelRouter.route({
      requestedModelId: payload.model,
      requestedProvider: payload.provider,
      requiredCapabilities: ["streaming", ...(payload.requiredCapabilities || [])],
      userPlan,
      quotaPolicy,
    });

    await this.recordRequestStart(payload, model.id, provider.id, supabase);

    let finalUsage: TokenUsage = {
      inputTokens: estimatedInputTokens,
      outputTokens: 0,
      totalTokens: estimatedInputTokens,
    };

    let streamStatus: "completed" | "cancelled" | "failed" = "completed";
    let errorCode: any = null;

    try {
      const streamIterable = provider.stream(model, payload.messages, payload.options);

      for await (const chunk of streamIterable) {
        if (chunk.usage) {
          finalUsage = chunk.usage;
        } else if (chunk.delta) {
          finalUsage.outputTokens += Math.ceil(chunk.delta.length / 4);
          finalUsage.totalTokens = finalUsage.inputTokens + finalUsage.outputTokens;
        }

        yield chunk;
      }
    } catch (err: any) {
      if (err instanceof OmniEngineError && err.code === OmniErrorCodes.REQUEST_CANCELLED) {
        streamStatus = "cancelled";
        errorCode = OmniErrorCodes.REQUEST_CANCELLED;
      } else {
        streamStatus = "failed";
        errorCode = err?.code || OmniErrorCodes.PROVIDER_ERROR;
      }
      throw this.normalizeError(err, model.id, provider.id);
    } finally {
      const latencyMs = Date.now() - startTime;

      if (streamStatus === "completed") {
        await this.recordUsageSuccess(
          payload,
          provider.id,
          model.id,
          finalUsage,
          latencyMs,
          supabase
        );
      } else {
        await this.recordUsageFailure(
          payload,
          provider.id,
          model.id,
          errorCode,
          latencyMs,
          supabase
        );
      }

      omniLogger.info("AI Gateway Stream Finalized", {
        requestId: payload.requestId,
        workspaceId: payload.workspaceId,
        provider: provider.id,
        model: model.id,
        status: streamStatus,
        latencyMs,
        usage: finalUsage,
      });
    }
  }

  // --- MÉTODOS INTERNOS DE VALIDACIÓN Y CONTROL ---

  private validatePayload(payload: AIRequestPayload) {
    if (!payload.requestId?.trim()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.INVALID_REQUEST,
        message: "El parámetro 'requestId' es obligatorio para trazabilidad.",
        statusCode: 400,
      });
    }

    if (!payload.workspaceId?.trim()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.WORKSPACE_FORBIDDEN,
        message: "La petición debe estar vinculada a un workspaceId válido.",
        statusCode: 400,
      });
    }

    if (!payload.userId?.trim()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.AUTH_REQUIRED,
        message: "La petición requiere un userId autenticado.",
        statusCode: 401,
      });
    }

    if (!payload.messages || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      throw new OmniEngineError({
        code: OmniErrorCodes.INVALID_REQUEST,
        message: "El payload debe contener un arreglo no vacío de mensajes.",
        statusCode: 400,
      });
    }
  }

  private async verifyWorkspaceAndPlan(
    payload: AIRequestPayload,
    supabase?: any
  ): Promise<{ userPlan: "free" | "pro" | "enterprise" }> {
    if (!supabase) {
      // Entorno de prueba unitaria sin cliente Supabase activo
      return { userPlan: "free" };
    }

    try {
      // 1. Validar que el usuario es miembro del workspace solicitado
      const { data: member, error: memberErr } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", payload.workspaceId)
        .eq("user_id", payload.userId)
        .maybeSingle();

      if (memberErr || !member) {
        throw new OmniEngineError({
          code: OmniErrorCodes.WORKSPACE_FORBIDDEN,
          message: "No tienes autorización para ejecutar peticiones en este workspace.",
          statusCode: 403,
        });
      }

      // 2. Obtener plan real inmutable desde profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan, status")
        .eq("id", payload.userId)
        .single();

      if (profile?.status === "suspended") {
        throw new OmniEngineError({
          code: OmniErrorCodes.AUTH_REQUIRED,
          message: "Tu cuenta se encuentra suspendida por políticas de seguridad.",
          statusCode: 403,
        });
      }

      return { userPlan: (profile?.plan as any) || "free" };
    } catch (err: any) {
      if (err instanceof OmniEngineError) throw err;
      throw new OmniEngineError({
        code: OmniErrorCodes.INTERNAL_ERROR,
        message: "Error de verificación de autorización con la base de datos.",
        statusCode: 500,
      });
    }
  }

  private async verifyQuotas(
    payload: AIRequestPayload,
    plan: "free" | "pro" | "enterprise",
    estimatedTokens: number,
    supabase?: any
  ) {
    let requestsToday = 0;
    let tokensToday = 0;

    if (supabase) {
      try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const { data: usageAgg } = await supabase
          .from("ai_usage")
          .select("total_tokens")
          .eq("workspace_id", payload.workspaceId)
          .gte("created_at", startOfDay.toISOString());

        if (Array.isArray(usageAgg)) {
          requestsToday = usageAgg.length;
          tokensToday = usageAgg.reduce((sum, row) => sum + (row.total_tokens || 0), 0);
        }
      } catch {
        // En caso de fallo transitorio de telemetría, continuar
      }
    }

    defaultQuotaManager.validateQuota({
      plan,
      currentDayRequestsCount: requestsToday,
      currentDayTokensCount: tokensToday,
      requestedTokensEstimate: estimatedTokens,
    });
  }

  private async recordRequestStart(
    payload: AIRequestPayload,
    modelId: string,
    providerId: string,
    supabase?: any
  ) {
    if (!supabase) return;
    try {
      await supabase.from("ai_requests").insert({
        request_id: payload.requestId,
        workspace_id: payload.workspaceId,
        user_id: payload.userId,
        conversation_id: payload.conversationId || null,
        provider: providerId,
        model: modelId,
        status: "processing",
      });
    } catch {
      // Ignorar fallas secundarias de logging
    }
  }

  private async recordUsageSuccess(
    payload: AIRequestPayload,
    providerId: string,
    modelId: string,
    usage: TokenUsage,
    latencyMs: number,
    supabase?: any
  ) {
    if (!supabase) return;
    try {
      await supabase.from("ai_usage").insert({
        request_id: payload.requestId,
        workspace_id: payload.workspaceId,
        user_id: payload.userId,
        conversation_id: payload.conversationId || null,
        provider: providerId,
        model: modelId,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        latency_ms: latencyMs,
        status: "completed",
      });

      await supabase
        .from("ai_requests")
        .update({ status: "completed" })
        .eq("request_id", payload.requestId);
    } catch {
      // Ignorar fallas secundarias de registro
    }
  }

  private async recordUsageFailure(
    payload: AIRequestPayload,
    providerId: string,
    modelId: string,
    errorCode: string,
    latencyMs: number,
    supabase?: any
  ) {
    if (!supabase) return;
    try {
      await supabase.from("ai_usage").insert({
        request_id: payload.requestId,
        workspace_id: payload.workspaceId,
        user_id: payload.userId,
        conversation_id: payload.conversationId || null,
        provider: providerId,
        model: modelId,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        latency_ms: latencyMs,
        status: "failed",
        error_code: errorCode,
      });

      await supabase
        .from("ai_requests")
        .update({ status: "failed", error_code: errorCode })
        .eq("request_id", payload.requestId);
    } catch {
      // Ignorar fallas secundarias
    }
  }

  private normalizeError(err: any, modelId: string, providerId: string): OmniEngineError {
    if (err instanceof OmniEngineError) return err;

    return new OmniEngineError({
      code: OmniErrorCodes.PROVIDER_ERROR,
      message: sanitizeText(err?.message || "Ocurrió un error en el AI Gateway."),
      statusCode: err?.statusCode || 500,
      provider: providerId,
      model: modelId,
    });
  }
}

export const defaultAIGateway = new AIGateway();
