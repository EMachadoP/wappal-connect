import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatArea } from '@/components/inbox/ChatArea';
import { useRealtimeMessages } from '@/hooks/useRealtimeMessages';
import { ChatSkeleton } from '@/components/inbox/ChatSkeleton';
import { useRealtimeInbox } from '@/hooks/useRealtimeInbox';

export default function InboxPage() {
  const { id: conversationIdParam } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { playNotificationSound } = useNotificationSound();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationIdParam || null);
  const [activeContact, setActiveContact] = useState<any>(null);
  const [activeConvData, setActiveConvData] = useState<any>(null);

  // Hook customizado para gerenciar a lista e realtime global
  const { conversations, loading: loadingConversations } = useRealtimeInbox({
    onNewInboundMessage: playNotificationSound
  });

  // Hook para mensagens da conversa ativa
  const { messages, loading: loadingMessages } = useRealtimeMessages(activeConversationId);

  const fetchActiveConversationDetails = useCallback(async (id: string) => {
    const { data } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .eq('id', id)
      .single();

    if (data) {
      setActiveConvData(data);
      setActiveContact(data.contacts);

      // Marcar como lida se houver mensagens não lidas
      if (data.unread_count > 0) {
        await supabase.from('conversations').update({ unread_count: 0 }).eq('id', id);
      }
    }
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      // Clear transient data immediately to prevent UI mixing
      setActiveContact(null);
      setActiveConvData(null);
      fetchActiveConversationDetails(activeConversationId);
    }
  }, [activeConversationId, fetchActiveConversationDetails]);

  // Sincronizar parâmetro da URL com estado local
  useEffect(() => {
    if (conversationIdParam && conversationIdParam !== activeConversationId) {
      setActiveConversationId(conversationIdParam);
    }
  }, [conversationIdParam, activeConversationId]);

  const handleSelectConversation = useCallback((id: string) => {
    // Navigate updates the URL parameter, which in turn updates conversationIdParam
    // and triggers our sync useEffect. This is the standard way to handle tab/list switches.
    navigate(`/inbox/${id}`);
  }, [navigate]);

  const handleSendMessage = async (content: string) => {
    // Debug Alerts
    if (!user) { alert('Erro: Usuário não logado'); return; }
    if (!activeConversationId) { alert('Erro: Nenhuma conversa selecionada (ID nulo)'); return; }

    try {
      // Obter sessão para Authorization Header
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error("Sessão perdida. Faça login novamente.");

      // Chamada direta via Fetch para debug de rede
      const response = await fetch('https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-message', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversation_id: activeConversationId,
          content,
          message_type: 'text'
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
      }

      // Sucesso
      // alert('Mensagem enviada!'); // Opcional, remover em produção
    } catch (error: any) {
      console.error('Erro ao enviar:', error);
      // Import toast if not available, finding where it is imported or adding import if needed (it is not imported in original snippet, but likely available via sonner or similar in this project based on ChatArea.tsx having toast)
      // Actually ChatArea receives toast, Inbox.tsx doesn't seem to import it.
      // I will assume simple alert or console for now, or check imports.
      // I'll add the import first if I can.
      alert(`Erro ao enviar: ${error.message || 'Erro desconhecido'}`);
    }
  };

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden bg-background">
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          userId={user.id}
          onSelectConversation={handleSelectConversation}
          isMobile={isMobile}
        />

        {!isMobile && (
          <div className="flex-1 flex flex-col min-w-0">
            {activeConversationId ? (
              loadingMessages && !messages.length ? (
                <ChatSkeleton />
              ) : (
                <ChatArea
                  key={activeConversationId}
                  contact={activeContact}
                  messages={messages as any}
                  profiles={[]}
                  conversationId={activeConversationId}
                  conversationStatus={activeConvData?.status}
                  onSendMessage={handleSendMessage}
                  aiMode={activeConvData?.ai_mode}
                  humanControl={activeConvData?.human_control}
                  loading={loadingMessages}
                  currentUserId={user.id}
                />
              )
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-muted/10">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                  <ChatSkeleton /> {/* Apenas como placeholder visual */}
                </div>
                <p className="text-lg font-medium">Suas conversas aparecem aqui</p>
                <p className="text-sm">Selecione um contato na lista para iniciar o atendimento.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}