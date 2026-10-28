import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { encryptBackupKey } from "@/lib/protection/backups";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/backups/config
 * Guarda o actualiza la configuración de respaldo de un cliente (NIV1-5).
 * Las llaves se reciben en claro sobre HTTPS y se almacenan estrictamente cifradas con AES-256-GCM.
 * Si en edición una llave se envía vacía, se conserva el valor cifrado existente.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function POST(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Acceso exclusivo para superadministradores." } },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      client_id,
      supabase_url,
      service_key,
      github_repo,
      github_branch,
      github_token,
      enabled,
    } = body;

    if (!client_id || typeof client_id !== "string") {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'client_id' es obligatorio." } },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // 1. Obtener registro previo para preservar llaves no modificadas
    const { data: existing } = await (serviceClient.from("backup_configs") as any)
      .select("*")
      .eq("client_id", client_id)
      .maybeSingle();

    // 2. Cifrar service_key si fue provista
    let serviceKeyEncrypted = existing?.service_key_encrypted || null;
    if (typeof service_key === "string" && service_key.trim().length > 0) {
      serviceKeyEncrypted = encryptBackupKey(service_key.trim(), client_id, "service-key");
    }

    // 3. Cifrar github_token si fue provisto
    let githubTokenEncrypted = existing?.github_token_encrypted || null;
    if (typeof github_token === "string" && github_token.trim().length > 0) {
      githubTokenEncrypted = encryptBackupKey(github_token.trim(), client_id, "github-token");
    }

    const payload: any = {
      client_id,
      supabase_url: typeof supabase_url === "string" && supabase_url.trim() ? supabase_url.trim() : null,
      service_key_encrypted: serviceKeyEncrypted,
      github_repo: typeof github_repo === "string" && github_repo.trim() ? github_repo.trim() : null,
      github_branch: typeof github_branch === "string" && github_branch.trim() ? github_branch.trim() : "main",
      github_token_encrypted: githubTokenEncrypted,
      enabled: enabled !== undefined ? Boolean(enabled) : true,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveErr } = await (serviceClient.from("backup_configs") as any)
      .upsert(payload, { onConflict: "client_id" })
      .select(`
        client_id,
        supabase_url,
        github_repo,
        github_branch,
        enabled,
        created_at,
        updated_at
      `)
      .single();

    if (saveErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: "Error interno del servidor." } },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      config: {
        ...saved,
        has_service_key: Boolean(serviceKeyEncrypted),
        has_github_token: Boolean(githubTokenEncrypted),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Error interno del servidor.",
        },
      },
      { status: 500 }
    );
  }
}
