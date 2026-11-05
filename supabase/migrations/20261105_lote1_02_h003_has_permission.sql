-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 2 (H-003)
-- Reescritura de has_permission con orden de evaluación estricto.
--
-- Orden nuevo:
--   (1) Identidad (amarre al llamador): un authenticated solo consulta sus
--       propios permisos; service_role puede consultar los de cualquier
--       usuario (lo exigen los caminos de servidor). Sin sesión: denegar.
--   (2) Existencia y estado activo del workspace.
--   (3) Estado activo del usuario (suspendido/pendiente/eliminado deniega
--       aunque exista un override antiguo).
--   (4) Membresía activa.
--   (5) Denegaciones explícitas (deny-first), luego overrides allow.
--   (6) Matriz base en role_permissions.
-- Mantiene SECURITY DEFINER (lo exigen las RLS) con el revoke del paso 1.
-- Las denegaciones relevantes se registran en authorization_audit_log
-- (tabla existente; el registro nunca rompe la decisión: cualquier error
-- al auditar se traga y la denegación se devuelve igual).
--
-- Cambios de volatilidad: STABLE -> VOLATILE, porque la función ahora
-- escribe filas de auditoría (efecto secundario real).
--
-- NOTAS DE ESQUEMA (desviaciones documentadas del diseño genérico):
-- - La tabla workspaces NO tiene columna de estado (solo id, name, slug,
--   owner_id, is_personal): "workspace activo" = la fila existe. La
--   suspensión se aplica a nivel de usuario (profiles.status).
-- - La tabla workspace_members NO tiene columna de estado: "membresía
--   activa" = la fila existe.
-- - profiles.status ∈ ('active', 'suspended', 'pending'). Un usuario sin
--   fila en profiles (eliminado, o sin perfil creado porque el trigger
--   handle_new_user falta en vivo — hallazgo nuevo del Lote 0, se recrea
--   en el Lote 2) también deniega. El único operador actual (JC,
--   super admin) tiene perfil activo, así que no hay impacto operativo.
--
-- ROLLBACK (SQL inverso exacto): restaurar la función anterior, definida
-- en supabase/migrations/20261007_integrations_and_external_events.sql
-- :226-271 (origin/main 6f1b427). Cuerpo íntegro:
--   create or replace function public.has_permission(
--     p_user_id uuid,
--     p_workspace_id uuid,
--     p_permission_key text
--   )
--   returns boolean
--   language plpgsql
--   security definer
--   stable
--   set search_path = pg_catalog, public, pg_temp
--   as $$
--   declare
--     v_role text;
--     v_override text;
--   begin
--     if p_user_id is null or p_workspace_id is null or p_permission_key is null then
--       return false;
--     end if;
--     select effect into v_override
--     from public.workspace_permissions
--     where workspace_id = p_workspace_id
--       and user_id = p_user_id
--       and permission_key = p_permission_key;
--     if v_override = 'deny' then
--       return false;
--     elsif v_override = 'allow' then
--       return true;
--     end if;
--     select role into v_role
--     from public.workspace_members
--     where workspace_id = p_workspace_id
--       and user_id = p_user_id;
--     if v_role is null then
--       return false;
--     end if;
--     return exists (
--       select 1
--       from public.role_permissions
--       where role = v_role
--         and permission_key = p_permission_key
--     );
--   end;
--   $$;
-- ==============================================================================

create or replace function public.has_permission(
  p_user_id uuid,
  p_workspace_id uuid,
  p_permission_key text
)
returns boolean
language plpgsql
security definer
volatile
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text;
  v_override text;
  v_profile_status text;
begin
  if p_user_id is null or p_workspace_id is null or p_permission_key is null then
    return false;
  end if;

  -- 1. Identidad (amarre al llamador).
  if auth.role() = 'authenticated' and p_user_id <> auth.uid() then
    begin
      insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_permissions)
      values (p_workspace_id, p_user_id, 'permission.check', 'workspace', p_workspace_id::text, 'deny', 'identity_mismatch', jsonb_build_object('permission', p_permission_key));
    exception when others then
      null;
    end;
    return false;
  end if;

  -- Sin sesión (anon u otro rol sin uid) y sin service_role: denegar.
  if auth.role() <> 'service_role' and auth.uid() is null then
    return false;
  end if;

  -- 2. Existencia del workspace (sin columna de estado en el esquema).
  if not exists (select 1 from public.workspaces where id = p_workspace_id) then
    begin
      insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_permissions)
      values (p_workspace_id, p_user_id, 'permission.check', 'workspace', p_workspace_id::text, 'deny', 'workspace_not_found', jsonb_build_object('permission', p_permission_key));
    exception when others then
      null;
    end;
    return false;
  end if;

  -- 3. Estado del usuario: solo 'active' pasa. Suspendido, pendiente o sin
  --    perfil (eliminado) deniega aunque exista un override antiguo.
  select status into v_profile_status from public.profiles where id = p_user_id;
  if not found or v_profile_status <> 'active' then
    begin
      insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_permissions)
      values (p_workspace_id, p_user_id, 'permission.check', 'workspace', p_workspace_id::text, 'deny', 'user_not_active', jsonb_build_object('permission', p_permission_key));
    exception when others then
      null;
    end;
    return false;
  end if;

  -- 4. Membresía activa.
  select role into v_role
  from public.workspace_members
  where workspace_id = p_workspace_id
    and user_id = p_user_id;

  if v_role is null then
    begin
      insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_permissions)
      values (p_workspace_id, p_user_id, 'permission.check', 'workspace', p_workspace_id::text, 'deny', 'not_a_member', jsonb_build_object('permission', p_permission_key));
    exception when others then
      null;
    end;
    return false;
  end if;

  -- 5. Denegaciones explícitas (deny-first) y overrides allow.
  select effect into v_override
  from public.workspace_permissions
  where workspace_id = p_workspace_id
    and user_id = p_user_id
    and permission_key = p_permission_key;

  if v_override = 'deny' then
    begin
      insert into public.authorization_audit_log (workspace_id, actor_id, action, resource_type, resource_id, decision, reason, evaluated_permissions)
      values (p_workspace_id, p_user_id, 'permission.check', 'workspace', p_workspace_id::text, 'deny', 'explicit_deny', jsonb_build_object('permission', p_permission_key));
    exception when others then
      null;
    end;
    return false;
  elsif v_override = 'allow' then
    return true;
  end if;

  -- 6. Matriz base en role_permissions.
  return exists (
    select 1
    from public.role_permissions
    where role = v_role
      and permission_key = p_permission_key
  );
end;
$$;
