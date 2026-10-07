# NEXTEХ (Nexora Texter) — DOCUMENTO OFICIAL DE CIERRE TÉCNICO

**Versión del Producto:** `v0.1.0-rc1 / Production Ready`  
**Fecha de Cierre:** 7 de Octubre de 2026  
**Clasificación:** Documento Técnico Autoritativo de Entrega y Operación  

---

## 1. Resumen Ejecutivo

NEXTEХ (Nexora Texter) es una plataforma autónoma multi-tenant de orquestación de agentes de inteligencia artificial, ejecución duradera de trabajos en segundo plano (Durable Jobs Engine), memoria cognitiva persistente con aislamiento RLS estricto y gobernanza granular basada en 41 permisos canónicos.

Este documento formaliza la conclusión exitosa de todas las fases del ciclo de desarrollo, estabilización, endurecimiento de seguridad (*security hardening*) y despliegue a producción. Se certifica que el sistema ha superado 964 pruebas automatizadas acumuladas (incluyendo 877 pruebas canónicas de regresión, 38 pruebas adversariales de Red Team y 20 pruebas de fiabilidad y consistencia), verificando la interoperabilidad en vivo de la arquitectura híbrida Cloudflare Cron Dispatcher → Vercel Serverless Control Plane → Supabase Cloud PostgreSQL.

---

## 2. Estado Final del Proyecto

* **Estado General:** `PRODUCTION READY / PROJECT CLOSED`
* **Defectos Bloqueantes:** 0
* **Defectos Críticos:** 0
* **Defectos Altos:** 0
* **Regresiones Activas:** 0
* **Disponibilidad de Producción:** Verificada y operativa en `https://nextex-seven.vercel.app`
* **Base de Datos de Producción:** Verificada y operativa en Supabase Cloud (`vvpdycuclnoptffwmrvb`)
* **Despachador Programado:** Verificado y activo en Cloudflare Workers (`texter-cron-dispatcher`)

---

## 3. Commit y Versión Final

* **Rama Principal:** `main`
* **Commit HEAD Autoritativo:** `6da5899` (`6da5899ab8ce294423f23810aec3bfafa0b17d7a`)
* **Mensaje de Commit:** `fix(scheduler): use service client for internal tick`
* **Autor / Identidad de Git Verificada:** `jordanyjames623-hash <jordanygenao84@gmail.com>`
* **Repositorio Remoto Sincronizado:** `git@github-nextex:jordanygenao84-lang/nextex.git`
* **Diferencia respecto a `origin/main`:** 0 commits (Árbol completamente sincronizado)
* **Tag Canónico de Lanzamiento:** `v0.1.0-rc1`

---

## 4. Arquitectura Final

El sistema opera bajo un modelo desacoplado y tolerante a fallos diseñado para maximizar la resiliencia en infraestructura *serverless*:

```text
[ Cloudflare Cron Trigger (* * * * *) ]
                  │
                  ▼
[ Cloudflare Worker Dispatcher (texter-cron-dispatcher) ]
                  │ (HTTP POST con Bearer CRON_SECRET, redirect: "manual")
                  ├──────────────────────────────┐
                  │ 1. Sequential Tick           │ 2. Post-Scheduler Tick
                  ▼                              ▼
  [ /api/internal/scheduler/tick ]  [ /api/internal/worker/tick ]
                  │                              │
                  │ (createServiceClient)        │ (createServiceClient)
                  │ (service_role)               │ (service_role)
                  ▼                              ▼
    [ RPC: generate_schedule_occurrences ]    [ RPC: claim_job_run / complete_job_run ]
                  │                                            │
                  └──────────────────────┬─────────────────────┘
                                         ▼
                 [ Supabase Cloud (PostgreSQL 15+) ]
                 ├── 36 Tablas con RLS mandatorio
                 ├── Idempotency Ledger & Monotonic Fencing
                 ├── 65 Funciones con search_path blindado
                 └── Append-Only Audit Logging
```

