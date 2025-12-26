"use client";

import { useState } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, FileText, Camera, Video, Mic, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MessageFeedback } from './MessageFeedback';
import { MessageActionsMenu } from './MessageActionsMenu';
import { EditMessageModal } from './EditMessageModal';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  onMessageDeleted?: (messageId: string) => void;
  onMessageUpdated?: (messageId: string, newContent: string) => void;
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
  onMessageDeleted,
  onMessageUpdated,
}: ChatMessageProps) {
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const [isDeleted, setIsDeleted] = useState(false);
  
  const time = format(new Date(sentAt), 'HH:mm');

  const handleDelete = async () => {
    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;

      setIsDeleted(true);
      onMessageDeleted?.(messageId);
      toast.success('Mensagem excluída');
    } catch (error) {
      console.error('Error deleting message:', error);
      toast.error('Erro ao excluir mensagem');
    }
  };

  const handleEditSaved = (newContent: string) => {
    setLocalContent(newContent);
    onMessageUpdated?.(messageId, newContent);
  };

  if (isDeleted) return null;

  if (isSystem || messageType === 'system') {
    return (
      <div className="flex justify-center my-3">
        <Badge variant="secondary" className="text-xs px-3 py-1 bg-muted text-muted-foreground font-normal">
          {localContent} • {time}
        </Badge>
      </div>
    );
  }

  const renderMedia = () => {
    if (!mediaUrl) return null;

    switch (messageType) {
      case 'image':
        return (
          <img
            src={mediaUrl}
            alt="Imagem"
            className="max-w-xs rounded-lg cursor-pointer hover:opacity-90 transition-opacity mb-2"
            onClick={() => window.open(mediaUrl, '_blank')}
          />
        );
      case 'video':
        return <video src={mediaUrl} controls className="max-w-xs rounded-lg mb-2" />;
      case 'audio':
        return (
          <div className="flex flex-col gap-2 mb-2">
            <audio src={mediaUrl} controls className="max-w-xs" />
            {transcript && (
              <div className={cn(
                "text-xs p-2 rounded-md max-w-xs",
                isOutgoing ? "bg-primary-foreground/10 text-primary-foreground/90" : "bg-muted text-muted-foreground"
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
            className="flex items-center gap-2 p-3 bg-background/50 rounded-lg hover:bg-background/70 transition-colors mb-2"
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
    if (readAt) return <CheckCheck className="w-4 h-4 text-info" />;
    if (deliveredAt) return <CheckCheck className="w-4 h-4" />;
    return <Check className="w-4 h-4" />;
  };

  const canEditDelete = isOutgoing && messageType === 'text';

  return (
    <div className={cn('flex mb-2 group', isOutgoing ? 'justify-end' : 'justify-start')}>
      {canEditDelete && isOutgoing && (
        <div className="flex items-center mr-1">
          <MessageActionsMenu onEdit={() => setEditModalOpen(true)} onDelete={handleDelete} />
        </div>
      )}

      <div
        className={cn(
          'max-w-[70%] rounded-lg px-3 py-2',
          isOutgoing
            ? 'bg-chat-outgoing text-chat-outgoing-foreground rounded-br-none'
            : 'bg-chat-incoming text-chat-incoming-foreground rounded-bl-none'
        )}
      >
        {/* Nome do remetente (ajustado para aparecer em ambos os lados) */}
        {senderName && (
          <p className={cn(
            "text-[11px] font-bold mb-1 truncate",
            isOutgoing ? "text-primary-foreground/80" : "text-primary"
          )}>
            {senderName}
          </p>
        )}
        
        {renderMedia()}
        
        {localContent && (
          <p className="text-sm whitespace-pre-wrap break-words">{localContent}</p>
        )}
        
        <div className={cn('flex items-center gap-1 mt-1', isOutgoing ? 'justify-end' : 'justify-start')}>
          <span className={cn('text-[10px]', isOutgoing ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
            {time}
          </span>
          {renderStatus()}
        </div>

        {isOutgoing && isAIGenerated && localContent && conversationId && (
          <MessageFeedback messageId={messageId} conversationId={conversationId} messageContent={localContent} />
        )}
      </div>

      <EditMessageModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        messageId={messageId}
        currentContent={localContent || ''}
        onSaved={handleEditSaved}
      />
    </div>
  );
}