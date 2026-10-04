/**
 * NEXTEХ (Nexora Texter) — Control Plane Governance Manager (Fase 4.10-H)
 * Autoridad transversal de gobernanza, límites de autoridad y decisiones
 * de autorización deterministas para todo el Control Plane.
 */

import {
  ControlPlaneDecision,
  GovernanceActorType,
  GovernanceResourceType,
  GovernanceFailureCode,
  GovernanceEvaluationContext,
  GovernanceDecisionResult,
  EvaluateApprovalParams,
  ControlPlaneError,
} from "./types";
import { AuditManager } from "./AuditManager";
import { tracer } from "@/lib/observability/tracer";
import { ObservabilityContext } from "@/lib/observability/context";

export interface GovernanceManagerConfig {
  workspaceId?: string;
  supabaseClient?: any;
  auditManager?: AuditManager;
}

export class GovernanceManager {
  private readonly workspaceId?: string;
  private readonly supabaseClient?: any;
  private readonly audit: AuditManager;

  constructor(config: GovernanceManagerConfig = {}) {
    this.workspaceId = config.workspaceId;
    this.supabaseClient = config.supabaseClient;
    this.audit =
      config.auditManager ||
      new AuditManager({
        workspaceId: this.workspaceId,
        supabaseClient: this.supabaseClient,
      });
  }

  public getAuditManager(): AuditManager {
    return this.audit;
  }

