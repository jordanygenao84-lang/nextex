/**
 * NEXTEХ — Anti-Production Barrier & Staging Isolation Guard (Fase 4.11-H0)
 *
 * Módulo autoritativo de defensa que impide rigurosamente que cualquier script,
 * migración, deployment o cliente HTTP de staging ejecute operaciones
 * contra los entornos conocidos de PRODUCCIÓN.
 *
 * REGLAS ABSOLUTAS:
 * - Supabase Production Ref conocido: 'vvpdycuclnoptffwmrvb5' / 'vvpdycuclnoptffwmrvb'
 * - Supabase Production URL: 'https://vvpdycuclnoptffwmrvb.supabase.co'
 * - Vercel Production URL: 'https://nextex-seven.vercel.app/'
 */

export class AntiProductionBarrierError extends Error {
  public readonly code: string;
  public readonly target: string;

  constructor(message: string, code: string = "PRODUCTION_TARGET_REJECTED", target: string = "") {
    super(`[ANTI-PRODUCTION BARRIER TRIGGERED]: ${message}`);
    this.name = "AntiProductionBarrierError";
    this.code = code;
    this.target = target;
  }
}

export const KNOWN_PRODUCTION_REFS = Object.freeze([
  "vvpdycuclnoptffwmrvb5",
  "vvpdycuclnoptffwmrvb",
]);

export const KNOWN_PRODUCTION_SUPABASE_URLS = Object.freeze([
  "https://vvpdycuclnoptffwmrvb.supabase.co",
  "https://vvpdycuclnoptffwmrvb5.supabase.co",
]);

export const KNOWN_PRODUCTION_VERCEL_URLS = Object.freeze([
  "https://nextex-seven.vercel.app",
  "https://nextex-seven.vercel.app/",
]);

/**
 * Extrae el project ref de una URL de Supabase.
 */
export function extractSupabaseRef(urlOrRef: string): string {
  if (!urlOrRef) return "";
  const trimmed = urlOrRef.trim().toLowerCase();
  const match = trimmed.match(/https?:\/\/([a-z0-9_-]+)\.supabase\.co/i);
  if (match) return match[1];
  return trimmed.replace(/[^a-z0-9_-]/g, "");
}

/**
 * Valida de forma estricta que el target de Supabase pertenezca a STAGING y jamás a PRODUCCIÓN.
 */
export function assertSupabaseStagingTarget(
  targetUrlOrRef: string,
  verifiedStagingRef?: string
): { valid: boolean; targetRef: string; status: "STAGING_TARGET_ACCEPTED" } {
  if (!targetUrlOrRef) {
    throw new AntiProductionBarrierError("Target de Supabase vacío o no proporcionado", "EMPTY_TARGET");
  }

  const normalized = targetUrlOrRef.trim().toLowerCase();
  const ref = extractSupabaseRef(normalized);

  // 1. Barrera contra Producción conocida
  if (KNOWN_PRODUCTION_REFS.includes(ref)) {
    throw new AntiProductionBarrierError(
      `El target coincide con el project ref de PRODUCCIÓN '${ref}'. Operación abortada de inmediato.`,
      "PRODUCTION_TARGET_REJECTED",
      ref
    );
  }

  for (const prodUrl of KNOWN_PRODUCTION_SUPABASE_URLS) {
    if (normalized.startsWith(prodUrl.toLowerCase())) {
      throw new AntiProductionBarrierError(
        `La URL coincide con el endpoint de PRODUCCIÓN '${prodUrl}'. Operación abortada de inmediato.`,
        "PRODUCTION_TARGET_REJECTED",
        normalized
      );
    }
  }

  // 2. Si se suministra un staging ref explícito, verificar correspondencia estricta
  if (verifiedStagingRef) {
    const expectedRef = verifiedStagingRef.trim().toLowerCase();
    if (ref !== expectedRef) {
      throw new AntiProductionBarrierError(
        `El ref del target ('${ref}') no coincide con el STAGING_REF verificado ('${expectedRef}').`,
        "STAGING_REF_MISMATCH",
        ref
      );
    }
  }

  return {
    valid: true,
    targetRef: ref,
    status: "STAGING_TARGET_ACCEPTED",
  };
}

/**
 * Valida que un URL de Vercel pertenezca a STAGING y jamás a PRODUCCIÓN.
 */
export function assertVercelStagingTarget(
  targetUrl: string
): { valid: boolean; status: "STAGING_VERCEL_TARGET_ACCEPTED" } {
  if (!targetUrl) {
    throw new AntiProductionBarrierError("URL de Vercel no proporcionada", "EMPTY_TARGET");
  }

  const normalized = targetUrl.trim().toLowerCase().replace(/\/$/, "");

  for (const prodUrl of KNOWN_PRODUCTION_VERCEL_URLS) {
    const cleanProd = prodUrl.toLowerCase().replace(/\/$/, "");
    if (normalized === cleanProd) {
      throw new AntiProductionBarrierError(
        `La URL de Vercel coincide con PRODUCCIÓN ('${targetUrl}'). Operación abortada de inmediato.`,
        "PRODUCTION_VERCEL_TARGET_REJECTED",
        targetUrl
      );
    }
  }

  return {
    valid: true,
    status: "STAGING_VERCEL_TARGET_ACCEPTED",
  };
}

/**
 * Inspecciona un diccionario de variables de entorno para alertar si contiene credenciales o URLs de producción.
 */
export function detectProductionInEnvironment(env: Record<string, string | undefined>): {
  hasProduction: boolean;
  productionItems: string[];
} {
  const productionItems: string[] = [];

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  if (supabaseUrl) {
    const ref = extractSupabaseRef(supabaseUrl);
    if (KNOWN_PRODUCTION_REFS.includes(ref) || KNOWN_PRODUCTION_SUPABASE_URLS.some((u) => supabaseUrl.startsWith(u))) {
      productionItems.push(`SUPABASE_URL_IS_PRODUCTION (${ref})`);
    }
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL || env.VERCEL_URL;
  if (appUrl) {
    if (KNOWN_PRODUCTION_VERCEL_URLS.some((u) => appUrl.startsWith(u))) {
      productionItems.push(`APP_URL_IS_PRODUCTION (${appUrl})`);
    }
  }

  return {
    hasProduction: productionItems.length > 0,
    productionItems,
  };
}
