// Names every French clip a set needs, so the renderer never has to read Echo's content itself.
// Usage: bun scripts/list-clips.ts comprehension|grammar  ->  [{ "id": "...", "text": "..." }] on stdout.
import { join } from 'node:path';
import { loadBank } from '../lib/comprehension-content';
import { grammarSpeech, loadCourse } from '../lib/grammar-content';

const root = join(import.meta.dir, '..');
const set = process.argv[2];
if (set !== 'comprehension' && set !== 'grammar') {
  console.error('Usage: bun scripts/list-clips.ts comprehension|grammar');
  process.exit(2);
}

const clips: { id: string; text: string }[] = [];
if (set === 'comprehension') {
  const bank = await loadBank(root, process.env.ECHO_COMPREHENSION_DIR);
  for (const sentence of bank.sentences) clips.push({ id: sentence.id, text: sentence.fr });
  // A passage is heard line by line, so each line is its own clip, numbered from one.
  for (const passage of bank.passages) {
    passage.lines.forEach((line, index) => clips.push({ id: `${passage.id}-${index + 1}`, text: line.fr }));
  }
} else {
  const course = await loadCourse(join(root, 'content/grammar'));
  for (const topic of course.topics) {
    for (const exercise of topic.exercises) clips.push({ id: exercise.id, text: grammarSpeech(exercise) });
  }
}
console.log(JSON.stringify(clips));
