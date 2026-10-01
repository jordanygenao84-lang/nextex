/**
 * NEXTEХ Agent Core — Herramienta Nativa: Escritura de Registros en el Workspace (Fase 4.3)
 * REGLAS ABSOLUTAS DE SEGURIDAD:
 * - Nivel de riesgo: 'write' -> REQUIERE APROBACIÓN HUMANA EXPLÍCITA (Human-in-the-Loop).
 * - Aislamiento forzado: workspace_id inmutable ligado al contexto verificado.
 * - Tablas mutables autorizadas: EXCLUSIVAMENTE 'conversations' y 'agents'.
 * - 'ai_usage' queda TERMINANTEMENTE PROHIBIDO para mutaciones.
 * - Integración con Idempotency Ledger y Fencing Token en PostgreSQL.
 */

import { ToolExecutionContext } from "../types";
import { AgentError, AgentErrorCodes } from "../../types/errors";

const ALLOWED_MUTABLE_TABLES = ["conversations", "agents"] as const;
type MutableTable = (typeof ALLOWED_MUTABLE_TABLES)[number];

export interface DatabaseWriteParams {
  table: string;
  operation?: "insert" | "update" | "delete";
  data?: Record<string, any>;
  recordId?: string;
}

export async function databaseWriteToolHandler(
  params: Record<string, any>,
  context: ToolExecutionContext
): Promise<{ result: any; metadata: Record<string, any> }> {
  const targetTable = (params.table || "").toLowerCase().trim() as MutableTable;
  const operation = (params.operation || "insert").toLowerCase().trim();
  const inputData = params.data || {};

  // 1. Validación estricta de tabla destino
  if (!ALLOWED_MUTABLE_TABLES.includes(targetTable)) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION,
      message: `Escritura denegada en tabla '${targetTable}'. Tablas mutables autorizadas: ${ALLOWED_MUTABLE_TABLES.join(", ")}.`,
      statusCode: 403,
      toolId: "database_write",
      runId: context.runId,
      agentId: context.agentId,
    });
  }

  // 2. Validación de operación permitida
  if (!["insert", "update", "delete"].includes(operation)) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
      message: `Operación '${operation}' no permitida. Operaciones autorizadas: 'insert', 'update', 'delete'.`,
      statusCode: 400,
      toolId: "database_write",
    });
  }

  // 3. Reglas específicas por tabla
  if (targetTable === "agents") {
    if (operation !== "insert") {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION,
        message: "Solo la operación 'insert' está permitida sobre la tabla 'agents'.",
        statusCode: 403,
        toolId: "database_write",
      });
    }
  }

  if (operation === "update" || operation === "delete") {
    if (!params.recordId) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_SCHEMA_INVALID,
        message: `El parámetro 'recordId' es obligatorio para la operación '${operation}'.`,
        statusCode: 400,
        toolId: "database_write",
      });
    }
  }

  // 4. En entorno Supabase con RPC endurecida de Fencing e Idempotencia
  if (context.supabaseClient && context.stepId && context.executionId && context.fencingToken !== undefined) {
    const { data: rpcResult, error: rpcError } = await context.supabaseClient.rpc(
      "execute_authorized_database_write",
      {
        p_run_id: context.runId,
        p_step_id: context.stepId,
        p_execution_id: context.executionId,
        p_fencing_token: Number(context.fencingToken),
        p_expected_payload_hash: context.expectedPayloadHash || "",
      }
    );

    if (rpcError) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
        message: `Fallo RPC en persistencia atómica: ${rpcError.message}`,
        statusCode: 500,
        toolId: "database_write",
        runId: context.runId,
      });
    }

    if (!rpcResult?.success) {
      const code = (rpcResult?.error_code as any) || AgentErrorCodes.TOOL_EXECUTION_FAILED;
      throw new AgentError({
        code,
        message: rpcResult?.error_message || "Error en la mutación autorizada de base de datos.",
        statusCode: code === AgentErrorCodes.TOOL_FENCING_REJECTED ? 409 : 400,
        toolId: "database_write",
        runId: context.runId,
      });
    }

    return {
      result: {
        operation,
        table: targetTable,
        workspace_id: context.workspaceId,
        status: rpcResult.status,
        data: rpcResult.data,
        cached: Boolean(rpcResult.cached),
      },
      metadata: {
        executedAt: new Date().toISOString(),
        mode: "atomic_pg_idempotency_ledger",
        fencingToken: context.fencingToken,
        ledgerId: rpcResult.ledger_id,
        riskLevel: "write",
      },
    };
  }

  // 5. Entorno simulado o ejecución directa de pruebas
  if (targetTable === "conversations") {
    if (operation === "insert") {
      const safeRecord = {
        id: `conv-sim-${Date.now()}`,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        title: inputData.title || "Nueva conversación",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      return {
        result: {
          operation: "insert",
          table: targetTable,
          workspace_id: context.workspaceId,
          record: safeRecord,
          status: "committed",
        },
        metadata: {
          executedAt: new Date().toISOString(),
          mode: "simulated_safe_write",
          riskLevel: "write",
        },
      };
    } else if (operation === "update") {
      const updatedRecord = {
        id: params.recordId,
        workspace_id: context.workspaceId,
        user_id: context.userId,
        title: inputData.title || "Título actualizado",
        updated_at: new Date().toISOString(),
      };
      return {
        result: {
          operation: "update",
          table: targetTable,
          workspace_id: context.workspaceId,
          record: updatedRecord,
          status: "committed",
        },
        metadata: {
          executedAt: new Date().toISOString(),
          mode: "simulated_safe_write",
          riskLevel: "write",
        },
      };
    } else if (operation === "delete") {
      return {
        result: {
          operation: "delete",
          table: targetTable,
          workspace_id: context.workspaceId,
          recordId: params.recordId,
          deleted_rows: 1,
          status: "committed",
        },
        metadata: {
          executedAt: new Date().toISOString(),
          mode: "simulated_safe_write",
          riskLevel: "write",
        },
      };
    }
  } else if (targetTable === "agents") {
    // Para agents, forzamos status = 'draft' y created_by = context.userId
    const agentRecord = {
      id: `agent-sim-${Date.now()}`,
      workspace_id: context.workspaceId,
      created_by: context.userId,
      name: inputData.name || "Nuevo Agente",
      description: inputData.description || null,
      system_instructions: inputData.system_instructions || "Instrucciones base",
      model_id: inputData.model_id || "gpt-4o",
      status: "draft", // Forzado inmutable
      max_steps: inputData.max_steps || 10,
      max_tokens: inputData.max_tokens || 8000,
      timeout_seconds: inputData.timeout_seconds || 60,
      max_tool_calls: inputData.max_tool_calls || 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return {
      result: {
        operation: "insert",
        table: targetTable,
        workspace_id: context.workspaceId,
        record: agentRecord,
        status: "committed",
      },
      metadata: {
        executedAt: new Date().toISOString(),
        mode: "simulated_safe_write",
        riskLevel: "write",
      },
    };
  }

  throw new AgentError({
    code: AgentErrorCodes.TOOL_EXECUTION_FAILED,
    message: `Operación no procesada para ${targetTable}/${operation}.`,
    statusCode: 500,
  });
}
