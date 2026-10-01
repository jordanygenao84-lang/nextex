/**
 * NEXTEХ Agent Core — Permission Engine (Fase 4.4 & 4.5)
 * Motor central de permisos con precedencia estricta:
 * EXPLICIT DENY -> EXPLICIT ALLOW -> ROLE PERMISSION -> DEFAULT DENY
 */

import {
  CanonicalPermissionKey,
  Permission,
  WorkspaceRole,
} from "../types";

export const CANONICAL_PERMISSIONS_CATALOG: Permission[] = [
  { id: "agents.read", key: "agents.read", category: "agents", description: "Visualizar agentes y sus configuraciones en el workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "agents.create", key: "agents.create", category: "agents", description: "Registrar y configurar nuevos agentes autónomos", created_at: "2026-10-01T00:00:00Z" },
  { id: "agents.update", key: "agents.update", category: "agents", description: "Modificar instrucciones, modelos y parámetros de agentes existentes", created_at: "2026-10-01T00:00:00Z" },
  { id: "agents.delete", key: "agents.delete", category: "agents", description: "Eliminar agentes del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "agents.activate", key: "agents.activate", category: "agents", description: "Activar agentes para habilitar su ejecución", created_at: "2026-10-01T00:00:00Z" },
  { id: "agents.pause", key: "agents.pause", category: "agents", description: "Pausar agentes suspendiendo nuevas ejecuciones", created_at: "2026-10-01T00:00:00Z" },
  { id: "runs.read", key: "runs.read", category: "runs", description: "Consultar historial y telemetría de runs y steps", created_at: "2026-10-01T00:00:00Z" },
  { id: "runs.execute", key: "runs.execute", category: "runs", description: "Iniciar y despachar nuevas ejecuciones de agentes", created_at: "2026-10-01T00:00:00Z" },
  { id: "runs.cancel", key: "runs.cancel", category: "runs", description: "Cancelar runs en ejecución activa", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.read", key: "tools.read", category: "tools", description: "Descubrir herramientas disponibles en el catálogo", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.execute", key: "tools.execute", category: "tools", description: "Permiso base para invocar herramientas asignadas", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.execute_read", key: "tools.execute_read", category: "tools", description: "Ejecutar herramientas de lectura o riesgo nulo", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.execute_write", key: "tools.execute_write", category: "tools", description: "Ejecutar herramientas mutativas de base de datos", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.execute_external", key: "tools.execute_external", category: "tools", description: "Ejecutar herramientas que consumen APIs o servicios externos", created_at: "2026-10-01T00:00:00Z" },
  { id: "tools.execute_destructive", key: "tools.execute_destructive", category: "tools", description: "Ejecutar operaciones destructivas o irreversibles", created_at: "2026-10-01T00:00:00Z" },
  { id: "approvals.read", key: "approvals.read", category: "approvals", description: "Listar y auditar solicitudes de aprobación humana", created_at: "2026-10-01T00:00:00Z" },
  { id: "approvals.approve", key: "approvals.approve", category: "approvals", description: "Aprobar solicitudes de ejecución protegidas", created_at: "2026-10-01T00:00:00Z" },
  { id: "approvals.reject", key: "approvals.reject", category: "approvals", description: "Rechazar solicitudes de ejecución protegidas", created_at: "2026-10-01T00:00:00Z" },
  { id: "workspace.members.read", key: "workspace.members.read", category: "workspace", description: "Visualizar miembros, roles y estados del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "workspace.members.manage", key: "workspace.members.manage", category: "workspace", description: "Invitar, modificar roles y desasociar miembros", created_at: "2026-10-01T00:00:00Z" },
  { id: "workspace.settings.read", key: "workspace.settings.read", category: "workspace", description: "Consultar configuraciones y cuotas del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "workspace.settings.update", key: "workspace.settings.update", category: "workspace", description: "Modificar configuraciones globales del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "memory.read", key: "memory.read", category: "memory", description: "Consultar y recuperar memorias cognitivas del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "memory.write", key: "memory.write", category: "memory", description: "Persistir y consolidar nuevos recuerdos de agentes", created_at: "2026-10-01T00:00:00Z" },
  { id: "memory.delete", key: "memory.delete", category: "memory", description: "Eliminar físicamente recuerdos y ejecutar olvido de datos", created_at: "2026-10-01T00:00:00Z" },
  { id: "memory.manage", key: "memory.manage", category: "memory", description: "Administrar retención, cuotas y cuarentenas de memoria", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.read", key: "jobs.read", category: "jobs", description: "Visualizar jobs y configuraciones en el workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.create", key: "jobs.create", category: "jobs", description: "Registrar nuevos jobs autónomos durables", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.update", key: "jobs.update", category: "jobs", description: "Modificar instrucciones, reintentos y timeouts de jobs", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.delete", key: "jobs.delete", category: "jobs", description: "Eliminar o archivar jobs del workspace", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.activate", key: "jobs.activate", category: "jobs", description: "Activar jobs para permitir su ejecución o programación", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.pause", key: "jobs.pause", category: "jobs", description: "Pausar jobs suspendiendo nuevas ejecuciones", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.archive", key: "jobs.archive", category: "jobs", description: "Archivar jobs preservando su historial inmutable", created_at: "2026-10-01T00:00:00Z" },
  { id: "jobs.run", key: "jobs.run", category: "jobs", description: "Disparar ejecución manual inmediata de un job", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.read", key: "automations.read", category: "automations", description: "Visualizar programaciones y calendarios de automations", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.create", key: "automations.create", category: "automations", description: "Registrar nuevas automations y reglas cron", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.update", key: "automations.update", category: "automations", description: "Modificar reglas cron, timezone y políticas de overlap", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.delete", key: "automations.delete", category: "automations", description: "Eliminar programaciones de automation", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.activate", key: "automations.activate", category: "automations", description: "Habilitar disparo programado de automations", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.pause", key: "automations.pause", category: "automations", description: "Pausar programaciones suspendiendo generación de occurrences", created_at: "2026-10-01T00:00:00Z" },
  { id: "automations.archive", key: "automations.archive", category: "automations", description: "Archivar automations preservando historial", created_at: "2026-10-01T00:00:00Z" },
];

export const DEFAULT_ROLE_PERMISSIONS: Record<WorkspaceRole, CanonicalPermissionKey[]> = {
  owner: [
    "agents.read", "agents.create", "agents.update", "agents.delete", "agents.activate", "agents.pause",
    "runs.read", "runs.execute", "runs.cancel",
    "tools.read", "tools.execute", "tools.execute_read", "tools.execute_write", "tools.execute_external", "tools.execute_destructive",
    "approvals.read", "approvals.approve", "approvals.reject",
    "workspace.members.read", "workspace.members.manage",
    "workspace.settings.read", "workspace.settings.update",
    "memory.read", "memory.write", "memory.delete", "memory.manage",
    "jobs.read", "jobs.create", "jobs.update", "jobs.delete", "jobs.activate", "jobs.pause", "jobs.archive", "jobs.run",
    "automations.read", "automations.create", "automations.update", "automations.delete", "automations.activate", "automations.pause", "automations.archive"
  ],
  admin: [
    "agents.read", "agents.create", "agents.update", "agents.delete", "agents.activate", "agents.pause",
    "runs.read", "runs.execute", "runs.cancel",
    "tools.read", "tools.execute", "tools.execute_read", "tools.execute_write", "tools.execute_external",
    "approvals.read", "approvals.approve", "approvals.reject",
    "workspace.members.read",
    "workspace.settings.read",
    "memory.read", "memory.write", "memory.delete", "memory.manage",
    "jobs.read", "jobs.create", "jobs.update", "jobs.delete", "jobs.activate", "jobs.pause", "jobs.archive", "jobs.run",
    "automations.read", "automations.create", "automations.update", "automations.delete", "automations.activate", "automations.pause", "automations.archive"
  ],
  member: [
    "agents.read",
    "runs.read", "runs.execute", "runs.cancel",
    "tools.read", "tools.execute", "tools.execute_read",
    "approvals.read",
    "workspace.members.read",
    "memory.read",
    "memory.write",
    "jobs.read",
    "jobs.run",
    "automations.read"
  ],
};

export class PermissionEngine {
  /**
   * Resuelve si un usuario posee un permiso en un workspace siguiendo la cadena:
   * 1. EXPLICIT DENY
   * 2. EXPLICIT ALLOW
   * 3. ROLE PERMISSION
   * 4. DEFAULT DENY
   */
  public async can(
    userId: string,
    workspaceId: string,
    permissionKey: CanonicalPermissionKey,
    context?: {
      supabaseClient?: any;
      inMemoryOverrides?: Map<string, "allow" | "deny">; // key: `${workspaceId}:${userId}:${permissionKey}`
      inMemoryRole?: WorkspaceRole;
    }
  ): Promise<{ allowed: boolean; reason: string }> {
    if (!userId || !workspaceId || !permissionKey) {
      return { allowed: false, reason: "Contexto de autorización incompleto." };
    }

    // 1. COMPROBAR OVERRIDE EN MEMORIA (para pruebas unitarias y mocks)
    if (context?.inMemoryOverrides) {
      const overrideKey = `${workspaceId}:${userId}:${permissionKey}`;
      const override = context.inMemoryOverrides.get(overrideKey);
      if (override === "deny") {
        return { allowed: false, reason: "Permiso denegado por override explícito (EXPLICIT DENY)." };
      }
      if (override === "allow") {
        return { allowed: true, reason: "Permiso concedido por override explícito (EXPLICIT ALLOW)." };
      }
    }

    // 2. COMPROBAR BASE DE DATOS SUPABASE SI EXISTE CLIENTE
    if (context?.supabaseClient) {
      // A) Consulta de workspace_permissions (Overrides)
      const { data: overrideRecord } = await context.supabaseClient
        .from("workspace_permissions")
        .select("effect")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .eq("permission_key", permissionKey)
        .maybeSingle();

      if (overrideRecord?.effect === "deny") {
        return { allowed: false, reason: "Permiso denegado por política de workspace (EXPLICIT DENY)." };
      }
      if (overrideRecord?.effect === "allow") {
        return { allowed: true, reason: "Permiso concedido por política de workspace (EXPLICIT ALLOW)." };
      }

      // B) Consulta de rol en workspace_members
      const { data: memberRecord } = await context.supabaseClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!memberRecord) {
        return { allowed: false, reason: "El usuario no es miembro activo del workspace (DEFAULT DENY)." };
      }

      const role = memberRecord.role as WorkspaceRole;
      const rolePermissions = DEFAULT_ROLE_PERMISSIONS[role] || [];
      const hasRolePerm = rolePermissions.includes(permissionKey);

      if (hasRolePerm) {
        return { allowed: true, reason: `Permiso concedido por rol base '${role}' (ROLE PERMISSION).` };
      }

      return { allowed: false, reason: `El rol '${role}' no posee el permiso '${permissionKey}' (DEFAULT DENY).` };
    }

    // 3. RESOLUCIÓN DIRECTA POR ROL EN MEMORIA SI SE SUMINISTRA
    if (context?.inMemoryRole) {
      const rolePerms = DEFAULT_ROLE_PERMISSIONS[context.inMemoryRole] || [];
      if (rolePerms.includes(permissionKey)) {
        return { allowed: true, reason: `Permiso concedido por rol '${context.inMemoryRole}'.` };
      }
      return { allowed: false, reason: `El rol '${context.inMemoryRole}' no posee el permiso solicitado.` };
    }

    // 4. DEFAULT DENY INAPELABLE
    return { allowed: false, reason: "Sin autorización explícita para la acción (DEFAULT DENY)." };
  }
}

export const defaultPermissionEngine = new PermissionEngine();
