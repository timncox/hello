// Video cards: narration playback, word-synced captions, and export to a real video file.
// A card's "video" is assembled live from parts played back to back: e.g. a brainrot
// character's chant, then the verse in the human narration (scripts/align-audio.py), over
// either a motion background (motion.ts) or the character's art.

import { drawScene, type Genre } from "./motion";

export interface Clip {
  src: string;
  start: number; // seconds into the audio file
  end: number;
  words: { w: string; t: number }[]; // display token + start time (seconds, file-relative)
  narrator: string;
}

export interface Part {
  clip: Clip;
  at: number; // seconds into the card's timeline
  kind: "chant" | "verse";
}

interface MediaFile {
  audio: string;
  narrator?: string;
  verses: [verse: number, start: number, end: number, words: number[]][]; // centiseconds
}

const SENTENCE_END = /[.!?…]["”’)\]]*$/;
const mediaCache = new Map<string, Promise<MediaFile>>();
const partLen = (p: Part) => p.clip.end - p.clip.start;

function loadMedia(book: string, chapter: number): Promise<MediaFile> {
  const key = `${book}/${chapter}`;
  let p = mediaCache.get(key);
  if (!p) {
    p = fetch(`/media/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`No media for ${key}`);
      return r.json();
    });
    mediaCache.set(key, p);
  }
  return p;
}

export async function loadClip(book: string, c: number, v: number, e: number, chapter: string[]): Promise<Clip | null> {
  const media = await loadMedia(book, c);
  const rows = media.verses.filter(([vn]) => vn >= v && vn <= e);
  if (!rows.length) return null;
  const words: Clip["words"] = [];
  for (const [vn, , , starts] of rows) {
    chapter[vn - 1].trim().split(/\s+/).forEach((w, i) => words.push({ w, t: starts[i] / 100 }));
  }
  // Same ellipsis treatment as text cards when a chunk starts or ends mid-sentence.
  const first = words[0];
  const last = words[words.length - 1];
  if (/^[a-z]/.test(first.w)) first.w = `…${first.w}`;
  if (!SENTENCE_END.test(last.w)) last.w = `${last.w.replace(/[,;:—]$/, "")}…`;
  return {
    src: `/media/${media.audio}`,
    start: rows[0][1] / 100,
    end: rows[rows.length - 1][2] / 100,
    words,
    narrator: media.narrator ?? "",
  };
}

/** Index of the word being spoken at file time t, or -1 before the first word. */
function wordAt(clip: Clip, t: number) {
  let i = -1;
  while (i + 1 < clip.words.length && clip.words[i + 1].t <= t) i++;
  return i;
}

/** The part playing at timeline time t (and the time within its file), if any. */
function partAt(parts: Part[], t: number) {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (t >= parts[i].at) return { i, part: parts[i], fileT: parts[i].clip.start + (t - parts[i].at) };
  }
  return null;
}

// ---------- captions ----------

export interface Captions {
  el: HTMLElement;
  /** Timeline seconds, or null when the card isn't playing. Returns true when a new caption chunk appears. */
  update(t: number | null): boolean;
}

/** Full passage on screen; upcoming words dimmed, the spoken word lit. */
export function karaoke(part: Part, className: string): Captions {
  const el = document.createElement("blockquote");
  el.className = `${className} karaoke`;
  const spans = part.clip.words.map((x, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = x.w;
    el.append(span);
    if (i < part.clip.words.length - 1) el.append(" ");
    return span;
  });
  let shown = -2;
  return {
    el,
    update(t) {
      const now = t == null ? -2 : wordAt(part.clip, part.clip.start + t - part.at);
      if (now === shown) return false;
      shown = now;
      el.classList.toggle("live", t != null);
      spans.forEach((s, i) => {
        s.classList.toggle("said", i < now);
        s.classList.toggle("now", i === now);
      });
      return false;
    },
  };
}

/** Short bursts of words, TikTok style. Chunks break at punctuation or every few words. */
function chunkWords(part: Part) {
  const max = part.kind === "chant" ? 2 : 3;
  const chunks: number[][] = [[]];
  part.clip.words.forEach((x, i) => {
    const cur = chunks[chunks.length - 1];
    cur.push(i);
    if (cur.length >= max || /[,.!?;:…”]$/.test(x.w)) chunks.push([]);
  });
  return chunks.filter((c) => c.length);
}

export function popCaptions(parts: Part[]): Captions {
  const el = document.createElement("div");
  el.className = "pop-caption";
  const chunked = parts.map(chunkWords);
  let shownKey = "";
  return {
    el,
    update(t) {
      const hit = t == null ? null : partAt(parts, t);
      let key = "";
      let words: string[] = [];
      let hot = -1;
      if (hit) {
        const w = wordAt(hit.part.clip, hit.fileT);
        const chunk = chunked[hit.i].find((c) => c.includes(Math.max(w, 0)));
        if (chunk && hit.fileT <= hit.part.clip.end + 0.15) {
          key = `${hit.i}:${chunk[0]}`;
          words = chunk.map((k) => hit.part.clip.words[k].w);
          hot = chunk.indexOf(w);
        }
      }
      const fresh = key !== shownKey;
      if (fresh) {
        shownKey = key;
        el.replaceChildren(...words.map((w) => Object.assign(document.createElement("span"), { textContent: w })));
        if (words.length) el.animate([{ transform: "scale(0.55)", opacity: 0.4 }, { transform: "scale(1.12)", opacity: 1 }, { transform: "scale(1)" }], { duration: 200, easing: "ease-out" });
      }
      el.querySelectorAll("span").forEach((s, i) => s.classList.toggle("hot", i === hot));
      return fresh && words.length > 0;
    },
  };
}

// ---------- playback stage ----------

export interface Playable {
  card: HTMLElement;
  canvas?: HTMLCanvasElement; // motion background (text and narrated cards)
  image?: HTMLImageElement; // character art (brainrot cards)
  title?: string; // character name, drawn on exported video
  genre: Genre;
  seed: number;
  duration: number; // seconds: sum of parts, or reading time for text-only cards
  parts: Part[];
  captions?: Captions;
  progress: HTMLElement;
  /** Plain text shown on text-only cards (used for export). */
  text: string;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (!w || !h) return false;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return true;
}

export function drawStill(p: Playable) {
  if (!p.canvas || !fitCanvas(p.canvas)) return;
  drawScene(p.canvas.getContext("2d")!, p.canvas.width, p.canvas.height, p.seed * 37, p.genre, p.seed);
}

function punch(img: HTMLElement, strong: boolean) {
  if (reduceMotion()) return;
  const s = strong ? 1.13 : 1.07;
  img.animate([{ transform: `scale(${s}) rotate(${strong ? -1.5 : 0.8}deg)` }, { transform: "scale(1)" }], { duration: strong ? 260 : 180, easing: "ease-out" });
}

const LOOP_GAP_MS = 1200;

export class Stage {
  readonly audio = new Audio();
  muted = true;
  paused = false;
  current: Playable | null = null;
  /** Called when the current card finishes; return true if the app moved on. */
  onEnd: (p: Playable) => boolean = () => false;
  onMutedChange: (muted: boolean) => void = () => {};

  private elapsed = 0;
  private clock0 = 0;
  private sceneT = 0;
  private lastFrame = 0;
  private endedAt = 0;
  private raf = 0;
  private partIdx = -1; // part whose audio is loaded and playing
  private pending = false; // play() called, audio not started yet
  private phase = "";

  constructor() {
    this.audio.preload = "auto";
    document.addEventListener("visibilitychange", () => this.syncAudio());
  }

  activate(p: Playable) {
    if (this.current === p) return;
    this.deactivate();
    this.current = p;
    this.paused = false;
    this.elapsed = 0;
    this.endedAt = 0;
    this.partIdx = -1;
    this.clock0 = performance.now();
    this.sceneT = p.seed * 37;
    p.card.classList.add("active");
    this.syncAudio();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  deactivate() {
    const p = this.current;
    if (!p) return;
    cancelAnimationFrame(this.raf);
    this.audio.pause();
    this.partIdx = -1;
    p.card.classList.remove("active", "paused");
    delete p.card.dataset.phase;
    this.phase = "";
    p.captions?.update(null);
    p.progress.style.transform = "scaleX(0)";
    this.current = null;
  }

  /** Must be called from a user gesture the first time, so iOS lets audio play. */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.onMutedChange(muted);
    if (!muted) this.unlock();
    this.syncAudio();
  }

  togglePause() {
    const p = this.current;
    if (!p) return;
    this.paused = !this.paused;
    p.card.classList.toggle("paused", this.paused);
    if (!this.paused) this.clock0 = performance.now() - this.elapsed * 1000;
    this.syncAudio();
  }

  /** iOS only lets an element play later if it played inside a gesture once. */
  private unlock() {
    const src = this.current?.parts[0]?.clip.src;
    if (this.audio.src || !src) return;
    this.audio.src = src;
    this.audio.muted = true;
    this.audio.play().then(() => {
      if (this.partIdx < 0) this.audio.pause();
      this.audio.muted = false;
    }, () => (this.audio.muted = false));
  }

  /** Make the audio element match the timeline: play the right part from the right spot, or stay quiet. */
  private syncAudio() {
    const p = this.current;
    const hit = p && !this.muted && !this.paused && !this.endedAt && !document.hidden ? partAt(p.parts, this.elapsed) : null;
    const inPart = hit && hit.fileT < hit.part.clip.end - 0.03;
    if (!hit || !inPart) {
      this.audio.pause();
      this.partIdx = -1;
      this.pending = false;
      return;
    }
    if (hit.i === this.partIdx && !this.audio.paused) return;
    this.partIdx = hit.i;
    const url = new URL(hit.part.clip.src, location.href).href;
    if (this.audio.src !== url) {
      this.audio.src = url;
      const target = hit.fileT;
      this.audio.addEventListener("loadedmetadata", () => {
        if (Math.abs(this.audio.currentTime - target) > 0.3) this.audio.currentTime = target;
      }, { once: true });
    }
    this.audio.currentTime = hit.fileT;
    this.pending = true;
    this.audio.play().then(
      () => (this.pending = false),
      () => {
        // Autoplay blocked (no gesture yet): fall back to captions-only.
        this.pending = false;
        if (!this.muted) this.setMuted(true);
      },
    );
  }

  private tick = (now: number) => {
    const p = this.current;
    if (!p) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    if (!this.paused) {
      this.sceneT += dt;
      if (this.endedAt) {
        if (now - this.endedAt > LOOP_GAP_MS) {
          this.endedAt = 0;
          this.elapsed = 0;
          this.clock0 = now;
          this.syncAudio();
        }
      } else {
        const part = this.partIdx >= 0 ? p.parts[this.partIdx] : null;
        if (part && this.pending) {
          // hold the timeline while the audio starts
        } else if (part && !this.audio.paused) {
          if (this.audio.currentTime >= part.clip.end - 0.02 || this.audio.ended) {
            this.elapsed = part.at + partLen(part);
            this.audio.pause();
            this.partIdx = -1;
          } else {
            this.elapsed = part.at + (this.audio.currentTime - part.clip.start);
          }
        } else if (part && this.audio.ended) {
          this.elapsed = part.at + partLen(part); // file ran out before the padded clip end
          this.partIdx = -1;
        } else {
          this.elapsed = (now - this.clock0) / 1000;
        }
        this.clock0 = now - this.elapsed * 1000;

        const hit = partAt(p.parts, this.elapsed);
        const playing = hit && hit.fileT < hit.part.clip.end - 0.03 ? hit.i : -1;
        if (!this.muted && playing !== this.partIdx) this.syncAudio();

        if (this.elapsed >= p.duration) {
          this.elapsed = p.duration;
          this.audio.pause();
          this.partIdx = -1;
          this.endedAt = now;
          if (this.onEnd(p)) return;
        }
      }
    }

    const phase = partAt(p.parts, this.elapsed)?.part.kind ?? "";
    if (phase !== this.phase) {
      this.phase = phase;
      p.card.dataset.phase = phase;
      if (p.image && phase) punch(p.image, true);
    }
    if (p.canvas && fitCanvas(p.canvas)) {
      drawScene(p.canvas.getContext("2d")!, p.canvas.width, p.canvas.height, reduceMotion() ? p.seed * 37 : this.sceneT, p.genre, p.seed);
    }
    if (p.captions?.update(this.elapsed) && p.image) punch(p.image, phase === "chant");
    p.progress.style.transform = `scaleX(${Math.min(1, this.elapsed / p.duration)})`;
  };
}

// ---------- export to a video file ----------

export interface VideoMeta {
  ref: string;
  translation: string;
  credit: string;
  site: string;
  accent: string;
}

const W = 720;
const H = 1280;
const POP_FONT = `"Anton", Impact, "Arial Black", sans-serif`;

function pickMime() {
  const options = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export const canExportVideo = () =>
  typeof MediaRecorder !== "undefined" && !!pickMime() && "captureStream" in HTMLCanvasElement.prototype;

function layout(ctx: CanvasRenderingContext2D, words: string[], font: (size: number) => string, start: number, maxW: number, maxH: number, leading = 1.32) {
  let size = start;
  for (;;) {
    ctx.font = font(size);
    const space = ctx.measureText(" ").width;
    const lines: { i: number; x: number; w: number }[][] = [[]];
    let x = 0;
    words.forEach((w, i) => {
      const width = ctx.measureText(w).width;
      if (x > 0 && x + width > maxW) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1].push({ i, x, w: width });
      x += width + space;
    });
    const lineH = size * leading;
    if (lines.length * lineH <= maxH || size <= 26) return { size, lineH, lines };
    size -= 2;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, stroke: number) {
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke;
  ctx.strokeStyle = "#000";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, scale: number, dx: number, dy: number) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * scale;
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}

/** Brainrot frame: character art with punch zooms, big outlined pop captions. */
function drawBrainrotFrame(ctx: CanvasRenderingContext2D, p: Playable, meta: VideoMeta, t: number, chunked: number[][][]) {
  const hit = partAt(p.parts, t);
  const w = hit ? wordAt(hit.part.clip, hit.fileT) : -1;
  const sinceWord = hit && w >= 0 ? hit.fileT - hit.part.clip.words[w].t : 9;
  const chanting = hit?.part.kind === "chant";
  const kick = Math.max(0, 1 - sinceWord / (chanting ? 0.22 : 0.18)) * (chanting ? 0.1 : 0.04);
  const shake = chanting && sinceWord < 0.15 ? 7 : 0;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  drawCover(ctx, p.image!, 1.04 + (0.06 * t) / p.duration + kick, Math.sin(t * 60) * shake, Math.cos(t * 47) * shake);

  const shade = ctx.createLinearGradient(0, H * 0.45, 0, H);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.7)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (p.title) {
    const title = layout(ctx, p.title.toUpperCase().split(" "), (s) => `${s}px ${POP_FONT}`, 76, W - 80, 220, 1.1);
    ctx.font = `${title.size}px ${POP_FONT}`;
    title.lines.forEach((line, li) => outlined(ctx, line.map((x) => p.title!.toUpperCase().split(" ")[x.i]).join(" "), W / 2, 150 + li * title.lineH, "#fff", 12));
  }

  if (hit && hit.fileT <= hit.part.clip.end + 0.15) {
    const chunk = chunked[hit.i].find((c) => c.includes(Math.max(w, 0)));
    if (chunk) {
      const words = chunk.map((k) => hit.part.clip.words[k].w.toUpperCase());
      const pop = layout(ctx, words, (s) => `${s}px ${POP_FONT}`, chanting ? 96 : 84, W - 90, 340, 1.08);
      const ageChunk = hit.fileT - hit.part.clip.words[chunk[0]].t;
      const scale = ageChunk < 0.1 ? 0.6 + ageChunk * 5 : ageChunk < 0.2 ? 1.1 - (ageChunk - 0.1) : 1;
      const cy = H * 0.66 - (pop.lines.length * pop.lineH) / 2;
      ctx.save();
      ctx.translate(W / 2, cy + (pop.lines.length * pop.lineH) / 2);
      ctx.scale(scale, scale);
      ctx.translate(-W / 2, -(cy + (pop.lines.length * pop.lineH) / 2));
      ctx.font = `${pop.size}px ${POP_FONT}`;
      ctx.textAlign = "left";
      pop.lines.forEach((line, li) => {
        const lineW = line.reduce((a, x) => Math.max(a, x.x + x.w), 0);
        const x0 = (W - lineW) / 2;
        const y = cy + (li + 1) * pop.lineH - pop.size * 0.12;
        for (const x of line) outlined(ctx, words[x.i], x0 + x.x, y, chunk[x.i] === w ? "#ffe14d" : "#fff", 14);
      });
      ctx.restore();
    }
  }

  ctx.textAlign = "left";
  if (!chanting) {
    ctx.font = `800 34px system-ui, -apple-system, "Segoe UI", sans-serif`;
    outlined(ctx, `${meta.ref} · ${meta.translation}`, 48, H - 110, "#fff", 6);
  }
  ctx.font = `600 22px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`${meta.site} · ${meta.credit}`, 48, H - 64);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = meta.accent;
  ctx.fillRect(0, H - 8, (W * Math.min(1, t / p.duration)), 8);
}

/** Classic frame: motion background, full passage with the spoken word highlighted. */
function drawFrame(ctx: CanvasRenderingContext2D, p: Playable, words: string[], meta: VideoMeta, elapsed: number) {
  drawScene(ctx, W, H, p.seed * 37 + elapsed, p.genre, p.seed);
  const pad = 64;
  const chars = words.join(" ").length;
  const serif = (s: number) => `500 ${s}px Georgia, "Times New Roman", serif`;
  const { size, lineH, lines } = layout(ctx, words, serif, chars < 90 ? 66 : chars < 170 ? 56 : chars < 320 ? 46 : 38, W - pad * 2, H * 0.56);
  const part = p.parts[0];
  const now = part ? wordAt(part.clip, part.clip.start + elapsed - part.at) : words.length;
  const top = H * 0.46 - (lines.length * lineH) / 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = serif(size);
  lines.forEach((line, li) => {
    const y = top + li * lineH + size;
    for (const { i, x, w: width } of line) {
      if (i === now) {
        ctx.fillStyle = meta.accent;
        roundRect(ctx, pad + x - 8, y - size * 0.86, width + 16, size * 1.12, 10);
        ctx.fill();
      }
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = !part || i <= now ? "#fff" : "rgba(255,255,255,0.5)";
      ctx.fillText(words[i], pad + x, y);
      ctx.shadowBlur = 0;
    }
  });

  const refY = top + lines.length * lineH + 70;
  ctx.font = `800 36px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.fillText(meta.ref, pad, refY);
  const refW = ctx.measureText(meta.ref).width;
  ctx.font = `700 22px system-ui, -apple-system, sans-serif`;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  const tagW = ctx.measureText(meta.translation).width + 18;
  roundRect(ctx, pad + refW + 16, refY - 28, tagW, 34, 6);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(meta.translation, pad + refW + 25, refY - 4);

  ctx.font = `800 30px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.fillText(meta.site, pad, 110);
  ctx.font = `600 24px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText(meta.credit, pad, H - 80);

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = meta.accent;
  ctx.fillRect(0, H - 8, W * Math.min(1, elapsed / p.duration), 8);
}

/** Records the card into a 720×1280 video in real time. Resolves with the file. */
export async function renderVideo(p: Playable, meta: VideoMeta, preview: HTMLCanvasElement, onProgress: (f: number) => void) {
  const mime = pickMime();
  preview.width = W;
  preview.height = H;
  const ctx = preview.getContext("2d")!;
  if (p.image) await document.fonts.load(`80px ${POP_FONT}`).catch(() => {});
  const words = p.parts[0] ? p.parts[0].clip.words.map((x) => x.w) : p.text.split(/\s+/);
  const chunked = p.parts.map(chunkWords);
  const draw = (t: number) => (p.image ? drawBrainrotFrame(ctx, p, meta, t, chunked) : drawFrame(ctx, p, words, meta, t));
  const total = p.duration + 0.8;

  const stream = preview.captureStream(30);
  let ac: AudioContext | null = null;
  const sources: { node: AudioBufferSourceNode; part: Part }[] = [];
  if (p.parts.length) {
    ac = new AudioContext();
    const dest = ac.createMediaStreamDestination();
    for (const part of p.parts) {
      const buf = await ac.decodeAudioData(await (await fetch(part.clip.src)).arrayBuffer());
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(dest);
      sources.push({ node, part });
    }
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));

  draw(0);
  rec.start(250);
  const t0 = performance.now();
  if (ac) {
    const base = ac.currentTime;
    for (const { node, part } of sources) node.start(base + part.at, part.clip.start, partLen(part));
  }

  await new Promise<void>((done) => {
    const frame = () => {
      const elapsed = (performance.now() - t0) / 1000;
      draw(Math.min(elapsed, p.duration));
      onProgress(Math.min(1, elapsed / total));
      if (elapsed >= total) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });

  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  await ac?.close();
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), ext: type.endsWith("mp4") ? "mp4" : "webm" };
}
