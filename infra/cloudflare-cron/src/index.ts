interface DispatcherEnv {
  TEXTER_BASE_URL: string;
  CRON_SECRET: string;
  SCHEDULER_TIMEOUT_MS?: string | number;
  WORKER_TIMEOUT_MS?: string | number;
}

interface ScheduledEvent {
  scheduledTime: number;
  cron?: string;
}

export const DEFAULT_SCHEDULER_TIMEOUT_MS = 10_000;
export const DEFAULT_WORKER_TIMEOUT_MS = 50_000;

export const endpoints = [
  "/api/internal/scheduler/tick",
  "/api/internal/worker/tick",
] as const;

export type EndpointPath = (typeof endpoints)[number];

export function getEndpointTimeoutMs(env: DispatcherEnv, endpoint: EndpointPath): number {
  if (endpoint === "/api/internal/scheduler/tick") {
    const custom = Number(env?.SCHEDULER_TIMEOUT_MS);
    return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_SCHEDULER_TIMEOUT_MS;
  }
  if (endpoint === "/api/internal/worker/tick") {
    const custom = Number(env?.WORKER_TIMEOUT_MS);
    return Number.isFinite(custom) && custom > 0 ? custom : DEFAULT_WORKER_TIMEOUT_MS;
  }
  return DEFAULT_SCHEDULER_TIMEOUT_MS;
}

function getBaseUrl(env: DispatcherEnv): string {
  if (typeof env?.TEXTER_BASE_URL !== "string" || !env.TEXTER_BASE_URL.trim()) {
    throw new Error("Missing required environment binding: TEXTER_BASE_URL");
  }

  if (typeof env?.CRON_SECRET !== "string" || !env.CRON_SECRET.trim()) {
    throw new Error("Missing required environment binding: CRON_SECRET");
  }

  let parsed: URL;
  try {
    parsed = new URL(env.TEXTER_BASE_URL);
  } catch {
    throw new Error("Invalid TEXTER_BASE_URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Invalid TEXTER_BASE_URL");
  }

  return parsed.toString().replace(/\/$/, "");
}

function sanitizeDiagnosticString(value: unknown, secret: string): string {
  if (value === null || value === undefined) return "";
  let str = String(value);
  if (secret && secret.trim()) {
    str = str.split(secret).join("[REDACTED_SECRET]");
  }
  str = str.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
  str = str.replace(/:\/\/([^:@]+):([^@]+)@/g, "://[REDACTED_AUTH]@");
  str = str.replace(/(token|secret|password|key|auth)=[^&\s]+/gi, "$1=[REDACTED]");
  str = str.replace(/cookie:\s*[^;\r\n]+/gi, "Cookie: [REDACTED]");
  return str;
}

function extractSanitizedCause(cause: unknown, secret: string): unknown {
  if (cause === null || cause === undefined) return undefined;
  if (cause instanceof Error) {
    const safeCause: Record<string, unknown> = {
      name: cause.name,
      message: sanitizeDiagnosticString(cause.message, secret),
    };
    if ("code" in cause && (cause as { code?: unknown }).code !== undefined) {
      safeCause.code = (cause as { code: unknown }).code;
    }
    return safeCause;
  }
  if (typeof cause === "object") {
    const causeObj = cause as Record<string, unknown>;
    const safeCause: Record<string, unknown> = {};
    if (typeof causeObj.name === "string") safeCause.name = causeObj.name;
    if (causeObj.message !== undefined) safeCause.message = sanitizeDiagnosticString(causeObj.message, secret);
    if (causeObj.code !== undefined) safeCause.code = causeObj.code;
    return Object.keys(safeCause).length > 0 ? safeCause : sanitizeDiagnosticString(String(cause), secret);
  }
  return sanitizeDiagnosticString(cause, secret);
}

async function dispatchEndpoint(
  baseUrl: string,
  secret: string,
  endpoint: EndpointPath,
  timeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      console.error(
        JSON.stringify({
          event: "cron_dispatch_failed",
          endpoint,
          reason: "timeout",
          timeoutMs,
        }),
      );
      throw new Error(`Cron dispatch failed for ${endpoint} (timeout after ${timeoutMs}ms)`);
    }

    const err = error instanceof Error ? error : null;
    const errorName =
      err?.name ||
      (typeof error === "object" && error !== null && "name" in error
        ? String((error as { name: unknown }).name)
        : "Error");
    const rawMessage =
      err?.message || (typeof error === "string" ? error : "Unknown transport error");
    const errorMessage = sanitizeDiagnosticString(rawMessage, secret) || "Unknown transport error";
    const cause = err && "cause" in err ? extractSanitizedCause(err.cause, secret) : undefined;

    const logPayload: Record<string, unknown> = {
      event: "cron_dispatch_failed",
      endpoint,
      reason: "transport",
      name: errorName,
      message: errorMessage,
    };
    if (cause !== undefined) {
      logPayload.cause = cause;
    }

    console.error(JSON.stringify(logPayload));
    throw new Error(`Cron dispatch failed for ${endpoint} (transport)`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    console.error(
      JSON.stringify({
        event: "cron_dispatch_failed",
        endpoint,
        reason: "redirect",
        status: response.status,
      }),
    );
    throw new Error(`Cron dispatch failed for ${endpoint} (redirect HTTP ${response.status})`);
  }

  if (!response.ok) {
    console.error(
      JSON.stringify({ event: "cron_dispatch_failed", endpoint, status: response.status }),
    );
    throw new Error(`Cron dispatch failed for ${endpoint} with HTTP ${response.status}`);
  }

  console.log(
    JSON.stringify({ event: "cron_dispatch_succeeded", endpoint, status: response.status }),
  );
}

/**
 * Pipeline Semantics: Scheduler -> Worker
 *
 * Dispatch sequence on each scheduled cron tick:
 * 1. POST /api/internal/scheduler/tick (default timeout: 10s)
 * 2. POST /api/internal/worker/tick    (default timeout: 50s)
 *
 * Deliberate Scheduler-Failure Policy:
 * If the scheduler request fails for any reason (transport error, timeout, or HTTP non-2xx status),
 * execution throws immediately and the worker is NOT executed during this tick.
 *
 * Architectural reasons for this policy:
 * - Preserves execution ordering: scheduled automations and occurrences must be evaluated and
 *   materialized into the queue before the worker attempts to claim and execute pending jobs.
 * - Prevents executing the worker against a failing scheduler or database state.
 * - Zero job loss: persisted jobs in PostgreSQL remain intact and will be picked up on subsequent ticks.
 * - The next Cloudflare Cron tick (1 minute later) will retry the full cycle.
 */
const dispatcher = {
  async scheduled(_event: ScheduledEvent, env: DispatcherEnv): Promise<void> {
    const baseUrl = getBaseUrl(env);

    for (const endpoint of endpoints) {
      const timeoutMs = getEndpointTimeoutMs(env, endpoint);
      await dispatchEndpoint(baseUrl, env.CRON_SECRET, endpoint, timeoutMs);
    }
  },
};

export default dispatcher;
