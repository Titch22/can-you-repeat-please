import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { MAX_CUSTOM_SOUND_MS, SoundLabelSchema } from '@cyrp/shared';
import { forgetAudio, preload, renderSegments, replaySegments, stopReplay } from '../lib/audio';
import { fits, initialCrop, keepsOriginal, moveCrop, shiftCrop, type Crop } from '../lib/crop';
import { Button, ErrorText, inputClass } from './ui';
import { Waveform } from './Waveform';

const sec = (ms: number) => (ms / 1000).toFixed(1);

/**
 * Pick the part of a sound to keep and name it, before it's uploaded: any length while
 * editing, 20 s max to be added. The kept part
 * is rendered as a WAV in the browser; a whole sound that already fits is sent as it is.
 * `onAdd` uploads it and answers an error message, or null when it's done.
 */
export function CropEditor({
  source,
  label: initialLabel,
  position,
  onAdd,
  onSkip,
  onCancelAll,
}: {
  source: Blob;
  label: string;
  /** "2 of 5" when several sounds go through the editor in turn. */
  position?: string;
  onAdd: (file: Blob, label: string) => Promise<string | null>;
  onSkip: () => void;
  onCancelAll?: () => void;
}) {
  /** The decoded sound: its temporary URL (for playback and rendering) and length. */
  const [sound, setSound] = useState<{ url: string; duration: number } | null>(null);
  const url = sound?.url ?? '';
  const duration = sound?.duration ?? null;
  const [crop, setCrop] = useState<Crop>({ startMs: 0, endMs: 0 });
  const [label, setLabel] = useState(initialLabel.trim().slice(0, 40) || 'Sound');
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef(0);
  /** What the pointer drags: an edge, or the whole selection (from where it was grabbed). */
  const dragging = useRef<keyof Crop | { from: number; crop: Crop } | null>(null);

  // Created and released here (dev mode mounts twice): the decoded sound can be big.
  useEffect(() => {
    let live = true;
    const blobUrl = URL.createObjectURL(source);
    preload(blobUrl).then(
      ({ buffer }) => {
        if (!live) return;
        const ms = Math.round(buffer.duration * 1000);
        setSound({ url: blobUrl, duration: ms });
        setCrop(initialCrop(ms));
      },
      () => live && setError('Not a supported audio file.'),
    );
    return () => {
      live = false;
      cancelAnimationFrame(frame.current);
      stopReplay();
      forgetAudio(blobUrl);
      URL.revokeObjectURL(blobUrl);
    };
  }, [source]);

  const stop = () => {
    cancelAnimationFrame(frame.current);
    stopReplay();
    setPlayhead(null);
  };
  const play = () => {
    stop();
    const { startMs, endMs } = crop;
    replaySegments([{ url, offsetMs: startMs, durationMs: endMs - startMs, atMs: 0 }]);
    const started = performance.now();
    const tick = () => {
      const at = startMs + (performance.now() - started);
      if (at >= endMs) return setPlayhead(null);
      setPlayhead(at);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const move = (edge: keyof Crop, ms: number) =>
    duration !== null && setCrop((c) => moveCrop(c, duration, edge, ms));
  /** Pointer on the waveform: grab the nearest edge and drag it. */
  const msAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return ((e.clientX - box.left) / box.width) * (duration ?? 0);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (duration === null) return;
    const ms = msAt(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    // Inside the selection, away from its edges (10 px): grab it whole.
    const edgeMs = (10 / e.currentTarget.getBoundingClientRect().width) * duration;
    if (ms > crop.startMs + edgeMs && ms < crop.endMs - edgeMs) {
      dragging.current = { from: ms, crop };
      return;
    }
    const edge = Math.abs(ms - crop.startMs) <= Math.abs(ms - crop.endMs) ? 'startMs' : 'endMs';
    dragging.current = edge;
    move(edge, ms);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || duration === null) return;
    if (typeof drag === 'string') move(drag, msAt(e));
    else setCrop(shiftCrop(drag.crop, duration, msAt(e) - drag.from));
  };

  const add = async () => {
    if (duration === null || !fits(crop)) return;
    stop();
    setBusy(true);
    setError(null);
    try {
      const length = crop.endMs - crop.startMs;
      const file = keepsOriginal(source.size, duration, crop)
        ? source
        : await renderSegments(
            [{ url, offsetMs: crop.startMs, durationMs: length, atMs: 0 }],
            length,
          );
      const problem = await onAdd(file, label.trim());
      if (problem) setError(problem);
    } catch {
      setError('Could not cut this sound.');
    } finally {
      setBusy(false);
    }
  };

  const pct = (ms: number) => `${duration ? (ms / duration) * 100 : 0}%`;
  const labelOk = SoundLabelSchema.safeParse(label).success;
  const length = crop.endMs - crop.startMs;

  return (
    <div className="flex flex-col gap-3" data-testid="crop-editor">
      {position && <p className="text-xs text-subtle">Sound {position}</p>}
      <div
        className="relative h-20 cursor-ew-resize touch-none overflow-hidden rounded-md bg-surface-sunken select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (dragging.current = null)}
        role="presentation"
        data-testid="crop-wave"
      >
        {duration !== null && <Waveform url={url} />}
        {duration !== null && (
          <>
            {/* Outside the kept part: dimmed. */}
            <div
              className="absolute inset-y-0 left-0 bg-black/60"
              style={{ width: pct(crop.startMs) }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-black/60"
              style={{ left: pct(crop.endMs) }}
            />
            <div
              className="absolute inset-y-0 cursor-grab border-x-4 border-accent bg-accent/15 active:cursor-grabbing"
              style={{ left: pct(crop.startMs), width: pct(length) }}
            >
              {/* The 10 px at each edge resize it (see onPointerDown): the resize cursor there. */}
              <div className="absolute inset-y-0 -left-1 w-2.5 cursor-ew-resize" />
              <div className="absolute inset-y-0 -right-1 w-2.5 cursor-ew-resize" />
            </div>
            {playhead !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink"
                style={{ left: pct(playhead) }}
              />
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          size="sm"
          variant="secondary"
          disabled={duration === null}
          onClick={() => (playhead === null ? play() : stop())}
        >
          {playhead === null ? '▶ Play' : '■ Stop'}
        </Button>
        {(['startMs', 'endMs'] as const).map((edge) => (
          <label key={edge} className="flex items-center gap-1 text-muted">
            {edge === 'startMs' ? 'from' : 'to'}
            <input
              type="number"
              step={0.1}
              min={0}
              max={(duration ?? 0) / 1000}
              value={sec(crop[edge])}
              disabled={duration === null}
              onChange={(e) => move(edge, Number(e.target.value) * 1000)}
              aria-label={edge === 'startMs' ? 'Start (seconds)' : 'End (seconds)'}
              className="w-20 rounded-md border border-line-strong bg-surface-sunken px-2 py-0.5 text-ink tabular-nums"
            />
            s
          </label>
        ))}
        <span
          className={`tabular-nums ${fits(crop) ? 'text-muted' : 'font-semibold text-danger'}`}
          data-testid="crop-length"
        >
          {sec(length)}s kept
          {fits(crop) ? '' : `: shorten it to ${MAX_CUSTOM_SOUND_MS / 1000}s or less`}
        </span>
      </div>

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={40}
        aria-label="Sound name"
        className={`${inputClass} w-full py-2`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void add()}
          disabled={!labelOk || busy || duration === null || !fits(crop)}
        >
          {busy ? 'Uploading…' : 'Add sound'}
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          {onCancelAll ? 'Skip' : 'Cancel'}
        </Button>
        {onCancelAll && (
          <Button variant="ghost" onClick={onCancelAll} disabled={busy}>
            Cancel the rest
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
