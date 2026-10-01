/**
 * NEXTEХ Agent Core — Tool Registry Central (Declarativo)
 * Catálogo canónico de herramientas con niveles de riesgo para control de permisos.
 * REGLA: En Fase 4.1 ninguna herramienta externa se ejecuta de forma arbitraria.
 */

import { ToolDefinition } from "./types";

export const CANONICAL_TOOLS: ToolDefinition[] = [
  {
    id: "calculator",
    name: "Calculadora de Precisión",
    description: "Evaluación matemática de operaciones aritméticas y financieras.",
    riskLevel: "read",
    requiresApproval: false,
    enabled: true,
    parameters: {
      expression: { type: "string", description: "Expresión matemática", required: true },
    },
  },
  {
    id: "database_read",
    name: "Lector de Datos del Workspace",
    description: "Consulta segura de registros vinculados al workspace actual bajo RLS.",
    riskLevel: "read",
    requiresApproval: false,
    enabled: true,
    parameters: {
      query: { type: "string", description: "Criterio de búsqueda", required: true },
    },
  },
  {
    id: "database_write",
    name: "Escritura de Registros",
    description: "Creación o actualización de entidades del workspace.",
    riskLevel: "write",
    requiresApproval: false,
    enabled: true,
    parameters: {
      table: { type: "string", description: "Tabla destino", required: true },
      data: { type: "object", description: "Payload estructurado", required: true },
    },
  },
  {
    id: "web_search",
    name: "Búsqueda Web Segura",
    description: "Consulta externa de información pública en internet.",
    riskLevel: "external",
    requiresApproval: false,
    enabled: false, // Inhabilitada en Fase 4.1
    parameters: {
      query: { type: "string", description: "Término de búsqueda", required: true },
    },
  },
  {
    id: "email",
    name: "Canal Email",
    description: "Envío y redacción de correos electrónicos corporativos.",
    riskLevel: "external",
    requiresApproval: true,
    enabled: false, // Inhabilitada en Fase 4.1
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
    riskLevel: "external",
    requiresApproval: true,
    enabled: false, // Inhabilitada en Fase 4.1
    parameters: {
      phone: { type: "string", description: "Número de teléfono con código de país", required: true },
      message: { type: "string", description: "Mensaje a enviar", required: true },
    },
  },
  {
    id: "sms",
    name: "Canal SMS",
    description: "Despacho de mensajes cortos de texto para alertas.",
    riskLevel: "external",
    requiresApproval: true,
    enabled: false, // Inhabilitada en Fase 4.1
    parameters: {
      phone: { type: "string", description: "Número destino", required: true },
      text: { type: "string", description: "Texto SMS", required: true },
    },
  },
];

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  constructor(initialTools = CANONICAL_TOOLS) {
    for (const tool of initialTools) {
      this.tools.set(tool.id, tool);
    }
  }

  public getTool(id: string): ToolDefinition | null {
    return this.tools.get(id) || null;
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public isRegistered(id: string): boolean {
    return this.tools.has(id);
  }

  public isEnabled(id: string): boolean {
    const t = this.getTool(id);
    return Boolean(t && t.enabled);
  }

  public requiresApproval(id: string): boolean {
    const t = this.getTool(id);
    return Boolean(t && t.requiresApproval);
  }
}

export const defaultToolRegistry = new ToolRegistry();
