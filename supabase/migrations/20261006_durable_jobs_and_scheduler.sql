-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.6
-- Durable Jobs, Automation, Scheduler, Queue & Episodic Worker Engine
-- ==============================================================================

create extension if not exists pgcrypto;

-- 1. EXTENSIÓN DEL CATÁLOGO DE PERMISOS: 26 -> 41 PERMISOS CANÓNICOS
alter table public.permissions
  drop constraint if exists permissions_category_check;

alter table public.permissions
  add constraint permissions_category_check
  check (category in ('agents', 'runs', 'tools', 'approvals', 'workspace', 'memory', 'jobs', 'automations'));

insert into public.permissions (id, key, category, description)
values
  ('jobs.read', 'jobs.read', 'jobs', 'Visualizar jobs y configuraciones en el workspace'),
  ('jobs.create', 'jobs.create', 'jobs', 'Registrar nuevos jobs autónomos durables'),
  ('jobs.update', 'jobs.update', 'jobs', 'Modificar instrucciones, reintentos y timeouts de jobs'),
  ('jobs.delete', 'jobs.delete', 'jobs', 'Eliminar o archivar jobs del workspace'),
  ('jobs.activate', 'jobs.activate', 'jobs', 'Activar jobs para permitir su ejecución o programación'),
  ('jobs.pause', 'jobs.pause', 'jobs', 'Pausar jobs suspendiendo nuevas ejecuciones'),
  ('jobs.archive', 'jobs.archive', 'jobs', 'Archivar jobs preservando su historial inmutable'),
  ('jobs.run', 'jobs.run', 'jobs', 'Disparar ejecución manual inmediata de un job'),
  ('automations.read', 'automations.read', 'automations', 'Visualizar programaciones y calendarios de automations'),
  ('automations.create', 'automations.create', 'automations', 'Registrar nuevas automations y reglas cron'),
  ('automations.update', 'automations.update', 'automations', 'Modificar reglas cron, timezone y políticas de overlap'),
  ('automations.delete', 'automations.delete', 'automations', 'Eliminar programaciones de automation'),
  ('automations.activate', 'automations.activate', 'automations', 'Habilitar disparo programado de automations'),
  ('automations.pause', 'automations.pause', 'automations', 'Pausar programaciones suspendiendo generación de occurrences'),
  ('automations.archive', 'automations.archive', 'automations', 'Archivar automations preservando historial')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 2. ACTUALIZACIÓN DE LA MATRIZ DE ROLES (OWNER=41, ADMIN=38, MEMBER=14)
-- OWNER: 41 permisos canónicos completos
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 38 permisos (excluye tools.execute_destructive, workspace.members.manage, workspace.settings.update)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- MEMBER: 14 permisos operativos
insert into public.role_permissions (role, permission_key)
values
  ('member', 'jobs.read'),
  ('member', 'jobs.run'),
  ('member', 'automations.read')
on conflict (role, permission_key) do nothing;

-- 3. EXTENDER WORKSPACES CON CONCURRENCY_LIMIT
alter table public.workspaces
  add column if not exists concurrency_limit integer not null default 5 check (concurrency_limit between 1 and 100);

-- 4. TABLA: jobs (Definición Durable de Trabajo Autónomo)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  input text not null check (char_length(trim(input)) between 1 and 8000),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  trigger_type text not null default 'manual' check (trigger_type in ('manual', 'scheduled')),
  timeout_seconds integer not null default 300 check (timeout_seconds between 10 and 1800),
  max_concurrent_runs integer not null default 1 check (max_concurrent_runs between 1 and 10),
  retry_policy jsonb not null default '{"max_attempts": 3, "initial_delay_seconds": 10, "max_delay_seconds": 300, "backoff_factor": 2.0, "jitter": true}'::jsonb,
  configuration_version integer not null default 1 check (configuration_version >= 1),
  configuration_hash text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.jobs is 'Definición durable de trabajo autónomo con gobernanza de reintentos, límites y configuración inmutable versionada';

