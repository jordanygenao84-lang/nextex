/**
 * NEXTEХ OmniEngine — Tipos fundamentales de orquestación, modelos y gateway
 */

import { OmniErrorCode } from "./errors";

export type AIProviderId = "openai" | "anthropic" | "google" | "local_mock";

export type AICapability =
  | "streaming"
  | "vision"
  | "toolCalling"
  | "structuredOutput"
  | "embeddings";

export type ModelStatus = "available" | "unconfigured" | "deprecated" | "offline";

export interface ModelMetadata {
  id: string;
  provider: AIProviderId;
  displayName: string;
  family: string;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: AICapability[];
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  status: ModelStatus;
  configurationRequirement: {
    envKey: string;
    description: string;
  };
  recommendedFor?: string[];
  costPer1kInputTokens?: number;
  costPer1kOutputTokens?: number;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  tools?: any[];
  responseFormat?: "text" | "json_object";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AIRequestPayload {
  requestId: string;
  workspaceId: string;
  userId: string;
  conversationId?: string;
  provider?: AIProviderId;
  model: string;
  messages: ChatMessage[];
  options?: GenerationOptions;
  requiredCapabilities?: AICapability[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface NormalizedAIResponse {
  id: string;
  provider: AIProviderId;
  model: string;
  content: string;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error" | "cancelled";
  usage: TokenUsage;
  latencyMs: number;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  id: string;
  delta: string;
  finishReason?: NormalizedAIResponse["finishReason"];
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
}

export interface AIUsageRecord {
  requestId: string;
  workspaceId: string;
  userId: string;
  conversationId?: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "completed" | "failed" | "cancelled";
  errorCode?: OmniErrorCode | null;
  createdAt?: string;
}

export interface PlanQuotaPolicy {
  plan: "free" | "pro" | "enterprise";
  maxRequestsPerDay: number;
  maxTokensPerDay: number;
  maxTokensPerRequest: number;
  allowedModels: string[]; // "*" para todos
  allowVision: boolean;
  allowToolCalling: boolean;
  concurrencyLimit: number;
}
