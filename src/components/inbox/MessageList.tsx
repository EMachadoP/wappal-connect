"use client";

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { ChatMessage } from './ChatMessage';

interface MessageListProps {
  messages: any[];
  loading?: boolean;
  conversationId?: string | null;
  profiles: any[];
  contactName?: string; // Novo prop para fallback
}

const MemoizedChatMessage = memo(ChatMessage);

export function MessageList({ messages, loading, conversationId, profiles, contactName }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(messages.length);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const isNewMessage = messages.length > prevLength.current;
    if (isNewMessage) {
      scrollToBottom('smooth');
    } else {
      scrollToBottom('auto');
    }
    prevLength.current = messages.length;
  }, [messages.length, scrollToBottom]);

  const getAgentName = (senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find(p => p.id === senderId);
    return profile?.name || null;
  };

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center" aria-busy="true">
        <p className="text-muted-foreground">Carregando mensagens...</p>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 scrollbar-thin"
      role="log"
      aria-label="Histórico de mensagens"
    >
      <div className="flex flex-col">
        {messages.map((msg) => {
          const isOutgoing = msg.sender_type === 'agent';
          
          // Lógica de nome:
          // Se for agente: prioriza agent_name da tabela, senão busca no array de perfis
          // Se for contato: usa o sender_name salvo na mensagem (vinda do WhatsApp) 
          // ou o nome do contato principal como fallback
          const name = isOutgoing 
            ? (msg.agent_name || getAgentName(msg.sender_id || msg.agent_id))
            : (msg.sender_name || contactName);

          return (
            <MemoizedChatMessage
              key={msg.id}
              messageId={msg.id}
              conversationId={conversationId}
              content={msg.content}
              messageType={msg.message_type}
              mediaUrl={msg.media_url}
              sentAt={msg.sent_at}
              isOutgoing={isOutgoing}
              isSystem={msg.sender_type === 'system'}
              deliveredAt={msg.delivered_at}
              readAt={msg.read_at}
              senderName={name}
              isAIGenerated={isOutgoing && !msg.sender_id && !msg.agent_id}
              transcript={msg.transcript}
            />
          );
        })}
      </div>
    </div>
  );
}