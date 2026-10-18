import { describe, expect, it } from 'vitest';
import { sniffAudio } from './formats';

const pad = (head: number[] | string) =>
  Buffer.concat([
    typeof head === 'string' ? Buffer.from(head, 'latin1') : Buffer.from(head),
    Buffer.alloc(16),
  ]);

describe('sniffAudio', () => {
  it.each([
    ['webm', pad([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm'],
    ['ogg', pad('OggS'), 'audio/ogg'],
    ['wav', pad('RIFF\0\0\0\0WAVE'), 'audio/wav'],
    ['m4a', pad('\0\0\0\x20ftypM4A '), 'audio/mp4'],
    ['mp3 (ID3)', pad('ID3'), 'audio/mpeg'],
    ['mp3 (frame sync)', pad([0xff, 0xfb]), 'audio/mpeg'],
  ])('recognizes %s', (_name, data, mime) => {
    expect(sniffAudio(data)?.mime).toBe(mime);
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(sniffAudio(pad('<html><script>'))).toBeNull();
    expect(sniffAudio(pad('%PDF-1.7'))).toBeNull();
    expect(sniffAudio(Buffer.from('OggS'))).toBeNull(); // too short
  });
});
