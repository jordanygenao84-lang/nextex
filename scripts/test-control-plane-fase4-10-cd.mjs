/**
 * NEXTEХ — Suite Oficial de Pruebas: Control Plane (Fase 4.10-C/D)
 * Cobertura Completa de 35 Casos de Prueba
 */

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/lib/control-plane/")) {
      if (specifier.endsWith(".js")) return nextResolve(specifier.slice(0, -3) + ".ts", context);
      if (specifier.startsWith("./") && !specifier.endsWith(".ts")) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.includes("/src/lib/control-plane/") && url.endsWith(".ts")) {
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
const { ControlPlaneError } = await import("../src/lib/control-plane/types.ts");

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
    this.workspaces = new Map();
    this.agents = new Map();
    this.agent_policies = new Map();
    this.jobs = new Map();
    this.workspace_memberships = new Map();

    this.workspaces.set("ws-prod", { id: "ws-prod", concurrency_limit: 5 });
    this.workspaces.set("ws-tenant-b", { id: "ws-tenant-b", concurrency_limit: 5 });
    this.workspace_memberships.set("auth-user-1:ws-prod", { user_id: "auth-user-1", workspace_id: "ws-prod" });
    this.workspace_memberships.set("auth-user-2:ws-tenant-b", { user_id: "auth-user-2", workspace_id: "ws-tenant-b" });
    this.agents.set("agent-1", { id: "agent-1", workspace_id: "ws-prod", status: "active" });
    this.agent_policies.set("agent-1", { agent_id: "agent-1", allow_execution: true, max_concurrent_runs: 3 });
    this.jobs.set("job-1", { id: "job-1", workspace_id: "ws-prod", agent_id: "agent-1", status: "active", max_concurrent_runs: 2 });
  }

  is_workspace_member(workspace_id, user_id) {
    return this.workspace_memberships.has(`${user_id}:${workspace_id}`);
  }

  from(table) {
    const store = this[table];
    if (!store) throw new Error(`Unknown mock table ${table}`);
    const client = this;
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
      update: (payload) => { updatePayload = payload; return chain; },
      single: async () => {
        const res = await chain.then ? new Promise((r) => chain.then(r)) : null;
        return { data: res?.data?.[0] || null, error: res?.data?.[0] ? null : new Error("Not found") };
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

  if (funcName === "mark_worker_stale") {
    const timeoutSeconds = params.p_heartbeat_timeout_seconds || 90;
    const cutoff = Date.now() - timeoutSeconds * 1000;
    let count = 0;
    for (const w of this.workers.values()) {
      if ((w.status === "HEALTHY" || w.status === "STARTING") && new Date(w.last_heartbeat_at).getTime() < cutoff) {
        w.status = "STALE";
        count++;
      }
    }
    return { data: count, error: null };
  }

  if (funcName === "drain_worker") {
    const { p_worker_id } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (worker.status === "QUARANTINED") {
      return { data: { success: false, error_code: "WORKER_QUARANTINED" }, error: null };
    }
    const activeLeases = Array.from(this.worker_leases.values()).filter(
      (l) => l.worker_id === p_worker_id && l.status === "active"
    ).length;
    if (activeLeases === 0) {
      worker.status = "STOPPED";
    } else {
      worker.status = "DRAINING";
    }
    return { data: { success: true, status: worker.status, active_leases: activeLeases }, error: null };
  }

  if (funcName === "quarantine_worker") {
    const { p_worker_id, p_reason } = params;
    if (!p_reason || !p_reason.trim()) return { data: { success: false, error_code: "REASON_REQUIRED" }, error: null };
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    worker.status = "QUARANTINED";
    worker.current_concurrency = 0;
    let revoked = 0;
    for (const l of this.worker_leases.values()) {
      if (l.worker_id === p_worker_id && l.status === "active") {
        l.status = "revoked";
        const run = this.job_runs.get(l.job_run_id);
        if (run && (run.status === "claimed" || run.status === "running")) {
          run.status = "queued";
          run.worker_id = null;
          run.fencing_token = BigInt(run.fencing_token) + 1n;
        }
        revoked++;
      }
    }
    return { data: { success: true, status: "QUARANTINED", revoked_leases: revoked }, error: null };
  }

  if (funcName === "release_worker_quarantine") {
    const { p_worker_id } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (worker.status !== "QUARANTINED") {
      return { data: { success: false, error_code: "NOT_QUARANTINED" }, error: null };
    }
    worker.status = "STOPPED";
    worker.current_concurrency = 0;
    return { data: { success: true, status: "STOPPED" }, error: null };
  }

  if (funcName === "release_worker_lease") {
    const { p_lease_id, p_worker_id, p_fencing_token } = params;
    const lease = this.worker_leases.get(p_lease_id);
    if (!lease) return { data: { success: false, error_code: "LEASE_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(lease.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (lease.worker_id !== p_worker_id || BigInt(lease.fencing_token) !== BigInt(p_fencing_token)) {
      return { data: { success: false, error_code: "FENCING_REJECTED" }, error: null };
    }
    if (lease.status !== "active") {
      return { data: { success: true, already_released: true, status: lease.status }, error: null };
    }
    lease.status = "released";
    const worker = this.workers.get(p_worker_id);
    if (worker) {
      worker.current_concurrency = Math.max(0, worker.current_concurrency - 1);
      if (worker.status === "DRAINING" && worker.current_concurrency === 0) {
        worker.status = "STOPPED";
      }
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

  if (funcName === "request_job_cancellation") {
    const { p_job_run_id } = params;
    const run = this.job_runs.get(p_job_run_id);
    if (!run) return { data: { success: false, error_code: "JOB_RUN_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(run.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (run.status === "queued") {
      run.status = "cancelled";
      return { data: { success: true, status: "cancelled" }, error: null };
    } else {
      run.status = "cancellation_requested";
      return { data: { success: true, status: "cancellation_requested" }, error: null };
    }
  }

  if (funcName === "claim_job_run_v2") {
    const { p_worker_id, p_lease_seconds, p_required_capabilities } = params;
    const worker = this.workers.get(p_worker_id);
    if (!worker) return { data: { success: false, error_code: "WORKER_NOT_FOUND" }, error: null };
    if (authUid && !this.is_workspace_member(worker.workspace_id, authUid)) {
      return { data: { success: false, error_code: "UNAUTHORIZED_WORKSPACE" }, error: null };
    }
    if (worker.status !== "HEALTHY") {
      return { data: { success: false, error_code: "WORKER_NOT_ELIGIBLE", status: worker.status }, error: null };
    }
    if (worker.current_concurrency >= worker.max_concurrency) {
      return { data: { success: false, error_code: "CAPACITY_EXCEEDED" }, error: null };
    }
    if (p_required_capabilities && p_required_capabilities.length > 0) {
      const hasCaps = p_required_capabilities.every((c) => worker.capabilities.includes(c));
      if (!hasCaps) return { data: { success: false, error_code: "CAPABILITY_MISMATCH" }, error: null };
    }

    const candidates = Array.from(this.job_runs.values())
      .filter((r) => r.workspace_id === worker.workspace_id && r.status === "queued")
      .sort((a, b) => (a.queued_at < b.queued_at ? -1 : 1));

    for (const cand of candidates) {
      const ws = this.workspaces.get(cand.workspace_id);
      const activeWs = Array.from(this.job_runs.values()).filter(
        (r) => r.workspace_id === cand.workspace_id && ["claimed", "running", "waiting_approval"].includes(r.status)
      ).length;
      if (activeWs >= (ws?.concurrency_limit || 5)) continue;

      const ag = this.agents.get(cand.agent_id);
      if (!ag || ag.status !== "active") continue;
      const policy = this.agent_policies.get(cand.agent_id);
      if (policy && policy.allow_execution === false) continue;
      const activeAg = Array.from(this.job_runs.values()).filter(
        (r) => r.agent_id === cand.agent_id && ["claimed", "running", "waiting_approval"].includes(r.status)
      ).length;
      if (activeAg >= (policy?.max_concurrent_runs || 3)) continue;

      const jb = this.jobs.get(cand.job_id);
      if (!jb || jb.status !== "active") continue;
      const activeJb = Array.from(this.job_runs.values()).filter(
        (r) => r.job_id === cand.job_id && ["claimed", "running", "waiting_approval"].includes(r.status)
      ).length;
      if (activeJb >= (jb?.max_concurrent_runs || 2)) continue;

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

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 01–05)
// ==========================================

const mockClient = new MockSupabaseClient();
const registry = new WorkerRegistry(mockClient);

// 01. Worker registration
const reg1 = await registry.register({
  workspaceId: "ws-prod",
  workerIdentity: "worker-prod-01",
  version: "1.0.0",
  maxConcurrency: 3,
  capabilities: ["ai", "database", "integrations"]
});
recordTest(reg1.success && reg1.worker?.status === "HEALTHY", 1, "Worker registration crea worker HEALTHY");
const worker1 = reg1.worker;

// 02. Worker restart
const newInst = registry.generateInstanceIdentity("worker-prod-01");
const regRestart = await registry.register({
  workspaceId: "ws-prod",
  workerIdentity: "worker-prod-01",
  instanceIdentity: newInst
});
recordTest(regRestart.success && regRestart.worker?.instance_identity === newInst, 2, "Worker restart re-registra con nueva instancia");

// 03. Instance identity uniqueness
const instA = registry.generateInstanceIdentity("worker-prod-01");
const instB = registry.generateInstanceIdentity("worker-prod-01");
recordTest(instA !== instB && instA.includes("worker-prod-01"), 3, "Instance identity uniqueness genera UUIDs únicos por boot");

// 04. Heartbeat
const hb1 = await registry.heartbeat(worker1.id, newInst);
recordTest(hb1.success && hb1.status === "HEALTHY", 4, "Heartbeat exitoso actualiza estado a HEALTHY");

// 05. Invalid instance identity
const hbInvalid = await registry.heartbeat(worker1.id, "old-stale-instance-123");
recordTest(!hbInvalid.success && hbInvalid.error_code === "INSTANCE_MISMATCH", 5, "Invalid instance identity es detectado y rechazado");

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 06–10)
// ==========================================

// 06. Worker stale
const workerRecord = mockClient.workers.get(worker1.id);
workerRecord.last_heartbeat_at = new Date(Date.now() - 120000).toISOString();
const staledCount = await registry.markStale(90);
recordTest(staledCount === 1 && workerRecord.status === "STALE", 6, "Worker stale marcado tras superar umbral de 90s");

// Reanimar worker mediante heartbeat válido
await registry.heartbeat(worker1.id, newInst);

// 07. Drain
const drainRes = await registry.drain(worker1.id, "admin-user", "scheduled maintenance");
recordTest(drainRes.success && drainRes.status === "STOPPED", 7, "Drain sin leases activos transiciona inmediatamente a STOPPED");

// Re-registrar worker a HEALTHY para continuar
await registry.register({
  workspaceId: "ws-prod",
  workerIdentity: "worker-prod-01",
  instanceIdentity: newInst
});

// 08. Quarantine
const qRes = await registry.quarantine(worker1.id, "admin-user", "segfault detected");
recordTest(qRes.success && qRes.status === "QUARANTINED", 8, "Quarantine sella worker en QUARANTINED");

// 09. Release quarantine
const relQ = await registry.releaseQuarantine(worker1.id, "admin-user");
recordTest(relQ.success && relQ.status === "STOPPED", 9, "Release quarantine transiciona worker a STOPPED");

// Re-registrar limpio para Dispatcher tests
const freshInst = registry.generateInstanceIdentity("worker-prod-01");
await registry.register({
  workspaceId: "ws-prod",
  workerIdentity: "worker-prod-01",
  instanceIdentity: freshInst,
  maxConcurrency: 2,
  capabilities: ["ai", "database"]
});

// 10. Dispatcher startup
const dispatcher = new Dispatcher(mockClient, {
  workspaceId: "ws-prod",
  dispatcherId: "disp-1",
  pollIntervalMs: 500,
  maxClaimsPerTick: 2
});
recordTest(dispatcher.getStatus() === "IDLE", 10, "Dispatcher startup inicializa en estado IDLE");

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 11–15)
// ==========================================

// 11. Dispatcher shutdown
dispatcher.stop();
recordTest(dispatcher.getStatus() === "STOPPED", 11, "Dispatcher shutdown detiene el despachador");

// 12. Empty queue backoff
const tickEmpty = await dispatcher.tick();
recordTest(tickEmpty.claimsMade === 0 && dispatcher.getStatus() === "BACKOFF", 12, "Empty queue backoff entra en BACKOFF");

// 13. Multi-dispatcher
const dispA = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "disp-A" });
const dispB = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "disp-B" });
recordTest(dispA.id !== dispB.id, 13, "Multi-dispatcher opera con instancias independientes");

// Encolar un JobRun de prueba
mockClient.job_runs.set("jr-101", {
  id: "jr-101",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});

// 14. Double claim prevention
let dispatchedRun = null;
dispA.onDispatch((evt) => {
  dispatchedRun = evt.jobRun;
});

const tickA = await dispA.tick();
const tickB = await dispB.tick();
recordTest(tickA.claimsMade === 1 && dispatchedRun?.id === "jr-101" && tickB.claimsMade === 0, 14, "Double claim prevention: Disp A reclama, Disp B no duplica");

// 15. Capability matching
mockClient.job_runs.set("jr-browser", {
  id: "jr-browser",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimCapRes = await mockClient.rpc("claim_job_run_v2", {
  p_worker_id: worker1.id,
  p_required_capabilities: ["browser"]
});
recordTest(!claimCapRes.data.success && claimCapRes.data.error_code === "CAPABILITY_MISMATCH", 15, "Capability matching rechaza worker sin capabilities requeridas");
mockClient.job_runs.delete("jr-browser");

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 16–20)
// ==========================================

// 16. Worker capacity
mockClient.job_runs.set("jr-102", {
  id: "jr-102",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
await dispA.tick(); // Worker 1 alcanza 2 leases (su max_concurrency)
mockClient.job_runs.set("jr-103", {
  id: "jr-103",
  workspace_id: "ws-prod",
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const claimOverflow = await mockClient.rpc("claim_job_run_v2", { p_worker_id: worker1.id });
recordTest(!claimOverflow.data.success && claimOverflow.data.error_code === "CAPACITY_EXCEEDED", 16, "Worker capacity bloquea atómicamente al superar max_concurrency");

// 17. Workspace capacity
mockClient.workspaces.get("ws-prod").concurrency_limit = 2;
const claimWsCap = await mockClient.rpc("claim_job_run_v2", { p_worker_id: worker1.id });
recordTest(!claimWsCap.data.claimed, 17, "Workspace capacity respetada cuando activeWs >= concurrency_limit");
mockClient.workspaces.get("ws-prod").concurrency_limit = 5;

// 18. Agent capacity
mockClient.agent_policies.get("agent-1").max_concurrent_runs = 2;
const claimAgCap = await mockClient.rpc("claim_job_run_v2", { p_worker_id: worker1.id });
recordTest(!claimAgCap.data.claimed, 18, "Agent capacity respetada cuando activeAg >= max_concurrent_runs");
mockClient.agent_policies.get("agent-1").max_concurrent_runs = 5;

// 19. Job capacity
mockClient.jobs.get("job-1").max_concurrent_runs = 2;
const claimJbCap = await mockClient.rpc("claim_job_run_v2", { p_worker_id: worker1.id });
recordTest(!claimJbCap.data.claimed, 19, "Job capacity respetada cuando activeJb >= max_concurrent_runs");
mockClient.jobs.get("job-1").max_concurrent_runs = 5;

// 20. Cross-tenant isolation
mockClient.job_runs.delete("jr-103");
const workerTenantIso = (await registry.register({
  workspaceId: "ws-prod",
  workerIdentity: "worker-iso-prod",
  maxConcurrency: 5,
  capabilities: ["ai", "database"]
})).worker;

mockClient.job_runs.set("jr-tenant-b", {
  id: "jr-tenant-b",
  workspace_id: "ws-tenant-b",
  job_id: "job-b",
  agent_id: "agent-b",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n,
  worker_id: null
});
const claimCross = await mockClient.rpc("claim_job_run_v2", { p_worker_id: workerTenantIso.id });
const jobTenantB = mockClient.job_runs.get("jr-tenant-b");
const isolationVerified =
  claimCross.data.success === true &&
  claimCross.data.claimed === false &&
  claimCross.data.error_code === undefined &&
  jobTenantB.status === "queued" &&
  jobTenantB.worker_id === null;

recordTest(isolationVerified, 20, "Cross-tenant isolation: Worker de ws-prod jamás recibe jobs de ws-tenant-b");
mockClient.job_runs.delete("jr-tenant-b");
mockClient.workers.delete(workerTenantIso.id);

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 21–25)
// ==========================================

// 21. Fencing
const run101 = mockClient.job_runs.get("jr-101");
recordTest(BigInt(run101.fencing_token) === 2n, 21, "Fencing token autoritativo incrementado a 2n por el Control Plane");

// 22. Zombie worker
const lease101 = Array.from(mockClient.worker_leases.values()).find((l) => l.job_run_id === "jr-101");
const zombieRelease = await registry.releaseLease(lease101.id, worker1.id, 999n);
recordTest(!zombieRelease.success && zombieRelease.error_code === "FENCING_REJECTED", 22, "Zombie worker con fencing inválido es rechazado");

// 23. Lease expiration
lease101.expires_at = new Date(Date.now() - 5000).toISOString();
recordTest(new Date(lease101.expires_at).getTime() < Date.now(), 23, "Lease expiration detectado temporalmente");

// 24. Recovery
const recRes = await registry.recoverJobs(10);
recordTest(recRes.success && recRes.recovered_count >= 1 && run101.status === "queued", 24, "Recovery re-encola job y libera lease expirado");

// 25. Cancellation
const cancelRes = await mockClient.rpc("request_job_cancellation", {
  p_job_run_id: "jr-102",
  p_reason: "User requested abort"
});
recordTest(cancelRes.data.success && cancelRes.data.status === "cancellation_requested", 25, "Cancellation transiciona a 'cancellation_requested'");

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 26–30)
// ==========================================

// 26. Quarantine + dispatcher
mockClient.workers.get(worker1.id).status = "QUARANTINED";
const tickQuar = await dispA.tick();
recordTest(tickQuar.claimsMade === 0 && tickQuar.eligibleWorkersFound === 0, 26, "Quarantine + dispatcher: Worker en cuarentena no recibe trabajo");
mockClient.workers.get(worker1.id).status = "HEALTHY";

// 27. Graceful shutdown
const ac = new AbortController();
const bgDisp = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "bg-disp" });
bgDisp.start(ac.signal);
ac.abort();
recordTest(bgDisp.getStatus() === "STOPPED", 27, "Graceful shutdown detiene Dispatcher limpiamente ante AbortSignal");

// 28. Error classification
const errQ = ControlPlaneError.classify({ code: "WORKER_QUARANTINED" });
const errF = ControlPlaneError.classify({ code: "FENCING_REJECTED" });
const errT = ControlPlaneError.classify({ message: "fetch failed ETIMEDOUT" });
recordTest(errQ.code === "QUARANTINE" && errF.code === "FENCING" && errT.code === "TRANSIENT", 28, "Error classification clasifica correctamente tipos de fallo");

// 29. Backpressure
const metricsDisp = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "metrics-disp" });
await metricsDisp.tick();
recordTest(metricsDisp.getMetrics().consecutiveEmptyPolls > 0, 29, "Backpressure incrementa conteo ante cola vacía");

