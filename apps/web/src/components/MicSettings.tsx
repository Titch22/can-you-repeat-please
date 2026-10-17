import { useState } from 'react';
import { useMicLevel } from '../hooks/useMicLevel';
import { unlockAudio, useAudioUnlock } from '../lib/audio';
import { MAX_MIC_BOOST, MIN_MIC_BOOST, pickInput, setMicBoost, useDevices } from '../lib/devices';
import { setInputDevice } from '../lib/mic';
import { MicIcon, MicOffIcon } from './icons';
import { Button, ErrorText } from './ui';

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
      className={`flex items-center gap-2 rounded-full px-2 py-1 ${blocked ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <span
        className={`transition-colors ${
          detected ? (muted ? 'text-slate-300' : 'text-emerald-400') : 'text-slate-500'
        }`}
      >
        {muted ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
      </span>
      <span className="h-2 w-16 overflow-hidden rounded-full bg-slate-800">
        <span
          className={`block h-full transition-[width] duration-75 ${muted ? 'bg-slate-500' : 'bg-emerald-400'}`}
          style={{ width: `${level * 100}%` }}
        />
      </span>
    </button>
  );
}

/** Mic picker and test meter (the "Mic settings" panel of the voice bar). */
export function MicSettings({ locked }: { locked: boolean }) {
  const { inputs, inputId, micBoost } = useDevices();
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
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate-400">Microphone</span>
        <select
          value={pickInput(inputId, inputs) ?? ''}
          onChange={(e) => void choose(e.target.value)}
          disabled={locked || busy}
          aria-label="Microphone"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-amber-400 disabled:opacity-60"
        >
          <option value="">Browser default</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {locked && <p className="text-xs text-slate-400">You can switch mic after the recording.</p>}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="flex justify-between text-slate-400">
          Mic boost
          <span className="font-semibold text-slate-100" data-testid="mic-boost-value">
            {Math.round(micBoost * 100)}%
          </span>
        </span>
        <input
          type="range"
          min={MIN_MIC_BOOST}
          max={MAX_MIC_BOOST}
          step={0.25}
          value={micBoost}
          onChange={(e) => setMicBoost(Number(e.target.value))}
          aria-label="Mic boost"
          className="accent-amber-400"
        />
        <span className="text-xs text-slate-500">
          Raise it if friends say you’re too quiet. It only changes your voice in the chat.
        </span>
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="flex justify-between text-slate-400">
          Speak to test your mic
          <span className={detected ? 'text-emerald-300' : ''} data-testid="mic-test-status">
            {detected ? 'Sound detected ✓' : 'No sound'}
          </span>
        </span>
        <div className="h-3 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full bg-emerald-400 transition-[width] duration-75"
            style={{ width: `${level * 100}%` }}
          />
        </div>
        {blocked && (
          <Button
            variant="secondary"
            className="self-start py-1.5 text-sm"
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
