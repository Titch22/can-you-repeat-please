/** Browser storage can be unavailable (private mode, blocked site data): never let it throw. */
function read<T>(store: () => Storage, key: string): T | null {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// Profile is remembered across visits.
export interface Profile {
  nickname: string;
  color: string;
}

export const PALETTE = [
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];

export function loadProfile(): Profile {
  return (
    read<Profile>(() => localStorage, 'cyrp.profile') ?? {
      nickname: '',
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
    }
  );
}

export const saveProfile = (p: Profile) => write(() => localStorage, 'cyrp.profile', p);

// Session is per tab (sessionStorage), so two tabs can be two players; it survives a reload.
export interface Session {
  code: string;
  playerId: string;
  sessionToken: string;
}

export const loadSession = () => read<Session>(() => sessionStorage, 'cyrp.session');
export const saveSession = (s: Session | null) => write(() => sessionStorage, 'cyrp.session', s);
