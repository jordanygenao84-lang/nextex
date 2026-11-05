-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 5 (H-005)
-- RLS de agents: INSERT/UPDATE/DELETE exigen permiso efectivo o admin.
--
-- Antes, agents_insert/update/delete_member exigían solo membresía: cualquier
-- member podía crear agentes, reescribir system_instructions (prompt
-- injection persistente) o borrar agentes. La API tampoco chequea rol en
-- código (eso es H-013, Lote 3); esta migración pone el backstop en BD.
--
-- Nuevo: además de membresía, se exige
--   public.has_permission(auth.uid(), workspace_id, 'agents.create' |
--   'agents.update' | 'agents.delete')  (has_permission ya corregido, paso 2)
--   O rol admin del workspace (owner/admin vía is_workspace_admin).
-- SELECT queda por membresía, SIN cambios.
-- agent_policies NO se toca en este lote (Lotes 2/5).
--
-- ROLLBACK (SQL inverso exacto): restaurar las tres políticas anteriores,
-- definidas en supabase/migrations/2026100104_agent_core.sql:117-135
-- (origin/main 6f1b427):
--   drop policy if exists "agents_insert_member" on public.agents;
--   create policy "agents_insert_member"
--     on public.agents
--     for insert
--     with check (auth.uid() = created_by and public.is_workspace_member(workspace_id, auth.uid()));
--   drop policy if exists "agents_update_member" on public.agents;
--   create policy "agents_update_member"
--     on public.agents
--     for update
--     using (public.is_workspace_member(workspace_id, auth.uid()))
--     with check (public.is_workspace_member(workspace_id, auth.uid()));
--   drop policy if exists "agents_delete_member" on public.agents;
--   create policy "agents_delete_member"
--     on public.agents
--     for delete
--     using (public.is_workspace_member(workspace_id, auth.uid()));
-- ==============================================================================

drop policy if exists "agents_insert_member" on public.agents;
create policy "agents_insert_member"
  on public.agents
  for insert
  with check (
    auth.uid() = created_by
    and public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'agents.create')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );

drop policy if exists "agents_update_member" on public.agents;
create policy "agents_update_member"
  on public.agents
  for update
  using (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'agents.update')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  )
  with check (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'agents.update')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );

drop policy if exists "agents_delete_member" on public.agents;
create policy "agents_delete_member"
  on public.agents
  for delete
  using (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'agents.delete')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );
