import type { DialogueLine, Performance, Role, Speaker } from '@cyrp/shared';

/** A piece of a recording to play: `durationMs` of `url` from `offsetMs`, at `atMs` in the scene. */
export interface Segment {
  url: string;
  offsetMs: number;
  durationMs: number;
  atMs: number;
}

/** Whether a player with `role` voices `speaker`'s lines. */
export const speaks = (role: Role | null | undefined, speaker: Speaker) =>
  role === 'both' || role === speaker;

/**
 * How to play a performance. Everyone records over the whole scene, so a team's performance is
 * stitched: during each line, the recording of whoever voices that line (same timecodes as the
 * original). Lines nobody recorded stay silent. Classic performances play whole.
 */
export function performanceSegments(
  performance: Performance,
  lines: DialogueLine[] | undefined,
): Segment[] {
  const whole = performance.parts.every((p) => p.role === null) || !lines?.length;
  if (whole) {
    return performance.parts.map((p) => ({
      url: p.url,
      offsetMs: 0,
      durationMs: performance.durationMs,
      atMs: 0,
    }));
  }
  return lines.flatMap((line) => {
    const part = performance.parts.find((p) => speaks(p.role, line.speaker));
    return part
      ? [
          {
            url: part.url,
            offsetMs: line.startMs,
            durationMs: line.endMs - line.startMs,
            atMs: line.startMs,
          },
        ]
      : [];
  });
}

/** The line spoken at `ms` into the scene (if any), and the next one to come. */
export function lineAt(lines: DialogueLine[], ms: number) {
  const current = lines.find((l) => ms >= l.startMs && ms < l.endMs) ?? null;
  const next = lines.find((l) => l.startMs > ms) ?? null;
  return { current, next };
}

/** 16-bit PCM WAV of an AudioBuffer (what a stitched team performance is downloaded as). */
export function encodeWav(
  buffer: Pick<AudioBuffer, 'numberOfChannels' | 'sampleRate' | 'length' | 'getChannelData'>,
): Blob {
  const channels = buffer.numberOfChannels;
  const bytes = 44 + buffer.length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (at: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, buffer.length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (const channel of data) {
      const s = Math.max(-1, Math.min(1, channel[i]!));
      view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
