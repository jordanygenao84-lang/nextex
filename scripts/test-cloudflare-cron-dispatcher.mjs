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
const { default: dispatcher } = await import(moduleUrl);

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
  }

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
      assert.deepEqual(calls, ["/api/internal/scheduler/tick"]);
      assert.ok(!`${output}\n${thrown}`.includes(secret));
      assert.ok(!`${output}\n${thrown}`.includes(`echo ${secret}`));
    }
  }

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

  console.log("PASS: Cloudflare cron dispatcher contract");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
