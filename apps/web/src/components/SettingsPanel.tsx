import type { ReactNode } from 'react';
import type { Settings } from '@cyrp/shared';
import { updateSettings } from '../lib/actions';
import { Card } from './ui';

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
