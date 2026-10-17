export interface AudioFormat {
  mime: string;
  ext: string;
}

/**
 * Identifies an audio file from its first bytes. The declared Content-Type is not trusted:
 * only these formats are ever stored or served back.
 */
export function sniffAudio(data: Buffer): AudioFormat | null {
  const ascii = (start: number, end: number) => data.subarray(start, end).toString('latin1');
  if (data.length < 12) return null;
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) {
    return { mime: 'audio/webm', ext: 'webm' };
  }
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(0, 3) === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0)) {
    return { mime: 'audio/mpeg', ext: 'mp3' };
  }
  return null;
}
