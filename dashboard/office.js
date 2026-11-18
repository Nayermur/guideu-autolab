// AutoLab virtual office: an isometric pixel-art room drawn on a small canvas and scaled up.
// Agents sit at their desks while "working" and wander around the office while "idle".

const W = 400, H = 262;          // low-res world size; CSS scales it up with pixelated rendering
const TW = 32, TH = 16;          // isometric tile size
const OX = 200, OY = 90;         // screen position of grid corner (0,0)
const WALL = 78;                 // wall height in px

export const iso = (gx, gy, z = 0) => [OX + (gx - gy) * (TW / 2), OY + (gx + gy) * (TH / 2) - z];

// ---------- colour helpers ----------
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function poly(ctx, pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y))));
  ctx.closePath();
  ctx.fill();
}

/** Axis-aligned isometric box covering [gx, gx+w] × [gy, gy+d], from height z0 to z0+h. */
function box(ctx, gx, gy, w, d, h, color, z0 = 0) {
  const t = z0 + h;
  poly(ctx, [iso(gx, gy + d, z0), iso(gx + w, gy + d, z0), iso(gx + w, gy + d, t), iso(gx, gy + d, t)], shade(color, 0.78));
  poly(ctx, [iso(gx + w, gy, z0), iso(gx + w, gy + d, z0), iso(gx + w, gy + d, t), iso(gx + w, gy, t)], shade(color, 0.62));
  poly(ctx, [iso(gx, gy, t), iso(gx + w, gy, t), iso(gx + w, gy + d, t), iso(gx, gy + d, t)], color);
}

// ---------- agents' looks and desks ----------
export const LOOKS = {
  scout:    { skin: "#f1c27d", hair: "#3b2416", shirt: "#4f9d69", pants: "#2f3b52", hat: "#c9a227", accent: "#7ee081" },
  verifier: { skin: "#e0ac69", hair: "#111111", shirt: "#6c8cff", pants: "#2b2b3d", glasses: true, accent: "#8fb3ff" },
  writer:   { skin: "#c68642", hair: "#1d1d1d", shirt: "#f2f2f2", pants: "#39424e", beanie: "#e4572e", accent: "#ffd166" },
  designer: { skin: "#f5d0b0", hair: "#b5179e", shirt: "#ff8fab", pants: "#3a2e5c", headphones: true, accent: "#ff8fab" },
  critic:   { skin: "#8d5524", hair: "#2a1a10", shirt: "#ef476f", pants: "#22223b", cap: "#22223b", accent: "#ff6b81" },
};

// Desk layout. `seat` is where the agent sits.
const HQ_DESKS = {
  scout:    { gx: 1.0, gy: 0.6, w: 1.9, d: 0.9, seat: [1.95, 2.05], prop: "globe" },
  verifier: { gx: 4.0, gy: 0.6, w: 1.9, d: 0.9, seat: [4.95, 2.05], prop: "papers" },
  writer:   { gx: 7.0, gy: 0.6, w: 1.9, d: 0.9, seat: [7.95, 2.05], prop: "typewriter" },
  designer: { gx: 0.6, gy: 4.6, w: 0.9, d: 1.9, seat: [2.05, 5.55], prop: "dual" },
  critic:   { gx: 6.4, gy: 6.4, w: 1.9, d: 0.9, seat: [7.35, 7.85], prop: "clipboard" },
};

// ---------- rooms ----------
// Pakhi, the owner's assistant (My Office Room).
export const PAKHI_LOOK = { skin: "#e8b98a", hair: "#1a1a1a", longHair: true, dress: "#14b8a6", shirt: "#14b8a6", pants: "#14b8a6", flower: "#ff6b9d", accent: "#5eead4" };
const OFFICE_DESKS = { pakhi: { gx: 4.0, gy: 0.6, w: 1.9, d: 0.9, seat: [4.95, 2.05], prop: "typewriter" } };

