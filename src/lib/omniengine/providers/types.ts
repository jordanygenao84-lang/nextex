/**
 * NEXTEХ OmniEngine — Interfaz canónica AIProvider
 * Estandariza la integración de múltiples proveedores LLM sin dependencias acopladas.
 */

import {
  AIProviderId,
  ModelMetadata,
  ChatMessage,
  GenerationOptions,
  NormalizedAIResponse,
  StreamChunk,
} from "../types";

export interface AIProvider {
  readonly id: AIProviderId;
  readonly name: string;

  /**
   * Verifica si el proveedor cuenta con las credenciales requeridas en el entorno de ejecución.
   */
  isConfigured(): boolean;

  /**
   * Generación de texto estándar (no streaming).
   */
  generate(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse>;

  /**
   * Generación progresiva de texto mediante streaming (AsyncIterable de fragmentos).
   */
  stream(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): AsyncIterable<StreamChunk>;

  /**
   * Generación de embeddings vectoriales (opcional).
   */
  embeddings?(texts: string[], model?: string): Promise<number[][]>;

  /**
   * Ejecución con llamada a funciones/herramientas (opcional).
   */
  toolCalling?(
    model: ModelMetadata,
    messages: ChatMessage[],
    tools: any[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse>;

  /**
   * Procesamiento visual / multimodal (opcional).
   */
  vision?(
    model: ModelMetadata,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): Promise<NormalizedAIResponse>;

  /**
   * Extracción JSON estructurada garantizada (opcional).
   */
  structuredOutput?<T>(
    model: ModelMetadata,
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    options?: GenerationOptions
  ): Promise<T>;
}
