// Which of the Verbs room's tenses a French sentence uses, read from its words alone, so Sentence cards can keep to
// the Practising line. Every finite verb is found and named:
//   pres  the présent, and the imperative (its forms are the présent's), so futur proche (aller + infinitive) and the
//         passé récent (venir de + infinitive) count as pres: aller and venir are in the présent, and what follows is
//         an infinitive. A learner who chose the présent can read them; the futur-proche topic switch leaves them out.
//   pc    the passé composé: avoir in the présent + a participle, or être + the participle of a verb conjugated with
//         être or used reflexively. être + any other participle is the présent of être (le magasin est fermé).
//   imp   the imparfait.
//   fut   the futur simple.
//   other anything else: conditional, subjunctive, plus-que-parfait, futur antérieur, passé simple.
// Infinitives, participles and the gérondif have no tense. Fixed tags carry none either: est-ce que, n’est-ce pas,
// s’il vous plaît, n’importe, and il y a + a length of time (ago).
//
// The forms come from rules for the regular families, a table of the irregular verbs, and every infinitive the
// sentence's own glosses name ("I forgot (oublier)"), so the result depends on the sentence alone and is the same on
// the server, in the scripts and in the tests. A word that is also a noun (la porte, il porte) counts as a verb only
// where a subject or a gloss says so. The rules are checked against every verb table Echo has (tests/tenses.test.ts).
import type { Gloss } from '../comprehension-contract';
import { TENSES, type Tense } from './verbs';

export type TenseTag = Tense | 'other';
export const TENSE_TAGS: readonly TenseTag[] = [...TENSES, 'other'];
type Mood = 'pres' | 'imp' | 'fut' | 'cond' | 'subj' | 'ps';
type Aux = 'avoir' | 'être';
// impBeforeI: the imparfait stem before -ions and -iez where it differs (commencions beside commençais).
export type Paradigm = { pres: string[][]; imp: string[]; impBeforeI?: string; fut: string[]; pp: string[]; aux: Aux; subj?: string[][]; ps?: string[] };

const IMP_END = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient'];
const FUT_END = ['ai', 'as', 'a', 'ons', 'ez', 'ont'];
const split = (forms: string) => forms.split(' ').map((form) => form === '-' ? [] : form.split('/'));

