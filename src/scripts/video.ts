// Video cards: narration playback, word-synced captions, and export to a real video file.
// A card's "video" is assembled live: motion background (motion.ts) + a slice of the
// chapter narration + captions timed per word (scripts/align-audio.py).

import { drawScene, type Genre } from "./motion";

export interface Clip {
  src: string;
  start: number; // seconds into the chapter audio
  end: number;
  words: { w: string; t: number }[]; // display token + start time (seconds, chapter-relative)
  narrator: string;
}

interface MediaFile {
  audio: string;
  narrator?: string;
  verses: [verse: number, start: number, end: number, words: number[]][]; // centiseconds
}

const SENTENCE_END = /[.!?…]["”’)\]]*$/;
const mediaCache = new Map<string, Promise<MediaFile>>();

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

/** Index of the word being spoken at time t, or -1 before the first word. */
function wordAt(clip: Clip, t: number) {
  let i = -1;
  while (i + 1 < clip.words.length && clip.words[i + 1].t <= t) i++;
  return i;
}

// ---------- captions (DOM) ----------

export function captionEl(clip: Clip, className: string): HTMLElement {
  const el = document.createElement("blockquote");
  el.className = `${className} karaoke`;
  clip.words.forEach((x, i) => {
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = x.w;
    el.append(span);
    if (i < clip.words.length - 1) el.append(" ");
  });
  return el;
}

function setCaption(el: HTMLElement, clip: Clip, t: number | null) {
  const now = t == null ? -2 : wordAt(clip, t);
  if (el.dataset.now === String(now)) return;
  el.dataset.now = String(now);
  el.classList.toggle("live", t != null);
  el.querySelectorAll<HTMLElement>(".w").forEach((s, i) => {
    s.classList.toggle("said", i < now);
    s.classList.toggle("now", i === now);
  });
}

// ---------- playback stage ----------

export interface Playable {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  genre: Genre;
  seed: number;
  duration: number; // seconds (clip length, or reading time for text cards)
  clip?: Clip;
  caption?: HTMLElement;
  progress: HTMLElement;
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
  if (!fitCanvas(p.canvas)) return;
  drawScene(p.canvas.getContext("2d")!, p.canvas.width, p.canvas.height, p.seed * 37, p.genre, p.seed);
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

  constructor() {
    this.audio.preload = "auto";
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.audio.pause();
      else if (this.current && !this.paused) this.restartAudio();
    });
  }

  activate(p: Playable) {
    if (this.current === p) return;
    this.deactivate();
    this.current = p;
    this.paused = false;
    this.elapsed = 0;
    this.endedAt = 0;
    this.clock0 = performance.now();
    this.sceneT = p.seed * 37;
    p.card.classList.add("active");
    this.restartAudio();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  deactivate() {
    const p = this.current;
    if (!p) return;
    cancelAnimationFrame(this.raf);
    this.audio.pause();
    p.card.classList.remove("active", "paused");
    if (p.clip && p.caption) setCaption(p.caption, p.clip, null);
    p.progress.style.transform = "scaleX(0)";
    this.current = null;
  }

  /** Must be called from a user gesture the first time, so iOS lets audio play. */
  setMuted(muted: boolean) {
    this.muted = muted;
    this.onMutedChange(muted);
    if (muted) this.audio.pause();
    else this.restartAudio();
  }

  togglePause() {
    const p = this.current;
    if (!p) return;
    this.paused = !this.paused;
    p.card.classList.toggle("paused", this.paused);
    if (this.paused) this.audio.pause();
    else {
      this.clock0 = performance.now() - this.elapsed * 1000;
      this.restartAudio();
    }
  }

  private restartAudio() {
    const clip = this.current?.clip;
    if (!clip || this.muted || this.paused || this.endedAt) {
      this.audio.pause();
      return;
    }
    const url = new URL(clip.src, location.href).href;
    const target = clip.start + this.elapsed;
    if (this.audio.src !== url) {
      this.audio.src = url;
      this.audio.addEventListener(
        "loadedmetadata",
        () => {
          if (Math.abs(this.audio.currentTime - target) > 0.3) this.audio.currentTime = target;
        },
        { once: true },
      );
    }
    this.audio.currentTime = target;
    this.audio.play().catch(() => {
      // Autoplay blocked (no gesture yet): fall back to captions-only.
      if (!this.muted) this.setMuted(true);
    });
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
          this.restartAudio();
        }
      } else {
        const audible = p.clip && !this.muted && !this.audio.paused && this.audio.readyState >= 2;
        if (audible) {
          this.elapsed = Math.max(0, this.audio.currentTime - p.clip!.start);
          this.clock0 = now - this.elapsed * 1000;
        } else if (!(p.clip && !this.muted)) {
          this.elapsed = (now - this.clock0) / 1000;
        } else if (this.audio.ended) {
          this.elapsed = p.duration; // chapter audio ran out before the clip's padded end
        } else {
          this.clock0 = now - this.elapsed * 1000; // waiting on audio to buffer
        }
        if (this.elapsed >= p.duration) {
          this.elapsed = p.duration;
          this.audio.pause();
          this.endedAt = now;
          if (this.onEnd(p)) return;
        }
      }
    }

    if (fitCanvas(p.canvas)) {
      drawScene(p.canvas.getContext("2d")!, p.canvas.width, p.canvas.height, reduceMotion() ? p.seed * 37 : this.sceneT, p.genre, p.seed);
    }
    if (p.clip && p.caption) setCaption(p.caption, p.clip, p.clip.start + this.elapsed);
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

