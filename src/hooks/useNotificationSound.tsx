import { useRef, useCallback, useEffect } from 'react';

export function useNotificationSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const lastPlayedRef = useRef<number>(0);

  useEffect(() => {
    const unlock = async () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        unlockedRef.current = true;
        console.log('[Notification] Audio unlocked');
      } catch (err) {
        console.warn('[Notification] Failed to unlock audio:', err);
      }
    };

    // Unlock on first pointerdown gesture
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const playNotificationSound = useCallback(async () => {
    // Throttle: don't play more than once every 1 second
    const now = Date.now();
    if (now - lastPlayedRef.current < 1000) return;
    lastPlayedRef.current = now;

    if (!unlockedRef.current) {
      console.log('[Notification] Sound skipped (context not unlocked)');
      return;
    }

    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      // Ensure context is running
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Simple but pleasant two-tone beep
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);

      console.log('[Notification] Sound played');
    } catch (error) {
      console.warn('[Notification] Could not play sound:', error);
    }
  }, []);

  return { playNotificationSound };
}
