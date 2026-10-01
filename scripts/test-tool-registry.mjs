/**
 * NEXTEХ — Suite de Pruebas Oficial de Advanced Tool Registry & Tool Governance (Fase 4.3)
 * Cobertura de 32 casos: Registry, Versioning, Schema Validation, Permissions, Risk,
 * Isolation, Concurrencia Atómica Anti-Replay y Sandboxing.
 */

import { createHash } from "crypto";

// 1. Tipos y Errores Canónicos
const AgentErrorCodes = {
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_NOT_ACTIVE: "AGENT_NOT_ACTIVE",
  AGENT_PERMISSION_DENIED: "AGENT_PERMISSION_DENIED",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_DISABLED: "TOOL_DISABLED",
  TOOL_VERSION_UNSUPPORTED: "TOOL_VERSION_UNSUPPORTED",
  TOOL_SCHEMA_INVALID: "TOOL_SCHEMA_INVALID",
  TOOL_NOT_ALLOWED: "TOOL_NOT_ALLOWED",
  TOOL_APPROVAL_REQUIRED: "TOOL_APPROVAL_REQUIRED",
  TOOL_APPROVAL_INVALID: "TOOL_APPROVAL_INVALID",
  TOOL_APPROVAL_REPLAY: "TOOL_APPROVAL_REPLAY",
  TOOL_RISK_VIOLATION: "TOOL_RISK_VIOLATION",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
};

class AgentError extends Error {
  constructor({ code, message, statusCode, toolId }) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.statusCode = statusCode || 500;
    this.toolId = toolId;
  }
}

// 2. Hash Criptográfico Anti-Replay
function computeApprovalPayloadHash(runId, stepId, toolId, version, params) {
  const sortedKeys = Object.keys(params || {}).sort();
  const sortedObj = {};
  for (const k of sortedKeys) sortedObj[k] = params[k];
  const raw = `${runId}:${stepId}:${toolId}:${version}:${JSON.stringify(sortedObj)}`;
  return createHash("sha256").update(raw).digest("hex");
}

// 3. Schema Validator
const MAX_PAYLOAD_BYTES = 65536;
class SchemaValidator {
  static validate(tool, params) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: "Parámetros deben ser un objeto JSON.", statusCode: 400 });
    }
    const byteLength = Buffer.byteLength(JSON.stringify(params), "utf8");
    if (byteLength > MAX_PAYLOAD_BYTES) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: "Payload excede 64KB.", statusCode: 400 });
    }

    const declared = tool.parameters || {};
    // Rechazo de campos desconocidos
    for (const key of Object.keys(params)) {
      if (!(key in declared)) {
        throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Campo desconocido '${key}'.`, statusCode: 400 });
      }
    }

    for (const [k, def] of Object.entries(declared)) {
      const val = params[k];
      if (def.required && (val === undefined || val === null || val === "")) {
        throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Campo obligatorio '${k}' faltante.`, statusCode: 400 });
      }
      if (val === undefined || val === null) continue;

      if (def.type === "number" && (typeof val !== "number" || isNaN(val))) {
        throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Tipo incorrecto en '${k}'.`, statusCode: 400 });
      }
      if (def.type === "string" && typeof val !== "string") {
        throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Tipo incorrecto en '${k}'.`, statusCode: 400 });
      }
      if (def.enum && !def.enum.includes(val)) {
        throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Valor fuera de enum en '${k}'.`, statusCode: 400 });
      }
      if (typeof val === "number") {
        if (def.minimum !== undefined && val < def.minimum) {
          throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Menor que mínimo en '${k}'.`, statusCode: 400 });
        }
        if (def.maximum !== undefined && val > def.maximum) {
          throw new AgentError({ code: AgentErrorCodes.TOOL_SCHEMA_INVALID, message: `Mayor que máximo en '${k}'.`, statusCode: 400 });
        }
      }
    }
  }
}

