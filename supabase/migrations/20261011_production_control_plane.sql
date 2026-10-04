-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.10
-- Production Control Plane: Worker Registry, Leases, Dispatcher & Fault Tolerance
-- REVISION: Hardened Service-Role Security & Defensive Tenant Barriers
-- ==============================================================================

-- 1. EXTENDER CATEGORÍAS DE PERMISOS E INSERTAR 7 PERMISOS CANÓNICOS DE CONTROL PLANE
alter table public.permissions drop constraint if exists permissions_category_check;
alter table public.permissions add constraint permissions_category_check
  check (category in (
    'agents', 'runs', 'tools', 'approvals', 'workspace', 'memory',
    'jobs', 'automations', 'integrations', 'integration_events', 'workers'
  ));

insert into public.permissions (id, key, category, description)
values
  ('workers.read', 'workers.read', 'workers', 'Visualizar workers, leases, métricas y telemetría de ejecución'),
  ('workers.manage', 'workers.manage', 'workers', 'Administrar ciclo de vida, registro y políticas de workers'),
  ('workers.drain', 'workers.drain', 'workers', 'Iniciar vaciado controlado (drain) de workers en el workspace'),
  ('workers.quarantine', 'workers.quarantine', 'workers', 'Aislar y poner workers anómalos en cuarentena operativa'),
  ('workers.restart', 'workers.restart', 'workers', 'Reiniciar workers y reasignar leases activos'),
  ('workers.recover', 'workers.recover', 'workers', 'Forzar recuperación de jobs con leases expirados o workers caídos'),
  ('workers.configure', 'workers.configure', 'workers', 'Modificar capacidad de concurrencia y capabilities de workers')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 2. ACTUALIZACIÓN DE LA MATRIZ DE ROLES (OWNER=59, ADMIN=56, MEMBER=17)
-- OWNER: 59 permisos canónicos completos (100% catálogo)
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 56 permisos (excluye herramientas destructivas y configuración global de miembros/settings)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- MEMBER: 17 permisos operativos (incluye lectura de workers)
insert into public.role_permissions (role, permission_key)
values
  ('member', 'workers.read')
on conflict (role, permission_key) do nothing;

-- 3. EXTENDER ESTADOS DE job_runs CON 'cancellation_requested'
alter table public.job_runs drop constraint if exists job_runs_status_check;
alter table public.job_runs add constraint job_runs_status_check
  check (status in (
    'queued', 'claimed', 'running', 'waiting_approval', 'cancellation_requested',
    'completed', 'failed', 'cancelled', 'timeout', 'dead_letter'
  ));

-- 4. TABLA: workers (Registro de Nodos Ejecutores del Control Plane)
create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  worker_identity text not null check (char_length(trim(worker_identity)) between 3 and 100),
  instance_identity text not null check (char_length(trim(instance_identity)) between 3 and 128),
  status text not null default 'STARTING' check (status in ('STARTING', 'HEALTHY', 'DRAINING', 'STOPPED', 'STALE', 'QUARANTINED')),
  version text not null default '1.0.0' check (char_length(trim(version)) between 1 and 50),
  capabilities text[] not null default array['ai', 'database', 'integrations', 'http']::text[]
    check (cardinality(capabilities) >= 1),
  max_concurrency integer not null default 5 check (max_concurrency between 1 and 100),
  current_concurrency integer not null default 0 check (current_concurrency >= 0),
  last_heartbeat_at timestamptz not null default now(),
  registered_at timestamptz not null default now(),
  draining_at timestamptz,
  stopped_at timestamptz,
  quarantined_at timestamptz,
  quarantine_reason text check (quarantine_reason is null or char_length(quarantine_reason) <= 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_workers_workspace_identity unique (workspace_id, worker_identity),
  constraint uq_workers_id_ws unique (id, workspace_id)
);

comment on table public.workers is 'Registro autoritativo de workers gestionados por el Control Plane con aislamiento multi-tenant estricto';

create index if not exists idx_workers_workspace on public.workers (workspace_id);
create index if not exists idx_workers_status on public.workers (workspace_id, status);
create index if not exists idx_workers_heartbeat on public.workers (status, last_heartbeat_at);

drop trigger if exists tr_workers_updated_at on public.workers;
create trigger tr_workers_updated_at
  before update on public.workers
  for each row execute function public.handle_updated_at();

