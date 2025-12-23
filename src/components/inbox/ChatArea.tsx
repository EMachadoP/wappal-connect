import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { Send, Paperclip, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConversationAvatar } from './ConversationAvatar';
import { ChatMessage } from './ChatMessage';
import { EmojiPicker } from './EmojiPicker';
import { ConversationActionsMenu } from './ConversationActionsMenu';
import { ParticipantHeader } from './ParticipantHeader';
import { IdentifyParticipantModal } from './IdentifyParticipantModal';
import { AIControlBar } from './AIControlBar';
import { HumanActionBar } from './HumanActionBar';
import { GenerateProtocolModal } from './GenerateProtocolModal';
import { CondominiumChips } from './CondominiumSelector';
import { useParticipantInfo } from '@/hooks/useParticipantInfo';
import { useContactCondominiums } from '@/hooks/useContactCondominiums';
import { toast } from 'sonner';
interface Message {
  id: string;
  content?: string | null;
  message_type: string;
  media_url?: string | null;
  sent_at: string;
  sender_type: 'contact' | 'agent' | 'system';
  sender_id?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  agent_id?: string | null;
  agent_name?: string | null;
}

interface Contact {
  id?: string;
  name: string;
  profile_picture_url?: string | null;
  phone?: string | null;
  lid?: string | null;
  is_group?: boolean;
  whatsapp_display_name?: string | null;
}

interface Profile {
  id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
}

interface Label {
  id: string;
  name: string;
  color: string;
}

interface Condominium {
  id: string;
  name: string;
  is_default?: boolean;
}

interface ChatAreaProps {
  contact: Contact | null;
  messages: Message[];
  profiles: Profile[];
  teams?: Team[];
  labels?: Label[];
  conversationId?: string | null;
  conversationStatus?: string;
  conversationPriority?: string;
  assignedTo?: string | null;
  markedUnread?: boolean;
  aiMode?: 'AUTO' | 'COPILOT' | 'OFF';
  aiPausedUntil?: string | null;
  humanControl?: boolean;
  activeCondominiumId?: string | null;
  activeCondominiumSetBy?: string | null;
  onSendMessage: (content: string) => void;
  onSendFile?: (file: File) => void;
  onResolveConversation?: () => void;
  onReopenConversation?: () => void;
  onMarkUnread?: () => void;
  onSetPriority?: (priority: string) => void;
  onSnooze?: (until: Date) => void;
  onAssignAgent?: (agentId: string) => void;
  onAssignTeam?: (teamId: string) => void;
  onAddLabel?: (labelId: string) => void;
  onAiModeChange?: (mode: 'AUTO' | 'COPILOT' | 'OFF') => void;
  onSelectCondominium?: (condominiumId: string) => void;
  loading?: boolean;
  isMobile?: boolean;
}

// Memoized message component for performance
const MemoizedChatMessage = memo(ChatMessage);

