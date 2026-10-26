// Oddly-satisfying loops for the bottom half of split-screen cards. Every frame is a pure
// function of (time, beats), where beats are the moments each word is spoken, so the
// ball hits the ring, the block lands, the knife cuts exactly on the word, live and in
// exported video alike.

export type Vibe = "ring" | "stack" | "fireworks" | "sand" | "spiro" | "pendulum" | "marble" | "escape" | "cradle" | "bubble" | "plinko" | "press";
export const VIBES: Vibe[] = ["ring", "stack", "fireworks", "sand", "spiro", "pendulum", "marble", "escape", "cradle", "bubble", "plinko", "press"];

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

const ease = (u: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

function counter(ctx: CanvasRenderingContext2D, text: string, size: number) {
  ctx.font = `800 ${Math.round(size)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.textAlign = "left";
  ctx.fillText(text, 16, size + 8);
}

// ---------- paint marbling: a drop lands on every word and pushes the older paint outward ----------

const MARBLE_HUES = [0, 38, 180, 205, 320, 260];

function marble(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  const k = lastBeat(beats, t);
  const from = Math.max(0, k - 22);
  // Each drop's colour differs from the one before, so neighbouring rings never merge.
  const colors: string[] = [];
  let prev = -1;
  for (let i = 0; i <= k + 1; i++) {
    const r = rnd(seed, i, 5);
    let c = Math.floor(r * MARBLE_HUES.length);
    if (c === prev) c = (c + 1) % MARBLE_HUES.length;
    prev = c;
    colors.push(rnd(seed, i, 6) < 0.15 ? hsl(hue + 30, 35, 93) : hsl(hue + MARBLE_HUES[c], 78, 50 + rnd(seed, i, 7) * 16));
  }
  if (from > 0) {
    ctx.fillStyle = colors[from - 1];
    ctx.fillRect(0, 0, w, h);
  } else backdrop(ctx, w, h, hue + 20);

  const m = Math.min(w, h);
  const center = (i: number) => [w * (0.22 + 0.56 * rnd(seed, i, 1)), h * (0.22 + 0.56 * rnd(seed, i, 2))];
  const radius = (i: number) => m * (0.1 + 0.08 * rnd(seed, i, 3)) * ease((t - beatAt(beats, i)) / 0.5);
  const drops: { c: number[]; r: number }[] = [];
  for (let i = from; i <= k; i++) drops.push({ c: center(i), r: radius(i) });

  const N = 110;
  for (let a = 0; a < drops.length; a++) {
    const { c, r } = drops[a];
    if (r < 0.5) continue;
    ctx.beginPath();
    for (let q = 0; q < N; q++) {
      const ang = (q / N) * TAU;
      let x = c[0] + Math.cos(ang) * r;
      let y = c[1] + Math.sin(ang) * r;
      // Every later drop displaces this ring: area-preserving push away from its centre.
      for (let b = a + 1; b < drops.length; b++) {
        const d = drops[b];
        if (d.r <= 0) continue;
        const dx = x - d.c[0];
        const dy = y - d.c[1];
        const f = Math.sqrt(1 + (d.r * d.r) / Math.max(dx * dx + dy * dy, 1e-6));
        x = d.c[0] + dx * f;
        y = d.c[1] + dy * f;
      }
      if (q) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = colors[from + a];
    ctx.fill();
  }

  // The next drop falling onto the surface.
  const until = beatAt(beats, k + 1) - t;
  if (until < 0.25) {
    const [x, y] = center(k + 1);
    const u = 1 - until / 0.25;
    ctx.fillStyle = colors[k + 1];
    ctx.beginPath();
    ctx.ellipse(x, y * u * u, m * 0.018, m * 0.03, 0, 0, TAU);
    ctx.fill();
  }
}

// ---------- ball escaping nested spinning rings: one ring breaks on every word ----------

function escape(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 200);
  const cx = w / 2;
  const cy = h / 2;
  const GAP = 0.85;
  const BALL = 0.09; // ball radius relative to the ring it's in
  const worldR = (j: number) => Math.pow(1.3, j); // each ring 30% bigger, so zooming in looks the same at any depth
  const spin = (j: number) => (rnd(seed, j, 1) < 0.5 ? -1 : 1) * (0.8 + rnd(seed, j, 2));
  const exitAngle = (j: number) => rnd(seed, j, 3) * TAU; // ball leaves ring j here, on beat j
  const gapAngle = (j: number, tt: number) => exitAngle(j) + spin(j) * (tt - beatAt(beats, j));
  const at = (r: number, a: number) => [Math.cos(a) * r, Math.sin(a) * r];
  const pos = (tt: number) => {
    const j = lastBeat(beats, tt); // ring j is broken; bouncing inside ring j+1
    const from = j >= 0 ? at(worldR(j), exitAngle(j)) : [0, 0];
    const wall = at(worldR(j + 1) * (1 - BALL), exitAngle(j) + 1.3 + rnd(seed, j, 4) * 2.2);
    const to = at(worldR(j + 1), exitAngle(j + 1));
    const b0 = j >= 0 ? beatAt(beats, j) : beatAt(beats, 0) - 0.6;
    const u = clamp01((tt - b0) / Math.max(0.05, beatAt(beats, j + 1) - b0));
    const [p, q, v] = u < 0.5 ? [from, wall, u * 2] : [wall, to, u * 2 - 1];
    return { x: p[0] + (q[0] - p[0]) * v, y: p[1] + (q[1] - p[1]) * v, j, bounce: u - 0.5 };
  };

  const k = lastBeat(beats, t);
  const since = k >= 0 ? t - beatAt(beats, k) : 9;
  const zc = k + ease(since / 0.4);
  const scale = (0.42 * Math.min(w, h)) / worldR(zc + 2);
  const lw = Math.min(w, h) * 0.014;

  ctx.lineCap = "round";
  for (let j = k + 1; j <= k + 6; j++) {
    const r = worldR(j) * scale;
    if (r > Math.hypot(w, h) / 2) break;
    const g = gapAngle(j, t);
    const near = j === k + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, g + GAP / 2, g - GAP / 2 + TAU);
    // glow: a wide faint stroke under the ring (much cheaper than shadowBlur)
    ctx.strokeStyle = hsl(hue + j * 28, 100, 60, near ? 0.22 : 0.12);
    ctx.lineWidth = lw * 3.5;
    ctx.stroke();
    ctx.strokeStyle = hsl(hue + j * 28, 90, near ? 62 : 52, near ? 1 : 0.75);
    ctx.lineWidth = lw;
    ctx.stroke();
  }

  // Broken rings fly apart.
  for (let j = Math.max(0, k - 1); j <= k; j++) {
    const age = t - beatAt(beats, j);
    if (age < 0 || age > 0.9) continue;
    const r = worldR(j) * scale;
    const g = gapAngle(j, beatAt(beats, j));
    const SEG = 22;
    ctx.strokeStyle = hsl(hue + j * 28, 95, 65, 1 - age / 0.9);
    ctx.lineWidth = lw;
    for (let s = 0; s < SEG; s++) {
      const a0 = g + GAP / 2 + ((TAU - GAP) * s) / SEG;
      const a1 = a0 + ((TAU - GAP) / SEG) * 0.8;
      const mid = (a0 + a1) / 2;
      const push = age * Math.min(w, h) * (0.5 + rnd(seed, j * 40 + s, 5) * 0.4);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(mid) * push, cy + Math.sin(mid) * push + 0.5 * h * age * age, r, a0, a1);
      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = "lighter";
  const ballPx = BALL * worldR(zc + 1) * scale;
  for (let s = 10; s >= 1; s--) {
    const p = pos(t - s * 0.025);
    ctx.fillStyle = hsl(hue + 40, 100, 60, 0.05 * (11 - s));
    ctx.beginPath();
    ctx.arc(cx + p.x * scale, cy + p.y * scale, ballPx * (1 - s / 25), 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  const now = pos(t);
  const x = cx + now.x * scale;
  const y = cy + now.y * scale;
  const br = ballPx * (1 + Math.max(0, 1 - Math.abs(now.bounce) * 12) * 0.15);
  const grad = ctx.createRadialGradient(x - br * 0.3, y - br * 0.3, 1, x, y, br);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(1, hsl(hue + 40, 95, 58));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, br, 0, TAU);
  ctx.fill();
  counter(ctx, String(Math.max(0, k + 1)), Math.min(w, h) * 0.07);
}

// ---------- Newton's cradle: a click on every word ----------

function cradle(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 90);
  const N = 5;
  const br = Math.min(w * 0.055, h * 0.085);
  const L = Math.min(h * 0.55, (w / 2 - br * 5) / Math.sin(0.42)); // full swing stays on screen
  const barY = Math.max(h * 0.08, h * 0.68 - L);
  const cx = w / 2;
  const k = lastBeat(beats, t);
  const b0 = beatAt(beats, k);
  const b1 = beatAt(beats, k + 1);
  // Between beat k and k+1 one end ball swings out and back, landing on the next word.
  const gap = b1 - b0;
  const amp = Math.min(0.42, 0.2 + gap * 0.3);
  const u = clamp01((t - b0) / Math.max(0.05, gap));
  const side = ((k % 2) + 2) % 2 ? -1 : 1;
  const swing = amp * Math.sin(Math.PI * u);
  const age = t - b0;
  const flash = k >= 0 ? Math.max(0, 1 - age / 0.18) : 0;

  // frame
  const bar = ctx.createLinearGradient(0, barY - 8, 0, barY + 8);
  bar.addColorStop(0, "#f2f4f8");
  bar.addColorStop(1, "#6b7280");
  ctx.fillStyle = bar;
  ctx.fillRect(cx - br * 6.4, barY - 6, br * 12.8, 12);

  for (let i = 0; i < N; i++) {
    const px = cx + (i - 2) * br * 2;
    let a = 0;
    if (side > 0 && i === N - 1) a = swing;
    if (side < 0 && i === 0) a = -swing;
    const jiggle = i > 0 && i < N - 1 ? Math.sin(age * 90 + i) * flash * br * 0.03 : 0;
    const x = px + Math.sin(a) * L + jiggle;
    const y = barY + Math.cos(a) * L;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - br * 0.8, barY);
    ctx.lineTo(x, y - br);
    ctx.lineTo(px + br * 0.8, barY);
    ctx.stroke();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, barY + L + br * 1.6, br * 0.9, br * 0.22, 0, 0, TAU);
    ctx.fill();
    const hit = (side > 0 ? i === 0 : i === N - 1) || (side > 0 ? i === N - 1 : i === 0);
    const glow = hit ? flash : 0;
    const g = ctx.createRadialGradient(x - br * 0.35, y - br * 0.35, br * 0.05, x, y, br);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, hsl(hue + 20 + i * 8, 25 + glow * 60, 72 + glow * 15));
    g.addColorStop(1, hsl(hue + 20 + i * 8, 30, 22));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, TAU);
    ctx.fill();
    if (glow > 0) {
      ctx.strokeStyle = hsl(hue + 40, 100, 75, glow);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, br + (1 - glow) * br * 0.8, 0, TAU);
      ctx.stroke();
    }
  }
  counter(ctx, String(Math.max(0, k + 1)), Math.min(w, h) * 0.07);
}

// ---------- bubble wrap: one pop per word, a fresh sheet slides in when it's done ----------

function bubble(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 300);
  const cols = 6;
  const cell = (w * 0.86) / cols;
  const rows = Math.max(3, Math.floor((h * 0.84) / cell));
  const n = cols * rows;
  const k = lastBeat(beats, t);
  const ox = (w - cols * cell) / 2;
  const oy = (h - rows * cell) / 2;
  // Snake order: left to right, then back.
  const cellOf = (i: number) => {
    const r = Math.floor(i / cols);
    const c = r % 2 ? cols - 1 - (i % cols) : i % cols;
    return [c, r];
  };

  const drawSheet = (sheet: number, pops: number, dx: number) => {
    const tint = hue + sheet * 47;
    ctx.fillStyle = hsl(tint, 50, 80, 0.12);
    ctx.fillRect(ox + dx - 6, oy - 6, cols * cell + 12, rows * cell + 12);
    for (let i = 0; i < n; i++) {
      const [c, r] = cellOf(i);
      const x = ox + dx + (c + 0.5) * cell;
      const y = oy + (r + 0.5) * cell;
      const rad = cell * 0.4;
      const beat = sheet * n + i;
      const age = i < pops ? t - beatAt(beats, beat) : -1;
      if (i < pops && age >= 0.22) {
        // flat, crinkled
        ctx.fillStyle = hsl(tint, 30, 70, 0.18);
        ctx.beginPath();
        for (let q = 0; q < 9; q++) {
          const a = (q / 9) * TAU;
          const rr = rad * (0.62 + rnd(seed, beat, q) * 0.25);
          if (q) ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          else ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        continue;
      }
      const popping = i < pops ? clamp01(age / 0.22) : 0;
      const sc = 1 - popping * 0.45;
      const g = ctx.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.05, x, y, rad * sc);
      g.addColorStop(0, "rgba(255,255,255,0.85)");
      g.addColorStop(0.4, hsl(tint, 70, 78, 0.45));
      g.addColorStop(1, hsl(tint, 60, 55, 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad * sc, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - popping)})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (popping > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - popping})`;
        ctx.lineWidth = 2;
        for (let s = 0; s < 8; s++) {
          const a = (s / 8) * TAU + 0.3;
          const r0 = rad * (0.7 + popping * 0.6);
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          ctx.lineTo(x + Math.cos(a) * (r0 + rad * 0.35), y + Math.sin(a) * (r0 + rad * 0.35));
          ctx.stroke();
        }
      }
    }
  };

  const done = Math.max(0, k + 1); // bubbles popped so far
  const sheet = Math.floor(Math.max(0, k) / n);
  const pops = done - sheet * n;
  if (pops === n) {
    // Sheet finished: slide it away and the next one in before the next word.
    const b0 = beatAt(beats, k);
    const b1 = beatAt(beats, k + 1);
    const start = b0 + Math.min(0.3, (b1 - b0) * 0.4);
    const u = ease((t - start) / Math.max(0.12, b1 - start - 0.03));
    drawSheet(sheet, pops, -u * w);
    drawSheet(sheet + 1, 0, (1 - u) * w);
  } else drawSheet(sheet, pops, 0);
  counter(ctx, `${done}`, Math.min(w, h) * 0.07);
}

