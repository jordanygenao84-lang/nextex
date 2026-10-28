-- HITL: approval_requests tenía SOLO política SELECT para miembros.
-- El AgentRuntime inserta la solicitud formal con el cliente del usuario
-- (igual que agent_run_steps, que sí tiene política INSERT), así que el
-- insert fallaba con RLS y el run quedaba en espera sin nada aprobable.
-- Se agregan INSERT (crear la solicitud al pedir aprobación) y UPDATE
-- (resolverla desde /control-plane/approvals). El trigger
-- tr_protect_immutable_approval sigue impidiendo reabrir solicitudes ya
-- resueltas, así que la política UPDATE no debilita esa garantía.

drop policy if exists "approval_requests_insert_member" on public.approval_requests;
create policy "approval_requests_insert_member"
  on public.approval_requests
  for insert
  with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "approval_requests_update_member" on public.approval_requests;
create policy "approval_requests_update_member"
  on public.approval_requests
  for update
  using (public.is_workspace_member(workspace_id, auth.uid()))
  with check (public.is_workspace_member(workspace_id, auth.uid()));
