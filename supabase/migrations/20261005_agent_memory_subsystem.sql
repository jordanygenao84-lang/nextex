-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.5 (ENDURECIDA Y CERTIFICADA)
-- Cognitive Memory Subsystem: pgvector, agent_memories, agent_memory_access_log,
-- 26 Canonical Permissions, Role Matrix, Memory Policies, Scopes & Hardened RPCs
-- ==============================================================================

create extension if not exists vector;
create extension if not exists pgcrypto;

-- 0. FUNCIÓN DE UTILIDAD: RESOLUCIÓN DE PERMISOS UNIFICADA (Deny-First Precedence)
-- Precedencia Canónica: EXPLICIT DENY -> EXPLICIT ALLOW -> ROLE PERMISSION -> DEFAULT DENY
create or replace function public.has_workspace_permission(
  p_workspace_id uuid,
  p_user_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_member_role text;
  v_override_effect text;
begin
  if p_user_id is null or p_workspace_id is null or p_permission_key is null then
    return false;
  end if;

  -- 1. Verificar membresía en workspace
  select wm.role into v_member_role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id;

  if not found then
    return false;
  end if;

  -- 2. Precedencia: EXPLICIT OVERRIDES (workspace_permissions)
  select wp.effect into v_override_effect
  from public.workspace_permissions wp
  where wp.workspace_id = p_workspace_id and wp.user_id = p_user_id and wp.permission_key = p_permission_key;

  if found then
    if v_override_effect = 'deny' then
      return false;
    elsif v_override_effect = 'allow' then
      return true;
    end if;
  end if;

  -- 3. Precedencia: ROLE PERMISSION (role_permissions)
  return exists (
    select 1
    from public.role_permissions rp
    where rp.role = v_member_role and rp.permission_key = p_permission_key
  );
end;
$$;

revoke execute on function public.has_workspace_permission(uuid, uuid, text) from public;
grant execute on function public.has_workspace_permission(uuid, uuid, text) to authenticated, service_role;

-- 1. TABLA PRINCIPAL: agent_memories (Almacén de Recuerdos Cognitivos)
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  scope text not null check (scope in ('workspace', 'agent', 'user')),
  type text not null check (type in ('episodic', 'semantic', 'fact', 'preference')),
  content text not null check (char_length(trim(content)) > 0 and char_length(content) <= 4000),
  summary text check (summary is null or (char_length(trim(summary)) > 0 and char_length(summary) <= 500)),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 16384),
  embedding vector(1536),
  status text not null default 'active' check (status in ('active', 'archived', 'deprecated', 'quarantined')),
  trust_level text not null default 'untrusted' check (trust_level in ('untrusted', 'verified', 'system')),
  source_run_id uuid references public.agent_runs(id) on delete set null,
  source_step_id uuid references public.agent_run_steps(id) on delete set null,
  idempotency_hash text not null,
  client_idempotency_key text,
  access_count integer not null default 0 check (access_count >= 0),
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz check (expires_at is null or expires_at > created_at),

  -- Restricciones de Semántica y Procedencia
  constraint chk_agent_memories_step_requires_run check (source_step_id is null or source_run_id is not null),
  constraint chk_agent_memories_user_scope check (scope <> 'user' or user_id is not null),
  constraint chk_agent_memories_agent_scope check (scope <> 'agent' or user_id is null),
  constraint chk_agent_memories_workspace_scope check (scope <> 'workspace' or user_id is null),
  constraint chk_agent_memories_manual_idempotency check (source_step_id is not null or client_idempotency_key is not null)
);

comment on table public.agent_memories is 'Almacén cognitivo de recuerdos desconfiados para agentes autónomos (Memory != Authority)';

-- Reglas de Idempotencia Física:
-- A) Runtime Memory: Deduplicación atómica por step_id + hash
create unique index if not exists idx_agent_memories_step_idempotency
  on public.agent_memories (workspace_id, source_step_id, idempotency_hash)
  where source_step_id is not null;

-- B) Manual Memory: Deduplicación atómica por client_idempotency_key
create unique index if not exists idx_agent_memories_client_idempotency
  on public.agent_memories (workspace_id, client_idempotency_key)
  where client_idempotency_key is not null;

-- Índices de consulta y rendimiento
create index if not exists idx_agent_memories_workspace on public.agent_memories (workspace_id);
create index if not exists idx_agent_memories_agent on public.agent_memories (agent_id);
create index if not exists idx_agent_memories_user on public.agent_memories (user_id);
create index if not exists idx_agent_memories_lookup on public.agent_memories (workspace_id, agent_id, status, scope);
create index if not exists idx_agent_memories_expires on public.agent_memories (expires_at) where expires_at is not null;

-- Índice Vectorial HNSW (Cosine Ops) para búsqueda semántica ultrarrápida
create index if not exists idx_agent_memories_hnsw on public.agent_memories using hnsw (embedding vector_cosine_ops)
  where status = 'active' and embedding is not null;

-- Trigger updated_at para agent_memories
drop trigger if exists tr_agent_memories_updated_at on public.agent_memories;
create trigger tr_agent_memories_updated_at
  before update on public.agent_memories
  for each row execute function public.handle_updated_at();

