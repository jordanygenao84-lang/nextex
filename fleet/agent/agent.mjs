#!/usr/bin/env node
/**
 * Agente de Ejecución de Pruebas de Carga para Nextex (Mac / Linux)
 * Requisitos: Node.js 18+ y k6 instalado (brew install k6)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn } from "node:child_process";

// 1. Configuración de entorno
const FLEET_URL = (process.env.NEXTER_FLEET_URL || "https://nextex-seven.vercel.app").replace(/\/$/, "");
const FLEET_KEY = (process.env.NEXTER_FLEET_KEY || "").trim();

if (!FLEET_KEY) {
  console.error("❌ Error: NEXTER_FLEET_KEY no está configurada.");
  console.error("Uso: export NEXTER_FLEET_URL=\"https://...\" && export NEXTER_FLEET_KEY=\"tu_token\" && node agent.mjs");
  process.exit(1);
}

const HEADERS = {
  "X-Fleet-Key": FLEET_KEY,
  "Content-Type": "application/json",
};

// 2. Logging con timestamps
function log(msg) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  console.log(`[${ts}] ${msg}`);
}

let currentRunningJob = null;
let isExecuting = false;

// 3. Heartbeat periódico (cada 30 segundos)
async function sendHeartbeat() {
  try {
    const res = await fetch(`${FLEET_URL}/api/fleet/agents/heartbeat`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ status: currentRunningJob ? "busy" : "online" }),
    });

    if (res.status === 401) {
      log("❌ Error fatal: API key inválida (401 Unauthorized). Saliendo.");
      process.exit(1);
    }

    if (res.ok) {
      log("heartbeat ok");
    } else {
      log(`⚠️ Heartbeat respondió status HTTP ${res.status}`);
    }
  } catch (err) {
    log(`⚠️ Error de conexión en heartbeat: ${err.message}`);
  }
}

// 4. Generador de script k6
function generateK6Script(job) {
  const rampupSec = Number(job.rampup_seconds) || 60;
  const durationSec = Number(job.duration_seconds) || 60;
  const targetVus = Number(job.vus) || 50;

  const stages = [
    { duration: `${rampupSec}s`, target: targetVus },
    { duration: `${durationSec}s`, target: targetVus },
    { duration: "30s", target: 0 },
  ];

  let endpoints = [{ path: "/", weight: 100 }];
  if (job.scenario && Array.isArray(job.scenario.endpoints) && job.scenario.endpoints.length > 0) {
    endpoints = job.scenario.endpoints;
  }

  const script = `// Script autogenerado por Nextex Fleet Agent para el Job: ${job.id}
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: ${JSON.stringify(stages, null, 2)},
  thresholds: {
    http_req_failed: ['rate<0.5'],
  },
  discardResponseBodies: true,
};

const targetBase = ${JSON.stringify(job.target_url.replace(/\\/$/, ""))};
const endpoints = ${JSON.stringify(endpoints)};

function pickEndpoint() {
  const totalWeight = endpoints.reduce((acc, ep) => acc + (Number(ep.weight) || 1), 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    random -= (Number(ep.weight) || 1);
    if (random <= 0) return ep.path || '/';
  }
  return endpoints[0].path || '/';
}

export default function () {
  const epPath = pickEndpoint();
  const url = targetBase + (epPath.startsWith('/') ? epPath : '/' + epPath);

  const res = http.get(url, {
    headers: {
      'User-Agent': 'NextexFleetAgent/1.0 (+https://nextex-seven.vercel.app)',
      'Accept': '*/*',
    },
    tags: { name: epPath },
    timeout: '15s',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(0.05);
}
`;

  return { script, stages, rampupSec, durationSec, targetVus };
}

// 5. Cálculo de VUs interpolados según stages
function getInterpolatedVus(elapsedSec, rampupSec, durationSec, targetVus) {
  if (elapsedSec <= rampupSec) {
    return Math.max(1, Math.round((elapsedSec / Math.max(1, rampupSec)) * targetVus));
  }
  if (elapsedSec <= rampupSec + durationSec) {
    return targetVus;
  }
  const rampDownElapsed = elapsedSec - (rampupSec + durationSec);
  const remaining = Math.max(0, 30 - rampDownElapsed);
  return Math.max(0, Math.round((remaining / 30) * targetVus));
}

// 6. Cálculo de percentiles
function calculatePercentile(sortedArray, percentile) {
  if (!sortedArray || sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  const safeIndex = Math.max(0, Math.min(sortedArray.length - 1, index));
  return Number(sortedArray[safeIndex].toFixed(2));
}

// 7. Ejecutor de Job
async function executeJob(job) {
  isExecuting = true;
  currentRunningJob = job;
  const shortId = job.id.substring(0, 8);
  log(`job ${shortId} tomado (${job.vus} VUs, ${job.duration_seconds}s contra ${job.target_url})`);

  const tmpScriptPath = path.join(os.tmpdir(), `k6-${job.id}.js`);
  const tmpJsonlPath = path.join(os.tmpdir(), `k6-${job.id}.jsonl`);

  const { script, rampupSec, durationSec, targetVus } = generateK6Script(job);
  fs.writeFileSync(tmpScriptPath, script, "utf-8");

  // Asegurar archivo jsonl vacío para streaming
  if (fs.existsSync(tmpJsonlPath)) {
    fs.unlinkSync(tmpJsonlPath);
  }
  fs.writeFileSync(tmpJsonlPath, "", "utf-8");

  const startTime = Date.now();
  let k6Process = null;

  // Estructuras para ventanas de métricas
  let windowDurations = [];
  let windowReqCount = 0;
  let windowErrors = 0;
  let lastMetricVus = 1;

  // Totales acumulados para el summary
  let totalReqs = 0;
  let totalErrors = 0;
  let allDurations = [];

  let isJobFinished = false;

  // Stream reader del archivo JSONL
  let jsonlFd = fs.openSync(tmpJsonlPath, "r");
  let filePosition = 0;
  let leftoverBuffer = "";

  const readNewLines = () => {
    try {
      const stats = fs.fstatSync(jsonlFd);
      if (stats.size > filePosition) {
        const bytesToRead = stats.size - filePosition;
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(jsonlFd, buf, 0, bytesToRead, filePosition);
        filePosition += bytesToRead;

        const chunk = leftoverBuffer + buf.toString("utf-8");
        const lines = chunk.split("\n");
        leftoverBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            if (entry.type === "Point" && entry.data) {
              const val = Number(entry.data.value);
              if (entry.metric === "http_req_duration") {
                windowDurations.push(val);
                allDurations.push(val);
                windowReqCount++;
                totalReqs++;
              } else if (entry.metric === "http_req_failed" && val === 1) {
                windowErrors++;
                totalErrors++;
              } else if (entry.metric === "checks" && val === 0) {
                windowErrors++;
                totalErrors++;
              } else if (entry.metric === "vus") {
                lastMetricVus = val;
              }
            }
          } catch {
            // Ignorar líneas parciales
          }
        }
      }
    } catch {
      // Archivo en escritura
    }
  };

  // Timer para enviar métricas cada 10 segundos
  const metricsInterval = setInterval(async () => {
    if (isJobFinished) return;
    readNewLines();

    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const calculatedVus = getInterpolatedVus(elapsedSec, rampupSec, durationSec, targetVus);
    const activeVus = Math.max(calculatedVus, lastMetricVus);

    windowDurations.sort((a, b) => a - b);
    const p50 = calculatePercentile(windowDurations, 50);
    const p95 = calculatePercentile(windowDurations, 95);
    const p99 = calculatePercentile(windowDurations, 99);

    const rps = Number((windowReqCount / 10).toFixed(2));
    const errors = windowErrors;

    // Reset de ventana
    windowDurations = [];
    windowReqCount = 0;
    windowErrors = 0;

    try {
      const res = await fetch(`${FLEET_URL}/api/fleet/jobs/${job.id}/metrics`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          vus: activeVus,
          rps,
          p50_ms: p50,
          p95_ms: p95,
          p99_ms: p99,
          p50,
          p95,
          p99,
          errors,
        }),
      });

      if (res.ok) {
        log(`métricas enviadas: ${activeVus} VUs, ${rps} RPS, p95=${p95}ms, errores=${errors}`);
      } else {
        log(`⚠️ Error al enviar métricas (HTTP ${res.status})`);
      }
    } catch (err) {
      log(`⚠️ Fallo de red enviando métricas: ${err.message}`);
    }
  }, 10000);

  // Ejecutar k6
  try {
    k6Process = spawn("k6", ["run", "--out", `json=${tmpJsonlPath}`, tmpScriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    clearInterval(metricsInterval);
    isJobFinished = true;
    try { fs.closeSync(jsonlFd); } catch {}
    log(`❌ No se pudo iniciar k6: ${err.message}`);

    await fetch(`${FLEET_URL}/api/fleet/jobs/${job.id}/finish`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ error: `k6 no pudo iniciar: ${err.message}. Asegúrate de tener k6 instalado (brew install k6).` }),
    }).catch(() => {});

    cleanupFiles(tmpScriptPath, tmpJsonlPath);
    isExecuting = false;
    currentRunningJob = null;
    return;
  }

  let stderrOutput = "";
  k6Process.stderr.on("data", (data) => {
    stderrOutput += data.toString();
  });

  k6Process.on("error", async (err) => {
    clearInterval(metricsInterval);
    isJobFinished = true;
    try { fs.closeSync(jsonlFd); } catch {}
    log(`❌ Error de ejecución en k6: ${err.message}`);

    await fetch(`${FLEET_URL}/api/fleet/jobs/${job.id}/finish`, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ error: `Fallo al ejecutar k6: ${err.message}` }),
    }).catch(() => {});

    cleanupFiles(tmpScriptPath, tmpJsonlPath);
    isExecuting = false;
    currentRunningJob = null;
  });

  k6Process.on("close", async (code) => {
    clearInterval(metricsInterval);
    isJobFinished = true;
    readNewLines();
    try { fs.closeSync(jsonlFd); } catch {}

    const totalDurationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
    allDurations.sort((a, b) => a - b);

    const overallP50 = calculatePercentile(allDurations, 50);
    const overallP95 = calculatePercentile(allDurations, 95);
    const overallP99 = calculatePercentile(allDurations, 99);
    const avgRps = Number((totalReqs / totalDurationSec).toFixed(2));

    if (code === 0) {
      const summary = {
        total_requests: totalReqs,
        total_errors: totalErrors,
        avg_rps: avgRps,
        duration_seconds: totalDurationSec,
        p50_ms: overallP50,
        p95_ms: overallP95,
        p99_ms: overallP99,
        success_rate: totalReqs > 0 ? Number((((totalReqs - totalErrors) / totalReqs) * 100).toFixed(2)) : 0,
        finished_at: new Date().toISOString(),
      };

      log(`job ${shortId} completado (total: ${totalReqs} reqs, avg RPS: ${avgRps}, p95: ${overallP95}ms, errs: ${totalErrors})`);

      try {
        await fetch(`${FLEET_URL}/api/fleet/jobs/${job.id}/finish`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ summary }),
        });
      } catch (err) {
        log(`⚠️ Error notificando fin de job: ${err.message}`);
      }
    } else {
      const errorMsg = stderrOutput.trim() || `k6 terminó con código de salida ${code}`;
      log(`job ${shortId} falló con código ${code}: ${errorMsg.slice(0, 150)}`);

      try {
        await fetch(`${FLEET_URL}/api/fleet/jobs/${job.id}/finish`, {
          method: "POST",
          headers: HEADERS,
          body: JSON.stringify({ error: errorMsg.slice(0, 500) }),
        });
      } catch (err) {
        log(`⚠️ Error notificando fallo de job: ${err.message}`);
      }
    }

    cleanupFiles(tmpScriptPath, tmpJsonlPath);
    isExecuting = false;
    currentRunningJob = null;
  });
}

function cleanupFiles(scriptPath, jsonlPath) {
  try {
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    if (fs.existsSync(jsonlPath)) fs.unlinkSync(jsonlPath);
  } catch {}
}

// 8. Bucle principal de sondeo de trabajos
async function pollForNextJob() {
  if (isExecuting) return;

  try {
    const res = await fetch(`${FLEET_URL}/api/fleet/agents/jobs/next`, {
      method: "GET",
      headers: HEADERS,
    });

    if (res.status === 204) {
      // Sin trabajos pendientes
      return;
    }

    if (res.status === 401) {
      log("❌ Error fatal: API key inválida (401 Unauthorized). Saliendo.");
      process.exit(1);
    }

    if (res.ok) {
      const data = await res.json();
      if (data && data.id) {
        await executeJob(data);
      }
    } else {
      log(`⚠️ Búsqueda de jobs respondió HTTP ${res.status}`);
    }
  } catch (err) {
    log(`⚠️ Error conectando al servidor para buscar jobs: ${err.message}`);
  }
}

// 9. Arranque del Agente
log("Iniciando Nextex Fleet Agent...");
log(`Conectando a: ${FLEET_URL}`);

// Primer heartbeat inmediato
await sendHeartbeat();

// Intervalos recurrentes
setInterval(sendHeartbeat, 30000); // Heartbeat cada 30 segundos
setInterval(pollForNextJob, 10000); // Polling de jobs cada 10 segundos

// Manejo de apagado graceful
process.on("SIGINT", () => {
  log("Deteniendo agente...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("Deteniendo agente...");
  process.exit(0);
});
