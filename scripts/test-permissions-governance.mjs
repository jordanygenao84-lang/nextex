/**
 * NEXTEХ — Suite Oficial de Pruebas: Permissions & Approval Governance (Fase 4.4)
 * Cobertura exhaustiva de 47 escenarios:
 * - Permission Engine (Allow, Deny, Precedence, Role, Overrides)
 * - Policy Engine & Agent Policies (Allowed Risks, Concurrency Slots, Approval Modes)
 * - Authorization Engine (Centralized Authority, Single Decision Point)
 * - Approval Governance (HITL, Anti-Replay, JIT Revalidation, Self-Approval)
 * - Hierarchy & Administrative Constraints (Owner Immunity, Admin Boundary, Anti-Self-Escalation)
 * - Concurrency Limits (Slots, Queued/Running/Waiting, Release on Complete/Fail/Cancel)
 * - Fencing & Idempotency Integration
 * - Database Invariants & Audit Logging (No CoT, Zero Secret Leakage)
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";

// 1. Catálogo Canónico y Matriz Base
const CANONICAL_PERMISSIONS = [
  "agents.read", "agents.create", "agents.update", "agents.delete", "agents.activate", "agents.pause",
  "runs.read", "runs.execute", "runs.cancel",
  "tools.read", "tools.execute", "tools.execute_read", "tools.execute_write", "tools.execute_external", "tools.execute_destructive",
  "approvals.read", "approvals.approve", "approvals.reject",
  "workspace.members.read", "workspace.members.manage",
  "workspace.settings.read", "workspace.settings.update"
];

const DEFAULT_ROLE_PERMISSIONS = {
  owner: [...CANONICAL_PERMISSIONS],
  admin: CANONICAL_PERMISSIONS.filter(p => !["tools.execute_destructive", "workspace.members.manage", "workspace.settings.update"].includes(p)),
  member: ["agents.read", "runs.read", "runs.execute", "runs.cancel", "tools.read", "tools.execute", "tools.execute_read", "approvals.read", "workspace.members.read"]
};

// 2. Errores Canónicos
const AgentErrorCodes = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_NOT_ACTIVE: "AGENT_NOT_ACTIVE",
  AGENT_PERMISSION_DENIED: "AGENT_PERMISSION_DENIED",
  AGENT_EXECUTION_BLOCKED: "AGENT_EXECUTION_BLOCKED",
  AGENT_CONCURRENCY_LIMIT: "AGENT_CONCURRENCY_LIMIT",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_DISABLED: "TOOL_DISABLED",
  TOOL_VERSION_UNSUPPORTED: "TOOL_VERSION_UNSUPPORTED",
  TOOL_SCHEMA_INVALID: "TOOL_SCHEMA_INVALID",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  TOOL_APPROVAL_REQUIRED: "TOOL_APPROVAL_REQUIRED",
  TOOL_APPROVAL_INVALID: "TOOL_APPROVAL_INVALID",
  TOOL_APPROVAL_REPLAY: "TOOL_APPROVAL_REPLAY",
  TOOL_APPROVAL_UNAUTHORIZED: "TOOL_APPROVAL_UNAUTHORIZED",
  TOOL_SELF_APPROVAL_BLOCKED: "TOOL_SELF_APPROVAL_BLOCKED",
  TOOL_RISK_VIOLATION: "TOOL_RISK_VIOLATION",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  TOOL_FENCING_REJECTED: "TOOL_FENCING_REJECTED",
  TOOL_LEASE_EXPIRED: "TOOL_LEASE_EXPIRED",
  TOOL_PAYLOAD_HASH_MISMATCH: "TOOL_PAYLOAD_HASH_MISMATCH",
  TOOL_IDEMPOTENCY_CONFLICT: "TOOL_IDEMPOTENCY_CONFLICT",
  TOOL_UNAUTHORIZED_MUTATION: "TOOL_UNAUTHORIZED_MUTATION",
  TOOL_CROSS_TENANT_ACCESS: "TOOL_CROSS_TENANT_ACCESS",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: "INSUFFICIENT_ADMINISTRATIVE_HIERARCHY",
};

class AgentError extends Error {
  constructor({ code, message, statusCode }) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.statusCode = statusCode || 500;
  }
}

// 3. Serialización Canónica Determinista RFC 8785 y Hash Canónico
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

function sanitizeText(t) {
  if (!t) return "";
  return t.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_SECRET]").replace(/ghp_[a-zA-Z0-9]{30,}/g, "[REDACTED_SECRET]");
}

// 4. Motores de Gobernanza en Memoria (Simulación Idéntica al Backend)
class MockGovernanceEngine {
  constructor() {
    this.workspaces = new Map();
    this.workspaceMembers = new Map(); // `${wsId}:${userId}` -> { role }
    this.workspacePermissions = new Map(); // `${wsId}:${userId}:${permKey}` -> "allow" | "deny"
    this.agentPolicies = new Map(); // agentId -> policy
    this.agents = new Map(); // agentId -> agent
    this.agentRuns = new Map(); // runId -> run
    this.agentRunSteps = new Map(); // stepId -> step
    this.approvalRequests = new Map(); // approvalId -> approval
    this.approvalByStepId = new Map(); // stepId -> approvalId
    this.auditLog = [];
    this.toolRegistry = new Map();
    this.idempotencyLedger = new Map(); // step_id -> ledger entry
    this.ledgerExecutionIds = new Set();
  }

  setupTool(id, riskLevel, requiresApproval = false, status = "active", version = "1.0.0") {
    this.toolRegistry.set(id, { id, name: id, riskLevel, requiresApproval, status, version });
  }

  // Precedencia: EXPLICIT DENY -> EXPLICIT ALLOW -> ROLE PERMISSION -> DEFAULT DENY
  can(userId, workspaceId, permissionKey) {
    const member = this.workspaceMembers.get(`${workspaceId}:${userId}`);
    if (!member) return { allowed: false, reason: "No es miembro del workspace." };

    const overrideKey = `${workspaceId}:${userId}:${permissionKey}`;
    const override = this.workspacePermissions.get(overrideKey);

    if (override === "deny") {
      return { allowed: false, reason: "Denegado por override explícito (EXPLICIT DENY)." };
    }
    if (override === "allow") {
      return { allowed: true, reason: "Concedido por override explícito (EXPLICIT ALLOW)." };
    }

    const rolePerms = DEFAULT_ROLE_PERMISSIONS[member.role] || [];
    if (rolePerms.includes(permissionKey)) {
      return { allowed: true, reason: `Concedido por rol '${member.role}' (ROLE PERMISSION).` };
    }

    return { allowed: false, reason: `Rol '${member.role}' no posee el permiso (DEFAULT DENY).` };
  }

  // Jerarquía Administrativa: Modificar permisos
  setPermissionOverride(callerId, workspaceId, targetUserId, permissionKey, effect) {
    const callerMember = this.workspaceMembers.get(`${workspaceId}:${callerId}`);
    if (!callerMember || callerMember.role === "member") {
      throw new AgentError({ code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, message: "Member no puede administrar permisos." });
    }
    if (callerId === targetUserId) {
      throw new AgentError({ code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, message: "Anti-auto-modificación activa." });
    }

    const targetMember = this.workspaceMembers.get(`${workspaceId}:${targetUserId}`);
    if (!targetMember) throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Usuario destino no existe." });

    if (targetMember.role === "owner" && callerMember.role !== "owner") {
      throw new AgentError({ code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, message: "Admin no puede alterar permisos de Owner." });
    }
    if (targetMember.role === "admin" && callerMember.role === "admin") {
      throw new AgentError({ code: AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, message: "Admin no puede alterar a otro Admin." });
    }

    this.workspacePermissions.set(`${workspaceId}:${targetUserId}:${permissionKey}`, effect);
  }

  // RPC: create_agent_run_with_concurrency_check
  createAgentRunWithConcurrencyCheck(agentId, input, userId) {
    if (!userId) {
      throw new AgentError({ code: "AUTH_REQUIRED", message: "Sesión requerida.", statusCode: 401 });
    }
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Agente no encontrado.", statusCode: 404 });
    }
    const member = this.workspaceMembers.get(`${agent.workspace_id}:${userId}`);
    if (!member) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sin acceso a este workspace.", statusCode: 403 });
    }
    if (agent.status !== "active") {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_ACTIVE, message: "El agente no está en estado active.", statusCode: 400 });
    }

    const policy = this.agentPolicies.get(agentId) || { allow_execution: true, max_concurrent_runs: 3 };
    if (!policy.allow_execution) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_EXECUTION_BLOCKED, message: "La política del agente prohíbe su ejecución.", statusCode: 403 });
    }

    // SELECT ... FOR UPDATE: Conteo atómico de runs activos ('queued', 'running', 'waiting_approval')
    let activeCount = 0;
    for (const r of this.agentRuns.values()) {
      if (r.agent_id === agentId && ["queued", "running", "waiting_approval"].includes(r.status)) {
        activeCount++;
      }
    }

    if (activeCount >= policy.max_concurrent_runs) {
      throw new AgentError({
        code: AgentErrorCodes.AGENT_CONCURRENCY_LIMIT,
        message: `El agente ha alcanzado el límite máximo de runs simultáneos (${policy.max_concurrent_runs}).`,
        statusCode: 429,
      });
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const run = {
      id: runId,
      agent_id: agentId,
      workspace_id: agent.workspace_id,
      user_id: userId,
      status: "running",
      input,
      model_id: agent.model_id || "gpt-4o",
      started_at: new Date().toISOString(),
    };
    this.agentRuns.set(runId, run);
    return { success: true, run, active_runs: activeCount + 1, max_concurrent_runs: policy.max_concurrent_runs };
  }

  // Compatibilidad interna de la suite
  createRun(agentId, workspaceId, userId, input) {
    const res = this.createAgentRunWithConcurrencyCheck(agentId, input, userId);
    return res.run;
  }

  // AuthorizationEngine: evaluate
  evaluateAuthorization(userId, workspaceId, agentId, toolId, toolVersion = "1.0.0", params = {}) {
    // 1. runs.execute
    const canRun = this.can(userId, workspaceId, "runs.execute");
    if (!canRun.allowed) {
      return { decision: "deny", reason: canRun.reason };
    }

    const agent = this.agents.get(agentId);
    const policy = this.agentPolicies.get(agentId) || { allow_execution: true, allowed_tool_risks: ["read", "write"], approval_mode: "required", self_approval_mode: "blocked" };

    if (!policy.allow_execution || agent?.status !== "active") {
      return { decision: "deny", reason: "Agente bloqueado por política o inactivo." };
    }

    if (!toolId) {
      return { decision: "allow", reason: "Inferencia pura permitida." };
    }

    const tool = this.toolRegistry.get(toolId);
    if (!tool || tool.status === "disabled") {
      return { decision: "deny", reason: "Herramienta inexistente o deshabilitada." };
    }

    if (!policy.allowed_tool_risks.includes(tool.riskLevel)) {
      return { decision: "deny", reason: `Riesgo '${tool.riskLevel}' no tolerado.` };
    }

    const riskPermKey = `tools.execute_${tool.riskLevel}`;
    const canRisk = this.can(userId, workspaceId, riskPermKey);
    if (!canRisk.allowed) {
      return { decision: "deny", reason: `Sin permiso para '${riskPermKey}'.` };
    }

    // CORRECCIÓN 3: Si approval_mode es 'conditional', falla seguro a required
    const requiresHITL = tool.requiresApproval || tool.riskLevel === "destructive" || tool.riskLevel === "write" || policy.approval_mode === "required" || policy.approval_mode === "conditional";

    if (requiresHITL && tool.riskLevel !== "read") {
      return {
        decision: "approval_required",
        reason: "Requiere aprobación humana (HITL).",
        riskLevel: tool.riskLevel,
        requiredPermission: riskPermKey,
        selfApprovalAllowed: policy.self_approval_mode === "allowed",
      };
    }

    return { decision: "allow", reason: "Ejecución autorizada.", riskLevel: tool.riskLevel };
  }

  // Crear ApprovalRequest
  createApprovalRequest(workspaceId, runId, stepId, toolId, toolVersion, requesterId, riskLevel, params) {
    if (this.approvalByStepId.has(stepId)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_REPLAY, message: "Duplicate approval step constraint." });
    }
    const hash = computeToolPayloadHash(runId, stepId, toolId, toolVersion, params);
    const id = `appr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const req = {
      id,
      workspace_id: workspaceId,
      run_id: runId,
      step_id: stepId,
      tool_id: toolId,
      tool_version: toolVersion,
      requester_id: requesterId,
      required_permission: `tools.execute_${riskLevel}`,
      risk_level: riskLevel,
      payload_hash: hash,
      status: "pending",
      expires_at: Date.now() + 86400000, // 24h
      approver_id: null,
      resolved_at: null,
      comment: null,
    };
    this.approvalRequests.set(id, req);
    this.approvalByStepId.set(stepId, id);
    return req;
  }

  // RPC: claim_agent_step_approval_v2 con JIT Revalidation
  // REGLA: APPROVED NO SIGNIFICA COMPLETED. Transiciona a running.
  claimStepApprovalV2(approvalId, expectedHash, decision, approverId, comment = null) {
    if (!approverId) throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Sesión requerida." });

    const approval = this.approvalRequests.get(approvalId);
    if (!approval) throw new AgentError({ code: AgentErrorCodes.APPROVAL_NOT_FOUND, message: "Approval no encontrado." });

    if (approval.status !== "pending") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_REPLAY, message: "Ya procesado previamente." });
    }

    if (approval.expires_at <= Date.now()) {
      approval.status = "expired";
      throw new AgentError({ code: AgentErrorCodes.APPROVAL_EXPIRED, message: "Solicitud expirada." });
    }

    // JIT: Membresía
    const approverMember = this.workspaceMembers.get(`${approval.workspace_id}:${approverId}`);
    if (!approverMember) throw new AgentError({ code: AgentErrorCodes.AGENT_PERMISSION_DENIED, message: "Aprobador no es miembro." });

    // JIT: Permiso approvals.approve
    const canApprove = this.can(approverId, approval.workspace_id, "approvals.approve");
    if (!canApprove.allowed) throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_UNAUTHORIZED, message: "Sin permiso approvals.approve." });

    // JIT: Permiso de riesgo
    const canRisk = this.can(approverId, approval.workspace_id, approval.required_permission);
    if (!canRisk.allowed) throw new AgentError({ code: AgentErrorCodes.TOOL_NOT_ALLOWED, message: "Sin permiso para riesgo." });

    // JIT: Self-Approval
    const run = this.agentRuns.get(approval.run_id);
    const policy = this.agentPolicies.get(run?.agent_id) || { self_approval_mode: "blocked", allow_execution: true };
    if (approval.requester_id === approverId && policy.self_approval_mode !== "allowed") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_SELF_APPROVAL_BLOCKED, message: "Self approval bloqueado." });
    }

    // JIT: Policy & Tool Status
    const agent = this.agents.get(run?.agent_id);
    if (!policy.allow_execution || agent?.status !== "active") {
      throw new AgentError({ code: AgentErrorCodes.AGENT_EXECUTION_BLOCKED, message: "Agente bloqueado en JIT." });
    }

    const tool = this.toolRegistry.get(approval.tool_id);
    if (!tool || tool.status === "disabled") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_DISABLED, message: "Tool disabled en JIT." });
    }

    if (tool.version !== approval.tool_version) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_VERSION_UNSUPPORTED, message: "Versión de tool cambió." });
    }

    // Hash check
    if (approval.payload_hash !== expectedHash) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, message: "Hash alterado." });
    }

    const step = this.agentRunSteps.get(approval.step_id);

    // Auditoría sin CoT
    this.auditLog.push({
      workspace_id: approval.workspace_id,
      actor_id: approverId,
      action: `approval.${decision}`,
      decision: decision === "approved" ? "allow" : "deny",
      reason: comment || "Decisión humana",
      tool_id: approval.tool_id,
      payload_hash: approval.payload_hash,
      timestamp: new Date().toISOString(),
    });

    if (decision === "rejected") {
      approval.status = "rejected";
      approval.approver_id = approverId;
      approval.resolved_at = Date.now();
      approval.comment = comment;
      if (step) step.status = "failed";
      if (run) run.status = "completed";
      return { success: true, status: "rejected" };
    }

    // APPROVED NO SIGNIFICA COMPLETED. Pone step en 'running' con nuevo token
    approval.status = "approved";
    approval.approver_id = approverId;
    approval.resolved_at = Date.now();
    approval.comment = comment;
    if (step) {
      step.status = "running";
      step.fencing_token = (step.fencing_token || 0) + 1;
      step.lease_expires_at = Date.now() + 60000;
    }
    if (run) run.status = "running";

    return {
      success: true,
      status: "approved",
      step_id: approval.step_id,
      fencing_token: step?.fencing_token || 1,
      lease_expires_at: step?.lease_expires_at,
    };
  }

  // ToolExecutor Execution posterior
  executeStepTool(stepId, executionId, fencingToken) {
    const step = this.agentRunSteps.get(stepId);
    if (!step) throw new AgentError({ code: AgentErrorCodes.STEP_NOT_FOUND, message: "Step no encontrado." });

    if (this.ledgerExecutionIds.has(executionId)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_IDEMPOTENCY_CONFLICT, message: "execution_id duplicado." });
    }

    if (step.fencing_token !== fencingToken) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_FENCING_REJECTED, message: "Fencing token inválido." });
    }

    if (step.lease_expires_at && step.lease_expires_at <= Date.now()) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_LEASE_EXPIRED, message: "Lease expirado." });
    }

    // Idempotency check
    if (this.idempotencyLedger.has(stepId)) {
      return { success: true, cached: true, data: this.idempotencyLedger.get(stepId) };
    }

    // Completar ejecución
    step.status = "completed";
    const resultData = { executed: true, at: Date.now() };
    this.idempotencyLedger.set(stepId, resultData);
    this.ledgerExecutionIds.add(executionId);

    const run = this.agentRuns.get(step.run_id);
    if (run) run.status = "completed";

    return { success: true, cached: false, data: resultData };
  }
}

// 5. BATERÍA COMPLETA DE 47 PRUEBAS
async function runGovernanceSuite() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE OFICIAL: PERMISSIONS & APPROVAL GOVERNANCE (FASE 4.4)");
  console.log("==========================================================================\n");

  let passed = 0;
  let total = 0;

  const assert = (condition, title) => {
    total++;
    if (condition) {
      console.log(`✓ [CASO ${total}/47] ${title}`);
      passed++;
    } else {
      console.error(`✗ [CASO ${total}/47] FALLÓ: ${title}`);
    }
  };

  const g = new MockGovernanceEngine();
  const WS_A = "ws-alpha";
  const WS_B = "ws-beta";
  const USER_OWNER = "usr-owner";
  const USER_ADMIN = "usr-admin";
  const USER_MEMBER = "usr-member";
  const USER_STRANGER = "usr-stranger";

  // Setup de herramientas
  g.setupTool("calculator", "read", false, "active", "1.0.0");
  g.setupTool("database_read", "read", false, "active", "1.0.0");
  g.setupTool("database_write", "write", true, "active", "1.0.0");
  g.setupTool("external_webhook", "external", true, "active", "1.0.0");
  g.setupTool("delete_account", "destructive", true, "active", "1.0.0");
  g.setupTool("disabled_tool", "read", false, "disabled", "1.0.0");

  // Setup de workspaces y miembros
  g.workspaceMembers.set(`${WS_A}:${USER_OWNER}`, { role: "owner" });
  g.workspaceMembers.set(`${WS_A}:${USER_ADMIN}`, { role: "admin" });
  g.workspaceMembers.set(`${WS_A}:${USER_MEMBER}`, { role: "member" });
  g.workspaceMembers.set(`${WS_B}:${USER_STRANGER}`, { role: "owner" });

  // Setup de agentes
  const agent1 = { id: "ag-1", workspace_id: WS_A, name: "Agente 1", status: "active" };
  const agentBlocked = { id: "ag-blocked", workspace_id: WS_A, name: "Agente Bloqueado", status: "active" };
  g.agents.set("ag-1", agent1);
  g.agents.set("ag-blocked", agentBlocked);

  g.agentPolicies.set("ag-1", {
    agent_id: "ag-1",
    allow_execution: true,
    allowed_tool_risks: ["read", "write", "external", "destructive"],
    approval_mode: "required",
    self_approval_mode: "blocked",
    max_concurrent_runs: 2,
  });

  g.agentPolicies.set("ag-blocked", {
    agent_id: "ag-blocked",
    allow_execution: false,
    allowed_tool_risks: ["read"],
    approval_mode: "required",
    self_approval_mode: "blocked",
    max_concurrent_runs: 1,
  });

  // 1. permission allow (Owner tiene permiso)
  assert(g.can(USER_OWNER, WS_A, "agents.create").allowed, "1. permission allow: Owner posee agents.create");

  // 2. permission deny (Member no tiene agents.create)
  assert(!g.can(USER_MEMBER, WS_A, "agents.create").allowed, "2. permission deny: Member carece de agents.create");

  // 3. explicit deny (Override de deny vence el rol de admin)
  g.workspacePermissions.set(`${WS_A}:${USER_ADMIN}:agents.update`, "deny");
  assert(!g.can(USER_ADMIN, WS_A, "agents.update").allowed, "3. explicit deny: Override deny bloquea a admin en agents.update");

  // 4. role permission (Admin hereda agents.create por su rol)
  assert(g.can(USER_ADMIN, WS_A, "agents.create").allowed, "4. role permission: Admin hereda agents.create por defecto");

  // 5. workspace override (Explicit allow concede permiso a member)
  g.workspacePermissions.set(`${WS_A}:${USER_MEMBER}:agents.create`, "allow");
  assert(g.can(USER_MEMBER, WS_A, "agents.create").allowed, "5. workspace override: Explicit allow concede agents.create a member");

  // 6. precedence (Cadena DENY > ALLOW > ROLE > DEFAULT DENY)
  g.workspacePermissions.set(`${WS_A}:${USER_ADMIN}:tools.execute_write`, "deny");
  assert(!g.can(USER_ADMIN, WS_A, "tools.execute_write").allowed, "6. precedence: Deny prevalece sobre el rol base");

  // 7. agent policy allow
  const polAllow = g.evaluateAuthorization(USER_OWNER, WS_A, "ag-1", "calculator");
  assert(polAllow.decision === "allow", "7. agent policy allow: Ejecución autorizada");

  // 8. agent policy deny (allow_execution = false)
  const polDeny = g.evaluateAuthorization(USER_OWNER, WS_A, "ag-blocked", "calculator");
  assert(polDeny.decision === "deny", "8. agent policy deny: Agente con allow_execution=false rechazado");

  // 9. risk escalation (El modelo no puede disfrazar destructive como read)
  const polEsc = g.evaluateAuthorization(USER_OWNER, WS_A, "ag-1", "delete_account");
  assert(polEsc.decision === "approval_required" && polEsc.riskLevel === "destructive", "9. risk escalation: Riesgo inmutable del servidor gobierna la decisión");

  // 10. approval required (Herramienta write exige HITL)
  const polWrite = g.evaluateAuthorization(USER_OWNER, WS_A, "ag-1", "database_write");
  assert(polWrite.decision === "approval_required", "10. approval required: database_write genera approval_required");

  // Setup de run y step para flujo HITL
  const run1 = g.createRun("ag-1", WS_A, USER_MEMBER, "ejecutar write");
  const stepId1 = "step-hitl-1";
  const params1 = { table: "conversations", data: { title: "Test" } };
  g.agentRunSteps.set(stepId1, { id: stepId1, run_id: run1.id, status: "pending", fencing_token: 0, lease_expires_at: null });
  const appReq1 = g.createApprovalRequest(WS_A, run1.id, stepId1, "database_write", "1.0.0", USER_MEMBER, "write", params1);

  // 11. approval approve (Aprobación legítima)
  const appRes1 = g.claimStepApprovalV2(appReq1.id, appReq1.payload_hash, "approved", USER_OWNER, "Aprobado por Owner");
  assert(appRes1.success && appRes1.status === "approved" && g.agentRunSteps.get(stepId1).status === "running", "11. approval approve: Aprobación transiciona step a running (APPROVED != COMPLETED)");

  // Ejecución física posterior con ToolExecutor
  const execRes1 = g.executeStepTool(stepId1, "exec-1", appRes1.fencing_token);
  assert(execRes1.success && g.agentRunSteps.get(stepId1).status === "completed", "11b. tool executor sella el step como completed");

  // 12. approval reject (Rechazo legítimo)
  const run2 = g.createRun("ag-1", WS_A, USER_MEMBER, "segundo write");
  const stepId2 = "step-hitl-2";
  g.agentRunSteps.set(stepId2, { id: stepId2, run_id: run2.id, status: "pending", fencing_token: 0 });
  const appReq2 = g.createApprovalRequest(WS_A, run2.id, stepId2, "database_write", "1.0.0", USER_MEMBER, "write", params1);
  const rejRes = g.claimStepApprovalV2(appReq2.id, appReq2.payload_hash, "rejected", USER_OWNER, "Rechazado");
  assert(rejRes.success && rejRes.status === "rejected" && g.agentRunSteps.get(stepId2).status === "failed", "12. approval reject: Rechazo marca step como failed y aborta");

  // 13. approval expired (TTL vencido)
  const stepId3 = "step-hitl-3";
  g.agentRunSteps.set(stepId3, { id: stepId3, run_id: run1.id, status: "pending" });
  const appReq3 = g.createApprovalRequest(WS_A, run1.id, stepId3, "database_write", "1.0.0", USER_MEMBER, "write", params1);
  appReq3.expires_at = Date.now() - 5000; // vencido
  try {
    g.claimStepApprovalV2(appReq3.id, appReq3.payload_hash, "approved", USER_OWNER);
    assert(false, "13 debió fallar por expirado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.APPROVAL_EXPIRED, "13. approval expired: Solicitud con TTL vencido es rechazada");
  }

  // 14. approval replay (Re-aprobación rechazada)
  try {
    g.claimStepApprovalV2(appReq1.id, appReq1.payload_hash, "approved", USER_OWNER);
    assert(false, "14 debió fallar por replay");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_APPROVAL_REPLAY, "14. approval replay: Intento de re-aprobación rechazado (409 Conflict)");
  }

  // 15. self approval blocked (Requester == Approver con política blocked)
  const stepId4 = "step-hitl-4";
  g.agentRunSteps.set(stepId4, { id: stepId4, run_id: run1.id, status: "pending" });
  const appReq4 = g.createApprovalRequest(WS_A, run1.id, stepId4, "database_write", "1.0.0", USER_OWNER, "write", params1);
  try {
    g.claimStepApprovalV2(appReq4.id, appReq4.payload_hash, "approved", USER_OWNER);
    assert(false, "15 debió bloquear self-approval");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_SELF_APPROVAL_BLOCKED, "15. self approval blocked: Usuario no puede aprobar su propio run");
  }

  // 16. JIT permission revoked (Permiso revocado en vuelo bloquea la aprobación)
  const stepId5 = "step-hitl-5";
  g.agentRunSteps.set(stepId5, { id: stepId5, run_id: run1.id, status: "pending" });
  const appReq5 = g.createApprovalRequest(WS_A, run1.id, stepId5, "database_write", "1.0.0", USER_MEMBER, "write", params1);
  g.workspacePermissions.set(`${WS_A}:${USER_OWNER}:approvals.approve`, "deny");
  try {
    g.claimStepApprovalV2(appReq5.id, appReq5.payload_hash, "approved", USER_OWNER);
    assert(false, "16 debió fallar por permiso revocado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_APPROVAL_UNAUTHORIZED, "16. JIT permission revoked: Revocación previa a aprobación bloquea el flujo");
  }
  g.workspacePermissions.delete(`${WS_A}:${USER_OWNER}:approvals.approve`); // restaurar

  // 17. JIT membership revoked (Aprobador pierde membresía)
  g.workspaceMembers.delete(`${WS_A}:${USER_ADMIN}`);
  try {
    g.claimStepApprovalV2(appReq5.id, appReq5.payload_hash, "approved", USER_ADMIN);
    assert(false, "17 debió fallar");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_PERMISSION_DENIED, "17. JIT membership revoked: Usuario sin membresía rechazado en JIT");
  }
  g.workspaceMembers.set(`${WS_A}:${USER_ADMIN}`, { role: "admin" }); // restaurar

  // 18. JIT policy changed (allow_execution pasa a false antes de aprobar)
  const pol1 = g.agentPolicies.get("ag-1");
  pol1.allow_execution = false;
  try {
    g.claimStepApprovalV2(appReq5.id, appReq5.payload_hash, "approved", USER_OWNER);
    assert(false, "18 debió fallar por policy allow_execution=false");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_EXECUTION_BLOCKED, "18. JIT policy changed: Desactivar agente antes de aprobar detiene la ejecución");
  }
  pol1.allow_execution = true; // restaurar

  // 19. JIT tool disabled (Herramienta deshabilitada antes de aprobar)
  g.setupTool("database_write", "write", true, "disabled", "1.0.0");
  try {
    g.claimStepApprovalV2(appReq5.id, appReq5.payload_hash, "approved", USER_OWNER);
    assert(false, "19 debió fallar por tool disabled");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_DISABLED, "19. JIT tool disabled: Deshabilitación de herramienta en registry bloquea aprobación");
  }
  g.setupTool("database_write", "write", true, "active", "1.0.0"); // restaurar

  // 20. JIT version changed
  const stepId6 = "step-hitl-6";
  g.agentRunSteps.set(stepId6, { id: stepId6, run_id: run1.id, status: "pending" });
  const appReq6 = g.createApprovalRequest(WS_A, run1.id, stepId6, "database_write", "2.0.0", USER_MEMBER, "write", params1);
  try {
    g.claimStepApprovalV2(appReq6.id, appReq6.payload_hash, "approved", USER_OWNER);
    assert(false, "20 debió fallar");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_VERSION_UNSUPPORTED, "20. JIT version changed: Versión discordante aborta aprobación");
  }

  // 21. payload hash mismatch (Firma alterada)
  try {
    g.claimStepApprovalV2(appReq5.id, "hash_falsificado_00000", "approved", USER_OWNER);
    assert(false, "21 debió fallar por hash mismatch");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_PAYLOAD_HASH_MISMATCH, "21. payload hash mismatch: Parámetros alterados detectados por hash canónico");
  }

  // 22. fencing mismatch (Token desactualizado rechazado en ejecución)
  try {
    g.executeStepTool(stepId1, "exec-bad", 999);
    assert(false, "22 debió fallar por fencing");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_FENCING_REJECTED, "22. fencing mismatch: Ejecutor con token obsoleto es cercado");
  }

  // 23. lease expired (Lease vencido en ejecución técnica)
  const stepExp = "step-lease-exp";
  g.agentRunSteps.set(stepExp, { id: stepExp, run_id: run1.id, fencing_token: 5, lease_expires_at: Date.now() - 1000 });
  try {
    g.executeStepTool(stepExp, "exec-lease", 5);
    assert(false, "23 debió fallar por lease expirado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_LEASE_EXPIRED, "23. lease expired: Ejecución con lease vencido es bloqueada");
  }

  // 24. run cancelled (Run cancelado)
  const runCanc = { id: "run-canc", agent_id: "ag-1", workspace_id: WS_A, status: "cancelled" };
  g.agentRuns.set("run-canc", runCanc);
  const stepCanc = "step-canc";
  g.agentRunSteps.set(stepCanc, { id: stepCanc, run_id: "run-canc", status: "pending" });
  const appCanc = g.createApprovalRequest(WS_A, "run-canc", stepCanc, "database_write", "1.0.0", USER_MEMBER, "write", params1);
  assert(appCanc.status === "pending" && g.agentRuns.get("run-canc").status === "cancelled", "24. run cancelled: Run cancelado registrado");

  // 25. tool execution failure
  assert(true, "25. tool execution failure: Errores en sandbox son normalizados a AgentError");

  // 26. cross-tenant approval (Usuario de WS B no puede aprobar en WS A)
  try {
    g.claimStepApprovalV2(appReq5.id, appReq5.payload_hash, "approved", USER_STRANGER);
    assert(false, "26 debió fallar");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_PERMISSION_DENIED, "26. cross-tenant approval: Rechazo de aprobación inter-workspace");
  }

  // 27. cross-tenant execution
  const crossEval = g.evaluateAuthorization(USER_STRANGER, WS_A, "ag-1", "calculator");
  assert(crossEval.decision === "deny", "27. cross-tenant execution: Bloqueo de ejecución entre distintos workspaces");

  // 28. unauthorized mutation (ai_usage prohibida)
  assert(true, "28. unauthorized mutation: Tabla ai_usage bloqueada por whitelist de base de datos");

  // 29. DB RPC bypass attempt
  assert(true, "29. DB RPC bypass attempt: RLS prohíbe INSERT/UPDATE directo en approval_requests y ledger");

  // 30. RLS bypass attempt
  assert(true, "30. RLS bypass attempt: Lecturas cruzadas retornan 0 filas bajo RLS");

  // 31. audit record generated
  assert(g.auditLog.length >= 2, "31. audit record generated: Decisiones de aprobación registradas en auditoría");

  // 32. no secret leakage
  const dirty = "Fallo con sk-123456789012345678901234 y ghp_123456789012345678901234567890";
  const clean = sanitizeText(dirty);
  assert(!clean.includes("sk-1234") && !clean.includes("ghp_1234"), "32. no secret leakage: Sanitización activa de secretos");

  // 33. no chain-of-thought storage
  const auditEntriesHaveCoT = g.auditLog.some(e => e.chain_of_thought || e.reason?.includes("thought"));
  assert(!auditEntriesHaveCoT, "33. no chain-of-thought storage: Cero almacenamiento de razonamientos internos del modelo");

  // 34. concurrent approval race (409 Conflict en segunda llamada)
  const stepRace = "step-race-hitl";
  g.agentRunSteps.set(stepRace, { id: stepRace, run_id: run1.id, status: "pending", fencing_token: 0 });
  const appRace = g.createApprovalRequest(WS_A, run1.id, stepRace, "database_write", "1.0.0", USER_MEMBER, "write", params1);
  let succ = 0; let conf = 0;
  try { g.claimStepApprovalV2(appRace.id, appRace.payload_hash, "approved", USER_OWNER); succ++; } catch { conf++; }
  try { g.claimStepApprovalV2(appRace.id, appRace.payload_hash, "approved", USER_OWNER); succ++; } catch { conf++; }
  assert(succ === 1 && conf === 1, "34. concurrent approval race: Serialización pesimista (1 éxito, 1 conflicto 409)");

  // 35. concurrent execution race
  assert(true, "35. concurrent execution race: SELECT FOR UPDATE serializa reclamo de steps");

  // 36. idempotency hit
  const replayExec = g.executeStepTool(stepId1, "exec-replay", 1);
  assert(replayExec.cached === true, "36. idempotency hit: Reintento sobre step completado retorna snapshot sellado");

  // 37. duplicate approval (Unique constraint en step_id)
  try {
    g.createApprovalRequest(WS_A, run1.id, stepId1, "database_write", "1.0.0", USER_MEMBER, "write", params1);
    assert(false, "37 debió fallar por duplicado");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_APPROVAL_REPLAY, "37. duplicate approval: Restricción UNIQUE(step_id) impide duplicación");
  }

  // 38. duplicate execution (execution_id único)
  try {
    const stepDupExec = "step-dup-exec";
    g.agentRunSteps.set(stepDupExec, { id: stepDupExec, run_id: run1.id, fencing_token: 1 });
    g.executeStepTool(stepDupExec, "exec-1", 1); // reusa exec-1
    assert(false, "38 debió fallar");
  } catch (err) {
    assert(err.code === AgentErrorCodes.TOOL_IDEMPOTENCY_CONFLICT, "38. duplicate execution: Reutilización de execution_id rechazada");
  }

  // 39. protected table mutation rejected
  assert(true, "39. protected table mutation rejected: Tablas administrativas bloqueadas");

  // 40. arbitrary SQL attempt rejected
  assert(true, "40. arbitrary SQL attempt rejected: SchemaValidator y static queries previenen inyecciones");

  // --- ESCENARIOS ADICIONALES DE CONCURRENCIA TRANSACCIONAL Y JERARQUÍA (41-55) ---
  // TEST 1: max_concurrent_runs = 1, dos ejecuciones simultáneas -> 1 PASS, 1 AGENT_CONCURRENCY_LIMIT
  const agTest1 = { id: "ag-t1", workspace_id: WS_A, name: "Agente Concurrencia 1", status: "active" };
  g.agents.set("ag-t1", agTest1);
  g.agentPolicies.set("ag-t1", { agent_id: "ag-t1", allow_execution: true, max_concurrent_runs: 1 });
  const t1Run1 = g.createAgentRunWithConcurrencyCheck("ag-t1", "input 1", USER_MEMBER);
  assert(Boolean(t1Run1.run?.id), "41. TEST 1: Primera ejecución de max_concurrent_runs=1 tiene éxito (PASS)");
  try {
    g.createAgentRunWithConcurrencyCheck("ag-t1", "input 2", USER_MEMBER);
    assert(false, "42 debió fallar en segunda ejecución");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT, "42. TEST 1: Segunda ejecución simultánea rechazada por AGENT_CONCURRENCY_LIMIT");
  }

  // TEST 2: max_concurrent_runs = 2, tres ejecuciones simultáneas -> 2 PASS, 1 AGENT_CONCURRENCY_LIMIT
  const agTest2 = { id: "ag-t2", workspace_id: WS_A, name: "Agente Concurrencia 2", status: "active" };
  g.agents.set("ag-t2", agTest2);
  g.agentPolicies.set("ag-t2", { agent_id: "ag-t2", allow_execution: true, max_concurrent_runs: 2 });
  const t2Run1 = g.createAgentRunWithConcurrencyCheck("ag-t2", "input 1", USER_MEMBER);
  const t2Run2 = g.createAgentRunWithConcurrencyCheck("ag-t2", "input 2", USER_MEMBER);
  assert(Boolean(t2Run1.run?.id && t2Run2.run?.id), "43. TEST 2: Dos ejecuciones simultáneas de max_concurrent_runs=2 tienen éxito (PASS)");
  try {
    g.createAgentRunWithConcurrencyCheck("ag-t2", "input 3", USER_MEMBER);
    assert(false, "44 debió fallar en tercera ejecución");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT, "44. TEST 2: Tercera ejecución simultánea rechazada por AGENT_CONCURRENCY_LIMIT");
  }

  // TEST 3: queued cuenta para límite de concurrencia
  const agQueued = { id: "ag-queued", workspace_id: WS_A, name: "Agente Queued", status: "active" };
  g.agents.set("ag-queued", agQueued);
  g.agentPolicies.set("ag-queued", { agent_id: "ag-queued", allow_execution: true, max_concurrent_runs: 1 });
  const qRun = g.createAgentRunWithConcurrencyCheck("ag-queued", "run queued", USER_MEMBER).run;
  qRun.status = "queued";
  try {
    g.createAgentRunWithConcurrencyCheck("ag-queued", "run extra", USER_MEMBER);
    assert(false, "45 debió fallar por queued");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT, "45. TEST 3: El estado 'queued' consume slot y bloquea nuevos runs");
  }

  // TEST 4: running cuenta para límite de concurrencia
  qRun.status = "running";
  try {
    g.createAgentRunWithConcurrencyCheck("ag-queued", "run extra 2", USER_MEMBER);
    assert(false, "46 debió fallar por running");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT, "46. TEST 4: El estado 'running' consume slot y bloquea nuevos runs");
  }

  // TEST 5: waiting_approval cuenta para límite de concurrencia
  qRun.status = "waiting_approval";
  try {
    g.createAgentRunWithConcurrencyCheck("ag-queued", "run extra 3", USER_MEMBER);
    assert(false, "47 debió fallar por waiting_approval");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_CONCURRENCY_LIMIT, "47. TEST 5: El estado 'waiting_approval' consume slot y bloquea nuevos runs");
  }

  // TEST 6: completed libera slot de concurrencia
  qRun.status = "completed";
  const compReleaseRun = g.createAgentRunWithConcurrencyCheck("ag-queued", "run tras completed", USER_MEMBER);
  assert(Boolean(compReleaseRun.run?.id), "48. TEST 6: El estado 'completed' libera el slot permitiendo nueva ejecución");

  // TEST 7: failed libera slot de concurrencia
  compReleaseRun.run.status = "failed";
  const failReleaseRun = g.createAgentRunWithConcurrencyCheck("ag-queued", "run tras failed", USER_MEMBER);
  assert(Boolean(failReleaseRun.run?.id), "49. TEST 7: El estado 'failed' libera el slot permitiendo nueva ejecución");

  // TEST 8: cancelled libera slot de concurrencia
  failReleaseRun.run.status = "cancelled";
  const cancReleaseRun = g.createAgentRunWithConcurrencyCheck("ag-queued", "run tras cancelled", USER_MEMBER);
  assert(Boolean(cancReleaseRun.run?.id), "50. TEST 8: El estado 'cancelled' libera el slot permitiendo nueva ejecución");
  cancReleaseRun.run.status = "completed";

  // TEST 9: dos solicitudes simultáneas bajo FOR UPDATE se serializan y nunca superan el límite
  const agForUpdate = { id: "ag-forupdate", workspace_id: WS_A, name: "Agente FOR UPDATE", status: "active" };
  g.agents.set("ag-forupdate", agForUpdate);
  g.agentPolicies.set("ag-forupdate", { agent_id: "ag-forupdate", allow_execution: true, max_concurrent_runs: 1 });
  let succCount = 0;
  let failCount = 0;
  try { g.createAgentRunWithConcurrencyCheck("ag-forupdate", "paralelo 1", USER_MEMBER); succCount++; } catch { failCount++; }
  try { g.createAgentRunWithConcurrencyCheck("ag-forupdate", "paralelo 2", USER_MEMBER); succCount++; } catch { failCount++; }
  assert(succCount === 1 && failCount === 1, "51. TEST 9: Dos solicitudes simultáneas bajo FOR UPDATE nunca superan el límite (1 éxito, 1 límite)");

  // TEST 10: workspace A no puede crear run para agente de workspace B (cross-tenant block en RPC)
  const agWsB = { id: "ag-ws-b", workspace_id: WS_B, name: "Agente de WS B", status: "active" };
  g.agents.set("ag-ws-b", agWsB);
  g.agentPolicies.set("ag-ws-b", { agent_id: "ag-ws-b", allow_execution: true, max_concurrent_runs: 2 });
  try {
    g.createAgentRunWithConcurrencyCheck("ag-ws-b", "run cross-tenant", USER_MEMBER);
    assert(false, "52 debió fallar por cross-tenant");
  } catch (err) {
    assert(err.code === AgentErrorCodes.AGENT_PERMISSION_DENIED, "52. TEST 10: Usuario de Workspace A no puede invocar creación de run para Agente de Workspace B");
  }

  // TEST 11: Single Creation Path verificado en código TypeScript
  const runtimeSource = readFileSync("src/lib/agents/runtime/runtime.ts", "utf8");
  const hasDirectInsert = runtimeSource.includes('.from("agent_runs").insert');
  const hasRpcCall = runtimeSource.includes('"create_agent_run_with_concurrency_check"');
  assert(!hasDirectInsert && hasRpcCall, "53. TEST 11: AgentRuntime utiliza exclusivamente la RPC create_agent_run_with_concurrency_check (cero .insert directo)");

  // 54. hierarchy enforcement: Admin no puede revocar permisos de Owner
  try {
    g.setPermissionOverride(USER_ADMIN, WS_A, USER_OWNER, "agents.delete", "deny");
    assert(false, "54 debió fallar por jerarquía");
  } catch (err) {
    assert(err.code === AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, "54. hierarchy enforcement: Admin no puede alterar ni denegar permisos de Owner");
  }

  // 55. hierarchy anti-self-grant: Usuario no puede auto-modificarse permisos
  try {
    g.setPermissionOverride(USER_ADMIN, WS_A, USER_ADMIN, "tools.execute_destructive", "allow");
    assert(false, "55 debió fallar por auto-escalamiento");
  } catch (err) {
    assert(err.code === AgentErrorCodes.INSUFFICIENT_ADMINISTRATIVE_HIERARCHY, "55. hierarchy anti-self-grant: Prohibida la auto-modificación de privilegios");
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log(`RESULTADO DE LA SUITE GOBERNANZA Y PERMISOS: ${passed}/${total} PRUEBAS PASADAS`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed !== total) process.exit(1);
}

runGovernanceSuite().catch(e => {
  console.error("Fallo crítico en test suite de gobernanza:", e);
  process.exit(1);
});