-- 2. TABLA DE AUDITORÍA: agent_memory_access_log (Append-Only, SIN CONTENIDO BRUTO)
create table if not exists public.agent_memory_access_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_id uuid references public.agent_memories(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  run_id uuid references public.agent_runs(id) on delete set null,
  step_id uuid references public.agent_run_steps(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  operation text not null check (operation in ('read', 'write', 'archive', 'delete', 'quarantine', 'unquarantine')),
  similarity_score double precision,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now()
);

comment on table public.agent_memory_access_log is 'Registro de auditoría inmutable de accesos y ciclo de vida de memoria cognitiva (Append-Only, Zero-Raw-Content)';

create index if not exists idx_memory_access_log_workspace on public.agent_memory_access_log (workspace_id);
create index if not exists idx_memory_access_log_memory on public.agent_memory_access_log (memory_id);
create index if not exists idx_memory_access_log_created on public.agent_memory_access_log (created_at);

-- Trigger de Inmutabilidad Estricta: Prohibir UPDATE y DELETE en audit log
create or replace function public.protect_memory_access_log_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE: agent_memory_access_log es estrictamente append-only. UPDATE y DELETE están prohibidos.';
end;
$$;

drop trigger if exists tr_protect_memory_access_log_immutable on public.agent_memory_access_log;
create trigger tr_protect_memory_access_log_immutable
  before update or delete on public.agent_memory_access_log
  for each row execute function public.protect_memory_access_log_immutable();

-- 3. TRIGGER DE SEGURIDAD EN MUTACIONES DE MEMORIA (Trust & Inmutabilidad de Procedencia)
create or replace function public.protect_agent_memory_trust_and_provenance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_is_internal_trusted boolean;
begin
  v_caller := auth.uid();
  v_is_internal_trusted := (current_setting('texter.internal_trusted_system', true) = 'true');

  -- Regla A: En INSERT (Cero Bypass por set_config)
  if TG_OP = 'INSERT' then
    -- Ningún usuario autenticado ni sesión pública puede asignar trust_level system bajo ninguna circunstancia
    if new.trust_level = 'system' then
      if v_caller is not null or coalesce(auth.role(), '') in ('authenticated', 'anon') or not v_is_internal_trusted then
        raise exception 'SYSTEM_TRUST_PROHIBITED: trust_level system está estrictamente prohibido para clientes y sesiones autenticadas.';
      end if;
    end if;

    if new.trust_level = 'verified' and not v_is_internal_trusted then
      raise exception 'VERIFIED_TRUST_PROHIBITED: Las memorias nuevas deben ingresar como untrusted y promoverse vía verify_agent_memory().';
    end if;
  end if;

  -- Regla B: En UPDATE, congelar procedencia y núcleo cognitivo
  if TG_OP = 'UPDATE' then
    -- Bloquear alteración de campos de procedencia y anclaje
    if new.workspace_id is distinct from old.workspace_id or
       new.agent_id is distinct from old.agent_id or
       new.user_id is distinct from old.user_id or
       new.source_run_id is distinct from old.source_run_id or
       new.source_step_id is distinct from old.source_step_id or
       new.idempotency_hash is distinct from old.idempotency_hash or
       new.client_idempotency_key is distinct from old.client_idempotency_key or
       new.scope is distinct from old.scope or
       new.type is distinct from old.type or
       new.content is distinct from old.content or
       new.embedding is distinct from old.embedding then
      raise exception 'IMMUTABLE_PROVENANCE: No se permite modificar los campos de procedencia, anclaje, contenido ni embedding de una memoria existente.';
    end if;

    -- Bloquear asignación de trust_level = 'system' (Cero Bypass)
    if new.trust_level = 'system' and old.trust_level is distinct from 'system' then
      if v_caller is not null or coalesce(auth.role(), '') in ('authenticated', 'anon') or not v_is_internal_trusted then
        raise exception 'SYSTEM_TRUST_PROHIBITED: trust_level system solo puede originarse internamente y jamás por clientes.';
      end if;
    end if;

    -- Promoción a 'verified' exige permiso memory.manage
    if new.trust_level = 'verified' and old.trust_level is distinct from 'verified' and not v_is_internal_trusted then
      if not public.has_workspace_permission(old.workspace_id, v_caller, 'memory.manage') then
        raise exception 'PERMISSION_DENIED: Se requiere permiso memory.manage para verificar memorias.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tr_protect_agent_memory_trust on public.agent_memories;
create trigger tr_protect_agent_memory_trust
  before insert or update on public.agent_memories
  for each row execute function public.protect_agent_memory_trust_and_provenance();

-- 4. TRIGGER ANTES DE ELIMINAR MEMORIA (Auditoría Forzada y Control de Permisos)
create or replace function public.handle_agent_memory_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_is_cascade boolean;
begin
  v_caller := auth.uid();
  v_is_cascade := (current_setting('texter.internal_cascade_cleanup', true) = 'true');

  -- Si no es una cascada interna controlada, verificar permiso memory.delete
  if not v_is_cascade and v_caller is not null then
    if not public.has_workspace_permission(old.workspace_id, v_caller, 'memory.delete') then
      raise exception 'PERMISSION_DENIED: Se requiere el permiso memory.delete para eliminar memorias.';
    end if;
  end if;

  -- Registrar en el log append-only (NUNCA almacenar el contenido en el audit log)
  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    old.workspace_id, old.id, old.agent_id, v_caller, 'delete',
    jsonb_build_object('scope', old.scope, 'type', old.type, 'reason', case when v_is_cascade then 'agent_cascade_deletion' else 'manual_deletion' end)
  );

  return old;
end;
$$;

drop trigger if exists tr_agent_memory_before_delete on public.agent_memories;
create trigger tr_agent_memory_before_delete
  before delete on public.agent_memories
  for each row execute function public.handle_agent_memory_delete();

-- 5. TRIGGER DE ELIMINACIÓN DE AGENTES (Semántica de Borrado Seguro por Scope)
-- Al eliminar un agente, únicamente se purgan memorias donde scope = 'agent'.
-- Se preservan las memorias de scope = 'workspace' y scope = 'user'.
create or replace function public.handle_agent_memory_cleanup_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  set local texter.internal_cascade_cleanup = 'true';
  delete from public.agent_memories
  where agent_id = old.id and scope = 'agent';
  return old;
end;
$$;

