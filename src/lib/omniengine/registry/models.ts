/**
 * NEXTEХ OmniEngine — Model Registry Central
 * Catálogo canónico de modelos reales, capacidades verificadas y ciclo de vida oficial.
 * REGLA ESTRICTA: Cero modelos ficticios. Modelos sin API Key se marcan 'unconfigured'.
 */

import { ModelMetadata, AIProviderId } from "../types";

export const CANONICAL_MODELS: Omit<ModelMetadata, "status">[] = [
  // --- GOOGLE GEMINI ---
  {
    id: "gemini-1.5-flash",
    provider: "google",
    displayName: "Gemini 1.5 Flash",
    family: "Gemini",
    lifecycle: "active",
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "GEMINI_API_KEY",
      description: "API Key de Google AI Studio o Vertex AI",
    },
    recommendedFor: ["Velocidad extrema", "Respuestas en tiempo real", "Chat interactivo"],
  },
  {
    id: "gemini-1.5-pro",
    provider: "google",
    displayName: "Gemini 1.5 Pro",
    family: "Gemini",
    lifecycle: "active",
    contextWindow: 2097152, // 2M tokens
    maxOutputTokens: 8192,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "GEMINI_API_KEY",
      description: "API Key de Google AI Studio o Vertex AI",
    },
    recommendedFor: ["Razonamiento complejo", "Análisis de contexto masivo", "Documentos largos"],
  },
  {
    id: "gemini-2.0-flash-exp",
    provider: "google",
    displayName: "Gemini 2.0 Flash (Experimental)",
    family: "Gemini",
    lifecycle: "experimental",
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "GEMINI_API_KEY",
      description: "API Key de Google AI Studio",
    },
    recommendedFor: ["Última generación multimodal", "Baja latencia"],
  },

  // --- ANTHROPIC CLAUDE ---
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    displayName: "Claude 3.5 Sonnet",
    family: "Claude",
    lifecycle: "active",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "ANTHROPIC_API_KEY",
      description: "API Key de Anthropic Console",
    },
    recommendedFor: ["Generación de código", "Razonamiento lógico", "Arquitectura"],
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    displayName: "Claude 3.5 Haiku",
    family: "Claude",
    lifecycle: "active",
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "ANTHROPIC_API_KEY",
      description: "API Key de Anthropic Console",
    },
    recommendedFor: ["Respuestas rápidas", "Extracción de datos"],
  },

  // --- OPENAI ---
  {
    id: "gpt-4o",
    provider: "openai",
    displayName: "GPT-4o (Omni)",
    family: "GPT-4",
    lifecycle: "active",
    contextWindow: 128000,
    maxOutputTokens: 4096,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "OPENAI_API_KEY",
      description: "API Key de OpenAI Platform",
    },
    recommendedFor: ["Multimodal general", "Instrucciones estructuradas", "Tool calling"],
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    displayName: "GPT-4o mini",
    family: "GPT-4",
    lifecycle: "active",
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ["streaming", "vision", "toolCalling", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "OPENAI_API_KEY",
      description: "API Key de OpenAI Platform",
    },
    recommendedFor: ["Tareas ligeras", "Alta frecuencia", "Económico"],
  },
  {
    id: "o1-mini",
    provider: "openai",
    displayName: "o1-mini",
    family: "o1",
    lifecycle: "deprecated", // Marcado oficialmente en docs de OpenAI
    contextWindow: 128000,
    maxOutputTokens: 65536,
    capabilities: ["streaming", "structuredOutput"],
    supportsStreaming: false,
    supportsVision: false,
    supportsToolCalling: false,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "OPENAI_API_KEY",
      description: "API Key de OpenAI Platform",
    },
    recommendedFor: ["Matemáticas", "Ciencia", "Razonamiento paso a paso"],
  },

  // --- MOTOR LOCAL DE PRUEBA / SIMULACIÓN NEXTEX ---
  {
    id: "nextex-simulation",
    provider: "local_mock",
    displayName: "NEXTEХ Sandbox Simulator",
    family: "NEXTEХ Internal",
    lifecycle: "active",
    contextWindow: 32768,
    maxOutputTokens: 4096,
    capabilities: ["streaming", "structuredOutput"],
    supportsStreaming: true,
    supportsVision: false,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    configurationRequirement: {
      envKey: "INTERNAL_MOCK",
      description: "Motor interno de verificación offline",
    },
    recommendedFor: ["Pruebas de canalización", "Verificación offline", "Desarrollo local"],
  },
];

/**
 * Verifica si un proveedor tiene sus credenciales configuradas en el entorno del servidor.
 */
export function isProviderConfigured(provider: AIProviderId): boolean {
  if (typeof process === "undefined" || !process.env) return false;

  switch (provider) {
    case "google":
      return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "local_mock":
      return true;
    default:
      return false;
  }
}

/**
 * Retorna el catálogo completo con el estado en vivo ('available' o 'unconfigured').
 */
export function getModelRegistry(): ModelMetadata[] {
  return CANONICAL_MODELS.map((model) => {
    const isConfigured = isProviderConfigured(model.provider);
    return {
      ...model,
      status: isConfigured ? "available" : "unconfigured",
    };
  });
}

/**
 * Busca un modelo por su ID único.
 */
export function getModelById(id: string): ModelMetadata | null {
  const models = getModelRegistry();
  return models.find((m) => m.id === id) || null;
}

/**
 * Retorna la lista filtrada de modelos configurados y disponibles para ejecución.
 */
export function getAvailableModels(): ModelMetadata[] {
  return getModelRegistry().filter((m) => m.status === "available");
}
