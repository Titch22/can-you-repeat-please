import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  DialogueLinesSchema,
  fitWordStarts,
  TEAM_TAG,
  textWords,
  type DialogueLine,
  type LibrarySound,
  type Speaker,
  type TranscriptLanguage,
} from '@cyrp/shared';
import { preload, replay, replaySegments, stopReplay } from '../../lib/audio';
import { evenWordStarts, moveWordStart, wordAt, withText } from '../../lib/dialogue';
import {
  adminAlign,
  adminSetBackground,
  adminTranscribe,
  adminUpdate,
  LIBRARY_ERROR_TEXT,
} from '../../lib/library';
import { fillLineText, suggestLines, toTranscriptionInput } from '../../lib/transcribe';
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
  /** "Suggest text" or "Align words" running on the sounds service. */
  const [busy, setBusy] = useState<'suggest' | 'align' | null>(null);
  const [language, setLanguage] = useState<TranscriptLanguage>('french');
  // Seconds since the click, so a slow request visibly isn't stuck.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const frame = useRef(0);
  /** Where playback started, to read the exact position in event handlers (taps). */
  const clock = useRef({ from: 0, started: 0 });
  /** "Tap timing" in progress: the line, and the word starts tapped so far. */
  const tapping = useRef<{ line: number; starts: number[] } | null>(null);
  const [tapped, setTapped] = useState<number | null>(null); // words tapped, null when not tapping

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
    tapping.current = null;
    setTapped(null);
  };
  useEffect(() => stop, []);

  /** Plays `from`..`to` (ms) and moves the playhead along; `onEnd` runs if it plays to the end. */
  const play = (from: number, to = duration, onEnd?: () => void) => {
    stop();
    replaySegments([{ url: sound.url, offsetMs: from, durationMs: to - from, atMs: 0 }]);
    setPlaying(true);
    const started = performance.now();
    clock.current = { from, started };
    const tick = () => {
      const at = from + (performance.now() - started);
      if (at >= to) {
        setPlayhead(to);
        setPlaying(false);
        onEnd?.();
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
    const merged = { ...lines[i]!, ...patch };
    // Moving a line's edges keeps its word timings inside it.
    const line =
      'startMs' in patch || 'endMs' in patch
        ? {
            ...merged,
            wordStartsMs: fitWordStarts(merged.wordStartsMs, merged.startMs, merged.endMs),
          }
        : merged;
    update(
      lines.map((l, j) => (j === i ? line : l)),
      line,
    );
  };
  const addLine = (speaker: Speaker) => {
    const start = Math.round(playhead >= duration - 300 ? 0 : playhead);
    const nextStart = lines.find((l) => l.startMs > start)?.startMs ?? duration;
    const line = {
      startMs: start,
      endMs: Math.min(start + 1500, nextStart, duration),
      speaker,
      text: '',
      wordStartsMs: [],
    };
    update([...lines, line], line);
  };

  /**
   * Tap timing: plays the line; each tap (Space, Enter or the Tap button) starts the next word
   * at that moment. Words not tapped when the line ends share the time after the last tap.
   */
  const finishTap = () => {
    const tap = tapping.current;
    if (!tap) return;
    tapping.current = null;
    setTapped(null);
    const line = lines[tap.line]!;
    const words = textWords(line.text);
    const n = tap.starts.length;
    // The untapped words at an even pace after the last tapped one (or the whole line if none).
    const from = n ? tap.starts[n - 1]! : line.startMs;
    const tail = { ...line, startMs: from, text: words.slice(n ? n - 1 : 0).join(' ') };
    const rest = evenWordStarts(tail).slice(n ? 1 : 0);
    setLine(tap.line, {
      wordStartsMs: fitWordStarts([...tap.starts, ...rest], line.startMs, line.endMs),
    });
  };
  const startTap = (i: number) => {
    const line = lines[i]!;
    play(line.startMs, Math.min(line.endMs, duration), finishTap);
    tapping.current = { line: i, starts: [] };
    setTapped(0);
  };
  const tapWord = () => {
    const tap = tapping.current;
    if (!tap) return;
    tap.starts.push(Math.round(clock.current.from + (performance.now() - clock.current.started)));
    setTapped(tap.starts.length);
    // Every word tapped: done (the line keeps playing to its end).
    if (tap.starts.length === textWords(lines[tap.line]!.text).length) finishTap();
  };
  useEffect(() => {
    if (tapped === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); // no page scroll, no button press
        tapWord();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const check = DialogueLinesSchema.safeParse(lines);
  const outOfRange = lines.some((l) => l.endMs > duration);
  const problem = !check.success
    ? 'Lines must not overlap, and each must last at least 0.3s.'
    : outOfRange
      ? 'A line ends after the sound.'
      : null;
  const changed = JSON.stringify(lines) !== JSON.stringify(sound.lines);
  const hasBoth = lines.some((l) => l.speaker === 'A') && lines.some((l) => l.speaker === 'B');

  /**
   * Speech recognition (on the sounds service) fills the empty line texts, or proposes lines
   * when there are none. Not saved.
   */
  /** Runs `job` on the sound as the sounds service wants it (decoded, 16 kHz mono). */
  const withSamples = async (
    kind: 'suggest' | 'align',
    job: (samples: Float32Array<ArrayBuffer>) => Promise<void>,
  ) => {
    setBusy(kind);
    setElapsed(0);
    setError(null);
    try {
      await job(await toTranscriptionInput((await preload(sound.url)).buffer));
    } catch (err) {
      console.warn('[admin] could not decode the sound', err);
      setError('Could not decode this sound.');
    } finally {
      setBusy(null);
    }
  };

  /** Times the words of `base`'s lines from the audio (lines it can't align keep theirs). */
  const aligned = async (base: DialogueLine[], samples: Float32Array<ArrayBuffer>) => {
    const timed = base.filter((l) => l.text);
    if (!timed.length) return base;
    const result = await adminAlign(token, samples, language, timed);
    if (!result.ok) {
      setError(LIBRARY_ERROR_TEXT[result.error]);
      return base;
    }
    const starts = new Map(timed.map((l, i) => [l, result.value.wordStartsMs[i]]));
    return base.map((l) => {
      const s = starts.get(l);
      return s?.length ? { ...l, wordStartsMs: s } : l;
    });
  };

  /** "Align words": re-times every line's words, e.g. after editing texts by hand. */
  const alignWords = () =>
    withSamples('align', async (samples) => update(await aligned(lines, samples)));

  const suggest = () =>
    withSamples('suggest', async (samples) => {
      const result = await adminTranscribe(token, samples, language);
      if (!result.ok) setError(LIBRARY_ERROR_TEXT[result.error]);
      else if (result.value.length === 0) setError('No speech found in this sound.');
      else {
        const words = result.value;
        const filled = lines.length ? fillLineText(lines, words) : suggestLines(words, duration);
        // Whisper's word timings are rough: the aligner places the words more precisely.
        update(await aligned(filled, samples));
      }
    });

  const save = async (patch: { lines?: DialogueLine[]; tags?: string[] }) => {
    setSaving(true);
    setError(null);
    const result = await adminUpdate(token, sound.id, patch);
    setSaving(false);
    if (result.ok) onChanged(result.value);
    else setError(LIBRARY_ERROR_TEXT[result.error]);
  };

  const setBackground = async (file: File | null) => {
    setSaving(true);
    setError(null);
    const result = await adminSetBackground(token, sound.id, file);
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
              <input
                type="text"
                value={l.text}
                maxLength={200}
                placeholder="What is said (subtitle)"
                aria-label={`Line ${i + 1} text`}
                onChange={(e) => setLine(i, withText(l, e.target.value))}
                className="min-w-40 flex-1 rounded-md border border-line-strong bg-surface-sunken px-2 py-0.5 text-ink"
              />
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

      {selected !== null && lines[selected]?.text && (
        <WordTiming
          line={lines[selected]}
          playhead={playhead}
          tapped={tapped}
          onMove={(word) =>
            setLine(selected, { wordStartsMs: moveWordStart(lines[selected]!, word, playhead) })
          }
          onTap={() => (tapped === null ? startTap(selected) : tapWord())}
          onEven={() => setLine(selected, { wordStartsMs: [] })}
        />
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
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as TranscriptLanguage)}
          aria-label="Language spoken in the sound"
          className="rounded-md border border-line-strong bg-surface-sunken px-2 py-1 text-sm text-ink"
        >
          <option value="french">French</option>
          <option value="english">English</option>
        </select>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void suggest()}
          title={
            lines.length
              ? 'Fill the empty line texts with what is said (speech recognition)'
              : 'Propose lines from what is said (speech recognition)'
          }
        >
          {busy === 'suggest' ? `Listening… ${elapsed}s` : 'Suggest text'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null || !lines.some((l) => l.text)}
          onClick={() => void alignWords()}
          title="Time every word from the audio, for the texts as they are now (replaces the word timings)"
        >
          {busy === 'align' ? `Aligning… ${elapsed}s` : 'Align words'}
        </Button>
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
      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Background (no voices)</span>
          {sound.backgroundUrl ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => replay(sound.backgroundUrl!)}>
                ▶ Play
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => backgroundInput.current?.click()}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={saving}
                onClick={() => void setBackground(null)}
              >
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => backgroundInput.current?.click()}
            >
              Upload
            </Button>
          )}
          <input
            ref={backgroundInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void setBackground(file);
            }}
          />
        </div>
        <p className="text-xs text-subtle">
          Played under the players' voices when the teams are played back. Same length as the sound.
          Make it with UVR, or <code>demucs --two-stems=vocals clip.wav</code> and upload{' '}
          <code>no_vocals.wav</code>.
        </p>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/**
 * The selected line's words, for the karaoke timing: the word under the playhead lights up,
 * clicking a word starts it at the playhead, and "Tap timing" times them all while listening.
 */
