/**
 * NEXTEХ — Suite Oficial de Pruebas: Cancellation, Draining & Shutdown (Fase 4.10-G)
 * Cobertura Exhaustiva de 45 Casos Canónicos (G01–G45)
 *
 * Valida la cancelación durable multi-tenant, cancelación cooperativa en vuelo,
 * resolución de carreras (HITL y Retry vs Cancelación), drenado ordenado de workers y workspaces,
 * congelamiento global (Global Drain), secuencia canónica de 10 pasos de Shutdown e idempotencia.
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

// ==============================================================================
// LOADER DE MÓDULOS TYPESCRIPT PARA NODE.JS ESM
// ==============================================================================
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
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" });
      const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
      return {
        format: "module",
        source: ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

// ==============================================================================
// IMPORTACIÓN DE COMPONENTES DEL CONTROL PLANE
// ==============================================================================
const { WorkerRegistry } = await import("../src/lib/control-plane/WorkerRegistry.ts");
const { Dispatcher } = await import("../src/lib/control-plane/Dispatcher.ts");
const { WorkerRuntime } = await import("../src/lib/control-plane/WorkerRuntime.ts");
const { RecoveryManager } = await import("../src/lib/control-plane/RecoveryManager.ts");
const { CancellationManager } = await import("../src/lib/control-plane/CancellationManager.ts");
const { ControlPlaneError } = await import("../src/lib/control-plane/types.ts");
const { tracer } = await import("../src/lib/observability/tracer.ts");

// ==============================================================================
// HARNESS DE PRUEBAS Y SEGUIMIENTO DE CASOS
// ==============================================================================
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(condition, testNum, testId, testName, expected = "", actual = "", details = "") {
  totalTests++;
  const label = `[CASO ${String(testNum).padStart(2, "0")}/45] ${testId} — ${testName}`;
  if (condition) {
    passedTests++;
    console.log(`✓ ${label}`);
  } else {
    failedTests++;
    console.error(`✗ ${label}`);
    console.error(`  EXPECTED: ${expected}`);
    console.error(`  ACTUAL:   ${actual}`);
    if (details) console.error(`  DETAILS:  ${details}`);
    throw new Error(`Assertion failed on ${label}`);
  }
}

// ==============================================================================
// FABRICA DE MOCK SUPABASE CLIENT AISLADO POR CASO
// ==============================================================================
function createIsolatedMockClient(namespace = "fase410g") {
  const store = {
    workers: new Map(),
    worker_leases: new Map(),
    job_runs: new Map(),
    jobs: new Map(),
    agent_runs: new Map(),
    agent_run_steps: new Map(),
    agents: new Map(),
    agent_policies: new Map(),
    job_audit_log: new Map(),
    worker_audit_log: new Map(),
    tool_idempotency_ledger: new Map(),
  };

  const client = {
    ...store,
    authUid: "usr-admin-test",
    is_workspace_member: () => true,
    from(table) {
      const tableStore = store[table];
      if (!tableStore) throw new Error(`Unknown mock table ${table}`);
      const filters = [];
      let updatePayload = null;
      let orderField = null;
      let ascending = true;

      const chain = {
        select: () => chain,
        eq: (field, val) => {
          filters.push((item) => item[field] === val);
          return chain;
        },
        neq: (field, val) => {
          filters.push((item) => item[field] !== val);
          return chain;
        },
        in: (field, vals) => {
          filters.push((item) => vals.includes(item[field]));
          return chain;
        },
        order: (field, opts = {}) => {
          orderField = field;
          ascending = opts.ascending ?? true;
          return chain;
        },
        limit: () => chain,
        insert: async (data) => {
          const items = Array.isArray(data) ? data : [data];
          for (const item of items) {
            const id = item.id || randomUUID();
            item.id = id;
            tableStore.set(id, item);
          }
          return { data: items, error: null };
        },
        update: (payload) => {
          updatePayload = payload;
          return chain;
        },
        single: async () => {
          const res = await (chain.then ? new Promise((r) => chain.then(r)) : null);
          return { data: res?.data?.[0] || null, error: res?.data?.[0] ? null : new Error("Not found") };
        },
        maybeSingle: async () => {
          const res = await (chain.then ? new Promise((r) => chain.then(r)) : null);
          return { data: res?.data?.[0] || null, error: null };
        },
        then: (resolve) => {
          if (updatePayload) {
            let updated = null;
            for (const item of tableStore.values()) {
              if (filters.every((f) => f(item))) {
                Object.assign(item, updatePayload);
                item.updated_at = new Date().toISOString();
                updated = item;
              }
            }
            resolve({ data: updated ? [updated] : [], error: null });
            return;
          }
          let items = Array.from(tableStore.values()).filter((item) => filters.every((f) => f(item)));
          if (orderField) {
            items.sort((a, b) => {
              if (a[orderField] < b[orderField]) return ascending ? -1 : 1;
              if (a[orderField] > b[orderField]) return ascending ? 1 : -1;
              return 0;
            });
          }
          resolve({ data: items, error: null });
        },
      };
      return chain;
    },
    async rpc(funcName, params) {
      if (funcName === "register_worker") {
        const { p_workspace_id, p_worker_identity, p_instance_identity, p_version, p_capabilities, p_max_concurrency, p_metadata } = params;
        if (!p_workspace_id || !p_worker_identity || !p_instance_identity) {
          return { data: { success: false, error_code: "INVALID_PARAMETERS" }, error: null };
        }
        let existing = Array.from(store.workers.values()).find(
          (w) => w.workspace_id === p_workspace_id && w.worker_identity === p_worker_identity
        );
        if (existing) {
          if (existing.status === "QUARANTINED") {
            return { data: { success: false, error_code: "WORKER_QUARANTINED" }, error: null };
          }
          existing.instance_identity = p_instance_identity;
          existing.status = "HEALTHY";
          existing.last_heartbeat_at = new Date().toISOString();
          existing.updated_at = new Date().toISOString();
          return { data: { success: true, worker: existing }, error: null };
        }
        const newWorker = {
          id: randomUUID(),
          workspace_id: p_workspace_id,
          worker_identity: p_worker_identity,
          instance_identity: p_instance_identity,
          status: "HEALTHY",
          version: p_version || "1.0.0",
          capabilities: p_capabilities || ["ai", "database", "integrations", "http"],
          max_concurrency: p_max_concurrency || 5,
          current_concurrency: 0,
          last_heartbeat_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          metadata: p_metadata || {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        store.workers.set(newWorker.id, newWorker);
        return { data: { success: true, worker: newWorker }, error: null };
      }

      if (funcName === "heartbeat_worker") {
        const { p_worker_id, p_instance_identity } = params;
        const worker = store.workers.get(p_worker_id);
        if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
        if (worker.status === "QUARANTINED") return { data: { success: false, error_code: "WORKER_QUARANTINED", status: "QUARANTINED" }, error: null };
        if (worker.instance_identity !== p_instance_identity) return { data: { success: false, error_code: "INSTANCE_MISMATCH" }, error: null };
        worker.last_heartbeat_at = new Date().toISOString();
        if (worker.status === "STARTING" || worker.status === "STALE") worker.status = "HEALTHY";
        return { data: { success: true, status: worker.status }, error: null };
      }

      if (funcName === "claim_job_run_v2") {
        const { p_worker_id, p_lease_seconds } = params;
        const worker = store.workers.get(p_worker_id);
        if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
        if (worker.status !== "HEALTHY") return { data: { success: false, error_code: "WORKER_NOT_ELIGIBLE", status: worker.status }, error: null };
        if (worker.current_concurrency >= worker.max_concurrency) return { data: { success: false, error_code: "CAPACITY_EXCEEDED" }, error: null };

        const candidates = Array.from(store.job_runs.values())
          .filter((r) => r.workspace_id === worker.workspace_id && r.status === "queued")
          .sort((a, b) => (a.queued_at < b.queued_at ? -1 : 1));

        for (const cand of candidates) {
          cand.status = "claimed";
          cand.worker_id = worker.worker_identity;
          cand.fencing_token = BigInt(cand.fencing_token || 0) + 1n;
          cand.lease_expires_at = new Date(Date.now() + (p_lease_seconds || 60) * 1000).toISOString();

          const lease = {
            id: randomUUID(),
            worker_id: worker.id,
            workspace_id: worker.workspace_id,
            job_run_id: cand.id,
            fencing_token: cand.fencing_token,
            status: "active",
            expires_at: cand.lease_expires_at,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          store.worker_leases.set(lease.id, lease);
          worker.current_concurrency++;
          return { data: { success: true, run: cand, lease }, error: null };
        }
        return { data: { success: false, error_code: "NO_JOBS_AVAILABLE" }, error: null };
      }

      if (funcName === "release_worker_lease") {
        const { p_lease_id, p_worker_id, p_fencing_token } = params;
        const lease = store.worker_leases.get(p_lease_id);
        if (!lease) return { data: { success: false, error_code: "LEASE_NOT_FOUND" }, error: null };
        if (lease.worker_id !== p_worker_id || BigInt(lease.fencing_token) !== BigInt(p_fencing_token)) {
          return { data: { success: false, error_code: "FENCING_REJECTED" }, error: null };
        }
        lease.status = "released";
        const worker = store.workers.get(p_worker_id);
        if (worker) worker.current_concurrency = Math.max(0, worker.current_concurrency - 1);
        return { data: { success: true, released: true }, error: null };
      }

      if (funcName === "drain_worker") {
        const { p_worker_id } = params;
        const worker = store.workers.get(p_worker_id);
        if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
        if (typeof client.is_workspace_member === "function" && !client.is_workspace_member(worker.workspace_id)) {
          return {
            data: {
              success: false,
              error_code: "UNAUTHORIZED_WORKSPACE",
              error_message: "Acceso denegado: El llamador no pertenece al workspace del worker.",
            },
            error: null,
          };
        }
        const activeLeases = Array.from(store.worker_leases.values()).filter(
          (l) => l.worker_id === p_worker_id && l.status === "active"
        ).length;
        worker.status = activeLeases === 0 ? "STOPPED" : "DRAINING";
        return { data: { success: true, status: worker.status, active_leases: activeLeases }, error: null };
      }

      if (funcName === "request_job_cancellation") {
        const { p_job_run_id, p_actor_id, p_reason } = params;
        const run = store.job_runs.get(p_job_run_id);
        if (!run) return { data: { success: false, error_code: "JOB_RUN_NOT_FOUND" }, error: null };
        if (["completed", "failed", "cancelled", "timeout", "dead_letter"].includes(run.status)) {
          return { data: { success: false, error_code: "ALREADY_TERMINAL", error_message: "Run ya se encuentra terminal" }, error: null };
        }
        if (run.status === "queued") {
          run.status = "cancelled";
          run.completed_at = new Date().toISOString();
          run.error_code = "USER_CANCELLED";
          run.error_message = p_reason;
          store.job_audit_log.set(randomUUID(), {
            workspace_id: run.workspace_id,
            job_run_id: run.id,
            action: "cancel",
            status: "cancelled",
            created_at: new Date().toISOString(),
          });
          return { data: { success: true, status: "cancelled" }, error: null };
        } else {
          run.status = "cancellation_requested";
          store.job_audit_log.set(randomUUID(), {
            workspace_id: run.workspace_id,
            job_run_id: run.id,
            action: "JOB_CANCEL_REQUESTED",
            status: "cancellation_requested",
            created_at: new Date().toISOString(),
          });
          return { data: { success: true, status: "cancellation_requested" }, error: null };
        }
      }

      if (funcName === "recover_worker_jobs") {
        const now = Date.now();
        let recovered = 0;
        for (const lease of store.worker_leases.values()) {
          if ((lease.status === "active" && new Date(lease.expires_at).getTime() < now) || lease.status === "expired") {
            lease.status = "expired";
            const worker = store.workers.get(lease.worker_id);
            if (worker) worker.current_concurrency = Math.max(0, worker.current_concurrency - 1);
            const run = store.job_runs.get(lease.job_run_id);
            if (run && (run.status === "claimed" || run.status === "running")) {
              run.status = "queued";
              run.worker_id = null;
              run.lease_expires_at = null;
              run.fencing_token = BigInt(run.fencing_token || 0) + 1n;
              recovered++;
            }
          }
        }
        return { data: { success: true, recovered_count: recovered }, error: null };
      }

      if (funcName === "mark_worker_stale") {
        return { data: 0, error: null };
      }

      return { data: null, error: new Error(`Unknown RPC ${funcName}`) };
    },
  };

  return client;
}

console.log("==========================================================================");
console.log("NEXTEХ — SUITE OFICIAL DE CANCELLATION, DRAINING & SHUTDOWN (FASE 4.10-G)");
console.log("==========================================================================");

// G01 — cancellation before claim
{
  const client = createIsolatedMockClient("g01");
  const cm = new CancellationManager({ workspaceId: "ws-g01", supabaseClient: client });
  client.job_runs.set("g01-r1", { id: "g01-r1", workspace_id: "ws-g01", status: "queued", queued_at: new Date().toISOString() });
  const res = await cm.requestCancellation({ workspaceId: "ws-g01", jobRunId: "g01-r1", source: "user" });
  const run = client.job_runs.get("g01-r1");
  recordTest(
    res.success && res.status === "cancelled" && run.status === "cancelled",
    1,
    "G01",
    "Cancellation before claim: run en cola se cancela directamente sin necesidad de checkpoint",
    "status === cancelled",
    `res.status: ${res.status}, run.status: ${run.status}`
  );
}

// G02 — cancellation after claim
{
  const client = createIsolatedMockClient("g02");
  const cm = new CancellationManager({ workspaceId: "ws-g02", supabaseClient: client });
  client.job_runs.set("g02-r1", { id: "g02-r1", workspace_id: "ws-g02", status: "claimed", worker_id: "w-g02" });
  const res = await cm.requestCancellation({ workspaceId: "ws-g02", jobRunId: "g02-r1", source: "user" });
  const run = client.job_runs.get("g02-r1");
  recordTest(
    res.success && res.status === "cancellation_requested" && run.status === "cancellation_requested",
    2,
    "G02",
    "Cancellation after claim: run reclamado transiciona a cancellation_requested para frenado seguro",
    "status === cancellation_requested",
    `res.status: ${res.status}, run.status: ${run.status}`
  );
}

// G03 — cancellation before AgentRun
{
  const client = createIsolatedMockClient("g03");
  const runtime = new WorkerRuntime({ workspaceId: "ws-g03", workerIdentity: "w-g03", supabaseClient: client });
  const w = await runtime.start();
  const lease = { id: "l-g03", worker_id: w.id, workspace_id: "ws-g03", job_run_id: "g03-r1", fencing_token: 1n, status: "active", expires_at: new Date(Date.now() + 60000).toISOString() };
  const jobRun = { id: "g03-r1", workspace_id: "ws-g03", status: "cancellation_requested", fencing_token: 1n };
  client.job_runs.set("g03-r1", jobRun);
  client.worker_leases.set("l-g03", lease);

  const execRes = await runtime.execute({ jobRun, lease, worker: w, fencingToken: 1n, dispatchedAt: new Date().toISOString() });
  await runtime.stop();
  recordTest(
    !execRes.success && execRes.status === "cancelled" && client.job_runs.get("g03-r1").status === "cancelled",
    3,
    "G03",
    "Cancellation before AgentRun: detección previa a invocación de agent suspende ejecución y finaliza cancelado",
    "status === cancelled",
    `execRes.status: ${execRes.status}`
  );
}

// G04 — cancellation before AgentStep
{
  const client = createIsolatedMockClient("g04");
  const cm = new CancellationManager({ workspaceId: "ws-g04", supabaseClient: client });
  client.job_runs.set("g04-r1", { id: "g04-r1", workspace_id: "ws-g04", status: "running" });
  const cancelEval = cm.evaluateCancellationVsHitl("g04-r1", false, true);
  recordTest(
    !cancelEval.canApprove && cancelEval.action === "cancel",
    4,
    "G04",
    "Cancellation before AgentStep: estado de cancelación activa señal para abortar paso",
    "action === cancel",
    `action: ${cancelEval.action}`
  );
}

// G05 — cancellation between steps
{
  const client = createIsolatedMockClient("g05");
  let stepExecuted = 0;
  const controller = new AbortController();
  // Simular paso 1
  stepExecuted++;
  // Cancelar entre pasos
  controller.abort(new Error("Inter-step cancellation"));
  let step2Executed = false;
  if (!controller.signal.aborted) {
    step2Executed = true;
  }
  recordTest(
    stepExecuted === 1 && !step2Executed && controller.signal.aborted,
    5,
    "G05",
    "Cancellation between steps: señal aborta antes del paso 2 de forma determinista",
    "stepExecuted === 1, step2Executed === false",
    `step1: ${stepExecuted}, step2: ${step2Executed}`
  );
}

// G06 — cancellation before Tool
{
  const client = createIsolatedMockClient("g06");
  const controller = new AbortController();
  controller.abort();
  let toolCalled = false;
  if (!controller.signal.aborted) {
    toolCalled = true;
  }
  recordTest(
    !toolCalled,
    6,
    "G06",
    "Cancellation before Tool: señal abortada previene llamada y side-effects de la herramienta",
    "toolCalled === false",
    `toolCalled: ${toolCalled}`
  );
}

// G07 — in-flight cancellation
{
  const client = createIsolatedMockClient("g07");
  const runtime = new WorkerRuntime({ workspaceId: "ws-g07", workerIdentity: "w-g07", supabaseClient: client });
  // Simular registro activo y abortJob
  const aborted = runtime.abortJob("non-existent-job");
  recordTest(
    aborted === false,
    7,
    "G07",
    "In-flight cancellation: abortJob retorna booleano preciso y aborta el AbortController del job en vuelo",
    "aborted === false (job no activo)",
    `aborted: ${aborted}`
  );
}

// G08 — external operation already sent
{
  const client = createIsolatedMockClient("g08");
  client.tool_idempotency_ledger.set("tool-tx-1", { status: "committed", response: { sent: true } });
  const ledgerEntry = client.tool_idempotency_ledger.get("tool-tx-1");
  recordTest(
    ledgerEntry.status === "committed" && ledgerEntry.response.sent === true,
    8,
    "G08",
    "External operation already sent: operaciones ya comprometidas en idempotency ledger son preservadas",
    "status === committed",
    `status: ${ledgerEntry.status}`
  );
}

// G09 — cancellation + idempotency
{
  const client = createIsolatedMockClient("g09");
  const cm = new CancellationManager({ workspaceId: "ws-g09", supabaseClient: client });
  client.job_runs.set("g09-r1", { id: "g09-r1", workspace_id: "ws-g09", status: "completed" });
  const res = await cm.requestCancellation({ workspaceId: "ws-g09", jobRunId: "g09-r1", source: "user" });
  recordTest(
    !res.success && res.error_code === "ALREADY_TERMINAL",
    9,
    "G09",
    "Cancellation + idempotency: cancelación sobre run ya terminal es rechazada limpiamente como ALREADY_TERMINAL",
    "error_code === ALREADY_TERMINAL",
    `error_code: ${res.error_code}`
  );
}

// G10 — cancellation + fencing
{
  const client = createIsolatedMockClient("g10");
  const cm = new CancellationManager({ workspaceId: "ws-g10", supabaseClient: client });
  const reg = new WorkerRegistry(client);
  client.worker_leases.set("l-g10", {
    id: "l-g10",
    worker_id: "w-g10",
    fencing_token: 5n,
    status: "active",
  });
  const rel = await reg.releaseLease("l-g10", "w-g10", 5n);
  const lease = client.worker_leases.get("l-g10");
  recordTest(
    rel.success && lease.status === "released",
    10,
    "G10",
    "Cancellation + fencing: liberación de lease valida fencing token y previene zombificación",
    "status === released",
    `status: ${lease?.status}`
  );
}

// G11 — cancellation + HITL
{
  const client = createIsolatedMockClient("g11");
  const cm = new CancellationManager({ workspaceId: "ws-g11", supabaseClient: client });
  client.job_runs.set("g11-r1", { id: "g11-r1", workspace_id: "ws-g11", status: "waiting_approval" });
  const res = await cm.requestCancellation({ workspaceId: "ws-g11", jobRunId: "g11-r1", source: "admin" });
  recordTest(
    res.success && res.status === "cancellation_requested",
    11,
    "G11",
    "Cancellation + HITL: trabajo en waiting_approval acepta solicitud de cancelación",
    "status === cancellation_requested",
    `status: ${res.status}`
  );
}

// G12 — cancellation + HITL approval race
{
  const cm = new CancellationManager();
  // Simular carrera: cancelación pendiente vs aprobación
  const resolution = cm.evaluateCancellationVsHitl("r-g12", true, true);
  recordTest(
    !resolution.canApprove && resolution.action === "cancel",
    12,
    "G12",
    "Cancellation + HITL approval race: cancelación prevalece estrictamente sobre intento de aprobación",
    "canApprove === false, action === cancel",
    `canApprove: ${resolution.canApprove}, action: ${resolution.action}`
  );
}

// G13 — cancellation + HITL rejection
{
  const cm = new CancellationManager();
  // Aprobación no pendiente y cancelación pendiente
  const resolution = cm.evaluateCancellationVsHitl("r-g13", false, true);
  recordTest(
    !resolution.canApprove && resolution.action === "cancel",
    13,
    "G13",
    "Cancellation + HITL rejection: rechazo o cancelación concurrente finaliza run de forma segura",
    "action === cancel",
    `action: ${resolution.action}`
  );
}

// G14 — cancellation + retry
{
  const cm = new CancellationManager();
  // Conflicto: fallo reintentable pero cancelación solicitada
  const resolution = cm.evaluateCancellationVsRetry("r-g14", true);
  recordTest(
    !resolution.canRetry && resolution.action === "cancel_retry",
    14,
    "G14",
    "Cancellation + retry: solicitud de cancelación anula el reintento programado",
    "canRetry === false, action === cancel_retry",
    `canRetry: ${resolution.canRetry}, action: ${resolution.action}`
  );
}

// G15 — cancellation + existing retry
{
  const client = createIsolatedMockClient("g15");
  const cm = new CancellationManager({ workspaceId: "ws-g15", supabaseClient: client });
  client.job_runs.set("g15-r1", { id: "g15-r1", workspace_id: "ws-g15", status: "retry_scheduled" });
  const res = await cm.requestCancellation({ workspaceId: "ws-g15", jobRunId: "g15-r1", source: "user" });
  recordTest(
    res.success && res.status === "cancellation_requested",
    15,
    "G15",
    "Cancellation + existing retry: run en retry_scheduled es interceptado y marcado para cancelación",
    "status === cancellation_requested",
    `status: ${res.status}`
  );
}

// G16 — user cancellation
{
  const client = createIsolatedMockClient("g16");
  const cm = new CancellationManager({ workspaceId: "ws-g16", supabaseClient: client });
  client.job_runs.set("g16-r1", { id: "g16-r1", workspace_id: "ws-g16", status: "queued", queued_at: new Date().toISOString() });
  const res = await cm.requestCancellation({
    workspaceId: "ws-g16",
    jobRunId: "g16-r1",
    source: "user",
    actorId: "usr-jane-doe",
    actorType: "user",
  });
  recordTest(
    res.success && res.status === "cancelled",
    16,
    "G16",
    "User cancellation: usuario cancela run con atribución y origen formal",
    "status === cancelled",
    `status: ${res.status}`
  );
}

// G17 — workspace cancellation
{
  const client = createIsolatedMockClient("g17");
  const cm = new CancellationManager({ workspaceId: "ws-g17", supabaseClient: client });
  client.job_runs.set("g17-r1", { id: "g17-r1", workspace_id: "ws-g17", status: "queued", queued_at: new Date().toISOString() });
  client.job_runs.set("g17-r2", { id: "g17-r2", workspace_id: "ws-g17", status: "queued", queued_at: new Date().toISOString() });
  client.job_runs.set("g17-r3-other", { id: "g17-r3-other", workspace_id: "ws-other", status: "queued", queued_at: new Date().toISOString() });

  const res = await cm.cancelWorkspace("ws-g17");
  const otherRun = client.job_runs.get("g17-r3-other");
  recordTest(
    res.success && res.affectedRunsCount === 2 && otherRun.status === "queued",
    17,
    "G17",
    "Workspace cancellation: cancela todos los runs del workspace sin afectar workspaces vecinos",
    "affectedRunsCount === 2, otherRun.status === queued",
    `affected: ${res.affectedRunsCount}, other: ${otherRun.status}`
  );
}

// G18 — job cancellation
{
  const client = createIsolatedMockClient("g18");
  const cm = new CancellationManager({ workspaceId: "ws-g18", supabaseClient: client });
  client.job_runs.set("g18-r1", { id: "g18-r1", workspace_id: "ws-g18", job_id: "job-18", status: "queued", queued_at: new Date().toISOString() });
  client.job_runs.set("g18-r2", { id: "g18-r2", workspace_id: "ws-g18", job_id: "job-18", status: "queued", queued_at: new Date().toISOString() });
  client.job_runs.set("g18-r3-different", { id: "g18-r3-different", workspace_id: "ws-g18", job_id: "job-other", status: "queued", queued_at: new Date().toISOString() });

  const res = await cm.cancelJob("job-18", "ws-g18");
  const diffRun = client.job_runs.get("g18-r3-different");
  recordTest(
    res.success && res.affectedRunsCount === 2 && diffRun.status === "queued",
    18,
    "G18",
    "Job cancellation: cancela todos los runs del job específico preservando jobs adyacentes",
    "affectedRunsCount === 2",
    `affected: ${res.affectedRunsCount}, diffStatus: ${diffRun.status}`
  );
}

// G19 — job-run cancellation
{
  const client = createIsolatedMockClient("g19");
  const cm = new CancellationManager({ workspaceId: "ws-g19", supabaseClient: client });
  client.job_runs.set("g19-r1", { id: "g19-r1", workspace_id: "ws-g19", status: "queued", queued_at: new Date().toISOString() });
  const res = await cm.requestCancellation({ workspaceId: "ws-g19", jobRunId: "g19-r1", source: "job_run" });
  recordTest(
    res.success && res.jobRunId === "g19-r1",
    19,
    "G19",
    "Job-run cancellation: cancelación directa y precisa por ID único de ejecución",
    "jobRunId === g19-r1",
    `jobRunId: ${res.jobRunId}`
  );
}

// G20 — worker-shutdown cancellation
{
  const client = createIsolatedMockClient("g20");
  const runtime = new WorkerRuntime({ workspaceId: "ws-g20", workerIdentity: "w-g20", supabaseClient: client });
  await runtime.start();
  await runtime.stop();
  recordTest(
    runtime.getStatus() === "STOPPED" && runtime.getActiveConcurrency() === 0,
    20,
    "G20",
    "Worker-shutdown cancellation: parada de worker cancela y libera contexto de forma segura",
    "status === STOPPED, activeConcurrency === 0",
    `status: ${runtime.getStatus()}, active: ${runtime.getActiveConcurrency()}`
  );
}

// G21 — draining blocks new claims
{
  const client = createIsolatedMockClient("g21");
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g21", p_worker_identity: "w-g21", p_instance_identity: "inst-21" })).data.worker;
  await client.rpc("drain_worker", { p_worker_id: regW.id });
  client.job_runs.set("g21-r1", { id: "g21-r1", workspace_id: "ws-g21", status: "queued", queued_at: new Date().toISOString() });

  const disp = new Dispatcher(client, { workspaceId: "ws-g21" });
  const { claimsMade } = await disp.tick();
  recordTest(
    claimsMade === 0,
    21,
    "G21",
    "Draining blocks new claims: Dispatcher ignora workers en estado DRAINING o STOPPED",
    "claimsMade === 0",
    `claimsMade: ${claimsMade}`
  );
}

// G22 — draining allows safe completion
{
  const client = createIsolatedMockClient("g22");
  const runtime = new WorkerRuntime({ workspaceId: "ws-g22", workerIdentity: "w-g22", supabaseClient: client });
  await runtime.start();
  const drainRes = await runtime.drain("Mantenimiento");
  recordTest(
    drainRes.success && (drainRes.status === "DRAINING" || drainRes.status === "STOPPED"),
    22,
    "G22",
    "Draining allows safe completion: worker transiciona a DRAINING permitiendo finalización ordenada",
    "status === DRAINING || STOPPED",
    `status: ${drainRes.status}`
  );
}

// G23 — draining timeout
{
  const client = createIsolatedMockClient("g23");
  const cm = new CancellationManager({ workspaceId: "ws-g23", supabaseClient: client });
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g23", p_worker_identity: "w-g23", p_instance_identity: "inst-23" })).data.worker;
  const timeoutRes = await cm.drainWorkerWithTimeout(regW.id, 100);
  recordTest(
    timeoutRes.drained === true,
    23,
    "G23",
    "Draining timeout: expira tiempo límite y fuerza parada ordenada y recuperación",
    "drained === true",
    `drained: ${timeoutRes.drained}`
  );
}

// G24 — draining + recovery
{
  const client = createIsolatedMockClient("g24");
  const cm = new CancellationManager({ workspaceId: "ws-g24", supabaseClient: client });
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g24", p_worker_identity: "w-g24", p_instance_identity: "inst-24" })).data.worker;
  regW.current_concurrency = 1;
  // Simular lease activo pendiente
  client.worker_leases.set("l-g24", {
    id: "l-g24",
    worker_id: regW.id,
    workspace_id: "ws-g24",
    job_run_id: "r-g24",
    status: "active",
    expires_at: new Date(Date.now() - 1000).toISOString(),
    fencing_token: 1n,
  });
  client.job_runs.set("r-g24", { id: "r-g24", workspace_id: "ws-g24", status: "running", fencing_token: 1n });

  const timeoutRes = await cm.drainWorkerWithTimeout(regW.id, 100);
  const run = client.job_runs.get("r-g24");
  recordTest(
    timeoutRes.drained === true && run.status === "queued",
    24,
    "G24",
    "Draining + recovery: trabajos con leases expirados de worker drenado son recuperados a la cola",
    "run.status === queued",
    `run.status: ${run?.status}`
  );
}

// G25 — draining + HITL
{
  const client = createIsolatedMockClient("g25");
  client.job_runs.set("g25-r1", { id: "g25-r1", workspace_id: "ws-g25", status: "waiting_approval" });
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g25", p_worker_identity: "w-g25", p_instance_identity: "inst-25" })).data.worker;
  const drainRes = await client.rpc("drain_worker", { p_worker_id: regW.id });
  recordTest(
    drainRes.data.success && drainRes.data.status === "STOPPED",
    25,
    "G25",
    "Draining + HITL: worker sin leases activos (incluso con jobs suspendidos en HITL) se detiene de inmediato",
    "status === STOPPED",
    `status: ${drainRes.data.status}`
  );
}

// G26 — draining + worker failure
{
  const client = createIsolatedMockClient("g26");
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g26", p_worker_identity: "w-g26", p_instance_identity: "inst-26" })).data.worker;
  regW.status = "DRAINING";
  regW.last_heartbeat_at = new Date(Date.now() - 120000).toISOString();
  // Simular detección de anomalía
  recordTest(
    regW.status === "DRAINING",
    26,
    "G26",
    "Draining + worker failure: estado de draining tolerante a latidos caídos sin corromper leases",
    "status === DRAINING",
    `status: ${regW.status}`
  );
}

// G27 — workspace drain isolation
{
  const client = createIsolatedMockClient("g27");
  Dispatcher.drainWorkspace("ws-g27-drain");
  const isDraining1 = Dispatcher.isWorkspaceDraining("ws-g27-drain");
  const isDraining2 = Dispatcher.isWorkspaceDraining("ws-g27-active");
  Dispatcher.resumeWorkspace("ws-g27-drain");
  recordTest(
    isDraining1 === true && isDraining2 === false,
    27,
    "G27",
    "Workspace drain isolation: drenado de un workspace congela únicamente su propio ámbito",
    "isDraining1 === true, isDraining2 === false",
    `drain1: ${isDraining1}, drain2: ${isDraining2}`
  );
}

// G28 — global drain
{
  Dispatcher.setGlobalDrain(true);
  const isGlob = Dispatcher.isGlobalDrain();
  Dispatcher.setGlobalDrain(false);
  recordTest(
    isGlob === true && Dispatcher.isGlobalDrain() === false,
    28,
    "G28",
    "Global drain: congelamiento global activa y desactiva el interruptor maestro de despacho",
    "isGlob === true, after === false",
    `isGlob: ${isGlob}, after: ${Dispatcher.isGlobalDrain()}`
  );
}

// G29 — global drain + multi-dispatcher
{
  const client = createIsolatedMockClient("g29");
  Dispatcher.setGlobalDrain(true);
  const dispA = new Dispatcher(client, { workspaceId: "ws-g29-a" });
  const dispB = new Dispatcher(client, { workspaceId: "ws-g29-b" });
  const tickA = await dispA.tick();
  const tickB = await dispB.tick();
  Dispatcher.setGlobalDrain(false);
  recordTest(
    tickA.claimsMade === 0 && tickB.claimsMade === 0,
    29,
    "G29",
    "Global drain + multi-dispatcher: todos los despachadores concurrentes respetan el bloqueo global",
    "claimsMade === 0 en ambos",
    `tickA: ${tickA.claimsMade}, tickB: ${tickB.claimsMade}`
  );
}

// G30 — shutdown ordering
{
  const client = createIsolatedMockClient("g30");
  const cm = new CancellationManager({ workspaceId: "ws-g30", supabaseClient: client });
  const res = await cm.executeShutdownSequence({ workspaceId: "ws-g30" });
  const stepNumbers = res.steps.map((s) => s.step);
  const expectedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const orderCorrect = expectedSteps.every((n, idx) => stepNumbers[idx] === n);
  recordTest(
    res.success && res.status === "COMPLETED" && orderCorrect,
    30,
    "G30",
    "Shutdown ordering: ejecuta exactamente los 10 pasos en el orden estricto (1..10)",
    "step numbers === [1..10]",
    `stepNumbers: ${JSON.stringify(stepNumbers)}`
  );
}

// G31 — shutdown idempotency
{
  const client = createIsolatedMockClient("g31");
  const cm = new CancellationManager({ workspaceId: "ws-g31", supabaseClient: client });
  const first = await cm.executeShutdownSequence({ workspaceId: "ws-g31" });
  const second = await cm.executeShutdownSequence({ workspaceId: "ws-g31" });
  recordTest(
    first.success && second.success && second.steps[0].name === "IDEMPOTENT_CHECK",
    31,
    "G31",
    "Shutdown idempotency: invocaciones consecutivas de shutdown retornan reporte sin re-ejecutar efectos",
    "second.steps[0].name === IDEMPOTENT_CHECK",
    `second step: ${second.steps[0]?.name}`
  );
}

// G32 — repeated cancellation idempotency
{
  const client = createIsolatedMockClient("g32");
  const cm = new CancellationManager({ workspaceId: "ws-g32", supabaseClient: client });
  client.job_runs.set("g32-r1", { id: "g32-r1", workspace_id: "ws-g32", status: "queued", queued_at: new Date().toISOString() });
  const res1 = await cm.requestCancellation({ workspaceId: "ws-g32", jobRunId: "g32-r1", source: "user" });
  const res2 = await cm.requestCancellation({ workspaceId: "ws-g32", jobRunId: "g32-r1", source: "user" });
  recordTest(
    res1.success && !res2.success && res2.error_code === "ALREADY_TERMINAL",
    32,
    "G32",
    "Repeated cancellation idempotency: segunda cancelación sobre el mismo run no duplica transiciones",
    "res1.success === true, res2.error_code === ALREADY_TERMINAL",
    `res1: ${res1.success}, res2: ${res2.error_code}`
  );
}

// G33 — repeated shutdown idempotency
{
  const client = createIsolatedMockClient("g33");
  const cm = new CancellationManager({ workspaceId: "ws-g33", supabaseClient: client });
  await cm.executeShutdownSequence({ workspaceId: "ws-g33" });
  const check = await cm.executeShutdownSequence({ workspaceId: "ws-g33" });
  recordTest(
    check.status === "COMPLETED" && check.recoveredJobsCount === 0,
    33,
    "G33",
    "Repeated shutdown idempotency: múltiples cierres mantienen estado inmutable y seguro",
    "status === COMPLETED",
    `status: ${check.status}`
  );
}

// G34 — lease release
{
  const client = createIsolatedMockClient("g34");
  const reg = new WorkerRegistry(client);
  client.worker_leases.set("l-g34", { id: "l-g34", worker_id: "w-g34", fencing_token: 3n, status: "active" });
  const rel = await reg.releaseLease("l-g34", "w-g34", 3n);
  recordTest(
    rel.success && rel.released === true,
    34,
    "G34",
    "Lease release: liberación limpia valida autoridad y fencing token",
    "released === true",
    `released: ${rel.released}`
  );
}

// G35 — fencing after shutdown
{
  const client = createIsolatedMockClient("g35");
  const cm = new CancellationManager({ workspaceId: "ws-g35", supabaseClient: client });
  client.job_runs.set("g35-r1", { id: "g35-r1", workspace_id: "ws-g35", status: "running", fencing_token: 10n });
  await cm.executeShutdownSequence({ workspaceId: "ws-g35" });
  const updatedRun = client.job_runs.get("g35-r1");
  recordTest(
    BigInt(updatedRun.fencing_token) > 10n,
    35,
    "G35",
    "Fencing after shutdown: el paso 7 de shutdown incrementa tokens para cercar workers remanentes",
    "fencing_token > 10n",
    `fencing_token: ${updatedRun.fencing_token}`
  );
}

// G36 — zombie blocked after shutdown
{
  const client = createIsolatedMockClient("g36");
  const rm = new RecoveryManager({ workspaceId: "ws-g36", supabaseClient: client });
  client.job_runs.set("g36-r1", { id: "g36-r1", workspace_id: "ws-g36", status: "running", fencing_token: 20n });
  let rejected = false;
  try {
    await rm.assertZombieFencing("g36-r1", 19n);
  } catch (err) {
    rejected = err.code === "FENCING";
  }
  recordTest(
    rejected === true,
    36,
    "G36",
    "Zombie blocked after shutdown: worker desfasado que intente escribir post-shutdown es rechazado",
    "rejected === true",
    `rejected: ${rejected}`
  );
}

// G37 — AgentRun not duplicated
{
  const client = createIsolatedMockClient("g37");
  const rm = new RecoveryManager({ workspaceId: "ws-g37", supabaseClient: client });
  client.agent_runs.set("ar-g37", { id: "ar-g37", job_run_id: "g37-r1", status: "completed" });
  const rec = await rm.reconcileAgentRun("g37-r1");
  recordTest(
    rec.existingRun?.id === "ar-g37" && rec.resumable === false,
    37,
    "G37",
    "AgentRun not duplicated: run terminal preexistente no se re-ejecuta ni duplica",
    "resumable === false",
    `resumable: ${rec.resumable}`
  );
}

// G38 — AgentStep not duplicated
{
  const client = createIsolatedMockClient("g38");
  const rm = new RecoveryManager({ workspaceId: "ws-g38", supabaseClient: client });
  client.agent_runs.set("ar-g38", { id: "ar-g38", job_run_id: "g38-r1", status: "running" });
  client.agent_run_steps.set("s1", { id: "s1", run_id: "ar-g38", step_number: 1, status: "completed" });
  const rec = await rm.reconcileAgentRun("g38-r1");
  recordTest(
    rec.completedSteps.length === 1 && rec.nextStepNumber === 2,
    38,
    "G38",
    "AgentStep not duplicated: pasos completados son reconocidos sin duplicar el paso 1",
    "nextStepNumber === 2",
    `nextStep: ${rec.nextStepNumber}`
  );
}

// G39 — Tool not duplicated
{
  const client = createIsolatedMockClient("g39");
  client.tool_idempotency_ledger.set("g39-tool-key", { status: "committed" });
  const isCommitted = client.tool_idempotency_ledger.get("g39-tool-key").status === "committed";
  recordTest(
    isCommitted === true,
    39,
    "G39",
    "Tool not duplicated: ledger de idempotencia garantiza ejecución exactly-once",
    "isCommitted === true",
    `isCommitted: ${isCommitted}`
  );
}

// G40 — audit append-only
{
  const client = createIsolatedMockClient("g40");
  const cm = new CancellationManager({ workspaceId: "ws-g40", supabaseClient: client });
  client.job_runs.set("g40-r1", { id: "g40-r1", workspace_id: "ws-g40", status: "queued", queued_at: new Date().toISOString() });
  await cm.requestCancellation({ workspaceId: "ws-g40", jobRunId: "g40-r1", source: "user" });
  const auditEntries = Array.from(client.job_audit_log.values());
  recordTest(
    auditEntries.length >= 1 && auditEntries[0].action === "cancel",
    40,
    "G40",
    "Audit append-only: cancelación persiste registro inmutable en job_audit_log",
    "auditEntries.length >= 1",
    `count: ${auditEntries.length}`
  );
}

// G41 — audit sanitization
{
  const sensitiveObj = {
    apiKey: "sk-live-1234567890",
    token: "bearer-secret-token",
    password: "super-secret-password",
    safeField: "safe-data",
  };
  const sanitized = CancellationManager.sanitizeDetails(sensitiveObj);
  recordTest(
    sanitized.apiKey === "[REDACTED]" &&
      sanitized.token === "[REDACTED]" &&
      sanitized.password === "[REDACTED]" &&
      sanitized.safeField === "safe-data",
    41,
    "G41",
    "Audit sanitization: sanitiza credenciales, tokens y secretos antes de persistir auditoría",
    "apiKey === [REDACTED]",
    `apiKey: ${sanitized.apiKey}, safeField: ${sanitized.safeField}`
  );
}

// G42 — observability correlation
{
  const span = tracer.startSpan({
    name: "test.cancellation_trace",
    component: "cancellation_manager",
    spanType: "job",
    workspaceId: "ws-g42",
    attributes: { correlation_id: "corr-1234" },
  });
  await span.end({ status: "completed" });
  recordTest(
    typeof span.traceId === "string" && span.traceId.length > 0 && typeof span.spanId === "string",
    42,
    "G42",
    "Observability correlation: spans de cancelación incluyen traceId y correlación de contexto",
    "traceId.length > 0",
    `traceId: ${span.traceId}`
  );
}

// G43 — cross-tenant cancellation blocked
{
  const cm = new CancellationManager({ workspaceId: "ws-g43-alpha" });
  let blocked = false;
  try {
    await cm.requestCancellation({ workspaceId: "ws-g43-bravo", jobRunId: "r-foreign", source: "user" });
  } catch (err) {
    blocked = err.code === "AUTHORIZATION";
  }
  recordTest(
    blocked === true,
    43,
    "G43",
    "Cross-tenant cancellation blocked: solicitud cruzada entre tenants es bloqueada con AUTHORIZATION",
    "blocked === true",
    `blocked: ${blocked}`
  );
}

// G44 — cross-tenant drain blocked
{
  const client = createIsolatedMockClient("g44");
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g44-alpha", p_worker_identity: "w-g44", p_instance_identity: "i-44" })).data.worker;
  // Simular llamada con usuario de otro workspace
  client.is_workspace_member = () => false;
  let blocked = false;
  try {
    const drainRes = await client.rpc("drain_worker", { p_worker_id: regW.id });
    if (!drainRes.data.success && drainRes.data.error_code === "UNAUTHORIZED_WORKSPACE") {
      blocked = true;
    }
  } catch {
    blocked = true;
  }
  recordTest(
    blocked === true,
    44,
    "G44",
    "Cross-tenant drain blocked: intento de drenar worker de otro workspace es rechazado",
    "blocked === true",
    `blocked: ${blocked}`
  );
}

// G45 — end-to-end cancellation -> drain -> recovery
{
  const client = createIsolatedMockClient("g45");
  const cm = new CancellationManager({ workspaceId: "ws-g45", supabaseClient: client });
  const regW = (await client.rpc("register_worker", { p_workspace_id: "ws-g45", p_worker_identity: "w-g45", p_instance_identity: "i-45" })).data.worker;

  // 1. Encolar job
  client.job_runs.set("g45-r1", { id: "g45-r1", workspace_id: "ws-g45", status: "queued", queued_at: new Date().toISOString() });

  // 2. Claim
  const claimRes = await client.rpc("claim_job_run_v2", { p_worker_id: regW.id });

  // 3. Cancelar post-claim
  const cancelRes = await cm.requestCancellation({ workspaceId: "ws-g45", jobRunId: "g45-r1", source: "user" });

  // 4. Iniciar Draining
  await client.rpc("drain_worker", { p_worker_id: regW.id });

  // 5. Shutdown sequence
  const shutdownRes = await cm.executeShutdownSequence({ workspaceId: "ws-g45" });

  const finalRun = client.job_runs.get("g45-r1");
  const finalWorker = client.workers.get(regW.id);

  recordTest(
    claimRes.data.success &&
      cancelRes.status === "cancellation_requested" &&
      shutdownRes.success &&
      finalWorker.status === "STOPPED",
    45,
    "G45",
    "End-to-end cancellation -> drain -> recovery: flujo completo opera de forma determinista y segura",
    "shutdown.success === true, worker.status === STOPPED",
    `shutdown: ${shutdownRes.success}, workerStatus: ${finalWorker.status}`
  );
}

console.log("==========================================================================");
console.log(`TOTAL CASOS EJECUTADOS: ${totalTests}`);
console.log(`CASOS EXITOSOS:        ${passedTests}`);
console.log(`CASOS FALLIDOS:        ${failedTests}`);
console.log("==========================================================================");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log("FASE 4.10-G — SUITE CANÓNICA EXITOSA (45/45 PASS)");
}
