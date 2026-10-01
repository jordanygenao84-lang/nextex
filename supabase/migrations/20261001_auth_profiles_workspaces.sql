-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN OFICIAL FASE 2
-- Autenticación, Perfiles de Usuario, Workspaces y Políticas RLS
-- ==============================================================================

-- 1. TABLA: profiles (Separada de auth.users, sincronizada por trigger)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Comentario descriptivo
comment on table public.profiles is 'Perfiles de usuario extendidos de NEXTEХ con plan y estado';

-- 2. TABLA: workspaces (Espacios de trabajo para tareas, agentes y colaboración)
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  is_personal boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspaces is 'Espacios de trabajo de NEXTEХ aislados por inquilino';

-- 3. TABLA: workspace_members (Membresías y roles de acceso)
create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

comment on table public.workspace_members is 'Membresías de usuarios en workspaces para control RBAC';

-- 4. ÍNDICES DE RENDIMIENTO
create index if not exists idx_profiles_plan on public.profiles(plan);
create index if not exists idx_workspaces_owner on public.workspaces(owner_id);
create index if not exists idx_workspace_members_user on public.workspace_members(user_id);
create index if not exists idx_workspace_members_workspace on public.workspace_members(workspace_id);

-- 5. FUNCIÓN ACTUALIZAR TIMESTAMP
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tr_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger tr_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.handle_updated_at();

-- 6. FUNCIÓN Y TRIGGER: CREACIÓN AUTOMÁTICA DE PERFIL Y WORKSPACE PERSONAL
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_workspace_id uuid;
  v_slug text;
begin
  -- Obtener nombre completo desde metadata o fallback a email
  v_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    split_part(new.email, '@', 1)
  );

  -- Crear perfil con plan inicial 'free' y estado 'active'
  insert into public.profiles (id, full_name, plan, status)
  values (new.id, v_full_name, 'free', 'active')
  on conflict (id) do nothing;

  -- Generar slug único para el workspace personal
  v_slug := lower(regexp_replace(v_full_name, '[^a-zA-Z0-9]', '', 'g')) || '-' || substr(md5(random()::text), 1, 6);

  -- Crear workspace personal
  insert into public.workspaces (name, slug, owner_id, is_personal)
  values (v_full_name || ' Workspace', v_slug, new.id, true)
  returning id into v_workspace_id;

  -- Asignar membresía de owner en el workspace
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$ language plpgsql;

-- Trigger sobre auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==============================================================================
-- 7. ROW LEVEL SECURITY (RLS) ESTRICTO — AISLAMIENTO MULTI-INQUILINO
-- ==============================================================================

-- Habilitar RLS en todas las tablas
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- POLÍTICAS: profiles
-- Cada usuario solo puede ver su propio perfil
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

-- Cada usuario solo puede actualizar su propio nombre/avatar (no su plan ni status)
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- El plan y status se protegen contra modificación arbitraria desde cliente
    and (plan = (select plan from public.profiles where id = auth.uid()))
    and (status = (select status from public.profiles where id = auth.uid()))
  );

-- POLÍTICAS: workspaces
-- Los usuarios solo pueden ver workspaces de los que son miembros
create policy "workspaces_select_member"
  on public.workspaces
  for select
  using (
    exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = workspaces.id
      and workspace_members.user_id = auth.uid()
    )
  );

-- Solo usuarios autenticados pueden crear nuevos workspaces como owners
create policy "workspaces_insert_owner"
  on public.workspaces
  for insert
  with check (auth.uid() = owner_id);

-- Solo los owners o admins del workspace pueden actualizarlo
create policy "workspaces_update_admin"
  on public.workspaces
  for update
  using (
    exists (
      select 1 from public.workspace_members
      where workspace_members.workspace_id = workspaces.id
      and workspace_members.user_id = auth.uid()
      and workspace_members.role in ('owner', 'admin')
    )
  );

-- Solo el owner puede eliminar un workspace
create policy "workspaces_delete_owner"
  on public.workspaces
  for delete
  using (auth.uid() = owner_id);

-- POLÍTICAS: workspace_members
-- Los miembros pueden ver a otros miembros dentro de sus propios workspaces
create policy "workspace_members_select_coworkers"
  on public.workspace_members
  for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
      and wm.user_id = auth.uid()
    )
  );

-- Solo owners/admins del workspace pueden añadir miembros
create policy "workspace_members_insert_admin"
  on public.workspace_members
  for insert
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
    )
  );

-- Solo owners/admins pueden revocar membresías
create policy "workspace_members_delete_admin"
  on public.workspace_members
  for delete
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
    )
  );
