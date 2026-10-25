import { useEffect, useRef } from 'react';
import { preload } from '../lib/audio';

/** Peak per column of the first channel, 0..1. */
function peaks(buffer: AudioBuffer, columns: number) {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / columns));
  return Array.from({ length: columns }, (_, c) => {
    let max = 0;
    for (let i = c * step; i < Math.min(data.length, (c + 1) * step); i++) {
      max = Math.max(max, Math.abs(data[i]!));
    }
    return max;
  });
}

/** The waveform of `url`, filling its (positioned) parent. */
export function Waveform({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void preload(url).then(
      ({ buffer }) => {
        const el = canvas.current;
        if (cancelled || !el) return;
        const ratio = window.devicePixelRatio || 1;
        el.width = el.clientWidth * ratio;
        el.height = el.clientHeight * ratio;
        const g = el.getContext('2d')!;
        g.fillStyle = getComputedStyle(el).color;
        const cols = Math.floor(el.width / (2 * ratio));
        peaks(buffer, cols).forEach((p, i) => {
          const h = Math.max(1, p * el.height);
          g.fillRect(i * 2 * ratio, (el.height - h) / 2, ratio, h);
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return <canvas ref={canvas} className="absolute inset-0 size-full text-slate-500" />;
}