-- 5. TABLA: worker_leases (Arrendamientos Transaccionales de Ejecución de JobRuns)
create table if not exists public.worker_leases (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null,
  workspace_id uuid not null,
  job_run_id uuid not null,
  fencing_token bigint not null check (fencing_token >= 0),
  leased_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  status text not null default 'active' check (status in ('active', 'released', 'expired', 'revoked')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_worker_leases_worker foreign key (worker_id, workspace_id)
    references public.workers(id, workspace_id) on delete cascade,
  constraint fk_worker_leases_job_run foreign key (job_run_id, workspace_id)
    references public.job_runs(id, workspace_id) on delete cascade,
  constraint uq_worker_leases_id_ws unique (id, workspace_id)
);

comment on table public.worker_leases is 'Arrendamientos desacoplados de workers independientes del lease temporal de JobRun';

-- Invariante Crítica: Exactamente un lease activo por JobRun
create unique index if not exists uq_worker_leases_active_job_run
  on public.worker_leases (job_run_id)
  where status = 'active';

create index if not exists idx_worker_leases_worker on public.worker_leases (worker_id, status);
create index if not exists idx_worker_leases_job_run on public.worker_leases (job_run_id);
create index if not exists idx_worker_leases_expires on public.worker_leases (status, expires_at) where status = 'active';

drop trigger if exists tr_worker_leases_updated_at on public.worker_leases;
create trigger tr_worker_leases_updated_at
  before update on public.worker_leases
  for each row execute function public.handle_updated_at();

-- 6. TABLA: worker_audit_log (Auditoría Append-Only de Ciclo de Vida del Control Plane)
create table if not exists public.worker_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  worker_id uuid references public.workers(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'worker', 'dispatcher', 'system')),
  actor_id text not null check (char_length(trim(actor_id)) between 1 and 100),
  action text not null check (action in (
    'WORKER_REGISTERED', 'WORKER_HEARTBEAT_ANOMALY', 'WORKER_DRAIN_REQUESTED',
    'WORKER_DRAINED', 'WORKER_STOPPED', 'WORKER_QUARANTINED', 'WORKER_RELEASED',
    'WORKER_RECOVERED', 'JOB_DISPATCHED', 'JOB_CLAIMED', 'JOB_REQUEUED', 'JOB_CANCEL_REQUESTED'
  )),
  previous_status text,
  new_status text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  created_at timestamptz not null default now()
);

comment on table public.worker_audit_log is 'Registro inmutable append-only del ciclo de vida de workers y orquestación del Control Plane';

create index if not exists idx_worker_audit_ws on public.worker_audit_log (workspace_id);
create index if not exists idx_worker_audit_worker on public.worker_audit_log (worker_id);
create index if not exists idx_worker_audit_created on public.worker_audit_log (created_at desc);

-- Trigger de Inmutabilidad para worker_audit_log
create or replace function public.protect_worker_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'WORKER_AUDIT_LOG_IMMUTABLE: worker_audit_log es estrictamente append-only. Prohibido UPDATE y DELETE.'
    using errcode = '55000';
end;
$$;

revoke execute on function public.protect_worker_audit_immutable() from public;
revoke execute on function public.protect_worker_audit_immutable() from anon;
revoke execute on function public.protect_worker_audit_immutable() from authenticated;
grant execute on function public.protect_worker_audit_immutable() to service_role;

drop trigger if exists tr_protect_worker_audit_immutable on public.worker_audit_log;
create trigger tr_protect_worker_audit_immutable
  before update or delete on public.worker_audit_log
  for each row execute function public.protect_worker_audit_immutable();

-- 7. ROW LEVEL SECURITY (RLS)
alter table public.workers enable row level security;
alter table public.worker_leases enable row level security;
alter table public.worker_audit_log enable row level security;

-- POLÍTICAS: workers
drop policy if exists "workers_select_member" on public.workers;
create policy "workers_select_member" on public.workers
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "workers_insert_deny" on public.workers;
create policy "workers_insert_deny" on public.workers
  for insert with check (false);

drop policy if exists "workers_update_deny" on public.workers;
create policy "workers_update_deny" on public.workers
  for update using (false);

drop policy if exists "workers_delete_deny" on public.workers;
create policy "workers_delete_deny" on public.workers
  for delete using (false);

-- POLÍTICAS: worker_leases
drop policy if exists "worker_leases_select_member" on public.worker_leases;
create policy "worker_leases_select_member" on public.worker_leases
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "worker_leases_insert_deny" on public.worker_leases;
create policy "worker_leases_insert_deny" on public.worker_leases
  for insert with check (false);

drop policy if exists "worker_leases_update_deny" on public.worker_leases;
create policy "worker_leases_update_deny" on public.worker_leases
  for update using (false);

drop policy if exists "worker_leases_delete_deny" on public.worker_leases;
create policy "worker_leases_delete_deny" on public.worker_leases
  for delete using (false);

-- POLÍTICAS: worker_audit_log
drop policy if exists "worker_audit_select_member" on public.worker_audit_log;
create policy "worker_audit_select_member" on public.worker_audit_log
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "worker_audit_insert_deny" on public.worker_audit_log;
create policy "worker_audit_insert_deny" on public.worker_audit_log
  for insert with check (false);

-- ==============================================================================
-- 8. TRANSACTIONAL RPC PRIMITIVES (SECURITY DEFINER + search_path SEGURO)
-- STRICT SERVICE_ROLE EXECUTION ONLY + DEFENSIVE TENANT BARRIERS
-- ==============================================================================

