import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
    audioUrl: string;
    className?: string;
}

export function AudioPlayer({ audioUrl, className }: AudioPlayerProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blobUrlRef = useRef<string | null>(null);

    useEffect(() => {
        // Cleanup blob URL on unmount
        return () => {
            if (blobUrlRef.current) {
                URL.revokeObjectURL(blobUrlRef.current);
            }
        };
    }, []);

    const loadAudio = async () => {
        if (blobUrlRef.current) {
            // Already loaded
            return blobUrlRef.current;
        }

        setIsLoading(true);
        setError(null);

        try {
            // First attempt: Fetch audio with proper headers to create a blob URL
            // This is better for custom player controls and UI
            const response = await fetch(audioUrl, {
                method: 'GET',
                // Simplify credentials - only include if it's explicitly a Supabase private URL
                credentials: audioUrl.includes('supabase') && !audioUrl.includes('public') ? 'include' : 'omit',
            });

            if (!response.ok) {
                console.warn(`Fetch failed with status ${response.status}. Falling back to direct src.`);
                return setupDirectAudio(audioUrl);
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            blobUrlRef.current = blobUrl;

            return setupAudioElement(blobUrl);
        } catch (err: any) {
            console.warn('Fetch failed due to CORS or network. Falling back to direct src:', err);
            return setupDirectAudio(audioUrl);
        }
    };

    const setupAudioElement = (url: string) => {
        if (!audioRef.current) {
            audioRef.current = new Audio(url);

            audioRef.current.addEventListener('loadedmetadata', () => {
                setDuration(audioRef.current?.duration || 0);
            });

            audioRef.current.addEventListener('timeupdate', () => {
                setCurrentTime(audioRef.current?.currentTime || 0);
            });

            audioRef.current.addEventListener('ended', () => {
                setIsPlaying(false);
                setCurrentTime(0);
            });

            audioRef.current.addEventListener('error', (e) => {
                console.error('Audio playback error:', e);
                setError('Erro ao reproduzir áudio');
                setIsPlaying(false);
            });
        } else {
            audioRef.current.src = url;
            audioRef.current.load();
        }
        setIsLoading(false);
        return url;
    };

    const setupDirectAudio = (url: string) => {
        setIsLoading(true);
        // If direct loading also fails, we'll see it in the 'error' event listener
        return setupAudioElement(url);
    };
    const togglePlay = async () => {
        try {
            // If audio element doesn't exist yet, load it first
            if (!audioRef.current) {
                console.log('[AudioPlayer] Loading audio for first time...');
                await loadAudio();
            }

            // Double-check audio element is ready
            if (!audioRef.current) {
                console.error('[AudioPlayer] Audio element still not ready after loading');
                setError('Erro ao carregar áudio');
                return;
            }

            if (isPlaying) {
                console.log('[AudioPlayer] Pausing audio');
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                console.log('[AudioPlayer] Playing audio', { 
                    src: audioRef.current.src,
                    readyState: audioRef.current.readyState,
                    duration: audioRef.current.duration
                });
                
                // Ensure audio is loaded before playing
                if (audioRef.current.readyState < 2) {
                    console.log('[AudioPlayer] Audio not ready, loading...');
                    await audioRef.current.load();
                }
                
                await audioRef.current.play();
                setIsPlaying(true);
                console.log('[AudioPlayer] Audio playing successfully');
            }
        } catch (err: any) {
            console.error('[AudioPlayer] Error during playback:', {
                error: err,
                message: err.message,
                name: err.name,
                audioSrc: audioRef.current?.src
            });
            
            // Provide user-friendly error messages
            const errorMsg = err.name === 'NotAllowedError' 
                ? 'Reprodução bloqueada. Tente novamente.'
                : err.name === 'NotSupportedError'
                ? 'Formato de áudio não suportado'
                : 'Erro ao reproduzir áudio';
            
            setError(errorMsg);
            setIsPlaying(false);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || !duration) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const newTime = percentage * duration;

        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    if (error) {
        return (
            <div className={cn("flex items-center gap-2 p-2 bg-destructive/10 rounded-md", className)}>
                <Volume2 className="w-4 h-4 text-destructive" />
                <span className="text-xs text-destructive">{error}</span>
            </div>
        );
    }

    return (
        <div className={cn("flex items-center gap-2 bg-muted/50 rounded-md p-2 max-w-xs", className)}>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={togglePlay}
                disabled={isLoading}
            >
                {isLoading ? (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                    <Pause className="w-4 h-4" />
                ) : (
                    <Play className="w-4 h-4" />
                )}
            </Button>

            <div className="flex-1 flex flex-col gap-1">
                <div
                    className="h-1 bg-muted rounded-full cursor-pointer"
                    onClick={handleSeek}
                >
                    <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                    />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>
        </div>
    );
}
