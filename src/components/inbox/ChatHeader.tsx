"use client";

import React from 'react';
import { Users } from 'lucide-react';
import { ConversationAvatar } from './ConversationAvatar';
import { ConversationActionsMenu } from './ConversationActionsMenu';

interface ChatHeaderProps {
  contact: any;
  isMobile: boolean;
  isResolved: boolean;
  conversationPriority: string;
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
}

export function ChatHeader({
  contact,
  isMobile,
  isResolved,
  conversationPriority,
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
}: ChatHeaderProps) {
  if (isMobile) return null;

  return (
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
  );
}