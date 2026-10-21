-- ==============================================================================
-- Migración: Centro de Vigilancia (VIGÍA) (VIG-1)
-- Tablas: site_health_checks, security_events, security_findings, incident_log
-- ==============================================================================

-- 1. Tabla: site_health_checks
CREATE TABLE IF NOT EXISTS public.site_health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
    response_ms INT,
    ssl_days_left INT,
    live_commit TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_site_health_checks_client_checked 
    ON public.site_health_checks (client_id, checked_at DESC);

-- 2. Tabla: security_events
CREATE TABLE IF NOT EXISTS public.security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('failed_login', 'rate_limited', 'suspicious_path', 'auth_spike', 'other')),
    ip TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_client_created 
    ON public.security_events (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_events_client_type_created 
    ON public.security_events (client_id, event_type, created_at DESC);

-- 3. Tabla: security_findings
CREATE TABLE IF NOT EXISTS public.security_findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('scan', 'detection')),
    type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    title TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    fix_prompt TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fix_sent', 'fixed', 'accepted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_security_findings_client_created 
    ON public.security_findings (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_findings_client_status 
    ON public.security_findings (client_id, status);

-- 4. Tabla: incident_log
CREATE TABLE IF NOT EXISTS public.incident_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('health_down', 'health_recovered', 'attack_detected', 'finding_opened', 'finding_fixed', 'consumption_spike')),
    title TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_log_client_created 
    ON public.incident_log (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_log_created 
    ON public.incident_log (created_at DESC);

-- 5. Habilitar Row Level Security (RLS)
ALTER TABLE public.site_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_log ENABLE ROW LEVEL SECURITY;

-- 6. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on site_health_checks" ON public.site_health_checks;
CREATE POLICY "Allow authenticated read on site_health_checks"
    ON public.site_health_checks
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on security_events" ON public.security_events;
CREATE POLICY "Allow authenticated read on security_events"
    ON public.security_events
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on security_findings" ON public.security_findings;
CREATE POLICY "Allow authenticated read on security_findings"
    ON public.security_findings
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on incident_log" ON public.incident_log;
CREATE POLICY "Allow authenticated read on incident_log"
    ON public.incident_log
    FOR SELECT
    TO authenticated
    USING (true);

-- 7. Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on site_health_checks" ON public.site_health_checks;
CREATE POLICY "Allow service_role full access on site_health_checks"
    ON public.site_health_checks
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on security_events" ON public.security_events;
CREATE POLICY "Allow service_role full access on security_events"
    ON public.security_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on security_findings" ON public.security_findings;
CREATE POLICY "Allow service_role full access on security_findings"
    ON public.security_findings
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on incident_log" ON public.incident_log;
CREATE POLICY "Allow service_role full access on incident_log"
    ON public.incident_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