// ---------- Galton board: every word drops a ball into a bin, building a bell curve ----------

function plinko(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 40);
  const ROWS = 9;
  const FALL = 1.1;
  const ROUND = 64;
  const sp = (w * 0.84) / (ROWS + 1);
  const top = h * 0.08;
  const dy = Math.min(sp * 0.86, (h * 0.5) / ROWS);
  const pegR = Math.max(2, sp * 0.07);
  const ballR = Math.min(sp * 0.22, dy * 0.38);
  const floorY = h * 0.97;
  const binTop = top + ROWS * dy + dy * 0.5;
  const pegX = (r: number, j: number) => w / 2 + (j - r / 2) * sp;
  const pegY = (r: number) => top + (r + 1) * dy;
  const binOf = (i: number) => {
    let j = 0;
    for (let r = 0; r < ROWS; r++) j += rnd(seed, i, 20 + r) < 0.5 ? 0 : 1;
    return j;
  };
  const color = (i: number) => hsl(hue + (i % 12) * 30, 90, 62);
  const k = lastBeat(beats, t);
  const round = Math.floor(Math.max(0, k) / ROUND);

  // bins
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.5;
  for (let j = 0; j <= ROWS + 1; j++) {
    const x = w / 2 + (j - 0.5 - ROWS / 2) * sp;
    ctx.beginPath();
    ctx.moveTo(x, binTop);
    ctx.lineTo(x, floorY);
    ctx.stroke();
  }
  // landed balls, stacked two wide
  const counts = new Array(ROWS + 1).fill(0);
  for (let i = round * ROUND; i <= k; i++) {
    const bin = binOf(i);
    const m = counts[bin]++;
    const x = w / 2 + (bin - ROWS / 2) * sp + ((m % 2) - 0.5) * ballR * 2.1;
    const y = floorY - ballR - Math.floor(m / 2) * ballR * 2;
    const age = t - beatAt(beats, i);
    ctx.fillStyle = color(i);
    ctx.beginPath();
    ctx.arc(x, y, ballR * (1 + Math.max(0, 1 - age / 0.2) * 0.3), 0, TAU);
    ctx.fill();
  }

  // pegs, lit when a ball bounces off them
  const lit = new Map<string, number>();
  const flying: { x: number; y: number; i: number }[] = [];
  for (let i = k + 1; beatAt(beats, i) - FALL < t; i++) {
    const land = beatAt(beats, i);
    const u = (t - (land - FALL)) / FALL; // 0..1 from spawn to bin
    const seg = u * (ROWS + 1);
    const r = Math.floor(seg);
    const v = seg - r;
    let j = 0;
    for (let q = 0; q < r && q < ROWS; q++) j += rnd(seed, i, 20 + q) < 0.5 ? 0 : 1;
    const step = r < ROWS ? (rnd(seed, i, 20 + r) < 0.5 ? 0 : 1) : 0;
    const x0 = r === 0 ? w / 2 : pegX(r - 1, j);
    const y0 = r === 0 ? top - dy * 0.5 : pegY(r - 1) - pegR - ballR;
    const x1 = r < ROWS ? pegX(r, j + step) : w / 2 + (j - ROWS / 2) * sp;
    const y1 = r < ROWS ? pegY(r) - pegR - ballR : binTop;
    // The previous peg kicks the ball sideways and up a little, then it falls onto the next.
    const x = r === 0 ? x0 : x0 + (x1 - x0) * Math.min(1, v * 1.4);
    const y = y0 + (y1 - y0) * v * v - (r === 0 ? 0 : dy * 0.35 * Math.sin(Math.PI * Math.min(1, v * 1.2)));
    flying.push({ x, y, i });
    if (r > 0 && r <= ROWS && v < 0.25) lit.set(`${r - 1}:${j}`, 1 - v / 0.25);
  }
  for (let r = 0; r < ROWS; r++) {
    for (let j = 0; j <= r; j++) {
      const glow = lit.get(`${r}:${j}`) ?? 0;
      ctx.fillStyle = glow ? hsl(hue + 40, 100, 70 + glow * 20) : "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(pegX(r, j), pegY(r), pegR * (1 + glow * 0.8), 0, TAU);
      ctx.fill();
    }
  }
  for (const f of flying) {
    const g = ctx.createRadialGradient(f.x - ballR * 0.3, f.y - ballR * 0.3, 1, f.x, f.y, ballR);
    g.addColorStop(0, "#fff");
    g.addColorStop(1, color(f.i));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, ballR, 0, TAU);
    ctx.fill();
  }
  counter(ctx, String(Math.max(0, k + 1)), Math.min(w, h) * 0.07);
}

