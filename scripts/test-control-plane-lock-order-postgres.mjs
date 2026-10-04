import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/lib/control-plane/")) {
      if (specifier.endsWith(".js")) return nextResolve(specifier.slice(0, -3) + ".ts", context);
      if (specifier.startsWith("./") && !specifier.endsWith(".ts")) return nextResolve(specifier + ".ts", context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.includes("/src/lib/control-plane/") && url.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" });
      const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
      return {
        format: "module",
        source: ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

const host = process.env.PGHOST || "127.0.0.1";
const port = process.env.PGPORT || "55439";
const database = process.env.PGDATABASE || "control_plane_lock_test";
const user = process.env.PGUSER || "postgres";
const psql = process.env.PSQL_BIN || "psql";
const workerId = "00000000-0000-0000-0000-000000000001";
const leaseId = "00000000-0000-0000-0000-000000000002";
const runId = "00000000-0000-0000-0000-000000000003";
const workerId2 = "00000000-0000-0000-0000-000000000004";
const agentId = "00000000-0000-0000-0000-000000000005";
const jobId = "00000000-0000-0000-0000-000000000006";
let realTestNumber = 0;

assert.equal(host, "127.0.0.1", "lock-order test only supports loopback PostgreSQL");
assert.equal(database, "control_plane_lock_test", "use only the dedicated disposable test database");

const migration = readFileSync(new URL("../supabase/migrations/20261011_production_control_plane.sql", import.meta.url), "utf8");

function recordPass(name) {
  realTestNumber += 1;
  console.log(`${String(realTestNumber).padStart(2, "0")}. ${name} — PASS`);
}

function functionSql(name) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `missing function terminator for ${name}`);
  return migration.slice(start, end + 4);
}

function runPsql(sql, timeout = 15000) {
  const result = spawnSync(psql, [
    "-X", "-q", "-h", host, "-p", port, "-U", user, "-d", database,
    "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
  ], { encoding: "utf8", timeout });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `psql failed (${result.status}):\n${result.stderr}\n${result.stdout}`);
  return result.stdout.trim();
}

