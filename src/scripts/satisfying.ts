// Oddly-satisfying loops for the bottom half of split-screen cards. Every frame is a pure
// function of (time, beats), where beats are the moments each word is spoken, so the
// ball hits the ring, the block lands, the knife cuts exactly on the word, live and in
// exported video alike.

export type Vibe = "ring" | "stack" | "fireworks" | "sand" | "spiro" | "pendulum";
export const VIBES: Vibe[] = ["ring", "stack", "fireworks", "sand", "spiro", "pendulum"];

const TAU = Math.PI * 2;
const FILL_GAP = 0.5; // beat spacing used before the first and after the last real beat

function rnd(seed: number, i: number, k: number) {
  const x = Math.sin(i * 127.1 + k * 311.7 + seed * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Beat i, extending the real beats with an even pulse on both sides so loops never stall. */
function beatAt(beats: number[], i: number) {
  const n = beats.length;
  if (!n) return 0.4 + i * FILL_GAP;
  if (i < 0) return beats[0] + i * FILL_GAP;
  if (i < n) return beats[i];
  return beats[n - 1] + (i - n + 1) * FILL_GAP;
}

/** Index of the last beat at or before t (can be negative before the first beat). */
function lastBeat(beats: number[], t: number) {
  let i = Math.floor((t - beatAt(beats, 0)) / FILL_GAP);
  if (beats.length && t >= beats[0]) {
    i = 0;
    while (beatAt(beats, i + 1) <= t) i++;
  }
  return i;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h % 360},${s}%,${l}%,${a})`;

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, hue: number) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, hsl(225 + (hue % 40), 40, 7));
  g.addColorStop(1, hsl(255 + (hue % 40), 45, 15));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ---------- ball bouncing inside a ring, growing on every hit ----------

function ring(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) * 0.42;
  const radius = (i: number) => R * (0.06 + 0.011 * Math.min(Math.max(i, 0), 30));
  const angle = (i: number) => {
    let a = Math.PI / 2;
    for (let k = 1; k <= i; k++) a += Math.PI + (rnd(seed, k, 1) - 0.5) * 1.5;
    return a;
  };
  const impact = (i: number) => {
    const a = angle(i);
    const r = R - radius(i);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const pos = (tt: number) => {
    const k = lastBeat(beats, tt);
    if (k < 0) {
      const b0 = beatAt(beats, 0);
      const u = Math.max(0, 1 - (b0 - tt) / 0.6);
      const [x, y] = impact(0);
      return { x: cx + (x - cx) * u * u, y: cy + (y - cy) * u * u, k: -1 };
    }
    const [x0, y0] = impact(k);
    const [x1, y1] = impact(k + 1);
    const b0 = beatAt(beats, k);
    const u = Math.min(1, (tt - b0) / Math.max(0.05, beatAt(beats, k + 1) - b0));
    let x = x0 + (x1 - x0) * u;
    let y = y0 + (y1 - y0) * u - R * 0.28 * 4 * u * (1 - u);
    const d = Math.hypot(x - cx, y - cy);
    const lim = R - radius(k);
    if (d > lim) {
      x = cx + ((x - cx) / d) * lim;
      y = cy + ((y - cy) / d) * lim;
    }
    return { x, y, k };
  };

  backdrop(ctx, w, h, hue);
  const now = pos(t);
  const k = Math.max(now.k, 0);
  const age = now.k >= 0 ? t - beatAt(beats, now.k) : 9;
  const flash = Math.max(0, 1 - age / 0.2);

  ctx.lineWidth = R * 0.035;
  ctx.strokeStyle = hsl(hue + k * 23, 90, 60 + flash * 25);
  ctx.shadowColor = hsl(hue + k * 23, 100, 60);
  ctx.shadowBlur = 20 + flash * 30;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (now.k >= 0 && age < 0.6) {
    const [ix, iy] = impact(now.k);
    ctx.strokeStyle = hsl(hue + k * 23, 100, 70, 1 - age / 0.6);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ix, iy, radius(now.k) + age * R * 0.5, 0, TAU);
    ctx.stroke();
    for (let s = 0; s < 14; s++) {
      const a = rnd(seed, now.k * 31 + s, 2) * TAU;
      const sp = R * (0.3 + rnd(seed, now.k * 31 + s, 3) * 0.6);
      ctx.fillStyle = hsl(hue + k * 23 + s * 6, 100, 65, 1 - age / 0.6);
      ctx.beginPath();
      ctx.arc(ix + Math.cos(a) * sp * age, iy + Math.sin(a) * sp * age, 2.5, 0, TAU);
      ctx.fill();
    }
  }

  ctx.globalCompositeOperation = "lighter";
  for (let j = 14; j >= 1; j--) {
    const p = pos(t - j * 0.022);
    ctx.fillStyle = hsl(hue + (k - j * 0.4) * 23, 100, 55, 0.05 * (15 - j) / 1.4);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius(Math.max(p.k, 0)) * (1 - j / 30), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  const g = ctx.createRadialGradient(now.x - radius(k) * 0.3, now.y - radius(k) * 0.3, 1, now.x, now.y, radius(k));
  g.addColorStop(0, "#fff");
  g.addColorStop(1, hsl(hue + k * 23, 95, 55));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(now.x, now.y, radius(k) * (1 + flash * 0.12), 0, TAU);
  ctx.fill();

  ctx.font = `700 ${Math.round(R * 0.12)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "left";
  ctx.fillText(`×${Math.max(0, now.k + 1)}`, 14, R * 0.16 + 10);
}

// ---------- stacking blocks, trimmed like the Stack game ----------

function stack(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue);
  const bh = h * 0.085;
  const k = lastBeat(beats, t);
  // Walk the tower up to the next block: width/centre after each trim.
  type Block = { x: number; width: number; cut: number; perfect: boolean };
  const blocks: Block[] = [{ x: w / 2, width: w * 0.5, cut: 0, perfect: false }];
  for (let i = 1; i <= Math.max(k + 1, 1); i++) {
    const prev = blocks[i - 1];
    // Trim a little each time; once the tower is thin, every drop is perfect.
    const thin = prev.width < w * 0.2;
    const perfect = thin || rnd(seed, i, 4) < 0.25;
    const off = perfect ? 0 : (rnd(seed, i, 5) - 0.5) * Math.min(w * 0.1, prev.width * 0.3);
    blocks.push({ x: prev.x + off / 2, width: prev.width - Math.abs(off), cut: off, perfect });
  }

  const top = Math.max(k, 0);
  const cam = Math.max(0, top * bh - h * 0.42);
  const baseY = h * 0.92 + cam;
  const color = (i: number, l = 58) => hsl(hue + i * 9, 75, l);
  const from = Math.max(0, top - 14);
  for (let i = from; i <= top; i++) {
    const b = blocks[i];
    const y = baseY - (i + 1) * bh;
    ctx.fillStyle = color(i);
    ctx.fillRect(b.x - b.width / 2, y, b.width, bh);
    ctx.fillStyle = color(i, 70);
    ctx.fillRect(b.x - b.width / 2, y, b.width, bh * 0.18);
    // Trimmed overhang tumbling away.
    const age = t - beatAt(beats, i);
    if (i > 0 && b.cut && age >= 0 && age < 1.2) {
      const prev = blocks[i - 1];
      const side = Math.sign(b.cut);
      const cw = Math.abs(b.cut);
      const px = side > 0 ? prev.x + prev.width / 2 + cw / 2 - cw : prev.x - prev.width / 2 - cw / 2 + cw;
      ctx.save();
      ctx.translate(px + side * age * w * 0.15, y + bh / 2 + 0.5 * 2.2 * h * age * age);
      ctx.rotate(side * age * 2.5);
      ctx.globalAlpha = 1 - age / 1.2;
      ctx.fillStyle = color(i, 50);
      ctx.fillRect(-cw / 2, -bh / 2, cw, bh);
      ctx.restore();
    }
    if (b.perfect && age >= 0 && age < 0.6) {
      ctx.strokeStyle = `rgba(255,255,255,${1 - age / 0.6})`;
      ctx.lineWidth = 3;
      const pad = age * 40;
      ctx.strokeRect(b.x - b.width / 2 - pad, y - pad, b.width + pad * 2, bh + pad * 2);
    }
  }
  // Next block sliding in, landing on the beat.
  const next = blocks[top + 1];
  const b0 = beatAt(beats, top + 1);
  const u = 1 - Math.min(1, Math.max(0, (b0 - t) / 0.35));
  const side = (top + 1) % 2 ? 1 : -1;
  const prevB = blocks[top];
  const restX = prevB.x + next.cut;
  const sx = restX + side * (1 - u) * w * 0.8;
  ctx.fillStyle = color(top + 1);
  ctx.fillRect(sx - prevB.width / 2, baseY - (top + 2) * bh, prevB.width, bh);

  ctx.font = `800 ${Math.round(h * 0.07)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textAlign = "left";
  ctx.fillText(String(Math.max(0, k + 1)), 16, h * 0.11);
}

// ---------- fireworks bursting on every word ----------

function fireworks(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 30);
  for (let s = 0; s < 40; s++) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.3 * rnd(seed, s, 9)})`;
    ctx.fillRect(rnd(seed, s, 7) * w, rnd(seed, s, 8) * h * 0.7, 1.5, 1.5);
  }
  ctx.globalCompositeOperation = "lighter";
  const k = lastBeat(beats, t);
  for (let i = k - 4; i <= k + 1; i++) {
    const b = beatAt(beats, i);
    const bx = w * (0.15 + 0.7 * rnd(seed, i, 1));
    const by = h * (0.18 + 0.32 * rnd(seed, i, 2));
    const c = hue + rnd(seed, i, 3) * 360;
    const age = t - b;
    if (age < 0 && age > -0.5) {
      const u = 1 + age / 0.5;
      const y = h + (by - h) * (1 - (1 - u) * (1 - u));
      ctx.fillStyle = hsl(c, 100, 75);
      ctx.beginPath();
      ctx.arc(bx, y, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = hsl(c, 100, 60, 0.35);
      ctx.fillRect(bx - 1, y, 2, h * 0.08);
    } else if (age >= 0 && age < 1.6) {
      const fade = 1 - age / 1.6;
      if (age < 0.12) {
        ctx.fillStyle = `rgba(255,255,255,${0.07 * (1 - age / 0.12)})`;
        ctx.fillRect(0, 0, w, h);
      }
      for (let s = 0; s < 46; s++) {
        const a = (s / 46) * TAU + rnd(seed, i, s) * 0.2;
        const sp = Math.min(w, h) * (0.35 + rnd(seed, i * 7, s) * 0.25);
        const x = bx + Math.cos(a) * sp * age * (1 - age * 0.25);
        const y = by + Math.sin(a) * sp * age * (1 - age * 0.25) + 0.5 * h * 0.35 * age * age;
        ctx.fillStyle = hsl(c + s * 2, 100, 65, fade);
        ctx.beginPath();
        ctx.arc(x, y, 2.6 * fade + 0.8, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

// ---------- kinetic sand, a slice cut on every word ----------

function sand(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  const SLICES = 12;
  backdrop(ctx, w, h, hue + 120);
  const k = Math.max(-1, lastBeat(beats, t));
  const bw = w * 0.62;
  const bhgt = h * 0.42;
  const left = (w - bw) / 2;
  const floor = h * 0.82;
  const sw = bw / SLICES;
  const block = Math.floor((k + 1) / SLICES);
  const cut = (k + 1) % SLICES;
  const layers = 7;
  const layerColor = (blockIdx: number, l: number) => hsl(hue + rnd(seed, blockIdx, l) * 140 + l * 18, 70, 66);

  // plate
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.ellipse(w / 2, floor + 6, bw * 0.62, 12, 0, 0, TAU);
  ctx.fill();

  const remaining = bw - cut * sw;
  for (let l = 0; l < layers; l++) {
    ctx.fillStyle = layerColor(block, l);
    ctx.fillRect(left, floor - bhgt + (l * bhgt) / layers, remaining, bhgt / layers + 0.5);
  }

  // The last two slices: tip over, then crumble into grains.
  for (let i = k - 1; i <= k; i++) {
    if (i < 0) continue;
    const age = t - beatAt(beats, i);
    const bIdx = Math.floor(i / SLICES);
    const x0 = left + bw - ((i % SLICES) + 1) * sw;
    if (age < 0.28) {
      ctx.save();
      ctx.translate(x0 + sw, floor);
      ctx.rotate((age / 0.28) * 1.2);
      for (let l = 0; l < layers; l++) {
        ctx.fillStyle = layerColor(bIdx, l);
        ctx.fillRect(-sw, -bhgt + (l * bhgt) / layers, sw, bhgt / layers + 0.5);
      }
      ctx.restore();
    } else if (age < 1.6) {
      const a = age - 0.28;
      for (let g = 0; g < 90; g++) {
        const l = Math.floor(rnd(seed, i * 13, g) * layers);
        const gx = x0 + sw + (rnd(seed, i * 17, g) * bhgt * 0.9) * Math.cos(1.2) + rnd(seed, i, g) * sw;
        const gy = floor - bhgt * (1 - rnd(seed, i * 17, g)) * 0.4;
        const vx = (rnd(seed, i * 19, g) - 0.3) * w * 0.25;
        const y = Math.min(floor + 4, gy + 0.5 * h * 1.6 * a * a);
        ctx.fillStyle = layerColor(bIdx, l);
        ctx.globalAlpha = Math.min(1, 2.2 - a * 1.6);
        ctx.fillRect(gx + vx * a, y, 3.2, 3.2);
      }
      ctx.globalAlpha = 1;
    }
  }

  // Knife comes down on the beat.
  const nb = beatAt(beats, k + 1);
  const until = nb - t;
  const drop = until < 0.22 ? 1 - until / 0.22 : 0;
  const kx = left + remaining - sw;
  const tipY = floor - bhgt - h * 0.18 + drop * (h * 0.18 + bhgt);
  ctx.fillStyle = "#d9dee6";
  ctx.beginPath();
  ctx.moveTo(kx - 3, tipY - h * 0.5);
  ctx.lineTo(kx + 3, tipY - h * 0.5);
  ctx.lineTo(kx + 3, tipY);
  ctx.lineTo(kx - 3, tipY - 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#8a6a4a";
  ctx.fillRect(kx - 6, tipY - h * 0.62, 12, h * 0.13);
}

// ---------- spirograph drawing itself, jumping ahead on each word ----------

const SPIROS = [
  [5, 3, 0.9],
  [7, 4, 0.7],
  [8, 3, 1.1],
  [9, 5, 0.8],
  [11, 4, 0.9],
];

function spiro(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 60);
  const [R0, r0, dRatio] = SPIROS[Math.floor(rnd(seed, 1, 1) * SPIROS.length)];
  const scale = (Math.min(w, h) * 0.44) / (R0 - r0 + r0 * dRatio);
  const R = R0 * scale;
  const r = r0 * scale;
  const d = r * dRatio;
  const period = TAU * r0;
  let theta = t * 1.6;
  for (let i = 0; i <= lastBeat(beats, t); i++) {
    const age = t - beatAt(beats, i);
    if (age >= 0) theta += 0.8 * (1 - Math.pow(1 - Math.min(1, age / 0.3), 3));
  }
  const pt = (a: number) => [
    w / 2 + (R - r) * Math.cos(a) + d * Math.cos(((R - r) / r) * a),
    h / 2 + (R - r) * Math.sin(a) - d * Math.sin(((R - r) / r) * a),
  ];
  const start = Math.max(0, theta - period);
  const step = 0.035;
  ctx.lineCap = "round";
  ctx.globalCompositeOperation = "lighter";
  for (const [width, alpha] of [[9, 0.12], [3.2, 1]]) {
    ctx.lineWidth = width;
    let [px, py] = pt(start);
    for (let a = start + step; a <= theta; a += step) {
      const [x, y] = pt(a);
      const fade = (a - start) / Math.max(period, theta - start);
      ctx.strokeStyle = hsl(hue + a * 12, 95, 62, alpha * (0.2 + 0.8 * fade));
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      px = x;
      py = y;
    }
  }
  ctx.globalCompositeOperation = "source-over";
  const [ex, ey] = pt(theta);
  const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 14);
  g.addColorStop(0, "#fff");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(ex - 14, ey - 14, 28, 28);
}

// ---------- pendulum wave (seen from below), pulsing on each word ----------

function pendulum(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 160);
  const N = 16;
  const k = lastBeat(beats, t);
  const age = k >= 0 ? t - beatAt(beats, k) : 9;
  const pulse = Math.max(0, 1 - age / 0.25);
  const lead = ((k % N) + N) % N;
  const amp = h * 0.34;
  const at = (i: number, tt: number) => h / 2 + amp * Math.cos((TAU * tt * (40 + i)) / 40 + rnd(seed, 0, 1) * 0);
  for (let i = 0; i < N; i++) {
    const x = w * 0.08 + (w * 0.84 * i) / (N - 1);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, h / 2 - amp);
    ctx.lineTo(x, h / 2 + amp);
    ctx.stroke();
    for (let j = 6; j >= 1; j--) {
      ctx.fillStyle = hsl(hue + i * 20, 95, 60, 0.06 * (7 - j));
      ctx.beginPath();
      ctx.arc(x, at(i, t - j * 0.03), Math.min(w, h) * 0.03, 0, TAU);
      ctx.fill();
    }
    const y = at(i, t);
    const rad = Math.min(w, h) * 0.034 * (1 + (i === lead ? pulse * 0.7 : pulse * 0.12));
    const g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 1, x, y, rad);
    g.addColorStop(0, "#fff");
    g.addColorStop(1, hsl(hue + i * 20, 95, 55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
  }
}

const DRAW: Record<Vibe, typeof ring> = { ring, stack, fireworks, sand, spiro, pendulum };

export function drawVibe(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], vibe: Vibe, seed: number, hue: number) {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  DRAW[vibe](ctx, w, h, t, beats, seed, hue);
  ctx.restore();
}
