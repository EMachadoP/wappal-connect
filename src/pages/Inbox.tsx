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
import { useRealtimeInbox, Conversation } from '@/hooks/useRealtimeInbox';
import { invokeFunction } from '@/lib/api-client';

export default function InboxPage() {
  const { id: conversationIdParam } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { playNotificationSound } = useNotificationSound();
  
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationIdParam || null);
  const [activeContact, setActiveContact] = useState<any>(null);
  const [activeConvData, setActiveConvData] = useState<any>(null);

  const { conversations, loading: loadingConversations } = useRealtimeInbox({
    onNewInboundMessage: playNotificationSound
  });

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
      if (data.unread_count > 0) {
        await supabase.from('conversations').update({ unread_count: 0 }).eq('id', id);
      }
    }
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      fetchActiveConversationDetails(activeConversationId);
    }
  }, [activeConversationId, fetchActiveConversationDetails]);

  useEffect(() => {
    if (conversationIdParam && conversationIdParam !== activeConversationId) {
      setActiveConversationId(conversationIdParam);
    }
  }, [conversationIdParam, activeConversationId]);

  const handleSelectConversation = useCallback((id: string) => {
    if (isMobile) {
      navigate(`/inbox/${id}`);
    } else {
      setActiveConversationId(id);
      window.history.pushState(null, '', `/inbox/${id}`);
    }
  }, [isMobile, navigate]);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId || !user) return;
    await invokeFunction('zapi-send-message', { 
      conversation_id: activeConversationId, 
      content 
    });
  };

  if (authLoading) return null;
  if (!user) return <Navigate to="/auth" replace />;

  return (
    <AppLayout>
      <div className="flex h-full overflow-hidden bg-background">
        <ConversationList 
          conversations={conversations as any} 
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
                  contact={activeContact}
                  messages={messages}
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
                <p className="text-lg font-medium">Selecione uma conversa para iniciar</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}