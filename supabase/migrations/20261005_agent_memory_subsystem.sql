-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.5
-- Cognitive Memory Subsystem: pgvector, agent_memories, agent_memory_access_log,
-- 26 Canonical Permissions, Role Matrix, Memory Policies, Scopes & Hardened RPCs
-- ==============================================================================

create extension if not exists vector;
create extension if not exists pgcrypto;

-- 1. TABLA PRINCIPAL: agent_memories (Almacén de Recuerdos Cognitivos)
create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  scope text not null check (scope in ('workspace', 'agent', 'user')),
  type text not null check (type in ('episodic', 'semantic', 'fact', 'preference')),
  content text not null check (char_length(content) <= 4000),
  summary text check (char_length(summary) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  status text not null default 'active' check (status in ('active', 'archived', 'deprecated', 'quarantined')),
  trust_level text not null default 'untrusted' check (trust_level in ('untrusted', 'verified', 'system')),
  source_run_id uuid references public.agent_runs(id) on delete set null,
  source_step_id uuid references public.agent_run_steps(id) on delete set null,
  idempotency_hash text not null,
  client_idempotency_key text,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz
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

-- 2. TABLA DE AUDITORÍA: agent_memory_access_log (Append-Only)
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
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.agent_memory_access_log is 'Registro de auditoría inmutable de accesos y ciclo de vida de memoria cognitiva (Append-Only)';

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

-- 3. TRIGGER DE ELIMINACIÓN DE AGENTES (Semántica de Borrado Seguro por Scope)
-- Al eliminar un agente, únicamente se purgan memorias donde scope = 'agent'.
-- Se preservan las memorias de scope = 'workspace' y scope = 'user'.
create or replace function public.handle_agent_memory_cleanup_on_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  delete from public.agent_memories
  where agent_id = old.id and scope = 'agent';
  return old;
end;
$$;

drop trigger if exists tr_agent_memory_cleanup on public.agents;
create trigger tr_agent_memory_cleanup
  before delete on public.agents
  for each row execute function public.handle_agent_memory_cleanup_on_delete();

-- 4. EXTENSIÓN DEL CATÁLOGO DE PERMISOS: 22 -> 26 PERMISOS CANÓNICOS
insert into public.permissions (id, key, category, description)
values
  ('memory.read', 'memory.read', 'memory', 'Consultar y recuperar memorias cognitivas del workspace'),
  ('memory.write', 'memory.write', 'memory', 'Persistir y consolidar nuevos recuerdos de agentes'),
  ('memory.delete', 'memory.delete', 'memory', 'Eliminar físicamente recuerdos y ejecutar olvido de datos'),
  ('memory.manage', 'memory.manage', 'memory', 'Administrar retención, cuotas y cuarentenas de memoria')
on conflict (key) do update set
  category = excluded.category,
  description = excluded.description;

-- 5. ACTUALIZACIÓN DE MATRIZ DE ROLES (role_permissions)
-- OWNER: 26 permisos exactos (100% catálogo)
insert into public.role_permissions (role, permission_key)
select 'owner', key from public.permissions
on conflict (role, permission_key) do nothing;

-- ADMIN: 23 permisos exactos (excluye tools.execute_destructive, workspace.members.manage, workspace.settings.update)
insert into public.role_permissions (role, permission_key)
select 'admin', key from public.permissions
where key not in ('tools.execute_destructive', 'workspace.members.manage', 'workspace.settings.update')
on conflict (role, permission_key) do nothing;

-- MEMBER: 11 permisos exactos (9 base + memory.read + memory.write)
insert into public.role_permissions (role, permission_key)
values
  ('member', 'memory.read'),
  ('member', 'memory.write')
on conflict (role, permission_key) do nothing;

-- 6. EXTENSIÓN DE agent_policies CON CAMPOS DE GOBERNANZA DE MEMORIA
alter table public.agent_policies
  add column if not exists memory_enabled boolean not null default true,
  add column if not exists memory_retrieval_mode text not null default 'semantic'
    check (memory_retrieval_mode in ('disabled', 'recent', 'semantic', 'hybrid')),
  add column if not exists memory_max_tokens integer not null default 1000
    check (memory_max_tokens between 100 and 4000),
  add column if not exists memory_similarity_threshold double precision not null default 0.70
    check (memory_similarity_threshold between 0.0 and 1.0),
  add column if not exists memory_scopes text[] not null default array['agent', 'workspace']::text[],
  add column if not exists memory_write_mode text not null default 'quarantined'
    check (memory_write_mode in ('automatic', 'quarantined', 'disabled'));

-- 7. RPC: match_agent_memories (Recuperación Segura Confinada al Tenant)
create or replace function public.match_agent_memories(
  p_agent_id uuid,
  p_query_embedding vector(1536),
  p_match_threshold double precision default 0.70,
  p_match_count integer default 5,
  p_allowed_scopes text[] default array['agent', 'workspace']::text[],
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
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_agent record;
  v_caller_role text;
  v_has_read_perm boolean;
  v_override record;
begin
  -- 1. Validar autenticación
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'AUTH_REQUIRED: Sesión autenticada requerida para consultar memorias.';
  end if;

  -- 2. Derivar workspace_id desde el agente verificado
  select * into v_agent from public.agents where id = p_agent_id;
  if not found then
    raise exception 'AGENT_NOT_FOUND: Agente no encontrado.';
  end if;

  -- 3. Validar pertenencia del usuario al workspace del agente
  select role into v_caller_role
  from public.workspace_members
  where workspace_id = v_agent.workspace_id and user_id = v_caller;

  if not found then
    raise exception 'AGENT_PERMISSION_DENIED: Sin acceso al workspace de este agente.';
  end if;

  -- 4. Validar permiso JIT memory.read
  v_has_read_perm := false;
  select * into v_override
  from public.workspace_permissions
  where workspace_id = v_agent.workspace_id and user_id = v_caller and permission_key = 'memory.read';

  if found then
    if v_override.effect = 'allow' then v_has_read_perm := true;
    elsif v_override.effect = 'deny' then v_has_read_perm := false; end if;
  else
    select exists (
      select 1 from public.role_permissions where role = v_caller_role and permission_key = 'memory.read'
    ) into v_has_read_perm;
  end if;

  if not v_has_read_perm then
    raise exception 'PERMISSION_DENIED: Usuario carece de permiso memory.read en este workspace.';
  end if;

  -- 5. Consulta de Coincidencias con Orden Determinista y Filtros Estrictos
  return query
  with candidates as (
    select
      m.id,
      m.workspace_id,
      m.agent_id,
      m.user_id,
      m.scope,
      m.type,
      m.content,
      m.summary,
      m.metadata,
      m.trust_level,
      (1 - (m.embedding <=> p_query_embedding)) as similarity,
      m.created_at,
      m.access_count
    from public.agent_memories m
    where m.workspace_id = v_agent.workspace_id
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > clock_timestamp())
      and m.scope = any(p_allowed_scopes)
      and (m.agent_id = p_agent_id or m.scope in ('workspace', 'user'))
      and m.embedding is not null
      and (1 - (m.embedding <=> p_query_embedding)) >= p_match_threshold
    order by
      -- Prioridad Determinista de Retrieval:
      case m.scope when 'agent' then 1 when 'user' then 2 when 'workspace' then 3 else 4 end asc,
      case m.trust_level when 'system' then 1 when 'verified' then 2 when 'untrusted' then 3 else 4 end asc,
      similarity desc,
      m.created_at desc,
      m.id asc
    limit p_match_count
  ),
  updated as (
    -- Incremento atómico de access_count y actualización de last_accessed_at
    update public.agent_memories am
    set access_count = am.access_count + 1,
        last_accessed_at = clock_timestamp()
    from candidates c
    where am.id = c.id
    returning am.id
  ),
  logged as (
    -- Registro atómico en agent_memory_access_log
    insert into public.agent_memory_access_log (
      workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, similarity_score
    )
    select
      v_agent.workspace_id, c.id, p_agent_id, p_run_id, p_step_id, v_caller, 'read', c.similarity
    from candidates c
    returning id
  )
  select
    c.id, c.workspace_id, c.agent_id, c.user_id, c.scope, c.type, c.content, c.summary,
    c.metadata, c.trust_level, c.similarity, c.created_at, (c.access_count + 1)
  from candidates c;
end;
$$;

revoke execute on function public.match_agent_memories(uuid, vector, double precision, integer, text[], uuid, uuid) from public;
grant execute on function public.match_agent_memories(uuid, vector, double precision, integer, text[], uuid, uuid) to authenticated, service_role;

-- 8. RPC: ingest_agent_memory (Ingestión Controlada y Deduplicada)
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
  p_idempotency_hash text default null,
  p_client_idempotency_key text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_caller uuid;
  v_agent record;
  v_run record;
  v_step record;
  v_policy record;
  v_caller_role text;
  v_has_write_perm boolean;
  v_override record;
  v_target_status text;
  v_computed_hash text;
  v_inserted_id uuid;
  v_result record;
begin
  -- 1. Validar autenticación
  v_caller := auth.uid();
  if v_caller is null then
    return jsonb_build_object('success', false, 'error_code', 'AUTH_REQUIRED', 'error_message', 'Sesión autenticada requerida.');
  end if;

  -- 2. Derivar workspace_id desde el agente
  select * into v_agent from public.agents where id = p_agent_id;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_NOT_FOUND', 'error_message', 'Agente no encontrado.');
  end if;

  -- 3. Validar pertenencia del usuario al workspace del agente
  select role into v_caller_role
  from public.workspace_members
  where workspace_id = v_agent.workspace_id and user_id = v_caller;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'Sin acceso al workspace de este agente.');
  end if;

  -- 4. Validar procedencia del Run y Step si vienen informados
  if p_source_run_id is not null then
    select * into v_run from public.agent_runs where id = p_source_run_id;
    if not found or v_run.workspace_id <> v_agent.workspace_id or v_run.agent_id <> p_agent_id then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'Procedencia de run inválida o cross-tenant.');
    end if;
  end if;

  if p_source_step_id is not null then
    select * into v_step from public.agent_run_steps where id = p_source_step_id;
    if not found or v_step.workspace_id <> v_agent.workspace_id or v_step.run_id <> p_source_run_id then
      return jsonb_build_object('success', false, 'error_code', 'AGENT_PERMISSION_DENIED', 'error_message', 'Procedencia de step inválida o cross-tenant.');
    end if;
  end if;

  -- 5. Validar permiso memory.write
  v_has_write_perm := false;
  select * into v_override
  from public.workspace_permissions
  where workspace_id = v_agent.workspace_id and user_id = v_caller and permission_key = 'memory.write';

  if found then
    if v_override.effect = 'allow' then v_has_write_perm := true;
    elsif v_override.effect = 'deny' then v_has_write_perm := false; end if;
  else
    select exists (
      select 1 from public.role_permissions where role = v_caller_role and permission_key = 'memory.write'
    ) into v_has_write_perm;
  end if;

  if not v_has_write_perm then
    return jsonb_build_object('success', false, 'error_code', 'PERMISSION_DENIED', 'error_message', 'Usuario carece de permiso memory.write.');
  end if;

  -- 6. Restricciones por Rol (Member no puede crear scope=workspace)
  if v_caller_role = 'member' and p_scope = 'workspace' then
    return jsonb_build_object('success', false, 'error_code', 'INSUFFICIENT_ADMINISTRATIVE_HIERARCHY', 'error_message', 'Los miembros no pueden crear memorias con scope workspace.');
  end if;

  -- 7. Determinar estado inicial según AgentPolicy
  select * into v_policy from public.agent_policies where agent_id = p_agent_id;
  if found and not v_policy.memory_enabled then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_DISABLED', 'error_message', 'La memoria está deshabilitada para este agente.');
  end if;

  if found and v_policy.memory_write_mode = 'disabled' then
    return jsonb_build_object('success', false, 'error_code', 'MEMORY_WRITE_DISABLED', 'error_message', 'La escritura de memoria está deshabilitada en la política del agente.');
  end if;

  v_target_status := 'quarantined';
  if found and v_policy.memory_write_mode = 'automatic' then
    v_target_status := 'active';
  end if;

  -- 8. Hash canónico de idempotencia
  v_computed_hash := coalesce(p_idempotency_hash, encode(digest(p_content || ':' || p_type || ':' || p_scope, 'sha256'), 'hex'));

  -- 9. Inserción con deduplicación idempotente
  insert into public.agent_memories (
    workspace_id,
    agent_id,
    user_id,
    scope,
    type,
    content,
    summary,
    metadata,
    embedding,
    status,
    trust_level,
    source_run_id,
    source_step_id,
    idempotency_hash,
    client_idempotency_key,
    expires_at
  ) values (
    v_agent.workspace_id,
    p_agent_id,
    v_caller,
    p_scope,
    p_type,
    p_content,
    p_summary,
    p_metadata,
    p_embedding,
    v_target_status,
    'untrusted', -- Toda memoria ingresada por API o runtime es siempre untrusted
    p_source_run_id,
    p_source_step_id,
    v_computed_hash,
    p_client_idempotency_key,
    p_expires_at
  )
  on conflict do nothing
  returning id into v_inserted_id;

  -- Si no insertó por conflicto de idempotencia, recuperar el existente
  if v_inserted_id is null then
    select id into v_inserted_id
    from public.agent_memories
    where workspace_id = v_agent.workspace_id
      and (
        (source_step_id is not null and source_step_id = p_source_step_id and idempotency_hash = v_computed_hash)
        or
        (client_idempotency_key is not null and client_idempotency_key = p_client_idempotency_key)
      )
    limit 1;

    return jsonb_build_object('success', true, 'id', v_inserted_id, 'status', 'deduplicated', 'cached', true);
  end if;

  -- 10. Registro en Auditoría
  insert into public.agent_memory_access_log (
    workspace_id, memory_id, agent_id, run_id, step_id, actor_id, operation, metadata
  ) values (
    v_agent.workspace_id, v_inserted_id, p_agent_id, p_source_run_id, p_source_step_id, v_caller,
    case when v_target_status = 'quarantined' then 'quarantine' else 'write' end,
    jsonb_build_object('scope', p_scope, 'type', p_type)
  );

  return jsonb_build_object('success', true, 'id', v_inserted_id, 'status', v_target_status, 'cached', false);
