# Cloudflare Cron Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve approximately once-per-minute scheduler and worker dispatch for Texter on Vercel Hobby by moving cron dispatch to a standalone Cloudflare Worker.

**Architecture:** A stateless Cloudflare Worker runs on `* * * * *` and sends authenticated POST requests to Texter's existing scheduler route followed by its worker route. The Worker reads `TEXTER_BASE_URL` and `CRON_SECRET` from Cloudflare environment bindings; Vercel no longer registers Cron Jobs.

**Tech Stack:** Cloudflare Workers, Wrangler TOML, TypeScript, Node.js built-in assertions, the repository's existing `typescript` dev dependency, and Vercel `vercel.json`.

**Spec:** `docs/superpowers/specs/2026-10-06-cloudflare-cron-dispatcher-design.md`

## Global Constraints

- Keep the existing HTTP endpoints and their `CRON_SECRET` Bearer authentication.
- The external component only dispatches requests; keep application scheduling, queue state, and execution on Texter/Vercel.
- Do not change job, scheduler, worker, Supabase, or migration behavior.
- Do not change endpoint authentication or expose unauthenticated cron routes.
- Do not commit production URLs or secret values.
- Do not create or change provider accounts, secrets, or deployments during repository implementation.
- Do not guarantee real-time execution at an exact second.
- Remove only the two Vercel cron declarations from `vercel.json`.

## Review Focus

- Missing or malformed `TEXTER_BASE_URL` or missing `CRON_SECRET` must fail before any fetch.
- A scheduler transport error or non-2xx response must stop that invocation before the worker route is called.
- A worker transport error or non-2xx response must be reported without exposing the secret.
- Logs and thrown errors must never contain `CRON_SECRET` or response bodies that may echo it.
- Concurrent scheduled events must remain stateless and preserve scheduler-before-worker order independently per event.

---

### Task 1: Pin the dispatcher contract with focused tests

**Files:**
- Create: `scripts/test-cloudflare-cron-dispatcher.mjs`
- Create: `infra/cloudflare-cron/README.md`
- Consumes: the exported Worker `scheduled(event, env)` handler to be added in Task 2.
- Produces: a dependency-free test command that dynamically transpiles the Worker TypeScript with the installed `typescript` package and imports it from a data URL; command: `node scripts/test-cloudflare-cron-dispatcher.mjs`.

- [ ] **Step 1: Write success and ordering tests**

Load `infra/cloudflare-cron/src/index.ts` using `readFileSync` and `typescript.transpileModule` with `module: ESNext` and `target: ES2022`, then import the output from a `data:text/javascript;base64,...` URL. Replace `globalThis.fetch` with a recorder returning `{ ok: true, status: 200 }`. Invoke the exported default handler's `scheduled({ scheduledTime: Date.now() }, env)` and assert exactly two POSTs in this order:

```js
assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
  "/api/internal/scheduler/tick",
  "/api/internal/worker/tick",
]);
assert.deepEqual(calls.map(({ init }) => init.method), ["POST", "POST"]);
assert.deepEqual(calls.map(({ init }) => init.headers.Authorization), [
  `Bearer ${secret}`,
  `Bearer ${secret}`,
]);
```

Restore `globalThis.fetch` in `finally` so one test cannot leak state into the next.

- [ ] **Step 2: Add configuration and failure tests**

Assert missing `TEXTER_BASE_URL`, missing `CRON_SECRET`, and malformed base URL reject before `fetch` is called. Assert scheduler fetch rejection and scheduler `503` each reject and call only the scheduler endpoint. Assert worker fetch rejection and worker `503` each reject after exactly two calls. Capture `console.error` and `console.log` during failure cases and assert neither output nor thrown error includes the secret or response body.

- [ ] **Step 3: Add concurrent invocation coverage**

Run two `scheduled()` invocations with a mocked fetch that records a distinct invocation's first request before resolving it. Assert each invocation sends its own scheduler request before its own worker request and that no shared dispatcher state suppresses either event.

- [ ] **Step 4: Run the focused test before implementation**

Run: `node scripts/test-cloudflare-cron-dispatcher.mjs`
Expected: FAIL because `infra/cloudflare-cron/src/index.ts` does not exist yet. Confirm this is the expected missing-module failure, not a test harness or TypeScript transpilation error.

---

### Task 2: Implement the Cloudflare Worker dispatcher

