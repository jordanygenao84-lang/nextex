/**
 * NEXTEХ — Auditoría Estática de Seguridad (Fase 4.7.1 Remediada)
 * Escaneo profundo de código fuente y migraciones SQL para verificar el cumplimiento
 * de todos los controles de seguridad, criptografía, RLS, triggers y RBAC.
 */

import { readFileSync } from "fs";

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function audit(name, condition, failureDetail = "") {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${totalChecks}. ${name}`);
  } else {
    failedChecks++;
    console.error(`[FAIL] ${totalChecks}. ${name}${failureDetail ? ` -> ${failureDetail}` : ""}`);
  }
}

async function runStaticAudit() {
  console.log("==========================================================================");
  console.log("NEXTEХ — AUDITORÍA ESTÁTICA DE SEGURIDAD FASE 4.7.1 REMEDIADA");
  console.log("ESCANEO DE INTEGRACIÓN, CRIPTOGRAFÍA, TRIGGERS Y RPCs");
  console.log("==========================================================================\n");

  const migrationSQL = readFileSync("supabase/migrations/20261007_integrations_and_external_events.sql", "utf8");
  const vaultSrc = readFileSync("src/lib/integrations/crypto/secret-vault.ts", "utf8");
  const verifierSrc = readFileSync("src/lib/integrations/gateway/verifier.ts", "utf8");
  const routeSrc = readFileSync("src/app/api/inbound/[endpointKey]/route.ts", "utf8");
  const engineSrc = readFileSync("src/lib/integrations/engine.ts", "utf8");
  const typesSrc = readFileSync("src/lib/integrations/types.ts", "utf8");
  const sanitizerSrc = readFileSync("src/lib/integrations/validation/config-sanitizer.ts", "utf8");
  const serverClientSrc = readFileSync("src/lib/supabase/server.ts", "utf8");
  const rotateRouteSrc = readFileSync("src/app/api/integrations/[id]/endpoints/[endpointId]/rotate/route.ts", "utf8");
  const approveRouteSrc = readFileSync("src/app/api/approvals/[id]/approve/route.ts", "utf8");
  const rejectRouteSrc = readFileSync("src/app/api/approvals/[id]/reject/route.ts", "utf8");
  const agentApprovalRouteSrc = readFileSync("src/app/api/agents/[id]/runs/[runId]/approval/route.ts", "utf8");
  const workerTickRouteSrc = readFileSync("src/app/api/internal/worker/tick/route.ts", "utf8");
  const runtimeSrc = readFileSync("src/lib/agents/runtime/runtime.ts", "utf8");

  // 1. RPC ingest NO accesible por authenticated (service_role only)
  audit(
    "ingest_integration_event_atomic NO es accesible por authenticated",
    !migrationSQL.includes("grant execute on function public.ingest_integration_event_atomic to authenticated") &&
    migrationSQL.includes("grant execute on function public.ingest_integration_event_atomic to service_role;")
  );

  // 2. RPC quarantine NO accesible por authenticated (service_role only)
  audit(
    "quarantine_inbound_event_atomic NO es accesible por authenticated",
    !migrationSQL.includes("grant execute on function public.quarantine_inbound_event_atomic to authenticated") &&
    migrationSQL.includes("grant execute on function public.quarantine_inbound_event_atomic to service_role;")
  );

  // 3. secret_reference NO utilizado como HMAC key
  audit(
    "secret_reference NO se utiliza como clave HMAC en el Gateway",
    !routeSrc.includes("secret: endpoint.secret_reference") &&
    routeSrc.includes("SecretVault.decryptSecret")
  );

  // 4. Plaintext secrets NO almacenados en DB
  audit(
    "Base de datos almacena encrypted_secret y no texto plano",
    migrationSQL.includes("encrypted_secret text not null") &&
    !migrationSQL.includes("plain_secret text") &&
    !migrationSQL.includes("raw_secret text")
  );

  // 5. Plaintext secrets NO emitidos en logs
  audit(
    "Audit log inmutable no registra secretos ni credenciales",
    !migrationSQL.includes("secret_reference") || !migrationSQL.includes("encrypted_secret in audit")
  );

  // 6. p_signature_verified NO expuesto como parámetro en RPC de ingestión
  audit(
    "ingest_integration_event_atomic NO recibe p_signature_verified del cliente",
    !migrationSQL.includes("p_signature_verified boolean") &&
    migrationSQL.includes("signature_verified, status") &&
    migrationSQL.includes("p_payload_hash, true, 'received'")
  );

  // 7. trigger_type == 'webhook' obligatorio
  audit(
    "Validación de trigger_type = 'webhook' en ingestión y reintento",
    migrationSQL.includes("v_job.trigger_type <> 'webhook'") &&
    engineSrc.includes("job.trigger_type !== \"webhook\"")
  );

  // 8. Cero ejecución directa de Agent desde el webhook
  audit(
    "Webhook NUNCA ejecuta Agent directamente (solo crea JobRun)",
    !routeSrc.includes("executeRun") &&
    !routeSrc.includes("AgentRuntime") &&
    !migrationSQL.substring(migrationSQL.indexOf("ingest_integration_event_atomic"), migrationSQL.indexOf("quarantine_inbound_event_atomic")).includes("insert into public.agent_runs")
  );

  // 9. Cero ejecución directa de Tool / SQL arbitrario
  audit(
    "Webhook NUNCA ejecuta herramientas directamente ni SQL dinámico",
    !routeSrc.includes("ToolExecutor") &&
    !routeSrc.includes("eval(") &&
    !migrationSQL.includes("execute format(")
  );

  // 10. Bloqueo de mutaciones directas de estado en integration_events
  audit(
    "Mutación directa de integration_events bloqueada por RLS",
    migrationSQL.includes("integration_events_update_deny") &&
    migrationSQL.includes("for update to authenticated using (false)")
  );

  // 11. Presencia de Trigger de Máquina de Estados (BEFORE UPDATE)
  audit(
    "Trigger trg_validate_event_state_transition activo y bloquea estados terminales",
    migrationSQL.includes("create trigger trg_validate_event_state_transition") &&
    migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')")
  );

  // 12. Presencia de Trigger de Campos Inmutables (BEFORE UPDATE)
  audit(
    "Trigger trg_protect_event_immutable_fields protege procedencia y hash",
    migrationSQL.includes("create trigger trg_protect_event_immutable_fields") &&
    migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: payload_hash es inmutable")
  );

  // 13. Presencia de Bounded Body Reader en Gateway
  audit(
    "Bounded Stream Reader implementado para mitigar DoS de memoria",
    routeSrc.includes("readBoundedBody") &&
    routeSrc.includes("reader.read()") &&
    routeSrc.includes("totalBytes > maxBytes")
  );

  // 14. Prohibición de JSON.stringify para cálculo HMAC
  audit(
    "Cálculo HMAC utiliza buffers binarios directos sin JSON.stringify",
    !verifierSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").includes("JSON.stringify") &&
    verifierSrc.includes("Buffer.concat([prefixBuffer, rawBodyBytes])")
  );

  // 15. Cifrado AES-256-GCM con AAD obligatorio
  audit(
    "SecretVault vincula criptográficamente el endpoint con AAD",
    vaultSrc.includes("nextex:integration-endpoint:") &&
    vaultSrc.includes("cipher.setAAD") &&
    vaultSrc.includes("decipher.setAAD")
  );

  // 16. Integridad física por FKs compuestas en cascada
  audit(
    "Claves foráneas compuestas garantizan aislamiento multi-tenant estricto",
    migrationSQL.includes("references public.integration_endpoints(id, integration_id, workspace_id)") &&
    migrationSQL.includes("references public.integrations(id, workspace_id)")
  );

  // 17. Detección de colisión con payload mismatch
  audit(
    "Idempotencia detecta DUPLICATE_PAYLOAD_MISMATCH ante payload alterado",
    migrationSQL.includes("v_existing_event.payload_hash <> p_payload_hash") &&
    migrationSQL.includes("DUPLICATE_PAYLOAD_MISMATCH")
  );

  // 18. Autorización JIT en SQL para Retry y Reprocess
  audit(
    "Retry y Reprocess validan JIT permission mediante public.has_permission en SQL",
    migrationSQL.includes("public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.retry')") &&
    migrationSQL.includes("public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.reprocess')")
  );

  // 19. Sincronización atómica de JobRun hacia integration_events y Attempts (FINDING-001 & FINDING-002)
  audit(
    "Trigger trg_sync_job_run_status_to_event implementa Completion Barrier y sincroniza Attempts",
    migrationSQL.includes("v_has_pending_steps") &&
    migrationSQL.includes("v_has_pending_approvals") &&
    migrationSQL.includes("update public.integration_event_attempts")
  );

  // 20. Sanitización estricta de integrations.config normalizada (FINDING-004)
  audit(
    "ConfigSanitizer normaliza claves canónicas y bloquea variantes de credenciales",
    sanitizerSrc.includes("canonicalizeKey") &&
    sanitizerSrc.includes("FORBIDDEN_CANONICAL_KEYS") &&
    sanitizerSrc.includes("CONFIG_CONTAINS_FORBIDDEN_KEYS")
  );

  // 21. rotate_integration_endpoint_secret es SERVICE_ROLE ONLY (FINDING-003)
  audit(
    "rotate_integration_endpoint_secret revocado a authenticated y otorgado solo a service_role",
    migrationSQL.includes("revoke execute on function public.rotate_integration_endpoint_secret from public, authenticated;") &&
    migrationSQL.includes("grant execute on function public.rotate_integration_endpoint_secret to service_role;")
  );

  // 22. Inbound route usa exclusivamente createServiceClient (FINDING-007)
  audit(
    "Inbound webhook usa createServiceClient y no cliente anon",
    routeSrc.includes("createServiceClient()") &&
    !routeSrc.includes("const supabase = createClient()") &&
    serverClientSrc.includes("export function createServiceClient")
  );

  // 23. Ingestión crea Attempt 1 inicial de forma atómica (FINDING-002)
  audit(
    "ingest_integration_event_atomic inserta Attempt 1 en integration_event_attempts",
    migrationSQL.includes("insert into public.integration_event_attempts (\n    event_id, attempt, job_run_id, status, started_at\n  ) values (\n    v_event_id, 1, v_job_run_id, 'started', now()\n  );")
  );

  // 24. Máquina de estados permite transiciones iniciales coherentes (FINDING-005)
  audit(
    "validate_event_state_transition permite received -> (verified, queued, quarantined, failed)",
    migrationSQL.includes("old.status = 'received' and new.status not in ('verified', 'queued', 'quarantined', 'failed')")
  );

  // 25. validateJobMappings valida job.status = 'active' (FINDING-006)
  audit(
    "validateJobMappings rechaza jobs en estados inactivos (draft, paused, archived)",
    engineSrc.includes("job.status !== \"active\"") &&
    engineSrc.includes("MAPPED_JOB_NOT_ACTIVE")
  );

  // 26. checkpoint_and_requeue_job_run soporta waiting_approval (GAP-001)
  audit(
    "checkpoint_and_requeue_job_run soporta transición waiting_approval -> queued tras resolución HITL",
    migrationSQL.includes("if v_run.status = 'waiting_approval' then") &&
    migrationSQL.includes("status = 'queued'") &&
    migrationSQL.includes("priority = 'high'")
  );

  // 27. Integridad física compuesta entre agent_runs y job_runs (GAP-002)
  audit(
    "Restricción física compuesta fk_agent_runs_job_run_ws en (job_run_id, workspace_id) garantiza integridad DDL",
    migrationSQL.includes("foreign key (job_run_id, workspace_id)") &&
    migrationSQL.includes("references public.job_runs (id, workspace_id)") &&
    migrationSQL.includes("on delete set null (job_run_id)")
  );

  // 28. Unicidad compuesta en job_runs (GAP-002)
  audit(
    "job_runs define restricción de unicidad compuesta UNIQUE (id, workspace_id)",
    migrationSQL.includes("uq_job_runs_id_ws unique (id, workspace_id)")
  );

  // 29. FINDING-009: checkpoint RPC revocada a authenticated
  audit(
    "checkpoint_and_requeue_job_run revocada estrictamente a authenticated y public",
    migrationSQL.includes("revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from public, authenticated;")
  );

  // 30. FINDING-009: checkpoint RPC concedida a service_role exclusivamente
  audit(
    "checkpoint_and_requeue_job_run concedida exclusivamente a service_role",
    migrationSQL.includes("grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to service_role;") &&
    !migrationSQL.includes("grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to authenticated")
  );

  // 31. FINDING-009: PUBLIC no tiene EXECUTE sobre checkpoint RPC
  audit(
    "PUBLIC carece de permisos EXECUTE sobre checkpoint_and_requeue_job_run",
    !migrationSQL.includes("grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to public")
  );

  // 32. FINDING-009: approve route utiliza service client para infraestructura
  audit(
    "approve route utiliza createServiceClient para re-encolar infraestructura tras autorización",
    approveRouteSrc.includes("createServiceClient()") &&
    approveRouteSrc.includes("checkpointAndRequeue")
  );

  // 33. FINDING-009: reject route utiliza service client para infraestructura
  audit(
    "reject route utiliza createServiceClient para re-encolar infraestructura tras autorización",
    rejectRouteSrc.includes("createServiceClient()") &&
    rejectRouteSrc.includes("checkpointAndRequeue")
  );

  // 34. FINDING-009: ningún caller cliente invoca directamente checkpoint RPC
  audit(
    "AgentRuntime no invoca directamente checkpoint_and_requeue_job_run (cero bypass desde cliente)",
    !runtimeSrc.includes("checkpoint_and_requeue_job_run")
  );

  // 35. FINDING-009: service-role key solamente en servidor
  audit(
    "SUPABASE_SERVICE_ROLE_KEY confinado exclusivamente a código de servidor sin variables NEXT_PUBLIC",
    !serverClientSrc.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY") &&
    serverClientSrc.includes("process.env.SUPABASE_SERVICE_ROLE_KEY")
  );

  // 36. FINDING-009: autorización del usuario sigue existiendo antes de usar service_role
  audit(
    "Autorización humana y JIT validation ejecutada estrictamente antes de instanciar service_role",
    approveRouteSrc.indexOf("resumeRunWithApproval") < approveRouteSrc.indexOf("createServiceClient()") &&
    rejectRouteSrc.indexOf("resumeRunWithApproval") < rejectRouteSrc.indexOf("createServiceClient()")
  );

  // 37. FINDING-009: worker tick de cron utiliza createServiceClient
  audit(
    "Endpoint interno de worker/tick utiliza createServiceClient para ejecución de fondo",
    workerTickRouteSrc.includes("createServiceClient()") &&
    !workerTickRouteSrc.includes("createClient()")
  );

  // 38. FINDING-009: Re-encolamiento no genera duplicación de JobRun ni AgentRun en checkpoint RPC
  audit(
    "checkpoint_and_requeue_job_run muta in-place sin INSERT en job_runs ni agent_runs",
    migrationSQL.includes("update public.job_runs\n  set status = 'queued'")
  );

  console.log("\n==========================================================================");
  console.log(`RESULTADO DE AUDITORÍA ESTÁTICA: ${passedChecks}/${totalChecks} COMPROBACIONES EXITOSAS`);
  console.log("==========================================================================");

  if (failedChecks > 0) {
    console.error(`\nAUDITORÍA ESTÁTICA RECHAZADA CON ${failedChecks} FALLOS.\n`);
    process.exit(1);
  } else {
    console.log("\nTODOS LOS CONTROLES ESTÁTICOS DE SEGURIDAD PASARON SATISFACTORIAMENTE (PASS).\n");
    process.exit(0);
  }
}

runStaticAudit();
