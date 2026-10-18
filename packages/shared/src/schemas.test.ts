import { describe, expect, it } from 'vitest';
import { NicknameSchema, SoundLabelSchema } from './schemas.js';

describe('visible text (nicknames, labels)', () => {
  it('removes invisible characters, so look-alike names are the same name', () => {
    expect(NicknameSchema.parse('Ali​ce')).toBe('Alice'); // zero-width space
    expect(NicknameSchema.parse('‮ecilA')).toBe('ecilA'); // right-to-left override
    expect(NicknameSchema.parse('Bob\u0007\n')).toBe('Bob'); // control characters
    expect(SoundLabelSchema.parse('  Goat﻿ ')).toBe('Goat');
  });

  it('normalises accents to one form', () => {
    expect(NicknameSchema.parse('Zoé')).toBe('Zoé'); // e + combining accent → é
  });

  it('refuses a name with nothing visible left, or too long', () => {
    expect(NicknameSchema.safeParse('​​').success).toBe(false);
    expect(NicknameSchema.safeParse('x'.repeat(21)).success).toBe(false);
    expect(NicknameSchema.safeParse('Émilie 🎤').success).toBe(true);
  });
});
