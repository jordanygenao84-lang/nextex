-- ==============================================================================
-- Migración: Integration Blueprints & Client Integrations
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: integration_blueprints
CREATE TABLE IF NOT EXISTS public.integration_blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'communication',
    required_credentials JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla: client_integrations
CREATE TABLE IF NOT EXISTS public.client_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    blueprint_slug TEXT NOT NULL REFERENCES public.integration_blueprints(slug) ON DELETE CASCADE,
    label TEXT NOT NULL,
    encrypted_credentials TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT client_integrations_client_slug_label_key UNIQUE (client_id, blueprint_slug, label)
);

-- 3. Índices para acelerar búsquedas
CREATE INDEX IF NOT EXISTS idx_client_integrations_client_id 
    ON public.client_integrations (client_id);

CREATE INDEX IF NOT EXISTS idx_client_integrations_blueprint_slug 
    ON public.client_integrations (blueprint_slug);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.integration_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on integration_blueprints" ON public.integration_blueprints;
CREATE POLICY "Allow authenticated read on integration_blueprints"
    ON public.integration_blueprints
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on client_integrations" ON public.client_integrations;
CREATE POLICY "Allow authenticated read on client_integrations"
    ON public.client_integrations
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on integration_blueprints" ON public.integration_blueprints;
CREATE POLICY "Allow service_role full access on integration_blueprints"
    ON public.integration_blueprints
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on client_integrations" ON public.client_integrations;
CREATE POLICY "Allow service_role full access on client_integrations"
    ON public.client_integrations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Triggers de actualización si existe función set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_integration_blueprints_updated_at ON public.integration_blueprints;
        CREATE TRIGGER set_integration_blueprints_updated_at
            BEFORE UPDATE ON public.integration_blueprints
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

        DROP TRIGGER IF EXISTS set_client_integrations_updated_at ON public.client_integrations;
        CREATE TRIGGER set_client_integrations_updated_at
            BEFORE UPDATE ON public.client_integrations
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;

-- 7. Seed Data: 3 Blueprints Iniciales
INSERT INTO public.integration_blueprints (slug, name, description, category, required_credentials, default_config, is_active)
VALUES
    (
        'instagram-dm',
        'Instagram DM Automation',
        'Automatización, clasificación y respuesta inteligente para mensajes directos de Instagram.',
        'social',
        '[
            {"key": "page_access_token", "label": "Page Access Token", "type": "password", "required": true},
            {"key": "page_id", "label": "Facebook Page ID", "type": "text", "required": true},
            {"key": "app_secret", "label": "App Secret", "type": "password", "required": true}
        ]'::jsonb,
        '{"auto_reply": true, "response_delay_seconds": 3, "human_takeover_enabled": true}'::jsonb,
        true
    ),
    (
        'gmail-triage',
        'Gmail Triage & Support',
        'Triaje automatizado, priorización de bandejas de entrada y redacción de borradores con IA.',
        'email',
        '[
            {"key": "client_id", "label": "OAuth Client ID", "type": "text", "required": true},
            {"key": "client_secret", "label": "OAuth Client Secret", "type": "password", "required": true},
            {"key": "refresh_token", "label": "OAuth Refresh Token", "type": "password", "required": true}
        ]'::jsonb,
        '{"label_processed": "IA-Procesado", "confidence_threshold": 0.8, "draft_only": true}'::jsonb,
        true
    ),
    (
        'whatsapp-bot',
        'WhatsApp AI Agent',
        'Agente conversacional de atención y ventas conectado a la API de WhatsApp Cloud.',
        'messaging',
        '[
            {"key": "phone_number_id", "label": "Phone Number ID", "type": "text", "required": true},
            {"key": "access_token", "label": "Permanent Access Token", "type": "password", "required": true},
            {"key": "verify_token", "label": "Webhook Verify Token", "type": "text", "required": true}
        ]'::jsonb,
        '{"agent_name": "Nextex Bot", "escalate_on_frustration": true, "language": "es"}'::jsonb,
        true
    )
ON CONFLICT (slug) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    required_credentials = EXCLUDED.required_credentials,
    default_config = EXCLUDED.default_config,
    is_active = EXCLUDED.is_active,
    updated_at = now();