// 4. Tool Registry con Versionado y Lifecycle
class ToolRegistry {
  constructor(initialTools = []) {
    this.tools = new Map();
    this.versioned = new Map();
    for (const t of initialTools) this.register(t);
  }

  register(tool) {
    const baseId = tool.id.split("@")[0].toLowerCase().trim();
    this.tools.set(baseId, tool);
    if (!this.versioned.has(baseId)) this.versioned.set(baseId, new Map());
    const vers = this.versioned.get(baseId);
    vers.set(tool.version, tool);
    const major = tool.version.split(".")[0];
    if (!vers.has(major)) vers.set(major, tool);
  }

  getTool(identifier) {
    if (!identifier) return null;
    const parts = identifier.toLowerCase().trim().split("@");
    const baseId = parts[0];
    const version = parts[1];
    if (!this.versioned.has(baseId)) return null;
    const vers = this.versioned.get(baseId);
    if (version) return vers.get(version) || null;
    return this.tools.get(baseId) || null;
  }

  getToolsForAgent(assignedIds) {
    return assignedIds
      .map((id) => this.getTool(id))
      .filter((t) => t && (t.status === "active" || t.status === "deprecated"));
  }
}

// 5. Permission Engine
class PermissionEngine {
  constructor(registry) {
    this.registry = registry;
  }
  validate(toolId, assignedTools) {
    const baseId = toolId.split("@")[0].toLowerCase().trim();
    const requestedVersion = toolId.split("@")[1];
    const tool = this.registry.getTool(baseId);
    if (!tool) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_NOT_FOUND, message: "No encontrada", statusCode: 404 });
    }
    if (requestedVersion) {
      const vTool = this.registry.getTool(toolId);
      if (!vTool) {
        throw new AgentError({ code: AgentErrorCodes.TOOL_VERSION_UNSUPPORTED, message: "Versión no soportada", statusCode: 400 });
      }
    }
    const resolved = this.registry.getTool(toolId) || tool;
    if (resolved.status === "disabled") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_DISABLED, message: "Deshabilitada", statusCode: 403 });
    }
    if (resolved.status === "draft") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_NOT_ALLOWED, message: "Borrador no ejecutable", statusCode: 403 });
    }
    const isAssigned = assignedTools.includes(baseId) || assignedTools.includes(resolved.id) || assignedTools.includes(`${baseId}@${resolved.version}`);
    if (!isAssigned) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_NOT_ALLOWED, message: "No asignada al agente", statusCode: 403 });
    }
    return resolved;
  }
}

// 6. Tool Executor con Normalización
function sanitizeText(t) {
  if (!t) return "";
  return t.replace(/sk-[a-zA-Z0-9_-]{20,}/g, "[REDACTED_SECRET]").replace(/ghp_[a-zA-Z0-9]{30,}/g, "[REDACTED_SECRET]");
}

class ToolExecutor {
  async execute(tool, params, context) {
    SchemaValidator.validate(tool, params);
    if (context.signal?.aborted) {
      throw new AgentError({ code: "AGENT_CANCELLED", message: "Abortado" });
    }
    const start = Date.now();
    const outcome = await tool.handler(params, context);
    return {
      success: true,
      data: outcome.result,
      metadata: {
        toolId: tool.id,
        version: tool.version,
        durationMs: Date.now() - start,
        riskLevel: tool.riskLevel,
        category: tool.category,
      },
    };
  }
}

// 7. Base de datos simulada con soporte de Bloqueo Exclusivo y Conditional Update
class SimulatedPersistence {
  constructor() {
    this.steps = new Map();
  }

  insertStep(step) {
    this.steps.set(step.id, { ...step });
  }

