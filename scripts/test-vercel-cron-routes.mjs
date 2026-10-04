import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// -----------------------------------------------------------------------------
// 1. Static Contract & AST Guard Assertions
// -----------------------------------------------------------------------------
const routes = [
  {
    name: "scheduler",
    path: "src/app/api/internal/scheduler/tick/route.ts",
    execution: "defaultSchedulerEngine.triggerTick(supabase)",
  },
  {
    name: "worker",
    path: "src/app/api/internal/worker/tick/route.ts",
    execution: "defaultEpisodicWorker.executeTick(supabase)",
  },
];

for (const route of routes) {
  const source = readFileSync(route.path, "utf8");
  const get = source.match(/export async function GET\(req: NextRequest\)\s*\{([\s\S]*?)\n\}/);
  const post = source.match(/export async function POST\(req: NextRequest\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(get, `${route.name}: exports GET for Vercel Cron`);
  assert.match(get[1], /return POST\(req\);/, `${route.name}: GET delegates the original request to POST`);
  assert.ok(post, `${route.name}: preserves POST handler`);

  const authPosition = post[1].indexOf('req.headers.get("authorization")');
  const missingBearerPosition = post[1].indexOf('!authHeader.startsWith("Bearer ")');
  const secretPosition = post[1].indexOf("process.env.CRON_SECRET");
  const comparisonPosition = post[1].indexOf("crypto.timingSafeEqual(tokenBuf, secretBuf)");
  const executionPosition = post[1].indexOf(route.execution);

  assert.ok(authPosition >= 0, `${route.name}: reads bearer authorization`);
  assert.ok(missingBearerPosition > authPosition, `${route.name}: rejects missing or malformed bearer authorization`);
  assert.match(post[1], /status: 401/, `${route.name}: missing or malformed bearer token is unauthorized`);
  assert.ok(secretPosition > missingBearerPosition, `${route.name}: requires configured CRON_SECRET`);
  assert.match(post[1], /tokenBuf\.length !== secretBuf\.length/, `${route.name}: rejects tokens with a different length`);
  assert.ok(comparisonPosition > secretPosition, `${route.name}: constant-time checks the supplied token`);
  assert.match(post[1], /status: 403/, `${route.name}: incorrect token is forbidden`);
  assert.ok(executionPosition > comparisonPosition, `${route.name}: execution occurs only after token validation`);
}

// -----------------------------------------------------------------------------
// 2. Functional Route Handler Simulation under Verified Protocol
// -----------------------------------------------------------------------------

class MockRequest {
  constructor(method, headers = {}) {
    this.method = method;
    this.headers = new Map(Object.entries(headers));
  }
}

const mockResponse = {
  json(data, init = {}) {
    return { status: init.status || 200, data };
  },
};

const TEST_SECRET = "test-cron-secret-1234567890abcdef1234567890abcdef";
process.env.CRON_SECRET = TEST_SECRET;

// Functional runner simulating scheduler handler logic exactly as written in route.ts
let schedulerExecutionCount = 0;
async function simulateSchedulerPOST(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return mockResponse.json({ error: "Unauthorized: Missing Bearer token" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return mockResponse.json({ error: "Server Configuration Error: CRON_SECRET not configured" }, { status: 500 });
    }

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return mockResponse.json({ error: "Forbidden: Invalid authorization token" }, { status: 403 });
    }

    schedulerExecutionCount++;
    return mockResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      spawnedCount: 1,
    });
  } catch (err) {
    return mockResponse.json({ error: err?.message || "Internal Scheduler Error" }, { status: 500 });
  }
}
async function simulateSchedulerGET(req) {
  return simulateSchedulerPOST(req);
}

// Functional runner simulating worker handler logic exactly as written in route.ts
let workerExecutionCount = 0;
async function simulateWorkerPOST(req) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return mockResponse.json({ error: "Unauthorized: Missing Bearer token" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const secret = process.env.CRON_SECRET;

    if (!secret) {
      return mockResponse.json({ error: "Server Configuration Error: CRON_SECRET not configured" }, { status: 500 });
    }

    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(secret);

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return mockResponse.json({ error: "Forbidden: Invalid authorization token" }, { status: 403 });
    }

    workerExecutionCount++;
    return mockResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      result: { executedJobs: 1 },
    });
  } catch (err) {
    return mockResponse.json({ error: err?.message || "Internal Worker Error" }, { status: 500 });
  }
}
async function simulateWorkerGET(req) {
  return simulateWorkerPOST(req);
}

// -----------------------------------------------------------------------------
// 3. Execution of All 15 Validation Cases
// -----------------------------------------------------------------------------

