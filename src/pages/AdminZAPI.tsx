import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Save, Loader2, Share2, Info, Activity, RefreshCw, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  forward_webhook_url?: string | null;
}

export default function AdminZAPIPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSignal, setLastSignal] = useState<string | null>(null);
  
  // Estado separado para o formulário para evitar sobrescrita
  const [settings, setSettings] = useState<ZAPISettings>({
    id: '',
    team_id: null,
    zapi_instance_id: '',
    zapi_token: '',
    zapi_security_token: '',
    open_tickets_group_id: '',
    enable_group_notifications: false,
    forward_webhook_url: '',
  });

  // Busca inicial dos dados (apenas uma vez ou quando clicar em atualizar)
  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('zapi_settings').select('*').is('team_id', null).maybeSingle();
      if (data) {
        setSettings(data);
        setLastSignal(data.last_webhook_received_at);
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  // Busca apenas o sinal (timestamp) para o monitor, sem mexer nos campos de texto
  const fetchSignalOnly = async () => {
    try {
      const { data } = await supabase
        .from('zapi_settings')
        .select('last_webhook_received_at')
        .is('team_id', null)
        .maybeSingle();
      
      if (data) {
        setLastSignal(data.last_webhook_received_at);
      }
    } catch (error) {
      console.error('Error fetching signal:', error);
    }
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchSettings();
      
      // Monitor de sinal: atualiza apenas o timestamp a cada 5s
      const interval = setInterval(fetchSignalOnly, 5000);
      return () => clearInterval(interval);
    }
  }, [user, isAdmin]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        team_id: null,
        zapi_instance_id: settings.zapi_instance_id || null,
        zapi_token: settings.zapi_token || null,
        zapi_security_token: settings.zapi_security_token || null,
        forward_webhook_url: settings.forward_webhook_url || null,
      };

      if (settings.id) {
        const { error } = await supabase.from('zapi_settings').update(payload).eq('id', settings.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('zapi_settings').insert(payload).select().single();
        if (error) throw error;
        if (data) setSettings(data);
      }
      toast({ title: 'Configurações salvas com sucesso!' });
    } catch (error) {
      console.error('Save error:', error);
      toast({ variant: 'destructive', title: 'Erro ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || roleLoading) return <div className="p-8 text-center">Carregando...</div>;
  if (!user || !isAdmin) return <Navigate to="/inbox" replace />;

  const signalTimeDisplay = lastSignal 
    ? formatDistanceToNow(new Date(lastSignal), { addSuffix: true, locale: ptBR })
    : 'Nunca';

  const isOnline = lastSignal && 
    (new Date().getTime() - new Date(lastSignal).getTime() < 60000);

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full max-w-4xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Configurações Z-API</h1>
            <p className="text-muted-foreground">Sincronização com WhatsApp</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchSettings}>
              <RefreshCw className="w-4 h-4 mr-2" /> Atualizar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </div>

        {/* MONITOR DE SINAL */}
        <Card className={`transition-colors duration-500 ${isOnline ? 'border-green-500/50 bg-green-500/5' : 'border-primary/50 bg-primary/5'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className={`w-4 h-4 ${isOnline ? 'text-green-500 animate-bounce' : 'text-primary animate-pulse'}`} />
              Monitor de Conexão (Webhook)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{lastSignal ? 'Recebendo Sinal' : 'Sem Sinal'}</p>
                <p className="text-xs text-muted-foreground mt-1">Última mensagem detectada: <span className="font-medium text-foreground">{signalTimeDisplay}</span></p>
              </div>
              <Badge variant={lastSignal ? "default" : "destructive"} className={`px-3 py-1 ${isOnline ? 'bg-green-600 hover:bg-green-600' : ''}`}>
                {isOnline ? 'CONECTADO AGORA' : lastSignal ? 'WEBHOOK OK' : 'WEBHOOK INATIVO'}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* ENCAMINHAMENTO (MULTIPLICADOR) */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Share2 className="w-4 h-4 text-amber-600" />
              Multiplicador de Webhook (Evolvy/Outros)
            </CardTitle>
            <CardDescription>
              Como a Z-API só aceita uma URL, use este campo para enviar as mensagens também para o Evolvy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>URL de Encaminhamento (URL do Evolvy)</Label>
              <Input 
                placeholder="https://sua-url-do-evolvy.com/webhook" 
                value={settings.forward_webhook_url || ''} 
                onChange={(e) => setSettings({ ...settings, forward_webhook_url: e.target.value })} 
              />
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                <Info className="w-3 h-3" />
                Cole aqui a URL que estava configurada no painel da Z-API antes.
              </p>
            </div>
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
                  <Input 
                    value={settings.zapi_instance_id || ''} 
                    onChange={(e) => setSettings({ ...settings, zapi_instance_id: e.target.value })} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Token</Label>
                  <Input 
                    type="password" 
                    value={settings.zapi_token || ''} 
                    onChange={(e) => setSettings({ ...settings, zapi_token: e.target.value })} 
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}