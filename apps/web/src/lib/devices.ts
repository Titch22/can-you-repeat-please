import { create } from 'zustand';

const KEY = 'cyrp.audioInput';
const BOOST_KEY = 'cyrp.micBoost';
export const MIN_MIC_BOOST = 1;
export const MAX_MIC_BOOST = 4;

/**
 * The player's microphones, which one they picked (null = the browser's default), and how
 * much their voice is amplified for the others (1–4).
 */
export const useDevices = create<{
  inputs: MediaDeviceInfo[];
  inputId: string | null;
  micBoost: number;
}>(() => ({
  inputs: [],
  inputId: savedInputId(),
  micBoost: savedMicBoost(),
}));

/** A boost value made safe: a number within [1, 4], 1 otherwise. */
export function clampBoost(value: unknown) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n)
    ? Math.min(MAX_MIC_BOOST, Math.max(MIN_MIC_BOOST, n))
    : MIN_MIC_BOOST;
}

function savedMicBoost() {
  try {
    return clampBoost(localStorage.getItem(BOOST_KEY) ?? undefined);
  } catch {
    return MIN_MIC_BOOST;
  }
}

export function setMicBoost(value: number) {
  const micBoost = clampBoost(value);
  try {
    localStorage.setItem(BOOST_KEY, String(micBoost));
  } catch {
    // not remembered, that's fine
  }
  useDevices.setState({ micBoost });
}

export function savedInputId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveInputId(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the choice just won't be remembered
  }
  useDevices.setState({ inputId: id });
}

/** The saved mic if it's still plugged in, otherwise undefined (= browser default). */
export function pickInput(saved: string | null, available: { deviceId: string }[]) {
  return saved && available.some((d) => d.deviceId === saved) ? saved : undefined;
}

/** Re-reads the mic list. Labels are only filled in once the mic permission was granted. */
export async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    useDevices.setState({ inputs: all.filter((d) => d.kind === 'audioinput' && d.deviceId) });
  } catch {
    // ignore: the selector just stays as it was
  }
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  // A headset plugged in or out.
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices());
}
