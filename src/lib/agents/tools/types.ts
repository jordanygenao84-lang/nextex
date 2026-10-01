/**
 * NEXTEХ Agent Core — Metadatos y Tipos de Herramientas Declarativas (Fase 4.2)
 * Tipado estricto para definición y ejecución en sandbox seguro.
 */

export type ToolRiskLevel = "read" | "write" | "external" | "destructive";

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolExecutionContext {
  agentId: string;
  runId: string;
  workspaceId: string;
  userId: string;
  supabaseClient?: any;
  signal?: AbortSignal;
}

export type ToolHandler = (
  params: Record<string, any>,
  context: ToolExecutionContext
) => Promise<{ result: any; metadata?: Record<string, any> }>;

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  enabled: boolean;
  parameters: Record<string, ToolParameter>;
  timeoutMs?: number;
  handler?: ToolHandler;
}
