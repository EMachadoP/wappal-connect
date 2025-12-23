import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Trash2, RefreshCw, History, Pencil, UserPlus, Shield, ShieldOff, Users, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';

interface Profile {
  id: string;
  email: string;
  name: string;
  is_active: boolean;
  team_id: string | null;
  teams?: { name: string } | null;
}

interface Team {
  id: string;
  name: string;
  description: string | null;
}

interface LabelType {
  id: string;
  name: string;
  color: string;
}

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [agents, setAgents] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [labels, setLabels] = useState<LabelType[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);

  // Dialog states
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<Profile | Team | LabelType | null>(null);

  // Form states - Team
  const [teamName, setTeamName] = useState('');
  const [teamDescription, setTeamDescription] = useState('');

  // Form states - Label
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('#3B82F6');

  // Form states - Agent (edit)
  const [agentName, setAgentName] = useState('');
  const [agentEmail, setAgentEmail] = useState('');
  const [agentTeamId, setAgentTeamId] = useState<string>('none');
  const [agentIsActive, setAgentIsActive] = useState(true);

  // Form states - New Agent
  const [newAgentEmail, setNewAgentEmail] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentPassword, setNewAgentPassword] = useState('');
  const [newAgentTeamId, setNewAgentTeamId] = useState<string>('none');
  const [creatingAgent, setCreatingAgent] = useState(false);

  const fetchData = async () => {
    // Fetch agents
    const { data: agentsData } = await supabase
      .from('profiles')
      .select('*, teams(name)')
      .order('name');

    if (agentsData) {
      setAgents(agentsData);

      // Fetch roles for each agent
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesData) {
        const rolesMap: Record<string, string[]> = {};
        rolesData.forEach((r) => {
          if (!rolesMap[r.user_id]) rolesMap[r.user_id] = [];
          rolesMap[r.user_id].push(r.role);
        });
        setUserRoles(rolesMap);
      }
    }

    // Fetch teams
    const { data: teamsData } = await supabase
      .from('teams')
      .select('*')
      .order('name');

    if (teamsData) setTeams(teamsData);

    // Fetch labels
    const { data: labelsData } = await supabase
      .from('labels')
      .select('*')
      .order('name');

    if (labelsData) setLabels(labelsData);

    setLoading(false);
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchData();
  }, [user, isAdmin]);

  // Team handlers
  const handleOpenTeamDialog = (team?: Team) => {
    if (team) {
      setEditingItem(team);
      setTeamName(team.name);
      setTeamDescription(team.description || '');
    } else {
      setEditingItem(null);
      setTeamName('');
      setTeamDescription('');
    }
    setDialogOpen('team');
  };

  const handleSaveTeam = async () => {
    if (!teamName.trim()) return;

    if (editingItem) {
      const { error } = await supabase
        .from('teams')
        .update({
          name: teamName.trim(),
          description: teamDescription.trim() || null,
        })
        .eq('id', editingItem.id);

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: 'Equipe atualizada!' });
        setDialogOpen(null);
        fetchData();
      }
    } else {
      const { error } = await supabase.from('teams').insert({
        name: teamName.trim(),
        description: teamDescription.trim() || null,
      });

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: 'Equipe criada!' });
        setDialogOpen(null);
        fetchData();
      }
    }
  };

  const handleDeleteTeam = async (id: string) => {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      setTeams((prev) => prev.filter((t) => t.id !== id));
      toast({ title: 'Equipe removida!' });
    }
  };

  // Label handlers
  const handleOpenLabelDialog = (label?: LabelType) => {
    if (label) {
      setEditingItem(label);
      setLabelName(label.name);
      setLabelColor(label.color);
    } else {
      setEditingItem(null);
      setLabelName('');
      setLabelColor('#3B82F6');
    }
    setDialogOpen('label');
  };

  const handleSaveLabel = async () => {
    if (!labelName.trim()) return;

    if (editingItem) {
      const { error } = await supabase
        .from('labels')
        .update({
          name: labelName.trim(),
          color: labelColor,
        })
        .eq('id', editingItem.id);

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: 'Etiqueta atualizada!' });
        setDialogOpen(null);
        fetchData();
      }
    } else {
      const { error } = await supabase.from('labels').insert({
        name: labelName.trim(),
        color: labelColor,
      });

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: 'Etiqueta criada!' });
        setDialogOpen(null);
        fetchData();
      }
    }
  };

  const handleDeleteLabel = async (id: string) => {
    const { error } = await supabase.from('labels').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      setLabels((prev) => prev.filter((l) => l.id !== id));
      toast({ title: 'Etiqueta removida!' });
    }
  };

  // Agent handlers
  const handleOpenAgentDialog = (agent?: Profile) => {
    if (agent) {
      setEditingItem(agent);
      setAgentName(agent.name);
      setAgentEmail(agent.email);
      setAgentTeamId(agent.team_id || 'none');
      setAgentIsActive(agent.is_active);
    } else {
      setEditingItem(null);
      setAgentName('');
      setAgentEmail('');
      setAgentTeamId('none');
      setAgentIsActive(true);
    }
    setDialogOpen('agent');
  };

  const handleSaveAgent = async () => {
    if (!agentName.trim()) return;

    if (editingItem) {
      const { error } = await supabase
        .from('profiles')
        .update({
          name: agentName.trim(),
          team_id: agentTeamId === 'none' ? null : agentTeamId,
          is_active: agentIsActive,
        })
        .eq('id', editingItem.id);

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: 'Agente atualizado!' });
        setDialogOpen(null);
        fetchData();
      }
    }
  };

  const handleOpenNewAgentDialog = () => {
    setNewAgentEmail('');
    setNewAgentName('');
    setNewAgentPassword('');
    setNewAgentTeamId('none');
    setDialogOpen('new-agent');
  };

  const handleCreateAgent = async () => {
    if (!newAgentEmail.trim() || !newAgentName.trim() || !newAgentPassword.trim()) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Preencha todos os campos obrigatórios' });
      return;
    }

    // Strong password validation
    const hasMinLength = newAgentPassword.length >= 8;
    const hasLowercase = /[a-z]/.test(newAgentPassword);
    const hasUppercase = /[A-Z]/.test(newAgentPassword);
    const hasNumber = /[0-9]/.test(newAgentPassword);

    if (!hasMinLength || !hasLowercase || !hasUppercase || !hasNumber) {
      toast({ 
        variant: 'destructive', 
        title: 'Senha fraca', 
        description: 'A senha deve ter pelo menos 8 caracteres, incluindo letras maiúsculas, minúsculas e números.' 
      });
      return;
    }

    setCreatingAgent(true);
    try {
      // Create user via edge function (doesn't log in)
      const { data, error } = await supabase.functions.invoke('create-agent', {
        body: {
          email: newAgentEmail.trim(),
          password: newAgentPassword,
          name: newAgentName.trim(),
          team_id: newAgentTeamId !== 'none' ? newAgentTeamId : null,
        },
      });

      if (error) {
        toast({ variant: 'destructive', title: 'Erro ao criar agente', description: error.message });
        return;
      }

      if (data?.error) {
        toast({ variant: 'destructive', title: 'Erro ao criar agente', description: data.error });
        return;
      }

      toast({ title: 'Agente criado com sucesso!', description: 'O novo agente pode fazer login com o email e senha informados.' });
      setDialogOpen(null);
      fetchData();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Erro', description: 'Falha ao criar agente' });
    } finally {
      setCreatingAgent(false);
    }
  };

  const handleToggleAgentRole = async (agentId: string, role: 'admin' | 'agent', hasRole: boolean) => {
    if (hasRole) {
      // Remove role
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', agentId)
        .eq('role', role);

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: `Papel ${role} removido!` });
        fetchData();
      }
    } else {
      // Add role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: agentId, role });

      if (error) {
        toast({ variant: 'destructive', title: 'Erro', description: error.message });
      } else {
        toast({ title: `Papel ${role} adicionado!` });
        fetchData();
      }
    }
  };

  const handleToggleAgentActive = async (agent: Profile) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !agent.is_active })
      .eq('id', agent.id);

    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      toast({ title: agent.is_active ? 'Agente desativado!' : 'Agente ativado!' });
      fetchData();
    }
  };

  // Sync handlers
  const handleSyncContacts = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-sync-contacts');
      
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro na sincronização',
          description: error.message,
        });
      } else if (data) {
        toast({
          title: 'Sincronização concluída!',
          description: `${data.created} criados, ${data.updated} atualizados, ${data.skipped} ignorados`,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Falha ao conectar com o serviço de sincronização',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncHistory = async () => {
    setSyncingHistory(true);
    try {
      const { data, error } = await supabase.functions.invoke('zapi-sync-history', {
        body: { pageSize: 50, maxPages: 10 }
      });
      
      if (error) {
        toast({
          variant: 'destructive',
          title: 'Erro na sincronização',
          description: error.message,
        });
      } else if (data) {
        toast({
          title: 'Sincronização de histórico concluída!',
          description: data.message || `${data.created} novos, ${data.updated} atualizados`,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Erro',
        description: 'Falha ao conectar com o serviço de sincronização de histórico',
      });
    } finally {
      setSyncingHistory(false);
    }
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
          <h1 className="text-2xl font-bold">Administração</h1>
          <div className="flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={() => navigate('/admin/duplicates')}
            >
              <Copy className="w-4 h-4" />
              Duplicados
            </Button>
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={handleSyncHistory}
              disabled={syncingHistory}
            >
              <History className={`w-4 h-4 ${syncingHistory ? 'animate-spin' : ''}`} />
              {syncingHistory ? 'Sincronizando...' : 'Sincronizar Histórico'}
            </Button>
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={handleSyncContacts}
              disabled={syncing}
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sincronizando...' : 'Sincronizar Contatos'}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : (
          <Tabs defaultValue="agents">
            <TabsList>
              <TabsTrigger value="agents">Agentes</TabsTrigger>
              <TabsTrigger value="teams">Equipes</TabsTrigger>
              <TabsTrigger value="labels">Etiquetas</TabsTrigger>
            </TabsList>

            {/* AGENTS TAB */}
            <TabsContent value="agents" className="mt-6">
              <div className="flex justify-end mb-4">
                <Button className="gap-2" onClick={handleOpenNewAgentDialog}>
                  <Plus className="w-4 h-4" />
                  Adicionar Agente
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.map((agent) => (
                  <Card key={agent.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg">{agent.name}</CardTitle>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenAgentDialog(agent)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">{agent.email}</p>
                      
                      <div className="flex flex-wrap gap-2">
                        {userRoles[agent.id]?.includes('admin') && (
                          <Badge>Admin</Badge>
                        )}
                        {userRoles[agent.id]?.includes('agent') && (
                          <Badge variant="secondary">Agente</Badge>
                        )}
                        {agent.is_active ? (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive">
                            Inativo
                          </Badge>
                        )}
                      </div>
                      
                      {agent.teams && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {agent.teams.name}
                        </p>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button
                          variant={userRoles[agent.id]?.includes('admin') ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1"
                          onClick={() => handleToggleAgentRole(agent.id, 'admin', userRoles[agent.id]?.includes('admin') || false)}
                        >
                          <Shield className="w-3 h-3 mr-1" />
                          Admin
                        </Button>
                        <Button
                          variant={userRoles[agent.id]?.includes('agent') ? 'secondary' : 'outline'}
                          size="sm"
                          className="flex-1"
                          onClick={() => handleToggleAgentRole(agent.id, 'agent', userRoles[agent.id]?.includes('agent') || false)}
                        >
                          <UserPlus className="w-3 h-3 mr-1" />
                          Agente
                        </Button>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => handleToggleAgentActive(agent)}
                      >
                        {agent.is_active ? (
                          <>
                            <ShieldOff className="w-3 h-3 mr-1" />
                            Desativar
                          </>
                        ) : (
                          <>
                            <Shield className="w-3 h-3 mr-1" />
                            Ativar
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* TEAMS TAB */}
            <TabsContent value="teams" className="mt-6">
              <div className="flex justify-end mb-4">
                <Button className="gap-2" onClick={() => handleOpenTeamDialog()}>
                  <Plus className="w-4 h-4" />
                  Adicionar Equipe
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teams.map((team) => (
                  <Card key={team.id}>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-lg">{team.name}</CardTitle>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenTeamDialog(team)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir equipe?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação não pode ser desfeita. Os agentes desta equipe ficarão sem equipe atribuída.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteTeam(team.id)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {team.description || 'Sem descrição'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {agents.filter(a => a.team_id === team.id).length} membro(s)
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            {/* LABELS TAB */}
            <TabsContent value="labels" className="mt-6">
              <div className="flex justify-end mb-4">
                <Button className="gap-2" onClick={() => handleOpenLabelDialog()}>
                  <Plus className="w-4 h-4" />
                  Adicionar Etiqueta
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {labels.map((label) => (
                  <Card key={label.id}>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                        <CardTitle className="text-lg">{label.name}</CardTitle>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenLabelDialog(label)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Esta ação não pode ser desfeita. A etiqueta será removida de todas as conversas.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteLabel(label.id)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* TEAM DIALOG */}
        <Dialog open={dialogOpen === 'team'} onOpenChange={(open) => !open && setDialogOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Editar Equipe' : 'Nova Equipe'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">Nome</Label>
                <Input
                  id="team-name"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder="Nome da equipe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-desc">Descrição</Label>
                <Input
                  id="team-desc"
                  value={teamDescription}
                  onChange={(e) => setTeamDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveTeam}>
                  {editingItem ? 'Salvar' : 'Criar'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* LABEL DIALOG */}
        <Dialog open={dialogOpen === 'label'} onOpenChange={(open) => !open && setDialogOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Editar Etiqueta' : 'Nova Etiqueta'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="label-name">Nome</Label>
                <Input
                  id="label-name"
                  value={labelName}
                  onChange={(e) => setLabelName(e.target.value)}
                  placeholder="Nome da etiqueta"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="label-color">Cor</Label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    id="label-color"
                    value={labelColor}
                    onChange={(e) => setLabelColor(e.target.value)}
                    className="w-12 h-10 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={labelColor}
                    onChange={(e) => setLabelColor(e.target.value)}
                    placeholder="#3B82F6"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveLabel}>
                  {editingItem ? 'Salvar' : 'Criar'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* AGENT DIALOG */}
        <Dialog open={dialogOpen === 'agent'} onOpenChange={(open) => !open && setDialogOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Agente</DialogTitle>
              <DialogDescription>
                Altere as informações do agente abaixo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Nome</Label>
                <Input
                  id="agent-name"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="Nome do agente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-email">Email</Label>
                <Input
                  id="agent-email"
                  value={agentEmail}
                  disabled
                  className="bg-muted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-team">Equipe</Label>
                <Select value={agentTeamId} onValueChange={setAgentTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma equipe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem equipe</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="agent-active">Ativo</Label>
                <Switch
                  id="agent-active"
                  checked={agentIsActive}
                  onCheckedChange={setAgentIsActive}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(null)}>
                  Cancelar
                </Button>
                <Button onClick={handleSaveAgent}>
                  Salvar
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        {/* NEW AGENT DIALOG */}
        <Dialog open={dialogOpen === 'new-agent'} onOpenChange={(open) => !open && setDialogOpen(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Novo Agente</DialogTitle>
              <DialogDescription>
                Crie uma nova conta de agente. O agente poderá fazer login com as credenciais informadas.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="new-agent-name">Nome *</Label>
                <Input
                  id="new-agent-name"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="Nome completo do agente"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-agent-email">Email *</Label>
                <Input
                  id="new-agent-email"
                  type="email"
                  value={newAgentEmail}
                  onChange={(e) => setNewAgentEmail(e.target.value)}
                  placeholder="email@exemplo.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-agent-password">Senha *</Label>
                <Input
                  id="new-agent-password"
                  type="password"
                  value={newAgentPassword}
                  onChange={(e) => setNewAgentPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-agent-team">Equipe</Label>
                <Select value={newAgentTeamId} onValueChange={setNewAgentTeamId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma equipe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem equipe</SelectItem>
                    {teams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(null)} disabled={creatingAgent}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateAgent} disabled={creatingAgent}>
                  {creatingAgent ? 'Criando...' : 'Criar Agente'}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
