/**
 * NEXTEХ — Suite de Auditoría de Esquema Físico (Fase 4.7): Integrations & External Events
 * Script de Solo Lectura (READ-ONLY) para Verificación Post-Migración en Supabase Cloud.
 * NOTA: No debe ejecutarse durante la implementación local.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("==========================================================================");
  console.log("NEXTEХ — AUDITORÍA FÍSICA CLOUD (FASE 4.7): SCRIPT PREPARADO");
  console.log("AVISO: Credenciales de Cloud no configuradas en entorno local.");
  console.log("Este script está listo para ser ejecutado contra Supabase Cloud una vez");
  console.log("aplicada la migración 20261007_integrations_and_external_events.sql.");
  console.log("==========================================================================");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function runReadOnlyAudit() {
  console.log("==========================================================================");
  console.log("NEXTEХ — AUDITORÍA FÍSICA CLOUD: INTEGRATIONS & EXTERNAL EVENTS (FASE 4.7)");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("Modo: STRICTLY READ-ONLY (Cero Mutaciones)");
  console.log("==========================================================================\n");

  let totalChecks = 0;
  let passedChecks = 0;

  function report(name, passed, detail = "") {
    totalChecks++;
    if (passed) {
      passedChecks++;
      console.log(`[PASS] ${name}${detail ? ` -> ${detail}` : ""}`);
    } else {
      console.error(`[FAIL] ${name}${detail ? ` -> ${detail}` : ""}`);
    }
  }

  try {
    // 1. Validar existencia de tablas de Fase 4.7
    const tables = [
      "integrations",
      "integration_endpoints",
      "integration_events",
      "integration_event_attempts",
      "integration_event_audit_log",
    ];

    for (const tbl of tables) {
      const { error } = await supabase.from(tbl).select("id").limit(1);
      report(`Tabla public.${tbl} accesible`, !error || error.code === "PGRST116", error?.message || "OK");
    }

    // 2. Validar catálogo de permisos (debe contener 52 permisos canónicos)
    const { data: perms, error: permErr } = await supabase.from("permissions").select("key, category");
    if (!permErr && perms) {
      report("Catálogo de permisos canónicos cuenta con 52 registros", perms.length === 52, `Total: ${perms.length}`);
      const integPerms = perms.filter((p) => p.category === "integrations" || p.category === "integration_events");
      report("Categorías integrations e integration_events presentes", integPerms.length === 11, `Total encontrados: ${integPerms.length}/11`);
    } else {
      report("Lectura de permisos canónicos", false, permErr?.message);
    }

    // 3. Validar columnas extendidas en jobs y job_runs
    const { error: jobErr } = await supabase.from("jobs").select("trigger_type").limit(1);
    report("jobs.trigger_type disponible", !jobErr, jobErr?.message || "OK");

    const { error: runErr } = await supabase.from("job_runs").select("event_id").limit(1);
    report("job_runs.event_id disponible", !runErr, runErr?.message || "OK");

    console.log("\n==========================================================================");
    console.log(`RESUMEN DE AUDITORÍA FÍSICA CLOUD: ${passedChecks}/${totalChecks} VERIFICACIONES EXITOSAS`);
    console.log("==========================================================================");
  } catch (err) {
    console.error("Error durante la auditoría física Cloud:", err);
  }
}

runReadOnlyAudit();