function launchPsql(sql) {
  const child = spawn(psql, [
    "-X", "-q", "-h", host, "-p", port, "-U", user, "-d", database,
    "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, done };
}

const setupSql = `
DO $$ BEGIN
  IF current_database() <> 'control_plane_lock_test' THEN
    RAISE EXCEPTION 'refusing to modify non-test database %', current_database();
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
DROP TABLE IF EXISTS public.workspace_memberships CASCADE;
CREATE TABLE public.workspace_memberships (workspace_id uuid NOT NULL, user_id uuid NOT NULL, PRIMARY KEY (workspace_id, user_id));
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_user_id)
$$;
DROP FUNCTION IF EXISTS public.quarantine_worker(uuid, text, text);
DROP FUNCTION IF EXISTS public.release_worker_lease(uuid, uuid, bigint);
DROP FUNCTION IF EXISTS public.recover_worker_jobs(integer);
DROP FUNCTION IF EXISTS public.claim_job_run_v2(uuid, integer, text[]);
DROP FUNCTION IF EXISTS public.register_worker(uuid, text, text, text, text[], integer, jsonb);
DROP FUNCTION IF EXISTS public.heartbeat_worker(uuid, text);
DROP FUNCTION IF EXISTS public.mark_worker_stale(integer);
DROP FUNCTION IF EXISTS public.drain_worker(uuid, text, text);
DROP FUNCTION IF EXISTS public.release_worker_quarantine(uuid, text);
DROP FUNCTION IF EXISTS public.request_job_cancellation(uuid, text, text);
DROP TABLE IF EXISTS public.job_audit_log, public.worker_audit_log, public.job_runs, public.worker_leases,
  public.workers, public.agent_policies, public.agents, public.jobs, public.workspaces CASCADE;
CREATE TABLE public.workspaces (id uuid PRIMARY KEY, concurrency_limit integer NOT NULL);
CREATE TABLE public.agents (id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.agent_policies (agent_id uuid PRIMARY KEY, allow_execution boolean, max_concurrent_runs integer);
CREATE TABLE public.jobs (id uuid PRIMARY KEY, status text NOT NULL, max_concurrent_runs integer NOT NULL);
CREATE TABLE public.workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, worker_identity text NOT NULL,
  instance_identity text NOT NULL DEFAULT 'test-instance', version text NOT NULL DEFAULT '1.0.0',
  status text NOT NULL, current_concurrency integer NOT NULL DEFAULT 0,
  max_concurrency integer NOT NULL DEFAULT 2, capabilities text[] NOT NULL DEFAULT ARRAY['ai'],
  quarantined_at timestamptz, quarantine_reason text, stopped_at timestamptz,
  last_heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(), registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  draining_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.worker_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worker_id uuid NOT NULL, workspace_id uuid NOT NULL,
  job_run_id uuid NOT NULL, fencing_token bigint NOT NULL,
  leased_at timestamptz, expires_at timestamptz NOT NULL,
  released_at timestamptz, status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.job_runs (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, job_id uuid NOT NULL, agent_id uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(), priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL, worker_id text, lease_expires_at timestamptz,
  started_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 1, attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3, error_code text, error_message text,
  completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.worker_audit_log (
  workspace_id uuid, worker_id uuid, actor_type text, actor_id text, action text,
  previous_status text, new_status text, details jsonb
);
CREATE TABLE public.job_audit_log (
  workspace_id uuid, job_id uuid, job_run_id uuid, actor_type text, actor_id text,
  action text, previous_status text, new_status text, fencing_token bigint,
  worker_id text, details jsonb
);
${functionSql("quarantine_worker")}
${functionSql("register_worker")}
${functionSql("heartbeat_worker")}
${functionSql("mark_worker_stale")}
${functionSql("drain_worker")}
${functionSql("release_worker_quarantine")}
${functionSql("request_job_cancellation")}
${functionSql("release_worker_lease")}
${functionSql("recover_worker_jobs")}
${functionSql("claim_job_run_v2")}
CREATE OR REPLACE FUNCTION public.test_delay_row_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS test_delay_worker_update ON public.workers;
DROP TRIGGER IF EXISTS test_delay_lease_update ON public.worker_leases;
CREATE TRIGGER test_delay_worker_update BEFORE UPDATE ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.test_delay_row_update();
CREATE TRIGGER test_delay_lease_update BEFORE UPDATE ON public.worker_leases
  FOR EACH ROW EXECUTE FUNCTION public.test_delay_row_update();
`;

runPsql(setupSql);

async function seedLease({ expired = false, runStatus = "running" } = {}) {
  runPsql(`
    TRUNCATE public.job_audit_log, public.worker_audit_log, public.job_runs, public.worker_leases, public.workers;
    INSERT INTO public.workers(id, workspace_id, worker_identity, status, current_concurrency)
      VALUES ('${workerId}', '${workerId}', 'worker-lock-test', 'HEALTHY', 1);
    INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, worker_id, fencing_token, lease_expires_at)
      VALUES ('${runId}', '${workerId}', '${runId}', '${agentId}', '${runStatus}', 'worker-lock-test', 1, clock_timestamp() + interval '1 hour');
    INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
      VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1,
        clock_timestamp() ${expired ? "-" : "+"} interval '${expired ? "1 second" : "1 hour"}', 'active');
  `);
}

async function race(name, leftSql, rightSql, options = {}) {
  await seedLease(options);
  const left = launchPsql(`SET deadlock_timeout='300ms'; SET statement_timeout='8s'; ${leftSql}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const right = launchPsql(`SET deadlock_timeout='300ms'; SET statement_timeout='8s'; ${rightSql}`);
  const [leftResult, rightResult] = await Promise.all([left.done, right.done]);
  assert.equal(leftResult.code, 0, `${name}: first transaction failed:\n${leftResult.stderr}\n${leftResult.stdout}`);
  assert.equal(rightResult.code, 0, `${name}: second transaction failed:\n${rightResult.stderr}\n${rightResult.stdout}`);
  assert(!leftResult.stderr.includes("deadlock detected") && !rightResult.stderr.includes("deadlock detected"), `${name}: PostgreSQL reported a deadlock`);
  const activeLeases = runPsql("SELECT count(*) FROM public.worker_leases WHERE status='active'");
  assert.equal(activeLeases, "0", `${name}: active lease remained after both operations`);
  const [workerStatus, workerConcurrency, leaseStatus, runStatus, fencingToken] = JSON.parse(runPsql(`
    SELECT json_build_array(w.status, w.current_concurrency, l.status, r.status, r.fencing_token)::text
    FROM public.workers w
    JOIN public.worker_leases l ON l.worker_id=w.id
    JOIN public.job_runs r ON r.id=l.job_run_id
    WHERE w.id='${workerId}' AND l.id='${leaseId}'
  `));
  assert.equal(workerConcurrency, 0, `${name}: worker concurrency did not reconcile`);
  if (options.expectedWorkerStatus) {
    assert.equal(workerStatus, options.expectedWorkerStatus, `${name}: unexpected worker status`);
  }
  assert(options.allowedLeaseStatuses?.includes(leaseStatus), `${name}: unexpected lease status ${leaseStatus}`);
  assert(options.allowedRunStatuses?.includes(runStatus), `${name}: unexpected run status ${runStatus}`);
  assert(options.allowedFencingTokens?.includes(fencingToken), `${name}: unexpected fencing token ${fencingToken}`);
  recordPass(name);
}

await race(
  "release-first race still lets quarantine requeue an active run",
  `SELECT public.release_worker_lease('${leaseId}', '${workerId}', 1)`,
  `SELECT public.quarantine_worker('${workerId}', 'tester', 'lock-order regression')`,
  {
    runStatus: "running",
    expectedWorkerStatus: "QUARANTINED",
    allowedLeaseStatuses: ["revoked"],
    allowedRunStatuses: ["queued"],
    allowedFencingTokens: [2],
  },
);

runPsql(`
  TRUNCATE public.job_audit_log, public.worker_audit_log, public.job_runs, public.worker_leases,
    public.workers, public.agent_policies, public.agents, public.jobs, public.workspaces;
  INSERT INTO public.workspaces(id, concurrency_limit) VALUES ('${workerId}', 5);
  INSERT INTO public.agents(id, status) VALUES ('${agentId}', 'active');
  INSERT INTO public.agent_policies(agent_id, allow_execution, max_concurrent_runs) VALUES ('${agentId}', true, 5);
  INSERT INTO public.jobs(id, status, max_concurrent_runs) VALUES ('${jobId}', 'active', 5);
  INSERT INTO public.workers(id, workspace_id, worker_identity, status, current_concurrency, max_concurrency)
    VALUES ('${workerId}', '${workerId}', 'dispatcher-worker-a', 'HEALTHY', 0, 2),
           ('${workerId2}', '${workerId}', 'dispatcher-worker-b', 'HEALTHY', 0, 2);
  INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, fencing_token)
    VALUES ('${runId}', '${workerId}', '${jobId}', '${agentId}', 'queued', 1);
`);
const claimA = launchPsql(`SET deadlock_timeout='300ms'; SET statement_timeout='8s'; SELECT public.claim_job_run_v2('${workerId}', 60, null)`);
await new Promise((resolve) => setTimeout(resolve, 100));
const claimB = launchPsql(`SET deadlock_timeout='300ms'; SET statement_timeout='8s'; SELECT public.claim_job_run_v2('${workerId2}', 60, null)`);
const [claimAResult, claimBResult] = await Promise.all([claimA.done, claimB.done]);
assert.equal(claimAResult.code, 0, `dispatcher A claim failed: ${claimAResult.stderr}`);
assert.equal(claimBResult.code, 0, `dispatcher B claim failed: ${claimBResult.stderr}`);
const claims = [JSON.parse(claimAResult.stdout.trim()), JSON.parse(claimBResult.stdout.trim())];
assert.equal(claims.filter((claim) => claim.claimed === true).length, 1, "two dispatchers claimed the same queued job");
assert.equal(claims.filter((claim) => claim.claimed === false).length, 1, "the losing dispatcher did not receive an empty claim result");
assert.equal(runPsql("SELECT count(*) FROM public.worker_leases WHERE status='active'"), "1", "double claim created multiple active leases");
assert.equal(runPsql("SELECT count(*) FROM public.job_runs WHERE id='00000000-0000-0000-0000-000000000003' AND status='claimed'"), "1", "job run was not claimed exactly once");
assert.equal(runPsql("SELECT sum(current_concurrency) FROM public.workers"), "1", "worker concurrency was incremented more than once");
recordPass("Concurrent dispatchers produce exactly one claim and one active lease");

await race(
  "quarantine concurrent with recovery",
  `SELECT public.quarantine_worker('${workerId}', 'tester', 'lock-order regression')`,
  "SELECT public.recover_worker_jobs(20)",
  {
    expired: true,
    expectedWorkerStatus: "QUARANTINED",
    allowedLeaseStatuses: ["revoked", "expired"],
    allowedRunStatuses: ["queued"],
    allowedFencingTokens: [2],
  },
);

await race(
  "release concurrent with recovery",
  `SELECT public.release_worker_lease('${leaseId}', '${workerId}', 1)`,
  "SELECT public.recover_worker_jobs(20)",
  {
    expired: true,
    expectedWorkerStatus: "HEALTHY",
    allowedLeaseStatuses: ["released", "expired"],
    allowedRunStatuses: ["running", "queued"],
    allowedFencingTokens: [1, 2],
  },
);

// Execute WorkerRegistry lifecycle RPCs extracted from the migration itself.
// These checks deliberately use disposable PostgreSQL rows, not the in-memory client.
runPsql(`DROP TRIGGER IF EXISTS test_delay_worker_update ON public.workers;
DROP TRIGGER IF EXISTS test_delay_lease_update ON public.worker_leases;`);

function registryFixture(status = "HEALTHY") {
  runPsql(`TRUNCATE public.job_audit_log, public.worker_audit_log, public.job_runs, public.worker_leases, public.workers;
    INSERT INTO public.workers(id, workspace_id, worker_identity, instance_identity, status, current_concurrency)
      VALUES ('${workerId}', '${workerId}', 'registry-worker', 'registry-instance-1', '${status}', 0);`);
}

function registryResult(sql) {
  return JSON.parse(runPsql(`SELECT (${sql})::text`));
}

registryFixture();
const registration = registryResult(`public.register_worker('${workerId}', 'registry-worker', 'registry-instance-1', '1.0.0', ARRAY['ai'], 2, '{}'::jsonb)`);
assert.equal(registration.success, true, "registration RPC did not succeed");
assert.equal(registration.worker.status, "HEALTHY", "registration RPC did not persist HEALTHY state");
assert.equal(runPsql(`SELECT count(*) FROM public.worker_audit_log WHERE worker_id='${workerId}' AND action='WORKER_REGISTERED'`), "1");
recordPass("Worker registration persists HEALTHY state and audit record");

const restart = registryResult(`public.register_worker('${workerId}', 'registry-worker', 'registry-instance-2', '1.1.0', ARRAY['ai'], 2, '{}'::jsonb)`);
assert.equal(restart.success, true, "restart registration RPC did not succeed");
assert.equal(restart.worker.instance_identity, "registry-instance-2", "restart did not replace instance identity");
assert.equal(runPsql("SELECT count(*) FROM public.workers"), "1", "restart created a duplicate worker row");
recordPass("Worker restart updates the existing row with a new instance identity");

const heartbeat = registryResult(`public.heartbeat_worker('${workerId}', 'registry-instance-2')`);
assert.equal(heartbeat.success, true, "matching heartbeat was rejected");
assert.equal(heartbeat.status, "HEALTHY", "heartbeat returned the wrong state");
recordPass("Heartbeat accepts the current instance identity");

const invalidHeartbeat = registryResult(`public.heartbeat_worker('${workerId}', 'registry-instance-old')`);
assert.equal(invalidHeartbeat.success, false, "stale instance heartbeat was accepted");
assert.equal(invalidHeartbeat.error_code, "INSTANCE_MISMATCH", "stale instance returned the wrong error");
recordPass("Invalid instance identity is rejected by heartbeat");

runPsql(`UPDATE public.workers SET last_heartbeat_at=clock_timestamp()-interval '2 minutes' WHERE id='${workerId}'`);
assert.equal(runPsql("SELECT public.mark_worker_stale(90)"), "1", "stale worker was not marked");
assert.equal(runPsql(`SELECT status FROM public.workers WHERE id='${workerId}'`), "STALE");
recordPass("Worker stale transition follows the configured heartbeat timeout");

const drained = registryResult(`public.drain_worker('${workerId}', 'tester', 'shutdown')`);
assert.equal(drained.success, true, "drain RPC did not succeed");
assert.equal(drained.status, "STOPPED", "drain without leases did not stop immediately");
recordPass("Drain without active leases stops the worker immediately");

const quarantined = registryResult(`public.quarantine_worker('${workerId}', 'tester', 'integration test')`);
assert.equal(quarantined.success, true, "quarantine RPC did not succeed");
assert.equal(runPsql(`SELECT status FROM public.workers WHERE id='${workerId}'`), "QUARANTINED");
recordPass("Quarantine persists QUARANTINED state");

const released = registryResult(`public.release_worker_quarantine('${workerId}', 'tester')`);
assert.equal(released.success, true, "quarantine release RPC did not succeed");
assert.equal(released.status, "STOPPED", "quarantine release did not require a clean restart");
recordPass("Release quarantine returns worker to STOPPED");

function claimFixture({ workspaceLimit = 5, agentLimit = 5, jobLimit = 5, workerConcurrency = 0,
  workerMax = 2, workerCapabilities = ["ai"], activeStatus = null, queuedWorkspace = workerId } = {}) {
  runPsql(`TRUNCATE public.job_audit_log, public.worker_audit_log, public.job_runs, public.worker_leases,
    public.workers, public.agent_policies, public.agents, public.jobs, public.workspaces;
    INSERT INTO public.workspaces(id, concurrency_limit) VALUES ('${workerId}', ${workspaceLimit});
    INSERT INTO public.agents(id, status) VALUES ('${agentId}', 'active');
    INSERT INTO public.agent_policies(agent_id, allow_execution, max_concurrent_runs) VALUES ('${agentId}', true, ${agentLimit});
    INSERT INTO public.jobs(id, status, max_concurrent_runs) VALUES ('${jobId}', 'active', ${jobLimit});
    INSERT INTO public.workers(id, workspace_id, worker_identity, status, current_concurrency, max_concurrency, capabilities)
      VALUES ('${workerId}', '${workerId}', 'capacity-worker', 'HEALTHY', ${workerConcurrency}, ${workerMax}, ARRAY[${workerCapabilities.map((c) => `'${c}'`).join(",")}]);
    ${activeStatus ? `INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, fencing_token)
      VALUES ('${leaseId}', '${workerId}', '${jobId}', '${agentId}', '${activeStatus}', 1);` : ""}
    INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, fencing_token)
      VALUES ('${runId}', '${queuedWorkspace}', '${jobId}', '${agentId}', 'queued', 1);`);
}

function claimResult(requiredCapabilities = "null") {
  return JSON.parse(runPsql(`SELECT public.claim_job_run_v2('${workerId}', 60, ${requiredCapabilities})::text`));
}

claimFixture({ workerCapabilities: ["ai"] });
const capabilityClaim = claimResult("ARRAY['browser']::text[]");
assert.equal(capabilityClaim.error_code, "CAPABILITY_MISMATCH", "claim did not enforce required capabilities");
recordPass("Capability matching rejects a worker missing required capabilities");

claimFixture({ workerConcurrency: 2, workerMax: 2 });
const workerCapacityClaim = claimResult();
assert.equal(workerCapacityClaim.error_code, "CAPACITY_EXCEEDED", "claim exceeded worker capacity");
recordPass("Worker capacity prevents exceeding max_concurrency");

claimFixture({ workspaceLimit: 1, activeStatus: "running" });
assert.equal(claimResult().claimed, false, "claim exceeded workspace concurrency");
recordPass("Workspace concurrency limit blocks additional claims");

claimFixture({ agentLimit: 1, activeStatus: "running" });
assert.equal(claimResult().claimed, false, "claim exceeded agent concurrency");
recordPass("Agent concurrency limit blocks additional claims");

claimFixture({ jobLimit: 1, activeStatus: "running" });
assert.equal(claimResult().claimed, false, "claim exceeded job concurrency");
recordPass("Job concurrency limit blocks additional claims");

claimFixture({ queuedWorkspace: workerId2 });
assert.equal(claimResult().claimed, false, "worker claimed a queued run from another workspace");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${runId}'`), "queued");
recordPass("Cross-tenant claim is rejected");