-- A) register_worker
create or replace function public.register_worker(
  p_workspace_id uuid,
  p_worker_identity text,
  p_instance_identity text,
  p_version text default '1.0.0',
  p_capabilities text[] default array['ai', 'database', 'integrations', 'http']::text[],
  p_max_concurrency integer default 5,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_active_leases integer;
  v_prev_status text;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  if p_workspace_id is null or p_worker_identity is null or trim(p_worker_identity) = '' or p_instance_identity is null or trim(p_instance_identity) = '' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_PARAMETERS', 'error_message', 'Parámetros obligatorios faltantes.');
  end if;

  -- Barrera Defensiva de Tenant: Si existe sesión de usuario autenticado, validar membresía estricta
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace destino.'
    );
  end if;

  -- Resolución de identidad autoritativa contra spoofing
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := p_worker_identity;
    v_effective_actor_type := 'worker';
  end if;

  select * into v_worker
  from public.workers
  where workspace_id = p_workspace_id and worker_identity = p_worker_identity
  for update;

  if found then
    -- Si el worker estaba en QUARANTINED, no puede autoregistrarse a HEALTHY
    if v_worker.status = 'QUARANTINED' then
      return jsonb_build_object(
        'success', false,
        'error_code', 'WORKER_QUARANTINED',
        'error_message', 'Worker en cuarentena operativa. Requiere liberación administrativa explícita.'
      );
    end if;

    v_prev_status := v_worker.status;

    -- Contar leases activos actuales para recalcular concurrencia real
    select count(*) into v_active_leases
    from public.worker_leases
    where worker_id = v_worker.id and status = 'active';

    update public.workers
    set instance_identity = p_instance_identity,
        version = coalesce(p_version, version),
        capabilities = coalesce(p_capabilities, capabilities),
        max_concurrency = coalesce(p_max_concurrency, max_concurrency),
        current_concurrency = v_active_leases,
        status = 'HEALTHY',
        last_heartbeat_at = clock_timestamp(),
        draining_at = null,
        stopped_at = null,
        metadata = coalesce(p_metadata, metadata),
        updated_at = clock_timestamp()
    where id = v_worker.id
    returning * into v_worker;

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      p_workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_REGISTERED', v_prev_status, 'HEALTHY',
      jsonb_build_object('instance_identity', p_instance_identity, 're_registration', true, 'reported_worker', p_worker_identity)
    );
  else
    insert into public.workers (
      workspace_id, worker_identity, instance_identity, status, version, capabilities,
      max_concurrency, current_concurrency, last_heartbeat_at, registered_at, metadata
    ) values (
      p_workspace_id, p_worker_identity, p_instance_identity, 'HEALTHY',
      coalesce(p_version, '1.0.0'),
      coalesce(p_capabilities, array['ai', 'database', 'integrations', 'http']::text[]),
      coalesce(p_max_concurrency, 5), 0, clock_timestamp(), clock_timestamp(),
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into v_worker;

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      p_workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_REGISTERED', null, 'HEALTHY',
      jsonb_build_object('instance_identity', p_instance_identity, 'new_registration', true, 'reported_worker', p_worker_identity)
    );
  end if;

  return jsonb_build_object('success', true, 'worker', to_jsonb(v_worker));
end;
$$;

revoke execute on function public.register_worker(uuid, text, text, text, text[], integer, jsonb) from public;
revoke execute on function public.register_worker(uuid, text, text, text, text[], integer, jsonb) from anon;
revoke execute on function public.register_worker(uuid, text, text, text, text[], integer, jsonb) from authenticated;
grant execute on function public.register_worker(uuid, text, text, text, text[], integer, jsonb) to service_role;

-- B) heartbeat_worker
create or replace function public.heartbeat_worker(
  p_worker_id uuid,
  p_instance_identity text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_active_leases integer;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant: Si existe sesión de usuario autenticado, validar membresía
  if auth.uid() is not null and not public.is_workspace_member(v_worker.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del worker.'
    );
  end if;

  -- Resolución de identidad para auditoría
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := v_worker.worker_identity;
    v_effective_actor_type := 'worker';
  end if;

  -- 1. Rechazo estricto si está en QUARANTINED
  if v_worker.status = 'QUARANTINED' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'WORKER_QUARANTINED',
      'error_message', 'Worker se encuentra en cuarentena.',
      'status', 'QUARANTINED'
    );
  end if;

  -- 2. Detección de Anomalía de Instancia (Instancia Zombie o Desfasada)
  if v_worker.instance_identity <> p_instance_identity then
    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_worker.workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_HEARTBEAT_ANOMALY',
      v_worker.status, v_worker.status,
      jsonb_build_object('expected_instance', v_worker.instance_identity, 'reported_instance', p_instance_identity)
    );

    return jsonb_build_object(
      'success', false,
      'error_code', 'INSTANCE_MISMATCH',
      'error_message', 'Identidad de instancia desfasada. Esta instancia fue reemplazada.'
    );
  end if;

  -- 3. Calcular leases activos reales
  select count(*) into v_active_leases
  from public.worker_leases
  where worker_id = p_worker_id and status = 'active';

  -- Si estaba en STARTING o STALE, promover a HEALTHY (siempre que no esté en DRAINING o STOPPED)
  update public.workers
  set last_heartbeat_at = clock_timestamp(),
      current_concurrency = v_active_leases,
      status = case
        when status in ('STARTING', 'STALE') then 'HEALTHY'
        else status
      end,
      updated_at = clock_timestamp()
  where id = p_worker_id
  returning * into v_worker;

  return jsonb_build_object(
    'success', true,
    'status', v_worker.status,
    'current_concurrency', v_active_leases,
    'last_heartbeat_at', v_worker.last_heartbeat_at
  );
