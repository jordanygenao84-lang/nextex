-- ==============================================================================
-- NEXTEХ — MIGRACIÓN LOTE 2 (Paso 1/2): H-006 agent_runs Transition & RLS Hardening
-- Fecha: 2026-11-05
-- Propósito:
--   1. Eliminar la política UPDATE permisiva de miembros (agent_runs_update_member).
--      Justificación: Verificado en código, ningún flujo legítimo actualiza agent_runs
--      con cliente de usuario fuera del runtime, y el runtime pasa a service client en
--      este mismo lote; la política permisiva no se estrecha, se elimina.
--   2. Implementar el trigger protect_agent_run_transition (BEFORE UPDATE) para todos los roles:
--      - Bloquear transiciones desde estados terminales (completed, failed, cancelled, timeout).
--      - Permitir exclusivamente las transiciones autorizadas:
--        * running -> waiting_approval | completed | failed | timeout | cancelled | queued
--        * queued -> running
--        * waiting_approval -> completed
--      - Exigir inmutabilidad en id, workspace_id, agent_id, user_id, input, model_id y created_at.
--      - Permitir mutar job_run_id solo de NULL a un valor no nulo una sola vez.
--
-- RIESGO RESIDUAL DOCUMENTADO:
-- La política INSERT de miembros (agent_runs_insert_member) sigue permitiendo el INSERT
-- directo de una fila de run fabricada (auth.uid() = user_id + membresía). Dicha fila no puede
-- ejecutarse: la ejecución pasa exclusivamente por la RPC o por el runtime, y el paso fabricado
-- que requeriría queda bloqueado por la migración 02. Queda documentado como residual para un lote posterior.
--
-- SQL INVERSO DE ROLLBACK (REVERTIR ESTA MIGRACIÓN):
-- drop trigger if exists tr_protect_agent_run_transition on public.agent_runs;
-- drop function if exists public.protect_agent_run_transition();
-- drop policy if exists "agent_runs_update_member" on public.agent_runs;
-- create policy "agent_runs_update_member"
--   on public.agent_runs
--   for update
--   using (public.is_workspace_member(workspace_id, auth.uid()));
-- ==============================================================================

-- 1. ELIMINAR POLÍTICA PERMISIVA UPDATE DE MIEMBROS EN agent_runs
drop policy if exists "agent_runs_update_member" on public.agent_runs;

-- 2. FUNCIÓN DE TRIGGER: protect_agent_run_transition
create or replace function public.protect_agent_run_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- A. Inmutabilidad estricta de columnas fundacionales
  if old.id is distinct from new.id then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.workspace_id is distinct from new.workspace_id then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: workspace_id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.agent_id is distinct from new.agent_id then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: agent_id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.user_id is distinct from new.user_id then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: user_id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.input is distinct from new.input then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: input no puede ser modificado.' using errcode = '22000';
  end if;

  if old.model_id is distinct from new.model_id then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: model_id no puede ser modificado.' using errcode = '22000';
  end if;

  if old.created_at is distinct from new.created_at then
    raise exception 'AGENT_RUN_IMMUTABLE_FIELD: created_at no puede ser modificado.' using errcode = '22000';
  end if;

  -- B. Regla de job_run_id: solo puede transicionar de NULL a un valor no nulo, una sola vez
  if old.job_run_id is distinct from new.job_run_id then
    if old.job_run_id is not null or new.job_run_id is null then
      raise exception 'AGENT_RUN_JOB_ID_IMMUTABLE: job_run_id solo puede fijarse de NULL a un valor una sola vez.' using errcode = '22000';
    end if;
  end if;

  -- C. Si el estado no cambia, permitir la actualización de campos operativos (tokens, output, updated_at, etc.)
  if old.status = new.status then
    return new;
  end if;

  -- D. Si OLD.status es terminal, rechazar cualquier cambio de estado
  if old.status in ('completed', 'failed', 'cancelled', 'timeout') then
    raise exception 'AGENT_RUN_TERMINAL_STATE: El run se encuentra en estado terminal (%) y no admite cambios de estado.', old.status
      using errcode = '22000';
  end if;

  -- E. Máquina de estados real: transiciones permitidas
  -- 1) running -> waiting_approval | completed | failed | timeout | cancelled | queued
  -- 2) queued -> running
  -- 3) waiting_approval -> completed
  if old.status = 'running' and new.status in ('waiting_approval', 'completed', 'failed', 'timeout', 'cancelled', 'queued') then
    return new;
  elsif old.status = 'queued' and new.status = 'running' then
    return new;
  elsif old.status = 'waiting_approval' and new.status = 'completed' then
    return new;
  else
    raise exception 'AGENT_RUN_INVALID_TRANSITION: Transición de estado no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  end if;

  return new;
end;
$$;

-- 3. VINCULAR TRIGGER BEFORE UPDATE EN agent_runs
drop trigger if exists tr_protect_agent_run_transition on public.agent_runs;
create trigger tr_protect_agent_run_transition
  before update on public.agent_runs
  for each row execute function public.protect_agent_run_transition();
