import { format } from 'date-fns';
import { Check, CheckCheck, Image, Video, Mic, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatMessageProps {
  content?: string | null;
  messageType: string;
  mediaUrl?: string | null;
  sentAt: string;
  isOutgoing: boolean;
  deliveredAt?: string | null;
  readAt?: string | null;
}

export function ChatMessage({
  content,
  messageType,
  mediaUrl,
  sentAt,
  isOutgoing,
  deliveredAt,
  readAt,
}: ChatMessageProps) {
  const time = format(new Date(sentAt), 'HH:mm');

  const renderMedia = () => {
    switch (messageType) {
      case 'image':
        return (
          <img
            src={mediaUrl || ''}
            alt="Imagem"
            className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => mediaUrl && window.open(mediaUrl, '_blank')}
          />
        );
      case 'video':
        return (
          <video
            src={mediaUrl || ''}
            controls
            className="max-w-xs rounded-lg"
          />
        );
      case 'audio':
        return (
          <audio src={mediaUrl || ''} controls className="max-w-xs" />
        );
      case 'document':
        return (
          <a
            href={mediaUrl || ''}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 p-3 bg-background/50 rounded-lg hover:bg-background/70 transition-colors"
          >
            <FileText className="w-8 h-8" />
            <span className="text-sm">Documento</span>
          </a>
        );
      default:
        return null;
    }
  };

  const renderStatus = () => {
    if (!isOutgoing) return null;

    if (readAt) {
      return <CheckCheck className="w-4 h-4 text-info" />;
    }
    if (deliveredAt) {
      return <CheckCheck className="w-4 h-4" />;
    }
    return <Check className="w-4 h-4" />;
  };

  return (
    <div
      className={cn(
        'flex mb-2',
        isOutgoing ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[70%] rounded-lg px-3 py-2',
          isOutgoing
            ? 'bg-chat-outgoing text-chat-outgoing-foreground rounded-br-none'
            : 'bg-chat-incoming text-chat-incoming-foreground rounded-bl-none'
        )}
      >
        {messageType !== 'text' && renderMedia()}
        
        {content && (
          <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        )}
        
        <div className={cn(
          'flex items-center gap-1 mt-1',
          isOutgoing ? 'justify-end' : 'justify-start'
        )}>
          <span className={cn(
            'text-xs',
            isOutgoing ? 'text-primary-foreground/70' : 'text-muted-foreground'
          )}>
            {time}
          </span>
          {renderStatus()}
        </div>
      </div>
    </div>
  );
}