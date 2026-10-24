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
  /** At most this many sounds (in label order). */
  limit?: number;
}

/** Whose sounds: a user's id, or null for the shared library. */
export type Owner = number | null;

export interface NewSound {
  /** Kept when given (folder import with a manifest), otherwise derived from the label. */
  id?: string;
  label: string;
  durationMs: number;
  tags: string[];
  data: Buffer;
  format: AudioFormat;
  /** Default: the shared library. */
  owner?: Owner;
}

interface Row {
  id: string;
  label: string;
  duration_ms: number;
  file: string;
  background_file: string | null;
  tags: string | null;
  /** JSON array of [startMs, endMs, speaker, text, wordStartsMs], in order. */
  lines: string;
}

const SEP = '\u001f';

/**
 * The sounds: the shared library (curated by admins, every room can use it) and each user's own
 * sounds (only rooms they share them with). Metadata in SQLite, audio files named after their
 * content hash (a file's URL never changes and can be cached forever; identical files are
 * stored once, and duplicates are detected).
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
        created_at INTEGER NOT NULL,
        background_file TEXT
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
        text TEXT NOT NULL DEFAULT '',
        word_starts TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (sound_id, idx)
      );
    `);
    // Columns added after the first release: existing databases get them here.
    this.addColumn('sound_lines', 'text', "TEXT NOT NULL DEFAULT ''");
    this.addColumn('sound_lines', 'word_starts', "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn('sounds', 'background_file', 'TEXT');
    this.addColumn('sounds', 'background_bytes', 'INTEGER NOT NULL DEFAULT 0');
    // Null: the shared library (every sound from before user sounds).
    this.addColumn('sounds', 'owner_id', 'INTEGER');
  }

  close() {
    this.db.close();
  }

  count() {
    return (this.db.prepare('SELECT count(*) AS n FROM sounds').get() as { n: number }).n;
  }

  list(query: LibraryQuery = {}, owner: Owner = null): LibrarySound[] {
    const where: string[] = ['s.owner_id IS ?'];
    const params: SQLInputValue[] = [owner];
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
    let clause = `WHERE ${where.join(' AND ')}`;
    if (query.limit !== undefined) {
      clause += ' ORDER BY s.label COLLATE NOCASE, s.id LIMIT ?';
      params.push(query.limit);
    }
    return this.select(clause, params);
  }

  /**
   * The sounds with these ids, in library order: from the shared library and from `owners`'
   * sounds. Unknown (or other users') ids are skipped.
   */
  lookup(ids: string[], owners: number[] = []): LibrarySound[] {
    if (ids.length === 0) return [];
    // json_each instead of one placeholder per id: the list can be long.
    return this.select(
      `WHERE s.id IN (SELECT value FROM json_each(?))
         AND (s.owner_id IS NULL OR s.owner_id IN (SELECT value FROM json_each(?)))`,
      [JSON.stringify(ids), JSON.stringify(owners)],
    );
  }

  /** Whose sound `id` is; undefined if it doesn't exist. */
  ownerOf(id: string): Owner | undefined {
    const row = this.db.prepare('SELECT owner_id FROM sounds WHERE id = ?').get(id) as
      { owner_id: number | null } | undefined;
    return row?.owner_id;
  }

  /** Size of sound `id`'s background (0 without one); undefined if the sound doesn't exist. */
  backgroundBytes(id: string): number | undefined {
    const row = this.db.prepare('SELECT background_bytes FROM sounds WHERE id = ?').get(id) as
      { background_bytes: number } | undefined;
    return row?.background_bytes;
  }

  /** Bytes stored for `owner`: their files as uploaded, backgrounds included. */
  usedBytes(owner: Owner): number {
    return (
      this.db
        .prepare(
          'SELECT coalesce(sum(bytes + background_bytes), 0) AS n FROM sounds WHERE owner_id IS ?',
        )
        .get(owner) as { n: number }
    ).n;
  }

  get(id: string): LibrarySound | undefined {
    return this.select('WHERE s.id = ?', [id])[0];
  }

  /** The shared library's tags. */
  tags(): TagCount[] {
    return this.db
      .prepare(
        `SELECT tag AS name, count(*) AS count FROM sound_tags
         WHERE sound_id IN (SELECT id FROM sounds WHERE owner_id IS NULL) GROUP BY tag ORDER BY tag`,
      )
      .all() as unknown as TagCount[];
  }

  /** `owner`'s existing sound with the same audio, if any. */
  findDuplicate(data: Buffer, owner: Owner = null): LibrarySound | undefined {
    const hash = sha256(data);
    const row = this.db
      .prepare('SELECT id FROM sounds WHERE file LIKE ? AND owner_id IS ? LIMIT 1')
      .get(`${hash}.%`, owner);
    return row ? this.get((row as { id: string }).id) : undefined;
  }

  add(sound: NewSound): LibrarySound {
    const { file, newFile } = this.storeFile(sound.data, sound.format);
    const id = this.uniqueId(sound.id ?? slugify(sound.label));
    this.transaction(
      () => {
        this.db
          .prepare(
            'INSERT INTO sounds (id, label, duration_ms, file, mime, bytes, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            sound.label,
            sound.durationMs,
            file,
            sound.format.mime,
            sound.data.length,
            Date.now(),
            sound.owner ?? null,
          );
        this.setTags(id, sound.tags);
      },
      // Don't leave an unreferenced file behind.
      () => newFile && this.deleteIfUnused(file),
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
          'INSERT INTO sound_lines (sound_id, idx, start_ms, end_ms, speaker, text, word_starts) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        patch.lines.forEach((l, i) =>
          insert.run(id, i, l.startMs, l.endMs, l.speaker, l.text, JSON.stringify(l.wordStartsMs)),
        );
      }
    });
    return this.get(id);
  }

  /** Deletes the sound, and its files once no other sound uses them. False if unknown. */
  remove(id: string): boolean {
    const row = this.files(id);
    if (!row) return false;
    this.db.prepare('DELETE FROM sounds WHERE id = ?').run(id);
    this.deleteIfUnused(row.file);
    if (row.background_file) this.deleteIfUnused(row.background_file);
    return true;
  }

  /**
   * Sets (or, with null, removes) the sound's background: the scene without the voices.
   * Undefined if the sound doesn't exist.
   */
  setBackground(
    id: string,
    background: { data: Buffer; format: AudioFormat } | null,
  ): LibrarySound | undefined {
    const row = this.files(id);
    if (!row) return undefined;
    const file = background ? this.storeFile(background.data, background.format).file : null;
    this.db
      .prepare('UPDATE sounds SET background_file = ?, background_bytes = ? WHERE id = ?')
      .run(file, background?.data.length ?? 0, id);
    if (row.background_file && row.background_file !== file) {
      this.deleteIfUnused(row.background_file);
    }
    return this.get(id);
  }

  private files(id: string) {
    return this.db.prepare('SELECT file, background_file FROM sounds WHERE id = ?').get(id) as
      { file: string; background_file: string | null } | undefined;
  }

  /** Writes `data` named after its content hash (once: identical files are shared). */
  private storeFile(data: Buffer, format: AudioFormat) {
    const file = `${sha256(data)}.${format.ext}`;
    const filePath = path.join(this.filesDir, file);
    const newFile = !fs.existsSync(filePath);
    if (newFile) fs.writeFileSync(filePath, data);
    return { file, newFile };
  }

  private deleteIfUnused(file: string) {
    const used = this.db
      .prepare('SELECT 1 FROM sounds WHERE file = ? OR background_file = ?')
      .get(file, file);
    if (!used) fs.rmSync(path.join(this.filesDir, file), { force: true });
  }

  private select(where: string, params: SQLInputValue[]): LibrarySound[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.label, s.duration_ms, s.file, s.background_file,
           (SELECT group_concat(tag, '${SEP}') FROM (SELECT tag FROM sound_tags t WHERE t.sound_id = s.id ORDER BY tag)) AS tags,
           (SELECT json_group_array(json_array(start_ms, end_ms, speaker, text, json(word_starts)))
              FROM (SELECT * FROM sound_lines l WHERE l.sound_id = s.id ORDER BY idx)) AS lines
         FROM sounds s ${where}
         ${where.includes('ORDER BY') ? '' : 'ORDER BY s.label COLLATE NOCASE, s.id'}`,
      )
      .all(...params) as unknown as Row[];
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      durationMs: r.duration_ms,
      tags: r.tags ? r.tags.split(SEP) : [],
      lines: (
        JSON.parse(r.lines) as [number, number, DialogueLine['speaker'], string, number[]][]
      ).map(([startMs, endMs, speaker, text, wordStartsMs]) => ({
        startMs,
        endMs,
        speaker,
        text,
        wordStartsMs,
      })),
      url: `${this.publicUrl}/files/${r.file}`,
      backgroundUrl: r.background_file ? `${this.publicUrl}/files/${r.background_file}` : null,
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

  private addColumn(table: string, column: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
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
