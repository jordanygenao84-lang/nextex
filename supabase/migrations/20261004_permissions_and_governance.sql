-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.4
-- Permissions, Role Permissions, Workspace Overrides, Agent Policies,
-- Approval Requests (HITL), Concurrency Limits & Authorization Audit Log
-- ==============================================================================

create extension if not exists pgcrypto;

-- 1. TABLA: permissions (Catálogo Canónico Server-Owned de 22 Permisos)
create table if not exists public.permissions (
  id text primary key,
  key text not null unique,
  category text not null check (category in ('agents', 'runs', 'tools', 'approvals', 'workspace')),
  description text not null,
  created_at timestamptz not null default now()
);

comment on table public.permissions is 'Catálogo inmutable de 22 permisos canónicos gobernados exclusivamente por el servidor';

-- Seeding declarativo de los 22 permisos
insert into public.permissions (id, key, category, description)
values
  ('agents.read', 'agents.read', 'agents', 'Visualizar agentes y sus configuraciones en el workspace'),
  ('agents.create', 'agents.create', 'agents', 'Registrar y configurar nuevos agentes autónomos'),
  ('agents.update', 'agents.update', 'agents', 'Modificar instrucciones, modelos y parámetros de agentes existentes'),
  ('agents.delete', 'agents.delete', 'agents', 'Eliminar agentes del workspace'),
  ('agents.activate', 'agents.activate', 'agents', 'Activar agentes para habilitar su ejecución'),
  ('agents.pause', 'agents.pause', 'agents', 'Pausar agentes suspendiendo nuevas ejecuciones'),
  ('runs.read', 'runs.read', 'runs', 'Consultar historial y telemetría de runs y steps'),
  ('runs.execute', 'runs.execute', 'runs', 'Iniciar y despachar nuevas ejecuciones de agentes'),
  ('runs.cancel', 'runs.cancel', 'runs', 'Cancelar runs en ejecución activa'),
  ('tools.read', 'tools.read', 'tools', 'Descubrir herramientas disponibles en el catálogo'),
  ('tools.execute', 'tools.execute', 'tools', 'Permiso base para invocar herramientas asignadas'),
  ('tools.execute_read', 'tools.execute_read', 'tools', 'Ejecutar herramientas de lectura o riesgo nulo'),
  ('tools.execute_write', 'tools.execute_write', 'tools', 'Ejecutar herramientas mutativas de base de datos'),
  ('tools.execute_external', 'tools.execute_external', 'tools', 'Ejecutar herramientas que consumen APIs o servicios externos'),
  ('tools.execute_destructive', 'tools.execute_destructive', 'tools', 'Ejecutar operaciones destructivas o irreversibles'),
  ('approvals.read', 'approvals.read', 'approvals', 'Listar y auditar solicitudes de aprobación humana'),
  ('approvals.approve', 'approvals.approve', 'approvals', 'Aprobar solicitudes de ejecución protegidas'),
  ('approvals.reject', 'approvals.reject', 'approvals', 'Rechazar solicitudes de ejecución protegidas'),
  ('workspace.members.read', 'workspace.members.read', 'workspace', 'Visualizar miembros, roles y estados del workspace'),
  ('workspace.members.manage', 'workspace.members.manage', 'workspace', 'Invitar, modificar roles y desasociar miembros'),
  ('workspace.settings.read', 'workspace.settings.read', 'workspace', 'Consultar configuraciones y cuotas del workspace'),
  ('workspace.settings.update', 'workspace.settings.update', 'workspace', 'Modificar configuraciones globales del workspace')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 2. TABLA: role_permissions (Matriz de Permisos Base por Rol)
create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('owner', 'admin', 'member')),
  permission_key text not null references public.permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role, permission_key)
);

comment on table public.role_permissions is 'Asignación declarativa de permisos por defecto para cada rol base';

-- Seeding de la Matriz Base por Rol
-- OWNER: Los 22 permisos
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 18 permisos (excluye tools.execute_destructive, workspace.members.manage, workspace.settings.update)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- MEMBER: 8 permisos operativos de lectura y ejecución básica
insert into public.role_permissions (role, permission_key)
values
  ('member', 'agents.read'),
  ('member', 'runs.read'),
  ('member', 'runs.execute'),
  ('member', 'runs.cancel'),
  ('member', 'tools.read'),
  ('member', 'tools.execute'),
  ('member', 'tools.execute_read'),
  ('member', 'approvals.read'),
  ('member', 'workspace.members.read')
