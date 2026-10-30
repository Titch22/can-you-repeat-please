import { describe, expect, it } from 'vitest';
import {
  AddClipPayload,
  NicknameSchema,
  RecordingLeadSchema,
  SoundLabelSchema,
  youtubeId,
} from './schemas.js';

describe('youtubeId', () => {
  it('finds the video in every usual form of link', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=12s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      '  https://www.youtube.com/live/dQw4w9WgXcQ  ',
    ]) {
      expect(youtubeId(link)).toBe('dQw4w9WgXcQ');
    }
  });

  it('refuses anything else', () => {
    for (const link of [
      '',
      'dQw4w9WgXcQ',
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXc%22',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)',
    ]) {
      expect(youtubeId(link)).toBeNull();
    }
  });
});

describe('AddClipPayload', () => {
  const clip = { youtubeId: 'dQw4w9WgXcQ', startMs: 5000, endMs: 15_000, label: 'Scene' };

  it('accepts a clip of a second or more, however long', () => {
    expect(AddClipPayload.safeParse(clip).success).toBe(true);
    expect(AddClipPayload.safeParse({ ...clip, endMs: 6000 }).success).toBe(true);
    expect(AddClipPayload.safeParse({ ...clip, endMs: 7_200_000 }).success).toBe(true);
  });

  it('refuses a clip too short or backwards, and an id that is not one', () => {
    expect(AddClipPayload.safeParse({ ...clip, endMs: 5999 }).success).toBe(false);
    expect(AddClipPayload.safeParse({ ...clip, endMs: 1000 }).success).toBe(false);
    expect(AddClipPayload.safeParse({ ...clip, youtubeId: '../../evil?' }).success).toBe(false);
  });
});

describe('RecordingLeadSchema', () => {
  it('reads the query, and falls back to 0 on anything odd', () => {
    expect(RecordingLeadSchema.parse('250')).toBe(250);
    expect(RecordingLeadSchema.parse('-40')).toBe(-40);
    expect(RecordingLeadSchema.parse(undefined)).toBe(0);
    expect(RecordingLeadSchema.parse('nope')).toBe(0);
    expect(RecordingLeadSchema.parse('9999999')).toBe(0);
  });
});

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
