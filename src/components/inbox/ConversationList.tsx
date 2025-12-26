import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationItem } from './ConversationItem';

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
  const [activeTab, setActiveTab] = useState<TabValue>('all');

  const filteredConversations = conversations
    .filter((conv) => {
      if (!conv.contact) return false;
      const contactName = conv.contact.name || "";
      const matchesSearch = contactName.toLowerCase().includes(search.toLowerCase());
      
      if (!matchesSearch) return false;

      switch (activeTab) {
        case 'mine':
          return conv.status === 'open' && conv.assigned_to === userId;
        case 'unassigned':
          return conv.status === 'open' && !conv.assigned_to;
        case 'all':
          return conv.status === 'open';
        case 'resolved':
          return conv.status === 'resolved';
        default:
          return true;
      }
    });

  const countByTab = {
    mine: conversations.filter(c => c.status === 'open' && c.assigned_to === userId).length,
    unassigned: conversations.filter(c => c.status === 'open' && !c.assigned_to).length,
    all: conversations.filter(c => c.status === 'open').length,
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
          <TabsTrigger value="mine" className="text-[10px] px-1 py-3 h-auto">Minhas ({countByTab.mine})</TabsTrigger>
          <TabsTrigger value="unassigned" className="text-[10px] px-1 py-3 h-auto">Fila ({countByTab.unassigned})</TabsTrigger>
          <TabsTrigger value="all" className="text-[10px] px-1 py-3 h-auto">Todos ({countByTab.all})</TabsTrigger>
          <TabsTrigger value="resolved" className="text-[10px] px-1 py-3 h-auto">OK ({countByTab.resolved})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground text-sm">
            Nenhuma conversa encontrada
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              id={conv.id}
              contactName={conv.contact.name || "Sem Nome"}
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