end;
$$;

revoke execute on function public.heartbeat_worker(uuid, text) from public;
revoke execute on function public.heartbeat_worker(uuid, text) from anon;
revoke execute on function public.heartbeat_worker(uuid, text) from authenticated;
grant execute on function public.heartbeat_worker(uuid, text) to service_role;

-- C) mark_worker_stale
create or replace function public.mark_worker_stale(
  p_heartbeat_timeout_seconds integer default 90
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer := 0;
  v_rec record;
begin
  for v_rec in
    select id, workspace_id, worker_identity, status
    from public.workers
    where status in ('HEALTHY', 'STARTING')
      and last_heartbeat_at < (clock_timestamp() - (coalesce(p_heartbeat_timeout_seconds, 90) || ' seconds')::interval)
    for update skip locked
  loop
    update public.workers
    set status = 'STALE', updated_at = clock_timestamp()
    where id = v_rec.id;

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_rec.workspace_id, v_rec.id, 'system', 'control_plane', 'WORKER_HEARTBEAT_ANOMALY',
      v_rec.status, 'STALE',
      jsonb_build_object('timeout_seconds', p_heartbeat_timeout_seconds, 'reason', 'Heartbeat timeout')
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.mark_worker_stale(integer) from public;
revoke execute on function public.mark_worker_stale(integer) from anon;
revoke execute on function public.mark_worker_stale(integer) from authenticated;
grant execute on function public.mark_worker_stale(integer) to service_role;

-- D) drain_worker
create or replace function public.drain_worker(
  p_worker_id uuid,
  p_actor_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_active_leases integer;
  v_prev_status text;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant y Anti-Spoofing:
  -- p_actor_id NO confiere autoridad. Si auth.uid() está presente, validar membresía obligatoria.
  if auth.uid() is not null and not public.is_workspace_member(v_worker.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del worker.'
    );
  end if;

  -- Resolución de identidad para auditoría
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := coalesce(trim(p_actor_id), 'system');
    v_effective_actor_type := case when p_actor_id is not null and p_actor_id <> '' then 'user' else 'system' end;
  end if;

  if v_worker.status = 'QUARANTINED' then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_QUARANTINED', 'error_message', 'No se puede drenar un worker en cuarentena.');
  end if;

  v_prev_status := v_worker.status;

  select count(*) into v_active_leases
  from public.worker_leases
  where worker_id = p_worker_id and status = 'active';

  if v_active_leases = 0 then
    -- Si ya no tiene trabajo activo, detenerlo inmediatamente
    update public.workers
    set status = 'STOPPED',
        draining_at = coalesce(draining_at, clock_timestamp()),
        stopped_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_worker_id
    returning * into v_worker;

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_worker.workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_DRAINED', v_prev_status, 'STOPPED',
      jsonb_build_object('reason', p_reason, 'reported_actor_id', p_actor_id, 'active_leases', 0)
    );
  else
    -- Marcar como DRAINING para impedir nuevos reclamos
    update public.workers
    set status = 'DRAINING',
        draining_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = p_worker_id
    returning * into v_worker;

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_worker.workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_DRAIN_REQUESTED', v_prev_status, 'DRAINING',
      jsonb_build_object('reason', p_reason, 'reported_actor_id', p_actor_id, 'active_leases', v_active_leases)
    );
  end if;

  return jsonb_build_object('success', true, 'status', v_worker.status, 'active_leases', v_active_leases);
end;
$$;

revoke execute on function public.drain_worker(uuid, text, text) from public;
revoke execute on function public.drain_worker(uuid, text, text) from anon;
revoke execute on function public.drain_worker(uuid, text, text) from authenticated;
grant execute on function public.drain_worker(uuid, text, text) to service_role;

