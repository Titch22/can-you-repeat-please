import type { ReactNode } from 'react';
import type { Settings } from '@cyrp/shared';
import { updateSettings } from '../lib/actions';
import { Card } from './ui';

const SOURCES: { value: Settings['soundSource']; label: string }[] = [
  { value: 'default', label: 'Default pack' },
  { value: 'custom', label: 'Our uploads' },
  { value: 'mixed', label: 'Mixed' },
];

function Row({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-sm">
        <span className="text-slate-400">{label}</span>
        <span className="font-semibold">{value}</span>
      </span>
      {children}
    </label>
  );
}

export function SettingsPanel({ settings, editable }: { settings: Settings; editable: boolean }) {
  const set = (patch: Partial<Settings>) => void updateSettings(patch);
  const range = 'w-full accent-amber-400 disabled:opacity-60';

  return (
    <Card>
      <h2 className="mb-3 font-bold">
        Settings
        {!editable && (
          <span className="ml-2 text-sm font-normal text-slate-400">(the host decides)</span>
        )}
      </h2>
      <div className="flex flex-col gap-4">
        <Row label="Rounds" value={String(settings.rounds)}>
          <input
            type="range"
            min={1}
            max={20}
            value={settings.rounds}
            disabled={!editable}
            onChange={(e) => set({ rounds: Number(e.target.value) })}
            className={range}
            aria-label="Rounds"
          />
        </Row>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-400">Sounds</span>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-950 p-1" role="radiogroup">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={settings.soundSource === s.value}
                disabled={!editable}
                onClick={() => set({ soundSource: s.value })}
                className={`rounded-lg px-2 py-1.5 text-sm transition disabled:cursor-default ${
                  settings.soundSource === s.value
                    ? 'bg-slate-700 font-semibold'
                    : 'text-slate-400 enabled:hover:text-slate-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <Row label="Extra recording time" value={`+${settings.extraRecordMs / 1000}s`}>
          <input
            type="range"
            min={0}
            max={3000}
            step={500}
            value={settings.extraRecordMs}
            disabled={!editable}
            onChange={(e) => set({ extraRecordMs: Number(e.target.value) })}
            className={range}
            aria-label="Extra recording time"
          />
        </Row>

        <Row label="Voting time" value={`${settings.votingMs / 1000}s`}>
          <input
            type="range"
            min={10_000}
            max={60_000}
            step={5000}
            value={settings.votingMs}
            disabled={!editable}
            onChange={(e) => set({ votingMs: Number(e.target.value) })}
            className={range}
            aria-label="Voting time"
          />
        </Row>
      </div>
    </Card>
  );
}
