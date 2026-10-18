-- ==============================================================================
-- Migración: Efficiency & Optimization (Response Cache & Token Usage Tracking)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: response_cache
CREATE TABLE IF NOT EXISTS public.response_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    query_hash TEXT NOT NULL,
    query_text TEXT NOT NULL,
    response TEXT NOT NULL,
    model TEXT NOT NULL,
    hit_count INT NOT NULL DEFAULT 1,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT response_cache_workspace_hash_key UNIQUE (workspace_id, query_hash)
);

-- 2. Tabla: token_usage
CREATE TABLE IF NOT EXISTS public.token_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Índices para acelerar consultas y purga de caché
CREATE INDEX IF NOT EXISTS idx_response_cache_workspace_id 
    ON public.response_cache (workspace_id);

CREATE INDEX IF NOT EXISTS idx_response_cache_lookup 
    ON public.response_cache (workspace_id, query_hash);

CREATE INDEX IF NOT EXISTS idx_response_cache_expires_at 
    ON public.response_cache (expires_at);

CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_id 
    ON public.token_usage (workspace_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_client_id 
    ON public.token_usage (client_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_conversation_id 
    ON public.token_usage (conversation_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at 
    ON public.token_usage (created_at DESC);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.token_usage ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on response_cache" ON public.response_cache;
CREATE POLICY "Allow authenticated read on response_cache"
    ON public.response_cache
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on token_usage" ON public.token_usage;
CREATE POLICY "Allow authenticated read on token_usage"
    ON public.token_usage
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on response_cache" ON public.response_cache;
CREATE POLICY "Allow service_role full access on response_cache"
    ON public.response_cache
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on token_usage" ON public.token_usage;
CREATE POLICY "Allow service_role full access on token_usage"
    ON public.token_usage
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Trigger de actualización de updated_at para response_cache si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_response_cache_updated_at ON public.response_cache;
        CREATE TRIGGER set_response_cache_updated_at
            BEFORE UPDATE ON public.response_cache
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
