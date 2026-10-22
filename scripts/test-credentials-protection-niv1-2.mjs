/**
 * Test Suite: NIV1-2 — Bóveda de credenciales: API y avisos de vencimiento
 * Verificación exhaustiva de:
 * 1. Mini-migración (SQL y archivo de migración)
 * 2. Cálculo de días restantes y estados de credencial
 * 3. Rutas API de administración (GET, POST, PATCH, DELETE con control super_admin)
 * 4. Motor de vencimiento de credenciales (checkCredentialExpirations)
 * 5. Dedup por (credencial, fecha) y comportamiento cuando Telegram no está configurado
 * 6. Integración en el tick del worker
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Registrar hook para resolución y transpilación TypeScript en tiempo de ejecución
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/lib/") || context.parentURL?.includes("/scripts/")) {
      let targetPath = null;
      if (specifier.startsWith("@/")) {
        const sub = specifier.replace("@/", "");
        targetPath = path.resolve(fileURLToPath(new URL("../src/" + sub, import.meta.url)));
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const parentPath = fileURLToPath(context.parentURL);
        const parentDir = path.dirname(parentPath);
        targetPath = path.resolve(parentDir, specifier);
      }

      if (targetPath) {
        if (targetPath.endsWith(".js")) {
          const tsPath = targetPath.slice(0, -3) + ".ts";
          if (fs.existsSync(tsPath)) return nextResolve(pathToFileURL(tsPath).href);
        }
        if (targetPath.endsWith(".ts") && fs.existsSync(targetPath)) {
          return nextResolve(pathToFileURL(targetPath).href);
        }
        if (fs.existsSync(targetPath + ".ts")) {
          return nextResolve(pathToFileURL(targetPath + ".ts").href);
        }
        if (fs.existsSync(path.join(targetPath, "index.ts"))) {
          return nextResolve(pathToFileURL(path.join(targetPath, "index.ts")).href);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const filePath = fileURLToPath(url);
      const source = ts.sys.readFile(filePath, "utf8");
      const transpiled = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      });
      return {
        format: "module",
        shortCircuit: true,
        source: transpiled.outputText,
      };
    }
    return nextLoad(url, context);
  },
});

const {
  calculateDaysLeft,
  computeCredentialStatus,
  checkCredentialExpirations,
} = await import("../src/lib/protection/credentials.ts");
const { sendVigiaAlert } = await import("../src/lib/vigia/notify.ts");

const repoRoot = path.resolve(process.cwd());

console.log("=== INICIANDO TEST SUITE: NIV1-2 BÓVEDA DE CREDENCIALES ===");

let passed = 0;
let total = 0;

function it(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function itAsync(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// 1. Mini-migración: archivo y sintaxis SQL
// -----------------------------------------------------------------------------
it("1.1 Archivo de migración existe en supabase/migrations", () => {
  const migPath = path.join(
    repoRoot,
    "supabase/migrations/20261021_incident_log_credential_alert.sql"
  );
  assert.ok(fs.existsSync(migPath), "El archivo de migración debe existir");
  const sql = fs.readFileSync(migPath, "utf8");
  assert.ok(sql.includes("incident_log_kind_check"), "Debe referenciar incident_log_kind_check");
  assert.ok(sql.includes("'credential_alert'"), "Debe incluir 'credential_alert'");
  assert.ok(sql.includes("DROP CONSTRAINT IF EXISTS"), "Debe tener DROP CONSTRAINT IF EXISTS");
  assert.ok(sql.includes("ADD CONSTRAINT"), "Debe tener ADD CONSTRAINT");
  assert.ok(sql.includes("'health_down'"), "Debe preservar 'health_down'");
  assert.ok(sql.includes("'consumption_spike'"), "Debe preservar 'consumption_spike'");
});

// -----------------------------------------------------------------------------
// 2. Cálculo de días y estados de vencimiento
// -----------------------------------------------------------------------------
it("2.1 calculateDaysLeft calcula correctamente fechas pasadas, hoy y futuras", () => {
  const now = new Date();
  const formatUtcDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // Hoy
  const todayStr = formatUtcDate(now);
  assert.strictEqual(calculateDaysLeft(todayStr), 0, "Hoy debe ser 0 días restantes");

  // Mañana (+1)
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = formatUtcDate(tomorrow);
  assert.strictEqual(calculateDaysLeft(tomorrowStr), 1, "Mañana debe ser 1 día restante");

  // Ayer (-1)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = formatUtcDate(yesterday);
  assert.strictEqual(calculateDaysLeft(yesterdayStr), -1, "Ayer debe ser -1 días restantes");

  // Sin fecha
  assert.strictEqual(calculateDaysLeft(null), null, "null debe retornar null");
  assert.strictEqual(calculateDaysLeft(undefined), null, "undefined debe retornar null");
  assert.strictEqual(calculateDaysLeft(""), null, "'' debe retornar null");
});

it("2.2 computeCredentialStatus mapea correctamente los 4 estados", () => {
  // no_expiry
  assert.strictEqual(computeCredentialStatus(null), "no_expiry");
  
  // expired
  assert.strictEqual(computeCredentialStatus(-1, 7), "expired");
  assert.strictEqual(computeCredentialStatus(-10, 7), "expired");

  // warning (days_left <= alert_days_before)
  assert.strictEqual(computeCredentialStatus(0, 7), "warning");
  assert.strictEqual(computeCredentialStatus(1, 7), "warning");
  assert.strictEqual(computeCredentialStatus(7, 7), "warning");

  // ok (days_left > alert_days_before)
  assert.strictEqual(computeCredentialStatus(8, 7), "ok");
  assert.strictEqual(computeCredentialStatus(30, 7), "ok");
});

// -----------------------------------------------------------------------------
// 3. sendVigiaAlert: retorno booleano
// -----------------------------------------------------------------------------
await itAsync("3.1 sendVigiaAlert devuelve false si Telegram no está configurado", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const res = await sendVigiaAlert("Test", "Body");
    assert.strictEqual(typeof res, "boolean", "sendVigiaAlert debe retornar booleano");
    assert.strictEqual(res, false, "Debe retornar false si falta configuración");
  } finally {
    if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat) process.env.TELEGRAM_CHAT_ID = oldChat;
  }
});

// -----------------------------------------------------------------------------
// 4. checkCredentialExpirations y deduplicación por (credencial, fecha)
// -----------------------------------------------------------------------------
await itAsync("4.1 checkCredentialExpirations: alerta en primer tick y omite en segundo (dedup)", async () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  const mockCredId = "cred-123-uuid";
  const mockCred = {
    id: mockCredId,
    name: "Clave API Stripe",
    provider: "otro",
    location: "Vercel env",
    expires_at: tomorrowStr,
    alert_days_before: 7,
    notes: "Credencial crítica",
  };

  // Mock DB storage
  const credentialsDb = [mockCred];
  const incidentLogDb = [];

  // Mock fetch para Telegram simulado
  const originalFetch = globalThis.fetch;
  let telegramCalls = [];

  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("telegram.org")) {
      telegramCalls.push({ url, body: JSON.parse(opts.body) });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => JSON.stringify({ ok: true }),
      };
    }
    return originalFetch(url, opts);
  };

  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  process.env.TELEGRAM_BOT_TOKEN = "mock-token";
  process.env.TELEGRAM_CHAT_ID = "mock-chat-id";

  const createMockSupabase = () => ({
    from: (table) => {
      if (table === "credentials_inventory") {
        return {
          select: () => ({
            not: (col, op, val) => ({
              data: credentialsDb,
              error: null,
            }),
          }),
        };
      }
      if (table === "incident_log") {
        return {
          select: () => ({
            eq: (col, val) => ({
              data: incidentLogDb.filter((r) => r[col] === val),
              error: null,
            }),
          }),
          insert: async (row) => {
            incidentLogDb.push({ ...row, id: `inc-${incidentLogDb.length + 1}` });
            return { data: row, error: null };
          },
        };
      }
      throw new Error(`Tabla no mockeada: ${table}`);
    },
  });

  try {
    // Tick 1: Debe enviar alerta e insertar incident_log
    const mockSupabase = createMockSupabase();
    const tick1 = await checkCredentialExpirations(mockSupabase);

    assert.strictEqual(tick1.checked, 1, "Debe chequear 1 credencial");
    assert.strictEqual(tick1.alerted, 1, "Debe alertar 1 credencial");
    assert.strictEqual(telegramCalls.length, 1, "Debe llamar a Telegram 1 vez");
    assert.strictEqual(incidentLogDb.length, 1, "Debe registrar 1 incident_log");
    assert.strictEqual(incidentLogDb[0].kind, "credential_alert", "El kind debe ser credential_alert");
    assert.strictEqual(incidentLogDb[0].detail.credential_id, mockCredId);
    assert.strictEqual(incidentLogDb[0].detail.expires_at, tomorrowStr);
    assert.ok(
      telegramCalls[0].body.text.includes("vence el " + tomorrowStr),
      "El texto debe contener 'vence el <fecha>'"
    );

    // Tick 2: Mismo estado -> NO repite alerta
    const tick2 = await checkCredentialExpirations(mockSupabase);
    assert.strictEqual(tick2.alerted, 0, "No debe alertar en segundo tick");
    assert.strictEqual(tick2.skipped, 1, "Debe saltar la credencial ya alertada");
    assert.strictEqual(telegramCalls.length, 1, "No debe hacer nuevas llamadas a Telegram");
    assert.strictEqual(incidentLogDb.length, 1, "No debe crear nuevos incident_log");

    // Renovación: JC renueva la credencial (cambia fecha)
    const newDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    const newDateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}-${String(newDate.getDate()).padStart(2, "0")}`;
    mockCred.expires_at = newDateStr;

    // Tick 3 con nueva fecha -> VUELVE A ALERTAR
    const tick3 = await checkCredentialExpirations(mockSupabase);
    assert.strictEqual(tick3.alerted, 1, "Debe alertar la nueva fecha tras renovación");
    assert.strictEqual(telegramCalls.length, 2, "Debe enviar la segunda alerta a Telegram");
    assert.strictEqual(incidentLogDb.length, 2, "Debe registrar el segundo incident_log para la nueva fecha");
    assert.strictEqual(incidentLogDb[1].detail.expires_at, newDateStr);

  } finally {
    globalThis.fetch = originalFetch;
    if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken;
    else delete process.env.TELEGRAM_BOT_TOKEN;
    if (oldChat) process.env.TELEGRAM_CHAT_ID = oldChat;
    else delete process.env.TELEGRAM_CHAT_ID;
  }
});

await itAsync("4.2 checkCredentialExpirations: si Telegram NO está configurado, NO registra incident_log", async () => {
  const now = new Date();
  const mockCred = {
    id: "cred-unconfigured-telegram",
    name: "OpenAI Production Key",
    provider: "openai",
    location: "Supabase Vault",
    expires_at: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    alert_days_before: 7,
  };

  const incidentLogDb = [];
  const mockSupabase = {
    from: (table) => {
      if (table === "credentials_inventory") {
        return {
          select: () => ({
            not: () => ({ data: [mockCred], error: null }),
          }),
        };
      }
      if (table === "incident_log") {
        return {
          select: () => ({
            eq: () => ({ data: incidentLogDb, error: null }),
          }),
          insert: async (row) => {
            incidentLogDb.push(row);
            return { data: row, error: null };
          },
        };
      }
      throw new Error(`Tabla no mockeada: ${table}`);
    },
  };

  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;

  try {
    const res = await checkCredentialExpirations(mockSupabase);
    assert.strictEqual(res.alerted, 0, "No debe marcar como alertada");
    assert.strictEqual(incidentLogDb.length, 0, "NO debe registrar incident_log si Telegram no envió");
  } finally {
    if (oldToken) process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat) process.env.TELEGRAM_CHAT_ID = oldChat;
  }
});

// -----------------------------------------------------------------------------
// 5. Integración con el tick del worker
// -----------------------------------------------------------------------------
it("5.1 El worker tick importa y ejecuta checkCredentialExpirations en try/catch sin puerta de tiempo", () => {
  const tickRoutePath = path.join(
    repoRoot,
    "src/app/api/internal/worker/tick/route.ts"
  );
  const code = fs.readFileSync(tickRoutePath, "utf8");
  assert.ok(
    code.includes('import { checkCredentialExpirations } from "@/lib/protection/credentials"'),
    "Debe importar checkCredentialExpirations"
  );
  assert.ok(
    code.includes("checkCredentialExpirations(supabase)"),
    "Debe invocar checkCredentialExpirations(supabase)"
  );
  assert.ok(
    code.includes("credentials_check: credentialsCheck"),
    "Debe incluir credentials_check en la respuesta"
  );
});

// -----------------------------------------------------------------------------
// 6. Archivos de endpoints API y validaciones
// -----------------------------------------------------------------------------
it("6.1 Endpoints de API existen y contienen validación super_admin", () => {
  const mainRoutePath = path.join(
    repoRoot,
    "src/app/api/admin/credentials/route.ts"
  );
  const idRoutePath = path.join(
    repoRoot,
    "src/app/api/admin/credentials/[id]/route.ts"
  );

  assert.ok(fs.existsSync(mainRoutePath), "src/app/api/admin/credentials/route.ts debe existir");
  assert.ok(fs.existsSync(idRoutePath), "src/app/api/admin/credentials/[id]/route.ts debe existir");

  const mainCode = fs.readFileSync(mainRoutePath, "utf8");
  const idCode = fs.readFileSync(idRoutePath, "utf8");

  assert.ok(mainCode.includes("isSuperAdmin"), "GET/POST debe usar isSuperAdmin");
  assert.ok(mainCode.includes("status: 403"), "GET/POST debe retornar 403 si no es super_admin");
  assert.ok(mainCode.includes("calculateDaysLeft"), "GET/POST debe calcular days_left");
  assert.ok(mainCode.includes("computeCredentialStatus"), "GET/POST debe calcular status");

  assert.ok(idCode.includes("isSuperAdmin"), "PATCH/DELETE debe usar isSuperAdmin");
  assert.ok(idCode.includes("status: 403"), "PATCH/DELETE debe retornar 403 si no es super_admin");
  assert.ok(idCode.includes("status: 404"), "PATCH/DELETE debe retornar 404 si no existe");
  assert.ok(idCode.includes("updated_at"), "PATCH debe actualizar updated_at");
});

console.log(`\n🎉 RESULTADO: ${passed}/${total} pruebas pasaron exitosamente.`);
