import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LibraryError } from './validate.js';
import { createYoutubeFetcher, youtubeUrl } from './youtube.js';

const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof LibraryError ? e.code : String(e)),
  );

describe('youtubeUrl', () => {
  it('accepts YouTube links only', () => {
    expect(youtubeUrl(' https://www.youtube.com/watch?v=abc ')).toBe(
      'https://www.youtube.com/watch?v=abc',
    );
    expect(youtubeUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    for (const bad of [
      'http://sounds:3100/v1/sounds',
      'file:///etc/passwd',
      'https://evil.com/?v=youtube.com',
      'https://youtube.com.evil.com/watch',
      'http://www.youtube.com/watch?v=abc', // https only
      'not a url',
    ]) {
      expect(youtubeUrl(bad)).toBeNull();
    }
  });
});

describe('createYoutubeFetcher', () => {
  /** A fake yt-dlp: writes `content` (if any) where -o says, prints `title`. */
  const fake = (content: string | null, fail = false) =>
    vi.fn(
      (
        _bin: string,
        args: string[],
        _opts: unknown,
        done: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const out = args[args.indexOf('-o') + 1]!.replace('%(ext)s', 'm4a');
        if (content !== null) fs.writeFileSync(out, content);
        if (fail) done(Object.assign(new Error('exit 1'), {}), '', 'Sign in to confirm');
        else done(null, 'My clip\n', '');
      },
    );

  it('runs yt-dlp without a shell, audio only, and returns the file and title', async () => {
    const execFile = fake('AUDIO');
    const fetch = createYoutubeFetcher('yt-dlp', execFile);
    const result = await fetch('https://youtu.be/abc');
    expect(result).toEqual({ data: Buffer.from('AUDIO'), ext: 'm4a', title: 'My clip' });
    const [bin, args] = execFile.mock.calls[0]!;
    expect(bin).toBe('yt-dlp');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('--ignore-config');
    expect(args.join(' ')).toContain('duration<=300');
    expect(args.at(-1)).toBe('https://youtu.be/abc');
  });

  it('refuses other links before running anything, and reports failures', async () => {
    const execFile = fake('AUDIO');
    const fetch = createYoutubeFetcher('yt-dlp', execFile);
    expect(await code(fetch('http://sounds:3100/v1/sounds'))).toBe('INVALID_PAYLOAD');
    expect(execFile).not.toHaveBeenCalled();
    // Too long: yt-dlp skips it and writes nothing.
    expect(await code(createYoutubeFetcher('yt-dlp', fake(null))('https://youtu.be/x'))).toBe(
      'SOUND_TOO_LONG',
    );
    // yt-dlp fails: its temp folder is still removed.
    const failing = fake('PARTIAL', true);
    expect(await code(createYoutubeFetcher('yt-dlp', failing)('https://youtu.be/x'))).toBe(
      'YOUTUBE_FAILED',
    );
    const out = failing.mock.calls[0]![1][failing.mock.calls[0]![1].indexOf('-o') + 1]!;
    expect(fs.existsSync(out.replace(/[^/\\]+$/, ''))).toBe(false);
  });
});
