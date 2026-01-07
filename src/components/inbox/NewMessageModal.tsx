import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Contact {
  id: string;
  name: string;
  phone: string | null;
  profile_picture_url: string | null;
}

interface NewMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectConversation: (conversationId: string) => void;
}

export function NewMessageModal({ open, onOpenChange, onSelectConversation }: NewMessageModalProps) {
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      fetchContacts('');
    } else {
      setSearch('');
    }
  }, [open]);

  const fetchContacts = async (query: string) => {
    setSearching(true);
    try {
      let supabaseQuery = supabase
        .from('contacts')
        .select('id, name, phone, profile_picture_url')
        .order('name')
        .limit(20);

      if (query) {
        supabaseQuery = supabaseQuery.or(`name.ilike.%${query}%,phone.ilike.%${query}%`);
      }

      const { data, error } = await supabaseQuery;

      if (error) throw error;
      setContacts(data || []);
    } catch (error: any) {
      console.error('Error fetching contacts:', error);
      toast.error('Erro ao carregar contatos');
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (open) fetchContacts(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSelectContact = async (contact: Contact) => {
    setLoading(true);
    try {
      // 1. Check if an open conversation already exists for this contact
      const { data: existingConv, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('status', 'open')
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existingConv) {
        onSelectConversation(existingConv.id);
        onOpenChange(false);
        return;
      }

      // 2. If not, create a new conversation
      const { data: newConv, error: createError } = await supabase
        .from('conversations')
        .insert({
          contact_id: contact.id,
          status: 'open',
          unread_count: 0,
        })
        .select()
        .single();

      if (createError) throw createError;

      onSelectConversation(newConv.id);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error starting conversation:', error);
      toast.error('Erro ao iniciar conversa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] p-0 overflow-hidden gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>Nova Mensagem</DialogTitle>
        </DialogHeader>

        <div className="p-3 bg-muted/30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[400px]">
          {searching && contacts.length === 0 ? (
            <div className="p-8 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Buscando contatos...</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>Nenhum contato encontrado</p>
            </div>
          ) : (
            <div className="divide-y">
              {contacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  disabled={loading}
                  className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {contact.profile_picture_url ? (
                      <img src={contact.profile_picture_url} alt={contact.name} className="w-full h-full object-cover" />
                    ) : (
                      <UserPlus className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{contact.name}</p>
                    {contact.phone && (
                      <p className="text-xs text-muted-foreground">{contact.phone}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
