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

  const playLongNotificationSound = useCallback(async () => {
    // Throttle: don't play more than once every 2 seconds
    const now = Date.now();
    if (now - lastPlayedRef.current < 2000) return;
    lastPlayedRef.current = now;

    if (!unlockedRef.current) {
      console.log('[Notification] Long Sound skipped (context not unlocked)');
      return;
    }

    try {
      const ctx = audioContextRef.current;
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Play a sequence of 3 emphatic beeps
      const playBeep = (startTime: number, freq: number, duration: number) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(freq, startTime);

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.3, startTime + duration * 0.2);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      const t = ctx.currentTime;
      playBeep(t, 659.25, 0.15); // E5
      playBeep(t + 0.2, 880.00, 0.15); // A5
      playBeep(t + 0.4, 1318.51, 0.3); // E6 

      console.log('[Notification] Long Sound played');
    } catch (error) {
      console.warn('[Notification] Could not play long sound:', error);
    }
  }, []);

  return { playNotificationSound, playLongNotificationSound };
}
