"""Explicit offline build of whole clips for one set, in French or (--lang) Brazilian Portuguese or Swedish; never a
page-load service.

A set is `comprehension` (graded sentences and passage lines) or `grammar` (the spoken
correct sentence of every exercise). `bun scripts/list-clips.ts <set>`, run with ECHO_LANG set to the
language, names the clips, so this script never reads Echo's content itself.

French and Portuguese speak in the Chatterbox voice (Portuguese with lang_code pt, as render-audio.py --lang pt), each
take checked by local Whisper in its language. Swedish speaks in the Higgs voice and is checked by KB-Whisper and the
tail check, as render-audio-sv.py's words are (higgs_swedish.py). A clip no seed passes for is left unrecorded.
Clips go to audio/<set> (French) or audio/<code>/<set>, or --audio-dir.

Run with the Python environment named in voices/provenance.json. This process owns
its voice model and waits for each local validator subprocess before exiting.
No vocabulary carrier, word extraction, model server or background worker is used.
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import argparse
import fcntl
import difflib
import gc
import hashlib
import json
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unicodedata
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# verbs: the Verbs room's spoken phrases outside French (list-clips.ts verbs, on the Verbs branch).
SETS = ('comprehension', 'grammar', 'story', 'verbs')
MODEL = 'mlx-community/chatterbox-multilingual-v3'
REFERENCE = ROOT / 'voices' / 'french-reference.wav'
VOICE_PROVENANCE = ROOT / 'voices' / 'provenance.json'
WHISPER_MODEL = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'
# Same selected voice and sampling settings as render-audio.py. Whole sentences
# receive a larger generation ceiling than single vocabulary words; no text is cut.
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1,
            'temperature': 0.5, 'max_tokens': 1000}
PIPELINE = 'whole-sentence-clip-v1'
ENCODING = {'codec': 'libmp3lame', 'bitrate': '96k'}
VALIDATION = {'language': 'fr', 'model': 'large-v3-turbo',
              'accept': 'full-normalized-text-or-full-french-phonemes',
              'input': 'decoded-final-mp3', 'sampleRate': 16000}
CLIP_ID = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')
# Listen and Read clips start with 250 ms of quiet, as word clips do (render-audio.py): a phone, and Bluetooth earbuds
# more, drop the first moment of a clip while the output wakes. Not part of the signature, so padding a clip never
# makes it re-render; the record notes it (leadIn) and the check runs on the padded mp3.
LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1'
LEAD_IN_MS = 250
LEAD_IN_SETS = ('comprehension',)
# What the Chatterbox languages change: the language Chatterbox is told, Whisper's language and espeak-ng's voice.
# French keeps its settings exactly, so its clip signatures never change. Swedish is not here: it has its own voice
# (build_swedish). main() picks the entry for --lang.
LANGUAGES = {
    'fr': {'settings': SETTINGS, 'validation': VALIDATION, 'espeak': 'fr-fr', 'name': 'French'},
    'pt': {'settings': {**SETTINGS, 'lang_code': 'pt'}, 'validation': {**VALIDATION, 'language': 'pt'}, 'espeak': 'pt-br', 'name': 'Portuguese'},
}
LANGUAGE = LANGUAGES['fr']
SV_PIPELINE = 'whole-sentence-higgs-v1'


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def normalize(text):
    text = unicodedata.normalize('NFC', text.lower().replace('œ', 'oe'))
    return ''.join(character for character in text if character.isalnum())


UNITS = {'zéro': 0, 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5, 'six': 6, 'sept': 7,
         'huit': 8, 'neuf': 9, 'dix': 10, 'onze': 11, 'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15,
         'seize': 16}
TENS = {'vingt': 20, 'vingts': 20, 'trente': 30, 'quarante': 40, 'cinquante': 50, 'soixante': 60}


def is_number(word):
    return all(part in UNITS or part in TENS or part in ('cent', 'cents', 'mille') for part in word.lower().split('-'))


def number_value(parts):
    total, current = 0, 0
    for part in parts:
        if part in ('vingt', 'vingts') and current == 4:
            current = 80
        elif part in ('cent', 'cents'):
            current = (current or 1) * 100
        elif part == 'mille':
            total, current = total + (current or 1) * 1000, 0
        else:
            current += UNITS.get(part, TENS.get(part, 0))
    return total + current


def digits(text):
    # Whisper writes numbers as digits ("9h30", "80 ans"); the script writes them as words. Both sides become
    # digits so a clip is not rejected for how the recogniser spells a number it heard correctly.
    tokens = re.findall(r"[\w’'-]+|[^\w’'-]+", text)
    out, index = [], 0
    while index < len(tokens):
        if not is_number(tokens[index]):
            out.append(tokens[index])
            index += 1
            continue
        parts, end = tokens[index].lower().split('-'), index + 1
        while end + 1 < len(tokens) and not tokens[end].strip():
            following = tokens[end + 1].lower()
            # "vingt et un", "soixante et onze": "et" belongs to the number only before un/une/onze.
            if following == 'et' and end + 3 < len(tokens) and not tokens[end + 2].strip() \
                    and tokens[end + 3].lower() in ('un', 'une', 'onze'):
                parts.append(tokens[end + 3].lower())
                end += 4
            elif is_number(following):
                parts += following.split('-')
                end += 2
            else:
                break
        out.append(str(number_value(parts)))
        index = end
    return ''.join(out)


def written_words(text):
    # One spelling for times, prices and titles, so "neuf heures et demie" and "9h30" compare equal.
    if LANGUAGE is not LANGUAGES['fr']:
        return written_words_pt(text)
    text = digits(text.replace('€', ' euros').replace('\u00a0', ' '))
    text = re.sub(r'\bDr\b\.?', 'docteur', text)
    text = re.sub(r'\bM\.\s', 'monsieur ', text)
    text = re.sub(r'(\d+)\s*heures?\b', r'\1h', text)
    text = re.sub(r'(\d+)h\s+et\s+demie', r'\1h30', text)
    text = re.sub(r'(\d+)h\s+et\s+quart', r'\1h15', text)
    text = re.sub(r'(\d+)h\s*(\d+)', r'\1h\2', text)
    text = re.sub(r'(\d+),(\d+)\s*euros', r'\1 euros \2', text)
    return re.findall(r'[^\W_]+', unicodedata.normalize('NFC', text.lower().replace('œ', 'oe')))


def written_words_pt(text):
    # The Portuguese script writes numbers, times and prices out; Whisper may write them as digits ("às 9h",
    # "R$ 20", "15%"). Its digits become words, so both sides compare as words.
    from num2words import num2words
    say = lambda match: num2words(int(match.group()), lang='pt_BR')
    text = text.replace('\u00a0', ' ')
    text = re.sub(r'R\$\s*(\d+)', r'\1 reais', text)
    text = re.sub(r'(\d+)\s*%', r'\1 por cento', text)
    text = re.sub(r'(\d+)h(\d+)', r'\1 horas e \2', text)
    text = re.sub(r'(\d+)h\b', r'\1 horas', text)
    text = re.sub(r'\d+', say, text)
    return re.findall(r'[^\W_]+', unicodedata.normalize('NFC', text.lower()))


def fold(word, keep_vowel=False):
    # Drops one ending the ear cannot hear (bains/bain, amusés/amusé, préparent/prépare). With keep_vowel,
    # final -ais/-ait/-aient (/ɛ/) and -ai (/e/) stay apart, so parlerais never passes for parlerai.
    if keep_vowel:
        word = re.sub(r'(ais|ait|aient)$', 'Ɛ', word)
        word = re.sub(r'ai$', 'É', word)
    return re.sub(r'(e?nt|e?s|e?x|e?t|e?d|e?z|e)$', '', word) or word


def proper_names(text):
    # Capitalised words that do not open a sentence: Whisper spells names its own way (Bréhat → Bréat).
    names = set()
    for match in re.finditer(r"[\w’'-]+", text):
        before = text[:match.start()].rstrip()
        if match.group()[0].isupper() and before and before[-1] not in '.!?:«—':
            names.update(re.findall(r'[^\W_]+', match.group().lower()))
    return names


def verdict(transcript, text, expected_phonemes, espeak, clip_set):
    """How the transcript matches the script, or None when it does not."""
    if not transcript:
        return None
    if normalize(transcript) == normalize(text):
        return 'text'
    heard, wanted = written_words(transcript), written_words(text)
    if heard == wanted:
        return 'written'
    if phonemes(transcript, espeak) == expected_phonemes:
        return 'phonetic'
    # A grammar clip models one exact form: it forgives silent endings (regardent/regarde) but keeps the
    # -ais/-ai vowel apart, and only listening clips forgive how Whisper spells a proper name. Silent endings are
    # French: Portuguese forgives only names.
    grammar = clip_set == 'grammar'
    names = set() if grammar else proper_names(text)
    french = LANGUAGE is LANGUAGES['fr']
    folded_heard = [fold(word, keep_vowel=grammar) if french else word for word in heard]
    folded_wanted = [fold(word, keep_vowel=grammar) if french else word for word in wanted]
    for tag, a1, a2, b1, b2 in difflib.SequenceMatcher(None, folded_wanted, folded_heard, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'replace' and all(word in names for word in wanted[a1:a2]) and 1 <= b2 - b1 <= 3:
            continue
        return None
    return 'homophone'


def executable(name):
    for directory in ('/opt/homebrew/bin', str(Path.home() / '.local' / 'bin')):
        candidate = Path(directory) / name
        if candidate.is_file():
            return str(candidate)
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f'Required local tool is missing: {name}')
    return found


def run(command, env=None):
    # A Ctrl-C or SIGTERM must not orphan Whisper/ffmpeg. Each short-lived child
    # gets its own process group, and only that owned group is terminated here.
    # Whisper can print a split accented letter as bytes that are not UTF-8; they read as U+FFFD.
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             errors='replace', start_new_session=True,
                             env={**os.environ, **env} if env else None)
    try:
        stdout, stderr = child.communicate()
        if child.returncode:
            raise RuntimeError(f'{Path(command[0]).name} exited {child.returncode}: {stderr.strip()}')
        return stdout
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


def phonemes(text, espeak):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    # espeak marks a liaison with "-" (ses → "se-z", ces → "sez"); it is not a sound, so it must not decide a match.
    return re.sub(r'[\sˈˌː-]', '', run([espeak, '-q', '-v', LANGUAGE['espeak'], '--ipa', text]))


def transcribe(path, whisper):
    # Whole-clip validation needs no vocabulary DTW boundary or word trimming.
    run([whisper, '-m', str(WHISPER_MODEL), '-l', LANGUAGE['validation']['language'], '--no-flash-attn',
         '-ojf', '-np', str(path)])
    # whisper.cpp can leave a split accented letter as bytes that are not UTF-8; it reads as U+FFFD and fails the check.
    result = json.loads(Path(str(path) + '.json').read_bytes().decode('utf-8', errors='replace'))
    return ''.join(segment['text'] for segment in result['transcription']).strip()


def clips_from(name, code='fr'):
    # The app owns what a clip is; this script only asks it, so ids and text never drift.
    listed = json.loads(run([executable('bun'), str(ROOT / 'scripts' / 'list-clips.ts'), name], {'ECHO_LANG': code}))
    clips = [{'id': clip['id'], 'text': clip['text']} for clip in listed]
    if not clips:
        raise ValueError(f'The {name} set lists no clips')
    seen = set()
    for clip in clips:
        if not CLIP_ID.fullmatch(clip['id']) or clip['id'] in seen:
            raise ValueError(f'Unsafe or duplicate clip id: {clip["id"]}')
        if not clip['text'].strip():
            raise ValueError(f'Empty French source for {clip["id"]}')
        seen.add(clip['id'])
    return clips


def signature_settings():
    voice = json.loads(VOICE_PROVENANCE.read_text())
    reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()
    return {'model': MODEL, 'settings': LANGUAGE['settings'], 'pipeline': PIPELINE,
            'referenceSha256': reference_hash, 'voiceProvenance': voice,
            'encoding': ENCODING, 'validation': LANGUAGE['validation']}


def clip_signature(settings, clip):
    # The cache key: a clip re-renders only when its text or any generation setting changes.
    payload = {**settings, 'source': clip}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def render_wav(model, conds, text, seed, path, mx, np):
    mx.random.seed(seed)
    chunks = []
    samples = None
    pcm = None
    result = None
    try:
        for result in model.generate(text=text, conds=conds, verbose=False, **LANGUAGE['settings']):
            chunks.append(result.audio)
        if not chunks:
            raise RuntimeError('No audio generated')
        samples = mx.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        mx.eval(samples)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        if pcm.size == 0 or not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .001:
            raise RuntimeError('Empty, non-finite or silent generated audio')
        rate = int(model.sample_rate)
        with wave.open(str(path), 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(rate)
            stream.writeframes((np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
        return round(len(pcm) / rate, 3)
    finally:
        chunks.clear()
        samples = pcm = result = None
        mx.clear_cache()


def selected_clips(args):
    clips = clips_from(args.set, args.lang)
    if args.ids is not None:
        wanted = {value.strip() for value in args.ids.split(',') if value.strip()}
        unknown = wanted - {clip['id'] for clip in clips}
        if not wanted or unknown:
            raise ValueError(f'--ids must name existing {args.set} clips; unknown: {sorted(unknown)}')
        clips = [clip for clip in clips if clip['id'] in wanted]
    return clips


def seed_list(args):
    seeds = [int(value.strip()) for value in args.seeds.split(',') if value.strip()]
    if not seeds:
        raise ValueError('--seeds must contain at least one integer')
    return seeds


def build(args, audio):
    clips = selected_clips(args)
    seeds = seed_list(args)
    signature_settings_ = signature_settings()

    def signature(clip):
        return clip_signature(signature_settings_, clip)

    manifest_path = audio / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    pending = []
    for clip in clips:
        path = audio / f'{clip["id"]}.mp3'
        cached = manifest.get(clip['id'], {})
        if (args.force or not path.is_file() or cached.get('signature') != signature(clip)
                or cached.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest()):
            pending.append(clip)
    if not pending:
        print(json.dumps({'set': args.set, 'cached': len(clips), 'pending': 0}), flush=True)
        return 0

    ffmpeg = executable('ffmpeg')
    whisper = executable('whisper-cli')
    espeak = executable('espeak-ng')
    if not WHISPER_MODEL.is_file():
        raise RuntimeError(f'Required local Whisper model is missing: {WHISPER_MODEL}')
    command = f'scripts/render-clips.py --set {args.set}' if args.lang == 'fr' else f'scripts/render-clips.py --lang {args.lang} --set {args.set}'
    provenance = {**signature_settings_, 'set': args.set, 'source': f'scripts/list-clips.ts {args.set}',
                  'python': sys.executable, 'reference': str(REFERENCE.relative_to(ROOT)),
                  'generationCommand': command,
                  'processing': f'Generate each complete {LANGUAGE["name"]} source without a carrier or trimming; encode MP3, decode it, then validate the entire spoken text locally.',
                  'validatorDependencies': {'whisper': whisper, 'whisperModel': str(WHISPER_MODEL),
                                            'espeak': espeak, 'ffmpeg': ffmpeg},
                  'pronunciationCaveat': 'Synthetic speech and ASR can make mistakes. Full phonetic agreement permits homophones and is not native-speaker certification. Dialogue lines use one selected voice, not separate character voices.'}
    atomic_json(audio / 'provenance.json', provenance)
    print(json.dumps({'set': args.set, 'loading': MODEL, 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)

    # Import and load only after cache/dependency checks. Offline mode forbids
    # downloads; missing cached model files fail rather than starting a service.
    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model

    model = conds = None
    failures = []
    completed = 0
    try:
        model = load_model(MODEL)
        conds = model.prepare_conditionals(str(REFERENCE), 24000, exaggeration=SETTINGS['exaggeration'])
        with tempfile.TemporaryDirectory(prefix='.render-', dir=audio) as work:
            scratch = Path(work)
            for index, clip in enumerate(pending, 1):
                started = time.monotonic()
                errors = []
                final = audio / f'{clip["id"]}.mp3'
                expected_phonemes = phonemes(clip['text'], espeak)
                for seed in seeds:
                    try:
                        wav = scratch / 'source.wav'
                        mp3 = scratch / 'encoded.mp3'
                        decoded = scratch / 'decoded.wav'
                        seconds = render_wav(model, conds, clip['text'], seed, wav, mx, np)
                        lead_in = ['-af', LEAD_IN] if args.set in LEAD_IN_SETS else []
                        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), *lead_in,
                             '-codec:a', ENCODING['codec'], '-b:a', ENCODING['bitrate'], str(mp3)])
                        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3),
                             '-ac', '1', '-ar', str(VALIDATION['sampleRate']), str(decoded)])
                        transcript = transcribe(decoded, whisper)
                        check = verdict(transcript, clip['text'], expected_phonemes, espeak, args.set)
                        if not check:
                            errors.append({'seed': seed, 'error': 'Full spoken text mismatch', 'transcript': transcript})
                            continue
                        record = {**clip, 'set': args.set, 'signature': signature(clip), 'model': MODEL,
                                  'pipeline': PIPELINE, 'seconds': seconds, 'transcript': transcript,
                                  'check': check, 'seed': seed, **({'leadIn': LEAD_IN_MS} if lead_in else {}),
                                  'sha256': hashlib.sha256(mp3.read_bytes()).hexdigest(),
                                  'generatedAt': datetime.now(timezone.utc).isoformat(),
                                  'renderSeconds': round(time.monotonic() - started, 2)}
                        mp3.replace(final)
                        manifest[clip['id']] = record
                        atomic_json(manifest_path, manifest)
                        completed += 1
                        print(json.dumps({'done': index, 'total': len(pending), **record}, ensure_ascii=False), flush=True)
                        break
                    except Exception as error:
                        errors.append({'seed': seed, 'error': str(error)})
                    finally:
                        mx.clear_cache()
                else:
                    failures.append({'id': clip['id'], 'text': clip['text'], 'attempts': errors})
                    # Never serve stale/unchecked output for a failed re-render.
                    final.unlink(missing_ok=True)
                    manifest.pop(clip['id'], None)
                    atomic_json(manifest_path, manifest)
                    print(json.dumps({'failed': clip['id'], 'attempts': errors}, ensure_ascii=False), flush=True)
                atomic_json(audio / 'failures.json', failures)
    finally:
        conds = model = None
        gc.collect()
        mx.clear_cache()
        # A completed/failed clip is saved immediately; an interrupted clip is
        # retried on the next explicit invocation, never by ordinary browsing.
        atomic_json(audio / 'failures.json', failures)
    print(json.dumps({'set': args.set, 'requested': len(clips), 'cached': len(clips) - len(pending),
                      'rendered': completed, 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
    return 1 if failures else 0


# Swedish clips are rendered and checked this many at a time: each round's takes wait on disk for one KB-Whisper run,
# and a finished batch is saved before the next starts.
SV_BATCH = 40


def build_swedish(args, audio):
    """Swedish clips in the Higgs voice (higgs_swedish.py, shared with render-audio-sv.py). Per seed, every clip of the
    batch still waiting gets a take trimmed 250 ms after its speech; one KB-Whisper run then checks the round. A take
    passes when it is heard as its text (or as words espeak-ng says the same), with nothing after the speech, a quiet
    end and within its frame limit. A clip no seed passes for is left unrecorded and listed in failures.json."""
    import higgs_swedish as sv
    clips = selected_clips(args)
    seeds = seed_list(args)
    reference_hash = hashlib.sha256(sv.REFERENCE.read_bytes()).hexdigest()

    def signature(clip):
        # The cache key: a clip re-renders only when its text, the voice or the pipeline changes.
        return hashlib.sha256(json.dumps([sv.MODEL, sv.REVISION, sv.BUILD.name, sv.SETTINGS, SV_PIPELINE, reference_hash, clip['text']], ensure_ascii=False).encode()).hexdigest()

    manifest_path = audio / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    pending = []
    for clip in clips:
        path = audio / f'{clip["id"]}.mp3'
        cached = manifest.get(clip['id'], {})
        if (args.force or not path.is_file() or cached.get('signature') != signature(clip)
                or cached.get('sha256') != hashlib.sha256(path.read_bytes()).hexdigest()):
            pending.append(clip)
    if not pending:
        print(json.dumps({'set': args.set, 'cached': len(clips), 'pending': 0}), flush=True)
        return 0

    ffmpeg = executable('ffmpeg')
    atomic_json(audio / 'provenance.json', {
        'model': sv.MODEL, 'revision': sv.REVISION, 'build': sv.BUILD.name, 'settings': sv.SETTINGS, 'pipeline': SV_PIPELINE,
        'referenceSha256': reference_hash, 'reference': str(sv.REFERENCE.relative_to(ROOT)), 'encoding': ENCODING,
        'set': args.set, 'source': f'scripts/list-clips.ts {args.set} (ECHO_LANG=sv)', 'python': sys.executable,
        'generationCommand': f'scripts/render-clips.py --lang sv --set {args.set}',
        'processing': 'Say each complete Swedish source, capitalised, with a full stop and a pause tag; cut 250 ms after the measured end of speech. KB-Whisper must hear the cut clip as the text (or words espeak-ng pronounces the same), with no sound after the speech, a quiet end and no frame-limit stop. A failing clip is re-rendered with the next seed; after the last it is left unrecorded.',
        'validation': {'model': sv.WHISPER, 'revision': sv.WHISPER_REVISION, 'language': 'sv', 'input': 'trimmed-wav-before-encoding'},
        'pronunciationCaveat': 'Synthetic speech and ASR can make mistakes; vowel length is the slip KB-Whisper catches least reliably. Dialogue lines use one voice, not separate character voices.'})
    print(json.dumps({'set': args.set, 'loading': sv.MODEL, 'revision': sv.REVISION, 'pending': len(pending), 'pipeline': SV_PIPELINE}), flush=True)
    whisper = sv.whisper_model()
    voice = sv.Voice()
    lead_in = ['-af', LEAD_IN] if args.set in LEAD_IN_SETS else []
    failures = []
    completed = 0
    tries = {clip['id']: [] for clip in pending}
    with tempfile.TemporaryDirectory(prefix='.render-', dir=audio) as work:
        scratch = Path(work)
        for start in range(0, len(pending), SV_BATCH):
            waiting = pending[start:start + SV_BATCH]
            for seed in seeds:
                if not waiting:
                    break
                made = []
                for clip in waiting:
                    began = time.monotonic()
                    try:
                        take = voice.take(clip['text'], seed, gap=sv.SENTENCE_GAP)
                    except Exception as error:
                        tries[clip['id']].append({'seed': seed, 'error': str(error)})
                        continue
                    wav = scratch / f'{clip["id"]}.{seed}.wav'
                    sv.save_wav(wav, take['clip'], voice.sample_rate)
                    made.append((clip, wav, take, round(time.monotonic() - began, 2)))
                heard = sv.transcribe([wav for _, wav, _, _ in made], whisper) if made else []
                passed = set()
                for (clip, wav, take, render_seconds), transcript in zip(made, heard):
                    found = take['found']
                    check = sv.heard_as(transcript, clip['text'])
                    attempt = {'seed': seed, 'transcript': transcript, 'heardAs': check, 'tailFlags': found['flags'],
                               'lateSounds': found['late'], 'frames': take['frames'], 'hitFrameLimit': take['hitFrameLimit']}
                    if not check or found['flags'] or take['hitFrameLimit']:
                        tries[clip['id']].append(attempt)
                        wav.unlink()
                        continue
                    mp3 = scratch / 'encoded.mp3'
                    run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), *lead_in,
                         '-codec:a', ENCODING['codec'], '-b:a', ENCODING['bitrate'], str(mp3)])
                    wav.unlink()
                    record = {**clip, 'set': args.set, 'signature': signature(clip), 'model': sv.MODEL, 'revision': sv.REVISION,
                              'build': sv.BUILD.name, 'pipeline': SV_PIPELINE, 'seconds': round(len(take['clip']) / voice.sample_rate, 3),
                              'transcript': transcript, 'check': check, 'seed': seed, 'lateSounds': found['late'],
                              'speechStart': found['begin'] / 100, 'speechEnd': found['end'] / 100,
                              **({'leadIn': LEAD_IN_MS} if lead_in else {}),
                              'sha256': hashlib.sha256(mp3.read_bytes()).hexdigest(),
                              'generatedAt': datetime.now(timezone.utc).isoformat(), 'renderSeconds': render_seconds}
                    mp3.replace(audio / f'{clip["id"]}.mp3')
                    manifest[clip['id']] = record
                    atomic_json(manifest_path, manifest)
                    completed += 1
                    passed.add(clip['id'])
                    print(json.dumps({'done': completed, 'total': len(pending), **record}, ensure_ascii=False), flush=True)
                waiting = [clip for clip in waiting if clip['id'] not in passed]
            for clip in waiting:
                failures.append({'id': clip['id'], 'text': clip['text'], 'attempts': tries[clip['id']]})
                # Never serve stale or unchecked audio for a clip that failed to re-render.
                (audio / f'{clip["id"]}.mp3').unlink(missing_ok=True)
                manifest.pop(clip['id'], None)
                atomic_json(manifest_path, manifest)
                print(json.dumps({'failed': clip['id'], 'attempts': tries[clip['id']]}, ensure_ascii=False), flush=True)
            atomic_json(audio / 'failures.json', failures)
    atomic_json(audio / 'failures.json', failures)
    print(json.dumps({'set': args.set, 'requested': len(clips), 'cached': len(clips) - len(pending),
                      'rendered': completed, 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
    return 1 if failures else 0



def pad(args, audio):
    """Give every recorded clip of the set that lacks it the lead-in, keeping its manifest record true (sha256)."""
    if args.set not in LEAD_IN_SETS:
        raise ValueError(f'--pad is for {", ".join(LEAD_IN_SETS)} clips')
    ffmpeg = executable('ffmpeg')
    manifest_path = audio / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    padded = 0
    for clip_id, record in sorted(manifest.items()):
        path = audio / f'{clip_id}.mp3'
        if record.get('leadIn') == LEAD_IN_MS or not path.is_file():
            continue
        temporary = audio / f'{clip_id}.pad.mp3'
        run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(path), '-af', LEAD_IN,
             '-codec:a', ENCODING['codec'], '-b:a', ENCODING['bitrate'], str(temporary)])
        temporary.replace(path)
        manifest[clip_id] = {**record, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'leadIn': LEAD_IN_MS}
        padded += 1
        if padded % 100 == 0:
            atomic_json(manifest_path, manifest)
            print(json.dumps({'padded': padded}), flush=True)
    atomic_json(manifest_path, manifest)
    print(json.dumps({'set': args.set, 'padded': padded, 'recordings': len(manifest)}), flush=True)
    return 0


def main():
    global LANGUAGE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set', required=True, choices=SETS, help='Which clip set to render')
    parser.add_argument('--lang', choices=('fr', 'pt', 'sv'), default='fr', help='The language to record; French unless given')
    parser.add_argument('--ids', help='Comma-separated clip ids; default: every clip of the set')
    parser.add_argument('--force', action='store_true', help='Re-render selected clips even if their signature matches')
    parser.add_argument('--seeds', default='42,17,101', help='Deterministic retry seeds, tried in order')
    parser.add_argument('--pad', action='store_true', help='Only give the recorded clips that lack it the 250 ms lead-in')
    parser.add_argument('--audio-dir', type=Path, help="Where the set's clips, manifest and failures live (audio/<set>, or audio/<code>/<set>, unless given); point elsewhere to trial a change")
    args = parser.parse_args()
    LANGUAGE = LANGUAGES.get(args.lang, LANGUAGES['fr'])
    audio = args.audio_dir or (ROOT / 'audio' / args.set if args.lang == 'fr' else ROOT / 'audio' / args.lang / args.set)
    audio.mkdir(parents=True, exist_ok=True)
    shown = audio.relative_to(ROOT) if audio.is_relative_to(ROOT) else audio

    def interrupt(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    try:
        with (audio / '.render.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError(f'Another renderer owns {shown}')
            if args.pad:
                return pad(args, audio)
            return build_swedish(args, audio) if args.lang == 'sv' else build(args, audio)
    except KeyboardInterrupt:
        print(f'{args.set} audio render interrupted; owned validators and model resources released.', file=sys.stderr)
        return 130
    except Exception as error:
        print(f'{args.set} audio render failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
