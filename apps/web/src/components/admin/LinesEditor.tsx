import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  DialogueLinesSchema,
  TEAM_TAG,
  type DialogueLine,
  type LibrarySound,
  type Speaker,
} from '@cyrp/shared';
import { preload, replaySegments, stopReplay } from '../../lib/audio';
import { adminUpdate, LIBRARY_ERROR_TEXT } from '../../lib/library';
import { RoleBadge } from '../game/teams';
import { Button, ErrorText } from '../ui';

const SPEAKER_BAND: Record<Speaker, string> = {
  A: 'bg-speaker-a/35 border-speaker-a',
  B: 'bg-speaker-b/35 border-speaker-b',
};
const sec = (ms: number) => (ms / 1000).toFixed(1);
const sorted = (lines: DialogueLine[]) => [...lines].sort((a, b) => a.startMs - b.startMs);

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

/**
 * Marks who speaks when in a dialogue (Teams mode): waveform with the lines as A / B bands,
 * a playhead to listen and mark, and exact start / end inputs per line.
 */
export function LinesEditor({
  sound,
  token,
  onChanged,
}: {
  sound: LibrarySound;
  token: string;
  onChanged: (s: LibrarySound) => void;
}) {
  const duration = sound.durationMs;
  const [lines, setLines] = useState<DialogueLine[]>(sound.lines);
  const [selected, setSelected] = useState<number | null>(sound.lines.length ? 0 : null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);

  // Waveform.
  useEffect(() => {
    let cancelled = false;
    void preload(sound.url).then(({ buffer }) => {
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
    });
    return () => {
      cancelled = true;
    };
  }, [sound.url]);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    stopReplay();
    setPlaying(false);
  };
  useEffect(() => stop, []);

  /** Plays `from`..`to` (ms) and moves the playhead along. */
  const play = (from: number, to = duration) => {
    stop();
    replaySegments([{ url: sound.url, offsetMs: from, durationMs: to - from, atMs: 0 }]);
    setPlaying(true);
    const started = performance.now();
    const tick = () => {
      const at = from + (performance.now() - started);
      if (at >= to) {
        setPlayhead(to);
        setPlaying(false);
        return;
      }
      setPlayhead(at);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const seek = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const at = Math.round(((e.clientX - box.left) / box.width) * duration);
    if (playing) play(at);
    else setPlayhead(at);
  };

  const update = (next: DialogueLine[], select?: DialogueLine) => {
    const ordered = sorted(next);
    setLines(ordered);
    if (select) setSelected(ordered.indexOf(select));
    setError(null);
  };
  const setLine = (i: number, patch: Partial<DialogueLine>) => {
    const line = { ...lines[i]!, ...patch };
    update(
      lines.map((l, j) => (j === i ? line : l)),
      line,
    );
  };
  const addLine = (speaker: Speaker) => {
    const start = Math.round(playhead >= duration - 300 ? 0 : playhead);
    const nextStart = lines.find((l) => l.startMs > start)?.startMs ?? duration;
    const line = { startMs: start, endMs: Math.min(start + 1500, nextStart, duration), speaker };
    update([...lines, line], line);
  };

  const check = DialogueLinesSchema.safeParse(lines);
  const outOfRange = lines.some((l) => l.endMs > duration);
  const problem = !check.success
    ? 'Lines must not overlap, and each must last at least 0.3s.'
    : outOfRange
      ? 'A line ends after the sound.'
      : null;
  const changed = JSON.stringify(lines) !== JSON.stringify(sound.lines);
  const hasBoth = lines.some((l) => l.speaker === 'A') && lines.some((l) => l.speaker === 'B');

  const save = async (patch: { lines?: DialogueLine[]; tags?: string[] }) => {
    setSaving(true);
    setError(null);
    const result = await adminUpdate(token, sound.id, patch);
    setSaving(false);
    if (result.ok) onChanged(result.value);
    else setError(LIBRARY_ERROR_TEXT[result.error]);
  };

  return (
    <div className="flex flex-col gap-3 rounded-control border border-line bg-surface-sunken/50 p-3">
      <div
        className="relative h-20 cursor-crosshair overflow-hidden rounded-md bg-surface-sunken"
        onClick={seek}
        role="presentation"
      >
        <canvas ref={canvas} className="absolute inset-0 size-full text-slate-500" />
        {lines.map((l, i) => (
          <div
            key={i}
            className={`absolute inset-y-0 border-x-2 ${SPEAKER_BAND[l.speaker]} ${
              i === selected ? 'ring-2 ring-ink ring-inset' : ''
            }`}
            style={{
              left: `${(l.startMs / duration) * 100}%`,
              width: `${((l.endMs - l.startMs) / duration) * 100}%`,
            }}
          >
            <span className="absolute top-1 left-1">
              <RoleBadge role={l.speaker} />
            </span>
          </div>
        ))}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-accent"
          style={{ left: `${(playhead / duration) * 100}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => (playing ? stop() : play(playhead))}>
          {playing ? '■ Stop' : '▶ Play'}
        </Button>
        <span className="w-16 text-sm text-muted tabular-nums">{sec(playhead)}s</span>
        <Button size="sm" variant="ghost" onClick={() => addLine('A')}>
          + <RoleBadge role="A" /> line
        </Button>
        <Button size="sm" variant="ghost" onClick={() => addLine('B')}>
          + <RoleBadge role="B" /> line
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={selected === null}
          onClick={() => setLine(selected!, { startMs: Math.round(playhead) })}
          title="Set the selected line's start to the playhead"
        >
          Mark start
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={selected === null}
          onClick={() => setLine(selected!, { endMs: Math.round(playhead) })}
          title="Set the selected line's end to the playhead"
        >
          Mark end
        </Button>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-muted">
          No lines yet. Play the scene, pause where a character starts talking, and add a line.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((l, i) => (
            <li
              key={i}
              onClick={() => setSelected(i)}
              className={`flex flex-wrap items-center gap-2 rounded-md px-2 py-1 text-sm ${
                i === selected ? 'bg-surface-raised' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => setLine(i, { speaker: l.speaker === 'A' ? 'B' : 'A' })}
                title="Switch character"
                aria-label={`Line ${i + 1}: character ${l.speaker}, click to switch`}
              >
                <RoleBadge role={l.speaker} />
              </button>
              {(['startMs', 'endMs'] as const).map((field) => (
                <label key={field} className="flex items-center gap-1 text-muted">
                  {field === 'startMs' ? 'from' : 'to'}
                  <input
                    type="number"
                    step={0.1}
                    min={0}
                    max={duration / 1000}
                    value={sec(l[field])}
                    onChange={(e) =>
                      setLine(i, { [field]: Math.round(Number(e.target.value) * 1000) })
                    }
                    className="w-20 rounded-md border border-line-strong bg-surface-sunken px-2 py-0.5 text-ink tabular-nums"
                  />
                  s
                </label>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => play(l.startMs, Math.min(l.endMs, duration))}
              >
                ▶ Line
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  update(lines.filter((_, j) => j !== i));
                  setSelected(null);
                }}
                aria-label={`Delete line ${i + 1}`}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!changed || !!problem || saving}
          onClick={() => void save({ lines })}
        >
          Save lines
        </Button>
        {changed && (
          <Button size="sm" variant="ghost" onClick={() => update(sound.lines)}>
            Revert
          </Button>
        )}
        {problem && <span className="text-sm text-danger">{problem}</span>}
        {!problem && lines.length > 0 && !hasBoth && (
          <span className="text-sm text-muted">A dialogue needs lines for both A and B.</span>
        )}
      </div>
      {hasBoth && !sound.tags.includes(TEAM_TAG) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          Add the “{TEAM_TAG}” tag to use it in Teams mode.
          <Button
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => void save({ tags: [...sound.tags, TEAM_TAG] })}
          >
            Add “{TEAM_TAG}”
          </Button>
        </p>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