registryFixture();
runPsql(`INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, worker_id, fencing_token)
  VALUES ('${runId}', '${workerId}', '${jobId}', '${agentId}', 'running', 'registry-worker', 9);
  INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 9, clock_timestamp() + interval '1 hour', 'active');
  UPDATE public.workers SET current_concurrency=1 WHERE id='${workerId}';`);
const staleFence = registryResult(`public.release_worker_lease('${leaseId}', '${workerId}', 8)`);
assert.equal(staleFence.error_code, "FENCING_REJECTED", "stale fencing token released a lease");
assert.equal(runPsql(`SELECT status FROM public.worker_leases WHERE id='${leaseId}'`), "active");
recordPass("Fencing rejects a stale token without releasing the lease");

registryFixture();
runPsql(`UPDATE public.workers SET status='DRAINING', current_concurrency=1 WHERE id='${workerId}';
  INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1, clock_timestamp() + interval '1 hour', 'active');`);
const releasedDrainLease = registryResult(`public.release_worker_lease('${leaseId}', '${workerId}', 1)`);
assert.equal(releasedDrainLease.success, true, "active drain lease was not released");
assert.equal(runPsql(`SELECT status FROM public.workers WHERE id='${workerId}'`), "STOPPED");
assert.equal(runPsql(`SELECT current_concurrency FROM public.workers WHERE id='${workerId}'`), "0");
recordPass("Releasing the last lease completes an orderly drain");

