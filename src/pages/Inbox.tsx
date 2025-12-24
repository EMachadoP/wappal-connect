import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
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
          thread_key,
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
          // Lógica corrigida: Usar thread_key do banco para agrupamento exato
          const threadKey = (conv as any).thread_key || conv.contact_id;
          const existing = threadMap.get(threadKey);

          if (!existing) {
            threadMap.set(threadKey, conv);
          } else {
            // Manter a conversa mais recente, somando unread_count
            const existingTime = existing.last_message_at ? new Date(existing.last_message_at).getTime() : 0;
            const convTime = conv.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
            const unreadTotal = (existing.unread_count || 0) + (conv.unread_count || 0);
            
            if (convTime > existingTime) {
              threadMap.set(threadKey, { ...conv, unread_count: unreadTotal });
            } else {
              existing.unread_count = unreadTotal;
            }
          }
        }

        // Fetch last message for each conversation
        const conversationIds = Array.from(threadMap.values()).map((c: any) => c.id);
        const lastMessagesMap = new Map<string, { content: string | null; message_type: string }>();
        
        if (conversationIds.length > 0) {
          const { data: messagesData } = await supabase
            .from('messages')
            .select('conversation_id, content, message_type, sent_at')
            .in('conversation_id', conversationIds)
            .order('sent_at', { ascending: false });
          
          if (messagesData) {
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
          const contact = conv.contacts;
          
          const isOnlyNumber = (str: string | null | undefined): boolean => {
            if (!str) return true;
            return /^[\d\s\+\-\(\)]+$/.test(str.trim());
          };
          
          let displayName = 'Desconhecido';
          if (contact?.is_group) {
            displayName = contact?.group_name || contact?.name || 'Grupo';
          } else {
            const whatsappName = contact?.whatsapp_display_name;
            const contactName = contact?.name;
            
            if (whatsappName && !isOnlyNumber(whatsappName)) {
              displayName = whatsappName;
            } else if (contactName && !isOnlyNumber(contactName)) {
              displayName = contactName;
            } else {
              displayName = contact?.phone || contactName || whatsappName || 'Desconhecido';
            }
          }
          return {
            id: conv.id,
            contact: {
              ...contact,
              name: displayName,
            },
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
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          const updated = payload.new as any;
          setConversations(prev => {
            const index = prev.findIndex(c => c.id === updated.id);
            if (index !== -1) {
              const newList = [...prev];
              newList[index] = {
                ...newList[index],
                last_message_at: updated.last_message_at,
                unread_count: updated.unread_count,
                status: updated.status,
                priority: updated.priority,
                assigned_to: updated.assigned_to,
                marked_unread: updated.marked_unread,
              };
              newList.sort((a, b) => {
                if (!a.last_message_at) return 1;
                if (!b.last_message_at) return -1;
                return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
              });
              return newList;
            }
            fetchConversations();
            return prev;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        () => {
          fetchConversations();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const newMessage = payload.new as any;
          if (newMessage.sender_type !== 'contact') return;
          
          const { data: conv } = await supabase
            .from('conversations')
            .select('assigned_to, status')
            .eq('id', newMessage.conversation_id)
            .maybeSingle();
          
          if (!conv) return;
          if (conv.status === 'resolved') return;
          
          if (conv.assigned_to === user?.id || conv.assigned_to === null) {
            playNotificationSound();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast, playNotificationSound]);

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
          ai_mode,
          ai_paused_until,
          human_control,
          active_condominium_id,
          active_condominium_set_by,
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
        setActiveAiMode((selectedConv as any).ai_mode || 'AUTO');
        setActiveAiPausedUntil((selectedConv as any).ai_paused_until || null);
        setActiveHumanControl((selectedConv as any).human_control || false);
        setActiveCondominiumId((selectedConv as any).active_condominium_id || null);
        setActiveCondominiumSetBy((selectedConv as any).active_condominium_set_by || null);
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
        .channel(`messages-thread-${activeConversationId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            const newMessage = payload.new as any as Message;
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMessage.id)) return prev;
              return [...prev, newMessage].sort(
                (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
              );
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            const updatedMessage = payload.new as any as Message;
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m))
            );
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    fetchMessages();

    return () => {
      isCancelled = true;
    };
  }, [activeConversationId, toast]);

  const handleSendMessage = async (content: string) => {
    if (!activeConversationId || !user) return;

    if (activeAiMode === 'AUTO') {
      const autoReturnTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await supabase.from('conversations').update({
        ai_mode: 'OFF',
        human_control: true,
        ai_paused_until: autoReturnTime,
      }).eq('id', activeConversationId);
      await supabase.from('ai_events').insert({
        conversation_id: activeConversationId,
        event_type: 'human_takeover',
        message: '👤 Atendimento assumido por operador humano (IA retorna automaticamente em 30min).',
      });
      setActiveAiMode('OFF');
      setActiveHumanControl(true);
      setActiveAiPausedUntil(autoReturnTime);
    }

    try {
      const { error } = await supabase.functions.invoke('zapi-send-message', {
        body: { conversation_id: activeConversationId, content, message_type: 'text', sender_id: user.id },
      });
      if (error) throw error;
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar', description: err.message });
    }
  };

  const handleSendFile = async (file: File) => {
    if (!activeConversationId || !user) return;
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `chat-files/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('chat-files').upload(filePath, file);
      if (uploadError) throw new Error('Falha no upload');
      const { data: urlData } = supabase.storage.from('chat-files').getPublicUrl(filePath);
      const { error } = await supabase.functions.invoke('zapi-send-file', {
        body: { conversation_id: activeConversationId, file_url: urlData.publicUrl, file_name: file.name, file_type: file.type, sender_id: user.id },
      });
      if (error) throw error;
      toast({ title: 'Arquivo enviado' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Erro ao enviar arquivo', description: err.message });
    }
  };

  const handleResolveConversation = async () => {
    if (!activeConversationId || !user) return;
    const { error } = await supabase.from('conversations').update({ 
      status: 'resolved', unread_count: 0, resolved_at: new Date().toISOString(), resolved_by: user.id,
    }).eq('id', activeConversationId);
    if (error) {
      toast({ variant: 'destructive', title: 'Erro ao resolver', description: error.message });
    } else {
      toast({ title: 'Conversa resolvida' });
      setActiveConversationStatus('resolved');
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, status: 'resolved', unread_count: 0 } : c));
      if (isMobile) handleBackToList();
      else setActiveConversationId(null);
    }
  };

  const handleReopenConversation = async () => {
    if (!activeConversationId || !user) return;
    const { error } = await supabase.from('conversations').update({ 
      status: 'open', assigned_to: user.id, resolved_at: null, resolved_by: null,
    }).eq('id', activeConversationId);
    if (error) {
      toast({ variant: 'destructive', title: 'Erro ao reabrir', description: error.message });
    } else {
      toast({ title: 'Conversa reaberta' });
      setActiveConversationStatus('open');
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, status: 'open' } : c));
    }
  };

  const handleMarkUnread = async () => {
    if (!activeConversationId) return;
    await supabase.from('conversations').update({ marked_unread: true, unread_count: 1 }).eq('id', activeConversationId);
    toast({ title: 'Marcada como não lida' });
  };

  const handleSetPriority = async (priority: string) => {
    if (!activeConversationId) return;
    await supabase.from('conversations').update({ priority }).eq('id', activeConversationId);
    setActiveConversationPriority(priority);
    toast({ title: `Prioridade: ${priority}` });
  };

  const handleSnooze = async (until: Date) => {
    if (!activeConversationId) return;
    await supabase.from('conversations').update({ snoozed_until: until.toISOString() }).eq('id', activeConversationId);
    toast({ title: 'Conversa adiada' });
  };

  const handleAssignAgent = async (agentId: string) => {
    if (!activeConversationId || !user) return;
    const { data, error } = await supabase.functions.invoke('assign-conversation', {
      body: { conversation_id: activeConversationId, agent_id: agentId },
    });
    if (error || data?.error) {
      toast({ variant: 'destructive', title: 'Erro ao atribuir', description: error?.message || data?.error });
    } else {
      setActiveAssignedTo(agentId);
      setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, assigned_to: agentId } : c));
      toast({ title: `Atribuído a ${data.agent_name}` });
    }
  };

  const handleProtocolCreated = (protocolCode: string) => {
    if (!activeConversationId || !user) return;
    setActiveAssignedTo(user.id);
    setConversations(prev => prev.map(c => c.id === activeConversationId ? { ...c, assigned_to: user.id } : c));
    toast({ title: `Protocolo ${protocolCode} criado` });
  };

  const handleAssignTeam = async (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    toast({ title: `Atribuído à equipe ${team?.name || ''}` });
  };

  const handleAddLabel = async (labelId: string) => {
    if (!activeConversationId) return;
    const { error } = await supabase.from('conversation_labels').insert({ conversation_id: activeConversationId, label_id: labelId });
    if (!error) {
      const label = labels.find(l => l.id === labelId);
      toast({ title: `Etiqueta "${label?.name}" adicionada` });
    }
  };

  const handleSelectCondominium = async (condominiumId: string) => {
    if (!activeConversationId || !user) return;
    const { error } = await supabase.from('conversations').update({
      active_condominium_id: condominiumId, active_condominium_confidence: 100, active_condominium_set_by: 'human', active_condominium_set_at: new Date().toISOString(),
    }).eq('id', activeConversationId);
    if (!error) {
      setActiveCondominiumId(condominiumId);
      setActiveCondominiumSetBy('human');
      toast({ title: 'Condomínio ativo atualizado' });
    }
  };

  if (authLoading) return <div className="min-h-screen-safe flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  if (isMobile && activeConversationId && activeContact) {
    return (
      <AppLayout hideBottomNav>
        <div className="flex flex-col h-full">
          <div className="h-14 shrink-0 border-b flex items-center gap-3 px-2 bg-card">
            <Button variant="ghost" size="icon" onClick={handleBackToList}><ArrowLeft className="w-5 h-5" /></Button>
            <ConversationAvatar name={activeContact.name} imageUrl={activeContact.profile_picture_url} />
            <div className="flex-1 min-w-0"><p className="font-medium truncate">{activeContact.name}</p><p className="text-xs text-muted-foreground truncate">{activeContact.phone || activeContact.lid || 'Sem identificação'}</p></div>
          </div>
          <ChatArea
            contact={activeContact} messages={messages} profiles={profiles} teams={teams} labels={labels} conversationId={activeConversationId} conversationStatus={activeConversationStatus} conversationPriority={activeConversationPriority} assignedTo={activeAssignedTo} aiMode={activeAiMode} aiPausedUntil={activeAiPausedUntil} humanControl={activeHumanControl} activeCondominiumId={activeCondominiumId} activeCondominiumSetBy={activeCondominiumSetBy} currentUserId={user.id} onProtocolCreated={handleProtocolCreated} onSendMessage={handleSendMessage} onSendFile={handleSendFile} onResolveConversation={handleResolveConversation} onReopenConversation={handleReopenConversation} onMarkUnread={handleMarkUnread} onSetPriority={handleSetPriority} onSnooze={handleSnooze} onAssignAgent={handleAssignAgent} onAssignTeam={handleAssignTeam} onAddLabel={handleAddLabel} onSelectCondominium={handleSelectCondominium} onAiModeChange={setActiveAiMode} loading={loadingMessages} isMobile
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex h-full">
        <ConversationList conversations={conversations} activeConversationId={activeConversationId} userId={user.id} onSelectConversation={handleSelectConversation} isMobile={isMobile} />
        {!isMobile && (
          <ChatArea
            contact={activeContact} messages={messages} profiles={profiles} teams={teams} labels={labels} conversationId={activeConversationId} conversationStatus={activeConversationStatus} conversationPriority={activeConversationPriority} assignedTo={activeAssignedTo} aiMode={activeAiMode} aiPausedUntil={activeAiPausedUntil} humanControl={activeHumanControl} activeCondominiumId={activeCondominiumId} activeCondominiumSetBy={activeCondominiumSetBy} currentUserId={user.id} onProtocolCreated={handleProtocolCreated} onSendMessage={handleSendMessage} onSendFile={handleSendFile} onResolveConversation={handleResolveConversation} onReopenConversation={handleReopenConversation} onMarkUnread={handleMarkUnread} onSetPriority={handleSetPriority} onSnooze={handleSnooze} onAssignAgent={handleAssignAgent} onAssignTeam={handleAssignTeam} onAddLabel={handleAddLabel} onSelectCondominium={handleSelectCondominium} onAiModeChange={setActiveAiMode} loading={loadingMessages}
          />
        )}
      </div>
    </AppLayout>
  );
}