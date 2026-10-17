export function isDomainAllowed(targetUrl: string): { allowed: boolean; hostname: string; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { allowed: false, hostname: "", reason: "URL inválida." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, hostname: parsed.hostname, reason: "Solo protocolos http y https permitidos." };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowlistEnv = process.env.FLEET_TARGET_ALLOWLIST || "nextex-seven.vercel.app";
  const allowedDomains = allowlistEnv
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  if (allowedDomains.length === 0) {
    return { allowed: false, hostname, reason: "FLEET_TARGET_ALLOWLIST no tiene dominios configurados." };
  }

  const isMatch = allowedDomains.some((allowed) => {
    return hostname === allowed || hostname.endsWith("." + allowed);
  });

  if (!isMatch) {
    return { allowed: false, hostname, reason: "dominio no autorizado" };
  }

  return { allowed: true, hostname };
}
