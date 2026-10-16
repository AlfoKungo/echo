import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import fixture from './fixtures/rule-verbs.json';
import sample from './fixtures/tense-sample.json';
import { DETECTED_TENSES, loadTenseDetector, paradigm } from '../lib/tenses';
import { conjugate, subject, verbOf, type Tense, type VerbTable } from '../lib/verbs';

const detector = await loadTenseDetector(join(import.meta.dir, '..'));
const tags = (text: string) => detector.detect(text).join('+');

describe('tense detector', () => {
  test('every form of the fixture verbs, said after its subject, reads as its own tense; a conditionnel or plus-que-parfait as other', () => {
    const words = new Map(fixture.words.map((word) => [word.id, word]));
    const wrong: string[] = [];
    for (const table of fixture.tables as VerbTable[]) {
      const verb = verbOf(table, words.get(table.id)!);
      for (const tense of [...DETECTED_TENSES, 'cond', 'pqp'] as Tense[]) conjugate(verb, tense).forEach((form, person) => {
        if (!form) return;
        const said = `${verb.impersonal ? 'il ' : subject(person, form.accepted[0]!)}${form.accepted[0]}.`;
        const found = detector.detect(said, [{ fr: form.accepted[0]!, en: `it (${verb.inf})` }]);
        const expected = (DETECTED_TENSES as readonly Tense[]).includes(tense) ? tense : 'other';
        if (found.join() !== expected) wrong.push(`${said} → ${found.join('+')} (${tense})`);
      });
    }
    expect(wrong).toEqual([]);
  });

  test('the 60 hand-checked bank sentences', () => {
    const wrong = sample.sentences.filter((entry) => detector.detect(entry.fr, entry.gloss).join('+') !== entry.tenses.join('+'))
      .map((entry) => `${entry.fr} → ${detector.detect(entry.fr, entry.gloss).join('+')} (${entry.tenses.join('+')})`);
    expect(wrong).toEqual([]);
  });

  test('futur proche, venir de and the imperative count as the présent', () => {
    expect(tags('Je vais partir demain.')).toBe('pres');
    expect(tags('Je viens de manger.')).toBe('pres');
    expect(tags('J’allais partir quand il a appelé.')).toBe('pc+imp');
    expect(tags('Ferme la porte, s’il te plaît.')).toBe('pres');
    expect(tags('Ne touche pas à ça.')).toBe('pres');
    expect(tags('Soyez prudents sur la route.')).toBe('pres');
    expect(tags('Dis-moi la vérité.')).toBe('pres');
  });

  test('être + participle: passé composé for être verbs and reflexives, the présent of être otherwise', () => {
    expect(tags('Il est né en 1990.')).toBe('pc');
    expect(tags('Nous nous sommes levés tôt.')).toBe('pc');
    expect(tags('Elle s’est assise près de la fenêtre.')).toBe('pc');
    expect(tags('Elle est assise près de la fenêtre.')).toBe('pres');
    expect(tags('Elle est mariée depuis dix ans.')).toBe('pres');
    expect(tags('Le magasin sera fermé demain.')).toBe('fut');
    expect(tags('La maison a été construite en 1900.')).toBe('pc');
  });

  test('the other moods and compound tenses are other', () => {
    expect(tags('Je voudrais un thé.')).toBe('other');
    expect(tags('Si j’avais su, je serais venu.')).toBe('other');
    expect(tags('Il était parti quand je suis arrivé.')).toBe('pc+other');
    expect(tags('Nous serons partis avant midi.')).toBe('other');
    expect(tags('Il faut que tu partes.')).toBe('pres+other');
    expect(tags('Je travaille pour que mes enfants soient heureux.')).toBe('pres+other');
    expect(tags('Avant que tu partes, appelle-moi.')).toBe('pres+other');
    // Present-looking forms after a trigger are the subjonctif.
    expect(detector.detect('Il faudrait que tu appelles le propriétaire.', [{ fr: 'appelles', en: 'call (appeler)' }]).join('+')).toBe('other');
  });

  test('a que after a trigger further back is a relative pronoun, and c’est pour ça que is no trigger', () => {
    expect(tags('Mon fils a peur des gens qu’il ne connaît pas.')).toBe('pres');
    expect(tags('C’est pour ça que je suis venu.')).toBe('pres+pc');
  });

  test('fixed tags carry no tense; il y a + a time is ago', () => {
    expect(tags('L’addition, s’il vous plaît.')).toBe('');
    expect(tags('Depuis combien de temps est-ce que tu apprends le français ?')).toBe('pres');
    expect(tags('Qu’est-ce qui s’est passé ?')).toBe('pc');
    expect(tags('Je suis arrivé il y a deux ans.')).toBe('pc');
    expect(tags('Il y a deux chats dans le jardin.')).toBe('pres');
    expect(tags('Il y a eu un accident.')).toBe('pc');
  });

  test('a word that is also a noun counts as a verb only where it is one', () => {
    expect(tags('Il porte la porte.')).toBe('pres');
    expect(tags('Mon père porte une cravate.')).toBe('pres');
    expect(tags('La porte ferme mal.')).toBe('pres');
    expect(tags('Le lit est confortable.')).toBe('pres');
    expect(tags('Elle a une montre en or.')).toBe('pres');
    expect(tags('J’ai vingt ans.')).toBe('pres');
    expect(tags('As-tu faim ?')).toBe('pres');
    expect(tags('Peut-être qu’il viendra.')).toBe('fut');
  });

  test('spelling changes in the regular families', () => {
    expect(paradigm('acheter')!.pres[0]).toEqual(['achète']);
    expect(paradigm('appeler')!.fut).toEqual(['appeller']);
    expect(paradigm('commencer')!.pres[3]).toEqual(['commençons']);
    expect(tags('Nous commencions à huit heures.')).toBe('imp');
    expect(tags('Je préférerai le train.')).toBe('fut');
    expect(paradigm('comprendre')!.pp).toEqual(['compris']);
    expect(paradigm('sourire')!.pres[0]).toEqual(['souris']);
  });
});
