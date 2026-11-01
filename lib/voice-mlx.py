# Talk's French voice on Apple's MLX: Chatterbox with the reference voice and sampling settings scripts/render-clips.py
# records sentences with (voices/provenance.json), loaded once and kept while Echo calls on it (lib/voice.ts starts and
# stops this). One call:
#   POST /speak {"text", "path", "seed"} -> {"seconds"}: says the text and writes it to path as a 16-bit mono WAV at
#     the model's rate. Nothing checks the take: Talk answers within seconds, and a recorded set's checking takes more.
# One request at a time, as the GPU runs one model.
import json
import os

# Offline, as render-clips.py runs: the model and its tokenizer are already cached (HF_HUB_OFFLINE comes from Echo).
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer


# Echo holds this process's stdin open while it runs; it closes however Echo stops (a crash too), and then this
# process goes, rather than keep the port and the GPU's memory for an Echo that is gone.
def leave_with_echo():
    sys.stdin.read()
    os._exit(0)


threading.Thread(target=leave_with_echo, daemon=True).start()

import mlx.core as mx
import numpy as np
from mlx_audio.tts.utils import load_model

PORT, REPO, REFERENCE = int(sys.argv[1]), sys.argv[2], sys.argv[3]
# scripts/render-clips.py SETTINGS, so Talk sounds like every recorded sentence.
SETTINGS = {'lang_code': 'fr', 'cfg_weight': 0.5, 'exaggeration': 0.1, 'temperature': 0.5, 'max_tokens': 1000}
model = load_model(REPO)
conds = model.prepare_conditionals(REFERENCE, 24000, exaggeration=SETTINGS['exaggeration'])


def speak(text, path, seed):
    mx.random.seed(seed)
    chunks = [result.audio for result in model.generate(text=text, conds=conds, verbose=False, **SETTINGS)]
    try:
        if not chunks:
            raise RuntimeError('no audio generated')
        samples = mx.concatenate(chunks) if len(chunks) > 1 else chunks[0]
        mx.eval(samples)
        pcm = np.asarray(samples, dtype=np.float32).reshape(-1)
        if pcm.size == 0 or not np.isfinite(pcm).all() or np.max(np.abs(pcm)) < .001:
            raise RuntimeError('empty, non-finite or silent audio')
        rate = int(model.sample_rate)
        with wave.open(path, 'wb') as stream:
            stream.setnchannels(1)
            stream.setsampwidth(2)
            stream.setframerate(rate)
            stream.writeframes((np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
        return round(len(pcm) / rate, 3)
    finally:
        chunks.clear()
        mx.clear_cache()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply(200, {"ok": True})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            if self.path == "/speak":
                self.reply(200, {"seconds": speak(body["text"], body["path"], int(body.get("seed", 42)))})
            else:
                self.reply(404, {"error": "not found"})
        except Exception as error:  # the reply carries it to Echo, which reports it
            self.reply(500, {"error": str(error)})

    def reply(self, status, data):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
