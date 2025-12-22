import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, MoreVertical, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationAvatar } from './ConversationAvatar';
import { ChatMessage } from './ChatMessage';
import { EmojiPicker } from './EmojiPicker';
import { ConversationActionsMenu } from './ConversationActionsMenu';

interface Message {
  id: string;
  content?: string | null;
  message_type: string;
  media_url?: string | null;
  sent_at: string;
  sender_type: string;
  sender_id?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
}

interface Contact {
  id?: string;
  name: string;
  profile_picture_url?: string | null;
  phone?: string | null;
  lid?: string | null;
  is_group?: boolean;
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

interface ChatAreaProps {
  contact: Contact | null;
  messages: Message[];
  profiles: Profile[];
  teams?: Team[];
  labels?: Label[];
  conversationId?: string | null;
  conversationStatus?: string;
  conversationPriority?: string;
  assignedTo?: string | null;
  markedUnread?: boolean;
  onSendMessage: (content: string) => void;
  onSendFile?: (file: File) => void;
  onResolveConversation?: () => void;
  onReopenConversation?: () => void;
  onMarkUnread?: () => void;
  onSetPriority?: (priority: string) => void;
  onSnooze?: (until: Date) => void;
  onAssignAgent?: (agentId: string) => void;
  onAssignTeam?: (teamId: string) => void;
  onAddLabel?: (labelId: string) => void;
  loading?: boolean;
}

export function ChatArea({ 
  contact, 
  messages, 
  profiles,
  teams = [],
  labels = [],
  conversationId,
  conversationStatus = 'open',
  conversationPriority = 'normal',
  assignedTo,
  markedUnread,
  onSendMessage,
  onSendFile,
  onResolveConversation,
  onReopenConversation,
  onMarkUnread,
  onSetPriority,
  onSnooze,
  onAssignAgent,
  onAssignTeam,
  onAddLabel,
  loading 
}: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessage((prev) => prev + emoji);
  };

  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const getSenderName = (senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find(p => p.id === senderId);
    return profile?.name || null;
  };

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <p className="text-lg">Selecione uma conversa</p>
          <p className="text-sm">Escolha uma conversa na lista para começar</p>
        </div>
      </div>
    );
  }

  const isResolved = conversationStatus === 'resolved';

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Chat Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          {contact.is_group ? (
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
          ) : (
            <ConversationAvatar name={contact.name} imageUrl={contact.profile_picture_url} />
          )}
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium">{contact.name}</p>
              {contact.is_group && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">Grupo</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {contact.phone || contact.lid || 'Sem identificação'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <ConversationActionsMenu
            isResolved={isResolved}
            priority={conversationPriority}
            profiles={profiles}
            teams={teams}
            labels={labels}
            assignedTo={assignedTo}
            onResolve={onResolveConversation}
            onReopen={onReopenConversation}
            onMarkUnread={onMarkUnread}
            onSetPriority={onSetPriority}
            onSnooze={onSnooze}
            onAssignAgent={onAssignAgent}
            onAssignTeam={onAssignTeam}
            onAddLabel={onAddLabel}
          />
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Carregando mensagens...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          <div className="min-h-full">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                content={msg.content}
                messageType={msg.message_type}
                mediaUrl={msg.media_url}
                sentAt={msg.sent_at}
                isOutgoing={msg.sender_type === 'agent'}
                deliveredAt={msg.delivered_at}
                readAt={msg.read_at}
                senderName={msg.sender_type === 'agent' ? getSenderName(msg.sender_id) : null}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border">
        {isResolved ? (
          <div className="text-center text-muted-foreground text-sm py-2">
            Conversa resolvida. Use o menu para reabrir.
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <EmojiPicker onEmojiSelect={handleEmojiSelect} />
            <Button variant="ghost" size="icon" className="shrink-0" onClick={handleFileClick}>
              <Paperclip className="w-5 h-5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            />
            <Input
              placeholder="Digite uma mensagem..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={!message.trim()} className="shrink-0">
              <Send className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
