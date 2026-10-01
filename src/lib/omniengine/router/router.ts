/**
 * NEXTEХ OmniEngine — Model Router
 * Enrutamiento inteligente con verificación de capacidades, cuotas, configuración y fallback controlado.
 * REGLA: Nunca cambiar silenciosamente de modelo si altera el comportamiento sin política explícita.
 */

import { getModelById, getModelRegistry } from "../registry/models";
import { getProvider } from "../providers";
import {
  ModelMetadata,
  AICapability,
  AIProviderId,
  PlanQuotaPolicy,
} from "../types";
import { AIProvider } from "../providers/types";
import { OmniEngineError, OmniErrorCodes } from "../types/errors";

export interface RouteRequest {
  requestedModelId?: string;
  requestedProvider?: AIProviderId;
  requiredCapabilities?: AICapability[];
  userPlan: "free" | "pro" | "enterprise";
  quotaPolicy?: PlanQuotaPolicy;
  allowFallback?: boolean;
  fallbackModelId?: string;
}

export interface RouteResult {
  model: ModelMetadata;
  provider: AIProvider;
  fallbackApplied: boolean;
  fallbackReason?: string;
}

export class ModelRouter {
  /**
   * Determina el modelo óptimo y autorizado para una petición.
   */
  public route(req: RouteRequest): RouteResult {
    const registry = getModelRegistry();

    // 1. Determinar modelo objetivo
    let targetModelId = req.requestedModelId;
    if (!targetModelId) {
      // Modelo por defecto si no se especificó uno
      targetModelId = "gemini-1.5-flash";
    }

    const model = getModelById(targetModelId);
    if (!model) {
      throw new OmniEngineError({
        code: OmniErrorCodes.MODEL_NOT_FOUND,
        message: `El modelo solicitado '${targetModelId}' no existe en el catálogo de NEXTEХ.`,
        statusCode: 404,
        model: targetModelId,
      });
    }

    // 2. Comprobar si el modelo solicitado está configurado
    if (model.status === "unconfigured") {
      // Política de fallback controlada
      if (req.allowFallback && req.fallbackModelId) {
        const fallback = getModelById(req.fallbackModelId);
        if (fallback && fallback.status === "available") {
          this.validateCapabilities(fallback, req.requiredCapabilities);
          this.validatePlanAccess(fallback, req.userPlan, req.quotaPolicy);
          return {
            model: fallback,
            provider: getProvider(fallback.provider),
            fallbackApplied: true,
            fallbackReason: `El modelo principal '${model.displayName}' no está configurado. Se activó el fallback explícito a '${fallback.displayName}'.`,
          };
        }
      }

      // Si no hay fallback explícito autorizado, rechazar con código canónico
      throw new OmniEngineError({
        code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
        message: `El modelo '${model.displayName}' (${model.id}) no está configurado. Requiere la clave '${model.configurationRequirement.envKey}' en las variables de entorno del servidor.`,
        statusCode: 503,
        provider: model.provider,
        model: model.id,
      });
    }

    // 3. Comprobar compatibilidad de capacidades requeridas
    this.validateCapabilities(model, req.requiredCapabilities);

    // 4. Comprobar autorización según el plan del usuario
    this.validatePlanAccess(model, req.userPlan, req.quotaPolicy);

    // 5. Retornar modelo y adaptador correspondiente
    const provider = getProvider(model.provider);

    return {
      model,
      provider,
      fallbackApplied: false,
    };
  }

  private validateCapabilities(model: ModelMetadata, required?: AICapability[]) {
    if (!required || required.length === 0) return;

    for (const cap of required) {
      if (!model.capabilities.includes(cap)) {
        throw new OmniEngineError({
          code: OmniErrorCodes.CAPABILITY_UNSUPPORTED,
          message: `El modelo '${model.displayName}' no soporta la capacidad requerida '${cap}'.`,
          statusCode: 400,
          provider: model.provider,
          model: model.id,
        });
      }
    }
  }

  private validatePlanAccess(
    model: ModelMetadata,
    plan: "free" | "pro" | "enterprise",
    policy?: PlanQuotaPolicy
  ) {
    if (!policy) return;

    if (policy.allowedModels && !policy.allowedModels.includes("*")) {
      if (!policy.allowedModels.includes(model.id)) {
        throw new OmniEngineError({
          code: OmniErrorCodes.QUOTA_EXCEEDED,
          message: `El modelo '${model.displayName}' no está disponible en tu plan actual (${plan.toUpperCase()}). Actualiza tu suscripción para desbloquearlo.`,
          statusCode: 403,
          provider: model.provider,
          model: model.id,
        });
      }
    }
  }
}

export const defaultModelRouter = new ModelRouter();
