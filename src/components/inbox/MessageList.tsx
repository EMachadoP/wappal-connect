"use client";

import React, { useRef, useEffect, useCallback, memo, useLayoutEffect } from "react";
import { ChatMessage } from "./ChatMessage";
import { format, isToday, isYesterday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";

interface MessageListProps {
  messages: any[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  conversationId?: string | null;
  profiles: any[];
  contactName?: string;
  focusMessageId?: string | null; // ✅ novo
}

const MemoizedChatMessage = memo(ChatMessage);

const isPhoneNumber = (str: string | null | undefined): boolean => {
  if (!str) return false;
  const digitsOnly = str.replace(/\D/g, "");
  return digitsOnly.length >= 8 && /^\d+$/.test(digitsOnly);
};

const formatDateSeparator = (date: Date): string => {
  if (isToday(date)) return "Hoje";
  if (isYesterday(date)) return "Ontem";
  const dayOfWeek = format(date, "EEEE", { locale: ptBR });
  const formattedDate = format(date, "dd/MM/yyyy");
  return `${dayOfWeek.charAt(0).toUpperCase() + dayOfWeek.slice(1)}, ${formattedDate}`;
};

const DateSeparator = ({ date }: { date: Date }) => (
  <div className="flex items-center justify-center my-4">
    <div className="flex-1 border-t border-border"></div>
    <span className="px-4 text-xs text-muted-foreground font-medium bg-background">
      {formatDateSeparator(date)}
    </span>
    <div className="flex-1 border-t border-border"></div>
  </div>
);

function raf2(cb: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(cb));
}

export function MessageList({
  messages,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  conversationId,
  profiles,
  contactName,
  focusMessageId
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // snapshots anteriores (para detectar prepend/append corretamente)
  const prevFirstId = useRef<string | null>(null);
  const prevLastId = useRef<string | null>(null);

  const isInitialLoad = useRef(true);
  const scrollSnapshot = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(false); // ✅ Flag para manter no fim quando imagens carregam

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = containerRef.current;
    if (!el) return;
    // ✅ FIX: Calcular top correto para evitar overflow
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top, behavior });
  }, []);

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
    return distance < 120; // threshold
  }, []);

  const getAgentName = (senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find((p) => p.id === senderId);
    return profile?.name || null;
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;

    // ✅ Atualiza stickToBottom: se usuário saiu do fim, desliga auto-scroll
    const distance = target.scrollHeight - (target.scrollTop + target.clientHeight);
    stickToBottom.current = distance < 120;

    if (target.scrollTop < 100 && hasMore && !loadingMore && onLoadMore && !loading) {
      console.log("[MessageList] Scrolled to top, fetching more...");
      scrollSnapshot.current = { height: target.scrollHeight, top: target.scrollTop };
      onLoadMore();
    }
  };

  // Reset when switching conversation
  useEffect(() => {
    isInitialLoad.current = true;
    scrollSnapshot.current = null;
    prevFirstId.current = null;
    prevLastId.current = null;
    stickToBottom.current = false;

    // ✅ CRÍTICO: Forçar scroll reset para evitar cache do browser
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [conversationId]);

  // ✅ ResizeObserver: mantém scroll no fim quando imagens carregam
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      // Só "gruda" no fim quando stickToBottom está ativo
      if (stickToBottom.current) {
        scrollToBottom('auto');
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  // ✅ Scroll para mensagem específica (com "load more")
  useEffect(() => {
    if (!focusMessageId) return;
    const el = containerRef.current;
    if (!el) return;

    let tries = 0;
    const maxTries = 8;

    const tryScroll = () => {
      const target = el.querySelector(`[data-message-id="${focusMessageId}"]`) as HTMLElement | null;

      if (target) {
        // ✅ achou: centraliza e para
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        // destaque (opcional)
        target.classList.add("ring-2", "ring-primary", "ring-offset-2", "rounded-lg", "transition-all", "duration-1000");
        setTimeout(() => target.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 3000);
        return;
      }

      // não achou: tenta carregar mais (mensagens antigas) até achar
      if (hasMore && onLoadMore && tries < maxTries && !loadingMore) {
        tries++;
        console.log(`[MessageList] Searching for focusMessageId ${focusMessageId}, try ${tries}/${maxTries}`);
        onLoadMore();
        // espera render
        raf2(tryScroll);
      }
    };

    raf2(tryScroll);
  }, [focusMessageId, hasMore, onLoadMore, loadingMore, messages]);

  // Scroll behavior AFTER render (mais confiável que setTimeout)
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const first = messages[0]?.id ?? null;
    const last = messages[messages.length - 1]?.id ?? null;

    const wasPrepended =
      !!prevFirstId.current && !!first && first !== prevFirstId.current && messages.length > 0;

    const wasAppended =
      !!prevLastId.current && !!last && last !== prevLastId.current && messages.length > 0;

    // 1) Initial load: ALWAYS scroll to bottom (last message)
    if (isInitialLoad.current && messages.length > 0) {
      // ✅ Triple RAF: garante que DOM + layout + paint estão prontos
      raf2(() => {
        requestAnimationFrame(() => {
          const el2 = containerRef.current;
          if (!el2) return;

          // ✅ SEMPRE rolar pro fim ao abrir conversa
          stickToBottom.current = true;
          scrollToBottom("auto");

          // ✅ ALTERNATIVA: Se quiser rolar para primeira mensagem não lida
          // Descomente o bloco a seguir e comente o scrollToBottom acima
          /*
          const firstUnreadIndex = messages.findIndex(
            (m) => !m.read_at && m.sender_type !== "agent" && m.sender_type !== "system"
          );

          if (firstUnreadIndex !== -1) {
            // Tem mensagens não lidas: rolar até primeira e NÃO stick
            stickToBottom.current = false;
            const wrappers = el2.querySelectorAll("[data-message-id]");
            const target = wrappers[firstUnreadIndex] as HTMLElement | undefined;
            if (target) {
              target.scrollIntoView({ behavior: "auto", block: "start" });
            } else {
              scrollToBottom("auto");
            }
          } else {
            // Tudo lido: rolar pro fim E ativar stick
            stickToBottom.current = true;
            scrollToBottom("auto");
          }
          */

          isInitialLoad.current = false;
        });
      });
    }

    // 2) After prepend: restore scroll position
    else if (wasPrepended && scrollSnapshot.current) {
      raf2(() => {
        const el2 = containerRef.current;
        if (!el2 || !scrollSnapshot.current) return;

        const newHeight = el2.scrollHeight;
        const diff = newHeight - scrollSnapshot.current.height;
        el2.scrollTop = scrollSnapshot.current.top + diff;
        scrollSnapshot.current = null;
      });
    }

    // 3) After append: only autoscroll if user is near bottom
    else if (wasAppended) {
      if (isNearBottom()) {
        raf2(() => scrollToBottom("smooth"));
      }
    }

    // update prev refs
    prevFirstId.current = first;
    prevLastId.current = last;
  }, [messages, scrollToBottom, isNearBottom]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground animate-pulse">Carregando histórico...</p>
      </div>
    );
  }

  // Agrupar mensagens por data
  const messagesWithDateSeparators: (any | { type: "date-separator"; date: Date; id: string })[] = [];
  let lastDate: Date | null = null;

  messages.forEach((msg) => {
    const msgDate = new Date(msg.sent_at);
    if (!lastDate || !isSameDay(msgDate, lastDate)) {
      messagesWithDateSeparators.push({
        type: "date-separator",
        date: msgDate,
        id: `sep-${msg.id || msg.sent_at}`,
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
      style={{ overflowAnchor: "none" }}
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
          if (item.type === "date-separator") {
            return <DateSeparator key={item.id} date={item.date} />;
          }

          const msg = item;

          const norm = (v?: string | null) => {
            const s = (v ?? "").trim();
            return s.length ? s : null;
          };

          // ✅ FIX: Detectar humanos enviando pelo celular
          const isHumanOperator =
            norm(msg.sender_name) === "Operador (Celular)" ||
            (msg.direction === "outbound" && msg.sender_id) ||  // tem sender_id = é humano
            msg.agent_id;  // tem agent_id = é humano

          const isAIGenerated =
            msg.sender_type === "assistant" ||
            norm(msg.sender_name) === "Ana Mônica" ||
            msg.is_ai_generated === true;

          const isOutgoing =
            msg.direction === "outbound" ||
            msg.sender_type === "agent" ||
            msg.sender_type === "assistant";
          let name: string | null = null;

          if (isOutgoing) {
            if (isAIGenerated) {
              name = "Ana Mônica";
            } else {
              // ✅ Lógica de nomes personalizada:
              // 1. ADMIN → Ana Mônica (se passa pela IA)
              // 2. Operador pelo celular → G7 Serv
              // 3. Agentes normais → Nome real

              const agentName = norm(msg.agent_name) || norm(getAgentName(msg.sender_id || msg.agent_id));

              // Verificar se é admin pelo profile
              const profile = profiles.find(p => p.id === (msg.sender_id || msg.agent_id));
              const isAdmin = profile?.role === 'admin';

              if (isAdmin) {
                name = "Ana Mônica"; // ADMIN se passa pela IA
              } else if (norm(msg.sender_name) === "Operador (Celular)") {
                name = "G7 Serv"; // Operador pelo celular
              } else {
                name = agentName || norm(msg.sender_name) || "Atendente G7";
              }
            }
          } else {
            name =
              (norm(msg.sender_name) && !isPhoneNumber(norm(msg.sender_name)!))
                ? norm(msg.sender_name)!
                : (norm(contactName) || norm(msg.sender_name));
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
                isSystem={msg.sender_type === "system"}
                deliveredAt={msg.delivered_at}
                readAt={msg.read_at}
                senderName={name}
                isAIGenerated={isAIGenerated}
                transcript={msg.transcript}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}