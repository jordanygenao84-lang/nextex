/**
 * NEXTEХ Agent Core — Metadatos y Tipos de Herramientas Declarativas
 * REGLA: En Fase 4.1 no se ejecutan herramientas externas arbitrarias; se define el contrato seguro.
 */

export type ToolRiskLevel = "read" | "write" | "external" | "destructive";

export interface ToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresApproval: boolean;
  enabled: boolean;
  parameters: Record<string, ToolParameter>;
}
