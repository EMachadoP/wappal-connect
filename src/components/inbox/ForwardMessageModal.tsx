"use client";

import { useState, useEffect } from 'react';
import { Search, Send } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Conversation {
    id: string;
    contact_name: string;
    contact_phone: string;
}

interface ForwardMessageModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    messageId: string;
    messageContent: string | null;
    messageType: string;
    mediaUrl?: string | null;
    currentConversationId: string;
}

export function ForwardMessageModal({
    open,
    onOpenChange,
    messageId,
    messageContent,
    messageType,
    mediaUrl,
    currentConversationId,
}: ForwardMessageModalProps) {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [forwarding, setForwarding] = useState(false);

    useEffect(() => {
        if (open) {
            fetchConversations();
        }
    }, [open]);

    useEffect(() => {
        if (searchQuery.trim()) {
            const filtered = conversations.filter(c =>
                c.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.contact_phone?.includes(searchQuery)
            );
            setFilteredConversations(filtered);
        } else {
            setFilteredConversations(conversations);
        }
    }, [searchQuery, conversations]);

    const fetchConversations = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('conversations')
                .select(`
          id,
          contacts (
            name,
            phone,
            whatsapp_display_name
          )
        `)
                .neq('id', currentConversationId)
                .order('last_message_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            const mapped = data?.map(c => ({
                id: c.id,
                contact_name: (c.contacts as any)?.whatsapp_display_name || (c.contacts as any)?.name || 'Contato',
                contact_phone: (c.contacts as any)?.phone || '',
            })) || [];

            setConversations(mapped);
            setFilteredConversations(mapped);
        } catch (error) {
            console.error('Error fetching conversations:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleForward = async () => {
        if (!selectedConversationId) {
            toast.error('Selecione uma conversa');
            return;
        }

        setForwarding(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            if (!token) throw new Error('Sessão expirada');

            // Get user profile for sender name
            const { data: profile } = await supabase
                .from('profiles')
                .select('name, display_name')
                .eq('id', session?.user?.id)
                .single();

            const senderName = profile?.display_name || profile?.name || 'Atendente G7';

            // Add forwarded indicator to content
            const forwardedContent = messageContent
                ? `↪️ *Encaminhada*\n\n${messageContent}`
                : '↪️ *Mensagem encaminhada*';

            if (messageType === 'text' || !mediaUrl) {
                // Forward text message
                const response = await fetch('https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-message', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        conversation_id: selectedConversationId,
                        content: forwardedContent,
                        message_type: 'text',
                        sender_name: senderName
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText);
                }
            } else {
                // Forward media message
                const response = await fetch('https://qoolzhzdcfnyblymdvbq.supabase.co/functions/v1/zapi-send-file', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        conversation_id: selectedConversationId,
                        file_url: mediaUrl,
                        file_type: messageType === 'image' ? 'image/jpeg' : messageType === 'video' ? 'video/mp4' : 'application/octet-stream',
                        caption: messageContent ? `↪️ Encaminhada\n\n${messageContent}` : '↪️ Mensagem encaminhada',
                        sender_id: session?.user?.id,
                        sender_name: senderName
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText);
                }
            }

            toast.success('Mensagem encaminhada com sucesso');
            onOpenChange(false);
            setSelectedConversationId(null);
            setSearchQuery('');
        } catch (error: any) {
            console.error('Error forwarding message:', error);
            toast.error(`Erro ao encaminhar: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setForwarding(false);
        }
    };

    const getInitials = (name: string) => {
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Encaminhar mensagem</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar conversa..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>

                    {/* Conversation list */}
                    <ScrollArea className="h-[300px] rounded-md border">
                        {loading ? (
                            <div className="p-4 text-center text-muted-foreground">
                                Carregando...
                            </div>
                        ) : filteredConversations.length === 0 ? (
                            <div className="p-4 text-center text-muted-foreground">
                                Nenhuma conversa encontrada
                            </div>
                        ) : (
                            <div className="p-2">
                                {filteredConversations.map((conv) => (
                                    <button
                                        key={conv.id}
                                        onClick={() => setSelectedConversationId(conv.id)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${selectedConversationId === conv.id
                                                ? 'bg-primary text-primary-foreground'
                                                : 'hover:bg-muted'
                                            }`}
                                    >
                                        <Avatar className="h-10 w-10">
                                            <AvatarFallback>{getInitials(conv.contact_name)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 text-left">
                                            <p className="font-medium truncate">{conv.contact_name}</p>
                                            <p className={`text-sm truncate ${selectedConversationId === conv.id
                                                    ? 'text-primary-foreground/70'
                                                    : 'text-muted-foreground'
                                                }`}>
                                                {conv.contact_phone}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </ScrollArea>

                    {/* Forward button */}
                    <Button
                        onClick={handleForward}
                        disabled={!selectedConversationId || forwarding}
                        className="w-full"
                    >
                        {forwarding ? (
                            'Encaminhando...'
                        ) : (
                            <>
                                <Send className="h-4 w-4 mr-2" />
                                Encaminhar
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
