# NEXTEХ (Nexora Texter) — Comprehensive Handover & Project State

**Fecha de Actualización:** 2026-10-03  
**Directorio Canónico Exclusivo:** `/Users/jordanycastanosgenao/Proyectos/texter`  
**Directorio Prohibido:** `/Users/jordanycastanosgenao/Downloads/infinite-smells`  
**Habilidad Registrada:** `user:nextex-project-engineer`

---

## 1. Resumen Ejecutivo del Proyecto
NEXTEХ es una plataforma empresarial multi-tenant de automatización de texto, agentes autónomos, procesamiento de IA (OmniEngine), colas de trabajos durables, integraciones externas (webhooks y eventos) y observabilidad operacional de misión crítica, construida con Next.js 14 (App Router), TypeScript, TailwindCSS y PostgreSQL en Supabase.

---

## 2. Estado Certificado por Fases

| Fase | Título / Alcance | Estado | Métricas Clave |
|---|---|---|---|
| **Fase 1 - 3** | Auth, Profiles, Workspaces, RLS multi-inquilino base | COMPLETE | Aislamiento RLS en 100% de tablas |
| **Fase 4.1 - 4.3** | OmniEngine AI Gateway, Quotas & Idempotency Ledger | COMPLETE | RFC 8785 canonical hashing, SHA-256 |
| **Fase 4.4** | Agent Core, Governance, HITL, Permissions Matrix | COMPLETE | Matriz de 22 permisos, Anti-Self-Approval |
| **Fase 4.5** | Cognitive Memory Subsystem (Episodic, Semantic, Declarative) | COMPLETE | pgvector, provenance triggers, 90 tests |
| **Fase 4.6** | Durable Jobs, Scheduler & Episodic Worker Engine | COMPLETE | SKIP LOCKED, leases, 175 tests |
| **Fase 4.7** | External Integrations, Webhooks & Secure Inbound Events | COMPLETE | HMAC signatures, replay defense, 240 tests |
| **Fase 4.8** | Observability, OpenTelemetry Telemetry & Trace Tree | COMPLETE | Composite FKs, Attribute Bounding, 100 tests |
| **Fase 4.9** | Reliability Hardening, Fencing Barriers & Zombie Prevention | COMPLETE | Pre-execution barriers, 40 tests |
| **Fase 4.10** | Production Control Plane (Dispatcher, Leases, Governance, Fault Tolerance) | COMPLETE | Worker Registry, Leases desacoplados, Dispatcher |
| **Fase 4.11-A** | Production Readiness Audit (Zero-Trust Inspection) | COMPLETE | 0 Critical, 0 High, 2 Medium, 3 Low, 2 Info |
| **Fase 4.11-B** | Security Hardening (MEDIUM-01 & MEDIUM-02) | COMPLETE | 65/65 SECURITY DEFINER endurecidas, Dual Path seguro |
| **Fase 4.11-C** | Reliability Hardening (R01 a R20) | VERIFIED | 20/20 escenarios de fiabilidad y tolerancia a fallos PASS |

---

## 3. Estado de Defectos y Hallazgos
* **CRITICAL:** 0
* **HIGH:** 0
* **MEDIUM:** 0 (MEDIUM-01 y MEDIUM-02 resueltos y certificados)
* **LOW Restantes (3):**
  1. `LOW-01`: Índices compuestos adicionales sugeridos en tablas de auditoría histórica.
  2. `LOW-02`: Limpieza de scripts de diagnóstico temporal en `scripts/`.
  3. `LOW-03`: Estandarización de mensajes de error en endpoints legados.
* **INFO Restantes (2):**
  1. `INFO-01`: Documentación de OpenAPI/Swagger interna para la API de Control Plane.
  2. `INFO-02`: Marcado de deprecación formal JSDoc en endpoints legados (`/api/approvals/[id]`).

---

## 4. Normas Operativas Inviolables
1. **Entorno Estrictamente Local:**
   * PROHIBIDO ejecutar `supabase db push`, `npx supabase db push`, o queries en el SQL Editor remoto.
   * PROHIBIDO realizar commits, pushes a GitHub o despliegues a Vercel sin orden explícita.
   * La base de datos y el código se mantienen sincronizados localmente mediante las migraciones versionadas en `supabase/migrations/`.
2. **Operaciones Git:**
   * Utilizar exclusivamente el servidor MCP `git` (`client:execute_mcp` con `ServerName: "git"`).
3. **Manejo de Desconexión de Stream (`Client stream disconnected.`):**
   * Si una herramienta arroja `Client stream disconnected.`, la regla estricta exige **DETENERSE INMEDIATAMENTE**.
   * No reintentar en bucle, no mutar archivos y esperar el siguiente turno limpio de conversación.
4. **Seguridad en PostgreSQL:**
   * Todas las funciones `SECURITY DEFINER` deben declarar obligatoriamente:
     `SET search_path = pg_catalog, public, pg_temp` (o incluir `extensions` si consumen pgvector/pgcrypto).
   * Ningún endpoint puede permitir bypass de Governance, HITL, Fencing, Idempotencia o Multi-Tenancy.

---

## 5. Batería de Pruebas y Comandos Canónicos

```bash
# 1. Validación estática de TypeScript
npm run typecheck

# 2. Compilación de producción Next.js
npm run build

# 3. Regresión canónica histórica (877 tests)
node -e '
import { execSync } from "child_process";
const suites = [
  "scripts/test-omniengine.mjs",
  "scripts/test-agent-core.mjs",
  "scripts/test-agent-tools.mjs",
  "scripts/test-tool-registry.mjs",
  "scripts/test-idempotency-fencing.mjs",
  "scripts/test-permissions-governance.mjs",
  "scripts/test-agent-memory.mjs",
  "scripts/test-durable-jobs.mjs",
  "scripts/test-integrations.mjs",
  "scripts/test-observability-fase4-8.mjs",
  "scripts/test-reliability-hardening-fase4-9.mjs",
  "scripts/test-vercel-cron-routes.mjs"
];
for (const s of suites) execSync(`node ${s}`, { stdio: "inherit" });
'

# 4. Suite de Confiabilidad y Tolerancia a Fallos R01-R20
node scripts/test-reliability-hardening-fase4-11-c.mjs

# 5. Suite de Certificación de Hardening MEDIUM-01 y MEDIUM-02
node scripts/test-medium-remediation.mjs
```

---

## 6. Instrucciones de Continuidad para Nuevas Sesiones
Para reanudar el proyecto en una nueva conversación:
1. Leer este archivo `PROJECT_HANDOVER.md`.
2. Invocar la habilidad `user:nextex-project-engineer` para cargar las directivas operativas.
3. Verificar el estado con `npm run typecheck` y `node scripts/test-reliability-hardening-fase4-11-c.mjs`.
4. Continuar directamente con el cierre formal de la **Fase 4.11-C** o iniciar la **Fase 4.11-D (Low & Info Remediation)**.
