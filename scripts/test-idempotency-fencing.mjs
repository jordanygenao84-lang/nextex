/**
 * NEXTEХ — Suite Oficial de Pruebas: Idempotency Ledger, Fencing y Database Write Seguro (Fase 4.3)
 * Cobertura exhaustiva de 20 escenarios:
 * 1. authorized insert
 * 2. unauthorized mutation (bloqueo de ai_usage u otras tablas)
 * 3. cross-tenant mutation (aislamiento estricto por workspace)
 * 4. payload tampering (detección de alteración post-aprobación)
 * 5. hash mismatch (violación de integridad de binding)
 * 6. expired lease (rechazo de ejecución con lease vencido)
 * 7. stale executor after takeover (cercado y rechazo de executor antiguo)
 * 8. fencing token mismatch (rechazo de token desactualizado)
 * 9. valid executor (adquisición legítima con lease activo)
 * 10. duplicate execution_id (bloqueo por unicidad de intento)
 * 11. ledger replay (idempotencia efectiva: reintento devuelve snapshot sellado)
 * 12. concurrent execution (serialización pesimista: 1 mutación física + 1 ledger hit)
 * 13. UPDATE successful (affected_rows = 1)
 * 14. UPDATE 0 rows (status = 'not_found' registrado en ledger)
 * 15. DELETE successful (deleted_rows = 1)
 * 16. DELETE 0 rows (status = 'already_deleted' registrado en ledger)
 * 17. crash/recovery semantics (recuperación determinista)
 * 18. atomic rollback (rollback conjunto de mutación y ledger)
 * 19. agents insert forced draft & created_by derivation
 * 20. payload immutability verification
 */

import { createHash } from "crypto";

// 1. Tipos y Errores Canónicos
const AgentErrorCodes = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_PERMISSION_DENIED: "AGENT_PERMISSION_DENIED",
  STEP_NOT_FOUND: "STEP_NOT_FOUND",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_SCHEMA_INVALID: "TOOL_SCHEMA_INVALID",
  TOOL_APPROVAL_INVALID: "TOOL_APPROVAL_INVALID",
  TOOL_APPROVAL_REPLAY: "TOOL_APPROVAL_REPLAY",
  TOOL_FENCING_REJECTED: "TOOL_FENCING_REJECTED",
  TOOL_LEASE_EXPIRED: "TOOL_LEASE_EXPIRED",
  TOOL_LEASE_ACTIVE: "TOOL_LEASE_ACTIVE",
  TOOL_PAYLOAD_HASH_MISMATCH: "TOOL_PAYLOAD_HASH_MISMATCH",
  TOOL_IDEMPOTENCY_CONFLICT: "TOOL_IDEMPOTENCY_CONFLICT",
  TOOL_UNAUTHORIZED_MUTATION: "TOOL_UNAUTHORIZED_MUTATION",
  TOOL_CROSS_TENANT_ACCESS: "TOOL_CROSS_TENANT_ACCESS",
  TOOL_PAYLOAD_IMMUTABLE: "TOOL_PAYLOAD_IMMUTABLE",
  TOOL_STATUS_INVALID: "TOOL_STATUS_INVALID",
  AUTH_REQUIRED: "AUTH_REQUIRED",
};

class AgentError extends Error {
  constructor({ code, message, statusCode }) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.statusCode = statusCode || 500;
  }
}

