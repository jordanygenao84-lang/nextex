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
 * - Si no: retorna únicamente los workspace_id donde está registrado en workspace_members o es owner.
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

    // Usuario estándar: consultar sus membresías y workspaces propios
    const [{ data: memberships }, { data: ownedWorkspaces }] = await Promise.all([
      (serviceClient.from("workspace_members") as any)
        .select("workspace_id")
        .eq("user_id", userId),
      (serviceClient.from("workspaces") as any)
        .select("id")
        .eq("owner_id", userId),
    ]);

    const wsSet = new Set<string>();
    if (Array.isArray(memberships)) {
      for (const m of memberships) {
        if (m?.workspace_id) wsSet.add(m.workspace_id);
      }
    }
    if (Array.isArray(ownedWorkspaces)) {
      for (const w of ownedWorkspaces) {
        if (w?.id) wsSet.add(w.id);
      }
    }

    return Array.from(wsSet);
  } catch (err: any) {
    console.error("Error al obtener workspaces de usuario:", err?.message || err);
    return [];
  }
}

/**
 * Verifica que un cliente exista y pertenezca a uno de los workspaces autorizados para userId
 * (o que userId sea super_admin). Si no existe o no tiene acceso, retorna null (para responder 404).
 */
export async function resolveAuthorizedClient(
  userId: string,
  clientId: string
): Promise<any | null> {
  if (!userId || !clientId) {
    return null;
  }

  try {
    const serviceClient = createServiceClient();
    const { data: client, error } = await (serviceClient.from("clients") as any)
      .select("*, workspace:workspaces(id, name, slug, owner_id)")
      .eq("id", clientId)
      .maybeSingle();

    if (error || !client || !client.workspace_id) {
      return null;
    }

    const superAdmin = await isSuperAdmin(userId);
    if (superAdmin) {
      return client;
    }

    const allowedWorkspaces = await getUserWorkspaces(userId);
    if (!allowedWorkspaces.includes(client.workspace_id)) {
      return null;
    }

    return client;
  } catch {
    return null;
  }
}

/**
 * Verifica que una conversación exista y que su cliente pertenezca a un workspace autorizado
 * para userId (o que userId sea super_admin). Si no existe o no tiene acceso, retorna null (para responder 404).
 */
export async function resolveAuthorizedConversation(
  userId: string,
  conversationId: string
): Promise<any | null> {
  if (!userId || !conversationId) {
    return null;
  }

  try {
    const serviceClient = createServiceClient();
    const { data: conv, error } = await (serviceClient.from("conversations") as any)
      .select(`
        id,
        client_id,
        channel,
        external_chat_id,
        visitor_name,
        status,
        last_message_at,
        created_at,
        updated_at,
        client:clients (
          id,
          display_name,
          workspace_id
        )
      `)
      .eq("id", conversationId)
      .maybeSingle();

    if (error || !conv || !conv.client?.workspace_id) {
      return null;
    }

    const superAdmin = await isSuperAdmin(userId);
    if (superAdmin) {
      return conv;
    }

    const allowedWorkspaces = await getUserWorkspaces(userId);
    if (!allowedWorkspaces.includes(conv.client.workspace_id)) {
      return null;
    }

    return conv;
  } catch {
    return null;
  }
}