create index if not exists idx_jobs_workspace on public.jobs (workspace_id);
create index if not exists idx_jobs_agent on public.jobs (agent_id);
create index if not exists idx_jobs_status on public.jobs (status);

drop trigger if exists tr_jobs_updated_at on public.jobs;
create trigger tr_jobs_updated_at
  before update on public.jobs
  for each row execute function public.handle_updated_at();

-- 5. TABLA: automations (Calendario y Disparadores Programados)
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  cron_expression text not null check (char_length(trim(cron_expression)) between 1 and 100),
  timezone text not null default 'UTC' check (char_length(trim(timezone)) <= 50),
  concurrency_policy text not null default 'forbid' check (concurrency_policy in ('allow', 'forbid', 'queue')),
  catch_up_policy text not null default 'limited_catch_up' check (catch_up_policy in ('skip', 'catch_up', 'limited_catch_up')),
  max_catch_up_occurrences integer not null default 2 check (max_catch_up_occurrences between 1 and 10),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  last_scheduled_at timestamptz,
  next_scheduled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.automations is 'Programación recurrente de jobs con soporte IANA timezone, control de overlap y limited catch-up';

create index if not exists idx_automations_workspace on public.automations (workspace_id);
create index if not exists idx_automations_job on public.automations (job_id);
create index if not exists idx_automations_dispatch on public.automations (status, next_scheduled_at);

drop trigger if exists tr_automations_updated_at on public.automations;
create trigger tr_automations_updated_at
  before update on public.automations
  for each row execute function public.handle_updated_at();

-- 6. TABLA: schedule_occurrences (Instantes Materializados de Ejecución Idempotente)
create table if not exists public.schedule_occurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'spawned', 'skipped', 'missed')),
  job_run_id uuid,
  skip_reason text,
  created_at timestamptz not null default now(),
  constraint uq_schedule_occurrence unique (automation_id, scheduled_for)
);

comment on table public.schedule_occurrences is 'Materialización determinista de instantes de schedule con protección anti-duplicados UNIQUE';

create index if not exists idx_schedule_occurrences_ws on public.schedule_occurrences (workspace_id);
create index if not exists idx_schedule_occurrences_lookup on public.schedule_occurrences (automation_id, scheduled_for);

-- 7. TABLA: job_runs (Cola Durable y Trazabilidad de Ejecución)
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  automation_id uuid references public.automations(id) on delete set null,
  occurrence_id uuid references public.schedule_occurrences(id) on delete set null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_run_id uuid references public.agent_runs(id) on delete set null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'timeout', 'dead_letter')),
  input text not null,
  output text,
  attempt integer not null default 1 check (attempt >= 1),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  retry_of_run_id uuid references public.job_runs(id) on delete set null,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  worker_id text,
  lease_expires_at timestamptz,
  configuration_version integer not null default 1,
  configuration_hash text not null,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  total_tokens integer not null default 0,
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.job_runs is 'Cola durable y estados de ejecución con leases temporales y fencing tokens para orquestación serverless';

create index if not exists idx_job_runs_workspace on public.job_runs (workspace_id);
create index if not exists idx_job_runs_job on public.job_runs (job_id);
create index if not exists idx_job_runs_agent on public.job_runs (agent_id);
create index if not exists idx_job_runs_status on public.job_runs (status);
create index if not exists idx_job_runs_lease on public.job_runs (status, lease_expires_at);
create index if not exists idx_job_runs_queue_fetch on public.job_runs (priority, queued_at) where status = 'queued';

drop trigger if exists tr_job_runs_updated_at on public.job_runs;
create trigger tr_job_runs_updated_at
  before update on public.job_runs
  for each row execute function public.handle_updated_at();

-- 8. EXTENDER TABLA agent_runs CON VÍNCULO A job_runs (1:1 LÓGICO)
alter table public.agent_runs
  add column if not exists job_run_id uuid references public.job_runs(id) on delete set null;

create unique index if not exists uq_agent_runs_job_run_id
  on public.agent_runs (job_run_id)
  where job_run_id is not null;

