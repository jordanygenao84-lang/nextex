import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261011_production_control_plane.sql", import.meta.url), "utf8");

function functionBody(name, nextMarker) {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = nextMarker ? migration.indexOf(nextMarker, start) : migration.length;
  assert.notEqual(end, -1, `missing end marker after ${name}`);
  return migration.slice(start, end);
}

const quarantine = functionBody("quarantine_worker", "-- F) release_worker_quarantine");
const release = functionBody("release_worker_lease", "-- I) request_job_cancellation");
const recovery = functionBody("recover_worker_jobs");

const quarantineWorkerLock = quarantine.indexOf("from public.workers where id = p_worker_id for update");
const quarantineLeaseLock = quarantine.indexOf("from public.worker_leases", quarantineWorkerLock);
assert(quarantineWorkerLock >= 0 && quarantineLeaseLock > quarantineWorkerLock, "quarantine must lock worker before its leases");

const releaseWorkerLock = release.indexOf("from public.workers where id = p_worker_id for update");
const releaseLeaseLock = release.indexOf("from public.worker_leases where id = p_lease_id for update");
assert(releaseWorkerLock >= 0 && releaseLeaseLock > releaseWorkerLock, "lease release must lock worker before lease");

const recoveryWorkerLock = recovery.indexOf("from public.workers where id = v_worker_id for update");
const recoveryLeaseLock = recovery.indexOf("for update of lease_row skip locked", recoveryWorkerLock);
assert(recoveryWorkerLock >= 0 && recoveryLeaseLock > recoveryWorkerLock, "recovery must lock candidate workers before leases");

console.log("PASS: quarantine, lease release, and recovery follow worker→lease lock order");
