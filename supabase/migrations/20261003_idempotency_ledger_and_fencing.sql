-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.3 (CIERRE DEFINITIVO)
-- Idempotency Ledger, Fencing Tokens, Leases Temporales y Mutaciones Seguras
-- ==============================================================================

create extension if not exists pgcrypto;

-- 1. EXTENDER TABLA agent_run_steps CON MECANISMOS DE FENCING Y LEASE
alter table public.agent_run_steps 
  add column if not exists fencing_token bigint not null default 0,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists executor_id uuid;

create index if not exists idx_agent_run_steps_lease 
  on public.agent_run_steps (status, lease_expires_at);

create index if not exists idx_agent_run_steps_fencing 
  on public.agent_run_steps (id, fencing_token);

-- 2. TABLA: tool_idempotency_ledger (Diario Inmutable de Idempotencia)
create table if not exists public.tool_idempotency_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id uuid not null references public.agent_run_steps(id) on delete cascade,
  tool_id text not null,
  tool_version text not null default '1.0.0',
  execution_id uuid not null,
  fencing_token bigint not null,
  payload_hash text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  target_table text not null check (target_table in ('conversations', 'agents')),
  target_record_id uuid,
  status text not null check (status in ('committed', 'not_found', 'already_deleted')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_tool_idempotency_ledger_step_id unique (step_id),
  constraint uq_tool_idempotency_ledger_execution_id unique (execution_id)
);

comment on table public.tool_idempotency_ledger is 'Diario contable de transacciones e idempotencia física para mutaciones locales de PostgreSQL';

create index if not exists idx_tool_ledger_workspace on public.tool_idempotency_ledger (workspace_id);
create index if not exists idx_tool_ledger_run on public.tool_idempotency_ledger (run_id);
create index if not exists idx_tool_ledger_step on public.tool_idempotency_ledger (step_id);
create index if not exists idx_tool_ledger_target on public.tool_idempotency_ledger (target_table, target_record_id);
create index if not exists idx_tool_ledger_execution on public.tool_idempotency_ledger (execution_id);

-- Trigger de updated_at para tool_idempotency_ledger
drop trigger if exists tr_tool_idempotency_ledger_updated_at on public.tool_idempotency_ledger;
create trigger tr_tool_idempotency_ledger_updated_at
  before update on public.tool_idempotency_ledger
  for each row execute function public.handle_updated_at();

-- 3. RLS ESTRICTO PARA tool_idempotency_ledger
alter table public.tool_idempotency_ledger enable row level security;

drop policy if exists "tool_idempotency_ledger_select_member" on public.tool_idempotency_ledger;
create policy "tool_idempotency_ledger_select_member"
  on public.tool_idempotency_ledger
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "tool_idempotency_ledger_insert_member" on public.tool_idempotency_ledger;
create policy "tool_idempotency_ledger_insert_member"
  on public.tool_idempotency_ledger
  for insert
  with check (public.is_workspace_member(workspace_id, auth.uid()));

-- 4. TRIGGER DE INMUTABILIDAD DE PASO AUTORIZADO (Anti-Tampering en Base de Datos)
create or replace function public.protect_immutable_step_payload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Prohibir alteración de input una vez que el paso entró en running o completed
  if old.status in ('running', 'completed') and (old.input is distinct from new.input) then
    raise exception 'TOOL_PAYLOAD_IMMUTABLE: El payload del paso ya ha sido bloqueado y no puede ser modificado.';
  end if;

  -- Prohibir alteración de asociaciones estructurales
  if old.run_id is distinct from new.run_id or old.workspace_id is distinct from new.workspace_id or old.tool_id is distinct from new.tool_id then
    raise exception 'TOOL_STRUCTURE_IMMUTABLE: La vinculación estructural del paso es inmutable.';
  end if;

  return new;
end;
$$;

drop trigger if exists tr_protect_immutable_step on public.agent_run_steps;
create trigger tr_protect_immutable_step
  before update on public.agent_run_steps
  for each row execute function public.protect_immutable_step_payload();

-- 5. FUNCIÓN DETERMINISTA DE CANONICAL JSON (RFC 8785)
create or replace function public.canonical_json(p_val jsonb)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_type text;
  v_result text;