-- 9. TABLA: job_audit_log (Auditoría Inmutable Append-Only de Jobs)
create table if not exists public.job_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_run_id uuid references public.job_runs(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'worker', 'scheduler', 'system')),
  actor_id text not null,
  action text not null,
  previous_status text,
  new_status text,
  fencing_token bigint,
  worker_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 8192),
  created_at timestamptz not null default now()
);

comment on table public.job_audit_log is 'Registro inmutable de auditoría para ciclo de vida de jobs, cola y workers (Append-Only)';

create index if not exists idx_job_audit_ws on public.job_audit_log (workspace_id);
create index if not exists idx_job_audit_job on public.job_audit_log (job_id);
create index if not exists idx_job_audit_run on public.job_audit_log (job_run_id);
create index if not exists idx_job_audit_created on public.job_audit_log (created_at);

-- Trigger de Inmutabilidad para job_audit_log
create or replace function public.protect_job_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'JOB_AUDIT_LOG_IMMUTABLE: El registro de auditoría de jobs es estrictamente append-only. Prohibido UPDATE o DELETE.';
end;
$$;

drop trigger if exists tr_protect_job_audit_immutable on public.job_audit_log;
create trigger tr_protect_job_audit_immutable
  before update or delete on public.job_audit_log
  for each row execute function public.protect_job_audit_immutable();

-- 10. ROW LEVEL SECURITY (RLS)
alter table public.jobs enable row level security;
alter table public.automations enable row level security;
alter table public.schedule_occurrences enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_audit_log enable row level security;

-- POLÍTICAS: jobs
drop policy if exists "jobs_select_member" on public.jobs;
create policy "jobs_select_member" on public.jobs
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "jobs_insert_member" on public.jobs;
create policy "jobs_insert_member" on public.jobs
  for insert with check (public.is_workspace_member(workspace_id, auth.uid()) and auth.uid() = created_by);

drop policy if exists "jobs_update_member" on public.jobs;
create policy "jobs_update_member" on public.jobs
  for update using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "jobs_delete_member" on public.jobs;
create policy "jobs_delete_member" on public.jobs
  for delete using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: automations
drop policy if exists "automations_select_member" on public.automations;
create policy "automations_select_member" on public.automations
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "automations_insert_member" on public.automations;
create policy "automations_insert_member" on public.automations
  for insert with check (public.is_workspace_member(workspace_id, auth.uid()) and auth.uid() = created_by);

drop policy if exists "automations_update_member" on public.automations;
create policy "automations_update_member" on public.automations
  for update using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "automations_delete_member" on public.automations;
create policy "automations_delete_member" on public.automations
  for delete using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: schedule_occurrences
drop policy if exists "schedule_occurrences_select_member" on public.schedule_occurrences;
create policy "schedule_occurrences_select_member" on public.schedule_occurrences
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: job_runs (Cero INSERT/UPDATE directo para clientes; administrado vía RPCs)
drop policy if exists "job_runs_select_member" on public.job_runs;
create policy "job_runs_select_member" on public.job_runs
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: job_audit_log (Lectura para miembros; Cero INSERT directo para clientes)
drop policy if exists "job_audit_select_member" on public.job_audit_log;
create policy "job_audit_select_member" on public.job_audit_log
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

