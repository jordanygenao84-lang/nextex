-- ============================================================================
-- NEXTEХ — FASE 4.7.1 MIGRATION: INTEGRATIONS & EXTERNAL EVENT ENGINE
-- Arquitectura Cerrada de Ingestión Segura, Cifrado AES-256-GCM con AAD,
-- Integridad Física por FKs Compuestas, Máquina de Estados Blindada por Triggers,
-- Mapeo Server-Side a Jobs Durables, Transacciones Atómicas y Auditoría Inmutable
-- ============================================================================

-- 1. EXTENDER CATEGORÍAS DE PERMISOS E INSERTAR 11 PERMISOS CANÓNICOS
alter table public.permissions drop constraint if exists permissions_category_check;
alter table public.permissions add constraint permissions_category_check
  check (category in ('agents', 'runs', 'tools', 'approvals', 'workspace', 'memory', 'jobs', 'automations', 'integrations', 'integration_events'));

insert into public.permissions (id, key, category, description)
values
  ('integrations.read', 'integrations.read', 'integrations', 'Visualizar integraciones y endpoints en el workspace'),
  ('integrations.create', 'integrations.create', 'integrations', 'Configurar y registrar nuevas integraciones'),
  ('integrations.update', 'integrations.update', 'integrations', 'Modificar nombres, configs y endpoints de integración'),
  ('integrations.delete', 'integrations.delete', 'integrations', 'Eliminar integraciones del workspace'),
  ('integrations.activate', 'integrations.activate', 'integrations', 'Activar integraciones para permitir recepción de eventos'),
  ('integrations.pause', 'integrations.pause', 'integrations', 'Pausar integraciones suspendiendo el encolamiento de jobs'),
  ('integrations.revoke', 'integrations.revoke', 'integrations', 'Revocar credenciales y endpoints de una integración'),
  ('integration_events.read', 'integration_events.read', 'integration_events', 'Consultar historial, metadatos y estado de eventos recibidos'),
  ('integration_events.retry', 'integration_events.retry', 'integration_events', 'Reintentar manualmente el despacho de eventos fallidos (status=failed)'),
  ('integration_events.quarantine', 'integration_events.quarantine', 'integration_events', 'Enviar eventos sospechosos o anómalos a cuarentena'),
  ('integration_events.reprocess', 'integration_events.reprocess', 'integration_events', 'Reprocesar eventos válidos sin ejecución previa (status in received, verified)')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 2. ACTUALIZACIÓN DE LA MATRIZ DE ROLES (OWNER=52, ADMIN=49, MEMBER=16)
-- OWNER: 52 permisos canónicos completos
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 49 permisos canónicos (excluye destructivos de tools y settings globales)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- MEMBER: 16 permisos canónicos
insert into public.role_permissions (role, permission_key)
values
  ('member', 'integrations.read'),
  ('member', 'integration_events.read')
on conflict (role, permission_key) do nothing;

-- 3. EXTENDER JOBS (ADITIVO Y BACKWARD-COMPATIBLE)
alter table public.jobs drop constraint if exists jobs_trigger_type_check;
alter table public.jobs add constraint jobs_trigger_type_check
  check (trigger_type in ('manual', 'scheduled', 'webhook'));

-- 4. TABLA: integrations
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  provider text not null check (char_length(trim(provider)) between 1 and 50),
  integration_type text not null default 'inbound_webhook' check (integration_type in ('inbound_webhook')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'revoked', 'archived')),
  config jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.integrations drop constraint if exists uq_integrations_id_ws;
alter table public.integrations add constraint uq_integrations_id_ws unique (id, workspace_id);

create index if not exists idx_integrations_workspace_status on public.integrations (workspace_id, status);

drop trigger if exists trg_integrations_updated_at on public.integrations;
create trigger trg_integrations_updated_at
  before update on public.integrations
  for each row execute function public.handle_updated_at();

-- 5. TABLA: integration_endpoints
create table if not exists public.integration_endpoints (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null,
  workspace_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 100),
  endpoint_key text unique not null check (char_length(endpoint_key) = 64),
  event_types jsonb not null default '{}'::jsonb,
  verification_method text not null default 'hmac_sha256' check (verification_method in ('hmac_sha256')),
  secret_reference text not null check (char_length(secret_reference) between 10 and 64),
  encrypted_secret text not null,
  encryption_iv text not null check (char_length(encryption_iv) = 24), -- 12 bytes hex
  encryption_auth_tag text not null check (char_length(encryption_auth_tag) = 32), -- 16 bytes hex
  secondary_encrypted_secret text,
  secondary_encryption_iv text check (secondary_encryption_iv is null or char_length(secondary_encryption_iv) = 24),
  secondary_encryption_auth_tag text check (secondary_encryption_auth_tag is null or char_length(secondary_encryption_auth_tag) = 32),
  secondary_secret_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled')),
  replay_window_seconds integer not null default 300 check (replay_window_seconds between 30 and 3600),
  max_payload_bytes integer not null default 262144 check (max_payload_bytes between 1024 and 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_endpoints_integration_ws foreign key (integration_id, workspace_id)
    references public.integrations(id, workspace_id) on delete cascade,
  constraint uq_endpoints_id_int_ws unique (id, integration_id, workspace_id),
  constraint chk_secondary_secret_coherence check (
    (secondary_encrypted_secret is null and secondary_encryption_iv is null and secondary_encryption_auth_tag is null and secondary_secret_expires_at is null)
    or
    (secondary_encrypted_secret is not null and secondary_encryption_iv is not null and secondary_encryption_auth_tag is not null and secondary_secret_expires_at is not null)
  )
);

create index if not exists idx_integration_endpoints_key on public.integration_endpoints (endpoint_key);
create index if not exists idx_integration_endpoints_ws on public.integration_endpoints (workspace_id);

