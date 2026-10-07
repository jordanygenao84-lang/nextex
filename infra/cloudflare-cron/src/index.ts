interface DispatcherEnv {
  TEXTER_BASE_URL: string;
  CRON_SECRET: string;
}

interface ScheduledEvent {
  scheduledTime: number;
  cron?: string;
}

const endpoints = [
  "/api/internal/scheduler/tick",
  "/api/internal/worker/tick",
] as const;

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

async function dispatchEndpoint(baseUrl: string, secret: string, endpoint: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
    });
  } catch {
    console.error(
      JSON.stringify({ event: "cron_dispatch_failed", endpoint, reason: "transport" }),
    );
    throw new Error(`Cron dispatch failed for ${endpoint} (transport)`);
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

const dispatcher = {
  async scheduled(_event: ScheduledEvent, env: DispatcherEnv): Promise<void> {
    const baseUrl = getBaseUrl(env);

    for (const endpoint of endpoints) {
      await dispatchEndpoint(baseUrl, env.CRON_SECRET, endpoint);
    }
  },
};

export default dispatcher;