-- E) quarantine_worker
create or replace function public.quarantine_worker(
  p_worker_id uuid,
  p_actor_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_prev_status text;
  v_lease record;
  v_revoked_count integer := 0;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  if p_reason is null or trim(p_reason) = '' then
    return jsonb_build_object('success', false, 'error_code', 'REASON_REQUIRED', 'error_message', 'Motivo de cuarentena obligatorio.');
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant y Anti-Spoofing:
  if auth.uid() is not null and not public.is_workspace_member(v_worker.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del worker.'
    );
  end if;

  -- Resolución de identidad para auditoría
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := coalesce(trim(p_actor_id), 'system');
    v_effective_actor_type := case when p_actor_id is not null and p_actor_id <> '' then 'user' else 'system' end;
  end if;

  v_prev_status := v_worker.status;

  -- 1. Poner worker en cuarentena
  update public.workers
  set status = 'QUARANTINED',
      quarantined_at = clock_timestamp(),
      quarantine_reason = p_reason,
      current_concurrency = 0,
      updated_at = clock_timestamp()
  where id = p_worker_id
  returning * into v_worker;

  -- 2. Revocar leases activos. También reconciliar una liberación que ganó
  -- la carrera si su JobRun todavía aparece claimed/running.
  for v_lease in
    select lease_row.id, lease_row.job_run_id, lease_row.workspace_id, lease_row.fencing_token
    from public.worker_leases lease_row
    where lease_row.worker_id = p_worker_id
      and (
        lease_row.status = 'active'
        or (
          lease_row.status = 'released'
          and exists (
            select 1 from public.job_runs run_row
            where run_row.id = lease_row.job_run_id
              and run_row.status in ('claimed', 'running')
          )
        )
      )
    for update
  loop
    update public.worker_leases
    set status = 'revoked', released_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_lease.id;

    -- Re-encolar job_run con incremento de fencing para aislar al worker en cuarentena
    update public.job_runs
    set status = 'queued',
        worker_id = null,
        lease_expires_at = null,
        fencing_token = fencing_token + 1,
        updated_at = clock_timestamp()
    where id = v_lease.job_run_id and status in ('claimed', 'running');

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_lease.workspace_id, p_worker_id, 'system', v_effective_actor, 'JOB_REQUEUED', 'running', 'queued',
      jsonb_build_object('job_run_id', v_lease.job_run_id, 'reason', 'Worker quarantined', 'reported_actor_id', p_actor_id)
    );

    v_revoked_count := v_revoked_count + 1;
  end loop;

  insert into public.worker_audit_log (
    workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
  ) values (
    v_worker.workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_QUARANTINED', v_prev_status, 'QUARANTINED',
    jsonb_build_object('reason', p_reason, 'reported_actor_id', p_actor_id, 'revoked_leases', v_revoked_count)
  );

  return jsonb_build_object('success', true, 'status', 'QUARANTINED', 'revoked_leases', v_revoked_count);
end;
$$;

revoke execute on function public.quarantine_worker(uuid, text, text) from public;
revoke execute on function public.quarantine_worker(uuid, text, text) from anon;
revoke execute on function public.quarantine_worker(uuid, text, text) from authenticated;
grant execute on function public.quarantine_worker(uuid, text, text) to service_role;