// The irregular verbs: présent | imparfait stem(s) | futur stem(s) | participle(s) | ê when it takes être | subjonctif
// | passé simple. An entry starting with - is an ending shared by a family (conduire, produire: -duire), used for any
// infinitive ending that way; a whole infinitive (prendre) also serves its prefixed verbs (comprendre, apprendre).
const IRREGULAR: Record<string, string> = {
  'être': 'suis es est sommes êtes sont|ét|ser|été||sois sois soit soyons soyez soient|fus fus fut fûmes fûtes furent',
  avoir: 'ai as a avons avez ont|av|aur|eu||aie aies ait ayons ayez aient|eus eus eut eûmes eûtes eurent',
  aller: 'vais vas va allons allez vont|all|ir|allé|ê|aille ailles aille allions alliez aillent|allai allas alla allâmes allâtes allèrent',
  faire: 'fais fais fait faisons faites font|fais|fer|fait||fasse fasses fasse fassions fassiez fassent|fis fis fit fîmes fîtes firent',
  dire: 'dis dis dit disons dites disent|dis|dir|dit||dise dises dise disions disiez disent',
  interdire: 'interdis interdis interdit interdisons interdisez interdisent|interdis|interdir|interdit||interdise interdises interdise interdisions interdisiez interdisent',
  pouvoir: 'peux peux peut pouvons pouvez peuvent|pouv|pourr|pu||puisse puisses puisse puissions puissiez puissent|pus pus put pûmes pûtes purent',
  vouloir: 'veux veux veut voulons voulez veulent|voul|voudr|voulu||veuille veuilles veuille voulions vouliez veuillent',
  devoir: 'dois dois doit devons devez doivent|dev|devr|dû,due,dus,dues||doive doives doive devions deviez doivent',
  savoir: 'sais sais sait savons savez savent|sav|saur|su||sache saches sache sachions sachiez sachent',
  voir: 'vois vois voit voyons voyez voient|voy|verr|vu||voie voies voie voyions voyiez voient',
  revoir: 'revois revois revoit revoyons revoyez revoient|revoy|reverr|revu||revoie revoies revoie revoyions revoyiez revoient',
  'prévoir': 'prévois prévois prévoit prévoyons prévoyez prévoient|prévoy|prévoir|prévu||prévoie prévoies prévoie prévoyions prévoyiez prévoient',
  prendre: 'prends prends prend prenons prenez prennent|pren|prendr|pris||prenne prennes prenne prenions preniez prennent|pris pris prit prîmes prîtes prirent',
  mettre: 'mets mets met mettons mettez mettent|mett|mettr|mis||mette mettes mette mettions mettiez mettent',
  venir: 'viens viens vient venons venez viennent|ven|viendr|venu|ê|vienne viennes vienne venions veniez viennent|vins vins vint vînmes vîntes vinrent',
  tenir: 'tiens tiens tient tenons tenez tiennent|ten|tiendr|tenu||tienne tiennes tienne tenions teniez tiennent',
  boire: 'bois bois boit buvons buvez boivent|buv|boir|bu||boive boives boive buvions buviez boivent',
  lire: 'lis lis lit lisons lisez lisent|lis|lir|lu||lise lises lise lisions lisiez lisent',
  'écrire': 'écris écris écrit écrivons écrivez écrivent|écriv|écrir|écrit||écrive écrives écrive écrivions écriviez écrivent',
  inscrire: 'inscris inscris inscrit inscrivons inscrivez inscrivent|inscriv|inscrir|inscrit||inscrive inscrives inscrive inscrivions inscriviez inscrivent',
  vivre: 'vis vis vit vivons vivez vivent|viv|vivr|vécu||vive vives vive vivions viviez vivent',
  suivre: 'suis suis suit suivons suivez suivent|suiv|suivr|suivi||suive suives suive suivions suiviez suivent',
  'connaître': 'connais connais connaît/connait connaissons connaissez connaissent|connaiss|connaîtr,connaitr|connu||connaisse connaisses connaisse connaissions connaissiez connaissent',
  'paraître': 'parais parais paraît/parait paraissons paraissez paraissent|paraiss|paraîtr,paraitr|paru||paraisse paraisses paraisse paraissions paraissiez paraissent',
  'naître': 'nais nais naît/nait naissons naissez naissent|naiss|naîtr,naitr|né|ê|naisse naisses naisse naissions naissiez naissent',
  croire: 'crois crois croit croyons croyez croient|croy|croir|cru||croie croies croie croyions croyiez croient',
  recevoir: 'reçois reçois reçoit recevons recevez reçoivent|recev|recevr|reçu||reçoive reçoives reçoive recevions receviez reçoivent',
  apercevoir: 'aperçois aperçois aperçoit apercevons apercevez aperçoivent|apercev|apercevr|aperçu||aperçoive aperçoives aperçoive apercevions aperceviez aperçoivent',
  'décevoir': 'déçois déçois déçoit décevons décevez déçoivent|décev|décevr|déçu||déçoive déçoives déçoive décevions déceviez déçoivent',
  courir: 'cours cours court courons courez courent|cour|courr|couru||coure coures coure courions couriez courent',
  mourir: 'meurs meurs meurt mourons mourez meurent|mour|mourr|mort|ê|meure meures meure mourions mouriez meurent',
  rire: 'ris ris rit rions riez rient|ri|rir|ri||rie ries rie riions riiez rient',
  plaire: 'plais plais plaît/plait plaisons plaisez plaisent|plais|plair|plu||plaise plaises plaise plaisions plaisiez plaisent',
  taire: 'tais tais tait taisons taisez taisent|tais|tair|tu||taise taises taise taisions taisiez taisent',
  pleuvoir: '- - pleut - - pleuvent|pleuv|pleuvr|plu||- - pleuve - - -',
  falloir: '- - faut - - -|fall|faudr|fallu||- - faille - - -',
  valoir: 'vaux vaux vaut valons valez valent|val|vaudr|valu||vaille vailles vaille valions valiez vaillent',
  asseoir: 'assieds/assois assieds/assois assied/assoit asseyons/assoyons asseyez/assoyez asseyent/assoient|assey,assoy|assiér,assoir|assis||asseye asseyes asseye asseyions asseyiez asseyent',
  envoyer: 'envoie envoies envoie envoyons envoyez envoient|envoy|enverr|envoyé||-',
  foutre: 'fous fous fout foutons foutez foutent|fout|foutr|foutu||foute foutes foute foutions foutiez foutent',
  battre: 'bats bats bat battons battez battent|batt|battr|battu||batte battes batte battions battiez battent',
  rompre: 'romps romps rompt rompons rompez rompent|romp|rompr|rompu||rompe rompes rompe rompions rompiez rompent',
  'résoudre': 'résous résous résout résolvons résolvez résolvent|résolv|résoudr|résolu||résolve résolves résolve résolvions résolviez résolvent',
  conclure: 'conclus conclus conclut concluons concluez concluent|conclu|conclur|conclu||conclue conclues conclue concluions concluiez concluent',
  inclure: 'inclus inclus inclut incluons incluez incluent|inclu|inclur|inclus||incluse incluses incluse incluions incluiez incluent',
  'acquérir': 'acquiers acquiers acquiert acquérons acquérez acquièrent|acquér|acquerr|acquis||acquière acquières acquière acquérions acquériez acquièrent',
  fuir: 'fuis fuis fuit fuyons fuyez fuient|fuy|fuir|fui||fuie fuies fuie fuyions fuyiez fuient',
  bouillir: 'bous bous bout bouillons bouillez bouillent|bouill|bouillir|bouilli||bouille bouilles bouille bouillions bouilliez bouillent',
  'haïr': 'hais hais hait haïssons haïssez haïssent|haïss|haïr|haï||haïsse haïsses haïsse haïssions haïssiez haïssent',
  vaincre: 'vaincs vaincs vainc vainquons vainquez vainquent|vainqu|vaincr|vaincu||vainque vainques vainque vainquions vainquiez vainquent',
  suffire: 'suffis suffis suffit suffisons suffisez suffisent|suffis|suffir|suffi||suffise suffises suffise suffisions suffisiez suffisent',
  nuire: 'nuis nuis nuit nuisons nuisez nuisent|nuis|nuir|nui||nuise nuises nuise nuisions nuisiez nuisent',
  'émouvoir': 'émeus émeus émeut émouvons émouvez émeuvent|émouv|émouvr|ému||émeuve émeuves émeuve émouvions émouviez émeuvent',
  '-duire': 'duis duis duit duisons duisez duisent|duis|duir|duit||duise duises duise duisions duisiez duisent',
  '-truire': 'truis truis truit truisons truisez truisent|truis|truir|truit||truise truises truise truisions truisiez truisent',
  cuire: 'cuis cuis cuit cuisons cuisez cuisent|cuis|cuir|cuit||cuise cuises cuise cuisions cuisiez cuisent',
  '-aindre': 'ains ains aint aignons aignez aignent|aign|aindr|aint||aigne aignes aigne aignions aigniez aignent',
  '-eindre': 'eins eins eint eignons eignez eignent|eign|eindr|eint||eigne eignes eigne eignions eigniez eignent',
  '-oindre': 'oins oins oint oignons oignez oignent|oign|oindr|oint||oigne oignes oigne oignions oigniez oignent',
};
// Prefixed verbs that take être whatever their base takes, and those that take avoir though their base takes être.
const ETRE_VERBS = new Set(['aller', 'venir', 'devenir', 'revenir', 'parvenir', 'intervenir', 'survenir', 'arriver', 'partir', 'repartir',
  'sortir', 'ressortir', 'entrer', 'rentrer', 'monter', 'remonter', 'descendre', 'redescendre', 'retourner', 'tomber', 'retomber',
  'rester', 'passer', 'repasser', 'naître', 'mourir', 'décéder', 'apparaître']);