  /**
   * Evalúa de forma canónica y centralizada la autoridad de una acción administrativa o de ejecución (H1, H2, H3).
   * Emite exclusivamente: 'allow' | 'deny' | 'requires_approval' | 'blocked' | 'expired'.
   */
  public async evaluateAuthority(
    context: GovernanceEvaluationContext
  ): Promise<GovernanceDecisionResult> {
    const {
      actorId,
      actorType,
      workspaceId,
      resourceType,
      resourceId,
      action,
      permission,
      role = "member",
      targetWorkspaceId,
      targetResource,
      capabilities = [],
      requiredCapabilities = [],
      correlationId,
      traceId,
      fencingToken,
      idempotencyKey,
      metadata = {},
    } = context;

    const timestamp = new Date().toISOString();

    const makeDecision = async (
      decision: ControlPlaneDecision,
      reason: string,
      errorCode?: GovernanceFailureCode
    ): Promise<GovernanceDecisionResult> => {
      const allowed = decision === "allow";

      // Registrar siempre en auditoría canónica (H4, H7)
      try {
        await this.audit.recordEvent({
          workspaceId,
          actorId,
          actorType,
          action,
          resourceType,
          resourceId,
          decision,
          reason,
          correlationId,
          traceId,
          fencingToken,
          idempotencyKey,
          metadata: {
            ...metadata,
            errorCode,
            role,
            permission,
          },
          createdAt: timestamp,
        });
      } catch {
        // Fallback si la auditoría falla
      }

      return {
        decision,
        allowed,
        errorCode,
        reason,
        actorId,
        actorType,
        workspaceId,
        resourceType,
        resourceId,
        action,
        permission,
        fencingToken,
        correlationId,
        traceId,
        timestamp,
      };
    };

    // 1. Validaciones básicas de presencia
    if (!actorId || !workspaceId || !resourceType || !resourceId || !action) {
      return await makeDecision(
        "deny",
        "Contexto de gobernanza incompleto o parámetros obligatorios faltantes",
        "AUTHORIZATION_DENIED"
      );
    }

    // 2. Fronteras Multi-Tenant (H03, H04, H14)
    if (targetWorkspaceId && targetWorkspaceId !== workspaceId) {
      return await makeDecision(
        "deny",
        `Frontera de tenant violada: actor workspace '${workspaceId}' no coincide con target workspace '${targetWorkspaceId}'`,
        "TENANT_MISMATCH"
      );
    }

    if (targetResource && targetResource.workspace_id && targetResource.workspace_id !== workspaceId) {
      return await makeDecision(
        "deny",
        `Frontera de tenant violada: el recurso pertenece al workspace '${targetResource.workspace_id}' (llamador: '${workspaceId}')`,
        "TENANT_MISMATCH"
      );
    }

    // 3. Fronteras de Rol y Privilegios (H05, H06)
    const isOwner = role === "owner";
    const isAdmin = role === "admin" || isOwner;
    const isSystem = actorType === "system" || actorType === "dispatcher";

    // Operaciones que requieren rol administrativo (Admin / Owner o System)
    const adminActions = new Set([
      "shutdown",
      "control_plane.shutdown",
      "workers.drain",
      "workers.quarantine",
      "workers.restart",
      "workers.configure",
      "workspace.settings.update",
      "workspace.members.manage",
    ]);

    if (adminActions.has(action) && !isAdmin && !isSystem) {
      // Verificar si hay permiso explícito concedido
      const hasExplicitPerm =
        permission &&
        context.metadata?.explicitPermissions &&
        Array.isArray(context.metadata.explicitPermissions) &&
        context.metadata.explicitPermissions.includes(permission);

      if (!hasExplicitPerm) {
        return await makeDecision(
          "deny",
          `Frontera de rol: el rol '${role}' no posee privilegios administrativos para la acción '${action}'`,
          "AUTHORIZATION_DENIED"
        );
      }
    }

    // 4. Gobernanza de Workers: Capacidad vs Autoridad (H09, H10)
    if (resourceType === "worker") {
      if (targetResource) {
        if (targetResource.status === "QUARANTINED") {
          return await makeDecision(
            "blocked",
            "El worker se encuentra en cuarentena operativa y tiene sus despachos congelados",
            "AUTHORIZATION_DENIED"
          );
        }
        if (targetResource.status === "STOPPED" && action !== "workers.restart") {
          return await makeDecision(
            "blocked",
            "El worker se encuentra detenido y no puede recibir tareas",
            "RESOURCE_NOT_ACTIVE"
          );
        }
      }

      // H10: CAPABILITY != AUTHORITY
      // Validar si la acción exige capabilities técnicas
      if (requiredCapabilities.length > 0) {
        const missingCap = requiredCapabilities.find((cap) => !capabilities.includes(cap));
        if (missingCap) {
          return await makeDecision(
            "deny",
            `El worker carece de la capacidad técnica requerida: '${missingCap}'`,
            "AUTHORIZATION_DENIED"
          );
        }
      }

      // Aunque posea la capacidad técnica, ejecutar sin lease o sin autoridad es denegado
      if (action === "execute_job" && !context.metadata?.hasActiveLease) {
        return await makeDecision(
          "deny",
          "Capacidad técnica presente, pero el worker carece de lease activo o autoridad para ejecutar",
          "AUTHORIZATION_DENIED"
        );
      }
    }

    // 5. Gobernanza de Agent Policy (H07)
    if (resourceType === "agent" || resourceType === "agent_run") {
      if (targetResource) {
        if (targetResource.status === "paused" || targetResource.status === "archived") {
          return await makeDecision(
            "deny",
            `Política de agente: el agente se encuentra en estado '${targetResource.status}' y tiene la ejecución deshabilitada`,
            "POLICY_DENIED"
          );
        }
        if (targetResource.policy && targetResource.policy.allow_execution === false) {
          return await makeDecision(
            "deny",
            "Política de agente: la directiva 'allow_execution' está configurada en false",
            "POLICY_DENIED"
          );
        }
      }
    }

    // 6. Gobernanza de Tools & Riesgo HITL (H08)
    if (resourceType === "tool") {
      const riskLevel = context.metadata?.riskLevel || "read";

      if (targetResource?.status === "disabled") {
        return await makeDecision(
          "deny",
          `La herramienta '${resourceId}' está deshabilitada en la plataforma`,
          "AUTHORIZATION_DENIED"
        );
      }

      // Herramientas de riesgo write o destructive exigen HITL
      if (riskLevel === "write" || riskLevel === "destructive") {
        return await makeDecision(
          "requires_approval",
          `La herramienta '${resourceId}' posee nivel de riesgo '${riskLevel}' y requiere aprobación humana formal`,
          "APPROVAL_REQUIRED"
        );
      }
    }

    // 7. Gobernanza de JobRun (H10, H42, H43)
    if (resourceType === "job_run") {
      if (targetResource) {
        const terminalStatuses = ["completed", "failed", "cancelled", "dead_letter"];
        if (terminalStatuses.includes(targetResource.status)) {
          if (
            action === "execute" ||
            action === "runs.execute" ||
            action === "retry" ||
            action === "claim" ||
            action === "heartbeat"
          ) {
            return await makeDecision(
              "deny",
              `El JobRun '${resourceId}' está en estado terminal '${targetResource.status}'`,
              "ALREADY_TERMINAL"
            );
          }
        }
      }

      // Validación de Fencing Token (H23)
      if (fencingToken !== undefined && targetResource?.fencing_token !== undefined) {
        const attToken = BigInt(fencingToken);
        const curToken = BigInt(targetResource.fencing_token);
        if (attToken < curToken) {
          return await makeDecision(
            "blocked",
            `Fencing token ${fencingToken} desfasado frente a versión autoritativa ${targetResource.fencing_token}`,
            "FENCING_REJECTED"
          );
        }
      }

      // Validación de Expiración de Lease
      if (context.metadata?.leaseExpiresAt) {
        const leaseTime = new Date(context.metadata.leaseExpiresAt).getTime();
        if (Date.now() > leaseTime) {
          return await makeDecision(
            "blocked",
            "El lease del worker ha expirado",
            "LEASE_EXPIRED"
          );
        }
      }
    }

    // Decisión Autorizada por defecto
    return await makeDecision(
      "allow",
      `Acción '${action}' autorizada bajo la política de gobernanza y rol '${role}'`
    );
  }

