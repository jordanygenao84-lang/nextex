-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.3
-- Tool Governance: Función Atómica Anti-Replay y Serialización de Aprobaciones
-- ==============================================================================

-- Eliminar versión anterior con firma obsoleta que recibía p_user_id externo
drop function if exists public.claim_agent_step_approval(uuid, uuid, text, text, uuid, text);

create or replace function public.claim_agent_step_approval(
  p_run_id uuid,
  p_step_id uuid,
  p_expected_hash text,
  p_decision text, -- 'approved' | 'rejected'
  p_comment text default null
)
returns table (
  success boolean,
  error_code text,
  error_message text,
  step_data jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_step record;
  v_run record;
  v_updated jsonb;
begin
  -- 1. Validar autenticación real de la sesión activa (auth.uid())
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return query select false, 'AUTH_REQUIRED', 'Sesión autenticada requerida para emitir aprobaciones.', null::jsonb;
    return;
  end if;

  -- 2. Validación estricta del parámetro de decisión (Bloqueante 4)
  if p_decision not in ('approved', 'rejected') then
    return query select false, 'TOOL_APPROVAL_INVALID', 'Decisión inválida. Valores permitidos: approved, rejected.', null::jsonb;
    return;
  end if;

  -- 3. Validar existencia del run y pertenencia del usuario al workspace
  select r.* into v_run
  from public.agent_runs r
  where r.id = p_run_id;

  if not found then
    return query select false, 'AGENT_NOT_FOUND', 'Run de agente no encontrado.', null::jsonb;
    return;
  end if;

  if not public.is_workspace_member(v_run.workspace_id, v_auth_user) then
    return query select false, 'AGENT_PERMISSION_DENIED', 'El usuario no posee permisos en este workspace.', null::jsonb;
    return;
  end if;

  -- 4. BLOQUEO EXCLUSIVO DE FILA (Serializa atómicamente solicitudes concurrentes)
  select * into v_step
  from public.agent_run_steps
  where id = p_step_id and run_id = p_run_id
  for update;

  if not found then
    return query select false, 'AGENT_NOT_FOUND', 'Paso de ejecución no encontrado en este run.', null::jsonb;
    return;
  end if;

  -- 5. Validar tipo de paso
  if v_step.step_type != 'APPROVAL_REQUEST' then
    return query select false, 'TOOL_APPROVAL_INVALID', 'El paso indicado no es una solicitud de aprobación.', null::jsonb;
    return;
  end if;

  -- 6. VALIDACIÓN ATÓMICA DE ESTADO (Anti-Replay físico en persistencia)
  if v_step.status != 'pending' then
    return query select false, 'TOOL_APPROVAL_REPLAY', 'La solicitud de aprobación ya fue procesada previamente.', null::jsonb;
    return;
  end if;

  -- 7. VALIDACIÓN CRIPTOGRÁFICA DE INTEGRIDAD (Anti-Tampering)
  if (v_step.input->>'payload_hash') is distinct from p_expected_hash then
    return query select false, 'TOOL_APPROVAL_INVALID', 'El hash del payload no coincide con la solicitud original.', null::jsonb;
    return;
  end if;

  -- 8. TRANSICIÓN ATÓMICA DE ESTADO
  update public.agent_run_steps
  set
    status = case when p_decision = 'approved' then 'completed' else 'failed' end,
    completed_at = clock_timestamp(),
    output = jsonb_build_object(
      'decision', p_decision,
      'approved_by', v_auth_user,
      'payload_hash', p_expected_hash,
      'comment', p_comment,
      'resolved_at', clock_timestamp()
    )
  where id = p_step_id
  returning to_jsonb(agent_run_steps.*) into v_updated;

  return query select true, null::text, null::text, v_updated;
end;
$$;

comment on function public.claim_agent_step_approval is 'Resuelve de forma atómica y serializada solicitudes de aprobación humana con verificación anti-replay y derivación estricta de auth.uid()';

revoke execute on function public.claim_agent_step_approval(uuid, uuid, text, text, text) from public;
grant execute on function public.claim_agent_step_approval(uuid, uuid, text, text, text) to authenticated, service_role;
