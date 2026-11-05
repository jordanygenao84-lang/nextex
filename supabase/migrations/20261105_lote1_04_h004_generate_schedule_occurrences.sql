-- ==============================================================================
-- NEXORA/nextex — REMEDIACIÓN ETAPA A, LOTE 1, PASO 4 (H-004)
-- Endurecimiento de generate_schedule_occurrences: solo service_role.
--
-- Cambios:
-- - REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO
--   service_role (mismo patrón que claim_job_run_v2).
-- - Cuerpo de la función SIN cambios de lógica (idéntico al de
--   supabase/migrations/20261016230000_fix_scheduler_cron_repetition.sql
--   :203-296). La lógica de generación y el cálculo de ocurrencias no se
--   tocan (eso es Lote 6, H-026).
--
-- Llamador verificado (sin cambio de código TS necesario):
-- - Único llamador vivo: src/lib/jobs/scheduler/scheduler.ts:169
--   (triggerTick), invocado SOLO desde
--   src/app/api/internal/scheduler/tick/route.ts:35 con createServiceClient()
--   (ruta protegida por Bearer CRON_SECRET). No hay ningún otro llamador
--   en src/ ni en SQL.
--
-- ROLLBACK (SQL inverso exacto):
--   revoke execute on function public.generate_schedule_occurrences() from public;
--   grant execute on function public.generate_schedule_occurrences() to authenticated, service_role;
-- ==============================================================================

create or replace function public.generate_schedule_occurrences()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_auto record;
  v_job record;
  v_active_runs integer;
  v_spawned_count integer := 0;
  v_occ_id uuid;
  v_run_id uuid;
  v_target_time timestamptz;
begin
  for v_auto in
    select a.*
    from public.automations a
    where a.status = 'active'
      and (a.next_scheduled_at is null or a.next_scheduled_at <= clock_timestamp())
    order by a.next_scheduled_at asc nulls first
    limit 20
    for update of a skip locked
  loop
    select * into v_job from public.jobs where id = v_auto.job_id;
    if not found or v_job.status <> 'active' then
      continue;
    end if;

    v_target_time := coalesce(v_auto.next_scheduled_at, clock_timestamp());

    -- 1. Insertar ocurrencia con protección UNIQUE anti-duplicados
    insert into public.schedule_occurrences (
      workspace_id, automation_id, job_id, scheduled_for, status
    ) values (
      v_auto.workspace_id, v_auto.id, v_auto.job_id, v_target_time, 'pending'
    )
    on conflict (automation_id, scheduled_for) do nothing
    returning id into v_occ_id;

    if v_occ_id is not null then
      -- 2. Evaluar Política de Overlap
      if v_auto.concurrency_policy = 'forbid' then
        select count(*) into v_active_runs
        from public.job_runs
        where job_id = v_auto.job_id
          and status in ('queued', 'claimed', 'running', 'waiting_approval');

        if v_active_runs > 0 then
          update public.schedule_occurrences
          set status = 'skipped', skip_reason = 'OVERLAP_FORBIDDEN'
          where id = v_occ_id;

          -- Avanzar próximo schedule según expresión cron calculada desde v_target_time
          update public.automations
          set last_scheduled_at = v_target_time,
              next_scheduled_at = public.cron_next_safe(v_auto.cron_expression, v_auto.timezone, v_target_time),
              updated_at = clock_timestamp()
          where id = v_auto.id;

          continue;
        end if;
      end if;

      -- 3. Encolar Job Run
      insert into public.job_runs (
        workspace_id, job_id, automation_id, occurrence_id, agent_id, priority, status,
        input, attempt, max_attempts, configuration_version, configuration_hash, queued_at
      ) values (
        v_auto.workspace_id, v_auto.job_id, v_auto.id, v_occ_id, v_job.agent_id, 'normal', 'queued',
        v_job.input, 1, 3, v_job.configuration_version, v_job.configuration_hash, clock_timestamp()
      ) returning id into v_run_id;

      update public.schedule_occurrences
      set status = 'spawned', job_run_id = v_run_id
      where id = v_occ_id;

      v_spawned_count := v_spawned_count + 1;
    end if;

    -- Actualizar fechas en automation según expresión cron calculada desde v_target_time
    update public.automations
    set last_scheduled_at = v_target_time,
        next_scheduled_at = public.cron_next_safe(v_auto.cron_expression, v_auto.timezone, v_target_time),
        updated_at = clock_timestamp()
    where id = v_auto.id;
  end loop;

  return jsonb_build_object('success', true, 'spawned_count', v_spawned_count);
end;
$$;

revoke execute on function public.generate_schedule_occurrences() from public;
revoke execute on function public.generate_schedule_occurrences() from anon;
revoke execute on function public.generate_schedule_occurrences() from authenticated;
grant execute on function public.generate_schedule_occurrences() to service_role;
