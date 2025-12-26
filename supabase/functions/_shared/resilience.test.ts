import { describe, it, expect, vi } from 'https://esm.sh/vitest@2.0.0';
import { withRetry } from './resilience.ts';

describe('Resilience Utility: withRetry', () => {
  it('should return value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry and eventually succeed', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValue('recovered');
    
    const result = await withRetry(fn, { maxRetries: 2, initialDelay: 10 });
    
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after exceeding max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Permanent Fail'));
    
    await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 }))
      .rejects.toThrow('Permanent Fail');
    
    expect(fn).toHaveBeenCalledTimes(3); // Initial call + 2 retries
  });
});