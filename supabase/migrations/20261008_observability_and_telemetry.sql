-- ============================================================================
-- FASE 4.8: OBSERVABILIDAD, TELEMETRÍA Y TRAZABILIDAD OPERACIONAL
-- NEXTEХ / Nexora Texter
-- Migración canónica: 20261008_observability_and_telemetry.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CORRECCIÓN 1: Claves Únicas Compuestas para Garantizar Integridad Multi-Tenant
-- ----------------------------------------------------------------------------

-- Garantizar (id, workspace_id) unique en agent_runs
alter table public.agent_runs drop constraint if exists uq_agent_runs_id_ws;
alter table public.agent_runs add constraint uq_agent_runs_id_ws unique (id, workspace_id);

-- Garantizar (id, workspace_id) unique en agent_run_steps
alter table public.agent_run_steps drop constraint if exists uq_agent_run_steps_id_ws;
alter table public.agent_run_steps add constraint uq_agent_run_steps_id_ws unique (id, workspace_id);

-- Garantizar (id, workspace_id) unique en integration_events
alter table public.integration_events drop constraint if exists uq_integration_events_id_ws;
alter table public.integration_events add constraint uq_integration_events_id_ws unique (id, workspace_id);

-- Garantizar (id, workspace_id) unique en approval_requests
alter table public.approval_requests drop constraint if exists uq_approval_requests_id_ws;
alter table public.approval_requests add constraint uq_approval_requests_id_ws unique (id, workspace_id);

-- Garantizar (id, workspace_id) unique en jobs
alter table public.jobs drop constraint if exists uq_jobs_id_ws;
alter table public.jobs add constraint uq_jobs_id_ws unique (id, workspace_id);

-- Garantizar (id, workspace_id) unique en agents
alter table public.agents drop constraint if exists uq_agents_id_ws;
alter table public.agents add constraint uq_agents_id_ws unique (id, workspace_id);


-- ----------------------------------------------------------------------------
-- 2. Tabla Central de Telemetría: observability_spans
-- ----------------------------------------------------------------------------
create table if not exists public.observability_spans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  -- Identificadores Internos de Telemetría NEXTEХ
  -- (Nota: Para exportación futura OpenTelemetry se mapearán vía adapter)
  trace_id text not null check (char_length(trim(trace_id)) between 8 and 128),
  span_id text not null unique check (char_length(trim(span_id)) between 8 and 128),
  parent_span_id text check (parent_span_id is null or char_length(trim(parent_span_id)) between 8 and 128),

  -- Taxonomía y Ciclo de Vida del Span
  span_type text not null check (span_type in (
    'workflow', 'integration', 'job', 'agent', 'step', 'tool', 'ai', 'approval', 'system'
  )),
  operation text not null check (char_length(trim(operation)) between 1 and 100),
  component text not null check (char_length(trim(component)) between 1 and 50),
  status text not null default 'started' check (status in ('started', 'completed', 'failed', 'cancelled')),

  -- Métricas Temporales
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),

  -- Diagnóstico Seguro (Sanitizado)
  error_code text check (error_code is null or char_length(error_code) <= 100),
  error_category text check (error_category is null or error_category in (
    'SYSTEM', 'VALIDATION', 'SECURITY', 'PROVIDER', 'TIMEOUT', 'RATE_LIMIT', 'GOVERNANCE', 'BUSINESS'
  )),
  error_message_safe text check (error_message_safe is null or char_length(error_message_safe) <= 1000),

  -- Entidades de Negocio Correlacionadas (Integridad Compuesta Multi-Tenant)
  job_id uuid,
  job_run_id uuid,
  agent_id uuid,
  agent_run_id uuid,
  agent_step_id uuid,
  integration_id uuid,
  integration_event_id uuid,
  approval_request_id uuid,
  ai_request_id text check (ai_request_id is null or char_length(ai_request_id) <= 128),
  tool_id text check (tool_id is null or char_length(tool_id) <= 100),

  -- Restricciones de Clave Foránea Compuesta (Workspace A nunca apunta a entidad de Workspace B)
  constraint fk_obs_spans_job foreign key (job_id, workspace_id)
    references public.jobs (id, workspace_id) on delete set null (job_id),
  constraint fk_obs_spans_job_run foreign key (job_run_id, workspace_id)
    references public.job_runs (id, workspace_id) on delete set null (job_run_id),
  constraint fk_obs_spans_agent foreign key (agent_id, workspace_id)
    references public.agents (id, workspace_id) on delete set null (agent_id),
  constraint fk_obs_spans_agent_run foreign key (agent_run_id, workspace_id)
    references public.agent_runs (id, workspace_id) on delete set null (agent_run_id),
  constraint fk_obs_spans_agent_step foreign key (agent_step_id, workspace_id)
    references public.agent_run_steps (id, workspace_id) on delete set null (agent_step_id),
  constraint fk_obs_spans_integration foreign key (integration_id, workspace_id)
    references public.integrations (id, workspace_id) on delete set null (integration_id),
  constraint fk_obs_spans_integration_event foreign key (integration_event_id, workspace_id)
    references public.integration_events (id, workspace_id) on delete set null (integration_event_id),
  constraint fk_obs_spans_approval_request foreign key (approval_request_id, workspace_id)
    references public.approval_requests (id, workspace_id) on delete set null (approval_request_id),

  -- Capa 2 de Attribute Bounding: Restricción física en base de datos (Máximo 4096 bytes)
  attributes jsonb not null default '{}'::jsonb check (
    jsonb_typeof(attributes) = 'object' and pg_column_size(attributes) <= 4096
  ),

  created_at timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 3. Índices de Alto Rendimiento
