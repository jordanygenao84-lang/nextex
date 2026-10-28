-- Rate limit persistente del widget público (SEC residual, 2026-10-28).
-- Contadores por (embed_key + IP hasheada), 30 mensajes/minuto.
-- Sin políticas RLS: solo service_role puede leer/escribir (el endpoint
-- del widget usa service client). El código usa esta tabla cuando existe
-- y cae al límite en memoria si aún no se aplicó esta migración, así que
-- el despliegue es seguro antes y después de correrla.
create table if not exists public.widget_rate_limits (
  bucket_key text primary key,
  count integer not null default 0,
  reset_at timestamptz not null
);

alter table public.widget_rate_limits enable row level security;

comment on table public.widget_rate_limits is 'Contadores persistentes del rate limit del widget público (30 msgs/min por embed_key+IP hasheada). Sin políticas: solo service_role.';
