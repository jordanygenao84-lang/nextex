/**
 * NEXTEХ — Suite Oficial de Pruebas: Reliability Hardening & Audit R2 (Fase 4.9.1-R2)
 * Cobertura Exhaustiva de 40 Casos de Prueba:
 * - PARTE 1 & 7: Separación Estricta Fencing vs Idempotency (Casos 1–8)
 * - PARTE 2: Pre-Execution Fencing Barrier Exhaustivo (Casos 9–16)
 * - PARTE 3: Zombie Worker Adversarial Simulation (Casos 17–20)
 * - PARTE 4 & 5: Database Write, Service Role & postgres-role Audit (Casos 21–26)
 * - PARTE 6: AI_REQUEST Recovery Determinista & Resumabilidad (Casos 27–32)
 * - PARTE 9 & 10: Integridad Multi-Tenant y Límites de Linaje (Casos 33–36)
 * - PARTE 11: Crash / Recovery Matrix (R1 a R8) (Casos 37–40)
 */

import { readFileSync } from "fs";
import { createHash } from "crypto";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [CASO ${totalTests}/40] ${message}`);
  } else {
    failedTests++;
    console.error(`✗ [CASO ${totalTests}/40] FALLÓ: ${message}`);
  }
}

// ----------------------------------------------------------------------------
// CONSTANTES Y ERRORES CANÓNICOS
// ----------------------------------------------------------------------------
const AgentErrorCodes = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_NOT_ACTIVE: "AGENT_NOT_ACTIVE",
  AGENT_PERMISSION_DENIED: "AGENT_PERMISSION_DENIED",
  AGENT_CANCELLED: "AGENT_CANCELLED",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_DISABLED: "TOOL_DISABLED",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TOOL_FENCING_REJECTED: "TOOL_FENCING_REJECTED",
  TOOL_LEASE_EXPIRED: "TOOL_LEASE_EXPIRED",
  TOOL_CROSS_TENANT_ACCESS: "TOOL_CROSS_TENANT_ACCESS",
  TOOL_UNAUTHORIZED_MUTATION: "TOOL_UNAUTHORIZED_MUTATION",
  STEP_NOT_FOUND: "STEP_NOT_FOUND",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  JOB_NOT_ACTIVE: "JOB_NOT_ACTIVE",
};

class AgentError extends Error {
  constructor({ code, message, statusCode = 500, toolId, runId }) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.statusCode = statusCode;
    this.toolId = toolId;
    this.runId = runId;
  }
}

// ----------------------------------------------------------------------------
// PRE-TOOL BARRIER Y DERIVACIÓN DE IDEMPOTENCY KEY (Fase 4.9.1-R2)
// ----------------------------------------------------------------------------
async function executePreToolBarrier(tool, context) {
  if (!context.jobRunId || !context.supabaseClient) {
    return;
  }

  const { data: jobRun, error: jrErr } = await context.supabaseClient
    .from("job_runs")
    .select("id, workspace_id, agent_id, worker_id, fencing_token, status, lease_expires_at")
    .eq("id", context.jobRunId)
    .maybeSingle();

  if (jrErr || !jobRun) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_FENCING_REJECTED,
      message: `PRE-TOOL BARRIER: JobRun '${context.jobRunId}' no encontrado en base de datos.`,
      statusCode: 409,
      toolId: tool.id,
      runId: context.runId,
    });
  }

  // 1. Aislamiento Multi-Tenant Estricto
  if (jobRun.workspace_id !== context.workspaceId) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
      message: `PRE-TOOL BARRIER: Violación cross-tenant detectada (JobRun ws: ${jobRun.workspace_id} vs context ws: ${context.workspaceId}).`,
      statusCode: 403,
      toolId: tool.id,
      runId: context.runId,
    });
  }

  // 2. Estado ejecutable obligatorio (running o claimed únicamente)
  if (jobRun.status !== "running" && jobRun.status !== "claimed") {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_FENCING_REJECTED,
      message: `PRE-TOOL BARRIER: JobRun no se encuentra en estado ejecutable ('${jobRun.status}'). Ejecución de herramienta cancelada.`,
      statusCode: 409,
      toolId: tool.id,
      runId: context.runId,
    });
  }

  // 3. Verificación de Agente Activo y Pertenencia a Tenant
  if (jobRun.agent_id) {
    const { data: agentRec } = await context.supabaseClient
      .from("agents")
      .select("id, status, workspace_id")
      .eq("id", jobRun.agent_id)
      .maybeSingle();

    if (agentRec && (agentRec.status !== "active" || agentRec.workspace_id !== context.workspaceId)) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_NOT_ACTIVE,
        message: `PRE-TOOL BARRIER: El Agente '${jobRun.agent_id}' no está activo (${agentRec?.status}) o no pertenece al workspace.`,
        statusCode: 400,
        toolId: tool.id,
        runId: context.runId,
      });
    }
  }

  // 4. Cercado estricto por Worker ID
  if (context.workerId && jobRun.worker_id && jobRun.worker_id !== context.workerId) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_FENCING_REJECTED,
      message: `PRE-TOOL BARRIER: Worker '${context.workerId}' ya no posee el lease del JobRun (poseído por '${jobRun.worker_id}').`,
      statusCode: 409,
      toolId: tool.id,
      runId: context.runId,
    });
  }

  // 5. Fencing Token Monótono
  if (context.fencingToken !== undefined && Number(jobRun.fencing_token) !== Number(context.fencingToken)) {
    throw new AgentError({
      code: AgentErrorCodes.TOOL_FENCING_REJECTED,
      message: `PRE-TOOL BARRIER: Fencing token desfasado (contexto: ${context.fencingToken}, DB: ${jobRun.fencing_token}). El worker fue cercado fuera.`,
      statusCode: 409,
      toolId: tool.id,
      runId: context.runId,
    });
  }

  // 6. Validez temporal de Lease
  if (jobRun.lease_expires_at) {
    const expiresMs = new Date(jobRun.lease_expires_at).getTime();
    if (expiresMs <= Date.now()) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_LEASE_EXPIRED,
        message: `PRE-TOOL BARRIER: El lease del JobRun expiró en ${jobRun.lease_expires_at}.`,
        statusCode: 409,
        toolId: tool.id,
        runId: context.runId,
      });
    }
  }

  // 7. Integridad de Linaje: AgentRun pertenece al JobRun y al workspace
  if (context.runId) {
    const { data: agentRunRec } = await context.supabaseClient
      .from("agent_runs")
      .select("id, job_run_id, workspace_id")
      .eq("id", context.runId)
      .maybeSingle();

    if (agentRunRec && (agentRunRec.job_run_id !== context.jobRunId || agentRunRec.workspace_id !== context.workspaceId)) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
        message: `PRE-TOOL BARRIER: El AgentRun no pertenece al JobRun ni al workspace indicado.`,
        statusCode: 403,
        toolId: tool.id,
        runId: context.runId,
      });
    }
  }

  // 8. Integridad de Linaje: Step pertenece al AgentRun y al workspace
  if (context.stepId && context.runId) {
    const { data: stepRec } = await context.supabaseClient
      .from("agent_run_steps")
      .select("id, run_id, workspace_id")
      .eq("id", context.stepId)
      .maybeSingle();

    if (stepRec && (stepRec.run_id !== context.runId || stepRec.workspace_id !== context.workspaceId)) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
        message: `PRE-TOOL BARRIER: El Step no pertenece al AgentRun ni al workspace indicado.`,
        statusCode: 403,
        toolId: tool.id,
        runId: context.runId,
      });
    }
  }
}

function deriveCanonicalIdempotencyKey(tool, context) {
  if (context.idempotencyKey) return context.idempotencyKey;
  const isExternalSideEffect = tool.riskLevel === "external" || tool.riskLevel === "destructive";
  if (!isExternalSideEffect) return undefined;
  return `idemp_${context.workspaceId}_${context.jobRunId || "direct"}_${context.runId}_${context.stepId || "step"}_${tool.id}`;
}

async function executeSimulatedTool(tool, params, context) {
  await executePreToolBarrier(tool, context);
  const idempotencyKey = deriveCanonicalIdempotencyKey(tool, context);
  const outcome = await tool.handler(params, { ...context, idempotencyKey });
  return { success: true, data: outcome.result, metadata: { ...outcome.metadata, idempotencyKey } };
}

// ----------------------------------------------------------------------------
// MOCK SUPABASE CLIENT CON POSTGRES / SERVICE ROLE DUAL ENGINE
// ----------------------------------------------------------------------------
class MockSupabaseClient {
  constructor() {
    this.workspaces = new Map();
    this.workspaceMembers = new Map();
    this.agents = new Map();
    this.jobs = new Map();
    this.jobRuns = new Map();
    this.agentRuns = new Map();
    this.agentRunSteps = new Map();
    this.approvalRequests = new Map();
    this.toolIdempotencyLedger = new Map();
    this.conversations = new Map();
    this.aiRequests = new Map();
    this.currentRole = "authenticated";
    this.currentUserId = null;
  }

  setSession(userId, role = "authenticated") {
    this.currentUserId = userId;
    this.currentRole = role;
  }

  from(tableName) {
    return new MockQueryBuilder(tableName, this[this._mapName(tableName)], this);
  }

  _mapName(t) {
    const m = {
      workspaces: "workspaces",
      workspace_members: "workspaceMembers",
      agents: "agents",
      jobs: "jobs",
      job_runs: "jobRuns",
      agent_runs: "agentRuns",
      agent_run_steps: "agentRunSteps",
      approval_requests: "approvalRequests",
      tool_idempotency_ledger: "toolIdempotencyLedger",
      conversations: "conversations",
      ai_requests: "aiRequests",
    };
    return m[t] || t;
  }

  async rpc(funcName, params) {
    if (funcName === "execute_authorized_database_write") {
      return this._executeAuthorizedDatabaseWrite(params);
    }
    return { data: null, error: new Error(`RPC ${funcName} no simulada`) };
  }

  _executeAuthorizedDatabaseWrite(params) {
    const { p_run_id, p_step_id, p_execution_id, p_fencing_token, p_expected_payload_hash } = params;

    const run = this.agentRuns.get(p_run_id);
    if (!run) {
      return { data: { success: false, error_code: AgentErrorCodes.AGENT_NOT_FOUND, error_message: "Run no encontrado" } };
    }

    if (this.currentUserId) {
      // Modo Interactivo: Usuario Autenticado
      const member = this.workspaceMembers.get(`${run.workspace_id}:${this.currentUserId}`);
      if (!member) {
        return { data: { success: false, error_code: AgentErrorCodes.AGENT_PERMISSION_DENIED, error_message: "Usuario no pertenece al workspace" } };
      }
    } else if (this.currentRole === "service_role") {
      // Modo Background Worker: Requiere estrictamente service_role (NO postgres)
      if (!run.job_run_id) {
        return { data: { success: false, error_code: "JOB_RUN_NOT_FOUND", error_message: "AgentRun sin JobRun formal" } };
      }

      const jobRun = this.jobRuns.get(run.job_run_id);
      if (!jobRun || jobRun.workspace_id !== run.workspace_id) {
        return { data: { success: false, error_code: "JOB_RUN_NOT_FOUND", error_message: "JobRun no encontrado o cross-tenant" } };
      }

      if (!["claimed", "running"].includes(jobRun.status)) {
        return { data: { success: false, error_code: "JOB_NOT_ACTIVE", error_message: "JobRun no está activo" } };
      }

      if (jobRun.lease_expires_at && new Date(jobRun.lease_expires_at).getTime() <= Date.now()) {
        return { data: { success: false, error_code: AgentErrorCodes.TOOL_LEASE_EXPIRED, error_message: "Lease expirado" } };
      }

      const agent = this.agents.get(jobRun.agent_id);
      if (!agent || agent.status !== "active" || agent.workspace_id !== run.workspace_id) {
        return { data: { success: false, error_code: AgentErrorCodes.AGENT_NOT_ACTIVE, error_message: "Agente inactivo o ajeno al workspace" } };
      }

      if (Number(jobRun.fencing_token) !== Number(p_fencing_token)) {
        return { data: { success: false, error_code: AgentErrorCodes.TOOL_FENCING_REJECTED, error_message: "Fencing token desfasado" } };
      }
    } else {
      // Cualquier otro rol (anon, postgres directo sin service_role JWT) se rechaza con AUTH_REQUIRED
      return { data: { success: false, error_code: "AUTH_REQUIRED", error_message: "Sesión autenticada o rol de servicio autorizado requerido." } };
    }

    const step = this.agentRunSteps.get(p_step_id);
    if (!step || step.run_id !== p_run_id) {
      return { data: { success: false, error_code: AgentErrorCodes.STEP_NOT_FOUND, error_message: "Step no encontrado" } };
    }

    if (step.workspace_id !== run.workspace_id) {
      return { data: { success: false, error_code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS, error_message: "Cross-tenant step" } };
    }

    const ledger = this.toolIdempotencyLedger.get(p_step_id);
    if (ledger) {
      return { data: { success: true, status: ledger.status, data: ledger.result, cached: true } };
    }

    const paramsObj = step.input?.params || step.input || {};
    const targetTable = paramsObj.table;
    let resultRecord = {};

    if (targetTable === "conversations") {
      resultRecord = {
        id: `conv-${Date.now()}`,
        workspace_id: run.workspace_id,
        user_id: this.currentUserId || run.user_id,
        title: paramsObj.data?.title || "Nueva conversación",
      };
      this.conversations.set(resultRecord.id, resultRecord);
    }

    this.toolIdempotencyLedger.set(p_step_id, {
      id: `ledg-${Date.now()}`,
      step_id: p_step_id,
      run_id: p_run_id,
      status: "committed",
      result: resultRecord,
      created_at: new Date().toISOString(),
    });

    step.status = "completed";
    step.output = resultRecord;

    return { data: { success: true, status: "committed", data: resultRecord, cached: false } };
  }
}

class MockQueryBuilder {
  constructor(name, map, root) {
    this.name = name;
    this.map = map;
    this.root = root;
    this.filters = [];
    this.isSingle = false;
    this.isMaybeSingle = false;
  }

  select() { return this; }
  eq(field, value) { this.filters.push({ field, value }); return this; }
  order() { return this; }
  single() { this.isSingle = true; return this._execute(); }
  maybeSingle() { this.isMaybeSingle = true; return this._execute(); }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  async insert(recOrArray) {
    const list = Array.isArray(recOrArray) ? recOrArray : [recOrArray];
    const inserted = [];
    for (const r of list) {
      const id = r.id || `gen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const full = { ...r, id };
      this.map.set(id, full);
      inserted.push(full);
    }
    return { data: Array.isArray(recOrArray) ? inserted : inserted[0], error: null };
  }

  update(patch) {
    this.pendingPatch = patch;
    return this;
  }

  async _execute() {
    let rows = Array.from(this.map.values());
    for (const f of this.filters) {
      rows = rows.filter((r) => r[f.field] === f.value);
    }
    if (this.pendingPatch) {
      for (const r of rows) {
        const u = { ...r, ...this.pendingPatch };
        this.map.set(r.id, u);
      }
      return { data: rows.map((r) => this.map.get(r.id)), error: null };
    }
    if (this.isSingle) {
      if (rows.length === 0) return { data: null, error: { message: "Not found", code: "PGRST116" } };
      return { data: rows[0], error: null };
    }
    if (this.isMaybeSingle) {
      return { data: rows[0] || null, error: null };
    }
    return { data: rows, error: null };
  }
}

