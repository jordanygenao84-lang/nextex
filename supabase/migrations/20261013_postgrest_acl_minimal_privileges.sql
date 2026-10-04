-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN OFICIAL FASE 4.11-H1-R1
-- Remediación Controlada de ACL PostgREST (FINDING-H1-01)
-- Principio de Mínimo Privilegio (PoLP) — Preservación Estricta de RLS
-- ==============================================================================

-- 1. ESQUEMA PUBLIC
grant usage on schema public to anon, authenticated, service_role;

-- 2. TABLAS BASE DE AUTENTICACIÓN, WORKSPACES Y MIEMBROS
-- profiles: authenticated solo lee y actualiza su propio perfil (sujeto a RLS)
grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- workspaces: authenticated gestiona sus workspaces según RLS
grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspaces to service_role;

-- workspace_members: authenticated gestiona membresías según RLS
grant select, insert, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.workspace_members to service_role;

-- 3. OMNIENGINE AI GATEWAY
-- conversations: miembros leen, crean y actualizan sus conversaciones
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.conversations to service_role;

-- messages: miembros leen e insertan mensajes; inmutables desde frontend
grant select, insert on table public.messages to authenticated;
grant select, insert, update, delete on table public.messages to service_role;

-- ai_requests: miembros leen e insertan peticiones de su workspace (sujeto a RLS)
grant select, insert on table public.ai_requests to authenticated;
grant select, insert, update, delete on table public.ai_requests to service_role;

-- ai_usage: miembros leen e insertan consumo de cuotas (sujeto a RLS)
grant select, insert on table public.ai_usage to authenticated;
grant select, insert, update, delete on table public.ai_usage to service_role;

-- 4. AGENT CORE & TOOLS
-- agents: gestión completa por miembros autorizados según RLS
grant select, insert, update, delete on table public.agents to authenticated;
grant select, insert, update, delete on table public.agents to service_role;

-- agent_tools: configuración de herramientas por miembros según RLS
grant select, insert, delete on table public.agent_tools to authenticated;
grant select, insert, update, delete on table public.agent_tools to service_role;

-- agent_runs: miembros leen y despachan ejecuciones
grant select, insert, update on table public.agent_runs to authenticated;
grant select, insert, update, delete on table public.agent_runs to service_role;

-- agent_run_steps: miembros leen e insertan pasos de ejecución (sujeto a RLS)
grant select, insert on table public.agent_run_steps to authenticated;
grant select, insert, update, delete on table public.agent_run_steps to service_role;

-- 5. IDEMPOTENCIA Y FENCING
-- tool_idempotency_ledger: miembros auditan ejecuciones; mutación vía RPC/backend
grant select on table public.tool_idempotency_ledger to authenticated;
grant select, insert, update, delete on table public.tool_idempotency_ledger to service_role;

-- 6. GOBERNANZA, PERMISOS Y APROBACIONES (HITL)
-- permissions: catálogo del sistema en modo solo lectura
grant select on table public.permissions to authenticated;
grant select, insert, update, delete on table public.permissions to service_role;

-- role_permissions: matriz RBAC en modo solo lectura
grant select on table public.role_permissions to authenticated;
grant select, insert, update, delete on table public.role_permissions to service_role;

-- workspace_permissions: administradores configuran overrides según RLS
grant select, insert, update, delete on table public.workspace_permissions to authenticated;
grant select, insert, update, delete on table public.workspace_permissions to service_role;

-- agent_policies: administradores configuran políticas según RLS
grant select, insert, update on table public.agent_policies to authenticated;
grant select, insert, update, delete on table public.agent_policies to service_role;

-- approval_requests: miembros leen, crean y resuelven solicitudes HITL según RLS
grant select, insert, update on table public.approval_requests to authenticated;
grant select, insert, update, delete on table public.approval_requests to service_role;

-- authorization_audit_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.authorization_audit_log to authenticated;
grant select, insert on table public.authorization_audit_log to service_role;

-- 7. MEMORIA COGNITIVA
-- agent_memories: gestión de memorias de workspace según RLS
grant select, insert, update, delete on table public.agent_memories to authenticated;
grant select, insert, update, delete on table public.agent_memories to service_role;

-- agent_memory_access_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.agent_memory_access_log to authenticated;
grant select, insert on table public.agent_memory_access_log to service_role;

-- 8. DURABLE JOBS Y SCHEDULER
-- jobs: miembros crean y gestionan jobs según RLS
grant select, insert, update, delete on table public.jobs to authenticated;
grant select, insert, update, delete on table public.jobs to service_role;

-- automations: miembros configuran automatizaciones según RLS
grant select, insert, update, delete on table public.automations to authenticated;
grant select, insert, update, delete on table public.automations to service_role;

-- schedule_occurrences: lectura de próximas ocurrencias; gestión por scheduler
grant select on table public.schedule_occurrences to authenticated;
grant select, insert, update, delete on table public.schedule_occurrences to service_role;

-- job_runs: lectura y reintentos/cancelaciones según RLS
grant select, insert, update on table public.job_runs to authenticated;
grant select, insert, update, delete on table public.job_runs to service_role;

-- job_audit_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.job_audit_log to authenticated;
grant select, insert on table public.job_audit_log to service_role;

-- 9. INTEGRACIONES Y WEBHOOKS
-- integrations: gestión de integraciones según RLS
grant select, insert, update, delete on table public.integrations to authenticated;
grant select, insert, update, delete on table public.integrations to service_role;

-- integration_endpoints: gestión de endpoints webhook según RLS
grant select, insert, update, delete on table public.integration_endpoints to authenticated;
grant select, insert, update, delete on table public.integration_endpoints to service_role;

-- integration_events: lectura de eventos por miembros; mutación por gateway/workers
grant select on table public.integration_events to authenticated;
grant select, insert, update, delete on table public.integration_events to service_role;

-- integration_event_attempts: lectura de intentos de procesamiento
grant select on table public.integration_event_attempts to authenticated;
grant select, insert, update, delete on table public.integration_event_attempts to service_role;

-- integration_event_audit_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.integration_event_audit_log to authenticated;
grant select, insert on table public.integration_event_audit_log to service_role;

-- 10. OBSERVABILIDAD Y TELEMETRÍA
-- observability_spans: lectura de trazas por miembros de workspace
grant select on table public.observability_spans to authenticated;
grant select, insert, update, delete on table public.observability_spans to service_role;

-- 11. CONTROL PLANE Y WORKER RUNTIME
-- workers: lectura para monitoreo de control plane; gestión por workers/RPCs
grant select on table public.workers to authenticated;
grant select, insert, update, delete on table public.workers to service_role;

-- worker_leases: lectura para monitoreo de control plane; gestión por workers/RPCs
grant select on table public.worker_leases to authenticated;
grant select, insert, update, delete on table public.worker_leases to service_role;

-- worker_audit_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.worker_audit_log to authenticated;
grant select, insert on table public.worker_audit_log to service_role;

-- control_plane_audit_log: append-only; inmutable sin UPDATE ni DELETE
grant select on table public.control_plane_audit_log to authenticated;
grant select, insert on table public.control_plane_audit_log to service_role;

-- ==============================================================================
-- NOTA DE SEGURIDAD (CONFINAMIENTO ANON):
-- El rol 'anon' NO recibe privilegios sobre ninguna de las 35 tablas públicas.
-- Toda consulta de PostgREST efectuada por 'anon' sobre estas tablas es bloqueada
-- directamente por el motor de ACL de PostgreSQL con error 42501 (Permission Denied).
-- ==============================================================================