drop trigger if exists trg_integration_endpoints_updated_at on public.integration_endpoints;
create trigger trg_integration_endpoints_updated_at
  before update on public.integration_endpoints
  for each row execute function public.handle_updated_at();

-- 6. TABLA: integration_events
create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  integration_id uuid not null,
  endpoint_id uuid not null,
  external_event_id text not null check (char_length(trim(external_event_id)) between 1 and 255),
  event_type text not null check (char_length(trim(event_type)) between 1 and 100),
  provider text not null check (char_length(trim(provider)) between 1 and 50),
  payload jsonb not null default '{}'::jsonb,
  headers_metadata jsonb not null default '{}'::jsonb,
  payload_hash text not null check (char_length(payload_hash) = 64),
  signature_verified boolean not null default false,
  status text not null default 'received' check (status in ('received', 'verified', 'rejected', 'queued', 'processing', 'completed', 'failed', 'duplicate', 'quarantined')),
  job_id uuid references public.jobs(id) on delete set null,
  job_run_id uuid, -- Referencia al Job Run más reciente/actual
  quarantine_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fk_events_endpoint_integration_ws foreign key (endpoint_id, integration_id, workspace_id)
    references public.integration_endpoints(id, integration_id, workspace_id) on delete restrict,
  constraint uq_integration_events_delivery unique (workspace_id, integration_id, external_event_id)
);

create index if not exists idx_integration_events_lookup on public.integration_events (workspace_id, integration_id, external_event_id);
create index if not exists idx_integration_events_status on public.integration_events (status, received_at);
create index if not exists idx_integration_events_job_run on public.integration_events (job_run_id) where job_run_id is not null;

drop trigger if exists trg_integration_events_updated_at on public.integration_events;
create trigger trg_integration_events_updated_at
  before update on public.integration_events
  for each row execute function public.handle_updated_at();

-- Extensión a job_runs vinculando integration_events(id)
alter table public.job_runs
  add column if not exists event_id uuid references public.integration_events(id) on delete set null;

create index if not exists idx_job_runs_event_id on public.job_runs (event_id) where event_id is not null;

-- Añadir FK diferida desde integration_events.job_run_id a job_runs(id)
alter table public.integration_events drop constraint if exists fk_events_job_run_id;
alter table public.integration_events add constraint fk_events_job_run_id
  foreign key (job_run_id) references public.job_runs(id) on delete set null;

-- GAP-002: Integridad Física Compuesta de Workspace entre agent_runs y job_runs
alter table public.job_runs drop constraint if exists uq_job_runs_id_ws;
alter table public.job_runs add constraint uq_job_runs_id_ws unique (id, workspace_id);

alter table public.agent_runs drop constraint if exists fk_agent_runs_job_run_ws;
alter table public.agent_runs add constraint fk_agent_runs_job_run_ws
  foreign key (job_run_id, workspace_id)
  references public.job_runs (id, workspace_id)
  on delete set null (job_run_id);

-- Documentación canónica de columna legacy/dead (PARTE 10)
comment on column public.job_runs.agent_run_id is 'LEGACY / UNUSED (Fase 4.6). La relación canónica unidireccional activa es agent_runs.job_run_id = job_runs.id.';

-- 7. TABLA: integration_event_attempts (Historial completo de ejecuciones y reintentos)
create table if not exists public.integration_event_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.integration_events(id) on delete cascade,
  attempt integer not null default 1 check (attempt >= 1),
  job_run_id uuid references public.job_runs(id) on delete set null,
  status text not null check (status in ('started', 'succeeded', 'failed', 'skipped')),
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint uq_event_attempts_attempt unique (event_id, attempt)
);

create index if not exists idx_event_attempts_event on public.integration_event_attempts (event_id, attempt);

