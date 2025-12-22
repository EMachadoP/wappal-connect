import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { ConversationList } from '@/components/inbox/ConversationList';
import { ChatArea } from '@/components/inbox/ChatArea';
import { useToast } from '@/hooks/use-toast';

interface Contact {
  id: string;
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

  // Fetch conversations - grouped by contact (one conversation per contact like WhatsApp)
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
          contact_id,
          contacts (
            id,
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
        // Group by thread key - one chat per phone/LID (WhatsApp-like)
        const threadMap = new Map<string, any>();

        for (const conv of data) {
          const contact = (conv as any).contacts;
          const threadKey = contact?.phone || contact?.lid || conv.contact_id;
          const existing = threadMap.get(threadKey);

          if (!existing) {
            threadMap.set(threadKey, conv);
          } else {
            // Merge: sum unread counts, keep most recent last_message_at
            existing.unread_count += conv.unread_count;
            if (conv.last_message_at && (!existing.last_message_at || conv.last_message_at > existing.last_message_at)) {
              existing.last_message_at = conv.last_message_at;
              // Keep the most recent conversation id as the visible “thread” id
              existing.id = conv.id;
              existing.status = conv.status;
              existing.assigned_to = conv.assigned_to;
              existing.contacts = contact;
            }
            // If any conversation is open, keep it open
            if (conv.status === 'open') {
              existing.status = 'open';
            }
          }
        }

        const formatted: Conversation[] = Array.from(threadMap.values()).map((conv: any) => ({
          id: conv.id,
          contact: conv.contacts,
          last_message: null,
          last_message_type: undefined,
          last_message_at: conv.last_message_at,
          unread_count: conv.unread_count,
          assigned_to: conv.assigned_to,
          status: conv.status,
        }));
        
        // Sort by last_message_at
        formatted.sort((a, b) => {
          if (!a.last_message_at) return 1;
          if (!b.last_message_at) return -1;
          return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
        });
        
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

  // Fetch messages when conversation changes (thread-based: same phone/LID)
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setActiveContact(null);
      return;
    }

    let isCancelled = false;

    const fetchMessages = async () => {
      setLoadingMessages(true);

      // Load the selected conversation + its contact (do NOT depend on `conversations` state to avoid loops)
      const { data: selectedConv, error: selectedConvError } = await supabase
        .from('conversations')
        .select(
          `
          id,
          status,
          contact_id,
          contacts (
            id,
            name,
            profile_picture_url,
            phone,
            lid
          )
        `
        )
        .eq('id', activeConversationId)
        .maybeSingle();

      if (selectedConvError || !selectedConv) {
        if (!isCancelled) {
          toast({
            variant: 'destructive',
            title: 'Erro ao carregar conversa',
            description: selectedConvError?.message || 'Conversa não encontrada',
          });
          setLoadingMessages(false);
        }
        return;
      }

      const contact = (selectedConv as any).contacts as Contact;
      const contactId = selectedConv.contact_id as string;

      if (!isCancelled) {
        setActiveContact(contact);
        setActiveConversationStatus(selectedConv.status);
      }

      // Resolve “thread” contacts (merge duplicates by phone or LID)
      let threadContactIds: string[] = [contactId];
      const threadPhone = contact?.phone || null;
      const threadLid = contact?.lid || null;

      if (threadPhone || threadLid) {
        let q = supabase.from('contacts').select('id');
        q = threadPhone ? q.eq('phone', threadPhone) : q.eq('lid', threadLid);

        const { data: threadContacts } = await q;
        if (threadContacts?.length) {
          threadContactIds = threadContacts.map((c: any) => c.id);
        }
      }

      // Get all conversation ids for this thread
      const { data: convsForThread } = await supabase
        .from('conversations')
        .select('id')
        .in('contact_id', threadContactIds);

      const conversationIds: string[] = convsForThread?.map((c: any) => c.id) || [activeConversationId];

      // Fetch messages from all conversations for this thread
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', conversationIds)
        .order('sent_at', { ascending: true });

      if (!isCancelled) {
        if (error) {
          toast({
            variant: 'destructive',
            title: 'Erro ao carregar mensagens',
            description: error.message,
          });
        } else {
          setMessages(data || []);
        }
      }

      // Mark all conversations in this thread as read
      if (conversationIds.length > 0) {
        await supabase.from('conversations').update({ unread_count: 0 }).in('id', conversationIds);
      }

      if (!isCancelled) setLoadingMessages(false);

      // Subscribe after first load, scoped by conversationIds (local closure)
      const channel = supabase
        .channel(`messages-thread-${conversationIds.join('-')}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          (payload) => {
            const newMessage = payload.new as any as Message;
            if (!conversationIds.includes((newMessage as any).conversation_id)) return;

            setMessages((prev) => {
              if (prev.some((m) => m.id === newMessage.id)) return prev;
              return [...prev, newMessage].sort(
                (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
              );
            });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    let unsubscribe: void | (() => void);
    fetchMessages().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      isCancelled = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeConversationId, toast]);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId || !user) return;

    try {
      // Call Z-API edge function to send message via WhatsApp
      const { data, error } = await supabase.functions.invoke('zapi-send-message', {
        body: {
          conversation_id: activeConversationId,
          content,
          message_type: 'text',
          sender_id: user.id,
        },
      });

      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao enviar mensagem',
          description: error.message,
        });
      } else if (data?.error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao enviar mensagem',
          description: data.error,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao enviar mensagem',
        description: 'Falha ao conectar com o serviço de envio',
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