drop trigger if exists tr_agent_memory_cleanup on public.agents;
create trigger tr_agent_memory_cleanup
  before delete on public.agents
  for each row execute function public.handle_agent_memory_cleanup_on_delete();

-- 6. EXTENSIÓN DEL CATÁLOGO DE PERMISOS: 22 -> 26 PERMISOS CANÓNICOS
alter table public.permissions
  drop constraint if exists permissions_category_check;

alter table public.permissions
  add constraint permissions_category_check
  check (category in ('agents', 'runs', 'tools', 'approvals', 'workspace', 'memory'));

insert into public.permissions (id, key, category, description)
values
  ('memory.read', 'memory.read', 'memory', 'Consultar y recuperar memorias cognitivas del workspace'),
  ('memory.write', 'memory.write', 'memory', 'Persistir y consolidar nuevos recuerdos de agentes'),
  ('memory.delete', 'memory.delete', 'memory', 'Eliminar físicamente recuerdos y ejecutar olvido de datos'),
  ('memory.manage', 'memory.manage', 'memory', 'Administrar retención, cuotas y cuarentenas de memoria')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 7. ACTUALIZACIÓN Y RECONCILIACIÓN DE MATRIZ DE ROLES (role_permissions)
-- OWNER: 26 permisos exactos (100% catálogo)
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 23 permisos exactos (excluye tools.execute_destructive, workspace.members.manage, workspace.settings.update)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- Purgar cualquier permiso prohibido que pudiera haber quedado en admin
delete from public.role_permissions
where role = 'admin' and permission_key in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update');

-- MEMBER: 11 permisos exactos (9 base + memory.read + memory.write)
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
  ('member', 'workspace.members.read'),
  ('member', 'memory.read'),
  ('member', 'memory.write')
on conflict (role, permission_key) do nothing;

-- Purgar cualquier permiso excedente en member para garantizar exactamente 11
delete from public.role_permissions
where role = 'member' and permission_key not in (
  'agents.read', 'runs.read', 'runs.execute', 'runs.cancel',
  'tools.read', 'tools.execute', 'tools.execute_read',
  'approvals.read', 'workspace.members.read',
  'memory.read', 'memory.write'
);

-- 8. EXTENSIÓN DE agent_policies CON CAMPOS DE GOBERNANZA DE MEMORIA
alter table public.agent_policies
  add column if not exists memory_enabled boolean not null default true,
  add column if not exists memory_retrieval_mode text not null default 'semantic'
    check (memory_retrieval_mode in ('disabled', 'recent', 'semantic', 'hybrid')),
  add column if not exists memory_max_tokens integer not null default 1000
    check (memory_max_tokens between 100 and 4000),
  add column if not exists memory_similarity_threshold double precision not null default 0.70
    check (memory_similarity_threshold between 0.0 and 1.0),
  add column if not exists memory_scopes text[] not null default array['agent', 'workspace']::text[]
    check (
      memory_scopes <@ array['agent', 'workspace', 'user']::text[]
      and cardinality(memory_scopes) between 1 and 3
      and cardinality(memory_scopes) - cardinality(array_remove(memory_scopes, 'agent')) <= 1
      and cardinality(memory_scopes) - cardinality(array_remove(memory_scopes, 'workspace')) <= 1
      and cardinality(memory_scopes) - cardinality(array_remove(memory_scopes, 'user')) <= 1
    ),
  add column if not exists memory_write_mode text not null default 'quarantined'
    check (memory_write_mode in ('automatic', 'quarantined', 'disabled'));

