"""Render French vocabulary in context, then extract the word using local Whisper timings."""
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
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1, 'temperature': 0.5, 'max_tokens': 400}
PIPELINE = 'context-word-pause-v2'
# The word is cut out of "On dit : <word>." inside the pause after the carrier (carrier_cut.py).
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ids', help='Comma-separated word IDs; default is the whole deck')
parser.add_argument('--force', action='store_true')
parser.add_argument('--sources', nargs='+', choices=['core', 'world'], default=['core', 'world'])
parser.add_argument('--seeds', default='42,17,101,7,13,99', help='Seeds to try when speech content or the pause does not check out')
parser.add_argument('--carrier', help='Override the French lead-in; use --force to replace cached clips')
parser.add_argument('--keep-context', action='store_true', help='Keep full sentences for alignment inspection')
parser.add_argument('--audio-dir', type=Path, default=ROOT / 'audio', help='Where clips and the manifest live; point elsewhere to trial a change')
parser.add_argument('--extra-words', type=Path, help='A JSON list of added words (from songs) to render alongside the deck')
args = parser.parse_args()
AUDIO = args.audio_dir
AUDIO.mkdir(parents=True, exist_ok=True)
contexts = json.loads((ROOT / 'voices/contexts.json').read_text())
words = []
for name in args.sources:
    words.extend(json.loads((ROOT / 'content' / f'{name}.json').read_text()))
if args.extra_words:
    words.extend(json.loads(args.extra_words.read_text()))
groups = {}
for word in words:
    groups.setdefault(word['category'], []).append(word)
words = [group[i] for i in range(max(map(len, groups.values()))) for group in groups.values() if i < len(group)]
if args.ids:
    wanted = set(args.ids.split(','))
    words = [word for word in words if word['id'] in wanted]
    if len(words) != len(wanted):
        raise ValueError('One or more word IDs do not exist')
manifest_path = AUDIO / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
reference_hash = hashlib.sha256(REFERENCE.read_bytes()).hexdigest()

def carrier_for(word):
    return args.carrier if args.carrier is not None else contexts.get(word['id'], {}).get('before', 'On dit : ')

def sounds_like(word):
    # espeak says a few words wrongly (laid as /lɛd/, like laide); contexts.json can name a word spoken the same
    # (lait), so the phonetic check compares the take with how the word really sounds.
    return contexts.get(word['id'], {}).get('soundsLike', word['fr'].strip().rstrip('.!?'))

def signature(word):
    return hashlib.sha256(json.dumps([MODEL, SETTINGS, PIPELINE, reference_hash, word['fr'], carrier_for(word)], ensure_ascii=False).encode()).hexdigest()

def phonemes(text):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    result = subprocess.run(['/opt/homebrew/bin/espeak-ng', '-q', '-v', 'fr-fr', '--ipa', text], capture_output=True, text=True, check=True)
    # Timestamp line breaks are not pauses; French vowel length varies by accent.
    return re.sub(r'[\sˈˌː]', '', result.stdout)

def transcribe(path):
    return carrier_cut.transcribe_tokens(path, keep=args.keep_context)

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
    carriers = list(dict.fromkeys([carrier_for(word), *carrier_cut.CARRIERS]))
    errors = []
    wav = AUDIO / f"{word['id']}.context.wav"
    trimmed = AUDIO / f"{word['id']}.trim.wav"
    final = AUDIO / f"{word['id']}.mp3"
    fallback_wav = AUDIO / f"{word['id']}.fallback.wav"
    chosen = fallback = None
    for carrier, seed in [(lead, seed) for lead in carriers for seed in map(int, args.seeds.split(','))]:
        text = carrier + word['fr'].strip().rstrip('.!?') + '.'
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
        heard = normalize(isolated) == normalize(word['fr']) or (isolated and phonemes(isolated) == phonemes(sounds_like(word)))
        entry = {'text': word['fr'], 'signature': signature(word), 'model': MODEL, 'pipeline': PIPELINE, 'alignment': 'pause-after-carrier', 'carrier': carrier, 'seconds': round(len(clip) / sample_rate, 3), 'trimStart': round(cut, 3), 'pauseMs': (pause[1] - pause[0]) * 10, 'fullSeconds': round(len(pcm) / sample_rate, 3), 'transcript': transcript, 'isolatedTranscript': isolated, 'check': 'text' if exact else 'phonetic', 'cutCheck': 'heard' if heard else 'unconfirmed', 'seed': seed, 'renderSeconds': round(time.monotonic() - started, 2)}
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
        failures.append({'id': word['id'], 'text': word['fr'], 'attempts': errors})
        print(json.dumps({'failed': word['id'], 'attempts': errors}), flush=True)
    if index % 10 == 0:
        save_manifest()
    mx.clear_cache()
save_manifest()
(AUDIO / 'failures.json').write_text(json.dumps(failures, ensure_ascii=False, indent=2))
print(json.dumps({'complete': len(words) - len(failures), 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
raise SystemExit(1 if failures else 0)
