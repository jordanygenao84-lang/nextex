-- ==============================================================================
-- Migración: Inventario de Dominios y DNS (Nivel 1.19) (NIV2-5)
-- Tabla: domains, alter incident_log (domain_alert)
-- ==============================================================================

-- 1. Tabla: domains
CREATE TABLE IF NOT EXISTS public.domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    domain TEXT UNIQUE NOT NULL,
    provider TEXT,
    registrar TEXT,
    expires_at DATE,
    auto_renew BOOLEAN NOT NULL DEFAULT false,
    expected_target TEXT,
    dns_status TEXT NOT NULL DEFAULT 'unknown' CHECK (dns_status IN ('ok', 'dns_issue', 'expiring', 'expired', 'unknown')),
    dns_checked_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para domains
CREATE INDEX IF NOT EXISTS idx_domains_client_id
    ON public.domains (client_id);

CREATE INDEX IF NOT EXISTS idx_domains_expires_at
    ON public.domains (expires_at)
    WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domains_dns_status
    ON public.domains (dns_status);

-- RLS para domains (igual que las tablas de protección)
ALTER TABLE public.domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on domains" ON public.domains;
CREATE POLICY "Allow authenticated read on domains"
    ON public.domains
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on domains" ON public.domains;
CREATE POLICY "Allow service_role full access on domains"
    ON public.domains
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Ampliar el CHECK de incident_log.kind agregando 'domain_alert'
--    (e incorporando cualquier valor existente en producción para evitar error 23514)
ALTER TABLE public.incident_log
    ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE public.incident_log
    DROP CONSTRAINT IF EXISTS incident_log_kind_check;

DO $$
DECLARE
    allowed_kinds TEXT;
BEGIN
    SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
    INTO allowed_kinds
    FROM (
        SELECT unnest(ARRAY[
            'health_down',
            'health_recovered',
            'attack_detected',
            'finding_opened',
            'finding_fixed',
            'scan_completed',
            'consumption_spike',
            'credential_alert',
            'billing_alert',
            'domain_alert'
        ]) AS k
        UNION
        SELECT DISTINCT kind AS k
        FROM public.incident_log
        WHERE kind IS NOT NULL
    ) sub;

    EXECUTE format(
        'ALTER TABLE public.incident_log ADD CONSTRAINT incident_log_kind_check CHECK (kind IN (%s))',
        allowed_kinds
    );
END $$;
