-- ==============================================================================
-- Migración: Tickets de Soporte Centralizados (Nivel 1.20) (NIV3-3)
-- Tablas: support_tickets, ticket_messages
-- ==============================================================================

-- 1. Tabla: support_tickets
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'closed')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_client_status
    ON public.support_tickets (client_id, status);

CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at_desc
    ON public.support_tickets (created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on support_tickets" ON public.support_tickets;
CREATE POLICY "Allow authenticated read on support_tickets"
    ON public.support_tickets
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on support_tickets" ON public.support_tickets;
CREATE POLICY "Allow service_role full access on support_tickets"
    ON public.support_tickets
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 2. Tabla: ticket_messages
CREATE TABLE IF NOT EXISTS public.ticket_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    author TEXT NOT NULL CHECK (author IN ('client', 'admin')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_created_at
    ON public.ticket_messages (ticket_id, created_at ASC);

ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read on ticket_messages" ON public.ticket_messages;
CREATE POLICY "Allow authenticated read on ticket_messages"
    ON public.ticket_messages
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow service_role full access on ticket_messages" ON public.ticket_messages;
CREATE POLICY "Allow service_role full access on ticket_messages"
    ON public.ticket_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
