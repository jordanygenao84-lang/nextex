-- Fix CRÍTICO seguridad 2026-10-28 (prueba súper profunda): la política
-- profiles_update_own fijaba SOLO plan y status en el WITH CHECK, así que
-- cualquier usuario autenticado podía subirse a super_admin con un UPDATE
-- directo vía PostgREST (el registro es público y handle_new_user crea la
-- fila). Se exige además que is_super_admin no cambie, con el mismo patrón
-- de subconsulta que ya usaban plan y status (la subconsulta ve la fila
-- previa, por eso el patrón funciona para fijar valores).
-- Defensa en profundidad: se elimina la política permisiva `invites read`
-- (USING true) de workspace_invites; la política restrictiva restante
-- cubre el acceso legítimo y las rutas usan service client. La app no lee
-- workspace_invites con cliente de usuario (la página /invite solo llama
-- a /api/invites/accept), así que nada se rompe.

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    (auth.uid() = id)
    AND (plan = ( SELECT profiles_1.plan FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())))
    AND (status = ( SELECT profiles_1.status FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())))
    AND (is_super_admin = ( SELECT profiles_1.is_super_admin FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())))
  );

drop policy if exists "invites read" on public.workspace_invites;
