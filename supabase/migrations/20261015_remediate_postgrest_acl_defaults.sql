-- ==============================================================================
-- NEXTEХ — FASE 4.11-H1-R2
-- Remediación definitiva de ACL PostgREST
-- Corrige ACL existentes + default privileges.
-- NO modifica RLS ni policies.
-- ==============================================================================

-- 1. Esquema public: conservar acceso de uso para los roles PostgREST.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Eliminar los privilegios amplios heredados actualmente por anon/authenticated.
REVOKE ALL PRIVILEGES ON TABLE
  public.agent_memories,
  public.agent_memory_access_log,
  public.agent_policies,
  public.agent_run_steps,
  public.agent_runs,
  public.agent_tools,
  public.agents,
  public.ai_requests,
  public.ai_usage,
  public.approval_requests,
  public.authorization_audit_log,
  public.automations,
  public.control_plane_audit_log,
  public.conversations,
  public.integration_endpoints,
  public.integration_event_attempts,
  public.integration_event_audit_log,
  public.integration_events,
  public.integrations,
  public.job_audit_log,
  public.job_runs,
  public.jobs,
  public.messages,
  public.observability_spans,
  public.permissions,
  public.profiles,
  public.role_permissions,
  public.schedule_occurrences,
  public.tool_idempotency_ledger,
  public.worker_audit_log,
  public.worker_leases,
  public.workers,
  public.workspace_members,
  public.workspace_permissions,
  public.workspaces
FROM anon, authenticated;

-- 3. Reaplicar exactamente los permisos de authenticated definidos por 20261013.

GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspaces TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.workspace_members TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.conversations TO authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ai_requests TO authenticated;
GRANT SELECT, INSERT ON TABLE public.ai_usage TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agents TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.agent_tools TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_runs TO authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_run_steps TO authenticated;

GRANT SELECT ON TABLE public.tool_idempotency_ledger TO authenticated;

GRANT SELECT ON TABLE public.permissions TO authenticated;
GRANT SELECT ON TABLE public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.agent_policies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.approval_requests TO authenticated;
GRANT SELECT ON TABLE public.authorization_audit_log TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_memories TO authenticated;
GRANT SELECT ON TABLE public.agent_memory_access_log TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.automations TO authenticated;
GRANT SELECT ON TABLE public.schedule_occurrences TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.job_runs TO authenticated;
GRANT SELECT ON TABLE public.job_audit_log TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.integration_endpoints TO authenticated;
GRANT SELECT ON TABLE public.integration_events TO authenticated;
GRANT SELECT ON TABLE public.integration_event_attempts TO authenticated;
GRANT SELECT ON TABLE public.integration_event_audit_log TO authenticated;

GRANT SELECT ON TABLE public.observability_spans TO authenticated;

GRANT SELECT ON TABLE public.workers TO authenticated;
GRANT SELECT ON TABLE public.worker_leases TO authenticated;
GRANT SELECT ON TABLE public.worker_audit_log TO authenticated;
GRANT SELECT ON TABLE public.control_plane_audit_log TO authenticated;

-- 4. IMPORTANTE:
-- service_role NO se modifica aquí.
-- Sus ACL existentes permanecen intactos.

-- 5. Evitar que futuras tablas creadas por postgres hereden privilegios
-- amplios hacia anon/authenticated.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;

-- 6. Los default privileges pertenecientes a supabase_admin no se modifican aquí.
-- Las migraciones linked se ejecutan como postgres y PostgreSQL no permite a
-- postgres modificar los default privileges de un rol reservado/superusuario
-- del que no es miembro.
-- ==============================================================================
-- FIN
-- RLS Y POLICIES NO SE MODIFICAN.
-- ==============================================================================

