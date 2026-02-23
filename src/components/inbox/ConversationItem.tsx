import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Image, Video, Mic, FileText, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConversationAvatar } from './ConversationAvatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';

interface ConversationItemProps {
  id: string;
  contactName: string;
  contactImageUrl?: string | null;
  lastMessage?: string | null;
  lastMessageType?: string;
  lastMessageAt?: string | null;
  unreadCount: number;
  isActive: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string, selected: boolean) => void;
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
  id,
  contactName,
  contactImageUrl,
  lastMessage,
  lastMessageType,
  lastMessageAt,
  unreadCount,
  isActive,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
  onClick,
}: ConversationItemProps) {
  const timeAgo = lastMessageAt
    ? formatDistanceToNow(new Date(lastMessageAt), { addSuffix: true, locale: ptBR })
    : '';

  const handleClick = (e: React.MouseEvent) => {
    if (selectionMode && onToggleSelection) {
      e.preventDefault();
      onToggleSelection(id, !isSelected);
    } else {
      onClick();
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full p-3 flex items-start gap-3 text-left transition-colors hover:bg-muted/50',
        isActive && !selectionMode && 'bg-muted',
        isSelected && selectionMode && 'bg-primary/5'
      )}
    >
      {selectionMode && (
        <div className="flex items-center justify-center pt-2.5 pr-1" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => {
              if (onToggleSelection) onToggleSelection(id, checked === true);
            }}
          />
        </div>
      )}
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
            <Badge className="bg-destructive hover:bg-destructive/90 text-destructive-foreground h-5 min-w-5 flex items-center justify-center px-1.5 shadow-sm ring-2 ring-destructive/20 shadow-destructive/50 animate-pulse">
              {unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}