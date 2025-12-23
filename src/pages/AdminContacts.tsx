import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Merge, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface DuplicateGroup {
  key: string;
  type: 'chat_lid' | 'phone';
  contacts: {
    id: string;
    name: string;
    phone: string | null;
    lid: string | null;
    chat_lid: string | null;
    is_group: boolean;
    created_at: string;
    conversation_count: number;
    message_count: number;
  }[];
}

export default function AdminContactsPage() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { toast } = useToast();

  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [confirmMerge, setConfirmMerge] = useState<DuplicateGroup | null>(null);

  const fetchDuplicates = async () => {
    setLoading(true);

    // Fetch all contacts with their conversation/message counts
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('id, name, phone, lid, chat_lid, is_group, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      toast({ variant: 'destructive', title: 'Erro', description: error.message });
      setLoading(false);
      return;
    }

    // Get conversation counts per contact
    const { data: conversations } = await supabase
      .from('conversations')
      .select('contact_id, id');

    const convCountMap = new Map<string, number>();
    conversations?.forEach((c) => {
      convCountMap.set(c.contact_id, (convCountMap.get(c.contact_id) || 0) + 1);
    });

    // Get message counts per contact (via conversations)
    const contactIds = contacts?.map((c) => c.id) || [];
    const { data: convIds } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .in('contact_id', contactIds);

    const contactToConvs = new Map<string, string[]>();
    convIds?.forEach((c) => {
      if (!contactToConvs.has(c.contact_id)) {
        contactToConvs.set(c.contact_id, []);
      }
      contactToConvs.get(c.contact_id)!.push(c.id);
    });

    const allConvIds = convIds?.map((c) => c.id) || [];
    const { data: msgCounts } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', allConvIds);

    const msgCountByConv = new Map<string, number>();
    msgCounts?.forEach((m) => {
      msgCountByConv.set(m.conversation_id, (msgCountByConv.get(m.conversation_id) || 0) + 1);
    });

    const msgCountByContact = new Map<string, number>();
    contactToConvs.forEach((convs, contactId) => {
      let total = 0;
      convs.forEach((convId) => {
        total += msgCountByConv.get(convId) || 0;
      });
      msgCountByContact.set(contactId, total);
    });

    // Group by chat_lid or phone
    const groupsByChatLid = new Map<string, DuplicateGroup['contacts']>();
    const groupsByPhone = new Map<string, DuplicateGroup['contacts']>();

    contacts?.forEach((c) => {
      const contactData = {
        id: c.id,
        name: c.name,
        phone: c.phone,
        lid: c.lid,
        chat_lid: c.chat_lid,
        is_group: c.is_group,
        created_at: c.created_at,
        conversation_count: convCountMap.get(c.id) || 0,
        message_count: msgCountByContact.get(c.id) || 0,
      };

      if (c.chat_lid) {
        if (!groupsByChatLid.has(c.chat_lid)) {
          groupsByChatLid.set(c.chat_lid, []);
        }
        groupsByChatLid.get(c.chat_lid)!.push(contactData);
      } else if (c.phone) {
        if (!groupsByPhone.has(c.phone)) {
          groupsByPhone.set(c.phone, []);
        }
        groupsByPhone.get(c.phone)!.push(contactData);
      }
    });

    // Filter only groups with duplicates (more than 1 contact)
    const duplicateGroups: DuplicateGroup[] = [];

    groupsByChatLid.forEach((contacts, key) => {
      if (contacts.length > 1) {
        duplicateGroups.push({
          key,
          type: 'chat_lid',
          contacts: contacts.sort((a, b) => b.message_count - a.message_count),
        });
      }
    });

    groupsByPhone.forEach((contacts, key) => {
      if (contacts.length > 1) {
        duplicateGroups.push({
          key,
          type: 'phone',
          contacts: contacts.sort((a, b) => b.message_count - a.message_count),
        });
      }
    });

    // Sort by number of duplicates (more duplicates first)
    duplicateGroups.sort((a, b) => b.contacts.length - a.contacts.length);

    setDuplicates(duplicateGroups);
    setLoading(false);
  };

  useEffect(() => {
    if (user && isAdmin) {
      fetchDuplicates();
    }
  }, [user, isAdmin]);

  const handleMerge = async (group: DuplicateGroup) => {
    setMerging(group.key);

    try {
      // Primary contact = first one (most messages)
      const primaryContact = group.contacts[0];
      const duplicateIds = group.contacts.slice(1).map((c) => c.id);

      // 1. Move all conversations from duplicates to primary
      const { error: convError } = await supabase
        .from('conversations')
        .update({ contact_id: primaryContact.id })
        .in('contact_id', duplicateIds);

      if (convError) throw convError;

      // 2. Move participants from duplicates to primary
      const { error: partError } = await supabase
        .from('participants')
        .update({ contact_id: primaryContact.id })
        .in('contact_id', duplicateIds);

      if (partError) throw partError;

      // 3. Update primary contact with best available data
      const updates: Record<string, unknown> = {};
      for (const dup of group.contacts.slice(1)) {
        if (dup.phone && !primaryContact.phone) updates.phone = dup.phone;
        if (dup.lid && !primaryContact.lid) updates.lid = dup.lid;
        if (dup.chat_lid && !primaryContact.chat_lid) updates.chat_lid = dup.chat_lid;
      }

      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await supabase
          .from('contacts')
          .update(updates)
          .eq('id', primaryContact.id);

        if (updateError) throw updateError;
      }

      // 4. Delete duplicate contacts
      const { error: deleteError } = await supabase
        .from('contacts')
        .delete()
        .in('id', duplicateIds);

      if (deleteError) throw deleteError;

      toast({
        title: 'Contatos mesclados!',
        description: `${duplicateIds.length} contato(s) duplicado(s) foram mesclados em "${primaryContact.name}".`,
      });

      // Refresh list
      fetchDuplicates();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Erro ao mesclar',
        description: error.message,
      });
    } finally {
      setMerging(null);
      setConfirmMerge(null);
    }
  };

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/inbox" replace />;

  return (
    <AppLayout>
      <div className="p-6 space-y-6 overflow-auto h-full">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">Gerenciar Contatos Duplicados</h1>
            <p className="text-muted-foreground">
              Detecte e mescle contatos duplicados para manter uma única thread por pessoa.
            </p>
          </div>
          <Button variant="outline" className="gap-2" onClick={fetchDuplicates} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : duplicates.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nenhum contato duplicado encontrado.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>
                Encontrados <strong>{duplicates.length}</strong> grupos de contatos duplicados.
              </span>
            </div>

            {duplicates.map((group) => {
              const isExpanded = expandedGroups.has(group.key);
              const primaryContact = group.contacts[0];

              return (
                <Card key={group.key}>
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(group.key)}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </Button>
                          </CollapsibleTrigger>
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {primaryContact.name}
                              <Badge variant="secondary">{group.contacts.length} duplicados</Badge>
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                              {group.type === 'chat_lid' ? 'Chat LID' : 'Telefone'}:{' '}
                              <code className="bg-muted px-1 rounded text-xs">{group.key}</code>
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-2"
                          disabled={merging === group.key}
                          onClick={() => setConfirmMerge(group)}
                        >
                          <Merge className="w-4 h-4" />
                          {merging === group.key ? 'Mesclando...' : 'Mesclar'}
                        </Button>
                      </div>
                    </CardHeader>

                    <CollapsibleContent>
                      <CardContent>
                        <div className="space-y-2">
                          {group.contacts.map((contact, idx) => (
                            <div
                              key={contact.id}
                              className={`p-3 rounded-lg border ${
                                idx === 0 ? 'border-primary bg-primary/5' : 'border-border'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium">{contact.name}</span>
                                    {idx === 0 && (
                                      <Badge variant="default" className="text-xs">
                                        Principal
                                      </Badge>
                                    )}
                                    {contact.is_group && (
                                      <Badge variant="outline" className="text-xs">
                                        Grupo
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1 space-x-3">
                                    {contact.phone && <span>Tel: {contact.phone}</span>}
                                    {contact.lid && <span>LID: {contact.lid.slice(0, 20)}...</span>}
                                  </div>
                                </div>
                                <div className="text-right text-sm">
                                  <div>{contact.conversation_count} conversa(s)</div>
                                  <div className="text-muted-foreground">{contact.message_count} msg</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-3">
                          Ao mesclar, todas as conversas e mensagens serão movidas para o contato principal
                          (com mais mensagens).
                        </p>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={!!confirmMerge} onOpenChange={(open) => !open && setConfirmMerge(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar mesclagem</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMerge && (
                <>
                  Você está prestes a mesclar <strong>{confirmMerge.contacts.length}</strong> contatos
                  duplicados em <strong>"{confirmMerge.contacts[0].name}"</strong>.
                  <br />
                  <br />
                  Todas as conversas e mensagens serão movidas para o contato principal. Os contatos
                  duplicados serão excluídos permanentemente.
                  <br />
                  <br />
                  <strong>Esta ação não pode ser desfeita.</strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmMerge && handleMerge(confirmMerge)}>
              Mesclar contatos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
