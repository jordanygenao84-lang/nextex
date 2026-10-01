/**
 * NEXTEХ — Suite de Validación y Seguridad Cloud (Fase 4.6): Durable Jobs & Automation
 * Cobertura de Escenarios Críticos de Comportamiento Remoto
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE DE PRUEBAS CLOUD (FASE 4.6): SCRIPT PREPARADO");
  console.log("AVISO: Credenciales de Cloud no configuradas en entorno local.");
  console.log("==========================================================================");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function runCloudJobsTests() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE DE VALIDACIÓN CLOUD (FASE 4.6): DURABLE JOBS & AUTOMATION");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("==========================================================================\n");

  let passed = 0;
  let total = 0;

  function record(scenario, name, ok, details = "") {
    total++;
    if (ok) {
      passed++;
      console.log(`✓ [ESCENARIO ${scenario}] ${name} ${details ? `(${details})` : ""}`);
    } else {
      console.error(`✗ [ESCENARIO ${scenario}] FALLÓ: ${name} — ${details}`);
    }
  }

  try {
    // A. Reclamo con worker_id vacío
    const { data: resA } = await supabase.rpc("claim_job_run", {
      p_worker_id: "",
      p_lease_seconds: 60,
    });
    record("A", "Worker ID Vacío Rechazado", resA?.success === false, resA?.error_code || "OK");

    // B. Direct INSERT a job_runs bloqueado por RLS
    const { error: errB } = await supabase.from("job_runs").insert({
      workspace_id: "00000000-0000-0000-0000-000000000000",
      job_id: "00000000-0000-0000-0000-000000000000",
      agent_id: "00000000-0000-0000-0000-000000000000",
      input: "test injection",
    });
    record("B", "Direct INSERT a job_runs Bloqueado", errB !== null, "RLS activo");

    // C. Direct INSERT a job_audit_log bloqueado por RLS
    const { error: errC } = await supabase.from("job_audit_log").insert({
      workspace_id: "00000000-0000-0000-0000-000000000000",
      job_id: "00000000-0000-0000-0000-000000000000",
      actor_type: "user",
      actor_id: "forged",
      action: "fake_action",
    });
    record("C", "Direct INSERT a job_audit_log Bloqueado", errC !== null, "RLS activo");

    // D. Heartbeat sobre run inexistente
    const { data: resD } = await supabase.rpc("heartbeat_job_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "fake-worker",
      p_fencing_token: 1,
    });
    record("D", "Heartbeat sobre Run Inexistente Rechazado", resD?.success === false, resD?.error_code || "OK");

    // E. Completion sobre run inexistente
    const { data: resE } = await supabase.rpc("complete_job_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "fake-worker",
      p_fencing_token: 1,
    });
    record("E", "Completion sobre Run Inexistente Rechazado", resE?.success === false, resE?.error_code || "OK");

    // F. Failure/Retry sobre run inexistente
    const { data: resF } = await supabase.rpc("fail_job_run_and_schedule_retry", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "fake-worker",
      p_fencing_token: 1,
      p_error_code: "TEST",
      p_error_message: "Test message",
    });
    record("F", "Fail/Retry sobre Run Inexistente Rechazado", resF?.success === false, resF?.error_code || "OK");

    // G. Release for approval sobre run inexistente
    const { data: resG } = await supabase.rpc("release_job_run_for_approval", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "fake-worker",
      p_fencing_token: 1,
    });
    record("G", "Release Approval sobre Run Inexistente Rechazado", resG?.success === false, resG?.error_code || "OK");

    // H. Checkpoint requeue sobre run inexistente
    const { data: resH } = await supabase.rpc("checkpoint_and_requeue_job_run", {
      p_run_id: "00000000-0000-0000-0000-000000000000",
      p_worker_id: "fake-worker",
      p_fencing_token: 1,
    });
    record("H", "Checkpoint Requeue sobre Run Inexistente Rechazado", resH?.success === false, resH?.error_code || "OK");

    // I. Recover stale job runs (ejecución segura)
    const { data: resI } = await supabase.rpc("recover_stale_job_runs", {
      p_timeout_grace_seconds: 15,
    });
    record("I", "Recover Stale Job Runs Operativo", resI?.success === true, `recuperados: ${resI?.recovered_count ?? 0}`);

    // J. Generate schedule occurrences (ejecución segura)
    const { data: resJ } = await supabase.rpc("generate_schedule_occurrences");
    record("J", "Generate Schedule Occurrences Operativo", resJ?.success === true, `spawned: ${resJ?.spawned_count ?? 0}`);

  } catch (err) {
    console.error("Excepción en pruebas Cloud:", err.message);
  }

  console.log("\n--------------------------------------------------------------------------");
  console.log(`RESULTADO DE VALIDACIÓN CLOUD FASE 4.6: ${passed}/${total} ESCENARIOS SUPERADOS`);
  console.log("--------------------------------------------------------------------------\n");

  if (passed < total) {
    process.exit(1);
  }
}

runCloudJobsTests();
