import { describe, expect, it } from 'vitest';
import { safeFileName } from './audio.js';

describe('safeFileName', () => {
  it('keeps readable names', () => {
    expect(safeFileName('Bob - Screaming goat')).toBe('Bob - Screaming goat');
    expect(safeFileName('Zoé – Cha-ching!')).toBe('Zoé – Cha-ching!');
  });

  it('strips path separators, reserved and control characters', () => {
    expect(safeFileName('../../etc/passwd')).toBe('....etcpasswd');
    expect(safeFileName('a\\b:c*d?e"f<g>h|i\u0000j\nk')).toBe('abcdefghijk');
  });

  it('collapses whitespace, trims trailing dots and caps the length', () => {
    expect(safeFileName('  Bob   -  goat ...  ')).toBe('Bob - goat');
    expect(safeFileName('x'.repeat(200))).toHaveLength(80);
  });

  it('falls back when nothing is left', () => {
    expect(safeFileName('///')).toBe('recording');
    expect(safeFileName('')).toBe('recording');
  });
});
