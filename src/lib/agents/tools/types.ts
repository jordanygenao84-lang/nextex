/**
 * NEXTEХ Agent Core — Metadatos y Tipos de Herramientas Declarativas (Fase 4.3)
 * Taxonomía estandarizada, esquemas estrictos de entrada/salida y ciclo de vida.
 */

export type ToolRiskLevel = "read" | "write" | "external" | "destructive";

export type ToolCategory =
  | "utility"
  | "database"
  | "files"
  | "communication"
  | "web"
  | "calendar"
  | "business"
  | "analytics"
  | "system";

export type ToolStatus = "draft" | "active" | "disabled" | "deprecated";

export type ParameterType = "string" | "number" | "boolean" | "object" | "array";

export interface ToolParameter {
  type: ParameterType | string;
  description: string;
  required?: boolean;
  enum?: (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, ToolParameter>;
  items?: ToolParameter;
}

export interface ToolExecutionContext {
  agentId: string;
  runId: string;
  workspaceId: string;
  userId: string;
  supabaseClient?: any;
  signal?: AbortSignal;
}

export interface NormalizedToolOutput<T = any> {
  success: boolean;
  data: T;
  metadata: {
    toolId: string;
    version: string;
    durationMs: number;
    riskLevel: ToolRiskLevel;
    category: ToolCategory;
    [key: string]: any;
  };
  error?: {
    code: string;
    message: string;
  };
}

export type ToolHandler = (
  params: Record<string, any>,
  context: ToolExecutionContext
) => Promise<{ result: any; metadata?: Record<string, any> }>;

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  category: ToolCategory;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  status: ToolStatus;
  enabled: boolean;
  parameters: Record<string, ToolParameter>;
  outputSchema?: Record<string, any>;
  timeoutMs?: number;
  handler?: ToolHandler;
}