const AVOIR_ANYWAY = new Set(['prévenir', 'convenir', 'subvenir', 'circonvenir']);
const PARTIR_TYPE = ['partir', 'sortir', 'dormir', 'sentir', 'servir', 'mentir', 'repentir'];
const OUVRIR_TYPE = ['ouvrir', 'offrir', 'souffrir'];
const CUEILLIR_TYPE = ['cueillir'];
// -eler and -eter verbs that double the consonant (j’appelle, je jette) rather than take è (j’achète); rappeler, rejeter
// and projeter end the same way.
const DOUBLING = ['appel', 'épel', 'renouvel', 'jet', 'feuillet', 'étiquet', 'ficel', 'interpel'];
const CONSONANT = '[bcdfghjklmnpqrstvwxzç]';

function irregular(inf: string): Paradigm | null {
  const direct = IRREGULAR[inf];
  // A prefixed verb takes its base's forms (comprendre: prendre), but -oir verbs and écrire's family are listed whole.
  const base = direct ? inf : Object.keys(IRREGULAR).filter((key) => !key.startsWith('-') && inf.endsWith(key) && inf.length > key.length && !key.endsWith('oir') && !(key === 'rire' && inf.endsWith('crire')))
    .sort((a, b) => b.length - a.length)[0];
  const family = !base ? Object.keys(IRREGULAR).filter((key) => key.startsWith('-') && inf.endsWith(key.slice(1))).sort((a, b) => b.length - a.length)[0] : undefined;
  const key = base ?? family;
  if (!key) return null;
  const prefix = family ? inf.slice(0, inf.length - family.length + 1) : inf.slice(0, inf.length - key.length);
  const [pres, imp, fut, pp, aux, subj, ps] = IRREGULAR[key]!.split('|') as string[];
  const add = (form: string) => prefix + form;
  const takesEtre = AVOIR_ANYWAY.has(inf) ? false : ETRE_VERBS.has(inf) || (aux === 'ê' && !prefix);
  return {
    pres: split(pres!).map((forms) => forms.map(add)), imp: imp!.split(',').map(add), fut: fut!.split(',').map(add),
    pp: pp!.split(',').map(add), aux: takesEtre || (aux === 'ê' && ETRE_VERBS.has(inf)) ? 'être' : 'avoir',
    ...(subj && subj !== '-' ? { subj: split(subj).map((forms) => forms.map(add)) } : {}),
    ...(ps ? { ps: ps.split(' ').map(add) } : {}),
  };
}

