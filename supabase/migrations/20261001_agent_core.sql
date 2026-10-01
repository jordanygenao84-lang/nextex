-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.1
-- Agent Core: Entidades de Agentes, Herramientas Autorizadas, Runs y Pasos
-- ==============================================================================

-- 1. TABLA: agents (Definición persistente y configurable de agentes por workspace)
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  system_instructions text not null,
  model_id text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  max_steps integer not null default 10 check (max_steps > 0 and max_steps <= 50),
  max_tokens integer not null default 8000 check (max_tokens > 0 and max_tokens <= 128000),
  timeout_seconds integer not null default 60 check (timeout_seconds > 0 and timeout_seconds <= 300),
  max_tool_calls integer not null default 5 check (max_tool_calls >= 0 and max_tool_calls <= 25),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agents is 'Configuración declarativa de agentes autónomos aislados por workspace';

-- 2. TABLA: agent_tools (Herramientas explícitamente autorizadas para cada agente)
create table if not exists public.agent_tools (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  tool_id text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agent_id, tool_id)
);

comment on table public.agent_tools is 'Catálogo de permisos de herramientas asignadas a cada agente';

-- 3. TABLA: agent_runs (Registro de ejecuciones concretas de agentes)
create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'timeout')),
  input text not null,
  output text,
  model_id text not null,
  tokens_input integer not null default 0,
  tokens_output integer not null default 0,
  total_tokens integer not null default 0,
  steps_count integer not null default 0,
  tool_calls_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.agent_runs is 'Historial y telemetría de ejecuciones de agentes con aislamiento multi-inquilino';

-- 4. TABLA: agent_run_steps (Trazabilidad detallada de pasos operativos por run)
create table if not exists public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_number integer not null,
  step_type text not null check (step_type in ('AI_REQUEST', 'TOOL_CALL', 'TOOL_RESULT', 'VALIDATION', 'APPROVAL_REQUEST', 'FINAL_RESPONSE')),
  status text not null default 'completed' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled', 'skipped')),
  tool_id text,
  input jsonb,
  output jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.agent_run_steps is 'Auditoría granular de pasos operativos sin almacenar chain-of-thought privado';

-- 5. ÍNDICES DE RENDIMIENTO Y CONSULTA
create index if not exists idx_agents_workspace on public.agents(workspace_id);
create index if not exists idx_agents_status on public.agents(status);
create index if not exists idx_agent_tools_agent on public.agent_tools(agent_id);
create index if not exists idx_agent_runs_workspace on public.agent_runs(workspace_id);
create index if not exists idx_agent_runs_agent on public.agent_runs(agent_id);
create index if not exists idx_agent_runs_user on public.agent_runs(user_id);
create index if not exists idx_agent_runs_status on public.agent_runs(status);
create index if not exists idx_agent_run_steps_run on public.agent_run_steps(run_id);
create index if not exists idx_agent_run_steps_workspace on public.agent_run_steps(workspace_id);

-- Triggers de actualización de updated_at (Idempotentes con drop trigger if exists)
drop trigger if exists tr_agents_updated_at on public.agents;
create trigger tr_agents_updated_at
  before update on public.agents
  for each row execute function public.handle_updated_at();

drop trigger if exists tr_agent_runs_updated_at on public.agent_runs;
create trigger tr_agent_runs_updated_at
  before update on public.agent_runs
  for each row execute function public.handle_updated_at();

-- 6. ROW LEVEL SECURITY (RLS) ESTRICTO
alter table public.agents enable row level security;
alter table public.agent_tools enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;

-- POLÍTICAS: agents
drop policy if exists "agents_select_member" on public.agents;
create policy "agents_select_member"
  on public.agents
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agents_insert_member" on public.agents;
create policy "agents_insert_member"
  on public.agents
  for insert
  with check (auth.uid() = created_by and public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agents_update_member" on public.agents;
create policy "agents_update_member"
  on public.agents
  for update
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agents_delete_member" on public.agents;
create policy "agents_delete_member"
  on public.agents
  for delete
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: agent_tools
drop policy if exists "agent_tools_select_member" on public.agent_tools;
create policy "agent_tools_select_member"
  on public.agent_tools
  for select
  using (
    exists (
      select 1 from public.agents a
      where a.id = agent_tools.agent_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
    )
  );

drop policy if exists "agent_tools_insert_member" on public.agent_tools;
create policy "agent_tools_insert_member"
  on public.agent_tools
  for insert
  with check (
    exists (
      select 1 from public.agents a
      where a.id = agent_tools.agent_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
    )
  );

drop policy if exists "agent_tools_delete_member" on public.agent_tools;
create policy "agent_tools_delete_member"
  on public.agent_tools
  for delete
  using (
    exists (
      select 1 from public.agents a
      where a.id = agent_tools.agent_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
    )
  );

-- POLÍTICAS: agent_runs
drop policy if exists "agent_runs_select_member" on public.agent_runs;
create policy "agent_runs_select_member"
  on public.agent_runs
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_runs_insert_member" on public.agent_runs;
create policy "agent_runs_insert_member"
  on public.agent_runs
  for insert
  with check (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_runs_update_member" on public.agent_runs;
create policy "agent_runs_update_member"
  on public.agent_runs
  for update
  using (public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: agent_run_steps
drop policy if exists "agent_run_steps_select_member" on public.agent_run_steps;
create policy "agent_run_steps_select_member"
  on public.agent_run_steps
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "agent_run_steps_insert_member" on public.agent_run_steps;
create policy "agent_run_steps_insert_member"
  on public.agent_run_steps
  for insert
  with check (public.is_workspace_member(workspace_id, auth.uid()));