---

## 5. Next.js / TypeScript

* **Framework:** Next.js `14.2.15` (App Router)
* **Lenguaje:** TypeScript `5.6.2` (Modo estricto `strict: true`, `noImplicitAny: true`)
* **Rutas Totales:** 28 páginas compiladas y 48 handlers de ruta API
* **Compilación de Producción:**
  - Comando: `npm run typecheck` (`tsc --noEmit`) -> **0 errores**
  - Comando: `npm run build` (`next build`) -> **Compilación 100% exitosa**
* **Manejo de Rutas Serverless:**
  - Endpoints internos marcados explícitamente con `export const dynamic = "force-dynamic"` para evitar cacheo estático y forzar ejecución serverless en cada invocación.

---

## 6. Supabase Production

* **Proyecto:** NEXTEX
* **Project Reference:** `vvpdycuclnoptffwmrvb`
* **Dominio Base Canónico:** `https://vvpdycuclnoptffwmrvb.supabase.co`
* **Esquema y Migraciones:** 18 de 18 migraciones canónicas aplicadas y verificadas (`2026100101` a `20261015`).
* **Seguridad de Esquema:**
  - 36 tablas con Row Level Security (`alter table ... enable row level security`) activo.
  - Privilegios por defecto revocados para roles no privilegiados (`anon`, `authenticated`).
  - 65 funciones declaradas con `SECURITY DEFINER` y fijación explícita de `set search_path = pg_catalog, public, pg_temp` para neutralizar ataques de suplantación de búsqueda.

---

## 7. Vercel Production

* **Proyecto Vercel:** `nextex` (`prj_O3KoWQTbFquBuXASf2IXYX2AV6FS`)
* **URL Pública:** `https://nextex-seven.vercel.app`
* **Plan:** Vercel Hobby
* **Directriz Crítica de Configuración:**
  - `NEXT_PUBLIC_SUPABASE_URL` en las variables de entorno de Vercel debe ser estrictamente el origen canónico:
    `https://vvpdycuclnoptffwmrvb.supabase.co`
  - **NUNCA** debe incluir el sufijo `/rest/v1`, barras finales duplicadas ni rutas anidadas. La resolución del cliente Supabase agrega internamente `/rest/v1`.
* **Configuración `vercel.json`:**
  - Mantenido estrictamente sin definiciones de crons locales para respetar los límites de frecuencia del plan Hobby.

---

## 8. Cloudflare Cron Dispatcher

* **Worker:** `texter-cron-dispatcher`
* **Ubicación en Repositorio:** `infra/cloudflare-cron/`
* **Trigger:** Cron Trigger ejecutado cada minuto (`* * * * *`).
* **Propósito Arquitectónico:** Asumir el disparo recurrente de alta frecuencia que el plan Hobby de Vercel no soporta, desacoplando la programación de la infraestructura de cómputo.
* **Política de Redirecciones:** Configurado con `redirect: "manual"` e interceptación de códigos de estado 300–399 para cumplir con las restricciones del runtime `workerd` y abortar de inmediato cualquier intento de redirección no segura.
* **Sanitización de Logs:** Los logs estructurados emitidos a Cloudflare (`cron_dispatch_failed`, `cron_dispatch_succeeded`) nunca exponen cabeceras de autorización, secretos ni tokens.

---

## 9. Scheduler Engine

* **Módulo:** `src/lib/jobs/scheduler/scheduler.ts`
* **Endpoint HTTP:** `POST /api/internal/scheduler/tick`
* **Cliente de Base de Datos:** `createServiceClient()` (`service_role` sin sesión de cookies).
* **Capacidades Operativas:**
  - Evaluación determinista de expresiones cron estándar de 5 campos.
  - Resolución nativa de husos horarios IANA y transiciones DST vía `Intl.DateTimeFormat`.
  - Política de captura limitada (*Limited Catch-up*): ante caídas prolongadas, genera un máximo configurable de 2 ejecuciones pendientes y descarta el exceso como `missed`.
  - Invocación atómica de la RPC `generate_schedule_occurrences` para materializar ocurrencias en la base de datos de forma idempotente con protección `UNIQUE(automation_id, scheduled_for)`.

