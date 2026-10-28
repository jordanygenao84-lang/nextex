-- Reconciliación de public.conversations (2026-10-28).
-- Causa raíz: la migración del widget (20261017_conversations.sql) usó
-- CREATE TABLE IF NOT EXISTS y fue NO-OP porque la tabla ya existía con la
-- forma del gateway (2026100103: workspace_id, user_id, title). Resultado:
-- las columnas del widget nunca existieron en producción y ningún mensaje
-- del widget se guardaba (el endpoint respondía igual, sin persistir;
-- verificado por SQL 2026-10-28: la tabla solo tiene id, workspace_id,
-- user_id, title, created_at, updated_at).
-- Esta migración agrega las columnas del widget y relaja los NOT NULL que
-- el widget no provee (workspace_id, user_id) — sin eso, el insert del
-- widget seguiría fallando aunque existieran las columnas nuevas.
alter table public.conversations
  add column if not exists client_id uuid references public.clients(id) on delete cascade,
  add column if not exists channel text check (channel in ('widget', 'whatsapp', 'instagram', 'other')),
  add column if not exists external_chat_id text,
  add column if not exists visitor_name text,
  add column if not exists status text not null default 'bot' check (status in ('bot', 'human', 'paused')),
  add column if not exists last_message_at timestamptz not null default now();

alter table public.conversations
  alter column workspace_id drop not null,
  alter column user_id drop not null;

create unique index if not exists uq_conversations_client_channel_external
  on public.conversations (client_id, channel, external_chat_id);
