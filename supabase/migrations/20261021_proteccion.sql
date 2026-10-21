-- ==============================================================================
-- Migración: Tablas de Protección (Nivel 1.18) (NIV1-1)
-- Tablas: credentials_inventory, error_events, backup_runs
-- ==============================================================================

-- 1. Tabla: credentials_inventory (inventario de credenciales - SOLO METADATOS)
CREATE TABLE IF NOT EXISTS public.credentials_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('github', 'vercel', 'supabase', 'meta', 'google', 'openai', 'otro')),
    location TEXT,
    expires_at DATE,
    alert_days_before INT NOT NULL DEFAULT 7,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices credentials_inventory
CREATE INDEX IF NOT EXISTS idx_credentials_inventory_expires 
    ON public.credentials_inventory (expires_at) 
    WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credentials_inventory_client 
    ON public.credentials_inventory (client_id);

-- 2. Tabla: error_events (registro central de errores de las webs)
CREATE TABLE IF NOT EXISTS public.error_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    error_type TEXT,
    message TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurrences INT NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices error_events
CREATE UNIQUE INDEX IF NOT EXISTS idx_error_events_client_fingerprint 
    ON public.error_events (client_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_error_events_last_seen 
    ON public.error_events (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_client_last_seen 
    ON public.error_events (client_id, last_seen_at DESC);

-- 3. Tabla: backup_runs (historial de respaldos)
CREATE TABLE IF NOT EXISTS public.backup_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('db', 'repo', 'config', 'full')),
    status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'partial')),
    location TEXT,
    size_bytes BIGINT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices backup_runs
CREATE INDEX IF NOT EXISTS idx_backup_runs_client_created 
    ON public.backup_runs (client_id, created_at DESC);

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.credentials_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_runs ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on credentials_inventory" ON public.credentials_inventory;
CREATE POLICY "Allow authenticated read on credentials_inventory"
    ON public.credentials_inventory
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on error_events" ON public.error_events;
CREATE POLICY "Allow authenticated read on error_events"
    ON public.error_events
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on backup_runs" ON public.backup_runs;
CREATE POLICY "Allow authenticated read on backup_runs"
    ON public.backup_runs
    FOR SELECT
    TO authenticated
    USING (true);

-- 6. Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on credentials_inventory" ON public.credentials_inventory;
CREATE POLICY "Allow service_role full access on credentials_inventory"
    ON public.credentials_inventory
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on error_events" ON public.error_events;
CREATE POLICY "Allow service_role full access on error_events"
    ON public.error_events
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on backup_runs" ON public.backup_runs;
CREATE POLICY "Allow service_role full access on backup_runs"
    ON public.backup_runs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
