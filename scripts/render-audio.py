"""Render vocabulary in context (French, or Brazilian Portuguese with --lang pt), then extract the word using local
Whisper timings."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import argparse
import hashlib
import json
import re
import subprocess
import time
import wave
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

import carrier_cut
from carrier_cut import normalize

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'mlx-community/chatterbox-multilingual-v3'
REFERENCE = ROOT / 'voices/french-reference.wav'
PIPELINE = 'context-word-pause-v2'
# Each language's deck, recordings, contexts, lead-ins and the voices that check a take (espeak-ng, Whisper). French
# reads content/ and writes audio/ as it always has. Portuguese speaks in the same reference voice with Chatterbox told
# the language is Portuguese; its deck carries each word under "pt" and its clips go to audio/pt.
LANGUAGES = {
    'fr': {'content': ROOT / 'content', 'audio': ROOT / 'audio', 'contexts': ROOT / 'voices/contexts.json',
           'carrier': 'On dit : ', 'carriers': carrier_cut.CARRIERS, 'espeak': 'fr-fr'},
    # "A palavra é…" makes the voice stop where "A palavra é:" runs on, and "Escute." ends a sentence before the word,
    # as French's "On dit…" and "Écoutez." do (carrier_cut.py).
    'pt': {'content': ROOT / 'content/pt', 'audio': ROOT / 'audio/pt', 'contexts': ROOT / 'content/pt/contexts.json',
           'carrier': 'A palavra é: ', 'carriers': ('A palavra é: ', 'A palavra é… ', 'Escute. '), 'espeak': 'pt-br'},
}
# The word is cut out of "<carrier><word>." inside the pause after the carrier (carrier_cut.py).
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--lang', choices=sorted(LANGUAGES), default='fr', help='The language to record; French unless given')
parser.add_argument('--ids', help='Comma-separated word IDs; default is the whole deck')
parser.add_argument('--force', action='store_true')
parser.add_argument('--sources', nargs='+', choices=['core', 'world'], default=['core', 'world'])
parser.add_argument('--seeds', default='42,17,101,7,13,99', help='Seeds to try when speech content or the pause does not check out')
parser.add_argument('--carrier', help='Override the lead-in; use --force to replace cached clips')
parser.add_argument('--keep-context', action='store_true', help='Keep full sentences for alignment inspection')
parser.add_argument('--audio-dir', type=Path, help="Where clips and the manifest live (the language's own folder unless given); point elsewhere to trial a change")
parser.add_argument('--extra-words', type=Path, help='A JSON list of added words (from songs) to render alongside the deck')
args = parser.parse_args()
LANGUAGE = LANGUAGES[args.lang]
# A word's text is under the language's code. The settings are part of every clip's signature, so for French they
# stay exactly what they were before there was a choice.
TEXT = args.lang
SETTINGS = {'lang_code': args.lang, 'cfg_weight': 0.5, 'exaggeration': 0.1, 'temperature': 0.5, 'max_tokens': 400}
AUDIO = args.audio_dir or LANGUAGE['audio']
AUDIO.mkdir(parents=True, exist_ok=True)
contexts = json.loads(LANGUAGE['contexts'].read_text()) if LANGUAGE['contexts'].exists() else {}
words = []
for name in args.sources:
    # French's deck is always there; another language's may not be written yet, and --extra-words renders alone.
    path = LANGUAGE['content'] / f'{name}.json'
    if args.lang == 'fr' or path.exists():
        words.extend(json.loads(path.read_text()))
if args.extra_words:
    words.extend(json.loads(args.extra_words.read_text()))
groups = {}
for word in words:
    groups.setdefault(word['category'], []).append(word)
words = [group[i] for i in range(max(map(len, groups.values()), default=0)) for group in groups.values() if i < len(group)]
if args.ids:
    wanted = set(args.ids.split(','))
    words = [word for word in words if word['id'] in wanted]
    if len(words) != len(wanted):
        raise ValueError('One or more word IDs do not exist')
manifest_path = AUDIO / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()

def carrier_for(word):
    return args.carrier if args.carrier is not None else contexts.get(word['id'], {}).get('before', LANGUAGE['carrier'])

def sounds_like(word):
    # espeak says a few words wrongly (laid as /lɛd/, like laide); contexts.json can name a word spoken the same
    # (lait), so the phonetic check compares the take with how the word really sounds.
    return contexts.get(word['id'], {}).get('soundsLike', word[TEXT].strip().rstrip('.!?'))

def signature(word):
    return hashlib.sha256(json.dumps([MODEL, SETTINGS, PIPELINE, reference_hash, word[TEXT], carrier_for(word)], ensure_ascii=False).encode()).hexdigest()

def phonemes(text):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    result = subprocess.run(['/opt/homebrew/bin/espeak-ng', '-q', '-v', LANGUAGE['espeak'], '--ipa', text], capture_output=True, text=True, check=True)
    # Timestamp line breaks are not pauses; French vowel length varies by accent.
    return re.sub(r'[\sˈˌː]', '', result.stdout)

def transcribe(path):
    return carrier_cut.transcribe_tokens(path, keep=args.keep_context, language=args.lang)

# Every word clip starts with the same 250 ms of quiet: a phone (and Bluetooth earbuds even more) drops the first
# moment of a short clip while its output wakes. The Walkman copies trim it back (build-walkman-clips.py).
# asetnsamples pads the last frame to a whole MP3 frame: ffmpeg 9's libmp3lame refuses a short one from adelay.
LEAD_IN = 'silenceremove=start_periods=1:start_threshold=-60dB,adelay=250:all=1,asetnsamples=n=1152:p=1'

def save_manifest():
    temporary = AUDIO / 'manifest.tmp.json'
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    temporary.replace(manifest_path)

def save_wav(path, samples, sample_rate):
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())

pending = [word for word in words if args.force or not (AUDIO / f"{word['id']}.mp3").exists() or manifest.get(word['id'], {}).get('signature') != signature(word)]
if not pending:
    print(json.dumps({'cached': len(words), 'pending': 0}), flush=True)
    raise SystemExit(0)
print(json.dumps({'loading': MODEL, 'pending': len(pending), 'pipeline': PIPELINE}), flush=True)
model = load_model(MODEL)
conds = model.prepare_conditionals(str(REFERENCE), 24000, exaggeration=SETTINGS['exaggeration'])
failures = []
for index, word in enumerate(pending, 1):
    started = time.monotonic()
    carriers = list(dict.fromkeys([carrier_for(word), *LANGUAGE['carriers']]))
    errors = []
    wav = AUDIO / f"{word['id']}.context.wav"
    trimmed = AUDIO / f"{word['id']}.trim.wav"
    final = AUDIO / f"{word['id']}.mp3"
    fallback_wav = AUDIO / f"{word['id']}.fallback.wav"
    chosen = fallback = None
    for carrier, seed in [(lead, seed) for lead in carriers for seed in map(int, args.seeds.split(','))]:
        text = carrier + word[TEXT].strip().rstrip('.!?') + '.'
        mx.random.seed(seed)
        chunks = [result.audio for result in model.generate(text=text, conds=conds, verbose=False, **SETTINGS)]
        if not chunks:
            errors.append({'seed': seed, 'error': 'No audio'})
            continue
        samples = mx.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        mx.eval(samples)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        sample_rate = int(model.sample_rate)
        if not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .001:
            errors.append({'seed': seed, 'error': 'Invalid audio'})
            continue
        save_wav(wav, pcm, sample_rate)
        result = transcribe(wav)
        transcript = result.get('text', '').strip()
        exact = normalize(transcript) == normalize(text)
        if not exact and phonemes(transcript) != phonemes(carrier + sounds_like(word) + '.'):
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'Speech content mismatch'})
            continue
        try:
            clip, cut, pause = carrier_cut.cut_after_carrier(pcm, sample_rate, result['tokens'], carrier)
        except carrier_cut.NoCut as error:
            errors.append({'seed': seed, 'transcript': transcript, 'error': error.error, **error.details})
            continue
        save_wav(trimmed, clip, sample_rate)
        # The sentence can check out while the cut still clips the word (fatal heard as "tal"): the cut clip must be
        # heard as the word too. A take that fails this is kept as a fallback in case no take passes.
        isolated = transcribe(trimmed).get('text', '').strip()
        heard = normalize(isolated) == normalize(word[TEXT]) or (isolated and phonemes(isolated) == phonemes(sounds_like(word)))
        entry = {'text': word[TEXT], 'signature': signature(word), 'model': MODEL, 'pipeline': PIPELINE, 'alignment': 'pause-after-carrier', 'carrier': carrier, 'seconds': round(len(clip) / sample_rate, 3), 'trimStart': round(cut, 3), 'pauseMs': (pause[1] - pause[0]) * 10, 'fullSeconds': round(len(pcm) / sample_rate, 3), 'transcript': transcript, 'isolatedTranscript': isolated, 'check': 'text' if exact else 'phonetic', 'cutCheck': 'heard' if heard else 'unconfirmed', 'seed': seed, 'renderSeconds': round(time.monotonic() - started, 2)}
        if not heard:
            errors.append({'seed': seed, 'carrier': carrier, 'isolatedTranscript': isolated, 'error': 'Cut clip not heard as the word'})
            if fallback is None:
                trimmed.replace(fallback_wav)
                fallback = entry
            continue
        chosen = entry
        break
    if chosen is None and fallback is not None:
        chosen = fallback
        fallback_wav.replace(trimmed)
    if chosen is not None:
        temporary = AUDIO / f"{word['id']}.tmp.mp3"
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-af', LEAD_IN, '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)], check=True)
        temporary.replace(final)
        manifest[word['id']] = chosen
        if not args.keep_context:
            wav.unlink(missing_ok=True)
        trimmed.unlink(missing_ok=True)
        fallback_wav.unlink(missing_ok=True)
        print(json.dumps({'done': index, 'total': len(pending), 'id': word['id'], **chosen}), flush=True)
    else:
        # Keep the previous clip when no seed gives a clean cut: an older recording beats a missing one.
        failures.append({'id': word['id'], 'text': word[TEXT], 'attempts': errors})
        print(json.dumps({'failed': word['id'], 'attempts': errors}), flush=True)
    if index % 10 == 0:
        save_manifest()
    mx.clear_cache()
save_manifest()
(AUDIO / 'failures.json').write_text(json.dumps(failures, ensure_ascii=False, indent=2))
print(json.dumps({'complete': len(words) - len(failures), 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
raise SystemExit(1 if failures else 0)
