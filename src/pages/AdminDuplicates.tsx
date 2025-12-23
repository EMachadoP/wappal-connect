import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Merge, Trash2, Users, MessageSquare, AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DuplicateGroup {
  chat_id: string;
  conversations: {
    id: string;
    contact_id: string;
    contact_name: string;
    message_count: number;
    last_message_at: string | null;
    created_at: string;
    status: string;
  }[];
}

export default function AdminDuplicates() {
  const navigate = useNavigate();
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [confirmMerge, setConfirmMerge] = useState<DuplicateGroup | null>(null);

  useEffect(() => {
    fetchDuplicates();
  }, []);

  async function fetchDuplicates() {
    setLoading(true);
    try {
      // Find conversations with duplicate chat_ids
      const { data: convs, error } = await supabase
        .from('conversations')
        .select(`
          id,
          chat_id,
          contact_id,
          status,
          last_message_at,
          created_at,
          contacts!inner(name, is_group, group_name)
        `)
        .not('chat_id', 'is', null)
        .order('chat_id')
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by chat_id and find duplicates
      const grouped: Record<string, DuplicateGroup['conversations']> = {};
      
      for (const conv of convs || []) {
        const chatId = conv.chat_id!;
        if (!grouped[chatId]) {
          grouped[chatId] = [];
        }
        
        // Get message count for this conversation
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.id);

        const contact = conv.contacts as { name: string; is_group: boolean; group_name: string | null };
        
        grouped[chatId].push({
          id: conv.id,
          contact_id: conv.contact_id,
          contact_name: contact.is_group ? (contact.group_name || contact.name) : contact.name,
          message_count: count || 0,
          last_message_at: conv.last_message_at,
          created_at: conv.created_at,
          status: conv.status,
        });
      }

      // Filter to only those with duplicates
      const duplicateGroups: DuplicateGroup[] = Object.entries(grouped)
        .filter(([_, convs]) => convs.length > 1)
        .map(([chat_id, conversations]) => ({
          chat_id,
          conversations: conversations.sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          ),
        }));

      setDuplicates(duplicateGroups);
    } catch (error) {
      console.error('Error fetching duplicates:', error);
      toast.error('Erro ao buscar duplicados');
    } finally {
      setLoading(false);
    }
  }

  async function handleMerge(group: DuplicateGroup) {
    setMerging(group.chat_id);
    
    try {
      const [primary, ...duplicateConvs] = group.conversations;
      
      // Move all messages from duplicates to primary
      for (const dup of duplicateConvs) {
        const { error: moveError } = await supabase
          .from('messages')
          .update({ conversation_id: primary.id })
          .eq('conversation_id', dup.id);

        if (moveError) throw moveError;

        // Create system event in primary conversation
        await supabase.from('ai_events').insert({
          conversation_id: primary.id,
          event_type: 'system',
          message: `🔗 Conversa mesclada: ${dup.message_count} mensagens movidas de conversa duplicada.`,
          metadata: { merged_from: dup.id, merged_at: new Date().toISOString() },
        });

        // Delete duplicate conversation
        const { error: deleteError } = await supabase
          .from('conversations')
          .delete()
          .eq('id', dup.id);

        if (deleteError) throw deleteError;
      }

      // Recalculate unread_count for primary
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', primary.id)
        .is('read_at', null)
        .eq('direction', 'inbound');

      await supabase
        .from('conversations')
        .update({ 
          unread_count: count || 0,
          status: 'open',
        })
        .eq('id', primary.id);

      toast.success(`${duplicateConvs.length} conversa(s) mesclada(s) com sucesso`);
      fetchDuplicates();
    } catch (error) {
      console.error('Error merging:', error);
      toast.error('Erro ao mesclar conversas');
    } finally {
      setMerging(null);
      setConfirmMerge(null);
    }
  }

  const isGroupChat = (chatId: string) => chatId.includes('@g.us');

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Conversas Duplicadas</h1>
            <p className="text-sm text-muted-foreground">
              Detectar e mesclar conversas com o mesmo chat_id
            </p>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>{duplicates.length} grupo(s) de duplicados encontrado(s)</span>
          </div>
          <Button variant="outline" onClick={fetchDuplicates} disabled={loading}>
            {loading ? 'Buscando...' : 'Atualizar'}
          </Button>
        </div>

        {duplicates.length === 0 && !loading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Nenhuma conversa duplicada encontrada</p>
            </CardContent>
          </Card>
        ) : (
          duplicates.map((group) => (
            <Card key={group.chat_id} className="overflow-hidden">
              <CardHeader className="bg-muted/50">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {isGroupChat(group.chat_id) && (
                        <Badge variant="secondary">Grupo</Badge>
                      )}
                      <code className="text-sm bg-background px-2 py-1 rounded">
                        {group.chat_id}
                      </code>
                    </CardTitle>
                    <CardDescription>
                      {group.conversations.length} conversas com o mesmo identificador
                    </CardDescription>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setConfirmMerge(group)}
                    disabled={merging === group.chat_id}
                  >
                    <Merge className="h-4 w-4 mr-2" />
                    {merging === group.chat_id ? 'Mesclando...' : 'Mesclar'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {group.conversations.map((conv, index) => (
                    <div
                      key={conv.id}
                      className={`p-4 flex items-center justify-between ${
                        index === 0 ? 'bg-green-50 dark:bg-green-900/10' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0">
                          {index === 0 ? (
                            <Badge variant="default" className="bg-green-600">
                              Principal
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <Trash2 className="h-3 w-3 mr-1" />
                              Duplicada
                            </Badge>
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{conv.contact_name}</p>
                          <p className="text-sm text-muted-foreground">
                            Criada em: {new Date(conv.created_at).toLocaleString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MessageSquare className="h-4 w-4" />
                          {conv.message_count} msgs
                        </div>
                        <Badge variant={conv.status === 'open' ? 'default' : 'secondary'}>
                          {conv.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>

      <AlertDialog open={!!confirmMerge} onOpenChange={() => setConfirmMerge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mesclar conversas duplicadas?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Mover todas as mensagens para a conversa mais antiga (principal)</li>
                <li>Excluir as conversas duplicadas</li>
                <li>Registrar um evento no histórico</li>
              </ul>
              <p className="mt-4 font-medium text-foreground">
                Esta ação não pode ser desfeita.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmMerge && handleMerge(confirmMerge)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirmar Mesclagem
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
