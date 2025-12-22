import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Save, Loader2, TestTube, MessageSquare, Info, CheckCircle, XCircle } from 'lucide-react';
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

interface ZAPISettings {
  id: string;
  team_id: string | null;
  zapi_instance_id: string | null;
  zapi_token: string | null;
  zapi_security_token: string | null;
  open_tickets_group_id: string | null;
  enable_group_notifications: boolean;
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
      // Fetch teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name')
        .order('name');
      
      if (teamsData) {
        setTeams(teamsData);
      }

      // Fetch settings for selected team
      await fetchSettings(selectedTeamId === '__global__' ? null : selectedTeamId);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao carregar dados' });
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async (teamId: string | null) => {
    let query = supabase.from('zapi_settings').select('*');
    
    if (teamId) {
      query = query.eq('team_id', teamId);
    } else {
      query = query.is('team_id', null);
    }

    const { data, error } = await query.single();

    if (data) {
      setSettings(data);
    } else {
      // Reset to defaults if no settings found
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
    if (user && isAdmin) {
      fetchData();
    }
  }, [user, isAdmin]);

  useEffect(() => {
    if (!loading) {
      fetchSettings(selectedTeamId === '__global__' ? null : selectedTeamId);
    }
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
        const { error } = await supabase
          .from('zapi_settings')
          .update(payload)
          .eq('id', settings.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('zapi_settings')
          .insert(payload)
          .select()
          .single();
        
        if (error) throw error;
        if (data) {
          setSettings(data);
        }
      }

      toast({ title: 'Configurações salvas!' });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao salvar configurações' });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const instanceId = settings.zapi_instance_id;
      const token = settings.zapi_token;

      if (!instanceId || !token) {
        setTestResult({ success: false, message: 'Preencha Instance ID e Token' });
        return;
      }

      // Test Z-API connection by getting instance status
      const response = await fetch(
        `https://api.z-api.io/instances/${instanceId}/token/${token}/status`,
        {
          headers: settings.zapi_security_token 
            ? { 'Client-Token': settings.zapi_security_token }
            : {},
        }
      );

      const result = await response.json();

      if (response.ok && result.connected) {
        setTestResult({ success: true, message: `Conectado! Número: ${result.smartphoneConnected || 'N/A'}` });
      } else {
        setTestResult({ success: false, message: result.error || 'Falha na conexão' });
      }
    } catch (error) {
      console.error('Test error:', error);
      setTestResult({ success: false, message: 'Erro ao testar conexão' });
    } finally {
      setTesting(false);
    }
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/inbox" replace />;
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Configurações Z-API</h1>
            <p className="text-muted-foreground">Configure a integração com WhatsApp via Z-API</p>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Team Selector */}
            <Card>
              <CardHeader>
                <CardTitle>Escopo das Configurações</CardTitle>
                <CardDescription>
                  Configure para uma equipe específica ou globalmente
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Equipe</Label>
                  <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__global__">🌐 Configuração Global</SelectItem>
                      {teams.map(team => (
                        <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Configurações de equipe têm prioridade sobre a global
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Credentials Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  Credenciais Z-API
                </CardTitle>
                <CardDescription>
                  Obtenha as credenciais no painel da Z-API (z-api.io)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Instance ID</Label>
                    <Input
                      value={settings.zapi_instance_id || ''}
                      onChange={(e) => setSettings({ ...settings, zapi_instance_id: e.target.value })}
                      placeholder="Ex: 3C4B5A6D7E8F..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Token</Label>
                    <Input
                      type="password"
                      value={settings.zapi_token || ''}
                      onChange={(e) => setSettings({ ...settings, zapi_token: e.target.value })}
                      placeholder="Seu token Z-API"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Security Token (opcional)</Label>
                  <Input
                    type="password"
                    value={settings.zapi_security_token || ''}
                    onChange={(e) => setSettings({ ...settings, zapi_security_token: e.target.value })}
                    placeholder="Client-Token para requisições seguras"
                  />
                  <p className="text-xs text-muted-foreground">
                    Necessário apenas se você habilitou o token de segurança no painel Z-API
                  </p>
                </div>

                <Separator />

                <div className="flex items-center gap-4">
                  <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                    {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <TestTube className="w-4 h-4 mr-2" />}
                    Testar Conexão
                  </Button>

                  {testResult && (
                    <Badge variant={testResult.success ? 'default' : 'destructive'} className="flex items-center gap-1">
                      {testResult.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {testResult.message}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Group Notifications Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📣 Notificações de Chamados
                </CardTitle>
                <CardDescription>
                  Envie notificações automáticas para um grupo WhatsApp quando novos chamados são abertos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <Switch
                    checked={settings.enable_group_notifications}
                    onCheckedChange={(checked) => setSettings({ ...settings, enable_group_notifications: checked })}
                  />
                  <Label>Habilitar notificações de grupo</Label>
                </div>

                {settings.enable_group_notifications && (
                  <div className="space-y-4 pl-4 border-l-2 border-primary/20">
                    <div className="space-y-2">
                      <Label>ID do Grupo WhatsApp</Label>
                      <Input
                        value={settings.open_tickets_group_id || ''}
                        onChange={(e) => setSettings({ ...settings, open_tickets_group_id: e.target.value })}
                        placeholder="Ex: 120363123456789012@g.us"
                      />
                      <p className="text-xs text-muted-foreground">
                        Use o formato completo do grupo (terminando em @g.us)
                      </p>
                    </div>

                    <div className="p-4 bg-muted rounded-lg">
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Como obter o ID do grupo?
                      </h4>
                      <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                        <li>Abra o grupo no WhatsApp Web</li>
                        <li>Na URL, copie o ID após "g.us/"</li>
                        <li>Ou use a API Z-API: GET /chats para listar grupos</li>
                      </ol>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <Info className="w-5 h-5 text-primary flex-shrink-0 mt-1" />
                  <div className="space-y-2 text-sm">
                    <p className="font-medium">Como funciona?</p>
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• Quando uma nova conversa é criada, um protocolo é gerado automaticamente</li>
                      <li>• Se as notificações estiverem habilitadas, uma mensagem é enviada ao grupo</li>
                      <li>• A mensagem inclui: protocolo, contato, prioridade, condomínio e resumo</li>
                      <li>• Um registro é criado na timeline do chamado para auditoria</li>
                      <li>• Sistema de deduplicação evita envios duplicados</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