claimFixture();
runPsql(`UPDATE public.workers SET status='QUARANTINED' WHERE id='${workerId}'`);
const quarantinedClaim = claimResult();
assert.equal(quarantinedClaim.error_code, "WORKER_NOT_ELIGIBLE", "quarantined worker was allowed to claim");
recordPass("Claim rejects a quarantined worker");

claimFixture();
runPsql(`UPDATE public.workers SET current_concurrency=1 WHERE id='${workerId}';
  INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, worker_id, fencing_token, attempt, max_attempts)
  VALUES ('${leaseId}', '${workerId}', '${jobId}', '${agentId}', 'running', 'capacity-worker', 4, 0, 3);
  INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${leaseId}', 4, clock_timestamp() - interval '1 second', 'active');`);
const recovered = registryResult("public.recover_worker_jobs(20)");
assert.equal(recovered.recovered_count, 1, "expired lease was not recovered");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${leaseId}'`), "queued");
assert.equal(runPsql(`SELECT fencing_token FROM public.job_runs WHERE id='${leaseId}'`), "5");
recordPass("Lease recovery requeues the run and increments its fencing token");

claimFixture();
const cancelled = registryResult(`public.request_job_cancellation('${runId}', 'tester', 'cancel test')`);
assert.equal(cancelled.success, true, "queued run cancellation failed");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${runId}'`), "cancelled");
recordPass("Cancellation immediately cancels a queued run");

