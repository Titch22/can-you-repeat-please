import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDownloader, isPublicAddress, publicLookup } from './download.js';
import { LibraryError } from './validate.js';

const code = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof LibraryError ? e.code : String(e)),
  );

/** A tiny RIFF/WAVE header: enough for the format sniffer. */
const wav = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVEfmt '), Buffer.alloc(64)]);

let server: http.Server;
let port: number;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const at = (where: string) => res.writeHead(302, { Location: where }).end();
    if (req.url === '/3615-usul%20salauds.mp3') return res.end(wav);
    if (req.url === '/moved') return at('/3615-usul%20salauds.mp3');
    if (req.url === '/to-internal') return at('http://127.0.0.1/secret');
    if (req.url === '/to-localhost') return at(`http://localhost:${port}/3615-usul%20salauds.mp3`);
    if (req.url === '/loop') return at('/loop');
    if (req.url === '/page') return res.end('<html>not audio</html>');
    if (req.url === '/huge') return res.writeHead(200, { 'Content-Length': 50e6 }).end();
    // A byte now and then, forever: only a total deadline stops it.
    if (req.url === '/drip') {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 50);
      return res.on('close', () => clearInterval(timer));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise((r) => server.close(r)));

/** The real lookup, except that "test.example" is our local server. */
const lookup: LookupFunction = (hostname, options, callback) =>
  hostname === 'test.example'
    ? options.all
      ? (callback as unknown as (e: null, a: object[]) => void)(null, [
          { address: '127.0.0.1', family: 4 },
        ])
      : callback(null, '127.0.0.1', 4)
    : publicLookup(hostname, options, callback);
const download = createDownloader({ lookup, anyPort: true });
const at = (path: string) => `http://test.example:${port}${path}`;

describe('isPublicAddress', () => {
  it('refuses internal addresses', () => {
    for (const ip of ['8.8.8.8', '2606:4700:4700::1111', '151.101.1.69']) {
      expect(isPublicAddress(ip)).toBe(true);
    }
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.5', // a Docker network
      '192.168.1.239',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::7f00:1', // IPv4-compatible
      '64:ff9b::7f00:1', // NAT64
      '2002:7f00:1::', // 6to4
      'not an ip',
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });
});

describe('createDownloader', () => {
  it('downloads an audio file, named after it, following redirects', async () => {
    expect(await download(at('/3615-usul%20salauds.mp3'))).toEqual({
      data: wav,
      mime: 'audio/wav',
      title: '3615-usul salauds',
    });
    expect((await download(at('/moved'))).title).toBe('3615-usul salauds');
  });

  it('never reaches internal addresses, directly or through a redirect', async () => {
    const real = createDownloader();
    expect(await code(real(`http://127.0.0.1:${port}/3615-usul%20salauds.mp3`))).toBe(
      'INVALID_PAYLOAD',
    );
    expect(await code(real(`http://localhost:${port}/3615-usul%20salauds.mp3`))).toBe(
      'INVALID_PAYLOAD',
    );
    expect(await code(real('http://169.254.169.254/latest/meta-data/'))).toBe('INVALID_PAYLOAD');
    expect(await code(real('http://[::1]/'))).toBe('INVALID_PAYLOAD');
    expect(await code(download(at('/to-internal')))).toBe('INVALID_PAYLOAD');
    expect(await code(download(at('/to-localhost')))).toBe('INVALID_PAYLOAD');
    expect(await code(download('file:///etc/passwd'))).toBe('INVALID_PAYLOAD');
    // Only web servers' usual ports (checked before connecting).
    expect(await code(real('http://example.com:22/a.mp3'))).toBe('INVALID_PAYLOAD');
    expect(await code(download('not a link'))).toBe('INVALID_PAYLOAD');
  });

  it('refuses what is not audio, too big, missing, or redirects forever', async () => {
    expect(await code(download(at('/page')))).toBe('UNSUPPORTED_FORMAT');
    expect(await code(download(at('/huge')))).toBe('FILE_TOO_LARGE');
    expect(await code(download(at('/nope')))).toBe('DOWNLOAD_FAILED');
    expect(await code(download(at('/loop')))).toBe('DOWNLOAD_FAILED');
  });

  it('stops a slow site at the deadline, and runs a few downloads at once at most', async () => {
    const quick = createDownloader({ lookup, anyPort: true, deadlineMs: 300, maxRunning: 1 });
    const started = Date.now();
    const slow = code(quick(at('/drip')));
    // While it runs, another one is refused.
    expect(await code(quick(at('/3615-usul%20salauds.mp3')))).toBe('RATE_LIMITED');
    expect(await slow).toBe('DOWNLOAD_FAILED');
    expect(Date.now() - started).toBeLessThan(2000);
    // Once done, the next one goes through.
    expect((await quick(at('/3615-usul%20salauds.mp3'))).mime).toBe('audio/wav');
  });
});
