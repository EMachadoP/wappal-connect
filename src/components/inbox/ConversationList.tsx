import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationItem } from './ConversationItem';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Conversation {
  id: string;
  contact: {
    name: string;
    profile_picture_url?: string | null;
  };
  last_message?: string | null;
  last_message_type?: string;
  last_message_at?: string | null;
  unread_count: number;
  assigned_to?: string | null;
  status: string;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  userId: string;
  onSelectConversation: (id: string) => void;
  isMobile?: boolean;
}

type TabValue = 'mine' | 'unassigned' | 'all' | 'resolved';

export function ConversationList({
  conversations,
  activeConversationId,
  userId,
  onSelectConversation,
  isMobile = false,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('mine');

  const filteredConversations = conversations
    .filter((conv) => {
      if (!conv.contact) return false;
      const matchesSearch = conv.contact.name.toLowerCase().includes(search.toLowerCase());
      
      switch (activeTab) {
        case 'mine':
          // Minha: status='open' AND assigned_to = current_user_id
          return matchesSearch && conv.status === 'open' && conv.assigned_to === userId;
        case 'unassigned':
          // Não atribuída: status='open' AND assigned_to IS NULL
          return matchesSearch && conv.status === 'open' && !conv.assigned_to;
        case 'all':
          // Todos: status='open' AND NOT assigned to anyone (same as unassigned, for visibility)
          // Once assigned, conversation only appears in the assignee's "Minha" tab
          return matchesSearch && conv.status === 'open' && !conv.assigned_to;
        case 'resolved':
          // Resolvidas: status='resolved'
          return matchesSearch && conv.status === 'resolved';
        default:
          return matchesSearch;
      }
    })
    .sort((a, b) => {
      const dateA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const dateB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return dateB - dateA;
    });

  const countByTab = {
    mine: conversations.filter(c => c.status === 'open' && c.assigned_to === userId).length,
    unassigned: conversations.filter(c => c.status === 'open' && !c.assigned_to).length,
    all: conversations.filter(c => c.status === 'open' && !c.assigned_to).length,
    resolved: conversations.filter(c => c.status === 'resolved').length,
  };

  return (
    <div className={`${isMobile ? 'w-full' : 'w-80'} border-r border-border flex flex-col bg-card h-full overflow-hidden`}>
      <div className="shrink-0 p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar conversas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="shrink-0 border-b border-border">
        <TabsList className="w-full h-auto p-0 bg-transparent grid grid-cols-4">
          <TabsTrigger
            value="mine"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-1"
          >
            Minha ({countByTab.mine})
          </TabsTrigger>
          <TabsTrigger
            value="unassigned"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-1"
          >
            Não atrib. ({countByTab.unassigned})
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-1"
          >
            Todos ({countByTab.all})
          </TabsTrigger>
          <TabsTrigger
            value="resolved"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-1"
          >
            Resolvidas ({countByTab.resolved})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              id={conv.id}
              contactName={conv.contact.name}
              contactImageUrl={conv.contact.profile_picture_url}
              lastMessage={conv.last_message}
              lastMessageType={conv.last_message_type}
              lastMessageAt={conv.last_message_at}
              unreadCount={conv.unread_count}
              isActive={conv.id === activeConversationId}
              onClick={() => onSelectConversation(conv.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
