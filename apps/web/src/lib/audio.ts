import { create } from 'zustand';
import { serverNow } from './clock';
import { encodeWav, type Segment } from './dialogue';
import { normalizationGain } from './loudness';
import { loadSession } from './storage';

/** True when the browser blocks game sound until the user clicks something (autoplay policy). */
export const useAudioUnlock = create(() => ({ blocked: false }));

let ctx: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;

/** One shared context: decoded buffers can be scheduled precisely with `start(when)`. */
export function audioContext() {
  if (!ctx) {
    ctx = new AudioContext();
    const c = ctx;
    const sync = () => useAudioUnlock.setState({ blocked: c.state === 'suspended' });
    c.addEventListener('statechange', sync);
    sync();
  }
  return ctx;
}

/**
 * Shared output limiter: normalization boosts quiet sounds, and their peaks must not clip.
 * A fast, hard compressor at -6 dB catches peaks without lowering the whole sound.
 */
function output() {
  const c = audioContext();
  if (!limiter) {
    limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;
    limiter.connect(c.destination);
  }
  return limiter;
}

/** Must be called from a click handler. */
export async function unlockAudio() {
  await audioContext().resume();
  useAudioUnlock.setState({ blocked: audioContext().state === 'suspended' });
}

/**
 * Fetches audio. Room audio (under /api) needs the session token, sent as a header: never in
 * the URL, where it would end up in logs and history. Library sounds are public.
 */
function fetchAudio(url: string, init?: RequestInit) {
  const token = url.startsWith('/api/') ? loadSession()?.sessionToken : undefined;
  return fetch(url, token ? { ...init, headers: { 'X-Session-Token': token } } : init);
}