-- 9. RPC: match_agent_memories (Recuperación Segura Confinada al Tenant y Scopes de la Política)
create or replace function public.match_agent_memories(
  p_agent_id uuid,
  p_query_embedding vector(1536) default null,
  p_match_threshold double precision default 0.70,
  p_match_count integer default 5,
  p_allowed_scopes text[] default null,
  p_run_id uuid default null,
  p_step_id uuid default null
)
returns table (
  id uuid,
  workspace_id uuid,
  agent_id uuid,
  user_id uuid,
  scope text,
  type text,
  content text,
  summary text,
  metadata jsonb,
  trust_level text,
  similarity double precision,
  created_at timestamptz,
  access_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_caller uuid;
  v_agent record;
  v_policy record;
  v_agent_found boolean := false;
  v_policy_found boolean := false;
  v_run_record record;
  v_step_record record;
  v_effective_scopes text[];
  v_effective_threshold double precision;
  v_retrieval_mode text;
begin
  -- 1. Validar autenticación
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'AUTH_REQUIRED: Sesión autenticada requerida para consultar memorias.';
  end if;

  -- 2. Validar parámetros numéricos
  if p_match_count is null or p_match_count < 1 or p_match_count > 50 then
    raise exception 'INVALID_MATCH_COUNT: p_match_count debe estar entre 1 y 50.';
  end if;

  if p_match_threshold is null or p_match_threshold < 0.0 or p_match_threshold > 1.0 then
    raise exception 'INVALID_MATCH_THRESHOLD: p_match_threshold debe estar entre 0.0 y 1.0.';
  end if;

  -- 3. Derivar workspace_id desde el agente verificado
  select a.* into v_agent from public.agents a where a.id = p_agent_id;
  if v_agent.id is not null then
    v_agent_found := true;
  end if;

  if not v_agent_found then
    raise exception 'AGENT_NOT_FOUND: Agente no encontrado.';
  end if;

  -- 4. Validar pertenencia del usuario y permiso memory.read con precedencia Deny-First
  if not public.has_workspace_permission(v_agent.workspace_id, v_caller, 'memory.read') then
    raise exception 'PERMISSION_DENIED: Usuario carece de permiso memory.read en este workspace.';
  end if;

  -- 5. Anti-Spoofing de Run y Step en contexto de retrieval
  if p_run_id is not null then
    select workspace_id, agent_id into v_run_record
    from public.agent_runs r where r.id = p_run_id;
    if v_run_record.workspace_id is null or v_run_record.workspace_id is distinct from v_agent.workspace_id or v_run_record.agent_id is distinct from p_agent_id then
      raise exception 'PROVENANCE_SPOOFING_DETECTED: p_run_id no pertenece al agente ni al workspace.';
    end if;
  end if;

  if p_step_id is not null then
    if p_run_id is null then
      raise exception 'INVALID_PROVENANCE: p_step_id requiere p_run_id obligatoriamente.';
    end if;
    select workspace_id, run_id into v_step_record
    from public.agent_run_steps s where s.id = p_step_id;
    if v_step_record.workspace_id is null or v_step_record.workspace_id is distinct from v_agent.workspace_id or v_step_record.run_id is distinct from p_run_id then
      raise exception 'PROVENANCE_SPOOFING_DETECTED: p_step_id no pertenece al run especificado.';
    end if;
  end if;

  -- 6. Validar estado de la política de memoria del agente
  select ap.* into v_policy from public.agent_policies ap where ap.agent_id = p_agent_id;
  if v_policy.agent_id is not null then
    v_policy_found := true;
  end if;

  if v_policy_found and not v_policy.memory_enabled then
    return; -- Memoria deshabilitada por política
  end if;

  v_retrieval_mode := coalesce(v_policy.memory_retrieval_mode, 'semantic');
  if v_retrieval_mode = 'disabled' then
    return; -- Modo disabled
  end if;

  -- 7. Acotar scopes estrictamente a los autorizados en AgentPolicy
  if v_policy_found and v_policy.memory_scopes is not null and array_length(v_policy.memory_scopes, 1) > 0 then
    if p_allowed_scopes is not null and array_length(p_allowed_scopes, 1) > 0 then
      select coalesce(array_agg(sc.scope_name), array[]::text[]) into v_effective_scopes
      from (
        select unnest(p_allowed_scopes) as scope_name
        intersect
        select unnest(v_policy.memory_scopes) as scope_name
      ) sc;
    else
      v_effective_scopes := v_policy.memory_scopes;
    end if;
  else
    v_effective_scopes := coalesce(p_allowed_scopes, array['agent', 'workspace']::text[]);
  end if;

  if array_length(v_effective_scopes, 1) is null or array_length(v_effective_scopes, 1) = 0 then
    return;
  end if;

  -- 8. Derivar umbral efectivo: la política es autoridad
  v_effective_threshold := greatest(p_match_threshold, coalesce(v_policy.memory_similarity_threshold, 0.70));

  -- 9. Ejecución determinista según memory_retrieval_mode
  if v_retrieval_mode = 'recent' then
    -- Modo recent: orden por recencia sin dependencia forzada de embedding
    return query
    with candidates as (
      select
        m.id, m.workspace_id, m.agent_id, m.user_id, m.scope, m.type,
        m.content, m.summary, m.metadata, m.trust_level,
        0.0::double precision as similarity,
        m.created_at, m.access_count
      from public.agent_memories m
      where m.workspace_id = v_agent.workspace_id
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > clock_timestamp())
        and m.scope = any(v_effective_scopes)
        and (
          (m.scope = 'agent' and m.agent_id = p_agent_id) or
          (m.scope = 'workspace') or
          (m.scope = 'user' and m.user_id = v_caller)
        )
      order by
        case m.scope when 'agent' then 1 when 'user' then 2 when 'workspace' then 3 else 4 end asc,
        case m.trust_level when 'system' then 1 when 'verified' then 2 when 'untrusted' then 3 else 4 end asc,
        m.created_at desc,
        m.id asc
      limit p_match_count
    ),
    updated as (
      update public.agent_memories am
      set access_count = am.access_count + 1,
          last_accessed_at = clock_timestamp()
      from candidates c
      where am.id = c.id
      returning am.id, am.access_count
    ),
    logged as (
      insert into public.agent_memory_access_log (
        workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, similarity_score, metadata
      )
      select
        v_agent.workspace_id, c.id, p_agent_id, p_run_id, p_step_id, v_caller, 'read', 0.0,
        jsonb_build_object('retrieval_mode', 'recent', 'scope', c.scope, 'type', c.type)
      from candidates c
      returning id
    )
    select
      c.id, c.workspace_id, c.agent_id, c.user_id, c.scope, c.type, c.content, c.summary,
      c.metadata, c.trust_level, c.similarity, c.created_at, u.access_count
    from candidates c
    join updated u on u.id = c.id;

  elsif v_retrieval_mode = 'semantic' then
    -- Modo semantic: vector similarity estricta
    if p_query_embedding is null then
      raise exception 'QUERY_EMBEDDING_REQUIRED: El modo de recuperación semantic requiere p_query_embedding.';
    end if;

    return query
    with candidates as (
      select
        m.id, m.workspace_id, m.agent_id, m.user_id, m.scope, m.type,
        m.content, m.summary, m.metadata, m.trust_level,
        (1 - (m.embedding <=> p_query_embedding)) as similarity,
        m.created_at, m.access_count
      from public.agent_memories m
      where m.workspace_id = v_agent.workspace_id
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > clock_timestamp())
        and m.scope = any(v_effective_scopes)
        and (
          (m.scope = 'agent' and m.agent_id = p_agent_id) or
          (m.scope = 'workspace') or
          (m.scope = 'user' and m.user_id = v_caller)
        )
        and m.embedding is not null
        and (1 - (m.embedding <=> p_query_embedding)) >= v_effective_threshold
      order by
        case m.scope when 'agent' then 1 when 'user' then 2 when 'workspace' then 3 else 4 end asc,
        case m.trust_level when 'system' then 1 when 'verified' then 2 when 'untrusted' then 3 else 4 end asc,
        similarity desc,
        m.created_at desc,
        m.id asc
      limit p_match_count
    ),
    updated as (
      update public.agent_memories am
      set access_count = am.access_count + 1,
          last_accessed_at = clock_timestamp()
      from candidates c
      where am.id = c.id
      returning am.id, am.access_count
    ),
    logged as (
      insert into public.agent_memory_access_log (
        workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, similarity_score, metadata
      )
      select
        v_agent.workspace_id, c.id, p_agent_id, p_run_id, p_step_id, v_caller, 'read', c.similarity,
        jsonb_build_object('retrieval_mode', 'semantic', 'scope', c.scope, 'type', c.type)
      from candidates c
      returning id
    )
    select
      c.id, c.workspace_id, c.agent_id, c.user_id, c.scope, c.type, c.content, c.summary,
      c.metadata, c.trust_level, c.similarity, c.created_at, u.access_count
    from candidates c
    join updated u on u.id = c.id;

  elsif v_retrieval_mode = 'hybrid' then
    -- Modo hybrid: balanceo determinista entre similitud vectorial y recencia temporal
    return query
    with candidates as (
      select
        m.id, m.workspace_id, m.agent_id, m.user_id, m.scope, m.type,
        m.content, m.summary, m.metadata, m.trust_level,
        case when m.embedding is not null and p_query_embedding is not null
             then (1 - (m.embedding <=> p_query_embedding))
             else 0.0 end as similarity,
        m.created_at, m.access_count
      from public.agent_memories m
      where m.workspace_id = v_agent.workspace_id
        and m.status = 'active'
        and (m.expires_at is null or m.expires_at > clock_timestamp())
        and m.scope = any(v_effective_scopes)
        and (
          (m.scope = 'agent' and m.agent_id = p_agent_id) or
          (m.scope = 'workspace') or
          (m.scope = 'user' and m.user_id = v_caller)
        )
        and (
          (m.embedding is not null and p_query_embedding is not null and (1 - (m.embedding <=> p_query_embedding)) >= v_effective_threshold)
          or (m.created_at > (clock_timestamp() - interval '7 days'))
        )
      order by
        case m.scope when 'agent' then 1 when 'user' then 2 when 'workspace' then 3 else 4 end asc,
        case m.trust_level when 'system' then 1 when 'verified' then 2 when 'untrusted' then 3 else 4 end asc,
        similarity desc,
        m.created_at desc,
        m.id asc
      limit p_match_count
    ),
    updated as (
      update public.agent_memories am
      set access_count = am.access_count + 1,
          last_accessed_at = clock_timestamp()
      from candidates c
      where am.id = c.id
      returning am.id, am.access_count
    ),
    logged as (
      insert into public.agent_memory_access_log (
        workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, similarity_score, metadata
      )
      select
        v_agent.workspace_id, c.id, p_agent_id, p_run_id, p_step_id, v_caller, 'read', c.similarity,
        jsonb_build_object('retrieval_mode', 'hybrid', 'scope', c.scope, 'type', c.type)
      from candidates c
      returning id
    )
    select
      c.id, c.workspace_id, c.agent_id, c.user_id, c.scope, c.type, c.content, c.summary,
      c.metadata, c.trust_level, c.similarity, c.created_at, u.access_count
    from candidates c
    join updated u on u.id = c.id;
  end if;
