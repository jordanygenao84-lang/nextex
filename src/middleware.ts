import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Database } from "@/lib/supabase/types";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const pathname = request.nextUrl.pathname;
  const protectedPrefixes = [
    "/admin",
    "/dashboard",
    "/chat",
    "/settings",
    "/control-plane",
    "/agents",
    "/jobs",
    "/integrations",
    "/automations",
    "/observability",
    "/fleet",
    "/clients",
    "/conversations",
  ];
  const isProtectedPath = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  const isAuthPath =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/reset-password" ||
    pathname === "/update-password" ||
    pathname === "/verify-email";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Fail-closed: si faltan las variables de entorno de Supabase, denegar navegación
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder-project")) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "AUTH_CONFIG_MISSING",
            message: "Configuración de autenticación no disponible.",
          },
        },
        { status: 503 }
      );
    }
    if (isProtectedPath) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }
    return new NextResponse("Servicio no disponible: configuración de autenticación incompleta.", {
      status: 503,
    });
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions | any }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Refrescar sesión
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // SEC-003: enforcear suspensión de usuario. Solo se bloquea cuando el
  // status es explícitamente 'suspended' o 'pending'; cualquier otro valor,
  // perfil ausente o error de lectura permite el paso (fail-open ante
  // errores transitorios para no bloquear a todos los usuarios).
  // No aplica a intakes públicos de máquina (widget, vigía, errores,
  // analítica, soporte, webhooks, loterías, salud), que autentican por
  // llave de sitio y no por sesión de usuario.
  const isPublicApi =
    pathname.startsWith("/api/widget/") ||
    pathname === "/api/vigia/events" ||
    pathname === "/api/errors/report" ||
    pathname === "/api/analytics/report" ||
    pathname === "/api/support/report" ||
    pathname.startsWith("/api/webhooks/") ||
    pathname.startsWith("/api/inbound/") ||
    pathname.startsWith("/api/lotteries") ||
    pathname.startsWith("/api/health") ||
    pathname === "/api/ai/models";
  if (user && (isProtectedPath || pathname.startsWith("/api/")) && !isPublicApi) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    const status = (profile as { status?: string } | null)?.status;
    if (status === "suspended" || status === "pending") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: { code: "ACCOUNT_SUSPENDED", message: "Cuenta suspendida." } },
          { status: 403 }
        );
      }
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      redirectUrl.searchParams.set("reason", "suspended");
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Redirigir a login si intenta entrar a ruta privada sin sesión
  if (isProtectedPath && !user) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Redirigir a dashboard si usuario autenticado intenta entrar a login/register
  if (isAuthPath && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - icon.svg (app icon)
     * - public assets
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
