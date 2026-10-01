# NEXTEХ — Documentación Técnica de Fase 4.3
## Advanced Tool Registry, Idempotency Ledger, Fencing y Database Write Seguro

**Versión del Sistema**: 4.3.0  
**Garantía Transaccional**: *Effectively-Once* para mutaciones locales PostgreSQL / *At-Most-Once* para servicios externos.

---

## 1. Arquitectura de Gobernanza y Ejecución

El subsistema de ejecución de herramientas de NEXTEХ opera bajo el principio de **desconfianza de frontera** (*zero-trust client boundary*):

```
Agent Run
   ↓
Tool Call Propuesto
   ↓
Permission Engine (Validación de asignación, estado 'active', compatibilidad de versión)
   ↓
Schema Validator (Validación estricta de parámetros, rechazo de campos desconocidos, límite 64KB)
   ↓
Risk Engine (Clasificación de riesgo: 'read', 'write', 'destructive', 'external')
   ↓
Human-in-the-Loop (Suspensión en APPROVAL_REQUEST si riskLevel in ('write', 'destructive'))
   ↓
Binding Criptográfico de Integridad (SHA-256 sobre run_id:step_id:tool_id:version:canonicalJSON)
   ↓
Reclamo de Paso & Concurrencia (fencing_token, executor_id, lease_expires_at)
   ↓
Transacción Atómica PostgreSQL (SECURITY DEFINER RPC: execute_authorized_database_write)
   ├── Lock pesimista exclusivo: SELECT ... FOR UPDATE sobre agent_run_steps
   ├── Reconstrucción de Autoridad: auth.uid() → agent_runs → workspace_members
   ├── Verificación de Fencing: token coincide y lease vigente (según clock_timestamp() del servidor)
   ├── Verificación de Integridad: canonical JSON y payload hash coinciden con payload autorizado
   ├── Consulta de Idempotencia: tool_idempotency_ledger
   │     ├── [HIT]  → Retornar snapshot previo sellado sin re-ejecutar mutación física
   │     └── [MISS] → Ejecutar mutación en tabla autorizada + Insertar en ledger + Step 'completed'
   └── COMMIT
```

---

## 2. Catálogo de Herramientas y Restricciones de `database_write`

### Tablas Mutables Autorizadas
Únicamente se autorizan mutaciones sobre:
1. **`conversations`**:
   - `insert`: Permite crear conversaciones vinculando de forma forzada e inmutable `workspace_id` y `user_id` desde la sesión autorizada.
   - `update`: Restringido estrictamente a la columna **`title`**. Prohibida la alteración de `workspace_id`, `user_id`, `id`, `created_at` o metadatos de tenant.
   - `delete`: Elimina exclusivamente el registro verificado perteneciente al workspace del run.
2. **`agents`**:
   - `insert`: Permite crear agentes nuevos, forzando server-side:
     - `status = 'draft'` (un agente nunca puede auto-activarse).
     - `created_by = auth.uid()` derivado de la sesión.
     - `workspace_id` derivado del run verificado.
   - `update` / `delete`: Terminantemente prohibidos en esta fase.

### Prohibición Absoluta de `ai_usage`
La tabla `ai_usage` es un recurso interno y exclusivo de telemetría de cuotas del OmniEngine / AI Gateway. Queda **totalmente prohibida** cualquier mutación mediante `database_write`. Ha sido removida de todos los esquemas, validadores y registros de mutación.

---

## 3. Idempotency Ledger y Fencing Token

### Estructura de `public.tool_idempotency_ledger`
- `id uuid primary key default gen_random_uuid()`
- `workspace_id uuid not null references public.workspaces(id)`
- `run_id uuid not null references public.agent_runs(id)`
- `step_id uuid not null references public.agent_run_steps(id)`
- `tool_id text not null`
- `tool_version text not null default '1.0.0'`
- `execution_id uuid not null`
- `fencing_token bigint not null`
- `payload_hash text not null`
- `operation text not null check (operation in ('insert', 'update', 'delete'))`
- `target_table text not null check (target_table in ('conversations', 'agents'))`
- `target_record_id uuid`
- `status text not null check (status in ('committed', 'not_found', 'already_deleted'))`
- `result jsonb not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- Restricciones: `UNIQUE(step_id)`, `UNIQUE(execution_id)`

### Regla Crítica de Lease y Fencing
Para autorizar una mutación local, la RPC verifica bajo bloqueo exclusivo (`FOR UPDATE`):
1. `step.status = 'running'`
2. `step.fencing_token = p_fencing_token`
3. `step.executor_id = p_execution_id`
4. `step.lease_expires_at > clock_timestamp()` (utilizando la hora del servidor PostgreSQL, jamás del cliente o navegador)

Si un executor anterior despierta tras un retraso de red habiendo expirado su lease y habiéndose ejecutado un takeover (`claim_agent_step_takeover` incrementando el token a $N+1$), el executor obsoleto recibe **`TOOL_FENCING_REJECTED`** y su mutación es rechazada sin alterar ninguna tabla de negocio.

---

## 4. Garantías Formales de Ejecución

### Garantía Local: EFFECTIVELY-ONCE
> **Garantía aplicable ÚNICAMENTE para mutaciones locales transaccionales PostgreSQL protegidas por el Idempotency Ledger, row-level locks, fencing tokens y verificación criptográfica de hash de payload.**

Cualquier reintento de ejecución con el mismo `step_id` tras un commit exitoso encontrará la entrada correspondiente en `tool_idempotency_ledger` y devolverá el resultado sellado previo sin duplicar filas ni re-ejecutar sentencias SQL. Si la transacción falla antes de confirmar el ledger, el motor de PostgreSQL efectúa un `ROLLBACK` atómico conjunto, impidiendo estados huérfanos.

### Garantía Externa: AT-MOST-ONCE / Provider-Dependent
> **Las APIs externas (servicios HTTP de terceros, webhooks, pasarelas externas de mensajería) NO reciben garantía effectively-once.**

En llamadas a herramientas externas sujetas a fallas de red o timeouts, la garantía es **at-most-once** o depende de los mecanismos de idempotencia nativos provistos por la API del tercero (por ejemplo, cabeceras `Idempotency-Key`).

---

## 5. Limitaciones Restantes y Consideraciones
1. **Volumen de Ledger**: A medida que los runs de agentes se acumulen en millones de pasos, la tabla `tool_idempotency_ledger` requerirá particionamiento por rangos de fecha (`created_at`) o políticas de retención.
2. **Sincronización de Reloj**: Es mandatorio que los servidores de base de datos utilicen servicios de sincronización horaria NTP consistentes, dado que la expiración del lease se calcula con `clock_timestamp()`.
3. **Escritura en Múltiples Tablas**: La herramienta actual `database_write` restringe cada invocación a una única tabla objetivo por paso operativo. No soporta transacciones heterogéneas multi-tabla en un solo paso.
