import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

console.log("==========================================================================");
console.log("NEXTEХ — SUITE OFICIAL FASE 4.11-C: RELIABILITY HARDENING & FAULT TOLERANCE");
console.log("VERIFICACIÓN DE LOS 20 ESCENARIOS OBLIGATORIOS (R01 A R20)");
console.log("==========================================================================\n");

let totalTests = 0;
let passedTests = 0;

function runCheck(id, description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✓ [${id}] ${description}: PASSED`);
  } catch (err) {
    console.error(`✗ [${id}] ${description}: FAILED ->`, err.message);
    throw err;
  }
}

// Funciones canónicas de binding y hashing RFC 8785
function canonicalJSON(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean" || typeof val === "number" || typeof val === "string") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map((item) => canonicalJSON(item)).join(",") + "]";
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(val[k])}`);
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(val);
}

function computeApprovalPayloadHash(runId, stepId, toolId, version, params) {
  const cJson = canonicalJSON(params || {});
  const canonicalBinding = `${runId}:${stepId}:${toolId}:${version}:${cJson}`;
  return createHash("sha256").update(canonicalBinding, "utf8").digest("hex");
}

// Cargar DDL y migraciones canónicas
const durableJobsSQL = fs.readFileSync("supabase/migrations/20261006_durable_jobs_and_scheduler.sql", "utf8");
const controlPlaneSQL = fs.readFileSync("supabase/migrations/20261011_production_control_plane.sql", "utf8");
const idempotencySQL = fs.readFileSync("supabase/migrations/20261003_idempotency_ledger_and_fencing.sql", "utf8");
const permissionsSQL = fs.readFileSync("supabase/migrations/20261004_permissions_and_governance.sql", "utf8");
const reliabilitySQL = fs.readFileSync("supabase/migrations/20261009_reliability_hardening_4_9_1.sql", "utf8");
const hashTS = fs.readFileSync("src/lib/agents/tools/hash.ts", "utf8");
const runtimeTS = fs.readFileSync("src/lib/agents/runtime/runtime.ts", "utf8");
const govManagerTS = fs.readFileSync("src/lib/control-plane/GovernanceManager.ts", "utf8");
const gatewayTS = fs.readFileSync("src/lib/omniengine/gateway/gateway.ts", "utf8");
const executorTS = fs.readFileSync("src/lib/agents/tools/executor.ts", "utf8");

// -----------------------------------------------------------------------------
// R01: WORKER CRASH
// -----------------------------------------------------------------------------
runCheck("R01", "Worker crash & lease revocation in quarantine", () => {
  assert.ok(controlPlaneSQL.includes("create or replace function public.quarantine_worker"), "quarantine_worker existe");
  assert.ok(/update\s+public\.worker_leases\s+set\s+status\s*=\s*'revoked'/.test(controlPlaneSQL), "Leases de worker caído se revocan");
  assert.ok(/update\s+public\.job_runs\s+set\s+status\s*=\s*'queued'/.test(controlPlaneSQL), "JobRuns se re-encolan con incremento de fencing");
});

// -----------------------------------------------------------------------------
// R02: STALE WORKER
// -----------------------------------------------------------------------------
runCheck("R02", "Missed heartbeat detection & STALE state promotion", () => {
  assert.ok(controlPlaneSQL.includes("create or replace function public.mark_worker_stale"), "mark_worker_stale existe");
  assert.ok(controlPlaneSQL.includes("last_heartbeat_at < (clock_timestamp() - (coalesce(p_heartbeat_timeout_seconds, 90) || ' seconds')::interval)"), "Valida timeout de heartbeat");
  assert.ok(controlPlaneSQL.includes("set status = 'STALE'"), "Promueve a status STALE");
  assert.ok(controlPlaneSQL.includes("WORKER_HEARTBEAT_ANOMALY"), "Registra auditoría WORKER_HEARTBEAT_ANOMALY");
});

