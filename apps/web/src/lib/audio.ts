import { create } from 'zustand';
import { serverNow } from './clock';
import { loadSession } from './storage';

/** True when the browser blocks game sound until the user clicks something (autoplay policy). */
export const useAudioUnlock = create(() => ({ blocked: false }));

let ctx: AudioContext | null = null;

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

/** Must be called from a click handler. */
export async function unlockAudio() {
  await audioContext().resume();
  useAudioUnlock.setState({ blocked: audioContext().state === 'suspended' });
}

/** Room audio under /api needs the session token; <audio>-style requests can't send headers. */
export function authUrl(url: string) {
  if (!url.startsWith('/api/')) return url;
  const token = loadSession()?.sessionToken;
  return token ? `${url}?t=${encodeURIComponent(token)}` : url;
}

/** Link that saves a room recording as "<name>.<ext>" (the server picks the extension). */
export function downloadUrl(url: string, name: string) {
  return `${authUrl(url)}&download=${encodeURIComponent(name)}`;
}

const buffers = new Map<string, Promise<AudioBuffer>>();

export function preload(url: string) {
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(authUrl(url))
      .then((res) => {
        if (!res.ok) throw new Error(`audio ${res.status}: ${url}`);
        return res.arrayBuffer();
      })
      .then((data) => audioContext().decodeAudioData(data));
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
    .then((buffer) => {
      if (cancelled) return;
      const c = audioContext();
      if (c.state === 'suspended') void c.resume().catch(() => {});
      const delay = (startsAt - serverNow()) / 1000;
      if (delay < 0 && -delay >= buffer.duration) return;
      source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(c.destination);
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
