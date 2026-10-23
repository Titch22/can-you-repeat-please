import type { GameMode, Settings } from '@cyrp/shared';
import { updateSettings } from '../lib/actions';
import { Card, Slider } from './ui';

const MODES: { mode: GameMode; label: string; hint: string }[] = [
  { mode: 'classic', label: 'Classic', hint: 'Everyone imitates the same sound.' },
  {
    mode: 'teams',
    label: 'Teams',
    hint: 'Random pairs dub the two characters of a movie dialogue. 3 players or more.',
  },
];

export function SettingsPanel({ settings, editable }: { settings: Settings; editable: boolean }) {
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  return (
    <Card title="Settings" subtitle={editable ? undefined : '(the host decides)'}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Game mode</span>
          <div
            className="grid grid-cols-2 gap-1 rounded-control bg-surface-sunken p-1"
            role="group"
            aria-label="Game mode"
          >
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                disabled={!editable}
                aria-pressed={settings.mode === m.mode}
                onClick={() => set({ mode: m.mode })}
                className={`rounded-[0.6rem] px-3 py-1.5 text-sm font-semibold transition focus-visible:shadow-glow disabled:cursor-default ${
                  settings.mode === m.mode
                    ? 'bg-accent text-accent-ink shadow-accent'
                    : 'text-muted enabled:hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-subtle" data-testid="mode-hint">
            {MODES.find((m) => m.mode === settings.mode)!.hint}
          </span>
        </div>
        <Slider
          label="Rounds"
          display={settings.rounds}
          min={1}
          max={20}
          value={settings.rounds}
          disabled={!editable}
          onChange={(e) => set({ rounds: Number(e.target.value) })}
        />
        <Slider
          label="Extra recording time"
          display={`+${settings.extraRecordMs / 1000}s`}
          min={0}
          max={3000}
          step={500}
          value={settings.extraRecordMs}
          disabled={!editable}
          onChange={(e) => set({ extraRecordMs: Number(e.target.value) })}
        />
        <Slider
          label="Voting time"
          display={`${settings.votingMs / 1000}s`}
          min={10_000}
          max={60_000}
          step={5000}
          value={settings.votingMs}
          disabled={!editable}
          onChange={(e) => set({ votingMs: Number(e.target.value) })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.replayReference}
            disabled={!editable}
            onChange={(e) => set({ replayReference: e.target.checked })}
            className="size-4 shrink-0 cursor-pointer disabled:cursor-default"
          />
          <span className="text-muted">Replay the original before the attempts</span>
        </label>
      </div>
    </Card>
  );
}
