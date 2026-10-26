# Runbook de respuesta a incidentes — nextex

Documento vivo. Quien decide es el dueño de la plataforma (JC). Este runbook no
sustituye el criterio: ante duda, contener primero y preguntar después.

## 1. Detectar

Señales: alertas de Telegram de VIGÍA, incidentes en `/admin/vigilancia`,
errores agrupados en `/admin/proteccion`, reportes de clientes, actividad
anómala en `incident_log`, `security_events` o `error_events`.

Consultas de triaje (Supabase SQL Editor):

```sql
-- Últimos incidentes críticos
SELECT kind, title, created_at FROM public.incident_log
ORDER BY created_at DESC LIMIT 20;

-- Últimos eventos de seguridad de un cliente
SELECT event_type, ip, created_at FROM public.security_events
WHERE client_id = '<uuid-cliente>' ORDER BY created_at DESC LIMIT 20;
```

## 2. Contener (en este orden, según el caso)

1. **Cuenta comprometida o vetada:** suspender al usuario (no basta con
   cambiar su contraseña):
   ```sql
   UPDATE public.profiles SET status = 'suspended' WHERE id = '<uuid-usuario>';
   ```
   El middleware bloquea páginas y APIs para `suspended`/`pending` (SEC-003).
   Para revocar sesiones activas, hacerlo desde el dashboard de Supabase
   (Auth → usuario → revocar sesiones) o pedirle al usuario que cierre sesión
   en todos sus dispositivos.
2. **Llave de sitio de un satélite comprometida:** panel del cliente →
   Conexiones → Revocar la llave. El satélite deja de poder reportar hasta
   que se registre una llave nueva. Nunca reutilizar una llave revocada.
3. **Widget abusado:** suspender el servicio del cliente (mora/suspensión en
   facturación) o revocar su llave de sitio; el chat responde el mensaje de
   servicio no disponible sin gastar tokens.
4. **Secreto de Vercel expuesto:** rotarlo en el dashboard de Vercel y
   redesplegar. Si es `INTEGRATION_KEY_ENCRYPTION_SECRET`, atención: es la
   llave maestra del SecretVault; cambiarla invalida todas las claves
   cifradas en la bóveda y hay que volver a registrarlas una por una.
5. **Despliegue malo:** revertir en Vercel al despliegue anterior
   (Deployments → Previous → Promote to Production) y luego corregir en
   código. No hacer hotfixes directos en producción.

## 3. Preservar evidencia

Antes de borrar o corregir nada, exportar las filas relevantes de
`incident_log`, `security_events` y `error_events` (CSV desde el SQL Editor).
No borrar registros para "limpiar" un incidente: la retención automática
(90 días eventos, 365 días incidentes) ya se encarga de lo viejo.

## 4. Erradicar y recuperar

Corregir la causa en código (nunca desactivando RLS, validaciones ni
auditoría para "hacer que funcione"). Redesplegar, verificar en vivo y
dejar constancia del commit en el propio incidente.

## 5. Comunicar

A clientes afectados: qué pasó, qué datos pudieron verse, qué se hizo y
qué deben hacer ellos (cambiar contraseña, revisar actividad). Sin
minimizar ni especular: solo hechos verificados.

## 6. Postmortem (dentro de 7 días)

Una página: cronología, causa raíz, qué falló en la detección, qué cambia
(código, proceso o monitoreo) y quién lo hace. Guardarla junto a este runbook.

## 7. Restaurar respaldos (procedimiento)

Los respaldos viven en el bucket privado `backups` (solo service_role) y se
generan semanalmente. **Nunca restaurar directo sobre producción sin probar
antes en staging.**

1. Descargar `db.json` y `repo.zip` del run correspondiente desde Storage.
2. Crear/restaurar en un proyecto Supabase de staging.
3. Verificar conteos por tabla contra el backup y probar login + paneles.
4. Solo entonces, con ventana de mantenimiento avisada, restaurar en
   producción y verificar de nuevo.
5. Registrar la prueba (fecha, run, conteos) en el postmortem o en este archivo.

## 8. Objetivos propuestos (a confirmar por JC)

- RPO (pérdida máxima aceptable): 7 días para datos de satélites, por la
  cadencia semanal de respaldos.
- RTO (tiempo objetivo de recuperación): 4 horas en horario laboral, manual.
- Si estos objetivos no bastan, la acción es subir la frecuencia de
  respaldos, no prometer lo que no se puede cumplir.
