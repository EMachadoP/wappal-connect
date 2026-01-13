"use client";

import React from 'react';
import { Users, FileText, ArrowLeft, ListTodo, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConversationAvatar } from './ConversationAvatar';
import { ConversationActionsMenu } from './ConversationActionsMenu';
import { AudioSettingsMenu } from './AudioSettingsMenu';

interface ChatHeaderProps {
  conversationId: string;
  contact: any;
  isMobile: boolean;
  isResolved: boolean;
  conversationPriority: string;
  audioEnabled?: boolean;
  audioAutoTranscribe?: boolean;
  profiles: any[];
  teams: any[];
  labels: any[];
  assignedTo?: string | null;
  onResolveConversation?: () => void;
  onReopenConversation?: () => void;
  onMarkUnread?: () => void;
  onSetPriority?: (priority: string) => void;
  onSnooze?: (until: Date) => void;
  onAssignAgent?: (agentId: string) => void;
  onAssignTeam?: (teamId: string) => void;
  onAddLabel?: (labelId: string) => void;
  onGenerateProtocol?: () => void;
  onCreateTask?: () => void;
  onWaitForClient?: () => void;
  onAudioSettingsChange?: () => void;
  onBack?: () => void;
}

export function ChatHeader({
  conversationId,
  contact,
  isMobile,
  isResolved,
  conversationPriority,
  audioEnabled = true,
  audioAutoTranscribe = true,
  profiles,
  teams,
  labels,
  assignedTo,
  onResolveConversation,
  onReopenConversation,
  onMarkUnread,
  onSetPriority,
  onSnooze,
  onAssignAgent,
  onAssignTeam,
  onAddLabel,
  onGenerateProtocol,
  onCreateTask,
  onWaitForClient,
  onAudioSettingsChange,
  onBack,
}: ChatHeaderProps) {

  return (
    <div className="h-14 shrink-0 border-b border-border flex items-center justify-between px-4">
      <div className="flex items-center gap-3">
        {isMobile && onBack && (
          <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
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
        {onGenerateProtocol && (
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerateProtocol}
            className="h-8"
          >
            <FileText className="w-4 h-4 mr-2" />
            Protocolo
          </Button>
        )}

        {onCreateTask && (
          <Button
            size="sm"
            variant="outline"
            onClick={onCreateTask}
            className="h-8"
          >
            <ListTodo className="w-4 h-4 mr-2" />
            Tarefa
          </Button>
        )}

        {onWaitForClient && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onWaitForClient}
            className="h-8"
            title="Aguardar resposta do cliente"
          >
            <Clock className="w-4 h-4" />
          </Button>
        )}

        <AudioSettingsMenu
          conversationId={conversationId}
          audioEnabled={audioEnabled}
          audioAutoTranscribe={audioAutoTranscribe}
          onSettingsChange={onAudioSettingsChange}
        />

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
  );
}