-- ----------------------------------------------------------------------------
-- Árbol de traza (Trace Detail)
create index if not exists idx_obs_spans_trace_tree 
  on public.observability_spans (workspace_id, trace_id, started_at);

-- Dashboard filtrado por tiempo
create index if not exists idx_obs_spans_dashboard_time 
  on public.observability_spans (workspace_id, started_at desc);

-- Métricas por componente y estado
create index if not exists idx_obs_spans_component_status 
  on public.observability_spans (workspace_id, component, status, started_at desc);

-- Índices parciales por entidad de negocio
create index if not exists idx_obs_spans_job_run 
  on public.observability_spans (job_run_id) 
  where job_run_id is not null;

create index if not exists idx_obs_spans_agent_run 
  on public.observability_spans (agent_run_id) 
  where agent_run_id is not null;

create index if not exists idx_obs_spans_parent 
  on public.observability_spans (parent_span_id) 
  where parent_span_id is not null;


-- ----------------------------------------------------------------------------
-- 4. Row Level Security (RLS)
-- ----------------------------------------------------------------------------
alter table public.observability_spans enable row level security;

-- SELECT: Miembros del Workspace
drop policy if exists "Users can read spans of their workspaces" on public.observability_spans;
create policy "Users can read spans of their workspaces"
  on public.observability_spans
  for select
  using (
    workspace_id in (
      select m.workspace_id 
      from public.workspace_members m 
      where m.user_id = auth.uid()
    )
  );

-- INSERT: Miembros del Workspace o Service Role
drop policy if exists "Members and service role can insert spans" on public.observability_spans;
create policy "Members and service role can insert spans"
  on public.observability_spans
  for insert
  with check (
    workspace_id in (
      select m.workspace_id 
      from public.workspace_members m 
      where m.user_id = auth.uid()
    )
    or auth.role() = 'service_role'
  );

-- No se definen políticas de UPDATE ni DELETE para authenticated ni anon (Inmutabilidad para usuarios).


