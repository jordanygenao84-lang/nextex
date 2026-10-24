-- ==============================================================================
-- Migración: Analítica Central de Negocio (Nivel 1.19) (NIV2-4)
-- Tabla: business_metrics
-- ==============================================================================

-- 1. Tabla: business_metrics
CREATE TABLE IF NOT EXISTS public.business_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    metric TEXT NOT NULL CHECK (metric IN ('visits', 'sales', 'orders', 'revenue')),
    value NUMERIC NOT NULL,
    currency TEXT,
    metric_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para business_metrics
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_metrics_client_metric_date_uq
    ON public.business_metrics (client_id, metric, metric_date);

CREATE INDEX IF NOT EXISTS idx_business_metrics_client_date_desc
    ON public.business_metrics (client_id, metric_date DESC);

-- RLS para business_metrics (igual que las tablas de protección)
ALTER TABLE public.business_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on business_metrics" ON public.business_metrics;
CREATE POLICY "Allow authenticated read on business_metrics"
    ON public.business_metrics
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on business_metrics" ON public.business_metrics;
CREATE POLICY "Allow service_role full access on business_metrics"
    ON public.business_metrics
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
