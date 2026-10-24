// Generates the static Bible data the app loads at runtime:
//   public/bible/index.json        translation info + book list (chapter/verse counts)
//   public/bible/books/<id>.json   one book: string[][] (chapters -> verses)
//   public/bible/themes.json       curated themes from src/data/themes.json, text resolved
//   public/bible/characters.json   brainrot characters from src/data/characters.json, with
//                                  chant timings from public/brainrot/<id>.json (scripts/make-chants.py)
//
// Source text: Berean Standard Bible (public domain), fetched from bereanbible.com
// and cached in scripts/.cache. To swap translations, produce a file in the same
// "Book C:V<TAB>text" format and point SOURCE_URL / TRANSLATION at it.
//
// Usage: npm run bible

import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_URL = "https://bereanbible.com/bsb.txt";
const CACHE = join(ROOT, "scripts/.cache/bsb.txt");
const OUT = join(ROOT, "public/bible");

const TRANSLATION = {
  id: "BSB",
  name: "Berean Standard Bible",
  license: "Public domain",
  url: "https://berean.bible",
};

// [source name, display name, genre]
const BOOKS = [
  ["Genesis", "Genesis", "law"], ["Exodus", "Exodus", "law"], ["Leviticus", "Leviticus", "law"],
  ["Numbers", "Numbers", "law"], ["Deuteronomy", "Deuteronomy", "law"],
  ["Joshua", "Joshua", "history"], ["Judges", "Judges", "history"], ["Ruth", "Ruth", "history"],
  ["1 Samuel", "1 Samuel", "history"], ["2 Samuel", "2 Samuel", "history"],
  ["1 Kings", "1 Kings", "history"], ["2 Kings", "2 Kings", "history"],
  ["1 Chronicles", "1 Chronicles", "history"], ["2 Chronicles", "2 Chronicles", "history"],
  ["Ezra", "Ezra", "history"], ["Nehemiah", "Nehemiah", "history"], ["Esther", "Esther", "history"],
  ["Job", "Job", "wisdom"], ["Psalm", "Psalms", "wisdom"], ["Proverbs", "Proverbs", "wisdom"],
  ["Ecclesiastes", "Ecclesiastes", "wisdom"], ["Song of Solomon", "Song of Solomon", "wisdom"],
  ["Isaiah", "Isaiah", "major"], ["Jeremiah", "Jeremiah", "major"], ["Lamentations", "Lamentations", "major"],
  ["Ezekiel", "Ezekiel", "major"], ["Daniel", "Daniel", "major"],
  ["Hosea", "Hosea", "minor"], ["Joel", "Joel", "minor"], ["Amos", "Amos", "minor"],
  ["Obadiah", "Obadiah", "minor"], ["Jonah", "Jonah", "minor"], ["Micah", "Micah", "minor"],
  ["Nahum", "Nahum", "minor"], ["Habakkuk", "Habakkuk", "minor"], ["Zephaniah", "Zephaniah", "minor"],
  ["Haggai", "Haggai", "minor"], ["Zechariah", "Zechariah", "minor"], ["Malachi", "Malachi", "minor"],
  ["Matthew", "Matthew", "gospels"], ["Mark", "Mark", "gospels"], ["Luke", "Luke", "gospels"],
  ["John", "John", "gospels"], ["Acts", "Acts", "gospels"],
  ["Romans", "Romans", "paul"], ["1 Corinthians", "1 Corinthians", "paul"],
  ["2 Corinthians", "2 Corinthians", "paul"], ["Galatians", "Galatians", "paul"],
  ["Ephesians", "Ephesians", "paul"], ["Philippians", "Philippians", "paul"],
  ["Colossians", "Colossians", "paul"], ["1 Thessalonians", "1 Thessalonians", "paul"],
  ["2 Thessalonians", "2 Thessalonians", "paul"], ["1 Timothy", "1 Timothy", "paul"],
  ["2 Timothy", "2 Timothy", "paul"], ["Titus", "Titus", "paul"], ["Philemon", "Philemon", "paul"],
  ["Hebrews", "Hebrews", "general"], ["James", "James", "general"], ["1 Peter", "1 Peter", "general"],
  ["2 Peter", "2 Peter", "general"], ["1 John", "1 John", "general"], ["2 John", "2 John", "general"],
  ["3 John", "3 John", "general"], ["Jude", "Jude", "general"],
  ["Revelation", "Revelation", "apocalypse"],
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

async function loadSource() {
  if (!existsSync(CACHE)) {
    console.log(`Downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    await mkdir(dirname(CACHE), { recursive: true });
    await writeFile(CACHE, await res.text());
  }
  return readFile(CACHE, "utf8");
}

function parse(raw) {
  const byBook = new Map(BOOKS.map(([src]) => [src, []]));
  for (const line of raw.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^(.+) (\d+):(\d+)\t(.*)$/);
    if (!m) continue;
    const [, book, c, v, text] = m;
    const chapters = byBook.get(book);
    if (!chapters) throw new Error(`Unknown book in source: ${book}`);
    const ci = Number(c) - 1;
    (chapters[ci] ??= [])[Number(v) - 1] = text.trim();
  }
  return byBook;
}

function resolveRef(ref, lookup) {
  const m = ref.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`Bad reference: ${ref}`);
  const [, name, c, v, e] = m;
  const book = lookup.get(name) ?? lookup.get(name.replace(/^Psalms$/, "Psalm"));
  if (!book) throw new Error(`Unknown book in reference: ${ref}`);
  const chapter = book.chapters[Number(c) - 1];
  const start = Number(v);
  const end = e ? Number(e) : start;
  const verses = chapter?.slice(start - 1, end);
  if (!verses || verses.length !== end - start + 1 || verses.some((t) => !t)) {
    throw new Error(`Reference out of range: ${ref}`);
  }
  return { b: book.id, c: Number(c), v: start, e: end, text: verses.join(" ") };
}

const byBook = parse(await loadSource());
const books = BOOKS.map(([src, name, genre]) => {
  const chapters = byBook.get(src).map((ch) => Array.from(ch, (t) => t ?? ""));
  return { id: slug(name), name, refName: src, genre, chapters };
});

const total = books.reduce((n, b) => n + b.chapters.reduce((m, ch) => m + ch.filter(Boolean).length, 0), 0);

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, "books"), { recursive: true });

for (const b of books) {
  await writeFile(join(OUT, "books", `${b.id}.json`), JSON.stringify(b.chapters));
}

// Narrated chapters (public/media/<book>/<chapter>.json from scripts/align-audio.py) play as video.
async function mediaFor(id) {
  const dir = join(ROOT, "public/media", id);
  if (!existsSync(dir)) return undefined;
  const chapters = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f)).map((f) => parseInt(f)).sort((a, b) => a - b);
  if (!chapters.length) return undefined;
  const { narrator } = JSON.parse(await readFile(join(dir, `${chapters[0]}.json`), "utf8"));
  return { narrator, chapters };
}

await writeFile(
  join(OUT, "index.json"),
  JSON.stringify({
    translation: TRANSLATION,
    totalVerses: total,
    books: await Promise.all(books.map(async ({ id, name, refName, genre, chapters }) => ({
      id, name, refName, genre, chapters: chapters.map((ch) => ch.length), media: await mediaFor(id),
    }))),
  }),
);

const lookup = new Map(books.map((b) => [b.refName, b]));
const themes = JSON.parse(await readFile(join(ROOT, "src/data/themes.json"), "utf8"));
await writeFile(
  join(OUT, "themes.json"),
  JSON.stringify(themes.map(({ refs, ...t }) => ({ ...t, passages: refs.map((r) => resolveRef(r, lookup)) }))),
);

const characters = JSON.parse(await readFile(join(ROOT, "src/data/characters.json"), "utf8"));
const resolvedCharacters = [];
for (const { id, name, chant, refs } of characters) {
  const timing = join(ROOT, "public/brainrot", `${id}.json`);
  if (!existsSync(timing)) {
    console.warn(`Skipping ${id}: no chant yet (run scripts/make-chants.py)`);
    continue;
  }
  const { duration, words } = JSON.parse(await readFile(timing, "utf8"));
  resolvedCharacters.push({
    id, name, chant, image: `/brainrot/${id}.jpg`, audio: `/brainrot/${id}.mp3`,
    chantDuration: duration, chantWords: words,
    passages: refs.map((r) => resolveRef(r, lookup)),
  });
}
await writeFile(join(OUT, "characters.json"), JSON.stringify(resolvedCharacters));

console.log(`Wrote ${books.length} books, ${total} verses, ${themes.length} themes, ${resolvedCharacters.length} characters to public/bible/`);