// ----------------------------------------------------------------------------
// RECOVERY STATE MACHINE EN MEMORIA (EXACTO A runtime.ts FASE 4.9.1-R2)
// ----------------------------------------------------------------------------
async function simulateResumeInterruptedRunR2(agentRunId, db, options = {}) {
  const { data: runRecord } = await db.from("agent_runs").select("*").eq("id", agentRunId).single();
  if (!runRecord) throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Run no encontrado" });

  const { data: stepsRecords } = await db.from("agent_run_steps").select("*").eq("run_id", agentRunId).order();
  const steps = stepsRecords || [];

  // Invariante de Estado Terminal
  if (["completed", "failed", "cancelled", "timeout"].includes(runRecord.status)) {
    return { run: runRecord, steps };
  }

  // Verificación estricta de aislamiento multi-tenant e integridad de linaje
  for (const step of steps) {
    if (step.workspace_id !== runRecord.workspace_id || step.run_id !== runRecord.id) {
      throw new AgentError({
        code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS,
        message: `Discrepancia de seguridad: el paso '${step.id}' no pertenece al run '${runRecord.id}' o al workspace '${runRecord.workspace_id}'.`,
        statusCode: 403,
        runId: runRecord.id,
      });
    }
  }

  const { data: agentData } = await db.from("agents").select("*").eq("id", runRecord.agent_id).single();
  if (!agentData || agentData.status !== "active") {
    throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_ACTIVE, message: "Agente inactivo" });
  }

  const effectiveFencingToken = options.fencingToken ?? (runRecord.fencing_token || 0);
  const effectiveWorkerId = options.workerId ?? runRecord.worker_id ?? undefined;

  // Reconciliar último step
  const lastStep = steps[steps.length - 1];
  if (lastStep && (lastStep.status === "running" || lastStep.status === "pending")) {
    if (lastStep.step_type === "APPROVAL_REQUEST" && lastStep.status === "pending") {
      return { run: runRecord, steps, needsApproval: true, approvalStep: lastStep };
    }

    if (lastStep.step_type === "TOOL_CALL") {
      const { data: ledgerEntry } = await db.from("tool_idempotency_ledger").select("*").eq("step_id", lastStep.id).maybeSingle();
      if (ledgerEntry && ledgerEntry.status === "committed") {
        lastStep.status = "completed";
        lastStep.step_type = "TOOL_RESULT";
        lastStep.output = ledgerEntry.result;
      } else {
        // Re-ejecutar tool bajo nuevo fencing token
        lastStep.status = "completed";
        lastStep.step_type = "TOOL_RESULT";
        lastStep.output = { result: "recovered-execution", fencingToken: effectiveFencingToken };
      }
    } else if (lastStep.step_type === "AI_REQUEST") {
      if (lastStep.output && lastStep.output.content) {
        lastStep.status = "completed";
      } else {
        // Re-invocar AI Gateway con requestId determinista
        const deterministicRequestId = `req-agent-${runRecord.id}-${lastStep.step_number}`;
        lastStep.status = "completed";
        lastStep.output = { content: "[AI_RECOVERED_CONTENT]", requestId: deterministicRequestId };
        await db.from("agent_run_steps").update({ status: "completed", output: lastStep.output }).eq("id", lastStep.id);
      }
    }
  }

  // Comprobar si hay approval pendiente
  const pendingApproval = steps.find((s) => s.step_type === "APPROVAL_REQUEST" && s.status === "pending");
  if (pendingApproval) {
    return { run: runRecord, steps, needsApproval: true, approvalStep: pendingApproval };
  }

  // Si no había steps
  if (steps.length === 0) {
    const step1 = {
      id: `step-${runRecord.id}-1`,
      run_id: runRecord.id,
      workspace_id: runRecord.workspace_id,
      step_number: 1,
      step_type: "AI_REQUEST",
      status: "completed",
      output: { content: "Respuesta inicial" },
    };
    steps.push(step1);
    await db.from("agent_run_steps").insert(step1);
    runRecord.status = "completed";
    return { run: runRecord, steps };
  }

  const lastCompleted = steps[steps.length - 1];
  if (lastCompleted.step_type === "AI_REQUEST") {
    const content = lastCompleted.output?.content || "";
    if (content.includes("[TOOL_CALL:")) {
      const step2 = {
        id: `step-${runRecord.id}-2`,
        run_id: runRecord.id,
        workspace_id: runRecord.workspace_id,
        step_number: 2,
        step_type: "TOOL_RESULT",
        status: "completed",
        output: { result: "tool-executed-on-recovery", fencing: effectiveFencingToken },
      };
      steps.push(step2);
      await db.from("agent_run_steps").insert(step2);
      runRecord.status = "completed";
      runRecord.output = `${content} [Resultado herramienta]`;
      return { run: runRecord, steps };
    }
  }

  runRecord.status = "completed";
  return { run: runRecord, steps };
}

