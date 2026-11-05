-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 1 (DB-001)
-- Cierre de acceso anónimo: REVOKE EXECUTE a PUBLIC y anon sobre las 50
-- funciones SECURITY DEFINER ejecutables por anon según los asesores de
-- Supabase en vivo (2026-11-05). La A1 contaba 8 por análisis estático; el
-- conteo en vivo es 50 (ver plan §2.1 punto 1 y §3.1 paso 1).
--
-- Alcance: EXACTAMENTE estas 50 funciones, ni una más ni una menos. Firmas
-- inventariadas del repo en origin/main 6f1b427. Se conserva GRANT a
-- authenticated y service_role donde el uso interno lo exige (las RLS y los
-- RPC las invocan en contexto autenticado o de servicio).
--
-- RIESGO RESIDUAL DOCUMENTADO (no eliminado): las 3 funciones oráculo
-- has_permission, is_workspace_member e is_workspace_admin siguen siendo
-- llamables por cualquier authenticated. El riesgo se mitiga en el paso 2
-- (migración 02, has_permission reescrito con amarre al llamador) y se
-- documenta aquí; no se finge eliminado.
--
-- Notas:
-- - cleanup_old_logs() la invoca pg_cron (job 'nextex-log-retention-monthly',
--   programado como postgres/superusuario, que no depende de estos grants).
-- - Las funciones trigger (protect_*, handle_*) se disparan por triggers; el
--   chequeo de EXECUTE de un trigger se hace contra su creador, no contra el
--   usuario que dispara el evento, así que el revoke no rompe los triggers.
-- - El bloque DO final barre cualquier sobrecarga de estos 50 nombres que
--   exista en vivo y no esté en el repo (deriva repo<->vivo confirmada en
--   Lote 0, punto 11): si una firma del repo difiere de la viva, el REVOKE
--   explícito fallaría y la migración abortaría en transacción; el barrido
--   garantiza que ninguna sobrecarga quede ejecutable por anon.
--
-- ROLLBACK (SQL inverso exacto): re-otorgar EXECUTE a PUBLIC sobre las 50
-- funciones (restaura la ejecutabilidad por anon). Ejecutar como bloque DO:
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname IN (<misma lista de 50
--       nombres>) LOOP
--       EXECUTE 'grant execute on function ' || r.sig || ' to public';
--     END LOOP;
--   END $$;
-- Verificación tras aplicar: re-ejecutar los asesores de Supabase; el
-- hallazgo 'funciones SECURITY DEFINER ejecutables por anon' debe quedar en 0.
-- ==============================================================================