-- 8. TABLA: integration_event_audit_log (Append-Only Inmutable)
create table if not exists public.integration_event_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id uuid references public.integration_events(id) on delete set null,
  operation text not null check (char_length(trim(operation)) between 1 and 100),
  actor_type text not null check (actor_type in ('system', 'gateway', 'user', 'worker')),
  actor_id text not null check (char_length(trim(actor_id)) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_integration_audit_ws_created on public.integration_event_audit_log (workspace_id, created_at desc);

-- Trigger de Inmutabilidad en integration_event_audit_log
create or replace function public.protect_integration_audit_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'INTEGRATION_AUDIT_LOG_IMMUTABLE: No está permitido modificar ni eliminar registros de auditoría de integraciones.'
    using errcode = '55000';
end;
$$;

drop trigger if exists trg_protect_integration_audit_immutable on public.integration_event_audit_log;
create trigger trg_protect_integration_audit_immutable
  before update or delete on public.integration_event_audit_log
  for each row execute function public.protect_integration_audit_immutable();

-- 9. HELPER DE AUTORIZACIÓN SQL: public.has_permission
create or replace function public.has_permission(
  p_user_id uuid,
  p_workspace_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text;
  v_override text;
begin
  if p_user_id is null or p_workspace_id is null or p_permission_key is null then
    return false;
  end if;

  -- 1. Explicit Override en workspace_permissions
  select effect into v_override
  from public.workspace_permissions
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and permission_key = p_permission_key;

  if v_override = 'deny' then
    return false;
  elsif v_override = 'allow' then
    return true;
  end if;

  -- 2. Resolver Rol del Miembro
  select role into v_role
  from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  if v_role is null then
    return false;
  end if;

  -- 3. Matriz Base en role_permissions
  return exists (
    select 1
    from public.role_permissions
    where role = v_role
      and permission_key = p_permission_key
  );
end;
$$;

-- 10. TRIGGER BEFORE UPDATE: MÁQUINA DE ESTADOS ESTRICTA EN integration_events
create or replace function public.validate_event_state_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Si el estado no cambia, permitir la actualización de campos no inmutables
  if old.status = new.status then
    return new;
  end if;

  -- 1. Estados Terminales: 'completed', 'quarantined', 'duplicate'
  if old.status in ('completed', 'quarantined', 'duplicate') then
    raise exception 'INVALID_STATE_TRANSITION: El evento se encuentra en estado terminal "%" y no admite transiciones.', old.status
      using errcode = '22000';
  end if;

  -- 2. Validar Transiciones Permitidas
  if old.status = 'received' and new.status not in ('verified', 'queued', 'quarantined', 'failed') then
    raise exception 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  elsif old.status = 'verified' and new.status not in ('queued') then
    raise exception 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  elsif old.status = 'queued' and new.status not in ('processing', 'failed') then
    raise exception 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  elsif old.status = 'processing' and new.status not in ('completed', 'failed') then
    raise exception 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  elsif old.status = 'failed' and new.status not in ('queued') then
    raise exception 'INVALID_STATE_TRANSITION: Transición no permitida de "%" a "%". Solo se permite failed -> queued vía retry.', old.status, new.status
      using errcode = '22000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_event_state_transition on public.integration_events;
create trigger trg_validate_event_state_transition
  before update on public.integration_events
  for each row execute function public.validate_event_state_transition();

-- 11. TRIGGER BEFORE UPDATE: INMUTABILIDAD DE CAMPOS FUNDACIONALES
create or replace function public.protect_event_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.workspace_id is distinct from new.workspace_id then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: workspace_id no puede ser modificado una vez insertado.' using errcode = '22000';
  end if;

  if old.integration_id is distinct from new.integration_id then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: integration_id no puede ser modificado una vez insertado.' using errcode = '22000';
  end if;

  if old.endpoint_id is distinct from new.endpoint_id then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: endpoint_id no puede ser modificado una vez insertado.' using errcode = '22000';
  end if;

  if old.external_event_id is distinct from new.external_event_id then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: external_event_id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.payload_hash is distinct from new.payload_hash then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: payload_hash es inmutable.' using errcode = '22000';
  end if;

  if old.signature_verified is distinct from new.signature_verified then
    raise exception 'IMMUTABLE_FIELD_MODIFIED: signature_verified no puede ser alterado tras la ingestión.' using errcode = '22000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_event_immutable_fields on public.integration_events;
create trigger trg_protect_event_immutable_fields
  before update on public.integration_events
  for each row execute function public.protect_event_immutable_fields();

-- 12. TRIGGER AFTER UPDATE EN job_runs: SINCRONIZACIÓN ATÓMICA DE ESTADO Y ATTEMPTS
create or replace function public.sync_job_run_status_to_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_current_event_status text;
  v_resolved_agent_run_id uuid;
  v_agent_run_status text;
  v_has_pending_steps boolean;
  v_has_pending_approvals boolean;
begin
  if new.event_id is not null and (old.status is distinct from new.status) then
    select status into v_current_event_status
    from public.integration_events
    where id = new.event_id;

    if not found then
      return new;
    end if;

    -- Regla 1: running o waiting_approval mueven queued -> processing
    if new.status in ('running', 'waiting_approval') then
      if v_current_event_status = 'queued' then
        update public.integration_events
        set status = 'processing', updated_at = now()
        where id = new.event_id;
      end if;

      -- Sincronizar attempt a 'started' si corresponde
      update public.integration_event_attempts
      set status = 'started'
      where event_id = new.event_id and job_run_id = new.id and status = 'started';

    -- Regla 2: completed solo puede ocurrir desde processing con validación estricta de agente y pasos
    elsif new.status = 'completed' then
      -- BARRERA DE COMPLETION: Verificar AgentRun y Steps asociados (FINDING-008 REMEDIADA)
      -- 1. Resolución canónica de AgentRun primario: agent_runs.job_run_id = new.id (Fase 4.6)
      v_resolved_agent_run_id := null;
      v_agent_run_status := null;

      select ar.id, ar.status into v_resolved_agent_run_id, v_agent_run_status
      from public.agent_runs ar
      where ar.job_run_id = new.id
        and ar.workspace_id = new.workspace_id;

      -- 2. Fallback de compatibilidad si no se encontró por job_run_id pero new.agent_run_id está presente
      if v_resolved_agent_run_id is null and new.agent_run_id is not null then
        select ar.id, ar.status into v_resolved_agent_run_id, v_agent_run_status
        from public.agent_runs ar
        where ar.id = new.agent_run_id
          and ar.workspace_id = new.workspace_id
          and (ar.job_run_id is null or ar.job_run_id = new.id);
      elsif v_resolved_agent_run_id is not null and new.agent_run_id is not null and new.agent_run_id <> v_resolved_agent_run_id then
        raise exception 'AGENT_RUN_LINEAGE_MISMATCH: new.agent_run_id (%) no coincide con agent_runs.job_run_id (%)',
          new.agent_run_id, v_resolved_agent_run_id using errcode = '22000';
      end if;

      if v_resolved_agent_run_id is not null then
        -- Verificar si existen pasos pendientes en agent_run_steps
        select exists (
          select 1 from public.agent_run_steps
          where run_id = v_resolved_agent_run_id
            and status in ('pending', 'running')
        ) into v_has_pending_steps;

        -- Verificar si existen aprobaciones pendientes en approval_requests
        select exists (
          select 1 from public.approval_requests
          where run_id = v_resolved_agent_run_id
            and status = 'pending'
        ) into v_has_pending_approvals;
      else
        v_agent_run_status := 'missing';
        v_has_pending_steps := false;
        v_has_pending_approvals := false;
      end if;

      -- El evento solo se sella como completed si el AgentRun está completed y no hay pasos ni aprobaciones pendientes
      if v_current_event_status = 'processing'
         and v_agent_run_status = 'completed'
         and not v_has_pending_steps
         and not v_has_pending_approvals then
        update public.integration_events
        set status = 'completed', processed_at = now(), updated_at = now()
        where id = new.event_id;

        -- Actualizar attempt correspondiente a succeeded
        update public.integration_event_attempts
        set status = 'succeeded', completed_at = now()
        where event_id = new.event_id and job_run_id = new.id;

        insert into public.integration_event_audit_log (
          workspace_id, event_id, operation, actor_type, actor_id, metadata
        ) values (
          new.workspace_id, new.event_id, 'event.completed',
          'worker', coalesce(new.worker_id, 'system'),
          jsonb_build_object('job_run_id', new.id, 'agent_run_id', v_resolved_agent_run_id)
        );
      else
        -- Si hay pasos o aprobaciones pendientes o agent_run no completado, mantener en processing
        if v_current_event_status = 'queued' then
          update public.integration_events
          set status = 'processing', updated_at = now()
          where id = new.event_id;
        end if;
      end if;

    -- Regla 3: failed, dead_letter, cancelled o timeout mueven queued o processing -> failed
    elsif new.status in ('failed', 'dead_letter', 'cancelled', 'timeout') then
      if v_current_event_status in ('queued', 'processing') then
        update public.integration_events
        set status = 'failed', processed_at = now(),
            quarantine_reason = coalesce(new.error_code, new.status),
            updated_at = now()
        where id = new.event_id;

        -- Actualizar attempt correspondiente a failed
        update public.integration_event_attempts
        set status = 'failed', completed_at = now(), error_code = coalesce(new.error_code, new.status)
        where event_id = new.event_id and job_run_id = new.id;

        insert into public.integration_event_audit_log (
          workspace_id, event_id, operation, actor_type, actor_id, metadata
        ) values (
          new.workspace_id, new.event_id, 'event.failed',
          'worker', coalesce(new.worker_id, 'system'),
          jsonb_build_object('job_run_id', new.id, 'error_code', new.error_code, 'final_job_status', new.status)
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_job_run_status_to_event on public.job_runs;
create trigger trg_sync_job_run_status_to_event
  after update of status on public.job_runs
  for each row execute function public.sync_job_run_status_to_event();

-- 13. HABILITACIÓN DE ROW LEVEL SECURITY (RLS)
alter table public.integrations enable row level security;
alter table public.integration_endpoints enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_event_attempts enable row level security;
alter table public.integration_event_audit_log enable row level security;

-- Políticas: integrations
drop policy if exists integrations_select on public.integrations;
create policy integrations_select on public.integrations
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integrations.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integrations_insert on public.integrations;
create policy integrations_insert on public.integrations
  for insert to authenticated
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integrations.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integrations_update on public.integrations;
create policy integrations_update on public.integrations
  for update to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integrations.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integrations_delete on public.integrations;
create policy integrations_delete on public.integrations
  for delete to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integrations.workspace_id
      and wm.user_id = auth.uid()
  ));

-- Políticas: integration_endpoints
drop policy if exists integration_endpoints_select on public.integration_endpoints;
create policy integration_endpoints_select on public.integration_endpoints
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_endpoints.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integration_endpoints_insert on public.integration_endpoints;
create policy integration_endpoints_insert on public.integration_endpoints
  for insert to authenticated
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_endpoints.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integration_endpoints_update on public.integration_endpoints;
create policy integration_endpoints_update on public.integration_endpoints
  for update to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_endpoints.workspace_id
      and wm.user_id = auth.uid()
  ));

