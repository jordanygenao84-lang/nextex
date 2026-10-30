-- ==============================================================================
-- Migración: Ampliación de CHECKs para Autodiagnóstico VIGÍA (Selfcheck)
-- 1. security_findings.source: 'scan', 'detection', 'selfcheck'
-- 2. incident_log.kind: agrega 'selfcheck_completed', 'self_finding_opened', 'self_finding_fixed'
-- ==============================================================================

-- 1. Ampliar CHECK de security_findings.source para admitir 'selfcheck'
ALTER TABLE public.security_findings
    DROP CONSTRAINT IF EXISTS security_findings_source_check;

DO $$
DECLARE
    allowed_sources TEXT;
BEGIN
    SELECT string_agg(quote_literal(s), ', ' ORDER BY s)
    INTO allowed_sources
    FROM (
        SELECT unnest(ARRAY[
            'scan',
            'detection',
            'selfcheck'
        ]) AS s
        UNION
        SELECT DISTINCT source AS s
        FROM public.security_findings
        WHERE source IS NOT NULL
    ) sub;

    EXECUTE format(
        'ALTER TABLE public.security_findings ADD CONSTRAINT security_findings_source_check CHECK (source IN (%s))',
        allowed_sources
    );
END $$;

-- 2. Ampliar CHECK de incident_log.kind agregando 'selfcheck_completed', 'self_finding_opened' y 'self_finding_fixed'
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
            'domain_alert',
            'selfcheck_completed',
            'self_finding_opened',
            'self_finding_fixed'
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
