/**
 * NEXTEХ — Suite de Verificación: Suspensión por Presupuesto Serverless y Reanudación Limpia
 * Valida la interrupción oportuna, checkpoint_requeued, preservación de estado reanudable en AgentRun
 * y reanudación limpia en resumeInterruptedRun().
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import ts from "typescript";

// Registrar hook para resolución y transpilación TypeScript en tiempo de ejecución
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/lib/") || context.parentURL?.includes("/scripts/")) {
      let targetPath = null;
      if (specifier.startsWith("@/")) {
        const sub = specifier.replace("@/", "");
        targetPath = path.resolve(fileURLToPath(new URL("../src/" + sub, import.meta.url)));
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const parentPath = fileURLToPath(context.parentURL);
        const parentDir = path.dirname(parentPath);
        targetPath = path.resolve(parentDir, specifier);
      }

      if (targetPath) {
        if (targetPath.endsWith(".js")) {
          const tsPath = targetPath.slice(0, -3) + ".ts";
          if (existsSync(tsPath)) return nextResolve(pathToFileURL(tsPath).href);
        }
        if (targetPath.endsWith(".ts") && existsSync(targetPath)) {
          return nextResolve(pathToFileURL(targetPath).href);
        }
        if (existsSync(targetPath + ".ts")) {
          return nextResolve(pathToFileURL(targetPath + ".ts").href);
        }
        if (existsSync(path.join(targetPath, "index.ts"))) {
          return nextResolve(pathToFileURL(path.join(targetPath, "index.ts")).href);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const filePath = fileURLToPath(url);
      const source = ts.sys.readFile(filePath, "utf8");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      });
      return {
        format: "module",
        shortCircuit: true,
        source: transpiled.outputText,
      };
    }
    return nextLoad(url, context);
  },
});

async function runBudgetTests() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE OFICIAL: REMEDIACIÓN DEL PRESUPUESTO DEL DURABLE WORKER");
  console.log("VERIFICACIÓN DE INTERRUPCIÓN SERVERLESS, CHECKPOINT Y REANUDACIÓN");
  console.log("==========================================================================\n");

  const { LeaseManager } = await import("../src/lib/jobs/worker/lease.ts");
  const { EpisodicWorker } = await import("../src/lib/jobs/worker/worker.ts");
  const { defaultAgentRuntime } = await import("../src/lib/agents/runtime/runtime.ts");
  const { AgentErrorCodes } = await import("../src/lib/agents/types/errors.ts");
  const { defaultJobQueue } = await import("../src/lib/jobs/queue/queue.ts");
  const { defaultAuthorizationEngine } = await import("../src/lib/agents/governance/authorization.ts");

  const originalAuthzEval = defaultAuthorizationEngine.evaluate;
  defaultAuthorizationEngine.evaluate = async () => ({ decision: "allow" });

  // CASO 1: LeaseManager expone señal de presupuesto y detecta umbral
  {
    const lm = new LeaseManager({ maxInvocationMs: 45000, safetyMarginMs: 15000 });
    const signal = lm.getBudgetSignal();
    assert.ok(signal instanceof AbortSignal, "getBudgetSignal() debe retornar un AbortSignal");
    assert.strictEqual(signal.aborted, false, "La señal no debe estar abortada al iniciar");
    assert.strictEqual(lm.isBudgetExpiring(), false, "isBudgetExpiring() debe ser false inicialmente");
    lm.stopHeartbeat();
    console.log("✓ [CASO 1/8] LeaseManager inicializa AbortSignal y timers correctamente");
  }

  // CASO 2: LeaseManager dispara la señal de presupuesto oportunamente
  {
    const lm = new LeaseManager({ maxInvocationMs: 100, safetyMarginMs: 50 });
    const signal = lm.getBudgetSignal();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(signal.aborted, true, "La señal debe haberse abortado al alcanzar el umbral");
    assert.strictEqual(lm.isBudgetExpiring(), true, "isBudgetExpiring() debe retornar true tras abortar");
    lm.stopHeartbeat();
    console.log("✓ [CASO 2/8] LeaseManager temporizador activa AbortSignal al cumplirse maxInvocationMs - safetyMarginMs");
  }

  // CASO 3: triggerBudgetExceeded aborta con WORKER_BUDGET_EXPIRED
  {
    const lm = new LeaseManager({ maxInvocationMs: 45000, safetyMarginMs: 15000 });
    lm.triggerBudgetExceeded();
    const signal = lm.getBudgetSignal();
    assert.strictEqual(signal.aborted, true, "triggerBudgetExceeded() debe marcar signal.aborted = true");
    assert.strictEqual(signal.reason?.message, "WORKER_BUDGET_EXPIRED", "Razón de aborto debe ser WORKER_BUDGET_EXPIRED");
    lm.stopHeartbeat();
    console.log("✓ [CASO 3/8] triggerBudgetExceeded() emite razón WORKER_BUDGET_EXPIRED");
  }

  // CASO 4: Distinción de causas de aborto en executeRun: AGENT_CANCELLED
  {
    const mockAgent = {
      id: "agent-test-1",
      workspace_id: "ws-test-1",
      name: "Test Agent",
      status: "active",
      model_id: "gpt-4o",
      system_instructions: "Eres un asistente",
      max_tokens: 1000,
      timeout_seconds: 60,
      max_steps: 5,
      max_tool_calls: 5,
      tools: [],
    };

    const cancelController = new AbortController();
    cancelController.abort(new Error("AGENT_CANCELLED"));

    let threwError = null;
    try {
      await defaultAgentRuntime.executeRun(
        mockAgent,
        {
          agent_id: mockAgent.id,
          workspace_id: mockAgent.workspace_id,
          user_id: "user-1",
          input: "Hola",
        },
        undefined,
        cancelController.signal
      );
    } catch (err) {
      threwError = err;
    }

    assert.ok(threwError, "Debe lanzar error ante cancelación");
    assert.strictEqual(threwError.code, AgentErrorCodes.AGENT_CANCELLED, "Error code debe ser AGENT_CANCELLED");
    console.log("✓ [CASO 4/8] executeRun distingue AGENT_CANCELLED como cancelación de usuario");
  }

  // CASO 5: Distinción de causas de aborto en executeRun: WORKER_BUDGET_EXPIRED mantiene estado no terminal
  {
    const mockAgent = {
      id: "agent-test-2",
      workspace_id: "ws-test-1",
      name: "Test Agent 2",
      status: "active",
      model_id: "gpt-4o",
      system_instructions: "Eres un asistente",
      max_tokens: 1000,
      timeout_seconds: 60,
      max_steps: 5,
      max_tool_calls: 5,
      tools: [],
    };

    const budgetController = new AbortController();
    budgetController.abort(new Error("WORKER_BUDGET_EXPIRED"));

    let mockDbUpdatedStatus = null;
    let mockDbCompletedAt = "INITIAL_UNTOUCHED";
    const mockSupabase = {
      rpc: async () => ({
        data: {
          success: true,
          run: {
            id: "run-budget-test",
            workspace_id: mockAgent.workspace_id,
            agent_id: mockAgent.id,
            user_id: "user-1",
            status: "running",
            input: "Hola",
            started_at: new Date().toISOString(),
          },
        },
      }),
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { plan: "pro" } }),
            single: async () => ({ data: { plan: "pro" } }),
          }),
        }),
        update: (payload) => ({
          eq: (field, val) => {
            if (table === "agent_runs") {
              mockDbUpdatedStatus = payload.status;
              if ("completed_at" in payload) {
                mockDbCompletedAt = payload.completed_at;
              }
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };

    let caughtError = null;
    try {
      await defaultAgentRuntime.executeRun(
        mockAgent,
        {
          agent_id: mockAgent.id,
          workspace_id: mockAgent.workspace_id,
          user_id: "user-1",
          input: "Test input",
        },
        mockSupabase,
        budgetController.signal
      );
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, "Debe lanzar error controlado ante expiración de presupuesto");
    assert.strictEqual(caughtError.code, "WORKER_BUDGET_EXPIRED", "Error code debe ser WORKER_BUDGET_EXPIRED");
    assert.strictEqual(mockDbUpdatedStatus, "queued", "AgentRun status debe permanecer en queued para reanudación");
    assert.strictEqual(mockDbCompletedAt, "INITIAL_UNTOUCHED", "completed_at NUNCA debe fijarse ante interrupción de presupuesto");
    console.log("✓ [CASO 5/8] executeRun ante WORKER_BUDGET_EXPIRED persiste status queued y completed_at null");
  }

  // CASO 6: resumeInterruptedRun acepta run en status queued y transiciona a running
  {
    let statusSetInDb = null;
    const mockSupabase = {
      from: (table) => {
        if (table === "agent_runs") {
          return {
            select: () => ({
              eq: (field, val) => ({
                single: async () => ({
                  data: {
                    id: "run-resumed-1",
                    workspace_id: "ws-1",
                    agent_id: "ag-1",
                    user_id: "usr-1",
                    status: "queued",
                    input: "Continuar tarea",
                    tokens_input: 10,
                    tokens_output: 10,
                    total_tokens: 20,
                    steps_count: 1,
                    tool_calls_count: 0,
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload) => ({
              eq: (field, val) => {
                statusSetInDb = payload.status;
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (table === "agent_run_steps") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({
                  data: [
                    {
                      id: "step-1",
                      run_id: "run-resumed-1",
                      workspace_id: "ws-1",
                      step_number: 1,
                      step_type: "AI_REQUEST",
                      status: "completed",
                      output: { content: "Respuesta final completa" },
                    },
                  ],
                }),
              }),
            }),
          };
        }
        if (table === "agents") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "ag-1",
                    status: "active",
                    max_steps: 5,
                    max_tool_calls: 5,
                    tools: [],
                  },
                }),
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) };
      },
    };

    const res = await defaultAgentRuntime.resumeInterruptedRun("run-resumed-1", mockSupabase);
    assert.strictEqual(statusSetInDb, "completed", "Run completado con éxito");
    assert.strictEqual(res.run.status, "completed", "Run finaliza en completed");
    console.log("✓ [CASO 6/8] resumeInterruptedRun reanuda run previamente en queued y lo concluye");
  }

  // CASO 7: resumeInterruptedRun ante WORKER_BUDGET_EXPIRED vuelve a queued
  {
    let updatedStatusOnAbort = null;
    let completedAtOnAbort = "UNTOUCHED";
    const budgetSignal = AbortSignal.abort(new Error("WORKER_BUDGET_EXPIRED"));

    const mockSupabase = {
      from: (table) => {
        if (table === "agent_runs") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "run-resumed-2",
                    workspace_id: "ws-1",
                    agent_id: "ag-1",
                    user_id: "usr-1",
                    status: "queued",
                    input: "Continuar tarea con corte",
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload) => ({
              eq: () => {
                updatedStatusOnAbort = payload.status;
                if ("completed_at" in payload) {
                  completedAtOnAbort = payload.completed_at;
                }
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (table === "agent_run_steps") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [] }),
              }),
            }),
          };
        }
        return {};
      },
    };

    let caughtErr = null;
    try {
      await defaultAgentRuntime.resumeInterruptedRun("run-resumed-2", mockSupabase, budgetSignal);
    } catch (e) {
      caughtErr = e;
    }

    assert.ok(caughtErr, "Debe propagar error de interrupción");
    assert.strictEqual(caughtErr.code, "WORKER_BUDGET_EXPIRED", "Error debe ser WORKER_BUDGET_EXPIRED");
    assert.strictEqual(updatedStatusOnAbort, "queued", "Status debe actualizarse a queued para siguiente invocación");
    assert.strictEqual(completedAtOnAbort, "UNTOUCHED", "completed_at NUNCA debe marcarse");
    console.log("✓ [CASO 7/8] resumeInterruptedRun ante corte de presupuesto re-establece queued sin completed_at");
  }

  // CASO 8: EpisodicWorker intercepta interrupción de presupuesto y realiza checkpoint_and_requeue
  {
    const worker = new EpisodicWorker();
    let checkpointCalled = false;
    let requeuedRunId = null;

    const originalCheckpoint = defaultJobQueue.checkpointAndRequeue;
    defaultJobQueue.checkpointAndRequeue = async (runId, workerId, fencingToken, sb) => {
      checkpointCalled = true;
      requeuedRunId = runId;
      return true;
    };

    const mockJobRun = {
      id: "job-run-budget-123",
      workspace_id: "ws-test",
      job_id: "job-123",
      agent_id: "ag-budget-test",
      attempt: 1,
      fencing_token: 42,
      input: "Execute heavy task",
      queued_at: new Date().toISOString(),
    };

    const mockSupabase = {
      rpc: async () => ({ data: { success: true } }),
      from: (table) => {
        if (table === "agents") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: "ag-budget-test",
                      workspace_id: "ws-test",
                      status: "active",
                      model_id: "mock-model",
                      system_instructions: "Instrucciones",
                      max_tokens: 1000,
                      timeout_seconds: 60,
                      max_steps: 5,
                      max_tool_calls: 5,
                      agent_tools: [],
                    },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "agent_runs") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }), // No previo, ejecución inicial
              }),
            }),
            update: () => ({ eq: () => Promise.resolve({ data: null }) }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      },
    };

    const originalClaimNext = defaultJobQueue.claimNext;
    defaultJobQueue.claimNext = async () => mockJobRun;

    const originalExecuteRun = defaultAgentRuntime.executeRun;
    defaultAgentRuntime.executeRun = async (agent, dto, sb, signal) => {
      // Simular que el presupuesto expiró en plena ejecución
      const err = new Error("WORKER_BUDGET_EXPIRED");
      err.code = "WORKER_BUDGET_EXPIRED";
      throw err;
    };

    try {
      const tickResult = await worker.executeTick(mockSupabase, "wrk-budget-verifier");
      assert.strictEqual(tickResult.processed, true, "Worker tick procesó el job");
      assert.strictEqual(tickResult.status, "checkpoint_requeued", "Status debe ser checkpoint_requeued");
      assert.strictEqual(checkpointCalled, true, "defaultJobQueue.checkpointAndRequeue fue invocado");
      assert.strictEqual(requeuedRunId, "job-run-budget-123", "RunId reencolado coincide con el del job");
      console.log("✓ [CASO 8/8] EpisodicWorker intercepta interrupción de presupuesto, llama a checkpointAndRequeue y retorna checkpoint_requeued");
    } finally {
      defaultJobQueue.claimNext = originalClaimNext;
      defaultJobQueue.checkpointAndRequeue = originalCheckpoint;
      defaultAgentRuntime.executeRun = originalExecuteRun;
    }
  }

  console.log("\n==========================================================================");
  console.log("TODOS LOS 8 CASOS DE REMEDIACIÓN DE PRESUPUESTO PASARON EXITOSAMENTE (8/8 PASS)");
  console.log("==========================================================================");
}

runBudgetTests().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
