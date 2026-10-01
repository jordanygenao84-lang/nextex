-- ==============================================================================
-- NEXTEХ — CORRECCIÓN RLS: Helper functions Security Definer anti-recursión
-- Ejecuta este script en el SQL Editor de Supabase
-- ==============================================================================

create or replace function public.is_workspace_member(ws_id uuid, u_id uuid)
returns boolean
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = u_id
  );
$$ language sql stable;

create or replace function public.is_workspace_admin(ws_id uuid, u_id uuid)
returns boolean
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = u_id and role in ('owner', 'admin')
  );
$$ language sql stable;

-- 1. Actualizar políticas de workspaces
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
  on public.workspaces
  for select
  using (public.is_workspace_member(id, auth.uid()));

drop policy if exists "workspaces_update_admin" on public.workspaces;
create policy "workspaces_update_admin"
  on public.workspaces
  for update
  using (public.is_workspace_admin(id, auth.uid()));

-- 2. Actualizar políticas de workspace_members
drop policy if exists "workspace_members_select_coworkers" on public.workspace_members;
create policy "workspace_members_select_coworkers"
  on public.workspace_members
  for select
  using (
    user_id = auth.uid()
    or public.is_workspace_member(workspace_id, auth.uid())
  );

drop policy if exists "workspace_members_insert_admin" on public.workspace_members;
create policy "workspace_members_insert_admin"
  on public.workspace_members
  for insert
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

drop policy if exists "workspace_members_delete_admin" on public.workspace_members;
create policy "workspace_members_delete_admin"
  on public.workspace_members
  for delete
  using (public.is_workspace_admin(workspace_id, auth.uid()));