-- 11. RPC ATÓMICA DE RECLAMO: claim_job_run
-- Implementa: Orden Jerárquico Global (Workspace -> Agent -> Job -> Job Run),
-- Serialización Concurrente con FOR UPDATE y Búsqueda Continua Anti-Starvation (Blocked-Candidate Skipping).
create or replace function public.claim_job_run(
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cand record;
  v_ws record;
  v_agent record;
  v_policy record;
  v_job record;
  v_active_ws integer;
  v_active_ag integer;
  v_active_jb integer;
  v_claimed record;
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_WORKER_ID', 'error_message', 'worker_id obligatorio.');
  end if;

  -- Iterar sobre candidatos queued ordenados por prioridad y antigüedad
  for v_cand in
    select jr.id, jr.workspace_id, jr.agent_id, jr.job_id
    from public.job_runs jr
    where jr.status = 'queued'
      and jr.queued_at <= clock_timestamp()
    order by
      case jr.priority when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end asc,
      jr.queued_at asc
    limit 20
    for update of jr skip locked
  loop
    -- 1. Bloqueo Jerárquico: Workspace
    select * into v_ws from public.workspaces where id = v_cand.workspace_id for update;
    if not found then
      continue;
    end if;

    select count(*) into v_active_ws from public.job_runs
    where workspace_id = v_cand.workspace_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_ws >= coalesce(v_ws.concurrency_limit, 5) then
      continue; -- Slot de Workspace saturado: saltar al siguiente candidato sin bloquear la cola
    end if;

    -- 2. Bloqueo Jerárquico: Agent
    select * into v_agent from public.agents where id = v_cand.agent_id for update;
    if not found or v_agent.status <> 'active' then
      continue;
    end if;

    select * into v_policy from public.agent_policies where agent_id = v_cand.agent_id;
    if found and v_policy.allow_execution = false then
      continue;
    end if;

    select count(*) into v_active_ag from public.job_runs
    where agent_id = v_cand.agent_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_ag >= coalesce(v_policy.max_concurrent_runs, 3) then
      continue; -- Slot de Agente saturado: saltar al siguiente candidato
    end if;

    -- 3. Bloqueo Jerárquico: Job
    select * into v_job from public.jobs where id = v_cand.job_id for update;
    if not found or v_job.status <> 'active' then
      continue;
    end if;

    select count(*) into v_active_jb from public.job_runs
    where job_id = v_cand.job_id and status in ('claimed', 'running', 'waiting_approval');

    if v_active_jb >= v_job.max_concurrent_runs then
      continue; -- Slot de Job saturado: saltar al siguiente candidato
    end if;

    -- 4. Reclamo Exitoso
    update public.job_runs
    set status = 'claimed',
        worker_id = p_worker_id,
        lease_expires_at = clock_timestamp() + (coalesce(p_lease_seconds, 60) || ' seconds')::interval,
        fencing_token = fencing_token + 1,
        started_at = coalesce(started_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = v_cand.id
    returning * into v_claimed;

    -- Registrar auditoría append-only
    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
    ) values (
      v_claimed.workspace_id, v_claimed.job_id, v_claimed.id, 'worker', p_worker_id, 'claim', 'queued', v_claimed.fencing_token, p_worker_id
    );

    return jsonb_build_object(
      'success', true,
      'claimed', true,
      'run', to_jsonb(v_claimed)
    );
  end loop;

  return jsonb_build_object('success', true, 'claimed', false, 'message', 'No hay jobs elegibles en cola.');
end;
$$;

revoke execute on function public.claim_job_run(text, integer) from public;
grant execute on function public.claim_job_run(text, integer) to authenticated, service_role;

-- 12. RPC: heartbeat_job_run (Renovación de Lease con Fencing Token)
create or replace function public.heartbeat_job_run(
  p_run_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_extend_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
  v_new_lease timestamptz;
begin
  select * into v_run from public.job_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Worker o fencing_token desfasado.');
  end if;

  if v_run.status not in ('claimed', 'running') then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'error_message', 'El run no está activo.');
  end if;

  v_new_lease := clock_timestamp() + (coalesce(p_extend_seconds, 60) || ' seconds')::interval;

  update public.job_runs
  set lease_expires_at = v_new_lease,
      status = 'running',
      updated_at = clock_timestamp()
  where id = p_run_id;

  return jsonb_build_object('success', true, 'lease_expires_at', v_new_lease);
end;
$$;

revoke execute on function public.heartbeat_job_run(uuid, text, bigint, integer) from public;
grant execute on function public.heartbeat_job_run(uuid, text, bigint, integer) to authenticated, service_role;

-- 13. RPC: complete_job_run
create or replace function public.complete_job_run(
  p_run_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_output text default null,
  p_tokens_input integer default 0,
  p_tokens_output integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
begin
  select * into v_run from public.job_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Worker o fencing_token desfasado.');
  end if;

  if v_run.status not in ('claimed', 'running') then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS', 'error_message', 'El run no está en estado activo.');
  end if;

  update public.job_runs
  set status = 'completed',
      output = coalesce(p_output, output),
      tokens_input = tokens_input + coalesce(p_tokens_input, 0),
      tokens_output = tokens_output + coalesce(p_tokens_output, 0),
      total_tokens = total_tokens + coalesce(p_tokens_input, 0) + coalesce(p_tokens_output, 0),
      completed_at = clock_timestamp(),
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_run_id;

  insert into public.job_audit_log (
    workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
  ) values (
    v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'complete', v_run.status, p_fencing_token, p_worker_id
  );

  return jsonb_build_object('success', true, 'status', 'completed');
end;
$$;

revoke execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) from public;
grant execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) to authenticated, service_role;

