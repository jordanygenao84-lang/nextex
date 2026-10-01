/**
 * NEXTEХ OmniEngine — Local / Simulation Provider Adapter
 * Motor de prueba interno para desarrollo, verificación de canalización y tests offline.
 */

import { AIProvider } from "./types";
import {
  ModelMetadata,
  ChatMessage,
  GenerationOptions,
  NormalizedAIResponse,
  StreamChunk,
} from "../types";
import { OmniEngineError, OmniErrorCodes } from "../types/errors";

export class LocalMockProvider implements AIProvider {
  public readonly id = "local_mock";
  public readonly name = "NEXTEХ Sandbox Simulator";

  public isConfigured(): boolean {
    return true;
  }

  public async generate(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse> {
    const startTime = Date.now();
    const lastMessage = messages[messages.length - 1]?.content || "Hola";

    // Simulación de timeout si se configuró un timeout ultra bajo
    if (options?.timeoutMs && options.timeoutMs < 50) {
      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_TIMEOUT,
        message: "La petición al proveedor excedió el límite de tiempo asignado.",
        statusCode: 504,
        provider: this.id,
        model: model.id,
        retryable: true,
      });
    }

    const inputTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
    const simulatedResponse = `[NEXTEХ OmniEngine - Simulación ${model.displayName}]: He procesado tu solicitud de forma estructurada. Entrada recibida: "${lastMessage.slice(0, 80)}${lastMessage.length > 80 ? "..." : ""}". Sistema preparado para orquestación multi-modelo.`;
    const outputTokens = Math.ceil(simulatedResponse.length / 4);

    return {
      id: `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      provider: this.id,
      model: model.id,
      content: simulatedResponse,
      finishReason: "stop",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  public async *stream(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): AsyncIterable<StreamChunk> {
    const lastMessage = messages[messages.length - 1]?.content || "Hola";
    const chunkTokens = [
      `[NEXTEХ OmniEngine (${model.displayName})]: `,
      "Iniciando flujo ",
      "de inferencia ",
      "progresivo. ",
      `Procesando tu consulta: "${lastMessage.slice(0, 40)}...". `,
      "La infraestructura de streaming ",
      "del AI Gateway ",
      "funciona con éxito y ",
      "aislamiento por workspace verificado.",
    ];

    const inputTokens = messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
    let totalOutputTokens = 0;
    const reqId = `mock-stream-${Date.now()}`;

    for (let i = 0; i < chunkTokens.length; i++) {
      // Verificar si se solicitó cancelación
      if (options?.signal?.aborted) {
        throw new OmniEngineError({
          code: OmniErrorCodes.REQUEST_CANCELLED,
          message: "La generación en streaming fue cancelada por el usuario.",
          statusCode: 499,
          provider: this.id,
          model: model.id,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 30));

      const delta = chunkTokens[i];
      totalOutputTokens += Math.ceil(delta.length / 4);
      const isLast = i === chunkTokens.length - 1;

      yield {
        id: reqId,
        delta,
        finishReason: isLast ? "stop" : undefined,
        usage: isLast
          ? {
              inputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: inputTokens + totalOutputTokens,
            }
          : undefined,
      };
    }
  }
}
