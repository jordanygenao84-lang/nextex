import { SupabaseClient } from "@supabase/supabase-js";
import { SecretVault } from "@/lib/integrations/crypto/secret-vault";

export interface BackupConfigRecord {
  client_id: string;
  supabase_url: string | null;
  service_key_encrypted: string | null;
  github_repo: string | null;
  github_branch: string;
  github_token_encrypted: string | null;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BackupRunResult {
  status: "ok" | "partial" | "failed" | "skipped";
  run_id?: string;
  location?: string | null;
  size_bytes?: number;
  tables_count?: number;
  total_rows?: number;
  errors?: string[];
  reason?: string;
}

/**
 * Cifra una clave de respaldo (service_key o github_token) con AES-256-GCM y AAD.
 */
export function encryptBackupKey(
  plaintext: string,
  clientId: string,
  keyType: "service-key" | "github-token"
): string {
  const clean = plaintext.trim();
  const aad = `nextex:backup:${keyType}:${clientId}`;
  const enc = SecretVault.encryptValue(clean, aad);
  return JSON.stringify({
    encryptedSecret: enc.encryptedSecret,
    iv: enc.iv,
    authTag: enc.authTag,
  });
}

/**
 * Descifra una clave de respaldo. Retorna null si falla la desencriptación.
 */
export function decryptBackupKey(
  encryptedJson: string | null | undefined,
  clientId: string,
  keyType: "service-key" | "github-token"
): string | null {
  if (!encryptedJson || typeof encryptedJson !== "string") {
    return null;
  }
  try {
    const enc = JSON.parse(encryptedJson);
    if (!enc || !enc.encryptedSecret || !enc.iv || !enc.authTag) {
      return null;
    }
    const aad = `nextex:backup:${keyType}:${clientId}`;
    return SecretVault.decryptValue(enc.encryptedSecret, enc.iv, enc.authTag, aad);
  } catch {
    return null;
  }
}

/**
 * Ejecuta el respaldo completo (BD + Repo) para un cliente.
 * NUNCA lanza excepciones.
 */
export async function runClientBackup(
  supabaseClient?: SupabaseClient | any,
  clientId?: string
): Promise<BackupRunResult> {
  if (!clientId) {
    return { status: "skipped", reason: "client_id no proporcionado" };
  }

  let client = supabaseClient;
  if (!client) {
    const { createServiceClient } = await import("@/lib/supabase/server");
    client = createServiceClient();
  }

  const errors: string[] = [];
  let dbLocation: string | null = null;
  let repoLocation: string | null = null;
  let totalBytes = 0;
  let totalTables = 0;
  let totalRows = 0;

  try {
    // 1. Obtener configuración de respaldo
    const { data: config, error: configErr } = await (client.from("backup_configs") as any)
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (configErr) {
      errors.push(`Error al leer backup_configs: ${configErr.message}`);
    }

    if (!config || !config.enabled) {
      return {
        status: "skipped",
        reason: !config ? "Sin configuración de respaldo" : "Respaldo deshabilitado",
      };
    }

    // Fecha única para la carpeta en storage
    const dateStamp = new Date().toISOString().replace(/[:.]/g, "-");

    // 2. Exportar Base de Datos del satélite si está configurado
    const serviceKey = decryptBackupKey(config.service_key_encrypted, clientId, "service-key");
    const rawSupabaseUrl = config.supabase_url ? config.supabase_url.trim().replace(/\/+$/, "") : null;

    if (rawSupabaseUrl && serviceKey) {
      try {
        // Consultar OpenAPI de PostgREST
        const openApiRes = await fetch(`${rawSupabaseUrl}/rest/v1/`, {
          method: "GET",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Accept: "application/openapi+json, application/json",
          },
        });

        if (!openApiRes.ok) {
          errors.push(`Error HTTP ${openApiRes.status} al consultar esquema OpenAPI de Supabase`);
        } else {
          const openApi = await openApiRes.json();
          // Extraer tablas públicas de definitions o paths
          const candidateTables = new Set<string>();

          if (openApi && typeof openApi.definitions === "object") {
            Object.keys(openApi.definitions).forEach((t) => candidateTables.add(t));
          }

          if (openApi && typeof openApi.paths === "object") {
            Object.keys(openApi.paths).forEach((p) => {
              const clean = p.replace(/^\//, "").split("/")[0];
              if (clean && clean !== "rpc") {
                candidateTables.add(clean);
              }
            });
          }

          const tablesToExport = Array.from(candidateTables).filter(
            (t) => t && !t.startsWith("_") && t !== "rpc"
          );

          const exportedData: Record<string, any[]> = {};

          for (const tableName of tablesToExport) {
            try {
              let offset = 0;
              const limit = 1000;
              let tableRows: any[] = [];
              let hasMore = true;

              while (hasMore) {
                const pageRes = await fetch(
                  `${rawSupabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*&limit=${limit}&offset=${offset}`,
                  {
                    headers: {
                      apikey: serviceKey,
                      Authorization: `Bearer ${serviceKey}`,
                    },
                  }
                );

                if (!pageRes.ok) {
                  errors.push(`Fallo al exportar tabla '${tableName}' (status ${pageRes.status})`);
                  break;
                }

                const pageData = await pageRes.json();
                if (Array.isArray(pageData)) {
                  tableRows = tableRows.concat(pageData);
                  if (pageData.length < limit) {
                    hasMore = false;
                  } else {
                    offset += limit;
                  }
                } else {
                  hasMore = false;
                }
              }

              exportedData[tableName] = tableRows;
              totalRows += tableRows.length;
            } catch (tblErr: any) {
              errors.push(`Excepción en tabla '${tableName}': ${tblErr?.message || "error de lectura"}`);
            }
          }

          totalTables = Object.keys(exportedData).length;

          // Generar JSON y subir a bucket 'backups'
          const dbPayload = {
            exported_at: new Date().toISOString(),
            client_id: clientId,
            tables_count: totalTables,
            total_rows: totalRows,
            tables: exportedData,
          };

          const dbBuffer = Buffer.from(JSON.stringify(dbPayload, null, 2), "utf8");
          const dbPath = `${clientId}/${dateStamp}/db.json`;

          const { error: uploadDbErr } = await client.storage
            .from("backups")
            .upload(dbPath, dbBuffer, {
              contentType: "application/json",
              upsert: true,
            });

          if (uploadDbErr) {
            errors.push(`Error al subir db.json a storage: ${uploadDbErr.message}`);
          } else {
            dbLocation = dbPath;
            totalBytes += dbBuffer.length;
          }
        }
      } catch (dbExportErr: any) {
        errors.push(`Excepción general en exportación de BD: ${dbExportErr?.message || "fallo de conexión"}`);
      }
    } else if (rawSupabaseUrl && !serviceKey) {
      errors.push("URL de Supabase provista pero no se encontró la llave de servicio");
    }

    // 3. Descargar Zipball del repositorio GitHub si está configurado
    if (config.github_repo && config.github_repo.trim()) {
      try {
        const repoClean = config.github_repo.trim().replace(/^\/+|\/+$/g, "");
        const branchClean = (config.github_branch || "main").trim();
        const githubToken = decryptBackupKey(config.github_token_encrypted, clientId, "github-token");

        const ghHeaders: Record<string, string> = {
          "User-Agent": "NEXTEX-Backup-Engine",
          Accept: "application/vnd.github+json",
        };

        if (githubToken) {
          ghHeaders.Authorization = `Bearer ${githubToken}`;
        }

        const zipUrl = `https://api.github.com/repos/${repoClean}/zipball/${encodeURIComponent(branchClean)}`;
        const ghRes = await fetch(zipUrl, {
          method: "GET",
          headers: ghHeaders,
        });

        if (!ghRes.ok) {
          errors.push(`Error HTTP ${ghRes.status} al descargar zipball de GitHub (${repoClean}@${branchClean})`);
        } else {
          const zipArrayBuf = await ghRes.arrayBuffer();
          const zipBuf = Buffer.from(zipArrayBuf);
          const repoPath = `${clientId}/${dateStamp}/repo.zip`;

          const { error: uploadRepoErr } = await client.storage
            .from("backups")
            .upload(repoPath, zipBuf, {
              contentType: "application/zip",
              upsert: true,
            });

          if (uploadRepoErr) {
            errors.push(`Error al subir repo.zip a storage: ${uploadRepoErr.message}`);
          } else {
            repoLocation = repoPath;
            totalBytes += zipBuf.length;
          }
        }
      } catch (ghErr: any) {
        errors.push(`Excepción al descargar repo GitHub: ${ghErr?.message || "fallo de red"}`);
      }
    }

    // 4. Determinar estado final de la corrida
    let finalStatus: "ok" | "partial" | "failed" = "ok";
    const hadDb = Boolean(rawSupabaseUrl);
    const hadRepo = Boolean(config.github_repo && config.github_repo.trim());

    if (!hadDb && !hadRepo) {
      finalStatus = "failed";
      errors.push("No se configuró ni BD de Supabase ni repositorio de GitHub");
    } else if (!dbLocation && !repoLocation) {
      finalStatus = "failed";
    } else if (errors.length > 0) {
      finalStatus = "partial";
    }

    const primaryLocation = dbLocation || repoLocation;

    // 5. Registrar SIEMPRE en backup_runs
    const detailPayload = {
      repo_location: repoLocation,
      tablas: totalTables,
      filas_totales: totalRows,
      errores: errors,
      completed_at: new Date().toISOString(),
    };

    const { data: runRecord, error: runInsertErr } = await (client.from("backup_runs") as any)
      .insert({
        client_id: clientId,
        kind: "full",
        status: finalStatus,
        location: primaryLocation,
        size_bytes: totalBytes,
        detail: detailPayload,
      })
      .select("id")
      .single();

    if (runInsertErr) {
      console.error("[BACKUPS] Error al registrar corrida en backup_runs:", runInsertErr);
    }

    return {
      status: finalStatus,
      run_id: runRecord?.id,
      location: primaryLocation,
      size_bytes: totalBytes,
      tables_count: totalTables,
      total_rows: totalRows,
      errors,
    };
  } catch (fatalErr: any) {
    console.error("[BACKUPS] Excepción fatal en runClientBackup:", fatalErr);
    try {
      await (client.from("backup_runs") as any).insert({
        client_id: clientId,
        kind: "full",
        status: "failed",
        location: null,
        size_bytes: 0,
        detail: {
          errores: [fatalErr?.message || "Excepción fatal durante el respaldo"],
          failed_at: new Date().toISOString(),
        },
      });
    } catch {}

    return {
      status: "failed",
      errors: [fatalErr?.message || "Error fatal en respaldo"],
    };
  }
}

export interface ScheduledBackupsResult {
  checked: number;
  executed: number;
  skipped: number;
  results: Array<{
    client_id: string;
    status: string;
    run_id?: string;
  }>;
}

/**
 * Chequea clientes con respaldo habilitado y ejecuta runClientBackup
 * si no poseen una corrida 'full' exitosa o parcial en los últimos 6 días.
 * Diseñado para engancharse en el tick episódico del worker.
 */
export async function executeScheduledBackups(
  supabaseClient?: SupabaseClient | any
): Promise<ScheduledBackupsResult> {
  let client = supabaseClient;
  if (!client) {
    const { createServiceClient } = await import("@/lib/supabase/server");
    client = createServiceClient();
  }

  const result: ScheduledBackupsResult = {
    checked: 0,
    executed: 0,
    skipped: 0,
    results: [],
  };

  try {
    const { data: configs, error: cfgErr } = await (client.from("backup_configs") as any)
      .select("client_id, enabled, supabase_url, service_key_encrypted, github_repo")
      .eq("enabled", true);

    if (cfgErr || !Array.isArray(configs) || configs.length === 0) {
      return result;
    }

    result.checked = configs.length;
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();

    for (const cfg of configs) {
      // Verificar si ya tiene respaldo reciente en los últimos 6 días
      const { data: recentRuns, error: runErr } = await (client.from("backup_runs") as any)
        .select("id")
        .eq("client_id", cfg.client_id)
        .eq("kind", "full")
        .in("status", ["ok", "partial"])
        .gte("created_at", sixDaysAgo)
        .limit(1);

      if (!runErr && Array.isArray(recentRuns) && recentRuns.length > 0) {
        result.skipped++;
        continue;
      }

      // Sin llave de servicio ni repo, la corrida fallaría con certeza sin
      // exportar nada: no se ejecuta cada minuto en bucle. En cuanto JC
      // pegue la llave en la configuración, el próximo tick la ejecuta.
      const hasSupabaseUrl = Boolean(cfg.supabase_url && cfg.supabase_url.trim());
      const hasServiceKey = Boolean(cfg.service_key_encrypted);
      const hasRepo = Boolean(cfg.github_repo && cfg.github_repo.trim());
      if (hasSupabaseUrl && !hasServiceKey && !hasRepo) {
        result.skipped++;
        result.results.push({
          client_id: cfg.client_id,
          status: "skipped_missing_service_key",
        });
        continue;
      }

      // Ejecutar respaldo para el cliente
      const runOutcome = await runClientBackup(client, cfg.client_id);
      result.executed++;
      result.results.push({
        client_id: cfg.client_id,
        status: runOutcome.status,
        run_id: runOutcome.run_id,
      });
    }
  } catch (err: any) {
    console.error("[BACKUPS] Error en executeScheduledBackups:", err);
  }

  return result;
}
