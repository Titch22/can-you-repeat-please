import { inputClass } from './ui';

export interface SoundFilter {
  /** Sounds having any of these tags. Empty: no tag filter. */
  tags: string[];
  /** Longest duration shown, or null for any length. */
  maxMs: number | null;
  /** Case-insensitive label search. */
  q: string;
}

export const NO_FILTER: SoundFilter = { tags: [], maxMs: null, q: '' };

const DURATIONS = [
  { label: 'Any length', value: null },
  { label: '≤ 2s', value: 2000 },
  { label: '≤ 3s', value: 3000 },
  { label: '≤ 5s', value: 5000 },
  { label: '≤ 10s', value: 10_000 },
];

export const isFiltered = (f: SoundFilter) => f.tags.length > 0 || f.maxMs !== null || !!f.q.trim();

/** Whether a sound passes the duration and search filters (tags are checked by the caller). */
export function matchesBasics(
  sound: { label: string; durationMs: number },
  f: SoundFilter,
): boolean {
  if (f.maxMs !== null && sound.durationMs > f.maxMs) return false;
  const q = f.q.trim().toLowerCase();
  return !q || sound.label.toLowerCase().includes(q);
}

export function matchesFilter(
  sound: { label: string; durationMs: number; tags: string[] },
  f: SoundFilter,
): boolean {
  if (f.tags.length > 0 && !sound.tags.some((t) => f.tags.includes(t))) return false;
  return matchesBasics(sound, f);
}

/** Every tag of `sounds` with how many sounds have it, most used first. */
export function tagCounts(sounds: { tags: string[] }[]) {
  const counts = new Map<string, number>();
  for (const s of sounds) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Search box, duration picker and tag chips. `extraChips` are added after the tags. */
export function SoundFilters({
  value,
  onChange,
  tags,
  extraChips,
}: {
  value: SoundFilter;
  onChange: (f: SoundFilter) => void;
  tags: [string, number][];
  extraChips?: { key: string; label: string; count: number; on: boolean; toggle: () => void }[];
}) {
  const toggleTag = (tag: string) =>
    onChange({
      ...value,
      tags: value.tags.includes(tag) ? value.tags.filter((t) => t !== tag) : [...value.tags, tag],
    });
  const chips = [
    ...tags.map(([tag, count]) => ({
      key: tag,
      label: tag,
      count,
      on: value.tags.includes(tag),
      toggle: () => toggleTag(tag),
    })),
    ...(extraChips ?? []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={value.q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          placeholder="Search sounds…"
          aria-label="Search sounds"
          className={`${inputClass} min-w-0 flex-1 py-1.5 text-sm`}
        />
        <select
          value={value.maxMs ?? ''}
          onChange={(e) =>
            onChange({ ...value, maxMs: e.target.value ? Number(e.target.value) : null })
          }
          aria-label="Maximum duration"
          className={`${inputClass} py-1.5 text-sm`}
        >
          {DURATIONS.map((d) => (
            <option key={d.label} value={d.value ?? ''}>
              {d.label}
            </option>
          ))}
        </select>
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tags">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.toggle}
              aria-pressed={chip.on}
              className={`rounded-full border px-2.5 py-0.5 text-sm transition focus-visible:shadow-glow ${
                chip.on
                  ? 'border-accent bg-accent/15 font-semibold text-accent-strong'
                  : 'border-line text-muted hover:border-line-strong hover:text-ink'
              }`}
            >
              {chip.label} <span className="text-xs opacity-70">{chip.count}</span>
            </button>
          ))}
          {value.tags.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...value, tags: [] })}
              className="px-1.5 text-sm text-subtle underline underline-offset-2 hover:text-ink"
            >
              Clear tags
            </button>
          )}
        </div>
      )}
    </div>
  );
}
