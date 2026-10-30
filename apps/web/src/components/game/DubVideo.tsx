import { useEffect, useRef, useState } from 'react';
import type { SoundRef } from '@cyrp/shared';
import { serverNow } from '../../lib/clock';
import { useDevices } from '../../lib/devices';
import { embedPlayer, embedUrl, PLAYING, useDubScene, type YouTubePlayer } from '../../lib/youtube';

/** Browsers refuse sound before a first click: past this wait, play muted rather than not at all. */
const SOUND_WAIT_MS = 1500;
/** Still no video (an ad, no network): the scene starts anyway, so the voices aren't lost. */
const GIVE_UP_MS = 4000;

/**
 * Dub mode's video: one player for the whole round, playing the clip at each `startsAt` (none:
 * it waits). It decides when the scene really starts, see useDubScene. YouTube's captions show
 * inside the player.
 */
export function DubVideo({
  video,
  durationMs,
  startsAt,
  muted,
}: {
  video: NonNullable<SoundRef['video']>;
  durationMs: number;
  startsAt: number | null;
  muted: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [player, setPlayer] = useState<YouTubePlayer | null>(null);
  const [failed, setFailed] = useState(false);
  const onPlaying = useRef<(() => void) | null>(null);

  useEffect(
    () =>
      embedPlayer(frame.current!, {
        onReady: setPlayer,
        onState: (state) => {
          if (state === PLAYING) onPlaying.current?.();
        },
        onError: () => setFailed(true),
      }),
    [],
  );

  useEffect(() => {
    if (startsAt === null) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => timers.push(setTimeout(fn, Math.max(0, ms)));
    const wait = startsAt - serverNow();
    let started = false;
    // shortcut: set once per play, so a video that buffers mid-clip drifts from the voices;
    // re-sync on each PLAYING if players notice.
    const start = (sceneStartsAt: number) => {
      if (started) return;
      started = true;
      useDubScene.setState({ startsAt, sceneStartsAt });
      if (player) after(sceneStartsAt + durationMs - serverNow(), () => player.pauseVideo());
    };

    after(failed ? wait : wait + GIVE_UP_MS, () => start(startsAt));
    const late = Math.max(0, -wait);
    if (player && !failed && late < durationMs) {
      // The video is already a bit past the seek when it reports playing: read where it is.
      onPlaying.current = () =>
        start(serverNow() - (player.getCurrentTime() * 1000 - video.startMs));
      after(wait, () => {
        if (muted) player.mute();
        else {
          player.unMute();
          player.setVolume(useDevices.getState().soundsVolume * 100);
        }
        player.seekTo((video.startMs + late) / 1000, true);
        player.playVideo();
      });
      if (!muted) {
        after(wait + SOUND_WAIT_MS, () => {
          if (started) return;
          player.mute();
          player.playVideo();
        });
      }
    }
    return () => {
      onPlaying.current = null;
      timers.forEach(clearTimeout);
      player?.pauseVideo();
    };
  }, [player, failed, startsAt, muted, durationMs, video.startMs]);

  return (
    <div className="mx-auto mt-3 w-full max-w-xl">
      {/* No controls and no clicks: everyone sees the same clip, nobody can pause it. */}
      <iframe
        ref={frame}
        title="The clip to dub"
        src={embedUrl(video.youtubeId, {
          start: String(Math.floor(video.startMs / 1000)),
          controls: '0',
          disablekb: '1',
          cc_load_policy: '1',
          cc_lang_pref: navigator.language.slice(0, 2),
        })}
        allow="autoplay"
        // This site sends no referrer, and YouTube refuses to play without one (error 153).
        referrerPolicy="strict-origin-when-cross-origin"
        className="pointer-events-none aspect-video w-full rounded-control bg-black"
        data-testid="dub-video"
      />
      {failed && (
        <p className="mt-2 text-sm text-danger" role="alert">
          This video can’t be played here. The round goes on without it.
        </p>
      )}
    </div>
  );
}
