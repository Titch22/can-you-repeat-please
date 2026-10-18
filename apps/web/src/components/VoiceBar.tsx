import { useState } from 'react';
import { debugSetVoiceMuted } from '../lib/actions';
import { enableAudio, setMicWanted, useVoice, type VoiceStatus } from '../lib/voice';
import { HeadphonesIcon, MicIcon, MicOffIcon, SlidersIcon } from './icons';
import { MicLevel, MicSettings } from './MicSettings';
import { Button } from './ui';

const STATUS: Record<VoiceStatus, { label: string; dot: string }> = {
  idle: { label: 'Voice off', dot: 'bg-subtle' },
  connecting: { label: 'Joining voice…', dot: 'bg-accent animate-pulse' },
  connected: { label: 'Voice connected', dot: 'bg-success' },
  reconnecting: { label: 'Voice reconnecting…', dot: 'bg-accent animate-pulse' },
  error: { label: 'Voice unavailable', dot: 'bg-rec' },
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
    <section
      aria-label="Voice chat"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card backdrop-blur-sm sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span
          className="flex items-center gap-2 pl-1 text-sm font-medium"
          data-testid="voice-status"
        >
          <span className={`size-2.5 rounded-full ${s.dot}`} aria-hidden />
          {s.label}
        </span>
        <span className="flex-1" />
        {!micBlocked && <MicLevel muted={!micWanted || gameMuted} />}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSettings}
          aria-expanded={settingsOpen}
          icon={<SlidersIcon className="size-4" />}
          className={settingsOpen ? 'bg-surface-raised text-ink' : ''}
        >
          Mic settings
        </Button>
        <Button
          variant={micWanted ? 'secondary' : 'danger'}
          size="sm"
          className={`min-w-24 ${micWanted ? '' : 'bg-rose-500/15'}`}
          onClick={() => setMicWanted(!micWanted)}
          aria-pressed={!micWanted}
          disabled={status !== 'connected'}
          icon={micWanted ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
        >
          {micWanted ? 'Mute' : 'Unmute'}
        </Button>
      </div>

      {settingsOpen && <MicSettings locked={gameMuted} />}
      {audioBlocked && <Button onClick={() => void enableAudio()}>Click to hear the others</Button>}
      {micBlocked && (
        <p className="text-sm text-danger">
          Microphone unavailable. Allow mic access in your browser to talk and play; you can still
          listen.
        </p>
      )}
      {status === 'error' && (
        <p className="text-sm text-danger">
          Could not reach the voice server. The game still works without voice.
        </p>
      )}
      {!compact && (
        <p className="flex items-center gap-2 pl-1 text-xs text-subtle">
          <HeadphonesIcon className="size-4" />
          Headphones recommended, so the game sounds don’t leak into your mic.
          {micOn && <span className="sr-only">Your mic is live.</span>}
        </p>
      )}

      {import.meta.env.DEV && amHost && !compact && (
        <div className="flex items-center gap-2 border-t border-dashed border-line-strong pt-2 pl-1 text-xs text-subtle">
          <span>Dev:</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
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
