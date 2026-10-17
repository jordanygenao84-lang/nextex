-- ==============================================================================
-- Migración: Roles (Super Admin Profile Column & Workspace Invites)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Modificar public.profiles para añadir is_super_admin
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Tabla: workspace_invites
CREATE TABLE IF NOT EXISTS public.workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    invited_by UUID,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Índices para acelerar búsquedas
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace_id 
    ON public.workspace_invites (workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token 
    ON public.workspace_invites (token);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_email 
    ON public.workspace_invites (email);

-- 4. Habilitar RLS en la tabla
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on workspace_invites" ON public.workspace_invites;
CREATE POLICY "Allow authenticated read on workspace_invites"
    ON public.workspace_invites
    FOR SELECT
    TO authenticated
    USING (true);

-- Política de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on workspace_invites" ON public.workspace_invites;
CREATE POLICY "Allow service_role full access on workspace_invites"
    ON public.workspace_invites
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Trigger de actualización de updated_at si existe set_updated_at
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_workspace_invites_updated_at ON public.workspace_invites;
        CREATE TRIGGER set_workspace_invites_updated_at
            BEFORE UPDATE ON public.workspace_invites
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