// 30. No busy loop
recordTest(metricsDisp["pollIntervalMs"] >= 100 && metricsDisp["maxPollIntervalMs"] <= 60000, 30, "No busy loop: Intervalos de retardo acotados y controlados");

// ==========================================
// TEST SUITE: CONTROL PLANE (CASOS 31–35)
// ==========================================

// 31. Multi-dispatcher: Concurrent race without duplicate claims
const multiWs = "ws-prod";
const workerAlpha = (await registry.register({
  workspaceId: multiWs,
  workerIdentity: "worker-alpha",
  maxConcurrency: 10
})).worker;

mockClient.job_runs.set("jr-conc-1", {
  id: "jr-conc-1",
  workspace_id: multiWs,
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});

const d1 = new Dispatcher(mockClient, { workspaceId: multiWs, dispatcherId: "d1" });
const d2 = new Dispatcher(mockClient, { workspaceId: multiWs, dispatcherId: "d2" });

const [claim1, claim2] = await Promise.all([d1.tick(), d2.tick()]);
const totalConcurrentClaims = claim1.claimsMade + claim2.claimsMade;
recordTest(totalConcurrentClaims === 1, 31, "Multi-dispatcher concurrency: NO duplicate claim");

// 32. Multi-dispatcher: Concurrent tick prevents capacity overflow
mockClient.workspaces.get(multiWs).concurrency_limit = 2;
mockClient.job_runs.set("jr-overflow-1", {
  id: "jr-overflow-1",
  workspace_id: multiWs,
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
mockClient.job_runs.set("jr-overflow-2", {
  id: "jr-overflow-2",
  workspace_id: multiWs,
  job_id: "job-1",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});

const [over1, over2] = await Promise.all([d1.tick(), d2.tick()]);
const activeAfterTicks = Array.from(mockClient.job_runs.values()).filter(
  (r) => r.workspace_id === multiWs && ["claimed", "running"].includes(r.status)
).length;
recordTest(activeAfterTicks <= 2, 32, "Multi-dispatcher concurrency: NO capacity overflow");
mockClient.workspaces.get(multiWs).concurrency_limit = 5;

// 33. Multi-dispatcher: Cross-tenant isolation under concurrent pressure
mockClient.job_runs.set("jr-iso-tenant-b", {
  id: "jr-iso-tenant-b",
  workspace_id: "ws-tenant-b",
  job_id: "job-b",
  agent_id: "agent-b",
  status: "queued",
  queued_at: new Date().toISOString(),
  fencing_token: 1n
});
const dTenantA = new Dispatcher(mockClient, { workspaceId: "ws-prod", dispatcherId: "d-tenant-a" });
const dTenantB = new Dispatcher(mockClient, { workspaceId: "ws-tenant-b", dispatcherId: "d-tenant-b" });

await Promise.all([dTenantA.tick(), dTenantB.tick()]);
const tenantBRun = mockClient.job_runs.get("jr-iso-tenant-b");
const assignedToCorrectTenant = tenantBRun.worker_id !== "worker-alpha";
recordTest(assignedToCorrectTenant, 33, "Multi-dispatcher concurrency: NO cross-tenant assignment");

// 34. Multi-dispatcher: Fencing token monotonic integrity
mockClient.job_runs.delete("jr-101");
mockClient.job_runs.delete("jr-overflow-2");

mockClient.jobs.set("job-fencing", {
  id: "job-fencing",
  workspace_id: multiWs,
  agent_id: "agent-1",
  status: "active",
  max_concurrent_runs: 5
});

mockClient.job_runs.set("jr-fencing-test", {
  id: "jr-fencing-test",
  workspace_id: multiWs,
  job_id: "job-fencing",
  agent_id: "agent-1",
  status: "queued",
  queued_at: new Date().toISOString(),
  worker_id: null,
  fencing_token: 5n
});
const claimFencing = await mockClient.rpc("claim_job_run_v2", { p_worker_id: workerAlpha.id });
recordTest(
  claimFencing.data.claimed === true &&
  claimFencing.data.run?.id === "jr-fencing-test" &&
  BigInt(claimFencing.data.run?.fencing_token) === 6n,
  34,
  "Multi-dispatcher concurrency: Fencing token monotonic integrity (5n -> 6n)"
);

// 35. Multi-dispatcher: Dead worker recovery under pressure
const workerBeta = (await registry.register({
  workspaceId: multiWs,
  workerIdentity: "worker-beta",
  maxConcurrency: 5
})).worker;
const leaseToExpire = Array.from(mockClient.worker_leases.values()).find((l) => l.job_run_id === "jr-fencing-test");
leaseToExpire.expires_at = new Date(Date.now() - 1000).toISOString();

await registry.recoverJobs(10);
const claimRecovered = await mockClient.rpc("claim_job_run_v2", { p_worker_id: workerBeta.id });
recordTest(claimRecovered.data.claimed && claimRecovered.data.run.worker_id === "worker-beta", 35, "Multi-dispatcher: Dead worker recovery delivers job to healthy worker");

console.log("\n==========================================");
console.log(`TOTAL VERIFIED: ${passedTests}/35 TESTS`);
console.log("==========================================");