on conflict (role, permission_key) do nothing;

-- 3. TABLA: workspace_permissions (Overrides Explícitos por Miembro con Precedencia)
create table if not exists public.workspace_permissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  effect text not null check (effect in ('allow', 'deny')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, permission_key)
);

comment on table public.workspace_permissions is 'Overrides explícitos de permisos por miembro (allow/deny) con precedencia sobre el rol';

create index if not exists idx_workspace_permissions_lookup 
  on public.workspace_permissions (workspace_id, user_id, permission_key);

drop trigger if exists tr_workspace_permissions_updated_at on public.workspace_permissions;
create trigger tr_workspace_permissions_updated_at
  before update on public.workspace_permissions
  for each row execute function public.handle_updated_at();

-- Trigger de Barrera Física: Jerarquía Administrativa Inviolable
create or replace function public.protect_permission_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_caller_role text;
  v_target_role text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return new; -- Permitir si proviene de seedings internos/service_role
  end if;

  -- 1. Obtener rol del caller en el workspace
  select role into v_caller_role
  from public.workspace_members
  where workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and user_id = v_caller;

  if v_caller_role is null then
    raise exception 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: El usuario ejecutor no pertenece a este workspace.';
  end if;

  if v_caller_role = 'member' then
    raise exception 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: Los usuarios con rol member no pueden administrar permisos.';
  end if;

  -- 2. Anti-Auto-Modificación de Privilegios Administrativos
  if coalesce(new.user_id, old.user_id) = v_caller then
    raise exception 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: No se permite modificar los propios privilegios administrativos.';
  end if;

  -- 3. Obtener rol del target user
  select role into v_target_role
  from public.workspace_members
  where workspace_id = coalesce(new.workspace_id, old.workspace_id)
    and user_id = coalesce(new.user_id, old.user_id);

  -- 4. Inmunidad del Owner: Un admin no puede alterar permisos del Owner
  if v_target_role = 'owner' and v_caller_role <> 'owner' then
    raise exception 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: Los administradores no pueden alterar ni denegar permisos del Owner.';
  end if;

  -- 5. Restricción entre pares: Un admin no puede alterar a otro admin
  if v_target_role = 'admin' and v_caller_role = 'admin' then
    raise exception 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY: Los administradores no pueden alterar permisos de otros administradores.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tr_protect_permission_hierarchy on public.workspace_permissions;
create trigger tr_protect_permission_hierarchy
  before insert or update or delete on public.workspace_permissions
  for each row execute function public.protect_permission_hierarchy();

