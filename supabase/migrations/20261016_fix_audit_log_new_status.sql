-- ==============================================================================
-- NEXTEХ — MIGRACIÓN 20261016
-- Corrección de auditoría: Agregar valor 'new_status' en INSERTs de job_audit_log
-- Corrige error PostgreSQL 42601: "INSERT has more target columns than expressions"
-- Funciones afectadas: claim_job_run y complete_job_run
-- ==============================================================================

-- 1. RPC: claim_job_run (Corrige INSERT a job_audit_log agregando 'claimed' como new_status)
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

    -- Registrar auditoría append-only con exactamente 10 columnas y 10 valores
    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
    ) values (
      v_claimed.workspace_id, v_claimed.job_id, v_claimed.id, 'worker', p_worker_id, 'claim', 'queued', 'claimed', v_claimed.fencing_token, p_worker_id
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

-- 2. RPC: complete_job_run (Corrige INSERT a job_audit_log agregando 'completed' como new_status)
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

  -- Registrar auditoría append-only con exactamente 10 columnas y 10 valores
  insert into public.job_audit_log (
    workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id
  ) values (
    v_run.workspace_id, v_run.job_id, v_run.id, 'worker', p_worker_id, 'complete', v_run.status, 'completed', p_fencing_token, p_worker_id
  );

  return jsonb_build_object('success', true, 'status', 'completed');
end;
$$;

revoke execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) from public;
grant execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) to authenticated, service_role;
