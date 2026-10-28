import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const userClient = createClient();
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      ),
    };
  }

  const superAdmin = await isSuperAdmin(user.id);
  if (!superAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      ),
    };
  }

  return { ok: true as const, user };
}

function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((t) => String(t ?? "").trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Invalida la caché de respuestas del widget del cliente cuando su base de conocimiento cambia
 * para que las entradas creadas/editadas/desactivadas surtan efecto de inmediato.
 */
async function invalidateClientResponseCache(serviceClient: any, clientId: string) {
  if (!clientId) return;
  try {
    const { data: client } = await (serviceClient.from("clients") as any)
      .select("workspace_id")
      .eq("id", clientId)
      .maybeSingle();

    if (client?.workspace_id) {
      await (serviceClient.from("response_cache") as any)
        .delete()
        .eq("workspace_id", client.workspace_id);
    }
  } catch {
    // Best-effort cache invalidation
  }
}

/**
 * GET /api/admin/knowledge?client_id=...
 * Lista las entradas de conocimiento de un cliente (client_id obligatorio).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const clientId = req.nextUrl.searchParams.get("client_id")?.trim();
    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El parámetro 'client_id' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: entries, error: dbErr } = await (
      serviceClient.from("knowledge_entries") as any
    )
      .select("id, client_id, title, content, tags, source, active, created_at, updated_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (dbErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: dbErr.message } },
        { status: 500 }
      );
    }

    const list = entries || [];
    return NextResponse.json({
      entries: list,
      total: list.length,
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

/**
 * POST /api/admin/knowledge?client_id=...
 * Crea una entrada de conocimiento para el cliente (client_id y content obligatorios).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const queryClientId = req.nextUrl.searchParams.get("client_id")?.trim();
    const bodyClientId =
      typeof body.client_id === "string" ? body.client_id.trim() : "";
    const clientId = queryClientId || bodyClientId;

    if (!clientId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'client_id' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const content =
      typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'content' es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : null;
    const tags = normalizeTags(body.tags);
    const source =
      typeof body.source === "string" && body.source.trim()
        ? body.source.trim()
        : null;
    const active = body.active !== undefined ? Boolean(body.active) : true;

    const serviceClient = createServiceClient();
    const nowIso = new Date().toISOString();

    const { data: created, error: insertErr } = await (
      serviceClient.from("knowledge_entries") as any
    )
      .insert({
        client_id: clientId,
        title,
        content,
        tags,
        source,
        active,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, client_id, title, content, tags, source, active, created_at, updated_at")
      .single();

    if (insertErr || !created) {
      return NextResponse.json(
        {
          error: {
            code: "DB_ERROR",
            message: insertErr?.message || "No se pudo crear la entrada de conocimiento.",
          },
        },
        { status: 500 }
      );
    }

    await invalidateClientResponseCache(serviceClient, clientId);

    return NextResponse.json({ entry: created }, { status: 201 });
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

/**
 * PATCH /api/admin/knowledge
 * Actualiza una entrada existente (id por query o body).
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const entryId =
      req.nextUrl.searchParams.get("id")?.trim() ||
      (typeof body.id === "string" ? body.id.trim() : "");

    if (!entryId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El campo 'id' de la entrada es obligatorio.",
          },
        },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) {
      updates.title =
        typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : null;
    }

    if (body.content !== undefined) {
      const cleanContent =
        typeof body.content === "string" ? body.content.trim() : "";
      if (!cleanContent) {
        return NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "El campo 'content' no puede estar vacío.",
            },
          },
          { status: 400 }
        );
      }
      updates.content = cleanContent;
    }

    if (body.tags !== undefined) {
      updates.tags = normalizeTags(body.tags);
    }

    if (body.source !== undefined) {
      updates.source =
        typeof body.source === "string" && body.source.trim()
          ? body.source.trim()
          : null;
    }

    if (body.active !== undefined) {
      updates.active = Boolean(body.active);
    }

    const serviceClient = createServiceClient();
    const { data: updated, error: updateErr } = await (
      serviceClient.from("knowledge_entries") as any
    )
      .update(updates)
      .eq("id", entryId)
      .select("id, client_id, title, content, tags, source, active, created_at, updated_at")
      .maybeSingle();

    if (updateErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: updateErr.message } },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Entrada de conocimiento no encontrada.",
          },
        },
        { status: 404 }
      );
    }

    await invalidateClientResponseCache(serviceClient, updated.client_id);

    return NextResponse.json({ entry: updated });
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

/**
 * DELETE /api/admin/knowledge
 * Elimina una entrada de conocimiento (id por query o body).
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireSuperAdmin();
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => ({}));
    const entryId =
      req.nextUrl.searchParams.get("id")?.trim() ||
      (typeof body.id === "string" ? body.id.trim() : "");

    if (!entryId) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "El parámetro 'id' es obligatorio para eliminar.",
          },
        },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();
    const { data: deleted, error: delErr } = await (
      serviceClient.from("knowledge_entries") as any
    )
      .delete()
      .eq("id", entryId)
      .select("id, client_id")
      .maybeSingle();

    if (delErr) {
      return NextResponse.json(
        { error: { code: "DB_ERROR", message: delErr.message } },
        { status: 500 }
      );
    }

    if (deleted?.client_id) {
      await invalidateClientResponseCache(serviceClient, deleted.client_id);
    }

    return NextResponse.json({ deleted: true, id: entryId });
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