drop policy if exists integration_endpoints_delete on public.integration_endpoints;
create policy integration_endpoints_delete on public.integration_endpoints
  for delete to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_endpoints.workspace_id
      and wm.user_id = auth.uid()
  ));

-- Políticas: integration_events
drop policy if exists integration_events_select on public.integration_events;
create policy integration_events_select on public.integration_events
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_events.workspace_id
      and wm.user_id = auth.uid()
  ));

-- Bloqueo de mutaciones directas de clientes en integration_events (solo vía RPC service_role)
drop policy if exists integration_events_insert_deny on public.integration_events;
create policy integration_events_insert_deny on public.integration_events
  for insert to authenticated with check (false);

drop policy if exists integration_events_update_deny on public.integration_events;
create policy integration_events_update_deny on public.integration_events
  for update to authenticated using (false);

drop policy if exists integration_events_delete_deny on public.integration_events;
create policy integration_events_delete_deny on public.integration_events
  for delete to authenticated using (false);

-- Políticas: integration_event_attempts
drop policy if exists event_attempts_select on public.integration_event_attempts;
create policy event_attempts_select on public.integration_event_attempts
  for select to authenticated
  using (exists (
    select 1 from public.integration_events ie
    join public.workspace_members wm on wm.workspace_id = ie.workspace_id
    where ie.id = integration_event_attempts.event_id
      and wm.user_id = auth.uid()
  ));

-- Políticas: integration_event_audit_log
drop policy if exists integration_audit_select on public.integration_event_audit_log;
create policy integration_audit_select on public.integration_event_audit_log
  for select to authenticated
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = integration_event_audit_log.workspace_id
      and wm.user_id = auth.uid()
  ));