registryFixture();
const emptyQuarantineReason = registryResult(`public.quarantine_worker('${workerId}', 'tester', '   ')`);
assert.equal(emptyQuarantineReason.error_code, "REASON_REQUIRED", "empty quarantine reason was accepted");
recordPass("Quarantine rejects an empty reason");

registryFixture();
const invalidRegistration = registryResult(`public.register_worker('${workerId}', ' ', 'instance-invalid', '1.0.0', ARRAY['ai'], 2, '{}'::jsonb)`);
assert.equal(invalidRegistration.error_code, "INVALID_PARAMETERS", "invalid worker identity was accepted");
recordPass("Worker registration rejects an invalid identity");

registryFixture("QUARANTINED");
const quarantinedRegistration = registryResult(`public.register_worker('${workerId}', 'registry-worker', 'instance-new', '1.0.0', ARRAY['ai'], 2, '{}'::jsonb)`);
assert.equal(quarantinedRegistration.error_code, "WORKER_QUARANTINED", "quarantined worker self-registered");
recordPass("Worker registration cannot release quarantine");

registryFixture();
runPsql(`INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1, clock_timestamp() + interval '1 hour', 'active');`);
const reconciledHeartbeat = registryResult(`public.heartbeat_worker('${workerId}', 'registry-instance-1')`);
assert.equal(reconciledHeartbeat.current_concurrency, 1, "heartbeat did not reconcile active lease count");
assert.equal(runPsql(`SELECT current_concurrency FROM public.workers WHERE id='${workerId}'`), "1");
recordPass("Heartbeat reconciles worker concurrency from active leases");

