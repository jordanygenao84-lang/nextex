import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthorizedClient } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    const clientId = params.id;
    const client = await resolveAuthorizedClient(user.id, clientId);

    if (!client) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Cliente no encontrado." } },
        { status: 404 }
      );
    }

    if (!client.website_url || typeof client.website_url !== "string" || !client.website_url.trim()) {
      return NextResponse.json(
        { error: { code: "NO_WEBSITE_URL", message: "El cliente no tiene una URL de sitio web configurada." } },
        { status: 400 }
      );
    }

    let currentUrl = client.website_url.trim();
    let redirectCount = 0;
    const MAX_REDIRECTS = 3;

    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(currentUrl, {
          method: "GET",
          headers: {
            "User-Agent": "nextex-agent/1.0",
            "Accept": "*/*",
          },
          redirect: "manual",
          signal: controller.signal,
        });

        if ([301, 302, 303, 307, 308].includes(res.status)) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            return NextResponse.json({ ok: false, error: "Demasiados redireccionamientos (máximo 3)." });
          }
          const location = res.headers.get("location");
          if (!location) {
            return NextResponse.json({ ok: true, status: res.status, finalUrl: currentUrl });
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        return NextResponse.json({ ok: true, status: res.status, finalUrl: currentUrl });
      } catch (fetchErr: any) {
        const errorMsg =
          fetchErr.name === "AbortError"
            ? "Timeout de conexión tras 10 segundos"
            : (fetchErr.message || "Error al conectar con el sitio web");
        return NextResponse.json({ ok: false, error: errorMsg });
      } finally {
        clearTimeout(timer);
      }
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Error inesperado al verificar sitio web." });
  }
}