// Desk slots for Specialised Team bots, in the order bots are added.
export const TEAM_SLOTS = [
  { gx: 1.0, gy: 0.6, w: 1.9, d: 0.9, seat: [1.95, 2.05] },
  { gx: 4.0, gy: 0.6, w: 1.9, d: 0.9, seat: [4.95, 2.05] },
  { gx: 7.0, gy: 0.6, w: 1.9, d: 0.9, seat: [7.95, 2.05] },
  { gx: 0.6, gy: 4.6, w: 0.9, d: 1.9, seat: [2.05, 5.55], side: true },
  { gx: 6.4, gy: 6.4, w: 1.9, d: 0.9, seat: [7.35, 7.85] },
  { gx: 3.4, gy: 3.6, w: 1.9, d: 0.9, seat: [4.35, 5.05] },
  { gx: 6.2, gy: 3.6, w: 1.9, d: 0.9, seat: [7.15, 5.05] },
  { gx: 0.6, gy: 7.0, w: 0.9, d: 1.6, seat: [2.05, 7.8], side: true },
];
const PROPS = ["papers", "typewriter", "globe", "clipboard"];

/** A stable, varied pixel look for a bot, derived from its name. */
export function botLook(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const pick = (arr, salt) => arr[(h >>> salt) % arr.length];
  const female = (h & 1) === 1;
  const look = {
    skin: pick(["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#f5d0b0"], 1),
    hair: pick(["#1d1d1d", "#3b2416", "#6b3e26", "#b5179e", "#2a1a10", "#c9a227"], 4),
    shirt: pick(["#4f9d69", "#6c8cff", "#f2994a", "#ef476f", "#9b5de5", "#00bbf9", "#f15bb5", "#80ed99"], 7),
    pants: pick(["#2f3b52", "#2b2b3d", "#39424e", "#3a2e5c"], 10),
  };
  look.accent = look.shirt;
  if (female) Object.assign(look, { longHair: true, dress: look.shirt, pants: look.shirt });
  const extra = (h >>> 13) % 5;
  if (extra === 0) look.glasses = true;
  else if (extra === 1) look.headphones = true;
  else if (extra === 2 && !female) look.cap = pick(["#22223b", "#e63946", "#264653"], 16);
  else if (extra === 3 && female) look.flower = pick(["#ff6b9d", "#ffd166", "#ffffff"], 16);
  return look;
}

/** Room definitions: which desks exist and how each person looks. */
export function makeScene(kind, bots = []) {
  if (kind === "office") return { desks: OFFICE_DESKS, looks: { pakhi: PAKHI_LOOK } };
  if (kind === "team") {
    const desks = {}, looks = {};
    bots.slice(0, TEAM_SLOTS.length).forEach((b, i) => {
      desks[b.id] = { ...TEAM_SLOTS[i], prop: TEAM_SLOTS[i].side ? "dual" : PROPS[i % PROPS.length] };
      looks[b.id] = botLook(b.name);
    });
    return { desks, looks };
  }
  return { desks: HQ_DESKS, looks: LOOKS };
}

let DESKS = HQ_DESKS;
let CUR_LOOKS = LOOKS;

// Places idle agents like to visit.
const SPOTS = [
  [8.4, 3.6], [8.4, 4.9], [4.6, 8.1], [5.6, 8.1], [4.8, 4.6], [3.4, 6.6], [6.0, 3.6], [2.6, 8.4], [5.4, 5.8],
];