revoke execute on function public.archive_agent_memory(uuid) from public;
revoke execute on function public.archive_agent_memory(uuid) from anon;
grant execute on function public.archive_agent_memory(uuid) to authenticated, service_role;
revoke execute on function public.canonical_json(jsonb) from public;
revoke execute on function public.canonical_json(jsonb) from anon;
grant execute on function public.canonical_json(jsonb) to authenticated, service_role;
revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from public;
revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from anon;
grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to authenticated, service_role;
revoke execute on function public.claim_agent_step_approval(uuid, uuid, text, text, text) from public;
revoke execute on function public.claim_agent_step_approval(uuid, uuid, text, text, text) from anon;
grant execute on function public.claim_agent_step_approval(uuid, uuid, text, text, text) to authenticated, service_role;
revoke execute on function public.claim_agent_step_approval_v2(uuid, text, text, text) from public;
revoke execute on function public.claim_agent_step_approval_v2(uuid, text, text, text) from anon;
grant execute on function public.claim_agent_step_approval_v2(uuid, text, text, text) to authenticated, service_role;
revoke execute on function public.claim_agent_step_execution(uuid, uuid, uuid, integer) from public;
revoke execute on function public.claim_agent_step_execution(uuid, uuid, uuid, integer) from anon;
grant execute on function public.claim_agent_step_execution(uuid, uuid, uuid, integer) to authenticated, service_role;
revoke execute on function public.claim_agent_step_takeover(uuid, uuid, uuid, integer) from public;
revoke execute on function public.claim_agent_step_takeover(uuid, uuid, uuid, integer) from anon;
grant execute on function public.claim_agent_step_takeover(uuid, uuid, uuid, integer) to authenticated, service_role;
revoke execute on function public.claim_job_run(text, integer) from public;
revoke execute on function public.claim_job_run(text, integer) from anon;
grant execute on function public.claim_job_run(text, integer) to authenticated, service_role;
revoke execute on function public.cleanup_old_logs() from public;
revoke execute on function public.cleanup_old_logs() from anon;
grant execute on function public.cleanup_old_logs() to authenticated, service_role;
revoke execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) from public;
revoke execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) from anon;
grant execute on function public.complete_job_run(uuid, text, bigint, text, integer, integer) to authenticated, service_role;
revoke execute on function public.compute_tool_payload_hash(text, text, text, text, jsonb) from public;
revoke execute on function public.compute_tool_payload_hash(text, text, text, text, jsonb) from anon;
grant execute on function public.compute_tool_payload_hash(text, text, text, text, jsonb) to authenticated, service_role;
revoke execute on function public.create_agent_run_with_concurrency_check(uuid, text, uuid) from public;
revoke execute on function public.create_agent_run_with_concurrency_check(uuid, text, uuid) from anon;
grant execute on function public.create_agent_run_with_concurrency_check(uuid, text, uuid) to authenticated, service_role;
revoke execute on function public.cron_next_occurrence(text, text, timestamptz) from public;
revoke execute on function public.cron_next_occurrence(text, text, timestamptz) from anon;
grant execute on function public.cron_next_occurrence(text, text, timestamptz) to authenticated, service_role;
revoke execute on function public.cron_next_safe(text, text, timestamptz) from public;
revoke execute on function public.cron_next_safe(text, text, timestamptz) from anon;
grant execute on function public.cron_next_safe(text, text, timestamptz) to authenticated, service_role;
revoke execute on function public.delete_agent_memory(uuid) from public;
revoke execute on function public.delete_agent_memory(uuid) from anon;
grant execute on function public.delete_agent_memory(uuid) to authenticated, service_role;
revoke execute on function public.execute_authorized_database_write(uuid, uuid, uuid, bigint, text) from public;
revoke execute on function public.execute_authorized_database_write(uuid, uuid, uuid, bigint, text) from anon;
grant execute on function public.execute_authorized_database_write(uuid, uuid, uuid, bigint, text) to authenticated, service_role;
revoke execute on function public.fail_job_run_and_schedule_retry(uuid, text, bigint, text, text, boolean) from public;
revoke execute on function public.fail_job_run_and_schedule_retry(uuid, text, bigint, text, text, boolean) from anon;
grant execute on function public.fail_job_run_and_schedule_retry(uuid, text, bigint, text, text, boolean) to authenticated, service_role;
revoke execute on function public.generate_schedule_occurrences() from public;
revoke execute on function public.generate_schedule_occurrences() from anon;
grant execute on function public.generate_schedule_occurrences() to authenticated, service_role;
revoke execute on function public.handle_agent_memory_cleanup_on_delete() from public;
revoke execute on function public.handle_agent_memory_cleanup_on_delete() from anon;
grant execute on function public.handle_agent_memory_cleanup_on_delete() to authenticated, service_role;
revoke execute on function public.handle_agent_memory_delete() from public;
revoke execute on function public.handle_agent_memory_delete() from anon;
grant execute on function public.handle_agent_memory_delete() to authenticated, service_role;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
grant execute on function public.handle_new_user() to authenticated, service_role;
revoke execute on function public.has_permission(uuid, uuid, text) from public;
revoke execute on function public.has_permission(uuid, uuid, text) from anon;
grant execute on function public.has_permission(uuid, uuid, text) to authenticated, service_role;
revoke execute on function public.has_workspace_permission(uuid, uuid, text) from public;
revoke execute on function public.has_workspace_permission(uuid, uuid, text) from anon;
grant execute on function public.has_workspace_permission(uuid, uuid, text) to authenticated, service_role;
revoke execute on function public.heartbeat_job_run(uuid, text, bigint, integer) from public;
revoke execute on function public.heartbeat_job_run(uuid, text, bigint, integer) from anon;
grant execute on function public.heartbeat_job_run(uuid, text, bigint, integer) to authenticated, service_role;
revoke execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector(1536), uuid, uuid, text, text) from public;
revoke execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector(1536), uuid, uuid, text, text) from anon;
grant execute on function public.ingest_agent_memory(uuid, text, text, text, text, jsonb, vector(1536), uuid, uuid, text, text) to authenticated, service_role;
revoke execute on function public.ingest_integration_event_atomic(text, text, text, text, jsonb, jsonb, text) from public;
revoke execute on function public.ingest_integration_event_atomic(text, text, text, text, jsonb, jsonb, text) from anon;
grant execute on function public.ingest_integration_event_atomic(text, text, text, text, jsonb, jsonb, text) to authenticated, service_role;
revoke execute on function public.is_workspace_admin(uuid, uuid) from public;
revoke execute on function public.is_workspace_admin(uuid, uuid) from anon;
grant execute on function public.is_workspace_admin(uuid, uuid) to authenticated, service_role;
revoke execute on function public.is_workspace_member(uuid, uuid) from public;
revoke execute on function public.is_workspace_member(uuid, uuid) from anon;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated, service_role;
revoke execute on function public.match_agent_memories(uuid, vector(1536), double precision, integer, text[], uuid, uuid) from public;
revoke execute on function public.match_agent_memories(uuid, vector(1536), double precision, integer, text[], uuid, uuid) from anon;
grant execute on function public.match_agent_memories(uuid, vector(1536), double precision, integer, text[], uuid, uuid) to authenticated, service_role;
revoke execute on function public.protect_agent_memory_trust_and_provenance() from public;
revoke execute on function public.protect_agent_memory_trust_and_provenance() from anon;
grant execute on function public.protect_agent_memory_trust_and_provenance() to authenticated, service_role;
revoke execute on function public.protect_control_plane_audit_immutable() from public;
revoke execute on function public.protect_control_plane_audit_immutable() from anon;
grant execute on function public.protect_control_plane_audit_immutable() to authenticated, service_role;
revoke execute on function public.protect_event_immutable_fields() from public;
revoke execute on function public.protect_event_immutable_fields() from anon;
grant execute on function public.protect_event_immutable_fields() to authenticated, service_role;
revoke execute on function public.protect_immutable_approval() from public;
revoke execute on function public.protect_immutable_approval() from anon;
grant execute on function public.protect_immutable_approval() to authenticated, service_role;
revoke execute on function public.protect_immutable_step_payload() from public;
revoke execute on function public.protect_immutable_step_payload() from anon;
grant execute on function public.protect_immutable_step_payload() to authenticated, service_role;
revoke execute on function public.protect_integration_audit_immutable() from public;
revoke execute on function public.protect_integration_audit_immutable() from anon;
grant execute on function public.protect_integration_audit_immutable() to authenticated, service_role;
revoke execute on function public.protect_job_audit_immutable() from public;
revoke execute on function public.protect_job_audit_immutable() from anon;
grant execute on function public.protect_job_audit_immutable() to authenticated, service_role;
revoke execute on function public.protect_memory_access_log_immutable() from public;
revoke execute on function public.protect_memory_access_log_immutable() from anon;
grant execute on function public.protect_memory_access_log_immutable() to authenticated, service_role;
revoke execute on function public.protect_permission_hierarchy() from public;
revoke execute on function public.protect_permission_hierarchy() from anon;
grant execute on function public.protect_permission_hierarchy() to authenticated, service_role;
revoke execute on function public.quarantine_agent_memory(uuid, text) from public;
revoke execute on function public.quarantine_agent_memory(uuid, text) from anon;
grant execute on function public.quarantine_agent_memory(uuid, text) to authenticated, service_role;
revoke execute on function public.quarantine_inbound_event_atomic(text, text, text, text, jsonb, text, text) from public;
revoke execute on function public.quarantine_inbound_event_atomic(text, text, text, text, jsonb, text, text) from anon;
grant execute on function public.quarantine_inbound_event_atomic(text, text, text, text, jsonb, text, text) to authenticated, service_role;
revoke execute on function public.recover_stale_job_runs(integer) from public;
revoke execute on function public.recover_stale_job_runs(integer) from anon;
grant execute on function public.recover_stale_job_runs(integer) to authenticated, service_role;
revoke execute on function public.release_job_run_for_approval(uuid, text, bigint) from public;
revoke execute on function public.release_job_run_for_approval(uuid, text, bigint) from anon;
grant execute on function public.release_job_run_for_approval(uuid, text, bigint) to authenticated, service_role;
revoke execute on function public.reprocess_integration_event(uuid) from public;
revoke execute on function public.reprocess_integration_event(uuid) from anon;
grant execute on function public.reprocess_integration_event(uuid) to authenticated, service_role;
revoke execute on function public.retry_integration_event(uuid) from public;
revoke execute on function public.retry_integration_event(uuid) from anon;
grant execute on function public.retry_integration_event(uuid) to authenticated, service_role;
revoke execute on function public.rotate_integration_endpoint_secret(uuid, text, text, text, text, integer) from public;
revoke execute on function public.rotate_integration_endpoint_secret(uuid, text, text, text, text, integer) from anon;
grant execute on function public.rotate_integration_endpoint_secret(uuid, text, text, text, text, integer) to authenticated, service_role;
revoke execute on function public.sync_job_run_status_to_event() from public;
revoke execute on function public.sync_job_run_status_to_event() from anon;
grant execute on function public.sync_job_run_status_to_event() to authenticated, service_role;
revoke execute on function public.unquarantine_agent_memory(uuid) from public;
revoke execute on function public.unquarantine_agent_memory(uuid) from anon;
grant execute on function public.unquarantine_agent_memory(uuid) to authenticated, service_role;
revoke execute on function public.update_agent_memory_metadata(uuid, jsonb, text) from public;
revoke execute on function public.update_agent_memory_metadata(uuid, jsonb, text) from anon;
grant execute on function public.update_agent_memory_metadata(uuid, jsonb, text) to authenticated, service_role;
revoke execute on function public.validate_event_state_transition() from public;
revoke execute on function public.validate_event_state_transition() from anon;
grant execute on function public.validate_event_state_transition() to authenticated, service_role;
revoke execute on function public.verify_agent_memory(uuid) from public;
revoke execute on function public.verify_agent_memory(uuid) from anon;
grant execute on function public.verify_agent_memory(uuid) to authenticated, service_role;