function pickMime() {
  const options = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? "";
}

export const canExportVideo = () =>
  typeof MediaRecorder !== "undefined" && !!pickMime() && "captureStream" in HTMLCanvasElement.prototype;

function layout(ctx: CanvasRenderingContext2D, words: string[], maxW: number, maxH: number) {
  const chars = words.join(" ").length;
  let size = chars < 90 ? 66 : chars < 170 ? 56 : chars < 320 ? 46 : 38;
  for (;;) {
    ctx.font = `500 ${size}px Georgia, "Times New Roman", serif`;
    const space = ctx.measureText(" ").width;
    const lines: { i: number; x: number }[][] = [[]];
    let x = 0;
    words.forEach((w, i) => {
      const width = ctx.measureText(w).width;
      if (x > 0 && x + width > maxW) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1].push({ i, x });
      x += width + space;
    });
    const lineH = size * 1.32;
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

function drawFrame(ctx: CanvasRenderingContext2D, p: Playable, words: string[], meta: VideoMeta, elapsed: number) {
  drawScene(ctx, W, H, p.seed * 37 + elapsed, p.genre, p.seed);
  const pad = 64;
  const { size, lineH, lines } = layout(ctx, words, W - pad * 2, H * 0.56);
  const now = p.clip ? wordAt(p.clip, p.clip.start + elapsed) : words.length;
  const top = H * 0.46 - (lines.length * lineH) / 2;

  ctx.textBaseline = "alphabetic";
  ctx.font = `500 ${size}px Georgia, "Times New Roman", serif`;
  lines.forEach((line, li) => {
    const y = top + li * lineH + size;
    for (const { i, x } of line) {
      const w = words[i];
      if (i === now) {
        const width = ctx.measureText(w).width;
        ctx.fillStyle = meta.accent;
        roundRect(ctx, pad + x - 8, y - size * 0.86, width + 16, size * 1.12, 10);
        ctx.fill();
      }
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 16;
      ctx.fillStyle = !p.clip || i <= now ? "#fff" : "rgba(255,255,255,0.5)";
      ctx.fillText(w, pad + x, y);
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

  const prog = Math.min(1, elapsed / p.duration);
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = meta.accent;
  ctx.fillRect(0, H - 8, W * prog, 8);
}

/** Records the card into a 720×1280 video in real time. Resolves with the file. */
export async function renderVideo(p: Playable, meta: VideoMeta, preview: HTMLCanvasElement, onProgress: (f: number) => void) {
  const mime = pickMime();
  preview.width = W;
  preview.height = H;
  const ctx = preview.getContext("2d")!;
  const words = p.clip ? p.clip.words.map((x) => x.w) : (p.caption?.textContent ?? "").split(/\s+/);
  const total = p.duration + 0.8;

  const stream = preview.captureStream(30);
  let ac: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  if (p.clip) {
    ac = new AudioContext();
    const buf = await ac.decodeAudioData(await (await fetch(p.clip.src)).arrayBuffer());
    const dest = ac.createMediaStreamDestination();
    source = ac.createBufferSource();
    source.buffer = buf;
    source.connect(dest);
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));

  drawFrame(ctx, p, words, meta, 0);
  rec.start(250);
  const t0 = performance.now();
  if (source && p.clip) source.start(0, p.clip.start, p.clip.end - p.clip.start);

  await new Promise<void>((done) => {
    const frame = () => {
      const elapsed = (performance.now() - t0) / 1000;
      drawFrame(ctx, p, words, meta, Math.min(elapsed, p.duration));
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