// ---------- room ----------
function drawRoom(ctx, t, hour) {
  const night = hour < 6 || hour >= 18;
  // floor
  for (let x = 0; x < 10; x++) {
    for (let y = 0; y < 10; y++) {
      const c = (x + y) % 2 ? "#c9a87c" : "#bf9c70";
      poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], c);
    }
  }
  // rug in front of the sofa
  poly(ctx, [iso(3.6, 6.9), iso(6.6, 6.9), iso(6.6, 8.0), iso(3.6, 8.0)], "#7b5ea7");
  poly(ctx, [iso(3.8, 7.05), iso(6.4, 7.05), iso(6.4, 7.85), iso(3.8, 7.85)], "#8e6fbf");

  // walls (left = teal, right = orange) with a trim line
  poly(ctx, [iso(0, 0), iso(0, 10), iso(0, 10, WALL), iso(0, 0, WALL)], "#2f7f7a");
  poly(ctx, [iso(0, 0), iso(10, 0), iso(10, 0, WALL), iso(0, 0, WALL)], "#e07a3f");
  poly(ctx, [iso(0, 0), iso(0, 10), iso(0, 10, 6), iso(0, 0, 6)], "#24615d");
  poly(ctx, [iso(0, 0), iso(10, 0), iso(10, 0, 6), iso(0, 0, 6)], "#b45f2f");
  // wall top edges
  poly(ctx, [iso(0, 0, WALL), iso(0, 10, WALL), iso(-0.25, 10, WALL), iso(-0.25, -0.25, WALL)], "#3d958f");
  poly(ctx, [iso(0, 0, WALL), iso(10, 0, WALL), iso(10, -0.25, WALL), iso(-0.25, -0.25, WALL)], "#f0935a");

  // windows on the left wall: sky changes with Bangladesh time
  const sky = night ? "#1b2142" : hour < 8 || hour >= 16 ? "#f6a96b" : "#8fd3ff";
  for (const gy of [1.4, 6.6]) {
    poly(ctx, [iso(0, gy, 30), iso(0, gy + 1.8, 30), iso(0, gy + 1.8, 64), iso(0, gy, 64)], "#f4e7d3");
    poly(ctx, [iso(0, gy + 0.12, 33), iso(0, gy + 1.68, 33), iso(0, gy + 1.68, 61), iso(0, gy + 0.12, 61)], sky);
    poly(ctx, [iso(0, gy + 0.86, 33), iso(0, gy + 0.94, 33), iso(0, gy + 0.94, 61), iso(0, gy + 0.86, 61)], "#f4e7d3");
    if (night) {
      for (let i = 0; i < 4; i++) {
        const [sx, sy] = iso(0, gy + 0.3 + i * 0.35, 40 + ((i * 7) % 18));
        ctx.fillStyle = (Math.floor(t / 600) + i) % 3 ? "#ffffff" : "#8a93c9";
        ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1);
      }
    } else {
      const [cx, cy] = iso(0, gy + 0.5 + ((t / 9000) % 1) * 0.9, 52);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.round(cx), Math.round(cy), 5, 2);
      ctx.fillRect(Math.round(cx) + 1, Math.round(cy) - 1, 3, 1);
    }
  }

  // whiteboard ("today's board") on the right wall
  poly(ctx, [iso(3.2, 0, 34), iso(6.8, 0, 34), iso(6.8, 0, 70), iso(3.2, 0, 70)], "#d9d9d9");
  poly(ctx, [iso(3.35, 0, 36), iso(6.65, 0, 36), iso(6.65, 0, 68), iso(3.35, 0, 68)], "#fbfbfb");
  // posters
  poly(ctx, [iso(8.0, 0, 40), iso(9.1, 0, 40), iso(9.1, 0, 66), iso(8.0, 0, 66)], "#3a86ff");
  poly(ctx, [iso(8.2, 0, 50), iso(8.9, 0, 50), iso(8.9, 0, 60), iso(8.2, 0, 60)], "#ffbe0b");
  poly(ctx, [iso(0, 4.0, 40), iso(0, 5.0, 40), iso(0, 5.0, 64), iso(0, 4.0, 64)], "#ff006e");
  poly(ctx, [iso(0, 4.2, 46), iso(0, 4.8, 46), iso(0, 4.8, 58), iso(0, 4.2, 58)], "#ffd6e8");
  // wall clock
  const [kx, ky] = iso(1.9, 0, 64);
  ctx.fillStyle = "#fff"; ctx.fillRect(Math.round(kx) - 3, Math.round(ky) - 3, 7, 7);
  ctx.fillStyle = "#222"; ctx.fillRect(Math.round(kx), Math.round(ky) - 2, 1, 3); ctx.fillRect(Math.round(kx), Math.round(ky), 2, 1);
}

