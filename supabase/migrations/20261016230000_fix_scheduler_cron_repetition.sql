-- ==============================================================================
-- NEXTEХ — MIGRACIÓN 20261016230000
-- Corrección de Scheduler: Cálculo determinista de próxima ocurrencia cron
-- Resuelve bug de cadencia fija de 1 hora reemplazando el hardcode con cálculo real
-- ==============================================================================

-- Helper: Parser individual de campos cron (minuto, hora, dom, mes, dow)
create or replace function public.cron_parse_field(
  p_field text,
  p_min int,
  p_max int
)
returns int[]
language plpgsql
immutable
as $$
declare
  v_res int[] := '{}';
  v_part text;
  v_step int;
  v_start int;
  v_end int;
  v_val int;
  v_dash_pos int;
begin
  if p_field is null or trim(p_field) = '' then
    raise exception 'CRON_FIELD_EMPTY: Campo cron vacío';
  end if;

  -- Lista separada por comas: 'a,b,c'
  if position(',' in p_field) > 0 then
    foreach v_part in array string_to_array(p_field, ',') loop
      v_res := v_res || public.cron_parse_field(v_part, p_min, p_max);
    end loop;
    return v_res;
  end if;

  -- Comodín total: '*'
  if p_field = '*' then
    for i in p_min..p_max loop
      v_res := array_append(v_res, i);
    end loop;
    return v_res;
  end if;

  -- Paso: '*/n'
  if p_field like '*/%' then
    begin
      v_step := substring(p_field from 3)::int;
    exception when others then
      raise exception 'CRON_STEP_ERROR: Paso inválido en %', p_field;
    end;
    if v_step is null or v_step <= 0 then
      raise exception 'CRON_STEP_ERROR: Paso inválido en %', p_field;
    end if;
    for i in p_min..p_max by v_step loop
      v_res := array_append(v_res, i);
    end loop;
    return v_res;
  end if;

  -- Rango: 'a-b'
  if position('-' in p_field) > 0 then
    v_dash_pos := position('-' in p_field);
    begin
      v_start := substring(p_field from 1 for v_dash_pos - 1)::int;
      v_end := substring(p_field from v_dash_pos + 1)::int;
    exception when others then
      raise exception 'CRON_RANGE_ERROR: Rango inválido en %', p_field;
    end;
    if v_start is null or v_end is null or v_start > v_end or v_start < p_min or v_end > p_max then
      raise exception 'CRON_RANGE_ERROR: Rango inválido en % (%..%)', p_field, p_min, p_max;
    end if;
    for i in v_start..v_end loop
      v_res := array_append(v_res, i);
    end loop;
    return v_res;
  end if;

  -- Valor individual entero
  begin
    v_val := p_field::int;
  exception when others then
    raise exception 'CRON_FIELD_ERROR: Valor no numérico en %', p_field;
  end;
  if v_val < p_min or v_val > p_max then
    raise exception 'CRON_FIELD_ERROR: Valor % fuera de rango (%..%)', v_val, p_min, p_max;
  end if;
  return array[v_val];
end;
$$;

revoke execute on function public.cron_parse_field(text, int, int) from public;
grant execute on function public.cron_parse_field(text, int, int) to authenticated, service_role;

-- 1. RPC: cron_next_occurrence (Calcula próxima ocurrencia estrictamente posterior a p_from)
create or replace function public.cron_next_occurrence(
  p_cron text,
  p_timezone text,
  p_from timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_clean text;
  v_parts text[];
  v_tz text;
  v_minutes int[];
  v_hours int[];
  v_days int[];
  v_months int[];
  v_dows int[];
  v_candidate timestamptz;
  v_local timestamp;
  v_min int;
  v_hour int;
  v_dom int;
  v_mon int;
  v_dow int;
begin
  if p_cron is null or trim(p_cron) = '' then
    raise exception 'CRON_EMPTY: Expresión cron vacía';
  end if;

  v_clean := regexp_replace(trim(p_cron), '\s+', ' ', 'g');
  v_parts := string_to_array(v_clean, ' ');

  if array_length(v_parts, 1) <> 5 then
    raise exception 'CRON_SYNTAX_ERROR: Expresión inválida %. Se esperan 5 campos', p_cron;
  end if;

  v_tz := coalesce(nullif(trim(p_timezone), ''), 'UTC');

  -- Parsear los 5 campos en conjuntos de enteros válidos
  v_minutes := public.cron_parse_field(v_parts[1], 0, 59);
  v_hours   := public.cron_parse_field(v_parts[2], 0, 23);
  v_days    := public.cron_parse_field(v_parts[3], 1, 31);
  v_months  := public.cron_parse_field(v_parts[4], 1, 12);
  v_dows    := public.cron_parse_field(v_parts[5], 0, 6);

  -- Candidato inicial: avanzar al menos 1 minuto truncado
  v_candidate := date_trunc('minute', coalesce(p_from, clock_timestamp())) + interval '1 minute';

  -- Búsqueda iterativa acotada hasta 525,600 minutos (1 año)
  for v_iter in 1..525600 loop
    v_local := v_candidate at time zone v_tz;
    v_min  := extract(minute from v_local)::int;
    v_hour := extract(hour from v_local)::int;
    v_dom  := extract(day from v_local)::int;
    v_mon  := extract(month from v_local)::int;
    v_dow  := extract(dow from v_local)::int;

    if (v_min = any(v_minutes))
       and (v_hour = any(v_hours))
       and (v_dom = any(v_days))
       and (v_mon = any(v_months))
       and (v_dow = any(v_dows)) then
      return v_candidate;
    end if;

    v_candidate := v_candidate + interval '1 minute';
  end loop;

  raise exception 'CRON_HORIZON_EXCEEDED: No se encontró próxima ocurrencia en 1 año para cron %', p_cron;
end;
$$;

revoke execute on function public.cron_next_occurrence(text, text, timestamptz) from public;
grant execute on function public.cron_next_occurrence(text, text, timestamptz) to authenticated, service_role;

-- 2. RPC: cron_next_safe (Envoltorio resiliente contra errores de sintaxis o timezone)
create or replace function public.cron_next_safe(
  p_cron text,
  p_timezone text,
  p_from timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_next timestamptz;
  v_base timestamptz;
begin
  v_base := coalesce(p_from, clock_timestamp());
  begin
    v_next := public.cron_next_occurrence(p_cron, p_timezone, v_base);
    return v_next;
  exception when others then
    return v_base + interval '1 hour';
  end;
end;
$$;

revoke execute on function public.cron_next_safe(text, text, timestamptz) from public;
grant execute on function public.cron_next_safe(text, text, timestamptz) to authenticated, service_role;

-- 3. RPC: generate_schedule_occurrences (Con cálculo dinámico exacto de next_scheduled_at)
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
grant execute on function public.generate_schedule_occurrences() to authenticated, service_role;