---

## 10. Episodic Serverless Worker

* **Módulo:** `src/lib/jobs/worker/worker.ts`
* **Endpoint HTTP:** `POST /api/internal/worker/tick`
* **Cliente de Base de Datos:** `createServiceClient()` (`service_role`).
* **Gobernanza de Presupuesto Serverless:**
  - Límite global por invocación acotado a 45 segundos (`maxInvocationMs: 45000`).
  - Margen de seguridad de 15 segundos (`safetyMarginMs: 15000`).
  - En el segundo 30 de ejecución activa, el `LeaseManager` activa el `AbortSignal` (`WORKER_BUDGET_EXPIRED`), deteniendo el paso del agente, realizando un checkpoint del estado y re-encolando el trabajo (`checkpoint_requeued`) para continuación limpia en el siguiente ciclo.
* **Reclamo de Trabajos:**
  - Implementa exclusión concurrente vía `FOR UPDATE SKIP LOCKED`.
  - Respeta la jerarquía de bloqueo global: `Workspace -> Agent -> Job -> JobRun`.

---

## 11. Durable Jobs & Queue Subsystem

* **Módulo:** `src/lib/jobs/queue/queue.ts`
* **Ciclo de Vida de Ejecución:**
  - Estados permitidos: `queued`, `claimed`, `running`, `waiting_approval`, `completed`, `failed`, `cancelled`, `timeout`, `dead_letter`.
* **Protección Monótona (Fencing Tokens):**
  - Cada reclamo o modificación incrementa monótonamente `fencing_token`.
  - Operaciones con tokens obsoletos o identidades de worker desfasadas son rechazadas atómicamente (`FENCING_REJECTED`).
* **Políticas de Reintento:**
  - Backoff exponencial con factor configurable (default 2.0).
  - Jitter aleatorio (+/- 20%) para evitar tormentas de reconexión.
  - Transición automática a `dead_letter` al agotar `max_attempts`.

---

## 12. Authentication & Authorization

* **Autenticación Primaria:** Supabase Auth integrado con `@supabase/ssr` mediante almacenamiento seguro de cookies `HttpOnly`, `SameSite=Lax`.
* **Motor de Autorización:** `PermissionEngine` (`src/lib/agents/governance/permissions.ts`).
  - Modelo RBAC canónico: `owner` (41 permisos), `admin` (38 permisos), `member` (14 permisos).
  - Overrides transaccionales por workspace (`workspace_permissions`) gobernados por triggers que impiden la auto-elevación de privilegios.

---

## 13. RLS, ACL y Multi-Tenancy

* **Invariante Multi-Tenant:**
  - Todas las tablas del sistema contienen la columna `workspace_id`.
  - Las consultas directas de clientes aplican la función de aislamiento `public.is_workspace_member(workspace_id, auth.uid())`.
* **Matriz de Acceso a Base de Datos (ACL):**
  - `anon`: Sin acceso de lectura ni escritura a tablas operativas; acceso a RPCs administrativas revocado.
  - `authenticated`: Acceso estrictamente acotado por políticas RLS evaluadas en tiempo de ejecución.
  - `service_role`: Reservado para procesos de servidor desatendidos (`scheduler`, `worker`, ingesta de webhooks).
* **Auditoría Append-Only:**
  - Las tablas `audit_logs`, `job_audit_log`, `authorization_audit_log` y `agent_memory_access_log` tienen triggers que bloquean de forma terminante sentencias `UPDATE` y `DELETE`.

---

## 14. Secret Management