// ---------- furniture (depth-sorted along with agents) ----------
function furniture(t, agents) {
  const items = [];
  const add = (depth, draw) => items.push({ depth, draw });

  for (const [key, d] of Object.entries(DESKS)) {
    const working = agents[key]?.status === "working";
    const err = agents[key]?.status === "error";
    add(d.gx + d.w + d.gy + d.d - 0.2, (ctx) => {
      // desk top + legs
      box(ctx, d.gx, d.gy, d.w, d.d, 3, "#8b5a2b", 13);
      box(ctx, d.gx + 0.05, d.gy + 0.05, 0.12, 0.12, 13, "#5c3a1a");
      box(ctx, d.gx + d.w - 0.17, d.gy + d.d - 0.17, 0.12, 0.12, 13, "#5c3a1a");
      box(ctx, d.gx + 0.05, d.gy + d.d - 0.17, 0.12, 0.12, 13, "#5c3a1a");
      box(ctx, d.gx + d.w - 0.17, d.gy + 0.05, 0.12, 0.12, 13, "#5c3a1a");
      drawProp(ctx, d, t, working, err, CUR_LOOKS[key]?.accent ?? "#8fb3ff");
    });
    // chair
    const [cx, cy] = d.seat;
    add(cx + cy + 0.3, (ctx) => {
      box(ctx, cx - 0.3, cy - 0.3, 0.6, 0.6, 2, "#3d3d5c", 7);
      box(ctx, cx - 0.06, cy - 0.06, 0.12, 0.12, 7, "#222");
      if (d.prop === "dual") box(ctx, cx + 0.22, cy - 0.3, 0.1, 0.6, 10, "#3d3d5c", 9);
      else box(ctx, cx - 0.3, cy + 0.22, 0.6, 0.1, 10, "#3d3d5c", 9);
    });
  }

  // water cooler + coffee station on the right side
  add(9.0 + 3.0 + 0.8, (ctx) => {
    box(ctx, 9.0, 3.0, 0.6, 0.6, 16, "#e8e8e8");
    box(ctx, 9.08, 3.08, 0.44, 0.44, 12, "#7fc8f8", 16);
    box(ctx, 9.15, 3.15, 0.3, 0.3, 2, "#4aa3df", 28);
  });
  add(9.0 + 4.3 + 0.8, (ctx) => {
    box(ctx, 8.9, 4.3, 0.8, 0.8, 14, "#6b4423");
    box(ctx, 9.05, 4.45, 0.4, 0.4, 10, "#2d2d2d", 14);
    const [sx, sy] = iso(9.2, 4.6, 26 + ((t / 200) % 6));
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(Math.round(sx), Math.round(sy), 1, 2);
  });
  // sofa
  add(4.0 + 8.6 + 2.6, (ctx) => {
    box(ctx, 3.9, 8.5, 2.6, 0.9, 8, "#5e60ce");
    box(ctx, 3.9, 9.15, 2.6, 0.25, 10, "#4ea8de", 8);
    box(ctx, 3.9, 8.5, 0.25, 0.9, 6, "#4ea8de", 8);
    box(ctx, 6.25, 8.5, 0.25, 0.9, 6, "#4ea8de", 8);
  });
  // plants
  for (const [px, py] of [[0.4, 9.0], [9.1, 0.4], [9.0, 8.6]]) {
    add(px + py + 0.6, (ctx) => {
      box(ctx, px, py, 0.5, 0.5, 8, "#b5523b");
      const [lx, ly] = iso(px + 0.25, py + 0.25, 8);
      ctx.fillStyle = "#2d6a4f";
      ctx.fillRect(Math.round(lx) - 5, Math.round(ly) - 12, 10, 10);
      ctx.fillStyle = "#40916c";
      ctx.fillRect(Math.round(lx) - 3, Math.round(ly) - 16, 6, 8);
      ctx.fillRect(Math.round(lx) - 7, Math.round(ly) - 8, 3, 4);
      ctx.fillRect(Math.round(lx) + 4, Math.round(ly) - 9, 3, 4);
    });
  }
  return items;
}