-- Barrido anti-deriva: cualquier sobrecarga de estos 50 nombres que exista en
-- vivo (y no en el repo) queda igualmente cerrada a PUBLIC/anon.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('archive_agent_memory', 'canonical_json', 'checkpoint_and_requeue_job_run', 'claim_agent_step_approval', 'claim_agent_step_approval_v2', 'claim_agent_step_execution', 'claim_agent_step_takeover', 'claim_job_run', 'cleanup_old_logs', 'complete_job_run', 'compute_tool_payload_hash', 'create_agent_run_with_concurrency_check', 'cron_next_occurrence', 'cron_next_safe', 'delete_agent_memory', 'execute_authorized_database_write', 'fail_job_run_and_schedule_retry', 'generate_schedule_occurrences', 'handle_agent_memory_cleanup_on_delete', 'handle_agent_memory_delete', 'handle_new_user', 'has_permission', 'has_workspace_permission', 'heartbeat_job_run', 'ingest_agent_memory', 'ingest_integration_event_atomic', 'is_workspace_admin', 'is_workspace_member', 'match_agent_memories', 'protect_agent_memory_trust_and_provenance', 'protect_control_plane_audit_immutable', 'protect_event_immutable_fields', 'protect_immutable_approval', 'protect_immutable_step_payload', 'protect_integration_audit_immutable', 'protect_job_audit_immutable', 'protect_memory_access_log_immutable', 'protect_permission_hierarchy', 'quarantine_agent_memory', 'quarantine_inbound_event_atomic', 'recover_stale_job_runs', 'release_job_run_for_approval', 'reprocess_integration_event', 'retry_integration_event', 'rotate_integration_endpoint_secret', 'sync_job_run_status_to_event', 'unquarantine_agent_memory', 'update_agent_memory_metadata', 'validate_event_state_transition', 'verify_agent_memory')
  loop
    execute 'revoke execute on function ' || r.sig || ' from public';
    execute 'revoke execute on function ' || r.sig || ' from anon';
    execute 'grant execute on function ' || r.sig || ' to authenticated, service_role';
  end loop;
end $$;
