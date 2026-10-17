import { useEffect, useRef, useState } from 'react';
import { useDevices } from '../lib/devices';
import { audioContext } from '../lib/audio';
import { getMicStream, onMicChange } from '../lib/mic';
import { THRESHOLD, createLevelMeter, type LevelMeter } from '../lib/levelMeter';

const HOLD_MS = 300;
/** Same cadence as speaking.ts. A timer, not requestAnimationFrame, which pauses in hidden tabs. */
const TICK_MS = 50;

/**
 * Live level of the player's own mic (0–1) and whether it picks up sound.
 * Reads the shared mic stream itself, not the voice track, so it also works while muted.
 */
export function useMicLevel(enabled = true) {
  const [state, setState] = useState({ level: 0, detected: false });
  const [version, setVersion] = useState(0);
  // Show what the others hear: the level after the player's mic boost.
  const boost = useDevices((s) => s.micBoost);
  const boostRef = useRef(boost);
  useEffect(() => {
    boostRef.current = boost;
  }, [boost]);

  // Rebuild when the player switches mic.
  useEffect(() => onMicChange(() => setVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let meter: LevelMeter | null = null;

    void getMicStream()
      .then((stream) => {
        if (stopped) return;
        meter = createLevelMeter(audioContext(), stream);
        const m = meter;
        let smoothed = 0;
        let lastLoud = 0;
        let shown = { level: -1, detected: false };

        const tick = () => {
          const read = m.read();
          const latest = Math.min(1, read.latest * boostRef.current);
          const peak = read.peak * boostRef.current;
          // Fast attack, slow release: readable without flicker (decay tuned for 50 ms ticks).
          smoothed = latest > smoothed ? latest : smoothed * 0.7 + latest * 0.3;
          const now = performance.now();
          if (peak > THRESHOLD) lastLoud = now;
          const next = {
            level: Math.round(Math.min(1, smoothed * 5) * 50) / 50,
            detected: now - lastLoud < HOLD_MS,
          };
          // Re-render only when something visible changes.
          if (next.level !== shown.level || next.detected !== shown.detected) {
            shown = next;
            setState(next);
          }
        };
        timer = setInterval(tick, TICK_MS);
      })
      .catch(() => {
        // no mic access: the level stays at 0 (the voice bar already explains why)
      });

    return () => {
      stopped = true;
      clearInterval(timer);
      meter?.disconnect();
    };
  }, [enabled, version]);

  return state;
}
