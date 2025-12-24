import { useRef, useCallback, useEffect } from 'react';

export function useNotificationSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastPlayedRef = useRef<number>(0);

  // Initialize audio context on first user interaction
  useEffect(() => {
    const initAudioContext = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };

    // Initialize on any user interaction
    const events = ['click', 'keydown', 'touchstart'];
    events.forEach(event => document.addEventListener(event, initAudioContext, { once: true }));

    return () => {
      events.forEach(event => document.removeEventListener(event, initAudioContext));
    };
  }, []);

  const playNotificationSound = useCallback(() => {
    // Throttle: don't play more than once every 2 seconds
    const now = Date.now();
    if (now - lastPlayedRef.current < 2000) return;
    lastPlayedRef.current = now;

    try {
      // Create audio context if needed
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const ctx = audioContextRef.current;
      
      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // Create a pleasant notification sound
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      // Two-tone notification sound
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
      oscillator.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.1); // C6

      // Envelope for smooth sound
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.12);
      gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

      oscillator.type = 'sine';
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);

      console.log('[Notification] Sound played');
    } catch (error) {
      console.warn('[Notification] Could not play sound:', error);
    }
  }, []);

  return { playNotificationSound };
}