registryFixture();
assert.equal(runPsql("SELECT public.mark_worker_stale(90)"), "0", "fresh worker was incorrectly marked stale");
assert.equal(runPsql(`SELECT status FROM public.workers WHERE id='${workerId}'`), "HEALTHY");
recordPass("Fresh worker remains healthy below the stale threshold");

registryFixture();
runPsql(`INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1, clock_timestamp() + interval '1 hour', 'active');`);
const draining = registryResult(`public.drain_worker('${workerId}', 'tester', 'graceful')`);
assert.equal(draining.status, "DRAINING", "worker with active lease did not enter DRAINING");
recordPass("Drain with an active lease preserves DRAINING state");

registryFixture();
runPsql(`INSERT INTO public.job_runs(id, workspace_id, job_id, agent_id, status, worker_id, fencing_token)
  VALUES ('${runId}', '${workerId}', '${jobId}', '${agentId}', 'running', 'registry-worker', 1);
  INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1, clock_timestamp() + interval '1 hour', 'active');
  UPDATE public.workers SET current_concurrency=1 WHERE id='${workerId}';`);
const quarantineActive = registryResult(`public.quarantine_worker('${workerId}', 'tester', 'safety test')`);
assert.equal(quarantineActive.revoked_leases, 1, "quarantine did not revoke the active lease");
assert.equal(runPsql(`SELECT status FROM public.worker_leases WHERE id='${leaseId}'`), "revoked");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${runId}'`), "queued");
assert.equal(runPsql(`SELECT fencing_token FROM public.job_runs WHERE id='${runId}'`), "2");
recordPass("Quarantine revokes active lease, requeues run, and fences old worker");

registryFixture();
const releaseNotQuarantined = registryResult(`public.release_worker_quarantine('${workerId}', 'tester')`);
assert.equal(releaseNotQuarantined.error_code, "NOT_QUARANTINED", "non-quarantined worker was released");
recordPass("Quarantine release rejects a worker that is not quarantined");

claimFixture();
const successfulClaim = claimResult();
assert.equal(successfulClaim.claimed, true, "eligible queued job was not claimed");
assert.equal(runPsql("SELECT count(*) FROM public.worker_leases WHERE status='active'"), "1");
assert.equal(runPsql(`SELECT current_concurrency FROM public.workers WHERE id='${workerId}'`), "1");
recordPass("Eligible claim creates one active lease and increments worker concurrency");

claimFixture();
runPsql(`UPDATE public.job_runs SET status='cancelled' WHERE id='${runId}'`);
assert.equal(claimResult().claimed, false, "claim returned a cancelled run");
recordPass("Empty eligible queue returns no claim");

