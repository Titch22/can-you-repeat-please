import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { AudioFormat } from '@cyrp/audio';
import type { DialogueLine, LibrarySound, LibrarySoundPatch, TagCount } from '@cyrp/shared';

export interface LibraryQuery {
  /** Matches sounds having any of these tags. */
  tags?: string[];
  minMs?: number;
  maxMs?: number;
  /** Case-insensitive search in labels. */
  q?: string;
}

export interface NewSound {
  /** Kept when given (folder import with a manifest), otherwise derived from the label. */
  id?: string;
  label: string;
  durationMs: number;
  tags: string[];
  data: Buffer;
  format: AudioFormat;
}

interface Row {
  id: string;
  label: string;
  duration_ms: number;
  file: string;
  tags: string | null;
  /** JSON array of [startMs, endMs, speaker], in order. */
  lines: string;
}

const SEP = '\u001f';

/**
 * The curated sound library: metadata in SQLite, audio files named after their content hash
 * (so a file's URL never changes and can be cached forever, and duplicates are detected).
 */
export class Library {
  readonly filesDir: string;
  private db: DatabaseSync;

  constructor(
    dataDir: string,
    /** Prefix of the file URLs handed out. */
    private publicUrl: string,
  ) {
    this.filesDir = path.join(dataDir, 'files');
    fs.mkdirSync(this.filesDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'library.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS sounds (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        file TEXT NOT NULL,
        mime TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sounds_file ON sounds(file);
      CREATE TABLE IF NOT EXISTS sound_tags (
        sound_id TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (sound_id, tag)
      );
      CREATE INDEX IF NOT EXISTS sound_tags_tag ON sound_tags(tag);
      CREATE TABLE IF NOT EXISTS sound_lines (
        sound_id TEXT NOT NULL REFERENCES sounds(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        speaker TEXT NOT NULL CHECK (speaker IN ('A', 'B')),
        PRIMARY KEY (sound_id, idx)
      );
    `);
  }

  close() {
    this.db.close();
  }

  count() {
    return (this.db.prepare('SELECT count(*) AS n FROM sounds').get() as { n: number }).n;
  }

  list(query: LibraryQuery = {}): LibrarySound[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.tags?.length) {
      where.push(
        `s.id IN (SELECT sound_id FROM sound_tags WHERE tag IN (${query.tags.map(() => '?').join(',')}))`,
      );
      params.push(...query.tags);
    }
    if (query.minMs !== undefined) {
      where.push('s.duration_ms >= ?');
      params.push(query.minMs);
    }
    if (query.maxMs !== undefined) {
      where.push('s.duration_ms <= ?');
      params.push(query.maxMs);
    }
    if (query.q) {
      where.push("lower(s.label) LIKE ? ESCAPE '\\'");
      params.push(`%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    return this.select(where.length ? `WHERE ${where.join(' AND ')}` : '', params);
  }

  /** The sounds with these ids, in library order; unknown ids are skipped. */
  lookup(ids: string[]): LibrarySound[] {
    if (ids.length === 0) return [];
    // json_each instead of one placeholder per id: the list can be long.
    return this.select('WHERE s.id IN (SELECT value FROM json_each(?))', [JSON.stringify(ids)]);
  }

  get(id: string): LibrarySound | undefined {
    return this.select('WHERE s.id = ?', [id])[0];
  }

  tags(): TagCount[] {
    return this.db
      .prepare('SELECT tag AS name, count(*) AS count FROM sound_tags GROUP BY tag ORDER BY tag')
      .all() as unknown as TagCount[];
  }

  /** The existing sound with the same audio, if any. */
  findDuplicate(data: Buffer): LibrarySound | undefined {
    const hash = sha256(data);
    const row = this.db.prepare('SELECT id FROM sounds WHERE file LIKE ? LIMIT 1').get(`${hash}.%`);
    return row ? this.get((row as { id: string }).id) : undefined;
  }

  add(sound: NewSound): LibrarySound {
    const file = `${sha256(sound.data)}.${sound.format.ext}`;
    const filePath = path.join(this.filesDir, file);
    const newFile = !fs.existsSync(filePath);
    if (newFile) fs.writeFileSync(filePath, sound.data);
    const id = this.uniqueId(sound.id ?? slugify(sound.label));
    this.transaction(
      () => {
        this.db
          .prepare(
            'INSERT INTO sounds (id, label, duration_ms, file, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            sound.label,
            sound.durationMs,
            file,
            sound.format.mime,
            sound.data.length,
            Date.now(),
          );
        this.setTags(id, sound.tags);
      },
      // Don't leave an unreferenced file behind.
      () => newFile && fs.rmSync(filePath, { force: true }),
    );
    return this.get(id)!;
  }

  /**
   * Applies `patch`. Undefined if the sound doesn't exist; 'LINES_OUT_OF_RANGE' if a line ends
   * after the sound does (the rest of the line checks are the schema's).
   */
  update(id: string, patch: LibrarySoundPatch): LibrarySound | 'LINES_OUT_OF_RANGE' | undefined {
    const sound = this.get(id);
    if (!sound) return undefined;
    if (patch.lines?.some((l) => l.endMs > sound.durationMs)) return 'LINES_OUT_OF_RANGE';
    this.transaction(() => {
      if (patch.label !== undefined) {
        this.db.prepare('UPDATE sounds SET label = ? WHERE id = ?').run(patch.label, id);
      }
      if (patch.tags !== undefined) {
        this.db.prepare('DELETE FROM sound_tags WHERE sound_id = ?').run(id);
        this.setTags(id, patch.tags);
      }
      if (patch.lines !== undefined) {
        this.db.prepare('DELETE FROM sound_lines WHERE sound_id = ?').run(id);
        const insert = this.db.prepare(
          'INSERT INTO sound_lines (sound_id, idx, start_ms, end_ms, speaker) VALUES (?, ?, ?, ?, ?)',
        );
        patch.lines.forEach((l, i) => insert.run(id, i, l.startMs, l.endMs, l.speaker));
      }
    });
    return this.get(id);
  }

  /** Deletes the sound, and its file once no other sound uses it. False if unknown. */
  remove(id: string): boolean {
    const row = this.db.prepare('SELECT file FROM sounds WHERE id = ?').get(id) as
      { file: string } | undefined;
    if (!row) return false;
    this.db.prepare('DELETE FROM sounds WHERE id = ?').run(id);
    const stillUsed = this.db.prepare('SELECT 1 FROM sounds WHERE file = ?').get(row.file);
    if (!stillUsed) fs.rmSync(path.join(this.filesDir, row.file), { force: true });
    return true;
  }

  private select(where: string, params: SQLInputValue[]): LibrarySound[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.label, s.duration_ms, s.file,
           (SELECT group_concat(tag, '${SEP}') FROM (SELECT tag FROM sound_tags t WHERE t.sound_id = s.id ORDER BY tag)) AS tags,
           (SELECT json_group_array(json_array(start_ms, end_ms, speaker))
              FROM (SELECT * FROM sound_lines l WHERE l.sound_id = s.id ORDER BY idx)) AS lines
         FROM sounds s ${where}
         ORDER BY s.label COLLATE NOCASE, s.id`,
      )
      .all(...params) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      durationMs: r.duration_ms,
      tags: r.tags ? r.tags.split(SEP) : [],
      lines: (JSON.parse(r.lines) as [number, number, DialogueLine['speaker']][]).map(
        ([startMs, endMs, speaker]) => ({ startMs, endMs, speaker }),
      ),
      url: `${this.publicUrl}/files/${r.file}`,
    }));
  }

  private setTags(id: string, tags: string[]) {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO sound_tags (sound_id, tag) VALUES (?, ?)',
    );
    for (const tag of tags) insert.run(id, tag);
  }

  private uniqueId(base: string) {
    const taken = (id: string) => !!this.db.prepare('SELECT 1 FROM sounds WHERE id = ?').get(id);
    let id = base || 'sound';
    while (taken(id)) id = `${base || 'sound'}-${randomBytes(3).toString('hex')}`;
    return id;
  }

  private transaction(fn: () => void, onRollback?: () => void) {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      onRollback?.();
      throw err;
    }
  }
}

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** "Screaming Goat!" → "screaming-goat" */
export function slugify(label: string) {
  return label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