function WordTiming({
  line,
  playhead,
  tapped,
  onMove,
  onTap,
  onEven,
}: {
  line: DialogueLine;
  playhead: number;
  /** Words tapped so far, null when not tapping. */
  tapped: number | null;
  onMove: (word: number) => void;
  onTap: () => void;
  onEven: () => void;
}) {
  const words = textWords(line.text);
  const starts = line.wordStartsMs.length ? line.wordStartsMs : evenWordStarts(line);
  // While tapping: the word just tapped (being said).
  const current = tapped !== null ? tapped - 1 : wordAt(line, playhead);
  return (
    <div className="flex flex-col gap-2 rounded-md bg-surface-raised/50 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Karaoke timing</span>
        <span className="text-muted">
          {line.wordStartsMs.length ? 'word by word' : 'even pace (not timed yet)'}
        </span>
        <Button size="sm" variant={tapped === null ? 'secondary' : 'primary'} onClick={onTap}>
          {tapped === null ? '▶ Tap timing' : `Tap! (${tapped}/${words.length})`}
        </Button>
        {line.wordStartsMs.length > 0 && tapped === null && (
          <Button size="sm" variant="ghost" onClick={onEven}>
            Even pace
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {words.map((word, k) => (
          <button
            key={k}
            type="button"
            disabled={tapped !== null}
            onClick={() => onMove(k)}
            title={`Starts at ${sec(starts[k]!)}s. Click: start it at the playhead (${sec(playhead)}s)`}
            className={`rounded-md border px-1.5 py-0.5 tabular-nums transition ${
              k === current
                ? 'border-accent bg-accent text-accent-ink'
                : tapped !== null && k < tapped
                  ? 'border-line-strong text-ink'
                  : 'border-line text-muted enabled:hover:border-accent/60'
            }`}
          >
            {word}
            <span className="ml-1 text-[0.7em] opacity-70">{sec(starts[k]!)}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-subtle">
        {tapped === null
          ? 'Tap timing plays the line: press Space (or Tap!) as each word starts. Or pause the playhead where a word starts and click it.'
          : 'Press Space as each word starts. Esc cancels.'}
      </p>
    </div>
  );
}
