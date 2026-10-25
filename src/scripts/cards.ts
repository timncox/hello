// Brainrot collector cards: earned by finishing a character's section (see Quest in app.ts).
// Front: art, name, type, rarity, number, playful stats. Back: chant, key verse, date earned.
// Holo shine follows the pointer; tap flips. cardImage() draws the same card for sharing.

export interface CardCharacter {
  id: string;
  name: string;
  chant: string;
  type: string;
  number: number;
  rarity: "common" | "rare" | "epic" | "legendary";
  image: string;
  passages: { b: string; c: number; v: number; e: number; text: string }[];
}

export interface CardContext {
  total: number;
  foundIn: string; // e.g. "Jonah 1"
  verseRef: string; // e.g. "Jonah 1:17"
  translation: string;
  collectedAt?: number;
  site: string;
}

const RARITY = {
  common: { label: "Common", gem: "●", range: [40, 74], frame: ["#e3e8ee", "#8b95a1"] },
  rare: { label: "Rare", gem: "◆", range: [55, 84], frame: ["#7cc0ff", "#1c4fd8"] },
  epic: { label: "Epic", gem: "✦", range: [68, 93], frame: ["#d79bff", "#6a1fb0"] },
  legendary: { label: "Legendary", gem: "★", range: [84, 99], frame: ["#ffe27a", "#c9891c"] },
} as const;

