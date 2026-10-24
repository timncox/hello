// Scrollture client app: infinite scripture feed + book/theme drill-down.
// Vanilla TS, hash-routed, data lazy-loaded from /bible (see scripts/build-bible.mjs).
// Books with narration in /media play as video cards (see video.ts).

import type { Genre } from "./motion";
import { Stage, loadClip, captionEl, drawStill, renderVideo, canExportVideo, type Clip, type Playable } from "./video";

interface BookMeta {
  id: string;
  name: string;
  refName: string;
  genre: Genre;
  chapters: number[];
  media?: { narrator: string };
}

interface Index {
  translation: { id: string; name: string; license: string; url: string };
  totalVerses: number;
  books: BookMeta[];
}

interface Passage {
  b: string;
  c: number;
  v: number;
  e: number;
  text: string;
}

interface Theme {
  id: string;
  name: string;
  emoji: string;
  passages: Passage[];
}

type Kind = "banger" | "deep" | "rare" | "seq";
interface Card extends Passage {
  kind: Kind;
  theme?: string;
  clip?: Clip;
}

interface Liked extends Passage {
  t: number;
}

const GENRES: Record<Genre, { label: string; emoji: string }> = {
  law: { label: "Law", emoji: "📜" },
  history: { label: "History", emoji: "🏛️" },
  wisdom: { label: "Poetry & Wisdom", emoji: "🎵" },
  major: { label: "Major Prophets", emoji: "🔥" },
  minor: { label: "Minor Prophets", emoji: "📯" },
  gospels: { label: "Gospels & Acts", emoji: "✝️" },
  paul: { label: "Paul's Letters", emoji: "✉️" },
  general: { label: "General Letters", emoji: "📨" },
  apocalypse: { label: "Prophecy", emoji: "👁️" },
};

const SENTENCE_END = /[.!?…]["”’)\]]*$/;
const MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const RARE_BOOK_VERSES = 60;

// ---------- data ----------

let index: Index;
let themes: Theme[];
const bookById = new Map<string, BookMeta>();
const bookOffset = new Map<string, number[]>(); // per chapter, global verse offset
const bookCache = new Map<string, Promise<string[][]>>();

async function loadIndex() {
  const [i, t] = await Promise.all([
    fetch("/bible/index.json").then((r) => r.json() as Promise<Index>),
    fetch("/bible/themes.json").then((r) => r.json() as Promise<Theme[]>),
  ]);
  index = i;
  themes = t;
  let offset = 0;
  for (const b of index.books) {
    bookById.set(b.id, b);
    bookOffset.set(b.id, b.chapters.map((n) => ((offset += n), offset - n)));
  }
}

function loadBook(id: string): Promise<string[][]> {
  let p = bookCache.get(id);
  if (!p) {
    p = fetch(`/bible/books/${id}.json`).then((r) => r.json());
    bookCache.set(id, p);
  }
  return p;
}

const bookVerseCount = (b: BookMeta) => b.chapters.reduce((a, n) => a + n, 0);
const totalSlots = () => index.books.reduce((a, b) => a + bookVerseCount(b), 0);

function refOf(p: Passage) {
  const b = bookById.get(p.b)!;
  return `${b.refName} ${p.c}:${p.v}${p.e > p.v ? `–${p.e}` : ""}`;
}

const keyOf = (p: Passage) => `${p.b}.${p.c}.${p.v}`;

// ---------- persistence (per-browser) ----------

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`scrollture:${k}`);
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`scrollture:${k}`, JSON.stringify(v));
    } catch {
      /* storage unavailable: app still works, just forgets */
    }
  },
};

const today = () => new Date().toLocaleDateString("en-CA");
const yesterday = () => new Date(Date.now() - 864e5).toLocaleDateString("en-CA");

const state = {
  liked: store.get<Liked[]>("liked", []),
  streak: store.get("streak", { day: "", count: 0 }),
  daily: store.get("daily", { day: "", seen: 0 }),
  seenBits: decodeBits(store.get("seen", "")),
};

function decodeBits(s: string): Uint8Array {
  const bits = new Uint8Array(4000);
  try {
    const raw = atob(s);
    for (let i = 0; i < raw.length && i < bits.length; i++) bits[i] = raw.charCodeAt(i);
  } catch {
    /* fresh start */
  }
  return bits;
}

