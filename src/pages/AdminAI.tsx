import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import type { Json } from '@/integrations/supabase/types';
import { Save, RotateCcw, Play, Loader2, Plus, Trash2, Pencil, Copy, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface AISettings {
  id: string;
  enabled_global: boolean;
  timezone: string;
  base_system_prompt: string;
  fallback_offhours_message: string;
  policies_json: Record<string, unknown>;
  memory_message_count: number;
  enable_auto_summary: boolean;
  anti_spam_seconds: number;
  max_messages_per_hour: number;
  human_request_pause_hours: number;
}

interface AITeamSettings {
  id: string;
  team_id: string;
  enabled: boolean;
  prompt_override: string | null;
  schedule_json: ScheduleJson;
  throttling_json: ThrottlingJson;
  teams?: { name: string };
}

interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}

interface ScheduleException {
  date: string;
  enabled: boolean;
  message?: string;
}

interface ScheduleJson {
  days: Record<string, DaySchedule>;
  exceptions: ScheduleException[];
}

interface ThrottlingJson {
  anti_spam_seconds: number | null;
  max_messages_per_hour: number | null;
}

interface AIProviderConfig {
  id: string;
  provider: string;
  model: string;
  temperature: number;
  max_tokens: number;
  top_p: number;
  active: boolean;
  key_ref: string | null;
}

interface AILog {
  id: string;
  conversation_id: string | null;
  team_id: string | null;
  provider: string;
  model: string;
  request_id: string | null;
  input_excerpt: string | null;
  output_text: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  teams?: { name: string } | null;
}

interface Team {
  id: string;
  name: string;
}

const DEFAULT_PROMPT = `Você é um assistente virtual profissional e prestativo da empresa.

Diretrizes:
- Seja educado, claro e objetivo
- Responda em português brasileiro
- Se não souber algo, diga que vai verificar com a equipe
- Não invente preços ou informações não confirmadas
- Se o cliente pedir atendimento humano, informe que está transferindo

Variáveis disponíveis:
- Nome do cliente: {{customer_name}}
- Fuso horário: {{timezone}}
- Horário comercial: {{business_hours}}`;

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Recife',
  'America/Fortaleza',
  'America/Manaus',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Rio_Branco',
];

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