  /**
   * Resuelve la gobernanza de aprobación humana (HITL) (H31, H32, H33, H34, H35, H36, H37).
   */
  public async evaluateApproval(
    params: EvaluateApprovalParams
  ): Promise<GovernanceDecisionResult> {
    const {
      workspaceId,
      approvalRequestId,
      approverId,
      requesterId,
      approverRole = "member",
      approverPermissions = [],
      expectedPayloadHash,
      actualPayloadHash,
      status,
      expiresAt,
      isCancellationPending,
    } = params;

    const timestamp = new Date().toISOString();

    const makeApprovalDecision = async (
      decision: ControlPlaneDecision,
      reason: string,
      errorCode?: GovernanceFailureCode
    ): Promise<GovernanceDecisionResult> => {
      const allowed = decision === "allow";

      try {
        await this.audit.recordEvent({
          workspaceId,
          actorId: approverId,
          actorType: "user",
          action: "evaluate_approval",
          resourceType: "approval",
          resourceId: approvalRequestId,
          decision,
          reason,
          metadata: {
            errorCode,
            requesterId,
            approverRole,
            status,
          },
          createdAt: timestamp,
        });
      } catch {
        // Fallback
      }

      return {
        decision,
        allowed,
        errorCode,
        reason,
        actorId: approverId,
        actorType: "user",
        workspaceId,
        resourceType: "approval",
        resourceId: approvalRequestId,
        action: "evaluate_approval",
        timestamp,
      };
    };

    // 1. Anti-Self-Approval: El creador del run no puede aprobarse a sí mismo (H32)
    if (approverId === requesterId) {
      return await makeApprovalDecision(
        "blocked",
        "Auto-aprobación prohibida: el solicitante del run no puede aprobar su propia operación",
        "AUTHORIZATION_DENIED"
      );
    }

    // 2. Cancellation vs Approval Race: Si existe cancelación pendiente, la cancelación prevalece (H36)
    if (isCancellationPending) {
      return await makeApprovalDecision(
        "blocked",
        "Cancelación autoritativa en curso prevalece sobre cualquier intento de aprobación",
        "ALREADY_TERMINAL"
      );
    }

    // 3. Expiración de TTL de la Solicitud (H33)
    if (expiresAt && Date.now() > new Date(expiresAt).getTime()) {
      return await makeApprovalDecision(
        "expired",
        "La solicitud de aprobación ha superado su tiempo de vida (TTL) y está expirada",
        "APPROVAL_EXPIRED"
      );
    }

    // 4. Anti-Replay: Solicitud ya resuelta no puede volver a aprobarse (H35)
    if (status !== "pending") {
      return await makeApprovalDecision(
        "blocked",
        `La solicitud de aprobación ya fue resuelta previamente (estado actual: '${status}')`,
        "DUPLICATE_REQUEST"
      );
    }

    // 5. Inmutabilidad del Payload y Anti-Tampering (H34)
    if (expectedPayloadHash && actualPayloadHash && expectedPayloadHash !== actualPayloadHash) {
      return await makeApprovalDecision(
        "blocked",
        "Discrepancia en el hash canónico del payload (detección de manipulación o alteración)",
        "POLICY_DENIED"
      );
    }

    // 6. Autoridad y Permiso del Aprobador (H31)
    const hasApprovePerm =
      approverRole === "owner" ||
      approverRole === "admin" ||
      approverPermissions.includes("approvals.approve");

    if (!hasApprovePerm) {
      return await makeApprovalDecision(
        "deny",
        "El usuario carece de permiso para aprobar solicitudes ('approvals.approve')",
        "AUTHORIZATION_DENIED"
      );
    }

    return await makeApprovalDecision(
      "allow",
      "Aprobación humana validada y autorizada conforme a la política HITL"
    );
  }