function saveSeen() {
  let s = "";
  for (const byte of state.seenBits) s += String.fromCharCode(byte);
  store.set("seen", btoa(s));
}

function markVersesSeen(p: Passage) {
  const off = bookOffset.get(p.b)![p.c - 1];
  for (let v = p.v; v <= p.e; v++) {
    const i = off + v - 1;
    state.seenBits[i >> 3] |= 1 << (i & 7);
  }
}

function countSeen(from = 0, to = totalSlots()) {
  let n = 0;
  for (let i = from; i < to; i++) if (state.seenBits[i >> 3] & (1 << (i & 7))) n++;
  return n;
}

function bookSeen(b: BookMeta) {
  const start = bookOffset.get(b.id)![0];
  return countSeen(start, start + bookVerseCount(b));
}

function touchStreak() {
  const s = state.streak;
  if (s.day === today()) return;
  s.count = s.day === yesterday() ? s.count + 1 : 1;
  s.day = today();
  store.set("streak", s);
  if (s.count > 1) toast(`🔥 ${s.count}-day streak. Keep it going.`);
}

function recordSeen(p: Passage) {
  if (state.daily.day !== today()) state.daily = { day: today(), seen: 0 };
  state.daily.seen++;
  store.set("daily", state.daily);
  markVersesSeen(p);
  saveSeen();
  if (MILESTONES.includes(state.daily.seen)) toast(`🎉 ${state.daily.seen} passages today!`);
  renderStats();
}

const isLiked = (p: Passage) => state.liked.some((l) => keyOf(l) === keyOf(p));

function toggleLike(p: Passage): boolean {
  const k = keyOf(p);
  const i = state.liked.findIndex((l) => keyOf(l) === k);
  if (i >= 0) state.liked.splice(i, 1);
  else state.liked.unshift({ b: p.b, c: p.c, v: p.v, e: p.e, text: p.text, t: Date.now() });
  store.set("liked", state.liked);
  return i < 0;
}

// ---------- passage building ----------

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(xs: T[]) => xs[rand(xs.length)];

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Grow a single verse into a readable chunk: back up to the sentence start, run on to the sentence end. */
function chunkAround(chapter: string[], vi: number): [number, number] {
  let s = vi;
  while (s > 0 && chapter[s - 1] && !SENTENCE_END.test(chapter[s - 1]) && vi - s < 2) s--;
  let e = vi;
  while (e < chapter.length - 1 && !SENTENCE_END.test(chapter[e]) && e - s < 3) e++;
  return [s, e];
}

/** Next chunk starting exactly at vi (for in-order reading). */
function chunkFrom(chapter: string[], vi: number): [number, number] {
  let e = vi;
  while (e < chapter.length - 1 && !SENTENCE_END.test(chapter[e]) && e - vi < 3) e++;
  return [vi, e];
}

function passageText(chapter: string[], s: number, e: number) {
  let text = chapter.slice(s, e + 1).filter(Boolean).join(" ");
  if (/^[a-z]/.test(text)) text = `…${text}`;
  if (!SENTENCE_END.test(text) && !/[:;,—]$/.test(text)) text = `${text}…`;
  else if (/[:;,—]$/.test(text)) text = `${text.slice(0, -1)}…`;
  return text;
}

async function randomFromBook(b: BookMeta): Promise<Card> {
  const chapters = await loadBook(b.id);
  for (;;) {
    const ci = rand(chapters.length);
    const vi = rand(chapters[ci].length);
    if (!chapters[ci][vi]) continue;
    const [s, e] = chunkAround(chapters[ci], vi);
    const kind: Kind = bookVerseCount(b) < RARE_BOOK_VERSES ? "rare" : "deep";
    return { b: b.id, c: ci + 1, v: s + 1, e: e + 1, text: passageText(chapters[ci], s, e), kind };
  }
}

function weightedBook(): BookMeta {
  // Half the time weight by size (true random verse), half the time any book equally,
  // so the small books still show up. Likes pull the feed toward what you enjoy.
  const likedBooks = state.liked.map((l) => l.b);
  if (likedBooks.length && Math.random() < 0.25) return bookById.get(pick(likedBooks))!;
  if (Math.random() < 0.5) return pick(index.books);
  let r = rand(totalSlots());
  for (const b of index.books) {
    r -= bookVerseCount(b);
    if (r < 0) return b;
  }
  return index.books[0];
}

