import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UserCheck, Building2, AlertCircle } from 'lucide-react';
import { NotificationStatus } from './NotificationStatus';
import { CondominiumSelector } from './CondominiumSelector';

interface Entity {
  id: string;
  name: string;
  type: string;
}

interface Participant {
  id: string;
  name: string;
  role_type?: string | null;
  confidence: number;
  entity_id?: string | null;
  entity?: Entity | null;
}

interface Condominium {
  id: string;
  name: string;
  is_default?: boolean;
}

interface ParticipantHeaderProps {
  phone?: string | null;
  whatsappDisplayName?: string | null;
  participant?: Participant | null;
  displayNameType?: string;
  conversationId?: string;
  protocol?: string | null;
  condominiums?: Condominium[];
  activeCondominiumId?: string | null;
  activeCondominiumSetBy?: string | null;
  loadingCondominiums?: boolean;
  onIdentify: () => void;
  onSelectCondominium?: (condominiumId: string) => void;
}

export function ParticipantHeader({
  phone,
  whatsappDisplayName,
  participant,
  displayNameType,
  conversationId,
  protocol,
  condominiums = [],
  activeCondominiumId,
  activeCondominiumSetBy,
  loadingCondominiums,
  onIdentify,
  onSelectCondominium,
}: ParticipantHeaderProps) {
  const isLowConfidence = !participant || participant.confidence < 0.7;
  const isEntityName = displayNameType === 'ENTITY_NAME';
  const needsCondominiumSelection = condominiums.length > 1 && !activeCondominiumId;

  return (
    <div className="bg-muted/50 border-b border-border px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0 flex-1">
          {/* Row 1: Phone + WhatsApp name + Protocol */}
          <div className="flex items-center gap-2 flex-wrap">
            {phone && (
              <span className="text-sm font-medium text-foreground">
                {phone}
              </span>
            )}
            {whatsappDisplayName && (
              <span className={`text-xs px-2 py-0.5 rounded ${isEntityName
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
                }`}>
                {isEntityName && <Building2 className="w-3 h-3 inline mr-1" />}
                {whatsappDisplayName}
              </span>
            )}
            {protocol && (
              <Badge variant="outline" className="text-xs font-mono">
                🎫 {protocol}
              </Badge>
            )}
          </div>

          {/* Row 2: Participant info + Condominium selector + Notification status */}
          <div className="flex items-center gap-2 flex-wrap">
            {participant ? (
              <>
                <span className="text-sm font-semibold text-foreground">
                  {participant.name}
                </span>
                {participant.role_type && (
                  <Badge variant="secondary" className="text-xs">
                    {participant.role_type}
                  </Badge>
                )}
                {participant.entity && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Building2 className="w-3 h-3" />
                    {participant.entity.name}
                  </Badge>
                )}
                <Badge
                  variant={participant.confidence >= 0.8 ? 'default' : participant.confidence >= 0.5 ? 'secondary' : 'destructive'}
                  className="text-xs"
                >
                  {Math.round(participant.confidence * 100)}%
                </Badge>
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span>Remetente não identificado</span>
              </div>
            )}

            {/* Condominium selector */}
            {condominiums.length > 0 && onSelectCondominium && (
              <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
                <CondominiumSelector
                  condominiums={condominiums}
                  activeCondominiumId={activeCondominiumId ?? null}
                  activeCondominiumSetBy={activeCondominiumSetBy}
                  loading={loadingCondominiums}
                  onSelect={onSelectCondominium}
                />
                {needsCondominiumSelection && (
                  <Badge variant="destructive" className="text-xs animate-pulse">
                    Selecione!
                  </Badge>
                )}
              </div>
            )}

            {/* Notification status */}
            {conversationId && (
              <NotificationStatus conversationId={conversationId} />
            )}
          </div>
        </div>

        <Button
          variant={isLowConfidence ? "default" : "outline"}
          size="sm"
          onClick={onIdentify}
          className="shrink-0"
        >
          <UserCheck className="w-4 h-4 mr-1" />
          {isLowConfidence ? 'Identificar' : 'Editar'}
        </Button>
      </div>
    </div>
  );
}
