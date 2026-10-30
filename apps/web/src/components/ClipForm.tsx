import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MIN_DUB_CLIP_MS, SoundLabelSchema, youtubeId } from '@cyrp/shared';
import { addClip } from '../lib/actions';
import { errorMessage } from '../lib/errors';
import { embedPlayer, embedUrl, type YouTubePlayer } from '../lib/youtube';
import { Button, ErrorText, inputClass } from './ui';

const clock = (ms: number) => {
  const seconds = ms / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
};

/** Dub mode: anyone can add a YouTube clip to the room. Clips vanish with it, like uploads. */
export function ClipForm({ disabledReason }: { disabledReason?: string }) {
  const [link, setLink] = useState('');
  const id = youtubeId(link);
  return (
    <div className="flex flex-col gap-2 rounded-control border border-dashed border-line-strong bg-surface-sunken/40 p-3">
      <p className="text-sm text-muted">
        Paste a YouTube video, then pick the part to dub. Its captions show during the game, if it
        has some.
      </p>
      {disabledReason ? (
        <p className="text-sm text-muted">{disabledReason}</p>
      ) : (
        <>
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="YouTube link"
            className={`${inputClass} py-2`}
          />
          {link.trim() && !id && (
            <p className="text-sm text-danger" role="alert">
              That isn’t a link to a YouTube video.
            </p>
          )}
          {id && <ClipPicker key={id} id={id} onAdded={() => setLink('')} />}
        </>
      )}
    </div>
  );
}

/** The video with its usual controls: scrub to a moment, then mark where the clip starts and ends. */
function ClipPicker({ id, onAdded }: { id: string; onAdded: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [player, setPlayer] = useState<YouTubePlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const [startMs, setStartMs] = useState<number | null>(null);
  const [endMs, setEndMs] = useState<number | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(
    () =>
      embedPlayer(frame.current!, {
        onReady: setPlayer,
        onState: () => {},
        onError: () => setFailed(true),
      }),
    [],
  );

  const here = () => Math.round(player!.getCurrentTime() * 1000);
  const wholeVideo = () => {
    // YouTube may only know the length once the video has started.
    const durationMs = Math.round(player!.getDuration() * 1000);
    if (!durationMs) return setError('Play the video for a moment first.');
    setError(null);
    setStartMs(0);
    setEndMs(durationMs);
  };
  const length = startMs !== null && endMs !== null ? endMs - startMs : null;
  const lengthOk = length !== null && length >= MIN_DUB_CLIP_MS;
  const name = SoundLabelSchema.safeParse(label);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.success || !lengthOk) return;
    setSending(true);
    setError(null);
    const ack = await addClip({
      youtubeId: id,
      startMs: startMs!,
      endMs: endMs!,
      label: name.data,
    });
    setSending(false);
    if (ack.ok) onAdded();
    else setError(errorMessage(ack.error));
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <iframe
        ref={frame}
        title="Pick the clip"
        src={embedUrl(id, { controls: '1' })}
        allow="autoplay"
        // This site sends no referrer, and YouTube refuses to play without one (error 153).
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded-control bg-black"
        data-testid="clip-preview"
      />
      {failed ? (
        <p className="text-sm text-danger" role="alert">
          This video can’t be played here: its owner doesn’t allow it. Try another one.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!player}
              onClick={() => setStartMs(here())}
            >
              Start here
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!player}
              onClick={() => setEndMs(here())}
            >
              End here
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!player}
              onClick={wholeVideo}
            >
              Whole clip
            </Button>
            <span className="text-sm text-muted tabular-nums" data-testid="clip-times">
              {startMs === null ? '–' : clock(startMs)} → {endMs === null ? '–' : clock(endMs)}
            </span>
          </div>
          {length !== null && !lengthOk && (
            <p className="text-sm text-danger" role="alert">
              The end must come at least a second after the start.
            </p>
          )}
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={40}
              placeholder="Name of the clip"
              aria-label="Name of the clip"
              className={`${inputClass} min-w-0 flex-1 py-2`}
            />
            <Button type="submit" disabled={!lengthOk || !name.success || sending}>
              Add
            </Button>
          </div>
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </form>
  );
}