begin
  if p_val is null or jsonb_typeof(p_val) = 'null' then
    return 'null';
  end if;

  v_type := jsonb_typeof(p_val);

  if v_type = 'boolean' or v_type = 'number' then
    return p_val::text;
  elsif v_type = 'string' then
    return to_json(p_val#>>'{}')::text;
  elsif v_type = 'array' then
    select coalesce('[' || string_agg(public.canonical_json(elem.value), ',' order by elem.ordinality) || ']', '[]')
    into v_result
    from jsonb_array_elements(p_val) with ordinality as elem;
    return v_result;
  elsif v_type = 'object' then
    select coalesce('{' || string_agg(to_json(kv.key)::text || ':' || public.canonical_json(kv.value), ',' order by kv.key) || '}', '{}')
    into v_result
    from jsonb_each(p_val) as kv;
    return v_result;
  end if;

  return p_val::text;
end;
$$;

-- 6. FUNCIÓN DE HASH CANÓNICO DE BINDING
create or replace function public.compute_tool_payload_hash(
  p_run_id text,
  p_step_id text,
  p_tool_id text,
  p_tool_version text,
  p_params jsonb
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_binding text;
begin
  v_binding := p_run_id || ':' || p_step_id || ':' || p_tool_id || ':' || coalesce(p_tool_version, '1.0.0') || ':' || public.canonical_json(p_params);
  return encode(digest(convert_to(v_binding, 'UTF8'), 'sha256'), 'hex');
end;
$$;

-- 7. RPC: RECLAMO INICIAL DE EJECUCIÓN (pending -> running con token y lease)
create or replace function public.claim_agent_step_execution(
  p_run_id uuid,
  p_step_id uuid,
  p_execution_id uuid,
  p_lease_duration_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_run record;
  v_step record;
  v_new_token bigint;
  v_new_lease timestamptz;
begin
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  select * into v_run from public.agent_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if not public.is_workspace_member(v_run.workspace_id, v_auth_user) then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'Sin permisos en este workspace.');
  end if;

  select * into v_step from public.agent_run_steps where id = p_step_id and run_id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado.');
  end if;

  if v_step.status <> 'pending' then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_STATUS_INVALID', 'error_message', 'El paso no está en estado pending.');
  end if;

  v_new_token := coalesce(v_step.fencing_token, 0) + 1;
  v_new_lease := clock_timestamp() + (coalesce(p_lease_duration_seconds, 30) || ' seconds')::interval;

  update public.agent_run_steps
  set status = 'running',
      fencing_token = v_new_token,
      executor_id = p_execution_id,
      lease_expires_at = v_new_lease,
      started_at = clock_timestamp()
  where id = p_step_id;

  return jsonb_build_object(
    'success', true,
    'step_id', p_step_id,
    'fencing_token', v_new_token,
    'executor_id', p_execution_id,
    'lease_expires_at', v_new_lease
  );
end;
$$;

revoke execute on function public.claim_agent_step_execution(uuid, uuid, uuid, integer) from public;
grant execute on function public.claim_agent_step_execution(uuid, uuid, uuid, integer) to authenticated, service_role;

-- 8. RPC: TAKEOVER ATÓMICO POR EXPIRACIÓN DE LEASE (running + expired -> running con token incrementado)
create or replace function public.claim_agent_step_takeover(
  p_run_id uuid,
  p_step_id uuid,
  p_new_execution_id uuid,
  p_lease_duration_seconds integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_run record;
  v_step record;
  v_new_token bigint;
  v_new_lease timestamptz;
begin
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  select * into v_run from public.agent_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_RUN_NOT_FOUND', 'error_message', 'Run no encontrado.');
  end if;

  if not public.is_workspace_member(v_run.workspace_id, v_auth_user) then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'Sin permisos en este workspace.');
  end if;

  -- Bloqueo pesimista para serializar takeovers concurrentes
  select * into v_step from public.agent_run_steps where id = p_step_id and run_id = p_run_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado.');
  end if;

  if v_step.status = 'completed' then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_ALREADY_COMPLETED', 'error_message', 'El paso ya fue completado.');
  end if;

  if v_step.status <> 'running' then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_STATUS_INVALID', 'error_message', 'El paso no está en estado running.');
  end if;

  -- Regla crítica de lease: el takeover solo procede si el lease ya expiró en PostgreSQL
  if v_step.lease_expires_at is not null and v_step.lease_expires_at > clock_timestamp() then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_LEASE_ACTIVE', 'error_message', 'El lease actual sigue vigente.');
  end if;

  -- Incrementar atómicamente fencing_token
  v_new_token := v_step.fencing_token + 1;
  v_new_lease := clock_timestamp() + (coalesce(p_lease_duration_seconds, 30) || ' seconds')::interval;

  update public.agent_run_steps
  set fencing_token = v_new_token,
      executor_id = p_new_execution_id,
      lease_expires_at = v_new_lease
  where id = p_step_id;

  return jsonb_build_object(
    'success', true,
    'step_id', p_step_id,
    'fencing_token', v_new_token,
    'executor_id', p_new_execution_id,
    'lease_expires_at', v_new_lease
  );
end;
$$;

revoke execute on function public.claim_agent_step_takeover(uuid, uuid, uuid, integer) from public;
grant execute on function public.claim_agent_step_takeover(uuid, uuid, uuid, integer) to authenticated, service_role;

-- 9. RPC CORE: MUTACIÓN AUTORIZADA DE BASE DE DATOS CON IDEMPOTENCY LEDGER Y FENCING
create or replace function public.execute_authorized_database_write(
  p_run_id uuid,
  p_step_id uuid,
  p_execution_id uuid,
  p_fencing_token bigint,
  p_expected_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_run record;
  v_step record;
  v_ledger record;
  v_member_role text;
  v_authorized_params jsonb;
  v_tool_id text;
  v_tool_version text;
  v_computed_hash text;
  v_operation text;
  v_target_table text;
  v_target_id uuid;
  v_result_status text;
  v_result jsonb;
  v_conv_record record;
  v_agent_record record;
  v_affected_rows integer;
  v_deleted_rows integer;
  v_ledger_id uuid;
begin
  -- 1. Reconstrucción de Autoridad: auth.uid() no nulo
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  -- 2. Validar existencia del run y extraer workspace_id real de BD
  select * into v_run from public.agent_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_RUN_NOT_FOUND', 'error_message', 'Run de agente no encontrado.');
  end if;

  -- 3. Validar membresía y permisos en workspace_members
  select role into v_member_role
  from public.workspace_members
  where workspace_id = v_run.workspace_id and user_id = v_auth_user;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'El usuario no pertenece al workspace.');
  end if;

  -- 4. SERIALIZACIÓN: Bloqueo exclusivo de fila sobre agent_run_steps
  select * into v_step
  from public.agent_run_steps
  where id = p_step_id and run_id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado en este run.');
  end if;

  -- 5. Validar pertenencia de tenant
  if v_step.workspace_id <> v_run.workspace_id then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_CROSS_TENANT_ACCESS', 'error_message', 'El paso no pertenece al workspace del run.');
  end if;

  -- 6. CONSULTA AL IDEMPOTENCY LEDGER (LEDGER HIT)
  select * into v_ledger
  from public.tool_idempotency_ledger
  where step_id = p_step_id;

  if found then
    -- Retorno seguro del snapshot sellado sin volver a ejecutar mutaciones físicas
    return jsonb_build_object(
      'success', true,
      'status', v_ledger.status,
      'ledger_id', v_ledger.id,
      'execution_id', v_ledger.execution_id,
      'fencing_token', v_ledger.fencing_token,
      'payload_hash', v_ledger.payload_hash,
      'data', v_ledger.result,
      'cached', true
    );
  end if;

  -- 7. VALIDACIÓN ESTRICTA DE ESTADO, FENCING Y LEASE
  if v_step.status <> 'running' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_STATUS_INVALID',
      'error_message', 'El paso no se encuentra en estado running para persistencia.'
    );
  end if;

  if v_step.fencing_token <> p_fencing_token then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_FENCING_REJECTED',
      'error_message', 'Fencing token obsoleto o inválido. El executor fue cercado fuera.'
    );
  end if;

  if v_step.executor_id <> p_execution_id then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_FENCING_REJECTED',
      'error_message', 'Execution ID no coincide con el executor activo.'
    );
  end if;

  if v_step.lease_expires_at is null or v_step.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_LEASE_EXPIRED',
      'error_message', 'El lease temporal del paso ha expirado.'
    );
  end if;

  -- 8. OBTENCIÓN DEL PAYLOAD AUTORIZADO INMUTABLE
  v_authorized_params := coalesce(v_step.input->'params', v_step.input);
  if v_authorized_params is null or jsonb_typeof(v_authorized_params) <> 'object' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_SCHEMA_INVALID',
      'error_message', 'El paso no contiene parámetros autorizados válidos.'
    );
  end if;

  v_tool_id := coalesce(v_step.tool_id, v_step.input->>'tool_id', 'database_write');
  v_tool_version := coalesce(v_step.input->>'tool_version', '1.0.0');

  -- 9. VALIDACIÓN CRIPTOGRÁFICA DE HASH CANÓNICO (ANTI-TAMPERING)
  v_computed_hash := public.compute_tool_payload_hash(
    p_run_id::text,
    p_step_id::text,
    v_tool_id,
    v_tool_version,
    v_authorized_params
  );

  if v_computed_hash <> p_expected_payload_hash then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_PAYLOAD_HASH_MISMATCH',
      'error_message', 'El hash del payload esperado no coincide con el payload autorizado.'
    );
  end if;

  if (v_step.input->>'payload_hash') is not null and (v_step.input->>'payload_hash') <> v_computed_hash then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_PAYLOAD_HASH_MISMATCH',
      'error_message', 'El hash almacenado del paso no coincide con el payload autorizado.'
    );
  end if;

  -- 10. RESTRICCIÓN DE TABLA DESTINO Y OPERACIÓN
  v_operation := lower(trim(coalesce(v_authorized_params->>'operation', 'insert')));
  v_target_table := lower(trim(coalesce(v_authorized_params->>'table', '')));

  if v_target_table not in ('conversations', 'agents') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_UNAUTHORIZED_MUTATION',
      'error_message', 'Tabla destino no autorizada. ai_usage y otras tablas están prohibidas.'
    );
  end if;

  if v_operation not in ('insert', 'update', 'delete') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_UNAUTHORIZED_MUTATION',
      'error_message', 'Operación no soportada para database_write.'
    );
  end if;

  -- 11. EJECUCIÓN DE LA MUTACIÓN TRANSACCIONAL
  if v_target_table = 'conversations' then
    if v_operation = 'insert' then
      insert into public.conversations (
        workspace_id,
        user_id,
        title
      ) values (
        v_run.workspace_id,
        v_auth_user,
        coalesce(v_authorized_params->'data'->>'title', v_authorized_params->>'title', 'Nueva conversación')
      )
      returning id, workspace_id, user_id, title, created_at, updated_at
      into v_conv_record;

      v_result_status := 'committed';
      v_result := to_jsonb(v_conv_record);
      v_target_id := v_conv_record.id;

    elsif v_operation = 'update' then
      v_target_id := (v_authorized_params->>'recordId')::uuid;
      if v_target_id is null then
        return jsonb_build_object('success', false, 'error_code', 'TOOL_SCHEMA_INVALID', 'error_message', 'recordId es requerido para update.');
      end if;

      update public.conversations
      set title = coalesce(v_authorized_params->'data'->>'title', v_authorized_params->>'title', title),
          updated_at = clock_timestamp()
      where id = v_target_id and workspace_id = v_run.workspace_id
      returning id, workspace_id, user_id, title, created_at, updated_at
      into v_conv_record;

      get diagnostics v_affected_rows = row_count;
      if v_affected_rows = 1 then
        v_result_status := 'committed';
        v_result := to_jsonb(v_conv_record);
      else
        v_result_status := 'not_found';
        v_result := jsonb_build_object('affected_rows', 0, 'status', 'not_found', 'recordId', v_target_id);
      end if;

    elsif v_operation = 'delete' then
      v_target_id := (v_authorized_params->>'recordId')::uuid;
      if v_target_id is null then
        return jsonb_build_object('success', false, 'error_code', 'TOOL_SCHEMA_INVALID', 'error_message', 'recordId es requerido para delete.');
      end if;

      delete from public.conversations
      where id = v_target_id and workspace_id = v_run.workspace_id;

      get diagnostics v_deleted_rows = row_count;
      if v_deleted_rows = 1 then
        v_result_status := 'committed';
        v_result := jsonb_build_object('deleted_rows', 1, 'status', 'deleted', 'recordId', v_target_id);
      else
        v_result_status := 'already_deleted';
        v_result := jsonb_build_object('deleted_rows', 0, 'status', 'already_deleted', 'recordId', v_target_id);
      end if;
    end if;

  elsif v_target_table = 'agents' then
    if v_operation <> 'insert' then
      return jsonb_build_object(
        'success', false,
        'error_code', 'TOOL_UNAUTHORIZED_MUTATION',
        'error_message', 'Solo la operación insert está permitida sobre agents.'
      );
    end if;

    insert into public.agents (
      workspace_id,
      created_by,
      name,
      description,
      system_instructions,
      model_id,
      status,
      max_steps,
      max_tokens,
      timeout_seconds,
      max_tool_calls
    ) values (
      v_run.workspace_id,
      v_auth_user,
      coalesce(v_authorized_params->'data'->>'name', v_authorized_params->>'name', 'Nuevo Agente'),
      coalesce(v_authorized_params->'data'->>'description', v_authorized_params->>'description'),
      coalesce(v_authorized_params->'data'->>'system_instructions', v_authorized_params->>'system_instructions', 'Instrucciones del agente'),
      coalesce(v_authorized_params->'data'->>'model_id', v_authorized_params->>'model_id', 'gpt-4o'),
      'draft', -- <--- OBLIGATORIO STATUS = 'draft'
      coalesce((coalesce(v_authorized_params->'data'->>'max_steps', v_authorized_params->>'max_steps'))::integer, 10),
      coalesce((coalesce(v_authorized_params->'data'->>'max_tokens', v_authorized_params->>'max_tokens'))::integer, 8000),
      coalesce((coalesce(v_authorized_params->'data'->>'timeout_seconds', v_authorized_params->>'timeout_seconds'))::integer, 60),
      coalesce((coalesce(v_authorized_params->'data'->>'max_tool_calls', v_authorized_params->>'max_tool_calls'))::integer, 5)
    )
    returning id, workspace_id, created_by, name, description, system_instructions, model_id, status, created_at, updated_at
    into v_agent_record;

    v_result_status := 'committed';
    v_result := to_jsonb(v_agent_record);
    v_target_id := v_agent_record.id;
  end if;

  -- 12. REGISTRO EN TOOL IDEMPOTENCY LEDGER DENTRO DE LA MISMA TRANSACCIÓN
  insert into public.tool_idempotency_ledger (
    workspace_id,
    run_id,
    step_id,
    tool_id,
    tool_version,
    execution_id,
    fencing_token,
    payload_hash,
    operation,
    target_table,
    target_record_id,
    status,
    result
  ) values (
    v_run.workspace_id,
    p_run_id,
    p_step_id,
    v_tool_id,
    v_tool_version,
    p_execution_id,
    p_fencing_token,
    v_computed_hash,
    v_operation,
    v_target_table,
    v_target_id,
    v_result_status,
    v_result
  )
  returning id into v_ledger_id;

  -- 13. ACTUALIZAR AGENT_RUN_STEPS A COMPLETED
  update public.agent_run_steps
  set status = 'completed',
      completed_at = clock_timestamp(),
      output = v_result
  where id = p_step_id;

  return jsonb_build_object(
    'success', true,
    'status', v_result_status,
    'ledger_id', v_ledger_id,
    'execution_id', p_execution_id,
    'fencing_token', p_fencing_token,
    'payload_hash', v_computed_hash,
    'data', v_result,
    'cached', false
  );
end;
$$;

revoke execute on function public.execute_authorized_database_write(uuid, uuid, uuid, bigint, text) from public;
grant execute on function public.execute_authorized_database_write(uuid, uuid, uuid, bigint, text) to authenticated, service_role;
