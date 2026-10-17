-- Agentes de ejecución (Mac de JC, VPS Oracle, etc.)
create table public.fleet_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_key_hash text not null unique,
  status text not null default 'offline',
  last_seen_at timestamptz,
  capabilities jsonb not null default '{"max_vus": 5000, "engines": ["http"]}',
  created_at timestamptz not null default now()
);

-- Trabajos de prueba
create table public.fleet_jobs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.fleet_agents(id) on delete set null,
  name text not null,
  target_url text not null,
  vus int not null check (vus > 0 and vus <= 100000),
  duration_seconds int not null check (duration_seconds > 0 and duration_seconds <= 3600),
  rampup_seconds int not null default 60,
  scenario jsonb not null default '{}',
  status text not null default 'queued',
  created_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  summary jsonb,
  error text,
  created_at timestamptz not null default now()
);
create index on public.fleet_jobs (status, created_at desc);

-- Métricas en vivo
create table public.fleet_metrics (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.fleet_jobs(id) on delete cascade,
  ts timestamptz not null default now(),
  vus int not null,
  rps numeric not null,
  p50_ms numeric, p95_ms numeric, p99_ms numeric,
  errors int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.fleet_metrics (job_id, ts desc);

-- RLS: lectura para authenticated; escritura solo vía service_role
alter table public.fleet_agents enable row level security;
alter table public.fleet_jobs enable row level security;
alter table public.fleet_metrics enable row level security;
create policy "fleet read" on public.fleet_agents for select to authenticated using (true);
create policy "fleet read" on public.fleet_jobs for select to authenticated using (true);
create policy "fleet read" on public.fleet_metrics for select to authenticated using (true);
