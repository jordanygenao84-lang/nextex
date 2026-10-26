import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getUserWorkspaces, isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "client"
  );
}

function randomChars(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let res = "";
  for (let i = 0; i < len; i++) {
    res += chars[Math.floor(Math.random() * chars.length)];
  }
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    const allowedWorkspaces = superAdmin ? null : await getUserWorkspaces(user.id);

    if (!superAdmin && (!allowedWorkspaces || allowedWorkspaces.length === 0)) {
      return NextResponse.json([]);
    }

    const serviceClient = createServiceClient();
    let query = (serviceClient.from("clients") as any)
      .select(`
        id,
        workspace_id,
        display_name,
        website_url,
        status,
        credit_limit_monthly,
        contact_name,
        contact_email,
        contact_phone,
        notes,
        created_at,
        updated_at,
        workspace:workspaces(id, name)
      `)
      .order("created_at", { ascending: false });

    if (!superAdmin && allowedWorkspaces) {
      query = query.in("workspace_id", allowedWorkspaces);
    }

    const { data: clients, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: error.message } },
        { status: 500 }
      );
    }

    const formatted = (clients || []).map((c: any) => ({
      id: c.id,
      display_name: c.display_name,
      website_url: c.website_url,
      status: c.status,
      credit_limit_monthly: c.credit_limit_monthly != null ? Number(c.credit_limit_monthly) : null,
      contact_name: c.contact_name,
      contact_email: c.contact_email,
      contact_phone: c.contact_phone,
      notes: c.notes,
      created_at: c.created_at,
      updated_at: c.updated_at,
      workspace: c.workspace ? { id: c.workspace.id, name: c.workspace.name } : null,
    }));

    return NextResponse.json(formatted);
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al listar clientes." } },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const userClient = createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sesión de usuario requerida." } },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      display_name,
      website_url,
      contact_name,
      contact_email,
      contact_phone,
      credit_limit_monthly,
      notes,
    } = body;

    if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
      return NextResponse.json(
        { error: { code: "INVALID_PARAMETERS", message: "El campo 'display_name' es obligatorio." } },
        { status: 400 }
      );
    }

    if (website_url && typeof website_url === "string" && website_url.trim()) {
      try {
        const u = new URL(website_url.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          return NextResponse.json(
            { error: { code: "INVALID_URL", message: "La URL debe ser http o https válida." } },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: { code: "INVALID_URL", message: "URL inválida." } },
          { status: 400 }
        );
      }
    }

    const serviceClient = createServiceClient();

    let slug = "";
    let isUnique = false;
    for (let i = 0; i < 5; i++) {
      const candidate = `${slugify(display_name)}-${randomChars(6)}`;
      const { data: existing } = await (serviceClient.from("workspaces") as any)
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();

      if (!existing) {
        slug = candidate;
        isUnique = true;
        break;
      }
    }

    if (!isUnique) {
      slug = `${slugify(display_name)}-${Date.now()}`;
    }

    // 1. Crear workspace con service client
    const { data: workspace, error: wsError } = await (serviceClient.from("workspaces") as any)
      .insert({
        name: display_name.trim(),
        slug,
        owner_id: user.id,
        is_personal: false,
      })
      .select("id, name, slug, owner_id, is_personal")
      .single();

    if (wsError || !workspace) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: wsError?.message || "Error al crear workspace para el cliente." } },
        { status: 500 }
      );
    }

    // Registrar membresía owner
    await (serviceClient.from("workspace_members") as any).insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner",
    });

    // 2. Crear client vinculado
    const { data: client, error: clientError } = await (serviceClient.from("clients") as any)
      .insert({
        workspace_id: workspace.id,
        display_name: display_name.trim(),
        website_url: website_url?.trim() || null,
        contact_name: contact_name?.trim() || null,
        contact_email: contact_email?.trim() || null,
        contact_phone: contact_phone?.trim() || null,
        credit_limit_monthly: credit_limit_monthly != null ? Number(credit_limit_monthly) : null,
        notes: notes?.trim() || null,
        status: "active",
      })
      .select()
      .single();

    if (clientError || !client) {
      await (serviceClient.from("workspaces") as any).delete().eq("id", workspace.id);
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: clientError?.message || "Error al registrar cliente." } },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        client: {
          ...client,
          workspace: { id: workspace.id, name: workspace.name },
        },
        workspace,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: err?.message || "Error al crear cliente." } },
      { status: 500 }
    );
  }
}
