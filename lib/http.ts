// How Echo's responses travel: byte ranges for audio, validators so a phone keeps what it already has, and gzip
// for text. The phone reaches the Mac over Tailscale, where every round trip and every kilobyte is felt.
import type { BunFile } from 'bun';

// Audio is served with byte ranges: Safari will not play a recording, or keep one playing locked, without them.
export function ranged(req: Request, size: number, slice: (start: number, end: number) => BodyInit, headers: Record<string, string>): Response {
  const range = req.headers.get('range');
  const all = { ...headers, 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' };
  if (!range) return new Response(req.method === 'HEAD' ? null : slice(0, size), { headers: { ...all, 'Content-Length': String(size) } });
  const r = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!r || (!r[1] && !r[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]));
  const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(req.method === 'HEAD' ? null : slice(start, end + 1), { status: 206, headers: { ...all, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

// A file's version: its size and modification time, which change whenever it is rewritten.
const tag = (file: BunFile) => `"${file.size.toString(36)}-${Math.trunc(file.lastModified).toString(36)}"`;
const unchanged = (req: Request, etag: string) => (req.headers.get('if-none-match') ?? '').split(',').some((value) => value.trim().replace(/^W\//, '') === etag);

// A recording on disk. It is kept for a day without asking again, so hearing a word, sentence or sound a second
// time needs no network at all; a clip re-recorded under the same name can be heard in its old version for that day.
export const AUDIO_CACHE = 'max-age=86400';
export function audioFile(req: Request, file: BunFile): Response {
  const etag = tag(file);
  const headers = { 'Cache-Control': AUDIO_CACHE, ETag: etag, 'Last-Modified': new Date(file.lastModified).toUTCString() };
  if (unchanged(req, etag) && !req.headers.get('range')) return new Response(null, { status: 304, headers });
  return ranged(req, file.size, (start, end) => file.slice(start, end), headers);
}

// The app itself: checked on every visit, so a new version shows at once, but only fetched again when it changed.
export function staticFile(req: Request, file: BunFile): Response {
  // Weak: the same version goes out gzipped or plain.
  const etag = tag(file);
  const headers = { 'Cache-Control': 'no-cache', ETag: `W/${etag}`, 'X-Content-Type-Options': 'nosniff' };
  if (unchanged(req, etag)) return new Response(null, { status: 304, headers });
  return new Response(req.method === 'HEAD' ? null : file, { headers: { ...headers, 'Content-Type': file.type } });
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg\+xml)/;
const MIN_BYTES = 1024;
// Text is sent gzipped to a browser that accepts it (about a quarter of the size; a millisecond to make).
// Audio, byte ranges, empty and tiny bodies go as they are.
export async function compressed(req: Request, res: Response): Promise<Response> {
  const type = res.headers.get('content-type') ?? '';
  // Only the headers are looked at before deciding: touching the body of a sliced file response turns it back
  // into the whole file, which would break byte ranges.
  if (req.method === 'HEAD' || res.status === 204 || res.status === 206 || res.status === 304 || res.headers.has('content-encoding') || !COMPRESSIBLE.test(type)) return res;
  if (!/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) return res;
  const bytes = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.append('Vary', 'Accept-Encoding');
  if (bytes.length < MIN_BYTES) return new Response(bytes, { status: res.status, headers });
  headers.set('Content-Encoding', 'gzip');
  headers.delete('Content-Length');
  return new Response(Bun.gzipSync(bytes), { status: res.status, headers });
}
