/**
 * NEXTEХ — Suite de Validación Anti-Producción & Staging Provisioning (Fase 4.11-H0)
 *
 * Valida de forma estricta:
 * 1. Rechazo inmediato de targets de producción Supabase (PRODUCTION_TARGET_REJECTED).
 * 2. Aceptación limpia de targets legítimos de staging (STAGING_TARGET_ACCEPTED).
 * 3. Rechazo inmediato del dominio de producción Vercel (PRODUCTION_VERCEL_TARGET_REJECTED).
 * 4. Aceptación de dominios preview/staging en Vercel (STAGING_VERCEL_TARGET_ACCEPTED).
 * 5. Detección automática de variables de producción en entornos cargados.
 * 6. Integridad de aislamiento de archivos de entorno (.env.local protegido, .env.staging ignorado).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import {
  assertSupabaseStagingTarget,
  assertVercelStagingTarget,
  detectProductionInEnvironment,
  extractSupabaseRef,
  AntiProductionBarrierError,
  KNOWN_PRODUCTION_REFS,
  KNOWN_PRODUCTION_SUPABASE_URLS,
  KNOWN_PRODUCTION_VERCEL_URLS,
} from "../src/lib/staging/anti-production-barrier.ts";

console.log("==========================================================================");
console.log("NEXTEХ — SUITE OFICIAL FASE 4.11-H0: ANTI-PRODUCTION BARRIER VALIDATION");
console.log("==========================================================================\n");

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`✓ [TEST ${String(total).padStart(2, "0")}] ${name}: PASS`);
  } catch (err) {
    console.error(`✗ [TEST ${String(total).padStart(2, "0")}] ${name}: FAIL ->`, err.message);
    throw err;
  }
}

// 1. PRODUCTION TARGET REJECTION (Ref corto)
test("Rechazo de PRODUCTION_REF corto ('vvpdycuclnoptffwmrvb')", () => {
  let caught = false;
  try {
    assertSupabaseStagingTarget("vvpdycuclnoptffwmrvb");
  } catch (err) {
    if (err instanceof AntiProductionBarrierError && err.code === "PRODUCTION_TARGET_REJECTED") {
      caught = true;
    }
  }
  assert.equal(caught, true, "Debe rechazar project ref de producción");
});

// 2. PRODUCTION TARGET REJECTION (Ref largo)
test("Rechazo de PRODUCTION_REF largo ('vvpdycuclnoptffwmrvb5')", () => {
  let caught = false;
  try {
    assertSupabaseStagingTarget("vvpdycuclnoptffwmrvb5");
  } catch (err) {
    if (err instanceof AntiProductionBarrierError && err.code === "PRODUCTION_TARGET_REJECTED") {
      caught = true;
    }
  }
  assert.equal(caught, true, "Debe rechazar project ref de producción largo");
});

// 3. PRODUCTION TARGET REJECTION (URL completa)
test("Rechazo de PRODUCTION_URL ('https://vvpdycuclnoptffwmrvb.supabase.co')", () => {
  let caught = false;
  try {
    assertSupabaseStagingTarget("https://vvpdycuclnoptffwmrvb.supabase.co");
  } catch (err) {
    if (err instanceof AntiProductionBarrierError && err.code === "PRODUCTION_TARGET_REJECTED") {
      caught = true;
    }
  }
  assert.equal(caught, true, "Debe rechazar URL completa de producción");
});

// 4. STAGING TARGET ACCEPTANCE
test("Aceptación de STAGING_TARGET legítimo ('https://nextex-staging-cloud.supabase.co')", () => {
  const res = assertSupabaseStagingTarget("https://nextex-staging-cloud.supabase.co");
  assert.equal(res.valid, true);
  assert.equal(res.status, "STAGING_TARGET_ACCEPTED");
  assert.equal(res.targetRef, "nextex-staging-cloud");
});

// 5. STAGING TARGET VERIFICATION CONTRA STAGING_REF
test("Validación de correspondencia estricta cuando se suministra verifiedStagingRef", () => {
  const res = assertSupabaseStagingTarget("https://nextex-staging-prod-test.supabase.co", "nextex-staging-prod-test");
  assert.equal(res.valid, true);

  let mismatchCaught = false;
  try {
    assertSupabaseStagingTarget("https://nextex-staging-prod-test.supabase.co", "differentstagingref");
  } catch (err) {
    if (err instanceof AntiProductionBarrierError && err.code === "STAGING_REF_MISMATCH") {
      mismatchCaught = true;
    }
  }
  assert.equal(mismatchCaught, true, "Debe detectar discrepancia con el staging ref esperado");
});

// 6. VERCEL PRODUCTION REJECTION
test("Rechazo de URL de producción Vercel ('https://nextex-seven.vercel.app/')", () => {
  let caught = false;
  try {
    assertVercelStagingTarget("https://nextex-seven.vercel.app/");
  } catch (err) {
    if (err instanceof AntiProductionBarrierError && err.code === "PRODUCTION_VERCEL_TARGET_REJECTED") {
      caught = true;
    }
  }
  assert.equal(caught, true, "Debe rechazar la URL de producción de Vercel");
});

// 7. VERCEL STAGING ACCEPTANCE
test("Aceptación de URL de staging Vercel ('https://nextex-staging.vercel.app')", () => {
  const res = assertVercelStagingTarget("https://nextex-staging.vercel.app");
  assert.equal(res.valid, true);
  assert.equal(res.status, "STAGING_VERCEL_TARGET_ACCEPTED");
});

// 8. ENVIRONMENT SCAN (.env.local contiene producción y es detectado)
test("detectProductionInEnvironment detecta variables de producción en .env.local", () => {
  const lines = fs.readFileSync(".env.local", "utf8").split("\n");
  const parsedEnv = {};
  for (const l of lines) {
    const idx = l.indexOf("=");
    if (idx > 0) {
      parsedEnv[l.slice(0, idx).trim()] = l.slice(idx + 1).trim();
    }
  }
  const detection = detectProductionInEnvironment(parsedEnv);
  assert.equal(detection.hasProduction, true, "Debe detectar que .env.local apunta a producción");
  assert.ok(detection.productionItems.some((i) => i.includes("vvpdycuclnoptffwmrvb")));
});

// 9. ENVIRONMENT SCAN (.env.staging no contiene producción)
test("detectProductionInEnvironment confirma que .env.staging está limpio de producción", () => {
  assert.ok(fs.existsSync(".env.staging"), ".env.staging debe existir");
  const lines = fs.readFileSync(".env.staging", "utf8").split("\n");
  const parsedEnv = {};
  for (const l of lines) {
    const trimmed = l.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      parsedEnv[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  const detection = detectProductionInEnvironment(parsedEnv);
  assert.equal(detection.hasProduction, false, ".env.staging no debe contener referencias a producción");
});

// 10. GITIGNORE ENFORCEMENT
test(".gitignore ignora .env.staging y .env.production de forma obligatoria", () => {
  const gitignore = fs.readFileSync(".gitignore", "utf8");
  assert.ok(gitignore.includes(".env.staging"), ".gitignore debe listar .env.staging");
  assert.ok(gitignore.includes(".env.production"), ".gitignore debe listar .env.production");
});

console.log("\n==========================================================================");
console.log(`RESULTADO DE VALIDACIÓN ANTI-PRODUCCIÓN: ${passed}/${total} PRUEBAS PASADAS (100% PASS)`);
console.log("==========================================================================");
