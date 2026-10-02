#!/usr/bin/env python3
"""Make the clips of a Radio episode (lib/radio.ts), every one in the Walkman format so the episode is joined
byte for byte (scripts/build-walkman-clips.py): 24 kHz mono 64 kbps MPEG-2 Layer III frames, levelled alike.

The plan (--plan FILE, written by the server) lists clips by id, each one of:
  {"id": ..., "kind": "convert", "source": "audio/..."}  an existing recording, converted
  {"id": ..., "kind": "en", "text": ...}                 English, said by the Walkman's English voice (Kokoro)
  {"id": ..., "kind": "fr", "text": ...}                 French, said by the deck's French voice (Chatterbox)
Spoken clips are checked like the others: Whisper must hear the text (render-english.py's checks for English,
render-clips.py's for French), else the next take is tried. A short French phrase no take passes for alone (ils
vont, tu peux) is said after a carrier and cut out, as vocabulary words are (carrier_cut.py). A clip nothing passes
for is left out and the episode skips it. Clips go to audio/radio/<id>.mp3; a clip already made from the same text or source is kept.
Prints {"failed": id} per clip that could not be made, and exits 1 when there is one.
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import argparse
import fcntl
import glob
import hashlib
import importlib.util
import json
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / file)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


walkman = module('build_walkman_clips', 'build-walkman-clips.py')
english = module('render_english', 'render-english.py')
french = module('render_clips', 'render-clips.py')
from whisper_scorer import Scorer  # noqa: E402
import carrier_cut  # noqa: E402

FRENCH_SEEDS = (42, 17, 101)
# A phrase of up to this many words may be said in a carrier when it fails alone.
CARRIER_WORDS = 4


def signature(item):
    if item['kind'] == 'convert':
        source = ROOT / item['source']
        return f"{walkman.FORMAT}:convert:{hashlib.sha256(source.read_bytes()).hexdigest()}" if source.exists() else None
    return f"{walkman.FORMAT}:{item['kind']}:{item['text']}"


class Voices:
    """The voice models, loaded the first time a clip needs them."""

    def __init__(self):
        import mlx.core as mx
        import numpy as np
        self.mx, self.np = mx, np
        self.kokoro = self.chatterbox = None
        self.scorers = {}

    def scorer(self, language):
        if language not in self.scorers:
            self.scorers[language] = Scorer(language)
        return self.scorers[language]

    def english_take(self, text, speed, raw):
        if self.kokoro is None:
            from mlx_audio.tts.utils import load_model
            self.kokoro = load_model(english.MODEL)
            self.voice = glob.glob(str(Path.home() / f'.cache/huggingface/hub/models--mlx-community--Kokoro-82M-bf16/snapshots/*/voices/{english.VOICE}.safetensors'))[0]
        chunks = [result.audio for result in self.kokoro.generate(text=text, voice=self.voice, speed=speed, lang_code='a', verbose=False)]
        pcm = self.np.asarray(self.mx.concatenate(chunks) if len(chunks) > 1 else chunks[0], dtype=self.np.float32).reshape(-1)
        with wave.open(str(raw), 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(24000)
            stream.writeframes((self.np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
        self.mx.clear_cache()

    def french_take(self, text, seed, raw):
        if self.chatterbox is None:
            from mlx_audio.tts.utils import load_model
            self.chatterbox = load_model(french.MODEL)
            self.conds = self.chatterbox.prepare_conditionals(str(french.REFERENCE), 24000, exaggeration=french.SETTINGS['exaggeration'])
        french.render_wav(self.chatterbox, self.conds, text, seed, raw, self.mx, self.np)


def make_english(voices, text, scratch):
    """A checked English take as a 16 kHz decode path and its mp3, or None."""
    for speed in english.SPEEDS:
        raw, trimmed, mp3, decoded = (scratch / name for name in ('raw.wav', 'trimmed.wav', 'take.mp3', 'decoded.wav'))
        voices.english_take(text, speed, raw)
        english.run([english.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw), '-af', english.TRIM, str(trimmed)])
        english.run([english.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-codec:a', 'libmp3lame', '-b:a', '96k', str(mp3)])
        english.run([english.FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
        transcript = english.transcribe(decoded)
        heard, said = english.normalize(transcript), english.normalize(text)
        if heard and (heard.replace(' ', '') == said.replace(' ', '') or english.phonemes(transcript) == english.phonemes(text)):
            return mp3, transcript
        if heard:
            scores = voices.scorer('en')(decoded, [text, transcript])
            if scores[0] >= scores[1] - english.SCORE_SLACK:
                return mp3, transcript
    return None, None


def make_french(voices, text, scratch):
    ffmpeg, whisper, espeak = (french.executable(name) for name in ('ffmpeg', 'whisper-cli', 'espeak-ng'))
    expected = french.phonemes(text, espeak)
    for seed in FRENCH_SEEDS:
        raw, mp3, decoded = scratch / 'raw.wav', scratch / 'take.mp3', scratch / 'decoded.wav'
        try:
            voices.french_take(text, seed, raw)
        except Exception:
            continue
        french.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(raw), '-codec:a', french.ENCODING['codec'], '-b:a', french.ENCODING['bitrate'], str(mp3)])
        french.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
        transcript = french.transcribe(decoded, whisper)
        if french.verdict(transcript, text, expected, espeak, 'comprehension'):
            return mp3, transcript
    if len(text.split()) > CARRIER_WORDS:
        return None, None
    return french_in_carrier(voices, text, scratch, ffmpeg, whisper, espeak, expected)


def french_in_carrier(voices, text, scratch, ffmpeg, whisper, espeak, expected):
    """The phrase said after a carrier and cut out where the voice pauses. The whole sentence must be heard as said;
    a cut also heard as the phrase on its own is taken at once, else the first clean cut is kept, as for words."""
    import numpy as np
    raw, trimmed, mp3, decoded, fallback = (scratch / name for name in ('carrier.wav', 'cut.wav', 'cut.mp3', 'cut-decoded.wav', 'fallback.mp3'))
    fallback_transcript = None
    for carrier in carrier_cut.CARRIERS:
        sentence = carrier + text + '.'
        said = french.phonemes(sentence, espeak)
        for seed in FRENCH_SEEDS:
            try:
                voices.french_take(sentence, seed, raw)
            except Exception:
                continue
            heard = carrier_cut.transcribe_tokens(raw)
            if not french.verdict(heard['text'], sentence, said, espeak, 'comprehension'):
                continue
            with wave.open(str(raw), 'rb') as stream:
                rate = stream.getframerate()
                pcm = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32) / 32767
            try:
                clip, _, _ = carrier_cut.cut_after_carrier(pcm, rate, heard['tokens'], carrier)
            except carrier_cut.NoCut:
                continue
            with wave.open(str(trimmed), 'wb') as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(rate)
                stream.writeframes((np.clip(clip, -1, 1) * 32767).astype('<i2').tobytes())
            french.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(trimmed), '-codec:a', french.ENCODING['codec'], '-b:a', french.ENCODING['bitrate'], str(mp3)])
            french.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(mp3), '-ac', '1', '-ar', '16000', str(decoded)])
            alone = french.transcribe(decoded, whisper)
            if french.verdict(alone, text, expected, espeak, 'comprehension'):
                return mp3, alone
            if fallback_transcript is None:
                mp3.replace(fallback)
                fallback_transcript = heard['text']
    return (fallback, fallback_transcript) if fallback_transcript is not None else (None, None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    args = parser.parse_args()
    out = ROOT / 'audio' / 'radio'
    out.mkdir(parents=True, exist_ok=True)
    manifest_path = out / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    plan = json.loads(Path(args.plan).read_text())
    pending = [item for item in plan if signature(item) and (not (out / f"{item['id']}.mp3").is_file() or manifest.get(item['id']) != signature(item))]
    print(json.dumps({'pending': len(pending), 'planned': len(plan)}), flush=True)
    if not pending:
        return 0
    lock = (out / '.render.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('Another renderer owns audio/radio')
    voices = None
    failed = 0
    with tempfile.TemporaryDirectory(prefix='.radio-', dir=out) as work:
        scratch = Path(work)
        for item in pending:
            target = out / f"{item['id']}.mp3"
            try:
                if item['kind'] == 'convert':
                    walkman.convert(ROOT / item['source'], target)
                else:
                    voices = voices or Voices()
                    mp3, transcript = (make_english if item['kind'] == 'en' else make_french)(voices, item['text'], scratch)
                    if mp3 is None:
                        raise RuntimeError('no take was heard as the text')
                    walkman.convert(mp3, target)
            except Exception as error:
                failed += 1
                target.unlink(missing_ok=True)
                manifest.pop(item['id'], None)
                english.atomic_json(manifest_path, manifest)
                print(json.dumps({'failed': item['id'], 'error': str(error)[:200]}, ensure_ascii=False), flush=True)
                continue
            manifest[item['id']] = signature(item)
            english.atomic_json(manifest_path, manifest)
            print(json.dumps({'done': item['id']}), flush=True)
    print(json.dumps({'made': len(pending) - failed, 'failed': failed}), flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
