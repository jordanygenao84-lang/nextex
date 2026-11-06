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
      redirectUrl.searchParams.set("reason", "auth_config_missing");
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

  // SEC-003: enforcear suspensión y verificación de usuario (fail-closed).
  // Si el perfil no puede verificarse (error o ausente), o su status es 'suspended'/'pending',
  // se deniega el acceso a rutas protegidas y APIs autenticadas.
  // No aplica a intakes públicos de máquina (widget, vigía, errores,
  // analítica, soporte, webhooks, loterías, salud, modelos), que autentican por
  // llave de sitio o son públicos por diseño.
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
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr || !profile) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: { code: "PROFILE_UNAVAILABLE", message: "No se pudo verificar el perfil." } },
          { status: 401 }
        );
      }
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      redirectUrl.searchParams.set("reason", "profile_unavailable");
      return NextResponse.redirect(redirectUrl);
    }

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

  // MFA opt-in (SEC-002): si el usuario tiene un factor TOTP verificado
  // (nextLevel aal2) pero su sesión actual es aal1, exigir el reto TOTP
  // antes de entrar a rutas protegidas. Sin factores, nextLevel es aal1
  // y no hay redirección. La página /mfa-challenge no está protegida, así
  // que no hay bucle. Ante un error del chequeo (fail-closed), se deniega el
  // paso a rutas protegidas redirigiendo a /login o 401 en API.
  if (user && isProtectedPath) {
    const { data: aal, error: mfaErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (mfaErr) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: { code: "PROFILE_UNAVAILABLE", message: "No se pudo verificar el perfil." } },
          { status: 401 }
        );
      }
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("redirect", pathname);
      redirectUrl.searchParams.set("reason", "profile_unavailable");
      return NextResponse.redirect(redirectUrl);
    }

    if (aal?.nextLevel === "aal2" && aal?.currentLevel !== "aal2") {
      const challengeUrl = new URL("/mfa-challenge", request.url);
      challengeUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(challengeUrl);
    }
  }

  // Redirigir a dashboard si usuario autenticado intenta entrar a login/register,
  // SALVO que venga de una denegación del middleware (reason=suspended /
  // profile_unavailable / auth_config_missing): en ese caso la página de
  // login debe RENDERIZAR para mostrar el aviso correspondiente. Sin esta
  // excepción, el usuario denegado entra en bucle /dashboard ↔ /login
  // (ERR_TOO_MANY_REDIRECTS, verificado en vivo en N6a del Lote 3): el
  // middleware lo manda a /login y esta regla lo devuelve a /dashboard.
  // El aviso de suspendido ya existía en la página de login
  // (suspendedNotice) pero era código muerto por este bucle.
  if (isAuthPath && user) {
    const reason = request.nextUrl.searchParams.get("reason");
    const denialReason =
      reason === "suspended" ||
      reason === "profile_unavailable" ||
      reason === "auth_config_missing";
    if (!denialReason) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
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
