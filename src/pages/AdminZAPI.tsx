import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Save, Loader2, TestTube, MessageSquare, Info, CheckCircle, XCircle, Activity, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ZAPISettings {
  id: string;
  team_id: string | null;
  zapi_instance_id: string | null;
  zapi_token: string | null;
  zapi_security_token: string | null;
  open_tickets_group_id: string | null;
  enable_group_notifications: boolean;
  last_webhook_received_at?: string | null;
}

interface Team {
  id: string;
  name: string;
}

export default function AdminZAPIPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [settings, setSettings] = useState<ZAPISettings>({
    id: '',
    team_id: null,
    zapi_instance_id: '',
    zapi_token: '',
    zapi_security_token: '',
    open_tickets_group_id: '',
    enable_group_notifications: false,
  });

  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('__global__');

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: teamsData } = await supabase.from('teams').select('id, name').order('name');
      if (teamsData) setTeams(teamsData);
      await fetchSettings(selectedTeamId === '__global__' ? null : selectedTeamId);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async (teamId: string | null) => {
    let query = supabase.from('zapi_settings').select('*');
    if (teamId) query = query.eq('team_id', teamId);
    else query = query.is('team_id', null);

    const { data } = await query.maybeSingle();

    if (data) {
      setSettings(data);
    } else {
      setSettings({
        id: '',
        team_id: teamId,
        zapi_instance_id: '',
        zapi_token: '',
        zapi_security_token: '',
        open_tickets_group_id: '',
        enable_group_notifications: false,
      });
    }
  };

  useEffect(() => {
    if (user && isAdmin) fetchData();
  }, [user, isAdmin]);

  useEffect(() => {
    if (!loading) fetchSettings(selectedTeamId === '__global__' ? null : selectedTeamId);
  }, [selectedTeamId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const teamId = selectedTeamId === '__global__' ? null : selectedTeamId;
      const payload = {
        team_id: teamId,
        zapi_instance_id: settings.zapi_instance_id || null,
        zapi_token: settings.zapi_token || null,
        zapi_security_token: settings.zapi_security_token || null,
        open_tickets_group_id: settings.open_tickets_group_id || null,
        enable_group_notifications: settings.enable_group_notifications,
      };

      if (settings.id) {
        await supabase.from('zapi_settings').update(payload).eq('id', settings.id);
      } else {
        const { data } = await supabase.from('zapi_settings').insert(payload).select().single();
        if (data) setSettings(data);
      }
      toast({ title: 'Configurações salvas!' });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || roleLoading) return <div className="p-8 text-center">Carregando...</div>;
  if (!user || !isAdmin) return <Navigate to="/inbox" replace />;

  const lastSignal = settings.last_webhook_received_at 
    ? formatDistanceToNow(new Date(settings.last_webhook_received_at), { addSuffix: true, locale: ptBR })
    : 'Nunca';

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Configurações Z-API</h1>
            <p className="text-muted-foreground">Sincronização com WhatsApp</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Atualizar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </div>

        {/* MONITOR DE SINAL */}
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary animate-pulse" />
              Monitor de Conexão (Webhook)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{settings.last_webhook_received_at ? 'Recebendo Sinal' : 'Sem Sinal'}</p>
                <p className="text-xs text-muted-foreground mt-1">Última mensagem detectada: <span className="font-medium text-foreground">{lastSignal}</span></p>
              </div>
              <Badge variant={settings.last_webhook_received_at ? "default" : "destructive"} className="px-3 py-1">
                {settings.last_webhook_received_at ? 'Webhook OK' : 'Webhook Inativo'}
              </Badge>
            </div>
            {!settings.last_webhook_received_at && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex gap-2">
                <Info className="w-4 h-4 shrink-0" />
                <p>O servidor ainda não recebeu nenhuma chamada do Z-API. Verifique se a URL do Webhook no painel da Z-API está configurada para: <strong>https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-webhook</strong></p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Credenciais da Instância</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Instance ID</Label>
                  <Input value={settings.zapi_instance_id || ''} onChange={(e) => setSettings({ ...settings, zapi_instance_id: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Token</Label>
                  <Input type="password" value={settings.zapi_token || ''} onChange={(e) => setSettings({ ...settings, zapi_token: e.target.value })} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}