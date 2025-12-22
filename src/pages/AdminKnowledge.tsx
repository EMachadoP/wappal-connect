import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, Plus, Check, X, Pencil, Trash2, Loader2, BookOpen, FileText, Clock, CheckCircle } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface KBSnippet {
  id: string;
  title: string;
  category: string;
  problem_text: string;
  solution_text: string;
  tags: string[];
  source: string;
  approved: boolean;
  confidence_score: number;
  used_count: number;
  created_at: string;
  updated_at: string;
}

export default function AdminKnowledgePage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [snippets, setSnippets] = useState<KBSnippet[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<KBSnippet | null>(null);
  const [snippetForm, setSnippetForm] = useState({
    title: '',
    category: 'general',
    problem_text: '',
    solution_text: '',
    tags: '',
  });

  const fetchSnippets = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('kb_snippets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSnippets((data || []) as KBSnippet[]);
    } catch (error) {
      console.error('Error fetching snippets:', error);
      toast({ variant: 'destructive', title: 'Erro ao carregar snippets' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchSnippets();
    }
  }, [user, isAdmin]);

  const handleOpenEdit = (snippet?: KBSnippet) => {
    if (snippet) {
      setEditingSnippet(snippet);
      setSnippetForm({
        title: snippet.title,
        category: snippet.category,
        problem_text: snippet.problem_text,
        solution_text: snippet.solution_text,
        tags: (snippet.tags || []).join(', '),
      });
    } else {
      setEditingSnippet(null);
      setSnippetForm({
        title: '',
        category: 'general',
        problem_text: '',
        solution_text: '',
        tags: '',
      });
    }
    setEditDialogOpen(true);
  };

  const handleSaveSnippet = async () => {
    if (!snippetForm.title.trim() || !snippetForm.problem_text.trim() || !snippetForm.solution_text.trim()) {
      toast({ variant: 'destructive', title: 'Preencha todos os campos obrigatórios' });
      return;
    }

    try {
      const tagsArray = snippetForm.tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t);

      const snippetData = {
        title: snippetForm.title,
        category: snippetForm.category,
        problem_text: snippetForm.problem_text,
        solution_text: snippetForm.solution_text,
        tags: tagsArray,
      };

      if (editingSnippet) {
        const { error } = await supabase
          .from('kb_snippets')
          .update(snippetData)
          .eq('id', editingSnippet.id);
        if (error) throw error;
        toast({ title: 'Snippet atualizado!' });
      } else {
        const { error } = await supabase
          .from('kb_snippets')
          .insert({ ...snippetData, source: 'manual', approved: false });
        if (error) throw error;
        toast({ title: 'Snippet criado!' });
      }

      setEditDialogOpen(false);
      fetchSnippets();
    } catch (error) {
      console.error('Error saving snippet:', error);
      toast({ variant: 'destructive', title: 'Erro ao salvar' });
    }
  };

  const handleApprove = async (snippetId: string) => {
    try {
      // First approve the snippet
      const { error: updateError } = await supabase
        .from('kb_snippets')
        .update({ approved: true })
        .eq('id', snippetId);

      if (updateError) throw updateError;

      // Generate embedding via edge function
      const { error: embedError } = await supabase.functions.invoke('kb-generate-embedding', {
        body: { snippetId },
      });

      if (embedError) {
        console.warn('Embedding generation failed:', embedError);
        toast({ title: 'Snippet aprovado!', description: 'Embedding será gerado em breve.' });
      } else {
        toast({ title: 'Snippet aprovado e indexado!' });
      }

      fetchSnippets();
    } catch (error) {
      console.error('Error approving snippet:', error);
      toast({ variant: 'destructive', title: 'Erro ao aprovar' });
    }
  };

  const handleReject = async (snippetId: string) => {
    try {
      const { error } = await supabase
        .from('kb_snippets')
        .delete()
        .eq('id', snippetId);

      if (error) throw error;
      toast({ title: 'Snippet removido' });
      fetchSnippets();
    } catch (error) {
      console.error('Error rejecting snippet:', error);
      toast({ variant: 'destructive', title: 'Erro ao remover' });
    }
  };

  // Filter snippets
  const pendingSnippets = snippets.filter(s => !s.approved);
  const approvedSnippets = snippets.filter(s => s.approved);

  const filteredSnippets = (approved: boolean) => {
    const list = approved ? approvedSnippets : pendingSnippets;
    return list.filter(s => {
      const matchesSearch = searchQuery === '' ||
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.problem_text.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.solution_text.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  };

  const categories = [...new Set(snippets.map(s => s.category))];

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
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Conhecimento Vivo
            </h1>
            <p className="text-muted-foreground">
              Base de conhecimento para a IA aprender com o dia a dia
            </p>
          </div>
          <Button onClick={() => handleOpenEdit()}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Snippet
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-warning/10 rounded-lg">
                  <Clock className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pendingSnippets.length}</p>
                  <p className="text-sm text-muted-foreground">Pendentes</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-success/10 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{approvedSnippets.length}</p>
                  <p className="text-sm text-muted-foreground">Aprovados</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{categories.length}</p>
                  <p className="text-sm text-muted-foreground">Categorias</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-info/10 rounded-lg">
                  <BookOpen className="h-6 w-6 text-info" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {approvedSnippets.reduce((acc, s) => acc + (s.used_count || 0), 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Usos Totais</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar snippets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <select
            className="border rounded-md px-3 py-2 bg-background"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Todas categorias</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="pending" className="space-y-6">
            <TabsList>
              <TabsTrigger value="pending" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Pendentes ({filteredSnippets(false).length})
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Aprovados ({filteredSnippets(true).length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              <Card>
                <CardHeader>
                  <CardTitle>Snippets Pendentes de Aprovação</CardTitle>
                  <CardDescription>
                    Revise e aprove para adicionar à base de conhecimento da IA
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    {filteredSnippets(false).length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        Nenhum snippet pendente
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {filteredSnippets(false).map(snippet => (
                          <SnippetCard
                            key={snippet.id}
                            snippet={snippet}
                            onEdit={() => handleOpenEdit(snippet)}
                            onApprove={() => handleApprove(snippet.id)}
                            onReject={() => handleReject(snippet.id)}
                          />
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="approved">
              <Card>
                <CardHeader>
                  <CardTitle>Base de Conhecimento Ativa</CardTitle>
                  <CardDescription>
                    Snippets indexados e usados pela IA nas respostas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Título</TableHead>
                          <TableHead>Categoria</TableHead>
                          <TableHead>Fonte</TableHead>
                          <TableHead>Usos</TableHead>
                          <TableHead>Criado em</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSnippets(true).map(snippet => (
                          <TableRow key={snippet.id}>
                            <TableCell className="font-medium max-w-[200px] truncate">
                              {snippet.title}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{snippet.category}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {snippet.source}
                            </TableCell>
                            <TableCell>{snippet.used_count || 0}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {format(new Date(snippet.created_at), 'dd/MM/yy', { locale: ptBR })}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(snippet)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleReject(snippet.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingSnippet ? 'Editar Snippet' : 'Novo Snippet'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Título *</Label>
                  <Input
                    value={snippetForm.title}
                    onChange={(e) => setSnippetForm(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Ex: Como resolver X"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Categoria *</Label>
                  <Input
                    value={snippetForm.category}
                    onChange={(e) => setSnippetForm(prev => ({ ...prev, category: e.target.value }))}
                    placeholder="Ex: suporte, vendas"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tags (separadas por vírgula)</Label>
                <Input
                  value={snippetForm.tags}
                  onChange={(e) => setSnippetForm(prev => ({ ...prev, tags: e.target.value }))}
                  placeholder="Ex: boleto, pagamento, 2ª via"
                />
              </div>
              <div className="space-y-2">
                <Label>Problema / Pergunta do Cliente *</Label>
                <Textarea
                  value={snippetForm.problem_text}
                  onChange={(e) => setSnippetForm(prev => ({ ...prev, problem_text: e.target.value }))}
                  placeholder="Descreva o problema ou pergunta típica..."
                  className="min-h-[100px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Solução / Resposta *</Label>
                <Textarea
                  value={snippetForm.solution_text}
                  onChange={(e) => setSnippetForm(prev => ({ ...prev, solution_text: e.target.value }))}
                  placeholder="Descreva a solução ou resposta ideal..."
                  className="min-h-[150px]"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSaveSnippet}>
                {editingSnippet ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}

// Snippet Card Component
function SnippetCard({
  snippet,
  onEdit,
  onApprove,
  onReject,
}: {
  snippet: KBSnippet;
  onEdit: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{snippet.title}</h4>
              <Badge variant="secondary">{snippet.category}</Badge>
              <Badge variant="outline" className="text-xs">{snippet.source}</Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              <strong>Problema:</strong> {snippet.problem_text.substring(0, 200)}
              {snippet.problem_text.length > 200 && '...'}
            </div>
            <div className="text-sm">
              <strong>Solução:</strong> {snippet.solution_text.substring(0, 300)}
              {snippet.solution_text.length > 300 && '...'}
            </div>
            {snippet.tags && snippet.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {snippet.tags.map((tag, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="default" size="icon" onClick={onApprove} className="bg-success hover:bg-success/90">
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="destructive" size="icon" onClick={onReject}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