end;
$$;

revoke execute on function public.match_agent_memories(uuid, vector, double precision, integer, text[], uuid, uuid) from public;
grant execute on function public.match_agent_memories(uuid, vector, double precision, integer, text[], uuid, uuid) to authenticated, service_role;

-- 10. RPC: ingest_agent_memory (Ingestión Controlada, Sanitizada, Validada y Deduplicada)
create or replace function public.ingest_agent_memory(
  p_agent_id uuid,
  p_content text,
  p_type text,
  p_scope text,
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_embedding vector(1536) default null,
  p_source_run_id uuid default null,
  p_source_step_id uuid default null,
  p_idempotency_hash text default null, -- Ignorado: se calcula server-side
  p_client_idempotency_key text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_caller uuid;
  v_agent record;
  v_run record;
  v_step record;
  v_policy record;
  v_agent_found boolean := false;
  v_policy_found boolean := false;
  v_target_status text;
  v_computed_hash text;
  v_inserted_id uuid;
  v_existing record;
  v_sanitized_content text;
  v_sanitized_summary text;
  v_target_user_id uuid;
begin
  -- 1. Validar autenticación
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  -- 2. Validar contenido no vacío
  v_sanitized_content := trim(p_content);
  if v_sanitized_content is null or char_length(v_sanitized_content) = 0 then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_CONTENT', 'error_message', 'El contenido no puede estar vacío.');
  end if;

  if char_length(v_sanitized_content) > 4000 then
    return jsonb_build_object('success', false, 'error_code', 'CONTENT_TOO_LARGE', 'error_message', 'El contenido no puede exceder 4000 caracteres.');
  end if;

  -- 3. Barrera de Detección de Secretos en contenido
  if v_sanitized_content ~* '(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)' then
    return jsonb_build_object('success', false, 'error_code', 'UNSANITIZED_CONTENT', 'error_message', 'El contenido contiene patrones de credenciales o secretos detectables no sanitizados.');
  end if;

  -- 4. Validar summary si fue suministrado
  if p_summary is not null then
    v_sanitized_summary := trim(p_summary);
    if char_length(v_sanitized_summary) = 0 then
      v_sanitized_summary := null;
    elsif char_length(v_sanitized_summary) > 500 then
      return jsonb_build_object('success', false, 'error_code', 'SUMMARY_TOO_LARGE', 'error_message', 'El resumen no puede exceder 500 caracteres.');
    elsif v_sanitized_summary ~* '(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|AKIA[0-9A-Z]{16})' then
      return jsonb_build_object('success', false, 'error_code', 'UNSANITIZED_CONTENT', 'error_message', 'El resumen contiene secretos detectables no sanitizados.');
    end if;
  end if;

  -- 5. Validar metadata
  if p_metadata is not null then
    if jsonb_typeof(p_metadata) <> 'object' then
      return jsonb_build_object('success', false, 'error_code', 'INVALID_METADATA', 'error_message', 'metadata debe ser un objeto JSON.');
    end if;
    if pg_column_size(p_metadata) > 16384 then
      return jsonb_build_object('success', false, 'error_code', 'METADATA_TOO_LARGE', 'error_message', 'metadata excede el límite de 16KB.');
    end if;
    if p_metadata::text ~* '(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|AKIA[0-9A-Z]{16})' then
      return jsonb_build_object('success', false, 'error_code', 'UNSANITIZED_CONTENT', 'error_message', 'metadata contiene secretos detectables no sanitizados.');
    end if;
  end if;

  -- 6. Derivar workspace_id desde el agente
  select a.* into v_agent from public.agents a where a.id = p_agent_id;
  if v_agent.id is not null then
    v_agent_found := true;
  end if;

  if not v_agent_found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_NOT_FOUND', 'error_message', 'Agente no encontrado.');
  end if;

  -- 7. Validar permiso memory.write con precedencia Deny-First
  if not public.has_workspace_permission(v_agent.workspace_id, v_caller, 'memory.write') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Usuario carece de permiso memory.write.');
  end if;

  -- 8. Validar política del agente y scopes permitidos
  select ap.* into v_policy from public.agent_policies ap where ap.agent_id = p_agent_id;
  if v_policy.agent_id is not null then
    v_policy_found := true;
  end if;

  if v_policy_found and not v_policy.memory_enabled then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_DISABLED', 'error_message', 'La memoria está deshabilitada para este agente.');
  end if;

  if v_policy_found and v_policy.memory_write_mode = 'disabled' then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_WRITE_DISABLED', 'error_message', 'La escritura de memoria está deshabilitada en la política del agente.');
  end if;

  if v_policy_found and v_policy.memory_scopes is not null and not (p_scope = any(v_policy.memory_scopes)) then
    return jsonb_build_object('success', false, 'error_code', 'SCOPE_NOT_ALLOWED', 'error_message', 'El scope solicitado no está permitido por la política del agente.');
  end if;

  -- 9. Restricción por Rol: Member solo puede escribir en scope user
  declare
    v_caller_role text;
  begin
    select wm.role into v_caller_role from public.workspace_members wm where wm.workspace_id = v_agent.workspace_id and wm.user_id = v_caller;
    if v_caller_role = 'member' and p_scope <> 'user' then
      return jsonb_build_object('success', false, 'error_code', 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY', 'error_message', 'Los miembros solo pueden persistir memorias en scope user.');
    end if;
  end;

  -- 10. Validar expiración si fue enviada
  if p_expires_at is not null and p_expires_at <= clock_timestamp() then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_EXPIRATION', 'error_message', 'expires_at debe ser una fecha futura.');
  end if;

  -- 11. Validar Procedencia y Requisitos de Idempotencia
  if p_source_step_id is not null then
    -- Runtime Memory: requiere source_run_id obligatoriamente
    if p_source_run_id is null then
      return jsonb_build_object('success', false, 'error_code', 'INVALID_PROVENANCE', 'error_message', 'source_step_id requiere source_run_id obligatoriamente.');
    end if;

    select r.* into v_run from public.agent_runs r where r.id = p_source_run_id;
    if v_run.id is null or v_run.workspace_id is distinct from v_agent.workspace_id or v_run.agent_id is distinct from p_agent_id then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'Procedencia de run inválida o cross-tenant.');
    end if;

    if v_run.status <> 'completed' then
      return jsonb_build_object('success', false, 'error_code', 'RUN_NOT_COMPLETED', 'error_message', 'Solo los runs en estado completed pueden consolidar memorias.');
    end if;

    select s.* into v_step from public.agent_run_steps s where s.id = p_source_step_id;
    if v_step.id is null or v_step.workspace_id is distinct from v_agent.workspace_id or v_step.run_id is distinct from p_source_run_id then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'Procedencia de step inválida o cross-tenant.');
    end if;

    -- Hash Canónico Server-Side para Runtime
    v_computed_hash := encode(digest(p_source_run_id::text || ':' || p_source_step_id::text || ':' || p_scope || ':' || p_type || ':' || v_sanitized_content, 'sha256'), 'hex');

  else
    -- Manual Memory: client_idempotency_key es OBLIGATORIO
    if p_client_idempotency_key is null or char_length(trim(p_client_idempotency_key)) = 0 then
      return jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_KEY_REQUIRED', 'error_message', 'Para memorias manuales se requiere obligatoriamente client_idempotency_key.');
    end if;

    -- Hash Canónico Server-Side para Manual
    v_computed_hash := encode(digest(v_agent.workspace_id::text || ':' || trim(p_client_idempotency_key) || ':' || p_scope || ':' || p_type || ':' || v_sanitized_content, 'sha256'), 'hex');
  end if;

  -- 12. Asignación Semántica de user_id por Scope
  if p_scope = 'user' then
    v_target_user_id := v_caller;
  else
    v_target_user_id := null;
  end if;

  -- 13. Decisión de Cuarentena Automática Basada en Riesgo
  -- Solo hechos y memorias semánticas van a 'active' bajo automatic; 'preference' y otros van a 'quarantined'
  v_target_status := 'quarantined';
  if v_policy_found and v_policy.memory_write_mode = 'automatic' and p_type in ('semantic', 'fact') then
    v_target_status := 'active';
  end if;

  -- 14. Detección Preventiva de Conflicto de Idempotencia
  if p_source_step_id is not null then
    select em.* into v_existing from public.agent_memories em
    where em.workspace_id = v_agent.workspace_id and em.source_step_id = p_source_step_id;
  else
    select em.* into v_existing from public.agent_memories em
    where em.workspace_id = v_agent.workspace_id and em.client_idempotency_key = trim(p_client_idempotency_key);
  end if;

  if v_existing.id is not null then
    if v_existing.idempotency_hash = v_computed_hash then
      -- Replay exacto idéntico: deduplicado
      return jsonb_build_object('success', true, 'id', v_existing.id, 'status', 'deduplicated', 'cached', true);
    else
      -- Misma clave pero diferente contenido/parámetros: CONFLICTO
      return jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error_message', 'La clave de idempotencia ya fue utilizada previamente con un contenido o metadata diferentes.');
    end if;
  end if;

  -- 15. Inserción protegida (trust_level SIEMPRE 'untrusted')
  insert into public.agent_memories (
    workspace_id, agent_id, user_id, scope, type, content, summary, metadata,
    embedding, status, trust_level, source_run_id, source_step_id,
    idempotency_hash, client_idempotency_key, expires_at
  ) values (
    v_agent.workspace_id, p_agent_id, v_target_user_id, p_scope, p_type,
    v_sanitized_content, v_sanitized_summary, coalesce(p_metadata, '{}'::jsonb),
    p_embedding, v_target_status, 'untrusted', p_source_run_id, p_source_step_id,
    v_computed_hash, trim(p_client_idempotency_key), p_expires_at
  )
  on conflict do nothing
  returning id into v_inserted_id;

  -- 16. En caso de carrera concurrente atómica
  if v_inserted_id is null then
    if p_source_step_id is not null then
      select * into v_existing from public.agent_memories
      where workspace_id = v_agent.workspace_id and source_step_id = p_source_step_id;
    else
      select * into v_existing from public.agent_memories
      where workspace_id = v_agent.workspace_id and client_idempotency_key = trim(p_client_idempotency_key);
    end if;

    if v_existing.id is not null then
      if v_existing.idempotency_hash = v_computed_hash then
        return jsonb_build_object('success', true, 'id', v_existing.id, 'status', 'deduplicated', 'cached', true);
      else
        return jsonb_build_object('success', false, 'error_code', 'IDEMPOTENCY_CONFLICT', 'error_message', 'Conflicto de idempotencia en inserción concurrente.');
      end if;
    end if;
  end if;

  -- 17. Registro en Auditoría (Sin contenido bruto)
  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, metadata
  ) values (
    v_agent.workspace_id, v_inserted_id, p_agent_id, p_source_run_id, p_source_step_id, v_caller,
    case when v_target_status = 'quarantined' then 'quarantine' else 'write' end,
    jsonb_build_object('scope', p_scope, 'type', p_type, 'status', v_target_status)
  );

  return jsonb_build_object('success', true, 'id', v_inserted_id, 'status', v_target_status, 'cached', false);
