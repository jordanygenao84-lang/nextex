/**
 * Plantilla de Referencia de Script k6 para Nextex Fleet Agent
 *
 * Esta plantilla documenta la estructura del código k6 que el agente genera
 * de forma dinámica en /tmp/k6-<job_id>.js al reclamar un trabajo de prueba.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

// 1. Opciones de ejecución y etapas de carga (Stages)
// El agente interpola las etapas calculadas a partir de:
// - rampup_seconds: tiempo de escalado gradual de 0 a VUs objetivo.
// - duration_seconds: meseta con carga sostenida al 100% de los VUs objetivo.
// - rampdown (30s): enfriamiento gradual para cierre limpio de conexiones.
export const options = {
  stages: [
    { duration: '60s', target: 50 },  // Rampa de subida (Ramp-up)
    { duration: '300s', target: 50 }, // Carga sostenida (Steady State)
    { duration: '30s', target: 0 },   // Enfriamiento (Ramp-down)
  ],
  thresholds: {
    // Umbral de tolerancia de errores para métricas de fiabilidad
    http_req_failed: ['rate<0.5'],
  },
  discardResponseBodies: true, // Optimiza el uso de CPU y memoria en la Mac
};

// 2. URL objetivo y escenario de rutas ponderadas
const targetBase = 'https://nextex-seven.vercel.app';
const endpoints = [
  { path: '/api/health', weight: 80 },
  { path: '/api/status', weight: 20 },
];

/**
 * Selecciona una ruta aleatoria en función de los pesos (weights) definidos en el escenario.
 */
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

/**
 * Función principal ejecutada por cada Virtual User (VU) en iteraciones continuas.
 */
export default function () {
  const epPath = pickEndpoint();
  const url = targetBase + (epPath.startsWith('/') ? epPath : '/' + epPath);

  // Inyección de petición HTTP GET
  const res = http.get(url, {
    headers: {
      'User-Agent': 'NextexFleetAgent/1.0 (+https://nextex-seven.vercel.app)',
      'Accept': '*/*',
    },
    tags: { name: epPath },
    timeout: '15s',
  });

  // Validación de aserciones de código de estado
  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  // Pequeña pausa entre iteraciones para simular comportamiento realista
  sleep(0.05);
}
