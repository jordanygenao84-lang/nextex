-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 7 (H-007)
-- Transición controlada de approval_requests: la vía RPC es la única que
-- puede resolver una solicitud pendiente.
--
-- (a) Política UPDATE: solo el solicitante puede tocar su propia solicitud
--     pendiente, y solo para cancelarla (WITH CHECK status = 'cancelled').
--     Nadie modifica status/approver_id directamente. La política INSERT
--     queda como está (el runtime inserta la solicitud con cliente de
--     usuario). Las RPC SECURITY DEFINER no pasan por RLS, así que la
--     resolución por RPC no se ve afectada por esta política.
-- (b) Trigger protect_approval_transition (NUEVO): rechaza cualquier UPDATE
--     que mueva pending -> approved/rejected/expired salvo cuando lo ejecuta
--     claim_agent_step_approval_v2, señalizado con
--     set_config('nextex.approval_via_rpc','true', true) dentro de la RPC
--     (local a la transacción) y leído por el trigger. Fuera de la RPC, una
--     cancelación directa solo puede cambiar status, resolved_at y comment;
--     el resto de columnas (approver_id, requester_id, workspace_id, run_id,
--     step_id, tool_id, tool_version, required_permission, risk_level,
--     payload_hash, expires_at, created_at) es intocable. El trigger
--     existente protect_immutable_approval SE CONSERVA intacto (sigue
--     impidiendo reabrir solicitudes ya resueltas); este trigger lo amplía
--     gobernando las salidas de 'pending'.
-- (c) claim_agent_step_approval_v2: exige permiso efectivo vía el
--     has_permission corregido (paso 2) para 'approvals.approve' y para el
--     nivel de riesgo ('tools.execute_' || risk_level); approver_id =
--     auth.uid() (ya lo era: v_auth_user := auth.uid() y los UPDATE ponen
--     approver_id = v_auth_user); hash de integridad, TTL vigente y
--     auditoría se conservan tal cual. Las comprobaciones JIT inline
--     (override/rol) se sustituyen por has_permission, que hace lo mismo
--     más los guardias nuevos (identidad, workspace, usuario activo).
--     El resto de la RPC (self-approval del dueño, transiciones de step y
--     run, auditoría) NO cambia. Los grants se conservan (CREATE OR REPLACE
--     no los toca): authenticated y service_role.
--
-- SEGUIMIENTO OBLIGATORIO ANTES/DURANTE EL DESPLIEGUE (hallazgo de la
-- revisión de llamadores, NO inventariado en el plan):
-- POST /api/control-plane/approvals hace UPDATE DIRECTO sobre
-- approval_requests con el cliente del usuario tras evaluar con
-- GovernanceManager (src/app/api/control-plane/approvals/route.ts:160),
-- y la página /control-plane/approvals lo usa para aprobar/rechazar.
-- Tras esta migración, esa ruta FALLARÁ (el trigger rechaza la transición
-- directa con APPROVAL_TRANSITION_DENIED) hasta que se migre a llamar a
-- claim_agent_step_approval_v2. Es un cambio TS de una sola ruta, fuera
-- del alcance de este lote (solo se permitía tocar Dispatcher/queue/tick,
-- que no necesitaron cambios). NO desplegar el Lote 1 sin esa migración
-- de la ruta, o la bandeja de aprobaciones del control-plane quedará rota.
-- Las otras dos vías vivas (/api/approvals/[id]/approve|reject y
-- /api/agents/[id]/runs/[runId]/approval) ya van por la RPC v2
-- (resumeRunWithApproval -> resolveApproval) y NO se ven afectadas.
-- La RPC v1 claim_agent_step_approval no tiene llamadores en src/ ni en
-- SQL; tras esta migración sus transiciones también quedan bloqueadas
-- (no pone la señal). Queda inerte; se propone revocarla o eliminarla
-- en un lote posterior, no en este.
--
-- ROLLBACK (SQL inverso exacto):
--   1) Restaurar la política UPDATE anterior:
--        drop policy if exists "approval_requests_update_member" on public.approval_requests;
--        create policy "approval_requests_update_member"
--          on public.approval_requests
--          for update
--          using (public.is_workspace_member(workspace_id, auth.uid()))
--          with check (public.is_workspace_member(workspace_id, auth.uid()));
--   2) Eliminar el trigger nuevo y su función:
--        drop trigger if exists tr_protect_approval_transition on public.approval_requests;
--        drop function if exists public.protect_approval_transition();
--   3) Restaurar claim_agent_step_approval_v2 a su cuerpo anterior
--      (supabase/migrations/20261028_self_approval_owner.sql:12-224,
--      origin/main 6f1b427), íntegro a continuación:
--   create or replace function public.claim_agent_step_approval_v2(
--     p_approval_id uuid,
--     p_expected_hash text,
--     p_decision text, -- 'approved' | 'rejected'
--     p_comment text default null
--   )
--   returns jsonb
--   language plpgsql
--   security definer
--   set search_path = pg_catalog, public, pg_temp
--   as $$
--   declare
--     v_auth_user uuid;
--     v_approval record;
--     v_step record;
--     v_run record;
--     v_agent_policy record;
--     v_member_role text;
--     v_is_owner boolean;
--     v_override record;
--     v_has_approve_perm boolean;
--     v_has_tool_risk_perm boolean;
--     v_required_risk_perm text;
--     v_new_token bigint;
--     v_new_lease timestamptz;
--   begin
--     -- 1. Validar autenticación
--     v_auth_user := auth.uid();
--     if v_auth_user is null then
--       return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
--     end if;
--   
--     -- 2. Validar parámetro de decisión
--     if p_decision not in ('approved', 'rejected') then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_INVALID', 'error_message', 'Decisión inválida. Valores permitidos: approved, rejected.');
--     end if;
--   
--     -- 3. Bloqueo exclusivo de fila en approval_requests (SELECT FOR UPDATE)
--     select * into v_approval
--     from public.approval_requests
--     where id = p_approval_id
--     for update;
--   
--     if not found then
--       return jsonb_build_object('success', false, 'error_code', 'APPROVAL_NOT_FOUND', 'error_message', 'Solicitud de aprobación no encontrada.');
--     end if;
--   
--     -- 4. Validar estado y expiración TTL
--     if v_approval.status <> 'pending' then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_REPLAY', 'error_message', 'La solicitud ya fue procesada previamente.');
--     end if;
--   
--     if v_approval.expires_at <= clock_timestamp() then
--       update public.approval_requests
--       set status = 'expired', resolved_at = clock_timestamp(), comment = 'Expirado por TTL'
--       where id = p_approval_id;
--   
--       update public.agent_run_steps
--       set status = 'failed', completed_at = clock_timestamp(), error_code = 'APPROVAL_EXPIRED'
--       where id = v_approval.step_id;
--   
--       return jsonb_build_object('success', false, 'error_code', 'APPROVAL_EXPIRED', 'error_message', 'La solicitud de aprobación ha expirado.');
--     end if;
--   
--     -- 5. Validar pertenencia del aprobador al workspace
--     select role into v_member_role
--     from public.workspace_members
--     where workspace_id = v_approval.workspace_id and user_id = v_auth_user;
--   
--     if not found then
--       return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'El aprobador no pertenece al workspace.');
--     end if;
--   
--     -- 5b. Decisión JC 2026-10-27: el dueño del workspace (o super admin)
--     -- puede resolver sus propias solicitudes (operador único). Para el
--     -- resto de roles, el bloqueo de self-approval sigue vigente.
--     v_is_owner := (v_member_role = 'owner')
--       or coalesce((select is_super_admin from public.profiles where id = v_auth_user), false);
--   
--     -- 6. Bloqueo del Step y Run correspondientes
--     select * into v_step from public.agent_run_steps where id = v_approval.step_id for update;
--     if not found then
--       return jsonb_build_object('success', false, 'error_code', 'STEP_NOT_FOUND', 'error_message', 'Paso de ejecución no encontrado.');
--     end if;
--   
--     select * into v_run from public.agent_runs where id = v_approval.run_id;
--     if not found or v_run.status <> 'waiting_approval' then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_STATUS_INVALID', 'error_message', 'El run no está esperando aprobación.');
--     end if;
--   
--     -- 7. Validar Política de Agente y Self-Approval
--     select * into v_agent_policy from public.agent_policies where agent_id = v_run.agent_id;
--     if found then
--       if not v_agent_policy.allow_execution then
--         return jsonb_build_object('success', false, 'error_code', 'AGENT_EXECUTION_BLOCKED', 'error_message', 'La política del agente prohíbe su ejecución.');
--       end if;
--   
--       if v_approval.requester_id = v_auth_user and not v_is_owner and v_agent_policy.self_approval_mode <> 'allowed' then
--         return jsonb_build_object('success', false, 'error_code', 'TOOL_SELF_APPROVAL_BLOCKED', 'error_message', 'Self-approval bloqueado: el iniciador del run no puede autorizar su propia solicitud.');
--       end if;
--     else
--       -- Sin fila de política: self-approval bloqueado salvo dueño (decisión JC 2026-10-27)
--       if v_approval.requester_id = v_auth_user and not v_is_owner then
--         return jsonb_build_object('success', false, 'error_code', 'TOOL_SELF_APPROVAL_BLOCKED', 'error_message', 'Self-approval bloqueado por política del sistema.');
--       end if;
--     end if;
--   
--     -- 8. Validar Permisos JIT del Aprobador (Precedencia Deny-First)
--     -- A) Permiso approvals.approve
--     v_has_approve_perm := false;
--     select * into v_override from public.workspace_permissions
--     where workspace_id = v_approval.workspace_id and user_id = v_auth_user and permission_key = 'approvals.approve';
--   
--     if found then
--       if v_override.effect = 'deny' then
--         v_has_approve_perm := false;
--       elsif v_override.effect = 'allow' then
--         v_has_approve_perm := true;
--       end if;
--     else
--       select exists (
--         select 1 from public.role_permissions where role = v_member_role and permission_key = 'approvals.approve'
--       ) into v_has_approve_perm;
--     end if;
--   
--     if not v_has_approve_perm then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_UNAUTHORIZED', 'error_message', 'El usuario carece de permiso para emitir aprobaciones.');
--     end if;
--   
--     -- B) Permiso para el nivel de riesgo de la herramienta
--     v_required_risk_perm := 'tools.execute_' || v_approval.risk_level;
--     v_has_tool_risk_perm := false;
--   
--     select * into v_override from public.workspace_permissions
--     where workspace_id = v_approval.workspace_id and user_id = v_auth_user and permission_key = v_required_risk_perm;
--   
--     if found then
--       if v_override.effect = 'deny' then
--         v_has_tool_risk_perm := false;
--       elsif v_override.effect = 'allow' then
--         v_has_tool_risk_perm := true;
--       end if;
--     else
--       select exists (
--         select 1 from public.role_permissions where role = v_member_role and permission_key = v_required_risk_perm
--       ) into v_has_tool_risk_perm;
--     end if;
--   
--     if not v_has_tool_risk_perm then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_NOT_ALLOWED', 'error_message', 'El aprobador carece de permisos para el nivel de riesgo de la herramienta (' || v_required_risk_perm || ').');
--     end if;
--   
--     -- 9. Validación Criptográfica Anti-Tampering
--     if v_approval.payload_hash <> p_expected_hash then
--       return jsonb_build_object('success', false, 'error_code', 'TOOL_PAYLOAD_HASH_MISMATCH', 'error_message', 'El hash del payload no coincide con la solicitud original.');
--     end if;
--   
--     -- 10. Transición Transaccional según Decisión
--     if p_decision = 'rejected' then
--       update public.approval_requests
--       set status = 'rejected', approver_id = v_auth_user, resolved_at = clock_timestamp(), comment = p_comment
--       where id = p_approval_id;
--   
--       update public.agent_run_steps
--       set status = 'failed', completed_at = clock_timestamp(),
--           output = jsonb_build_object('decision', 'rejected', 'approver_id', v_auth_user, 'comment', p_comment)
--       where id = v_approval.step_id;
--   
--       update public.agent_runs
--       set status = 'completed', output = '[ACCION DENEGADA]: El operador humano rechazó la ejecución de la herramienta.', completed_at = clock_timestamp()
--       where id = v_approval.run_id;
--   
--       -- Auditoría
--       insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_role, agent_id, run_id, step_id, tool_id, tool_version, payload_hash)
--       values (v_approval.workspace_id, v_auth_user, 'approval.reject', 'tool', v_approval.tool_id, 'deny', coalesce(p_comment, 'Rechazo explícito'), v_member_role, v_run.agent_id, v_run.id, v_step.id, v_approval.tool_id, v_approval.tool_version, v_approval.payload_hash);
--   
--       return jsonb_build_object('success', true, 'status', 'rejected', 'message', 'Solicitud rechazada exitosamente.');
--     end if;
--   
--     -- DECISIÓN = 'approved'
--     -- REGLA: APPROVED NO SIGNIFICA COMPLETED. Pone step en 'running' con nuevo token y lease.
--     v_new_token := coalesce(v_step.fencing_token, 0) + 1;
--     v_new_lease := clock_timestamp() + interval '60 seconds';
--   
--     update public.approval_requests
--     set status = 'approved', approver_id = v_auth_user, resolved_at = clock_timestamp(), comment = p_comment
--     where id = p_approval_id;
--   
--     update public.agent_run_steps
--     set status = 'running',
--         fencing_token = v_new_token,
--         lease_expires_at = v_new_lease,
--         output = jsonb_build_object('decision', 'approved', 'approver_id', v_auth_user, 'authorized_at', clock_timestamp())
--     where id = v_approval.step_id;
--   
--     update public.agent_runs
--     set status = 'running', updated_at = clock_timestamp()
--     where id = v_approval.run_id;
--   
--     -- Auditoría
--     insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_role, agent_id, run_id, step_id, tool_id, tool_version, payload_hash)
--     values (v_approval.workspace_id, v_auth_user, 'approval.approve', 'tool', v_approval.tool_id, 'allow', coalesce(p_comment, 'Aprobación legítima'), v_member_role, v_run.agent_id, v_run.id, v_step.id, v_approval.tool_id, v_approval.tool_version, v_approval.payload_hash);
--   
--     return jsonb_build_object(
--       'success', true,
--       'status', 'approved',
--       'step_id', v_approval.step_id,
--       'fencing_token', v_new_token,
--       'lease_expires_at', v_new_lease,
--       'message', 'Solicitud aprobada; step transicionado a running para ejecución controlada.'
--     );
--   end;
--   $$;
-- ==============================================================================

