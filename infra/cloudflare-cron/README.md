# Cloudflare Cron Dispatcher

This Worker invokes Texter's existing scheduler and worker endpoints once per minute. The scheduler endpoint runs first; the worker endpoint runs after it succeeds.

## Configure the Worker

1. In the Cloudflare dashboard, open **Workers & Pages**, select `texter-cron-dispatcher`, and open **Settings → Variables and Secrets**.
2. Add the non-secret text variable `TEXTER_BASE_URL` with the production Texter origin, for example `https://your-production-host`. Do not add a path, query, or fragment.
3. Add a secret named `CRON_SECRET`. Its value must match the `CRON_SECRET` configured for the Vercel production deployment. Do not put the secret in `wrangler.toml`, a plaintext variable, or source control. You can also set the Worker secret interactively from this directory with:

   ```sh
   npx wrangler secret put CRON_SECRET
   ```

4. Deploy the Vercel application with the `crons` entries removed from `vercel.json`, then deploy this Worker from this directory:

   ```sh
   npx wrangler deploy
   ```

5. In the Cloudflare Worker logs, confirm successful responses for `/api/internal/scheduler/tick` and `/api/internal/worker/tick`. The dispatcher logs route paths and HTTP statuses; it never logs the secret or response bodies.

The production URL and secret are intentionally not stored in this repository. Configure production and preview environments separately if both need scheduled dispatch. Cloudflare schedules run on UTC minute boundaries, but invocation is not guaranteed at an exact second.
