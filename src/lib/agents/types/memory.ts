/**
 * NEXTEХ Agent Core — Tipos e interfaces del Subsistema de Memoria Cognitiva (Fase 4.5)
 * Principio Fundamental: MEMORY != AUTHORITY / MEMORY != SYSTEM INSTRUCTIONS
 */

export type MemoryScope = "workspace" | "agent" | "user";

export type MemoryType = "episodic" | "semantic" | "fact" | "preference";

export type MemoryStatus = "active" | "archived" | "deprecated" | "quarantined";

export type MemoryTrustLevel = "untrusted" | "verified" | "system";

export type MemoryRetrievalMode = "disabled" | "recent" | "semantic" | "hybrid";

export type MemoryWriteMode = "automatic" | "quarantined" | "disabled";

export interface AgentMemory {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  user_id: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  summary: string | null;
  metadata: Record<string, any>;
  embedding?: number[] | null;
  status: MemoryStatus;
  trust_level: MemoryTrustLevel;
  source_run_id?: string | null;
  source_step_id?: string | null;
  idempotency_hash: string;
  client_idempotency_key?: string | null;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export type MemoryAccessLogOperation =
  | "read"
  | "write"
  | "archive"
  | "delete"
  | "quarantine"
  | "unquarantine";

export interface AgentMemoryAccessLogEntry {
  id: string;
  workspace_id: string;
  memory_id: string | null;
  agent_id?: string | null;
  run_id?: string | null;
  step_id?: string | null;
  actor_id?: string | null;
  operation: MemoryAccessLogOperation;
  similarity_score?: number | null;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface MemoryRetrievalOptions {
  query: string;
  agentId: string;
  userId?: string;
  limit?: number;
  similarityThreshold?: number;
  scopes?: MemoryScope[];
  runId?: string;
  stepId?: string;
}

export interface RetrievedMemoryMatch {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  user_id: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  summary: string | null;
  metadata: Record<string, any>;
  trust_level: MemoryTrustLevel;
  similarity: number;
  created_at: string;
  access_count: number;
}

export interface MemoryCandidate {
  content: string;
  type: MemoryType;
  scope: MemoryScope;
  summary?: string;
  metadata?: Record<string, any>;
  expiresAt?: string | null;
}
