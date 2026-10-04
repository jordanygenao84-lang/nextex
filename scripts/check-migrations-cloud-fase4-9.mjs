/**
 * Verificación de Migraciones y Objetos en Supabase Cloud para Fase 4.9.1
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("No se encontraron credenciales en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

async function checkCloudSchema() {
  console.log("==========================================================================");
  console.log("NEXTEХ — INSPECCIÓN DE ESQUEMA REMOTO EN SUPABASE CLOUD");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("==========================================================================\n");

  // 1. Verificar tabla observability_spans (Migración 20261008)
  const { data: spans, error: spansErr } = await supabase.from("observability_spans").select("id").limit(1);
  const mig20261008Exists = !spansErr || spansErr.code === "PGRST116" || spansErr.message?.includes("0 rows");
  console.log("MIGRACIÓN 20261008 (observability_spans):", spansErr ? `Error: [${spansErr.code}] ${spansErr.message}` : "PRESENTE EN CLOUD (Tabla existe)");

  // 2. Verificar función execute_authorized_database_write
  const { data: rpcRes, error: rpcErr } = await supabase.rpc("execute_authorized_database_write", {
    p_run_id: "00000000-0000-0000-0000-000000000000",
    p_step_id: "00000000-0000-0000-0000-000000000000",
    p_execution_id: "00000000-0000-0000-0000-000000000000",
    p_fencing_token: 0,
    p_expected_payload_hash: "",
  });

  console.log("RPC execute_authorized_database_write:", rpcRes ? JSON.stringify(rpcRes) : `Error: [${rpcErr?.code}] ${rpcErr?.message}`);

  // 3. Iniciar sesión con User A para verificar comportamiento autenticado
  const userAEmail = process.env.TEST_USER_A_EMAIL;
  const userAPassword = process.env.TEST_USER_A_PASSWORD;

  if (userAEmail && userAPassword) {
    const authClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: authData, error: authErr } = await authClient.auth.signInWithPassword({
      email: userAEmail,
      password: userAPassword,
    });

    if (authErr) {
      console.log("Auth User A falló:", authErr.message);
    } else {
      console.log("Auth User A:", authData.user?.email, "ID:", authData.user?.id);
      const { data: authRpcRes, error: authRpcErr } = await authClient.rpc("execute_authorized_database_write", {
        p_run_id: "00000000-0000-0000-0000-000000000000",
        p_step_id: "00000000-0000-0000-0000-000000000000",
        p_execution_id: "00000000-0000-0000-0000-000000000000",
        p_fencing_token: 0,
        p_expected_payload_hash: "",
      });
      console.log("RPC execute_authorized_database_write (User A Authenticated):", authRpcRes ? JSON.stringify(authRpcRes) : `Error: [${authRpcErr?.code}] ${authRpcErr?.message}`);
    }
  }
}

checkCloudSchema().catch(console.error);
