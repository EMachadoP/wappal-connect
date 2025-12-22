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
}

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  userId: string;
  onSelectConversation: (id: string) => void;
}

type TabValue = 'mine' | 'unassigned' | 'all';

export function ConversationList({
  conversations,
  activeConversationId,
  userId,
  onSelectConversation,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('mine');

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch = conv.contact.name.toLowerCase().includes(search.toLowerCase());
    
    switch (activeTab) {
      case 'mine':
        return matchesSearch && conv.assigned_to === userId;
      case 'unassigned':
        return matchesSearch && !conv.assigned_to;
      case 'all':
        return matchesSearch;
      default:
        return matchesSearch;
    }
  });

  return (
    <div className="w-80 border-r border-border flex flex-col bg-card">
      <div className="p-3 border-b border-border">
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

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="border-b border-border">
        <TabsList className="w-full h-auto p-0 bg-transparent">
          <TabsTrigger
            value="mine"
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Minha Caixa
          </TabsTrigger>
          <TabsTrigger
            value="unassigned"
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Não Atribuídas
          </TabsTrigger>
          <TabsTrigger
            value="all"
            className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            Todas
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <ScrollArea className="flex-1">
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
      </ScrollArea>
    </div>
  );
}