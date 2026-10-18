import type { Settings } from '@cyrp/shared';
import { updateSettings } from '../lib/actions';
import { Card, Slider } from './ui';

export function SettingsPanel({ settings, editable }: { settings: Settings; editable: boolean }) {
  const set = (patch: Partial<Settings>) => void updateSettings(patch);

  return (
    <Card title="Settings" subtitle={editable ? undefined : '(the host decides)'}>
      <div className="flex flex-col gap-5">
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
      </div>
    </Card>
  );
}
