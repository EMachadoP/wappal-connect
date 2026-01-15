"use client";

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { ChatMessage } from './ChatMessage';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MessageListProps {
  messages: any[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  conversationId?: string | null;
  profiles: any[];
  contactName?: string;
}

const MemoizedChatMessage = memo(ChatMessage);

// Função auxiliar para verificar se uma string parece um número de telefone
const isPhoneNumber = (str: string | null | undefined): boolean => {
  if (!str) return false;
  const digitsOnly = str.replace(/\D/g, '');
  return digitsOnly.length >= 8 && /^\d+$/.test(digitsOnly);
};

// Função para formatar a data do separador
const formatDateSeparator = (date: Date): string => {
  if (isToday(date)) return 'Hoje';
  if (isYesterday(date)) return 'Ontem';
  const dayOfWeek = format(date, 'EEEE', { locale: ptBR });
  const formattedDate = format(date, 'dd/MM/yyyy');
  return `${dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)}, ${formattedDate}`;
};

// Componente de separador de data
const DateSeparator = ({ date }: { date: Date }) => (
  <div className="flex items-center justify-center my-4">
    <div className="flex-1 border-t border-border"></div>
    <span className="px-4 text-xs text-muted-foreground font-medium bg-background">
      {formatDateSeparator(date)}
    </span>
    <div className="flex-1 border-t border-border"></div>
  </div>
);

export function MessageList({
  messages,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  conversationId,
  profiles,
  contactName
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLength = useRef(messages.length);
  const isInitialLoad = useRef(true);
  const scrollSnapshot = useRef<{ height: number; top: number } | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, []);

  const getAgentName = (senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find(p => p.id === senderId);
    return profile?.name || null;
  };

  // Handle pagination trigger
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Trigger when scrolled to near the top (100px threshold for better UX)
    if (target.scrollTop < 100 && hasMore && !loadingMore && onLoadMore && !loading) {
      console.log('[MessageList] Scrolled to top, fetching more...');
      scrollSnapshot.current = {
        height: target.scrollHeight,
        top: target.scrollTop
      };
      onLoadMore();
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const isAddedAtBottom = messages.length > prevLength.current && messages[messages.length - 1]?.sent_at !== (prevLength.current > 0 ? messages[prevLength.current - 1]?.sent_at : null);
    const isPrepended = messages.length > prevLength.current && messages[0]?.sent_at !== (prevLength.current > 0 ? messages[0]?.sent_at : null);

    if (isInitialLoad.current && messages.length > 0) {
      // ✅ FIX: Wait for DOM to render before scrolling
      setTimeout(() => {
        if (!containerRef.current) return;

        const firstUnreadIndex = messages.findIndex(msg => !msg.read_at && msg.sender_type !== 'agent');

        if (firstUnreadIndex !== -1) {
          // Scroll to first unread message
          const messageElements = containerRef.current.querySelectorAll('[data-message-id]');
          const targetElement = messageElements[firstUnreadIndex];
          if (targetElement) {
            targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
          } else {
            scrollToBottom('auto');
          }
        } else {
          // All read or no incoming messages - scroll to bottom
          scrollToBottom('auto');
        }
      }, 100); // Small delay to ensure DOM is ready

      isInitialLoad.current = false;
    } else if (isPrepended && scrollSnapshot.current) {
      // Restore scroll position after history load
      const newHeight = containerRef.current.scrollHeight;
      const heightDifference = newHeight - scrollSnapshot.current.height;
      containerRef.current.scrollTop = scrollSnapshot.current.top + heightDifference;
      scrollSnapshot.current = null;
    } else if (isAddedAtBottom) {
      scrollToBottom('smooth');
    }

    prevLength.current = messages.length;
  }, [messages, scrollToBottom]);

  // Reset flags when switching conversation
  useEffect(() => {
    isInitialLoad.current = true;
    scrollSnapshot.current = null;
    prevLength.current = 0;
  }, [conversationId]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Carregando histórico...</p>
      </div>
    );
  }

  // Agrupar mensagens por data
  const messagesWithDateSeparators: (any | { type: 'date-separator', date: Date, id: string })[] = [];
  let lastDate: Date | null = null;

  messages.forEach((msg) => {
    const msgDate = new Date(msg.sent_at);
    if (!lastDate || !isSameDay(msgDate, lastDate)) {
      messagesWithDateSeparators.push({
        type: 'date-separator',
        date: msgDate,
        id: `sep-${msg.id || msg.sent_at}`
      });
      lastDate = msgDate;
    }
    messagesWithDateSeparators.push(msg);
  });

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto p-4 scrollbar-thin"
      style={{ overflowAnchor: 'none' }}
    >
      <div className="flex flex-col min-h-full">
        {hasMore && (
          <div className="py-6 text-center">
            {loadingMore ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            ) : (
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest opacity-40">
                Continue rolando para carregar mais histórico
              </p>
            )}
          </div>
        )}

        {!hasMore && messages.length > 50 && (
          <div className="py-8 text-center border-b border-border/50 mb-6">
            <p className="text-xs text-muted-foreground italic opacity-60">Início da conversa</p>
          </div>
        )}

        {messagesWithDateSeparators.map((item) => {
          if (item.type === 'date-separator') {
            return <DateSeparator key={item.id} date={item.date} />;
          }

          const msg = item;
          const isOutgoing = msg.sender_type === 'agent';
          let name: string | null = null;

          if (isOutgoing) {
            name = msg.agent_name || getAgentName(msg.sender_id || msg.agent_id) || msg.sender_name;
          } else {
            if (msg.sender_name && !isPhoneNumber(msg.sender_name)) {
              name = msg.sender_name;
            } else {
              name = contactName || msg.sender_name;
            }
          }

          return (
            <div key={msg.id} data-message-id={msg.id}>
              <MemoizedChatMessage
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
            </div>
          );
        })}
      </div>
    </div>
  );
}