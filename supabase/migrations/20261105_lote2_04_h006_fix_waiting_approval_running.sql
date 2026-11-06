-- ==============================================================================
-- NEXTEХ — REMEDIACIÓN ETAPA A, LOTE 2, FIX H-006
-- Permitir waiting_approval -> running en protect_agent_run_transition.
--
-- Causa: la sección E del prompt del Lote 2 enumeró las transiciones solo
-- desde runtime.ts y afirmó que no existía waiting_approval -> running.
-- Esa transición SÍ existe en SQL: la RPC claim_agent_step_approval_v2
-- (Lote 1, migración 07, rama 'approved') pone el run en 'running' al
-- aprobar ("APPROVED NO SIGNIFICA COMPLETED": el run reanuda, el worker
-- ejecuta la herramienta y solo entonces completa). La misma transición
-- está en la v1 (20261004) y en la variante de self-approval del dueño
-- (20261028).
-- Al correr la migración 01 del Lote 2, el trigger empezó a rechazar esa
-- transición con AGENT_RUN_INVALID_TRANSITION y la RPC hacía rollback
-- completo (aprobación, step y run quedaban pending/pending/
-- waiting_approval): aprobar desde POST /api/control-plane/approvals
-- devolvía 500. El rechazo NO se rompió (run -> completed, permitido) y
-- la vía POST /api/approvals/[id]/approve tampoco (resumeRunWithApproval
-- lleva el run directo a completed).
-- La transición es segura de permitir: la autorización vive en la RPC
-- (membresía, has_permission JIT approvals.approve + tools.execute_<riesgo>,
-- hash del payload, reglas de self-approval, fencing_token + lease de 60s).
-- El trigger sigue bloqueando salidas de estados terminales y cualquier
-- otra transición no enumerada.
--
-- Cambio: una sola línea en la rama waiting_approval (se reemplaza la
-- función completa con CREATE OR REPLACE).
--
-- ROLLBACK (SQL inverso exacto): re-ejecutar la migración 01 del Lote 2
-- (20261105_lote2_01_h006_agent_runs.sql), que restaura la función con
-- waiting_approval -> completed solamente.
-- Verificación tras aplicar: aprobar una solicitud pendiente por RPC v2
-- debe devolver 200 con status approved (no 500); el run queda en running
-- con fencing_token incrementado y lease de ~60s.
-- ==============================================================================

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
  -- 3) waiting_approval -> completed | running
  --    (running: la RPC claim_agent_step_approval_v2 reanuda el run al aprobar;
  --    aprobado no significa completado; la autorización vive en la RPC.)
  if old.status = 'running' and new.status in ('waiting_approval', 'completed', 'failed', 'timeout', 'cancelled', 'queued') then
    return new;
  elsif old.status = 'queued' and new.status = 'running' then
    return new;
  elsif old.status = 'waiting_approval' and new.status in ('completed', 'running') then
    return new;
  else
    raise exception 'AGENT_RUN_INVALID_TRANSITION: Transición de estado no permitida de "%" a "%".', old.status, new.status
      using errcode = '22000';
  end if;

  return new;
end;
$$;