end;
$$;

revoke execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector, uuid, uuid, text, text, timestamptz) to authenticated, service_role;

-- 11. RPCs CONTROLADAS DE GOBERNANZA Y CICLO DE VIDA (Sin UPDATE/DELETE Directo)

-- A) Eliminar Memoria
create or replace function public.delete_agent_memory(p_memory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  if not public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.delete') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Se requiere el permiso memory.delete.');
  end if;

  delete from public.agent_memories where id = p_memory_id;

  return jsonb_build_object('success', true, 'id', p_memory_id, 'operation', 'delete');
end;
$$;

-- B) Archivar Memoria
create or replace function public.archive_agent_memory(p_memory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  if not public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.manage') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Se requiere el permiso memory.manage.');
  end if;

  update public.agent_memories
  set status = 'archived', updated_at = clock_timestamp()
  where id = p_memory_id;

  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    v_memory.workspace_id, p_memory_id, v_memory.agent_id, v_caller, 'archive',
    jsonb_build_object('previous_status', v_memory.status, 'new_status', 'archived')
  );

  return jsonb_build_object('success', true, 'id', p_memory_id, 'status', 'archived');
end;
$$;

-- C) Poner Memoria en Cuarentena
create or replace function public.quarantine_agent_memory(p_memory_id uuid, p_reason text default 'governance_review')
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  if not public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.manage') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Se requiere el permiso memory.manage.');
  end if;

  update public.agent_memories
  set status = 'quarantined', updated_at = clock_timestamp()
  where id = p_memory_id;

  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    v_memory.workspace_id, p_memory_id, v_memory.agent_id, v_caller, 'quarantine',
    jsonb_build_object('reason', p_reason, 'previous_status', v_memory.status)
  );

  return jsonb_build_object('success', true, 'id', p_memory_id, 'status', 'quarantined');
