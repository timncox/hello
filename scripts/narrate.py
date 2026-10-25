"""Narrate books: word-level timing for the public-domain BSB audio, streamed (not stored).

For each chapter, downloads the narration MP3 from openbible.com to a temp file, aligns
it with scripts/align-audio.py, and writes public/media/<book>/<chapter>.json whose
"audio" is /audio/<voice>/BSB_<nn>_<Code>_<ccc>.mp3. The site proxies /audio/* to
openbible.com (see astro.config.mjs), so the app streams the original file.
Chapters that already point at streamed audio are skipped, so runs can resume.

Usage (needs `pip install faster-whisper`):
  python scripts/narrate.py <book-id> [<book-id> ...] [--chapters 1-3,5] [--model base.en]
"""

import argparse
import importlib.util
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parent.parent
VOICES = {"souer": "Bob Souer", "hays": "Barry Hays", "gilbert": "Jordan Scott Gilbert"}

# USFM book codes in canonical order; the audio files use them title-cased (Gen, 1Sa, Jhn).
CODES = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG "
    "ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT "
    "ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()

_spec = importlib.util.spec_from_file_location("align_audio", ROOT / "scripts/align-audio.py")
align = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(align)


# Where the audio host's file names differ from title-cased USFM.
CODE_OVERRIDES = {"TIT": "Tts"}


def audio_path(num: int, chapter: int, voice: str) -> str:
    usfm = CODES[num - 1]
    first = next(i for i, ch in enumerate(usfm) if ch.isalpha())
    code = CODE_OVERRIDES.get(usfm) or usfm[: first + 1] + usfm[first + 1 :].lower()  # GEN -> Gen, 1SA -> 1Sa
    return f"/audio/{voice}/BSB_{num:02d}_{code}_{chapter:03d}.mp3"


def chapters_arg(spec: str) -> list[int]:
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out += range(int(a), int(b or a) + 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("books", nargs="+")
    ap.add_argument("--chapters", help="only these chapters (single book)")
    ap.add_argument("--voice", default="souer", choices=VOICES)
    ap.add_argument("--model", default="base.en")
    args = ap.parse_args()

    index = json.loads((ROOT / "public/bible/index.json").read_text())["books"]
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=4)
    for book in args.books:
        num = next(i for i, b in enumerate(index) if b["id"] == book) + 1
        text = json.loads((ROOT / "public/bible/books" / f"{book}.json").read_text())
        out_dir = ROOT / "public/media" / book
        out_dir.mkdir(parents=True, exist_ok=True)
        wanted = chapters_arg(args.chapters) if args.chapters else range(1, len(text) + 1)
        for c in wanted:
            out = out_dir / f"{c}.json"
            audio = audio_path(num, c, args.voice)
            if out.exists() and json.loads(out.read_text()).get("audio") == audio:
                continue
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
                    urllib.request.urlretrieve("https://openbible.com" + audio, tmp.name)
                    rows, ratio = align.align_chapter(model, Path(tmp.name), text[c - 1])
            except Exception as err:  # keep going; a rerun retries what failed
                print(f"{book} {c}: FAILED {err}", file=sys.stderr, flush=True)
                continue
            out.write_text(json.dumps({"audio": audio, "narrator": VOICES[args.voice], "verses": rows}, separators=(",", ":")))
            print(f"{book} {c}: {ratio:.1%} of words matched", flush=True)


if __name__ == "__main__":
    main()
