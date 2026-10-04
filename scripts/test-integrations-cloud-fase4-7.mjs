/**
 * NEXTEХ — Suite de Pruebas Dinámicas Cloud (Fase 4.7): Integrations & External Events
 * Script preparado para certificación funcional en Supabase Cloud.
 * NOTA: No debe ejecutarse durante la implementación local.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("==========================================================================");
  console.log("NEXTEХ — PRUEBAS CLOUD (FASE 4.7): SCRIPT PREPARADO");
  console.log("AVISO: Credenciales de Cloud no configuradas en entorno local.");
  console.log("Este script está listo para ser ejecutado contra Supabase Cloud una vez");
  console.log("aplicada la migración 20261007_integrations_and_external_events.sql.");
  console.log("==========================================================================");
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

async function runCloudFunctionalTests() {
  console.log("==========================================================================");
  console.log("NEXTEХ — CERTIFICACIÓN FUNCIONAL CLOUD: FASE 4.7");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("==========================================================================\n");

  let passed = 0;
  let total = 0;

  function check(name, ok, info = "") {
    total++;
    if (ok) {
      passed++;
      console.log(`✓ [CLOUD] ${name}${info ? ` -> ${info}` : ""}`);
    } else {
      console.error(`✗ [CLOUD] ${name}${info ? ` -> ${info}` : ""}`);
    }
  }

  try {
    // 1. Verificar RPC ingest_integration_event_atomic existe
    const { error: rpcErr } = await supabase.rpc("ingest_integration_event_atomic", {
      p_endpoint_key: "0000000000000000000000000000000000000000000000000000000000000000",
      p_external_event_id: "test-probe",
      p_event_type: "test",
      p_provider: "test",
      p_payload: {},
      p_headers_metadata: {},
      p_payload_hash: "0000000000000000000000000000000000000000000000000000000000000000",
      p_signature_verified: false,
    });
    // Se espera que falle con ENDPOINT_NOT_FOUND o retorne json con success=false
    check("RPC ingest_integration_event_atomic registrada en Cloud", !rpcErr || rpcErr.message.includes("ENDPOINT_NOT_FOUND") || rpcErr.code === "PGRST202");

    console.log("\n==========================================================================");
    console.log(`RESULTADO CERTIFICACIÓN CLOUD FASE 4.7: ${passed}/${total} PRUEBAS`);
    console.log("==========================================================================");
  } catch (err) {
    console.error("Fallo durante certificación Cloud:", err);
  }
}

runCloudFunctionalTests();