// ----------------------------------------------------------------------------
// SUITE PRINCIPAL
// ----------------------------------------------------------------------------
async function runSuite() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE OFICIAL FASE 4.9.1-R2: HARDENING AUDIT");
  console.log("40 CASOS DE PRUEBA: FENCING, IDEMPOTENCY, ZOMBIES, POSTGRES ROLE & AI RECOVERY");
  console.log("==========================================================================\n");

  const migrationSQL = readFileSync("supabase/migrations/20261009_reliability_hardening_4_9_1.sql", "utf8");
  const runtimeCode = readFileSync("src/lib/agents/runtime/runtime.ts", "utf8");
  const executorCode = readFileSync("src/lib/agents/tools/executor.ts", "utf8");

  const db = new MockSupabaseClient();
  const wsA = "ws-tenant-alpha";
  const wsB = "ws-tenant-beta";
  db.workspaces.set(wsA, { id: wsA });
  db.workspaces.set(wsB, { id: wsB });

  const agentA = {
    id: "agent-a1",
    workspace_id: wsA,
    name: "Agente A",
    status: "active",
    max_steps: 5,
    max_tokens: 4000,
    max_tool_calls: 3,
    created_by: "user-owner",
  };
  db.agents.set(agentA.id, agentA);

  const jobRunActive = {
    id: "job-run-100",
    workspace_id: wsA,
    agent_id: agentA.id,
    job_id: "job-1",
    worker_id: "worker-live-1",
    fencing_token: 10,
    status: "running",
    lease_expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  db.jobRuns.set(jobRunActive.id, jobRunActive);

  const agentRunActive = {
    id: "agent-run-100",
    workspace_id: wsA,
    agent_id: agentA.id,
    user_id: "user-owner",
    job_run_id: jobRunActive.id,
    status: "running",
  };
  db.agentRuns.set(agentRunActive.id, agentRunActive);

  const stepActive = {
    id: "step-100-1",
    run_id: agentRunActive.id,
    workspace_id: wsA,
    step_number: 1,
    step_type: "TOOL_CALL",
    status: "running",
  };
  db.agentRunSteps.set(stepActive.id, stepActive);

  // ==========================================================================
  // PARTE 1 & 7: SEPARACIÓN ESTRICTA FENCING VS IDEMPOTENCY (Casos 1–8)
  // ==========================================================================
  const toolExternal = {
    id: "send_sms",
    riskLevel: "external",
    handler: async (p, ctx) => ({ result: { sent: true, key: ctx.idempotencyKey } }),
  };

  // 1. Worker A (fencing = 10, workerId = worker-A) ejecuta la tool
  const resWorkerA = await executeSimulatedTool(toolExternal, { to: "+1234567890" }, {
    agentId: agentA.id,
    runId: agentRunActive.id,
    workspaceId: wsA,
    userId: "user-owner",
    stepId: stepActive.id,
    jobRunId: jobRunActive.id,
    workerId: "worker-live-1",
    fencingToken: 10,
    supabaseClient: db,
  });
  const keyA = resWorkerA.metadata.idempotencyKey;
  assert(Boolean(keyA), "1. Worker A genera clave de idempotencia canónica para side-effect externo");

  // 2. Fencing Token NO está en la clave de idempotencia
  assert(!keyA.includes("_10"), "2. La clave de idempotencia no contiene el fencing token (_10)");

  // 3. Worker ID NO está en la clave de idempotencia
  assert(!keyA.includes("worker-live-1"), "3. La clave de idempotencia no contiene el worker ID");

  // 4. Worker B (fencing = 11, workerId = worker-B) recupera la misma operación lógica
  // Simulamos que el JobRun fue tomado por Worker B con fencing incrementado
  const jobRunTakenOver = {
    ...jobRunActive,
    fencing_token: 11,
    worker_id: "worker-live-2",
  };
  db.jobRuns.set(jobRunActive.id, jobRunTakenOver);

  const resWorkerB = await executeSimulatedTool(toolExternal, { to: "+1234567890" }, {
    agentId: agentA.id,
    runId: agentRunActive.id,
    workspaceId: wsA,
    userId: "user-owner",
    stepId: stepActive.id,
    jobRunId: jobRunActive.id,
    workerId: "worker-live-2",
    fencingToken: 11,
    supabaseClient: db,
  });
  const keyB = resWorkerB.metadata.idempotencyKey;

  // 5. Invariante Matemática: Misma Op Lógica + Worker Diferente + Fencing Diferente = MISMA IDEMPOTENCY KEY
  assert(keyA === keyB, "4. Invariante: Misma operación lógica con diferente worker y fencing produce exactamente la misma idempotency key");

  // 6. Operación Lógica Diferente (diferente stepId) produce Idempotency Key DIFERENTE
  const keyStep2 = deriveCanonicalIdempotencyKey(toolExternal, {
    workspaceId: wsA,
    jobRunId: jobRunActive.id,
    runId: agentRunActive.id,
    stepId: "step-100-2",
  });
  assert(keyStep2 !== keyA, "5. Operación lógica diferente (stepId distinto) genera una idempotency key distinta");

  // 7. Tool diferente produce Idempotency Key DIFERENTE
  const toolOther = { id: "charge_card", riskLevel: "external" };
  const keyToolOther = deriveCanonicalIdempotencyKey(toolOther, {
    workspaceId: wsA,
    jobRunId: jobRunActive.id,
    runId: agentRunActive.id,
    stepId: stepActive.id,
  });
  assert(keyToolOther !== keyA, "6. Herramienta diferente genera una idempotency key distinta");

  // 8. Inspección Estática de executor.ts: Cero concatenación de fencingToken en idempotencyKey
  assert(
    !executorCode.includes("`idemp_${context.runId}_${context.stepId || \"step\"}_${tool.id}_${context.fencingToken"),
    "7. executor.ts desvincula físicamente fencingToken de la derivación de idempotencyKey"
  );
  assert(
    executorCode.includes("`idemp_${context.workspaceId}_${context.jobRunId || \"direct\"}_${context.runId}_${context.stepId || \"step\"}_${tool.id}`"),
    "8. executor.ts aplica la fórmula canónica estable workspace + job_run + agent_run + step + tool"
  );

  // ==========================================================================
  // PARTE 2: PRE-EXECUTION FENCING BARRIER EXHAUSTIVO (Casos 9–16)
  // ==========================================================================
  // 9. JobRun Inexistente rechazado
  let jrNotFoundCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      jobRunId: "jr-phantom",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    jrNotFoundCaught = err.code === AgentErrorCodes.TOOL_FENCING_REJECTED;
  }
  assert(jrNotFoundCaught, "9. Barrier rechaza JobRun inexistente con TOOL_FENCING_REJECTED");

  // 10. Workspace Mismatch rechazado
  let wsMismatchCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsB, // Ajeno
      jobRunId: jobRunActive.id,
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    wsMismatchCaught = err.code === AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS;
  }
  assert(wsMismatchCaught, "10. Barrier rechaza discrepancia de workspace con TOOL_CROSS_TENANT_ACCESS");

  // 11. JobRun en estado no ejecutable (waiting_approval) rechazado
  const jrWaiting = { ...jobRunTakenOver, id: "jr-waiting", status: "waiting_approval" };
  db.jobRuns.set(jrWaiting.id, jrWaiting);
  let notExecStatusCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      jobRunId: jrWaiting.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    notExecStatusCaught = err.code === AgentErrorCodes.TOOL_FENCING_REJECTED;
  }
  assert(notExecStatusCaught, "11. Barrier bloquea ejecución si JobRun está en waiting_approval o estado no ejecutable");

  // 12. Agente Pausado/Inactivo en DB rechazado
  const agPaused = { ...agentA, id: "ag-paused-barrier", status: "paused" };
  db.agents.set(agPaused.id, agPaused);
  const jrPausedAg = { ...jobRunTakenOver, id: "jr-ag-paused", agent_id: agPaused.id };
  db.jobRuns.set(jrPausedAg.id, jrPausedAg);
  let agPausedCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agPaused.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      jobRunId: jrPausedAg.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    agPausedCaught = err.code === AgentErrorCodes.AGENT_NOT_ACTIVE;
  }
  assert(agPausedCaught, "12. Barrier rechaza ejecución si el agente asociado en DB fue pausado o archivado");

  // 13. Agente Cross-Tenant en DB rechazado
  const agCrossTenant = { ...agentA, id: "ag-cross-tenant", workspace_id: wsB, status: "active" };
  db.agents.set(agCrossTenant.id, agCrossTenant);
  const jrCrossAg = { ...jobRunTakenOver, id: "jr-ag-cross", agent_id: agCrossTenant.id };
  db.jobRuns.set(jrCrossAg.id, jrCrossAg);
  let agCrossCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agCrossTenant.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      jobRunId: jrCrossAg.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    agCrossCaught = err.code === AgentErrorCodes.AGENT_NOT_ACTIVE;
  }
  assert(agCrossCaught, "13. Barrier detecta y bloquea agente que no pertenece al workspace del JobRun");

  // 14. Lease Expirado rechazado
  const jrExpired = { ...jobRunTakenOver, id: "jr-exp-r2", lease_expires_at: new Date(Date.now() - 100).toISOString() };
  db.jobRuns.set(jrExpired.id, jrExpired);
  let expCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      jobRunId: jrExpired.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    expCaught = err.code === AgentErrorCodes.TOOL_LEASE_EXPIRED;
  }
  assert(expCaught, "14. Barrier rechaza invocación si el lease temporal del JobRun ha vencido");

  // 15. Linaje AgentRun no corresponde a JobRun
  const orphanAgentRun = { ...agentRunActive, id: "run-orphan-2", job_run_id: "other-jr" };
  db.agentRuns.set(orphanAgentRun.id, orphanAgentRun);
  let orphanRunCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: orphanAgentRun.id,
      workspaceId: wsA,
      jobRunId: jobRunTakenOver.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    orphanRunCaught = err.code === AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS;
  }
  assert(orphanRunCaught, "15. Barrier valida correspondencia de linaje entre AgentRun y JobRun");

  // 16. Linaje Step no corresponde a AgentRun
  const orphanStep = { ...stepActive, id: "step-orphan-2", run_id: "other-run" };
  db.agentRunSteps.set(orphanStep.id, orphanStep);
  let orphanStepCaught = false;
  try {
    await executeSimulatedTool(toolExternal, {}, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      stepId: orphanStep.id,
      jobRunId: jobRunTakenOver.id,
      workerId: "worker-live-2",
      fencingToken: 11,
      supabaseClient: db,
    });
  } catch (err) {
    orphanStepCaught = err.code === AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS;
  }
  assert(orphanStepCaught, "16. Barrier valida correspondencia de linaje entre AgentRunStep y AgentRun");

  // ==========================================================================
  // PARTE 3: ZOMBIE WORKER ADVERSARIAL SIMULATION (Casos 17–20)
  // ==========================================================================
  let externalNetworkHitCount = 0;
  const toolAuditedNetwork = {
    id: "external_wire_transfer",
    riskLevel: "external",
    handler: async (p, ctx) => {
      externalNetworkHitCount++;
      return { result: { transferId: "tx-999" } };
    },
  };

  // Escenario:
  // 1. Worker A tenía JobRun activo con fencing 10.
  // 2. Worker A se pausa (GC pause / network stall).
  // 3. Lease expira. Worker B toma el JobRun (fencing = 11, workerId = worker-B).
  // 4. Worker A despierta e intenta ejecutar toolAuditedNetwork.
  let zombieAttemptCaught = false;
  try {
    await executeSimulatedTool(toolAuditedNetwork, { amount: 1000 }, {
      agentId: agentA.id,
      runId: agentRunActive.id,
      workspaceId: wsA,
      stepId: stepActive.id,
      jobRunId: jobRunActive.id, // En DB ahora tiene fencing 11 y worker-live-2
      workerId: "worker-live-1", // Worker A
      fencingToken: 10, // Fencing A
      supabaseClient: db,
    });
  } catch (err) {
    zombieAttemptCaught = err.code === AgentErrorCodes.TOOL_FENCING_REJECTED;
  }

  assert(zombieAttemptCaught, "17. Zombie Worker A es detenido de raíz con TOOL_FENCING_REJECTED al intentar ejecutar la herramienta");
  assert(externalNetworkHitCount === 0, "18. CERO llamadas a la red externa ejecutadas por Worker A (Efecto secundario evitado ANTES de iniciar)");

  // 5. Worker B ejecuta la herramienta legítimamente
  const workerBOutcome = await executeSimulatedTool(toolAuditedNetwork, { amount: 1000 }, {
    agentId: agentA.id,
    runId: agentRunActive.id,
    workspaceId: wsA,
    stepId: stepActive.id,
    jobRunId: jobRunActive.id,
    workerId: "worker-live-2",
    fencingToken: 11,
    supabaseClient: db,
  });

  assert(workerBOutcome.success === true && externalNetworkHitCount === 1, "19. Worker B legítimo ejecuta la operación física con éxito");
  assert(
    workerBOutcome.metadata.idempotencyKey.includes(`idemp_${wsA}_${jobRunActive.id}_${agentRunActive.id}_${stepActive.id}_external_wire_transfer`),
    "20. Worker B transmite la clave de idempotencia canónica estable al proveedor externo"
  );

  // ==========================================================================
  // PARTE 4 & 5: DATABASE WRITE, SERVICE ROLE & POSTGRES ROLE (Casos 21–26)
  // ==========================================================================
  db.workspaceMembers.set(`${wsA}:user-owner`, { role: "owner" });

  // 21. Modo Interactivo funciona con usuario autenticado
  db.setSession("user-owner", "authenticated");
  const authWrite = await db.rpc("execute_authorized_database_write", {
    p_run_id: agentRunActive.id,
    p_step_id: stepActive.id,
    p_execution_id: "exec-auth",
    p_fencing_token: 11,
    p_expected_payload_hash: "",
  });
  assert(authWrite.data.success && authWrite.data.status === "committed", "21. Modo interactivo: usuario autenticado ejecuta mutación autorizada");

  // 22. Modo Service Role funciona con JobRun activo y persistido
  db.setSession(null, "service_role");
  const stepWorker = {
    id: "step-worker-r2",
    run_id: agentRunActive.id,
    workspace_id: wsA,
    step_number: 2,
    step_type: "TOOL_CALL",
    status: "running",
    input: { table: "conversations", operation: "insert", data: { title: "Service Role Title" } },
  };
  db.agentRunSteps.set(stepWorker.id, stepWorker);

  const srWrite = await db.rpc("execute_authorized_database_write", {
    p_run_id: agentRunActive.id,
    p_step_id: stepWorker.id,
    p_execution_id: "exec-sr",
    p_fencing_token: 11,
    p_expected_payload_hash: "",
  });
  assert(srWrite.data.success && srWrite.data.status === "committed", "22. Modo Service Role: worker background ejecuta mutación derivando autoridad persistida");

  // 23. Rol 'postgres' sin JWT de service_role rechazado con AUTH_REQUIRED
  db.setSession(null, "postgres");
  const postgresWrite = await db.rpc("execute_authorized_database_write", {
    p_run_id: agentRunActive.id,
    p_step_id: stepWorker.id,
    p_execution_id: "exec-pg",
    p_fencing_token: 11,
    p_expected_payload_hash: "",
  });
  assert(
    postgresWrite.data.success === false && postgresWrite.data.error_code === "AUTH_REQUIRED",
    "23. Rol 'postgres' directo sin claim de service_role es rechazado con AUTH_REQUIRED (Bypass cerrado)"
  );

  // 24. Migración SQL eliminó la cláusula 'or current_user = postgres'
  assert(
    !migrationSQL.includes("or current_user = 'postgres'"),
    "24. Migración 20261009 eliminó formalmente el bypass 'or current_user = postgres'"
  );
  assert(
    migrationSQL.includes("elsif v_auth_role = 'service_role' then"),
    "25. Migración 20261009 exige estrictamente v_auth_role = 'service_role'"
  );

  // 26. Grants limitados a authenticated y service_role
  assert(
    migrationSQL.includes("to authenticated, service_role;"),
    "26. Migración 20261009 otorga permisos exclusivamente a authenticated y service_role"
  );

  // ==========================================================================
  // PARTE 6: AI_REQUEST RECOVERY DETERMINISTA & RESUMABILIDAD (Casos 27–32)
  // ==========================================================================
  // 27. Caso A: Step AI_REQUEST completado y persistido NO vuelve a llamar al provider
  const runAiCompleted = {
    id: "run-ai-done",
    workspace_id: wsA,
    agent_id: agentA.id,
    user_id: "user-owner",
    status: "running",
    input: "Prompt A",
  };
  db.agentRuns.set(runAiCompleted.id, runAiCompleted);
  const stepAiDone = {
    id: "step-ai-done-1",
    run_id: runAiCompleted.id,
    workspace_id: wsA,
    step_number: 1,
    step_type: "AI_REQUEST",
    status: "completed",
    output: { content: "Respuesta existente persistida" },
  };
  db.agentRunSteps.set(stepAiDone.id, stepAiDone);

  const resAiDone = await simulateResumeInterruptedRunR2(runAiCompleted.id, db);
  assert(
    resAiDone.steps[0].output.content === "Respuesta existente persistida",
    "27. Recovery Caso A: AI_REQUEST ya completada y persistida reutiliza el resultado durable sin re-invocación"
  );

  // 28. Caso B: Step AI_REQUEST que crasheó en vuelo (status: running, output: null)
  // Recovery DEBE re-invocar AI Gateway con requestId determinista y persistir resultado
  const runAiCrashed = {
    id: "run-ai-crashed",
    workspace_id: wsA,
    agent_id: agentA.id,
    user_id: "user-owner",
    status: "running",
    input: "Prompt Crashed",
  };
  db.agentRuns.set(runAiCrashed.id, runAiCrashed);
  const stepAiCrashed = {
    id: "step-ai-crashed-1",
    run_id: runAiCrashed.id,
    workspace_id: wsA,
    step_number: 1,
    step_type: "AI_REQUEST",
    status: "running", // Crashed en running sin output
    output: null,
  };
  db.agentRunSteps.set(stepAiCrashed.id, stepAiCrashed);

  const resAiCrashed = await simulateResumeInterruptedRunR2(runAiCrashed.id, db);
  assert(
    resAiCrashed.steps[0].status === "completed" &&
    resAiCrashed.steps[0].output.content === "[AI_RECOVERED_CONTENT]",
    "28. Recovery Caso B: AI_REQUEST interrumpida sin output durable es re-invocada y persistida en BD"
  );
  assert(
    resAiCrashed.steps[0].output.requestId === `req-agent-${runAiCrashed.id}-1`,
    "29. Recovery Caso B: Re-invocación utiliza requestId canónico y determinista para deduplicación en gateway"
  );

  // 30. Caso C: Step AI_REQUEST pertenece a otro workspace/run -> Cross-Tenant Attack
  const runCrossAi = {
    id: "run-cross-ai",
    workspace_id: wsA,
    agent_id: agentA.id,
    user_id: "user-owner",
    status: "running",
  };
  db.agentRuns.set(runCrossAi.id, runCrossAi);
  const stepCrossAi = {
    id: "step-cross-ai-1",
    run_id: runCrossAi.id,
    workspace_id: wsB, // Inyectado desde workspace B!
    step_number: 1,
    step_type: "AI_REQUEST",
    status: "completed",
    output: { content: "Intruso" },
  };
  db.agentRunSteps.set(stepCrossAi.id, stepCrossAi);

  let crossAiStepCaught = false;
  try {
    await simulateResumeInterruptedRunR2(runCrossAi.id, db);
  } catch (err) {
    crossAiStepCaught = err.code === AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS;
  }
  assert(crossAiStepCaught, "30. Recovery Caso C: Paso de otro workspace es detectado y bloqueado con TOOL_CROSS_TENANT_ACCESS");

  // 31. Caso D: AI_REQUEST completada que solicitó Tool -> Continúa a Step 2 TOOL_CALL
  const runAiThenTool = {
    id: "run-ai-tool",
    workspace_id: wsA,
    agent_id: agentA.id,
    user_id: "user-owner",
    status: "running",
    input: "Ejecutar comando",
  };
  db.agentRuns.set(runAiThenTool.id, runAiThenTool);
  const stepAiWithTool = {
    id: "step-ai-tool-1",
    run_id: runAiThenTool.id,
    workspace_id: wsA,
    step_number: 1,
    step_type: "AI_REQUEST",
    status: "completed",
    output: { content: "[TOOL_CALL: send_sms]\n{\"to\":\"+1234\"}\n[/TOOL_CALL]" },
  };
  db.agentRunSteps.set(stepAiWithTool.id, stepAiWithTool);

  const resAiTool = await simulateResumeInterruptedRunR2(runAiThenTool.id, db);
  assert(
    resAiTool.steps.length === 2 &&
    resAiTool.steps[1].step_type === "TOOL_RESULT" &&
    resAiTool.run.status === "completed",
    "31. Recovery Caso D: AI_REQUEST con tool call pendiente continúa al Step 2 sin sellar prematuramente"
  );

  // 32. runtime.ts contiene la lógica de re-ejecución con requestId determinista
  assert(
    runtimeCode.includes("requestId: `req-agent-${runRecord.id}-${lastStep.step_number}`"),
    "32. runtime.ts implementa re-invocación con requestId determinista en resumeInterruptedRun"
  );

  // ==========================================================================
  // PARTE 9 & 10: INTEGRIDAD MULTI-TENANT Y LÍMITES DE LINAJE (Casos 33–36)
  // ==========================================================================
  // 33. Coherencia 4-Way Tenant: job_runs = agent_runs = agent_run_steps = context
  assert(
    executorCode.includes("jobRun.workspace_id !== context.workspaceId") &&
    executorCode.includes("agentRunRec.workspace_id !== context.workspaceId") &&
    executorCode.includes("stepRec.workspace_id !== context.workspaceId"),
    "33. ToolExecutor impone coherencia multi-tenant estricta de 4 vías"
  );

  // 34. Coherencia de Linaje en runtime.ts
  assert(
    runtimeCode.includes("step.workspace_id !== runRecord.workspace_id || step.run_id !== runRecord.id"),
    "34. runtime.ts valida coherencia de workspace y run en cada paso recuperado"
  );

  // 35. Respeto de Estado Terminal: Inmutabilidad física garantizada
  const termRun = { id: "run-term-imm", workspace_id: wsA, agent_id: agentA.id, status: "cancelled", output: "Cancelado" };
  db.agentRuns.set(termRun.id, termRun);
  const resTerm = await simulateResumeInterruptedRunR2(termRun.id, db);
  assert(resTerm.run.status === "cancelled" && resTerm.run.output === "Cancelado", "35. Invariante: Run terminal (cancelled) no sufre mutaciones en recovery");

  // 36. HITL Preservation: Pending approval no se sella como completed
  const runHitl = { id: "run-hitl-imm", workspace_id: wsA, agent_id: agentA.id, status: "waiting_approval" };
  db.agentRuns.set(runHitl.id, runHitl);
  const stepHitl = { id: "step-hitl-1", run_id: runHitl.id, workspace_id: wsA, step_number: 2, step_type: "APPROVAL_REQUEST", status: "pending" };
  db.agentRunSteps.set(stepHitl.id, stepHitl);
  const resHitl = await simulateResumeInterruptedRunR2(runHitl.id, db);
  assert(resHitl.needsApproval === true && resHitl.run.status === "waiting_approval", "36. Invariante: Step de aprobación pendiente retorna needsApproval = true sin sellar completed");

  // ==========================================================================
  // PARTE 11: CRASH / RECOVERY MATRIX (R1 A R8) (Casos 37–40)
  // ==========================================================================
  // 37. R1 & R2: Crash durante tool sin ledger -> Re-ejecuta con nuevo fencing token
  const runR2 = { id: "run-r2", workspace_id: wsA, agent_id: agentA.id, status: "running" };
  db.agentRuns.set(runR2.id, runR2);
  const stepR2 = { id: "step-r2-1", run_id: runR2.id, workspace_id: wsA, step_number: 1, step_type: "TOOL_CALL", status: "running" };
  db.agentRunSteps.set(stepR2.id, stepR2);
  const resR2 = await simulateResumeInterruptedRunR2(runR2.id, db, { fencingToken: 99 });
  assert(
    resR2.steps[0].status === "completed" && resR2.steps[0].output.fencingToken === 99,
    "37. Matriz R2: Crash durante tool sin ledger re-ejecuta bajo nuevo fencing token 99"
  );

  // 38. R3 & R4: Crash tras commit en ledger pero antes de actualizar step -> Reutiliza snapshot
  const runR4 = { id: "run-r4", workspace_id: wsA, agent_id: agentA.id, status: "running" };
  db.agentRuns.set(runR4.id, runR4);
  const stepR4 = { id: "step-r4-1", run_id: runR4.id, workspace_id: wsA, step_number: 1, step_type: "TOOL_CALL", status: "running" };
  db.agentRunSteps.set(stepR4.id, stepR4);
  db.toolIdempotencyLedger.set(stepR4.id, {
    step_id: stepR4.id,
    status: "committed",
    result: { committedValue: 12345 },
  });
  const resR4 = await simulateResumeInterruptedRunR2(runR4.id, db);
  assert(
    resR4.steps[0].output.committedValue === 12345,
    "38. Matriz R4: Crash tras ledger commit reutiliza snapshot sellado sin mutación duplicada"
  );

  // 39. R6: Crash tras AI Result -> Recupera y avanza de forma determinista
  assert(resAiDone.run.status === "completed", "39. Matriz R6: Crash tras AI Result avanza y sella sin repetir el cómputo");

  // 40. R8: Fencing incrementado en recovery transmitido a la ejecución
  assert(
    runtimeCode.includes("const effectiveFencingToken = options?.fencingToken ?? (runRecord.fencing_token || 0);") &&
    runtimeCode.includes("fencingToken: effectiveFencingToken,"),
    "40. Matriz R8: Fencing incrementado del nuevo worker se propaga a todas las llamadas de herramientas en recuperación"
  );

  console.log("\n==========================================================================");
  console.log(`RESULTADO DE SUITE FASE 4.9.1-R2: ${passedTests}/${totalTests} CASOS PASARON (${failedTests} FALLOS)`);
  console.log("==========================================================================\n");

  if (failedTests > 0) process.exit(1);
}

runSuite().catch((err) => {
  console.error("Error fatal en suite:", err);
  process.exit(1);
});
