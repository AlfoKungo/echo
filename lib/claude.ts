// Asks Claude (Opus) through the Claude Code command line, signed in as the Mac's user. Runs from a scratch
// directory so no project instructions are loaded into the request. Songs (lib/songs.ts) and new reading and
// listening texts (lib/text-topup.ts) both go through here.
import { tmpdir } from 'node:os';
import { StoreError } from './store';
import { parseFacts, songPrompt, type LyricForm, type WordFacts } from './song-words';

export type ClaudeOptions = { command?: string; model?: string };
export type Ask = (prompt: string, options: { timeout: number; purpose: string }) => Promise<string>;

export function createClaude(options: ClaudeOptions = {}): Ask {
  const command = options.command ?? 'claude';
  const model = options.model ?? 'opus';
  return async function ask(prompt, { timeout, purpose }) {
    let child: ReturnType<typeof Bun.spawn>;
    try {
      child = Bun.spawn([command, '-p', '--model', model, '--output-format', 'json'], {
        cwd: tmpdir(), stdin: new TextEncoder().encode(prompt), stdout: 'pipe', stderr: 'pipe',
      });
    } catch {
      throw new StoreError(`Claude Code is not installed on this Mac, so ${purpose} is not possible.`, 503);
    }
    const timer = setTimeout(() => child.kill(), timeout);
    const [out, err, code] = await Promise.all([new Response(child.stdout as ReadableStream).text(), new Response(child.stderr as ReadableStream).text(), child.exited]);
    clearTimeout(timer);
    let reply: unknown;
    try { reply = JSON.parse(out); } catch { reply = null; }
    const result = reply && typeof reply === 'object' && 'result' in reply ? reply.result : null;
    const failed = reply && typeof reply === 'object' && 'is_error' in reply ? reply.is_error === true : true;
    if (code !== 0 || failed || typeof result !== 'string') {
      const said = typeof result === 'string' && result.trim() ? result.trim() : err.trim().split('\n').pop() || 'no reply';
      throw new StoreError(`Claude could not help with ${purpose} (${said.slice(0, 160)}). Check that Claude Code is signed in on the Mac, then try again.`, 503);
    }
    return result;
  };
}

export function createClaudeReader(ask: Ask) {
  return async (lyrics: string, forms: LyricForm[]): Promise<Map<string, WordFacts>> =>
    parseFacts(await ask(songPrompt(lyrics, forms), { timeout: 5 * 60_000, purpose: 'reading the song' }), forms);
}