// ---------- feed sources ----------

type Source = () => Promise<Card | null>;

function forYouSource(): Source {
  const recent: string[] = [];
  const likedThemes = () => {
    const keys = new Set(state.liked.map(keyOf));
    return themes.filter((t) => t.passages.some((p) => keys.has(keyOf(p))));
  };
  return async () => {
    for (let tries = 0; tries < 10; tries++) {
      let card: Card;
      const narrated = mediaBooks();
      if (narrated.length && Math.random() < 0.3) {
        card = await randomFromBook(pick(narrated));
      } else if (Math.random() < 0.45) {
        const pool = likedThemes();
        const theme = pool.length && Math.random() < 0.4 ? pick(pool) : pick(themes);
        card = { ...pick(theme.passages), kind: "banger", theme: theme.id };
      } else {
        card = await randomFromBook(weightedBook());
      }
      if (recent.includes(keyOf(card))) continue;
      recent.push(keyOf(card));
      if (recent.length > 200) recent.shift();
      return card;
    }
    return randomFromBook(weightedBook());
  };
}

function themeSource(theme: Theme): Source {
  let queue: Passage[] = [];
  return async () => {
    if (!queue.length) queue = shuffle(theme.passages);
    return { ...queue.shift()!, kind: "banger", theme: theme.id };
  };
}

function bookShuffleSource(b: BookMeta): Source {
  return () => randomFromBook(b);
}

const mediaBooks = () => index.books.filter((b) => b.media);

/** Video-only feed: narrated passages, half the time a curated one. */
function watchSource(): Source {
  return async () => {
    const narrated = new Set(mediaBooks().map((b) => b.id));
    const bangers = themes.flatMap((t) => t.passages.filter((p) => narrated.has(p.b)).map((p) => ({ p, theme: t.id })));
    if (bangers.length && Math.random() < 0.5) {
      const { p, theme } = pick(bangers);
      return { ...p, kind: "banger", theme };
    }
    return randomFromBook(pick(mediaBooks()));
  };
}

/** In-order reading that rolls into the next book when one ends. */
function sequentialSource(b: BookMeta, c = 1, v = 1): Source {
  let bi = index.books.indexOf(b);
  let ci = c - 1;
  let vi = v - 1;
  return async () => {
    for (;;) {
      if (bi >= index.books.length) return null;
      const book = index.books[bi];
      const chapters = await loadBook(book.id);
      if (ci >= chapters.length) {
        bi++;
        ci = 0;
        vi = 0;
        continue;
      }
      const ch = chapters[ci];
      if (vi >= ch.length) {
        ci++;
        vi = 0;
        continue;
      }
      if (!ch[vi]) {
        vi++;
        continue;
      }
      const [s, e] = chunkFrom(ch, vi);
      vi = e + 1;
      return { b: book.id, c: ci + 1, v: s + 1, e: e + 1, text: passageText(ch, s, e), kind: "seq" };
    }
  };
}

// ---------- UI helpers ----------

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const view = () => $("#view");

function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) if (c != null) el.append(c);
  return el;
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2200);
}

function renderStats() {
  const streak = state.streak.count;
  const seen = state.daily.day === today() ? state.daily.seen : 0;
  $("#stats").textContent = `🔥${streak} · 👁${seen}`;
}

function setTab(tab: string) {
  document.querySelectorAll<HTMLAnchorElement>(".tabs a").forEach((a) => {
    a.classList.toggle("active", a.dataset.tab === tab);
  });
}

function sizeClass(text: string) {
  const n = text.length;
  return n < 90 ? "xl" : n < 170 ? "lg" : n < 320 ? "md" : "sm";
}

const BADGES: Record<Kind, string> = {
  banger: "🔥 BANGER",
  deep: "🪨 DEEP CUT",
  rare: "🦄 RARE DROP",
  seq: "",
};

async function share(p: Passage) {
  const text = `“${p.text}” — ${refOf(p)} (${index.translation.id})`;
  const url = `${location.origin}/#/read/${p.b}/${p.c}/${p.v}`;
  try {
    if (navigator.share) await navigator.share({ text, url });
    else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("📋 Copied to clipboard");
    }
  } catch {
    /* share sheet dismissed */
  }
}

