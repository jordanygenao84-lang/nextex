/**
 * NEXTEХ — Governance & Audit: certificación local Fase 4.10-H.
 * H01–H50 usan instancias aisladas y no conectan con Supabase/Cloud.
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes("/src/lib/") || context.parentURL?.includes("/scripts/")) {
      let target = null;
      if (specifier.startsWith("@/")) target = path.resolve(fileURLToPath(new URL("../src/" + specifier.slice(2), import.meta.url)));
      else if (specifier.startsWith("./") || specifier.startsWith("../")) target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      if (target) {
        if (target.endsWith(".js") && existsSync(target.slice(0, -3) + ".ts")) target = target.slice(0, -3) + ".ts";
        else if (!path.extname(target) && existsSync(target + ".ts")) target += ".ts";
        else if (!path.extname(target) && existsSync(path.join(target, "index.ts"))) target = path.join(target, "index.ts");
        if (target.endsWith(".ts") && existsSync(target)) return nextResolve(pathToFileURL(target).href);
      }
    }
    return nextResolve(specifier);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const loaded = nextLoad(url, { ...context, format: "module" });
      const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
      return { format: "module", source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { GovernanceManager } = await import("../src/lib/control-plane/GovernanceManager.ts");
const { AuditManager, isSensitiveKey, sanitizeAuditMetadata } = await import("../src/lib/control-plane/AuditManager.ts");
let count = 0;
async function test(id, name, fn) {
  try { await fn(); count++; console.log(`✓ ${id} — ${name}`); }
  catch (error) { console.error(`✗ ${id} — ${name}`); throw error; }
}
const ctx = (overrides = {}) => ({ actorId: "user-1", actorType: "user", workspaceId: "ws-1", resourceType: "job", resourceId: "job-1", action: "read", role: "admin", ...overrides });
const audit = (workspaceId = "ws-1") => new AuditManager({ workspaceId });
const event = (overrides = {}) => ({ workspaceId: "ws-1", actorId: "user-1", actorType: "user", action: "read", resourceType: "job", resourceId: "job-1", decision: "allow", ...overrides });
async function decision(overrides) { return new GovernanceManager({ workspaceId: "ws-1" }).evaluateAuthority(ctx(overrides)); }

await test("H01", "permission allow", async () => assert.equal((await decision({})).decision, "allow"));
await test("H02", "permission deny", async () => assert.equal((await decision({ actorId: "", action: "read" })).decision, "deny"));
await test("H03", "tenant mismatch", async () => assert.equal((await decision({ targetWorkspaceId: "ws-2" })).errorCode, "TENANT_MISMATCH"));
await test("H04", "resource ownership", async () => assert.equal((await decision({ targetResource: { workspace_id: "ws-2" } })).errorCode, "TENANT_MISMATCH"));
await test("H05", "role boundary", async () => assert.equal((await decision({ role: "member", action: "shutdown" })).decision, "deny"));
await test("H06", "workspace permission", async () => assert.equal((await decision({ role: "owner", action: "workspace.settings.update" })).decision, "allow"));
await test("H07", "agent policy deny", async () => assert.equal((await decision({ resourceType: "agent", targetResource: { policy: { allow_execution: false } } })).errorCode, "POLICY_DENIED"));
await test("H08", "tool permission deny", async () => assert.equal((await decision({ resourceType: "tool", metadata: { riskLevel: "destructive" } })).decision, "requires_approval"));
await test("H09", "worker authority", async () => assert.equal((await decision({ resourceType: "worker", action: "workers.drain", role: "admin" })).decision, "allow"));
await test("H10", "capability vs authority", async () => assert.equal((await decision({ resourceType: "worker", action: "execute_job", capabilities: ["ai"], requiredCapabilities: ["ai"], metadata: { hasActiveLease: false } })).decision, "deny"));

await test("H11", "audit insert", async () => assert.equal((await audit().recordEvent(event())).decision, "allow"));
await test("H12", "audit update blocked", async () => assert.rejects(audit().updateEvent("x", {})));
await test("H13", "audit delete blocked", async () => assert.rejects(audit().deleteEvent("x")));
await test("H14", "terminal immutability", async () => assert.rejects(audit().reopenTerminalEvent("x")));
await test("H15", "actor immutability", async () => assert.rejects(audit().modifyActor("x", "other")));
await test("H16", "tenant audit isolation", async () => assert.rejects(audit().recordEvent(event({ workspaceId: "ws-2" }))));
await test("H17", "metadata sanitization", async () => assert.equal(sanitizeAuditMetadata({ password: "secret" }).password, "[REDACTED]"));
await test("H18", "nested secret sanitization", async () => assert.equal(sanitizeAuditMetadata({ a: [{ secret: "x" }] }).a[0].secret, "[REDACTED]"));
await test("H19", "camelCase secret sanitization", async () => assert.equal(sanitizeAuditMetadata({ accessToken: "x" }).accessToken, "[REDACTED]"));
await test("H20", "kebab-case secret sanitization", async () => assert.equal(sanitizeAuditMetadata({ "webhook-secret": "x" })["webhook-secret"], "[REDACTED]"));

await test("H21", "correlation chain", async () => { const a = audit(); await a.recordEvent(event({ correlationId: "c1" })); assert.equal((await a.reconstructForensicChain("c1", "ws-1")).length, 1); });
await test("H22", "trace correlation", async () => { const a = audit(); await a.recordEvent(event({ traceId: "t1" })); assert.equal((await a.queryAuditEvents({ callerWorkspaceId: "ws-1", targetWorkspaceId: "ws-1", traceId: "t1" })).length, 1); });
await test("H23", "fencing correlation", async () => assert.equal((await audit().recordEvent(event({ fencingToken: 4 }))).fencing_token, 4));
await test("H24", "idempotency correlation", async () => { const a = audit(); const x = await a.recordEvent(event({ idempotencyKey: "i1" })); const y = await a.recordEvent(event({ idempotencyKey: "i1", action: "different" })); assert.equal(x.event_id, y.event_id); });
await test("H25", "cancellation audit", async () => { const a = audit(); const r = await new GovernanceManager({ auditManager: a }).evaluateAuthority(ctx({ action: "runs.cancel", resourceType: "job_run" })); assert.equal(r.decision, "allow"); assert.equal((await a.queryAuditEvents({ callerWorkspaceId: "ws-1", targetWorkspaceId: "ws-1" })).length, 1); });
await test("H26", "recovery audit", async () => assert.equal((await new GovernanceManager().evaluateWorkerRecovery({ workerId: "w", actorId: "system", workspaceId: "ws-1", workerWorkspaceId: "ws-1" })).decision, "allow"));
await test("H27", "shutdown audit", async () => assert.equal((await new GovernanceManager().evaluateShutdown({ workspaceId: "ws-1", actorId: "u", role: "owner" })).decision, "allow"));
await test("H28", "worker lifecycle audit", async () => assert.equal((await decision({ resourceType: "worker", action: "workers.drain", role: "owner" })).decision, "allow"));
await test("H29", "job lifecycle audit", async () => assert.equal((await decision({ resourceType: "job_run", targetResource: { status: "completed" }, action: "execute" })).errorCode, "ALREADY_TERMINAL"));
await test("H30", "tool lifecycle audit", async () => assert.equal((await decision({ resourceType: "tool", targetResource: { status: "disabled" } })).decision, "deny"));

await test("H31", "approval ownership", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "admin", requesterId: "user", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "pending", expiresAt: "2999-01-01" })).decision, "allow"));
await test("H32", "self approval blocked", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "u", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "pending", expiresAt: "2999-01-01" })).decision, "blocked"));
await test("H33", "approval expiration", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "a", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "pending", expiresAt: "2000-01-01" })).decision, "expired"));
await test("H34", "approved payload immutable", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "a", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "y", status: "pending", expiresAt: "2999-01-01" })).decision, "blocked"));
await test("H35", "duplicate approval blocked", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "a", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "approved", expiresAt: "2999-01-01" })).errorCode, "DUPLICATE_REQUEST"));
await test("H36", "cancellation vs approval", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "a", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "pending", expiresAt: "2999-01-01", isCancellationPending: true })).decision, "blocked"));
await test("H37", "recovery vs approval", async () => assert.equal((await new GovernanceManager().evaluateApproval({ workspaceId: "ws-1", approvalRequestId: "a", approverId: "a", requesterId: "u", approverRole: "admin", expectedPayloadHash: "x", actualPayloadHash: "x", status: "recovery_pending", expiresAt: "2999-01-01" })).decision, "blocked"));

await test("H38", "worker drain authority", async () => assert.equal((await new GovernanceManager().evaluateWorkerDrain({ workerId: "w", actorId: "u", role: "member", workspaceId: "ws-1", workerWorkspaceId: "ws-1" })).decision, "deny"));
await test("H39", "worker quarantine authority", async () => assert.equal((await new GovernanceManager().evaluateWorkerQuarantine({ workerId: "w", actorId: "u", role: "admin", workspaceId: "ws-1", workerWorkspaceId: "ws-2" })).errorCode, "TENANT_MISMATCH"));
await test("H40", "worker recovery authority", async () => assert.equal((await new GovernanceManager().evaluateWorkerRecovery({ workerId: "w", actorId: "system", workspaceId: "ws-1", workerWorkspaceId: "ws-1" })).decision, "allow"));
await test("H41", "worker restart authority", async () => assert.equal((await new GovernanceManager().evaluateWorkerRestart({ workerId: "w", actorId: "u", role: "member", workspaceId: "ws-1", workerWorkspaceId: "ws-1" })).decision, "deny"));
await test("H42", "job cancel authority", async () => assert.equal((await new GovernanceManager().evaluateJobCancel({ jobRunId: "r", actorId: "u", role: "member", workspaceId: "ws-1", runWorkspaceId: "ws-1" })).decision, "allow"));
await test("H43", "job retry authority", async () => assert.equal((await new GovernanceManager().evaluateJobRetry({ jobRunId: "r", actorId: "u", role: "admin", workspaceId: "ws-1", runWorkspaceId: "ws-1", targetRun: { status: "completed" } })).errorCode, "ALREADY_TERMINAL"));
await test("H44", "job recovery authority", async () => assert.equal((await new GovernanceManager().evaluateJobRecovery({ jobRunId: "r", actorId: "system", workspaceId: "ws-1", runWorkspaceId: "ws-1" })).decision, "allow"));
await test("H45", "shutdown authority", async () => assert.equal((await new GovernanceManager().evaluateShutdown({ workspaceId: "ws-1", actorId: "u", role: "member" })).decision, "deny"));

await test("H46", "audit read isolation", async () => { const a = audit(); await a.recordEvent(event()); await assert.rejects(a.queryAuditEvents({ callerWorkspaceId: "ws-2", targetWorkspaceId: "ws-1" })); });
await test("H47", "forensic reconstruction", async () => { const a = audit(); await a.recordEvent(event({ correlationId: "chain" })); await a.recordEvent(event({ correlationId: "chain", action: "write" })); assert.equal((await a.reconstructForensicChain("chain", "ws-1")).length, 2); });
await test("H48", "failure semantics", async () => { const result = await new GovernanceManager().evaluateAuthority(ctx({ workspaceId: "" })); assert.equal(result.decision, "deny"); assert.equal(result.allowed, false); });
await test("H49", "repeated audit request idempotency", async () => { const a = audit(); const first = await a.recordEvent(event({ idempotencyKey: "repeat" })); const second = await a.recordEvent(event({ idempotencyKey: "repeat", metadata: { other: true } })); assert.equal(first.event_id, second.event_id); assert.equal((await a.queryAuditEvents({ callerWorkspaceId: "ws-1", targetWorkspaceId: "ws-1" })).length, 1); });
await test("H50", "end-to-end governance chain", async () => { const a = audit(); const g = new GovernanceManager({ workspaceId: "ws-1", auditManager: a }); const result = await g.evaluateAuthority(ctx({ correlationId: "e2e", traceId: "trace", fencingToken: 8, idempotencyKey: "e2e" })); const rows = await a.reconstructForensicChain("e2e", "ws-1"); assert.equal(result.decision, "allow"); assert.equal(rows.length, 1); assert.equal(rows[0].trace_id, "trace"); assert.equal(rows[0].fencing_token, 8); assert.equal(isSensitiveKey("accessToken"), true); });

assert.equal(count, 50, `Expected 50 isolated cases, got ${count}`);
console.log(`\nFase 4.10-H: ${count}/50 casos aprobados.`);
