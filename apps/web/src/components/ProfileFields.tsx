import { useState } from 'react';
import { NicknameSchema } from '@cyrp/shared';
import { loadProfile, PALETTE, saveProfile, type Profile } from '../lib/storage';

/** Profile state, persisted to localStorage on every change. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const update = (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    saveProfile(next);
  };
  const valid = NicknameSchema.safeParse(profile.nickname).success;
  return {
    profile: { ...profile, nickname: profile.nickname.trim() },
    raw: profile,
    update,
    valid,
  };
}

export function ProfileFields({
  value,
  onChange,
}: {
  value: Profile;
  onChange: (patch: Partial<Profile>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-slate-400">Nickname</span>
        <input
          value={value.nickname}
          onChange={(e) => onChange({ nickname: e.target.value })}
          maxLength={20}
          placeholder="Your name"
          autoComplete="off"
          className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-lg outline-none focus:border-amber-400"
        />
      </label>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm text-slate-400">Color</legend>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Color ${color}`}
              aria-pressed={value.color === color}
              onClick={() => onChange({ color })}
              className={`size-9 rounded-full transition ${
                value.color === color
                  ? 'ring-4 ring-white/80 ring-offset-2 ring-offset-slate-900'
                  : 'opacity-70 hover:opacity-100'
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}
