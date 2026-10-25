-- ==============================================================================
-- Migración: Control de Despliegues y Rollback Guiado (Nivel 1.20) (NIV3-2)
-- Tabla: deployments
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    commit_hash TEXT NOT NULL,
    commit_message TEXT,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deployed_by TEXT,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'failed', 'rolled_back')),
    notes TEXT,
    previous_commit TEXT
);

-- Índice por cliente y fecha de despliegue descendente
CREATE INDEX IF NOT EXISTS idx_deployments_client_deployed_at_desc
    ON public.deployments (client_id, deployed_at DESC);

-- RLS estándar (igual que las tablas de protección y conocimiento)
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on deployments" ON public.deployments;
CREATE POLICY "Allow authenticated read on deployments"
    ON public.deployments
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on deployments" ON public.deployments;
CREATE POLICY "Allow service_role full access on deployments"
    ON public.deployments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
