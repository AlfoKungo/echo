// Writes content/pt/verbs.json: the presente, pretérito perfeito and pretérito imperfeito of every verb in the
// Portuguese deck, for eu, você/ele/ela, nós and vocês/eles/elas, from the rules and the irregular forms in
// lib/verbs-pt.ts, so the file is the same each time it is made. Run it again after the deck's verbs change.
// Usage: bun scripts/make-pt-verbs.ts
import { join } from 'node:path';
import { ptBase, ptTable } from '../lib/verbs-pt';

const root = join(import.meta.dir, '..');
type Entry = { id: string; pt: string; en: string; category: string };
const deck = [...await Bun.file(join(root, 'content/pt/core.json')).json(), ...await Bun.file(join(root, 'content/pt/world.json')).json()] as Entry[];
// The deck's verbs: every "to …" word, and the modal verbs in Verbs (poder "can", dever "must").
const verbs = deck.filter((word) => /^to /.test(word.en) || word.category === 'verbs');
const entries = verbs.map((word) => ({ id: word.id, pt: word.pt, ...ptTable(ptBase(word.pt)) }));
await Bun.write(join(root, 'content/pt/verbs.json'), `[\n${entries.map((entry) => ` ${JSON.stringify(entry)}`).join(',\n')}\n]\n`);
console.log(`content/pt/verbs.json: ${entries.length} verbs`);
