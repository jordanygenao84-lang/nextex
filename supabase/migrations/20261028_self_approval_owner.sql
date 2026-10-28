-- Self-approval para el dueño (decisión JC 2026-10-27).
-- El RPC claim_agent_step_approval_v2 bloqueaba TODA autoaprobación cuando
-- no había fila en agent_policies (caso de todos los agentes creados desde
-- la app, que nunca inserta filas ahí) y cuando la fila decía 'blocked'.
-- Como JC es el único operador, eso dejaba la cola HITL sin resolutor.
-- Cambio mínimo: el dueño del workspace (o super admin) puede resolver
-- sus propias solicitudes; para admin/member el bloqueo sigue intacto.
-- El resto de validaciones JIT (permiso approvals.approve, riesgo,
-- hash anti-tampering, TTL, inmutabilidad) NO cambia. La reescritura es
-- CREATE OR REPLACE: los grants existentes se conservan.

create or replace function public.claim_agent_step_approval_v2(
  p_approval_id uuid,
  p_expected_hash text,
  p_decision text, -- 'approved' | 'rejected'
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_approval record;
  v_step record;
  v_run record;
  v_agent_policy record;
  v_member_role text;
  v_is_owner boolean;
  v_override record;
  v_has_approve_perm boolean;
  v_has_tool_risk_perm boolean;
  v_required_risk_perm text;
  v_new_token bigint;
  v_new_lease timestamptz;
begin
  -- 1. Validar autenticación
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  -- 2. Validar parámetro de decisión
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_INVALID', 'error_message', 'Decisión inválida. Valores permitidos: approved, rejected.');
  end if;

  -- 3. Bloqueo exclusivo de fila en approval_requests (SELECT FOR UPDATE)
  select * into v_approval
  from public.approval_requests
  where id = p_approval_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'APPROVAL_NOT_FOUND', 'error_message', 'Solicitud de aprobación no encontrada.');
  end if;

  -- 4. Validar estado y expiración TTL
  if v_approval.status <> 'pending' then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_REPLAY', 'error_message', 'La solicitud ya fue procesada previamente.');
  end if;

  if v_approval.expires_at <= clock_timestamp() then
    update public.approval_requests
    set status = 'expired', resolved_at = clock_timestamp(), comment = 'Expirado por TTL'
    where id = p_approval_id;

    update public.agent_run_steps
    set status = 'failed', completed_at = clock_timestamp(), error_code = 'APPROVAL_EXPIRED'
    where id = v_approval.step_id;

    return jsonb_build_object('success', false, 'error_code', 'APPROVAL_EXPIRED', 'error_message', 'La solicitud de aprobación ha expirado.');
  end if;

  -- 5. Validar pertenencia del aprobador al workspace
  select role into v_member_role
  from public.workspace_members
  where workspace_id = v_approval.workspace_id and user_id = v_auth_user;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'El aprobador no pertenece al workspace.');
  end if;

  -- 5b. Decisión JC 2026-10-27: el dueño del workspace (o super admin)
  -- puede resolver sus propias solicitudes (operador único). Para el
  -- resto de roles, el bloqueo de self-approval sigue vigente.
  v_is_owner := (v_member_role = 'owner')
    or coalesce((select is_super_admin from public.profiles where id = v_auth_user), false);

  -- 6. Bloqueo del Step y Run correspondientes
  select * into v_step from public.agent_run_steps where id = v_approval.step_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado.');
  end if;

  select * into v_run from public.agent_runs where id = v_approval.run_id;
  if not found or v_run.status <> 'waiting_approval' then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_STATUS_INVALID', 'error_message', 'El run no está esperando aprobación.');
  end if;

  -- 7. Validar Política de Agente y Self-Approval
  select * into v_agent_policy from public.agent_policies where agent_id = v_run.agent_id;
  if found then
    if not v_agent_policy.allow_execution then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_EXECUTION_BLOCKED', 'error_message', 'La política del agente prohíbe su ejecución.');
    end if;

    if v_approval.requester_id = v_auth_user and not v_is_owner and v_agent_policy.self_approval_mode <> 'allowed' then
      return jsonb_build_object('success', false, 'error_code', 'TOOL_SELF_APPROVAL_BLOCKED', 'error_message', 'Self-approval bloqueado: el iniciador del run no puede autorizar su propia solicitud.');
    end if;
  else
    -- Sin fila de política: self-approval bloqueado salvo dueño (decisión JC 2026-10-27)
    if v_approval.requester_id = v_auth_user and not v_is_owner then
      return jsonb_build_object('success', false, 'error_code', 'TOOL_SELF_APPROVAL_BLOCKED', 'error_message', 'Self-approval bloqueado por política del sistema.');
    end if;
  end if;

  -- 8. Validar Permisos JIT del Aprobador (Precedencia Deny-First)
  -- A) Permiso approvals.approve
  v_has_approve_perm := false;
  select * into v_override from public.workspace_permissions
  where workspace_id = v_approval.workspace_id and user_id = v_auth_user and permission_key = 'approvals.approve';

  if found then
    if v_override.effect = 'deny' then
      v_has_approve_perm := false;
    elsif v_override.effect = 'allow' then
      v_has_approve_perm := true;
    end if;
  else
    select exists (
      select 1 from public.role_permissions where role = v_member_role and permission_key = 'approvals.approve'
    ) into v_has_approve_perm;
  end if;

  if not v_has_approve_perm then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_UNAUTHORIZED', 'error_message', 'El usuario carece de permiso para emitir aprobaciones.');
  end if;

  -- B) Permiso para el nivel de riesgo de la herramienta
  v_required_risk_perm := 'tools.execute_' || v_approval.risk_level;
  v_has_tool_risk_perm := false;

  select * into v_override from public.workspace_permissions
  where workspace_id = v_approval.workspace_id and user_id = v_auth_user and permission_key = v_required_risk_perm;

  if found then
    if v_override.effect = 'deny' then
      v_has_tool_risk_perm := false;
    elsif v_override.effect = 'allow' then
      v_has_tool_risk_perm := true;
    end if;
  else
    select exists (
      select 1 from public.role_permissions where role = v_member_role and permission_key = v_required_risk_perm
    ) into v_has_tool_risk_perm;
  end if;

  if not v_has_tool_risk_perm then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_NOT_ALLOWED', 'error_message', 'El aprobador carece de permisos para el nivel de riesgo de la herramienta (' || v_required_risk_perm || ').');
  end if;

  -- 9. Validación Criptográfica Anti-Tampering
  if v_approval.payload_hash <> p_expected_hash then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_PAYLOAD_HASH_MISMATCH', 'error_message', 'El hash del payload no coincide con la solicitud original.');
  end if;

  -- 10. Transición Transaccional según Decisión
  if p_decision = 'rejected' then
    update public.approval_requests
    set status = 'rejected', approver_id = v_auth_user, resolved_at = clock_timestamp(), comment = p_comment
    where id = p_approval_id;

    update public.agent_run_steps
    set status = 'failed', completed_at = clock_timestamp(),
        output = jsonb_build_object('decision', 'rejected', 'approver_id', v_auth_user, 'comment', p_comment)
    where id = v_approval.step_id;

    update public.agent_runs
    set status = 'completed', output = '[ACCION DENEGADA]: El operador humano rechazó la ejecución de la herramienta.', completed_at = clock_timestamp()
    where id = v_approval.run_id;

    -- Auditoría
    insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_role, agent_id, run_id, step_id, tool_id, tool_version, payload_hash)
    values (v_approval.workspace_id, v_auth_user, 'approval.reject', 'tool', v_approval.tool_id, 'deny', coalesce(p_comment, 'Rechazo explícito'), v_member_role, v_run.agent_id, v_run.id, v_step.id, v_approval.tool_id, v_approval.tool_version, v_approval.payload_hash);

    return jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Solicitud rechazada exitosamente.');
  end if;

  -- DECISIÓN = 'approved'
  -- REGLA: APPROVED NO SIGNIFICA COMPLETED. Pone step en 'running' con nuevo token y lease.
  v_new_token := coalesce(v_step.fencing_token, 0) + 1;
  v_new_lease := clock_timestamp() + interval '60 seconds';

  update public.approval_requests
  set status = 'approved', approver_id = v_auth_user, resolved_at = clock_timestamp(), comment = p_comment
  where id = p_approval_id;

  update public.agent_run_steps
  set status = 'running',
      fencing_token = v_new_token,
      lease_expires_at = v_new_lease,
      output = jsonb_build_object('decision', 'approved', 'approver_id', v_auth_user, 'authorized_at', clock_timestamp())
  where id = v_approval.step_id;

  update public.agent_runs
  set status = 'running', updated_at = clock_timestamp()
  where id = v_approval.run_id;

  -- Auditoría
  insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_role, agent_id, run_id, step_id, tool_id, tool_version, payload_hash)
  values (v_approval.workspace_id, v_auth_user, 'approval.approve', 'tool', v_approval.tool_id, 'allow', coalesce(p_comment, 'Aprobación legítima'), v_member_role, v_run.agent_id, v_run.id, v_step.id, v_approval.tool_id, v_approval.tool_version, v_approval.payload_hash);

  return jsonb_build_object(
    'success', true,
    'status', 'approved',
    'step_id', v_approval.step_id,
    'fencing_token', v_new_token,
    'lease_expires_at', v_new_lease,
    'message', 'Solicitud aprobada; step transicionado a running para ejecución controlada.'
  );
end;
$$;