function screen(ctx, pts, on, t, accent) {
  poly(ctx, pts, on ? "#0f1b2d" : "#1a1a1a");
  if (!on) return;
  // scrolling "code" lines on the monitor
  const [a, b, , dpt] = pts;
  for (let i = 0; i < 4; i++) {
    const f = ((i * 0.22 + t / 1500) % 0.9) + 0.05;
    const x1 = a[0] + (dpt[0] - a[0]) * f, y1 = a[1] + (dpt[1] - a[1]) * f;
    const len = 0.3 + ((i * 37) % 5) / 10;
    ctx.fillStyle = i % 2 ? accent : "#9be7ff";
    ctx.fillRect(Math.round(x1 + (b[0] - a[0]) * 0.1), Math.round(y1 + (b[1] - a[1]) * 0.1), Math.max(1, Math.round((b[0] - a[0]) * len)), 1);
  }
}

function drawProp(ctx, d, t, working, err, lookAccent) {
  const z = 16;
  const accent = err ? "#ff4d4d" : lookAccent;
  if (d.prop === "dual") {
    // two monitors facing +gx (toward the chair)
    for (const oy of [0.15, 1.0]) {
      box(ctx, d.gx + 0.15, d.gy + oy, 0.15, 0.75, 14, "#2b2d42", z);
      screen(ctx, [iso(d.gx + 0.31, d.gy + oy + 0.06, z + 2), iso(d.gx + 0.31, d.gy + oy + 0.69, z + 2), iso(d.gx + 0.31, d.gy + oy + 0.69, z + 12), iso(d.gx + 0.31, d.gy + oy + 0.06, z + 12)], working, t, accent);
    }
    box(ctx, d.gx + 0.5, d.gy + 0.8, 0.3, 0.4, 1, "#111", z);
    return;
  }
  // monitor facing +gy (toward the chair)
  box(ctx, d.gx + 0.5, d.gy + 0.2, 0.9, 0.15, 15, "#2b2d42", z);
  screen(ctx, [iso(d.gx + 0.56, d.gy + 0.36, z + 2), iso(d.gx + 1.34, d.gy + 0.36, z + 2), iso(d.gx + 1.34, d.gy + 0.36, z + 13), iso(d.gx + 0.56, d.gy + 0.36, z + 13)], working, t, accent);
  box(ctx, d.gx + 0.6, d.gy + 0.55, 0.7, 0.2, 1, "#d9d9d9", z); // keyboard
  if (d.prop === "globe") {
    box(ctx, d.gx + 1.55, d.gy + 0.3, 0.2, 0.2, 3, "#6b4423", z);
    const [x, y] = iso(d.gx + 1.65, d.gy + 0.4, z + 3);
    ctx.fillStyle = "#3a86ff"; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 7, 6, 6);
    ctx.fillStyle = "#52b788"; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 6, 3, 2); ctx.fillRect(Math.round(x), Math.round(y) - 4, 2, 2);
  } else if (d.prop === "papers") {
    box(ctx, d.gx + 0.1, d.gy + 0.2, 0.35, 0.5, 6, "#f8f9fa", z);
    box(ctx, d.gx + 1.5, d.gy + 0.25, 0.3, 0.4, 4, "#f1faee", z);
  } else if (d.prop === "typewriter") {
    box(ctx, d.gx + 1.45, d.gy + 0.25, 0.4, 0.4, 4, "#495057", z);
    box(ctx, d.gx + 1.5, d.gy + 0.25, 0.3, 0.06, 4, "#f8f9fa", z + 4);
    box(ctx, d.gx + 0.15, d.gy + 0.5, 0.18, 0.18, 4, "#e63946", z); // mug
  } else if (d.prop === "clipboard") {
    box(ctx, d.gx + 1.45, d.gy + 0.3, 0.35, 0.45, 1, "#c08552", z);
    box(ctx, d.gx + 1.5, d.gy + 0.35, 0.25, 0.35, 1, "#ffffff", z + 1);
    box(ctx, d.gx + 0.12, d.gy + 0.3, 0.3, 0.06, 1, "#e63946", z); // red pen
  }
}