-- F) release_worker_quarantine
create or replace function public.release_worker_quarantine(
  p_worker_id uuid,
  p_actor_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant y Anti-Spoofing:
  if auth.uid() is not null and not public.is_workspace_member(v_worker.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del worker.'
    );
  end if;

  -- Resolución de identidad para auditoría
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := coalesce(trim(p_actor_id), 'system');
    v_effective_actor_type := case when p_actor_id is not null and p_actor_id <> '' then 'user' else 'system' end;
  end if;

  if v_worker.status <> 'QUARANTINED' then
    return jsonb_build_object('success', false, 'error_code', 'NOT_QUARANTINED', 'error_message', 'El worker no está en cuarentena.');
  end if;

  -- Se libera pasando a STOPPED para obligar a reinicio limpio y nuevo handshake
  update public.workers
  set status = 'STOPPED',
      quarantined_at = null,
      quarantine_reason = null,
      stopped_at = clock_timestamp(),
      current_concurrency = 0,
      updated_at = clock_timestamp()
  where id = p_worker_id
  returning * into v_worker;

  insert into public.worker_audit_log (
    workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
  ) values (
    v_worker.workspace_id, v_worker.id, v_effective_actor_type, v_effective_actor, 'WORKER_RELEASED', 'QUARANTINED', 'STOPPED',
    jsonb_build_object('reported_actor_id', p_actor_id, 'released_at', clock_timestamp())
  );

  return jsonb_build_object('success', true, 'status', 'STOPPED');
end;
$$;

revoke execute on function public.release_worker_quarantine(uuid, text) from public;
revoke execute on function public.release_worker_quarantine(uuid, text) from anon;
revoke execute on function public.release_worker_quarantine(uuid, text) from authenticated;
grant execute on function public.release_worker_quarantine(uuid, text) to service_role;

-- G) claim_job_run_v2 (Control Plane Atomic Multi-Dispatcher Claim)
create or replace function public.claim_job_run_v2(
  p_worker_id uuid,
  p_lease_seconds integer default 60,
  p_required_capabilities text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_worker record;
  v_cand record;
  v_ws record;
  v_agent record;
  v_policy record;
  v_job record;
  v_active_ws integer;
  v_active_ag integer;
  v_active_jb integer;
  v_claimed_run record;
  v_lease record;
  v_effective_actor text;
begin
  -- 1. Validar Worker Autorizado y Capacidad
  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no registrado.');
  end if;

  -- Barrera Defensiva de Tenant: Si existe sesión autenticada, validar pertenencia
  if auth.uid() is not null and not public.is_workspace_member(v_worker.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del worker.'
    );
  end if;

  if v_worker.status <> 'HEALTHY' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'WORKER_NOT_ELIGIBLE',
      'error_message', 'Worker en estado no elegible (' || v_worker.status || ').',
      'status', v_worker.status
    );
  end if;

  if v_worker.current_concurrency >= v_worker.max_concurrency then
    return jsonb_build_object(
      'success', false,
      'error_code', 'CAPACITY_EXCEEDED',
      'error_message', 'Worker alcanzó su capacidad máxima de concurrencia (' || v_worker.max_concurrency || ').'
    );
  end if;

  -- Validar Capabilities
  if p_required_capabilities is not null and array_length(p_required_capabilities, 1) > 0 then
    if not (p_required_capabilities <@ v_worker.capabilities) then
      return jsonb_build_object(
        'success', false,
        'error_code', 'CAPABILITY_MISMATCH',
        'error_message', 'El worker carece de las capabilities requeridas.'
      );
    end if;
  end if;

  v_effective_actor := coalesce(auth.uid()::text, v_worker.worker_identity);

  -- 2. Búsqueda y Bloqueo Concurrente en la Cola (Exclusivo para el Tenant del Worker)
  for v_cand in
    select jr.id, jr.workspace_id, jr.agent_id, jr.job_id
    from public.job_runs jr
    where jr.workspace_id = v_worker.workspace_id
      and jr.status = 'queued'
      and jr.queued_at <= clock_timestamp()
    order by
      case jr.priority when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end asc,
      jr.queued_at asc
    limit 20
    for update of jr skip locked
  loop
    -- A) Bloqueo Jerárquico: Workspace
    select * into v_ws from public.workspaces where id = v_cand.workspace_id for update;
    if not found then continue; end if;

    select count(*) into v_active_ws from public.job_runs
    where workspace_id = v_cand.workspace_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_ws >= coalesce(v_ws.concurrency_limit, 5) then
      continue; -- Concurrencia de Workspace saturada
    end if;

    -- B) Bloqueo Jerárquico: Agent
    select * into v_agent from public.agents where id = v_cand.agent_id for update;
    if not found or v_agent.status <> 'active' then continue; end if;

    select * into v_policy from public.agent_policies where agent_id = v_cand.agent_id;
    if found and v_policy.allow_execution = false then continue; end if;

    select count(*) into v_active_ag from public.job_runs
    where agent_id = v_cand.agent_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_ag >= coalesce(v_policy.max_concurrent_runs, 3) then
      continue; -- Concurrencia de Agente saturada
    end if;

    -- C) Bloqueo Jerárquico: Job
    select * into v_job from public.jobs where id = v_cand.job_id for update;
    if not found or v_job.status <> 'active' then continue; end if;

    select count(*) into v_active_jb from public.job_runs
    where job_id = v_cand.job_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_jb >= v_job.max_concurrent_runs then
      continue; -- Concurrencia de Job saturada
    end if;

    -- D) Reclamo Atómico de JobRun
    update public.job_runs
    set status = 'claimed',
        worker_id = v_worker.worker_identity,
        lease_expires_at = clock_timestamp() + (coalesce(p_lease_seconds, 60) || ' seconds')::interval,
        fencing_token = fencing_token + 1,
        started_at = coalesce(started_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = v_cand.id
    returning * into v_claimed_run;

    -- E) Crear Worker Lease Desacoplado
    insert into public.worker_leases (
      worker_id, workspace_id, job_run_id, fencing_token, leased_at, expires_at, status
    ) values (
      v_worker.id, v_worker.workspace_id, v_claimed_run.id, v_claimed_run.fencing_token,
      clock_timestamp(), v_claimed_run.lease_expires_at, 'active'
    )
    returning * into v_lease;

    -- F) Incrementar Concurrencia Actual del Worker
    update public.workers
    set current_concurrency = current_concurrency + 1,
        updated_at = clock_timestamp()
    where id = v_worker.id;

    -- G) Auditoría en Ambos Diarios
    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
    ) values (
      v_claimed_run.workspace_id, v_claimed_run.job_id, v_claimed_run.id, 'dispatcher', v_effective_actor,
      'claim', 'queued', 'claimed', v_claimed_run.fencing_token, v_worker.worker_identity
    );

    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_worker.workspace_id, v_worker.id, 'dispatcher', v_effective_actor, 'JOB_CLAIMED',
      'queued', 'claimed',
      jsonb_build_object('job_run_id', v_claimed_run.id, 'lease_id', v_lease.id, 'fencing_token', v_claimed_run.fencing_token)
    );

    return jsonb_build_object(
      'success', true,
      'claimed', true,
      'run', to_jsonb(v_claimed_run),
      'lease', to_jsonb(v_lease)
    );
  end loop;

  return jsonb_build_object('success', true, 'claimed', false, 'message', 'No hay jobs elegibles en cola.');
end;
$$;