function heartBurst(card: HTMLElement, x: number, y: number) {
  const el = h("div", { class: "burst" }, "❤️");
  const r = card.getBoundingClientRect();
  el.style.left = `${x - r.left}px`;
  el.style.top = `${y - r.top}px`;
  card.append(el);
  setTimeout(() => el.remove(), 800);
}

// ---------- playback ----------

const stage = new Stage();
let autoScroll = store.get("auto", false);

stage.onMutedChange = (muted) => {
  $("#app").classList.toggle("muted", muted);
  document.querySelectorAll(".act.sound span").forEach((s) => (s.textContent = muted ? "🔇" : "🔊"));
};

stage.onEnd = () => {
  if (!autoScroll || !activeFeed) return false;
  const scroller = $(".feed", activeFeed.el);
  scroller.scrollBy({ top: scroller.clientHeight, behavior: "smooth" });
  return true;
};

function toggleAuto() {
  autoScroll = !autoScroll;
  store.set("auto", autoScroll);
  document.querySelectorAll(".act.auto").forEach((el) => el.classList.toggle("on", autoScroll));
  toast(autoScroll ? "⏩ Auto-scroll on: sit back" : "Auto-scroll off");
}

const readingTime = (text: string) => Math.max(4, text.split(/\s+/).length * 0.3 + 1.5);

// ---------- share sheet & video export ----------

function openSheet(onClose: () => void, ...children: (Node | null)[]) {
  const panel = h("div", { class: "sheet" }, ...children);
  const backdrop = h("div", { class: "sheet-backdrop" }, panel);
  const close = () => {
    backdrop.remove();
    onClose();
  };
  backdrop.addEventListener("click", (e) => e.target === backdrop && close());
  $("#app").append(backdrop);
  return { panel, close };
}

function shareSheet(p: Card, play: Playable) {
  const videoBtn = canExportVideo() ? h("button", { class: "btn primary" }, "🎬 Save as video") : null;
  const linkBtn = h("button", { class: "btn" }, "🔗 Share link");
  const closeBtn = h("button", { class: "btn" }, "Close");
  const { close } = openSheet(() => {}, h("h3", {}, `Share ${refOf(p)}`), h("div", { class: "sheet-actions" }, videoBtn, linkBtn, closeBtn));
  closeBtn.addEventListener("click", close);
  linkBtn.addEventListener("click", () => {
    close();
    share(p);
  });
  videoBtn?.addEventListener("click", () => {
    close();
    exportSheet(p, play);
  });
}

async function exportSheet(p: Card, play: Playable) {
  stage.deactivate();
  const preview = h("canvas", { class: "export-preview" }) as HTMLCanvasElement;
  const status = h("p", { class: "muted" }, "🎬 Recording… keep this screen open");
  const bar = progressBar(0, 1);
  const fill = bar.firstChild as HTMLElement;
  const { panel, close } = openSheet(() => activeFeed?.resume(), preview, status, bar);
  const closeBtn = h("button", { class: "btn" }, "Close");
  closeBtn.addEventListener("click", close);

  const meta = {
    ref: refOf(p),
    translation: index.translation.id,
    credit: play.clip ? `🎙 Read by ${play.clip.narrator} · ${index.translation.license}` : `${index.translation.name} · ${index.translation.license}`,
    site: $(".logo").textContent ?? "",
    accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff2e63",
  };
  try {
    const { blob, ext } = await renderVideo(play, meta, preview, (f) => (fill.style.width = `${f * 100}%`));
    const file = new File([blob], `scrollture-${p.b}-${p.c}-${p.v}.${ext}`, { type: blob.type });
    status.textContent = `✅ Video ready (${(blob.size / 1e6).toFixed(1)} MB)`;
    const shareBtn = navigator.canShare?.({ files: [file] }) ? h("button", { class: "btn primary" }, "📤 Share video") : null;
    shareBtn?.addEventListener("click", () => navigator.share({ files: [file] }).catch(() => {}));
    const download = h("a", { class: "btn", href: URL.createObjectURL(blob), download: file.name }, "⬇️ Download");
    panel.append(h("div", { class: "sheet-actions" }, shareBtn, download, closeBtn));
  } catch (err) {
    console.error(err);
    status.textContent = "⚠️ This browser couldn't record a video.";
    panel.append(h("div", { class: "sheet-actions" }, closeBtn));
  }
}

