/**
 * NEXTEХ OmniEngine — Fábrica y Registro de Proveedores
 */

import { AIProviderId } from "../types";
import { AIProvider } from "./types";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { GoogleGeminiProvider } from "./google";
import { LocalMockProvider } from "./mock";
import { OmniEngineError, OmniErrorCodes } from "../types/errors";

const providersRegistry: Record<AIProviderId, AIProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  google: new GoogleGeminiProvider(),
  local_mock: new LocalMockProvider(),
};

export function getProvider(id: AIProviderId): AIProvider {
  const provider = providersRegistry[id];
  if (!provider) {
    throw new OmniEngineError({
      code: OmniErrorCodes.MODEL_NOT_FOUND,
      message: `El proveedor de IA '${id}' no está registrado en el sistema.`,
      statusCode: 404,
      provider: id,
    });
  }
  return provider;
}

export function getAllProviders(): AIProvider[] {
  return Object.values(providersRegistry);
}

export * from "./types";
export * from "./openai";
export * from "./anthropic";
export * from "./google";
export * from "./mock";
