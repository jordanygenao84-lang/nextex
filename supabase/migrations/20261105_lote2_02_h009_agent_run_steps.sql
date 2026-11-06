-- ==============================================================================
-- NEXTEХ — MIGRACIÓN LOTE 2 (Paso 2/2): H-009 agent_run_steps Validation & RLS Hardening
-- Fecha: 2026-11-05
-- Propósito:
--   1. Eliminar la política permisiva INSERT de miembros (agent_run_steps_insert_member).
--      Justificación: El runtime pasa a service client en este mismo lote, y no existe
--      ningún flujo legítimo de inserción de pasos desde cliente de usuario.
--   2. Implementar el trigger validate_agent_run_step_insert (BEFORE INSERT) para todos los roles:
--      - El run referenciado debe existir y coincidir en workspace_id.
--      - El run NO debe encontrarse en estado terminal (completed, failed, cancelled, timeout).
--      - step_number debe ser estrictamente > 0 (sin exigir secuencia consecutiva ni índice único).
--      - tool_id:
--        * Si step_type IN ('TOOL_CALL', 'TOOL_RESULT', 'APPROVAL_REQUEST'): NOT NULL y asignado en public.agent_tools.
--        * Si step_type IN ('AI_REQUEST', 'VALIDATION', 'FINAL_RESPONSE'): estrictamente NULL.
--      - status inicial en INSERT debe ser IN ('pending', 'running', 'completed').
--
-- NOTA:
-- VALIDATION y FINAL_RESPONSE están en la lista cerrada (tipo TypeScript y CHECK existente
-- de la tabla) pero ningún código de src/ los construye hoy.
--
-- SQL INVERSO DE ROLLBACK (REVERTIR ESTA MIGRACIÓN):
-- drop trigger if exists tr_validate_agent_run_step_insert on public.agent_run_steps;
-- drop function if exists public.validate_agent_run_step_insert();
-- drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;
-- create policy "agent_run_steps_insert_member"
--   on public.agent_run_steps
--   for insert
--   with check (public.is_workspace_member(workspace_id, auth.uid()));
-- ==============================================================================

-- 1. ELIMINAR POLÍTICA PERMISIVA INSERT DE MIEMBROS EN agent_run_steps
drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;

-- 2. FUNCIÓN DE TRIGGER: validate_agent_run_step_insert
create or replace function public.validate_agent_run_step_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_run record;
begin
  -- A. El run referenciado debe existir y NEW.workspace_id debe coincidir con el del run
  select id, workspace_id, agent_id, status
  into v_run
  from public.agent_runs
  where id = new.run_id;

  if not found then
    raise exception 'INVALID_STEP_INSERT: El agent_run referenciado (%) no existe.', new.run_id
      using errcode = '23503';
  end if;

  if new.workspace_id is distinct from v_run.workspace_id then
    raise exception 'INVALID_STEP_INSERT: workspace_id (%) no coincide con el run referenciado (%).', new.workspace_id, v_run.workspace_id
      using errcode = '22000';
  end if;

  -- B. El run NO debe estar en estado terminal en el momento del INSERT
  if v_run.status in ('completed', 'failed', 'cancelled', 'timeout') then
    raise exception 'INVALID_STEP_INSERT: No se permite insertar pasos en un run terminal (estado actual: %).', v_run.status
      using errcode = '22000';
  end if;

  -- C. step_number debe ser estrictamente > 0
  if new.step_number is null or new.step_number <= 0 then
    raise exception 'INVALID_STEP_INSERT: step_number debe ser un entero estrictamente mayor a 0.'
      using errcode = '22000';
  end if;

  -- D. Validación de tool_id según step_type:
  -- Si step_type IN ('TOOL_CALL', 'TOOL_RESULT', 'APPROVAL_REQUEST'):
  -- tool_id debe ser NOT NULL y existir en public.agent_tools para el agent_id del run.
  -- Si step_type IN ('AI_REQUEST', 'VALIDATION', 'FINAL_RESPONSE'):
  -- tool_id debe ser NULL.
  if new.step_type in ('TOOL_CALL', 'TOOL_RESULT', 'APPROVAL_REQUEST') then
    if new.tool_id is null or trim(new.tool_id) = '' then
      raise exception 'INVALID_STEP_INSERT: tool_id es obligatorio para pasos de tipo %.', new.step_type
        using errcode = '22000';
    end if;

    if not exists (
      select 1
      from public.agent_tools
      where agent_id = v_run.agent_id
        and tool_id = new.tool_id
    ) then
      raise exception 'INVALID_STEP_INSERT: tool_id "%" no está asignado al agente (%) en public.agent_tools.', new.tool_id, v_run.agent_id
        using errcode = '22000';
    end if;
  elsif new.step_type in ('AI_REQUEST', 'VALIDATION', 'FINAL_RESPONSE') then
    if new.tool_id is not null then
      raise exception 'INVALID_STEP_INSERT: tool_id debe ser NULL para pasos de tipo %.', new.step_type
        using errcode = '22000';
    end if;
  end if;

  -- E. status en el INSERT debe ser IN ('pending', 'running', 'completed')
  if new.status not in ('pending', 'running', 'completed') then
    raise exception 'INVALID_STEP_INSERT: status inicial no permitido (%). Valores permitidos en INSERT: pending, running, completed.', new.status
      using errcode = '22000';
  end if;

  return new;
end;
$$;

-- 3. VINCULAR TRIGGER BEFORE INSERT EN agent_run_steps
drop trigger if exists tr_validate_agent_run_step_insert on public.agent_run_steps;
create trigger tr_validate_agent_run_step_insert
  before insert on public.agent_run_steps
  for each row execute function public.validate_agent_run_step_insert();
