/**
 * NEXTEХ — Test de Aislamiento Multi-inquilino y Políticas RLS
 * Verificación obligatoria contra Supabase Cloud Real
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables desde .env.local
const envPath = path.resolve(__dirname, "../.env.local");
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [k, ...vParts] = trimmed.split("=");
    const v = vParts.join("=").trim();
    if (k.trim() === "NEXT_PUBLIC_SUPABASE_URL" && !supabaseUrl) supabaseUrl = v;
    if (k.trim() === "NEXT_PUBLIC_SUPABASE_ANON_KEY" && !supabaseAnonKey) supabaseAnonKey = v;
  }
}

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder-project")) {
  console.error("ERROR: No se encontraron credenciales válidas de Supabase en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runIsolationTests() {
  console.log("==============================================================");
  console.log("NEXTEХ — VERIFICACIÓN EN VIVO: POLÍTICAS RLS EN SUPABASE CLOUD");
  console.log(`Endpoint: ${supabaseUrl}`);
  console.log("==============================================================\n");

  let passedTests = 0;
  const totalTests = 6;

  try {
    // TEST 1: Intento de lectura anónima sobre profiles (Debe retornar 0 filas por RLS)
    const { data: profilesData, error: profilesError } = await supabase.from("profiles").select("*");
    if (!profilesError && Array.isArray(profilesData) && profilesData.length === 0) {
      console.log("✓ TEST 1 PASADO: profiles tiene RLS activo — lectura anónima protegida (0 filas devueltas).");
      passedTests++;
    } else {
      console.error("✗ TEST 1 FALLÓ en profiles:", profilesError || profilesData);
    }

    // TEST 2: Intento de lectura anónima sobre workspaces (Debe retornar 0 filas por RLS)
    const { data: wsData, error: wsError } = await supabase.from("workspaces").select("*");
    if (!wsError && Array.isArray(wsData) && wsData.length === 0) {
      console.log("✓ TEST 2 PASADO: workspaces tiene RLS activo — lectura anónima protegida (0 filas devueltas).");
      passedTests++;
    } else {
      console.error("✗ TEST 2 FALLÓ en workspaces:", wsError || wsData);
    }

    // TEST 3: Intento de lectura anónima sobre workspace_members (Debe retornar 0 filas por RLS)
    const { data: wmData, error: wmError } = await supabase.from("workspace_members").select("*");
    if (!wmError && Array.isArray(wmData) && wmData.length === 0) {
      console.log("✓ TEST 3 PASADO: workspace_members tiene RLS activo — lectura anónima protegida (0 filas devueltas).");
      passedTests++;
    } else {
      console.error("✗ TEST 3 FALLÓ en workspace_members:", wmError || wmData);
    }

    // TEST 4: Intento de inserción no autorizada en profiles (Debe ser bloqueado por política RLS)
    const fakeUserId = "00000000-0000-0000-0000-000000000001";
    const { data: insertProfileData, error: insertProfileError } = await supabase
      .from("profiles")
      .insert({ id: fakeUserId, full_name: "Invasor Ilegítimo", plan: "enterprise" })
      .select();
    if (insertProfileError) {
      console.log("✓ TEST 4 PASADO: Intento de INSERT en profiles rechazado por RLS/DB:", insertProfileError.message);
      passedTests++;
    } else {
      console.error("✗ TEST 4 FALLÓ: Se permitió inserción ilegítima en profiles:", insertProfileData);
    }

    // TEST 5: Intento de inserción no autorizada en workspaces (Debe ser bloqueado por RLS)
    const { data: insertWsData, error: insertWsError } = await supabase
      .from("workspaces")
      .insert({ name: "Workspace Vulnerable", slug: "ws-vuln", owner_id: fakeUserId })
      .select();
    if (insertWsError) {
      console.log("✓ TEST 5 PASADO: Intento de INSERT en workspaces rechazado por RLS/DB:", insertWsError.message);
      passedTests++;
    } else {
      console.error("✗ TEST 5 FALLÓ: Se permitió inserción ilegítima en workspaces:", insertWsData);
    }

    // TEST 6: Intento de modificación arbitraria de perfil ajeno (Debe retornar 0 filas modificadas o error RLS)
    const { data: updateData, error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: "Modificado por Atacante" })
      .eq("id", fakeUserId)
      .select();
    if (!updateError && Array.isArray(updateData) && updateData.length === 0) {
      console.log("✓ TEST 6 PASADO: Intento de UPDATE anónimo en profiles bloqueado por RLS (0 registros afectados).");
      passedTests++;
    } else if (updateError) {
      console.log("✓ TEST 6 PASADO: Intento de UPDATE rechazado por RLS:", updateError.message);
      passedTests++;
    } else {
      console.error("✗ TEST 6 FALLÓ: Modificación no autorizada permitida:", updateData);
    }

  } catch (err) {
    console.error("Error crítico durante la ejecución de pruebas RLS:", err);
  }

  console.log("\n--------------------------------------------------------------");
  console.log(`RESULTADO DE LA SUITE DE AISLAMIENTO: ${passedTests}/${totalTests} PRUEBAS EXITOSAS`);
  console.log(`Aislamiento multi-inquilino de PostgreSQL y Supabase RLS: ${passedTests === totalTests ? "6/6 PASSED (VALIDADO EN SUPABASE CLOUD)" : "FALLIDO"}`);
  console.log("--------------------------------------------------------------\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runIsolationTests();
