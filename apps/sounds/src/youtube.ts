import { execFile as nodeExecFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LibraryError } from './validate.js';

/** Longest video accepted: its audio is decoded whole in the browser, to crop it. */
export const MAX_YOUTUBE_SECONDS = 300;
const HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'];

export type YoutubeFetcher = (url: string) => Promise<{ data: Buffer; ext: string; title: string }>;

type ExecFile = (
  file: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number },
  done: (err: (Error & { stderr?: string }) | null, stdout: string, stderr: string) => void,
) => void;

/**
 * A YouTube link, or null for anything else. Only YouTube: yt-dlp would otherwise fetch any URL
 * from the server, internal ones included.
 */
export function youtubeUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' && HOSTS.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Downloads a YouTube video's audio (m4a when offered, no conversion) with yt-dlp, one at a
 * time. Throws INVALID_PAYLOAD for a non-YouTube link, SOUND_TOO_LONG past 5 minutes, and
 * YOUTUBE_FAILED otherwise (YouTube refusing the server, a private video…).
 */
export function createYoutubeFetcher(
  binary: string,
  /**
   * A cookies.txt of a signed-in YouTube session: YouTube asks server addresses to "sign in to
   * confirm you're not a bot". yt-dlp also writes refreshed cookies back to it: keep it writable.
   */
  cookies?: string,
  execFile: ExecFile = nodeExecFile as unknown as ExecFile,
): YoutubeFetcher {
  let queue: Promise<unknown> = Promise.resolve();

  const run = async (text: string) => {
    const url = youtubeUrl(text);
    if (!url) throw new LibraryError('INVALID_PAYLOAD');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cyrp-yt-'));
    try {
      const args = [
        '--ignore-config',
        '--no-playlist',
        '--no-warnings',
        ...(cookies ? ['--cookies', cookies] : []),
        '-f',
        'bestaudio[ext=m4a]/bestaudio',
        '--match-filter',
        `duration<=${MAX_YOUTUBE_SECONDS}`,
        '--max-filesize',
        '15M',
        '--no-simulate',
        '--print',
        'title',
        '-o',
        path.join(dir, `${randomBytes(6).toString('hex')}.%(ext)s`),
        url,
      ];
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile(binary, args, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, out, stderr) =>
          err ? reject(Object.assign(err, { stderr })) : resolve(out),
        ),
      );
      const [file] = await fs.readdir(dir);
      // No file: the duration filter skipped the video (yt-dlp still exits 0).
      if (!file) throw new LibraryError('SOUND_TOO_LONG');
      return {
        data: await fs.readFile(path.join(dir, file)),
        ext: path.extname(file).slice(1),
        title: stdout.trim().split('\n')[0] ?? '',
      };
    } catch (err) {
      if (err instanceof LibraryError) throw err;
      console.warn('[youtube] failed:', (err as { stderr?: string }).stderr || err);
      throw new LibraryError('YOUTUBE_FAILED');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  return (url) => {
    const next = queue.then(() => run(url));
    queue = next.catch(() => {});
    return next;
  };
}
