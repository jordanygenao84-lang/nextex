/**
 * NEXTEХ Automation Scheduler Engine (Fase 4.6)
 * Evaluación determinista de expresiones cron, husos horarios IANA,
 * transiciones DST y política de limited catch-up.
 */

export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

export class SchedulerEngine {
  /**
   * Parsea una expresión cron estándar de 5 campos (minuto, hora, día de mes, mes, día de semana).
   */
  public parseCronExpression(cron: string): ParsedCron {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`CRON_SYNTAX_ERROR: Expresión inválida '${cron}'. Se esperan 5 campos.`);
    }

    const parseField = (field: string, min: number, max: number): number[] => {
      if (field === "*") {
        const res: number[] = [];
        for (let i = min; i <= max; i++) res.push(i);
        return res;
      }
      if (field.startsWith("*/")) {
        const step = parseInt(field.slice(2), 10);
        if (isNaN(step) || step <= 0) throw new Error(`CRON_STEP_ERROR: Paso inválido en '${field}'`);
        const res: number[] = [];
        for (let i = min; i <= max; i += step) res.push(i);
        return res;
      }
      if (field.includes(",")) {
        return field.split(",").flatMap((sub) => parseField(sub, min, max));
      }
      if (field.includes("-")) {
        const [startStr, endStr] = field.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (isNaN(start) || isNaN(end) || start > end || start < min || end > max) {
          throw new Error(`CRON_RANGE_ERROR: Rango inválido '${field}'`);
        }
        const res: number[] = [];
        for (let i = start; i <= end; i++) res.push(i);
        return res;
      }
      const val = parseInt(field, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`CRON_FIELD_ERROR: Valor fuera de rango '${field}' (${min}-${max})`);
      }
      return [val];
    };

    return {
      minutes: parseField(parts[0], 0, 59),
      hours: parseField(parts[1], 0, 23),
      daysOfMonth: parseField(parts[2], 1, 31),
      months: parseField(parts[3], 1, 12),
      daysOfWeek: parseField(parts[4], 0, 6),
    };
  }

  /**
   * Calcula la próxima fecha de ejecución determinista respetando huso horario IANA y DST.
   */
  public getNextOccurrence(cron: string, timezone: string = "UTC", fromDate: Date = new Date()): Date {
    const parsed = this.parseCronExpression(cron);
    let candidate = new Date(fromDate.getTime() + 60000); // Avanzar al menos 1 minuto
    candidate.setSeconds(0, 0);

    // Búsqueda iterativa acotada hasta 5 años en el futuro
    const maxIterations = 60 * 24 * 366 * 5;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      
      // Obtener componentes en el timezone especificado
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        hour12: false,
      });

      const parts = formatter.formatToParts(candidate);
      const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

      const localMin = getPart("minute");
      const localHour = getPart("hour") === 24 ? 0 : getPart("hour");
      const localDay = getPart("day");
      const localMonth = getPart("month");
      const localDayOfWeek = candidate.getDay(); // 0 = Sunday

      const matchMin = parsed.minutes.includes(localMin);
      const matchHour = parsed.hours.includes(localHour);
      const matchDay = parsed.daysOfMonth.includes(localDay);
      const matchMonth = parsed.months.includes(localMonth);
      const matchDow = parsed.daysOfWeek.includes(localDayOfWeek);

      if (matchMin && matchHour && matchDay && matchMonth && matchDow) {
        return candidate;
      }

      // Avanzar 1 minuto
      candidate = new Date(candidate.getTime() + 60000);
    }

    throw new Error(`CRON_HORIZON_EXCEEDED: No se encontró próxima ocurrencia en 5 años.`);
  }

  /**
   * Resuelve el catching up limitado cuando el scheduler estuvo inactivo.
   * Regla: Hasta maxCatchUp ejecuciones activas, el resto 'missed'.
   */
  public resolveCatchUp(
    cron: string,
    timezone: string,
    lastScheduledAt: Date | null,
    now: Date = new Date(),
    maxCatchUp: number = 2
  ): { eligible: Date[]; missed: Date[]; nextScheduledAt: Date } {
    if (!lastScheduledAt) {
      const next = this.getNextOccurrence(cron, timezone, now);
      return { eligible: [], missed: [], nextScheduledAt: next };
    }

    const pastOccurrences: Date[] = [];
    let cur = this.getNextOccurrence(cron, timezone, lastScheduledAt);

    while (cur.getTime() <= now.getTime() && pastOccurrences.length < 100) {
      pastOccurrences.push(cur);
      cur = this.getNextOccurrence(cron, timezone, cur);
    }

    if (pastOccurrences.length === 0) {
      return { eligible: [], missed: [], nextScheduledAt: cur };
    }

    // Ordenar cronológicamente
    pastOccurrences.sort((a, b) => a.getTime() - b.getTime());

    // Las últimas maxCatchUp son elegibles para ejecucion; las anteriores se descartan como missed
    const eligibleCount = Math.min(maxCatchUp, pastOccurrences.length);
    const missed = pastOccurrences.slice(0, pastOccurrences.length - eligibleCount);
    const eligible = pastOccurrences.slice(pastOccurrences.length - eligibleCount);

    return {
      eligible,
      missed,
      nextScheduledAt: cur,
    };
  }

  /**
   * Dispara el tick del scheduler en la base de datos invocando la RPC atómica.
   */
  public async triggerTick(supabase: any): Promise<{ spawnedCount: number }> {
    if (!supabase) return { spawnedCount: 0 };

    const { data, error } = await supabase.rpc("generate_schedule_occurrences");
    if (error) throw error;
    return { spawnedCount: data?.spawned_count || 0 };
  }
}

export const defaultSchedulerEngine = new SchedulerEngine();
