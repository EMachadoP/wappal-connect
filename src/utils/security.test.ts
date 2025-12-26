import { describe, it, expect } from 'vitest';

// Exemplo de função utilitária para testar
export const sanitizeInput = (val: string) => val.trim().slice(0, 100);

describe('Security Utils', () => {
  it('should trim and limit input length', () => {
    const longInput = "  test ".repeat(50);
    const result = sanitizeInput(longInput);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.startsWith('test')).toBe(true);
  });

  it('should handle empty strings', () => {
    expect(sanitizeInput("   ")).toBe("");
  });
});