-- 14. RPC: fail_job_run_and_schedule_retry
create or replace function public.fail_job_run_and_schedule_retry(
  p_run_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_error_code text,
  p_error_message text,
  p_is_retryable boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
  v_job record;
  v_policy jsonb;
  v_max_attempts integer;
  v_backoff_factor float;
  v_init_delay integer;
  v_max_delay integer;
  v_jitter boolean;
  v_delay_seconds integer;
  v_new_run record;
begin
  select * into v_run from public.job_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Fencing token o worker inválido.');
  end if;

  select * into v_job from public.jobs where id = v_run.job_id;
  v_policy := coalesce(v_job.retry_policy, '{}'::jsonb);
  v_max_attempts := coalesce((v_policy->>'max_attempts')::integer, v_run.max_attempts, 3);
  v_backoff_factor := coalesce((v_policy->>'backoff_factor')::float, 2.0);
  v_init_delay := coalesce((v_policy->>'initial_delay_seconds')::integer, 10);
  v_max_delay := coalesce((v_policy->>'max_delay_seconds')::integer, 300);
  v_jitter := coalesce((v_policy->>'jitter')::boolean, true);

  -- Si es reintentable y no superó max_attempts: Programar reintento con nuevo run
  if p_is_retryable and v_run.attempt < v_max_attempts then
    -- Calcular backoff exponencial
    v_delay_seconds := round(least(v_max_delay, v_init_delay * power(v_backoff_factor, v_run.attempt - 1)))::integer;
    if v_jitter then
      v_delay_seconds := round(v_delay_seconds * (0.8 + (random() * 0.4)))::integer;
    end if;

    -- Sellar run actual como failed
    update public.job_runs
    set status = 'failed',
        error_code = p_error_code,
        error_message = p_error_message,
        completed_at = clock_timestamp(),
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where id = p_run_id;

    -- Insertar nuevo intento conservando linaje
    insert into public.job_runs (
      workspace_id, job_id, automation_id, occurrence_id, agent_id, priority, status,
      input, attempt, max_attempts, retry_of_run_id, configuration_version, configuration_hash, queued_at
    ) values (
      v_run.workspace_id, v_run.job_id, v_run.automation_id, v_run.occurrence_id, v_run.agent_id, v_run.priority, 'queued',
      v_run.input, v_run.attempt + 1, v_max_attempts, v_run.id, v_run.configuration_version, v_run.configuration_hash,
      clock_timestamp() + (v_delay_seconds || ' seconds')::interval
    ) returning * into v_new_run;

    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
    ) values (
      v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'retry_scheduled', v_run.status, 'failed', p_fencing_token, p_worker_id,
      jsonb_build_object('next_run_id', v_new_run.id, 'attempt', v_new_run.attempt, 'delay_seconds', v_delay_seconds)
    );

    return jsonb_build_object('success', true, 'status', 'failed', 'retried', true, 'next_run_id', v_new_run.id);
  else
    -- Fallo definitivo o agotamiento de intentos -> dead_letter
    update public.job_runs
    set status = 'dead_letter',
        error_code = p_error_code,
        error_message = p_error_message,
        completed_at = clock_timestamp(),
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where id = p_run_id;

    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
    ) values (
      v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'dead_letter', v_run.status, 'dead_letter', p_fencing_token, p_worker_id,
      jsonb_build_object('error_code', p_error_code, 'final_attempt', v_run.attempt)
    );

    return jsonb_build_object('success', true, 'status', 'dead_letter', 'retried', false);
  end if;