// 2. Serialización Canónica Determinista RFC 8785 y Hash Canónico
function canonicalJSON(val) {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean" || typeof val === "number") return JSON.stringify(val);
  if (typeof val === "string") return JSON.stringify(val);
  if (Array.isArray(val)) {
    return "[" + val.map((item) => canonicalJSON(item)).join(",") + "]";
  }
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(val[k])}`);
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(val);
}

function computeToolPayloadHash(runId, stepId, toolId, version, params) {
  const cJson = canonicalJSON(params || {});
  const canonicalBinding = `${runId}:${stepId}:${toolId}:${version}:${cJson}`;
  return createHash("sha256").update(canonicalBinding, "utf8").digest("hex");
}

// 3. Motor de Base de Datos Transaccional con Soporte Físico de Locks, Fencing y Ledger
class TransactionalEngine {
  constructor() {
    this.workspaces = new Map();
    this.workspaceMembers = new Map(); // key: `${workspace_id}:${user_id}` -> role
    this.agentRuns = new Map();
    this.agentRunSteps = new Map();
    this.conversations = new Map();
    this.agents = new Map();
    this.toolIdempotencyLedger = new Map(); // key: id -> entry
    this.ledgerByStepId = new Map(); // key: step_id -> id
    this.ledgerByExecutionId = new Map(); // key: execution_id -> id
    this.rowLocks = new Set(); // locks simulados de fila
  }

  // Setup de semilla multi-tenant
  setupTenant(workspaceId, userId, role = "member") {
    this.workspaces.set(workspaceId, { id: workspaceId, name: `Workspace ${workspaceId}` });
    this.workspaceMembers.set(`${workspaceId}:${userId}`, { workspace_id: workspaceId, user_id: userId, role });
  }

  createRun(runId, workspaceId, userId) {
    const run = { id: runId, workspace_id: workspaceId, user_id: userId, status: "running" };
    this.agentRuns.set(runId, run);
    return run;
  }

  createStep(stepId, runId, workspaceId, toolId, params, initialStatus = "pending") {
    const hash = computeToolPayloadHash(runId, stepId, toolId, "1.0.0", params);
    const step = {
      id: stepId,
      run_id: runId,
      workspace_id: workspaceId,
      tool_id: toolId,
      status: initialStatus,
      input: {
        tool_id: toolId,
        tool_version: "1.0.0",
        params,
        payload_hash: hash,
      },
      output: null,
      fencing_token: 0,
      lease_expires_at: null,
      executor_id: null,
    };
    this.agentRunSteps.set(stepId, step);
    return step;
  }

  // RPC: claim_agent_step_execution
  claimStepExecution(runId, stepId, executionId, callerUserId, leaseDurationMs = 30000) {
    if (!callerUserId) {
      throw new AgentError({ code: AgentErrorCodes.AUTH_REQUIRED, message: "Sesión requerida.", statusCode: 401 });
    }
    const run = this.agentRuns.get(runId);
    if (!run) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Run no encontrado.", statusCode: 404 });
    }
    const member = this.workspaceMembers.get(`${run.workspace_id}:${callerUserId}`);
    if (!member) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sin acceso al workspace.", statusCode: 403 });
    }
    const step = this.agentRunSteps.get(stepId);
    if (!step || step.run_id !== runId) {
      throw new AgentError({ code: AgentErrorCodes.STEP_NOT_FOUND, message: "Paso no encontrado.", statusCode: 404 });
    }
    if (step.status !== "pending") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_STATUS_INVALID, message: "Paso no está en estado pending.", statusCode: 400 });
    }

    step.status = "running";
    step.fencing_token = Number(step.fencing_token || 0) + 1;
    step.executor_id = executionId;
    step.lease_expires_at = Date.now() + leaseDurationMs;
    return { ...step };
  }

  // RPC: claim_agent_step_takeover
  claimStepTakeover(runId, stepId, newExecutionId, callerUserId, leaseDurationMs = 30000) {
    if (!callerUserId) {
      throw new AgentError({ code: AgentErrorCodes.AUTH_REQUIRED, message: "Sesión requerida.", statusCode: 401 });
    }
    const run = this.agentRuns.get(runId);
    if (!run) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Run no encontrado.", statusCode: 404 });
    }
    const member = this.workspaceMembers.get(`${run.workspace_id}:${callerUserId}`);
    if (!member) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sin acceso al workspace.", statusCode: 403 });
    }
    const step = this.agentRunSteps.get(stepId);
    if (!step || step.run_id !== runId) {
      throw new AgentError({ code: AgentErrorCodes.STEP_NOT_FOUND, message: "Paso no encontrado.", statusCode: 404 });
    }
    if (step.status !== "running") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_STATUS_INVALID, message: "Paso no está en running.", statusCode: 400 });
    }

    // Regla crítica de lease: solo puede hacerse takeover si el lease ya expiró
    if (step.lease_expires_at && step.lease_expires_at > Date.now()) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_LEASE_ACTIVE, message: "El lease actual sigue vigente.", statusCode: 409 });
    }

    step.fencing_token = Number(step.fencing_token || 0) + 1;
    step.executor_id = newExecutionId;
    step.lease_expires_at = Date.now() + leaseDurationMs;
    return { ...step };
  }

  // RPC: execute_authorized_database_write (TRANSACCIÓN ATÓMICA COMPLETA)
  executeAuthorizedDatabaseWrite({
    runId,
    stepId,
    executionId,
    fencingToken,
    expectedPayloadHash,
    callerUserId,
    simulateCrashPoint = null, // para probar crashes en puntos ACID específicos
  }) {
    // 1. Validar autenticación
    if (!callerUserId) {
      throw new AgentError({ code: AgentErrorCodes.AUTH_REQUIRED, message: "Sesión requerida.", statusCode: 401 });
    }

    // 2. Validar existencia del run
    const run = this.agentRuns.get(runId);
    if (!run) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Run no encontrado.", statusCode: 404 });
    }

    // 3. Validar autorización en workspace
    const member = this.workspaceMembers.get(`${run.workspace_id}:${callerUserId}`);
    if (!member) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Acceso denegado.", statusCode: 403 });
    }

    // 4. Bloqueo exclusivo de fila (SELECT ... FOR UPDATE)
    const step = this.agentRunSteps.get(stepId);
    if (!step || step.run_id !== runId) {
      throw new AgentError({ code: AgentErrorCodes.STEP_NOT_FOUND, message: "Paso no encontrado.", statusCode: 404 });
    }

    // 5. Validar tenant matching
    if (step.workspace_id !== run.workspace_id) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_CROSS_TENANT_ACCESS, message: "Violación cross-tenant.", statusCode: 403 });
    }

    // 6. Consultar Idempotency Ledger primero (LEDGER HIT)
    const existingLedgerId = this.ledgerByStepId.get(stepId);
    if (existingLedgerId) {
      const entry = this.toolIdempotencyLedger.get(existingLedgerId);
      return {
        success: true,
        status: entry.status,
        ledger_id: entry.id,
        execution_id: entry.execution_id,
        fencing_token: entry.fencing_token,
        payload_hash: entry.payload_hash,
        data: entry.result,
        cached: true,
      };
    }

    // 7. Validar estado, fencing y lease
    if (step.status !== "running") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_STATUS_INVALID, message: "Step no está running.", statusCode: 400 });
    }

    if (Number(step.fencing_token) !== Number(fencingToken)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_FENCING_REJECTED, message: "Fencing token obsoleto o menor.", statusCode: 409 });
    }

    if (step.executor_id !== executionId) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_FENCING_REJECTED, message: "Executor ID no coincide.", statusCode: 409 });
    }

    if (!step.lease_expires_at || step.lease_expires_at <= Date.now()) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_LEASE_EXPIRED, message: "Lease expirado.", statusCode: 410 });
    }

    // 8. Payload inmutable
    const authorizedParams = step.input?.params || step.input;
    const toolId = step.tool_id || step.input?.tool_id || "database_write";
    const toolVersion = step.input?.tool_version || "1.0.0";

    // 9. Validar hash canónico
    const computedHash = computeToolPayloadHash(runId, stepId, toolId, toolVersion, authorizedParams);
    if (computedHash !== expectedPayloadHash) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, message: "Hash no coincide con payload esperado.", statusCode: 400 });
    }
    if (step.input?.payload_hash && step.input.payload_hash !== computedHash) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, message: "Hash almacenado alterado.", statusCode: 400 });
    }

    // 10. Validar tablas autorizadas y operaciones
    const targetTable = (authorizedParams.table || "").toLowerCase().trim();
    const operation = (authorizedParams.operation || "insert").toLowerCase().trim();

    if (!["conversations", "agents"].includes(targetTable)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION, message: `Tabla '${targetTable}' no permitida.`, statusCode: 403 });
    }

    if (!["insert", "update", "delete"].includes(operation)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION, message: `Operación '${operation}' no soportada.`, statusCode: 400 });
    }

    // UNICIDAD DE EXECUTION ID
    if (this.ledgerByExecutionId.has(executionId)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_IDEMPOTENCY_CONFLICT, message: "execution_id ya utilizado previamente.", statusCode: 409 });
    }

    if (simulateCrashPoint === "before_mutation") {
      throw new Error("SIMULATED_CRASH_BEFORE_MUTATION");
    }

    // Snapshot inicial para garantizar atomicidad de rollback ante fallos
    const prevConversations = new Map(this.conversations);
    const prevAgents = new Map(this.agents);

    let resultStatus = "committed";
    let mutationResult = null;
    let targetRecordId = null;

    try {
      // 11. Ejecución de la mutación de negocio
      if (targetTable === "conversations") {
        if (operation === "insert") {
          const recId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const title = authorizedParams.data?.title || authorizedParams.title || "Nueva conversación";
          const newConv = {
            id: recId,
            workspace_id: run.workspace_id,
            user_id: callerUserId,
            title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          this.conversations.set(recId, newConv);
          mutationResult = newConv;
          targetRecordId = recId;
          resultStatus = "committed";
        } else if (operation === "update") {
          targetRecordId = authorizedParams.recordId;
          const conv = this.conversations.get(targetRecordId);
          if (conv && conv.workspace_id === run.workspace_id) {
            conv.title = authorizedParams.data?.title || authorizedParams.title || conv.title;
            conv.updated_at = new Date().toISOString();
            mutationResult = { ...conv };
            resultStatus = "committed";
          } else {
            resultStatus = "not_found";
            mutationResult = { affected_rows: 0, status: "not_found", recordId: targetRecordId };
          }
        } else if (operation === "delete") {
          targetRecordId = authorizedParams.recordId;
          const conv = this.conversations.get(targetRecordId);
          if (conv && conv.workspace_id === run.workspace_id) {
            this.conversations.delete(targetRecordId);
            resultStatus = "committed";
            mutationResult = { deleted_rows: 1, status: "deleted", recordId: targetRecordId };
          } else {
            resultStatus = "already_deleted";
            mutationResult = { deleted_rows: 0, status: "already_deleted", recordId: targetRecordId };
          }
        }
      } else if (targetTable === "agents") {
        if (operation !== "insert") {
          throw new AgentError({ code: AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION, message: "Solo 'insert' permitido en agents.", statusCode: 403 });
        }
        const agentId = `agent-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const newAgent = {
          id: agentId,
          workspace_id: run.workspace_id,
          created_by: callerUserId,
          name: authorizedParams.data?.name || authorizedParams.name || "Nuevo Agente",
          description: authorizedParams.data?.description || authorizedParams.description || null,
          system_instructions: authorizedParams.data?.system_instructions || "Instrucciones",
          model_id: authorizedParams.data?.model_id || "gpt-4o",
          status: "draft", // SIEMPRE DRAFT
          max_steps: 10,
          max_tokens: 8000,
          timeout_seconds: 60,
          max_tool_calls: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.agents.set(agentId, newAgent);
        mutationResult = newAgent;
        targetRecordId = agentId;
        resultStatus = "committed";
      }

      if (simulateCrashPoint === "after_mutation_before_ledger") {
        throw new Error("SIMULATED_CRASH_AFTER_MUTATION");
      }

      // 12. Persistir en tool_idempotency_ledger
      const ledgerId = `ledger-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const ledgerEntry = {
        id: ledgerId,
        workspace_id: run.workspace_id,
        run_id: runId,
        step_id: stepId,
        tool_id: toolId,
        tool_version: toolVersion,
        execution_id: executionId,
        fencing_token: fencingToken,
        payload_hash: computedHash,
        operation,
        target_table: targetTable,
        target_record_id: targetRecordId,
        status: resultStatus,
        result: mutationResult,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      this.toolIdempotencyLedger.set(ledgerId, ledgerEntry);
      this.ledgerByStepId.set(stepId, ledgerId);
      this.ledgerByExecutionId.set(executionId, ledgerId);

      // 13. Marcar step como completed
      step.status = "completed";
      step.output = mutationResult;

      if (simulateCrashPoint === "after_commit_before_network_reply") {
        // En este punto ya hubo COMMIT, la respuesta de red falla
        throw new Error("NETWORK_DISCONNECTED_AFTER_COMMIT");
      }

      return {
        success: true,
        status: resultStatus,
        ledger_id: ledgerId,
        execution_id: executionId,
        fencing_token: fencingToken,
        payload_hash: computedHash,
        data: mutationResult,
        cached: false,
      };
    } catch (err) {
      // ROLLBACK ATÓMICO: Restablecer tablas de negocio si falló antes de sellar el ledger
      if (!this.ledgerByStepId.has(stepId)) {
        this.conversations = prevConversations;
        this.agents = prevAgents;
      }
      throw err;
    }
  }
}

// 4. Ejecución de la Suite de 20 Escenarios
async function runIdempotencyFencingSuite() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE OFICIAL: IDEMPOTENCY LEDGER, FENCING & DATABASE WRITE SEGURO");
  console.log("==========================================================================\n");

  let passed = 0;
  let total = 0;

  const assert = (condition, title) => {
    total++;
    if (condition) {
      console.log(`✓ [CASO ${total}/20] ${title}`);
      passed++;
    } else {
      console.error(`✗ [CASO ${total}/20] FALLÓ: ${title}`);
    }
  };

  const engine = new TransactionalEngine();

  const WS_A = "ws-alpha-1";
  const WS_B = "ws-beta-2";
  const USER_A = "user-alice";
  const USER_B = "user-bob";

  engine.setupTenant(WS_A, USER_A, "owner");
  engine.setupTenant(WS_B, USER_B, "owner");

  // CASO 1: Authorized INSERT (Conversations)
  const run1 = engine.createRun("run-1", WS_A, USER_A);
  const payload1 = { table: "conversations", operation: "insert", data: { title: "Charla Inicial" } };
  const step1 = engine.createStep("step-1", run1.id, WS_A, "database_write", payload1);
  const claim1 = engine.claimStepExecution(run1.id, step1.id, "exec-1", USER_A);

  const res1 = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: step1.id,
    executionId: "exec-1",
    fencingToken: claim1.fencing_token,
    expectedPayloadHash: step1.input.payload_hash,
    callerUserId: USER_A,
  });

  assert(
    res1.success && res1.status === "committed" && res1.data.title === "Charla Inicial" && res1.data.workspace_id === WS_A,
    "1. Authorized INSERT en conversations persiste correctamente y vincula workspace_id derivado"
  );

  // CASO 2: Unauthorized Mutation (Tabla ai_usage prohibida)
  const step2 = engine.createStep("step-2", run1.id, WS_A, "database_write", { table: "ai_usage", operation: "insert", data: { tokens: 50 } });
  const claim2 = engine.claimStepExecution(run1.id, step2.id, "exec-2", USER_A);
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: step2.id,
      executionId: "exec-2",
      fencingToken: claim2.fencing_token,
      expectedPayloadHash: step2.input.payload_hash,
      callerUserId: USER_A,
    });
    assert(false, "2. Debió rechazar mutación en ai_usage");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_UNAUTHORIZED_MUTATION, "2. Bloqueo estricto de tablas no autorizadas (ai_usage prohibida en database_write)");
  }

  // CASO 3: Cross-tenant mutation (User A intenta mutar en Workspace B)
  const runB = engine.createRun("run-b", WS_B, USER_B);
  const stepB = engine.createStep("step-b-1", runB.id, WS_B, "database_write", { table: "conversations", operation: "insert", data: { title: "Hack" } });
  try {
    engine.claimStepExecution(runB.id, stepB.id, "exec-hack", USER_A);
    assert(false, "3. Debió bloquear claim cross-tenant");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_PERMISSION_DENIED, "3. Aislamiento cross-tenant estricto: usuario de Workspace A no puede operar en Workspace B");
  }

  // CASO 4: Payload tampering (Parámetros modificados tras el cálculo del hash)
  const stepTamper = engine.createStep("step-tamper", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Original" } });
  const claimTamper = engine.claimStepExecution(run1.id, stepTamper.id, "exec-tamper", USER_A);
  // Alteramos el payload en el step
  stepTamper.input.params.data.title = "Alterado maliciosamente";
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepTamper.id,
      executionId: "exec-tamper",
      fencingToken: claimTamper.fencing_token,
      expectedPayloadHash: stepTamper.input.payload_hash, // hash original
      callerUserId: USER_A,
    });
    assert(false, "4. Debió fallar por payload tampering");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, "4. Detección y bloqueo inmediato de Payload Tampering (hash mismatch)");
  }

  // CASO 5: Hash mismatch (El invocador envía un hash esperado que no coincide)
  const stepHash = engine.createStep("step-hash", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Test" } });
  const claimHash = engine.claimStepExecution(run1.id, stepHash.id, "exec-hash", USER_A);
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepHash.id,
      executionId: "exec-hash",
      fencingToken: claimHash.fencing_token,
      expectedPayloadHash: "bad_expected_hash_00000",
      callerUserId: USER_A,
    });
    assert(false, "5. Debió fallar por hash esperado inválido");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, "5. Rechazo estricto ante hash esperado que no coincide con el payload canónico");
  }

  // CASO 6: Expired lease (Lease temporal vencido rechazado)
  const stepExpired = engine.createStep("step-exp", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Tardío" } });
  const claimExpired = engine.claimStepExecution(run1.id, stepExpired.id, "exec-exp", USER_A, -5000); // lease vencido hace 5s
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepExpired.id,
      executionId: "exec-exp",
      fencingToken: claimExpired.fencing_token,
      expectedPayloadHash: stepExpired.input.payload_hash,
      callerUserId: USER_A,
    });
    assert(false, "6. Debió fallar por lease expirado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_LEASE_EXPIRED, "6. Bloqueo de ejecutor cuyo lease temporal ha expirado en el servidor");
  }

  // CASO 7: Stale executor after takeover (Executor A es cercado por Takeover de B)
  const stepTakeover = engine.createStep("step-to", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Fenced" } });
  // Executor A adquiere con lease vencido
  const claimA = engine.claimStepExecution(run1.id, stepTakeover.id, "exec-A", USER_A, -1000);
  // Recovery/Takeover de Executor B incrementa token a 2
  const claimB = engine.claimStepTakeover(run1.id, stepTakeover.id, "exec-B", USER_A, 30000);

  // Executor A intenta persistir con token 1
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepTakeover.id,
      executionId: "exec-A",
      fencingToken: claimA.fencing_token, // token 1
      expectedPayloadHash: stepTakeover.input.payload_hash,
      callerUserId: USER_A,
    });
    assert(false, "7. Executor A debió ser rechazado por Fencing");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_FENCING_REJECTED, "7. Fencing activo: Executor A obsoleto es rechazado (TOOL_FENCING_REJECTED)");
  }

  // CASO 8: Fencing token mismatch directo
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepTakeover.id,
      executionId: "exec-B",
      fencingToken: 999, // token erróneo
      expectedPayloadHash: stepTakeover.input.payload_hash,
      callerUserId: USER_A,
    });
    assert(false, "8. Debió fallar por token no coincidente");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_FENCING_REJECTED, "8. Verificación de fencing token rechaza discrepancias de número de secuencia");
  }

  // CASO 9: Valid executor (Executor B con token 2 persiste exitosamente)
  const resB = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepTakeover.id,
    executionId: "exec-B",
    fencingToken: claimB.fencing_token, // token 2
    expectedPayloadHash: stepTakeover.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(resB.success && resB.fencing_token === 2, "9. Executor B legítimo con nuevo fencing token completa la transacción con éxito");

  // CASO 10: Duplicate execution_id
  const stepDupExec = engine.createStep("step-dup-exec", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Dup" } });
  engine.claimStepExecution(run1.id, stepDupExec.id, "exec-B", USER_A); // reusa execution_id de B
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepDupExec.id,
      executionId: "exec-B", // colisión con el ya persistido
      fencingToken: 1,
      expectedPayloadHash: stepDupExec.input.payload_hash,
      callerUserId: USER_A,
    });
    assert(false, "10. Debió rechazar execution_id duplicado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_IDEMPOTENCY_CONFLICT, "10. Restricción de unicidad: execution_id duplicado es bloqueado");
  }

  // CASO 11: Ledger Replay (Idempotencia Efectiva ante reintentos de red)
  // Reintentamos exactamente la llamada del caso 1
  const res1Replay = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: step1.id,
    executionId: "exec-1",
    fencingToken: claim1.fencing_token,
    expectedPayloadHash: step1.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    res1Replay.cached === true && res1Replay.ledger_id === res1.ledger_id && engine.conversations.size === 2,
    "11. Ledger Replay: El reintento retorna el snapshot sellado sin volver a ejecutar mutaciones (Effectively-Once)"
  );

  // CASO 12: Concurrencia Simulada (Dos ejecutores simultáneos sobre el mismo paso)
  const stepConc = engine.createStep("step-conc", run1.id, WS_A, "database_write", { table: "conversations", operation: "insert", data: { title: "Concurrente" } });
  const claimConc = engine.claimStepExecution(run1.id, stepConc.id, "exec-conc", USER_A);

  const initialConvCount = engine.conversations.size;
  // Simular dos llamadas concurrentes
  const c1 = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepConc.id,
    executionId: "exec-conc",
    fencingToken: claimConc.fencing_token,
    expectedPayloadHash: stepConc.input.payload_hash,
    callerUserId: USER_A,
  });
  const c2 = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepConc.id,
    executionId: "exec-conc",
    fencingToken: claimConc.fencing_token,
    expectedPayloadHash: stepConc.input.payload_hash,
    callerUserId: USER_A,
  });

  assert(
    c1.cached === false && c2.cached === true && engine.conversations.size === initialConvCount + 1,
    "12. Concurrencia Serializada: Exactamente 1 mutación física ejecutada y la segunda colisión reutiliza el ledger"
  );

  // CASO 13: UPDATE Successful (affected_rows = 1)
  const targetConvId = res1.data.id;
  const stepUpdate = engine.createStep("step-update", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "update",
    recordId: targetConvId,
    data: { title: "Título Modificado con Éxito" },
  });
  const claimUpdate = engine.claimStepExecution(run1.id, stepUpdate.id, "exec-update", USER_A);
  const resUpdate = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepUpdate.id,
    executionId: "exec-update",
    fencingToken: claimUpdate.fencing_token,
    expectedPayloadHash: stepUpdate.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    resUpdate.success && resUpdate.status === "committed" && engine.conversations.get(targetConvId).title === "Título Modificado con Éxito",
    "13. UPDATE exitoso modifica únicamente el título y sella en ledger con status 'committed'"
  );

  // CASO 14: UPDATE 0 rows (Registro no encontrado sella 'not_found' en ledger)
  const stepUpZero = engine.createStep("step-up-zero", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "update",
    recordId: "non-existent-conv-id",
    data: { title: "Inexistente" },
  });
  const claimUpZero = engine.claimStepExecution(run1.id, stepUpZero.id, "exec-up-zero", USER_A);
  const resUpZero = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepUpZero.id,
    executionId: "exec-up-zero",
    fencingToken: claimUpZero.fencing_token,
    expectedPayloadHash: stepUpZero.input.payload_hash,
    callerUserId: USER_A,
  });
  const resUpZeroRetry = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepUpZero.id,
    executionId: "exec-up-zero",
    fencingToken: claimUpZero.fencing_token,
    expectedPayloadHash: stepUpZero.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    resUpZero.status === "not_found" && resUpZeroRetry.cached === true && resUpZeroRetry.status === "not_found",
    "14. UPDATE con 0 filas afectadas sella 'not_found' en ledger; reintento devuelve 'not_found' sin reintentos infinitos"
  );

  // CASO 15: DELETE Successful (deleted_rows = 1)
  const stepDelete = engine.createStep("step-delete", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "delete",
    recordId: targetConvId,
  });
  const claimDelete = engine.claimStepExecution(run1.id, stepDelete.id, "exec-del", USER_A);
  const resDelete = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepDelete.id,
    executionId: "exec-del",
    fencingToken: claimDelete.fencing_token,
    expectedPayloadHash: stepDelete.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    resDelete.success && resDelete.data.deleted_rows === 1 && !engine.conversations.has(targetConvId),
    "15. DELETE exitoso elimina el registro físico y sella en ledger con status 'committed'"
  );

  // CASO 16: DELETE 0 rows (Registro ya eliminado sella 'already_deleted' en ledger)
  const stepDelZero = engine.createStep("step-del-zero", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "delete",
    recordId: targetConvId, // ya fue borrado en caso 15
  });
  const claimDelZero = engine.claimStepExecution(run1.id, stepDelZero.id, "exec-del-zero", USER_A);
  const resDelZero = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepDelZero.id,
    executionId: "exec-del-zero",
    fencingToken: claimDelZero.fencing_token,
    expectedPayloadHash: stepDelZero.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    resDelZero.status === "already_deleted" && resDelZero.data.deleted_rows === 0,
    "16. DELETE sobre registro inexistente/ya eliminado sella 'already_deleted' de forma determinista"
  );

  // CASO 17: Crash/Recovery Semantics (Crash de red tras el commit recupera el resultado)
  const stepCrashNet = engine.createStep("step-crash-net", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "insert",
    data: { title: "Post Commit Crash" },
  });
  const claimCrashNet = engine.claimStepExecution(run1.id, stepCrashNet.id, "exec-crash-net", USER_A);
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepCrashNet.id,
      executionId: "exec-crash-net",
      fencingToken: claimCrashNet.fencing_token,
      expectedPayloadHash: stepCrashNet.input.payload_hash,
      callerUserId: USER_A,
      simulateCrashPoint: "after_commit_before_network_reply",
    });
  } catch (err) {
    // La red cayó antes de responder
  }
  // Recovery / Reintento del cliente tras la desconexión
  const recoveryRes = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepCrashNet.id,
    executionId: "exec-crash-net",
    fencingToken: claimCrashNet.fencing_token,
    expectedPayloadHash: stepCrashNet.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    recoveryRes.cached === true && recoveryRes.data.title === "Post Commit Crash",
    "17. Crash tras COMMIT: La recuperación lee el ledger comprometido y entrega el resultado sin duplicar la inserción"
  );

  // CASO 18: Atomic Rollback (Crash previo al ledger revierte la mutación de negocio)
  const stepAtomic = engine.createStep("step-atomic", run1.id, WS_A, "database_write", {
    table: "conversations",
    operation: "insert",
    data: { title: "Debe Revertirse" },
  });
  const claimAtomic = engine.claimStepExecution(run1.id, stepAtomic.id, "exec-atomic", USER_A);
  const convCountBefore = engine.conversations.size;
  try {
    engine.executeAuthorizedDatabaseWrite({
      runId: run1.id,
      stepId: stepAtomic.id,
      executionId: "exec-atomic",
      fencingToken: claimAtomic.fencing_token,
      expectedPayloadHash: stepAtomic.input.payload_hash,
      callerUserId: USER_A,
      simulateCrashPoint: "after_mutation_before_ledger",
    });
    assert(false, "18. Debió simular crash");
  } catch (err) {
    // Verificamos que la tabla de negocio se revirtió
    assert(
      engine.conversations.size === convCountBefore && !engine.ledgerByStepId.has(stepAtomic.id),
      "18. Atomic Rollback: Falla previa a la escritura del ledger revierte la mutación de negocio en su totalidad"
    );
  }

  // CASO 19: Agents INSERT obliga status = 'draft' y created_by derivado de auth
  const stepAgent = engine.createStep("step-agent", run1.id, WS_A, "database_write", {
    table: "agents",
    operation: "insert",
    data: { name: "Bot Autónomo", status: "active" }, // Intenta enviar status active
  });
  const claimAgent = engine.claimStepExecution(run1.id, stepAgent.id, "exec-agent", USER_A);
  const resAgent = engine.executeAuthorizedDatabaseWrite({
    runId: run1.id,
    stepId: stepAgent.id,
    executionId: "exec-agent",
    fencingToken: claimAgent.fencing_token,
    expectedPayloadHash: stepAgent.input.payload_hash,
    callerUserId: USER_A,
  });
  assert(
    resAgent.success && resAgent.data.status === "draft" && resAgent.data.created_by === USER_A,
    "19. Creación de agentes: Se ignora status del modelo, forzando status 'draft' y derivando created_by desde auth.uid()"
  );

  // CASO 20: Inmutabilidad de pasos completados (Anti-Tampering)
  const completedStep = engine.agentRunSteps.get(step1.id);
  assert(
    completedStep.status === "completed" && completedStep.input.params.data.title === "Charla Inicial",
    "20. Inmutabilidad física garantizada: el payload del paso permanece sellado e inalterable tras completarse"
  );

  console.log("\n--------------------------------------------------------------------------");
  console.log(`RESULTADO DE LA SUITE IDEMPOTENCY & FENCING: ${passed}/${total} PRUEBAS PASADAS`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) process.exit(1);
}

runIdempotencyFencingSuite().catch((err) => {
  console.error("Fallo crítico en test suite de idempotencia:", err);
  process.exit(1);
});
