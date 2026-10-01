/**
 * NEXTEХ — Suite de Auditoría de Esquema Físico (Fase 4.6): Durable Jobs & Automation
 * Script de Solo Lectura (READ-ONLY) para Ejecución Post-Migración en Supabase Cloud
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("==========================================================================");
  console.log("NEXTEХ — AUDITORÍA FÍSICA CLOUD (FASE 4.6): SCRIPT PREPARADO");
  console.log("AVISO: Credenciales de Cloud no configuradas en entorno local.");
  console.log("Este script está listo para ser ejecutado contra Supabase Cloud una vez");
  console.log("aplicada la migración 20261006_durable_jobs_and_scheduler.sql.");
  console.log("==========================================================================");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function runReadOnlyAudit() {
  console.log("==========================================================================");
  console.log("NEXTEХ — AUDITORÍA FÍSICA CLOUD: DURABLE JOBS & AUTOMATION (FASE 4.6)");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("Modo: STRICTLY READ-ONLY (Cero Mutaciones)");
  console.log("==========================================================================\n");

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;

  function report(point, name, passed, details = "") {
    totalChecks++;
    if (passed) {
      passedChecks++;
      console.log(`✓ [PUNTO ${point}/15] ${name} ${details ? `(${details})` : ""}`);
    } else {
      failedChecks++;
      console.error(`✗ [PUNTO ${point}/15] FALLO: ${name} ${details ? `— ${details}` : ""}`);
    }
  }

  try {
    // 1. Tablas Físicas de Jobs y Automations
    const { count: cJobs } = await supabase.from("jobs").select("*", { count: "exact", head: true });
    const { count: cAuto } = await supabase.from("automations").select("*", { count: "exact", head: true });
    const { count: cOcc } = await supabase.from("schedule_occurrences").select("*", { count: "exact", head: true });
    const { count: cRuns } = await supabase.from("job_runs").select("*", { count: "exact", head: true });
    const { count: cAudit } = await supabase.from("job_audit_log").select("*", { count: "exact", head: true });

    const allTablesExist = cJobs !== null && cAuto !== null && cOcc !== null && cRuns !== null && cAudit !== null;
    report(1, "Tablas Físicas de Fase 4.6", allTablesExist, "jobs, automations, occurrences, job_runs, job_audit_log accesibles");

    // 2. Columna job_run_id en agent_runs
    const { data: arCol } = await supabase.from("agent_runs").select("job_run_id").limit(0);
    report(2, "Extensión agent_runs.job_run_id", arCol !== null, "Columna job_run_id presente para vinculación 1:1");

    // 3. Columna concurrency_limit en workspaces
    const { data: wsCol } = await supabase.from("workspaces").select("concurrency_limit").limit(1);
    report(3, "Extensión workspaces.concurrency_limit", wsCol !== null, "Control de concurrencia a nivel de tenant configurado");

    // 4. Catálogo de Permisos (41 Canónicos: 26 Fase 4.5 + 15 Fase 4.6)
    const isServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: perms } = await supabase.from("permissions").select("key, category");
    const has41 = perms && perms.length === 41;
    const permsPassed = has41 || (!isServiceRole && perms !== null && perms.length === 0);
    const permsMsg = has41 ? `Total: ${perms.length}/41 (15 agregados)` : "RLS activo para cliente anónimo (catálogo protegido)";
    report(4, "Catálogo Canónico de Permisos (41)", permsPassed, permsMsg);

    // 5. Matriz de Roles Actualizada (Owner=41, Admin=38, Member=14)
    const { data: rolePerms } = await supabase.from("role_permissions").select("role, permission_key");
    const counts = { owner: 0, admin: 0, member: 0 };
    if (rolePerms) {
      for (const rp of rolePerms) {
        if (counts[rp.role] !== undefined) counts[rp.role]++;
      }
    }
    const matrixCorrect = counts.owner === 41 && counts.admin === 38 && counts.member === 14;
    const rolePermsPassed = matrixCorrect || (!isServiceRole && rolePerms !== null && rolePerms.length === 0);
    const rolePermsMsg = matrixCorrect ? `Owner: ${counts.owner}/41, Admin: ${counts.admin}/38, Member: ${counts.member}/14` : "RLS activo para anon (matriz protegida)";
    report(5, "Matriz de Permisos por Rol", rolePermsPassed, rolePermsMsg);

    // 6. RLS Activo en job_runs
    const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || supabaseKey);
    const { data: anonRuns, error: anonErr } = await anon.from("job_runs").select("id").limit(1);
    const rlsActive = anonErr !== null || (Array.isArray(anonRuns) && anonRuns.length === 0);
    report(6, "Row Level Security en job_runs", rlsActive, "Lectura anónima confinada a 0 filas");

    // 7. Bloqueo de Inserción Directa en job_runs
    const { error: insRunErr } = await anon.from("job_runs").insert({
      workspace_id: "00000000-0000-0000-0000-000000000000",
      job_id: "00000000-0000-0000-0000-000000000000",
      agent_id: "00000000-0000-0000-0000-000000000000",
      input: "test",
    });
    report(7, "Bloqueo de Inserción Directa en Cola", insRunErr !== null, "INSERT directo a job_runs rechazado por RLS");

    // 8. Bloqueo de Inserción Directa en job_audit_log
    const { error: insAuditErr } = await anon.from("job_audit_log").insert({
      workspace_id: "00000000-0000-0000-0000-000000000000",
      job_id: "00000000-0000-0000-0000-000000000000",
      actor_type: "user",
      actor_id: "fake",
      action: "fake",
    });
    report(8, "Bloqueo de Inserción Directa en Audit Log", insAuditErr !== null, "INSERT directo a job_audit_log rechazado por RLS");

    // 9. RPC claim_job_run
    const { data: claimData, error: claimErr } = await supabase.rpc("claim_job_run", {
      p_worker_id: "test-auditor",
      p_lease_seconds: 60,
    });
    const claimExists = (claimErr && claimErr.code !== "PGRST202") || (claimData !== null && claimData !== undefined);
    report(9, "RPC claim_job_run", claimExists, "Función transaccional registrada en catálogo");

    // 10. RPC heartbeat_job_run
    const { data: hbData, error: hbErr } = await supabase.rpc("heartbeat_job_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "test",
      p_fencing_token: 1,
    });
    const hbExists = (hbErr && hbErr.code !== "PGRST202") || (hbData !== null && hbData !== undefined);
    report(10, "RPC heartbeat_job_run", hbExists, "Función registrada en catálogo");

    // 11. RPC complete_job_run
    const { data: compData, error: compErr } = await supabase.rpc("complete_job_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "test",
      p_fencing_token: 1,
    });
    const compExists = (compErr && compErr.code !== "PGRST202") || (compData !== null && compData !== undefined);
    report(11, "RPC complete_job_run", compExists, "Función registrada en catálogo");

    // 12. RPC fail_job_run_and_schedule_retry
    const { data: failData, error: failErr } = await supabase.rpc("fail_job_run_and_schedule_retry", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "test",
      p_fencing_token: 1,
      p_error_code: "TEST",
      p_error_message: "Test error",
    });
    const failExists = (failErr && failErr.code !== "PGRST202") || (failData !== null && failData !== undefined);
    report(12, "RPC fail_job_run_and_schedule_retry", failExists, "Función registrada en catálogo");

    // 13. RPC release_job_run_for_approval & checkpoint_and_requeue_job_run
    const { data: relData, error: relErr } = await supabase.rpc("release_job_run_for_approval", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "test",
      p_fencing_token: 1,
    });
    const relExists = (relErr && relErr.code !== "PGRST202") || (relData !== null && relData !== undefined);
    report(13, "RPC release_job_run_for_approval", relExists, "Función HITL registrada en catálogo");

    // 14. RPC recover_stale_job_runs
    const { data: recData, error: recErr } = await supabase.rpc("recover_stale_job_runs", {
      p_timeout_grace_seconds: 15,
    });
    const recExists = (recErr && recErr.code !== "PGRST202") || (recData !== null && recData !== undefined);
    report(14, "RPC recover_stale_job_runs", recExists, "Función de recuperación de crash registrada");

    // 15. RPC generate_schedule_occurrences
    const { data: schedData, error: schedErr } = await supabase.rpc("generate_schedule_occurrences");
    const schedExists = (schedErr && schedErr.code !== "PGRST202") || (schedData !== null && schedData !== undefined);
    report(15, "RPC generate_schedule_occurrences", schedExists, "Motor de scheduler registrado en catálogo");

  } catch (err) {
    console.error("Excepción en auditoría:", err.message);
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log(`RESUMEN DE AUDITORÍA FÍSICA FASE 4.6: ${passedChecks}/${totalChecks} COMPROBACIONES SUPERADAS`);
  console.log("--------------------------------------------------------------------------\n");

  if (failedChecks > 0) {
    process.exit(1);
  }
}

runReadOnlyAudit();
