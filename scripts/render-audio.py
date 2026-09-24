"""Render French vocabulary in context, then extract the word using local Whisper timings."""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
import argparse
import hashlib
import json
import re
import subprocess
import time
import unicodedata
import wave
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'mlx-community/chatterbox-multilingual-v3'
REFERENCE = ROOT / 'voices/french-reference.wav'
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1, 'temperature': 0.5, 'max_tokens': 400}
PIPELINE = 'context-word-pause-v2'
# The word is cut out of "On dit : <word>." inside the pause after the carrier. A cut placed by token timing
# alone landed inside "dit" (a stray sound before the word) or inside the word (its first syllable lost).
MIN_PAUSE = 8   # 10 ms frames: the colon pause; a stop closure inside a word is shorter
MAX_TAIL = 30   # frames of the carrier allowed after its last token's anchor before the pause
LEAD = 3        # frames of silence kept before the word
QUIET_DB = 35   # a frame is silent when this far below the loudest frame
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ids', help='Comma-separated word IDs; default is the whole deck')
parser.add_argument('--force', action='store_true')
parser.add_argument('--sources', nargs='+', choices=['core', 'world'], default=['core', 'world'])
parser.add_argument('--seeds', default='42,17,101,7,13,99', help='Seeds to try when speech content or the pause does not check out')
parser.add_argument('--carrier', help='Override the French lead-in; use --force to replace cached clips')
parser.add_argument('--keep-context', action='store_true', help='Keep full sentences for alignment inspection')
parser.add_argument('--audio-dir', type=Path, default=ROOT / 'audio', help='Where clips and the manifest live; point elsewhere to trial a change')
args = parser.parse_args()
AUDIO = args.audio_dir
AUDIO.mkdir(parents=True, exist_ok=True)
contexts = json.loads((ROOT / 'voices/contexts.json').read_text())
words = []
for name in args.sources:
    words.extend(json.loads((ROOT / 'content' / f'{name}.json').read_text()))
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

def signature(word):
    return hashlib.sha256(json.dumps([MODEL, SETTINGS, PIPELINE, reference_hash, word['fr'], carrier_for(word)], ensure_ascii=False).encode()).hexdigest()

def normalize(text):
    text = unicodedata.normalize('NFC', text.lower().replace('œ', 'oe'))
    return ''.join(character for character in text if character.isalnum())

def phonemes(text):
    text = ' '.join(text.replace('«', '').replace('»', '').replace(':', '').replace('.', '').split())
    result = subprocess.run(['/opt/homebrew/bin/espeak-ng', '-q', '-v', 'fr-fr', '--ipa', text], capture_output=True, text=True, check=True)
    # Timestamp line breaks are not pauses; French vowel length varies by accent.
    return re.sub(r'[\sˈˌː]', '', result.stdout)

def transcribe(path):
    model_path = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'
    subprocess.run(['/opt/homebrew/bin/whisper-cli', '-m', str(model_path), '-l', 'fr', '--dtw', 'large.v3.turbo', '--no-flash-attn', '-ojf', '-np', str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    result_path = Path(str(path) + '.json')
    result = json.loads(result_path.read_text())
    if not args.keep_context:
        result_path.unlink()
    return {'text': ''.join(segment['text'] for segment in result['transcription']), 'tokens': [token for segment in result['transcription'] for token in segment['tokens']]}

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
    # Some words follow "On dit :" with no audible pause; "On dit…" makes the voice stop before the word, and
    # a lead-in that ends the sentence ("Écoutez.") separates even short words such as "mais" or "donc".
    carriers = list(dict.fromkeys([carrier_for(word), 'On dit… ', 'Écoutez. ']))
    errors = []
    wav = AUDIO / f"{word['id']}.context.wav"
    trimmed = AUDIO / f"{word['id']}.trim.wav"
    final = AUDIO / f"{word['id']}.mp3"
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
        if not exact and phonemes(transcript) != phonemes(text):
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'Speech content mismatch'})
            continue
        tokens = [token for token in result['tokens'] if token['t_dtw'] >= 0 and normalize(token['text'])]
        prefix = ''
        boundary = None
        for token_index, token in enumerate(tokens):
            prefix += normalize(token['text'])
            if prefix == normalize(carrier):
                boundary = token_index
                break
        if boundary is None or boundary + 1 >= len(tokens):
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'No reliable word boundary'})
            continue
        frame = sample_rate // 100
        count = len(pcm) // frame
        level = 20 * np.log10(np.sqrt(np.square(pcm[:count * frame].reshape(count, frame)).mean(axis=1)) + 1e-9)
        quiet = level < level.max() - QUIET_DB
        carrier_anchor = int(tokens[boundary]['t_dtw'])  # t_dtw is in centiseconds, i.e. frames
        word_anchor = int(tokens[boundary + 1]['t_dtw'])
        pause, run = None, 0
        for position in range(carrier_anchor, count):
            run = run + 1 if quiet[position] else 0
            if run == MIN_PAUSE:
                end = position + 1
                while end < count and quiet[end]:
                    end += 1
                pause = (position + 1 - MIN_PAUSE, end)
                break
        # The pause must follow the carrier closely and come before the word: a pause found later lies inside
        # the word, and cutting there would drop its first syllable.
        if pause is None or pause[0] - carrier_anchor > MAX_TAIL or pause[0] > word_anchor or pause[1] >= count:
            errors.append({'seed': seed, 'transcript': transcript, 'error': 'No clear pause before the word',
                           'pause': pause, 'carrierAnchor': carrier_anchor, 'wordAnchor': word_anchor})
            continue
        cut = max(pause[0], pause[1] - LEAD) * frame / sample_rate
        clip = pcm[int(cut * sample_rate):].copy()
        if np.count_nonzero(~quiet[pause[1]:]) < 10:
            errors.append({'seed': seed, 'error': 'Too little speech after the pause'})
            continue
        fade = min(len(clip), sample_rate // 200)
        clip[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        save_wav(trimmed, clip, sample_rate)
        temporary = AUDIO / f"{word['id']}.tmp.mp3"
        subprocess.run(['/opt/homebrew/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-codec:a', 'libmp3lame', '-b:a', '96k', str(temporary)], check=True)
        temporary.replace(final)
        isolated = transcribe(trimmed).get('text', '').strip()
        manifest[word['id']] = {'text': word['fr'], 'signature': signature(word), 'model': MODEL, 'pipeline': PIPELINE, 'alignment': 'pause-after-carrier', 'carrier': carrier, 'seconds': round(len(clip) / sample_rate, 3), 'trimStart': round(cut, 3), 'pauseMs': (pause[1] - pause[0]) * 10, 'fullSeconds': round(len(pcm) / sample_rate, 3), 'transcript': transcript, 'isolatedTranscript': isolated, 'check': 'text' if exact else 'phonetic', 'seed': seed, 'renderSeconds': round(time.monotonic() - started, 2)}
        if not args.keep_context:
            wav.unlink(missing_ok=True)
        trimmed.unlink(missing_ok=True)
        print(json.dumps({'done': index, 'total': len(pending), 'id': word['id'], **manifest[word['id']]}), flush=True)
        break
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
