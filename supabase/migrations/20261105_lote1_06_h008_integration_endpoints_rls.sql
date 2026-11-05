-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 6 (H-008)
-- RLS de integration_endpoints: INSERT/UPDATE/DELETE exigen permiso
-- efectivo o admin, vía el has_permission ya corregido (paso 2).
--
-- Antes, las tres políticas exigían solo membresía, sin usar
-- has_permission() ni los permisos integrations.create/update/delete.
-- Nuevo: además de membresía, se exige
--   public.has_permission(auth.uid(), workspace_id,
--   'integrations.create' | 'integrations.update' | 'integrations.delete')
--   O rol admin del workspace (owner/admin vía is_workspace_admin).
-- SELECT queda por membresía, SIN cambios.
--
-- DECISIÓN DE DISEÑO — REVOKE DE COLUMNA EVALUADO Y NO APLICADO
-- (riesgo residual documentado, no bloquea el lote):
-- Se evaluó REVOKE SELECT/INSERT/UPDATE sobre encrypted_secret,
-- encryption_iv, encryption_auth_tag y secret_reference para authenticated.
-- NO es viable hoy porque el cliente de usuario escribe y relee esas
-- columnas en el flujo vivo de creación de endpoints:
-- - POST /api/integrations/[id]/endpoints usa createClient() y pasa ese
--   cliente a defaultIntegrationEngine.createEndpoint()
--   (src/lib/integrations/engine.ts:160-180), que hace INSERT con las 4
--   columnas cifradas y .select() (RETURNING *) sobre la fila creada.
-- - updateEndpoint hace lo mismo con .select() tras el UPDATE.
-- Un REVOKE de columna rompería la creación/edición de endpoints para
-- todos los usuarios. Migrar ese write-path a service client/RPC es
-- trabajo de un lote posterior (mismo patrón que el write-path de runs
-- del Lote 2). Mitigaciones que YA existen y se conservan:
-- - La UI (GET /api/integrations/[id]/endpoints) selecciona columnas
--   explícitas y NUNCA devuelve material cifrado (comentario en la ruta).
-- - La verificación de webhook (src/app/api/inbound/[endpointKey]/route.ts)
--   lee las columnas con service client, no con el cliente de usuario.
--
-- ROLLBACK (SQL inverso exacto): restaurar las tres políticas anteriores,
-- definidas en supabase/migrations/20261007_integrations_and_external_events.sql
-- :562-587 (origin/main 6f1b427):
--   drop policy if exists integration_endpoints_insert on public.integration_endpoints;
--   create policy integration_endpoints_insert on public.integration_endpoints
--     for insert to authenticated
--     with check (exists (
--       select 1 from public.workspace_members wm
--       where wm.workspace_id = integration_endpoints.workspace_id
--         and wm.user_id = auth.uid()
--     ));
--   drop policy if exists integration_endpoints_update on public.integration_endpoints;
--   create policy integration_endpoints_update on public.integration_endpoints
--     for update to authenticated
--     using (exists (
--       select 1 from public.workspace_members wm
--       where wm.workspace_id = integration_endpoints.workspace_id
--         and wm.user_id = auth.uid()
--     ));
--   drop policy if exists integration_endpoints_delete on public.integration_endpoints;
--   create policy integration_endpoints_delete on public.integration_endpoints
--     for delete to authenticated
--     using (exists (
--       select 1 from public.workspace_members wm
--       where wm.workspace_id = integration_endpoints.workspace_id
--         and wm.user_id = auth.uid()
--     ));
-- ==============================================================================

drop policy if exists integration_endpoints_insert on public.integration_endpoints;
create policy integration_endpoints_insert on public.integration_endpoints
  for insert to authenticated
  with check (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'integrations.create')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );

drop policy if exists integration_endpoints_update on public.integration_endpoints;
create policy integration_endpoints_update on public.integration_endpoints
  for update to authenticated
  using (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'integrations.update')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  )
  with check (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'integrations.update')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );

drop policy if exists integration_endpoints_delete on public.integration_endpoints;
create policy integration_endpoints_delete on public.integration_endpoints
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id, auth.uid())
    and (
      public.has_permission(auth.uid(), workspace_id, 'integrations.delete')
      or public.is_workspace_admin(workspace_id, auth.uid())
    )
  );
