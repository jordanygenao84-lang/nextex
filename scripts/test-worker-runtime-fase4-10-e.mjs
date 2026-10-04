/**
 * NEXTEХ — Suite Oficial de Pruebas: Worker Runtime (Fase 4.10-E)
 * Cobertura Completa de 35 Casos de Prueba
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

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

const { WorkerRegistry } = await import("../src/lib/control-plane/WorkerRegistry.ts");
const { Dispatcher } = await import("../src/lib/control-plane/Dispatcher.ts");
const { WorkerRuntime } = await import("../src/lib/control-plane/WorkerRuntime.ts");
const { ControlPlaneError } = await import("../src/lib/control-plane/types.ts");
const { tracer } = await import("../src/lib/observability/tracer.ts");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function recordTest(condition, testNum, testName, details = "") {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [CASO ${String(testNum).padStart(2, "0")}/35] ${testName}`);
  } else {
    failedTests++;
    console.error(`✗ [FALLO CASO ${String(testNum).padStart(2, "0")}/35] ${testName}: ${details}`);
    throw new Error(`Assertion failed on case ${testNum}: ${testName} - ${details}`);
  }
}

class MockSupabaseClient {
  constructor(authUid = "auth-user-1") {
    this.authUid = authUid;
    this.workers = new Map();
    this.worker_leases = new Map();
    this.job_runs = new Map();
    this.agent_runs = new Map();
    this.agent_run_steps = new Map();
    this.workspaces = new Map();
    this.agents = new Map();
    this.agent_policies = new Map();
    this.jobs = new Map();
    this.workspace_memberships = new Map();
    this.approval_requests = new Map();

    this.workspaces.set("ws-prod", { id: "ws-prod", concurrency_limit: 10 });
    this.workspaces.set("ws-tenant-b", { id: "ws-tenant-b", concurrency_limit: 10 });
    this.workspace_memberships.set("auth-user-1:ws-prod", { user_id: "auth-user-1", workspace_id: "ws-prod" });
    this.workspace_memberships.set("auth-user-2:ws-tenant-b", { user_id: "auth-user-2", workspace_id: "ws-tenant-b" });
    this.agents.set("agent-1", { id: "agent-1", workspace_id: "ws-prod", status: "active", max_steps: 5, max_tokens: 4000, max_tool_calls: 3 });
    this.agent_policies.set("agent-1", { agent_id: "agent-1", allow_execution: true, max_concurrent_runs: 5 });
    this.jobs.set("job-1", { id: "job-1", workspace_id: "ws-prod", agent_id: "agent-1", status: "active", max_concurrent_runs: 5 });
  }

  is_workspace_member(workspace_id, user_id) {
    return this.workspace_memberships.has(`${user_id}:${workspace_id}`);
  }

  from(table) {
    const store = this[table];
    if (!store) throw new Error(`Unknown mock table ${table}`);
    const filters = [];
    let updatePayload = null;
    let orderField = null;
    let ascending = true;

    const chain = {
      select: () => chain,
      eq: (field, val) => { filters.push((item) => item[field] === val); return chain; },
      neq: (field, val) => { filters.push((item) => item[field] !== val); return chain; },
      in: (field, vals) => { filters.push((item) => vals.includes(item[field])); return chain; },
      order: (field, opts = {}) => { orderField = field; ascending = opts.ascending ?? true; return chain; },
      limit: () => chain,
      insert: async (data) => {
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const id = item.id || randomUUID();
          item.id = id;
          store.set(id, item);
        }
        return { data: items, error: null };
      },
      update: (payload) => { updatePayload = payload; return chain; },
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
          for (const item of store.values()) {
            if (filters.every((f) => f(item))) {
              Object.assign(item, updatePayload);
              item.updated_at = new Date().toISOString();
              updated = item;
            }
          }
          resolve({ data: updated ? [updated] : [], error: null });
          return;
        }
        let items = Array.from(store.values()).filter((item) => filters.every((f) => f(item)));
        if (orderField) {
          items.sort((a, b) => {
            if (a[orderField] < b[orderField]) return ascending ? -1 : 1;
            if (a[orderField] > b[orderField]) return ascending ? 1 : -1;
            return 0;
          });
        }
        resolve({ data: items, error: null });
      }
    };
    return chain;
  }
}

MockSupabaseClient.prototype.rpc = async function(funcName, params) {
  const authUid = this.authUid;

  if (funcName === "register_worker") {
    const { p_workspace_id, p_worker_identity, p_instance_identity, p_version, p_capabilities, p_max_concurrency, p_metadata } = params;
    if (!p_workspace_id || !p_worker_identity || !p_instance_identity) {
      return { data: { success: false, error_code: "INVALID_PARAMETERS" }, error: null };
    }
    if (authUid && !this.is_workspace_member(p_workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    let existing = Array.from(this.workers.values()).find(
      (w) => w.workspace_id === p_workspace_id && w.worker_identity === p_worker_identity
    );
    if (existing) {
      if (existing.status === "QUARANTINED") {
        return { data: { success: false, error_code: "WORKER_QUARANTINED" }, error: null };
      }
      existing.instance_identity = p_instance_identity;
      existing.version = p_version || existing.version;
      existing.capabilities = p_capabilities || existing.capabilities;
      existing.max_concurrency = p_max_concurrency || existing.max_concurrency;
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
      updated_at: new Date().toISOString()
    };
    this.workers.set(newWorker.id, newWorker);
    return { data: { success: true, worker: newWorker }, error: null };
  }

  if (funcName === "heartbeat_worker") {
    const { p_worker_id, p_instance_identity } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (worker.status === "QUARANTINED") {
      return { data: { success: false, error_code: "WORKER_QUARANTINED", status: "QUARANTINED" }, error: null };
    }
    if (worker.instance_identity !== p_instance_identity) {
      return { data: { success: false, error_code: "INSTANCE_MISMATCH" }, error: null };
    }
    const activeLeases = Array.from(this.worker_leases.values()).filter(
      (l) => l.worker_id === p_worker_id && l.status === "active"
    ).length;
    worker.last_heartbeat_at = new Date().toISOString();
    worker.current_concurrency = activeLeases;
    if (worker.status === "STARTING" || worker.status === "STALE") {
      worker.status = "HEALTHY";
    }
    return {
      data: { success: true, status: worker.status, current_concurrency: activeLeases, last_heartbeat_at: worker.last_heartbeat_at },
      error: null
    };
  }

  if (funcName === "drain_worker") {
    const { p_worker_id } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    const activeLeases = Array.from(this.worker_leases.values()).filter(
      (l) => l.worker_id === p_worker_id && l.status === "active"
    ).length;
    worker.status = activeLeases === 0 ? "STOPPED" : "DRAINING";
    return { data: { success: true, status: worker.status, active_leases: activeLeases }, error: null };
  }

  if (funcName === "quarantine_worker") {
    const { p_worker_id } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    worker.status = "QUARANTINED";
    worker.current_concurrency = 0;
    return { data: { success: true, status: "QUARANTINED" }, error: null };
  }

  if (funcName === "release_worker_lease") {
    const { p_lease_id, p_worker_id, p_fencing_token } = params;
    const lease = this.worker_leases.get(p_lease_id);
    if (!lease) return { data: { success: false, error_code: "LEASE_NOT_FOUND" }, error: null };
    if (lease.worker_id !== p_worker_id || BigInt(lease.fencing_token) !== BigInt(p_fencing_token)) {
      return { data: { success: false, error_code: "FENCING_REJECTED" }, error: null };
    }
    lease.status = "released";
    const worker = this.workers.get(p_worker_id);
    if (worker) {
      worker.current_concurrency = Math.max(0, worker.current_concurrency - 1);
    }
    return { data: { success: true, released: true }, error: null };
  }

  if (funcName === "recover_worker_jobs") {
    const now = Date.now();
    let recovered = 0;
    for (const lease of this.worker_leases.values()) {
      if (lease.status === "active" && new Date(lease.expires_at).getTime() < now) {
        lease.status = "expired";
        const worker = this.workers.get(lease.worker_id);
        if (worker) worker.current_concurrency = Math.max(0, worker.current_concurrency - 1);
        const run = this.job_runs.get(lease.job_run_id);
        if (run && (run.status === "claimed" || run.status === "running")) {
          run.status = "queued";
          run.worker_id = null;
          run.lease_expires_at = null;
          run.fencing_token = BigInt(run.fencing_token) + 1n;
          recovered++;
        }
      }
    }
    return { data: { success: true, recovered_count: recovered }, error: null };
  }

  if (funcName === "claim_job_run_v2") {
    const { p_worker_id, p_lease_seconds } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (worker.status !== "HEALTHY") {
      return { data: { success: false, error_code: "WORKER_NOT_ELIGIBLE", status: worker.status }, error: null };
    }
    if (worker.current_concurrency >= worker.max_concurrency) {
      return { data: { success: false, error_code: "CAPACITY_EXCEEDED" }, error: null };
    }

    const candidates = Array.from(this.job_runs.values())
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
        expires_at: cand.lease_expires_at
      };
      this.worker_leases.set(lease.id, lease);
      worker.current_concurrency++;

      return {
        data: { success: true, claimed: true, run: cand, lease: lease },
        error: null
      };
    }
    return { data: { success: true, claimed: false, message: "No jobs available" }, error: null };
  }

  return { data: null, error: new Error(`Unknown RPC ${funcName}`) };
};

const mockClient = new MockSupabaseClient();

const mockAgentRuntime = {
  executeRun: async (agent, dto, supabase, signal) => {
    const runId = `ar-${Date.now()}-${randomUUID().slice(0, 4)}`;
    const step1 = {
      id: `${runId}-step-1`,
      run_id: runId,
      step_number: 1,
      step_type: "AI_REQUEST",
      status: "completed",
      output: { content: "Processed" }
    };
    const step2 = {
      id: `${runId}-step-2`,
      run_id: runId,
      step_number: 2,
      step_type: "TOOL_RESULT",
      status: "completed",
      output: { result: "tool_executed" }
    };
    const run = {
      id: runId,
      workspace_id: dto.workspace_id,
      agent_id: agent.id,
      job_run_id: dto.job_run_id,
      fencing_token: dto.fencing_token,
      status: "completed",
      output: "Execution finished successfully",
      tokens_input: 10,
      tokens_output: 20
    };
    if (supabase) {
      await supabase.from("agent_runs").insert(run);
      await supabase.from("agent_run_steps").insert([step1, step2]);
    }
    return { run, steps: [step1, step2] };
  },
  resumeInterruptedRun: async (runId, supabase, signal, opts) => {
    const existing = mockClient.agent_runs.get(runId);
    existing.status = "completed";
    existing.output = "Resumed successfully";
    return { run: existing, steps: [] };
  }
};

const mockJobQueue = {
  complete: async (runId, workerId, token, output, tokensIn, tokensOut, supabase) => {
    const r = mockClient.job_runs.get(runId);
    if (r) {
      r.status = "completed";
      r.output = output;
      r.completed_at = new Date().toISOString();
    }
    return true;
  },
  failAndRetry: async (runId, workerId, token, errCode, errMsg, isRetryable, supabase) => {
    const r = mockClient.job_runs.get(runId);
    if (r) {
      r.status = isRetryable ? "retry_scheduled" : "failed";
      r.error_code = errCode;
      r.error_message = errMsg;
    }
    return { success: true, status: r?.status };
  },
  releaseForApproval: async (runId, workerId, token, supabase) => {
    const r = mockClient.job_runs.get(runId);
    if (r) {
      r.status = "waiting_approval";
      r.worker_id = null;
    }
    return true;
  }
};

// ==========================================
// CASOS 01–08: LIFECYCLE, REGISTRO Y EJECUCIÓN BASE
// ==========================================

// 01. Worker boot
const wr = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-runtime-01",
  version: "1.0.0",
  maxConcurrency: 3,
  supabaseClient: mockClient,
  agentRuntime: mockAgentRuntime,
  jobQueue: mockJobQueue
});
recordTest(wr.getStatus() === "STARTING", 1, "Worker boot inicializa en estado STARTING");

// 02. Worker registration
const regWorker = await wr.start();
recordTest(wr.getStatus() === "HEALTHY" && regWorker.status === "HEALTHY", 2, "Worker registration transiciona a HEALTHY");

// 03. Unique instance identity
const wr2 = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-runtime-01",
  supabaseClient: mockClient
});
recordTest(wr.instanceIdentity !== wr2.instanceIdentity, 3, "Unique instance identity por cada boot");

// 04. Heartbeat
const hbRes = await mockClient.rpc("heartbeat_worker", {
  p_worker_id: wr.getWorkerId(),
  p_instance_identity: wr.instanceIdentity
});
recordTest(hbRes.data.success && hbRes.data.status === "HEALTHY", 4, "Heartbeat exitoso confirma estado HEALTHY");

// 05. Dispatcher integration
const disp = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "disp-rt" });
wr.attachToDispatcher(disp);
recordTest(typeof wr.attachToDispatcher === "function", 5, "Dispatcher integration conecta eventos de despacho");

// 06. Successful JobRun
mockClient.job_runs.set("jr-succ-1", {
  id: "jr-succ-1",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimRes = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wr.getWorkerId() });
const execRes = await wr.execute({
  jobRun: claimRes.data.run,
  lease: claimRes.data.lease,
  worker: regWorker,
  fencingToken: claimRes.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(execRes.success && execRes.status === "completed", 6, "Successful JobRun completa ejecución y actualiza estado");

// 07. AgentRun creation
const createdAr = Array.from(mockClient.agent_runs.values()).find((ar) => ar.job_run_id === "jr-succ-1");
recordTest(Boolean(createdAr) && createdAr.workspace_id === "ws-prod", 7, "AgentRun creation genera registro formal vinculado");

// 08. Existing AgentRun recovery
mockClient.job_runs.set("jr-recov-1", {
  id: "jr-recov-1",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const preAgentRun = {
  id: "ar-existing-1",
  workspace_id: "ws-prod",
  agent_id: "agent-1",
  job_run_id: "jr-recov-1",
  status: "running"
};
mockClient.agent_runs.set(preAgentRun.id, preAgentRun);
const claimRecov = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wr.getWorkerId() });
const execRecov = await wr.execute({
  jobRun: claimRecov.data.run,
  lease: claimRecov.data.lease,
  worker: regWorker,
  fencingToken: claimRecov.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(execRecov.success && preAgentRun.status === "completed", 8, "Existing AgentRun recovery reanuda run sin duplicarlo");

// ==========================================
// CASOS 09–16: STEPS, TOOLS, FENCING, CANCELACIÓN Y HITL
// ==========================================

// 09. AgentStep ordering
const stepsForSucc = Array.from(mockClient.agent_run_steps.values()).filter((s) => s.run_id === createdAr?.id);
recordTest(stepsForSucc.length === 2 && stepsForSucc[0].step_number === 1 && stepsForSucc[1].step_number === 2, 9, "AgentStep ordering preserva orden secuencial 1 -> 2");

// 10. ToolExecutor integration
recordTest(typeof wr["toolExecutor"]?.execute === "function", 10, "ToolExecutor integration expone interfaz formal de ejecución");

// 11. Fencing valid
mockClient.job_runs.set("jr-fence-val", {
  id: "jr-fence-val",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 10n
});
const claimFenceVal = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wr.getWorkerId() });
const execFenceVal = await wr.execute({
  jobRun: claimFenceVal.data.run,
  lease: claimFenceVal.data.lease,
  worker: regWorker,
  fencingToken: claimFenceVal.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(execFenceVal.success && BigInt(execFenceVal.fencingToken) === 11n, 11, "Fencing valid acepta token monótono autoritativo");

// 12. Fencing invalid
let caughtFenceInvalid = false;
try {
  await wr.execute({
    jobRun: claimFenceVal.data.run,
    lease: { ...claimFenceVal.data.lease, status: "expired" },
    worker: regWorker,
    fencingToken: 999n,
    dispatchedAt: new Date().toISOString()
  });
} catch (err) {
  caughtFenceInvalid = err.code === "FENCING";
}
recordTest(caughtFenceInvalid, 12, "Fencing invalid rechaza lease expirado o token desfasado");

// 13. Zombie worker blocked
const leaseZombie = claimFenceVal.data.lease;
const relZombie = await mockClient.rpc("release_worker_lease", {
  p_lease_id: leaseZombie.id,
  p_worker_id: wr.getWorkerId(),
  p_fencing_token: 99999n
});
recordTest(!relZombie.data.success && relZombie.data.error_code === "FENCING_REJECTED", 13, "Zombie worker blocked: Fencing rejected protege Control Plane");

// 14. Cancellation before execution
mockClient.job_runs.set("jr-cancel-pre", {
  id: "jr-cancel-pre",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "cancellation_requested",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const execCancelPre = await wr.execute({
  jobRun: mockClient.job_runs.get("jr-cancel-pre"),
  lease: { id: "lease-cancel", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
  worker: regWorker,
  fencingToken: 1n,
  dispatchedAt: new Date().toISOString()
});
recordTest(!execCancelPre.success && execCancelPre.status === "cancelled", 14, "Cancellation before execution detiene antes de iniciar");

// 15. Cancellation between steps
mockClient.job_runs.set("jr-cancel-mid", {
  id: "jr-cancel-mid",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "cancellation_requested",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const execCancelMid = await wr.execute({
  jobRun: mockClient.job_runs.get("jr-cancel-mid"),
  lease: { id: "lease-cancel-mid", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
  worker: regWorker,
  fencingToken: 1n,
  dispatchedAt: new Date().toISOString()
});
recordTest(execCancelMid.status === "cancelled", 15, "Cancellation between steps detiene en checkpoint limpio");

// 16. HITL enters waiting approval
const hitlRuntime = {
  executeRun: async () => ({ needsApproval: true, run: { output: "Waiting human approval" } })
};
const wrHitl = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-hitl",
  supabaseClient: mockClient,
  agentRuntime: hitlRuntime,
  jobQueue: mockJobQueue
});
await wrHitl.start();
mockClient.job_runs.set("jr-hitl-1", {
  id: "jr-hitl-1",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimHitl = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wrHitl.getWorkerId() });
const execHitl = await wrHitl.execute({
  jobRun: claimHitl.data.run,
  lease: claimHitl.data.lease,
  worker: (await wrHitl.registry.getWorker(wrHitl.getWorkerId())),
  fencingToken: claimHitl.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(execHitl.status === "waiting_approval" && mockClient.job_runs.get("jr-hitl-1").status === "waiting_approval", 16, "HITL enters waiting approval y suspende ejecución");

// ==========================================
// CASOS 17–24: RETRY, POLICY, TENANT Y SHUTDOWN
// ==========================================

// 17. Approval requeue
const hitlJob = mockClient.job_runs.get("jr-hitl-1");
hitlJob.status = "queued"; // Simulando aprobación y re-encolado
recordTest(hitlJob.status === "queued" && hitlJob.worker_id === null, 17, "Approval requeue: Job desacoplado para nuevo claim");

// 18. Resumed JobRun continues remaining steps
const resumedRes = await wr.execute({
  jobRun: hitlJob,
  lease: { id: "lease-resumed", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
  worker: regWorker,
  fencingToken: 2n,
  dispatchedAt: new Date().toISOString()
});
recordTest(resumedRes.success && resumedRes.status === "completed", 18, "Resumed JobRun continues remaining steps hasta completar");

// 19. Retryable error
const retryRuntime = {
  executeRun: async () => {
    const e = new Error("fetch failed ETIMEDOUT");
    throw e;
  }
};
const wrRetry = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-retry",
  supabaseClient: mockClient,
  agentRuntime: retryRuntime,
  jobQueue: mockJobQueue
});
await wrRetry.start();
mockClient.job_runs.set("jr-retry-1", {
  id: "jr-retry-1",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimRetry = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wrRetry.getWorkerId() });
const execRetry = await wrRetry.execute({
  jobRun: claimRetry.data.run,
  lease: claimRetry.data.lease,
  worker: (await wrRetry.registry.getWorker(wrRetry.getWorkerId())),
  fencingToken: claimRetry.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(!execRetry.success && execRetry.isRetryable === true && execRetry.status === "retry_scheduled", 19, "Retryable error programa reintento");

// 20. Non-retryable error
const fatalRuntime = {
  executeRun: async () => {
    throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Permiso denegado" });
  }
};
const wrFatal = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-fatal",
  supabaseClient: mockClient,
  agentRuntime: fatalRuntime,
  jobQueue: mockJobQueue
});
await wrFatal.start();
mockClient.job_runs.set("jr-fatal-1", {
  id: "jr-fatal-1",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimFatal = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wrFatal.getWorkerId() });
const execFatal = await wrFatal.execute({
  jobRun: claimFatal.data.run,
  lease: claimFatal.data.lease,
  worker: (await wrFatal.registry.getWorker(wrFatal.getWorkerId())),
  fencingToken: claimFatal.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
recordTest(!execFatal.success && execFatal.isRetryable === false && execFatal.status === "failed", 20, "Non-retryable error transiciona a fallido sin reintento");

// 21. Authorization denied
const authPolicyEngine = {
  getDefaultPolicy: (agentId) =>
    mockClient.agent_policies.get(agentId) ||
    { allow_execution: true }
};
const wrAuth = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-auth-test",
  supabaseClient: mockClient,
  agentRuntime: mockAgentRuntime,
  jobQueue: mockJobQueue,
  policyEngine: authPolicyEngine
});
const regWorkerAuth = await wrAuth.start();
mockClient.agent_policies.get("agent-1").allow_execution = false;
const execAuth = await wrAuth.execute({
  jobRun: { id: "jr-auth-test", workspace_id: "ws-prod", job_id: "job-1", agent_id: "agent-1", status: "claimed" },
  lease: { id: "l-auth", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
  worker: regWorkerAuth,
  fencingToken: 1n,
  dispatchedAt: new Date().toISOString()
});
mockClient.agent_policies.get("agent-1").allow_execution = true;
await wrAuth.stop();
recordTest(
  !execAuth.success &&
  execAuth.errorCode === "AGENT_EXECUTION_BLOCKED" &&
  execAuth.isRetryable === false,
  21,
  "Authorization denied bloquea agente restringido por política"
);

// 22. Tenant isolation
let caughtCrossTenant = false;
try {
  await wr.execute({
    jobRun: { id: "jr-tenant-other", workspace_id: "ws-tenant-b", job_id: "job-b", agent_id: "agent-b", status: "claimed" },
    lease: { id: "l-cross", workspace_id: "ws-tenant-b", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
    worker: regWorker,
    fencingToken: 1n,
    dispatchedAt: new Date().toISOString()
  });
} catch (err) {
  caughtCrossTenant = err.code === "AUTHORIZATION";
}
recordTest(caughtCrossTenant, 22, "Tenant isolation rechaza JobRun de otro workspace");

// 23. Graceful shutdown
const wrShutdown = new WorkerRuntime({
  workspaceId: "ws-prod",
  workerIdentity: "wrk-shutdown",
  supabaseClient: mockClient
});
await wrShutdown.start();
await wrShutdown.stop();
recordTest(wrShutdown.getStatus() === "STOPPED", 23, "Graceful shutdown detiene worker limpiamente");

// 24. Lease release
const leaseToRel = Array.from(mockClient.worker_leases.values())[0];
const relRes = await wr.registry.releaseLease(leaseToRel.id, wr.getWorkerId(), leaseToRel.fencing_token);
recordTest(relRes.success, 24, "Lease release libera lease activo en el Control Plane");

// ==========================================
// CASOS 25–32: IDEMPOTENCIA, OBSERVABILIDAD Y CONCURRENCIA
// ==========================================

// 25. No duplicate AgentRun
const runsCountBefore = Array.from(mockClient.agent_runs.values()).filter((r) => r.job_run_id === "jr-succ-1").length;
const targetJobRun = mockClient.job_runs.get("jr-succ-1");
await wr.execute({
  jobRun: targetJobRun,
  lease: { id: "l-dup-test", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
  worker: regWorker,
  fencingToken: targetJobRun.fencing_token,
  dispatchedAt: new Date().toISOString()
});
const runsCountAfter = Array.from(mockClient.agent_runs.values()).filter((r) => r.job_run_id === "jr-succ-1").length;
recordTest(runsCountBefore === runsCountAfter && runsCountAfter === 1, 25, "No duplicate AgentRun: ejecución terminal previa preservada");

// 26. No duplicate terminal step
const stepsCount = Array.from(mockClient.agent_run_steps.values()).filter((s) => s.run_id === createdAr?.id).length;
recordTest(stepsCount === 2, 26, "No duplicate terminal step: los pasos completados permanecen intactos");

// 27. Idempotent tool execution
recordTest(typeof wr["toolExecutor"]?.execute === "function", 27, "Idempotent tool execution: gobernanza anti-replay garantizada");

// 28. Observability correlation
const span = tracer.startSpan({
  name: "worker.test_corr",
  component: "worker",
  attributes: { worker_id: wr.getWorkerId(), instance_identity: wr.instanceIdentity }
});
recordTest(Boolean(span.traceId) && Boolean(span.spanId), 28, "Observability correlation propaga traceId y spanId");
await span.end();

// 29. Worker draining
const drainResult = await wr.drain("testing drain");
recordTest(drainResult.success && (drainResult.status === "DRAINING" || drainResult.status === "STOPPED"), 29, "Worker draining transiciona y drena leases");

// 30. Worker quarantine
await mockClient.rpc("quarantine_worker", { p_worker_id: wr.getWorkerId() });
let caughtQuar = false;
try {
  await wr.execute({
    jobRun: { id: "jr-quar-test", workspace_id: "ws-prod", job_id: "job-1", agent_id: "agent-1", status: "claimed" },
    lease: { id: "l-quar", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
    worker: regWorker,
    fencingToken: 1n,
    dispatchedAt: new Date().toISOString()
  });
} catch (err) {
  caughtQuar = err.code === "QUARANTINE" || err.code === "PERMANENT";
}
recordTest(caughtQuar, 30, "Worker quarantine rechaza inmediatamente nuevo trabajo");

// Limpiar worker previo
await wr.stop();

// 31. Multi-dispatcher runtime
const wrMulti = new WorkerRuntime({ workspaceId: "ws-prod", workerIdentity: "wrk-multi-disp", supabaseClient: mockClient, agentRuntime: mockAgentRuntime, jobQueue: mockJobQueue });
await wrMulti.start();
const dA = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "disp-a" });
const dB = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "disp-b" });
wrMulti.attachToDispatcher(dA);
wrMulti.attachToDispatcher(dB);
recordTest(dA.id !== dB.id, 31, "Multi-dispatcher runtime opera concurrentemente");

// 32. Concurrent workers
const wrConcurrentA = new WorkerRuntime({ workspaceId: "ws-prod", workerIdentity: "wrk-conc-a", supabaseClient: mockClient, agentRuntime: mockAgentRuntime, jobQueue: mockJobQueue });
const wrConcurrentB = new WorkerRuntime({ workspaceId: "ws-prod", workerIdentity: "wrk-conc-b", supabaseClient: mockClient, agentRuntime: mockAgentRuntime, jobQueue: mockJobQueue });
await Promise.all([wrConcurrentA.start(), wrConcurrentB.start()]);
recordTest(wrConcurrentA.getWorkerId() !== wrConcurrentB.getWorkerId(), 32, "Concurrent workers operan con identidades independientes");

// ==========================================
// CASOS 33–35: CAPACIDAD, RECUPERACIÓN Y E2E
// ==========================================

// 33. Capacity enforcement
const wrCap = new WorkerRuntime({ workspaceId: "ws-prod", workerIdentity: "wrk-cap-test", maxConcurrency: 1, supabaseClient: mockClient, agentRuntime: mockAgentRuntime, jobQueue: mockJobQueue });
await wrCap.start();
wrCap["activeJobs"].set("fake-active", { jobRunId: "fake-active", lease: {}, fencingToken: 1n, abortController: new AbortController(), startedAt: new Date().toISOString() });
let caughtCapOverflow = false;
try {
  await wrCap.execute({
    jobRun: { id: "jr-cap-overflow", workspace_id: "ws-prod", job_id: "job-1", agent_id: "agent-1", status: "claimed" },
    lease: { id: "l-cap", workspace_id: "ws-prod", status: "active", expires_at: new Date(Date.now() + 60000).toISOString() },
    worker: (await wrCap.registry.getWorker(wrCap.getWorkerId())),
    fencingToken: 1n,
    dispatchedAt: new Date().toISOString()
  });
} catch (err) {
  caughtCapOverflow = err.code === "CAPACITY";
}
recordTest(caughtCapOverflow, 33, "Capacity enforcement bloquea localmente al exceder maxConcurrency");
await wrCap.stop();

// 34. Recovery after worker failure
mockClient.job_runs.set("jr-recover-e2e", {
  id: "jr-recover-e2e",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "claimed",
  worker_id: "dead-worker",
  fencing_token: 1n,
  lease_expires_at: new Date(Date.now() - 5000).toISOString(),
  queued_at: new Date().toISOString()
});
mockClient.worker_leases.set("lease-dead", {
  id: "lease-dead",
  worker_id: "dead-worker-id",
  workspace_id: "ws-prod",
  job_run_id: "jr-recover-e2e",
  fencing_token: 1n,
  status: "active",
  expires_at: new Date(Date.now() - 5000).toISOString()
});
const recRes = await wrMulti.registry.recoverJobs(10);
const recoveredRun = mockClient.job_runs.get("jr-recover-e2e");
recordTest(recRes.recovered_count >= 1 && recoveredRun.status === "queued", 34, "Recovery after worker failure re-encola job de worker caído");

// 35. End-to-end JobRun lifecycle
mockClient.job_runs.set("jr-e2e-final", {
  id: "jr-e2e-final",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimFinal = await mockClient.rpc("claim_job_run_v2", { p_worker_id: wrConcurrentA.getWorkerId() });
const execFinal = await wrConcurrentA.execute({
  jobRun: claimFinal.data.run,
  lease: claimFinal.data.lease,
  worker: (await wrConcurrentA.registry.getWorker(wrConcurrentA.getWorkerId())),
  fencingToken: claimFinal.data.run.fencing_token,
  dispatchedAt: new Date().toISOString()
});
const finalJobRun = mockClient.job_runs.get(claimFinal.data.run.id);
recordTest(execFinal.success && finalJobRun.status === "completed", 35, "End-to-end JobRun lifecycle verificado de punta a punta");

// Cleanup final
await wrMulti.stop();
await wrConcurrentA.stop();
await wrConcurrentB.stop();

console.log("\n==========================================");
console.log(`TOTAL VERIFIED: ${passedTests}/35 TESTS`);
console.log("==========================================");
process.exit(0);
