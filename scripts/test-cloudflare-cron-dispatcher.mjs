import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../infra/cloudflare-cron/src/index.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
const {
  default: dispatcher,
  DEFAULT_SCHEDULER_TIMEOUT_MS,
  DEFAULT_WORKER_TIMEOUT_MS,
  endpoints,
  getEndpointTimeoutMs,
} = await import(moduleUrl);

const secret = "test-cron-secret-not-for-logs";
const env = {
  TEXTER_BASE_URL: "https://texter.example",
  CRON_SECRET: secret,
};
const event = { scheduledTime: Date.now() };

async function withFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function captureOutput(run) {
  const captured = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => captured.push(values.join(" "));
  console.error = (...values) => captured.push(values.join(" "));
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return captured.join("\n");
}

function pathname(url) {
  return new URL(url).pathname;
}

async function run() {
  // Test 1: Happy path - sequential execution, correct methods, headers, and AbortSignal
  {
    const calls = [];
    await withFetch(async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }, async () => {
      await dispatcher.scheduled(event, env);
    });

    assert.deepEqual(calls.map(({ url }) => pathname(url)), [
      "/api/internal/scheduler/tick",
      "/api/internal/worker/tick",
    ]);
    assert.deepEqual(calls.map(({ init }) => init.method), ["POST", "POST"]);
    assert.deepEqual(calls.map(({ init }) => init.redirect), ["error", "error"]);
    assert.deepEqual(
      calls.map(({ init }) => new Headers(init.headers).get("Content-Type")),
      ["application/json", "application/json"],
    );
    assert.deepEqual(
      calls.map(({ init }) => new Headers(init.headers).get("Authorization")),
      [`Bearer ${secret}`, `Bearer ${secret}`],
    );
    for (const { init } of calls) {
      assert.ok(init.signal instanceof AbortSignal, "fetch init must receive an AbortSignal");
      assert.equal(init.signal.aborted, false, "signal must not be aborted on successful request");
    }
  }

  // Test 2: Timeout constants and budget bounds
  {
    assert.equal(DEFAULT_SCHEDULER_TIMEOUT_MS, 10000, "scheduler timeout must default to 10s");
    assert.equal(DEFAULT_WORKER_TIMEOUT_MS, 50000, "worker timeout must default to 50s");
    assert.equal(
      DEFAULT_SCHEDULER_TIMEOUT_MS + DEFAULT_WORKER_TIMEOUT_MS,
      60000,
      "combined timeouts must not exceed 1 minute tick interval",
    );
    assert.deepEqual(endpoints, [
      "/api/internal/scheduler/tick",
      "/api/internal/worker/tick",
    ]);
    assert.equal(
      getEndpointTimeoutMs(env, "/api/internal/scheduler/tick"),
      10000,
      "default scheduler timeout must be 10000ms",
    );
    assert.equal(
      getEndpointTimeoutMs(env, "/api/internal/worker/tick"),
      50000,
      "default worker timeout must be 50000ms",
    );
    assert.equal(
      getEndpointTimeoutMs({ ...env, SCHEDULER_TIMEOUT_MS: "25000" }, "/api/internal/scheduler/tick"),
      25000,
      "SCHEDULER_TIMEOUT_MS override must be respected",
    );
    assert.equal(
      getEndpointTimeoutMs({ ...env, WORKER_TIMEOUT_MS: 40000 }, "/api/internal/worker/tick"),
      40000,
      "WORKER_TIMEOUT_MS override must be respected",
    );
    assert.equal(
      getEndpointTimeoutMs({ ...env, SCHEDULER_TIMEOUT_MS: "invalid" }, "/api/internal/scheduler/tick"),
      10000,
      "invalid SCHEDULER_TIMEOUT_MS must fallback to default",
    );
  }

  // Test 3: Invalid configuration fails fast before network access
  {
    let fetchCount = 0;
    await withFetch(async () => {
      fetchCount++;
      return new Response(null, { status: 200 });
    }, async () => {
      await assert.rejects(() => dispatcher.scheduled(event, { ...env, TEXTER_BASE_URL: "" }));
      await assert.rejects(() => dispatcher.scheduled(event, { ...env, CRON_SECRET: "" }));
      await assert.rejects(() => dispatcher.scheduled(event, { ...env, TEXTER_BASE_URL: "not a URL" }));
      await assert.rejects(() =>
        dispatcher.scheduled(event, { ...env, TEXTER_BASE_URL: "https://texter.example/prefix" }),
      );
    });
    assert.equal(fetchCount, 0, "invalid configuration must fail before network access");
  }

  // Test 4: Scheduler failure (network or HTTP error) skips worker and protects secret
  {
    for (const responseFailure of [
      async () => {
        throw new Error("network unavailable");
      },
      async () => new Response(`echo ${secret}`, { status: 503 }),
    ]) {
      const calls = [];
      let thrown;
      const output = await captureOutput(() =>
        withFetch(async (url) => {
          calls.push(pathname(url));
          return responseFailure();
        }, async () => {
          try {
            await dispatcher.scheduled(event, env);
          } catch (error) {
            thrown = error;
          }
        }),
      );
      assert.ok(thrown, "scheduler failure must reject the scheduled invocation");
      assert.deepEqual(calls, ["/api/internal/scheduler/tick"], "worker must NOT be called if scheduler fails");
      assert.ok(!`${output}\n${thrown}`.includes(secret));
      assert.ok(!`${output}\n${thrown}`.includes(`echo ${secret}`));
    }
  }

  // Test 5: Scheduler timeout explicitly recorded, worker NOT called, secret protected
  {
    const calls = [];
    let thrown;
    const output = await captureOutput(() =>
      withFetch(async (url, init) => {
        calls.push(pathname(url));
        return new Promise((_, reject) => {
          if (init?.signal?.aborted) {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            return reject(err);
          }
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }, async () => {
        try {
          await dispatcher.scheduled(event, { ...env, SCHEDULER_TIMEOUT_MS: 30 });
        } catch (error) {
          thrown = error;
        }
      }),
    );
    assert.ok(thrown, "scheduler timeout must reject the scheduled invocation");
    assert.ok(
      thrown.message.includes("timeout after 30ms"),
      `expected timeout message, got: ${thrown.message}`,
    );
    assert.deepEqual(calls, ["/api/internal/scheduler/tick"], "worker must NOT be executed when scheduler times out");
    assert.ok(output.includes('"reason":"timeout"'), "structured log must report reason: timeout");
    assert.ok(output.includes('"timeoutMs":30'), "structured log must report timeoutMs");
    assert.ok(!`${output}\n${thrown}`.includes(secret), "CRON_SECRET must not appear in output or error");
  }

  // Test 6: Worker failure (network or HTTP error) rejects invocation and protects secret
  {
    for (const workerFailure of [
      async () => {
        throw new Error("network unavailable");
      },
      async () => new Response(`echo ${secret}`, { status: 503 }),
    ]) {
      const calls = [];
      let thrown;
      const output = await captureOutput(() =>
        withFetch(async (url) => {
          calls.push(pathname(url));
          if (calls.length === 1) return new Response(null, { status: 200 });
          return workerFailure();
        }, async () => {
          try {
            await dispatcher.scheduled(event, env);
          } catch (error) {
            thrown = error;
          }
        }),
      );
      assert.ok(thrown, "worker failure must reject the scheduled invocation");
      assert.deepEqual(calls, [
        "/api/internal/scheduler/tick",
        "/api/internal/worker/tick",
      ]);
      assert.ok(!`${output}\n${thrown}`.includes(secret));
      assert.ok(!`${output}\n${thrown}`.includes(`echo ${secret}`));
    }
  }

  // Test 7: Worker timeout explicitly recorded, secret protected
  {
    const calls = [];
    let thrown;
    const output = await captureOutput(() =>
      withFetch(async (url, init) => {
        const path = pathname(url);
        calls.push(path);
        if (path === "/api/internal/scheduler/tick") {
          return new Response(null, { status: 200 });
        }
        return new Promise((_, reject) => {
          if (init?.signal?.aborted) {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            return reject(err);
          }
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }, async () => {
        try {
          await dispatcher.scheduled(event, { ...env, WORKER_TIMEOUT_MS: 30 });
        } catch (error) {
          thrown = error;
        }
      }),
    );
    assert.ok(thrown, "worker timeout must reject the scheduled invocation");
    assert.ok(
      thrown.message.includes("timeout after 30ms"),
      `expected timeout message, got: ${thrown.message}`,
    );
    assert.deepEqual(calls, [
      "/api/internal/scheduler/tick",
      "/api/internal/worker/tick",
    ], "scheduler must succeed and worker must run until timeout");
    assert.ok(output.includes('"reason":"timeout"'), "structured log must report reason: timeout");
    assert.ok(output.includes('"timeoutMs":30'), "structured log must report timeoutMs");
    assert.ok(!`${output}\n${thrown}`.includes(secret), "CRON_SECRET must not appear in output or error");
  }

  // Test 8: Timer cleanup on success, HTTP error, transport failure, and timeout
  {
    let clearTimeoutCalls = 0;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.clearTimeout = (...args) => {
      clearTimeoutCalls++;
      return originalClearTimeout(...args);
    };

    try {
      // Subtest 8a: Success cleans up timers for both scheduler and worker
      clearTimeoutCalls = 0;
      await withFetch(async () => new Response(null, { status: 200 }), async () => {
        await dispatcher.scheduled(event, env);
      });
      assert.equal(clearTimeoutCalls, 2, "must clear timer on each successful request");

      // Subtest 8b: HTTP Error cleans up timer
      clearTimeoutCalls = 0;
      await withFetch(async () => new Response(null, { status: 500 }), async () => {
        await assert.rejects(() => dispatcher.scheduled(event, env));
      });
      assert.equal(clearTimeoutCalls, 1, "must clear timer when scheduler returns HTTP error");

      // Subtest 8c: Transport failure cleans up timer
      clearTimeoutCalls = 0;
      await withFetch(async () => { throw new Error("connection reset"); }, async () => {
        await assert.rejects(() => dispatcher.scheduled(event, env));
      });
      assert.equal(clearTimeoutCalls, 1, "must clear timer when scheduler throws transport error");

      // Subtest 8d: Timeout cleans up timer
      clearTimeoutCalls = 0;
      await withFetch(async (url, init) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        });
      }, async () => {
        await assert.rejects(() =>
          dispatcher.scheduled(event, { ...env, SCHEDULER_TIMEOUT_MS: 20 }),
        );
      });
      assert.equal(clearTimeoutCalls, 1, "must clear timer on timeout");
    } finally {
      globalThis.clearTimeout = originalClearTimeout;
    }
  }

  // Test 9: Subsequent tick can retry and succeed after a failure
  {
    // Tick 1 fails on scheduler
    await withFetch(async () => new Response(null, { status: 500 }), async () => {
      await assert.rejects(() => dispatcher.scheduled(event, env));
    });

    // Tick 2 (next minute) succeeds cleanly
    const calls = [];
    await withFetch(async (url) => {
      calls.push(pathname(url));
      return new Response(null, { status: 200 });
    }, async () => {
      await dispatcher.scheduled({ scheduledTime: event.scheduledTime + 60000 }, env);
    });
    assert.deepEqual(calls, [
      "/api/internal/scheduler/tick",
      "/api/internal/worker/tick",
    ], "subsequent tick after failure must execute full cycle successfully");
  }

  // Test 10: Concurrency / race condition test (two concurrent scheduled events)
  {
    const calls = [];
    let releaseSchedulers;
    const schedulerGate = new Promise((resolve) => {
      releaseSchedulers = resolve;
    });
    let resolveTwoSchedulers;
    const twoSchedulers = new Promise((resolve) => {
      resolveTwoSchedulers = resolve;
    });
    let schedulerCount = 0;

    await withFetch(async (url) => {
      const path = pathname(url);
      calls.push(path);
      if (path === "/api/internal/scheduler/tick") {
        schedulerCount++;
        if (schedulerCount === 2) resolveTwoSchedulers();
        await schedulerGate;
      }
      return new Response(null, { status: 200 });
    }, async () => {
      const first = dispatcher.scheduled({ scheduledTime: 1 }, env);
      const second = dispatcher.scheduled({ scheduledTime: 2 }, env);
      await twoSchedulers;
      assert.deepEqual(calls, [
        "/api/internal/scheduler/tick",
        "/api/internal/scheduler/tick",
      ]);
      releaseSchedulers();
      await Promise.all([first, second]);
    });

    assert.deepEqual(calls.slice(2), [
      "/api/internal/worker/tick",
      "/api/internal/worker/tick",
    ]);
  }

  console.log("PASS: Cloudflare cron dispatcher contract (10/10 test blocks passed)");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
