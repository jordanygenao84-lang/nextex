# Nextex Fleet Agent (Mac / Runner)

Agente de ejecución distribuida para pruebas de carga y estrés sobre la plataforma NEXTEХ. Se ejecuta de forma autónoma en tu Mac o servidor secundario, consulta periódicamente por nuevos trabajos asignados, lanza instancias locales de **k6** y reporta telemetría de rendimiento (VUs, RPS, p50, p95, p99, errores) en tiempo real al panel central de `/fleet`.

---

## 1. Requisitos Previos

En macOS:
```bash
# 1. Instalar Node.js (versión 18+) y k6 usando Homebrew
brew install node k6

# 2. Verificar instalaciones
node -v   # v18.0.0 o superior
k6 version
```

---

## 2. Puesta en Marcha Rápida (Paso a Paso)

1. **Acceder al panel de Flota:**  
   Ingresa a [https://nextex-seven.vercel.app/fleet](https://nextex-seven.vercel.app/fleet) con tu cuenta de usuario.

2. **Registrar nuevo agente:**  
   En la sección *Agentes de Ejecución*, presiona **"Registrar Agente"** e ingresa el nombre identificador (por ejemplo, `Mac-JC`).

3. **Copiar la API Key:**  
   Copia el token único generado (encabezado `X-Fleet-Key`). *Recuerda guardarlo, ya que por seguridad no se vuelve a mostrar.*

4. **Configurar variables de entorno en tu terminal:**
   ```bash
   export NEXTER_FLEET_URL="https://nextex-seven.vercel.app"
   export NEXTER_FLEET_KEY="tu_token_aqui"
   ```

5. **Iniciar el agente:**
   ```bash
   cd fleet/agent
   node agent.mjs
   ```

El agente emitirá un latido inicial (heartbeat) y pasará a estado `online` en el dashboard. Al encolar una prueba de carga en `/fleet`, el agente la tomará de forma atómica, ejecutará el escenario de `k6` y transmitirá las métricas cada 10 segundos.

---

## 3. Auto-Arranque con Launchd (Segundo Plano en macOS)

Para que el agente se inicie automáticamente al encender tu Mac y se mantenga siempre activo:

1. Edita el archivo `com.nextex.fleet.plist` ajustando:
   - Rutas absolutas hacia `node` (`/opt/homebrew/bin/node` o `/usr/local/bin/node`).
   - Ruta hacia `agent.mjs`.
   - Tus variables `NEXTER_FLEET_URL` y `NEXTER_FLEET_KEY`.

2. Copia el archivo a tu carpeta de LaunchAgents:
   ```bash
   cp com.nextex.fleet.plist ~/Library/LaunchAgents/
   ```

3. Carga el servicio en el sistema:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.nextex.fleet.plist
   ```

4. Ver logs en tiempo real:
   ```bash
   tail -f /tmp/nextex-fleet-agent.log
   ```

Para detener el servicio:
```bash
launchctl unload ~/Library/LaunchAgents/com.nextex.fleet.plist
```

---

## 4. Notas Operativas & Seguridad

* **Dominios Permitidos (Allowlist):** El agente solo ejecutará pruebas contra URLs cuyos dominios estén autorizados en la variable `FLEET_TARGET_ALLOWLIST` del backend.
* **Aislamiento Local:** Los scripts temporales de k6 y los volcados de métricas se generan en `/tmp/k6-<job_id>.*` y se eliminan automáticamente al terminar cada trabajo.
* **Continuidad de Conexión:** Si el servidor central no responde o hay caídas de red temporales, el agente reintentará automáticamente con retroceso exponencial sin interrumpir las pruebas activas.