/** Silly game stats, stable per character (never presented as Bible facts). */
export function statsFor(c: CardCharacter) {
  const [lo, hi] = RARITY[c.rarity].range;
  let h = 2166136261;
  for (const ch of c.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ["AURA", "CHAOS", "DRIP"].map((label, i) => {
    const r = ((h >>> (i * 8)) & 255) / 255;
    return { label, value: Math.round(lo + r * (hi - lo)) };
  });
}

const num = (c: CardCharacter, total: number) => `#${String(c.number).padStart(2, "0")}/${total}`;

function el(tag: string, cls: string, ...kids: (Node | string | null)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

/** Tilt + holo shine follow the pointer; tap flips. */
function interactive(card: HTMLElement, flippable: boolean) {
  const reset = () => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--mx", "50%");
    card.style.setProperty("--my", "50%");
  };
  card.addEventListener("pointermove", (ev) => {
    const r = card.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    card.style.setProperty("--ry", `${(x - 0.5) * 22}deg`);
    card.style.setProperty("--rx", `${(0.5 - y) * 22}deg`);
    card.style.setProperty("--mx", `${x * 100}%`);
    card.style.setProperty("--my", `${y * 100}%`);
  });
  card.addEventListener("pointerleave", reset);
  if (flippable) card.addEventListener("click", () => card.classList.toggle("flipped"));
  reset();
}

export function tradingCard(c: CardCharacter, ctx: CardContext, opts: { interactive?: boolean } = {}) {
  const r = RARITY[c.rarity];
  const img = document.createElement("img");
  img.src = c.image;
  img.alt = c.name;
  img.loading = "lazy";
  const stats = el("div", "tc-stats", ...statsFor(c).map((s) => el("div", "", el("b", "", String(s.value)), el("small", "", s.label))));
  const front = el(
    "div",
    "tc-face tc-front",
    el("div", "tc-top", el("span", "tc-num", num(c, ctx.total)), el("span", "tc-gem", r.gem)),
    el("div", "tc-art", img),
    el("div", "tc-name", c.name),
    el("div", "tc-type", el("span", "", c.type), el("span", "tc-rarity", r.label)),
    stats,
    el("div", "tc-foot", `🔍 ${ctx.foundIn} · ${ctx.site}`),
    el("div", "tc-holo"),
  );
  const date = ctx.collectedAt ? new Date(ctx.collectedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  const back = el(
    "div",
    "tc-face tc-back",
    el("div", "tc-chant", `“${c.chant}”`),
    el("blockquote", "tc-verse", c.passages[0].text),
    el("div", "tc-ref", `${ctx.verseRef} · ${ctx.translation}`),
    date ? el("div", "tc-date", `✅ Collected ${date}`) : null,
    el("div", "tc-holo"),
  );
  const card = el("div", `tcard r-${c.rarity}`, el("div", "tc-inner", front, back));
  card.setAttribute("role", "img");
  card.setAttribute("aria-label", `${c.name}, ${r.label} card ${num(c, ctx.total)}`);
  if (opts.interactive) interactive(card, true);
  return card;
}

/** The back of an unearned card: just a mystery. */
export function lockedCard(total: number, number: number) {
  return el(
    "div",
    "tcard locked",
    el("div", "tc-inner", el("div", "tc-face tc-front", el("div", "tc-lock", el("span", "", "?"), el("small", "", `#${String(number).padStart(2, "0")}/${total}`)))),
  );
}

// ---------- shareable image ----------

const CW = 750;
const CH = 1050;
const ANTON = `"Anton", Impact, "Arial Black", sans-serif`;

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, start: number, maxW: number, family: string) {
  let size = start;
  do {
    ctx.font = `${size}px ${family}`;
    size -= 2;
  } while (ctx.measureText(text).width > maxW && size > 20);
}

export async function cardImage(c: CardCharacter, ctx0: CardContext): Promise<Blob> {
  await document.fonts.load(`60px ${ANTON}`).catch(() => {});
  const img = new Image();
  img.src = c.image;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext("2d")!;
  const r = RARITY[c.rarity];

  const frame = ctx.createLinearGradient(0, 0, CW, CH);
  frame.addColorStop(0, r.frame[0]);
  frame.addColorStop(1, r.frame[1]);
  ctx.fillStyle = frame;
  rr(ctx, 0, 0, CW, CH, 44);
  ctx.fill();
  if (c.rarity === "legendary") {
    const foil = ctx.createLinearGradient(0, CH, CW, 0);
    ["#ff6ec4", "#ffd36e", "#7cf29a", "#6ec8ff", "#b27bff"].forEach((col, i) => foil.addColorStop(i / 4, col));
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = foil;
    rr(ctx, 0, 0, CW, CH, 44);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = "#121218";
  rr(ctx, 24, 24, CW - 48, CH - 48, 28);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.font = `700 30px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(num(c, ctx0.total), 56, 70);
  ctx.textAlign = "right";
  ctx.fillStyle = r.frame[0];
  ctx.font = `700 40px system-ui, sans-serif`;
  ctx.fillText(r.gem, CW - 56, 70);

  // art (cover)
  const ax = 48, ay = 106, aw = CW - 96, ah = 560;
  ctx.save();
  rr(ctx, ax, ay, aw, ah, 18);
  ctx.clip();
  const s = Math.max(aw / img.naturalWidth, ah / img.naturalHeight);
  ctx.drawImage(img, ax + (aw - img.naturalWidth * s) / 2, ay + (ah - img.naturalHeight * s) * 0.4, img.naturalWidth * s, img.naturalHeight * s);
  ctx.restore();
  ctx.strokeStyle = r.frame[0];
  ctx.lineWidth = 4;
  rr(ctx, ax, ay, aw, ah, 18);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  fitFont(ctx, c.name.toUpperCase(), 72, CW - 110, ANTON);
  ctx.fillText(c.name.toUpperCase(), CW / 2, 720);

  ctx.font = `700 30px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`${c.type}  ·  ${r.label}`, CW / 2, 782);

  statsFor(c).forEach((st, i) => {
    const bw = 196, gap = 21, x = 48 + i * (bw + gap), y = 818;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    rr(ctx, x, y, bw, 108, 16);
    ctx.fill();
    ctx.fillStyle = r.frame[0];
    ctx.font = `56px ${ANTON}`;
    ctx.fillText(String(st.value), x + bw / 2, y + 46);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `700 22px system-ui, sans-serif`;
    ctx.fillText(st.label, x + bw / 2, y + 88);
  });

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `600 24px system-ui, sans-serif`;
  ctx.fillText(`🔍 ${ctx0.foundIn} · ${ctx0.site}`, CW / 2, 976);

  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}