claimFixture();
runPsql(`UPDATE public.job_runs SET status='running' WHERE id='${runId}'`);
const runningCancel = registryResult(`public.request_job_cancellation('${runId}', 'tester', 'checkpoint')`);
assert.equal(runningCancel.status, "cancellation_requested", "running cancellation was not graceful");
recordPass("Cancellation of a running job requests a safe checkpoint");

claimFixture();
runPsql(`UPDATE public.workers SET current_concurrency=1 WHERE id='${workerId}';
  UPDATE public.job_runs SET status='running', worker_id='capacity-worker', attempt=3, max_attempts=3 WHERE id='${runId}';
  INSERT INTO public.worker_leases(id, worker_id, workspace_id, job_run_id, fencing_token, expires_at, status)
  VALUES ('${leaseId}', '${workerId}', '${workerId}', '${runId}', 1, clock_timestamp() - interval '1 second', 'active');`);
const exhaustedRecovery = registryResult("public.recover_worker_jobs(20)");
assert.equal(exhaustedRecovery.recovered_count, 1, "exhausted lease was not recovered");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${runId}'`), "dead_letter");
recordPass("Recovery sends a run with exhausted attempts to dead letter");

assert.equal(realTestNumber, 35, `expected 35 real PostgreSQL checks, received ${realTestNumber}`);

registryFixture();
const unauthorizedHeartbeat = JSON.parse(runPsql(`SET request.jwt.claim.sub='${workerId2}';
  SELECT public.heartbeat_worker('${workerId}', 'registry-instance-1')::text`));
assert.equal(unauthorizedHeartbeat.error_code, "UNAUTHORIZED_WORKSPACE", "non-member accessed another workspace's worker");
console.log("PASS: real authenticated heartbeat rejects a non-member from another tenant");

const { WorkerRegistry, ControlPlaneError } = await import("../src/lib/control-plane/index.ts");
const { Dispatcher } = await import("../src/lib/control-plane/Dispatcher.ts");

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `ARRAY[${value.map(sqlQuote).join(",")}]::text[]`;
  if (typeof value === "object") return `${sqlQuote(JSON.stringify(value))}::jsonb`;
  return sqlQuote(value);
}

class LocalPostgresSupabaseClient {
  async rpc(functionName, params) {
    assert.match(functionName, /^[a-z_][a-z0-9_]*$/);
    try {
      const raw = runPsql(`SELECT public.${functionName}(${Object.values(params).map(sqlValue).join(", ")})::text`);
      return { data: /^-?\d+$/.test(raw) ? Number(raw) : JSON.parse(raw), error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: "LOCAL_POSTGRES_ERROR" } };
    }
  }

  from(table) {
    assert.ok(["workers", "worker_leases", "job_runs"].includes(table), `unsupported local table ${table}`);
    const filters = [];
    let orderBy = null;
    let ascending = true;
    const execute = async () => {
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const order = orderBy ? `ORDER BY ${orderBy} ${ascending ? "ASC" : "DESC"}` : "";
      const rows = runPsql(`SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)::text FROM (SELECT * FROM public.${table} ${where} ${order}) q`);
      return { data: JSON.parse(rows), error: null };
    };
    const chain = {
      select() { return chain; },
      eq(field, value) {
        assert.match(field, /^[a-z_][a-z0-9_]*$/);
        filters.push(`${field} = ${sqlValue(value)}`);
        return chain;
      },
      contains(field, value) {
        assert.match(field, /^[a-z_][a-z0-9_]*$/);
        filters.push(`${field} @> ${sqlValue(value)}`);
        return chain;
      },
      order(field, options = {}) {
        assert.match(field, /^[a-z_][a-z0-9_]*$/);
        orderBy = field;
        ascending = options.ascending ?? true;
        return chain;
      },
      async maybeSingle() {
        const result = await execute();
        return { data: result.data[0] ?? null, error: result.error };
      },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return chain;
  }
}

const applicationClient = new LocalPostgresSupabaseClient();
const workerRegistry = new WorkerRegistry(applicationClient);
registryFixture();
const registryRead = await workerRegistry.getWorker(workerId);
assert.equal(registryRead?.worker_identity, "registry-worker", "WorkerRegistry.getWorker did not read PostgreSQL");
console.log("PASS: TypeScript WorkerRegistry.getWorker reads the real PostgreSQL fixture");

const registeredViaTypeScript = await workerRegistry.register({
  workspaceId: workerId,
  workerIdentity: "registry-ts-worker",
  instanceIdentity: "registry-ts-instance",
  maxConcurrency: 2,
});
assert.equal(registeredViaTypeScript.success, true, "WorkerRegistry.register failed against PostgreSQL");
console.log("PASS: TypeScript WorkerRegistry.register invokes the real register_worker RPC");

