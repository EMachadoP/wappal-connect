-- Enum para roles de usuário
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');

-- Tabela de roles (segurança - separada de profiles)
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Função para verificar role (SECURITY DEFINER para evitar recursão RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Tabela de equipes
CREATE TABLE public.teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Tabela de profiles (usuários do sistema)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Tabela de contatos WhatsApp (com suporte LID)
CREATE TABLE public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lid TEXT UNIQUE, -- Identificador LID (chave principal para WhatsApp)
    phone TEXT, -- Número de telefone (complementar, pode ser null)
    chat_lid TEXT, -- Identificador do chat
    name TEXT NOT NULL,
    profile_picture_url TEXT,
    lid_source TEXT, -- Origem do LID (webhook, sync, etc.)
    lid_collected_at TIMESTAMPTZ, -- Data de coleta do LID
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Criar índice no campo lid para performance
CREATE INDEX idx_contacts_lid ON public.contacts(lid);
CREATE INDEX idx_contacts_phone ON public.contacts(phone);

-- Tabela de etiquetas
CREATE TABLE public.labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- Status de conversa
CREATE TYPE public.conversation_status AS ENUM ('open', 'resolved');

-- Tabela de conversas
CREATE TABLE public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    status conversation_status NOT NULL DEFAULT 'open',
    unread_count INTEGER NOT NULL DEFAULT 0,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Tabela de etiquetas de conversa (muitos-para-muitos)
CREATE TABLE public.conversation_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, label_id)
);

ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;

-- Tipo de mensagem
CREATE TYPE public.message_type AS ENUM ('text', 'image', 'video', 'audio', 'document');

-- Tipo de remetente
CREATE TYPE public.sender_type AS ENUM ('contact', 'agent');

-- Tabela de mensagens
CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type sender_type NOT NULL,
    sender_id UUID, -- ID do agente se sender_type = 'agent'
    content TEXT,
    message_type message_type NOT NULL DEFAULT 'text',
    media_url TEXT,
    whatsapp_message_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Índices para performance
CREATE INDEX idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX idx_messages_sent_at ON public.messages(sent_at);
CREATE INDEX idx_conversations_assigned_to ON public.conversations(assigned_to);
CREATE INDEX idx_conversations_status ON public.conversations(status);

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_teams_updated_at
    BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at
    BEFORE UPDATE ON public.contacts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger para criar profile automaticamente quando usuário se registra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS Policies

-- user_roles: admins podem ver tudo, usuários podem ver próprias roles
CREATE POLICY "Users can view own roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
    ON public.user_roles FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- profiles: usuários autenticados podem ver todos os profiles
CREATE POLICY "Authenticated users can view profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid());

CREATE POLICY "Admins can manage all profiles"
    ON public.profiles FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- teams: usuários autenticados podem ver, admins podem gerenciar
CREATE POLICY "Authenticated users can view teams"
    ON public.teams FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins can manage teams"
    ON public.teams FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- contacts: usuários autenticados podem ver e gerenciar contatos
CREATE POLICY "Authenticated users can view contacts"
    ON public.contacts FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert contacts"
    ON public.contacts FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
    ON public.contacts FOR UPDATE
    TO authenticated
    USING (true);

-- labels: usuários autenticados podem ver, admins podem gerenciar
CREATE POLICY "Authenticated users can view labels"
    ON public.labels FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Admins can manage labels"
    ON public.labels FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));

-- conversations: usuários autenticados podem ver e gerenciar
CREATE POLICY "Authenticated users can view conversations"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert conversations"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update conversations"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (true);

-- conversation_labels: usuários autenticados podem ver e gerenciar
CREATE POLICY "Authenticated users can view conversation_labels"
    ON public.conversation_labels FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can manage conversation_labels"
    ON public.conversation_labels FOR ALL
    TO authenticated
    USING (true);

-- messages: usuários autenticados podem ver e criar mensagens
CREATE POLICY "Authenticated users can view messages"
    ON public.messages FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert messages"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update messages"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (true);

-- Habilitar realtime para mensagens e conversas
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;