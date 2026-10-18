import { useState } from 'react';
import { NicknameSchema } from '@cyrp/shared';
import { loadProfile, PALETTE, saveProfile, type Profile } from '../lib/storage';
import { Avatar, inputClass } from './ui';

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

/** Nickname + color picker, with a live preview of the player's avatar. */
export function ProfileFields({
  value,
  onChange,
}: {
  value: Profile;
  onChange: (patch: Partial<Profile>) => void;
}) {
  return (
    <div className="flex items-start gap-4 sm:gap-5">
      <Avatar
        player={{ nickname: value.nickname.trim() || '?', color: value.color }}
        size="xl"
        className="mt-6 hidden shadow-lg sm:grid"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted">Nickname</span>
          <input
            value={value.nickname}
            onChange={(e) => onChange({ nickname: e.target.value })}
            maxLength={20}
            placeholder="Your name"
            autoComplete="off"
            className={`${inputClass} text-lg`}
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm text-muted">Color</legend>
          <div className="flex flex-wrap gap-2.5">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                aria-pressed={value.color === color}
                onClick={() => onChange({ color })}
                className={`size-9 rounded-full transition focus-visible:shadow-glow ${
                  value.color === color
                    ? 'scale-110 ring-[3px] ring-white/85 ring-offset-2 ring-offset-slate-900'
                    : 'opacity-60 hover:scale-105 hover:opacity-100'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
