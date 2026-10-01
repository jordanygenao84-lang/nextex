/**
 * NEXTEХ OmniEngine — Gestor de Políticas de Cuota y Consumo
 * Control de límites por plan (Free, Pro, Enterprise) y auditoría de uso.
 */

import { PlanQuotaPolicy } from "../types";
import { OmniEngineError, OmniErrorCodes } from "../types/errors";

export const PLAN_POLICIES: Record<"free" | "pro" | "enterprise", PlanQuotaPolicy> = {
  free: {
    plan: "free",
    maxRequestsPerDay: 100,
    maxTokensPerDay: 150000,
    maxTokensPerRequest: 4096,
    allowedModels: [
      "gemini-1.5-flash",
      "gpt-4o-mini",
      "claude-3-5-haiku-20241022",
      "nextex-simulation",
    ],
    allowVision: true,
    allowToolCalling: true,
    concurrencyLimit: 2,
  },
  pro: {
    plan: "pro",
    maxRequestsPerDay: 2000,
    maxTokensPerDay: 5000000,
    maxTokensPerRequest: 16384,
    allowedModels: ["*"], // Acceso a todos los modelos de vanguardia
    allowVision: true,
    allowToolCalling: true,
    concurrencyLimit: 10,
  },
  enterprise: {
    plan: "enterprise",
    maxRequestsPerDay: 100000,
    maxTokensPerDay: 50000000,
    maxTokensPerRequest: 65536,
    allowedModels: ["*"],
    allowVision: true,
    allowToolCalling: true,
    concurrencyLimit: 50,
  },
};

export class QuotaManager {
  /**
   * Obtiene la política vigente para el plan.
   */
  public getPolicy(plan: "free" | "pro" | "enterprise"): PlanQuotaPolicy {
    return PLAN_POLICIES[plan] || PLAN_POLICIES.free;
  }

  /**
   * Valida si la petición actual está dentro de los límites de cuota asignados.
   */
  public validateQuota(params: {
    plan: "free" | "pro" | "enterprise";
    currentDayRequestsCount: number;
    currentDayTokensCount: number;
    requestedTokensEstimate: number;
  }) {
    const policy = this.getPolicy(params.plan);

    // 1. Validar límite de requests por día
    if (params.currentDayRequestsCount >= policy.maxRequestsPerDay) {
      throw new OmniEngineError({
        code: OmniErrorCodes.QUOTA_EXCEEDED,
        message: `Has alcanzado el límite diario de ${policy.maxRequestsPerDay} peticiones de tu plan ${params.plan.toUpperCase()}.`,
        statusCode: 429,
        retryable: false,
      });
    }

    // 2. Validar límite de tokens por día
    if (params.currentDayTokensCount + params.requestedTokensEstimate > policy.maxTokensPerDay) {
      throw new OmniEngineError({
        code: OmniErrorCodes.QUOTA_EXCEEDED,
        message: `Has alcanzado el límite diario de ${policy.maxTokensPerDay.toLocaleString()} tokens de tu plan ${params.plan.toUpperCase()}.`,
        statusCode: 429,
        retryable: false,
      });
    }

    // 3. Validar tamaño máximo por petición individual
    if (params.requestedTokensEstimate > policy.maxTokensPerRequest) {
      throw new OmniEngineError({
        code: OmniErrorCodes.QUOTA_EXCEEDED,
        message: `La longitud de tu consulta excede el máximo permitido de ${policy.maxTokensPerRequest.toLocaleString()} tokens por petición en tu plan.`,
        statusCode: 400,
        retryable: false,
      });
    }
  }
}

export const defaultQuotaManager = new QuotaManager();