-- 4. TABLA: agent_policies (Políticas Declarativas por Agente)
create table if not exists public.agent_policies (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  allow_execution boolean not null default true,
  allowed_tool_risks text[] not null default array['read', 'write']::text[],
  approval_mode text not null default 'required' check (approval_mode in ('automatic', 'required', 'conditional')),
  self_approval_mode text not null default 'blocked' check (self_approval_mode in ('blocked', 'allowed')),
  max_concurrent_runs integer not null default 3 check (max_concurrent_runs between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agent_policies is 'Políticas de seguridad, riesgos tolerados, modos de aprobación y cuotas de concurrencia por agente';

create index if not exists idx_agent_policies_workspace on public.agent_policies (workspace_id);
create index if not exists idx_agent_policies_agent on public.agent_policies (agent_id);

drop trigger if exists tr_agent_policies_updated_at on public.agent_policies;
create trigger tr_agent_policies_updated_at
  before update on public.agent_policies
  for each row execute function public.handle_updated_at();

-- Seeding de políticas por defecto para agentes existentes en BD
insert into public.agent_policies (agent_id, workspace_id, allow_execution, allowed_tool_risks, approval_mode, self_approval_mode, max_concurrent_runs)
select id, workspace_id, true, array['read', 'write', 'external']::text[], 'required', 'blocked', 3
from public.agents
on conflict (agent_id) do nothing;

-- 5. TABLA: approval_requests (Entidad Formal de Gobernanza HITL 1:1 con agent_run_steps)
create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id uuid not null references public.agent_run_steps(id) on delete cascade unique,
  tool_id text not null,
  tool_version text not null default '1.0.0',
  requester_id uuid not null references auth.users(id) on delete cascade,
  required_permission text not null references public.permissions(key) on delete restrict,
  risk_level text not null check (risk_level in ('read', 'write', 'external', 'destructive')),
  payload_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  approver_id uuid references auth.users(id) on delete set null,
  comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);

comment on table public.approval_requests is 'Registro formal de auditoría y ciclo de vida de solicitudes de aprobación humana (HITL)';

create index if not exists idx_approval_requests_workspace on public.approval_requests (workspace_id);
create index if not exists idx_approval_requests_run on public.approval_requests (run_id);
create index if not exists idx_approval_requests_step on public.approval_requests (step_id);
create index if not exists idx_approval_requests_status on public.approval_requests (status, expires_at);

-- Trigger de Inmutabilidad de Aprobación Resuelta
create or replace function public.protect_immutable_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.status in ('approved', 'rejected', 'expired', 'cancelled') and new.status <> old.status then
    raise exception 'APPROVAL_IMMUTABLE: Una solicitud de aprobación resuelta no puede ser reabierta ni modificada.';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_protect_immutable_approval on public.approval_requests;
create trigger tr_protect_immutable_approval
  before update on public.approval_requests
  for each row execute function public.protect_immutable_approval();

-- 6. TABLA: authorization_audit_log (Auditoría Estructurada sin Chain-of-Thought)
create table if not exists public.authorization_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  decision text not null check (decision in ('allow', 'deny', 'approval_required')),
  reason text not null,
  evaluated_role text,
  evaluated_permissions jsonb,
  agent_id uuid,
  run_id uuid,
  step_id uuid,
  tool_id text,
  tool_version text,
  payload_hash text,
  created_at timestamptz not null default now()
);

comment on table public.authorization_audit_log is 'Registro de auditoría estricto de decisiones de autorización (sin chain-of-thought)';

create index if not exists idx_authz_audit_workspace on public.authorization_audit_log (workspace_id);
create index if not exists idx_authz_audit_actor on public.authorization_audit_log (actor_id);
create index if not exists idx_authz_audit_created on public.authorization_audit_log (created_at);

-- 7. RPC TRANSACCIONAL: claim_agent_step_approval_v2
-- DESACOPLAMIENTO: APPROVED NO SIGNIFICA COMPLETED.
-- Pone approval_requests en 'approved' y agent_run_steps en 'running' con lease para ToolExecutor.
drop function if exists public.claim_agent_step_approval_v2(uuid, text, text, text);

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

    if v_approval.requester_id = v_auth_user and v_agent_policy.self_approval_mode <> 'allowed' then
      return jsonb_build_object('success', false, 'error_code', 'TOOL_SELF_APPROVAL_BLOCKED', 'error_message', 'Self-approval bloqueado: el iniciador del run no puede autorizar su propia solicitud.');
    end if;
  else
    -- Política por defecto: self-approval bloqueado
    if v_approval.requester_id = v_auth_user then
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

revoke execute on function public.claim_agent_step_approval_v2(uuid, text, text, text) from public;
grant execute on function public.claim_agent_step_approval_v2(uuid, text, text, text) to authenticated, service_role;

