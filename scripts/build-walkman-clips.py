#!/usr/bin/env python3
"""Convert each word's French and English recording into the Walkman format.

A tape is built by joining clips byte for byte (lib/walkman.ts), so every clip must be the
same kind of MP3: 24 kHz mono, 64 kbps CBR MPEG-2 Layer III, no Xing header or ID3 tags,
and no bit reservoir, so each 192-byte frame decodes on its own whatever precedes it. Both
voices are levelled to the same average loudness. silence.mp3 is one second of such frames.

A clip is rebuilt only when its source recording changes. Usage: python3 scripts/build-walkman-clips.py
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / 'audio'
OUT = AUDIO / 'walkman'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
FRAME_BYTES = 192
TARGET_MEAN_DB = -20.0
PEAK_CEILING_DB = -1.0
ENCODE = ['-ar', '24000', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '64k', '-reservoir', '0',
          '-write_xing', '0', '-id3v2_version', '0', '-write_id3v1', '0', '-f', 'mp3']
FORMAT = 'walkman-v1:' + ' '.join(ENCODE) + f':{TARGET_MEAN_DB}:{PEAK_CEILING_DB}'


def levels(path):
    report = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-'],
                            capture_output=True, text=True, check=True).stderr
    mean = float(re.search(r'mean_volume: (-?[\d.]+) dB', report).group(1))
    peak = float(re.search(r'max_volume: (-?[\d.]+) dB', report).group(1))
    return mean, peak


def valid(path):
    data = path.read_bytes()
    return bool(data) and len(data) % FRAME_BYTES == 0 and all(data[i] == 0xFF and data[i + 1] == 0xF3 for i in range(0, len(data), FRAME_BYTES))


def convert(source, target):
    mean, peak = levels(source)
    gain = min(TARGET_MEAN_DB - mean, PEAK_CEILING_DB - peak)
    temporary = target.with_suffix('.tmp.mp3')
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source), '-af', f'volume={gain:.2f}dB', *ENCODE, str(temporary)], check=True)
    if not valid(temporary):
        temporary.unlink()
        raise RuntimeError(f'{source.name} did not encode to whole {FRAME_BYTES}-byte frames')
    temporary.replace(target)


def main():
    words = [word for name in ('core', 'world') for word in json.loads((ROOT / 'content' / f'{name}.json').read_text())]
    # --extra-words <file>: added words (from songs) get their Walkman clips too.
    if '--extra-words' in sys.argv:
        words += json.loads(Path(sys.argv[sys.argv.index('--extra-words') + 1]).read_text())
    for kind in ('fr', 'en'):
        (OUT / kind).mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    silence = OUT / 'silence.mp3'
    if not silence.exists() or manifest.get('silence') != FORMAT:
        temporary = OUT / 'silence.tmp.mp3'
        subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', *ENCODE, str(temporary)], check=True)
        if not valid(temporary):
            raise RuntimeError('Silence did not encode to whole frames')
        temporary.replace(silence)
        manifest['silence'] = FORMAT
    built = skipped = missing = 0
    for word in words:
        for kind, source in (('fr', AUDIO / f'{word["id"]}.mp3'), ('en', AUDIO / 'en' / f'{word["id"]}.mp3')):
            target = OUT / kind / f'{word["id"]}.mp3'
            key = f'{kind}/{word["id"]}'
            if not source.exists():
                target.unlink(missing_ok=True)
                manifest.pop(key, None)
                missing += 1
                continue
            stamp = FORMAT + ':' + hashlib.sha256(source.read_bytes()).hexdigest()
            if target.exists() and manifest.get(key) == stamp:
                skipped += 1
                continue
            convert(source, target)
            manifest[key] = stamp
            built += 1
    temporary = manifest_path.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(manifest, indent=1) + '\n')
    temporary.replace(manifest_path)
    print(json.dumps({'built': built, 'unchanged': skipped, 'missingSource': missing}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
