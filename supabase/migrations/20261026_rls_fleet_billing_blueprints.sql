-- ==============================================================================
-- Migración: Cerrar RLS restante en fleet, billing_rates e integration_blueprints (FIX-SEG-7)
-- Tablas: fleet_agents, fleet_jobs, fleet_metrics, billing_rates, integration_blueprints
-- Reemplaza el SELECT abierto de authenticated por acceso exclusivo a super_admin
-- (EXISTS en public.profiles con is_super_admin = true).
-- Sin tocar columnas, triggers ni las políticas de service_role.
-- ==============================================================================

-- 1. public.fleet_agents
ALTER TABLE public.fleet_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fleet read" ON public.fleet_agents;
DROP POLICY IF EXISTS "Allow authenticated read on fleet_agents" ON public.fleet_agents;
CREATE POLICY "Allow authenticated read on fleet_agents"
    ON public.fleet_agents
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_super_admin = true
        )
    );

-- 2. public.fleet_jobs
ALTER TABLE public.fleet_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fleet read" ON public.fleet_jobs;
DROP POLICY IF EXISTS "Allow authenticated read on fleet_jobs" ON public.fleet_jobs;
CREATE POLICY "Allow authenticated read on fleet_jobs"
    ON public.fleet_jobs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_super_admin = true
        )
    );

-- 3. public.fleet_metrics
ALTER TABLE public.fleet_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fleet read" ON public.fleet_metrics;
DROP POLICY IF EXISTS "Allow authenticated read on fleet_metrics" ON public.fleet_metrics;
CREATE POLICY "Allow authenticated read on fleet_metrics"
    ON public.fleet_metrics
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_super_admin = true
        )
    );

-- 4. public.billing_rates
ALTER TABLE public.billing_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read on billing_rates" ON public.billing_rates;
CREATE POLICY "Allow authenticated read on billing_rates"
    ON public.billing_rates
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_super_admin = true
        )
    );

-- 5. public.integration_blueprints
ALTER TABLE public.integration_blueprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated read on integration_blueprints" ON public.integration_blueprints;
CREATE POLICY "Allow authenticated read on integration_blueprints"
    ON public.integration_blueprints
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid() AND p.is_super_admin = true
        )
    );
