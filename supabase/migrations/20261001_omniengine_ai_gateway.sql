-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 3
-- OmniEngine: AI Gateway, Conversaciones, Registro de Requests y Consumo (Usage)
-- ==============================================================================

-- 1. TABLA: conversations (Espacios de conversación vinculados por workspace)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.conversations is 'Hilos de conversación aislados por workspace y usuario';

-- 2. TABLA: messages (Mensajes dentro de cada conversación)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  model text,
  tokens_input integer default 0,
  tokens_output integer default 0,
  created_at timestamptz not null default now()
);

comment on table public.messages is 'Mensajes individuales con metadata de tokens y modelos';

-- 3. TABLA: ai_requests (Auditoría de cada petición dirigida al AI Gateway)
create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  model text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_code text,
  created_at timestamptz not null default now()
);

comment on table public.ai_requests is 'Registro de ciclo de vida de peticiones dirigidas al AI Gateway';

-- 4. TABLA: ai_usage (Consumo granular de tokens y latencias)
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.ai_requests(request_id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  latency_ms integer not null default 0,
  status text not null default 'completed',
  error_code text,
  created_at timestamptz not null default now()
);

comment on table public.ai_usage is 'Métricas auditables de consumo de tokens y latencia para control de cuotas';

-- 5. ÍNDICES DE RENDIMIENTO Y TELEMETRÍA
create index if not exists idx_conversations_workspace on public.conversations(workspace_id);
create index if not exists idx_conversations_user on public.conversations(user_id);
create index if not exists idx_messages_conversation on public.messages(conversation_id);
create index if not exists idx_ai_requests_workspace on public.ai_requests(workspace_id);
create index if not exists idx_ai_requests_user on public.ai_requests(user_id);
create index if not exists idx_ai_requests_req_id on public.ai_requests(request_id);
create index if not exists idx_ai_usage_workspace on public.ai_usage(workspace_id);
create index if not exists idx_ai_usage_user on public.ai_usage(user_id);
create index if not exists idx_ai_usage_created on public.ai_usage(created_at);

-- Trigger para updated_at en conversations
create trigger tr_conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

-- 6. ROW LEVEL SECURITY (RLS) ESTRICTO
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_requests enable row level security;
alter table public.ai_usage enable row level security;

-- POLÍTICAS: conversations
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member"
  on public.conversations
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "conversations_insert_member" on public.conversations;
create policy "conversations_insert_member"
  on public.conversations
  for insert
  with check (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member"
  on public.conversations
  for update
  using (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "conversations_delete_member" on public.conversations;
create policy "conversations_delete_member"
  on public.conversations
  for delete
  using (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: messages
drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member"
  on public.messages
  for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
      and public.is_workspace_member(c.workspace_id, auth.uid())
    )
  );

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member"
  on public.messages
  for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
      and public.is_workspace_member(c.workspace_id, auth.uid())
    )
  );

-- POLÍTICAS: ai_requests
drop policy if exists "ai_requests_select_member" on public.ai_requests;
create policy "ai_requests_select_member"
  on public.ai_requests
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "ai_requests_insert_member" on public.ai_requests;
create policy "ai_requests_insert_member"
  on public.ai_requests
  for insert
  with check (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));

-- POLÍTICAS: ai_usage
drop policy if exists "ai_usage_select_member" on public.ai_usage;
create policy "ai_usage_select_member"
  on public.ai_usage
  for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "ai_usage_insert_member" on public.ai_usage;
create policy "ai_usage_insert_member"
  on public.ai_usage
  for insert
  with check (auth.uid() = user_id and public.is_workspace_member(workspace_id, auth.uid()));
