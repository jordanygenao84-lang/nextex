-- ==============================================================================
-- NEXTEХ — REMEDIACIÓN ETAPA A, LOTE 2, FIX DB-001 RESIDUAL
-- Cierre de protect_agent_run_transition() y validate_agent_run_step_insert()
-- para anon/PUBLIC.
--
-- Causa: las dos funciones trigger se crearon en las migraciones 01 y 02 del
-- Lote 2. Al crear una función, PostgreSQL otorga EXECUTE a PUBLIC por
-- defecto, así que ambas nacieron ejecutables por anon y el asesor las
-- reportó (2 advertencias nuevas "Public Can Execute SECURITY DEFINER
-- Function"; advertencias totales 56 -> 60).
-- No es explotable: una función trigger invocada fuera de un trigger no
-- tiene fila NEW/OLD y no hace nada. Pero el criterio de aceptación del
-- lote es 0, así que se cierra aquí. Mismo patrón que la migración 08
-- del Lote 1 (commit 0d04c15).
-- El revoke NO rompe los triggers: el chequeo de EXECUTE de una función
-- trigger se hace contra su creador, no contra el usuario que dispara el
-- evento.
--
-- ROLLBACK (SQL inverso exacto):
--   grant execute on function public.protect_agent_run_transition() to public;
--   grant execute on function public.validate_agent_run_step_insert() to public;
-- Verificación tras aplicar: re-ejecutar los asesores; los 2 hallazgos
-- 'Public Can Execute SECURITY DEFINER Function' de estas funciones deben
-- desaparecer (advertencias totales 60 -> 58).
-- ==============================================================================

revoke execute on function public.protect_agent_run_transition() from public;
revoke execute on function public.protect_agent_run_transition() from anon;
grant execute on function public.protect_agent_run_transition() to authenticated, service_role;

revoke execute on function public.validate_agent_run_step_insert() from public;
revoke execute on function public.validate_agent_run_step_insert() from anon;
grant execute on function public.validate_agent_run_step_insert() to authenticated, service_role;