-- ----------------------------------------------------------------------------
-- 5. RPC Atómica de Inserción en Lote: record_observability_spans_batch
-- ----------------------------------------------------------------------------
create or replace function public.record_observability_spans_batch(
  p_spans jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_inserted_count integer := 0;
  v_span jsonb;
  v_workspace_id uuid;
  v_trace_id text;
  v_span_id text;
  v_parent_span_id text;
  v_span_type text;
  v_operation text;
  v_component text;
  v_status text;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_duration_ms integer;
  v_error_code text;
  v_error_category text;
  v_error_message_safe text;
  v_job_id uuid;
  v_job_run_id uuid;
  v_agent_id uuid;
  v_agent_run_id uuid;
  v_agent_step_id uuid;
  v_integration_id uuid;
  v_integration_event_id uuid;
  v_approval_request_id uuid;
  v_ai_request_id text;
  v_tool_id text;
  v_attributes jsonb;
begin
  if p_spans is null or jsonb_typeof(p_spans) != 'array' then
    raise exception 'p_spans must be a non-null jsonb array';
  end if;

  for v_span in select * from jsonb_array_elements(p_spans)
  loop
    v_workspace_id := (v_span->>'workspace_id')::uuid;
    v_trace_id := trim(v_span->>'trace_id');
    v_span_id := trim(v_span->>'span_id');
    v_parent_span_id := nullif(trim(v_span->>'parent_span_id'), '');
    v_span_type := trim(v_span->>'span_type');
    v_operation := trim(v_span->>'operation');
    v_component := trim(v_span->>'component');
    v_status := coalesce(nullif(trim(v_span->>'status'), ''), 'started');
    v_started_at := coalesce((v_span->>'started_at')::timestamptz, now());
    v_completed_at := (v_span->>'completed_at')::timestamptz;
    v_duration_ms := (v_span->>'duration_ms')::integer;
    v_error_code := nullif(trim(v_span->>'error_code'), '');
    v_error_category := nullif(trim(v_span->>'error_category'), '');
    v_error_message_safe := nullif(trim(v_span->>'error_message_safe'), '');
    
    v_job_id := (v_span->>'job_id')::uuid;
    v_job_run_id := (v_span->>'job_run_id')::uuid;
    v_agent_id := (v_span->>'agent_id')::uuid;
    v_agent_run_id := (v_span->>'agent_run_id')::uuid;
    v_agent_step_id := (v_span->>'agent_step_id')::uuid;
    v_integration_id := (v_span->>'integration_id')::uuid;
    v_integration_event_id := (v_span->>'integration_event_id')::uuid;
    v_approval_request_id := (v_span->>'approval_request_id')::uuid;
    v_ai_request_id := nullif(trim(v_span->>'ai_request_id'), '');
    v_tool_id := nullif(trim(v_span->>'tool_id'), '');
    
    v_attributes := coalesce(v_span->'attributes', '{}'::jsonb);
    if jsonb_typeof(v_attributes) != 'object' then
      v_attributes := '{}'::jsonb;
    end if;

    -- Validación de tamaño en RPC (Capa 2 adicional)
    if pg_column_size(v_attributes) > 4096 then
      v_attributes := jsonb_build_object(
        '_truncated', true,
        '_original_size_bytes', pg_column_size(v_attributes),
        '_reason', 'RPC attribute size bound exceeded 4096 bytes'
      );
    end if;

    insert into public.observability_spans (
      workspace_id,
      trace_id,
      span_id,
      parent_span_id,
      span_type,
      operation,
      component,
      status,
      started_at,
      completed_at,
      duration_ms,
      error_code,
      error_category,
      error_message_safe,
      job_id,
      job_run_id,
      agent_id,
      agent_run_id,
      agent_step_id,
      integration_id,
      integration_event_id,
      approval_request_id,
      ai_request_id,
      tool_id,
      attributes
    ) values (
      v_workspace_id,
      v_trace_id,
      v_span_id,
      v_parent_span_id,
      v_span_type,
      v_operation,
      v_component,
      v_status,
      v_started_at,
      v_completed_at,
      v_duration_ms,
      v_error_code,
      v_error_category,
      v_error_message_safe,
      v_job_id,
      v_job_run_id,
      v_agent_id,
      v_agent_run_id,
      v_agent_step_id,
      v_integration_id,
      v_integration_event_id,
      v_approval_request_id,
      v_ai_request_id,
      v_tool_id,
      v_attributes
    )
    on conflict (span_id) do update set
      status = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.status
        else excluded.status
      end,
      completed_at = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.completed_at
        else coalesce(excluded.completed_at, public.observability_spans.completed_at)
      end,
      duration_ms = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.duration_ms
        else coalesce(excluded.duration_ms, public.observability_spans.duration_ms)
      end,
      error_code = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.error_code
        else coalesce(excluded.error_code, public.observability_spans.error_code)
      end,
      error_category = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.error_category
        else coalesce(excluded.error_category, public.observability_spans.error_category)
      end,
      error_message_safe = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.error_message_safe
        else coalesce(excluded.error_message_safe, public.observability_spans.error_message_safe)
      end,
      attributes = case
        when public.observability_spans.status in ('completed', 'failed', 'cancelled')
          then public.observability_spans.attributes
        else public.observability_spans.attributes || excluded.attributes
      end;

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return v_inserted_count;
end;
$$;

revoke all on function public.record_observability_spans_batch(jsonb) from public, authenticated, anon;
grant execute on function public.record_observability_spans_batch(jsonb) to service_role;


-- ----------------------------------------------------------------------------
-- 6. RPC de Limpieza Periódica: cleanup_observability_spans
-- ----------------------------------------------------------------------------
create or replace function public.cleanup_observability_spans(
  p_retention_days integer default 30,
  p_batch_size integer default 5000
)
returns table(deleted_count bigint)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_deleted bigint := 0;
  v_batch_deleted bigint;
  v_cutoff_date timestamptz;
begin
  if p_retention_days < 7 then
    raise exception 'Retention days cannot be less than 7 days (provided: %)', p_retention_days;
  end if;
  if p_batch_size <= 0 or p_batch_size > 50000 then
    raise exception 'Batch size must be between 1 and 50000 (provided: %)', p_batch_size;
  end if;

  v_cutoff_date := now() - (p_retention_days || ' days')::interval;

  loop
    delete from public.observability_spans
    where id in (
      select id from public.observability_spans
      where created_at < v_cutoff_date
      limit p_batch_size
      for update skip locked
    );
    get diagnostics v_batch_deleted = row_count;
    v_deleted := v_deleted + v_batch_deleted;
    
    exit when v_batch_deleted < p_batch_size;
  end loop;

  return query select v_deleted;
end;
$$;

revoke all on function public.cleanup_observability_spans(integer, integer) from public, authenticated, anon;
grant execute on function public.cleanup_observability_spans(integer, integer) to service_role;