* **Almacenamiento Estricto:**
  - **Producción Vercel:** Almacenadas de forma cifrada en Vercel Project Settings (`CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_KEY_ENCRYPTION_SECRET`, API keys de proveedores LLM).
  - **Cloudflare Worker:** Configuradas en Cloudflare Dashboard / Wrangler Secrets (`CRON_SECRET`, `TEXTER_BASE_URL`).
  - **Desarrollo Local:** Almacenadas exclusivamente en `.env.local` y `.env.staging`, protegidas por `.gitignore` y la barrera anti-producción.
* **Prohibición Absoluta:**
  - Ningún secreto, token o clave privada debe registrarse en commits, documentación ni código fuente.

---

## 15. Webhooks & Integrations Gateway

* **Módulo:** `src/lib/integrations/`
* **Autenticación Criptográfica:**
  - Verificación obligatoria de firmas HMAC-SHA256 (`crypto.createHmac`) sobre el payload crudo (`rawBody`).
  - Ventana de tolerancia temporal estricta (+/- 300 segundos) para prevenir ataques de repetición (*replay attacks*).
  - Registro de noce en ledger de unicidad.
* **Cifrado de Secretos de Integración:**
  - Claves privadas y secretos de endpoint cifrados en reposo mediante AES-256-GCM utilizando `INTEGRATION_KEY_ENCRYPTION_SECRET`.

---

## 16. AI Runtime, Agents, Memory & Tools

* **OmniEngine & Model Router:**
  - Capa de abstracción multi-proveedor con soporte para streaming SSE, normalización de errores y fallback controlado entre modelos declarados en el Model Registry.
* **Agent Core:**
  - Máquina de estados determinista gobernada por límites duros de ejecución (`max_steps: 10`, `max_tokens`, `timeout_seconds`).
* **Tool Registry & Human-in-the-Loop (HITL):**
  - Clasificación canónica de herramientas: `read` (ejecución automática), `write` y `destructive` (suspensión mandatoria en `waiting_approval` hasta decisión humana explícita).
  - Idempotency Ledger que garantiza semántica *Effectively-Once*.
* **Cognitive Memory Subsystem:**
  - Aislamiento estricto de memoria (`workspace`, `agent`, `user`).
  - Las memorias inyectadas se tratan como datos no confiables delimitados en XML; el texto de memoria jamás otorga autorización a herramientas (*Memory != Authority*).

---

## 17. Backup y Recuperación ante Desastres

* **Políticas de Respaldo:**
  - Respaldos diarios y Point-in-Time Recovery (PITR) administrados en Supabase Cloud.
* **Procedimiento de Restauración:**
  - Validado y certificado en suite `test-disaster-recovery-fase4-11-g.mjs`.
  - Scripts de verificación de integridad y recarga de schema cache documentados en `scripts/audit-staging-database-h1.mjs`.

---

## 18. Tests y Resultados Finales

El proyecto cuenta con una cobertura integral validada al 100%:

