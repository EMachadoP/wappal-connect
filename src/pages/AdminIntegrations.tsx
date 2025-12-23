import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Save, Loader2, Plus, Trash2, Pencil, RefreshCw, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface IntegrationsSettings {
  id: string;
  whatsapp_group_id: string | null;
  whatsapp_notifications_enabled: boolean;
  asana_enabled: boolean;
  asana_project_id: string | null;
  asana_section_operacional: string | null;
  asana_section_financeiro: string | null;
  asana_section_support: string | null;
  asana_section_admin: string | null;
}

interface Agent {
  id: string;
  profile_id: string | null;
  name: string;
  phone: string | null;
  role: string;
  can_close_protocols: boolean;
  is_active: boolean;
}

export default function AdminIntegrationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<IntegrationsSettings | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  
  // Agent dialog
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [agentForm, setAgentForm] = useState({
    name: '',
    phone: '',
    role: 'agent',
    can_close_protocols: false,
    is_active: true,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch settings
      const { data: settingsData } = await supabase
        .from('integrations_settings')
        .select('*')
        .limit(1)
        .single();
      
      if (settingsData) {
        setSettings(settingsData as IntegrationsSettings);
      }

      // Fetch agents
      const { data: agentsData } = await supabase
        .from('agents')
        .select('*')
        .order('name');
      
      if (agentsData) {
        setAgents(agentsData as Agent[]);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
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
        .from('integrations_settings')
        .update({
          whatsapp_group_id: settings.whatsapp_group_id,
          whatsapp_notifications_enabled: settings.whatsapp_notifications_enabled,
          asana_enabled: settings.asana_enabled,
          asana_project_id: settings.asana_project_id,
          asana_section_operacional: settings.asana_section_operacional,
          asana_section_financeiro: settings.asana_section_financeiro,
          asana_section_support: settings.asana_section_support,
          asana_section_admin: settings.asana_section_admin,
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

  const handleOpenAgentDialog = (agent?: Agent) => {
    if (agent) {
      setEditingAgent(agent);
      setAgentForm({
        name: agent.name,
        phone: agent.phone || '',
        role: agent.role,
        can_close_protocols: agent.can_close_protocols,
        is_active: agent.is_active,
      });
    } else {
      setEditingAgent(null);
      setAgentForm({
        name: '',
        phone: '',
        role: 'agent',
        can_close_protocols: false,
        is_active: true,
      });
    }
    setAgentDialogOpen(true);
  };

  const handleSaveAgent = async () => {
    if (!agentForm.name) {
      toast({ variant: 'destructive', title: 'Nome é obrigatório' });
      return;
    }

    try {
      if (editingAgent) {
        const { error } = await supabase
          .from('agents')
          .update({
            name: agentForm.name,
            phone: agentForm.phone || null,
            role: agentForm.role,
            can_close_protocols: agentForm.can_close_protocols,
            is_active: agentForm.is_active,
          })
          .eq('id', editingAgent.id);

        if (error) throw error;
        toast({ title: 'Agente atualizado!' });
      } else {
        const { error } = await supabase
          .from('agents')
          .insert({
            name: agentForm.name,
            phone: agentForm.phone || null,
            role: agentForm.role,
            can_close_protocols: agentForm.can_close_protocols,
            is_active: agentForm.is_active,
          });

        if (error) throw error;
        toast({ title: 'Agente criado!' });
      }

      setAgentDialogOpen(false);
      fetchData();
    } catch (error) {
      console.error('Error saving agent:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao salvar agente' });
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir este agente?')) return;

    try {
      const { error } = await supabase
        .from('agents')
        .delete()
        .eq('id', id);

      if (error) throw error;
      toast({ title: 'Agente removido!' });
      fetchData();
    } catch (error) {
      console.error('Error deleting agent:', error);
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao remover' });
    }
  };

  const handleToggleAgentPermission = async (agent: Agent) => {
    try {
      const { error } = await supabase
        .from('agents')
        .update({ can_close_protocols: !agent.can_close_protocols })
        .eq('id', agent.id);

      if (error) throw error;
      toast({ title: agent.can_close_protocols ? 'Permissão removida' : 'Permissão concedida' });
      fetchData();
    } catch (error) {
      console.error('Error updating agent:', error);
      toast({ variant: 'destructive', title: 'Erro' });
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
            <h1 className="text-2xl font-bold">Integrações</h1>
            <p className="text-muted-foreground">Configure WhatsApp, Asana e agentes autorizados</p>
          </div>
          <Button onClick={handleSaveSettings} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="whatsapp" className="space-y-6">
            <TabsList>
              <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
              <TabsTrigger value="asana">Asana</TabsTrigger>
              <TabsTrigger value="agents">Agentes</TabsTrigger>
            </TabsList>

            {/* WHATSAPP TAB */}
            <TabsContent value="whatsapp" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Grupo de Notificações</CardTitle>
                  <CardDescription>
                    Configure o grupo WhatsApp onde os protocolos serão notificados
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Switch
                      checked={settings?.whatsapp_notifications_enabled || false}
                      onCheckedChange={(checked) => settings && setSettings({ ...settings, whatsapp_notifications_enabled: checked })}
                    />
                    <Label>Ativar notificações no grupo</Label>
                  </div>

                  <div className="space-y-2">
                    <Label>ID do Grupo WhatsApp</Label>
                    <Input
                      placeholder="5511999999999-1234567890@g.us"
                      value={settings?.whatsapp_group_id || ''}
                      onChange={(e) => settings && setSettings({ ...settings, whatsapp_group_id: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      O ID do grupo pode ser obtido nas configurações do Z-API ou na URL do grupo
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ASANA TAB */}
            <TabsContent value="asana" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Integração Asana</CardTitle>
                  <CardDescription>
                    Configure a criação automática de tarefas no Asana para cada protocolo
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-4">
                    <Switch
                      checked={settings?.asana_enabled || false}
                      onCheckedChange={(checked) => settings && setSettings({ ...settings, asana_enabled: checked })}
                    />
                    <Label>Ativar integração Asana</Label>
                  </div>

                  <div className="space-y-2">
                    <Label>Project ID</Label>
                    <Input
                      placeholder="1234567890123456"
                      value={settings?.asana_project_id || ''}
                      onChange={(e) => settings && setSettings({ ...settings, asana_project_id: e.target.value })}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Section ID - Operacional</Label>
                      <Input
                        placeholder="1234567890123456"
                        value={settings?.asana_section_operacional || ''}
                        onChange={(e) => settings && setSettings({ ...settings, asana_section_operacional: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Section ID - Financeiro</Label>
                      <Input
                        placeholder="1234567890123456"
                        value={settings?.asana_section_financeiro || ''}
                        onChange={(e) => settings && setSettings({ ...settings, asana_section_financeiro: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Section ID - Suporte</Label>
                      <Input
                        placeholder="1234567890123456"
                        value={settings?.asana_section_support || ''}
                        onChange={(e) => settings && setSettings({ ...settings, asana_section_support: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Section ID - Administrativo</Label>
                      <Input
                        placeholder="1234567890123456"
                        value={settings?.asana_section_admin || ''}
                        onChange={(e) => settings && setSettings({ ...settings, asana_section_admin: e.target.value })}
                      />
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Os Section IDs são opcionais. Se preenchidos, as tarefas serão criadas na seção correspondente à categoria do protocolo.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* AGENTS TAB */}
            <TabsContent value="agents" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Agentes Autorizados</CardTitle>
                      <CardDescription>
                        Gerencie quem pode encerrar protocolos pelo grupo WhatsApp
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={fetchData}>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Atualizar
                      </Button>
                      <Button size="sm" onClick={() => handleOpenAgentDialog()}>
                        <Plus className="w-4 h-4 mr-2" />
                        Novo Agente
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Telefone</TableHead>
                        <TableHead>Função</TableHead>
                        <TableHead>Pode Encerrar</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agents.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground">
                            Nenhum agente cadastrado
                          </TableCell>
                        </TableRow>
                      ) : (
                        agents.map((agent) => (
                          <TableRow key={agent.id}>
                            <TableCell className="font-medium">{agent.name}</TableCell>
                            <TableCell>{agent.phone || '-'}</TableCell>
                            <TableCell className="capitalize">{agent.role}</TableCell>
                            <TableCell>
                              <Button
                                variant={agent.can_close_protocols ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => handleToggleAgentPermission(agent)}
                              >
                                {agent.can_close_protocols ? (
                                  <><Check className="w-4 h-4 mr-1" /> Sim</>
                                ) : (
                                  <><X className="w-4 h-4 mr-1" /> Não</>
                                )}
                              </Button>
                            </TableCell>
                            <TableCell>
                              <span className={`px-2 py-1 rounded text-xs ${agent.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'}`}>
                                {agent.is_active ? 'Ativo' : 'Inativo'}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => handleOpenAgentDialog(agent)}>
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDeleteAgent(agent.id)}>
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Agent Dialog */}
        <Dialog open={agentDialogOpen} onOpenChange={setAgentDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingAgent ? 'Editar Agente' : 'Novo Agente'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input
                  placeholder="Nome do agente"
                  value={agentForm.name}
                  onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  placeholder="5511999999999"
                  value={agentForm.phone}
                  onChange={(e) => setAgentForm({ ...agentForm, phone: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Apenas números, sem espaços ou caracteres especiais
                </p>
              </div>
              <div className="space-y-2">
                <Label>Função</Label>
                <Select
                  value={agentForm.role}
                  onValueChange={(value) => setAgentForm({ ...agentForm, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Gerente</SelectItem>
                    <SelectItem value="tech">Técnico</SelectItem>
                    <SelectItem value="agent">Agente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <Switch
                  checked={agentForm.can_close_protocols}
                  onCheckedChange={(checked) => setAgentForm({ ...agentForm, can_close_protocols: checked })}
                />
                <Label>Pode encerrar protocolos pelo grupo</Label>
              </div>
              <div className="flex items-center gap-4">
                <Switch
                  checked={agentForm.is_active}
                  onCheckedChange={(checked) => setAgentForm({ ...agentForm, is_active: checked })}
                />
                <Label>Agente ativo</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAgentDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveAgent}>
                {editingAgent ? 'Atualizar' : 'Criar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
