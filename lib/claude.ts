// Reads a song's word forms with Claude (Opus) through the Claude Code command line, signed in as the Mac's
// user: one request per batch of forms, with the whole song as context. Runs from a scratch directory so no
// project instructions are loaded into the request.
import { tmpdir } from 'node:os';
import { StoreError } from './store';
import { parseFacts, songPrompt, type LyricForm, type WordFacts } from './song-words';

const TIMEOUT = 5 * 60_000;

export function createClaudeReader(options: { command?: string; model?: string } = {}) {
  const command = options.command ?? 'claude';
  const model = options.model ?? 'opus';
  return async function read(lyrics: string, forms: LyricForm[]): Promise<Map<string, WordFacts>> {
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn([command, '-p', '--model', model, '--output-format', 'json'], {
        cwd: tmpdir(), stdin: new TextEncoder().encode(songPrompt(lyrics, forms)), stdout: 'pipe', stderr: 'pipe',
      });
    } catch {
      throw new StoreError('Claude Code is not installed on this Mac, so songs cannot be read.', 503);
    }
    const timer = setTimeout(() => child.kill(), TIMEOUT);
    const [out, err, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    clearTimeout(timer);
    let reply: unknown;
    try { reply = JSON.parse(out); } catch { reply = null; }
    const result = reply && typeof reply === 'object' && 'result' in reply ? reply.result : null;
    const failed = reply && typeof reply === 'object' && 'is_error' in reply ? reply.is_error === true : true;
    if (code !== 0 || failed || typeof result !== 'string') {
      const said = typeof result === 'string' && result.trim() ? result.trim() : err.trim().split('\n').pop() || 'no reply';
      throw new StoreError(`Claude could not read the song (${said.slice(0, 160)}). Check that Claude Code is signed in on the Mac, then try again.`, 503);
    }
    return parseFacts(result, forms);
  };
}
