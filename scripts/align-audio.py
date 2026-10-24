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


def transcribe(model, audio: np.ndarray, offset: float = 0.0):
    """ASR words as (normalized word, start, end), times shifted by offset."""
    segments, _ = model.transcribe(
        audio, language="en", word_timestamps=True, beam_size=1,
        condition_on_previous_text=False, vad_filter=False,
    )
    return [(p, w.start + offset, w.end + offset) for seg in segments for w in seg.words or [] for p in asr_norm(w.word)]


def match(asr, truth: list[str]):
    """Times for canonical words found in the transcript (None where missed), and the
    transcript index matched to the first canonical word."""
    times: list[float | None] = [None] * len(truth)
    first = None
    sm = difflib.SequenceMatcher(None, [a[0] for a in asr], truth, autojunk=False)
    for a, t, n in sm.get_matching_blocks():
        for k in range(n):
            times[t + k] = asr[a + k][1]
            if t + k == 0:
                first = a + k
    return times, first


def fill(times: list[float | None], start: float, end: float) -> list[float]:
    """Interpolate missing times between known neighbours, then keep them monotonic."""
    known = [i for i, x in enumerate(times) if x is not None]
    out = list(times)
    for i, x in enumerate(out):
        if x is not None:
            continue
        prev = max((k for k in known if k < i), default=None)
        nxt = min((k for k in known if k > i), default=None)
        lo, lo_i = (times[prev], prev) if prev is not None else (start, -1)
        hi, hi_i = (times[nxt], nxt) if nxt is not None else (end, len(times))
        out[i] = lo + (hi - lo) * (i - lo_i) / (hi_i - lo_i)
    for i in range(1, len(out)):
        out[i] = max(out[i], out[i - 1])
    return out


def collapsed_runs(times: list[float], min_len: int = 3):
    """Runs of words squashed together faster than anyone speaks (~15 words/s): where the
    ASR skipped a stretch of audio and interpolation crammed the missing words in."""
    runs, i = [], 0
    while i < len(times):
        j = i
        while j + 1 < len(times) and times[j + 1] - times[j] < 0.07:
            j += 1
        if j - i + 1 >= min_len:
            runs.append((i, j))
        i = j + 1
    return runs


def align_chapter(model, mp3: Path, verses: list[str]):
    audio = decode(mp3)
    duration = len(audio) / 16000
    asr = transcribe(model, audio)

    # Canonical words, remembering which (verse, token) each came from.
    truth, owner = [], []
    for vi, text in enumerate(verses):
        for ti, tok in enumerate(text.split()):
            for p in norm_parts(tok):
                truth.append(p)
                owner.append((vi, ti))

    found, first = match(asr, truth)
    matched = sum(x is not None for x in found)
    if not matched:
        raise RuntimeError(f"No words aligned for {mp3}")
    times = fill(found, 0.0, duration)

    # Whisper occasionally skips a few seconds; re-transcribe just that window.
    for _ in range(3):
        runs = collapsed_runs(times)
        if not runs:
            break
        for i, j in runs:
            ws = times[i - 1] if i > 0 else 0.0
            later = [t for t in times[j + 1:] if t > times[j] + 0.5]
            we = min(duration, (later[0] if later else duration) + 1.0)
            sub, _ = match(transcribe(model, audio[int(ws * 16000):int(we * 16000)], ws), truth[i:j + 1])
            if any(x is not None for x in sub):
                times[i:j + 1] = fill(sub, ws, we)
        times = fill(times, 0.0, duration)

    # The narrator announces "<Book>, chapter N" before verse 1; start after it.
    resumes = pauses(mp3)
    if first:
        announced = asr[first - 1][2]
        if times[0] < announced:
            after = [r for r in resumes if announced - 0.05 <= r <= announced + 3]
            times[0] = (after[0] - 0.08) if after else announced + 0.1
            times = fill(times, 0.0, duration)
    # Sometimes the announcement isn't transcribed and the first word is stretched over it.
    if len(times) > 1 and times[1] - times[0] > 1.0:
        before = [r for r in resumes if times[0] < r < times[1]]
        if before:
            times[0] = before[-1] - 0.08

    # First part of each display token gives its start time.
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
        row[2] = out[i + 1][1] if i + 1 < len(out) else duration

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
