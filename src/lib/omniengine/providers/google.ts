/**
 * NEXTEХ OmniEngine — Google Gemini Provider Adapter
 * Adaptador oficial para modelos Gemini (gemini-1.5-flash, gemini-1.5-pro, gemini-2.0-flash-exp).
 * REGLA: Si GEMINI_API_KEY/GOOGLE_API_KEY no está definida, isConfigured() retorna false y no rompe la app.
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

export class GoogleGeminiProvider implements AIProvider {
  public readonly id = "google";
  public readonly name = "Google Gemini";

  private getApiKey(): string | null {
    if (typeof process === "undefined" || !process.env) return null;
    return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim() || null;
  }

  
  private resolveModelId(modelId: string): string {
    const aliases: Record<string, string> = {
      "gemini-1.5-flash": "gemini-3.6-flash",
      "gemini-1.5-flash-latest": "gemini-3.6-flash",
      "gemini-2.0-flash": "gemini-3.6-flash",
      "gemini-2.0-flash-exp": "gemini-3.6-flash",
      "gemini-2.5-flash": "gemini-3.6-flash",
      "gemini-2.5-flash-latest": "gemini-3.6-flash",
      "gemini-1.5-pro": "gemini-3.1-pro-preview",
      "gemini-1.5-pro-latest": "gemini-3.1-pro-preview",
      "gemini-2.0-pro": "gemini-3.1-pro-preview",
      "gemini-2.5-pro": "gemini-3.1-pro-preview",
      "gemini-2.5-pro-latest": "gemini-3.1-pro-preview",
    };
    return aliases[modelId] || modelId;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  private assertConfigured(modelId: string) {
    if (!this.isConfigured()) {
      throw new OmniEngineError({
        code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
        message: `El proveedor Google Gemini no está configurado. Añade GEMINI_API_KEY en las variables de entorno para habilitar ${modelId}.`,
        statusCode: 503,
        provider: this.id,
        model: modelId,
      });
    }
  }

  private formatContents(messages: ChatMessage[]) {
    let systemInstruction: any = undefined;
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

    const nonSystemMessages: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = {
          parts: [{ text: msg.content }],
        };
      } else if (msg.content && msg.content.trim().length > 0) {
        nonSystemMessages.push(msg);
      }
    }

    const firstUserIndex = nonSystemMessages.findIndex((m) => m.role === "user");
    const validTurnMessages =
      firstUserIndex !== -1 ? nonSystemMessages.slice(firstUserIndex) : nonSystemMessages;

    for (const msg of validTurnMessages) {
      const role = msg.role === "assistant" ? "model" : "user";
      const text = msg.content.trim();

      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push({ text });
      } else {
        contents.push({
          role,
          parts: [{ text }],
        });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Hola" }] });
    }

    return { systemInstruction, contents };
  }

  public async generate(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse> {
    this.assertConfigured(model.id);
    const apiKey = this.getApiKey()!;
    const startTime = Date.now();

    const { systemInstruction, contents } = this.formatContents(messages);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeoutMs || 45000
    );

    try {
      const resolvedModel = this.resolveModelId(model.id);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents,
          systemInstruction,
          generationConfig: {
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens || 4096,
            responseMimeType: options?.responseFormat === "json_object" ? "application/json" : "text/plain",
          },
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

        if (response.status === 400 && errorText.includes("API key not valid")) {
          throw new OmniEngineError({
            code: OmniErrorCodes.MODEL_NOT_CONFIGURED,
            message: "La clave GEMINI_API_KEY configurada no es válida.",
            statusCode: 401,
            provider: this.id,
            model: model.id,
          });
        }

        if (response.status === 429) {
          throw new OmniEngineError({
            code: OmniErrorCodes.PROVIDER_RATE_LIMIT,
            message: "Límite de cuota alcanzado en Google Gemini. Espera unos segundos.",
            statusCode: 429,
            provider: this.id,
            model: model.id,
            retryable: true,
          });
        }

        throw new OmniEngineError({
          code: OmniErrorCodes.PROVIDER_ERROR,
          message: errorData?.error?.message || "Error devuelto por la API de Google Gemini.",
          statusCode: response.status,
          provider: this.id,
          model: model.id,
        });
      }

      const json = await response.json();
      const candidate = json.candidates?.[0];
      const contentText =
        candidate?.content?.parts
          ?.map((p: any) => p.text)
          ?.join("") || "";

      const usageMetadata = json.usageMetadata || {};
      const inputTokens = usageMetadata.promptTokenCount || 0;
      const outputTokens = usageMetadata.candidatesTokenCount || 0;

      return {
        id: `gemini-${Date.now()}`,
        provider: this.id,
        model: model.id,
        content: contentText,
        finishReason: candidate?.finishReason === "STOP" ? "stop" : "stop",
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
          message: "Tiempo de espera agotado al conectar con Google Gemini.",
          statusCode: 504,
          provider: this.id,
          model: model.id,
          retryable: true,
        });
      }
      if (err instanceof OmniEngineError) throw err;

      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: err?.message || "Fallo inesperado al comunicar con Google Gemini.",
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
    const { systemInstruction, contents } = this.formatContents(messages);

    const resolvedModel = this.resolveModelId(model.id);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        systemInstruction,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens || 4096,
        },
      }),
      signal: options?.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new OmniEngineError({
        code: OmniErrorCodes.PROVIDER_ERROR,
        message: `Fallo al iniciar streaming con Google Gemini (${response.status}): ${errorText.slice(0, 120)}`,
        statusCode: response.status,
        provider: this.id,
        model: model.id,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const reqId = `gemini-stream-${Date.now()}`;

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

          let parsed: any;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (parsed.error) {
            throw new OmniEngineError({
              code: OmniErrorCodes.PROVIDER_ERROR,
              message: `Error de Google Gemini: ${parsed.error.message || JSON.stringify(parsed.error)}`,
              statusCode: parsed.error.code || 400,
              provider: this.id,
              model: model.id,
            });
          }

          if (parsed.promptFeedback?.blockReason) {
            throw new OmniEngineError({
              code: OmniErrorCodes.PROVIDER_ERROR,
              message: `Gemini bloqueó la solicitud por seguridad (${parsed.promptFeedback.blockReason}).`,
              statusCode: 400,
              provider: this.id,
              model: model.id,
            });
          }

          const candidate = parsed.candidates?.[0];
          const delta =
            candidate?.content?.parts
              ?.map((p: any) => p.text)
              ?.join("") || "";

          const usageMetadata = parsed.usageMetadata;
          const usage = usageMetadata
            ? {
                inputTokens: usageMetadata.promptTokenCount || 0,
                outputTokens: usageMetadata.candidatesTokenCount || 0,
                totalTokens: usageMetadata.totalTokenCount || 0,
              }
            : undefined;

          if (delta || usage || candidate?.finishReason) {
            yield {
              id: reqId,
              delta,
              finishReason: candidate?.finishReason === "STOP" ? "stop" : undefined,
              usage,
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