end;
$$;

-- D) Liberar de Cuarentena (Unquarantine)
create or replace function public.unquarantine_agent_memory(p_memory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  if not public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.manage') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Se requiere el permiso memory.manage.');
  end if;

  update public.agent_memories
  set status = 'active', updated_at = clock_timestamp()
  where id = p_memory_id;

  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    v_memory.workspace_id, p_memory_id, v_memory.agent_id, v_caller, 'unquarantine',
    jsonb_build_object('previous_status', v_memory.status, 'new_status', 'active')
  );

  return jsonb_build_object('success', true, 'id', p_memory_id, 'status', 'active');
end;
$$;

-- E) Verificar Memoria (Promover a verified)
create or replace function public.verify_agent_memory(p_memory_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  if not public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.manage') then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Se requiere el permiso memory.manage.');
  end if;

  update public.agent_memories
  set trust_level = 'verified', updated_at = clock_timestamp()
  where id = p_memory_id;

  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    v_memory.workspace_id, p_memory_id, v_memory.agent_id, v_caller, 'write',
    jsonb_build_object('action', 'verify_memory', 'previous_trust', v_memory.trust_level, 'new_trust', 'verified')
  );

  return jsonb_build_object('success', true, 'id', p_memory_id, 'trust_level', 'verified');