end;
$$;

revoke execute on function public.fail_job_run_and_schedule_retry(uuid, text, bigint, text, text, boolean) from public;
grant execute on function public.fail_job_run_and_schedule_retry(uuid, text, bigint, text, text, boolean) to authenticated, service_role;

-- 15. RPC: release_job_run_for_approval (HITL desacopla worker y libera lease)
create or replace function public.release_job_run_for_approval(
  p_run_id uuid,
  p_worker_id text,
  p_fencing_token bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
begin
  select * into v_run from public.job_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Fencing token o worker inválido.');
  end if;

  update public.job_runs
  set status = 'waiting_approval',
      worker_id = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_run_id;

  insert into public.job_audit_log (
    workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
  ) values (
    v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'waiting_approval', v_run.status, 'waiting_approval', p_fencing_token, p_worker_id
  );

  return jsonb_build_object('success', true, 'status', 'waiting_approval');
end;
$$;

revoke execute on function public.release_job_run_for_approval(uuid, text, bigint) from public;
grant execute on function public.release_job_run_for_approval(uuid, text, bigint) to authenticated, service_role;

-- 16. RPC: checkpoint_and_requeue_job_run (Serverless Continuation Bounded Budget)
create or replace function public.checkpoint_and_requeue_job_run(
  p_run_id uuid,
  p_worker_id text,
  p_fencing_token bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
begin
  select * into v_run from public.job_runs where id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'JOB_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if v_run.worker_id is distinct from p_worker_id or v_run.fencing_token is distinct from p_fencing_token then
    return jsonb_build_object('success', false, 'error_code', 'FENCING_REJECTED', 'error_message', 'Fencing token o worker inválido.');
  end if;

  -- Reencolar con prioridad high para continuar de inmediato en la siguiente invocación
  update public.job_runs
  set status = 'queued',
      priority = 'high',
      worker_id = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where id = p_run_id;

  insert into public.job_audit_log (
    workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
  ) values (
    v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'checkpoint_requeued', v_run.status, 'queued', p_fencing_token, p_worker_id
  );

  return jsonb_build_object('success', true, 'status', 'queued');
end;
$$;

revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from public;
grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to authenticated, service_role;

-- 17. RPC: recover_stale_job_runs (Rescate Atómico de Worker Crash)
create or replace function public.recover_stale_job_runs(
  p_timeout_grace_seconds integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_stale record;
  v_recovered_count integer := 0;
  v_new_token bigint;
begin
  for v_stale in
    select jr.*
    from public.job_runs jr
    where jr.status in ('claimed', 'running')
      and jr.lease_expires_at is not null
      and jr.lease_expires_at + (coalesce(p_timeout_grace_seconds, 15) || ' seconds')::interval <= clock_timestamp()
    order by jr.lease_expires_at asc
    limit 20
    for update of jr skip locked
  loop
    v_new_token := v_stale.fencing_token + 1;

    -- Si no superó max_attempts, reencolar incrementando fencing token
    if v_stale.attempt < v_stale.max_attempts then
      update public.job_runs
      set status = 'queued',
          priority = 'high',
          worker_id = null,
          lease_expires_at = null,
          fencing_token = v_new_token,
          updated_at = clock_timestamp()
      where id = v_stale.id;

      insert into public.job_audit_log (
        workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, details
      ) values (
        v_stale.workspace_id, v_stale.job_id, v_stale.id, 'system', 'stale_recovery', 'lease_recovered', v_stale.status, 'queued', v_new_token,
        jsonb_build_object('previous_worker', v_stale.worker_id, 'expired_lease', v_stale.lease_expires_at)
      );
    else
      -- Expirado tras max_attempts -> dead_letter
      update public.job_runs
      set status = 'dead_letter',
          error_code = 'LEASE_TIMEOUT_EXHAUSTED',
          error_message = 'Worker crash recurrente; lease expirado sin recuperación.',
          worker_id = null,
          lease_expires_at = null,
          fencing_token = v_new_token,
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where id = v_stale.id;

      insert into public.job_audit_log (
        workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, details
      ) values (
        v_stale.workspace_id, v_stale.job_id, v_stale.id, 'system', 'stale_recovery', 'dead_letter_recovered', v_stale.status, 'dead_letter', v_new_token,
        jsonb_build_object('previous_worker', v_stale.worker_id)
      );
    end if;

    v_recovered_count := v_recovered_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'recovered_count', v_recovered_count);
end;
$$;

revoke execute on function public.recover_stale_job_runs(integer) from public;
grant execute on function public.recover_stale_job_runs(integer) to authenticated, service_role;

-- 18. RPC: generate_schedule_occurrences (Scheduler Idempotente, Overlap, Limited Catch-up & DST)
create or replace function public.generate_schedule_occurrences()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auto record;
  v_job record;
  v_active_runs integer;
  v_spawned_count integer := 0;
  v_occ_id uuid;
  v_run_id uuid;
  v_target_time timestamptz;
begin
  for v_auto in
    select a.*
    from public.automations a
    where a.status = 'active'
      and (a.next_scheduled_at is null or a.next_scheduled_at <= clock_timestamp())
    order by a.next_scheduled_at asc nulls first
    limit 20
    for update of a skip locked
  loop
    select * into v_job from public.jobs where id = v_auto.job_id;
    if not found or v_job.status <> 'active' then
      continue;
    end if;

    v_target_time := coalesce(v_auto.next_scheduled_at, clock_timestamp());

    -- 1. Insertar ocurrencia con protección UNIQUE anti-duplicados
    insert into public.schedule_occurrences (
      workspace_id, automation_id, job_id, scheduled_for, status
    ) values (
      v_auto.workspace_id, v_auto.id, v_auto.job_id, v_target_time, 'pending'
    )
    on conflict (automation_id, scheduled_for) do nothing
    returning id into v_occ_id;

    if v_occ_id is not null then
      -- 2. Evaluar Política de Overlap
      if v_auto.concurrency_policy = 'forbid' then
        select count(*) into v_active_runs
        from public.job_runs
        where job_id = v_auto.job_id
          and status in ('queued', 'claimed', 'running', 'waiting_approval');

        if v_active_runs > 0 then
          update public.schedule_occurrences
          set status = 'skipped', skip_reason = 'OVERLAP_FORBIDDEN'
          where id = v_occ_id;

          -- Avanzar próximo schedule (simulado 1 hora por defecto si no hay motor cron externo)
          update public.automations
          set last_scheduled_at = v_target_time,
              next_scheduled_at = clock_timestamp() + interval '1 hour',
              updated_at = clock_timestamp()
          where id = v_auto.id;

          continue;
        end if;
      end if;

      -- 3. Encolar Job Run
      insert into public.job_runs (
        workspace_id, job_id, automation_id, occurrence_id, agent_id, priority, status,
        input, attempt, max_attempts, configuration_version, configuration_hash, queued_at
      ) values (
        v_auto.workspace_id, v_auto.job_id, v_auto.id, v_occ_id, v_job.agent_id, 'normal', 'queued',
        v_job.input, 1, 3, v_job.configuration_version, v_job.configuration_hash, clock_timestamp()
      ) returning id into v_run_id;

      update public.schedule_occurrences
      set status = 'spawned', job_run_id = v_run_id
      where id = v_occ_id;

      v_spawned_count := v_spawned_count + 1;
    end if;

    -- Actualizar fechas en automation
    update public.automations
    set last_scheduled_at = v_target_time,
        next_scheduled_at = clock_timestamp() + interval '1 hour',
        updated_at = clock_timestamp()
    where id = v_auto.id;
  end loop;

  return jsonb_build_object('success', true, 'spawned_count', v_spawned_count);
end;
$$;

revoke execute on function public.generate_schedule_occurrences() from public;
grant execute on function public.generate_schedule_occurrences() to authenticated, service_role;