-- (a) Política UPDATE: solo el solicitante cancela su propia solicitud pendiente.
drop policy if exists "approval_requests_update_member" on public.approval_requests;
create policy "approval_requests_update_member"
  on public.approval_requests
  for update
  using (public.is_workspace_member(workspace_id, auth.uid()) and status = 'pending' and requester_id = auth.uid())
  with check (public.is_workspace_member(workspace_id, auth.uid()) and status = 'cancelled' and requester_id = auth.uid());

-- (b) Trigger de transición controlada (nuevo). Se conserva
-- tr_protect_immutable_approval sin tocarlo.
create or replace function public.protect_approval_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_via_rpc boolean := coalesce(current_setting('nextex.approval_via_rpc', true)::boolean, false);
begin
  -- Salidas de 'pending' fuera de la RPC controlada.
  if old.status = 'pending' and not v_via_rpc then
    if new.status in ('approved', 'rejected', 'expired') then
      raise exception 'APPROVAL_TRANSITION_DENIED: Solo claim_agent_step_approval_v2 puede resolver una solicitud pendiente (intento directo a %).', new.status;
    end if;

    -- Cancelación directa: solo status, resolved_at y comment pueden cambiar.
    if new.approver_id is distinct from old.approver_id
      or new.requester_id is distinct from old.requester_id
      or new.workspace_id is distinct from old.workspace_id
      or new.run_id is distinct from old.run_id
      or new.step_id is distinct from old.step_id
      or new.tool_id is distinct from old.tool_id
      or new.tool_version is distinct from old.tool_version
      or new.required_permission is distinct from old.required_permission
      or new.risk_level is distinct from old.risk_level
      or new.payload_hash is distinct from old.payload_hash
      or new.expires_at is distinct from old.expires_at
      or new.created_at is distinct from old.created_at then
      raise exception 'APPROVAL_CANCEL_DENIED: La cancelación directa solo puede cambiar status, resolved_at y comment.';
    end if;
    -- new.status = 'pending' (sin cambio de estado) o 'cancelled' con los
    -- campos protegidos intactos: permitido. Cualquier otro estado ya se
    -- rechazó arriba (o lo rechaza el CHECK de la tabla).
  end if;

  -- Fila ya resuelta: la inmutabilidad de estado la cubre
  -- protect_immutable_approval; aquí se bloquean además los cambios a
  -- campos protegidos fuera de la RPC.
  if old.status <> 'pending' and not v_via_rpc then
    if new.approver_id is distinct from old.approver_id
      or new.requester_id is distinct from old.requester_id
      or new.workspace_id is distinct from old.workspace_id
      or new.run_id is distinct from old.run_id
      or new.step_id is distinct from old.step_id
      or new.tool_id is distinct from old.tool_id
      or new.tool_version is distinct from old.tool_version
      or new.required_permission is distinct from old.required_permission
      or new.risk_level is distinct from old.risk_level
      or new.payload_hash is distinct from old.payload_hash
      or new.expires_at is distinct from old.expires_at
      or new.created_at is distinct from old.created_at then
      raise exception 'APPROVAL_IMMUTABLE_FIELDS: Una solicitud resuelta no admite cambios a sus campos protegidos fuera de la RPC.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tr_protect_approval_transition on public.approval_requests;