export function ChatArea({ 
  contact, 
  messages, 
  profiles,
  teams = [],
  labels = [],
  conversationId,
  conversationStatus = 'open',
  conversationPriority = 'normal',
  assignedTo,
  markedUnread,
  aiMode = 'AUTO',
  aiPausedUntil,
  humanControl = false,
  activeCondominiumId,
  activeCondominiumSetBy,
  onSendMessage,
  onSendFile,
  onResolveConversation,
  onReopenConversation,
  onMarkUnread,
  onSetPriority,
  onSnooze,
  onAssignAgent,
  onAssignTeam,
  onAddLabel,
  onAiModeChange,
  onSelectCondominium,
  loading,
  isMobile = false,
}: ChatAreaProps) {
  const [message, setMessage] = useState('');
  const [identifyModalOpen, setIdentifyModalOpen] = useState(false);
  const [protocolModalOpen, setProtocolModalOpen] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const prevMessagesLengthRef = useRef(messages.length);

  // Fetch participant info for sender identification
  const {
    participant,
    contactInfo,
    displayNameType,
    refetch: refetchParticipant,
  } = useParticipantInfo(contact?.id, conversationId ?? undefined);

  // Fetch condominiums for the contact
  const {
    condominiums,
    loading: loadingCondominiums,
  } = useContactCondominiums(contact?.id ?? null);

  // Check if condominium selection is needed
  const needsCondominiumSelection = condominiums.length > 1 && !activeCondominiumId;

  // Smart auto-scroll: only scroll if user is at bottom
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ 
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end' 
    });
  }, []);

  // Handle scroll to detect if user is at bottom
  const handleScroll = useCallback(() => {
    setShouldAutoScroll(checkIfAtBottom());
  }, [checkIfAtBottom]);

  // Auto-scroll on new messages if user was at bottom
  useEffect(() => {
    if (messages.length > prevMessagesLengthRef.current && shouldAutoScroll) {
      scrollToBottom();
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length, shouldAutoScroll, scrollToBottom]);

  // Scroll to bottom on initial load or conversation change
  useEffect(() => {
    scrollToBottom(false);
    setShouldAutoScroll(true);
  }, [conversationId, scrollToBottom]);

  const handleSend = useCallback(() => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
      setShouldAutoScroll(true);
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [message, onSendMessage, scrollToBottom]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setMessage((prev) => prev + emoji);
  }, []);

  const handleFileClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onSendFile) {
      onSendFile(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onSendFile]);

  const getSenderName = useCallback((senderId: string | null | undefined): string | null => {
    if (!senderId) return null;
    const profile = profiles.find(p => p.id === senderId);
    return profile?.name || null;
  }, [profiles]);

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <p className="text-lg">Selecione uma conversa</p>
          <p className="text-sm">Escolha uma conversa na lista para começar</p>
        </div>
      </div>
    );
  }

  const isResolved = conversationStatus === 'resolved';

  return (
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      {/* Chat Header - Hidden on mobile (header is in parent) */}
      {!isMobile && (
        <div className="h-14 shrink-0 border-b border-border flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {contact.is_group ? (
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
            ) : (
              <ConversationAvatar name={contact.name} imageUrl={contact.profile_picture_url} />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{contact.name}</p>
                {contact.is_group && (
                  <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">Grupo</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {contact.phone || contact.lid || 'Sem identificação'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <ConversationActionsMenu
              isResolved={isResolved}
              priority={conversationPriority}
              profiles={profiles}
              teams={teams}
              labels={labels}
              assignedTo={assignedTo}
              onResolve={onResolveConversation}
              onReopen={onReopenConversation}
              onMarkUnread={onMarkUnread}
              onSetPriority={onSetPriority}
              onSnooze={onSnooze}
              onAssignAgent={onAssignAgent}
              onAssignTeam={onAssignTeam}
              onAddLabel={onAddLabel}
            />
          </div>
        </div>
      )}

      {/* AI Control Bar */}
      {conversationId && (
        <AIControlBar
          conversationId={conversationId}
          aiMode={aiMode}
          aiPausedUntil={aiPausedUntil ?? null}
          humanControl={humanControl}
          onModeChange={onAiModeChange}
        />
      )}

      {/* Participant Header - Sender Identification */}
      {!contact.is_group && (
        <ParticipantHeader
          phone={contact.phone}
          whatsappDisplayName={contactInfo?.whatsapp_display_name || contact.whatsapp_display_name}
          participant={participant}
          displayNameType={displayNameType}
          conversationId={conversationId ?? undefined}
          condominiums={condominiums}
          activeCondominiumId={activeCondominiumId}
          activeCondominiumSetBy={activeCondominiumSetBy}
          loadingCondominiums={loadingCondominiums}
          onIdentify={() => setIdentifyModalOpen(true)}
          onSelectCondominium={onSelectCondominium}
        />
      )}

      {/* Condominium Selection Chips - shown when AI asks or selection needed */}
      {needsCondominiumSelection && onSelectCondominium && (
        <div className="px-4 py-2">
          <CondominiumChips
            condominiums={condominiums}
            onSelect={onSelectCondominium}
          />
        </div>
      )}

      {/* Messages - Independent scroll area */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 scrollbar-thin"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Carregando mensagens...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Nenhuma mensagem ainda</p>
          </div>
        ) : (
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
              />
            ))}
            <div ref={bottomRef} className="h-1" />
          </div>
        )}
      </div>

      {/* Human Action Bar - shown when human has control */}
      {conversationId && (
        <HumanActionBar
          conversationId={conversationId}
          humanControl={humanControl}
          aiMode={aiMode}
          onResolveConversation={onResolveConversation}
          onGenerateProtocol={() => setProtocolModalOpen(true)}
          onAiModeChange={onAiModeChange}
        />
      )}

      {/* Input - Sticky at bottom with safe area */}
      <div className={`p-3 border-t border-border bg-card ${isMobile ? 'pb-safe' : ''}`}>
        {isResolved ? (
          <div className="text-center text-muted-foreground text-sm py-2">
            Conversa resolvida. 
            {!isMobile && ' Use o menu para reabrir.'}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <EmojiPicker onEmojiSelect={handleEmojiSelect} />
            <Button variant="ghost" size="icon" className="shrink-0" onClick={handleFileClick}>
              <Paperclip className="w-5 h-5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
            />
            <Input
              placeholder="Digite uma mensagem..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
              autoComplete="off"
            />
            <Button onClick={handleSend} disabled={!message.trim()} className="shrink-0">
              <Send className="w-5 h-5" />
            </Button>
          </div>
        )}
      </div>

      {/* Identify Participant Modal */}
      {contact?.id && conversationId && (
        <IdentifyParticipantModal
          open={identifyModalOpen}
          onOpenChange={setIdentifyModalOpen}
          contactId={contact.id}
          conversationId={conversationId}
          existingParticipant={participant}
          onSaved={refetchParticipant}
        />
      )}

      {/* Generate Protocol Modal */}
      {conversationId && (
        <GenerateProtocolModal
          open={protocolModalOpen}
          onOpenChange={setProtocolModalOpen}
          conversationId={conversationId}
          contactId={contact?.id}
          condominiums={condominiums}
          activeCondominiumId={activeCondominiumId}
          participant={participant}
          onProtocolCreated={(code) => toast.success(`Protocolo ${code} criado`)}
        />
      )}
    </div>
  );
}
