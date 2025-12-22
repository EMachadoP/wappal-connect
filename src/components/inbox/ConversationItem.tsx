import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Image, Video, Mic, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConversationAvatar } from './ConversationAvatar';
import { Badge } from '@/components/ui/badge';

interface ConversationItemProps {
  id: string;
  contactName: string;
  contactImageUrl?: string | null;
  lastMessage?: string | null;
  lastMessageType?: string;
  lastMessageAt?: string | null;
  unreadCount: number;
  isActive: boolean;
  onClick: () => void;
}

function getMessagePreview(message: string | null | undefined, type?: string): React.ReactNode {
  if (!message && !type) return 'Nenhuma mensagem';
  
  const iconClass = "w-4 h-4 inline mr-1";
  
  switch (type) {
    case 'image':
      return <><Image className={iconClass} />[Imagem]</>;
    case 'video':
      return <><Video className={iconClass} />[Vídeo]</>;
    case 'audio':
      return <><Mic className={iconClass} />[Áudio]</>;
    case 'document':
      return <><FileText className={iconClass} />[Documento]</>;
    default:
      return message || 'Nenhuma mensagem';
  }
}

export function ConversationItem({
  contactName,
  contactImageUrl,
  lastMessage,
  lastMessageType,
  lastMessageAt,
  unreadCount,
  isActive,
  onClick,
}: ConversationItemProps) {
  const timeAgo = lastMessageAt
    ? formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true, locale: ptBR })
    : '';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full p-3 flex items-start gap-3 text-left transition-colors hover:bg-muted/50',
        isActive && 'bg-muted'
      )}
    >
      <ConversationAvatar name={contactName} imageUrl={contactImageUrl} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "font-medium truncate",
            unreadCount > 0 && "text-foreground"
          )}>
            {contactName}
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {timeAgo}
          </span>
        </div>
        
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className={cn(
            "text-sm truncate",
            unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground"
          )}>
            {getMessagePreview(lastMessage, lastMessageType)}
          </span>
          
          {unreadCount > 0 && (
            <Badge className="bg-primary text-primary-foreground h-5 min-w-5 flex items-center justify-center px-1.5">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}