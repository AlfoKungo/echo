#!/usr/bin/env python3
"""Render the English meaning of every vocabulary word, for the Walkman track.

Each gloss is turned into speakable English (spoken_english.py), said by one Kokoro
voice, trimmed of leading and trailing silence, encoded as MP3, decoded again and
checked with Whisper. A take passes when the free transcript is the text; when it sounds
the same (espeak phonemes), since Whisper writes the commoner homophone ("Hi" for high);
or when Whisper scores the text at least as likely as its own transcript, within
SCORE_SLACK nats, since it mishears lone short words ("they" as "They have."). A failing take
is retried at other speaking rates; a word with no passing take gets no recording and
is listed in failures.json. Clips go to audio/en/<wordId>.mp3 with a manifest whose
signature re-renders a clip only when its text or a setting changes.

Run with the TTS venv:
  .venv/bin/python scripts/render-english.py [--ids a,b] [--force]
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'

import argparse
import difflib
import glob
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import wave
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from spoken_english import spoken  # noqa: E402
from whisper_scorer import Scorer  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODEL = 'mlx-community/Kokoro-82M-bf16'
VOICE = 'af_heart'
SPEEDS = (0.95, 0.9, 1.0, 0.85)
SCORE_SLACK = 1.0
WHISPER = '/opt/homebrew/bin/whisper-cli'
WHISPER_MODEL = Path.home() / '.local/share/whisper-models/ggml-large-v3-turbo.bin'
ESPEAK = '/opt/homebrew/bin/espeak-ng'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
PIPELINE = 'english-gloss-v2'
# Only true silence is trimmed, keeping 80 ms at each end: a stricter threshold clipped quiet
# edges (the f of fish, the t of ant), so the track's own gaps set the rhythm.
TRIM = ('silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.08,'
        'areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.08,areverse')
ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']


def words(extra=None):
    found = [word for name in ('core', 'world') for word in json.loads((ROOT / 'content' / f'{name}.json').read_text())]
    return found + (json.loads(Path(extra).read_text()) if extra else [])


def number_words(value):
    if value < 20:
        return ONES[value]
    if value < 100:
        return TENS[value // 10] + ('' if value % 10 == 0 else ' ' + ONES[value % 10])
    return {100: 'one hundred', 1000: 'one thousand'}.get(value, str(value))


def normalize(text):
    # Whisper writes numbers as digits ("20."); the text says them in words.
    text = re.sub(r'\b(\d{1,3}(?:,\d{3})?)\b', lambda match: number_words(int(match.group(1).replace(',', ''))), text.lower().replace('-', ' '))
    return ' '.join(re.sub(r"[^a-z0-9' ]+", ' ', text).split())


def run(command):
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def phonemes(text):
    return re.sub(r"[\s'ˈˌ,%=_:]+", '', run([ESPEAK, '-q', '-x', '-v', 'en-us', text]))


def transcribe(path):
    run([WHISPER, '-m', str(WHISPER_MODEL), '-l', 'en', '--no-flash-attn', '-ojf', '-np', str(path)])
    result = json.loads(Path(str(path) + '.json').read_text())
    return ''.join(segment['text'] for segment in result['transcription']).strip()


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--extra-words', help='A JSON list of added words (from songs) to render alongside the deck')
    args = parser.parse_args()
    out = ROOT / 'audio' / 'en'
    out.mkdir(exist_ok=True)
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    voice_path = glob.glob(str(Path.home() / f'.cache/huggingface/hub/models--mlx-community--Kokoro-82M-bf16/snapshots/*/voices/{VOICE}.safetensors'))[0]
    settings = {'model': MODEL, 'voice': VOICE, 'speeds': SPEEDS, 'pipeline': PIPELINE, 'trim': TRIM, 'bitrate': '96k'}
    wanted = set(value.strip() for value in args.ids.split(',')) if args.ids else None
    pending = []
    for word in words(args.extra_words):
        if wanted is not None and word['id'] not in wanted:
            continue
        text = spoken(word['en'], word['fr'])
        signature = hashlib.sha256(json.dumps({**settings, 'text': text}, sort_keys=True).encode()).hexdigest()
        path = out / f'{word["id"]}.mp3'
        cached = manifest.get(word['id'], {})
        if args.force or not path.is_file() or cached.get('signature') != signature:
            pending.append((word, text, signature))
    print(json.dumps({'pending': len(pending), 'cached': len(manifest)}), flush=True)
    if not pending:
        return 0

    import mlx.core as mx
    import numpy as np
    from mlx_audio.tts.utils import load_model
    model = load_model(MODEL)
    scorer = Scorer('en')
    failures = []
    with tempfile.TemporaryDirectory(prefix='.render-en-', dir=out) as work:
        scratch = Path(work)
        for index, (word, text, signature) in enumerate(pending, 1):
            attempts = []
            # The article added for a French noun ("the love" for l'amour) can be what fails the check; the bare
            # gloss is tried after it, under the same signature so a passing take is not redone.
            plain = spoken(word['en'])
            wordings = [text] + ([plain] if plain != text else [])
            done = False
            for said_text in wordings:
                for speed in SPEEDS:
                    raw, trimmed, mp3, decoded = (scratch / name for name in ('raw.wav', 'trimmed.wav', 'take.mp3', 'decoded.wav'))
                    chunks = [result.audio for result in model.generate(text=said_text, voice=voice_path, speed=speed, lang_code='a', verbose=False)]
                    pcm = np.asarray(mx.concatenate(chunks) if len(chunks) > 1 else chunks[0], dtype=np.float32).reshape(-1)
                    with wave.open(str(raw), 'wb') as stream:
                        stream.setnchannels(1)
                        stream.setsampwidth(2)
                        stream.setframerate(24000)
                        stream.writeframes((np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
                    mx.clear_cache()
                    run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw), '-af', TRIM, str(trimmed)])
                    run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-codec:a', 'libmp3lame', '-b:a', '96k', str(mp3)])
                    run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
                    transcript = transcribe(decoded)
                    heard, said = normalize(transcript), normalize(said_text)
                    ratio = difflib.SequenceMatcher(None, heard.replace(' ', ''), said.replace(' ', '')).ratio()
                    attempt = {'text': said_text, 'speed': speed, 'transcript': transcript, 'ratio': round(ratio, 3)}
                    attempts.append(attempt)
                    check = 'transcript' if heard.replace(' ', '') == said.replace(' ', '') else None
                    if not check and heard and phonemes(transcript) == phonemes(said_text):
                        check = 'phonemes'
                    if not check and heard:
                        attempt['scores'] = scorer(decoded, [said_text, transcript])
                        if attempt['scores'][0] >= attempt['scores'][1] - SCORE_SLACK:
                            check = 'scored'
                    if not check:
                        continue
                    final = out / f'{word["id"]}.mp3'
                    mp3.replace(final)
                    seconds = float(run(['/opt/homebrew/bin/ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(final)]))
                    manifest[word['id']] = {'id': word['id'], 'en': word['en'], 'text': said_text, 'signature': signature, 'speed': speed,
                                            'transcript': transcript, 'check': check, 'scores': attempt.get('scores'),
                                            'seconds': round(seconds, 3), 'sha256': hashlib.sha256(final.read_bytes()).hexdigest(),
                                            'generatedAt': datetime.now(timezone.utc).isoformat()}
                    atomic_json(manifest_path, manifest)
                    print(json.dumps({'done': index, 'total': len(pending), 'id': word['id'], 'text': said_text, 'transcript': transcript, 'check': check}), flush=True)
                    done = True
                    break
                if done:
                    break
            if not done:
                (out / f'{word["id"]}.mp3').unlink(missing_ok=True)
                manifest.pop(word['id'], None)
                atomic_json(manifest_path, manifest)
                failures.append({'id': word['id'], 'text': text, 'attempts': attempts})
                print(json.dumps({'failed': word['id'], 'text': text, 'attempts': attempts}), flush=True)
    atomic_json(out / 'failures.json', failures)
    print(json.dumps({'rendered': len(pending) - len(failures), 'failed': len(failures), 'recordings': len(manifest)}), flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
