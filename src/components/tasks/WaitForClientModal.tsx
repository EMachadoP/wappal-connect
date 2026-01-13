import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Clock, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface WaitForClientModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    conversationId: string;
    contactName?: string;
    onTaskCreated?: () => void;
}

export function WaitForClientModal({
    open,
    onOpenChange,
    conversationId,
    contactName = 'Cliente',
    onTaskCreated,
}: WaitForClientModalProps) {
    const [loading, setLoading] = useState(false);
    const [selectedHours, setSelectedHours] = useState<number | null>(null);
    const [customDate, setCustomDate] = useState('');
    const [customTime, setCustomTime] = useState('09:00');

    const handleQuickSelect = async (hours: number) => {
        setSelectedHours(hours);
        await createWaitTask(hours);
    };

    const handleCustomSubmit = async () => {
        if (!customDate) {
            toast.error('Selecione uma data');
            return;
        }

        const remindAt = new Date(`${customDate}T${customTime || '09:00'}:00`);
        const hoursFromNow = (remindAt.getTime() - Date.now()) / (1000 * 60 * 60);

        if (hoursFromNow <= 0) {
            toast.error('Data deve ser no futuro');
            return;
        }

        await createWaitTask(hoursFromNow, remindAt.toISOString());
    };

    const createWaitTask = async (hours: number, customRemindAt?: string) => {
        setLoading(true);

        try {
            const remindAt = customRemindAt || new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

            // Get session and force Authorization header
            const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
            if (sessionErr) throw new Error(sessionErr.message);

            const accessToken = sessionData.session?.access_token;
            if (!accessToken) {
                throw new Error("Sessão não encontrada/expirada. Faça login novamente.");
            }

            console.log("[wait-task] hasSession?", !!sessionData.session);
            console.log("[wait-task] userId", sessionData.session?.user?.id);

            const response = await supabase.functions.invoke('create-task', {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                body: {
                    title: `Follow-up: ${contactName}`,
                    description: `Cliente não respondeu. Aguardar e retornar contato.`,
                    priority: 'normal',
                    status: 'waiting',
                    conversation_id: conversationId,
                    remind_at: remindAt,
                    assign_conversation: false,
                },
            });

            if (response.error) {
                throw new Error(response.error.message);
            }

            const hoursLabel = hours === 24 ? '24 horas' : hours === 48 ? '48 horas' : `${Math.round(hours)} horas`;
            toast.success(`Follow-up agendado para ${hoursLabel}!`);
            onOpenChange(false);
            onTaskCreated?.();
        } catch (err) {
            console.error('Error creating wait task:', err);
            toast.error('Erro ao criar lembrete');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Aguardar Cliente
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Escolha quando ser lembrado de retomar contato com o cliente.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <p className="text-sm text-muted-foreground">
                        Quando você quer ser lembrado de retomar contato com <strong>{contactName}</strong>?
                    </p>

                    {/* Quick select buttons */}
                    <div className="grid grid-cols-2 gap-3">
                        <Button
                            variant={selectedHours === 24 ? 'default' : 'outline'}
                            onClick={() => handleQuickSelect(24)}
                            disabled={loading}
                            className="h-16 flex flex-col"
                        >
                            <Clock className="h-5 w-5 mb-1" />
                            <span>24 horas</span>
                        </Button>

                        <Button
                            variant={selectedHours === 48 ? 'default' : 'outline'}
                            onClick={() => handleQuickSelect(48)}
                            disabled={loading}
                            className="h-16 flex flex-col"
                        >
                            <Clock className="h-5 w-5 mb-1" />
                            <span>48 horas</span>
                        </Button>
                    </div>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-background px-2 text-muted-foreground">ou escolha</span>
                        </div>
                    </div>

                    {/* Custom date/time */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="customDate">Data</Label>
                            <Input
                                id="customDate"
                                type="date"
                                value={customDate}
                                onChange={(e) => setCustomDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="customTime">Horário</Label>
                            <Input
                                id="customTime"
                                type="time"
                                value={customTime}
                                onChange={(e) => setCustomTime(e.target.value)}
                            />
                        </div>
                    </div>

                    {customDate && (
                        <Button
                            onClick={handleCustomSubmit}
                            disabled={loading}
                            className="w-full"
                        >
                            <Calendar className="h-4 w-4 mr-2" />
                            Agendar para {new Date(`${customDate}T${customTime}`).toLocaleDateString('pt-BR')}
                        </Button>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
