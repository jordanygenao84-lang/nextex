-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.9.1
-- Reliability Hardening: Background Database Writes & Fencing Authority
-- ==============================================================================

-- 1. Actualización de execute_authorized_database_write:
-- Permite ejecución autorizada para background workers bajo service_role
-- derivando estrictamente la autoridad del JobRun y Agent persistidos en BD.

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
  v_auth_role text;
  v_effective_user_id uuid;
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
  v_job_run record;
  v_agent record;
begin
  -- 1. Reconstrucción de Autoridad: Identificación de Caller
  v_auth_user := auth.uid();
  v_auth_role := coalesce(auth.role(), '');

  -- 2. Validar existencia del run de agente y extraer workspace_id real de BD
  select * into v_run from public.agent_runs where id = p_run_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_RUN_NOT_FOUND', 'error_message', 'Run de agente no encontrado.');
  end if;

  if v_auth_user is not null then
    -- MODO INTERACTIVO: Validar membresía y rol de autorización del usuario en workspace_members
    select role into v_member_role
    from public.workspace_members
    where workspace_id = v_run.workspace_id and user_id = v_auth_user;

    if not found then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'El usuario no pertenece al workspace.');
    end if;

    if v_member_role not in ('owner', 'admin', 'member') then
      return jsonb_build_object('success', false, 'error_code', 'TOOL_UNAUTHORIZED_MUTATION', 'error_message', 'Rol de workspace no autorizado para ejecutar mutaciones.');
    end if;

    v_effective_user_id := v_auth_user;

  elsif v_auth_role = 'service_role' then
    -- MODO BACKGROUND WORKER (service_role): Derivación estricta de autoridad desde JobRun persistido
    -- El worker NO puede inventar workspace, agent, job_run ni tokens.
    if v_run.job_run_id is null then
      return jsonb_build_object(
        'success', false,
        'error_code', 'JOB_RUN_NOT_FOUND',
        'error_message', 'Ejecución bajo service_role exige que el AgentRun esté formalmente vinculado a un JobRun.'
      );
    end if;

    select * into v_job_run
    from public.job_runs
    where id = v_run.job_run_id and workspace_id = v_run.workspace_id;

    if not found then
      return jsonb_build_object(
        'success', false,
        'error_code', 'JOB_RUN_NOT_FOUND',
        'error_message', 'JobRun no encontrado o discrepancia cross-tenant en ejecución de service_role.'
      );
    end if;

    -- Validar que el JobRun esté activo
    if v_job_run.status not in ('claimed', 'running') then
      return jsonb_build_object(
        'success', false,
        'error_code', 'JOB_NOT_ACTIVE',
        'error_message', 'JobRun no se encuentra en estado activo claimed/running.'
      );
    end if;

    -- Validar lease temporal activo
    if v_job_run.lease_expires_at is null or v_job_run.lease_expires_at <= clock_timestamp() then
      return jsonb_build_object(
        'success', false,
        'error_code', 'TOOL_LEASE_EXPIRED',
        'error_message', 'El lease temporal del JobRun ha expirado.'
      );
    end if;

    -- Validar agente activo en el workspace
    select * into v_agent
    from public.agents
    where id = v_job_run.agent_id and workspace_id = v_run.workspace_id;

    if not found or v_agent.status <> 'active' then
      return jsonb_build_object(
        'success', false,
        'error_code', 'AGENT_NOT_ACTIVE',
        'error_message', 'El agente vinculado no existe o no está activo.'
      );
    end if;

    -- Validar que el creador del agente o usuario del run tenga membresía activa en el workspace
    select role into v_member_role
    from public.workspace_members
    where workspace_id = v_run.workspace_id and user_id = coalesce(v_run.user_id, v_agent.created_by);

    if not found or v_member_role not in ('owner', 'admin', 'member') then
      return jsonb_build_object(
        'success', false,
        'error_code', 'AGENT_PERMISSION_DENIED',
        'error_message', 'La identidad de ejecución no posee membresía autorizada en el workspace.'
      );
    end if;

    -- Fencing Token del JobRun
    if v_job_run.fencing_token <> p_fencing_token then
      return jsonb_build_object(
        'success', false,
        'error_code', 'TOOL_FENCING_REJECTED',
        'error_message', 'Fencing token del JobRun desfasado. El worker fue cercado fuera.'
      );
    end if;

    v_effective_user_id := coalesce(v_run.user_id, v_agent.created_by);

  else
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada o rol de servicio autorizado requerido.');
  end if;

  -- 4. SERIALIZACIÓN: Bloqueo exclusivo de fila sobre agent_run_steps
  select * into v_step
  from public.agent_run_steps
  where id = p_step_id and run_id = p_run_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado en este run.');
  end if;

  -- 5. Validar pertenencia estricta de tenant
  if v_step.workspace_id <> v_run.workspace_id then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_CROSS_TENANT_ACCESS', 'error_message', 'El paso no pertenece al workspace del run.');
  end if;

  -- 6. VALIDACIÓN DE EJECUTOR Y FENCING TOKEN
  if v_step.executor_id is not null and v_step.executor_id <> p_execution_id then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_FENCING_REJECTED',
      'error_message', 'Execution ID no coincide con el executor activo.'
    );
  end if;

  if v_step.fencing_token is not null and v_step.fencing_token > 0 and v_step.fencing_token <> p_fencing_token then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_FENCING_REJECTED',
      'error_message', 'Fencing token obsoleto o inválido. El executor fue cercado fuera.'
    );
  end if;

  -- 7. VALIDACIÓN DE ESTADO Y LEASE DEL STEP
  if v_step.status not in ('running', 'completed') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_STATUS_INVALID',
      'error_message', 'El paso no se encuentra en estado running ni completed.'
    );
  end if;

  if v_step.status = 'running' then
    if v_step.lease_expires_at is not null and v_step.lease_expires_at <= clock_timestamp() then
      return jsonb_build_object(
        'success', false,
        'error_code', 'TOOL_LEASE_EXPIRED',
        'error_message', 'El lease temporal del paso ha expirado.'
      );
    end if;
  end if;

  -- 8. OBTENCIÓN Y VALIDACIÓN CRIPTOGRÁFICA DEL PAYLOAD AUTORIZADO (ANTI-TAMPERING)
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

  -- 9. CONSULTA AL IDEMPOTENCY LEDGER (LEDGER HIT)
  select * into v_ledger
  from public.tool_idempotency_ledger
  where step_id = p_step_id;

  if found then
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

  if v_step.status = 'completed' then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_IDEMPOTENCY_CONFLICT',
      'error_message', 'El paso figura como completado pero no existe registro previo en el ledger.'
    );
  end if;

  -- 10. RESTRICCIÓN ESTRICTA DE TABLA DESTINO Y OPERACIÓN
  v_operation := lower(trim(coalesce(v_authorized_params->>'operation', 'insert')));
  v_target_table := lower(trim(coalesce(v_authorized_params->>'table', '')));

  if v_target_table not in ('conversations', 'agents') then
    return jsonb_build_object(
      'success', false,
      'error_code', 'TOOL_UNAUTHORIZED_MUTATION',
      'error_message', 'Tabla destino no autorizada. ai_usage y otras tablas están estrictamente prohibidas.'
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
        v_effective_user_id,
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
      v_effective_user_id,
      coalesce(v_authorized_params->'data'->>'name', v_authorized_params->>'name', 'Nuevo Agente'),
      coalesce(v_authorized_params->'data'->>'description', v_authorized_params->>'description'),
      coalesce(v_authorized_params->'data'->>'system_instructions', v_authorized_params->>'system_instructions', 'Instrucciones del agente'),
      coalesce(v_authorized_params->'data'->>'model_id', v_authorized_params->>'model_id', 'gpt-4o'),
      'draft',
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