  /**
   * Valida autoridad para drenado de worker (H38).
   */
  public async evaluateWorkerDrain(params: {
    workerId: string;
    actorId: string;
    role: string;
    workspaceId: string;
    workerWorkspaceId: string;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: "user",
      workspaceId: params.workspaceId,
      resourceType: "worker",
      resourceId: params.workerId,
      action: "workers.drain",
      role: params.role,
      targetWorkspaceId: params.workerWorkspaceId,
      permission: "workers.drain",
    });
  }

  /**
   * Valida autoridad para cuarentena de worker (H39).
   */
  public async evaluateWorkerQuarantine(params: {
    workerId: string;
    actorId: string;
    role: string;
    workspaceId: string;
    workerWorkspaceId: string;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: "user",
      workspaceId: params.workspaceId,
      resourceType: "worker",
      resourceId: params.workerId,
      action: "workers.quarantine",
      role: params.role,
      targetWorkspaceId: params.workerWorkspaceId,
      permission: "workers.quarantine",
    });
  }

  /**
   * Valida autoridad para recuperación de worker (H40).
   */
  public async evaluateWorkerRecovery(params: {
    workerId: string;
    actorId: string;
    role?: string;
    workspaceId: string;
    workerWorkspaceId: string;
    actorType?: GovernanceActorType;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: params.actorType || "system",
      workspaceId: params.workspaceId,
      resourceType: "worker",
      resourceId: params.workerId,
      action: "workers.recover",
      role: params.role || "owner",
      targetWorkspaceId: params.workerWorkspaceId,
      permission: "workers.recover",
    });
  }

  /**
   * Valida autoridad para reinicio de worker (H41).
   */
  public async evaluateWorkerRestart(params: {
    workerId: string;
    actorId: string;
    role: string;
    workspaceId: string;
    workerWorkspaceId: string;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: "user",
      workspaceId: params.workspaceId,
      resourceType: "worker",
      resourceId: params.workerId,
      action: "workers.restart",
      role: params.role,
      targetWorkspaceId: params.workerWorkspaceId,
      permission: "workers.restart",
    });
  }

  /**
   * Valida autoridad para cancelación de job o run (H42).
   */
  public async evaluateJobCancel(params: {
    jobRunId: string;
    actorId: string;
    role: string;
    workspaceId: string;
    runWorkspaceId: string;
    actorType?: GovernanceActorType;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: params.actorType || "user",
      workspaceId: params.workspaceId,
      resourceType: "job_run",
      resourceId: params.jobRunId,
      action: "runs.cancel",
      role: params.role,
      targetWorkspaceId: params.runWorkspaceId,
      permission: "runs.cancel",
    });
  }

  /**
   * Valida autoridad para reintento de job o run (H43).
   */
  public async evaluateJobRetry(params: {
    jobRunId: string;
    actorId: string;
    role: string;
    workspaceId: string;
    runWorkspaceId: string;
    targetRun?: any;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: "user",
      workspaceId: params.workspaceId,
      resourceType: "job_run",
      resourceId: params.jobRunId,
      action: "runs.execute",
      role: params.role,
      targetWorkspaceId: params.runWorkspaceId,
      targetResource: params.targetRun,
      permission: "runs.execute",
    });
  }

  /**
   * Valida autoridad para recuperación de job (H44).
   */
  public async evaluateJobRecovery(params: {
    jobRunId: string;
    actorId: string;
    workspaceId: string;
    runWorkspaceId: string;
    actorType?: GovernanceActorType;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: params.actorType || "system",
      workspaceId: params.workspaceId,
      resourceType: "job_run",
      resourceId: params.jobRunId,
      action: "recovery",
      role: "owner",
      targetWorkspaceId: params.runWorkspaceId,
      permission: "workers.recover",
    });
  }

  /**
   * Valida autoridad para ejecución de Shutdown (H45).
   */
  public async evaluateShutdown(params: {
    workspaceId: string;
    actorId: string;
    role: string;
  }): Promise<GovernanceDecisionResult> {
    return this.evaluateAuthority({
      actorId: params.actorId,
      actorType: "user",
      workspaceId: params.workspaceId,
      resourceType: "shutdown",
      resourceId: params.workspaceId,
      action: "shutdown",
      role: params.role,
      targetWorkspaceId: params.workspaceId,
      permission: "workspace.settings.update",
    });
  }
}