| Suite | Archivo de Prueba | Casos | Estado |
| :--- | :--- | :---: | :---: |
| **OmniEngine AI Gateway** | `scripts/test-omniengine.mjs` | 17 | `PASS` |
| **Agent Core Runtime** | `scripts/test-agent-core.mjs` | 24 | `PASS` |
| **Tool Execution & HITL** | `scripts/test-agent-tools.mjs` | 18 | `PASS` |
| **Advanced Tool Registry** | `scripts/test-tool-registry.mjs` | 32 | `PASS` |
| **Idempotency & Fencing** | `scripts/test-idempotency-fencing.mjs` | 20 | `PASS` |
| **Governance & Permissions** | `scripts/test-permissions-governance.mjs` | 56 | `PASS` |
| **Cognitive Memory Subsystem** | `scripts/test-agent-memory.mjs` | 90 | `PASS` |
| **Durable Jobs Engine** | `scripts/test-durable-jobs.mjs` | 175 | `PASS` |
| **Integrations & Gateway** | `scripts/test-integrations.mjs` | 240 | `PASS` |
| **Observability & Telemetry** | `scripts/test-observability-fase4-8.mjs` | 100 | `PASS` |
| **Reliability Hardening** | `scripts/test-reliability-hardening-fase4-9.mjs` | 40 | `PASS` |
| **Vercel Cron Route Guards** | `scripts/test-vercel-cron-routes.mjs` | 65 | `PASS` |
| **Reliability Hardening (C)** | `scripts/test-reliability-hardening-fase4-11-c.mjs` | 20 | `PASS` |
| **Cloudflare Cron Dispatcher** | `scripts/test-cloudflare-cron-dispatcher.mjs` | 11 | `PASS` |
| **Worker Budget Suspension** | `scripts/test-worker-budget-suspension.mjs` | 8 | `PASS` |
| **Adversarial Red Team** | `scripts/test-adversarial-red-team-fase4-11-f.mjs` | 38 | `PASS` |
| **Anti-Production Barrier** | `scripts/test-anti-production-barrier-fase4-11-h0.mjs` | 10 | `PASS` |
| **TOTAL** | — | **964** | **100% PASS** |

---

## 19. Production Smoke Tests

Pruebas en vivo ejecutadas sobre la infraestructura de producción:

1. **Invocación Directa de RPC:**
   - Endpoint: `POST https://vvpdycuclnoptffwmrvb.supabase.co/rest/v1/rpc/generate_schedule_occurrences`
   - Autenticación: `Bearer <service_role_key>`
   - Respuesta: `HTTP 200 {"success":true,"spawned_count":0}`
2. **Invocación de Scheduler en Vercel:**
   - Endpoint: `POST https://nextex-seven.vercel.app/api/internal/scheduler/tick`
   - Autenticación: `Bearer <CRON_SECRET>`
   - Encabezado: `x-matched-path: /api/internal/scheduler/tick`
   - Respuesta: `HTTP/2 200 {"success":true,"timestamp":"2026-10-07T21:53:24.488Z","spawnedCount":0}`
3. **Invocación de Worker en Vercel:**
   - Endpoint: `POST https://nextex-seven.vercel.app/api/internal/worker/tick`
   - Autenticación: `Bearer <CRON_SECRET>`
   - Respuesta: `HTTP/2 200` confirmando disponibilidad de procesamiento de cola.

---

## 20. Evidencia de Flujo Completo: Cloudflare → Vercel → Supabase

Registro en tiempo real capturado mediante Cloudflare Worker Tail:

```text
"* * * * *" @ 10/7/2026, 5:55:02 PM - Ok
(log) {"event":"cron_dispatch_succeeded","endpoint":"/api/internal/scheduler/tick","status":200}
(log) {"event":"cron_dispatch_succeeded","endpoint":"/api/internal/worker/tick","status":200}
```

Este registro certifica la cadena transaccional completa:
1. Cloudflare dispara el evento programado cada 60 segundos.
2. Despacha exitosamente hacia `/api/internal/scheduler/tick` con `Bearer <CRON_SECRET>`, evaluando schedules en Supabase.
3. Al recibir `HTTP 200`, avanza inmediatamente a `/api/internal/worker/tick`, reclamando y procesando trabajos de cola.
4. Ambos endpoints retornan `status: 200` de forma consistente y consecutiva.

---

## 21. Limitaciones Conocidas

1. **Concurrencia en Plan Vercel Hobby:**
   - La duración máxima de una función serverless está acotada a los límites del plan. El sistema lo compensa de forma nativa mediante el `LeaseManager` (suspensión en segundo 30 y re-encolado en alta prioridad).
2. **Frecuencia de Disparo:**
   - Depende del Cloudflare Worker externo (`texter-cron-dispatcher`) para mantener el intervalo de 1 minuto, debido a que Vercel Hobby no admite crons con frecuencia menor a 24 horas.

---

## 22. Operación y Mantenimiento

