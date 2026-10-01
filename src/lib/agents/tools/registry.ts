/**
 * NEXTEХ Agent Core — Advanced Tool Registry Central (Fase 4.3)
 * Catálogo canónico de herramientas con versionado semántico, taxonomía y ciclo de vida.
 */

import { ToolDefinition } from "./types";
import { calculatorToolHandler } from "./builtins/calculator";
import { databaseReadToolHandler } from "./builtins/database_read";
import { databaseWriteToolHandler } from "./builtins/database_write";

export const CANONICAL_TOOLS: ToolDefinition[] = [
  {
    id: "calculator",
    name: "Calculadora de Precisión",
    description: "Evaluación matemática de operaciones aritméticas y financieras sin eval().",
    version: "1.0.0",
    category: "utility",
    riskLevel: "read",
    requiresApproval: false,
    status: "active",
    enabled: true,
    timeoutMs: 3000,
    parameters: {
      expression: {
        type: "string",
        description: "Expresión matemática a evaluar",
        required: true,
        pattern: "^[0-9+\\-*/%^().,\\s\\w]+$",
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        expression: { type: "string" },
        result: { type: "number" },
        formatted: { type: "string" },
      },
    },
    handler: calculatorToolHandler,
  },
  {
    id: "database_read",
    name: "Lector de Datos del Workspace",
    description: "Consulta segura de registros vinculados al workspace actual bajo RLS.",
    version: "1.0.0",
    category: "database",
    riskLevel: "read",
    requiresApproval: false,
    status: "active",
    enabled: true,
    timeoutMs: 5000,
    parameters: {
      table: {
        type: "string",
        description: "Tabla destino (conversations, agents, etc.)",
        required: true,
        enum: ["workspaces", "profiles", "workspace_members", "conversations", "agents", "agent_runs", "agent_run_steps"],
      },
      limit: {
        type: "number",
        description: "Límite de registros (máximo 50)",
        required: false,
        minimum: 1,
        maximum: 50,
      },
      filterField: {
        type: "string",
        description: "Campo de la tabla a filtrar",
        required: false,
      },
      filterValue: {
        type: "string",
        description: "Valor exacto para el filtro",
        required: false,
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        table: { type: "string" },
        workspace_id: { type: "string" },
        count: { type: "number" },
        records: { type: "array" },
      },
    },
    handler: databaseReadToolHandler,
  },
  {
    id: "database_write",
    name: "Escritura de Registros",
    description: "Creación, actualización o eliminación de entidades autorizadas (conversations, agents). Requiere confirmación humana.",
    version: "1.0.0",
    category: "database",
    riskLevel: "write",
    requiresApproval: true,
    status: "active",
    enabled: true,
    timeoutMs: 5000,
    parameters: {
      table: {
        type: "string",
        description: "Tabla destino autorizada para mutaciones",
        required: true,
        enum: ["conversations", "agents"],
      },
      operation: {
        type: "string",
        description: "Operación: 'insert', 'update' o 'delete'",
        required: false,
        enum: ["insert", "update", "delete"],
      },
      data: {
        type: "object",
        description: "Payload estructurado a guardar (requerido para insert y update)",
        required: false,
      },
      recordId: {
        type: "string",
        description: "ID del registro a actualizar o eliminar (obligatorio si operation='update' o 'delete')",
        required: false,
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        operation: { type: "string" },
        table: { type: "string" },
        workspace_id: { type: "string" },
        status: { type: "string" },
        record: { type: "object" },
      },
    },
    handler: databaseWriteToolHandler,
  },
  {
    id: "web_search",
    name: "Búsqueda Web Segura",
    description: "Consulta externa de información pública en internet.",
    version: "1.0.0",
    category: "web",
    riskLevel: "external",
    requiresApproval: false,
    status: "disabled",
    enabled: false,
    parameters: {
      query: { type: "string", description: "Término de búsqueda", required: true },
    },
  },
  {
    id: "email",
    name: "Canal Email",
    description: "Envío y redacción de correos electrónicos corporativos.",
    version: "1.0.0",
    category: "communication",
    riskLevel: "external",
    requiresApproval: true,
    status: "disabled",
    enabled: false,
    parameters: {
      to: { type: "string", description: "Destinatario", required: true },
      subject: { type: "string", description: "Asunto", required: true },
      body: { type: "string", description: "Cuerpo del mensaje", required: true },
    },
  },
  {
    id: "whatsapp",
    name: "Canal WhatsApp",
    description: "Notificaciones y mensajería instantánea transaccional.",
    version: "1.0.0",
    category: "communication",
    riskLevel: "external",
    requiresApproval: true,
    status: "disabled",
    enabled: false,
    parameters: {
      phone: { type: "string", description: "Número de teléfono con código de país", required: true },
      message: { type: "string", description: "Mensaje a enviar", required: true },
    },
  },
  {
    id: "sms",
    name: "Canal SMS",
    description: "Despacho de mensajes cortos de texto para alertas.",
    version: "1.0.0",
    category: "communication",
    riskLevel: "external",
    requiresApproval: true,
    status: "disabled",
    enabled: false,
    parameters: {
      phone: { type: "string", description: "Número destino", required: true },
      text: { type: "string", description: "Texto SMS", required: true },
    },
  },
];

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private versionedTools = new Map<string, Map<string, ToolDefinition>>();

  constructor(initialTools = CANONICAL_TOOLS) {
    for (const tool of initialTools) {
      this.registerTool(tool);
    }
  }

  public registerTool(tool: ToolDefinition): void {
    const baseId = tool.id.split("@")[0].toLowerCase().trim();
    this.tools.set(baseId, tool);

    if (!this.versionedTools.has(baseId)) {
      this.versionedTools.set(baseId, new Map());
    }

    const versions = this.versionedTools.get(baseId)!;
    versions.set(tool.version, tool);

    // Mapeo también para alias de versión mayor: e.g. "1" para "1.0.0"
    const majorVersion = tool.version.split(".")[0];
    if (!versions.has(majorVersion)) {
      versions.set(majorVersion, tool);
    }
  }

  /**
   * Resuelve una herramienta a partir de un identificador base o versionado.
   * Soporta: "calculator", "calculator@1", "calculator@1.0.0".
   */
  public getTool(identifier: string): ToolDefinition | null {
    if (!identifier) return null;

    const parts = identifier.toLowerCase().trim().split("@");
    const baseId = parts[0];
    const version = parts[1];

    if (!this.versionedTools.has(baseId)) {
      return null;
    }

    const versions = this.versionedTools.get(baseId)!;

    if (version) {
      return versions.get(version) || null;
    }

    // Si no se especificó versión, retornar la versión activa o más reciente
    const defaultTool = this.tools.get(baseId);
    if (defaultTool) return defaultTool;

    // Fallback al primer registro disponible
    const allVersions = Array.from(versions.values());
    const activeOne = allVersions.find((t) => t.status === "active");
    return activeOne || allVersions[0] || null;
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public listActive(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.status === "active");
  }

  public isRegistered(identifier: string): boolean {
    return Boolean(this.getTool(identifier));
  }

  public isEnabled(identifier: string): boolean {
    const t = this.getTool(identifier);
    return Boolean(t && t.status === "active");
  }

  public requiresApproval(identifier: string): boolean {
    const t = this.getTool(identifier);
    return Boolean(t && (t.requiresApproval || t.riskLevel === "write" || t.riskLevel === "destructive"));
  }

  /**
   * Retorna exclusivamente las herramientas asignadas al agente que estén disponibles para uso.
   * Tool Discovery Filtrado para evitar sobreexposición del catálogo.
   */
  public getToolsForAgent(assignedToolIds: string[]): ToolDefinition[] {
    if (!assignedToolIds || !Array.isArray(assignedToolIds)) return [];

    const result: ToolDefinition[] = [];
    for (const toolId of assignedToolIds) {
      const tool = this.getTool(toolId);
      // Solo incluimos herramientas activas o en deprecación soportada
      if (tool && (tool.status === "active" || tool.status === "deprecated")) {
        result.push(tool);
      }
    }
    return result;
  }
}

export const defaultToolRegistry = new ToolRegistry();
