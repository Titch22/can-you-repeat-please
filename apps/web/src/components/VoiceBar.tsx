import { debugSetVoiceMuted } from '../lib/actions';
import { enableAudio, setMicWanted, useVoice, type VoiceStatus } from '../lib/voice';
import { useState } from 'react';
import { HeadphonesIcon, MicIcon, MicOffIcon, SlidersIcon } from './icons';
import { MicLevel, MicSettings } from './MicSettings';
import { Button } from './ui';

const STATUS: Record<VoiceStatus, { label: string; dot: string }> = {
  idle: { label: 'Voice off', dot: 'bg-slate-500' },
  connecting: { label: 'Joining voice…', dot: 'bg-amber-400 animate-pulse' },
  connected: { label: 'Voice connected', dot: 'bg-emerald-400' },
  reconnecting: { label: 'Voice reconnecting…', dot: 'bg-amber-400 animate-pulse' },
  error: { label: 'Voice unavailable', dot: 'bg-rose-500' },
};

export function VoiceBar({
  gameMuted,
  amHost,
  compact = false,
}: {
  gameMuted: boolean;
  amHost: boolean;
  /** In-game: just status and mute, no hints or dev tools. */
  compact?: boolean;
}) {
  const { status, micWanted, micOn, micBlocked, audioBlocked } = useVoice();
  const s = STATUS[status];
  const [settingsOpen, setSettingsOpen] = useState(loadSettingsOpen);
  const toggleSettings = () => {
    setSettingsOpen(!settingsOpen);
    saveSettingsOpen(!settingsOpen);
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-sm" data-testid="voice-status">
          <span className={`size-2.5 rounded-full ${s.dot}`} aria-hidden />
          {s.label}
        </span>
        <span className="flex-1" />
        {!micBlocked && <MicLevel muted={!micWanted || gameMuted} />}
        <Button
          variant="ghost"
          className="flex items-center gap-2 px-3 py-2 text-sm"
          onClick={toggleSettings}
          aria-expanded={settingsOpen}
        >
          <SlidersIcon className="size-4" />
          Mic settings
        </Button>
        <Button
          variant={micWanted ? 'secondary' : 'danger'}
          className="flex items-center gap-2 py-2"
          onClick={() => setMicWanted(!micWanted)}
          aria-pressed={!micWanted}
          disabled={status !== 'connected'}
        >
          {micWanted ? <MicIcon /> : <MicOffIcon />}
          {micWanted ? 'Mute' : 'Unmute'}
        </Button>
      </div>

      {settingsOpen && <MicSettings locked={gameMuted} />}
      {audioBlocked && <Button onClick={() => void enableAudio()}>Click to hear the others</Button>}
      {micBlocked && (
        <p className="text-sm text-rose-300">
          Microphone unavailable. Allow mic access in your browser to talk and play; you can still
          listen.
        </p>
      )}
      {status === 'error' && (
        <p className="text-sm text-rose-300">
          Could not reach the voice server. The game still works without voice.
        </p>
      )}
      {!compact && (
        <p className="flex items-center gap-2 text-xs text-slate-400">
          <HeadphonesIcon className="size-4" />
          Headphones recommended, so the game sounds don’t leak into your mic.
          {micOn && <span className="sr-only">Your mic is live.</span>}
        </p>
      )}

      {import.meta.env.DEV && amHost && !compact && (
        <div className="flex items-center gap-2 border-t border-dashed border-slate-700 pt-3 text-xs text-slate-400">
          <span>Dev:</span>
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs"
            onClick={() => void debugSetVoiceMuted(!gameMuted)}
          >
            {gameMuted ? 'End test mute' : 'Test recording mute'}
          </Button>
        </div>
      )}
    </section>
  );
}

const SETTINGS_KEY = 'cyrp.micSettingsOpen';

function loadSettingsOpen() {
  try {
    return localStorage.getItem(SETTINGS_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSettingsOpen(open: boolean) {
  try {
    localStorage.setItem(SETTINGS_KEY, open ? '1' : '0');
  } catch {
    // not remembered, that's fine
  }
}