// ---------- cards ----------

function renderCard(p: Card): { el: HTMLElement; play: Playable } {
  const b = bookById.get(p.b)!;
  const theme = p.theme ? themes.find((t) => t.id === p.theme) : undefined;
  const likeBtn = h("button", { class: "act like", "aria-label": "Like" }, h("span", {}, "❤️"), h("small", {}, "Like"));
  const sync = () => likeBtn.classList.toggle("on", isLiked(p));
  sync();

  const doLike = (x?: number, y?: number) => {
    const nowLiked = toggleLike(p);
    sync();
    if (nowLiked && x != null && y != null) heartBurst(card, x, y);
    if (nowLiked && state.liked.length === 1) toast("❤️ Saved. Likes tune your feed.");
  };

  likeBtn.addEventListener("click", () => {
    const r = likeBtn.getBoundingClientRect();
    doLike(r.left + r.width / 2, r.top);
  });

  const shareBtn = h("button", { class: "act", "aria-label": "Share" }, h("span", {}, "📤"), h("small", {}, "Share"));
  shareBtn.addEventListener("click", () => shareSheet(p, play));

  const soundBtn = p.clip ? h("button", { class: "act sound", "aria-label": "Sound on/off" }, h("span", {}, stage.muted ? "🔇" : "🔊"), h("small", {}, "Sound")) : null;
  soundBtn?.addEventListener("click", () => stage.setMuted(!stage.muted));

  const autoBtn = h("button", { class: `act auto${autoScroll ? " on" : ""}`, "aria-label": "Auto-scroll" }, h("span", {}, "⏩"), h("small", {}, "Auto"));
  autoBtn.addEventListener("click", toggleAuto);

  const pill = p.clip ? h("button", { class: "sound-pill" }, "🔇 Tap for sound") : null;
  pill?.addEventListener("click", () => stage.setMuted(false));

  const canvas = h("canvas", { class: "bg", "aria-hidden": "true" }) as HTMLCanvasElement;
  const caption = p.clip ? captionEl(p.clip, `verse ${sizeClass(p.text)}`) : h("blockquote", { class: `verse ${sizeClass(p.text)}` }, p.text);
  const progress = h("div", {});
  const badge =
    p.theme === "wild"
      ? h("div", { class: "badge k-rare" }, "🤯 UNHINGED")
      : BADGES[p.kind]
        ? h("div", { class: `badge k-${p.kind}` }, BADGES[p.kind])
        : null;

  const card = h(
    "article",
    { class: `card g-${b.genre}${p.clip ? " video" : ""}`, "data-key": keyOf(p) },
    canvas,
    h(
      "div",
      { class: "card-body" },
      badge,
      caption,
      h("div", { class: "ref" }, refOf(p), h("span", { class: "tr" }, index.translation.id)),
      p.clip ? h("div", { class: "credit" }, `🎙 ${p.clip.narrator}`) : null,
      h(
        "div",
        { class: "chips" },
        h("a", { class: "chip", href: `#/book/${b.id}` }, `${GENRES[b.genre].emoji} ${b.name}`),
        theme ? h("a", { class: "chip", href: `#/theme/${theme.id}` }, `${theme.emoji} ${theme.name}`) : null,
      ),
    ),
    h(
      "aside",
      { class: "rail" },
      likeBtn,
      h("a", { class: "act", href: `#/read/${b.id}/${p.c}/${p.v}`, "aria-label": "Read in context" }, h("span", {}, "📖"), h("small", {}, "Context")),
      h("a", { class: "act", href: `#/book/${b.id}/play/${p.c}/${p.v}`, "aria-label": "Keep reading from here" }, h("span", {}, "▶️"), h("small", {}, "Binge")),
      shareBtn,
      soundBtn,
      autoBtn,
    ),
    pill,
    h("div", { class: "pause-icon", "aria-hidden": "true" }, "▶"),
    h("div", { class: "playbar" }, progress),
  );

  const play: Playable = {
    card,
    canvas,
    genre: b.genre,
    seed: Math.random() * 1000,
    duration: p.clip ? p.clip.end - p.clip.start : readingTime(p.text),
    clip: p.clip,
    caption,
    progress,
  };

  // Single tap pauses, double tap likes.
  let tapTimer = 0;
  card.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("a,button")) return;
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = 0;
      if (!isLiked(p)) doLike(ev.clientX, ev.clientY);
      else heartBurst(card, ev.clientX, ev.clientY);
    } else {
      tapTimer = window.setTimeout(() => {
        tapTimer = 0;
        if (stage.current === play) stage.togglePause();
      }, 280);
    }
  });

  return { el: card, play };
}

