-- ==============================================================================
-- NEXTEХ CONTROL PLANE — FASE 4.10-H: GOVERNANCE & AUDIT MIGRATION
-- Registro inmutable, append-only y gobernanza de decisiones del Control Plane
-- ==============================================================================

create table if not exists public.control_plane_audit_log (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id text not null,
  actor_type text not null check (actor_type in ('user', 'system', 'worker', 'dispatcher', 'agent', 'service')),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  decision text not null check (decision in ('allow', 'deny', 'requires_approval', 'blocked', 'expired')),
  reason text,
  correlation_id text,
  trace_id text,
  fencing_token numeric,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Índices de consulta de alta frecuencia y correlación forense
create index if not exists idx_cp_audit_ws_created
  on public.control_plane_audit_log (workspace_id, created_at desc);

create index if not exists idx_cp_audit_correlation
  on public.control_plane_audit_log (workspace_id, correlation_id)
  where correlation_id is not null;

create index if not exists idx_cp_audit_trace
  on public.control_plane_audit_log (workspace_id, trace_id)
  where trace_id is not null;

create unique index if not exists uq_cp_audit_idempotency
  on public.control_plane_audit_log (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- H5: Inmutabilidad estricta (Trigger 55000: Prohibido UPDATE y DELETE)
create or replace function public.protect_control_plane_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception '55000: La auditoría del Control Plane es estrictamente inmutable y append-only. UPDATE y DELETE están prohibidos.';
end;
$$;

drop trigger if exists tr_protect_control_plane_audit_immutable on public.control_plane_audit_log;
create trigger tr_protect_control_plane_audit_immutable
  before update or delete on public.control_plane_audit_log
  for each row execute function public.protect_control_plane_audit_immutable();

-- RLS: Seguridad a nivel de fila y aislamiento estricto
alter table public.control_plane_audit_log enable row level security;

create policy cp_audit_select_isolation on public.control_plane_audit_log
  for select using (
    auth.uid() is not null and public.is_workspace_member(workspace_id, auth.uid())
  );

create policy cp_audit_insert_service on public.control_plane_audit_log
  for insert with check (
    auth.role() = 'service_role' or (auth.uid() is not null and public.is_workspace_member(workspace_id, auth.uid()))
  );

create policy cp_audit_update_deny on public.control_plane_audit_log
  for update using (false);

create policy cp_audit_delete_deny on public.control_plane_audit_log
  for delete using (false);