const AVAILABLE_MODELS = {
  lovable: [
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recomendado)' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Rápido)' },
    { value: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
    { value: 'openai/gpt-5', label: 'GPT-5 (Premium)' },
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4.1-mini-2025-04-14', label: 'GPT-4.1 Mini' },
  ],
  gemini: [
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

export default function AdminAIPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Data states
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [teamSettings, setTeamSettings] = useState<AITeamSettings[]>([]);
  const [providers, setProviders] = useState<AIProviderConfig[]>([]);
  const [logs, setLogs] = useState<AILog[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Dialog states
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProviderConfig | null>(null);
  const [editingTeamSetting, setEditingTeamSetting] = useState<AITeamSettings | null>(null);

  // Form states
  const [providerForm, setProviderForm] = useState({
    provider: 'lovable' as string,
    model: 'google/gemini-2.5-flash',
    temperature: 0.7,
    max_tokens: 1024,
    top_p: 1.0,
    active: false,
    key_ref: '',
  });

  // Test playground states
  const [testMessage, setTestMessage] = useState('');
  const [testTeamId, setTestTeamId] = useState<string>('');
  const [testProviderId, setTestProviderId] = useState<string>('');
  const [testResult, setTestResult] = useState<{
    response: string;
    prompt_rendered: string;
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
  } | null>(null);

  // Logs filter
  const [logsFilter, setLogsFilter] = useState({
    status: 'all',
    provider: 'all',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch settings
      const { data: settingsData } = await supabase
        .from('ai_settings')
        .select('*')
        .limit(1)
        .single();
      
      if (settingsData) {
        setSettings(settingsData as AISettings);
      }

      // Fetch team settings
      const { data: teamSettingsData } = await supabase
        .from('ai_team_settings')
        .select('*, teams(name)')
        .order('created_at');
      
      if (teamSettingsData) {
        setTeamSettings(teamSettingsData as unknown as AITeamSettings[]);
      }

      // Fetch providers
      const { data: providersData } = await supabase
        .from('ai_provider_configs')
        .select('*')
        .order('created_at');
      
      if (providersData) {
        setProviders(providersData as AIProviderConfig[]);
      }

      // Fetch teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name')
        .order('name');
      
      if (teamsData) {
        setTeams(teamsData);
      }

      // Fetch logs
      const { data: logsData } = await supabase
        .from('ai_logs')
        .select('*, teams(name)')
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (logsData) {
        setLogs(logsData as unknown as AILog[]);
      }
    } catch (error) {
      console.error('Error fetching AI data:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao carregar dados' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchData();
    }
  }, [user, isAdmin]);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('ai_settings')
        .update({
          enabled_global: settings.enabled_global,
          timezone: settings.timezone,
          base_system_prompt: settings.base_system_prompt,
          fallback_offhours_message: settings.fallback_offhours_message,
          policies_json: settings.policies_json as Json,
          memory_message_count: settings.memory_message_count,
          enable_auto_summary: settings.enable_auto_summary,
          anti_spam_seconds: settings.anti_spam_seconds,
          max_messages_per_hour: settings.max_messages_per_hour,
          human_request_pause_hours: settings.human_request_pause_hours,
        })
        .eq('id', settings.id);

      if (error) throw error;
      toast({ title: 'Configurações salvas!' });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao salvar' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetPrompt = () => {
    if (!settings) return;
    setSettings({ ...settings, base_system_prompt: DEFAULT_PROMPT });
  };

  const handleOpenProviderDialog = (provider?: AIProviderConfig) => {
    if (provider) {
      setEditingProvider(provider);
      setProviderForm({
        provider: provider.provider,
        model: provider.model,
        temperature: Number(provider.temperature),
        max_tokens: provider.max_tokens,
        top_p: Number(provider.top_p),
        active: provider.active,
        key_ref: provider.key_ref || '',
      });
    } else {
      setEditingProvider(null);
      setProviderForm({
        provider: 'lovable',
        model: 'google/gemini-2.5-flash',
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 1.0,
        active: false,
        key_ref: '',
      });
    }
    setProviderDialogOpen(true);
  };

  const handleSaveProvider = async () => {
    try {
      if (editingProvider) {
        const { error } = await supabase
          .from('ai_provider_configs')
          .update({
            provider: providerForm.provider,
            model: providerForm.model,
            temperature: providerForm.temperature,
            max_tokens: providerForm.max_tokens,
            top_p: providerForm.top_p,
            active: providerForm.active,
            key_ref: providerForm.key_ref || null,
          })
          .eq('id', editingProvider.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('ai_provider_configs')
          .insert({
            provider: providerForm.provider,
            model: providerForm.model,
            temperature: providerForm.temperature,
            max_tokens: providerForm.max_tokens,
            top_p: providerForm.top_p,
            active: providerForm.active,
            key_ref: providerForm.key_ref || null,
          });

        if (error) throw error;
      }

      toast({ title: editingProvider ? 'Provedor atualizado!' : 'Provedor criado!' });
      setProviderDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error('Error saving provider:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao salvar provedor' });
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      const { error } = await supabase
        .from('ai_provider_configs')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast({ title: 'Provedor removido!' });
      fetchData();
    } catch (error) {
      console.error('Error deleting provider:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao remover' });
    }
  };

  const handleToggleProviderActive = async (provider: AIProviderConfig) => {
    try {
      // If activating, deactivate others first
      if (!provider.active) {
        await supabase
          .from('ai_provider_configs')
          .update({ active: false })
          .neq('id', provider.id);
      }

      const { error } = await supabase
        .from('ai_provider_configs')
        .update({ active: !provider.active })
        .eq('id', provider.id);

      if (error) throw error;
      toast({ title: provider.active ? 'Provedor desativado!' : 'Provedor ativado!' });
      fetchData();
    } catch (error) {
      console.error('Error toggling provider:', error);
      toast({ variant: 'destructive', title: 'Erro' });
    }
  };

  const handleTestAI = async () => {
    if (!testMessage.trim()) {
      toast({ variant: 'destructive', title: 'Digite uma mensagem para testar' });
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('ai-test', {
        body: {
          message: testMessage,
          teamId: testTeamId || null,
          providerId: testProviderId || null,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      setTestResult(data);
      toast({ title: 'Teste concluído!' });
    } catch (error) {
      console.error('Test error:', error);
      toast({ 
        variant: 'destructive', 
        title: 'Erro no teste', 
        description: error instanceof Error ? error.message : 'Falha ao testar IA' 
      });
    } finally {
      setTesting(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (logsFilter.status !== 'all' && log.status !== logsFilter.status) return false;
    if (logsFilter.provider !== 'all' && log.provider !== logsFilter.provider) return false;
    return true;
  });

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
            <h1 className="text-2xl font-bold">Central de IA</h1>
            <p className="text-muted-foreground">Configure a automação de respostas com IA</p>
          </div>
          {settings && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings.enabled_global}
                  onCheckedChange={(checked) => setSettings({ ...settings, enabled_global: checked })}
                />
                <Label>IA Ativa Globalmente</Label>
              </div>
              <Button onClick={handleSaveSettings} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Salvar
              </Button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="prompt" className="space-y-6">
            <TabsList className="flex-wrap">
              <TabsTrigger value="prompt">Prompt & Persona</TabsTrigger>
              <TabsTrigger value="schedule">Horários & Regras</TabsTrigger>
              <TabsTrigger value="providers">Provedores</TabsTrigger>
              <TabsTrigger value="context">Ferramentas & Contexto</TabsTrigger>
              <TabsTrigger value="test">Testar IA</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            {/* PROMPT TAB */}
            <TabsContent value="prompt" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Prompt do Sistema</CardTitle>
                  <CardDescription>
                    Configure as instruções base para a IA. Use variáveis como {'{{'}'customer_name{'}}'}, {'{{'}'timezone{'}}'}, etc.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Prompt Base</Label>
                      <span className="text-xs text-muted-foreground">
                        {settings?.base_system_prompt?.length || 0} caracteres
                      </span>
                    </div>
                    <Textarea
                      value={settings?.base_system_prompt || ''}
                      onChange={(e) => settings && setSettings({ ...settings, base_system_prompt: e.target.value })}
                      className="min-h-[300px] font-mono text-sm"
                      placeholder="Digite o prompt do sistema..."
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleResetPrompt}>
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Restaurar Padrão
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Mensagem de Fallback (Fora do Horário)</Label>
                    <Textarea
                      value={settings?.fallback_offhours_message || ''}
                      onChange={(e) => settings && setSettings({ ...settings, fallback_offhours_message: e.target.value })}
                      className="min-h-[80px]"
                      placeholder="Mensagem enviada quando fora do horário..."
                    />
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2 flex items-center gap-2">
                      <Info className="w-4 h-4" />
                      Variáveis Disponíveis
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {['{{customer_name}}', '{{company_name}}', '{{agent_name}}', '{{team_name}}', '{{timezone}}', '{{business_hours}}', '{{policies}}'].map(v => (
                        <Badge key={v} variant="secondary" className="font-mono text-xs">
                          {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* SCHEDULE TAB */}
            <TabsContent value="schedule" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Configurações Globais de Horário</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Fuso Horário</Label>
                      <Select
                        value={settings?.timezone || 'America/Recife'}
                        onValueChange={(v) => settings && setSettings({ ...settings, timezone: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map(tz => (
                            <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Anti-Spam (segundos)</Label>
                      <Input
                        type="number"
                        value={settings?.anti_spam_seconds || 5}
                        onChange={(e) => settings && setSettings({ ...settings, anti_spam_seconds: parseInt(e.target.value) || 5 })}
                        min={0}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Máx. msgs/hora por conversa</Label>
                      <Input
                        type="number"
                        value={settings?.max_messages_per_hour || 6}
                        onChange={(e) => settings && setSettings({ ...settings, max_messages_per_hour: parseInt(e.target.value) || 6 })}
                        min={1}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Pausa quando cliente pede humano (horas)</Label>
                    <Input
                      type="number"
                      value={settings?.human_request_pause_hours || 2}
                      onChange={(e) => settings && setSettings({ ...settings, human_request_pause_hours: parseInt(e.target.value) || 2 })}
                      min={1}
                      className="w-32"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Configurações por Equipe</CardTitle>
                      <CardDescription>Horários e regras específicas por equipe</CardDescription>
                    </div>
                    <Button onClick={() => setTeamDialogOpen(true)} disabled={teams.length === 0}>
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar Equipe
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {teamSettings.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      Nenhuma configuração de equipe. As regras globais serão usadas.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {teamSettings.map(ts => (
                        <div key={ts.id} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex items-center gap-4">
                            <Switch
                              checked={ts.enabled}
                              onCheckedChange={async (checked) => {
                                await supabase
                                  .from('ai_team_settings')
                                  .update({ enabled: checked })
                                  .eq('id', ts.id);
                                fetchData();
                              }}
                            />
                            <div>
                              <p className="font-medium">{ts.teams?.name || 'Equipe'}</p>
                              <p className="text-sm text-muted-foreground">
                                {ts.prompt_override ? 'Prompt personalizado' : 'Usando prompt global'}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setEditingTeamSetting(ts);
                                setTeamDialogOpen(true);
                              }}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={async () => {
                                await supabase.from('ai_team_settings').delete().eq('id', ts.id);
                                fetchData();
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* PROVIDERS TAB */}
            <TabsContent value="providers" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Provedores de IA</CardTitle>
                      <CardDescription>Configure os provedores de IA disponíveis. Apenas um pode estar ativo por vez.</CardDescription>
                    </div>
                    <Button onClick={() => handleOpenProviderDialog()}>
                      <Plus className="w-4 h-4 mr-2" />
                      Adicionar Provedor
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {providers.map(provider => (
                      <div key={provider.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <Switch
                            checked={provider.active}
                            onCheckedChange={() => handleToggleProviderActive(provider)}
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium capitalize">{provider.provider}</p>
                              {provider.active && <Badge variant="default">Ativo</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground font-mono">{provider.model}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-sm text-muted-foreground">
                            Temp: {provider.temperature} | Tokens: {provider.max_tokens}
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => handleOpenProviderDialog(provider)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteProvider(provider.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {providers.length === 0 && (
                      <p className="text-muted-foreground text-center py-8">
                        Nenhum provedor configurado. Adicione um para usar a IA.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* CONTEXT TAB */}
            <TabsContent value="context" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Memória de Conversa</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Mensagens anteriores para contexto</Label>
                      <Input
                        type="number"
                        value={settings?.memory_message_count || 20}
                        onChange={(e) => settings && setSettings({ ...settings, memory_message_count: parseInt(e.target.value) || 20 })}
                        min={5}
                        max={50}
                      />
                      <p className="text-xs text-muted-foreground">
                        Quantidade de mensagens da conversa enviadas junto com cada pergunta
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={settings?.enable_auto_summary || false}
                          onCheckedChange={(checked) => settings && setSettings({ ...settings, enable_auto_summary: checked })}
                        />
                        <Label>Resumo automático</Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Gera resumo da conversa para contexto (em desenvolvimento)
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Políticas de Negócio</CardTitle>
                  <CardDescription>
                    Configure informações que a IA pode usar nas respostas (JSON)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={JSON.stringify(settings?.policies_json || {}, null, 2)}
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        settings && setSettings({ ...settings, policies_json: parsed });
                      } catch {
                        // Invalid JSON, ignore
                      }
                    }}
                    className="font-mono text-sm min-h-[200px]"
                    placeholder='{"sla": "24h", "garantia": "30 dias"}'
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* TEST TAB */}
            <TabsContent value="test" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Playground de Teste</CardTitle>
                  <CardDescription>Teste a IA antes de ativar em produção</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Equipe (opcional)</Label>
                      <Select value={testTeamId} onValueChange={setTestTeamId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Usar configuração global" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Global</SelectItem>
                          {teams.map(team => (
                            <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Provedor (opcional)</Label>
                      <Select value={testProviderId} onValueChange={setTestProviderId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Usar provedor ativo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Ativo</SelectItem>
                          {providers.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.provider} - {p.model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Mensagem do Cliente</Label>
                    <Textarea
                      value={testMessage}
                      onChange={(e) => setTestMessage(e.target.value)}
                      placeholder="Digite uma mensagem simulando um cliente..."
                      className="min-h-[100px]"
                    />
                  </div>

                  <Button onClick={handleTestAI} disabled={testing || !testMessage.trim()}>
                    {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                    Gerar Resposta
                  </Button>

                  {testResult && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground">Provedor</p>
                          <p className="font-medium capitalize">{testResult.provider}</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground">Modelo</p>
                          <p className="font-medium text-sm">{testResult.model}</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground">Tokens</p>
                          <p className="font-medium">{testResult.tokens_in} → {testResult.tokens_out}</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="text-xs text-muted-foreground">Latência</p>
                          <p className="font-medium">{testResult.latency_ms}ms</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Resposta da IA</Label>
                        <div className="p-4 bg-primary/10 rounded-lg whitespace-pre-wrap">
                          {testResult.response}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Prompt Renderizado</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard.writeText(testResult.prompt_rendered)}
                          >
                            <Copy className="w-4 h-4 mr-2" />
                            Copiar
                          </Button>
                        </div>
                        <ScrollArea className="h-[200px] border rounded-lg p-4">
                          <pre className="text-xs whitespace-pre-wrap">{testResult.prompt_rendered}</pre>
                        </ScrollArea>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* LOGS TAB */}
            <TabsContent value="logs" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <CardTitle>Logs de IA</CardTitle>
                      <CardDescription>Histórico de chamadas e respostas</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Select value={logsFilter.status} onValueChange={(v) => setLogsFilter({ ...logsFilter, status: v })}>
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="success">Sucesso</SelectItem>
                          <SelectItem value="error">Erro</SelectItem>
                          <SelectItem value="skipped">Ignorado</SelectItem>
                        </SelectContent>
                      </Select>

                      <Select value={logsFilter.provider} onValueChange={(v) => setLogsFilter({ ...logsFilter, provider: v })}>
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Provedor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos</SelectItem>
                          <SelectItem value="lovable">Lovable</SelectItem>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="gemini">Gemini</SelectItem>
                          <SelectItem value="system">Sistema</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Provedor</TableHead>
                          <TableHead>Modelo</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Latência</TableHead>
                          <TableHead>Resposta</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLogs.map(log => (
                          <TableRow key={log.id}>
                            <TableCell className="text-sm">
                              {format(new Date(log.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={log.status === 'success' ? 'default' : log.status === 'error' ? 'destructive' : 'secondary'}>
                                {log.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="capitalize">{log.provider}</TableCell>
                            <TableCell className="font-mono text-xs">{log.model}</TableCell>
                            <TableCell className="text-sm">
                              {log.tokens_in && log.tokens_out ? `${log.tokens_in}/${log.tokens_out}` : '-'}
                            </TableCell>
                            <TableCell className="text-sm">
                              {log.latency_ms ? `${log.latency_ms}ms` : '-'}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-sm">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">
                                      {log.error_message || log.output_text?.substring(0, 50) || '-'}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[400px]">
                                    <p className="whitespace-pre-wrap">
                                      {log.error_message || log.output_text || 'Sem conteúdo'}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredLogs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                              Nenhum log encontrado
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Provider Dialog */}
        <Dialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editingProvider ? 'Editar Provedor' : 'Novo Provedor'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Provedor</Label>
                <Select
                  value={providerForm.provider}
                  onValueChange={(v) => {
                    const models = AVAILABLE_MODELS[v as keyof typeof AVAILABLE_MODELS];
                    setProviderForm({
                      ...providerForm,
                      provider: v,
                      model: models?.[0]?.value || '',
                      key_ref: v === 'lovable' ? 'LOVABLE_API_KEY' : '',
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lovable">Lovable AI (Recomendado)</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Google Gemini</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Modelo</Label>
                <Select
                  value={providerForm.model}
                  onValueChange={(v) => setProviderForm({ ...providerForm, model: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_MODELS[providerForm.provider as keyof typeof AVAILABLE_MODELS]?.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {providerForm.provider !== 'lovable' && (
                <div className="space-y-2">
                  <Label>Nome do Secret (env var)</Label>
                  <Input
                    value={providerForm.key_ref}
                    onChange={(e) => setProviderForm({ ...providerForm, key_ref: e.target.value })}
                    placeholder="OPENAI_API_KEY"
                  />
                  <p className="text-xs text-muted-foreground">
                    Nome da variável de ambiente com a chave da API
                  </p>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Temperatura</Label>
                  <Input
                    type="number"
                    value={providerForm.temperature}
                    onChange={(e) => setProviderForm({ ...providerForm, temperature: parseFloat(e.target.value) || 0.7 })}
                    min={0}
                    max={2}
                    step={0.1}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input
                    type="number"
                    value={providerForm.max_tokens}
                    onChange={(e) => setProviderForm({ ...providerForm, max_tokens: parseInt(e.target.value) || 1024 })}
                    min={100}
                    max={4096}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Top P</Label>
                  <Input
                    type="number"
                    value={providerForm.top_p}
                    onChange={(e) => setProviderForm({ ...providerForm, top_p: parseFloat(e.target.value) || 1.0 })}
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={providerForm.active}
                  onCheckedChange={(checked) => setProviderForm({ ...providerForm, active: checked })}
                />
                <Label>Ativar este provedor</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setProviderDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveProvider}>
                {editingProvider ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Team Settings Dialog */}
        <Dialog open={teamDialogOpen} onOpenChange={(open) => {
          setTeamDialogOpen(open);
          if (!open) setEditingTeamSetting(null);
        }}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingTeamSetting ? 'Editar Configuração de Equipe' : 'Nova Configuração de Equipe'}
              </DialogTitle>
            </DialogHeader>
            <TeamSettingsForm
              teams={teams.filter(t => !teamSettings.find(ts => ts.team_id === t.id) || editingTeamSetting?.team_id === t.id)}
              existing={editingTeamSetting}
              onSave={async (data) => {
                try {
                  const updateData = {
                    team_id: data.team_id,
                    enabled: data.enabled,
                    prompt_override: data.prompt_override,
                    schedule_json: JSON.parse(JSON.stringify(data.schedule_json)) as Json,
                  };
                  if (editingTeamSetting) {
                    await supabase
                      .from('ai_team_settings')
                      .update(updateData)
                      .eq('id', editingTeamSetting.id);
                  } else {
                    await supabase
                      .from('ai_team_settings')
                      .insert({ ...updateData, team_id: data.team_id! });
                  }
                  toast({ title: 'Configuração salva!' });
                  setTeamDialogOpen(false);
                  setEditingTeamSetting(null);
                  fetchData();
                } catch (error) {
                  toast({ variant: 'destructive', title: 'Erro ao salvar' });
                }
              }}
              onCancel={() => {
                setTeamDialogOpen(false);
                setEditingTeamSetting(null);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

// Team Settings Form Component
function TeamSettingsForm({ 
  teams, 
  existing,
  onSave, 
  onCancel 
}: { 
  teams: Team[];
  existing: AITeamSettings | null;
  onSave: (data: Partial<AITeamSettings>) => void;
  onCancel: () => void;
}) {
  const [teamId, setTeamId] = useState(existing?.team_id || '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [promptOverride, setPromptOverride] = useState(existing?.prompt_override || '');
  const [schedule, setSchedule] = useState<ScheduleJson>(
    existing?.schedule_json || {
      days: {
        monday: { enabled: true, start: '08:00', end: '18:00' },
        tuesday: { enabled: true, start: '08:00', end: '18:00' },
        wednesday: { enabled: true, start: '08:00', end: '18:00' },
        thursday: { enabled: true, start: '08:00', end: '18:00' },
        friday: { enabled: true, start: '08:00', end: '18:00' },
        saturday: { enabled: true, start: '08:00', end: '12:00' },
        sunday: { enabled: false, start: '08:00', end: '12:00' },
      },
      exceptions: [],
    }
  );

  return (
    <div className="space-y-4">
      {!existing && (
        <div className="space-y-2">
          <Label>Equipe</Label>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione uma equipe" />
            </SelectTrigger>
            <SelectContent>
              {teams.map(team => (
                <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <Label>IA ativa para esta equipe</Label>
      </div>

      <div className="space-y-2">
        <Label>Prompt personalizado (opcional)</Label>
        <Textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          placeholder="Deixe vazio para usar o prompt global..."
          className="min-h-[100px]"
        />
      </div>

      <div className="space-y-2">
        <Label>Horários</Label>
        <div className="space-y-2 max-h-[200px] overflow-auto">
          {DAYS_OF_WEEK.map(day => (
            <div key={day.key} className="flex items-center gap-2">
              <Switch
                checked={schedule.days[day.key]?.enabled || false}
                onCheckedChange={(checked) => {
                  setSchedule({
                    ...schedule,
                    days: {
                      ...schedule.days,
                      [day.key]: { ...schedule.days[day.key], enabled: checked },
                    },
                  });
                }}
              />
              <span className="w-20 text-sm">{day.label}</span>
              <Input
                type="time"
                value={schedule.days[day.key]?.start || '08:00'}
                onChange={(e) => {
                  setSchedule({
                    ...schedule,
                    days: {
                      ...schedule.days,
                      [day.key]: { ...schedule.days[day.key], start: e.target.value },
                    },
                  });
                }}
                className="w-28"
                disabled={!schedule.days[day.key]?.enabled}
              />
              <span className="text-sm">até</span>
              <Input
                type="time"
                value={schedule.days[day.key]?.end || '18:00'}
                onChange={(e) => {
                  setSchedule({
                    ...schedule,
                    days: {
                      ...schedule.days,
                      [day.key]: { ...schedule.days[day.key], end: e.target.value },
                    },
                  });
                }}
                className="w-28"
                disabled={!schedule.days[day.key]?.enabled}
              />
            </div>
          ))}
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button 
          onClick={() => onSave({
            team_id: teamId || existing?.team_id,
            enabled,
            prompt_override: promptOverride || null,
            schedule_json: schedule as unknown as ScheduleJson,
          } as Partial<AITeamSettings>)}
          disabled={!existing && !teamId}
        >
          Salvar
        </Button>
      </DialogFooter>
    </div>
  );
}
