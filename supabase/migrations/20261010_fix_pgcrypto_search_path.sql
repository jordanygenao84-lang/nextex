-- ==============================================================================
-- NEXTEХ (Nexora Texter) — MIGRACIÓN FASE 4.9.1-R2
-- Fix: Calificación explícita de extensions.digest() en compute_tool_payload_hash
-- Preserva estrictamente: SECURITY DEFINER y search_path = pg_catalog, public, pg_temp
-- ==============================================================================

create or replace function public.compute_tool_payload_hash(
  p_run_id text,
  p_step_id text,
  p_tool_id text,
  p_tool_version text,
  p_params jsonb
)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_binding text;
begin
  v_binding := p_run_id || ':' || p_step_id || ':' || p_tool_id || ':' || coalesce(p_tool_version, '1.0.0') || ':' || public.canonical_json(p_params);
  return encode(extensions.digest(convert_to(v_binding, 'UTF8'), 'sha256'), 'hex');
end;
$$;

comment on function public.compute_tool_payload_hash(text, text, text, text, jsonb) is 'Calcula el SHA-256 del binding canónico inmutable de un paso operativo calificando explícitamente extensions.digest';