**Files:**
- Create: `infra/cloudflare-cron/src/index.ts`
- Create: `infra/cloudflare-cron/wrangler.toml`
- Test: `scripts/test-cloudflare-cron-dispatcher.mjs`
- Consumes: the test contract from Task 1.
- Produces: default Worker export with `scheduled(event, env)` and environment type containing `TEXTER_BASE_URL: string` and `CRON_SECRET: string`.

- [ ] **Step 1: Add Wrangler entrypoint and minute schedule**

Create `infra/cloudflare-cron/wrangler.toml` with the Worker name `texter-cron-dispatcher`, `main = "src/index.ts"`, `compatibility_date = "2026-10-06"`, and exactly one trigger: `crons = ["* * * * *"]`. Do not add a sample URL or secret to the file. Do not add account IDs or deploy credentials.

- [ ] **Step 2: Implement environment validation and ordered requests**

In `src/index.ts`, validate that `TEXTER_BASE_URL` and `CRON_SECRET` are non-empty, parse the base URL, and allow only `https:` URLs with no embedded username/password, query, or fragment. Remove a trailing slash before appending route paths. For each endpoint, send `fetch(url, { method: "POST", headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" } })` and await the response before proceeding. On a non-2xx response or transport failure, log only the endpoint path and HTTP status or a fixed sanitized failure label; do not log headers, response body, or raw exception. Throw a sanitized error so Cloudflare records the scheduled invocation as failed. A scheduler failure must prevent the worker call. A worker failure occurs after the scheduler call.

- [ ] **Step 3: Run focused tests and correct the implementation**

Run: `node scripts/test-cloudflare-cron-dispatcher.mjs`
Expected: PASS for success order, auth headers, required configuration, scheduler short-circuit, worker errors, secret non-disclosure, and concurrent stateless calls.

---

### Task 3: Remove Vercel cron registrations and review the integrated diff

**Files:**
- Modify: `vercel.json`
- Review: `infra/cloudflare-cron/src/index.ts`
- Review: `infra/cloudflare-cron/wrangler.toml`
- Review: `scripts/test-cloudflare-cron-dispatcher.mjs`
- Consumes: tested dispatcher from Task 2.
- Produces: a Hobby-compatible Vercel config and a separate external minute dispatcher.

- [ ] **Step 1: Remove only the Vercel cron array**

Edit `vercel.json` to remove its `crons` property and preserve `$schema` and all other configuration exactly. Do not change either route or any Supabase file.

- [ ] **Step 2: Verify the focused behavior and configuration**

Run: `node scripts/test-cloudflare-cron-dispatcher.mjs`
Expected: PASS.

Inspect `vercel.json` and `infra/cloudflare-cron/wrangler.toml`. Confirm `vercel.json` contains no cron entries and Wrangler contains one `* * * * *` trigger. Run `git diff --check` and inspect `git status --short` plus `git diff --stat` to confirm the feature diff contains only the two dispatcher files, its focused test, and `vercel.json`; keep pre-existing `.gitignore` and Supabase changes outside the feature commit.

- [ ] **Step 3: Prepare operator setup instructions**

Document the manual Cloudflare setup command `npx wrangler secret put CRON_SECRET` and the non-secret Worker variable `TEXTER_BASE_URL` in the dispatcher's README. State that the operator must set the same `CRON_SECRET` on Vercel and Cloudflare, deploy the Worker, confirm both endpoint responses in Cloudflare logs, and deploy the Vercel config with its Cron Jobs removed. Do not run these commands or deploy.

- [ ] **Step 4: Commit the isolated implementation**

Stage only `vercel.json`, `infra/cloudflare-cron/`, and `scripts/test-cloudflare-cron-dispatcher.mjs` (plus the dispatcher README from Step 3). Create one implementation commit with a message such as `feat(scheduler): dispatch minute ticks through Cloudflare`.

---

## Self-review

- Spec coverage: minute-level dispatch and removal of Vercel Cron are Task 3; existing authenticated routes and ordered calls are Task 2; environment/secret handling, errors, and overlap are Tasks 1–2; operator configuration and rollout guidance are Task 3.
- Placeholder scan: no TBD, TODO, or unspecified implementation steps are present.
- Interface consistency: tests and implementation use the default export's `scheduled(event, env)` method and the same `TEXTER_BASE_URL` and `CRON_SECRET` environment bindings.
- Review Focus coverage: configuration errors, scheduler failure, worker failure, secret disclosure, and concurrency each have explicit tests in Task 1.
- Scope note: provider secrets and deployment remain operator actions and are deliberately excluded from repository implementation.