// ---------- people ----------
function px(ctx, x, y, w, h, c) {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Draws a 10×18 pixel person with feet at (x, y). */
function drawPerson(ctx, x, y, look, { frame = 0, back = false, seated = false, typing = false, t = 0 }) {
  x = Math.round(x); y = Math.round(y);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(x - 4, y - 1, 9, 2);
  const lift = seated ? 5 : 0;
  const by = y - lift;
  if (!seated) {
    const step = frame % 2;
    px(ctx, x - 3, by - 5, 2, 4 - step, look.pants);
    px(ctx, x + 1, by - 5, 2, 3 + step, look.pants);
    px(ctx, x - 3, by - 1 - step, 2, 1, "#222");
    px(ctx, x + 1, by - 2 + step, 2, 1, "#222");
  } else {
    px(ctx, x - 3, by - 5, 6, 2, look.pants);
  }
  // body
  px(ctx, x - 4, by - 11, 8, 6, look.shirt);
  px(ctx, x - 4, by - 6, 8, 1, shade(look.shirt, 0.8));
  // arms
  const bob = typing ? (Math.floor(t / 150) % 2) : 0;
  if (back && typing) {
    px(ctx, x - 5, by - 11, 1, 3, look.shirt);
    px(ctx, x + 4, by - 11, 1, 3, look.shirt);
    px(ctx, x - 5, by - 9 - bob, 1, 1, look.skin);
    px(ctx, x + 4, by - 9 - (1 - bob), 1, 1, look.skin);
  } else {
    px(ctx, x - 5, by - 11, 1, 4, look.shirt);
    px(ctx, x + 4, by - 11, 1, 4, look.shirt);
    px(ctx, x - 5, by - 7, 1, 1, look.skin);
    px(ctx, x + 4, by - 7, 1, 1, look.skin);
  }
  // head
  px(ctx, x - 3, by - 17, 6, 6, look.skin);
  if (back) {
    px(ctx, x - 3, by - 18, 6, 6, look.hair);
  } else {
    px(ctx, x - 3, by - 18, 6, 2, look.hair);
    px(ctx, x - 3, by - 16, 1, 2, look.hair);
    px(ctx, x + 2, by - 16, 1, 2, look.hair);
    const blink = Math.floor(t / 2800 + x) % 9 === 0;
    if (!blink) { px(ctx, x - 2, by - 14, 1, 1, "#1b1b1b"); px(ctx, x + 1, by - 14, 1, 1, "#1b1b1b"); }
    px(ctx, x - 1, by - 12, 2, 1, shade(look.skin, 0.75));
    if (look.glasses) { px(ctx, x - 3, by - 14, 6, 1, "#222"); px(ctx, x - 2, by - 14, 1, 1, "#9ad1ff"); px(ctx, x + 1, by - 14, 1, 1, "#9ad1ff"); }
  }
  // long hair and dress (drawn over the base figure)
  if (look.longHair) {
    if (back) px(ctx, x - 3, by - 12, 6, 3, look.hair);
    else { px(ctx, x - 4, by - 16, 1, 6, look.hair); px(ctx, x + 3, by - 16, 1, 6, look.hair); }
  }
  if (look.dress && !seated) {
    px(ctx, x - 4, by - 6, 8, 2, look.dress);
    px(ctx, x - 5, by - 4, 10, 1, look.dress);
  }
  if (look.flower && !back) { px(ctx, x + 2, by - 18, 2, 2, look.flower); px(ctx, x + 2, by - 18, 1, 1, "#fff8"); }
  // accessories
  if (look.hat) { px(ctx, x - 5, by - 18, 10, 1, look.hat); px(ctx, x - 3, by - 20, 6, 2, look.hat); }
  if (look.beanie) { px(ctx, x - 3, by - 19, 6, 2, look.beanie); px(ctx, x - 1, by - 20, 2, 1, "#fff"); }
  if (look.cap) { px(ctx, x - 3, by - 19, 6, 2, look.cap); if (!back) px(ctx, x - 3, by - 17, 8, 1, look.cap); }
  if (look.headphones) { px(ctx, x - 4, by - 19, 8, 1, "#222"); px(ctx, x - 4, by - 16, 1, 3, "#222"); px(ctx, x + 3, by - 16, 1, 3, "#222"); }
}

// ---------- simulation ----------
export class Office {
  constructor(canvas, onLayout, scene = makeScene("hq")) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.width = W;
    canvas.height = H;
    this.onLayout = onLayout;    // callback(list of {key, x, y}) for DOM name tags
    this.agents = {};            // key -> { status, activity }
    this.setScene(scene);
    this.last = performance.now();
    this.hour = 12;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame((t) => this.loop(t));
  }

  /** Switches the room (Headquarter, My Office Room, Specialised Team). */
  setScene(scene) {
    this.scene = scene;
    DESKS = scene.desks;
    CUR_LOOKS = scene.looks;
    const old = this.people ?? {};
    this.people = {};
    Object.entries(DESKS).forEach(([key, d], i) => {
      const [sx, sy] = SPOTS[i % SPOTS.length];
      this.people[key] = old[key] ? { ...old[key], desk: d } : { key, gx: sx, gy: sy, target: null, wait: Math.random() * 3000, frame: 0, seated: false, desk: d };
    });
  }

  setAgents(agents, hour) {
    this.agents = agents;
    if (hour !== undefined) this.hour = hour;
  }

  step(dt, t) {
    for (const p of Object.values(this.people)) {
      const status = this.agents[p.key]?.status ?? "idle";
      const atDesk = status === "working" || status === "error";
      if (atDesk) {
        p.target = p.desk.seat;
      } else if (p.seated || (!p.target && (p.wait -= dt) <= 0)) {
        // pick a new place to wander to (not where another agent is going)
        const taken = Object.values(this.people).map((o) => o.target && o.target.join());
        const free = SPOTS.filter((s) => !taken.includes(s.join()));
        p.target = free[Math.floor(Math.random() * free.length)] ?? SPOTS[0];
        p.seated = false;
      }
      if (!p.target) continue;
      const dx = p.target[0] - p.gx, dy = p.target[1] - p.gy;
      const dist = Math.hypot(dx, dy);
      const speed = this.reduced ? 100 : 1.3 * (dt / 1000);
      if (dist <= speed) {
        p.gx = p.target[0]; p.gy = p.target[1];
        if (atDesk) p.seated = true;
        else { p.target = null; p.wait = 2500 + Math.random() * 5000; }
      } else {
        p.gx += (dx / dist) * speed; p.gy += (dy / dist) * speed;
        p.seated = false;
        p.frame = Math.floor(t / 180);
        p.back = dy < 0 || (Math.abs(dy) < 0.01 && dx < 0);
      }
    }
  }

  loop(t) {
    const dt = Math.min(100, t - this.last);
    this.last = t;
    this.step(dt, t);
    this.draw(t);
    requestAnimationFrame((n) => this.loop(n));
  }

  draw(t) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    drawRoom(ctx, t, this.hour);
    const items = furniture(t, this.agents);
    const tags = [];
    for (const p of Object.values(this.people)) {
      const status = this.agents[p.key]?.status ?? "idle";
      items.push({
        depth: p.gx + p.gy + (p.seated ? 0.35 : 0.05),
        draw: (c) => {
          const [x, y] = iso(p.gx, p.gy);
          const seatedBack = p.seated && p.desk.prop !== "dual";
          drawPerson(c, x, y, CUR_LOOKS[p.key], {
            frame: p.frame,
            back: p.seated ? seatedBack : p.back,
            seated: p.seated,
            typing: p.seated && status === "working",
            t,
          });
          tags.push({ key: p.key, x: x / W, y: (y - (p.seated ? 29 : 26)) / H });
        },
      });
    }
    items.sort((a, b) => a.depth - b.depth).forEach((i) => i.draw(ctx));
    this.onLayout?.(tags, iso(5, 0, 52).map((v, i) => v / (i ? H : W)));
  }
}
