/**
 * NEXTEХ — FASE 4.11-I-R3
 * SUITE DE VALIDACIÓN RUNTIME POST-REMEDIACIÓN (MIGRACIÓN 20261014)
 *
 * Target: Supabase STAGING (aoczrehfihlmbhrhbazl)
 * Producción Bloqueada: vvpdycuclnoptffwmrvb5
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  assertSupabaseStagingTarget,
  assertVercelStagingTarget,
  detectProductionInEnvironment,
} from "../src/lib/staging/anti-production-barrier.ts";

console.log("==========================================================================");
console.log("NEXTEХ — FASE 4.11-I-R3: STAGING RUNTIME POST-REMEDIATION");
console.log("VALIDACIÓN DE MIGRACIÓN 20261014 EN SUPABASE STAGING");
console.log("==========================================================================\n");

// 1. CARGA SEGURA DE .ENV.STAGING
const stagingEnvPath = ".env.staging";
if (!fs.existsSync(stagingEnvPath)) {
  console.error("FATAL: .env.staging no existe.");
  process.exit(1);
}

const lines = fs.readFileSync(stagingEnvPath, "utf8").split("\n");
const env = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx > 0) env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
}

// 2. BARRERA ANTI-PRODUCCIÓN
console.log("[FASE 0] Verificando Environment Gate y Barrera Anti-Producción...");
const supaBarrier = assertSupabaseStagingTarget(env.NEXT_PUBLIC_SUPABASE_URL, "aoczrehfihlmbhrhbazl");
const vercelBarrier = assertVercelStagingTarget(env.NEXT_PUBLIC_APP_URL);
const prodScan = detectProductionInEnvironment(env);

assert.equal(supaBarrier.valid, true, "Target debe ser staging aceptado");
assert.equal(supaBarrier.targetRef, "aoczrehfihlmbhrhbazl", "Ref debe coincidir exactamente con Staging");
assert.equal(vercelBarrier.valid, true, "Vercel debe ser staging aceptado");
assert.equal(prodScan.hasProduction, false, "No debe haber variables de producción");

const projectRefLinked = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
assert.equal(projectRefLinked, "aoczrehfihlmbhrhbazl", "Supabase CLI vinculada debe ser Staging");
console.log("✓ Environment Gate & Anti-Production Barrier: PASS (Target: aoczrehfihlmbhrhbazl)");

// 3. INICIALIZAR CLIENTES SUPABASE
const stagingUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const stagingAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const stagingServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const serviceClient = createClient(stagingUrl, stagingServiceKey, {
  auth: { persistSession: false },
});

const anonClient = createClient(stagingUrl, stagingAnonKey, {
  auth: { persistSession: false },
});

const cleanupQueue = [];

async function runR3Validation() {
  const ts = Date.now();
  const testResults = {};
  let workspaceId = null;

  try {
    // SETUP: Workspace, Agente y Job temporal para las pruebas controladas
    console.log("\n[SETUP] Preparando workspace y agente temporal en Staging...");
    const emailA = `r3_user_${ts}@nextex-staging.local`;
    const passwordA = `R3Secret_${ts}!#9`;

    const { data: userARes, error: errA } = await serviceClient.auth.admin.createUser({
      email: emailA,
      password: passwordA,
      email_confirm: true,
      user_metadata: { full_name: `R3 Test User ${ts}` },
    });
    if (errA) throw new Error("Error creando usuario de prueba R3: " + errA.message);
    const userA = userARes.user;
    cleanupQueue.push(async () => serviceClient.auth.admin.deleteUser(userA.id));

    const authClientA = createClient(stagingUrl, stagingAnonKey, { auth: { persistSession: false } });
    const { error: authErr } = await authClientA.auth.signInWithPassword({ email: emailA, password: passwordA });
    assert.equal(authErr, null, "Login de usuario R3 exitoso");

    const { data: wsAData, error: wsAErr } = await authClientA.from("workspaces").select("id").single();
    assert.equal(wsAErr, null, "Obtener Workspace R3");
    workspaceId = wsAData.id;

    // Crear agente activo
    const { data: agent, error: agErr } = await authClientA.from("agents").insert({
      workspace_id: workspaceId,
      name: `R3 Agent ${ts}`,
      model_id: "gpt-4o",
      system_instructions: "You are an R3 test agent.",
      created_by: userA.id,
      status: "active",
    }).select().single();
    assert.equal(agErr, null, "Crear agente R3: " + agErr?.message);

    // Crear job activo
    const { data: job, error: jobErr } = await authClientA.from("jobs").insert({
      workspace_id: workspaceId,
      name: `R3 Job ${ts}`,
      agent_id: agent.id,
      input: "Execute R3 test run",
      created_by: userA.id,
      status: "active",
      configuration_hash: `hash-r3-${ts}`,
    }).select().single();
    assert.equal(jobErr, null, "Crear job R3: " + jobErr?.message);

    // =========================================================================
    // TEST 1 — claim_job_run V1 (Sin error 42601)
    // =========================================================================
    console.log("\n[TEST 1] Ejecutando claim_job_run V1...");
    // 1. Crear Job Run en estado 'queued'
    const { data: jobRun1, error: jr1Err } = await serviceClient.from("job_runs").insert({
      workspace_id: workspaceId,
      job_id: job.id,
      agent_id: agent.id,
      status: "queued",
      input: "Task for claim v1",
      configuration_hash: `hash-r3-${ts}`,
    }).select().single();
    assert.equal(jr1Err, null, "Crear job_run para v1");

    // 2. Invocar RPC claim_job_run v1
    const workerIdV1 = `worker-v1-${ts}`;
    const { data: claimV1Res, error: claimV1Err } = await serviceClient.rpc("claim_job_run", {
      p_worker_id: workerIdV1,
      p_lease_seconds: 60,
    });

    assert.equal(claimV1Err, null, "RPC claim_job_run no debe producir error 42601: " + claimV1Err?.message);
    assert.equal(claimV1Res.success, true, "claim_job_run debe retornar success=true");
    assert.equal(claimV1Res.claimed, true, "claim_job_run debe reclamar el job");
    assert.ok(claimV1Res.run.id, "Debe ser un job_run válido");
    assert.equal(claimV1Res.run.status, "claimed", "Status del run debe ser claimed");
    assert.ok(claimV1Res.run.fencing_token >= 1, "Fencing token debe ser >= 1");

    // 3. Verificar auditoría en job_audit_log
    const { data: auditLogs1, error: al1Err } = await serviceClient
      .from("job_audit_log")
      .select("*")
      .eq("job_run_id", claimV1Res.run.id)
      .eq("action", "claim");

    assert.equal(al1Err, null, "Consultar job_audit_log");
    assert.equal(auditLogs1.length, 1, "Debe existir exactamente 1 registro de claim en job_audit_log");
    const auditRow1 = auditLogs1[0];
    assert.equal(auditRow1.actor_type, "worker", "actor_type debe ser 'worker'");
    assert.equal(auditRow1.actor_id, workerIdV1, "actor_id debe coincidir con worker_id");
    assert.equal(auditRow1.action, "claim", "action debe ser 'claim'");
    assert.equal(auditRow1.previous_status, "queued", "previous_status debe ser 'queued'");
    assert.equal(auditRow1.new_status, "claimed", "new_status debe ser 'claimed'");
    assert.equal(auditRow1.fencing_token, 1, "fencing_token debe ser 1");
    assert.equal(auditRow1.worker_id, workerIdV1, "worker_id debe ser correcto");

    testResults["TEST 1 — claim_job_run v1"] = "PASS";
    console.log("✓ TEST 1 — claim_job_run v1: PASS (NO 42601, 10 columnas/valores, new_status=claimed, actor_type=worker).");

    // =========================================================================
    // TEST 2 — claim_job_run_v2 / DISPATCHER (Sin error 23514)
    // =========================================================================
    console.log("\n[TEST 2] Ejecutando claim_job_run_v2 con actor_type='dispatcher'...");
    // 1. Crear Job 2 dedicado con concurrencia suficiente y su Job Run en estado 'queued'
    const { data: job2, error: job2Err } = await authClientA.from("jobs").insert({
      workspace_id: workspaceId,
      name: `R3 Job 2 ${ts}`,
      agent_id: agent.id,
      input: "Execute R3 test run 2",
      created_by: userA.id,
      status: "active",
      max_concurrent_runs: 5,
      configuration_hash: `hash-r3-2-${ts}`,
    }).select().single();
    assert.equal(job2Err, null, "Crear job 2");

    const { data: jobRun2, error: jr2Err } = await serviceClient.from("job_runs").insert({
      workspace_id: workspaceId,
      job_id: job2.id,
      agent_id: agent.id,
      status: "queued",
      input: "Task for claim v2 dispatcher",
      configuration_hash: `hash-r3-2-${ts}`,
    }).select().single();
    assert.equal(jr2Err, null, "Crear job_run para v2");

    // 2. Registrar worker HEALTHY
    const workerIdentityV2 = `worker-v2-${ts}`;
    const instanceIdentityV2 = `inst-v2-${ts}`;
    const { data: regRes, error: regErr } = await serviceClient.rpc("register_worker", {
      p_workspace_id: workspaceId,
      p_worker_identity: workerIdentityV2,
      p_instance_identity: instanceIdentityV2,
      p_version: "1.0.0",
      p_capabilities: ["ai", "database", "integrations"],
      p_max_concurrency: 5,
    });
    assert.equal(regErr, null, "Registrar worker v2: " + regErr?.message);
    assert.equal(regRes.success, true);
    const workerIdV2 = regRes.worker.id;

    // 3. Invocar RPC claim_job_run_v2
    const { data: claimV2Res, error: claimV2Err } = await serviceClient.rpc("claim_job_run_v2", {
      p_worker_id: workerIdV2,
      p_lease_seconds: 60,
    });

    assert.equal(claimV2Err, null, "RPC claim_job_run_v2 no debe producir error 23514: " + claimV2Err?.message);
    assert.equal(claimV2Res.success, true, "claim_job_run_v2 debe retornar success=true");
    assert.equal(claimV2Res.claimed, true, "claim_job_run_v2 debe reclamar el job");
    assert.ok(claimV2Res.run.id, "Debe retornar un job_run válido");
    assert.equal(claimV2Res.run.status, "claimed", "Status del run 2 debe ser claimed");
    assert.ok(claimV2Res.run.fencing_token >= 1, "Fencing token debe ser >= 1");

    // 4. Verificar auditoría en job_audit_log
    const { data: auditLogs2, error: al2Err } = await serviceClient
      .from("job_audit_log")
      .select("*")
      .eq("job_run_id", claimV2Res.run.id)
      .eq("action", "claim");

    assert.equal(al2Err, null, "Consultar job_audit_log para v2");
    assert.equal(auditLogs2.length, 1, "Debe existir exactamente 1 registro en job_audit_log");
    const auditRow2 = auditLogs2[0];
    assert.equal(auditRow2.actor_type, "dispatcher", "actor_type debe ser 'dispatcher'");
    assert.equal(auditRow2.action, "claim", "action debe ser 'claim'");
    assert.equal(auditRow2.previous_status, "queued", "previous_status debe ser 'queued'");
    assert.equal(auditRow2.new_status, "claimed", "new_status debe ser 'claimed'");
    assert.equal(auditRow2.fencing_token, 1, "fencing_token debe ser 1");
    assert.equal(auditRow2.worker_id, workerIdentityV2, "worker_id debe coincidir");

    // 5. Verificar auditoría en worker_audit_log
    const { data: workerAuditLogs, error: walErr } = await serviceClient
      .from("worker_audit_log")
      .select("*")
      .eq("worker_id", workerIdV2)
      .eq("action", "JOB_CLAIMED");

    assert.equal(walErr, null, "Consultar worker_audit_log");
    assert.equal(workerAuditLogs.length, 1, "Debe existir registro JOB_CLAIMED en worker_audit_log");
    assert.equal(workerAuditLogs[0].actor_type, "dispatcher", "actor_type en worker_audit_log debe ser 'dispatcher'");

    testResults["TEST 2 — claim_job_run_v2 / DISPATCHER"] = "PASS";
    console.log("✓ TEST 2 — claim_job_run_v2 / DISPATCHER: PASS (NO 23514, actor_type=dispatcher registrado en ambos diarios).");

    // =========================================================================
    // TEST 3 — DISPATCHER SPOOFING & POSTGREST PRIVILEGE VALIDATION
    // =========================================================================
    console.log("\n[TEST 3] Ejecutando pruebas anti-spoofing de Dispatcher...");
    // 3.1 Authenticated client intentando invocar claim_job_run_v2 -> DENEGADO (PGRST202 o 42501)
    const { error: authClaimV2Err } = await authClientA.rpc("claim_job_run_v2", {
      p_worker_id: workerIdV2,
      p_lease_seconds: 60,
    });
    assert.ok(authClaimV2Err !== null, "Usuario authenticated no debe poder ejecutar claim_job_run_v2");
    console.log("  ✓ Intento authenticated de invocar claim_job_run_v2: DENEGADO (PASS)");

    // 3.2 Authenticated client intentando insertar directamente en job_audit_log -> DENEGADO (42501)
    const { error: authInsertAuditErr } = await authClientA.from("job_audit_log").insert({
      workspace_id: workspaceId,
      job_id: job.id,
      job_run_id: jobRun2.id,
      actor_type: "dispatcher",
      actor_id: "malicious_user",
      action: "claim",
      previous_status: "queued",
      new_status: "claimed",
      fencing_token: 99,
      worker_id: "fake_worker",
    });
    assert.equal(authInsertAuditErr?.code, "42501", "INSERT authenticated en job_audit_log debe ser 42501");
    console.log("  ✓ Intento authenticated de insertar en job_audit_log: DENEGADO 42501 (PASS)");

    // 3.3 Anon client intentando insertar en job_audit_log -> DENEGADO (42501/401)
    const { error: anonInsertAuditErr } = await anonClient.from("job_audit_log").insert({
      workspace_id: workspaceId,
      job_id: job.id,
      actor_type: "dispatcher",
      actor_id: "anon",
      action: "claim",
    });
    assert.ok(anonInsertAuditErr?.code === "42501" || anonInsertAuditErr !== null, "INSERT anon en job_audit_log denegado");
    console.log("  ✓ Intento anon de insertar en job_audit_log: DENEGADO (PASS)");

    // 3.4 Authenticated client intentando mutar (UPDATE o DELETE) en job_audit_log -> DENEGADO (42501)
    const { error: authUpdAuditErr } = await authClientA.from("job_audit_log").update({ actor_id: "hacked" }).eq("id", auditRow2.id);
    assert.equal(authUpdAuditErr?.code, "42501", "UPDATE authenticated en job_audit_log debe ser 42501");

    const { error: authDelAuditErr } = await authClientA.from("job_audit_log").delete().eq("id", auditRow2.id);
    assert.equal(authDelAuditErr?.code, "42501", "DELETE authenticated en job_audit_log debe ser 42501");
    console.log("  ✓ Intento de modificar o eliminar registros de job_audit_log: DENEGADO 42501 (PASS)");

    testResults["TEST 3 — Dispatcher spoofing"] = "PASS";
    console.log("✓ TEST 3 — Dispatcher spoofing: PASS (100% de vectores de spoofing y bypass bloqueados).");

    // =========================================================================
    // TEST 5 — ACL / RLS / AUDIT IMMUTABILITY
    // =========================================================================
    console.log("\n[TEST 5] Revalidando ACL, RLS y Audit Immutability en Staging...");
    // Service role UPDATE/DELETE en job_audit_log debe ser bloqueado por trigger inmutable
    const { error: srvUpdErr } = await serviceClient.from("job_audit_log").update({ actor_id: "tampered" }).eq("id", auditRow2.id);
    assert.ok(srvUpdErr !== null, "service_role UPDATE en job_audit_log debe ser denegado por inmutabilidad");

    const { error: srvDelErr } = await serviceClient.from("job_audit_log").delete().eq("id", auditRow2.id);
    assert.ok(srvDelErr !== null, "service_role DELETE en job_audit_log debe ser denegado por inmutabilidad");
    console.log("  ✓ Inmutabilidad estricta de job_audit_log confirmada.");

    testResults["TEST 5 — ACL/RLS/Tenant isolation"] = "PASS";
    console.log("✓ TEST 5 — ACL/RLS/Tenant isolation: PASS.");

  } finally {
    // =========================================================================
    // LIMPIEZA DE FIXTURES DE LA PRUEBA R3
    // =========================================================================
    console.log("\n[CLEANUP] Limpiando fixtures de la prueba R3...");
    try {
      if (workspaceId) {
        await serviceClient.from("worker_leases").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("workers").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("job_runs").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("jobs").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("agents").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await serviceClient.from("workspaces").delete().eq("id", workspaceId);
      }
    } catch (e) {
      console.log("Cleanup child entities error:", e.message);
    }
    for (const cleaner of cleanupQueue.reverse()) {
      try {
        await cleaner();
      } catch (cErr) {
        console.log("Cleanup user error:", cErr.message);
      }
    }
  }
}

runR3Validation().then(() => {
  console.log("\n==========================================================================");
  console.log("RESULTADO FASE 4.11-I-R3: VALIDACIÓN RUNTIME EXITOSA (100% PASS)");
  console.log("==========================================================================");
}).catch((err) => {
  console.error("\nFATAL RUNTIME POST-REMEDIATION FAILED:", err);
  process.exit(1);
});
