import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConversationAvatar } from './ConversationAvatar';
import { ChatMessage } from './ChatMessage';

interface Message {
  id: string;
  content?: string | null;
  message_type: string;
  media_url?: string | null;
  sent_at: string;
  sender_type: string;
  delivered_at?: string | null;
  read_at?: string | null;
}

interface Contact {
  name: string;
  profile_picture_url?: string | null;
  phone?: string | null;
  lid?: string | null;
}

interface ChatAreaProps {
  contact: Contact | null;
  messages: Message[];
  onSendMessage: (content: string) => void;
  loading?: boolean;
}

export function ChatArea({ contact, messages, onSendMessage, loading }: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
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

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Chat Header */}
      <div className="h-14 border-b border-border flex items-center gap-3 px-4">
        <ConversationAvatar name={contact.name} imageUrl={contact.profile_picture_url} />
        <div>
          <p className="font-medium">{contact.name}</p>
          <p className="text-xs text-muted-foreground">
            {contact.phone || contact.lid || 'Sem identificação'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Carregando mensagens...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              content={msg.content}
              messageType={msg.message_type}
              mediaUrl={msg.media_url}
              sentAt={msg.sent_at}
              isOutgoing={msg.sender_type === 'agent'}
              deliveredAt={msg.delivered_at}
              readAt={msg.read_at}
            />
          ))
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="shrink-0">
            <Paperclip className="w-5 h-5" />
          </Button>
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
      </div>
    </div>
  );
}