import { useEffect, useState, useCallback } from 'react';
import { Navigate, useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
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
  sender_type: string;
  sender_id: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

interface Profile {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

export default function InboxPage() {
  const { id: conversationIdParam } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationIdParam || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [activeConversationStatus, setActiveConversationStatus] = useState<string>('open');
  const [activeConversationPriority, setActiveConversationPriority] = useState<string>('normal');
  const [activeAssignedTo, setActiveAssignedTo] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Sync URL param with state
  useEffect(() => {
    if (conversationIdParam) {
      setActiveConversationId(conversationIdParam);
    } else if (isMobile) {
      setActiveConversationId(null);
    }
  }, [conversationIdParam, isMobile]);

  const handleSelectConversation = useCallback((id: string | null) => {
    if (isMobile && id) {
      navigate(`/inbox/${id}`);
    } else {
      setActiveConversationId(id);
    }
  }, [isMobile, navigate]);

  const handleBackToList = useCallback(() => {
    navigate('/inbox');
    setActiveConversationId(null);
  }, [navigate]);

  // Fetch profiles, teams, labels
  useEffect(() => {
    const fetchData = async () => {
      const [profilesRes, teamsRes, labelsRes] = await Promise.all([
        supabase.from('profiles').select('id, name'),
        supabase.from('teams').select('id, name'),
        supabase.from('labels').select('id, name, color'),
      ]);
      if (profilesRes.data) setProfiles(profilesRes.data);
      if (teamsRes.data) setTeams(teamsRes.data);
      if (labelsRes.data) setLabels(labelsRes.data);
    };
    fetchData();
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
          priority,
          marked_unread,
          contact_id,
          contacts (
            id,
            name,
            profile_picture_url,
            phone,
            chat_lid,
            lid,
            is_group,
            whatsapp_display_name
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
          const threadMap = new Map<string, any>();

          for (const conv of data) {
            const contact = (conv as any).contacts;
            const threadKey = contact?.chat_lid || contact?.phone || contact?.lid || conv.contact_id;
          const existing = threadMap.get(threadKey);

          if (!existing) {
            threadMap.set(threadKey, conv);
          } else {
            existing.unread_count += conv.unread_count;
            if (conv.last_message_at && (!existing.last_message_at || conv.last_message_at > existing.last_message_at)) {
              existing.last_message_at = conv.last_message_at;
              existing.id = conv.id;
              existing.status = conv.status;
              existing.assigned_to = conv.assigned_to;
              existing.priority = conv.priority;
              existing.contacts = contact;
            }
            if (conv.status === 'open') {
              existing.status = 'open';
            }
          }
        }

        // Fetch last message for each conversation
        const conversationIds = Array.from(threadMap.values()).map((c: any) => c.id);
        const lastMessagesMap = new Map<string, { content: string | null; message_type: string }>();
        
        if (conversationIds.length > 0) {
          // Get last message for each conversation
          const { data: messagesData } = await supabase
            .from('messages')
            .select('conversation_id, content, message_type, sent_at')
            .in('conversation_id', conversationIds)
            .order('sent_at', { ascending: false });
          
          if (messagesData) {
            // Group by conversation_id and take the first (most recent)
            for (const msg of messagesData) {
              if (!lastMessagesMap.has(msg.conversation_id)) {
                lastMessagesMap.set(msg.conversation_id, {
                  content: msg.content,
                  message_type: msg.message_type,
                });
              }
            }
          }
        }

        const formatted: Conversation[] = Array.from(threadMap.values()).map((conv: any) => {
          const lastMsg = lastMessagesMap.get(conv.id);
          return {
            id: conv.id,
            contact: conv.contacts,
            last_message: lastMsg?.content || null,
            last_message_type: lastMsg?.message_type,
            last_message_at: conv.last_message_at,
            unread_count: conv.unread_count,
            assigned_to: conv.assigned_to,
            status: conv.status,
            priority: conv.priority || 'normal',
            marked_unread: conv.marked_unread || false,
          };
        });
        
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

    let isCancelled = false;

    const fetchMessages = async () => {
      setLoadingMessages(true);

      const { data: selectedConv, error: selectedConvError } = await supabase
        .from('conversations')
        .select(`
          id,
          status,
          priority,
          assigned_to,
          contact_id,
          contacts (
            id,
            name,
            profile_picture_url,
            phone,
            chat_lid,
            lid,
            is_group
          )
        `)
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
        setActiveConversationPriority((selectedConv as any).priority || 'normal');
        setActiveAssignedTo(selectedConv.assigned_to);
      }

      let threadContactIds: string[] = [contactId];
      const threadPhone = contact?.phone || null;
      const threadChatLid = (contact as any)?.chat_lid || null;
      const threadLid = contact?.lid || null;

      if (threadChatLid || threadPhone || threadLid) {
        let q = supabase.from('contacts').select('id');
        if (threadChatLid) q = q.eq('chat_lid', threadChatLid);
        else q = threadPhone ? q.eq('phone', threadPhone) : q.eq('lid', threadLid);

        const { data: threadContacts } = await q;
        if (threadContacts?.length) {
          threadContactIds = threadContacts.map((c: any) => c.id);
        }
      }

      const { data: convsForThread } = await supabase
        .from('conversations')
        .select('id')
        .in('contact_id', threadContactIds);

      const conversationIds: string[] = convsForThread?.map((c: any) => c.id) || [activeConversationId];

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

      if (conversationIds.length > 0) {
        await supabase.from('conversations').update({ unread_count: 0, marked_unread: false }).in('id', conversationIds);
      }

      if (!isCancelled) setLoadingMessages(false);

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

  const handleSendFile = async (file: File) => {
    if (!activeConversationId || !user) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `chat-files/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('chat-files')
        .upload(filePath, file);

      if (uploadError) {
        toast({
          variant: 'destructive',
          title: 'Erro ao enviar arquivo',
          description: 'Bucket de armazenamento não configurado.',
        });
        return;
      }

      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(filePath);

      const { data, error } = await supabase.functions.invoke('zapi-send-file', {
        body: {
          conversation_id: activeConversationId,
          file_url: urlData.publicUrl,
          file_name: file.name,
          file_type: file.type,
          sender_id: user.id,
        },
      });

      if (error || data?.error) {
        toast({
          variant: 'destructive',
          title: 'Erro ao enviar arquivo',
          description: error?.message || data?.error,
        });
      } else {
        toast({ title: 'Arquivo enviado' });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro ao enviar arquivo',
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
      toast({ title: 'Conversa resolvida' });
      setActiveConversationStatus('resolved');
      if (isMobile) {
        handleBackToList();
      } else {
        setActiveConversationId(null);
      }
    }
  };

  const handleReopenConversation = async () => {
    if (!activeConversationId || !user) return;

    const { error } = await supabase
      .from('conversations')
      .update({ 
        status: 'open',
        assigned_to: user.id,
      })
      .eq('id', activeConversationId);

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Erro ao reabrir conversa',
        description: error.message,
      });
    } else {
      toast({ title: 'Conversa reaberta' });
      setActiveConversationStatus('open');
    }
  };

  const handleMarkUnread = async () => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversations')
      .update({ marked_unread: true, unread_count: 1 })
      .eq('id', activeConversationId);

    if (!error) {
      toast({ title: 'Marcada como não lida' });
    }
  };

  const handleSetPriority = async (priority: string) => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversations')
      .update({ priority })
      .eq('id', activeConversationId);

    if (!error) {
      setActiveConversationPriority(priority);
      toast({ title: `Prioridade: ${priority}` });
    }
  };

  const handleSnooze = async (until: Date) => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversations')
      .update({ snoozed_until: until.toISOString() })
      .eq('id', activeConversationId);

    if (!error) {
      toast({ title: 'Conversa adiada' });
    }
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversations')
      .update({ assigned_to: agentId })
      .eq('id', activeConversationId);

    if (!error) {
      setActiveAssignedTo(agentId);
      const agent = profiles.find(p => p.id === agentId);
      toast({ title: `Atribuído a ${agent?.name || 'agente'}` });
    }
  };

  const handleAssignTeam = async (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    toast({ title: `Atribuído à equipe ${team?.name || ''}` });
  };

  const handleAddLabel = async (labelId: string) => {
    if (!activeConversationId) return;

    const { error } = await supabase
      .from('conversation_labels')
      .insert({ conversation_id: activeConversationId, label_id: labelId });

    if (!error) {
      const label = labels.find(l => l.id === labelId);
      toast({ title: `Etiqueta "${label?.name}" adicionada` });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen-safe flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Mobile: Show chat view when conversation is selected
  if (isMobile && activeConversationId && activeContact) {
    return (
      <AppLayout hideBottomNav>
        <div className="flex flex-col h-full">
          {/* Mobile Chat Header */}
          <div className="h-14 shrink-0 border-b border-border flex items-center gap-3 px-2 bg-card">
            <Button variant="ghost" size="icon" onClick={handleBackToList}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            {activeContact.is_group ? (
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
            ) : (
              <ConversationAvatar name={activeContact.name} imageUrl={activeContact.profile_picture_url} />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{activeContact.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {activeContact.phone || activeContact.lid || 'Sem identificação'}
              </p>
            </div>
          </div>
          
          <ChatArea
            contact={activeContact}
            messages={messages}
            profiles={profiles}
            teams={teams}
            labels={labels}
            conversationId={activeConversationId}
            conversationStatus={activeConversationStatus}
            conversationPriority={activeConversationPriority}
            assignedTo={activeAssignedTo}
            onSendMessage={handleSendMessage}
            onSendFile={handleSendFile}
            onResolveConversation={handleResolveConversation}
            onReopenConversation={handleReopenConversation}
            onMarkUnread={handleMarkUnread}
            onSetPriority={handleSetPriority}
            onSnooze={handleSnooze}
            onAssignAgent={handleAssignAgent}
            onAssignTeam={handleAssignTeam}
            onAddLabel={handleAddLabel}
            loading={loadingMessages}
            isMobile
          />
        </div>
      </AppLayout>
    );
  }

  // Mobile: Show only conversation list
  if (isMobile) {
    return (
      <AppLayout>
        <ConversationList
          conversations={conversations}
          activeConversationId={null}
          userId={user.id}
          onSelectConversation={handleSelectConversation}
          isMobile
        />
      </AppLayout>
    );
  }

  // Desktop: Show split view
  return (
    <AppLayout>
      <div className="flex h-full">
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversationId}
          userId={user.id}
          onSelectConversation={handleSelectConversation}
        />
        <ChatArea
          contact={activeContact}
          messages={messages}
          profiles={profiles}
          teams={teams}
          labels={labels}
          conversationId={activeConversationId}
          conversationStatus={activeConversationStatus}
          conversationPriority={activeConversationPriority}
          assignedTo={activeAssignedTo}
          onSendMessage={handleSendMessage}
          onSendFile={handleSendFile}
          onResolveConversation={handleResolveConversation}
          onReopenConversation={handleReopenConversation}
          onMarkUnread={handleMarkUnread}
          onSetPriority={handleSetPriority}
          onSnooze={handleSnooze}
          onAssignAgent={handleAssignAgent}
          onAssignTeam={handleAssignTeam}
          onAddLabel={handleAddLabel}
          loading={loadingMessages}
        />
      </div>
    </AppLayout>
  );
}
