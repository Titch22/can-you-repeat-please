import { create } from 'zustand';

/** The parts of YouTube's IFrame Player API the game uses. */
export interface YouTubePlayer {
  mute(): void;
  unMute(): void;
  setVolume(percent: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getDuration(): number;
}

interface YouTubeApi {
  Player: new (
    frame: HTMLIFrameElement,
    options: {
      events: {
        onReady(): void;
        onStateChange(e: { data: number }): void;
        onError(): void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PLAYING = 1;

let api: Promise<YouTubeApi> | null = null;

function loadYouTube() {
  api ??= new Promise<YouTubeApi>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      api = null; // let a later call retry
      reject(new Error('YouTube unreachable'));
    };
    document.head.append(script);
  });
  return api;
}

export const embedUrl = (id: string, params: Record<string, string>) =>
  `https://www.youtube-nocookie.com/embed/${id}?${new URLSearchParams({
    enablejsapi: '1',
    origin: location.origin,
    playsinline: '1',
    rel: '0',
    ...params,
  })}`;

/**
 * Connects to a player in `frame` (src from embedUrl). `onError`: the video can't be played here
 * (embedding disabled, removed…) or YouTube is unreachable. Returns a function that disconnects.
 */
export function embedPlayer(
  frame: HTMLIFrameElement,
  events: { onReady(player: YouTubePlayer): void; onState(state: number): void; onError(): void },
) {
  let live = true;
  loadYouTube().then(
    (YT) => {
      if (!live) return;
      const player = new YT.Player(frame, {
        events: {
          onReady: () => live && events.onReady(player),
          onStateChange: (e) => live && events.onState(e.data),
          onError: () => live && events.onError(),
        },
      });
    },
    () => live && events.onError(),
  );
  return () => {
    live = false;
  };
}

/**
 * Dub mode: when the clip scheduled at `startsAt` really began on this device, in server time.
 * A video starts when it can (buffering, an ad), so voices are placed from this, not `startsAt`.
 */
export const useDubScene = create(() => ({ startsAt: 0, sceneStartsAt: 0 }));