revoke execute on function public.claim_job_run_v2(uuid, integer, text[]) from public;
revoke execute on function public.claim_job_run_v2(uuid, integer, text[]) from anon;
revoke execute on function public.claim_job_run_v2(uuid, integer, text[]) from authenticated;
grant execute on function public.claim_job_run_v2(uuid, integer, text[]) to service_role;

-- H) release_worker_lease
create or replace function public.release_worker_lease(
  p_lease_id uuid,
  p_worker_id uuid,
  p_fencing_token bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lease record;
  v_worker record;
begin
  -- Lock ordering is worker -> lease across quarantine, release, and recovery.
  -- This prevents a release holding a lease while quarantine holds the worker.
  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'WORKER_NOT_FOUND', 'error_message', 'Worker no encontrado.');
  end if;

  select * into v_lease from public.worker_leases where id = p_lease_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'LEASE_NOT_FOUND', 'error_message', 'Lease no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant: Si existe sesión autenticada, validar pertenencia
  if auth.uid() is not null and not public.is_workspace_member(v_lease.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del lease.'
    );
  end if;

  if v_lease.worker_id <> p_worker_id or v_lease.fencing_token <> p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Fencing token o worker desfasado.');
  end if;

  if v_lease.status <> 'active' then
    return jsonb_build_object('success', true, 'already_released', true, 'status', v_lease.status);
  end if;

  update public.worker_leases
  set status = 'released', released_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_lease_id;

  update public.workers
  set current_concurrency = greatest(0, current_concurrency - 1),
      -- Si estaba en DRAINING y ya no quedan leases activos, finalizar a STOPPED
      status = case
        when status = 'DRAINING' and current_concurrency - 1 <= 0 then 'STOPPED'
        else status
      end,
      stopped_at = case
        when status = 'DRAINING' and current_concurrency - 1 <= 0 then clock_timestamp()
        else stopped_at
      end,
      updated_at = clock_timestamp()
  where id = p_worker_id
  returning * into v_worker;

  if v_worker.status = 'STOPPED' and v_lease.status = 'active' then
    insert into public.worker_audit_log (
      workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
    ) values (
      v_worker.workspace_id, v_worker.id, 'worker', v_worker.worker_identity, 'WORKER_DRAINED', 'DRAINING', 'STOPPED',
      jsonb_build_object('final_lease_id', p_lease_id)
    );
  end if;

  return jsonb_build_object('success', true, 'released', true);
end;
$$;

revoke execute on function public.release_worker_lease(uuid, uuid, bigint) from public;
revoke execute on function public.release_worker_lease(uuid, uuid, bigint) from anon;
revoke execute on function public.release_worker_lease(uuid, uuid, bigint) from authenticated;
grant execute on function public.release_worker_lease(uuid, uuid, bigint) to service_role;

-- I) request_job_cancellation
create or replace function public.request_job_cancellation(
  p_job_run_id uuid,
  p_actor_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
  v_prev_status text;
  v_effective_actor text;
  v_effective_actor_type text;
begin
  select * into v_run from public.job_runs where id = p_job_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  -- Barrera Defensiva de Tenant y Anti-Spoofing:
  if auth.uid() is not null and not public.is_workspace_member(v_run.workspace_id, auth.uid()) then
    return jsonb_build_object(
      'success', false,
      'error_code', 'UNAUTHORIZED_WORKSPACE',
      'error_message', 'Acceso denegado: El llamador no pertenece al workspace del run.'
    );
  end if;

  -- Resolución de identidad para auditoría
  if auth.uid() is not null then
    v_effective_actor := auth.uid()::text;
    v_effective_actor_type := 'user';
  else
    v_effective_actor := coalesce(trim(p_actor_id), 'system');
    v_effective_actor_type := case when p_actor_id is not null and p_actor_id <> '' then 'user' else 'system' end;
  end if;

  if v_run.status in ('completed', 'failed', 'cancelled', 'timeout', 'dead_letter') then
    return jsonb_build_object('success', false, 'error_code', 'ALREADY_TERMINAL', 'error_message', 'El run ya se encuentra en estado terminal (' || v_run.status || ').');
  end if;

  v_prev_status := v_run.status;

  if v_run.status = 'queued' then
    -- Si aún no fue reclamado, cancelar directamente
    update public.job_runs
    set status = 'cancelled', completed_at = clock_timestamp(), error_code = 'USER_CANCELLED', error_message = p_reason, updated_at = clock_timestamp()
    where id = p_job_run_id
    returning * into v_run;

    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
    ) values (
      v_run.workspace_id, v_run.job_id, v_run.id, v_effective_actor_type, v_effective_actor, 'cancel', v_prev_status, 'cancelled', v_run.fencing_token, v_run.worker_id,
      jsonb_build_object('reason', p_reason, 'reported_actor_id', p_actor_id, 'direct_cancellation', true)
    );

    return jsonb_build_object('success', true, 'status', 'cancelled');
  else
    -- Si ya fue reclamado o está corriendo, solicitar cancelación para que el worker llegue a checkpoint seguro
    update public.job_runs
    set status = 'cancellation_requested', updated_at = clock_timestamp()
    where id = p_job_run_id
    returning * into v_run;

    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
    ) values (
      v_run.workspace_id, v_run.job_id, v_run.id, v_effective_actor_type, v_effective_actor, 'JOB_CANCEL_REQUESTED', v_prev_status, 'cancellation_requested', v_run.fencing_token, v_run.worker_id,
      jsonb_build_object('reason', p_reason, 'reported_actor_id', p_actor_id, 'graceful_checkpoint_requested', true)
    );

    return jsonb_build_object('success', true, 'status', 'cancellation_requested');
  end if;
