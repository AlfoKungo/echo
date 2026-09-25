// Memory hooks: for a word missed TROUBLE_MISSES times, Claude (Opus) writes one short, vivid way to remember it,
// shown on the card's answer side beside the words it gets mixed up with. Written in the background, a batch at a
// time, and kept; a failed request waits RETRY_AFTER before the next try.
import type { Ask } from './claude';
import type { Store } from './store';

const BATCH = 15;
const MAX_LENGTH = 240;
const RETRY_AFTER = 6 * 3_600_000;

function prompt(words: ReturnType<Store['hookless']>): string {
  return `Echo is an app for an English speaker learning French (A1 to A2). The learner keeps forgetting the French words below. For each, write one memory hook: one or two short sentences that make the word stick, through an English sound-alike, a vivid picture, or a real English cousin of the word. Say "sounds like" rather than "comes from" unless the word really comes from it; never invent a history. Name the French word and what it means. When the word is listed with words it gets mixed up with, the hook may also say how to tell it from them. Plain English, under ${MAX_LENGTH} characters.

${JSON.stringify(words.map(({ id, fr, en, note, alongside }) => ({ id, fr, en, ...(note ? { note } : {}), ...(alongside.length ? { mixedUpWith: alongside } : {}) })))}

Reply with only JSON: {"hooks": [{"id": "...", "hook": "..."}]} with one entry for every id above.`;
}

export function createWordHooks(options: { ask: Ask; store: Store; now?: () => number }) {
  const now = options.now ?? Date.now;
  let busy = false;
  let failedAt = -Infinity;

  async function check(): Promise<void> {
    if (busy || now() - failedAt < RETRY_AFTER) return;
    const words = options.store.hookless().slice(0, BATCH);
    if (!words.length) return;
    busy = true;
    try {
      const reply = await options.ask(prompt(words), { timeout: 5 * 60_000, purpose: 'writing memory hooks' });
      let value: unknown;
      try { value = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)); } catch { value = null; }
      const hooks = value && typeof value === 'object' && Array.isArray((value as { hooks?: unknown }).hooks) ? (value as { hooks: unknown[] }).hooks : [];
      const ids = new Set(words.map((word) => word.id));
      const good = hooks.flatMap((entry) => {
        const { id, hook } = (entry ?? {}) as { id?: unknown; hook?: unknown };
        return typeof id === 'string' && ids.has(id) && typeof hook === 'string' && hook.trim() && hook.trim().length <= MAX_LENGTH ? [{ wordId: id, hook: hook.trim() }] : [];
      });
      options.store.setHooks(good);
      if (good.length) console.log(`hooks: wrote ${good.length} memory ${good.length === 1 ? 'hook' : 'hooks'}`);
      if (!good.length) failedAt = now();
    } catch (error) {
      failedAt = now();
      console.error(`hooks: could not write memory hooks: ${(error as Error).message}`);
    } finally { busy = false; }
  }

  return { check };
}
