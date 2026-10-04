/**
 * Script de Diagnóstico Definitivo de Supabase Secret Key (Fase 4.9.1-R2)
 * NUNCA imprime la clave, secretos ni tokens.
 */

import fs from "fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const content = fs.readFileSync(".env.local", "utf8");
let hasKey = false;
let prefix = "none";
let hasNewline = false;
let normalizedKey = "";
let envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const idx = content.indexOf("SUPABASE_SERVICE_ROLE_KEY");
if (idx !== -1) {
  hasKey = true;
  const rest = content.slice(idx);
  const eqIdx = rest.indexOf("=");
  const valPart = rest.slice(eqIdx + 1);
  const nextVarMatch = valPart.match(/\n[A-Z0-9_]+\s*=/);
  const rawKeyBlock = nextVarMatch ? valPart.slice(0, nextVarMatch.index) : valPart;
  
  hasNewline = rawKeyBlock.includes("\n") || rawKeyBlock.includes("\r");
  normalizedKey = rawKeyBlock.replace(/^["'`]/, "").replace(/["'`]$/, "").replace(/[\r\n\s]+/g, "");

  if (normalizedKey.startsWith("sb_secret_")) {
    prefix = "sb_secret";
  } else if (normalizedKey.startsWith("eyJ")) {
    prefix = "eyJ";
  } else if (normalizedKey.length > 0) {
    prefix = "otro";
  }
}

console.log("==================================================");
console.log("1. IDENTIFICACIÓN DEL TIPO DE CLAVE");
console.log("==================================================");
console.log(`SUPABASE_SERVICE_ROLE_KEY_PRESENT = ${hasKey}`);
console.log(`KEY_PREFIX = ${prefix}`);
console.log(`KEY_LENGTH = ${normalizedKey.length}`);
console.log(`HAS_EMBEDDED_NEWLINE = ${hasNewline}`);
console.log(`SUPABASE_NEW_SECRET_KEY = ${prefix === "sb_secret"}`);

console.log("\n==================================================");
console.log("2. NORMALIZACIÓN EN MEMORIA");
console.log("==================================================");
const isNormalizedClean = (
  normalizedKey.length > 0 &&
  !normalizedKey.includes("\n") &&
  !normalizedKey.includes("\r") &&
  !normalizedKey.includes("\t") &&
  !normalizedKey.includes(" ")
);
console.log(`NORMALIZED_SECRET_KEY = ${isNormalizedClean}`);

console.log("\n==================================================");
console.log("3. PROYECTO Y FUENTE");
console.log("==================================================");
console.log(`SUPABASE_URL (en .env.local): ${envUrl}`);

// Verificar fuente probable:
// Nuevas Secret Keys de Supabase comienzan con sb_secret_ y tienen longitud típica de ~40-50 chars
let keySource = "UNKNOWN";
if (prefix === "sb_secret") {
  keySource = "Supabase Dashboard → Settings → API Keys → Secret keys (Nuevo formato de Secret Key)";
} else if (prefix === "eyJ") {
  keySource = "Legacy service_role JWT";
}
console.log(`KEY_SOURCE = ${keySource}`);

async function runGatewayTests() {
  console.log("\n==================================================");
  console.log("4. PRUEBA DIRECTA DEL API GATEWAY");
  console.log("==================================================");

  // Intentamos con la URL configurada en .env.local
  const testUrls = [envUrl];
  // Si la prompt menciona vvpdycuclnoptffwmrvb5 con 5 al final, también probamos por si acaso
  const promptUrl = "https://vvpdycuclnoptffwmrvb5.supabase.co";
  if (promptUrl !== envUrl) {
    testUrls.push(promptUrl);
  }

  for (const baseUrl of testUrls) {
    const targetUrl = `${baseUrl.replace(/\/$/, "")}/rest/v1/`;
    console.log(`\nProbando contra: ${targetUrl}`);

    try {
      // Petición no destructiva con apikey: normalizedKey (SIN Authorization: Bearer)
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "apikey": normalizedKey,
        },
      });

      const bodyText = await res.text();
      let sanitizedBody = bodyText.slice(0, 300);

      console.log(`HTTP_STATUS: ${res.status}`);
      console.log(`RESPONSE_STATUS_TEXT: ${res.statusText}`);
      console.log(`RESPONSE_BODY_SANITIZED: ${sanitizedBody}`);

      if (res.ok || res.status === 200) {
        console.log(`API_GATEWAY_SECRET_KEY = PASS (en ${baseUrl})`);
      } else {
        console.log(`API_GATEWAY_SECRET_KEY = FAIL (en ${baseUrl})`);
      }

      // También probamos si el gateway requiere ambos headers (apikey + Authorization: Bearer <secret>)
      // tal como la documentación de Supabase indica para backend
      console.log(`\nProbando con headers combinados (apikey + Authorization Bearer):`);
      const resWithBearer = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "apikey": normalizedKey,
          "Authorization": `Bearer ${normalizedKey}`,
        },
      });
      const bearerBodyText = await resWithBearer.text();
      console.log(`HTTP_STATUS (con Bearer): ${resWithBearer.status}`);
      console.log(`RESPONSE_STATUS_TEXT (con Bearer): ${resWithBearer.statusText}`);
      console.log(`RESPONSE_BODY_SANITIZED (con Bearer): ${bearerBodyText.slice(0, 300)}`);

    } catch (err) {
      console.error(`Error de red al conectar a ${baseUrl}:`, err.message);
    }
  }
}

runGatewayTests().catch(console.error);