-- 8. RPC: create_agent_run_with_concurrency_check
-- Bloquea pesimistamente el agente para serializar peticiones concurrentes y aplicar max_concurrent_runs
create or replace function public.create_agent_run_with_concurrency_check(
  p_agent_id uuid,
  p_input text,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auth_user uuid;
  v_agent record;
  v_policy record;
  v_active_runs integer;
  v_max_runs integer;
  v_run record;
begin
  v_auth_user := coalesce(auth.uid(), p_user_id);
  if v_auth_user is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión requerida.');
  end if;

  -- Bloqueo Pesimista sobre la fila del agente para serializar peticiones simultáneas
  select * into v_agent from public.agents where id = p_agent_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_NOT_FOUND', 'error_message', 'Agente no encontrado.');
  end if;

  if not public.is_workspace_member(v_agent.workspace_id, v_auth_user) then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'Sin acceso a este workspace.');
  end if;

  if v_agent.status <> 'active' then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_NOT_ACTIVE', 'error_message', 'El agente no está en estado active.');
  end if;

  -- Obtener política del agente
  select * into v_policy from public.agent_policies where agent_id = p_agent_id;
  v_max_runs := coalesce(v_policy.max_concurrent_runs, 3);

  if found and not v_policy.allow_execution then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_EXECUTION_BLOCKED', 'error_message', 'La política del agente prohíbe su ejecución.');
  end if;

  -- Conteo atómico de runs activos bajo el bloqueo
  select count(*) into v_active_runs
  from public.agent_runs
  where agent_id = p_agent_id
    and status in ('queued', 'running', 'waiting_approval');

  if v_active_runs >= v_max_runs then
    return jsonb_build_object(
      'success', false,
      'error_code', 'AGENT_CONCURRENCY_LIMIT',
      'error_message', 'El agente ha alcanzado el límite máximo de runs simultáneos (' || v_max_runs || ').',
      'active_runs', v_active_runs,
      'max_concurrent_runs', v_max_runs
    );
  end if;

  -- Inserción atómica del nuevo run
  insert into public.agent_runs (
    workspace_id, agent_id, user_id, status, input, model_id, started_at
  ) values (
    v_agent.workspace_id, p_agent_id, v_auth_user, 'running', p_input, v_agent.model_id, clock_timestamp()
  )
  returning * into v_run;

  return jsonb_build_object(
    'success', true,
    'run', to_jsonb(v_run),
    'active_runs', v_active_runs + 1,
    'max_concurrent_runs', v_max_runs
  );
end;
$$;

revoke execute on function public.create_agent_run_with_concurrency_check(uuid, text, uuid) from public;
grant execute on function public.create_agent_run_with_concurrency_check(uuid, text, uuid) to authenticated, service_role;

-- 9. ROW LEVEL SECURITY (RLS) EN TODAS LAS NUEVAS TABLAS
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.workspace_permissions enable row level security;
alter table public.agent_policies enable row level security;
alter table public.approval_requests enable row level security;
alter table public.authorization_audit_log enable row level security;

-- POLÍTICAS: permissions
drop policy if exists "permissions_select_auth" on public.permissions;
create policy "permissions_select_auth" on public.permissions
  for select using (auth.role() = 'authenticated');

-- POLÍTICAS: role_permissions
drop policy if exists "role_permissions_select_auth" on public.role_permissions;
create policy "role_permissions_select_auth" on public.role_permissions
  for select using (auth.role() = 'authenticated');

-- POLÍTICAS: workspace_permissions
drop policy if exists "workspace_permissions_select_member" on public.workspace_permissions;
create policy "workspace_permissions_select_member" on public.workspace_permissions
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "workspace_permissions_insert_admin" on public.workspace_permissions;
create policy "workspace_permissions_insert_admin" on public.workspace_permissions
  for insert with check (public.is_workspace_admin(workspace_id, auth.uid()));

drop policy if exists "workspace_permissions_update_admin" on public.workspace_permissions;
create policy "workspace_permissions_update_admin" on public.workspace_permissions
  for update using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

drop policy if exists "workspace_permissions_delete_admin" on public.workspace_permissions;
create policy "workspace_permissions_delete_admin" on public.workspace_permissions
  for delete using (public.is_workspace_admin(workspace_id, auth.uid()));

-- POLÍTICAS: agent_policies
drop policy if exists "agent_policies_select_member" on public.agent_policies;
create policy "agent_policies_select_member" on public.agent_policies
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_policies_update_admin" on public.agent_policies;
create policy "agent_policies_update_admin" on public.agent_policies
  for update using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

-- POLÍTICAS: approval_requests
drop policy if exists "approval_requests_select_member" on public.approval_requests;
create policy "approval_requests_select_member" on public.approval_requests
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: authorization_audit_log
drop policy if exists "authz_audit_log_select_member" on public.authorization_audit_log;
create policy "authz_audit_log_select_member" on public.authorization_audit_log
  for select using (public.is_workspace_member(workspace_id, auth.uid()));
