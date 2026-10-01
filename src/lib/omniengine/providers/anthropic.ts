/**
 * NEXTEХ OmniEngine — Anthropic Provider Adapter
 * Adaptador oficial para modelos Claude (claude-3-5-sonnet-20241022, claude-3-5-haiku-20241022).
 * REGLA: Si ANTHROPIC_API_KEY no está definida, isConfigured() retorna false y no rompe la app.
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

export class AnthropicProvider implements AIProvider {
  public readonly id = "anthropic";
  public readonly name = "Anthropic";

  private getApiKey(): string | null {
    if (typeof process === "undefined" || !process.env) return null;
    return process.env.ANTHROPIC_API_KEY?.trim() || null;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  private assertConfigured(modelId: string) {
    if (!this.isConfigured()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
        message: `El proveedor Anthropic no está configurado. Añade ANTHROPIC_API_KEY en las variables de entorno para habilitar ${modelId}.`,
        statusCode: 503,
        provider: this.id,
        model: modelId,
      });
    }
  }

  private formatMessages(messages: ChatMessage[]) {
    let systemPrompt: string | undefined = undefined;
    const formattedMessages: Array<{ role: "user" | "assistant"; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = systemPrompt ? `${systemPrompt}\n${msg.content}` : msg.content;
      } else if (msg.role === "user" || msg.role === "assistant") {
        formattedMessages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    if (formattedMessages.length === 0) {
      formattedMessages.push({ role: "user", content: "Hola" });
    }

    return { systemPrompt, formattedMessages };
  }

  public async generate(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse> {
    this.assertConfigured(model.id);
    const apiKey = this.getApiKey()!;
    const startTime = Date.now();

    const { systemPrompt, formattedMessages } = this.formatMessages(messages);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeoutMs || 45000
    );

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model.id,
          max_tokens: options?.maxTokens || 4096,
          temperature: options?.temperature ?? 0.7,
          system: systemPrompt,
          messages: formattedMessages,
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
          // ignore
        }

        if (response.status === 401) {
          throw new OmniEngineError({
            code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
            message: "La clave ANTHROPIC_API_KEY es inválida o no autorizada.",
            statusCode: 401,
            provider: this.id,
            model: model.id,
          });
        }

        if (response.status === 429) {
          throw new OmniEngineError({
            code: OmniErrorCodes.PROVIDER_RATE_LIMIT,
            message: "Límite de peticiones de Anthropic alcanzado. Reintenta pronto.",
            statusCode: 429,
            provider: this.id,
            model: model.id,
            retryable: true,
          });
        }

        throw new OmniEngineError({
          code: OmniErrorCodes.PROVIDER_ERROR,
          message: errorData?.error?.message || "Error devuelto por la API de Anthropic.",
          statusCode: response.status,
          provider: this.id,
          model: model.id,
        });
      }

      const json = await response.json();
      const contentText =
        json.content
          ?.filter((c: any) => c.type === "text")
          ?.map((c: any) => c.text)
          ?.join("") || "";

      const inputTokens = json.usage?.input_tokens || 0;
      const outputTokens = json.usage?.output_tokens || 0;

      return {
        id: json.id || `anthropic-${Date.now()}`,
        provider: this.id,
        model: model.id,
        content: contentText,
        finishReason: json.stop_reason === "end_turn" ? "stop" : (json.stop_reason || "stop"),
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new OmniEngineError({
          code: OmniErrorCodes.PROVIDER_TIMEOUT,
          message: "Tiempo de espera agotado al conectar con Anthropic.",
          statusCode: 504,
          provider: this.id,
          model: model.id,
          retryable: true,
        });
      }
      if (err instanceof OmniEngineError) throw err;

      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: err?.message || "Fallo inesperado al comunicar con Anthropic.",
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
    const { systemPrompt, formattedMessages } = this.formatMessages(messages);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature ?? 0.7,
        system: systemPrompt,
        messages: formattedMessages,
        stream: true,
      }),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: `Fallo al iniciar streaming con Anthropic (${response.status}): ${errorText.slice(0, 120)}`,
        statusCode: response.status,
        provider: this.id,
        model: model.id,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let msgId = `anthropic-${Date.now()}`;
    let inputTokens = 0;
    let outputTokens = 0;

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

          try {
            const event = JSON.parse(dataStr);
            if (event.type === "message_start") {
              msgId = event.message?.id || msgId;
              inputTokens = event.message?.usage?.input_tokens || 0;
            } else if (event.type === "content_block_delta") {
              const delta = event.delta?.text || "";
              if (delta) {
                yield {
                  id: msgId,
                  delta,
                };
              }
            } else if (event.type === "message_delta") {
              outputTokens = event.usage?.output_tokens || outputTokens;
              const stopReason = event.delta?.stop_reason;
              yield {
                id: msgId,
                delta: "",
                finishReason: stopReason === "end_turn" ? "stop" : (stopReason || "stop"),
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
              };
            }
          } catch {
            // Ignorar eventos no parseables
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
