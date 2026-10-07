# Cloudflare Cron Dispatcher

External minute-level cron dispatcher for NEXTEХ (Nexora Texter).

## 1. Architecture & Execution Flow

```text
Cloudflare Cron (* * * * *)
       ↓
/api/internal/scheduler/tick  (Timeout: 10s default)
       ↓ (executed ONLY if scheduler succeeds)
/api/internal/worker/tick     (Timeout: 50s default)
       ↓
Durable Jobs Engine (PostgreSQL / Supabase)
```

### Why Cloudflare Workers?
Vercel Hobby plan does not permit cron jobs scheduled more frequently than once per day (rejecting `* * * * *` schedules during deployment). To maintain the required **1-minute target frequency** without moving database coordination, queue logic, or business state outside of Texter, an external Cloudflare Worker invokes the existing authenticated endpoints once per minute.

**CRITICAL POLICY**: Do NOT re-add a minute-level cron expression (`* * * * *`) to `vercel.json` while the project is hosted on Vercel Hobby.

---

## 2. Configuration & Secrets

The dispatcher requires two environment bindings:
- `TEXTER_BASE_URL`: The production origin of the Texter application (e.g. `https://your-production-app.vercel.app`). Must be HTTPS, without path, trailing slash, query, or fragment.
- `CRON_SECRET`: High-entropy shared secret used for Bearer authentication on internal routes.

### CRON_SECRET Synchronization:
The exact same `CRON_SECRET` string must be configured in:
1. **Cloudflare Worker Secret**: configured via Wrangler CLI or Cloudflare Dashboard.
2. **Vercel Environment Variable**: configured in Vercel Project Settings (`CRON_SECRET`) for Production and Preview.

> **SECURITY WARNING**: Never commit, hardcode, or write the secret value into this README, `wrangler.toml`, source code, or plaintext variables.

### Setting up the Worker:
1. In Cloudflare Dashboard, open **Workers & Pages → texter-cron-dispatcher → Settings → Variables and Secrets**.
2. Add the plaintext variable `TEXTER_BASE_URL` with your application origin.
3. Add the secret `CRON_SECRET` using the dashboard or via Wrangler CLI:
   ```sh
   npx wrangler secret put CRON_SECRET
   ```
4. Deploy the Worker from this directory:
   ```sh
   npx wrangler deploy
   ```

---

## 3. Dispatcher Pipeline Semantics: Scheduler → Worker

On each 1-minute cron trigger, the dispatcher executes in strict sequential order:
1. `POST /api/internal/scheduler/tick`
2. `POST /api/internal/worker/tick`

### Deliberate Scheduler-Failure Policy:
If the scheduler invocation fails (due to timeout, transport error, or non-2xx HTTP status):
- **The worker is NOT executed during that tick.**
- **Why this design is deliberate**:
  1. *Ordering guarantee*: Automations and occurrences must be evaluated and materialized into `job_runs` before the worker attempts to claim pending jobs.
  2. *Avoids cascading failures*: Prevents executing the worker against a failing database state or cold-start timeout that caused the scheduler to fail.
  3. *Zero job loss*: Persisted jobs in `job_runs` remain safely stored in the PostgreSQL queue.
  4. *Automatic recovery*: A scheduler failure only delays execution by up to the next minute's tick, when Cloudflare will retry the full cycle.

---

## 4. Timeout Design & Overlap Prevention

Each endpoint has an explicit, bounded request timeout implemented using `AbortController` + timer:
- **Scheduler Timeout**: `10,000 ms` (10 seconds default).
  - *Expected duration*: Sub-second (50ms–500ms typical, up to 2–3s during cold starts).
  - *Margin*: 10s provides ample headroom while failing fast if the database or endpoint is unresponsive.
- **Worker Timeout**: `50,000 ms` (50 seconds default).
  - *Expected duration*: 1s–35s. The worker's internal `LeaseManager` enforces a budget abort at 30 seconds (`maxInvocationMs: 45000` minus `safetyMarginMs: 15000`), gracefully checkpointing and re-queueing the job.
  - *Margin*: 50s gives the worker 5 full seconds beyond its 45s maximum invocation ceiling to finish its checkpoint and transmit the response.
- **Tick Overlap Protection**:
  - `Scheduler Timeout (10s) + Worker Timeout (50s) = 60s max total`.
  - Because scheduler failure aborts the tick immediately (taking at most 10s), and successful scheduler runs take < 2s leaving full 50s for the worker, total execution per tick is strictly bounded to <= 60 seconds, preventing overlap with the next minute's tick.
  - Optional overrides can be configured via `SCHEDULER_TIMEOUT_MS` and `WORKER_TIMEOUT_MS` environment bindings if needed.

---

## 5. Operational Diagnostics & Log Interpretation

The dispatcher outputs structured JSON logs to Cloudflare Observability. It **never logs authorization tokens, request bodies, or response payloads**.

### Diagnosing Common Scenarios:

1. **Scheduler Timeout**
   - *Log entry*: `{"event":"cron_dispatch_failed","endpoint":"/api/internal/scheduler/tick","reason":"timeout","timeoutMs":10000}`
   - *Cause*: Vercel serverless cold start exceeded 10s or database connection pool exhausted during `generate_schedule_occurrences`.
   - *Result*: Worker is skipped for this tick. The next tick will re-attempt.

2. **Worker Timeout**
   - *Log entry*: `{"event":"cron_dispatch_failed","endpoint":"/api/internal/worker/tick","reason":"timeout","timeoutMs":50000}`
   - *Cause*: Worker exceeded 50s without concluding its lease budget checkpoint.
   - *Result*: Cloudflare terminates the subrequest. The job lease in PostgreSQL will expire safely according to its `lease_expires_at` (60s), and `recover_stale_job_runs` will safely reclaim it with monotonic fencing token protection.

3. **HTTP 401 / 403 Forbidden**
   - *Log entry*: `{"event":"cron_dispatch_failed","endpoint":"...","status":401}` or `status: 403`
   - *Cause*: `CRON_SECRET` mismatch between Cloudflare Worker secret and Vercel environment variable, or invalid format.
   - *Resolution*: Re-synchronize `CRON_SECRET` in both platforms using `npx wrangler secret put CRON_SECRET` and Vercel Project Settings.

4. **HTTP 5xx Server Error**
   - *Log entry*: `{"event":"cron_dispatch_failed","endpoint":"...","status":500}` (or 502/503/504)
   - *Cause*: Next.js server crash, Supabase connection failure, or unhandled exception in the endpoint route.
   - *Resolution*: Check Vercel Function logs for `/api/internal/scheduler/tick` or `/api/internal/worker/tick` to inspect the error stack trace.

5. **Scheduler Failure Skipping Worker**
   - If Cloudflare logs show `cron_dispatch_failed` for `/api/internal/scheduler/tick` without a subsequent entry for `/api/internal/worker/tick`, this confirms the intentional pipeline safeguard was engaged. Persisted jobs remain safe in the queue and will be processed upon the next successful tick.
