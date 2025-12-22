import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Clock, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface NotificationStatusProps {
  conversationId: string;
}

interface Notification {
  id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  error_message: string | null;
  zapi_response_id: string | null;
}

export function NotificationStatus({ conversationId }: NotificationStatusProps) {
  const [notification, setNotification] = useState<Notification | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotification = async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('notification_type', 'ticket_created')
        .single();

      if (!error && data) {
        setNotification(data);
      }
      setLoading(false);
    };

    fetchNotification();
  }, [conversationId]);

  if (loading) {
    return null;
  }

  if (!notification) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="flex items-center gap-1 text-muted-foreground">
              <Bell className="w-3 h-3" />
              Não notificado
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Este chamado não foi notificado no grupo</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const getStatusInfo = () => {
    switch (notification.status) {
      case 'sent':
        return {
          icon: <CheckCircle className="w-3 h-3" />,
          label: 'Notificado',
          variant: 'default' as const,
          color: 'text-green-600',
        };
      case 'failed':
        return {
          icon: <XCircle className="w-3 h-3" />,
          label: 'Falhou',
          variant: 'destructive' as const,
          color: 'text-destructive',
        };
      case 'pending':
      default:
        return {
          icon: <Clock className="w-3 h-3" />,
          label: 'Pendente',
          variant: 'secondary' as const,
          color: 'text-muted-foreground',
        };
    }
  };

  const statusInfo = getStatusInfo();
  const dateTime = notification.sent_at || notification.created_at;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={statusInfo.variant} className={`flex items-center gap-1 ${statusInfo.color}`}>
            {statusInfo.icon}
            {statusInfo.label} no grupo
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px]">
          <div className="space-y-1">
            <p className="font-medium">Notificação de Grupo</p>
            <p className="text-xs">
              {format(new Date(dateTime), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
            </p>
            {notification.status === 'failed' && notification.error_message && (
              <p className="text-xs text-destructive">Erro: {notification.error_message}</p>
            )}
            {notification.zapi_response_id && (
              <p className="text-xs text-muted-foreground">ID: {notification.zapi_response_id}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
