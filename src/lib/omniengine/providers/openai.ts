/**
 * NEXTEХ OmniEngine — OpenAI Provider Adapter
 * Adaptador oficial para modelos OpenAI (gpt-4o, gpt-4o-mini, o1-mini).
 * REGLA: Si OPENAI_API_KEY no está definida, isConfigured() retorna false y no rompe la app.
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

export class OpenAIProvider implements AIProvider {
  public readonly id = "openai";
  public readonly name = "OpenAI";

  private getApiKey(): string | null {
    if (typeof process === "undefined" || !process.env) return null;
    return process.env.OPENAI_API_KEY?.trim() || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  private assertConfigured(modelId: string) {
    if (!this.isConfigured()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
        message: `El proveedor OpenAI no está configurado. Añade OPENAI_API_KEY en las variables de entorno del servidor para habilitar ${modelId}.`,
        statusCode: 503,
        provider: this.id,
        model: modelId,
      });
    }
  }

  public async generate(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse> {
    this.assertConfigured(model.id);
    const apiKey = this.getApiKey()!;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeoutMs || 45000
    );

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            name: m.name,
          })),
          temperature: model.id.startsWith("o1") ? undefined : (options?.temperature ?? 0.7),
          max_completion_tokens: options?.maxTokens,
          stream: false,
        }),
        signal: options?.signal || controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // formato no json
        }

        if (response.status === 401) {
          throw new OmniEngineError({
            code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
            message: "La clave OPENAI_API_KEY configurada es inválida o ha expirado.",
            statusCode: 401,
            provider: this.id,
            model: model.id,
          });
        }

        if (response.status === 429) {
          throw new OmniEngineError({
            code: OmniErrorCodes.PROVIDER_RATE_LIMIT,
            message: "Límite de tasa excedido en OpenAI. Reintenta en unos instantes.",
            statusCode: 429,
            provider: this.id,
            model: model.id,
            retryable: true,
          });
        }

        throw new OmniEngineError({
          code: OmniErrorCodes.PROVIDER_ERROR,
          message: errorData?.error?.message || "Error devuelto por la API de OpenAI.",
          statusCode: response.status,
          provider: this.id,
          model: model.id,
        });
      }

      const json = await response.json();
      const choice = json.choices?.[0];
      const usage = json.usage || {};

      return {
        id: json.id || `openai-${Date.now()}`,
        provider: this.id,
        model: model.id,
        content: choice?.message?.content || "",
        finishReason: choice?.finish_reason || "stop",
        usage: {
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new OmniEngineError({
          code: OmniErrorCodes.PROVIDER_TIMEOUT,
          message: "Tiempo de espera agotado al conectar con OpenAI.",
          statusCode: 504,
          provider: this.id,
          model: model.id,
          retryable: true,
        });
      }
      if (err instanceof OmniEngineError) throw err;

      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: err?.message || "Fallo inesperado de comunicación con OpenAI.",
        statusCode: 500,
        provider: this.id,
        model: model.id,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  public async *stream(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): AsyncIterable<StreamChunk> {
    this.assertConfigured(model.id);
    const apiKey = this.getApiKey()!;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.id,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: model.id.startsWith("o1") ? undefined : (options?.temperature ?? 0.7),
        max_completion_tokens: options?.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: `Fallo al iniciar streaming con OpenAI (${response.status}): ${errorText.slice(0, 120)}`,
        statusCode: response.status,
        provider: this.id,
        model: model.id,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const dataStr = trimmed.replace(/^data: /, "").trim();
          if (dataStr === "[DONE]") return;

          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta?.content || "";
            const finishReason = parsed.choices?.[0]?.finish_reason;
            const usage = parsed.usage
              ? {
                  inputTokens: parsed.usage.prompt_tokens || 0,
                  outputTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0,
                }
              : undefined;

            if (delta || finishReason || usage) {
              yield {
                id: parsed.id || `openai-${Date.now()}`,
                delta,
                finishReason,
                usage,
              };
            }
          } catch {
            // Ignorar líneas no parseables
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
