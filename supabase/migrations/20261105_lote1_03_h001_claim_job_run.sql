-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 3 (H-001, crítica)
-- Endurecimiento de claim_job_run: solo service_role.
--
-- Cambios:
-- - REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO
--   service_role (mismo patrón que claim_job_run_v2, ya bien cerrada en
--   20261011_production_control_plane.sql:937-940).
-- - Cuerpo de la función SIN cambios de lógica (idéntico al de
--   20261016_fix_audit_log_new_status.sql:9-118), salvo la fila de
--   auditoría: ahora registra también el lease (lease_seconds y
--   lease_expires_at en job_audit_log.details), para que cada reclamación
--   quede con worker, run y lease.
-- - NO se añaden topes de lease en este lote (quedan para el Lote 6, H-027);
--   anotado aquí para no mezclar dos cambios en la misma función.
--
-- Llamadores verificados (sin cambio de código TS necesario):
-- - src/lib/jobs/queue/queue.ts claimNext() recibe el cliente por parámetro;
--   el único llamador vivo es el worker episódico
--   (src/lib/jobs/worker/worker.ts:48), invocado desde
--   src/app/api/internal/worker/tick/route.ts:49-50 con createServiceClient().
-- - src/lib/control-plane/Dispatcher.ts usa claim_job_run_v2, no esta RPC.
--
-- ROLLBACK (SQL inverso exacto):
--   grant execute on function public.claim_job_run(text, integer) to authenticated;
--   (La fila de auditoría con details es compatible hacia atrás; el rollback
--   solo necesita restaurar el grant. Para restaurar además el INSERT de
--   auditoría original, re-aplicar la función desde
--   supabase/migrations/20261016_fix_audit_log_new_status.sql:9-118
--   en origin/main 6f1b427 y luego los grants originales:
--     revoke execute on function public.claim_job_run(text, integer) from public;
--     grant execute on function public.claim_job_run(text, integer) to authenticated, service_role;)
-- ==============================================================================

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

    -- Registrar auditoría append-only: worker, run y lease (Lote 1, H-001).
    insert into public.job_audit_log (
      workspace_id, job_id, job_run_id, actor_type, actor_id, action, previous_status, new_status, fencing_token, worker_id, details
    ) values (
      v_claimed.workspace_id, v_claimed.job_id, v_claimed.id, 'worker', p_worker_id, 'claim', 'queued', 'claimed', v_claimed.fencing_token, p_worker_id,
      jsonb_build_object('lease_seconds', coalesce(p_lease_seconds, 60), 'lease_expires_at', v_claimed.lease_expires_at)
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
revoke execute on function public.claim_job_run(text, integer) from anon;
revoke execute on function public.claim_job_run(text, integer) from authenticated;
grant execute on function public.claim_job_run(text, integer) to service_role;
