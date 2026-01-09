"use client";

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { ChatMessage } from './ChatMessage';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MessageListProps {
  messages: any[];
  loading?: boolean;
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
  if (isToday(date)) {
    return 'Hoje';
  }
  if (isYesterday(date)) {
    return 'Ontem';
  }
  // Para datas mais antigas, mostra o dia da semana e a data
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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Carregando mensagens...</p>
      </div>
    );
  }

  // Agrupar mensagens por data
  const messagesWithDateSeparators: (any | { type: 'date-separator', date: Date })[] = [];
  let lastDate: Date | null = null;

  messages.forEach((msg) => {
    const msgDate = new Date(msg.sent_at);

    // Se é um novo dia, adiciona o separador
    if (!lastDate || !isSameDay(msgDate, lastDate)) {
      messagesWithDateSeparators.push({
        type: 'date-separator',
        date: msgDate,
        id: `separator-${msg.sent_at}` // Unique key for separator
      });
      lastDate = msgDate;
    }

    messagesWithDateSeparators.push(msg);
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 scrollbar-thin"
    >
      <div className="flex flex-col">
        {messagesWithDateSeparators.map((item) => {
          // Renderizar separador de data
          if (item.type === 'date-separator') {
            return <DateSeparator key={item.id} date={item.date} />;
          }

          // Renderizar mensagem normal
          const msg = item;
          const isOutgoing = msg.sender_type === 'agent';

          let name: string | null = null;

          if (isOutgoing) {
            name = msg.agent_name || getAgentName(msg.sender_id || msg.agent_id);
          } else {
            // Lógica para remetente (inbound):
            // 1. Se o nome na mensagem NÃO for um telefone, usa ele (bom para grupos)
            // 2. Senão, usa o contactName (nome identificado do contato)
            // 3. Se nada funcionar, usa o que tiver na mensagem
            if (msg.sender_name && !isPhoneNumber(msg.sender_name)) {
              name = msg.sender_name;
            } else {
              name = contactName || msg.sender_name;
            }
          }

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