// ---------- hydraulic press: crushes something on every word ----------

function pressObject(ctx: CanvasRenderingContext2D, kind: number, x: number, floor: number, size: number, sq: number, col: number) {
  const sx = Math.min(2.4, 1 / Math.sqrt(sq));
  const wd = size * sx;
  const ht = size * sq;
  const left = x - wd / 2;
  const topY = floor - ht;
  if (kind === 0) {
    // jelly cube
    const g = ctx.createLinearGradient(left, topY, left + wd, floor);
    g.addColorStop(0, hsl(col, 85, 72));
    g.addColorStop(1, hsl(col, 80, 45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(left, topY, wd, ht, Math.min(wd, ht) * 0.18);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(left + wd * 0.3, topY + ht * 0.25, wd * 0.14, ht * 0.08, -0.4, 0, TAU);
    ctx.fill();
  } else if (kind === 1) {
    // ball
    const g = ctx.createRadialGradient(x - wd * 0.15, topY + ht * 0.3, 2, x, topY + ht / 2, Math.max(wd, ht) / 2);
    g.addColorStop(0, hsl(col, 90, 80));
    g.addColorStop(1, hsl(col, 80, 40));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, topY + ht / 2, wd / 2, ht / 2, 0, 0, TAU);
    ctx.fill();
  } else {
    // layer cake
    for (let l = 0; l < 4; l++) {
      ctx.fillStyle = l % 2 ? hsl(col + 30, 70, 88) : hsl(col, 75, 55 + l * 4);
      ctx.fillRect(left, topY + (l * ht) / 4, wd, ht / 4 + 0.5);
    }
    ctx.fillStyle = hsl(col + 10, 90, 92);
    ctx.fillRect(left, topY, wd, Math.max(2, ht * 0.08));
  }
}

function press(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], seed: number, hue: number) {
  backdrop(ctx, w, h, hue + 15);
  const k = lastBeat(beats, t);
  const b0 = beatAt(beats, k);
  const b1 = beatAt(beats, k + 1);
  const gap = b1 - b0;
  const floor = h * 0.8;
  const size = Math.min(w * 0.3, h * 0.36);
  const FLAT = 0.2;
  const CRUSH = 0.06;
  const down = Math.min(0.18, gap * 0.35);
  const kind = (i: number) => Math.floor(rnd(seed, i, 30) * 3);
  const col = (i: number) => hue + rnd(seed, i, 31) * 360;
  const sqOf = (i: number) => {
    const age = t - beatAt(beats, i);
    return age < 0 ? 1 : 1 - (1 - FLAT) * ease(age / CRUSH);
  };

  // Conveyor: after the crush, the flat one rides off left and the next one rides in.
  const shiftStart = b0 + Math.min(0.32, gap * 0.35);
  const shiftEnd = b1 - down - 0.02;
  const shift = k >= 0 ? ease((t - shiftStart) / Math.max(0.08, shiftEnd - shiftStart)) : 1;
  const travel = w * 0.62;

  // belt
  ctx.fillStyle = "#1f2430";
  ctx.fillRect(0, floor, w, h * 0.06);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  const off = ((k + shift) * travel) % 28;
  for (let x = -off; x < w; x += 28) ctx.fillRect(x, floor + 3, 12, 3);

  if (k >= 0) pressObject(ctx, kind(k), w / 2 - shift * travel, floor, size, sqOf(k), col(k));
  pressObject(ctx, kind(k + 1), w / 2 + (1 - shift) * travel, floor, size, 1, col(k + 1));

  // splat on impact
  const age = t - b0;
  if (k >= 0 && age < 0.7) {
    for (let s = 0; s < 22; s++) {
      const dir = s % 2 ? 1 : -1;
      const vx = dir * w * (0.25 + rnd(seed, k * 50 + s, 32) * 0.6);
      const vy = -h * (0.4 + rnd(seed, k * 50 + s, 33) * 0.9);
      const x = w / 2 + dir * size * 0.5 + vx * age;
      const y = Math.min(floor, floor - size * FLAT * 0.5 + vy * age + 0.5 * h * 4 * age * age);
      ctx.fillStyle = hsl(col(k), 85, 60, 1 - age / 0.7);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, size * 0.035 * (1 - age)), 0, TAU);
      ctx.fill();
    }
  }

  // press head: comes down onto the next object exactly on the word, lifts after the crush
  const restY = h * 0.08;
  let headY: number;
  if (t >= b1 - down) headY = restY + (floor - size - restY) * ease((t - (b1 - down)) / down) ** 2;
  else if (k >= 0 && age < CRUSH) headY = floor - size * sqOf(k);
  else if (k >= 0) headY = Math.max(restY, floor - size * FLAT - (floor - size * FLAT - restY) * ease((age - CRUSH - 0.05) / 0.3));
  else headY = restY;
  const headH = h * 0.1;
  const pw = size * 0.22;
  const rod = ctx.createLinearGradient(w / 2 - pw / 2, 0, w / 2 + pw / 2, 0);
  rod.addColorStop(0, "#9aa3b2");
  rod.addColorStop(0.5, "#f1f4f9");
  rod.addColorStop(1, "#6b7383");
  ctx.fillStyle = rod;
  ctx.fillRect(w / 2 - pw / 2, 0, pw, headY - headH);
  const head = ctx.createLinearGradient(0, headY - headH, 0, headY);
  head.addColorStop(0, "#c9ced8");
  head.addColorStop(1, "#5d6472");
  ctx.fillStyle = head;
  ctx.fillRect(w / 2 - size * 0.9, headY - headH, size * 1.8, headH);
  // hazard stripes
  ctx.fillStyle = "#f5c518";
  ctx.beginPath();
  for (let x = w / 2 - size * 0.9 + 2; x + 16 < w / 2 + size * 0.9; x += 16) {
    ctx.moveTo(x, headY - headH * 0.13);
    ctx.lineTo(x + 8, headY - headH * 0.35);
    ctx.lineTo(x + 16, headY - headH * 0.35);
    ctx.lineTo(x + 8, headY - headH * 0.13);
    ctx.closePath();
  }
  ctx.fill();
  counter(ctx, String(Math.max(0, k + 1)), Math.min(w, h) * 0.07);
}

const DRAW: Record<Vibe, typeof ring> = { ring, stack, fireworks, sand, spiro, pendulum, marble, escape, cradle, bubble, plinko, press };

export function drawVibe(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, beats: number[], vibe: Vibe, seed: number, hue: number) {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  DRAW[vibe](ctx, w, h, t, beats, seed, hue);
  ctx.restore();
}
