"use client";

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { ChatMessage } from './ChatMessage';

interface MessageListProps {
  messages: any[];
  loading?: boolean;
  conversationId?: string | null;
  profiles: any[];
}

const MemoizedChatMessage = memo(ChatMessage);

export function MessageList({ messages, loading, conversationId, profiles }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(messages.length);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (messages.length > prevLength.current) {
      scrollToBottom('smooth');
    } else {
      scrollToBottom('auto');
    }
    prevLength.current = messages.length;
  }, [messages.length, scrollToBottom]);

  const getSenderName = (senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find(p => p.id === senderId);
    return profile?.name || null;
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Carregando mensagens...</p>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 scrollbar-thin"
    >
      <div className="flex flex-col">
        {messages.map((msg) => (
          <MemoizedChatMessage
            key={msg.id}
            messageId={msg.id}
            conversationId={conversationId}
            content={msg.content}
            messageType={msg.message_type}
            mediaUrl={msg.media_url}
            sentAt={msg.sent_at}
            isOutgoing={msg.sender_type === 'agent'}
            isSystem={msg.sender_type === 'system'}
            deliveredAt={msg.delivered_at}
            readAt={msg.read_at}
            senderName={msg.agent_name || (msg.sender_type === 'agent' ? getSenderName(msg.sender_id || msg.agent_id) : null)}
            isAIGenerated={msg.sender_type === 'agent' && !msg.sender_id && !msg.agent_id}
            transcript={msg.transcript}
          />
        ))}
      </div>
    </div>
  );
}