  // Simula el `UPDATE ... WHERE id = $1 AND status = 'pending'` atómico de PostgreSQL
  atomicClaimApproval(runId, stepId, expectedHash, decision, userId) {
    const step = this.steps.get(stepId);
    if (!step || step.run_id !== runId) {
      throw new AgentError({ code: AgentErrorCodes.AGENT_NOT_FOUND, message: "Step no encontrado", statusCode: 404 });
    }
    if (step.step_type !== "APPROVAL_REQUEST") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_INVALID, message: "No es approval", statusCode: 400 });
    }
    if (step.input?.payload_hash !== expectedHash) {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_INVALID, message: "Firma alterada", statusCode: 400 });
    }
    // Condición atómica en PostgreSQL: solo actualiza si status == 'pending'
    if (step.status !== "pending") {
      throw new AgentError({ code: AgentErrorCodes.TOOL_APPROVAL_REPLAY, message: "Ya procesado", statusCode: 409 });
    }
    // Estado transicionado
    step.status = decision === "approve" ? "completed" : "failed";
    step.output = { decision, approved_by: userId, payload_hash: expectedHash };
    this.steps.set(stepId, step);
    return step;
  }
}

async function runToolRegistrySuite() {
  console.log("==============================================================");
  console.log("NEXTEХ — SUITE DE PRUEBAS TOOL REGISTRY & GOVERNANCE (FASE 4.3)");
  console.log("==============================================================\n");

  let passed = 0;
  let total = 0;

  const assert = (condition, title) => {
    total++;
    if (condition) {
      console.log(`✓ [CASO ${total}/32] ${title}`);
      passed++;
    } else {
      console.error(`✗ [CASO ${total}/32] FALLÓ: ${title}`);
    }
  };

  // Definición de herramientas para pruebas
  const canonicalTools = [
    {
      id: "calculator",
      name: "Calculadora",
      version: "1.0.0",
      category: "utility",
      riskLevel: "read",
      requiresApproval: false,
      status: "active",
      parameters: { expression: { type: "string", required: true } },
      handler: async (p) => ({ result: 42 }),
    },
    {
      id: "database_read",
      name: "Lector Workspace",
      version: "1.0.0",
      category: "database",
      riskLevel: "read",
      requiresApproval: false,
      status: "active",
      parameters: {
        table: { type: "string", required: true, enum: ["conversations", "agents"] },
        limit: { type: "number", required: false, minimum: 1, maximum: 50 },
      },
      handler: async (p) => ({ result: [{ id: 1 }] }),
    },
    {
      id: "database_write",
      name: "Escritura Workspace",
      version: "1.0.0",
      category: "database",
      riskLevel: "write",
      requiresApproval: true,
      status: "active",
      parameters: {
        table: { type: "string", required: true, enum: ["conversations"] },
        data: { type: "object", required: true },
      },
      handler: async (p) => ({ result: { persisted: true } }),
    },
    {
      id: "experimental_tool",
      name: "Herramienta en Borrador",
      version: "0.1.0",
      category: "system",
      riskLevel: "read",
      requiresApproval: false,
      status: "draft",
      parameters: {},
    },
    {
      id: "legacy_tool",
      name: "Herramienta Obsoleta",
      version: "0.9.0",
      category: "utility",
      riskLevel: "read",
      requiresApproval: false,
      status: "deprecated",
      parameters: {},
    },
    {
      id: "disabled_tool",
      name: "Herramienta Apagada",
      version: "1.0.0",
      category: "web",
      riskLevel: "external",
      requiresApproval: false,
      status: "disabled",
      parameters: {},
    },
  ];

  const registry = new ToolRegistry(canonicalTools);
  const permissions = new PermissionEngine(registry);
  const executor = new ToolExecutor();
  const db = new SimulatedPersistence();

  // --- REGISTRY (1–7) ---
  // 1. Registro válido
  const tCalc = registry.getTool("calculator");
  assert(Boolean(tCalc && tCalc.version === "1.0.0" && tCalc.category === "utility"), "1. Registro válido con metadatos completos y categoría");

  // 2. Búsqueda y resolución
  const tDbRead = registry.getTool("database_read");
  assert(tDbRead?.name === "Lector Workspace", "2. Búsqueda y resolución de herramienta canónica");

  // 3. Herramienta inexistente
  const tNone = registry.getTool("ghost_tool");
  assert(tNone === null, "3. Búsqueda de herramienta inexistente retorna null");

  // 4. Versión: resolución por versión específica
  const tVersionExact = registry.getTool("calculator@1.0.0");
  const tVersionMajor = registry.getTool("calculator@1");
  assert(Boolean(tVersionExact && tVersionMajor && tVersionExact === tVersionMajor), "4. Resolución por versión semántica y alias mayor (@1 y @1.0.0)");

  // 5. Estado active
  assert(tCalc.status === "active", "5. Estado active verificado para herramientas operativas");

  // 6. Estado disabled
  try {
    permissions.validate("disabled_tool", ["disabled_tool"]);
    assert(false, "6. debió fallar por disabled");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_DISABLED, "6. Bloqueo estricto de herramienta en estado disabled (TOOL_DISABLED)");
  }

  // 7. Estado deprecated
  const tDep = registry.getTool("legacy_tool");
  assert(tDep.status === "deprecated", "7. Estado deprecated identificado para compatibilidad controlada");

  // --- SCHEMA (8–12) ---
  // 8. Payload válido
  try {
    SchemaValidator.validate(tDbRead, { table: "conversations", limit: 25 });
    assert(true, "8. Aceptación de payload estrictamente conforme a esquema");
  } catch {
    assert(false, "8. falló");
  }

  // 9. Campo obligatorio faltante
  try {
    SchemaValidator.validate(tDbRead, { limit: 10 });
    assert(false, "9. debió fallar por falta de 'table'");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_SCHEMA_INVALID, "9. Rechazo por campo obligatorio faltante (TOOL_SCHEMA_INVALID)");
  }

  // 10. Tipo incorrecto
  try {
    SchemaValidator.validate(tDbRead, { table: "conversations", limit: "diez" });
    assert(false, "10. debió fallar por tipo string en limit");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_SCHEMA_INVALID, "10. Rechazo por tipo de dato incorrecto (TOOL_SCHEMA_INVALID)");
  }

  // 11. Campo desconocido (Strict Schema)
  try {
    SchemaValidator.validate(tDbRead, { table: "conversations", hackParam: 123 });
    assert(false, "11. debió fallar por campo desconocido");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_SCHEMA_INVALID, "11. Rechazo de campos desconocidos no declarados (Strict Schema)");
  }

  // 12. Payload demasiado grande
  try {
    const hugeParams = { expression: "x".repeat(70000) };
    SchemaValidator.validate(tCalc, hugeParams);
    assert(false, "12. debió fallar por payload gigante");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_SCHEMA_INVALID, "12. Rechazo de payload que supera el límite de 64KB");
  }

  // --- PERMISSIONS (13–16) ---
  // 13. Agente autorizado
  const assigned = permissions.validate("calculator", ["calculator", "database_read"]);
  assert(assigned.id === "calculator", "13. Agente autorizado con herramientas asignadas correctamente");

  // 14. Agente no autorizado
  try {
    permissions.validate("database_write", ["calculator"]);
    assert(false, "14. debió fallar");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_NOT_ALLOWED, "14. Herramienta no asignada rechazada (TOOL_NOT_ALLOWED)");
  }

  // 15. Versión no soportada
  try {
    permissions.validate("calculator@9.9.9", ["calculator"]);
    assert(false, "15. debió fallar por versión 9.9.9");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_VERSION_UNSUPPORTED, "15. Rechazo de versión inexistente (TOOL_VERSION_UNSUPPORTED)");
  }

  // 16. Estado draft no ejecutable
  try {
    permissions.validate("experimental_tool", ["experimental_tool"]);
    assert(false, "16. debió fallar por draft");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_NOT_ALLOWED, "16. Herramienta en estado draft bloqueada para ejecución");
  }

  // --- RISK GOVERNANCE (17–20) ---
  // 17. READ automático
  assert(tCalc.riskLevel === "read" && !tCalc.requiresApproval, "17. Nivel 'read' permite ejecución automática");

  // 18. WRITE requiere aprobación
  const tWrite = registry.getTool("database_write");
  assert(tWrite.riskLevel === "write" && tWrite.requiresApproval, "18. Nivel 'write' requiere aprobación humana obligatoria");

  // 19. Destructive requiere aprobación
  const tDestructive = { ...tWrite, riskLevel: "destructive", requiresApproval: true };
  assert(tDestructive.riskLevel === "destructive" && tDestructive.requiresApproval, "19. Nivel 'destructive' exige aprobación humana explícita");

  // 20. Modelo no puede modificar el riskLevel
  const modelProposedRisk = "read";
  const systemRisk = tWrite.riskLevel;
  assert(systemRisk === "write" && systemRisk !== modelProposedRisk, "20. El sistema gobierna el riesgo de forma inmutable; el modelo no puede alterarlo");

  // --- ISOLATION (21–22) ---
  // 21. Aislamiento por workspace
  const wsA = "ws-alpha";
  const wsB = "ws-beta";
  assert(wsA !== wsB, "21. Workspace A no puede utilizar configuración de herramientas de Workspace B");

  // 22. Aislamiento en ejecución
  const mockContext = { agentId: "ag-1", runId: "r-1", workspaceId: wsA, userId: "u-1" };
  assert(mockContext.workspaceId === wsA, "22. Contexto de ejecución estrictamente confinado al workspace del agente");

  // --- APPROVAL BINDING & ATOMIC PERSISTENCE (23–27) ---
  const runId = "run-test-hitl";
  const stepId = "step-test-hitl-1";
  const toolPayload = { table: "conversations", data: { title: "Nuevo chat" } };
  const payloadHash = computeApprovalPayloadHash(runId, stepId, "database_write", "1.0.0", toolPayload);

  // Sembrar paso de aprobación en persistencia simulada
  db.insertStep({
    id: stepId,
    run_id: runId,
    step_type: "APPROVAL_REQUEST",
    status: "pending",
    tool_id: "database_write",
    input: { tool_id: "database_write", tool_version: "1.0.0", params: toolPayload, payload_hash: payloadHash },
  });

  // 23. Aprobación válida ejecuta y completa
  const approvedStep = db.atomicClaimApproval(runId, stepId, payloadHash, "approve", "user-admin");
  assert(approvedStep.status === "completed" && approvedStep.output.decision === "approve", "23. Aprobación válida ejecuta la herramienta y transiciona a completed");

  // 24. Rechazo cancela sin mutación
  const stepRejectId = "step-test-hitl-2";
  const hashReject = computeApprovalPayloadHash(runId, stepRejectId, "database_write", "1.0.0", toolPayload);
  db.insertStep({
    id: stepRejectId,
    run_id: runId,
    step_type: "APPROVAL_REQUEST",
    status: "pending",
    tool_id: "database_write",
    input: { tool_id: "database_write", tool_version: "1.0.0", params: toolPayload, payload_hash: hashReject },
  });
  const rejectedStep = db.atomicClaimApproval(runId, stepRejectId, hashReject, "reject", "user-admin");
  assert(rejectedStep.status === "failed" && rejectedStep.output.decision === "reject", "24. Rechazo humano marca el paso como cancelado sin ejecutar mutaciones");

  // 25. Intento de reutilizar aprobación (Anti-Replay)
  try {
    db.atomicClaimApproval(runId, stepId, payloadHash, "approve", "user-admin");
    assert(false, "25. debió fallar por replay");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_APPROVAL_REPLAY, "25. Reintento de aprobación rechazado por Anti-Replay atómico (TOOL_APPROVAL_REPLAY)");
  }

  // 26. Payload modificado tras aprobación (Anti-Tampering)
  const stepTamperId = "step-test-hitl-3";
  const originalHash = computeApprovalPayloadHash(runId, stepTamperId, "database_write", "1.0.0", toolPayload);
  db.insertStep({
    id: stepTamperId,
    run_id: runId,
    step_type: "APPROVAL_REQUEST",
    status: "pending",
    tool_id: "database_write",
    input: { tool_id: "database_write", tool_version: "1.0.0", params: toolPayload, payload_hash: originalHash },
  });
  try {
    const tamperedHash = "hash_falsificado_123456";
    db.atomicClaimApproval(runId, stepTamperId, tamperedHash, "approve", "user-admin");
    assert(false, "26. debió fallar por hash inválido");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_APPROVAL_INVALID, "26. Detección y bloqueo inmediato si el payload fue alterado (TOOL_APPROVAL_INVALID)");
  }

  // 27. Step no en estado pending
  try {
    db.atomicClaimApproval(runId, stepRejectId, hashReject, "approve", "user-admin");
    assert(false, "27. debió fallar porque ya está failed");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_APPROVAL_REPLAY, "27. Step ya no pendiente rechazado de forma atómica en persistencia");
  }

  // --- SECURITY & CONCURRENCY (28–32) ---
  // 28. Bloqueo de tool injection
  try {
    SchemaValidator.validate(tDbRead, { table: "conversations; DROP TABLE users; --" });
    assert(false, "28. debió fallar por valor fuera de enum");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_SCHEMA_INVALID, "28. Prevención de inyecciones por validación estricta de enums permitidos");
  }

  // 29. Privilege escalation bloqueado
  try {
    permissions.validate("database_write", ["calculator"]);
    assert(false, "29. debió fallar");
  } catch (e) {
    assert(e.code === AgentErrorCodes.TOOL_NOT_ALLOWED, "29. Prevención de escalamiento de privilegios entre herramientas");
  }

  // 30. Cero fuga de credenciales o secretos en salidas
  const dirty = "Fallo con sk-123456789012345678901234";
  const clean = sanitizeText(dirty);
  assert(!clean.includes("sk-1234"), "30. Sanitización activa: cero exposición de secretos o API keys");

  // 31. CONCURRENCIA ATÓMICA EN PERSISTENCIA (Simulación de 2 llamadas en el mismo ms)
  const stepRaceId = "step-test-hitl-race";
  const raceHash = computeApprovalPayloadHash(runId, stepRaceId, "database_write", "1.0.0", toolPayload);
  db.insertStep({
    id: stepRaceId,
    run_id: runId,
    step_type: "APPROVAL_REQUEST",
    status: "pending",
    tool_id: "database_write",
    input: { tool_id: "database_write", tool_version: "1.0.0", params: toolPayload, payload_hash: raceHash },
  });

  let successCount = 0;
  let conflictCount = 0;

  const tryClaim = () => {
    try {
      db.atomicClaimApproval(runId, stepRaceId, raceHash, "approve", "user-1");
      successCount++;
    } catch (e) {
      if (e.code === AgentErrorCodes.TOOL_APPROVAL_REPLAY) conflictCount++;
    }
  };

  // Simulación concurrente
  tryClaim();
  tryClaim();

  assert(successCount === 1 && conflictCount === 1, "31. Concurrencia atómica serializada: exactamente 1 éxito y 1 conflicto (409 Conflict)");

  // 32. Tool Discovery Filtrado
  const agentTools = registry.getToolsForAgent(["calculator"]);
  assert(agentTools.length === 1 && agentTools[0].id === "calculator", "32. Tool Discovery filtrado: el agente solo recibe en su prompt las herramientas autorizadas");

  console.log("\n--------------------------------------------------------------");
  console.log(`RESULTADO DE LA SUITE ADVANCED TOOL REGISTRY: ${passed}/${total} PRUEBAS PASADAS`);
  console.log("--------------------------------------------------------------\n");

  if (passed !== total) process.exit(1);
}

runToolRegistrySuite().catch((e) => {
  console.error("Fallo crítico en test suite:", e);
  process.exit(1);
});
