-- ==============================================================================
-- Migración: Conversations & Conversation Messages (Omnichannel Inbox)
-- Estado: Ya aplicado en producción (rastreo de esquema local)
-- ==============================================================================

-- 1. Tabla: conversations
CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('widget', 'whatsapp', 'instagram', 'other')),
    external_chat_id TEXT NOT NULL,
    visitor_name TEXT,
    status TEXT NOT NULL DEFAULT 'bot' CHECK (status IN ('bot', 'human', 'paused')),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversations_client_channel_external_key UNIQUE (client_id, channel, external_chat_id)
);

-- 2. Tabla: conversation_messages
CREATE TABLE IF NOT EXISTS public.conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('visitor', 'bot', 'human_agent')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Índices para acelerar búsquedas
CREATE INDEX IF NOT EXISTS idx_conversations_client_id 
    ON public.conversations (client_id);

CREATE INDEX IF NOT EXISTS idx_conversations_lookup 
    ON public.conversations (client_id, channel, external_chat_id);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message 
    ON public.conversations (client_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_id 
    ON public.conversation_messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at 
    ON public.conversation_messages (conversation_id, created_at ASC);

-- 4. Habilitar RLS en ambas tablas
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de lectura para authenticated
DROP POLICY IF EXISTS "Allow authenticated read on conversations" ON public.conversations;
CREATE POLICY "Allow authenticated read on conversations"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Allow authenticated read on conversation_messages" ON public.conversation_messages;
CREATE POLICY "Allow authenticated read on conversation_messages"
    ON public.conversation_messages
    FOR SELECT
    TO authenticated
    USING (true);

-- Políticas de acceso completo para service_role
DROP POLICY IF EXISTS "Allow service_role full access on conversations" ON public.conversations;
CREATE POLICY "Allow service_role full access on conversations"
    ON public.conversations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access on conversation_messages" ON public.conversation_messages;
CREATE POLICY "Allow service_role full access on conversation_messages"
    ON public.conversation_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Trigger de actualización de updated_at en conversations
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
        DROP TRIGGER IF EXISTS set_conversations_updated_at ON public.conversations;
        CREATE TRIGGER set_conversations_updated_at
            BEFORE UPDATE ON public.conversations
            FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    END IF;
END $$;
