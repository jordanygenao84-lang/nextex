-- ==============================================================================
-- Migración: Base de Conocimiento por Cliente (Nivel 1.20) (NIV3-1)
-- Tabla: knowledge_entries
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.knowledge_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    source TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice compuesto (client_id, active)
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_client_active
    ON public.knowledge_entries (client_id, active);

-- RLS estándar (igual que las tablas de protección y negocio)
ALTER TABLE public.knowledge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on knowledge_entries" ON public.knowledge_entries;
CREATE POLICY "Allow authenticated read on knowledge_entries"
    ON public.knowledge_entries
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on knowledge_entries" ON public.knowledge_entries;
CREATE POLICY "Allow service_role full access on knowledge_entries"
    ON public.knowledge_entries
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