// ---------- feed view ----------

interface Feed {
  el: HTMLElement;
  scrollTop: number;
  /** Start playing whichever card is on screen. */
  resume: () => void;
}

const cardData = new WeakMap<Element, { p: Card; play: Playable }>();

async function attachClip(p: Card) {
  if (!bookById.get(p.b)?.media) return;
  try {
    const chapters = await loadBook(p.b);
    p.clip = (await loadClip(p.b, p.c, p.v, p.e, chapters[p.c - 1])) ?? undefined;
  } catch (err) {
    console.warn("No narration, showing text card", err);
  }
}

function createFeed(source: Source, label?: { text: string; back: string }): Feed {
  const scroller = h("div", { class: "feed", tabindex: "0" });
  const feed: Feed = {
    el: h("div", { class: "feed-wrap" }),
    scrollTop: 0,
    resume() {
      const i = Math.round(scroller.scrollTop / (scroller.clientHeight || 1));
      const data = scroller.children[i] && cardData.get(scroller.children[i]);
      if (data) stage.activate(data.play);
    },
  };
  if (label) {
    feed.el.append(h("div", { class: "feed-label" }, h("span", {}, label.text), h("a", { href: label.back, "aria-label": "Close" }, "✕")));
  }
  feed.el.append(scroller);

  let loading = false;
  let done = false;
  const seen = new WeakSet<Element>();
  const drawn = new WeakSet<Element>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        const data = cardData.get(en.target);
        if (!data) continue;
        if (en.isIntersecting && !drawn.has(en.target)) {
          drawn.add(en.target);
          drawStill(data.play);
        }
        if (en.intersectionRatio < 0.6) continue;
        stage.activate(data.play);
        if (!seen.has(en.target)) {
          seen.add(en.target);
          recordSeen(data.p);
        }
        const cards = scroller.children;
        if (Array.prototype.indexOf.call(cards, en.target) >= cards.length - 4) more();
      }
    },
    { root: scroller, threshold: [0, 0.6] },
  );

  async function more(n = 6) {
    if (loading || done) return;
    loading = true;
    try {
      for (let i = 0; i < n; i++) {
        const p = await source();
        if (!p) {
          done = true;
          scroller.append(h("article", { class: "card end" }, h("div", { class: "card-body" }, h("blockquote", { class: "verse lg" }, "You reached the end. Amen. 🙏"))));
          break;
        }
        await attachClip(p);
        const { el, play } = renderCard(p);
        cardData.set(el, { p, play });
        scroller.append(el);
        observer.observe(el);
      }
      prune();
    } catch (err) {
      console.error(err);
      toast("⚠️ Couldn't load more. Check your connection.");
    } finally {
      loading = false;
    }
  }

  // Keep the DOM light during long sessions.
  function prune() {
    const cards = scroller.children;
    if (cards.length <= 120) return;
    const remove = Array.from(cards).slice(0, 40);
    const height = remove.reduce((a, c) => a + (c as HTMLElement).offsetHeight, 0);
    remove.forEach((c) => c.remove());
    scroller.scrollTop -= height;
  }

  scroller.addEventListener("scroll", () => (feed.scrollTop = scroller.scrollTop), { passive: true });
  more(4);
  return feed;
}

let forYou: Feed | null = null;
let activeFeed: Feed | null = null;

function mountFeed(feed: Feed) {
  stage.deactivate();
  view().replaceChildren(feed.el);
  view().className = "is-feed";
  activeFeed = feed;
  const scroller = $(".feed", feed.el);
  scroller.scrollTop = feed.scrollTop;
  scroller.focus({ preventScroll: true });
  feed.resume();
}

// ---------- page views ----------

function mountPage(...children: (Node | string | null)[]) {
  stage.deactivate();
  activeFeed = null;
  view().className = "is-page";
  view().replaceChildren(h("div", { class: "page" }, ...children));
  view().scrollTop = 0;
}