-- 14. RPC: ingest_integration_event_atomic (SERVICE_ROLE ONLY, SIN p_signature_verified)
create or replace function public.ingest_integration_event_atomic(
  p_endpoint_key text,
  p_external_event_id text,
  p_event_type text,
  p_provider text,
  p_payload jsonb,
  p_headers_metadata jsonb,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_endpoint record;
  v_integration record;
  v_job record;
  v_existing_event record;
  v_event_id uuid;
  v_job_id uuid;
  v_job_id_text text;
  v_job_run_id uuid;
begin
  -- 1. Resolver y bloquear endpoint e integración
  select * into v_endpoint
  from public.integration_endpoints
  where endpoint_key = p_endpoint_key
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'error_code', 'ENDPOINT_NOT_FOUND',
      'message', 'Endpoint no encontrado o inválido.'
    );
  end if;

  if v_endpoint.status <> 'active' then
    return jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'error_code', 'ENDPOINT_DISABLED',
      'message', 'El endpoint de integración se encuentra deshabilitado.'
    );
  end if;

  select * into v_integration
  from public.integrations
  where id = v_endpoint.integration_id
  for share;

  if not found or v_integration.status in ('revoked', 'archived') then
    return jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'error_code', 'INTEGRATION_REVOKED',
      'message', 'La integración asociada ha sido revocada o archivada.'
    );
  end if;

  -- 2. Manejo de Integración Pausada: se acepta pero no se despacha JobRun
  if v_integration.status = 'paused' then
    insert into public.integration_events (
      workspace_id, integration_id, endpoint_id,
      external_event_id, event_type, provider,
      payload, headers_metadata, payload_hash,
      signature_verified, status
    ) values (
      v_endpoint.workspace_id, v_endpoint.integration_id, v_endpoint.id,
      p_external_event_id, p_event_type, p_provider,
      coalesce(p_payload, '{}'::jsonb), coalesce(p_headers_metadata, '{}'::jsonb),
      p_payload_hash, true, 'received'
    )
    on conflict (workspace_id, integration_id, external_event_id) do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select id, job_run_id, payload_hash into v_existing_event
      from public.integration_events
      where workspace_id = v_endpoint.workspace_id
        and integration_id = v_endpoint.integration_id
        and external_event_id = p_external_event_id;

      if v_existing_event.payload_hash <> p_payload_hash then
        insert into public.integration_event_audit_log (
          workspace_id, event_id, operation, actor_type, actor_id, metadata
        ) values (
          v_endpoint.workspace_id, v_existing_event.id, 'event.duplicate_payload_conflict',
          'gateway', v_endpoint.id::text,
          jsonb_build_object('external_event_id', p_external_event_id)
        );

        return jsonb_build_object(
          'success', false,
          'status', 'duplicate_conflict',
          'error_code', 'DUPLICATE_PAYLOAD_MISMATCH',
          'event_id', v_existing_event.id,
          'message', 'Conflicto: Event ID duplicado con carga útil diferente.'
        );
      end if;

      return jsonb_build_object(
        'success', true,
        'status', 'duplicate',
        'event_id', v_existing_event.id,
        'job_run_id', v_existing_event.job_run_id,
        'message', 'Evento duplicado recibido e ignorado de forma idempotente.'
      );
    end if;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.received_paused',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('event_type', p_event_type, 'warning', 'INTEGRATION_PAUSED')
    );

    return jsonb_build_object(
      'success', true,
      'status', 'received',
      'event_id', v_event_id,
      'job_run_id', null,
      'message', 'Evento recibido pero no encolado porque la integración está pausada.'
    );
  end if;

  -- 3. Inserción con detección de colisión/idempotencia atómica
  insert into public.integration_events (
    workspace_id, integration_id, endpoint_id,
    external_event_id, event_type, provider,
    payload, headers_metadata, payload_hash,
    signature_verified, status
  ) values (
    v_endpoint.workspace_id, v_endpoint.integration_id, v_endpoint.id,
    p_external_event_id, p_event_type, p_provider,
    coalesce(p_payload, '{}'::jsonb), coalesce(p_headers_metadata, '{}'::jsonb),
    p_payload_hash, true, 'received'
  )
  on conflict (workspace_id, integration_id, external_event_id) do nothing
  returning id into v_event_id;

  -- Si colisionó (evento duplicado o conflicto de payload)
  if v_event_id is null then
    select id, job_run_id, payload_hash into v_existing_event
    from public.integration_events
    where workspace_id = v_endpoint.workspace_id
      and integration_id = v_endpoint.integration_id
      and external_event_id = p_external_event_id;

    if v_existing_event.payload_hash <> p_payload_hash then
      insert into public.integration_event_audit_log (
        workspace_id, event_id, operation, actor_type, actor_id, metadata
      ) values (
        v_endpoint.workspace_id, v_existing_event.id, 'event.duplicate_payload_conflict',
        'gateway', v_endpoint.id::text,
        jsonb_build_object('external_event_id', p_external_event_id)
      );

      return jsonb_build_object(
        'success', false,
        'status', 'duplicate_conflict',
        'error_code', 'DUPLICATE_PAYLOAD_MISMATCH',
        'event_id', v_existing_event.id,
        'message', 'Conflicto: Event ID duplicado con carga útil diferente.'
      );
    end if;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_existing_event.id, 'event.duplicate',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('external_event_id', p_external_event_id)
    );

    return jsonb_build_object(
      'success', true,
      'status', 'duplicate',
      'event_id', v_existing_event.id,
      'job_run_id', v_existing_event.job_run_id,
      'message', 'Evento duplicado ignorado de forma idempotente.'
    );
  end if;

  -- 4. Resolver mapeo de event_type -> job_id
  v_job_id_text := v_endpoint.event_types ->> p_event_type;

  if v_job_id_text is null or trim(v_job_id_text) = '' then
    update public.integration_events
    set status = 'verified', updated_at = now()
    where id = v_event_id;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.verified_unmapped',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('event_type', p_event_type, 'info', 'NO_JOB_MAPPING')
    );

    return jsonb_build_object(
      'success', true,
      'status', 'verified',
      'event_id', v_event_id,
      'job_run_id', null,
      'message', 'Evento verificado pero sin Job mapeado configurado.'
    );
  end if;

  v_job_id := v_job_id_text::uuid;

  -- 5. Validar y bloquear Job mapped (exige trigger_type = 'webhook')
  select * into v_job
  from public.jobs
  where id = v_job_id
  for update;

  if not found or v_job.workspace_id <> v_endpoint.workspace_id then
    update public.integration_events
    set status = 'quarantined',
        quarantine_reason = 'CROSS_TENANT_MAPPING_VIOLATION',
        updated_at = now()
    where id = v_event_id;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.quarantined',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('error', 'CROSS_TENANT_MAPPING_VIOLATION')
    );

    return jsonb_build_object(
      'success', false,
      'status', 'quarantined',
      'event_id', v_event_id,
      'job_run_id', null,
      'error_code', 'CROSS_TENANT_MAPPING_VIOLATION',
      'message', 'El job configurado no pertenece al workspace del endpoint.'
    );
  end if;

  if v_job.trigger_type <> 'webhook' then
    update public.integration_events
    set status = 'quarantined',
        quarantine_reason = 'INVALID_JOB_TRIGGER_TYPE',
        updated_at = now()
    where id = v_event_id;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.quarantined',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('error', 'INVALID_JOB_TRIGGER_TYPE', 'trigger_type', v_job.trigger_type)
    );

    return jsonb_build_object(
      'success', false,
      'status', 'quarantined',
      'event_id', v_event_id,
      'job_run_id', null,
      'error_code', 'INVALID_JOB_TRIGGER_TYPE',
      'message', 'El job configurado no tiene trigger_type = "webhook".'
    );
  end if;

  if v_job.status <> 'active' then
    update public.integration_events
    set status = 'failed',
        quarantine_reason = 'MAPPED_JOB_NOT_ACTIVE',
        job_id = v_job_id,
        updated_at = now()
    where id = v_event_id;

    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.failed_inactive_job',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('job_id', v_job_id, 'job_status', v_job.status)
    );

    return jsonb_build_object(
      'success', false,
      'status', 'failed',
      'event_id', v_event_id,
      'job_run_id', null,
      'error_code', 'MAPPED_JOB_NOT_ACTIVE',
      'message', 'El job vinculado no se encuentra activo.'
    );
  end if;

  -- 6. Inserción atómica en job_runs, integration_event_attempts y actualización de integration_events
  insert into public.job_runs (
    workspace_id,
    job_id,
    agent_id,
    priority,
    status,
    input,
    event_id,
    configuration_version,
    configuration_hash
  ) values (
    v_endpoint.workspace_id,
    v_job.id,
    v_job.agent_id,
    'normal',
    'queued',
    v_job.input,
    v_event_id,
    v_job.configuration_version,
    v_job.configuration_hash
  )
  returning id into v_job_run_id;

  insert into public.integration_event_attempts (
    event_id, attempt, job_run_id, status, started_at
  ) values (
    v_event_id, 1, v_job_run_id, 'started', now()
  );

  update public.integration_events
  set job_id = v_job.id,
      job_run_id = v_job_run_id,
      status = 'queued',
      updated_at = now()
  where id = v_event_id;

  insert into public.integration_event_audit_log (
    workspace_id, event_id, operation, actor_type, actor_id, metadata
  ) values (
    v_endpoint.workspace_id, v_event_id, 'event.queued',
    'gateway', v_endpoint.id::text,
    jsonb_build_object('job_id', v_job.id, 'job_run_id', v_job_run_id, 'attempt', 1)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'queued',
    'event_id', v_event_id,
    'job_run_id', v_job_run_id,
    'message', 'Evento ingerido y encolado exitosamente de forma atómica.'
  );
