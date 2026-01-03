import { useState } from 'react';
import { Volume2, VolumeX, Mic, MicOff } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface AudioSettingsMenuProps {
    conversationId: string;
    audioEnabled: boolean;
    audioAutoTranscribe: boolean;
    onSettingsChange?: () => void;
}

export function AudioSettingsMenu({
    conversationId,
    audioEnabled: initialAudioEnabled,
    audioAutoTranscribe: initialAutoTranscribe,
    onSettingsChange,
}: AudioSettingsMenuProps) {
    const [audioEnabled, setAudioEnabled] = useState(initialAudioEnabled);
    const [audioAutoTranscribe, setAudioAutoTranscribe] = useState(initialAutoTranscribe);
    const [isSaving, setIsSaving] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const { toast } = useToast();

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('conversations')
                .update({
                    audio_enabled: audioEnabled,
                    audio_auto_transcribe: audioAutoTranscribe,
                })
                .eq('id', conversationId);

            if (error) throw error;

            toast({
                title: 'Configurações salvas',
                description: 'Preferências de áudio atualizadas.',
            });

            onSettingsChange?.();
            setIsOpen(false);
        } catch (error) {
            console.error('Error saving audio settings:', error);
            toast({
                variant: 'destructive',
                title: 'Erro',
                description: 'Não foi possível salvar as configurações.',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            // Reset to initial values if closing without saving
            setAudioEnabled(initialAudioEnabled);
            setAudioAutoTranscribe(initialAutoTranscribe);
        }
        setIsOpen(open);
    };

    // Determine icon based on settings
    const getIcon = () => {
        if (!audioEnabled) return <VolumeX className="w-4 h-4" />;
        if (!audioAutoTranscribe) return <Mic className="w-4 h-4" />;
        return <Volume2 className="w-4 h-4" />;
    };

    const getTooltip = () => {
        if (!audioEnabled) return 'Áudio bloqueado';
        if (!audioAutoTranscribe) return 'Áudio sem auto-transcrição';
        return 'Áudio com auto-transcrição';
    };

    return (
        <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={getTooltip()}
                >
                    {getIcon()}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Configurações de Áudio</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <div className="p-3 space-y-4">
                    <div className="flex items-center justify-between space-x-2">
                        <div className="flex-1">
                            <Label htmlFor="audio-enabled" className="text-sm font-medium">
                                Permitir áudio
                            </Label>
                            <p className="text-xs text-muted-foreground mt-1">
                                {audioEnabled
                                    ? 'Mensagens de áudio são permitidas'
                                    : 'Mensagens de áudio serão bloqueadas'}
                            </p>
                        </div>
                        <Switch
                            id="audio-enabled"
                            checked={audioEnabled}
                            onCheckedChange={setAudioEnabled}
                            disabled={isSaving}
                        />
                    </div>

                    <div className="flex items-center justify-between space-x-2">
                        <div className="flex-1">
                            <Label
                                htmlFor="auto-transcribe"
                                className={`text-sm font-medium ${!audioEnabled ? 'opacity-50' : ''}`}
                            >
                                Auto-transcrever
                            </Label>
                            <p className="text-xs text-muted-foreground mt-1">
                                {audioAutoTranscribe
                                    ? 'Áudios serão transcritos automaticamente'
                                    : 'Transcrição manual apenas'}
                            </p>
                        </div>
                        <Switch
                            id="auto-transcribe"
                            checked={audioAutoTranscribe}
                            onCheckedChange={setAudioAutoTranscribe}
                            disabled={!audioEnabled || isSaving}
                        />
                    </div>
                </div>

                <DropdownMenuSeparator />

                <div className="p-2">
                    <Button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full"
                        size="sm"
                    >
                        {isSaving ? 'Salvando...' : 'Salvar'}
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
