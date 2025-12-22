import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatArea } from '@/components/inbox/ChatArea';
import { useToast } from '@/hooks/use-toast';

interface Contact {
  name: string;
  profile_picture_url: string | null;
  phone: string | null;
  lid: string | null;
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
}

interface Message {
  id: string;
  content: string | null;
  message_type: string;
  media_url: string | null;
  sent_at: string;
  sender_type: string;
  sender_id: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

interface Profile {
  id: string;
  name: string;
}

export default function InboxPage() {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [activeConversationStatus, setActiveConversationStatus] = useState<string>('open');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Fetch profiles for sender names
  useEffect(() => {
    const fetchProfiles = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name');
      if (data) {
        setProfiles(data);
      }
    };
    fetchProfiles();
  }, []);

  // Fetch conversations
  useEffect(() => {
    if (!user) return;

    const fetchConversations = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id,
          unread_count,
          last_message_at,
          assigned_to,
          status,
          contacts (
            name,
            profile_picture_url,
            phone,
            lid
          )
        `)
        .order('last_message_at', { ascending: false, nullsFirst: false });

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar conversas',
          description: error.message,
        });
      } else if (data) {
        const formatted: Conversation[] = data.map((conv: any) => ({
          id: conv.id,
          contact: conv.contacts,
          last_message: null,
          last_message_type: undefined,
          last_message_at: conv.last_message_at,
          unread_count: conv.unread_count,
          assigned_to: conv.assigned_to,
          status: conv.status,
        }));
        setConversations(formatted);
      }
      setLoadingConversations(false);
    };

    fetchConversations();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => {
          fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast]);

  // Fetch messages when conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setActiveContact(null);
      return;
    }

    const fetchMessages = async () => {
      setLoadingMessages(true);

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeConversationId)
        .order('sent_at', { ascending: true });

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao carregar mensagens',
          description: error.message,
        });
      } else if (data) {
        setMessages(data);
      }

      // Get contact info and status
      const conv = conversations.find((c) => c.id === activeConversationId);
      if (conv) {
        setActiveContact(conv.contact);
        setActiveConversationStatus(conv.status);
      }

      // Mark as read if unread
      if (conv && conv.unread_count > 0) {
        await supabase
          .from('conversations')
          .update({ unread_count: 0 })
          .eq('id', activeConversationId);
      }

      setLoadingMessages(false);
    };

    fetchMessages();

    // Subscribe to new messages
    const channel = supabase
      .channel(`messages-${activeConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${activeConversationId}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversationId, conversations, toast]);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId || !user) return;

    const { error } = await supabase.from('messages').insert({
      conversation_id: activeConversationId,
      sender_type: 'agent',
      sender_id: user.id,
      content,
      message_type: 'text',
    });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao enviar mensagem',
        description: error.message,
      });
    }
  };

  const handleResolveConversation = async () => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversations')
      .update({ status: 'resolved' })
      .eq('id', activeConversationId);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao resolver conversa',
        description: error.message,
      });
    } else {
      toast({
        title: 'Conversa resolvida',
        description: 'A conversa foi marcada como resolvida.',
      });
      setActiveConversationStatus('resolved');
      // Clear selection to go back to list
      setActiveConversationId(null);
    }
  };

  const handleReopenConversation = async () => {
    if (!activeConversationId || !user) return;

    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'open',
        assigned_to: user.id, // Reassign to current user
      })
      .eq('id', activeConversationId);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao reabrir conversa',
        description: error.message,
      });
    } else {
      toast({
        title: 'Conversa reaberta',
        description: 'A conversa foi reaberta e atribuída a você.',
      });
      setActiveConversationStatus('open');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <AppLayout>
      <div className="flex h-full">
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          userId={user.id}
          onSelectConversation={setActiveConversationId}
        />
        <ChatArea
          contact={activeContact}
          messages={messages}
          profiles={profiles}
          conversationStatus={activeConversationStatus}
          onSendMessage={handleSendMessage}
          onResolveConversation={handleResolveConversation}
          onReopenConversation={handleReopenConversation}
          loading={loadingMessages}
        />
      </div>
    </AppLayout>
  );
}
