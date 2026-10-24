"""Word-level timing for narrated chapters, so captions can highlight word-by-word.

Transcribes each chapter MP3 with faster-whisper (word timestamps), then aligns the
transcript to the canonical BSB text from public/bible/books/<book>.json. Captions
always show the canonical text; the transcript only supplies timing. Words the ASR
missed get times interpolated from their neighbours.

Output: public/media/<book>/<chapter>.json
  { "audio": "<book>/<cc>.mp3", "narrator": "...", "verses": [[verse, start, end, [word starts...]], ...] }
  Times are in centiseconds. Word i of a verse is the i-th whitespace token of its text.

Usage (needs `pip install faster-whisper`):
  python scripts/align-audio.py <book-id> <dir-with-chapter-mp3s> --narrator "Bob Souer" [--model small.en]
  MP3s are named <cc>.mp3 (01.mp3, 02.mp3, ...).
"""

import argparse
import difflib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent


def norm_parts(token: str) -> list[str]:
    """A display token can hold several spoken words ("salvation—whom")."""
    parts = re.split(r"[—–-]+", token.lower())
    out = [re.sub(r"[^a-z0-9']", "", p).strip("'") for p in parts]
    return [p for p in out if p] or [""]


def asr_norm(word: str) -> list[str]:
    return [p for p in norm_parts(word) if p]


def decode(mp3: Path) -> np.ndarray:
    pcm = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.float32)


def pauses(mp3: Path) -> list[float]:
    """Times where speech resumes after a pause (ends of detected silences)."""
    log = subprocess.run(
        ["ffmpeg", "-i", str(mp3), "-af", "silencedetect=noise=-35dB:d=0.12", "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    return [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", log)]


def snap(t: float, resumes: list[float], window: float = 0.8) -> float:
    """Move a verse start to the nearby point where speech resumes, so playback never clips a word."""
    near = [r for r in resumes if abs(r - t) <= window]
    return min(near, key=lambda r: abs(r - t)) - 0.08 if near else t


def align_chapter(model, mp3: Path, verses: list[str]):
    segments, _ = model.transcribe(
        decode(mp3), language="en", word_timestamps=True, beam_size=1,
        condition_on_previous_text=False, vad_filter=False,
    )
    asr = []  # (normalized word, start, end)
    for seg in segments:
        for w in seg.words or []:
            for p in asr_norm(w.word):
                asr.append((p, w.start, w.end))

    # Canonical words, remembering which (verse, token) each came from.
    truth, owner = [], []
    for vi, text in enumerate(verses):
        for ti, tok in enumerate(text.split()):
            for p in norm_parts(tok):
                truth.append(p)
                owner.append((vi, ti))

    times: list[float | None] = [None] * len(truth)
    sm = difflib.SequenceMatcher(None, [a[0] for a in asr], truth, autojunk=False)
    matched = 0
    for a, t, n in sm.get_matching_blocks():
        for k in range(n):
            times[t + k] = asr[a + k][1]
            matched += 1

    # Interpolate gaps between known neighbours.
    known = [i for i, x in enumerate(times) if x is not None]
    if not known:
        raise RuntimeError(f"No words aligned for {mp3}")
    end_time = asr[-1][2]
    for i in range(len(times)):
        if times[i] is not None:
            continue
        prev = max((k for k in known if k < i), default=None)
        nxt = min((k for k in known if k > i), default=None)
        if prev is None:
            times[i] = times[nxt]
        elif nxt is None:
            times[i] = times[prev] + (end_time - times[prev]) * (i - prev) / (len(times) - prev)
        else:
            times[i] = times[prev] + (times[nxt] - times[prev]) * (i - prev) / (nxt - prev)

    # Keep times monotonic (ASR timestamps occasionally wobble).
    for i in range(1, len(times)):
        times[i] = max(times[i], times[i - 1])

    # First part of each display token gives its start time.
    resumes = pauses(mp3)
    out = []
    token_start: dict[tuple[int, int], float] = {}
    for (vi, ti), t in zip(owner, times):
        token_start.setdefault((vi, ti), t)
    for vi, text in enumerate(verses):
        if not text:
            continue
        starts = [token_start[(vi, ti)] for ti in range(len(text.split()))]
        starts[0] = snap(starts[0], resumes)
        starts = [starts[0]] + [max(w, starts[0]) for w in starts[1:]]
        out.append([vi + 1, starts[0], None, starts])
    for i, row in enumerate(out):
        row[2] = out[i + 1][1] if i + 1 < len(out) else end_time + 0.3

    cs = lambda x: round(x * 100)
    rows = [[v, cs(s), cs(e), [cs(w) for w in ws]] for v, s, e, ws in out]
    return rows, matched / len(truth)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("book")
    ap.add_argument("audio_dir")
    ap.add_argument("--narrator", required=True, help="credited on video cards")
    ap.add_argument("--model", default="small.en")
    ap.add_argument("--chapters", help="e.g. 1-3,5 (default: all)")
    args = ap.parse_args()

    chapters = json.loads((ROOT / "public/bible/books" / f"{args.book}.json").read_text())
    wanted = range(1, len(chapters) + 1)
    if args.chapters:
        wanted = []
        for part in args.chapters.split(","):
            a, _, b = part.partition("-")
            wanted += range(int(a), int(b or a) + 1)

    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=4)
    out_dir = ROOT / "public/media" / args.book
    out_dir.mkdir(parents=True, exist_ok=True)
    for c in wanted:
        mp3 = Path(args.audio_dir) / f"{c:02d}.mp3"
        rows, ratio = align_chapter(model, mp3, chapters[c - 1])
        (out_dir / f"{c}.json").write_text(json.dumps({"audio": f"{args.book}/{c:02d}.mp3", "narrator": args.narrator, "verses": rows}, separators=(",", ":")))
        print(f"{args.book} {c}: {ratio:.1%} of words matched", flush=True)


if __name__ == "__main__":
    sys.exit(main())
