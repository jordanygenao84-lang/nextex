create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  display_name text not null,
  website_url text,
  contact_name text,
  contact_email text,
  contact_phone text,
  status text not null default 'active',
  credit_limit_monthly numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.clients (workspace_id);
create index on public.clients (status);

alter table public.clients enable row level security;
create policy "clients read" on public.clients for select to authenticated using (true);
