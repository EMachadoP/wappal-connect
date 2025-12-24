import { format } from 'date-fns';
import { Check, CheckCheck, FileText, Camera, Video, Mic, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MessageFeedback } from './MessageFeedback';
import { Badge } from '@/components/ui/badge';

interface ChatMessageProps {
  messageId: string;
  conversationId?: string | null;
  content?: string | null;
  messageType: string;
  mediaUrl?: string | null;
  sentAt: string;
  isOutgoing: boolean;
  isSystem?: boolean;
  deliveredAt?: string | null;
  readAt?: string | null;
  senderName?: string | null;
  isAIGenerated?: boolean;
  transcript?: string | null;
}

export function ChatMessage({
  messageId,
  conversationId,
  content,
  messageType,
  mediaUrl,
  sentAt,
  isOutgoing,
  isSystem = false,
  deliveredAt,
  readAt,
  senderName,
  isAIGenerated,
  transcript,
}: ChatMessageProps) {
  const time = format(new Date(sentAt), 'HH:mm');

  // Render system messages as centered badge
  if (isSystem || messageType === 'system') {
    return (
      <div className="flex justify-center my-3">
        <Badge variant="secondary" className="text-xs px-3 py-1 bg-muted text-muted-foreground font-normal">
          {content} • {time}
        </Badge>
      </div>
    );
  }

  // Render media placeholder when no media_url
  const renderMediaPlaceholder = () => {
    switch (messageType) {
      case 'image':
        return (
          <div className="flex items-center gap-2 p-3 bg-background/30 rounded-lg">
            <Camera className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">📷 Imagem</span>
          </div>
        );
      case 'video':
        return (
          <div className="flex items-center gap-2 p-3 bg-background/30 rounded-lg">
            <Video className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">🎬 Vídeo</span>
          </div>
        );
      case 'audio':
        return (
          <div className="flex items-center gap-2 p-3 bg-background/30 rounded-lg">
            <Mic className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">🎤 Áudio</span>
          </div>
        );
      case 'document':
        return (
          <div className="flex items-center gap-2 p-3 bg-background/30 rounded-lg">
            <File className="w-6 h-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">📄 Documento</span>
          </div>
        );
      default:
        return null;
    }
  };

  const renderMedia = () => {
    // If no media_url, show placeholder
    if (!mediaUrl) {
      return renderMediaPlaceholder();
    }

    switch (messageType) {
      case 'image':
        return (
          <img
            src={mediaUrl}
            alt="Imagem"
            className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(mediaUrl, '_blank')}
            onError={(e) => {
              // If image fails to load, show placeholder
              e.currentTarget.style.display = 'none';
              e.currentTarget.parentElement?.querySelector('.media-fallback')?.classList.remove('hidden');
            }}
          />
        );
      case 'video':
        return (
          <video
            src={mediaUrl}
            controls
            className="max-w-xs rounded-lg"
          />
        );
      case 'audio':
        return (
          <div className="flex flex-col gap-2">
            <audio src={mediaUrl} controls className="max-w-xs" />
            {transcript && (
              <div className={cn(
                "text-xs p-2 rounded-md max-w-xs",
                isOutgoing 
                  ? "bg-primary-foreground/10 text-primary-foreground/90" 
                  : "bg-muted text-muted-foreground"
              )}>
                <span className="font-medium">📝 Transcrição:</span>
                <p className="mt-1 whitespace-pre-wrap">{transcript}</p>
              </div>
            )}
          </div>
        );
      case 'document':
        return (
          <a
            href={mediaUrl}
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
        {/* Nome do operador para mensagens enviadas */}
        {isOutgoing && senderName && (
          <p className="text-xs font-medium text-primary-foreground/80 mb-1">
            {senderName}
          </p>
        )}
        
        {messageType !== 'text' && messageType !== 'system' && renderMedia()}
        
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

        {/* Feedback buttons for AI-generated messages */}
        {isOutgoing && isAIGenerated && content && conversationId && (
          <MessageFeedback
            messageId={messageId}
            conversationId={conversationId}
            messageContent={content}
          />
        )}
      </div>
    </div>
  );
}