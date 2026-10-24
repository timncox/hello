// Procedural motion backgrounds, one look per genre. Pure function of time, so the same
// code draws the live card and the exported video frame-for-frame.

export type Genre = "law" | "history" | "wisdom" | "major" | "minor" | "gospels" | "paul" | "general" | "apocalypse";
type Effect = "dust" | "fog" | "waves" | "embers" | "rays" | "bokeh" | "stars";

const LOOKS: Record<Genre, { top: string; bottom: string; glow: string; effect: Effect }> = {
  law:        { top: "#2d1b4e", bottom: "#8a3b5c", glow: "255,190,150", effect: "dust" },
  history:    { top: "#0f2027", bottom: "#2c5364", glow: "200,230,255", effect: "fog" },
  wisdom:     { top: "#2a0b2e", bottom: "#a1306f", glow: "255,170,220", effect: "waves" },
  major:      { top: "#3a0f0f", bottom: "#a2381c", glow: "255,150,60",  effect: "embers" },
  minor:      { top: "#2b1a05", bottom: "#8f5b10", glow: "255,200,90",  effect: "dust" },
  gospels:    { top: "#0b1d3a", bottom: "#1e5aa8", glow: "255,240,200", effect: "rays" },
  paul:       { top: "#0d2b22", bottom: "#1f7a5c", glow: "180,255,220", effect: "bokeh" },
  general:    { top: "#102a43", bottom: "#43698a", glow: "200,225,255", effect: "bokeh" },
  apocalypse: { top: "#120024", bottom: "#6a1fb0", glow: "220,190,255", effect: "stars" },
};

/** Deterministic pseudo-random in [0, 1) for particle i, property k. */
function rnd(seed: number, i: number, k: number) {
  const x = Math.sin(i * 127.1 + k * 311.7 + seed * 74.7) * 43758.5453;
  return x - Math.floor(x);
}

const TAU = Math.PI * 2;

function glowDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, genre: Genre, seed: number) {
  const look = LOOKS[genre] ?? LOOKS.gospels;
  const s = Math.min(w, h) / 400; // scale particles with canvas size

  const bg = ctx.createLinearGradient(0, 0, w * 0.35, h);
  bg.addColorStop(0, look.top);
  bg.addColorStop(1, look.bottom);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = "lighter";
  const glow = look.glow;

  switch (look.effect) {
    case "dust": {
      // diagonal light shaft + drifting motes
      const sx = w * (0.3 + 0.1 * Math.sin(t * 0.15 + seed));
      const shaft = ctx.createLinearGradient(sx - 120 * s, 0, sx + 120 * s, 0);
      shaft.addColorStop(0, `rgba(${glow},0)`);
      shaft.addColorStop(0.5, `rgba(${glow},0.10)`);
      shaft.addColorStop(1, `rgba(${glow},0)`);
      ctx.save();
      ctx.translate(sx, 0);
      ctx.rotate(-0.35);
      ctx.translate(-sx, 0);
      ctx.fillStyle = shaft;
      ctx.fillRect(sx - 140 * s, -h * 0.2, 280 * s, h * 1.6);
      ctx.restore();
      for (let i = 0; i < 90; i++) {
        const sp = 0.01 + rnd(seed, i, 1) * 0.03;
        const x = ((rnd(seed, i, 2) + t * sp) % 1) * w;
        const y = ((rnd(seed, i, 3) + t * sp * 0.6) % 1) * h;
        const tw = 0.5 + 0.5 * Math.sin(t * (1 + rnd(seed, i, 4) * 2) + i);
        glowDot(ctx, x, y, (2 + rnd(seed, i, 5) * 4) * s, glow, 0.35 * tw);
      }
      break;
    }
    case "fog": {
      for (let i = 0; i < 7; i++) {
        const r = (140 + rnd(seed, i, 1) * 160) * s;
        const x = (((rnd(seed, i, 2) + t * (0.008 + rnd(seed, i, 3) * 0.012)) % 1) * (w + 2 * r)) - r;
        const y = h * (0.15 + rnd(seed, i, 4) * 0.8) + Math.sin(t * 0.2 + i) * 20 * s;
        glowDot(ctx, x, y, r, glow, 0.09);
      }
      for (let i = 0; i < 40; i++) {
        const x = ((rnd(seed, i, 6) + t * 0.004) % 1) * w;
        const y = rnd(seed, i, 7) * h;
        glowDot(ctx, x, y, 2.5 * s, glow, 0.2 * (0.5 + 0.5 * Math.sin(t + i)));
      }
      break;
    }
    case "waves": {
      for (let i = 0; i < 5; i++) {
        const base = h * (0.5 + i * 0.1);
        const amp = (18 + i * 8) * s;
        const freq = (0.006 + rnd(seed, i, 1) * 0.004) / s;
        const sp = 0.4 + rnd(seed, i, 2) * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) {
          ctx.lineTo(x, base + Math.sin(x * freq + t * sp + i * 1.7) * amp + Math.sin(x * freq * 2.3 - t * sp * 0.7) * amp * 0.35);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, base - amp, 0, h);
        g.addColorStop(0, `rgba(${glow},0.16)`);
        g.addColorStop(1, `rgba(${glow},0)`);
        ctx.fillStyle = g;
        ctx.fill();
      }
      glowDot(ctx, w * 0.75, h * 0.2, 200 * s, glow, 0.12);
      break;
    }
    case "embers": {
      glowDot(ctx, w * 0.5, h * 1.05, h * 0.55, glow, 0.22 + 0.04 * Math.sin(t * 3));
      for (let i = 0; i < 70; i++) {
        const sp = 0.05 + rnd(seed, i, 1) * 0.09;
        const life = (rnd(seed, i, 2) + t * sp) % 1;
        const x = rnd(seed, i, 3) * w + Math.sin(t * (0.8 + rnd(seed, i, 4)) + i) * 30 * s;
        const y = h * 1.05 - life * h * 1.15;
        const flicker = 0.6 + 0.4 * Math.sin(t * 9 + i * 3);
        glowDot(ctx, x, y, (3 + rnd(seed, i, 5) * 5) * s, glow, (1 - life) * 0.8 * flicker);
      }
      break;
    }
    case "rays": {
      const cx = w * 0.5;
      const cy = -h * 0.1;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI / 2 + (i - 4) * 0.13 + Math.sin(t * 0.12 + i) * 0.04;
        const spread = 0.035 + rnd(seed, i, 1) * 0.04;
        const len = h * 1.4;
        const alpha = 0.06 + 0.05 * Math.sin(t * 0.5 + i * 1.3);
        const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        g.addColorStop(0, `rgba(${glow},${alpha * 2})`);
        g.addColorStop(1, `rgba(${glow},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - spread) * len, cy + Math.sin(a - spread) * len);
        ctx.lineTo(cx + Math.cos(a + spread) * len, cy + Math.sin(a + spread) * len);
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 50; i++) {
        const x = (rnd(seed, i, 2) * w + Math.sin(t * 0.3 + i) * 15 * s);
        const y = ((rnd(seed, i, 3) + t * (0.01 + rnd(seed, i, 4) * 0.02)) % 1) * h;
        glowDot(ctx, x, y, (2 + rnd(seed, i, 5) * 3) * s, glow, 0.3 * (0.5 + 0.5 * Math.sin(t * 2 + i)));
      }
      break;
    }
    case "bokeh": {
      for (let i = 0; i < 22; i++) {
        const r = (25 + rnd(seed, i, 1) * 90) * s;
        const x = ((rnd(seed, i, 2) + Math.sin(t * 0.05 + i) * 0.08 + 1) % 1) * w;
        const y = ((rnd(seed, i, 3) - t * (0.006 + rnd(seed, i, 4) * 0.01) + 10) % 1) * (h + 2 * r) - r;
        ctx.globalAlpha = 0.06 + 0.07 * (0.5 + 0.5 * Math.sin(t * 0.7 + i));
        ctx.fillStyle = `rgb(${glow})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "stars": {
      for (let i = 0; i < 3; i++) {
        const x = w * (0.3 + 0.4 * rnd(seed, i, 1)) + Math.sin(t * 0.07 + i * 2) * 60 * s;
        const y = h * (0.25 + 0.5 * rnd(seed, i, 2)) + Math.cos(t * 0.05 + i) * 60 * s;
        glowDot(ctx, x, y, (180 + 120 * rnd(seed, i, 3)) * s, glow, 0.13);
      }
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);
      for (let i = 0; i < 150; i++) {
        const a = rnd(seed, i, 4) * TAU;
        const z = (rnd(seed, i, 5) + t * 0.04) % 1;
        const r = z * z * maxR;
        const size = (0.6 + z * 2.6) * s;
        ctx.globalAlpha = Math.min(1, z * 1.6);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
  }

  // vignette keeps captions readable over any effect
  ctx.globalCompositeOperation = "source-over";
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}
