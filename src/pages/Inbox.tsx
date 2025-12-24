import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatArea } from '@/components/inbox/ChatArea';
import { Button } from '@/components/ui/button';
import { ConversationAvatar } from '@/components/inbox/ConversationAvatar';
import { useToast } from '@/hooks/use-toast';

interface Contact {
  id: string;
  name: string;
  profile_picture_url: string | null;
  phone: string | null;
  lid: string | null;
  chat_lid: string | null;
  is_group?: boolean;
  whatsapp_display_name?: string | null;
}

interface Conversation {
  id: string;
  contact: Contact;
  last_message: string | null;
  last_message_type: string | undefined;
  last_message_at: string | null;
  unread_count: number;
  assigned_to: string | null;
  status: string;
  priority?: string;
  marked_unread?: boolean;
}

interface Message {
  id: string;
  content: string | null;
  message_type: string;
  media_url: string | null;
  sent_at: string;
  sender_type: 'contact' | 'agent' | 'system';
  sender_id: string | null;
  delivered_at: string | null;
  read_at: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
  transcript?: string | null;
}

export default function InboxPage() {
  const { id: conversationIdParam } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const { playNotificationSound } = useNotificationSound();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationIdParam || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [activeConversationStatus, setActiveConversationStatus] = useState<string>('open');
  const [activeConversationPriority, setActiveConversationPriority] = useState<string>('normal');
  const [activeAssignedTo, setActiveAssignedTo] = useState<string | null>(null);
  const [activeAiMode, setActiveAiMode] = useState<'AUTO' | 'COPILOT' | 'OFF'>('AUTO');
  const [activeAiPausedUntil, setActiveAiPausedUntil] = useState<string | null>(null);
  const [activeHumanControl, setActiveHumanControl] = useState(false);
  const [activeCondominiumId, setActiveCondominiumId] = useState<string | null>(null);
  const [activeCondominiumSetBy, setActiveCondominiumSetBy] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const fetchConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        contacts (*)
      `)
      .order('last_message_at', { ascending: false });

    if (error) {
      console.error('Error fetching conversations:', error);
    } else if (data) {
      const formatted: Conversation[] = data.map((conv: any) => ({
        id: conv.id,
        contact: conv.contacts,
        last_message: conv.last_message_content, // O webhook deve atualizar isso futuramente, ou buscamos a última msg
        last_message_type: 'text',
        last_message_at: conv.last_message_at,
        unread_count: conv.unread_count,
        assigned_to: conv.assigned_to,
        status: conv.status,
        priority: conv.priority,
        marked_unread: conv.marked_unread,
      }));
      setConversations(formatted);
    }
    setLoadingConversations(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchConversations();

    // Inscrição Real-time Global para Conversas
    const channel = supabase
      .channel('inbox-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          console.log('[Inbox] Conversa atualizada no banco, recarregando lista...');
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const newMessage = payload.new as any;
          
          // Somente toca som para mensagens de contatos
          if (newMessage.sender_type === 'contact') {
            playNotificationSound();
          }

          // Se a mensagem for da conversa aberta no momento, adicionamos ela na tela
          if (newMessage.conversation_id === activeIdRef.current) {
            setMessages(prev => {
              if (prev.some(m => m.id === newMessage.id)) return prev;
              return [...prev, newMessage].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchConversations, playNotificationSound]);

  const fetchMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    const { data: convData } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', convId)
      .single();

    if (convData) {
      setActiveContact(convData.contacts);
      setActiveConversationStatus(convData.status);
      setActiveConversationPriority(convData.priority || 'normal');
      setActiveAssignedTo(convData.assigned_to);
      setActiveAiMode(convData.ai_mode as any || 'AUTO');
      setActiveAiPausedUntil(convData.ai_paused_until);
      setActiveHumanControl(convData.human_control);
      setActiveCondominiumId(convData.active_condominium_id);
      setActiveCondominiumSetBy(convData.active_condominium_set_by);
    }

    const { data: msgs, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('sent_at', { ascending: true });

    if (!error && msgs) {
      setMessages(msgs);
      // Zerar contador de não lidas ao abrir
      await supabase.from('conversations').update({ unread_count: 0 }).eq('id', convId);
    }
    setLoadingMessages(false);
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    }
  }, [activeConversationId, fetchMessages]);

  const handleSelectConversation = useCallback((id: string | null) => {
    if (isMobile && id) {
      navigate(`/inbox/${id}`);
    } else {
      setActiveConversationId(id);
    }
  }, [isMobile, navigate]);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId || !user) return;
    await supabase.functions.invoke('zapi-send-message', {
      body: { conversation_id: activeConversationId, content, message_type: 'text', sender_id: user.id },
    });
  };

  if (authLoading) return <div className="h-screen flex items-center justify-center">Carregando...</div>;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden">
        <ConversationList 
          conversations={conversations} 
          activeConversationId={activeConversationId} 
          userId={user.id} 
          onSelectConversation={handleSelectConversation} 
          isMobile={isMobile} 
        />
        {!isMobile && (
          <ChatArea
            contact={activeContact}
            messages={messages}
            profiles={profiles}
            conversationId={activeConversationId}
            conversationStatus={activeConversationStatus}
            onSendMessage={handleSendMessage}
            loading={loadingMessages}
            aiMode={activeAiMode}
            humanControl={activeHumanControl}
          />
        )}
      </div>
    </AppLayout>
  );
}