create trigger tr_protect_approval_transition
  before update on public.approval_requests
  for each row execute function public.protect_approval_transition();

-- (c) claim_agent_step_approval_v2 con permiso vía has_permission y señal
-- transaccional para el trigger. Resto de la lógica intacto.
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
  v_required_risk_perm text;
  v_new_token bigint;
  v_new_lease timestamptz;
begin
  -- 1. Validar autenticación
  v_auth_user := auth.uid();
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  -- 1b. Señal transaccional para el trigger protect_approval_transition:
  --     solo esta RPC puede mover pending -> approved/rejected/expired.
  --     set_config(..., true) es local a la transacción: se resetea sola al
  --     terminar la llamada RPC (PostgREST envuelve cada RPC en una
  --     transacción). Ver migración 07, trigger tr_protect_approval_transition.
  perform set_config('nextex.approval_via_rpc', 'true', true);

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

  -- 8. Validar Permisos JIT del Aprobador vía has_permission corregido
  --    (Lote 1, paso 2: identidad, workspace, usuario activo, membresía,
  --    deny-first, matriz). El amarre al llamador ya está dentro.
  -- A) Permiso approvals.approve
  if not public.has_permission(v_auth_user, v_approval.workspace_id, 'approvals.approve') then
    return jsonb_build_object('success', false, 'error_code', 'TOOL_APPROVAL_UNAUTHORIZED', 'error_message', 'El usuario carece de permiso para emitir aprobaciones.');
  end if;

  -- B) Permiso para el nivel de riesgo de la herramienta
  v_required_risk_perm := 'tools.execute_' || v_approval.risk_level;

  if not public.has_permission(v_auth_user, v_approval.workspace_id, v_required_risk_perm) then
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
