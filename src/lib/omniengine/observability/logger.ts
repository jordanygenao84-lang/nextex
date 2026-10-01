/**
 * NEXTEХ OmniEngine — Logger Estructurado de Observabilidad
 * Telemetría de ejecución, métricas de latencia y trazabilidad sin filtración de secretos.
 */

import { sanitizeObject } from "../security/sanitizer";
import { TokenUsage } from "../types";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  event: string;
  requestId?: string;
  workspaceId?: string;
  userId?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: TokenUsage;
  status?: string;
  errorCode?: string;
  error?: string;
  retryable?: boolean;
  metadata?: Record<string, unknown>;
}

export class OmniLogger {
  private formatLog(entry: LogEntry): string {
    const sanitized = sanitizeObject(entry);
    return JSON.stringify(sanitized);
  }

  public info(event: string, details: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      event,
      ...details,
    };
    console.log(this.formatLog(entry));
  }

  public warn(event: string, details: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "warn",
      event,
      ...details,
    };
    console.warn(this.formatLog(entry));
  }

  public error(event: string, details: Partial<LogEntry> = {}) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      ...details,
    };
    console.error(this.formatLog(entry));
  }
}

export const omniLogger = new OmniLogger();
