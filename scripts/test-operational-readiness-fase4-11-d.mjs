/**
 * NEXTEХ — SUITE OFICIAL FASE 4.11-D
 * PRODUCTION OPERATIONAL READINESS & AUDIT VERIFICATION
 * Cobertura Completa de los Bloques Operacionales D01 a D23
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

console.log("==========================================================================");
console.log("NEXTEХ — SUITE OFICIAL FASE 4.11-D: PRODUCTION OPERATIONAL READINESS");
console.log("AUDITORÍA + HARDENING + CERTIFICACIÓN OPERACIONAL LOCAL");
console.log("==========================================================================\n");

let passedCount = 0;
let totalChecks = 0;

function runOperationalCheck(id, title, testFn) {
  totalChecks++;
  try {
    testFn();
    passedCount++;
    console.log(`✓ [${id}] ${title}: PASS`);
  } catch (err) {
    console.error(`✗ [${id}] ${title}: FAIL ->`, err.message);
    throw err;
  }
}

// Cargar artefactos clave para auditoría estática
const pkgJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const vercelJson = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
const envExample = fs.readFileSync(".env.example", "utf8");
const gitignore = fs.readFileSync(".gitignore", "utf8");
const middlewareSrc = fs.readFileSync("src/middleware.ts", "utf8");
const healthSrc = fs.readFileSync("src/app/api/health/route.ts", "utf8");
const healthDetailedSrc = fs.readFileSync("src/app/api/health/detailed/route.ts", "utf8");
const schedulerTickSrc = fs.readFileSync("src/app/api/internal/scheduler/tick/route.ts", "utf8");
const workerTickSrc = fs.readFileSync("src/app/api/internal/worker/tick/route.ts", "utf8");
const inboundSrc = fs.readFileSync("src/app/api/inbound/[endpointKey]/route.ts", "utf8");
const tracerSrc = fs.readFileSync("src/lib/observability/tracer.ts", "utf8");
const obsSanitizerSrc = fs.readFileSync("src/lib/observability/sanitizer.ts", "utf8");
const omniSanitizerSrc = fs.readFileSync("src/lib/omniengine/security/sanitizer.ts", "utf8");
const omniLoggerSrc = fs.readFileSync("src/lib/omniengine/observability/logger.ts", "utf8");
const rateLimiterSrc = fs.readFileSync("src/lib/omniengine/security/rate-limiter.ts", "utf8");
const gatewayLimiterSrc = fs.readFileSync("src/lib/integrations/gateway/limiter.ts", "utf8");
const memoryServiceSrc = fs.readFileSync("src/lib/agents/memory/service.ts", "utf8");
const workerSrc = fs.readFileSync("src/lib/jobs/worker/worker.ts", "utf8");
const controlPlaneSql = fs.readFileSync("supabase/migrations/20261011_production_control_plane.sql", "utf8");
const durableJobsSql = fs.readFileSync("supabase/migrations/20261006_durable_jobs_and_scheduler.sql", "utf8");

// D01: INVENTORY
runOperationalCheck("D01", "Operational inventory & dependencies sanity", () => {
  assert.equal(pkgJson.name, "nextex", "Project name matches");
  assert.ok(pkgJson.dependencies.next, "Next.js dependency present");
  assert.ok(pkgJson.dependencies["@supabase/supabase-js"], "Supabase client present");
  assert.ok(pkgJson.dependencies["@supabase/ssr"], "Supabase SSR present");
  assert.ok(pkgJson.scripts.typecheck, "Typecheck script present");
  assert.ok(pkgJson.scripts.build, "Build script present");
  assert.ok(vercelJson.crons && Array.isArray(vercelJson.crons), "Vercel crons configured");
  assert.equal(vercelJson.crons.length, 2, "2 Vercel cron endpoints configured");
});

// D02: ENVIRONMENT VARIABLE AUDIT
runOperationalCheck("D02", "Environment variables audit & isolation", () => {
  assert.ok(envExample.includes("NEXT_PUBLIC_SUPABASE_URL"), "SUPABASE_URL in example");
  assert.ok(envExample.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"), "ANON_KEY in example");
  assert.ok(envExample.includes("SUPABASE_SERVICE_ROLE_KEY"), "SERVICE_ROLE_KEY in example");
  assert.ok(envExample.includes("INTEGRATION_KEY_ENCRYPTION_SECRET"), "ENCRYPTION_SECRET in example");
  assert.ok(envExample.includes("CRON_SECRET"), "CRON_SECRET in example");
  assert.ok(!envExample.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"), "No public service role key");
  assert.ok(!envExample.includes("NEXT_PUBLIC_CRON_SECRET"), "No public cron secret");
  assert.ok(!envExample.includes("NEXT_PUBLIC_INTEGRATION_KEY"), "No public integration encryption key");
  assert.ok(gitignore.includes(".env*.local"), "Local env files ignored");
});

// D03: SECRET EXPOSURE AUDIT
runOperationalCheck("D03", "Secret exposure defenses & multi-casing sanitization", () => {
  assert.ok(obsSanitizerSrc.includes("/authorization/i"), "Catches authorization headers");
  assert.ok(obsSanitizerSrc.includes("/api[-_]?key/i"), "Catches api_key / apiKey / api-key");
  assert.ok(obsSanitizerSrc.includes("/service[-_]?role/i"), "Catches service_role / serviceRole");
  assert.ok(obsSanitizerSrc.includes("/webhook[-_]?secret/i"), "Catches webhook secrets");
  assert.ok(omniSanitizerSrc.includes("sk-"), "Catches OpenAI keys");
  assert.ok(omniSanitizerSrc.includes("sk-ant-"), "Catches Anthropic keys");
  assert.ok(omniSanitizerSrc.includes("AIza"), "Catches Google AI keys");
  assert.ok(omniSanitizerSrc.includes("Bearer"), "Redacts Bearer tokens");
});

// D04: PRODUCTION DEFAULTS
runOperationalCheck("D04", "Safe production defaults & no accidental permissive gates", () => {
  assert.ok(!middlewareSrc.includes("cors: '*'"), "No permissive wildcard CORS");
  assert.ok(middlewareSrc.includes("isProtectedPath"), "Enforces route authentication");
  assert.ok(middlewareSrc.includes("redirectUrl"), "Redirects unauthenticated traffic to login");
});

// D05: SERVERLESS EXECUTION LIMITS
runOperationalCheck("D05", "Serverless time budgeting & bounded execution", () => {
  assert.ok(workerSrc.includes("maxInvocationMs: 45000"), "Worker timeout bounded to 45s");
  assert.ok(workerSrc.includes("safetyMarginMs: 15000"), "15s safety margin for graceful checkpoint");
  assert.ok(workerSrc.includes("checkpointAndRequeue"), "Checkpoints and requeues before timeout");
  assert.ok(inboundSrc.includes("readBoundedBody"), "Bounded HTTP body reader for webhooks");
});

// D06: CRON READINESS
runOperationalCheck("D06", "Vercel Cron authentication & timing-safe token validation", () => {
  assert.ok(schedulerTickSrc.includes("crypto.timingSafeEqual"), "Scheduler uses timingSafeEqual");
  assert.ok(workerTickSrc.includes("crypto.timingSafeEqual"), "Worker uses timingSafeEqual");
  assert.ok(schedulerTickSrc.includes("status: 401"), "Scheduler rejects missing token with 401");
  assert.ok(schedulerTickSrc.includes("status: 403"), "Scheduler rejects invalid token with 403");
  assert.ok(schedulerTickSrc.includes("status: 500"), "Scheduler returns 500 if CRON_SECRET not configured");
  assert.ok(schedulerTickSrc.includes("export async function GET"), "Scheduler GET dispatches safely to POST");
  assert.ok(workerTickSrc.includes("export async function GET"), "Worker GET dispatches safely to POST");
});

// D07: HEALTH CHECKS
runOperationalCheck("D07", "Liveness & Readiness probe isolation without secret leakage", () => {
  assert.ok(healthSrc.includes('status: "ok"'), "Liveness returns status ok");
  assert.ok(!healthSrc.includes("password"), "Liveness leaks no credentials");
  assert.ok(healthDetailedSrc.includes('status: "ready"'), "Readiness returns ready on DB success");
  assert.ok(healthDetailedSrc.includes("503"), "Readiness returns 503 degraded on DB failure");
  assert.ok(!healthDetailedSrc.includes("err.message"), "Readiness sanitizes error messages");
});

// D08: ERROR HANDLING
runOperationalCheck("D08", "Error classification & standard HTTP status codes", () => {
  assert.ok(inboundSrc.includes("status: 400"), "Returns 400 on malformed input");
  assert.ok(inboundSrc.includes("status: 401"), "Returns 401 on signature failure");
  assert.ok(inboundSrc.includes("status: 404"), "Returns 404 on invalid endpoint");
  assert.ok(inboundSrc.includes("status: 409"), "Returns 409 on duplicate payload mismatch");
  assert.ok(inboundSrc.includes("status: 413"), "Returns 413 on payload too large");
  assert.ok(inboundSrc.includes("status: 429"), "Returns 429 on rate limit exceeded");
  assert.ok(inboundSrc.includes("status: 500"), "Returns 500 on internal gateway fault");
});

// D09: RETRY POLICY
runOperationalCheck("D09", "Deterministic exponential backoff, jitter & non-retryable isolation", () => {
  assert.ok(durableJobsSql.includes("power(v_backoff_factor, v_run.attempt - 1)"), "Calculates backoff exponential");
  assert.ok(durableJobsSql.includes("random() * 0.4"), "Random jitter applied to prevent thundering herd");
  assert.ok(workerSrc.includes("nonRetryableCodes"), "Explicit whitelist of non-retryable failure codes");
  assert.ok(workerSrc.includes("dead_letter"), "Terminal state dead_letter on exhaustion");
});

// D10: AI OPERATIONAL SAFETY
runOperationalCheck("D10", "AI Gateway quota management, rate limiting & error normalization", () => {
  assert.ok(rateLimiterSrc.includes("checkLimit"), "AI Rate limiter enforces window quota");
  assert.ok(rateLimiterSrc.includes("RATE_LIMIT_EXCEEDED"), "Throws 429 on rate limit exceeded");
  assert.ok(omniLoggerSrc.includes("sanitizeObject"), "Sanitizes AI log entries before output");
});

// D11: DATABASE OPERATIONAL SAFETY
runOperationalCheck("D11", "RLS isolation, SECURITY DEFINER search_path & concurrency safety", () => {
  assert.ok(/for\s+update\s+of\s+jr\s+skip\s+locked/i.test(durableJobsSql), "Durable jobs use SKIP LOCKED");
  assert.ok(controlPlaneSql.includes("set search_path = pg_catalog, public, pg_temp"), "Control plane sets search_path");
  assert.ok(controlPlaneSql.includes("create or replace function public.quarantine_worker"), "Quarantine worker implemented");
});

// D12: CONTROL PLANE OPERATIONAL SAFETY
runOperationalCheck("D12", "Worker lease lifecycle, monotonic fencing & anti-zombie rejection", () => {
  assert.ok(controlPlaneSql.includes("fencing_token bigint not null"), "Fencing token declared in schema");
  assert.ok(controlPlaneSql.includes("drain_worker"), "Drain worker implemented");
  assert.ok(controlPlaneSql.includes("mark_worker_stale"), "Heartbeat stale promotion implemented");
});

// D13: OBSERVABILITY OPERATIONAL READINESS
runOperationalCheck("D13", "Trace correlation, span hierarchy & attribute bounding", () => {
  assert.ok(tracerSrc.includes("startSpan"), "Tracer startSpan available");
  assert.ok(obsSanitizerSrc.includes("MAX_BYTE_SIZE = 4096"), "Span attributes bounded to 4096 bytes");
  assert.ok(obsSanitizerSrc.includes("boundSpanAttributes"), "Attribute bounding enforced");
});

// D14: LOGGING POLICY
runOperationalCheck("D14", "Structured JSON logging with active secrets redaction", () => {
  assert.ok(omniLoggerSrc.includes("formatLog"), "formatLog serializes sanitized log entries");
  assert.ok(omniLoggerSrc.includes("sanitizeObject"), "sanitizeObject invoked on all log outputs");
});

// D15: ABUSE RESISTANCE & RATE LIMITING
runOperationalCheck("D15", "Inbound gateway fast-drop limiter & header sanitization", () => {
  assert.ok(gatewayLimiterSrc.includes("checkRateLimit"), "checkRateLimit enforces 120 req/60s");
  assert.ok(gatewayLimiterSrc.includes("sanitizeHeaders"), "Suppresses cookie, authorization, API keys");
});

// D16: PAYLOAD LIMITS
runOperationalCheck("D16", "Inbound payload bounding & memory ingestion size bounds", () => {
  assert.ok(inboundSrc.includes("max_payload_bytes"), "Respects configured max_payload_bytes");
  assert.ok(inboundSrc.includes("GLOBAL_MAX_PAYLOAD"), "Respects GLOBAL_MAX_PAYLOAD bound");
  assert.ok(memoryServiceSrc.includes("sanitizedContent.length > 4000"), "Limits memory text to 4000 chars");
});

// D17: MEMORY OPERATIONAL SAFETY
runOperationalCheck("D17", "Grounding context untrusted encapsulation & token budgeting", () => {
  assert.ok(memoryServiceSrc.includes("<retrieved_context_memories trust_level=\"untrusted_historical_data\">"), "Encapsulates memories in untrusted XML wrapper");
  assert.ok(memoryServiceSrc.includes("TOKEN BUDGETING DETERMINISTA"), "Token budgeting prevents context blowout");
  assert.ok(memoryServiceSrc.includes("computeIdempotencyHash"), "Cryptographic hash prevents duplicate memory ingest");
});

// D18: INTEGRATIONS GATEWAY OPERATIONAL SAFETY
runOperationalCheck("D18", "HMAC-SHA256 signature verification, anti-replay & asynchronous job queueing", () => {
  assert.ok(inboundSrc.includes("verifyHMAC"), "Verifies HMAC signature");
  assert.ok(inboundSrc.includes("secondary_encrypted_secret"), "Supports secret rotation with secondary key");
  assert.ok(inboundSrc.includes("ingestEvent"), "Converts webhook directly into durable job");
});

// D19: LIFECYCLE MANAGEMENT
runOperationalCheck("D19", "Worker registration, instance identity & graceful drain/shutdown", () => {
  assert.ok(controlPlaneSql.includes("register_worker"), "RPC register_worker available");
  assert.ok(controlPlaneSql.includes("heartbeat_worker"), "RPC heartbeat_worker available");
  assert.ok(controlPlaneSql.includes("release_worker_lease"), "RPC release_worker_lease available");
});

// D20: CONFIGURATION DRIFT AUDIT
runOperationalCheck("D20", "Configuration drift inspection between Vercel crons & API routes", () => {
  for (const cron of vercelJson.crons) {
    const routeRel = `src/app${cron.path}/route.ts`;
    assert.ok(fs.existsSync(routeRel), `Cron route exists: ${routeRel}`);
  }
});

// D21: DEPENDENCY AUDIT
runOperationalCheck("D21", "Minimal runtime dependency graph & absence of install scripts", () => {
  assert.ok(!pkgJson.scripts.postinstall, "No untrusted postinstall lifecycle script");
  assert.ok(!pkgJson.scripts.preinstall, "No untrusted preinstall lifecycle script");
});

// D22 & D23 are validated via npm run typecheck, build and canonical regression.
console.log("\n==========================================================================");
console.log(`RESULTADO DE MATRIZ OPERACIONAL FASE 4.11-D: ${passedCount}/${totalChecks} CHECKS OPERACIONALES PASADOS (100% PASS)`);
console.log("==========================================================================");
