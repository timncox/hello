"""Brainrot chants: synthesize each character's Italian chant, give it the meme treatment
(deeper pitch, bass boost, compression, a sub "boom" on the name), and time every word
for the pop-up captions.

Input:  src/data/characters.json  (id, name, chant, and optional "say": how the Italian voice
        should spell the name, e.g. "Gionarino" for "Jonahrino"; captions keep the display name)
Output: public/brainrot/<id>.mp3  and  public/brainrot/<id>.json  {"duration": cs, "words": [cs...]}
        Word i is the i-th whitespace token of the chant.

Voice: Piper TTS, Italian "riccardo" voice (downloaded to scripts/.cache on first run).
Usage (needs `pip install piper-tts faster-whisper`):
  python scripts/make-chants.py [--only <id>]
"""

import argparse
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts/.cache"
VOICE = "it_IT-riccardo-x_low"
VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/it/it_IT/riccardo/x_low/" + VOICE
BOOM_S = 0.18  # voice starts just after the boom hits
SPEED = 0.88 * 1.08  # net playback-rate change from the pitch-down + atempo below

# Reuse the alignment helpers from align-audio.py.
_spec = importlib.util.spec_from_file_location("align_audio", ROOT / "scripts/align-audio.py")
align = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(align)


def voice_model() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    onnx = CACHE / f"{VOICE}.onnx"
    for suffix in (".onnx", ".onnx.json"):
        target = CACHE / f"{VOICE}{suffix}"
        if not target.exists():
            urllib.request.urlretrieve(VOICE_URL + suffix, target)
    return onnx


def synth(text: str, raw: Path, out_mp3: Path, model: Path):
    piper = shutil.which("piper") or Path(sys.executable).parent / "piper"
    subprocess.run([str(piper), "-m", str(model), "-f", str(raw)], input=text.encode(), check=True, capture_output=True)
    sr = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(raw)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    voice_fx = (
        f"asetrate={sr}*0.88,aresample=44100,atempo=1.08,bass=g=6,"  # SPEED
        "acompressor=threshold=-18dB:ratio=4:attack=5:release=80,aecho=0.8:0.6:40:0.15,"
        f"adelay={int(BOOM_S * 1000)}"
    )
    boom = "aevalsrc='0.9*sin(2*PI*(45+140*exp(-t*14))*t)*exp(-t*4.5)':d=0.9:s=44100"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-f", "lavfi", "-i", boom,
         "-filter_complex", f"[0]{voice_fx}[v];[v][1]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-12:TP=-1[out]",
         "-map", "[out]", "-ac", "1", "-ar", "44100", "-b:a", "64k", str(out_mp3)],
        check=True,
    )


def word_times(model: WhisperModel, raw: Path, chant: str) -> list[float]:
    """Time words on the clean voice (recognition is much better before the effects),
    then map onto the processed timeline. Unrecognised words are spread by length."""
    audio = align.decode(raw)
    raw_dur = len(audio) / 16000
    segments, _ = model.transcribe(audio, language="it", word_timestamps=True, beam_size=1)
    asr = [(p, w.start, w.end) for seg in segments for w in seg.words or [] for p in align.asr_norm(w.word)]
    tokens = chant.split()
    truth, owner = [], []
    for i, tok in enumerate(tokens):
        for p in align.norm_parts(tok):
            truth.append(p)
            owner.append(i)
    found, _ = align.match(asr, truth)

    # Anchor on matched tokens; spread the rest by character length between anchors.
    anchors = {owner[k]: t for k, t in enumerate(found) if t is not None}
    anchors[0] = 0.0  # chants start speaking immediately; a later repeat can mis-anchor word 0
    weights = [len(t) + 2 for t in tokens]
    keys = sorted(anchors)
    times = [0.0] * len(tokens)
    for a, b in zip(keys + [None], keys[1:] + [None]):
        if a is None:
            break
        t_a = anchors[a]
        end_i, t_b = (b, anchors[b]) if b is not None else (len(tokens), raw_dur * 0.97)
        span = sum(weights[a:end_i]) or 1
        acc = 0
        for i in range(a, end_i):
            times[i] = t_a + (t_b - t_a) * acc / span
            acc += weights[i]
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1])
    return [BOOM_S + t / SPEED for t in times]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    args = ap.parse_args()

    chars = json.loads((ROOT / "src/data/characters.json").read_text())
    out = ROOT / "public/brainrot"
    out.mkdir(parents=True, exist_ok=True)
    tts = voice_model()
    asr = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=4)
    for c in chars:
        if args.only and c["id"] != args.only:
            continue
        mp3 = out / f"{c['id']}.mp3"
        with tempfile.TemporaryDirectory() as tmp:
            raw = Path(tmp) / "raw.wav"
            spoken = c["chant"].replace(c["name"], c["say"]) if c.get("say") else c["chant"]
            synth(spoken, raw, mp3, tts)
            words = word_times(asr, raw, c["chant"])
        duration = len(align.decode(mp3)) / 16000
        cs = lambda x: round(x * 100)
        (out / f"{c['id']}.json").write_text(json.dumps({"duration": cs(duration), "words": [cs(w) for w in words]}))
        print(f"{c['id']}: {duration:.1f}s", flush=True)


if __name__ == "__main__":
    main()