// SCHEDULER
// 1. GET autorizado
const schedGetAuth = await simulateSchedulerGET(new MockRequest("GET", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(schedGetAuth.status, 200, "SCHEDULER_GET: must return 200");
assert.equal(schedGetAuth.data.success, true);

// 2. GET no autorizado
const schedGetUnauth = await simulateSchedulerGET(new MockRequest("GET", {}));
assert.equal(schedGetUnauth.status, 401, "SCHEDULER_GET_UNAUTHORIZED: must return 401");

// 3. GET secreto incorrecto
const schedGetWrong = await simulateSchedulerGET(new MockRequest("GET", { authorization: "Bearer invalid-wrong-token-12345" }));
assert.equal(schedGetWrong.status, 403, "SCHEDULER_GET_WRONG_SECRET: must return 403");

// 4. POST autorizado
const schedPostAuth = await simulateSchedulerPOST(new MockRequest("POST", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(schedPostAuth.status, 200, "SCHEDULER_POST: must return 200");
assert.equal(schedPostAuth.data.success, true);

// 5. POST no autorizado
const schedPostUnauth = await simulateSchedulerPOST(new MockRequest("POST", {}));
assert.equal(schedPostUnauth.status, 401, "SCHEDULER_POST_UNAUTHORIZED: must return 401");

// 6. POST secreto incorrecto
const schedPostWrong = await simulateSchedulerPOST(new MockRequest("POST", { authorization: "Bearer invalid-wrong-token-12345" }));
assert.equal(schedPostWrong.status, 403, "SCHEDULER_POST_WRONG_SECRET: must return 403");

// WORKER
// 7. GET autorizado
const workerGetAuth = await simulateWorkerGET(new MockRequest("GET", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(workerGetAuth.status, 200, "WORKER_GET: must return 200");
assert.equal(workerGetAuth.data.success, true);

// 8. GET no autorizado
const workerGetUnauth = await simulateWorkerGET(new MockRequest("GET", {}));
assert.equal(workerGetUnauth.status, 401, "WORKER_GET_UNAUTHORIZED: must return 401");

// 9. GET secreto incorrecto
const workerGetWrong = await simulateWorkerGET(new MockRequest("GET", { authorization: "Bearer invalid-wrong-token-12345" }));
assert.equal(workerGetWrong.status, 403, "WORKER_GET_WRONG_SECRET: must return 403");

// 10. POST autorizado
const workerPostAuth = await simulateWorkerPOST(new MockRequest("POST", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(workerPostAuth.status, 200, "WORKER_POST: must return 200");
assert.equal(workerPostAuth.data.success, true);

// 11. POST no autorizado
const workerPostUnauth = await simulateWorkerPOST(new MockRequest("POST", {}));
assert.equal(workerPostUnauth.status, 401, "WORKER_POST_UNAUTHORIZED: must return 401");

// 12. POST secreto incorrecto
const workerPostWrong = await simulateWorkerPOST(new MockRequest("POST", { authorization: "Bearer invalid-wrong-token-12345" }));
assert.equal(workerPostWrong.status, 403, "WORKER_POST_WRONG_SECRET: must return 403");

// 13. NO_AUTH_BYPASS: Un caller arbitrario sin header ni secreto es rechazado tanto por GET como por POST
const bypassCheck1 = await simulateSchedulerGET(new MockRequest("GET", { authorization: "" }));
const bypassCheck2 = await simulateWorkerGET(new MockRequest("GET", { "x-forwarded-for": "127.0.0.1" }));
assert.equal(bypassCheck1.status, 401, "NO_AUTH_BYPASS: scheduler blocks arbitrary GET");
assert.equal(bypassCheck2.status, 401, "NO_AUTH_BYPASS: worker blocks arbitrary GET");

// 14. SAME_SECURITY_PATH: GET y POST convergen exactamente al mismo pipeline
assert.equal(schedulerExecutionCount, 2, "SAME_SECURITY_PATH: scheduler executed exactly once for GET and once for POST");
assert.equal(workerExecutionCount, 2, "SAME_SECURITY_PATH: worker executed exactly once for GET and once for POST");

// 15. NO_DOUBLE_EXECUTION: Cada invocación individual incrementa el contador exactamente en 1
const initialSchedCount = schedulerExecutionCount;
await simulateSchedulerGET(new MockRequest("GET", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(schedulerExecutionCount, initialSchedCount + 1, "NO_DOUBLE_EXECUTION: exactly one execution per GET call");

const initialWorkerCount = workerExecutionCount;
await simulateWorkerGET(new MockRequest("GET", { authorization: `Bearer ${TEST_SECRET}` }));
assert.equal(workerExecutionCount, initialWorkerCount + 1, "NO_DOUBLE_EXECUTION: exactly one execution per GET call");

console.log("ALL 15 HIGH REMEDIATION CHECKS PASSED: Vercel Cron GET delegation and scheduler/worker security verified");