registryFixture();
const heartbeatViaTypeScript = await workerRegistry.heartbeat(workerId, "registry-instance-1");
assert.equal(heartbeatViaTypeScript.success, true, "WorkerRegistry.heartbeat failed against PostgreSQL");
console.log("PASS: TypeScript WorkerRegistry.heartbeat invokes the real heartbeat_worker RPC");

const identityA = workerRegistry.generateInstanceIdentity("worker-prod-01");
const identityB = workerRegistry.generateInstanceIdentity("worker-prod-01");
assert.notEqual(identityA, identityB, "WorkerRegistry generated duplicate boot identities");
console.log("PASS: TypeScript WorkerRegistry generates unique instance identities per boot");

claimFixture();
let dispatchedEvent = null;
const dispatcher = new Dispatcher(applicationClient, { workspaceId: workerId, dispatcherId: "postgres-dispatcher" });
dispatcher.onDispatch((event) => { dispatchedEvent = event; });
const dispatchResult = await dispatcher.tick();
assert.equal(dispatchResult.claimsMade, 1, "TypeScript Dispatcher did not claim through PostgreSQL");
assert.equal(dispatchedEvent?.jobRun.id, runId, "Dispatcher callback did not receive the claimed job");
assert.ok(dispatchedEvent?.fencingToken, "Dispatcher callback did not receive the fencing token");
console.log("PASS: TypeScript Dispatcher tick claims a real PostgreSQL job and delivers its lease");

claimFixture();
runPsql(`UPDATE public.job_runs SET status='cancelled' WHERE id='${runId}'`);
const emptyDispatcher = new Dispatcher(applicationClient, { workspaceId: workerId });
const emptyDispatchResult = await emptyDispatcher.tick();
assert.equal(emptyDispatchResult.claimsMade, 0, "empty PostgreSQL queue produced a claim");
assert.equal(emptyDispatcher.getStatus(), "BACKOFF", "empty PostgreSQL queue did not enter BACKOFF");
console.log("PASS: TypeScript Dispatcher backs off when the real PostgreSQL queue is empty");

claimFixture({ workerConcurrency: 2, workerMax: 2 });
const saturatedDispatcher = new Dispatcher(applicationClient, { workspaceId: workerId });
const saturatedResult = await saturatedDispatcher.tick();
assert.equal(saturatedResult.claimsMade, 0, "Dispatcher exceeded worker capacity");
assert.equal(runPsql(`SELECT status FROM public.job_runs WHERE id='${runId}'`), "queued");
console.log("PASS: TypeScript Dispatcher applies backpressure at worker capacity");

const fencingError = ControlPlaneError.classify({ code: "FENCING_REJECTED", message: "stale token" });
assert.equal(fencingError.code, "FENCING", "ControlPlaneError misclassified fencing rejection");
console.log("PASS: TypeScript ControlPlaneError classifies a real fencing error code");

claimFixture();
runPsql(`UPDATE public.job_runs SET status='cancelled' WHERE id='${runId}'`);
const loopDispatcher = new Dispatcher(applicationClient, { workspaceId: workerId, pollIntervalMs: 200, maxPollIntervalMs: 200 });
await loopDispatcher.start();
await new Promise((resolve) => setTimeout(resolve, 50));
const cyclesBeforeStop = loopDispatcher.getMetrics().cyclesTotal;
loopDispatcher.stop();
assert.equal(loopDispatcher.getStatus(), "STOPPED", "Dispatcher did not stop promptly");
assert.ok(cyclesBeforeStop <= 1, `Dispatcher busy-looped through ${cyclesBeforeStop} cycles`);
console.log("PASS: TypeScript Dispatcher startup/shutdown avoids a busy loop on an empty queue");

claimFixture();
runPsql(`INSERT INTO public.workers(id, workspace_id, worker_identity, status, current_concurrency, max_concurrency, capabilities)
  VALUES ('${workerId2}', '${workerId}', 'capacity-worker-b', 'HEALTHY', 0, 2, ARRAY['ai']);`);
const dispatcherA = new Dispatcher(applicationClient, { workspaceId: workerId, dispatcherId: "concurrent-dispatcher-a" });
const dispatcherB = new Dispatcher(applicationClient, { workspaceId: workerId, dispatcherId: "concurrent-dispatcher-b" });
const [dispatcherAResult, dispatcherBResult] = await Promise.all([dispatcherA.tick(), dispatcherB.tick()]);
assert.equal(dispatcherAResult.claimsMade + dispatcherBResult.claimsMade, 1, "two TypeScript dispatchers double-claimed one run");
assert.equal(runPsql("SELECT count(*) FROM public.worker_leases WHERE status='active'"), "1");
assert.equal(runPsql("SELECT sum(current_concurrency) FROM public.workers"), "1");
console.log("PASS: two TypeScript Dispatcher instances cannot double-claim or overflow capacity");