function progressBar(seen: number, total: number) {
  const pct = total ? Math.round((seen / total) * 100) : 0;
  const bar = h("div", { class: "progress", title: `${seen} of ${total} verses seen` }, h("div", {}));
  (bar.firstChild as HTMLElement).style.width = `${Math.max(pct, seen ? 2 : 0)}%`;
  return bar;
}

function booksView() {
  setTab("books");
  const groups = (Object.keys(GENRES) as Genre[]).map((g) =>
    h(
      "section",
      {},
      h("h2", {}, `${GENRES[g].emoji} ${GENRES[g].label}`),
      h(
        "div",
        { class: "book-grid" },
        ...index.books
          .filter((b) => b.genre === g)
          .map((b) => h("a", { class: `book-tile g-${b.genre}`, href: `#/book/${b.id}` }, h("strong", {}, b.media ? `${b.name} 🎬` : b.name), progressBar(bookSeen(b), bookVerseCount(b)))),
      ),
    ),
  );
  mountPage(h("h1", {}, "Books"), h("p", { class: "muted" }, "Pick a book to binge it in order, shuffle it, or read a chapter."), ...groups);
}

function bookView(b: BookMeta) {
  setTab("books");
  const total = bookVerseCount(b);
  const seen = bookSeen(b);
  mountPage(
    h("a", { class: "back", href: "#/books" }, "← Books"),
    h("div", { class: `book-hero g-${b.genre}` }, h("div", { class: "muted-light" }, `${GENRES[b.genre].emoji} ${GENRES[b.genre].label}`), h("h1", {}, b.name), h("div", {}, `${b.chapters.length} chapters · ${total.toLocaleString()} verses · ${Math.round((seen / total) * 100)}% seen`), progressBar(seen, total), b.media ? h("div", { class: "muted-light" }, `🎬 Video with narration by ${b.media.narrator}`) : ""),
    h("div", { class: "actions" }, h("a", { class: "btn primary", href: `#/book/${b.id}/play` }, "▶️ Binge in order"), h("a", { class: "btn", href: `#/book/${b.id}/shuffle` }, "🔀 Shuffle this book")),
    h("h2", {}, "Chapters"),
    h("div", { class: "chapter-grid" }, ...b.chapters.map((_, i) => h("a", { href: `#/read/${b.id}/${i + 1}` }, String(i + 1)))),
  );
}

async function readerView(b: BookMeta, c: number, v?: number) {
  setTab("books");
  const chapters = await loadBook(b.id);
  const ch = chapters[c - 1];
  if (!ch) return go(`#/book/${b.id}`);
  const verses = ch.map((t, i) => (t ? h("span", { class: `rv${v === i + 1 ? " hl" : ""}`, id: `v${i + 1}` }, h("sup", {}, String(i + 1)), `${t} `) : null));
  const nav = h(
    "div",
    { class: "reader-nav" },
    c > 1 ? h("a", { class: "btn", href: `#/read/${b.id}/${c - 1}` }, "← Prev") : h("span", {}),
    h("a", { class: "btn primary", href: `#/book/${b.id}/play/${c}/1` }, "▶️ Binge from here"),
    c < chapters.length ? h("a", { class: "btn", href: `#/read/${b.id}/${c + 1}` }, "Next →") : h("span", {}),
  );
  mountPage(
    h("a", { class: "back", href: `#/book/${b.id}` }, `← ${b.name}`),
    h("h1", {}, `${b.name} ${c}`),
    h("div", { class: "reader" }, ...verses),
    nav,
    h("p", { class: "muted small" }, `${index.translation.name} (${index.translation.id})`),
  );
  if (v) document.getElementById(`v${v}`)?.scrollIntoView({ block: "center" });
}

function themesView() {
  setTab("themes");
  mountPage(
    h("h1", {}, "Themes"),
    h("p", { class: "muted" }, "Endless scroll on whatever you need right now."),
    h("div", { class: "theme-grid" }, ...themes.map((t) => h("a", { class: "theme-tile", href: `#/theme/${t.id}` }, h("span", { class: "emoji" }, t.emoji), h("strong", {}, t.name), h("small", {}, `${t.passages.length} passages`)))),
  );
}

