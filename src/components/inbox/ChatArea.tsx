"use client";

import { useState } from 'react';
import { ChatHeader } from './ChatHeader';
import { MessageList } from './MessageList';
import { ChatInputArea } from './ChatInputArea';
import { ParticipantHeader } from './ParticipantHeader';
import { IdentifyParticipantModal } from './IdentifyParticipantModal';
import { AIControlBar } from './AIControlBar';
import { HumanActionBar } from './HumanActionBar';
import { GenerateProtocolModal } from './GenerateProtocolModal';
import { CondominiumChips } from './CondominiumSelector';
import { useParticipantInfo } from '@/hooks/useParticipantInfo';
import { useContactCondominiums } from '@/hooks/useContactCondominiums';
import { toast } from 'sonner';

interface ChatAreaProps {
  contact: any | null;
  messages: any[];
  profiles: any[];
  teams?: any[];
  labels?: any[];
  conversationId?: string | null;
  conversationStatus?: string;
  conversationPriority?: string;
  assignedTo?: string | null;
  aiMode?: 'AUTO' | 'COPILOT' | 'OFF';
  aiPausedUntil?: string | null;
  humanControl?: boolean;
  activeCondominiumId?: string | null;
  activeCondominiumSetBy?: string | null;
  audioEnabled?: boolean;
  audioAutoTranscribe?: boolean;
  currentUserId?: string;
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
  onProtocolCreated?: (code: string) => void;
  onAudioSettingsChange?: () => void;
  loading?: boolean;
  isMobile?: boolean;
  onBack?: () => void;
}

export function ChatArea(props: ChatAreaProps) {
  const { contact, messages, conversationId, loading, isMobile } = props;
  const [identifyModalOpen, setIdentifyModalOpen] = useState(false);
  const [protocolModalOpen, setProtocolModalOpen] = useState(false);

  const { participant, contactInfo, displayNameType, refetch: refetchParticipant } =
    useParticipantInfo(contact?.id, conversationId ?? undefined);

  const { condominiums, loading: loadingCondos } = useContactCondominiums(contact?.id ?? null);

  if (!contact) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground p-6">
          <p className="text-lg font-medium">Selecione uma conversa</p>
          <p className="text-sm">Escolha um contato para ver o histórico</p>
        </div>
      </div>
    );
  }

  const isResolved = props.conversationStatus === 'resolved';

  return (
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      <ChatHeader
        conversationId={conversationId || ''}
        contact={contact}
        isMobile={!!isMobile}
        isResolved={isResolved}
        conversationPriority={props.conversationPriority || 'normal'}
        audioEnabled={props.audioEnabled}
        audioAutoTranscribe={props.audioAutoTranscribe}
        profiles={props.profiles}
        teams={props.teams || []}
        labels={props.labels || []}
        assignedTo={props.assignedTo}
        onResolveConversation={props.onResolveConversation}
        onReopenConversation={props.onReopenConversation}
        onMarkUnread={props.onMarkUnread}
        onSetPriority={props.onSetPriority}
        onSnooze={props.onSnooze}
        onAssignAgent={props.onAssignAgent}
        onAssignTeam={props.onAssignTeam}
        onAddLabel={props.onAddLabel}
        onGenerateProtocol={() => setProtocolModalOpen(true)}
        onAudioSettingsChange={props.onAudioSettingsChange}
        onBack={props.onBack}
      />

      {conversationId && (
        <AIControlBar
          conversationId={conversationId}
          aiMode={props.aiMode || 'AUTO'}
          aiPausedUntil={props.aiPausedUntil ?? null}
          humanControl={props.humanControl || false}
          onModeChange={props.onAiModeChange}
        />
      )}

      {!contact.is_group && (
        <ParticipantHeader
          phone={contact.phone}
          whatsappDisplayName={contactInfo?.whatsapp_display_name || contact.whatsapp_display_name}
          participant={participant}
          displayNameType={displayNameType}
          conversationId={conversationId ?? undefined}
          condominiums={condominiums}
          activeCondominiumId={props.activeCondominiumId}
          activeCondominiumSetBy={props.activeCondominiumSetBy}
          onIdentify={() => setIdentifyModalOpen(true)}
          onSelectCondominium={props.onSelectCondominium}
        />
      )}

      {!props.activeCondominiumId && condominiums.length > 1 && props.onSelectCondominium && (
        <div className="px-4 py-2">
          <CondominiumChips condominiums={condominiums} onSelect={props.onSelectCondominium} />
        </div>
      )}

      <MessageList
        messages={messages}
        loading={loading}
        conversationId={conversationId}
        profiles={props.profiles}
        contactName={participant?.name || contact?.name}
      />

      {conversationId && (
        <HumanActionBar
          conversationId={conversationId}
          humanControl={props.humanControl || false}
          aiMode={props.aiMode || 'AUTO'}
          onResolveConversation={props.onResolveConversation}
          onGenerateProtocol={() => setProtocolModalOpen(true)}
          onAiModeChange={props.onAiModeChange}
        />
      )}

      <ChatInputArea
        onSendMessage={props.onSendMessage}
        onSendFile={props.onSendFile}
        isResolved={isResolved}
        isMobile={!!isMobile}
      />

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

      {conversationId && (
        <GenerateProtocolModal
          open={protocolModalOpen}
          onOpenChange={setProtocolModalOpen}
          conversationId={conversationId}
          contactId={contact?.id}
          condominiums={condominiums}
          activeCondominiumId={props.activeCondominiumId}
          participant={participant}
          currentUserId={props.currentUserId}
          onProtocolCreated={(code) => {
            props.onProtocolCreated?.(code);
            toast.success(`Protocolo ${code} criado`);
          }}
        />
      )}
    </div>
  );
}