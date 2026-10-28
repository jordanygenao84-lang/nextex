-- =============================================================================
-- NEXTEХ — Refuerzo del pin de campos privilegiados de profiles (2ª vuelta)
-- Fecha: 2026-10-28. APLICAR EN EL SQL EDITOR DE SUPABASE (proyecto nextex).
-- -----------------------------------------------------------------------------
-- La política profiles_update_own ya fija is_super_admin, plan y status en
-- su WITH CHECK, pero la semántica de su subconsulta (¿ve la fila vieja o
-- la nueva?) no estaba probada en comportamiento. Este trigger BEFORE UPDATE
-- es la garantía independiente: rechaza cualquier cambio de esos tres
-- campos cuando quien ejecuta es el rol authenticated, sin depender de
-- cómo evalúe Postgres la subconsulta de la política.
--
-- No afecta a ningún flujo legítimo:
--   * service_role (p. ej. la ruta de suscripción, que cambia plan) pasa:
--     auth.role() no es 'authenticated' y el trigger no bloquea.
--   * postgres (SQL Editor) pasa por la misma razón.
--   * La página de ajustes solo actualiza full_name con cliente de usuario.
-- =============================================================================

create or replace function public.protect_profiles_privilege_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' then
    if OLD.is_super_admin is distinct from NEW.is_super_admin then
      raise exception 'No está permitido cambiar is_super_admin.';
    end if;
    if OLD.plan is distinct from NEW.plan then
      raise exception 'No está permitido cambiar plan.';
    end if;
    if OLD.status is distinct from NEW.status then
      raise exception 'No está permitido cambiar status.';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists tr_protect_profiles_privilege_fields on public.profiles;
create trigger tr_protect_profiles_privilege_fields
  before update on public.profiles
  for each row execute function public.protect_profiles_privilege_fields();