end;
$$;

revoke execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector, uuid, uuid, text, text, timestamptz) from public;
grant execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector, uuid, uuid, text, text, timestamptz) to authenticated, service_role;

-- 9. ROW LEVEL SECURITY (RLS) PARA TABLAS DE MEMORIA
alter table public.agent_memories enable row level security;
alter table public.agent_memory_access_log enable row level security;

-- POLÍTICAS: agent_memories
drop policy if exists "agent_memories_select_member" on public.agent_memories;
create policy "agent_memories_select_member" on public.agent_memories
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_memories_insert_member" on public.agent_memories;
create policy "agent_memories_insert_member" on public.agent_memories
  for insert with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_memories_update_admin" on public.agent_memories;
create policy "agent_memories_update_admin" on public.agent_memories
  for update using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

drop policy if exists "agent_memories_delete_admin" on public.agent_memories;
create policy "agent_memories_delete_admin" on public.agent_memories
  for delete using (public.is_workspace_admin(workspace_id, auth.uid()));

-- POLÍTICAS: agent_memory_access_log (Estrictamente Append-Only para lectura/inserción de miembros)
drop policy if exists "memory_access_log_select_member" on public.agent_memory_access_log;
create policy "memory_access_log_select_member" on public.agent_memory_access_log
  for select using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "memory_access_log_insert_member" on public.agent_memory_access_log;
create policy "memory_access_log_insert_member" on public.agent_memory_access_log
  for insert with check (public.is_workspace_member(workspace_id, auth.uid()));