end;
$$;

-- F) Actualizar Campos Permitidos (Summary y Metadata)
create or replace function public.update_agent_memory_metadata(
  p_memory_id uuid,
  p_metadata jsonb default null,
  p_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_memory record;
  v_sanitized_summary text;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Autenticación requerida.');
  end if;

  select m.* into v_memory from public.agent_memories m where m.id = p_memory_id;
  if v_memory.id is null then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_NOT_FOUND', 'error_message', 'Memoria no encontrada.');
  end if;

  -- Requiere memory.write (si es scope user y pertenece al caller) o memory.manage
  if not (
    (v_memory.scope = 'user' and v_memory.user_id = v_caller and public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.write'))
    or
    public.has_workspace_permission(v_memory.workspace_id, v_caller, 'memory.manage')
  ) then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Permisos insuficientes para editar esta memoria.');
  end if;

  -- Validar y sanitizar summary si se proporciona
  if p_summary is not null then
    v_sanitized_summary := trim(p_summary);
    if char_length(v_sanitized_summary) > 500 then
      return jsonb_build_object('success', false, 'error_code', 'SUMMARY_TOO_LARGE', 'error_message', 'El resumen no puede exceder 500 caracteres.');
    end if;
    if v_sanitized_summary ~* '(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|AKIA[0-9A-Z]{16})' then
      return jsonb_build_object('success', false, 'error_code', 'UNSANITIZED_CONTENT', 'error_message', 'El resumen contiene secretos detectables no sanitizados.');
    end if;
  end if;

  -- Validar metadata si se proporciona
  if p_metadata is not null then
    if jsonb_typeof(p_metadata) <> 'object' then
      return jsonb_build_object('success', false, 'error_code', 'INVALID_METADATA', 'error_message', 'metadata debe ser un objeto JSON.');
    end if;
    if pg_column_size(p_metadata) > 16384 then
      return jsonb_build_object('success', false, 'error_code', 'METADATA_TOO_LARGE', 'error_message', 'metadata excede el límite de 16KB.');
    end if;
    if p_metadata::text ~* '(sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-\.]{20,}|AKIA[0-9A-Z]{16})' then
      return jsonb_build_object('success', false, 'error_code', 'UNSANITIZED_CONTENT', 'error_message', 'metadata contiene secretos detectables no sanitizados.');
    end if;
  end if;

  update public.agent_memories
  set summary = coalesce(v_sanitized_summary, summary),
      metadata = coalesce(p_metadata, metadata),
      updated_at = clock_timestamp()
  where id = p_memory_id;

  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, actor_id, operation, metadata
  ) values (
    v_memory.workspace_id, p_memory_id, v_memory.agent_id, v_caller, 'write',
    jsonb_build_object('action', 'update_metadata')
  );

  return jsonb_build_object('success', true, 'id', p_memory_id);
end;
$$;

-- Concesión de Privilegios para RPCs de Gobernanza
revoke execute on function public.delete_agent_memory(uuid) from public;
grant execute on function public.delete_agent_memory(uuid) to authenticated, service_role;

revoke execute on function public.archive_agent_memory(uuid) from public;
grant execute on function public.archive_agent_memory(uuid) to authenticated, service_role;

revoke execute on function public.quarantine_agent_memory(uuid, text) from public;
grant execute on function public.quarantine_agent_memory(uuid, text) to authenticated, service_role;

revoke execute on function public.unquarantine_agent_memory(uuid) from public;
grant execute on function public.unquarantine_agent_memory(uuid) to authenticated, service_role;

revoke execute on function public.verify_agent_memory(uuid) from public;
grant execute on function public.verify_agent_memory(uuid) to authenticated, service_role;

revoke execute on function public.update_agent_memory_metadata(uuid, jsonb, text) from public;
grant execute on function public.update_agent_memory_metadata(uuid, jsonb, text) to authenticated, service_role;

-- 12. ROW LEVEL SECURITY (RLS) ESTRICTO
alter table public.agent_memories enable row level security;
alter table public.agent_memory_access_log enable row level security;

-- POLÍTICAS: agent_memories
-- A) Lectura: Miembro del workspace. Si scope = 'user', confinado estrictamente a auth.uid()
drop policy if exists "agent_memories_select_member" on public.agent_memories;
create policy "agent_memories_select_member" on public.agent_memories
  for select using (
    public.is_workspace_member(workspace_id, auth.uid())
    and (scope <> 'user' or user_id = auth.uid())
  );

-- B) Mutaciones Directas: BLOQUEADAS para clientes.
-- Inserción, actualización y eliminación exclusivas vía RPCs SECURITY DEFINER controladas o service_role.
drop policy if exists "agent_memories_insert_member" on public.agent_memories;
drop policy if exists "agent_memories_update_admin" on public.agent_memories;
drop policy if exists "agent_memories_delete_admin" on public.agent_memories;

-- POLÍTICAS: agent_memory_access_log
-- A) Lectura: Solo miembros con permiso memory.read verificado vía Deny-First
drop policy if exists "memory_access_log_select_member" on public.agent_memory_access_log;
create policy "memory_access_log_select_member" on public.agent_memory_access_log
  for select using (
    public.has_workspace_permission(workspace_id, auth.uid(), 'memory.read')
  );

-- B) Mutaciones Directas: BLOQUEADAS para clientes. Solo insertan RPCs y triggers internos del servidor.
drop policy if exists "memory_access_log_insert_member" on public.agent_memory_access_log;
drop policy if exists "memory_access_log_update_member" on public.agent_memory_access_log;
drop policy if exists "memory_access_log_delete_member" on public.agent_memory_access_log;
