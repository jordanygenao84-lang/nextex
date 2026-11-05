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
-- - El bloque DO barre por nombre todas las sobrecargas de estos 50 nombres
--   que existan en vivo, estén o no en el repo (deriva repo<->vivo
--   confirmada en Lote 0, punto 11): si una firma del repo difiere de la
--   viva, un REVOKE explícito fallaría y la migración abortaría; el barrido
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

-- Las 50 revocaciones se hacen por NOMBRE (bloque DO de abajo), no por firma
-- explícita: en vivo al menos una firma difiere del repo
-- (ingest_agent_memory: el revoke explícito con vector(1536) falló con
-- 42883 "function does not exist" al aplicar la 01 en Supabase). El
-- barrido por nombre cierra TODAS las sobrecargas vivas de cada nombre,
-- así que la deriva de firmas ya no puede tumbar la migración. Re-ejecutar
-- esta migración es idempotente: revocar un permiso ya revocado y otorgar
-- uno ya otorgado no dan error.


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