// The regular families: -er (with their spelling changes), -ir like finir, partir, ouvrir or cueillir, and -re like
// attendre. An infinitive none of them covers has no paradigm.
export function paradigm(infinitive: string): Paradigm | null {
  const inf = infinitive.replace(/^(se |s’|s')/, '');
  const found = irregular(inf);
  if (found) return found;
  const aux: Aux = ETRE_VERBS.has(inf) ? 'être' : 'avoir';
  const six = (stems: string[], endings: string[]) => endings.map((ending, index) => [stems[index]! + ending]);
  if (inf.endsWith('er') && inf.length > 2) {
    const stem = inf.slice(0, -2);
    let strong = [stem];
    let futStems = [inf];
    const e = new RegExp(`e(${CONSONANT})$`).exec(stem);
    const é = new RegExp(`é(${CONSONANT}+)$`).exec(stem);
    if (/[ou]y$/.test(stem)) { strong = [`${stem.slice(0, -1)}i`]; futStems = [`${stem.slice(0, -1)}ier`]; }
    else if (/ay$/.test(stem)) { strong = [stem, `${stem.slice(0, -1)}i`]; futStems = [inf, `${stem.slice(0, -1)}ier`]; }
    else if (e && DOUBLING.some((ending) => stem.endsWith(ending))) { strong = [stem + e[1]]; futStems = [`${stem}${e[1]}er`]; }
    else if (e) { strong = [`${stem.slice(0, -2)}è${e[1]}`]; futStems = [`${strong[0]}er`]; }
    else if (é) { strong = [`${stem.slice(0, -é[0].length)}è${é[1]}`]; futStems = [inf, `${strong[0]}er`]; }
    const soft = stem.endsWith('g') ? `${stem}e` : stem.endsWith('c') ? `${stem.slice(0, -1)}ç` : stem;
    const pres = [0, 1, 2, 3, 4, 5].map((person) => person === 3 ? [`${soft}ons`] : person === 4 ? [`${stem}ez`] : strong.map((s) => s + ['e', 'es', 'e', '', '', 'ent'][person]));
    return { pres, imp: [soft], ...(soft !== stem ? { impBeforeI: stem } : {}), fut: futStems, pp: [`${stem}é`], aux };
  }
  if (inf.endsWith('ir') && inf.length > 2) {
    const stem = inf.slice(0, -2);
    const like = (types: string[]) => types.some((type) => inf.endsWith(type));
    if (like(PARTIR_TYPE)) {
      const short = stem.slice(0, -1);
      return { pres: six([short, short, short, stem, stem, stem], ['s', 's', 't', 'ons', 'ez', 'ent']), imp: [stem], fut: [inf], pp: [`${stem}i`], aux, subj: six([stem, stem, stem], ['e', 'es', 'e']) };
    }
    if (like(OUVRIR_TYPE) || like(CUEILLIR_TYPE)) {
      return { pres: six(Array(6).fill(stem), ['e', 'es', 'e', 'ons', 'ez', 'ent']), imp: [stem], fut: [like(CUEILLIR_TYPE) ? `${stem}er` : inf], pp: [like(CUEILLIR_TYPE) ? `${stem}i` : `${stem.slice(0, -1)}ert`], aux };
    }
    return { pres: six(Array(6).fill(stem), ['is', 'is', 'it', 'issons', 'issez', 'issent']), imp: [`${stem}iss`], fut: [inf], pp: [`${stem}i`], aux, subj: six(Array(3).fill(stem), ['isse', 'isses', 'isse']) };
  }
  if (/[^o]dre$/.test(inf) || /ondre$|erdre$|ordre$/.test(inf)) {
    const stem = inf.slice(0, -2);
    return { pres: six(Array(6).fill(stem), ['s', 's', '', 'ons', 'ez', 'ent']), imp: [stem], fut: [inf.slice(0, -1)], pp: [`${stem}u`], aux, subj: six(Array(3).fill(stem), ['e', 'es', 'e']) };
  }
  return null;
}

// Every form a paradigm makes, with the moods it can be. Participles come with their agreements.
type Lexicon = { finite: Map<string, Set<Mood>>; aux: Map<string, { aux: Aux; mood: Mood }>; pp: Map<string, Set<Aux>>; infinitives: Set<string> };
const emptyLexicon = (): Lexicon => ({ finite: new Map(), aux: new Map(), pp: new Map(), infinitives: new Set() });
function addForm(lexicon: Lexicon, form: string, mood: Mood) {
  if (!form) return;
  const moods = lexicon.finite.get(form) ?? new Set<Mood>();
  moods.add(mood);
  lexicon.finite.set(form, moods);
}
function addVerb(lexicon: Lexicon, infinitive: string) {
  const inf = infinitive.replace(/^(se |s’|s')/, '');
  if (lexicon.infinitives.has(inf)) return;
  const table = paradigm(inf);
  if (!table) return;
  lexicon.infinitives.add(inf);
  const moods: [Mood, string[]][] = [
    ['pres', table.pres.flat()],
    ['imp', table.imp.flatMap((stem) => IMP_END.map((ending) => (ending.startsWith('i') && table.impBeforeI ? table.impBeforeI : stem) + ending))],
    ['fut', table.fut.flatMap((stem) => FUT_END.map((ending) => stem + ending))],
    ['cond', table.fut.flatMap((stem) => IMP_END.map((ending) => stem + ending))],
    // The nous and vous subjonctif are the imparfait's forms; the others are the présent's, or the table's own.
    ['subj', table.subj ? table.subj.flat() : []],
    ['ps', table.ps ?? []],
  ];
  for (const [mood, forms] of moods) for (const form of forms) addForm(lexicon, form, mood);
  if (inf === 'avoir' || inf === 'être') for (const [mood, forms] of moods) for (const form of forms) lexicon.aux.set(form, { aux: inf, mood });
  for (const pp of table.pp) {
    const agreements = pp.endsWith('s') ? [pp, `${pp}e`, `${pp}es`] : pp === 'dû' ? [pp] : [pp, `${pp}e`, `${pp}s`, `${pp}es`];
    for (const form of agreements) {
      const auxes = lexicon.pp.get(form) ?? new Set<Aux>();
      auxes.add(table.aux);
      lexicon.pp.set(form, auxes);
    }
  }
}

// Words that are nouns or adjectives as often as verb forms; they count as verbs only after a subject, where a gloss
// names their infinitive, or as an imperative. The deck's own nouns join them (createTenseDetector).
const NOUNISH = ['porte', 'portes', 'marche', 'marches', 'ferme', 'fermes', 'livre', 'livres', 'visite', 'visites', 'danse', 'cuisine',
  'fête', 'fêtes', 'rêve', 'rêves', 'voyage', 'voyages', 'commande', 'aide', 'garde', 'montre', 'montres', 'note', 'notes', 'plante', 'plantes',
  'place', 'places', 'reste', 'demande', 'demandes', 'lit', 'court', 'courts', 'cours', 'bois', 'souris', 'sens', 'vis', 'calme', 'propre',
  'juste', 'pratique', 'pratiques', 'contre', 'entre', 'copie', 'fait', 'faits', 'dit', 'joue', 'joues', 'couche', 'couches', 'poste', 'postes',
  'règle', 'règles', 'compte', 'comptes', 'paye', 'paie', 'cause', 'causes'];
const ADJECTIVES = ['calme', 'calmes', 'propre', 'propres', 'juste', 'justes', 'pratique', 'pratiques', 'court', 'courts'];
// The words before which a word is a noun or infinitive, never a conjugated verb.
const DETERMINERS = new Set(['un', 'une', 'des', 'du', 'de', 'd’', 'au', 'aux', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre',
  'nos', 'votre', 'vos', 'leurs', 'cet', 'cette', 'ces', 'quel', 'quelle', 'quels', 'quelles', 'chaque', 'plusieurs', 'quelques', 'aucun', 'aucune',
  'à', 'pour', 'par', 'sans', 'avec', 'sur', 'sous', 'dans', 'chez', 'vers', 'contre', 'pendant', 'depuis', 'après', 'avant', 'très', 'trop',
  'assez', 'peu', 'beaucoup', 'un', 'deux', 'trois', 'premier', 'première', 'dernier', 'dernière', 'prochain', 'prochaine', 'bon', 'bonne',
  'petit', 'petite', 'grand', 'grande', 'nouveau', 'nouvelle', 'belle', 'beau', 'vieux', 'vieille', 'autre', 'même', 'le', 'la', 'les', 'l’']);
// le, la, les and l’ are articles and object pronouns; before a word that is only a verb form they are pronouns.
const OBJECT_OR_ARTICLE = new Set(['le', 'la', 'les', 'l’']);
const SUBJECTS = new Set(['je', 'j’', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'c’', 'ça', 'cela', 'ceci', 'qui']);
const CLITICS = new Set(['ne', 'n’', 'me', 'm’', 'te', 't’', 'se', 's’', 'le', 'la', 'l’', 'les', 'lui', 'leur', 'y', 'en', 'nous', 'vous']);
const REFLEXIVE: Record<string, string[]> = { je: ['me', 'm’'], 'j’': ['me', 'm’'], tu: ['te', 't’'], nous: ['nous'], vous: ['vous'] };
const AFTER_HYPHEN = new Set(['je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 't', 'ce', 'moi', 'toi', 'lui', 'leur', 'le', 'la', 'les', 'y', 'en', 'm’', 't’', 'l’']);
// What may stand between a helper and its participle: negation, adverbs, an inverted subject.
const BETWEEN = new Set(['pas', 'jamais', 'plus', 'rien', 'guère', 'point', 'déjà', 'bien', 'mal', 'encore', 'toujours', 'souvent', 'beaucoup',
  'trop', 'peu', 'assez', 'vraiment', 'enfin', 'presque', 'tout', 'tous', 'toutes', 'même', 'aussi', 'longtemps', 'vite', 'tant', 'sûrement',
  'certainement', 'probablement', 'juste', 'seulement', 'parfois', 'rarement', 'tellement', 'si', 'très', 'mieux', 'finalement', 'ensemble',
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 't', 'ce', 'enfin', 'forcément', 'jamais', 'pourtant', 'donc', 'alors']);
const TIME_WORDS = /^(ans?|années?|mois|semaines?|jours?|heures?|minutes?|secondes?|siècles?|instants?|moments?|longtemps|temps|peu|décennies?|week-ends?|soirs?|matins?|nuits?)$/;
const NUMBER = /^(\d+|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|mille|quelques|plusieurs|longtemps|peu)$/;
// Words before que after which the verb is in the subjonctif.
const SUBJUNCTIVE_TRIGGERS = new Set(['faut', 'faudra', 'fallait', 'faudrait', 'fallu', 'veux', 'veut', 'voulons', 'voulez', 'veulent', 'voulais',
  'voulait', 'voudrais', 'voudrait', 'voudrions', 'voudriez', 'voudraient', 'aimerais', 'aimerait', 'aimerions', 'aimeriez', 'préfère', 'préfères',
  'préférons', 'préférez', 'préfèrent', 'préférerais', 'souhaite', 'souhaites', 'souhaitons', 'souhaitez', 'souhaitent', 'souhaiterais', 'désire',
  'exige', 'exigent', 'pour', 'avant', 'sans', 'afin', 'moins', 'condition', 'pourvu', 'content', 'contente', 'contents', 'contentes', 'heureux',
  'heureuse', 'ravi', 'ravie', 'ravis', 'triste', 'désolé', 'désolée', 'dommage', 'peur', 'important', 'nécessaire', 'possible', 'impossible',
  'normal', 'essentiel', 'urgent', 'doute', 'doutes', 'étonnant', 'surpris', 'surprise', 'regrette', 'regrettes', 'attends', 'attend', 'attendons',
  'attendez', 'propose', 'proposes', 'suggère', 'conseille', 'permets', 'permet', 'ordonne', 'demande', 'demandes', 'bien', 'quoique', 'mieux', 'bon']);
// Fixed phrases whose verb carries no tense of the sentence's own.
const FIXED: string[][] = [['est', 'ce', 'que'], ['est', 'ce', 'qu’'], ['n’', 'est', 'ce', 'pas'], ['s’', 'il', 'vous', 'plaît'],
  ['s’', 'il', 'te', 'plaît'], ['s’', 'il', 'vous', 'plait'], ['s’', 'il', 'te', 'plait'], ['n’', 'importe']];
// Hyphenated words whose second part looks like a pronoun but is not one.
const COMPOUNDS = new Set(['rendez-vous']);
// These must stand right before que to call for the subjonctif (bien que, pour que, il vaut mieux que); further back
// they say something else (c’est pour ça que, mieux que toi).
const RIGHT_BEFORE_QUE = new Set(['bien', 'mieux', 'bon', 'moins', 'pour', 'avant', 'sans', 'afin']);
// What may stand between a trigger and que (je voudrais bien que, je ne veux pas que, jusqu’à ce que); a trigger further
// back belongs to another phrase (il a peur des gens qu’il ne connaît pas: qu’ is a relative pronoun there).
const BEFORE_QUE = new Set(['bien', 'vraiment', 'tellement', 'très', 'tant', 'pas', 'plus', 'jamais', 'ce']);
// Words after a subject that are never a verb, so an unknown one is not taken for one.
const NOT_VERBS = new Set(['pas', 'plus', 'jamais', 'rien', 'que', 'qu’', 'qui', 'où', 'quand', 'comment', 'pourquoi', 'si', 'aussi', 'très',
  'bien', 'même', 'tout', 'tous', 'toute', 'toutes', 'alors', 'donc', 'puis', 'et', 'ou', 'mais', 'moi', 'toi', 'eux', 'ce', 'ça', 'là', 'ici',
  'un', 'une', 'des', 'du', 'de', 'd’', 'au', 'aux', 'à', 'dans', 'pour', 'avec', 'chez', 'sur', 'sous', 'non', 'oui', 'depuis', 'encore', 'déjà',
  'toujours', 'souvent', 'parfois', 'aujourd’hui', 'demain', 'hier', 'maintenant', 'bientôt', 'ensuite', 'peut-être', 'seul', 'seule',
  'deux', 'trois', 'ceux', 'celle', 'celui', 'celles', 'lequel', 'laquelle', 'dont', 'quoi', 'comme', 'car', 'quelqu’un', 'personne', 'chacun',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche', 'midi', 'minuit', 'parmi', 'merci', 'ami', 'amie', 'amis']);
// The imperatives that are the subjonctif's forms rather than the présent's.
const IMPERATIVES = new Set(['sois', 'soyons', 'soyez', 'aie', 'ayons', 'ayez', 'sache', 'sachons', 'sachez', 'veuille', 'veuillez']);
const ADVERB_ENDING = /ment$/;
// What follows an imperative that is also a noun (ferme la porte, porte ton sac); a noun is followed by de or an adjective.
const ARTICLES = new Set(['le', 'la', 'les', 'l’', 'un', 'une', 'des', 'du', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'notre',
  'nos', 'votre', 'vos', 'leur', 'leurs', 'ce', 'cet', 'cette', 'ces']);

// inverted: a pronoun after a hyphen (as-tu), which is never the subject of the word after it.
type Token = { w: string; start: number; end: number; inv: boolean; inverted: boolean; boundary: boolean; skip: boolean; verb?: boolean; noun?: boolean };

// The words, lowercased with ’ for ', each with where it stands: inv for a verb with a hyphenated subject or object
// after it (as-tu, dis-moi), boundary for the first word of a clause. A hyphen joins a compound (peut-être,
// après-midi) unless what follows it is a pronoun.
function tokenize(text: string): Token[] {
  const lower = text.toLowerCase().replace(/'/g, '’');
  const raw = [...lower.matchAll(/[\p{L}\p{M}]+’?|\d+/gu)].map((match) => ({ w: match[0], start: match.index!, end: match.index! + match[0].length }));
  const merged: { w: string; start: number; end: number }[] = [];
  for (const token of raw) {
    const last = merged.at(-1);
    const gap = last ? lower.slice(last.end, token.start) : '';
    const joined = last ? `${last.w}${gap}${token.w}` : '';
    if (last && ((gap === '-' && (!AFTER_HYPHEN.has(token.w) || COMPOUNDS.has(joined))) || (gap === '' && /^(aujourd’|quelqu’|presqu’)$/.test(last.w)))) {
      last.w = joined; last.end = token.end;
    } else merged.push({ ...token });
  }
  return merged.map((token, index) => {
    const before = index ? lower.slice(merged[index - 1]!.end, token.start) : '';
    const next = merged[index + 1];
    const inv = !!next && lower.slice(token.end, next.start) === '-' && AFTER_HYPHEN.has(next.w);
    return { ...token, inv, inverted: before === '-', boundary: index === 0 || /[,;:.!?«»"“”—–()]/.test(before), skip: false };
  });
}

// The infinitives a gloss names in brackets ("does (faire); …", "(bouger, imperative)", "(ressembler à)").
const infinitivesOf = (english: string) => [...english.matchAll(/\(((?:se |s’|s')?[a-zàâäçéèêëîïôöùûüÿœ]+(?:er|ir|re|oir|ïr))(?=[\s,;)])/gi)].map((match) => match[1]!.toLowerCase().replace(/'/g, '’'));
const nounGloss = (english: string) => /\((?:le|la|les|l’|l'|un|une|des) [^)]*\)\s*$|\((?:l’|l')[^)]*\)\s*$/i.test(english);

export type TenseDetector = { detect(text: string, gloss?: Gloss[]): TenseTag[]; explain(text: string, gloss?: Gloss[]): { tags: TenseTag[]; verbs: { words: string; tag: TenseTag | 'none'; why: string }[]; unknown: string[] } };

// verbs: the infinitives Echo knows besides the irregular table (the deck's verbs); nouns: words that are nouns or
// adjectives in the deck, which then need a subject or a gloss to count as verbs; adjectives: those of them that may
// follow a noun as an adjective (un repas calme), so are never taken for its verb.
export function createTenseDetector(options: { verbs: string[]; nouns?: string[]; adjectives?: string[] }): TenseDetector {
  const base = emptyLexicon();
  for (const inf of [...Object.keys(IRREGULAR).filter((key) => !key.startsWith('-')), ...ETRE_VERBS, ...options.verbs]) addVerb(base, inf);
  const nounsOnly = new Set([...NOUNISH, ...(options.nouns ?? [])]);
  const adjectives = new Set([...ADJECTIVES, ...(options.adjectives ?? [])]);
  const nouns = new Set([...nounsOnly, ...adjectives]);

  function explain(text: string, gloss: Gloss[] = []) {
    const lexicon = { ...base, finite: new Map(base.finite), aux: base.aux, pp: new Map(base.pp), infinitives: new Set(base.infinitives) };
    const tokens = tokenize(text);
    const lowerText = text.toLowerCase().replace(/'/g, '’');
    // A gloss naming an infinitive adds its verb and marks that verb's forms in its words as a verb (in "s’en rende
    // compte (se rendre compte)", rende but not compte); one naming a noun marks its words as a noun.
    for (const entry of gloss) {
      const infinitives = infinitivesOf(entry.en);
      for (const inf of infinitives) addVerb(lexicon, inf);
      const noun = !infinitives.length && nounGloss(entry.en);
      if (!infinitives.length && !noun) continue;
      const own = emptyLexicon();
      for (const inf of infinitives) addVerb(own, inf);
      const isForm = (word: string) => own.finite.has(word) || own.pp.has(word);
      const needle = entry.fr.toLowerCase().replace(/'/g, '’');
      for (let at = lowerText.indexOf(needle); at >= 0; at = lowerText.indexOf(needle, at + 1)) {
        for (const token of tokens) {
          if (token.start < at || token.end > at + needle.length) continue;
          if (noun) token.noun = true;
          else if (isForm(token.w)) token.verb = true;
        }
      }
    }
    for (const phrase of FIXED) {
      for (let i = 0; i + phrase.length <= tokens.length; i++) if (phrase.every((word, k) => tokens[i + k]!.w === word)) for (let k = 0; k < phrase.length; k++) tokens[i + k]!.skip = true;
    }
    // qu’est-ce que / qu’est-ce qui ask, and il y a + a length of time says "ago".
    tokens.forEach((token, i) => {
      if (token.w === 'est' && tokens[i - 1]?.w === 'qu’' && tokens[i + 1]?.w === 'ce') token.skip = true;
      if (token.w === 'a' && tokens[i - 1]?.w === 'y' && tokens[i - 2]?.w === 'il' && (TIME_WORDS.test(tokens[i + 1]?.w ?? '') || (NUMBER.test(tokens[i + 1]?.w ?? '') && (TIME_WORDS.test(tokens[i + 2]?.w ?? '') || TIME_WORDS.test(tokens[i + 3]?.w ?? ''))))) token.skip = true;
    });

    // The object pronouns and ne before the word at i, never reaching back past the start of its clause.
    function before(i: number) {
      let j = i - 1;
      while (j >= 0 && !tokens[j + 1]!.boundary && CLITICS.has(tokens[j]!.w)) j--;
      let chain = tokens.slice(j + 1, i).map((entry) => entry.w);
      let subject = tokens[j + 1]!.boundary || tokens[j]!.inverted ? '' : tokens[j]!.w;
      // nous and vous open the chain as its subject when nothing else is one (nous nous levons; les enfants nous
      // voient), but not after a preposition or a verb (avec nous, viennent nous voir).
      const object = !!subject && (DETERMINERS.has(subject) || lexicon.finite.has(subject) || lexicon.infinitives.has(subject));
      if (!SUBJECTS.has(subject) && !object && (chain[0] === 'nous' || chain[0] === 'vous')) { subject = chain[0]; chain = chain.slice(1); }
      return { subject, chain };
    }
    // How the word at i stands: after a subject, inverted, opening a clause (an imperative), or anywhere else.
    function position(i: number): 'subject' | 'inverted' | 'clause' | 'other' {
      const token = tokens[i]!;
      if (token.inv) return 'inverted';
      const { subject, chain } = before(i);
      if (SUBJECTS.has(subject)) return 'subject';
      if (subject === 'ce' && /^(est|sont|sera|seront|serait|était|étaient|fut|soit|doit|peut|devait|pouvait|semble)$/.test(token.w)) return 'subject';
      const opening = i - chain.length === 0 || tokens[i - chain.length]!.boundary;
      return opening && !subject && (chain.length === 0 || chain[0] === 'ne' || chain[0] === 'n’') ? 'clause' : 'other';
    }
    const reflexiveBefore = (i: number) => {
      const { subject, chain } = before(i);
      const own = REFLEXIVE[subject] ?? ['se', 's’'];
      return chain.some((word) => own.includes(word));
    };
    // A participle's guess for a verb no gloss names, after avoir: -é, a consonant + -i or -u, -pris, -mis, -sis,
    // -quis, -ert, -int, with their agreements. Numbers, days and other words that only look like one are not.
    const ppGuess = (word: string) => /(é|[^aeiouy][iu]|pris|mis|sis|quis|ert|[aeo]int)(e|s|es)?$/.test(word) && word.length > 2 && !nounsOnly.has(word) && !NOT_VERBS.has(word)
      && !NUMBER.test(word) && !/^(vingt|trente|quarante|cinquante|soixante|quatre|dix|deux|trois|cent)/.test(word) && !ADVERB_ENDING.test(word) && !lexicon.finite.has(word);

    let subjunctive = -1;
    const verbs: { words: string; tag: TenseTag | 'none'; why: string }[] = [];
    const unknown: string[] = [];
    const tags = new Set<TenseTag>();
    const note = (words: string, tag: TenseTag | 'none', why: string) => { verbs.push({ words, tag, why }); if (tag !== 'none') tags.add(tag); };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.skip) continue;
      if (token.w === 'que' || token.w === 'qu’') {
        const lead = tokens[i - 1]?.w ?? '';
        let k = i - 1;
        while (k > 0 && BEFORE_QUE.has(tokens[k]!.w)) k--;
        const trigger = tokens[k]?.w ?? '';
        const jusqua = lead === 'ce' && tokens[i - 2]?.w === 'à' && tokens[i - 3]?.w === 'jusqu’';
        if (jusqua || (RIGHT_BEFORE_QUE.has(lead) && (lead !== 'mieux' || /^(vaut|vaudrait)$/.test(tokens[i - 2]?.w ?? ''))) || (SUBJUNCTIVE_TRIGGERS.has(trigger) && !RIGHT_BEFORE_QUE.has(trigger))) subjunctive = i;
        continue;
      }
      if (token.noun && !token.verb) continue;
      const moods = lexicon.finite.get(token.w);
      const where = position(i);
      if (where === 'clause' && IMPERATIVES.has(token.w)) { note(token.w, 'pres', 'imperative (clause)'); continue; }
      const prev = tokens[i - 1];
      const nounish = nouns.has(token.w) && !token.verb && !lexicon.aux.has(token.w);
      let finite = false;
      const { chain } = before(i);
      const negated = chain.includes('ne') || chain.includes('n’');
      if (moods) {
        // A word that is also a noun is a verb after ne (ne ferme pas), opening a clause before an article (ferme la
        // porte), or after a noun its determiner opens (la porte ferme, mon père porte), unless it is an adjective there.
        const verbHere = !nounish || !!token.verb || negated;
        if (where === 'subject' || where === 'inverted') finite = true;
        else if (where === 'clause') finite = verbHere || ARTICLES.has(tokens[i + 1]?.w ?? '');
        else {
          const afterNoun = !!prev && !DETERMINERS.has(prev.w) && (nouns.has(prev.w) || !lexicon.finite.has(prev.w)) && DETERMINERS.has(tokens[i - 2]?.w ?? '') && !adjectives.has(token.w);
          finite = (verbHere || afterNoun) && !(prev && DETERMINERS.has(prev.w) && !(OBJECT_OR_ARTICLE.has(prev.w) && !nouns.has(token.w) && !lexicon.pp.has(token.w)));
        }
      } else if ((where === 'subject' || where === 'inverted' || (where === 'clause' && negated)) && token.w.length > 1 && !ADVERB_ENDING.test(token.w) && !NOT_VERBS.has(token.w) && !lexicon.infinitives.has(token.w) && !/(er|ir|oir)$/.test(token.w) && !CLITICS.has(token.w) && !SUBJECTS.has(token.w) && !/\d/.test(token.w)) {
        // A word after a subject that no rule or gloss knows: its ending names the tense. The conditional's endings follow
        // the futur stem's r (parlerait, viendrait); the imparfait's follow the stem (entrait).
        unknown.push(token.w);
        const tag: TenseTag = subjunctive >= 0 ? 'other' : /(er|ir|rr|dr|vr)(ais|ait|ions|iez|aient)$/.test(token.w) ? 'other' : /(ais|ait|ions|iez|aient)$/.test(token.w) ? 'imp'
          : /(rai|ras|ra|rons|rez|ront)$/.test(token.w) ? 'fut' : 'pres';
        note(token.w, tag, 'ending, unknown verb');
        continue;
      }
      if (!finite) continue;
      const aux = lexicon.aux.get(token.w);
      if (aux) {
        // A helper: look past negation, adverbs and an inverted subject for a participle.
        let j = i + 1;
        let skipped = 0;
        while (j < tokens.length && skipped < 4 && (BETWEEN.has(tokens[j]!.w) || tokens[j]!.w === 't')) { j++; skipped++; }
        const next = tokens[j];
        const auxes = next && !next.noun ? lexicon.pp.get(next.w) ?? (aux.aux === 'avoir' && next.verb !== false && ppGuess(next.w) ? new Set<Aux>(['avoir']) : null) : null;
        if (next && auxes) {
          const compound = aux.aux === 'avoir' || auxes.has('être') || reflexiveBefore(i);
          next.skip = true;
          // A passive in the passé composé: a été + a second participle.
          if (next.w === 'été' || next.w === 'étés') {
            let k = j + 1;
            while (k < tokens.length && BETWEEN.has(tokens[k]!.w)) k++;
            if (tokens[k] && lexicon.pp.has(tokens[k]!.w)) tokens[k]!.skip = true;
          }
          const mood = subjunctive >= 0 && aux.mood === 'pres' && lexicon.finite.get(token.w)?.has('subj') ? 'subj' : aux.mood;
          if (compound) note(`${token.w} … ${next.w}`, mood === 'pres' ? 'pc' : 'other', `${aux.aux} (${mood}) + participle`);
          else note(`${token.w} … ${next.w}`, moodTag(mood), `être (${mood}) + participle as adjective`);
          if (subjunctive >= 0) subjunctive = -1;
          continue;
        }
      }
      // After a trigger (il faut que, pour que…) the verb is in the subjonctif; for most verbs its forms are the présent's
      // (and the imparfait's for nous and vous), so those count too. An imperative of être, avoir, savoir or vouloir
      // (sois, aie, sache, veuillez) is the subjonctif's form, and opens its clause.
      const inContext = subjunctive >= 0 && (moods!.has('subj') || moods!.has('pres') || (moods!.has('imp') && /(ions|iez)$/.test(token.w)));
      const imperative = where === 'clause' && IMPERATIVES.has(token.w);
      const tag: TenseTag = inContext ? 'other' : moods!.has('pres') || imperative ? 'pres' : moods!.has('imp') ? 'imp' : moods!.has('fut') ? 'fut' : 'other';
      const named = inContext ? 'subj' : imperative ? 'imperative' : moods!.has('pres') ? 'pres' : moods!.has('imp') ? 'imp' : moods!.has('fut') ? 'fut' : [...moods!].join('/');
      note(token.w, tag, `${named} (${where})`);
      if (subjunctive >= 0) subjunctive = -1;
    }
    return { tags: TENSE_TAGS.filter((tag) => tags.has(tag)), verbs, unknown };
  }
  return { detect: (text, gloss) => explain(text, gloss).tags, explain };
}
const moodTag = (mood: Mood): TenseTag => mood === 'pres' ? 'pres' : mood === 'imp' ? 'imp' : mood === 'fut' ? 'fut' : 'other';

// The detector for a deck: its verbs (en "to …") and the single-word nouns and adjectives that are not verbs.
export function deckDetector(deck: { fr: string; en: string }[]): TenseDetector {
  const verbs: string[] = [];
  const nouns: string[] = [];
  const adjectives: string[] = [];
  for (const word of deck) {
    const fr = word.fr.toLowerCase().replace(/'/g, '’');
    if (/^to /.test(word.en)) { verbs.push(fr); continue; }
    const match = /^((?:le|la|les|un|une) |l’)?([a-zàâäçéèêëîïôöùûüÿœ-]+)$/.exec(fr);
    if (!match) continue;
    const forms = [match[2]!, `${match[2]}s`, `${match[2]}x`];
    (match[1] ? nouns : adjectives).push(...forms);
  }
  return createTenseDetector({ verbs, nouns, adjectives });
}

// French's detector, from its deck in content/ (the same for the server, the scripts and the tests).
export async function loadTenseDetector(root: string): Promise<TenseDetector> {
  const deck = [...await Bun.file(`${root}/content/core.json`).json(), ...await Bun.file(`${root}/content/world.json`).json()] as { fr: string; en: string }[];
  return deckDetector(deck);
}
