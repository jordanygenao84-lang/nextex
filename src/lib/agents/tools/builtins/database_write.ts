/**
 * NEXTEХ Agent Core — Herramienta Nativa: Escritura de Registros en el Workspace
 * REGLA DE SEGURIDAD ESTRICTA:
 * - Nivel de riesgo: 'write' -> REQUIERE APROBACIÓN HUMANA EXPLÍCITA (Human-in-the-Loop).
 * - Aislamiento forzado: workspace_id inmutable ligado al contexto del agente.
 * - Tablas mutables autorizadas restringidas.
 */

import { ToolExecutionContext } from "../types";

const ALLOWED_MUTABLE_TABLES = [
  "conversations",
  "ai_usage",
  "agents",
];

export interface DatabaseWriteParams {
  table: string;
  operation?: "insert" | "update";
  data: Record<string, any>;
  recordId?: string;
}

export async function databaseWriteToolHandler(
  params: Record<string, any>,
  context: ToolExecutionContext
): Promise<{ result: any; metadata: Record<string, any> }> {
  const targetTable = (params.table || "").toLowerCase().trim();
  const operation = params.operation || "insert";
  const inputData = params.data || {};

  if (!ALLOWED_MUTABLE_TABLES.includes(targetTable)) {
    throw new Error(
      `Escritura denegada en tabla '${targetTable}'. Tablas mutables permitidas: ${ALLOWED_MUTABLE_TABLES.join(", ")}.`
    );
  }

  if (typeof inputData !== "object" || Array.isArray(inputData) || Object.keys(inputData).length === 0) {
    throw new Error("El parámetro 'data' debe contener un objeto con los campos a persistir.");
  }

  // Aislamiento Multi-Tenant Forzado: Asegurar que workspace_id no pueda ser falsificado
  const safeData = {
    ...inputData,
    workspace_id: context.workspaceId,
  };

  // En entorno simulado o pruebas sin cliente Supabase activo
  if (!context.supabaseClient) {
    return {
      result: {
        operation,
        table: targetTable,
        workspace_id: context.workspaceId,
        id: params.recordId || `rec-sim-${Date.now()}`,
        status: "persisted",
        data: safeData,
      },
      metadata: {
        executedAt: new Date().toISOString(),
        mode: "simulated_safe_write",
        riskLevel: "write",
        requiresApproval: true,
      },
    };
  }

  // Ejecución en Supabase con RLS
  if (operation === "insert") {
    const { data: inserted, error } = await (context.supabaseClient
      .from(targetTable) as any)
      .insert(safeData)
      .select()
      .single();

    if (error) {
      throw new Error(`Fallo en inserción sobre '${targetTable}': ${error.message}`);
    }

    return {
      result: {
        operation: "insert",
        table: targetTable,
        workspace_id: context.workspaceId,
        record: inserted,
      },
      metadata: {
        executedAt: new Date().toISOString(),
        mode: "live_supabase_rls",
      },
    };
  } else if (operation === "update") {
    if (!params.recordId) {
      throw new Error("Se requiere 'recordId' para operaciones de actualización.");
    }

    const { data: updated, error } = await (context.supabaseClient
      .from(targetTable) as any)
      .update(safeData)
      .eq("id", params.recordId)
      .eq("workspace_id", context.workspaceId)
      .select()
      .single();

    if (error) {
      throw new Error(`Fallo en actualización sobre '${targetTable}': ${error.message}`);
    }

    return {
      result: {
        operation: "update",
        table: targetTable,
        workspace_id: context.workspaceId,
        record: updated,
      },
      metadata: {
        executedAt: new Date().toISOString(),
        mode: "live_supabase_rls",
      },
    };
  }

  throw new Error(`Operación '${operation}' no soportada. Permitidas: 'insert', 'update'.`);
}
