# Cloudflare Cron Dispatcher for Texter

## Context

Texter currently registers two Vercel Cron Jobs in `vercel.json`, both with the schedule `* * * * *`: `/api/internal/scheduler/tick` and `/api/internal/worker/tick`. The deployment target is Vercel Hobby, whose current cron limit rejects schedules more frequent than once per day. Texter needs to retain minute-level dispatch for both endpoints.

## Goals

- Keep scheduler and worker dispatching approximately once per minute while the app remains on Vercel Hobby.
- Keep the existing HTTP endpoints and their `CRON_SECRET` Bearer authentication.
- Keep application scheduling, queue state, and execution on Texter/Vercel; the external component only dispatches requests.
- Remove Vercel Cron registrations so Hobby deployments no longer reject the schedule.

## Non-goals

- Changing job, scheduler, worker, Supabase, or migration behavior.
- Moving queue state or application logic into Cloudflare.
- Changing endpoint authentication or exposing unauthenticated cron routes.
- Guaranteeing real-time execution at an exact second. Cloudflare Cron Triggers provide minute-level schedules, but scheduled execution is not a hard real-time guarantee.
- Creating or changing provider accounts, secrets, or deployments as part of repository implementation.

## Proposed design

Create a small standalone Cloudflare Worker dispatcher under `infra/cloudflare-cron/`. Its Wrangler configuration registers one `* * * * *` Cron Trigger. The Worker reads the production Texter base URL and a `CRON_SECRET` secret from its environment; it must never contain either value in source control.

On each scheduled event, the Worker sends authenticated `POST` requests in order:

1. `https://<texter-base-url>/api/internal/scheduler/tick`
2. `https://<texter-base-url>/api/internal/worker/tick`

Both requests use `Authorization: Bearer <CRON_SECRET>`. The dispatcher awaits the scheduler response before invoking the worker, so newly generated work can be visible to the same minute's worker tick. It records each endpoint, HTTP status, and failure in Worker logs. A non-success response is treated as a failed scheduled invocation and logged; the next minute's event provides another dispatch opportunity.

Remove the `crons` array from `vercel.json`. No route code or application secret validation changes are needed. The Vercel `CRON_SECRET` and Cloudflare Worker secret must be configured to the same random value by the operator during setup.

## Failure and overlap behavior

- If the scheduler request fails, log the failure and skip the worker request for that event, since dispatching the worker before the scheduler has completed can miss newly materialized work until a later tick.
- If the worker request fails, log it; scheduled jobs remain owned by the existing Texter queue and lease logic.
- Each minute may overlap a prior invocation if either endpoint takes longer than a minute. Existing scheduler and worker database coordination remain authoritative. The dispatcher must not add its own mutable state or attempt to track jobs.
- Do not log the `CRON_SECRET` or include it in thrown error text.

## Files expected in implementation

- `vercel.json`: remove only the two Vercel cron declarations.
- `infra/cloudflare-cron/wrangler.toml` (or equivalent Wrangler JSON): define Worker entrypoint and the minute Cron Trigger.
- `infra/cloudflare-cron/src/index.ts`: perform sequential authenticated dispatch and structured logging.
- A focused test script for success, scheduler failure, worker failure, and secret non-disclosure using mocked `fetch`.

## Verification and rollout

Local verification should test the Worker handler with mocked fetch calls and confirm request order, authorization headers, and failure behavior. Review the final diff to confirm no Supabase, database, or application route changes. Operator rollout requires configuring the Worker variables/secrets and deploying the Worker, then confirming successful scheduler and worker requests in Cloudflare logs. Disable/remove the Vercel cron configuration before deploying the Hobby app so the Vercel deployment no longer rejects the per-minute schedule.

## Open operational requirement

The operator must provide/configure the production Texter base URL and set the same high-entropy `CRON_SECRET` in Vercel and Cloudflare. The repository change must not invent or commit these values.