end;
$$;

-- 15. RPC: quarantine_inbound_event_atomic (SERVICE_ROLE ONLY)
create or replace function public.quarantine_inbound_event_atomic(
  p_endpoint_key text,
  p_external_event_id text,
  p_event_type text,
  p_provider text,
  p_headers_metadata jsonb,
  p_payload_hash text,
  p_quarantine_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_endpoint record;
  v_event_id uuid;
  v_safe_external_id text;
begin
  select * into v_endpoint
  from public.integration_endpoints
  where endpoint_key = p_endpoint_key
  for share;

  if not found then
    return jsonb_build_object(
      'success', false,
      'status', 'rejected',
      'error_code', 'ENDPOINT_NOT_FOUND',
      'message', 'Endpoint no encontrado para cuarentena.'
    );
  end if;

  -- Sanitización garantizada: si es nulo, vacío o supera 255 chars, genera fallback seguro
  v_safe_external_id := coalesce(nullif(trim(p_external_event_id), ''), 'invalid-evt-' || gen_random_uuid()::text);
  if char_length(v_safe_external_id) > 255 then
    v_safe_external_id := 'invalid-evt-' || gen_random_uuid()::text;
  end if;

  insert into public.integration_events (
    workspace_id, integration_id, endpoint_id,
    external_event_id, event_type, provider,
    payload, headers_metadata, payload_hash,
    signature_verified, status, quarantine_reason
  ) values (
    v_endpoint.workspace_id, v_endpoint.integration_id, v_endpoint.id,
    v_safe_external_id,
    coalesce(p_event_type, 'unknown'),
    coalesce(p_provider, 'generic'),
    '{}'::jsonb, coalesce(p_headers_metadata, '{}'::jsonb),
    coalesce(p_payload_hash, repeat('0', 64)),
    false, 'quarantined', p_quarantine_reason
  )
  on conflict (workspace_id, integration_id, external_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    insert into public.integration_event_audit_log (
      workspace_id, event_id, operation, actor_type, actor_id, metadata
    ) values (
      v_endpoint.workspace_id, v_event_id, 'event.quarantined',
      'gateway', v_endpoint.id::text,
      jsonb_build_object('quarantine_reason', p_quarantine_reason)
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', 'quarantined',
    'event_id', v_event_id,
    'message', 'Evento enviado a cuarentena de forma segura.'
  );
end;
$$;

-- 16. RPC: retry_integration_event (AUTHENTICATED + SERVICE_ROLE con JIT)
create or replace function public.retry_integration_event(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event record;
  v_integration record;
  v_job record;
  v_next_attempt integer;
  v_new_run_id uuid;
begin
  select * into v_event
  from public.integration_events
  where id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'EVENT_NOT_FOUND', 'message', 'Evento no encontrado.');
  end if;

  -- 1. Autorización JIT obligatoria dentro de SQL
  if auth.role() <> 'service_role' and not public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.retry') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'No tiene permisos para reintentar eventos.');
  end if;

  -- 2. Regla estricta: solo 'failed' es reintentable
  if v_event.status <> 'failed' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_EVENT_STATE',
      'message', format('Solo eventos en estado "failed" admiten reintento. Estado actual: "%s".', v_event.status)
    );
  end if;

  -- 3. Comprobar que la integración asociada está activa
  select * into v_integration
  from public.integrations
  where id = v_event.integration_id
  for share;

  if not found or v_integration.status <> 'active' then
    return jsonb_build_object('success', false, 'error_code', 'INTEGRATION_NOT_ACTIVE', 'message', 'La integración asociada no se encuentra activa.');
  end if;

  if v_event.job_id is null then
    return jsonb_build_object('success', false, 'error_code', 'NO_MAPPED_JOB', 'message', 'El evento no tiene un Job asignado para reintento.');
  end if;

  -- 4. Validar Job activo y con trigger_type = 'webhook'
  select * into v_job
  from public.jobs
  where id = v_event.job_id
  for update;

  if not found or v_job.status <> 'active' then
    return jsonb_build_object('success', false, 'error_code', 'JOB_NOT_ACTIVE', 'message', 'El Job vinculado al evento no existe o no está activo.');
  end if;

  if v_job.trigger_type <> 'webhook' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_JOB_TRIGGER_TYPE', 'message', 'El Job vinculado no tiene trigger_type = "webhook".');
  end if;

  -- 5. Siguiente intento y creación de JobRun
  select coalesce(max(attempt), 0) + 1 into v_next_attempt
  from public.integration_event_attempts
  where event_id = p_event_id;

  insert into public.job_runs (
    workspace_id,
    job_id,
    agent_id,
    priority,
    status,
    input,
    event_id,
    configuration_version,
    configuration_hash
  ) values (
    v_event.workspace_id,
    v_job.id,
    v_job.agent_id,
    'high',
    'queued',
    v_job.input,
    v_event.id,
    v_job.configuration_version,
    v_job.configuration_hash
  )
  returning id into v_new_run_id;

  insert into public.integration_event_attempts (
    event_id, attempt, job_run_id, status
  ) values (
    p_event_id, v_next_attempt, v_new_run_id, 'started'
  );

  update public.integration_events
  set status = 'queued',
      job_run_id = v_new_run_id,
      quarantine_reason = null,
      updated_at = now()
  where id = p_event_id;

  insert into public.integration_event_audit_log (
    workspace_id, event_id, operation, actor_type, actor_id, metadata
  ) values (
    v_event.workspace_id, p_event_id, 'event.retry',
    'user', coalesce(auth.uid()::text, 'system'),
    jsonb_build_object('attempt', v_next_attempt, 'new_job_run_id', v_new_run_id)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'queued',
    'event_id', p_event_id,
    'job_run_id', v_new_run_id,
    'attempt', v_next_attempt,
    'message', 'Evento reintentado y re-encolado exitosamente.'
  );
end;
$$;

-- 17. RPC: reprocess_integration_event (AUTHENTICATED + SERVICE_ROLE con JIT)
create or replace function public.reprocess_integration_event(
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event record;
  v_endpoint record;
  v_integration record;
  v_job record;
  v_job_id_text text;
  v_job_id uuid;
  v_new_run_id uuid;
  v_next_attempt integer;
begin
  select * into v_event
  from public.integration_events
  where id = p_event_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'EVENT_NOT_FOUND', 'message', 'Evento no encontrado.');
  end if;

  -- 1. Autorización JIT obligatoria dentro de SQL
  if auth.role() <> 'service_role' and not public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.reprocess') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'No tiene permisos para reprocesar eventos.');
  end if;

  -- 2. Solo 'received' o 'verified' admiten reprocesamiento
  if v_event.status not in ('received', 'verified') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'INVALID_EVENT_STATE',
      'message', format('Solo eventos en estado "received" o "verified" admiten reprocesamiento. Estado actual: "%s".', v_event.status)
    );
  end if;

  select * into v_endpoint
  from public.integration_endpoints
  where id = v_event.endpoint_id
  for share;

  select * into v_integration
  from public.integrations
  where id = v_event.integration_id
  for share;

  if not found or v_integration.status <> 'active' then
    return jsonb_build_object('success', false, 'error_code', 'INTEGRATION_NOT_ACTIVE', 'message', 'La integración vinculada no está activa para reprocesamiento.');
  end if;

  v_job_id_text := v_endpoint.event_types ->> v_event.event_type;
  if v_job_id_text is not null and trim(v_job_id_text) <> '' then
    v_job_id := v_job_id_text::uuid;
  elsif v_event.job_id is not null then
    v_job_id := v_event.job_id;
  else
    return jsonb_build_object('success', false, 'error_code', 'NO_MAPPED_JOB', 'message', 'No se ha configurado un Job mapeado para este tipo de evento.');
  end if;

  select * into v_job
  from public.jobs
  where id = v_job_id
  for update;

  if not found or v_job.workspace_id <> v_event.workspace_id then
    return jsonb_build_object('success', false, 'error_code', 'CROSS_TENANT_JOB', 'message', 'El job asignado no pertenece al workspace del evento.');
  end if;

  if v_job.trigger_type <> 'webhook' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_JOB_TRIGGER_TYPE', 'message', 'El job asignado no tiene trigger_type = "webhook".');
  end if;

  if v_job.status <> 'active' then
    return jsonb_build_object('success', false, 'error_code', 'JOB_NOT_ACTIVE', 'message', 'El job configurado no está activo.');
  end if;

  insert into public.job_runs (
    workspace_id,
    job_id,
    agent_id,
    priority,
    status,
    input,
    event_id,
    configuration_version,
    configuration_hash
  ) values (
    v_event.workspace_id,
    v_job.id,
    v_job.agent_id,
    'normal',
    'queued',
    v_job.input,
    v_event.id,
    v_job.configuration_version,
    v_job.configuration_hash
  )
  returning id into v_new_run_id;

  select coalesce(max(attempt), 0) + 1 into v_next_attempt
  from public.integration_event_attempts
  where event_id = p_event_id;

  insert into public.integration_event_attempts (
    event_id, attempt, job_run_id, status, started_at
  ) values (
    p_event_id, v_next_attempt, v_new_run_id, 'started', now()
  );

  update public.integration_events
  set status = 'queued',
      job_id = v_job.id,
      job_run_id = v_new_run_id,
      quarantine_reason = null,
      updated_at = now()
  where id = p_event_id;

  insert into public.integration_event_audit_log (
    workspace_id, event_id, operation, actor_type, actor_id, metadata
  ) values (
    v_event.workspace_id, p_event_id, 'event.reprocessed',
    'user', coalesce(auth.uid()::text, 'system'),
    jsonb_build_object('job_id', v_job.id, 'job_run_id', v_new_run_id)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'queued',
    'event_id', p_event_id,
    'job_run_id', v_new_run_id,
    'message', 'Evento reprocesado y encolado exitosamente.'
  );
