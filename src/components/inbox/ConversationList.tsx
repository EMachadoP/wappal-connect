import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationItem } from './ConversationItem';
import { NewMessageModal } from './NewMessageModal';
import { Button } from '@/components/ui/button';

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

export type TabValue = 'mine' | 'inbox' | 'resolved' | 'all';

interface ConversationListProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  userId: string;
  onSelectConversation: (id: string) => void;
  isMobile?: boolean;
  activeTab: TabValue;
  onTabChange: (tab: TabValue) => void;
}

export function ConversationList({
  conversations,
  activeConversationId,
  userId,
  onSelectConversation,
  isMobile = false,
  activeTab,
  onTabChange,
}: ConversationListProps) {
  const [search, setSearch] = useState('');
  const [newMessageModalOpen, setNewMessageModalOpen] = useState(false);

  // Filter mainly by search now, as the LIST is already filtered by SQL based on activeTab
  const filteredConversations = conversations.filter((conv) => {
    const contactName = conv.contact?.name || "Contato Desconhecido";
    if (!contactName.toLowerCase().includes(search.toLowerCase())) return false;

    // HIDE EMPTY SHELLS check (keep this for safety)
    const hasHistory = conv.last_message_at || conv.status === 'resolved';
    if (!hasHistory) return false;

    return true;
  });

  return (
    <div className={`w-full border-r border-border flex flex-col bg-card h-full overflow-hidden`}>
      <div className="shrink-0 p-4 border-b border-border space-y-4 bg-muted/5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg px-1">Mensagens</h2>
          <Button
            variant="default"
            size="sm"
            onClick={() => setNewMessageModalOpen(true)}
            className="gap-2 h-8 px-3"
          >
            <Plus className="w-4 h-4" />
            Nova Conversa
          </Button>
        </div>
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

      <NewMessageModal
        open={newMessageModalOpen}
        onOpenChange={setNewMessageModalOpen}
        onSelectConversation={onSelectConversation}
      />

      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as TabValue)} className="shrink-0 border-b border-border">
        <TabsList className="w-full h-auto p-0 bg-transparent grid grid-cols-4">
          <TabsTrigger value="mine" className="text-xs px-2 py-3 h-auto">
            Minhas {activeTab === 'mine' && `(${filteredConversations.length})`}
          </TabsTrigger>
          <TabsTrigger value="inbox" className="text-xs px-2 py-3 h-auto">
            Entrada {activeTab === 'inbox' && `(${filteredConversations.length})`}
          </TabsTrigger>
          <TabsTrigger value="resolved" className="text-xs px-2 py-3 h-auto">
            Resolvidos {activeTab === 'resolved' && `(${filteredConversations.length})`}
          </TabsTrigger>
          <TabsTrigger value="all" className="text-xs px-2 py-3 h-auto">
            Todas {activeTab === 'all' && `(${filteredConversations.length})`}
          </TabsTrigger>
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