import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Trash2, RefreshCw, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

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

  const [agents, setAgents] = useState<Profile[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [labels, setLabels] = useState<LabelType[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);

  // Form states
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDescription, setNewTeamDescription] = useState('');
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#3B82F6');
  const [dialogOpen, setDialogOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isAdmin) return;

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

    fetchData();
  }, [user, isAdmin]);

  const handleAddTeam = async () => {
    if (!newTeamName.trim()) return;

    const { error } = await supabase.from('teams').insert({
      name: newTeamName.trim(),
      description: newTeamDescription.trim() || null,
    });

    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      toast({ title: 'Equipe criada com sucesso!' });
      setNewTeamName('');
      setNewTeamDescription('');
      setDialogOpen(null);
      // Refresh teams
      const { data } = await supabase.from('teams').select('*').order('name');
      if (data) setTeams(data);
    }
  };

  const handleAddLabel = async () => {
    if (!newLabelName.trim()) return;

    const { error } = await supabase.from('labels').insert({
      name: newLabelName.trim(),
      color: newLabelColor,
    });

    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      toast({ title: 'Etiqueta criada com sucesso!' });
      setNewLabelName('');
      setNewLabelColor('#3B82F6');
      setDialogOpen(null);
      // Refresh labels
      const { data } = await supabase.from('labels').select('*').order('name');
      if (data) setLabels(data);
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

  const handleDeleteLabel = async (id: string) => {
    const { error } = await supabase.from('labels').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
    } else {
      setLabels((prev) => prev.filter((l) => l.id !== id));
      toast({ title: 'Etiqueta removida!' });
    }
  };

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
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Administração</h1>
          <div className="flex gap-2">
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

            <TabsContent value="agents" className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {agents.map((agent) => (
                  <Card key={agent.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">{agent.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-muted-foreground">{agent.email}</p>
                      <div className="flex flex-wrap gap-2">
                        {userRoles[agent.id]?.includes('admin') && (
                          <Badge>Admin</Badge>
                        )}
                        {userRoles[agent.id]?.includes('agent') && (
                          <Badge variant="secondary">Agente</Badge>
                        )}
                        {agent.is_active ? (
                          <Badge variant="outline" className="text-success border-success">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-destructive border-destructive">
                            Inativo
                          </Badge>
                        )}
                      </div>
                      {agent.teams && (
                        <p className="text-sm text-muted-foreground">
                          Equipe: {agent.teams.name}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="teams" className="mt-6">
              <div className="flex justify-end mb-4">
                <Dialog open={dialogOpen === 'team'} onOpenChange={(open) => setDialogOpen(open ? 'team' : null)}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      Adicionar Equipe
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Nova Equipe</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="team-name">Nome</Label>
                        <Input
                          id="team-name"
                          value={newTeamName}
                          onChange={(e) => setNewTeamName(e.target.value)}
                          placeholder="Nome da equipe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="team-desc">Descrição</Label>
                        <Input
                          id="team-desc"
                          value={newTeamDescription}
                          onChange={(e) => setNewTeamDescription(e.target.value)}
                          placeholder="Descrição (opcional)"
                        />
                      </div>
                      <Button onClick={handleAddTeam} className="w-full">
                        Criar Equipe
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {teams.map((team) => (
                  <Card key={team.id}>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between">
                      <CardTitle className="text-lg">{team.name}</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteTeam(team.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {team.description || 'Sem descrição'}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="labels" className="mt-6">
              <div className="flex justify-end mb-4">
                <Dialog open={dialogOpen === 'label'} onOpenChange={(open) => setDialogOpen(open ? 'label' : null)}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <Plus className="w-4 h-4" />
                      Adicionar Etiqueta
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Nova Etiqueta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="label-name">Nome</Label>
                        <Input
                          id="label-name"
                          value={newLabelName}
                          onChange={(e) => setNewLabelName(e.target.value)}
                          placeholder="Nome da etiqueta"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="label-color">Cor</Label>
                        <div className="flex gap-2">
                          <input
                            type="color"
                            id="label-color"
                            value={newLabelColor}
                            onChange={(e) => setNewLabelColor(e.target.value)}
                            className="w-12 h-10 rounded border border-input cursor-pointer"
                          />
                          <Input
                            value={newLabelColor}
                            onChange={(e) => setNewLabelColor(e.target.value)}
                            placeholder="#3B82F6"
                          />
                        </div>
                      </div>
                      <Button onClick={handleAddLabel} className="w-full">
                        Criar Etiqueta
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteLabel(label.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppLayout>
  );
}