end;
$$;

-- 18. RPC: rotate_integration_endpoint_secret (AUTHENTICATED + SERVICE_ROLE con JIT)
create or replace function public.rotate_integration_endpoint_secret(
  p_endpoint_id uuid,
  p_new_encrypted_secret text,
  p_new_iv text,
  p_new_auth_tag text,
  p_new_secret_reference text,
  p_grace_period_seconds integer default 86400
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_endpoint record;
  v_grace_seconds integer;
begin
  -- 1. Bloqueo pesimista para serializar rotaciones concurrentes
  select * into v_endpoint
  from public.integration_endpoints
  where id = p_endpoint_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'ENDPOINT_NOT_FOUND', 'message', 'Endpoint no encontrado.');
  end if;

  -- 2. Validación JIT de permisos
  if auth.role() <> 'service_role' and not public.has_permission(auth.uid(), v_endpoint.workspace_id, 'integrations.update') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'message', 'No tiene permisos para rotar credenciales.');
  end if;

  -- 3. Acotar período de gracia entre 60 segundos y 7 días
  v_grace_seconds := greatest(60, least(coalesce(p_grace_period_seconds, 86400), 604800));

  -- 4. Rotación transaccional coherente (el actual primario pasa a secundario con expiración)
  update public.integration_endpoints
  set secondary_encrypted_secret = encrypted_secret,
      secondary_encryption_iv = encryption_iv,
      secondary_encryption_auth_tag = encryption_auth_tag,
      secondary_secret_expires_at = now() + (v_grace_seconds || ' seconds')::interval,
      encrypted_secret = p_new_encrypted_secret,
      encryption_iv = p_new_iv,
      encryption_auth_tag = p_new_auth_tag,
      secret_reference = p_new_secret_reference,
      updated_at = now()
  where id = p_endpoint_id;

  insert into public.integration_event_audit_log (
    workspace_id, operation, actor_type, actor_id, metadata
  ) values (
    v_endpoint.workspace_id, 'endpoint.secret_rotated',
    'user', coalesce(auth.uid()::text, 'system'),
    jsonb_build_object('endpoint_id', p_endpoint_id, 'grace_period_seconds', v_grace_seconds)
  );

  return jsonb_build_object('success', true, 'message', 'Credencial rotada exitosamente de forma atómica.');
