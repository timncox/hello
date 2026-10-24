"""Download BSB narration (public domain, CC0) for chapters and re-encode it for the web.

Source: openbible.com/audio/<voice>/BSB_<nn>_<Code>_<ccc>.mp3 (the files Bible Hub's
audio Bible plays). Output: public/media/<book>/<cc>.mp3, 40 kbps mono, ready for
scripts/align-audio.py.

Usage: python scripts/fetch-audio.py <book-id> <chapters e.g. 1-3,5> [--voice souer]
"""

import argparse
import json
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# USFM book codes in canonical order; the audio files use them title-cased (Gen, 1Sa, Jhn).
CODES = (
    "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG "
    "ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT "
    "ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV"
).split()


def chapters_arg(spec: str) -> list[int]:
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out += range(int(a), int(b or a) + 1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("book")
    ap.add_argument("chapters")
    ap.add_argument("--voice", default="souer")
    args = ap.parse_args()

    books = json.loads((ROOT / "public/bible/index.json").read_text())["books"]
    num = next(i for i, b in enumerate(books) if b["id"] == args.book) + 1
    usfm = CODES[num - 1]
    first = next(i for i, ch in enumerate(usfm) if ch.isalpha())
    code = usfm[: first + 1] + usfm[first + 1 :].lower()  # GEN -> Gen, 1SA -> 1Sa
    out_dir = ROOT / "public/media" / args.book
    out_dir.mkdir(parents=True, exist_ok=True)

    for c in chapters_arg(args.chapters):
        url = f"https://openbible.com/audio/{args.voice}/BSB_{num:02d}_{code}_{c:03d}.mp3"
        with tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
            urllib.request.urlretrieve(url, tmp.name)
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "24000",
                 "-b:a", "40k", "-map_metadata", "-1", str(out_dir / f"{c:02d}.mp3")],
                check=True,
            )
        print(f"{args.book} {c}: {url}", flush=True)


if __name__ == "__main__":
    main()
