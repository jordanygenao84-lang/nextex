import { createServiceClient } from "@/lib/supabase/server";

/**
 * Verifica si el usuario posee privilegios globales de superadministrador.
 * Consulta la columna profiles.is_super_admin mediante service_role.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  if (!userId || typeof userId !== "string") {
    return false;
  }

  try {
    const serviceClient = createServiceClient();
    const { data: profile, error } = await (serviceClient.from("profiles") as any)
      .select("is_super_admin")
      .eq("id", userId)
      .maybeSingle();

    if (error || !profile) {
      return false;
    }

    return Boolean(profile.is_super_admin);
  } catch (err: any) {
    console.error("Error al verificar isSuperAdmin:", err?.message || err);
    return false;
  }
}

/**
 * Retorna la lista de identificadores de workspace a los que el usuario tiene acceso.
 * - Si es super_admin: tiene acceso a todos los workspaces de la plataforma.
 * - Si no: retorna únicamente los workspace_id donde está registrado en workspace_members.
 */
export async function getUserWorkspaces(userId: string): Promise<string[]> {
  if (!userId || typeof userId !== "string") {
    return [];
  }

  try {
    const serviceClient = createServiceClient();
    const superAdmin = await isSuperAdmin(userId);

    // Si es super_admin, devolver todos los workspaces
    if (superAdmin) {
      const { data: allWorkspaces, error: wsErr } = await (serviceClient.from("workspaces") as any)
        .select("id");

      if (wsErr || !Array.isArray(allWorkspaces)) {
        return [];
      }

      return allWorkspaces.map((w: any) => w.id);
    }

    // Usuario estándar: consultar sus membresías
    const { data: memberships, error: memErr } = await (serviceClient.from("workspace_members") as any)
      .select("workspace_id")
      .eq("user_id", userId);

    if (memErr || !Array.isArray(memberships)) {
      return [];
    }

    return memberships.map((m: any) => m.workspace_id);
  } catch (err: any) {
    console.error("Error al obtener workspaces de usuario:", err?.message || err);
    return [];
  }
}
