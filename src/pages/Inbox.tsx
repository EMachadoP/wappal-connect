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
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { toast } from 'sonner';

export default function InboxPage() {
  const { id: conversationIdParam } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { playNotificationSound } = useNotificationSound();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationIdParam || null);
  const [activeContact, setActiveContact] = useState<any>(null);
  const [activeConvData, setActiveConvData] = useState<any>(null);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);

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

  // Fetch agents for assignment
  useEffect(() => {
    const fetchAgents = async () => {
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('id, name')
        .order('name');

      if (data) {
        setAgents(data);
      }
    };

    fetchAgents();
  }, [user]);

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
      toast.error(`Erro ao enviar: ${error.message || 'Erro desconhecido'}`);
    }
  };

  const handleSendFile = async (file: File) => {
    if (!user) { toast.error('Erro: Usuário não logado'); return; }
    if (!activeConversationId) { toast.error('Erro: Nenhuma conversa selecionada'); return; }

    const loadingToast = toast.loading(`Enviando ${file.name}...`);

    try {
      // 1. Upload para o Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `outbound/${fileName}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('media-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // 2. Obter URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('media-files')
        .getPublicUrl(filePath);

      // 3. Obter nome do atendente para o registro
      const { data: profile } = await supabase
        .from('profiles')
        .select('name, display_name')
        .eq('id', user.id)
        .single();

      const senderName = profile?.display_name || profile?.name || 'Atendente G7';

      // 4. Chamar Edge Function para enviar via Z-API
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error("Sessão perdida. Faça login novamente.");

      const response = await fetch('https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-file', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          conversation_id: activeConversationId,
          file_url: publicUrl,
          file_name: file.name,
          file_type: file.type,
          sender_id: user.id,
          sender_name: senderName
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ao enviar arquivo: ${errorText}`);
      }

      toast.success('Arquivo enviado com sucesso', { id: loadingToast });
    } catch (error: any) {
      console.error('Erro no upload/envio:', error);
      toast.error(`Erro: ${error.message || 'Falha ao enviar arquivo'}`, { id: loadingToast });
    }
  };

  const handleResolveConversation = async () => {
    if (!activeConversationId) return;

    try {
      const { error } = await supabase
        .from('conversations')
        .update({ status: 'resolved' })
        .eq('id', activeConversationId);

      if (error) throw error;

      // Optionally show success message
      console.log('Conversa marcada como resolvida');
    } catch (error: any) {
      console.error('Erro ao resolver conversa:', error);
      alert(`Erro ao concluir conversa: ${error.message || 'Erro desconhecido'}`);
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!activeConversationId) return;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) throw new Error('Sessão perdida. Faça login novamente.');

      const { error } = await supabase.functions.invoke('assign-conversation', {
        body: {
          conversation_id: activeConversationId,
          agent_id: agentId,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (error) {
        console.error('Erro ao atribuir agente:', error);
        alert(`Erro ao atribuir agente: ${error.message || 'Erro desconhecido'}`);
      } else {
        console.log('Agente atribuído com sucesso');
      }
    } catch (error: any) {
      console.error('Erro ao atribuir agente:', error);
      alert(`Erro ao atribuir agente: ${error.message || 'Erro desconhecido'}`);
    }
  };

  const handleMarkUnread = async () => {
    if (!activeConversationId) return;

    try {
      const { error } = await supabase
        .from('conversations')
        .update({ unread_count: 1 })
        .eq('id', activeConversationId);

      if (error) throw error;

      console.log('Conversa marcada como não lida');
      // Optionally navigate back to inbox list on mobile
      if (isMobile) {
        setActiveConversationId(null);
        navigate('/inbox');
      }
    } catch (error: any) {
      console.error('Erro ao marcar como não lida:', error);
      alert(`Erro ao marcar como não lida: ${error.message || 'Erro desconhecido'}`);
    }
  };

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="h-full overflow-hidden bg-background">
        {isMobile ? (
          activeConversationId ? (
            <div className="flex-1 flex flex-col min-w-0 h-full">
              {loadingMessages && !messages.length ? (
                <ChatSkeleton />
              ) : (
                <ChatArea
                  key={activeConversationId}
                  contact={activeContact}
                  messages={messages as any}
                  profiles={agents}
                  conversationId={activeConversationId}
                  conversationStatus={activeConvData?.status}
                  onSendMessage={handleSendMessage}
                  onSendFile={handleSendFile}
                  onResolveConversation={handleResolveConversation}
                  onAssignAgent={handleAssignAgent}
                  onMarkUnread={handleMarkUnread}
                  aiMode={activeConvData?.ai_mode}
                  humanControl={activeConvData?.human_control}
                  loading={loadingMessages}
                  currentUserId={user.id}
                  isMobile={true}
                  onBack={() => {
                    setActiveConversationId(null);
                    navigate('/inbox');
                  }}
                />
              )}
            </div>
          ) : (
            <ConversationList
              conversations={conversations}
              activeConversationId={activeConversationId}
              userId={user.id}
              onSelectConversation={handleSelectConversation}
              isMobile={isMobile}
            />
          )
        ) : (
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={30} minSize={20} maxSize={50}>
              <ConversationList
                conversations={conversations}
                activeConversationId={activeConversationId}
                userId={user.id}
                onSelectConversation={handleSelectConversation}
                isMobile={isMobile}
              />
            </Panel>

            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize" />

            <Panel defaultSize={70} minSize={50}>
              <div className="flex-1 flex flex-col min-w-0 h-full">
                {activeConversationId ? (
                  loadingMessages && !messages.length ? (
                    <ChatSkeleton />
                  ) : (
                    <ChatArea
                      key={activeConversationId}
                      contact={activeContact}
                      messages={messages as any}
                      profiles={agents}
                      conversationId={activeConversationId}
                      conversationStatus={activeConvData?.status}
                      onSendMessage={handleSendMessage}
                      onSendFile={handleSendFile}
                      onResolveConversation={handleResolveConversation}
                      onAssignAgent={handleAssignAgent}
                      onMarkUnread={handleMarkUnread}
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
            </Panel>
          </PanelGroup>
        )}
      </div>
    </AppLayout>
  );
}