function meView() {
  setTab("me");
  const seen = countSeen();
  const total = index.totalVerses;
  const liked = state.liked.map((l) =>
    h("a", { class: `saved g-${bookById.get(l.b)!.genre}`, href: `#/read/${l.b}/${l.c}/${l.v}` }, h("p", {}, l.text), h("strong", {}, refOf(l))),
  );
  mountPage(
    h("h1", {}, "You"),
    h(
      "div",
      { class: "stat-row" },
      h("div", { class: "stat" }, h("strong", {}, `🔥 ${state.streak.count}`), h("small", {}, "day streak")),
      h("div", { class: "stat" }, h("strong", {}, `👁 ${state.daily.day === today() ? state.daily.seen : 0}`), h("small", {}, "today")),
      h("div", { class: "stat" }, h("strong", {}, `❤️ ${state.liked.length}`), h("small", {}, "liked")),
    ),
    h("p", {}, `You've seen ${seen.toLocaleString()} of ${total.toLocaleString()} verses (${((seen / total) * 100).toFixed(1)}%). Gotta read 'em all.`),
    progressBar(seen, total),
    h("h2", {}, "Liked"),
    ...(liked.length ? liked : [h("p", { class: "muted" }, "Double-tap a card or hit ❤️ to save it here.")]),
  );
}

// ---------- routing ----------

function go(hash: string) {
  location.hash = hash;
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [root, id, a, b, c] = parts;

  if (activeFeed && activeFeed === forYou) forYou.scrollTop = $(".feed", forYou.el).scrollTop;

  if (!root) {
    setTab("feed");
    forYou ??= createFeed(forYouSource());
    return mountFeed(forYou);
  }
  if (root === "books") return booksView();
  if (root === "watch") {
    if (!mediaBooks().length) return go("#/");
    setTab("watch");
    return mountFeed(createFeed(watchSource(), { text: `🎬 Narrated: ${mediaBooks().map((b) => b.name).join(", ")}`, back: "#/" }));
  }
  if (root === "themes") return themesView();
  if (root === "me") return meView();

  if (root === "theme") {
    const theme = themes.find((t) => t.id === id);
    if (!theme) return go("#/themes");
    setTab("themes");
    return mountFeed(createFeed(themeSource(theme), { text: `${theme.emoji} ${theme.name}`, back: "#/themes" }));
  }

  const book = id ? bookById.get(id) : undefined;
  if (root === "book" && book) {
    if (a === "play") {
      setTab("books");
      const label = b ? `▶️ ${book.name} from ${b}:${c ?? 1}` : `▶️ ${book.name} in order`;
      return mountFeed(createFeed(sequentialSource(book, Number(b) || 1, Number(c) || 1), { text: label, back: `#/book/${book.id}` }));
    }
    if (a === "shuffle") {
      setTab("books");
      return mountFeed(createFeed(bookShuffleSource(book), { text: `🔀 ${book.name} shuffle`, back: `#/book/${book.id}` }));
    }
    return bookView(book);
  }
  if (root === "read" && book) return readerView(book, Number(a) || 1, Number(b) || undefined);

  go("#/");
}

document.addEventListener("keydown", (ev) => {
  if (!activeFeed || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const scroller = $(".feed", activeFeed.el);
  const step = { ArrowDown: 1, j: 1, ArrowUp: -1, k: -1 }[ev.key];
  if (step) {
    ev.preventDefault();
    scroller.scrollBy({ top: step * scroller.clientHeight, behavior: "smooth" });
  }
  if (ev.key === " ") {
    ev.preventDefault();
    stage.togglePause();
  }
  if (ev.key === "m") stage.setMuted(!stage.muted);
  if (ev.key === "a") toggleAuto();
  if (ev.key === "l") {
    const i = Math.round(scroller.scrollTop / scroller.clientHeight);
    (scroller.children[i]?.querySelector(".like") as HTMLElement | null)?.click();
  }
});

async function start() {
  try {
    await loadIndex();
  } catch (err) {
    console.error(err);
    view().textContent = "Couldn't load scripture. Refresh to try again.";
    return;
  }
  touchStreak();
  renderStats();
  $("#app").classList.add("muted");
  if (!mediaBooks().length) $('.tabs a[data-tab="watch"]').remove();
  window.addEventListener("hashchange", route);
  route();
}

start();
