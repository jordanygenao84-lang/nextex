/**
 * NEXTEХ Agent Core — Schema Validator (Fase 4.3)
 * Validación estricta y previa de contratos de entrada de herramientas.
 * PRINCIPIO: El modelo nunca puede modificar ni desbordar el esquema de parámetros.
 */

import { ToolDefinition, ToolParameter } from "./types";
import { AgentError, AgentErrorCodes } from "../types/errors";

export const MAX_TOOL_PAYLOAD_BYTES = 65536; // 64 KB máximo por payload

export class SchemaValidator {
  /**
   * Valida exhaustivamente un conjunto de parámetros contra el ToolDefinition.
   * Lanza AgentError con código TOOL_SCHEMA_INVALID si falla alguna regla.
   */
  public static validate(tool: ToolDefinition, params: Record<string, any>): void {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
        message: `Los parámetros para la herramienta '${tool.name}' deben ser un objeto JSON estructurado.`,
        statusCode: 400,
        toolId: tool.id,
      });
    }

    // 1. Control de tamaño máximo de payload
    const serialized = JSON.stringify(params);
    const byteLength = Buffer.byteLength(serialized, "utf8");
    if (byteLength > MAX_TOOL_PAYLOAD_BYTES) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
        message: `El tamaño del payload (${byteLength} bytes) excede el límite permitido de ${MAX_TOOL_PAYLOAD_BYTES} bytes.`,
        statusCode: 400,
        toolId: tool.id,
      });
    }

    const declaredParams = tool.parameters || {};

    // 2. Rechazo de campos desconocidos (Strict Schema)
    for (const key of Object.keys(params)) {
      if (!(key in declaredParams)) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
          message: `Campo desconocido '${key}' no permitido en el esquema de '${tool.name}'.`,
          statusCode: 400,
          toolId: tool.id,
        });
      }
    }

    // 3. Validación de campos declarados
    for (const [paramName, paramDef] of Object.entries(declaredParams)) {
      const val = params[paramName];

      // Verificación de obligatoriedad
      if (paramDef.required) {
        if (val === undefined || val === null || val === "") {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' es obligatorio para '${tool.name}'.`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
      }

      // Si el campo es opcional y no fue provisto, continuar
      if (val === undefined || val === null) {
        continue;
      }

      // Validación de tipos
      this.validateType(val, paramName, paramDef, tool);

      // Validación de Enums
      if (paramDef.enum && Array.isArray(paramDef.enum)) {
        if (!paramDef.enum.includes(val)) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El valor '${val}' para '${paramName}' no es válido. Valores permitidos: [${paramDef.enum.join(", ")}].`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
      }

      // Validación de rangos numéricos
      if (typeof val === "number") {
        if (paramDef.minimum !== undefined && val < paramDef.minimum) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El valor de '${paramName}' (${val}) es menor que el mínimo permitido (${paramDef.minimum}).`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        if (paramDef.maximum !== undefined && val > paramDef.maximum) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El valor de '${paramName}' (${val}) supera el máximo permitido (${paramDef.maximum}).`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
      }

      // Validación recursiva de objetos anidados
      if (paramDef.type === "object" && paramDef.properties && typeof val === "object" && !Array.isArray(val)) {
        this.validateNestedObject(val, paramName, paramDef.properties, tool);
      }
    }
  }

  private static validateType(val: any, paramName: string, paramDef: ToolParameter, tool: ToolDefinition): void {
    const expectedType = paramDef.type;

    switch (expectedType) {
      case "string":
        if (typeof val !== "string") {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' debe ser de tipo 'string', pero se recibió '${typeof val}'.`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        break;
      case "number":
        if (typeof val !== "number" || isNaN(val)) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' debe ser de tipo 'number', pero se recibió '${typeof val}'.`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        break;
      case "boolean":
        if (typeof val !== "boolean") {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' debe ser de tipo 'boolean', pero se recibió '${typeof val}'.`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        break;
      case "array":
        if (!Array.isArray(val)) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' debe ser un arreglo (array).`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        break;
      case "object":
        if (typeof val !== "object" || Array.isArray(val) || val === null) {
          throw new AgentError({
            code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
            message: `El campo '${paramName}' debe ser un objeto JSON.`,
            statusCode: 400,
            toolId: tool.id,
          });
        }
        break;
    }
  }

  private static validateNestedObject(
    obj: Record<string, any>,
    parentKey: string,
    properties: Record<string, ToolParameter>,
    tool: ToolDefinition
  ): void {
    for (const key of Object.keys(obj)) {
      if (!(key in properties)) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
          message: `Propiedad anidada desconocida '${parentKey}.${key}' en '${tool.name}'.`,
          statusCode: 400,
          toolId: tool.id,
        });
      }
    }

    for (const [childKey, childDef] of Object.entries(properties)) {
      const childVal = obj[childKey];
      if (childDef.required && (childVal === undefined || childVal === null)) {
        throw new AgentError({
          code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
          message: `La propiedad anidada '${parentKey}.${childKey}' es requerida.`,
          statusCode: 400,
          toolId: tool.id,
        });
      }
      if (childVal !== undefined && childVal !== null) {
        this.validateType(childVal, `${parentKey}.${childKey}`, childDef, tool);
      }
    }
  }
}
