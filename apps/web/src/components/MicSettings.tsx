import { useState } from 'react';
import { useMicLevel } from '../hooks/useMicLevel';
import { unlockAudio, useAudioUnlock } from '../lib/audio';
import {
  MAX_MIC_BOOST,
  MIN_MIC_BOOST,
  pickInput,
  setMicBoost,
  setVolume,
  useDevices,
} from '../lib/devices';
import { setInputDevice } from '../lib/mic';
import { MicIcon, MicOffIcon } from './icons';
import { Button, ErrorText, Slider, inputClass } from './ui';

/** Compact live mic level, shown next to the mute button. */
export function MicLevel({ muted }: { muted: boolean }) {
  const { level, detected } = useMicLevel();
  const blocked = useAudioUnlock((s) => s.blocked);
  const title = blocked
    ? 'Click to activate the mic meter'
    : muted
      ? 'Muted: you can test your mic, the others can’t hear you'
      : detected
        ? 'Your mic picks up sound'
        : 'Your mic level';
  return (
    <button
      type="button"
      onClick={() => blocked && void unlockAudio()}
      title={title}
      aria-label={title}
      data-testid="mic-level"
      data-detected={detected}
      data-level={level}
      className={`flex items-center gap-2 rounded-full px-2 py-1 focus-visible:shadow-glow ${blocked ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span
        className={`transition-colors ${
          detected ? (muted ? 'text-slate-300' : 'text-success') : 'text-subtle'
        }`}
      >
        {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
      </span>
      <span className="h-2 w-14 overflow-hidden rounded-full bg-surface-raised sm:w-16">
        <span
          className={`block h-full rounded-full transition-[width] duration-75 ${muted ? 'bg-subtle' : 'bg-success'}`}
          style={{ width: `${level * 100}%` }}
        />
      </span>
    </button>
  );
}

/** Listening volumes, mic picker and test meter (the "Audio settings" panel of the voice bar). */
export function MicSettings({ locked }: { locked: boolean }) {
  const { inputs, inputId, micBoost, soundsVolume, voicesVolume } = useDevices();
  const { level, detected } = useMicLevel();
  const blocked = useAudioUnlock((s) => s.blocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await setInputDevice(id || null);
    } catch {
      setError('Could not open that microphone. Is it used by another app?');
    }
    setBusy(false);
  };

  return (
    <div className="grid animate-enter gap-4 rounded-control border border-line bg-surface-sunken/70 p-4 sm:grid-cols-2">
      <Slider
        label="Game sounds volume"
        display={`${Math.round(soundsVolume * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={soundsVolume}
        onChange={(e) => setVolume('soundsVolume', Number(e.target.value))}
        hint="The sounds to imitate and everyone’s attempts."
      />
      <Slider
        label="Voices volume"
        display={`${Math.round(voicesVolume * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={voicesVolume}
        onChange={(e) => setVolume('voicesVolume', Number(e.target.value))}
        hint="The other players in voice chat (each one can also be set in the player list)."
      />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">Microphone</span>
        <select
          value={pickInput(inputId, inputs) ?? ''}
          onChange={(e) => void choose(e.target.value)}
          disabled={locked || busy}
          aria-label="Microphone"
          className={`${inputClass} py-2 disabled:opacity-60`}
        >
          <option value="">Browser default</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {locked && <p className="text-xs text-muted">You can switch mic after the recording.</p>}

      <Slider
        label="Mic boost"
        display={`${Math.round(micBoost * 100)}%`}
        valueTestId="mic-boost-value"
        min={MIN_MIC_BOOST}
        max={MAX_MIC_BOOST}
        step={0.25}
        value={micBoost}
        onChange={(e) => setMicBoost(Number(e.target.value))}
        hint="Raise it if friends say you’re too quiet. It only changes your voice in the chat."
      />

      <div className="flex flex-col gap-2 text-sm sm:col-span-2">
        <span className="flex justify-between text-muted">
          Speak to test your mic
          <span
            className={detected ? 'font-semibold text-success' : ''}
            data-testid="mic-test-status"
          >
            {detected ? 'Sound detected ✓' : 'No sound'}
          </span>
        </span>
        <div className="h-3 overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full bg-success transition-[width] duration-75"
            style={{ width: `${level * 100}%` }}
          />
        </div>
        {blocked && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => void unlockAudio()}
          >
            Activate the mic test
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