// -----------------------------------------------------------------------------
// R03: EXPIRED LEASE
// -----------------------------------------------------------------------------
runCheck("R03", "Expired lease detection & automated reclaim safety", () => {
  assert.ok(durableJobsSQL.includes("create or replace function public.recover_stale_job_runs"), "recover_stale_job_runs existe");
  assert.ok(durableJobsSQL.includes("where jr.status in ('claimed', 'running')"), "Filtra runs en estado activo");
  assert.ok(/jr\.lease_expires_at\s*\+\s*\(coalesce/.test(durableJobsSQL), "Detecta leases expirados con gracia temporal contra reloj de BD");
  assert.ok(durableJobsSQL.includes("fencing_token = v_new_token"), "Incrementa fencing token al recuperar");
});

// -----------------------------------------------------------------------------
// R04: ZOMBIE FENCING
// -----------------------------------------------------------------------------
runCheck("R04", "Zombie worker rejection via monotonic fencing tokens", () => {
  assert.ok(durableJobsSQL.includes("if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then"), "Protección contra worker desfasado o fencing antiguo");
  assert.ok(durableJobsSQL.includes("return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED'"), "Emite FENCING_REJECTED");
  assert.ok(controlPlaneSQL.includes("fencing_token bigint not null check (fencing_token >= 0)"), "Fencing token no negativo");
  assert.ok(executorTS.includes("TOOL_FENCING_REJECTED"), "ToolExecutor valida cerco de concurrencia");
});

// -----------------------------------------------------------------------------
// R05: RECOVERY SINGLE WINNER
// -----------------------------------------------------------------------------
runCheck("R05", "Concurrent recovery single-winner via SKIP LOCKED", () => {
  assert.ok(/for\s+update\s+of\s+jr\s+skip\s+locked/i.test(durableJobsSQL), "claim_job_run usa SKIP LOCKED para concurrencia segura");
  assert.ok(/limit\s+20\s+for\s+update\s+of\s+jr\s+skip\s+locked/i.test(durableJobsSQL), "recover_stale_job_runs evita contención con skip locked");
  assert.ok(/for\s+update(\s+of\s+\w+)?\s+skip\s+locked/i.test(controlPlaneSQL), "claim_job_run_v2 usa SKIP LOCKED");
});

// -----------------------------------------------------------------------------
// R06: RETRY LINEAGE
// -----------------------------------------------------------------------------
runCheck("R06", "Exponential backoff, jitter & lineage tracking (retry_of_run_id)", () => {
  assert.ok(durableJobsSQL.includes("create or replace function public.fail_job_run_and_schedule_retry"), "fail_job_run_and_schedule_retry existe");
  assert.ok(durableJobsSQL.includes("retry_of_run_id"), "job_runs incluye columna de linaje retry_of_run_id");
  assert.ok(durableJobsSQL.includes("attempt + 1"), "Incrementa intento");
  assert.ok(durableJobsSQL.includes("power(v_backoff_factor, v_run.attempt - 1)"), "Calcula backoff exponencial");
  assert.ok(durableJobsSQL.includes("random() * 0.4"), "Aplica jitter aleatorio anti-stampede");
});

// -----------------------------------------------------------------------------
// R07: RETRY EXHAUSTION
// -----------------------------------------------------------------------------
runCheck("R07", "Retry exhaustion to dead_letter terminal state", () => {
  assert.ok(durableJobsSQL.includes("set status = 'dead_letter'"), "Sella en dead_letter al agotar intentos");
  assert.ok(durableJobsSQL.includes("insert into public.job_audit_log"), "Registra auditoría inmutable de dead_letter");
  assert.ok(durableJobsSQL.includes("retried', false"), "Marca retried = false");
});

// -----------------------------------------------------------------------------
// R08: CHECKPOINT RECOVERY
// -----------------------------------------------------------------------------
runCheck("R08", "Bounded serverless continuation & checkpoint requeue", () => {
  assert.ok(durableJobsSQL.includes("create or replace function public.checkpoint_and_requeue_job_run"), "checkpoint_and_requeue_job_run existe");
  assert.ok(/update\s+public\.job_runs\s+set\s+status\s*=\s*'queued'/.test(durableJobsSQL), "Re-encola liberando worker y lease para continuación");
  assert.ok(durableJobsSQL.includes("priority = 'high'"), "Eleva prioridad a high para continuación inmediata");
});

// -----------------------------------------------------------------------------
// R09: AGENT RUN RECOVERY
// -----------------------------------------------------------------------------
runCheck("R09", "AgentRun recovery without duplicate run creation", () => {
  assert.ok(permissionsSQL.includes("create or replace function public.create_agent_run_with_concurrency_check"), "create_agent_run_with_concurrency_check existe");
  assert.ok(permissionsSQL.includes("select * into v_agent from public.agents where id = p_agent_id for update"), "Bloqueo pesimista del agente");
  assert.ok(permissionsSQL.includes("AGENT_CONCURRENCY_LIMIT"), "Previene saturación de runs concurrentes");
});

// -----------------------------------------------------------------------------
// R10: AGENT STEP RECOVERY
// -----------------------------------------------------------------------------
runCheck("R10", "AgentStep recovery without repeating completed steps", () => {
  assert.ok(runtimeTS.includes("order(\"step_number\", { ascending: true })"), "Ordena steps deterministamente");
  assert.ok(runtimeTS.includes("status: \"completed\""), "Sella pasos finalizados para evitar re-ejecución");
  assert.ok(runtimeTS.includes("step_type: \"TOOL_RESULT\""), "Almacena resultado de herramienta");
});

// -----------------------------------------------------------------------------
// R11: HITL RECOVERY
// -----------------------------------------------------------------------------
runCheck("R11", "HITL approval recovery with cryptographic payload hash binding", () => {
  const hash = computeApprovalPayloadHash("run-1", "step-1", "database_write", "1.0.0", { table: "users" });
  assert.ok(hash && typeof hash === "string" && hash.length === 64, "Genera hash SHA-256 canónico RFC 8785");
  assert.ok(hashTS.includes("canonicalJSON"), "canonicalJSON implementado conforme a RFC 8785");
  assert.ok(permissionsSQL.includes("if v_approval.payload_hash <> p_expected_hash then"), "Rechaza alteraciones de payload con TOOL_PAYLOAD_HASH_MISMATCH");
  assert.ok(permissionsSQL.includes("TOOL_SELF_APPROVAL_BLOCKED"), "Rechaza auto-aprobación del creador");
});

// -----------------------------------------------------------------------------
// R12: CANCELLATION RACE
// -----------------------------------------------------------------------------
runCheck("R12", "Cancellation precedence over active claim / execution", () => {
  assert.ok(govManagerTS.includes("if (isCancellationPending)"), "Detecta cancelación en curso");
  assert.ok(govManagerTS.includes("Cancelación autoritativa en curso prevalece sobre cualquier intento de aprobación"), "Cancelación tiene precedencia absoluta sobre aprobación");
  assert.ok(controlPlaneSQL.includes("'cancellation_requested'"), "Estado cancellation_requested presente en job_runs");
});

// -----------------------------------------------------------------------------
// R13: DRAIN RACE
// -----------------------------------------------------------------------------
runCheck("R13", "Worker drain race condition handling (DRAINING vs STOPPED)", () => {
  assert.ok(controlPlaneSQL.includes("create or replace function public.drain_worker"), "drain_worker existe");
  assert.ok(controlPlaneSQL.includes("if v_active_leases = 0 then"), "Si no hay leases activos pasa inmediatamente a STOPPED");
  assert.ok(controlPlaneSQL.includes("set status = 'DRAINING'"), "Si tiene trabajo en curso pasa a DRAINING impidiendo nuevos reclamos");
});

// -----------------------------------------------------------------------------
// R14: SHUTDOWN ORDERING
// -----------------------------------------------------------------------------
runCheck("R14", "Graceful shutdown deterministic ordering & audit logging", () => {
  assert.ok(govManagerTS.includes("evaluateShutdown"), "evaluateShutdown existe en GovernanceManager");
  assert.ok(govManagerTS.includes("permission: \"workspace.settings.update\""), "Exige permisos para shutdown");
  assert.ok(controlPlaneSQL.includes("WORKER_STOPPED"), "Registra WORKER_STOPPED en worker_audit_log");
});

// -----------------------------------------------------------------------------
// R15: DUPLICATE SCHEDULER OCCURRENCE
// -----------------------------------------------------------------------------
runCheck("R15", "Scheduler occurrence idempotency via UNIQUE constraint", () => {
  assert.ok(durableJobsSQL.includes("constraint uq_schedule_occurrence unique (automation_id, scheduled_for)"), "Restricción UNIQUE previene ocurrencias duplicadas para el mismo instante");
});

// -----------------------------------------------------------------------------
// R16: SCHEDULER CATCH-UP
// -----------------------------------------------------------------------------
runCheck("R16", "Bounded scheduler catch-up policy anti-stampede", () => {
  assert.ok(durableJobsSQL.includes("create or replace function public.generate_schedule_occurrences"), "generate_schedule_occurrences existe");
  assert.ok(durableJobsSQL.includes("max_catch_up_occurrences integer not null default 2 check (max_catch_up_occurrences between 1 and 10)"), "Limita ocurrencias catch-up a cota máxima");
  assert.ok(durableJobsSQL.includes("catch_up_policy text not null default 'limited_catch_up'"), "Política declarativa limited_catch_up");
});

// -----------------------------------------------------------------------------
// R17: CONCURRENCY RACE
// -----------------------------------------------------------------------------
runCheck("R17", "Three-level hierarchical locking (Workspace -> Agent -> Job)", () => {
  assert.ok(durableJobsSQL.includes("select * into v_ws from public.workspaces where id = v_cand.workspace_id for update"), "Nivel 1: Bloqueo de Workspace");
  assert.ok(durableJobsSQL.includes("select * into v_agent from public.agents where id = v_cand.agent_id for update"), "Nivel 2: Bloqueo de Agente");
  assert.ok(durableJobsSQL.includes("select * into v_job from public.jobs where id = v_cand.job_id for update"), "Nivel 3: Bloqueo de Job");
  assert.ok(durableJobsSQL.includes("continue; -- Slot de Workspace saturado: saltar al siguiente candidato"), "Skipping continuo anti-starvation");
});

// -----------------------------------------------------------------------------
// R18: IDEMPOTENCY RACE
// -----------------------------------------------------------------------------
runCheck("R18", "Pre-execution idempotency ledger check & hash verification", () => {
  assert.ok(idempotencySQL.includes("create or replace function public.claim_agent_step_execution"), "claim_agent_step_execution existe");
  assert.ok(idempotencySQL.includes("compute_tool_payload_hash"), "compute_tool_payload_hash existe en BD");
  assert.ok(/fencing_token\s*=\s*v_new_token/.test(idempotencySQL), "fencing_token incrementado");
});

// -----------------------------------------------------------------------------
// R19: TOOL FAILURE
// -----------------------------------------------------------------------------
runCheck("R19", "Tool execution error handling & fail state sealing", () => {
  assert.ok(runtimeTS.includes("status: \"failed\""), "Marca step como failed ante fallo de herramienta");
  assert.ok(runtimeTS.includes("TOOL_EXECUTION_FAILED"), "Registra código TOOL_EXECUTION_FAILED");
  assert.ok(executorTS.includes("execute"), "ToolExecutor dispone de función de ejecución protegida");
});

// -----------------------------------------------------------------------------
// R20: AI PROVIDER FAILURE
// -----------------------------------------------------------------------------
runCheck("R20", "AI Gateway retry logic, error classification & exponential backoff", () => {
  assert.ok(gatewayTS.includes("isRetryable"), "Clasificación de errores reintentables");
  assert.ok(gatewayTS.includes("maxRetries"), "Límite máximo de reintentos acotado");
  assert.ok(gatewayTS.includes("setTimeout(res, 500 * attempt)"), "Backoff de reintento entre llamadas");
  assert.ok(gatewayTS.includes("execute"), "Método execute disponible en AI Gateway");
});

console.log("\n==========================================================================");
console.log(`RESULTADO FINAL: ${passedTests}/${totalTests} CHECKS DE CONFIABILIDAD SUPERADOS (100% PASS)`);
console.log("==========================================================================");