/** Saves a room recording as "<name>.<ext>" (the server picks the extension). */
export async function downloadRecording(url: string, name: string) {
  const res = await fetchAudio(`${url}?download=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`download ${res.status}`);
  // Prefer the UTF-8 name (filename*), keep the ASCII fallback otherwise.
  const header = res.headers.get('content-disposition') ?? '';
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const fileName = utf8
    ? decodeURIComponent(utf8)
    : (/filename="([^"]+)"/.exec(header)?.[1] ?? name);
  saveBlob(await res.blob(), fileName);
}

/** A decoded sound and the gain that brings it to the common loudness (see loudness.ts). */
interface LoadedSound {
  buffer: AudioBuffer;
  gain: number;
}

const buffers = new Map<string, Promise<LoadedSound>>();

export function preload(url: string) {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetchAudio(url)
      .then((res) => {
        if (!res.ok) throw new Error(`audio ${res.status}: ${url}`);
        return res.arrayBuffer();
      })
      .then((data) => audioContext().decodeAudioData(data))
      .then((decoded) => {
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
          decoded.getChannelData(i),
        );
        return { buffer: decoded, gain: normalizationGain(channels, decoded.sampleRate) };
      });
    buffer.catch(() => buffers.delete(url)); // let a later call retry
    buffers.set(url, buffer);
  }
  return buffer;
}

export function clearAudioCache() {
  buffers.clear();
}

/**
 * Plays `url` when the server clock reaches `startsAt`, so everyone hears it together.
 * Joining late starts mid-sound. Returns a function that cancels or stops it.
 */
export function playAt(url: string, startsAt: number) {
  let source: AudioBufferSourceNode | null = null;
  let cancelled = false;
  void preload(url)
    .then(({ buffer, gain }) => {
      if (cancelled) return;
      const c = audioContext();
      if (c.state === 'suspended') void c.resume().catch(() => {});
      const delay = (startsAt - serverNow()) / 1000;
      if (delay < 0 && -delay >= buffer.duration) return;
      source = c.createBufferSource();
      source.buffer = buffer;
      const level = c.createGain();
      level.gain.value = gain;
      source.connect(level).connect(output());
      if (delay >= 0) source.start(c.currentTime + delay);
      else source.start(0, -delay);
    })
    .catch((err) => console.warn('[audio] playback failed', err));
  return () => {
    cancelled = true;
    try {
      source?.stop();
    } catch {
      // not started yet
    }
  };
}

let replaying: (() => void) | null = null;

/** Local replay (results, voting): stops any previous replay first. */
export function replay(url: string) {
  replaying?.();
  replaying = playAt(url, serverNow());
}

// ── Segments (performances, dialogue lines) ────────────────────────────────────

/** Short fades at each cut so stitched lines don't click. */
const FADE_S = 0.015;

/**
 * Schedules `segments` on `c`, the scene starting at context time `t0`. Segments already
 * under way start mid-way; finished ones are skipped. Returns the created sources.
 */
function scheduleSegments(
  c: BaseAudioContext,
  destination: AudioNode,
  segments: Segment[],
  loaded: Map<string, LoadedSound>,
  t0: number,
) {
  const sources: AudioBufferSourceNode[] = [];
  for (const seg of segments) {
    const sound = loaded.get(seg.url);
    if (!sound) continue;
    let start = t0 + seg.atMs / 1000;
    let offset = seg.offsetMs / 1000;
    // A recording can be a bit shorter than the scene.
    let duration = Math.min(seg.durationMs / 1000, sound.buffer.duration - offset);
    if (start < c.currentTime) {
      const late = c.currentTime - start;
      start += late;
      offset += late;
      duration -= late;
    }
    if (duration <= 0) continue;
    const source = c.createBufferSource();
    source.buffer = sound.buffer;
    const level = c.createGain();
    const fade = Math.min(FADE_S, duration / 4);
    level.gain.setValueAtTime(0, start);
    level.gain.linearRampToValueAtTime(sound.gain, start + fade);
    level.gain.setValueAtTime(sound.gain, start + duration - fade);
    level.gain.linearRampToValueAtTime(0, start + duration);
    source.connect(level).connect(destination);
    source.start(start, offset, duration);
    sources.push(source);
  }
  return sources;
}

async function loadAll(segments: Segment[]) {
  const urls = [...new Set(segments.map((s) => s.url))];
  const sounds = await Promise.all(urls.map((u) => preload(u)));
  return new Map(urls.map((u, i) => [u, sounds[i]!]));
}

/**
 * Plays `segments` with the scene starting when the server clock reaches `startsAt`, so
 * everyone hears it together. Returns a function that cancels or stops it.
 */
export function playSegmentsAt(segments: Segment[], startsAt: number) {
  let sources: AudioBufferSourceNode[] = [];
  let cancelled = false;
  void loadAll(segments)
    .then((loaded) => {
      if (cancelled) return;
      const c = audioContext();
      if (c.state === 'suspended') void c.resume().catch(() => {});
      const t0 = c.currentTime + (startsAt - serverNow()) / 1000;
      sources = scheduleSegments(c, output(), segments, loaded, t0);
    })
    .catch((err) => console.warn('[audio] playback failed', err));
  return () => {
    cancelled = true;
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // not started yet
      }
    }
  };
}

/** Local replay of segments: stops any previous replay first. */
export function replaySegments(segments: Segment[]) {
  replaying?.();
  replaying = playSegmentsAt(segments, serverNow());
}

/** Stops the current local replay, if any. */
export function stopReplay() {
  replaying?.();
  replaying = null;
}

/** Renders `segments` (a scene of `durationMs`) to a WAV file, e.g. to download a performance. */
export async function renderSegments(segments: Segment[], durationMs: number) {
  const loaded = await loadAll(segments);
  const rate = 44_100;
  const offline = new OfflineAudioContext(1, Math.ceil((durationMs / 1000) * rate), rate);
  const limit = offline.createDynamicsCompressor();
  limit.threshold.value = -6;
  limit.knee.value = 0;
  limit.ratio.value = 20;
  limit.connect(offline.destination);
  scheduleSegments(offline, limit, segments, loaded, 0);
  return encodeWav(await offline.startRendering());
}

/** Saves `blob` as `name` through a temporary link. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