* **Monitoreo de Salud:**
  - Endpoint de comprobación básica: `GET /api/health`
  - Endpoint detallado: `GET /api/health/detailed` (exige sesión de administrador).
* **Supervisión de Despacho:**
  - Ejecutar `npx wrangler tail texter-cron-dispatcher` desde la carpeta `infra/cloudflare-cron` para inspeccionar el flujo de ticks en vivo.
* **Rotación de `CRON_SECRET`:**
  - Cuando se requiera rotar el secreto, actualizar en este orden:
    1. Vercel Dashboard -> Environment Variables -> `CRON_SECRET` (Production).
    2. Cloudflare Dashboard / CLI -> `npx wrangler secret put CRON_SECRET`.

---

## 23. Procedimiento de Recuperación ante Incidentes

1. **Fallo en Despachador de Cron:**
   - Si Cloudflare Worker reporta errores o se desconecta, las ocurrencias acumuladas no se pierden; el motor del scheduler ejecutará *limited catch-up* de hasta 2 ejecuciones pendientes tan pronto se restablezca el servicio.
2. **Trabajos de Cola Bloqueados (Stale Jobs):**
   - Si un worker serverless muere súbitamente, el lease temporal de 60 segundos expira. El RPC `recover_worker_jobs` (o la función programada de recuperación) transiciona automáticamente los trabajos a `queued` con un nuevo fencing token.
3. **Desconexión de Base de Datos:**
   - El sistema opera de forma fail-safe: errores de red generan rechazos limpios en los handlers sin corromper el Idempotency Ledger ni los registros inmutables de auditoría.

---

## 24. Qué NO Debe Modificarse Manualmente

1. **NO modificar las políticas RLS directamente en el editor SQL de Supabase:** Todos los cambios deben realizarse mediante migraciones versionadas en `supabase/migrations/`.
2. **NO modificar ni eliminar registros en tablas `*_audit_log`:** Los triggers de PostgreSQL rechazarán las sentencias y generarán excepciones.
3. **NO reactivar crons de 1 minuto en `vercel.json`:** Vercel Hobby rechazará el despliegue.
4. **NO agregar `/rest/v1` a la variable `NEXT_PUBLIC_SUPABASE_URL`:** Esto provoca errores de ruta `PGRST125` en PostgREST.
5. **NO otorgar permisos `EXECUTE` al rol `anon` o `public` sobre funciones marcadas como `service_role`:** Esto comprometería el aislamiento del motor de ejecución.

---

## 25. Checklist para Futuros Releases

Antes de desplegar cualquier nueva versión a producción:

- [ ] Ejecutar `npm run typecheck` y constatar 0 errores de tipado.
- [ ] Ejecutar `npm run build` y constatar compilación exitosa de todas las rutas.
- [ ] Ejecutar la suite completa de 877 pruebas canónicas y verificar 100% PASS.
- [ ] Verificar que `git diff` esté limpio y no incluya archivos `.env*`.
- [ ] Comprobar que el correo de autor del commit coincida con la cuenta vinculada en Vercel/GitHub.
- [ ] Confirmar que `src/app/api/internal/scheduler/tick/route.ts` y `worker/tick/route.ts` utilicen `createServiceClient()`.
- [ ] Verificar en Vercel Dashboard que el deployment finalice en estado `READY`.
- [ ] Realizar un smoke test de 2 minutos vía `npx wrangler tail texter-cron-dispatcher` constatando eventos `cron_dispatch_succeeded` en ambos endpoints.

---

## 26. Veredicto y Declaración de Cierre

Se certifica formalmente que el proyecto **NEXTEХ (Nexora Texter)** cumple con la totalidad de los requisitos arquitectónicos, operativos, de gobernanza y de seguridad especificados.

```text
==========================================================================
                      ESTADO FINAL DE PRODUCCIÓN
                          PRODUCTION READY
                           PROJECT CLOSED
==========================================================================
```
