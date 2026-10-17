-- Configuración de IA por cliente (Nextex keys vs BYOK)
create table public.client_ai_config (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete cascade,
  mode text not null default 'nextex_keys' check (mode in ('nextex_keys', 'byok')),
  default_model text not null default 'gemini-1.5-flash',
  model_allowlist text[] default array['gemini-1.5-flash', 'gemini-1.5-pro'],
  monthly_token_cap bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.client_ai_config (client_id);

-- Claves API de proveedores provistas por el cliente (BYOK cifrado)
create table public.client_api_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  provider text not null check (provider in ('openai', 'google', 'anthropic')),
  label text not null,
  encrypted_key text not null,
  key_hint text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.client_api_keys (client_id, provider);

-- Auditoría de cambios en configuración de IA y gestión de llaves
create table public.client_ai_audit (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  changed_by uuid,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.client_ai_audit (client_id, created_at desc);

-- RLS: lectura para authenticated; mutaciones restringidas
alter table public.client_ai_config enable row level security;
alter table public.client_api_keys enable row level security;
alter table public.client_ai_audit enable row level security;

create policy "client_ai_config read" on public.client_ai_config for select to authenticated using (true);
create policy "client_api_keys read" on public.client_api_keys for select to authenticated using (true);
create policy "client_ai_audit read" on public.client_ai_audit for select to authenticated using (true);