end;
$$;

revoke execute on function public.request_job_cancellation(uuid, text, text) from public;
revoke execute on function public.request_job_cancellation(uuid, text, text) from anon;
revoke execute on function public.request_job_cancellation(uuid, text, text) from authenticated;
grant execute on function public.request_job_cancellation(uuid, text, text) to service_role;

-- J) recover_worker_jobs
create or replace function public.recover_worker_jobs(
  p_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lease record;
  v_run record;
  v_worker_id uuid;
  v_candidate_ids uuid[];
  v_recovered_count integer := 0;
begin
  -- Snapshot a bounded candidate batch without locking leases. Lock every
  -- affected worker in UUID order before taking any lease lock, matching the
  -- order used by quarantine and release and avoiding cross-worker cycles.
  select array_agg(candidate.id order by candidate.expires_at asc, candidate.id)
  into v_candidate_ids
  from (
    select id, expires_at
    from public.worker_leases
    where status = 'active'
      and expires_at < clock_timestamp()
    order by expires_at asc, id
    limit greatest(coalesce(p_batch_size, 20), 0)
  ) candidate;

  for v_worker_id in
    select candidate.worker_id
    from public.worker_leases candidate
    where candidate.id = any(coalesce(v_candidate_ids, array[]::uuid[]))
    group by candidate.worker_id
    order by candidate.worker_id
  loop
    perform 1 from public.workers where id = v_worker_id for update;
  end loop;

  for v_lease in
    select lease_row.*
    from unnest(coalesce(v_candidate_ids, array[]::uuid[])) with ordinality as candidate(lease_id, ordinal)
    join public.worker_leases lease_row on lease_row.id = candidate.lease_id
    where lease_row.status = 'active'
      and lease_row.expires_at < clock_timestamp()
    order by candidate.ordinal
    for update of lease_row skip locked
  loop
    -- 1. Expirar el lease de worker
    update public.worker_leases
    set status = 'expired', released_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_lease.id;

    -- 2. Ajustar concurrencia del worker
    update public.workers
    set current_concurrency = greatest(0, current_concurrency - 1),
        updated_at = clock_timestamp()
    where id = v_lease.worker_id;

    -- 3. Recuperar JobRun asociado si aún figura en estado no terminal
    select * into v_run from public.job_runs where id = v_lease.job_run_id for update;
    if found and v_run.status in ('claimed', 'running', 'cancellation_requested') then
      if v_run.attempt < v_run.max_attempts then
        -- Re-encolar incrementando fencing token (Zombie Worker Shield)
        update public.job_runs
        set status = 'queued',
            worker_id = null,
            lease_expires_at = null,
            fencing_token = fencing_token + 1,
            updated_at = clock_timestamp()
        where id = v_run.id;

        insert into public.job_audit_log (
          workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
        ) values (
          v_run.workspace_id, v_run.job_id, v_run.id, 'system', 'control_plane', 'lease_recovered', v_run.status, 'queued',
          v_run.fencing_token + 1, null,
          jsonb_build_object('expired_lease_id', v_lease.id, 'previous_worker', v_run.worker_id)
        );

        insert into public.worker_audit_log (
          workspace_id, worker_id, actor_type, actor_id, action, previous_status, new_status, details
        ) values (
          v_run.workspace_id, v_lease.worker_id, 'system', 'control_plane', 'WORKER_RECOVERED',
          v_run.status, 'queued',
          jsonb_build_object('job_run_id', v_run.id, 'expired_lease_id', v_lease.id)
        );
      else
        -- Agotamiento de intentos -> dead_letter
        update public.job_runs
        set status = 'dead_letter',
            lease_expires_at = null,
            error_code = 'LEASE_TIMEOUT_EXHAUSTED',
            error_message = 'JobRun superó max_attempts por expiración de lease.',
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        where id = v_run.id;

        insert into public.job_audit_log (
          workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
        ) values (
          v_run.workspace_id, v_run.job_id, v_run.id, 'system', 'control_plane', 'dead_letter_recovered', v_run.status, 'dead_letter',
          v_run.fencing_token, null
        );
      end if;

      v_recovered_count := v_recovered_count + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'recovered_count', v_recovered_count);
end;
$$;

revoke execute on function public.recover_worker_jobs(integer) from public;
revoke execute on function public.recover_worker_jobs(integer) from anon;
revoke execute on function public.recover_worker_jobs(integer) from authenticated;
grant execute on function public.recover_worker_jobs(integer) to service_role;