end;
$$;

-- 19. REVOCACIÓN Y OTORGAMIENTO ESTRICTO DE PRIVILEGIOS (LEAST PRIVILEGE)
revoke execute on function public.ingest_integration_event_atomic from public, authenticated;
revoke execute on function public.quarantine_inbound_event_atomic from public, authenticated;
revoke execute on function public.retry_integration_event from public;
revoke execute on function public.reprocess_integration_event from public;
revoke execute on function public.rotate_integration_endpoint_secret from public, authenticated;

grant execute on function public.ingest_integration_event_atomic to service_role;
grant execute on function public.quarantine_inbound_event_atomic to service_role;
grant execute on function public.retry_integration_event to authenticated, service_role;
grant execute on function public.reprocess_integration_event to authenticated, service_role;
grant execute on function public.rotate_integration_endpoint_secret to service_role;

-- 20. GAP-001 REMEDIACIÓN: checkpoint_and_requeue_job_run CON SOPORTE PARA waiting_approval
create or replace function public.checkpoint_and_requeue_job_run(
  p_run_id uuid,
  p_worker_id text default null,
  p_fencing_token bigint default null
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

  -- CASO 1: Transición desde HITL (waiting_approval) tras resolución humana
  if v_run.status = 'waiting_approval' then
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
      v_run.workspace_id, v_run.job_id, v_run.id, 'user', coalesce(p_worker_id, 'hitl_approval'), 'checkpoint_requeued', v_run.status, 'queued', v_run.fencing_token, null
    );

    return jsonb_build_object('success', true, 'status', 'queued');
  end if;

  -- CASO 2: Checkpoint de worker activo por agotamiento de lease budget
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

revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from public, authenticated;
grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to service_role;

