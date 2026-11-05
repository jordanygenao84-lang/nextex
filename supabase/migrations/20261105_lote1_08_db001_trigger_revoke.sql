-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, FIX DB-001 RESIDUAL
-- Cierre de protect_approval_transition() para anon/PUBLIC.
--
-- Causa: la función trigger protect_approval_transition() se creó en la
-- migración 07, DESPUÉS de que la 01 ya había revocado las 50 funciones.
-- Al crear una función, PostgreSQL otorga EXECUTE a PUBLIC por defecto, así
-- que la 07 nació ejecutable por anon y el asesor la reportó (50 -> 1).
-- No era explotable: una función trigger invocada fuera de un trigger no
-- tiene fila NEW/OLD y no hace nada. Pero el criterio de aceptación del
-- lote es 0, así que se cierra aquí.
-- El revoke NO rompe el trigger: el chequeo de EXECUTE de una función
-- trigger se hace contra su creador, no contra el usuario que dispara el
-- evento.
--
-- ROLLBACK (SQL inverso exacto):
--   grant execute on function public.protect_approval_transition() to public;
-- Verificación tras aplicar: re-ejecutar los asesores; el hallazgo
-- 'funciones SECURITY DEFINER ejecutables por anon' debe quedar en 0.
-- ==============================================================================

revoke execute on function public.protect_approval_transition() from public;
revoke execute on function public.protect_approval_transition() from anon;
grant execute on function public.protect_approval_transition() to authenticated, service_role;
