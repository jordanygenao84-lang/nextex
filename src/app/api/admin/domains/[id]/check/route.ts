import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/roles";
import { checkDomain, checkDomainExpirations } from "@/lib/domains/check";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/domains/[id]/check
 * Ejecuta checkDomain en vivo sobre el dominio solicitado y devuelve el resultado.
 * ACCESO RESTRINGIDO: Exclusivo para superadministradores (403 si no lo es).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userClient = createClient();
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "Sesión de usuario requerida.",
          },
        },
        { status: 401 }
      );
    }

    const superAdmin = await isSuperAdmin(user.id);
    if (!superAdmin) {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acceso exclusivo para superadministradores.",
          },
        },
        { status: 403 }
      );
    }

    const domainId = params.id;
    const serviceClient = createServiceClient();

    const { data: domainRow, error: findErr } = await (
      serviceClient.from("domains") as any
    )
      .select("id, domain, expected_target, expires_at")
      .eq("id", domainId)
      .maybeSingle();

    if (findErr || !domainRow) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Dominio no encontrado." } },
        { status: 404 }
      );
    }

    const checkResult = await checkDomain(serviceClient, domainRow);
    await checkDomainExpirations(serviceClient);

    return NextResponse.json({
      result: checkResult,
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
