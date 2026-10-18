import type { DialogueLine, Player, Role, RoomState, Speaker } from '@cyrp/shared';
import { useServerNow } from '../../lib/clock';
import { speaks } from '../../lib/dialogue';
import { Avatar } from '../ui';

/** The player, or a stand-in if they left the room since. */
export function playerOf(
  room: RoomState,
  playerId: string | null,
): Pick<Player, 'nickname' | 'color'> {
  return (
    room.players.find((p) => p.id === playerId) ?? {
      nickname: 'Someone who left',
      color: '#64748b',
    }
  );
}

/** "Alice", "Alice & Bob" */
export const namesOf = (room: RoomState, playerIds: string[]) =>
  playerIds.map((id) => playerOf(room, id).nickname).join(' & ');

/** The viewer's role this round (Teams mode), and their partner if they have one. */
export function myTeam(room: RoomState, meId: string | null | undefined) {
  const team = room.teams?.find((t) => t.members.some((m) => m.playerId === meId));
  if (!team) return null;
  const me = team.members.find((m) => m.playerId === meId)!;
  const partner = team.members.find((m) => m.playerId !== meId) ?? null;
  return { team, role: me.role, partner };
}

const SPEAKER_BG: Record<Speaker, string> = { A: 'bg-speaker-a', B: 'bg-speaker-b' };
const SPEAKER_TEXT: Record<Speaker, string> = { A: 'text-speaker-a', B: 'text-speaker-b' };

/** A small "A" / "B" / "A+B" chip in the characters' colors. */
export function RoleBadge({ role, className = '' }: { role: Role; className?: string }) {
  if (role === 'both') {
    return (
      <span className={`inline-flex gap-0.5 ${className}`} title="Voices both characters">
        <RoleBadge role="A" />
        <RoleBadge role="B" />
      </span>
    );
  }
  return (
    <span
      className={`inline-grid size-5 place-items-center rounded-md font-display text-xs font-black text-slate-950 ${SPEAKER_BG[role]} ${className}`}
      title={`Character ${role}`}
    >
      {role}
    </span>
  );
}

export const speakerText = (s: Speaker) => SPEAKER_TEXT[s];

/** Avatars and names of a performance's players, with their roles in Teams mode. */
export function PlayersLabel({
  room,
  playerIds,
  size = 'md',
}: {
  room: RoomState;
  playerIds: string[];
  size?: 'md' | 'lg';
}) {
  const roleOf = (id: string) =>
    room.teams?.flatMap((t) => t.members).find((m) => m.playerId === id)?.role;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {playerIds.map((id) => {
        const role = roleOf(id);
        return (
          <span key={id} className="flex min-w-0 items-center gap-2">
            <Avatar player={playerOf(room, id)} size={size} />
            <span className="truncate">{playerOf(room, id).nickname}</span>
            {role && <RoleBadge role={role} />}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The dialogue as a bar: one colored block per line (A / B), the viewer's lines highlighted,
 * and a cursor following the scene when `startsAt` is given (server time).
 */
export function DialogueTimeline({
  lines,
  durationMs,
  startsAt,
  myRole,
}: {
  lines: DialogueLine[];
  durationMs: number;
  startsAt?: number;
  myRole?: Role | null;
}) {
  const now = useServerNow(50);
  const pos =
    startsAt === undefined ? null : Math.min(1, Math.max(0, (now - startsAt) / durationMs));
  return (
    <div
      className="relative h-9 w-full overflow-hidden rounded-control bg-surface-sunken"
      aria-hidden
    >
      {lines.map((line, i) => {
        const mine = speaks(myRole, line.speaker);
        return (
          <div
            key={i}
            className={`absolute inset-y-1 grid place-items-center rounded-md font-display text-xs font-black text-slate-950 ${
              SPEAKER_BG[line.speaker]
            } ${myRole && !mine ? 'opacity-35' : ''} ${mine ? 'ring-2 ring-ink' : ''}`}
            style={{
              left: `${(line.startMs / durationMs) * 100}%`,
              width: `${((line.endMs - line.startMs) / durationMs) * 100}%`,
            }}
          >
            {line.speaker}
          </div>
        );
      })}
      {pos !== null && (
        <div
          className="absolute inset-y-0 w-0.5 bg-ink shadow-[0_0_8px_var(--color-ink)]"
          style={{ left: `${pos * 100}%` }}
        />
      )}
    </div>
  );
}
