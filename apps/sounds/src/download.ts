import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import path from 'node:path';
import { sniffAudio } from '@cyrp/audio';
import { LibraryError } from './validate.js';

/** Biggest file accepted: it's cut down in the browser, so it can be a few minutes of mp3. */
export const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
/** Whole download, however slowly the site sends: a slow site can't hold a connection open. */
const DEADLINE_MS = 30_000;
/** Downloads running at once, all users together; more are refused (RATE_LIMITED). */
const MAX_RUNNING = 3;
const MAX_REDIRECTS = 3;
/** Sound files live on web servers' usual ports; others would let the service probe hosts. */
const PORTS = ['', '80', '443'];

export type Downloader = (url: string) => Promise<{ data: Buffer; mime: string; title: string }>;

/** Private, loopback, link-local, carrier-grade NAT, multicast, reserved: not the internet. */
const internal = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // cloud metadata services live here
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  internal.addSubnet(net, bits, 'ipv4');
}
for (const [net, bits] of [
  ['::', 96], // unspecified, loopback and the old IPv4-compatible form (::127.0.0.1)
  ['64:ff9b::', 96], // NAT64: IPv4 addresses inside IPv6
  ['64:ff9b:1::', 48],
  ['2002::', 16], // 6to4: likewise
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  internal.addSubnet(net, bits, 'ipv6');
}

/** False for any address that isn't on the public internet (IPv4-mapped IPv6 included). */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = isIP(address);
  if (!family) return false;
  return !internal.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Resolves like the system does, but fails for internal addresses. Used at connection time, so
 * a name can't pass a check and then point somewhere else (DNS rebinding).
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const ok = addresses.filter((a) => isPublicAddress(a.address));
    if (!ok.length) return callback(new LibraryError('INVALID_PAYLOAD'), '', 0);
    if (options.all)
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, ok);
    callback(null, ok[0]!.address, ok[0]!.family);
  });
};

/** One GET, without following redirects: a redirect's target is checked like the first URL. */
function get(url: URL, lookup: LookupFunction, signal: AbortSignal) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { lookup, signal, headers: { Accept: 'audio/*' } }, resolve);
    req.on('error', reject);
  });
}

/** The body, up to `max` bytes (more: FILE_TOO_LARGE, without reading the rest). */
async function readBody(res: http.IncomingMessage, max: number) {
  if (Number(res.headers['content-length']) > max) {
    res.destroy();
    throw new LibraryError('FILE_TOO_LARGE');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) {
      res.destroy();
      throw new LibraryError('FILE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** "…/3615-usul-archive-salauds.mp3" → "3615-usul-archive-salauds" */
function titleOf(url: URL) {
  let name = path.posix.basename(url.pathname);
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep it encoded
  }
  return name.replace(/\.[^.]+$/, '').slice(0, 80);
}

/**
 * Downloads an audio file from a public http(s) link, to crop in the browser before uploading
 * it. Refuses internal addresses (at every redirect) and unusual ports, anything over 15 MB or
 * 30 seconds, and anything that isn't audio (format sniffed from the bytes); 3 at once at most.
 * The options are for tests.
 */
export function createDownloader({
  lookup = publicLookup,
  deadlineMs = DEADLINE_MS,
  maxRunning = MAX_RUNNING,
  anyPort = false,
}: {
  lookup?: LookupFunction;
  deadlineMs?: number;
  maxRunning?: number;
  /** Tests only: their local server runs on a random port. */
  anyPort?: boolean;
} = {}): Downloader {
  let running = 0;
  return async (text) => {
    let url: URL;
    try {
      url = new URL(text.trim());
    } catch {
      throw new LibraryError('INVALID_PAYLOAD');
    }
    if (running >= maxRunning) throw new LibraryError('RATE_LIMITED');
    running++;
    try {
      return await fetchAudio(url, lookup, AbortSignal.timeout(deadlineMs), anyPort);
    } catch (err) {
      // Network errors, and the deadline (it aborts the request and the body).
      if (err instanceof LibraryError) throw err;
      throw new LibraryError('DOWNLOAD_FAILED');
    } finally {
      running--;
    }
  };
}

async function fetchAudio(
  start: URL,
  lookup: LookupFunction,
  signal: AbortSignal,
  anyPort: boolean,
) {
  let url = start;
  for (let redirects = 0; ; redirects++) {
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      !(anyPort || PORTS.includes(url.port))
    ) {
      throw new LibraryError('INVALID_PAYLOAD');
    }
    // A literal IP skips the lookup: check it here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) {
      throw new LibraryError('INVALID_PAYLOAD');
    }
    const res = await get(url, lookup, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (redirects >= MAX_REDIRECTS) throw new LibraryError('DOWNLOAD_FAILED');
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status !== 200) {
      res.resume();
      throw new LibraryError('DOWNLOAD_FAILED');
    }
    const data = await readBody(res, MAX_DOWNLOAD_BYTES);
    const format = sniffAudio(data);
    if (!format) throw new LibraryError('UNSUPPORTED_FORMAT');
    return { data, mime: format.mime, title: titleOf(url) };
  }
}
