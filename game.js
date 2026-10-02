/* 鹈鹕骑行 Pelican Ride — first playable prototype
 * Plain Canvas 2D, no dependencies. Segment-based pseudo-3D road (OutRun style).
 */
(() => {
'use strict';

// ============================================================ utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (a, b, t) => a + (b - a) * t * t;
const easeOut = (a, b, t) => a + (b - a) * (1 - (1 - t) * (1 - t));
const easeInOut = (a, b, t) => a + (b - a) * (-Math.cos(t * Math.PI) / 2 + 0.5);
const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TAU = Math.PI * 2;

// ============================================================ canvas
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1, S = 1, HY = 0, CAM_H = 1000, PLAYER_Z = 1000, RIDER_S = 1, RIDER_Y = 0, PORTRAIT = false;

// ============================================================ road constants
const SEG = 200;              // segment length (world units)
const ROAD_W = 2000;          // half road width
const RUMBLE = 3;             // segments per colour band
const DRAW_DIST = 230;        // segments drawn
const FOV = 100;
const CAM_DEPTH = 1 / Math.tan((FOV / 2) * Math.PI / 180);
const MAX_SPEED = SEG * 60 * 0.62;   // world units / s
const KMH_MAX = 36;                  // displayed km/h at MAX_SPEED
const M_PER_UNIT = (KMH_MAX / 3.6) / MAX_SPEED;
const OFFROAD = 0.92;
const CENTRIFUGAL = 0.3;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  PORTRAIT = H > W * 1.05;
  S = W;
  HY = Math.round(H * (PORTRAIT ? 0.47 : 0.46));
  // rider size & placement
  RIDER_S = Math.min(H * (PORTRAIT ? 0.27 : 0.40) / 270, W * 0.36 / 125);
  RIDER_Y = H - Math.max(10, H * (PORTRAIT ? 0.075 : 0.035));
  // camera height chosen so the path's width at the bottom of the screen ~ frac * W
  const frac = PORTRAIT ? 1.0 : 0.62;
  CAM_H = 2 * ROAD_W * (H - HY) / (frac * W);
  // the point of road directly under the rider's wheel
  PLAYER_Z = CAM_DEPTH * CAM_H * (S / 2) / Math.max(1, RIDER_Y - HY);
  layoutControls();
}

// ============================================================ palettes / routes
const ROUTES = {
  sea: {
    key: 'sea', name: '海边', full: '海边路线', seed: 20261002,
    skyTop: '#86cdee', skyBot: '#dcf2f9', haze: '#e3f3f6',
    road: ['#efc98b', '#eac282'], rumble: ['#fffaf0', '#f6e6c6'], track: 'rgba(196,140,75,0.30)',
    grass: ['#a2d983', '#96d176'], sand: ['#fcefd2', '#f8e8c4'],
    sea: ['#5dbfe8', '#52b4e0'], seaFar: '#7cc9ea',
  },
  field: {
    key: 'field', name: '田野', full: '田野路线', seed: 777,
    skyTop: '#8fd0f0', skyBot: '#e0f3f7', haze: '#e6f4f1',
    road: ['#ecc88c', '#e6c082'], rumble: ['#fff6e2', '#f3e2bf'], track: 'rgba(180,125,65,0.30)',
    grass: ['#a6db86', '#9ad37a'], sand: ['#f8e6bb', '#f3ddab'],
    fields: [
      ['#f4d36e', '#ecc85d'],  // wheat
      ['#86cc6e', '#7bc263'],  // green crop
      ['#c4b0ea', '#b8a2e3'],  // lavender
      ['#f9cbd3', '#f6c0ca'],  // pink flowers
    ],
  },
};
let route = ROUTES.sea;

// ============================================================ track
let segments = [];
let trackLength = 0;

function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }
function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n,
    p1: { world: { y: lastY(), z: n * SEG }, camera: {}, screen: {} },
    p2: { world: { y: y, z: (n + 1) * SEG }, camera: {}, screen: {} },
    curve, sprites: [], fence: 0, fl: -1, fr: -1, clip: 0, fog: 0, vis: false,
  });
}
function addRoad(enter, hold, leave, curve, hill) {
  const startY = lastY(), endY = startY + hill * SEG, total = enter + hold + leave;
  for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}

// seaside shoreline (in road half-widths, measured on the LEFT)
const shoreAt = i => 3.5 + 0.6 * Math.sin(i * 0.011) + 0.25 * Math.sin(i * 0.037 + 1.3);

// a ride is a finite journey: start arch -> landmarks -> finish arch, then a short run-out
const JOURNEY = 3400, RUNOUT = 420, START_IDX = 18;
function buildTrack(r) {
  segments = [];
  const rnd = rng(r.seed);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  addRoad(10, 60, 10, 0, 0);
  while (segments.length < JOURNEY - 420) {
    const kind = rnd();
    const len = pick([25, 40, 60]);
    const hill = (rnd() < 0.55) ? (rnd() * 2 - 1) * pick([8, 14, 22]) : 0;
    // keep heights bounded
    const y = lastY() / SEG;
    const h = clamp(y + hill, -45, 45) - y;
    if (kind < 0.22) addRoad(len, len, len, 0, h);
    else if (kind < 0.75) addRoad(len, len + pick([0, 20, 40]), len, (rnd() < 0.5 ? -1 : 1) * pick([1.2, 2, 3, 3.8]), h);
    else { // gentle S-bend
      const c = pick([1.5, 2.5, 3]) * (rnd() < 0.5 ? -1 : 1);
      addRoad(30, 30, 30, c, h / 2);
      addRoad(30, 30, 30, -c, h / 2);
    }
  }
  addRoad(40, 40, 40, 0, -lastY() / SEG);
  addRoad(0, JOURNEY + RUNOUT - segments.length, 0, 0, 0);
  trackLength = segments.length * SEG;
  decorate(r, rnd);
  placeJourney(r, rnd);
}

function put(i, name, offset) {
  if (i < 0 || i >= segments.length) return;
  segments[i].sprites.push({ name, offset });
}

function decorate(r, rnd) {
  const N = segments.length;
  const R = (a, b) => a + rnd() * (b - a);
  if (r.key === 'sea') {
    for (let i = 0; i < N; i++) {
      const sh = shoreAt(i);
      // small stuff close to the path
      if (rnd() < 0.55) put(i, rnd() < 0.6 ? 'tuft' : rnd() < 0.5 ? 'flowerY' : 'flowerP', R(1.12, 2.0));
      if (rnd() < 0.35) put(i, rnd() < 0.5 ? 'flowerW' : 'tuft', R(2.0, 4.5));
      if (rnd() < 0.12) put(i, rnd() < 0.5 ? 'shell' : 'star', -R(1.2, sh - 0.4));
      if (rnd() < 0.08) put(i, 'tuftS', -R(1.15, 1.6));
    }
    // palms on both sides, in loose groups
    for (let i = 20; i < N; i += Math.floor(R(7, 22))) {
      if (rnd() < 0.7) put(i, 'palm', R(1.55, 2.6));
      if (rnd() < 0.45) put(i + 3, 'palm', -R(1.5, Math.min(2.2, shoreAt(i) - 0.7)));
      if (rnd() < 0.25) put(i + 5, 'palm', R(3.0, 5.0));
    }
    for (let i = 40; i < N; i += Math.floor(R(30, 70))) {
      const t = rnd();
      if (t < 0.45) put(i, rnd() < 0.5 ? 'umbrellaR' : 'umbrellaT', -R(1.6, shoreAt(i) - 0.6));
      else if (t < 0.7) put(i, 'hut', R(2.6, 3.6));
      else put(i, 'bush', R(1.8, 3.2));
      if (rnd() < 0.5) put(i + 7, 'rock', -(shoreAt(i + 7) - R(0.0, 0.3)));
    }
    // things at sea
    for (let i = 30; i < N; i += Math.floor(R(35, 90))) put(i, 'boat', -(shoreAt(i) + R(3, 14)));
    for (let i = 300; i < N; i += Math.floor(R(450, 650))) put(i, 'lighthouse', R(5, 7));
  } else {
    // field blocks
    let i = 0;
    while (i < N) {
      const len = Math.floor(R(40, 130));
      const fl = rnd() < 0.8 ? Math.floor(rnd() * 4) : -1;
      const fr = rnd() < 0.8 ? Math.floor(rnd() * 4) : -1;
      for (let k = i; k < Math.min(N, i + len); k++) { segments[k].fl = fl; segments[k].fr = fr; }
      // field furniture
      for (let k = i + 5; k < Math.min(N, i + len - 5); k += Math.floor(R(12, 30))) {
        for (const side of [-1, 1]) {
          const f = side < 0 ? fl : fr;
          if (f === 0 && rnd() < 0.6) put(k, 'hay', side * R(3.2, 6.5));
          else if (f === 1 && rnd() < 0.25) put(k, 'cow', side * R(3.3, 5.5));
          else if (f === -1 && rnd() < 0.35) put(k, 'cow', side * R(2.6, 5.0));
        }
      }
      // sunflower borders
      if (rnd() < 0.35) {
        const side = rnd() < 0.5 ? -1 : 1;
        for (let k = i + 2; k < Math.min(N, i + len - 2); k += 3) put(k, 'sunflower', side * R(2.15, 2.35));
      }
      i += len;
    }
    // fences
    for (let i2 = 30; i2 < N; i2 += Math.floor(R(120, 260))) {
      const len = Math.floor(R(50, 160));
      const bit = rnd() < 0.5 ? 1 : 2;
      for (let k = i2; k < Math.min(N, i2 + len); k++) segments[k].fence |= bit;
    }
    for (let k = 0; k < N; k++) {
      const s = segments[k];
      if (rnd() < 0.6) put(k, rnd() < 0.5 ? 'tuft' : pick4(rnd), (rnd() < 0.5 ? -1 : 1) * R(1.1, 1.9));
      if (rnd() < 0.25) put(k, rnd() < 0.6 ? 'tuft' : pick4(rnd), (rnd() < 0.5 ? -1 : 1) * R(1.9, 2.15));
      if (s.fl === -1 && rnd() < 0.2) put(k, pick4(rnd), -R(2.2, 5));
      if (s.fr === -1 && rnd() < 0.2) put(k, pick4(rnd), R(2.2, 5));
    }
    for (let k = 15; k < N; k += Math.floor(R(7, 20))) {
      const side = rnd() < 0.5 ? -1 : 1;
      const t = rnd();
      put(k, t < 0.45 ? 'tree' : t < 0.65 ? 'tree2' : t < 0.82 ? 'cypress' : 'bush', side * R(1.95, 2.4));
    }
    for (let k = 60; k < N; k += Math.floor(R(80, 180))) put(k, rnd() < 0.5 ? 'barn' : 'cottage', (rnd() < 0.5 ? -1 : 1) * R(3.5, 5.5));
    for (let k = 200; k < N; k += Math.floor(R(260, 420))) put(k, 'windmill', (rnd() < 0.5 ? -1 : 1) * R(6, 9));
    for (let k = 25; k < N; k += Math.floor(R(30, 60))) put(k, 'tree', (rnd() < 0.5 ? -1 : 1) * R(5, 9));
  }
  // nothing directly at the start line clutter: fine.
}
function pick4(rnd) { const r = rnd(); return r < 0.3 ? 'flowerP' : r < 0.55 ? 'flowerY' : r < 0.8 ? 'flowerW' : 'flowerV'; }

function findSegment(z) { return segments[Math.floor(z / SEG) % segments.length]; }

// ============================================================ drawing helpers
const OUT = '#5b6f7a';
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU); }
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function fillStroke(g, fill, stroke = null, lw = 2) {
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
}
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); }

// ============================================================ procedural sprites (pre-rendered)
const SPR = {};
function mk(name, w, h, worldH, fn, k = 3) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
  const g = c.getContext('2d');
  g.scale(k, k); g.translate(w / 2, h - 1);
  fn(g);
  SPR[name] = { img: c, w, h, worldH, worldW: worldH * w / h };
}
const SOFT = 'rgba(70,95,85,0.45)';

function flower(g, x, y, r, petal, center = '#ffd84d') {
  g.fillStyle = petal;
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; circ(g, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r * 0.75); g.fill(); }
  g.fillStyle = center; circ(g, x, y, r * 0.6); g.fill();
}
function flowerClump(petals) {
  return g => {
    g.strokeStyle = '#5fae55'; g.lineWidth = 2; g.lineCap = 'round';
    const heads = [[-20, -22], [-6, -32], [10, -25], [22, -16], [0, -14], [-28, -12]];
    for (const [x, y] of heads) { g.beginPath(); g.moveTo(x * 0.6, 0); g.quadraticCurveTo(x * 0.8, y * 0.5, x, y); g.stroke(); }
    g.fillStyle = '#74bf5f';
    ell(g, -12, -6, 12, 5, -0.4); g.fill(); ell(g, 12, -6, 12, 5, 0.4); g.fill();
    heads.forEach(([x, y], i) => flower(g, x, y, 5.2, petals[i % petals.length], petals === WHITE ? '#ffcf3a' : '#fff6c4'));
  };
}
const WHITE = ['#ffffff'];

function buildSprites() {
  // ---- small ground stuff
  mk('tuft', 60, 40, 210, g => {
    const blades = [[-22, -18, '#7cc566'], [-12, -30, '#6dbb5a'], [-2, -36, '#86cf6c'], [8, -28, '#6dbb5a'], [18, -20, '#7cc566'], [26, -12, '#86cf6c']];
    for (const [x, y, c] of blades) {
      g.fillStyle = c; g.beginPath(); g.moveTo(x - 6, 0); g.quadraticCurveTo(x - 2, y * 0.6, x + y * -0.15, y); g.quadraticCurveTo(x + 2, y * 0.5, x + 6, 0); g.closePath(); g.fill();
    }
  });
  mk('tuftS', 60, 40, 230, g => { // dune grass
    const blades = [[-20, -26], [-8, -36], [4, -30], [14, -38], [24, -22]];
    g.strokeStyle = '#9cc46a'; g.lineWidth = 3; g.lineCap = 'round';
    for (const [x, y] of blades) { g.beginPath(); g.moveTo(x * 0.4, 0); g.quadraticCurveTo(x * 0.7, y * 0.5, x, y); g.stroke(); }
  });
  mk('flowerP', 70, 44, 230, flowerClump(['#ff8fb1', '#ff9fc0', '#ffb3cd']));
  mk('flowerY', 70, 44, 230, flowerClump(['#ffd84d', '#ffcc33', '#ffe27a']));
  mk('flowerW', 70, 44, 230, flowerClump(WHITE));
  mk('flowerV', 70, 44, 230, flowerClump(['#b896ff', '#a88cf0', '#ff8fb1']));
  mk('shell', 40, 26, 110, g => {
    g.beginPath(); g.moveTo(-14, 0); g.quadraticCurveTo(-16, -20, 0, -22); g.quadraticCurveTo(16, -20, 14, 0); g.closePath();
    fillStroke(g, '#ffc2c8', '#e89aa4', 2);
    g.strokeStyle = '#e89aa4'; g.lineWidth = 1.5;
    for (const x of [-7, 0, 7]) { g.beginPath(); g.moveTo(x * 0.4, -1); g.lineTo(x, -18); g.stroke(); }
  });
  mk('star', 40, 26, 110, g => {
    g.save(); g.scale(1, 0.55); g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 7 : 17; g.lineTo(Math.cos(a) * r, -20 + Math.sin(a) * r); }
    g.closePath(); fillStroke(g, '#ff9d6b', '#e9784a', 2.4); g.restore();
  });
  mk('rock', 90, 56, 330, g => {
    g.beginPath(); g.moveTo(-42, 0); g.quadraticCurveTo(-44, -30, -18, -44); g.quadraticCurveTo(8, -56, 28, -38); g.quadraticCurveTo(46, -22, 42, 0); g.closePath();
    fillStroke(g, '#b8c6cc', SOFT, 2.2);
    g.fillStyle = '#d3dee2'; ell(g, -10, -36, 14, 6, -0.3); g.fill();
  });
  mk('bush', 130, 76, 520, g => {
    g.fillStyle = '#5fae5f';
    for (const [x, y, r] of [[-38, -26, 26], [38, -26, 26], [-12, -40, 32], [16, -42, 30]]) { circ(g, x, y, r); g.fill(); }
    g.fillStyle = '#78c46e';
    for (const [x, y, r] of [[-36, -30, 20], [34, -30, 20], [-12, -46, 24], [16, -48, 22]]) { circ(g, x, y, r); g.fill(); }
    g.fillStyle = '#92d683'; ell(g, -16, -58, 10, 6); g.fill(); ell(g, 18, -60, 9, 5); g.fill();
    flower(g, -30, -38, 3.5, '#ff8fb1'); flower(g, 22, -30, 3.5, '#ffffff'); flower(g, 0, -56, 3.5, '#ff8fb1');
  });
  // ---- trees
  mk('palm', 230, 270, 2300, g => {
    g.beginPath(); g.moveTo(-10, 0); g.quadraticCurveTo(-4, -120, 22, -210); g.lineTo(34, -208); g.quadraticCurveTo(10, -120, 10, 0); g.closePath();
    fillStroke(g, '#d39d5f', SOFT, 2);
    g.strokeStyle = '#b37d45'; g.lineWidth = 2;
    for (let i = 1; i < 12; i++) { const t = i / 12, y = -t * 205, x = lerp(0, 28, t * t); g.beginPath(); g.moveTo(x - 9 + t * 2, y); g.quadraticCurveTo(x, y + 4, x + 9 - t * 2, y); g.stroke(); }
    const top = [28, -212];
    const leaves = [[-2.9, 95], [-2.4, 100], [-1.85, 80], [-1.25, 82], [-0.7, 100], [-0.2, 95], [-1.55, 70]];
    leaves.forEach(([a, L], i) => {
      const ex = top[0] + Math.cos(a) * L, ey = top[1] + Math.sin(a) * L * 0.75 + (Math.abs(Math.cos(a)) * 38);
      const mx = top[0] + Math.cos(a) * L * 0.5, my = top[1] + Math.sin(a) * L * 0.5 - 18;
      const nx = -Math.sin(a) * 14, ny = Math.cos(a) * 14;
      g.beginPath(); g.moveTo(top[0], top[1]);
      g.quadraticCurveTo(mx + nx, my + ny, ex, ey);
      g.quadraticCurveTo(mx - nx * 0.4, my - ny * 0.4 - 10, top[0], top[1]); g.closePath();
      fillStroke(g, i % 2 ? '#5dbb6c' : '#47a85c', SOFT, 1.6);
    });
    g.fillStyle = '#8a5a32'; for (const [x, y] of [[22, -204], [33, -202], [27, -196]]) { circ(g, x, y, 6); g.fill(); }
  });
  const roundTree = (main, light, dark, fruit) => g => {
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(-6, -95); g.lineTo(6, -95); g.lineTo(10, 0); g.closePath(); fillStroke(g, '#a77a4e', SOFT, 2);
    g.strokeStyle = '#a77a4e'; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, -70); g.lineTo(-22, -100); g.moveTo(0, -80); g.lineTo(20, -108); g.stroke();
    const blobs = [[0, -130, 58], [-42, -105, 40], [42, -105, 40], [-24, -160, 40], [24, -162, 40]];
    g.fillStyle = SOFT; for (const [x, y, r] of blobs) { circ(g, x, y, r + 1.6); g.fill(); }
    g.fillStyle = dark; for (const [x, y, r] of blobs) { circ(g, x, y, r); g.fill(); }
    g.fillStyle = main; for (const [x, y, r] of blobs) { circ(g, x - 3, y - 5, r * 0.88); g.fill(); }
    g.fillStyle = light; for (const [x, y, r] of [[-26, -168, 18], [-46, -116, 14], [6, -150, 20], [30, -170, 12]]) { ell(g, x, y, r, r * 0.7, -0.4); g.fill(); }
    if (fruit) { g.fillStyle = fruit; for (const [x, y] of [[-30, -120], [18, -128], [40, -100], [-8, -98], [-14, -150], [30, -150], [0, -172]]) { circ(g, x, y, 5.5); g.fill(); } }
  };
  mk('tree', 190, 215, 1650, roundTree('#72c36d', '#93d988', '#58a95b'));
  mk('tree2', 190, 215, 1550, roundTree('#86cb63', '#a5df85', '#6aae4f', '#ff8a5c'));
  mk('cypress', 80, 230, 2300, g => {
    g.fillStyle = '#a77a4e'; g.fillRect(-5, -24, 10, 24);
    g.beginPath(); g.moveTo(0, -225); g.bezierCurveTo(34, -170, 36, -60, 0, -20); g.bezierCurveTo(-36, -60, -34, -170, 0, -225); g.closePath();
    fillStroke(g, '#4fa365', SOFT, 2);
    g.beginPath(); g.moveTo(-4, -205); g.bezierCurveTo(-24, -160, -24, -80, -4, -40); g.bezierCurveTo(-12, -100, -12, -160, -4, -205); g.closePath();
    g.fillStyle = '#6dbf78'; g.fill();
  });
  // ---- seaside stuff
  const umbrella = (c1, c2) => g => {
    g.fillStyle = '#ffffff'; rrect(g, -50, -10, 70, 10, 4); g.fill();
    g.fillStyle = c1; rrect(g, -50, -10, 70, 10, 4); g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = '#efe6d4'; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(6, -120); g.stroke();
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + i / n * Math.PI, a1 = Math.PI + (i + 1) / n * Math.PI;
      g.beginPath(); g.moveTo(6, -138);
      g.lineTo(6 + Math.cos(a0) * 70, -112 + Math.sin(a0) * 4);
      g.quadraticCurveTo(6 + Math.cos((a0 + a1) / 2) * 62, -104, 6 + Math.cos(a1) * 70, -112 + Math.sin(a1) * 4);
      g.closePath(); g.fillStyle = i % 2 ? c2 : c1; g.fill();
    }
    g.beginPath(); g.moveTo(-64, -112); g.quadraticCurveTo(6, -170, 76, -112); g.strokeStyle = SOFT; g.lineWidth = 2; g.stroke();
    g.fillStyle = c1; circ(g, 6, -140, 5); g.fill();
  };
  mk('umbrellaR', 160, 160, 1150, umbrella('#ff7b6b', '#ffffff'));
  mk('umbrellaT', 160, 160, 1150, umbrella('#2bb3a6', '#ffffff'));
  mk('hut', 150, 160, 1350, g => {
    g.fillStyle = '#c9965f'; g.fillRect(-46, -20, 6, 20); g.fillRect(40, -20, 6, 20);
    rrect(g, -52, -100, 104, 82, 6); fillStroke(g, '#ffffff', SOFT, 2);
    g.fillStyle = '#7ccfe0'; for (let x = -44; x < 48; x += 20) g.fillRect(x, -98, 10, 78);
    rrect(g, -14, -70, 28, 50, 5); fillStroke(g, '#ffd27a', SOFT, 2);
    poly(g, [-66, -96, 0, -150, 66, -96]); fillStroke(g, '#ff7b6b', SOFT, 2);
    g.fillStyle = '#ffffff'; poly(g, [-40, -100, -26, -100, 0, -134, 0, -150]); g.globalAlpha = 0.3; g.fill(); g.globalAlpha = 1;
  });
  mk('boat', 130, 140, 1000, g => {
    g.beginPath(); g.moveTo(-58, -26); g.lineTo(58, -26); g.quadraticCurveTo(48, -2, 30, 0); g.lineTo(-34, 0); g.quadraticCurveTo(-50, -4, -58, -26); g.closePath();
    fillStroke(g, '#ff7b6b', SOFT, 2);
    g.fillStyle = '#ffffff'; g.fillRect(-50, -20, 100, 5);
    g.strokeStyle = '#8b6a4a'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -26); g.lineTo(0, -134); g.stroke();
    poly(g, [4, -130, 4, -32, 52, -34]); fillStroke(g, '#ffffff', SOFT, 2);
    poly(g, [-4, -112, -4, -34, -40, -36]); fillStroke(g, '#fff2c9', SOFT, 2);
    g.fillStyle = '#2bb3a6'; poly(g, [0, -134, 18, -128, 0, -122]); g.fill();
  });
  mk('lighthouse', 110, 290, 4200, g => {
    g.beginPath(); g.moveTo(-50, 0); g.quadraticCurveTo(-46, -26, -20, -30); g.lineTo(26, -30); g.quadraticCurveTo(50, -22, 50, 0); g.closePath(); fillStroke(g, '#b8c6cc', SOFT, 2);
    poly(g, [-26, -24, 26, -24, 16, -210, -16, -210]); fillStroke(g, '#ffffff', SOFT, 2);
    g.fillStyle = '#ff6b5b';
    for (const [a, b] of [[-60, -95], [-130, -165]]) {
      const wa = 26 - (-a - 24) / 186 * 10, wb = 26 - (-b - 24) / 186 * 10;
      poly(g, [-wa, a, wa, a, wb, b, -wb, b]); g.fill();
    }
    g.fillStyle = '#5b6f7a'; g.fillRect(-22, -214, 44, 6);
    rrect(g, -13, -246, 26, 32, 4); fillStroke(g, '#ffe27a', SOFT, 2);
    g.fillStyle = '#ffffff'; g.globalAlpha = 0.6; g.fillRect(-8, -242, 5, 24); g.globalAlpha = 1;
    poly(g, [-18, -246, 18, -246, 0, -272]); fillStroke(g, '#ff6b5b', SOFT, 2);
    rrect(g, -7, -50, 14, 22, 6); fillStroke(g, '#2bb3a6', null);
  });
  // ---- countryside stuff
  mk('hay', 130, 96, 650, g => {
    g.beginPath(); g.moveTo(-58, 0); g.quadraticCurveTo(-62, -86, 0, -88); g.quadraticCurveTo(62, -86, 58, 0); g.closePath();
    fillStroke(g, '#f2c552', 'rgba(170,120,40,0.55)', 2);
    g.strokeStyle = '#d9a93a'; g.lineWidth = 2;
    for (const y of [-24, -46, -66]) { g.beginPath(); g.moveTo(-54 + (y + 88) * -0.0, y); g.quadraticCurveTo(0, y + 8, 54, y); g.stroke(); }
    g.fillStyle = '#fbe08a'; ell(g, -20, -68, 16, 7, -0.3); g.fill();
  });
  mk('sunflower', 56, 140, 760, g => {
    g.strokeStyle = '#5ca84f'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(4, -60, 0, -110); g.stroke();
    g.fillStyle = '#6dbb5a'; ell(g, -10, -50, 12, 5, 0.5); g.fill(); ell(g, 11, -70, 12, 5, -0.5); g.fill();
    g.fillStyle = '#ffcf33';
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ell(g, Math.cos(a) * 15, -114 + Math.sin(a) * 15, 8, 4, a); g.fill(); }
    g.fillStyle = '#8a5a32'; circ(g, 0, -114, 10); g.fill();
    g.fillStyle = '#a8743f'; circ(g, -3, -117, 4); g.fill();
  });
  mk('cow', 140, 96, 700, g => {
    g.fillStyle = '#ffffff'; g.strokeStyle = SOFT; g.lineWidth = 2;
    for (const x of [-34, -18, 22, 36]) { rrect(g, x - 5, -34, 10, 34, 4); fillStroke(g, '#ffffff', SOFT, 2); g.fillStyle = '#6b5a52'; g.fillRect(x - 5, -6, 10, 6); }
    rrect(g, -50, -72, 96, 44, 22); fillStroke(g, '#ffffff', SOFT, 2);
    g.fillStyle = '#4b4f57'; ell(g, -24, -56, 13, 10, 0.3); g.fill(); ell(g, 18, -60, 10, 8); g.fill(); ell(g, 0, -40, 7, 5); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(-50, -62); g.quadraticCurveTo(-62, -52, -58, -34); g.stroke();
    // head
    rrect(g, 36, -92, 34, 36, 14); fillStroke(g, '#ffffff', SOFT, 2);
    rrect(g, 38, -70, 32, 18, 9); fillStroke(g, '#ffb8c0', SOFT, 2);
    g.fillStyle = '#5b4a45'; circ(g, 47, -62, 2.2); g.fill(); circ(g, 61, -62, 2.2); g.fill();
    circ(g, 46, -80, 3); g.fill(); circ(g, 61, -80, 3); g.fill();
    g.fillStyle = '#fff3c4'; poly(g, [38, -90, 32, -102, 44, -94]); g.fill(); poly(g, [68, -90, 74, -102, 62, -94]); g.fill();
  });
  mk('barn', 230, 200, 2600, g => {
    rrect(g, -90, -110, 180, 110, 4); fillStroke(g, '#ef6b5a', SOFT, 2);
    poly(g, [-104, -104, -70, -160, 70, -160, 104, -104]); fillStroke(g, '#b9564a', SOFT, 2);
    g.fillStyle = '#ffffff'; g.fillRect(-104, -110, 208, 7);
    rrect(g, -30, -80, 60, 80, 2); fillStroke(g, '#ffffff', null);
    g.fillStyle = '#ef6b5a'; g.fillRect(-25, -75, 50, 75);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.beginPath(); g.moveTo(-25, -75); g.lineTo(25, 0); g.moveTo(25, -75); g.lineTo(-25, 0); g.stroke();
    rrect(g, -14, -142, 28, 22, 3); fillStroke(g, '#fff3dc', '#ffffff', 3);
    g.fillStyle = '#fff3dc'; for (const x of [-70, 52]) { rrect(g, x, -84, 18, 18, 2); g.fill(); }
  });
  mk('cottage', 210, 190, 2200, g => {
    g.fillStyle = '#d98b6a'; g.fillRect(36, -160, 18, 40);
    rrect(g, -78, -96, 156, 96, 4); fillStroke(g, '#fff3dc', SOFT, 2);
    poly(g, [-94, -90, 0, -166, 94, -90]); fillStroke(g, '#f08a4b', SOFT, 2);
    rrect(g, -14, -58, 28, 58, 10); fillStroke(g, '#2bb3a6', SOFT, 2);
    g.fillStyle = '#ffd84d'; circ(g, 8, -28, 2.5); g.fill();
    for (const x of [-60, 32]) { rrect(g, x, -70, 28, 26, 3); fillStroke(g, '#bfe6f5', SOFT, 2); g.fillStyle = '#ff8fb1'; rrect(g, x - 2, -44, 32, 7, 3); g.fill(); }
    circ(g, 0, -116, 10); fillStroke(g, '#bfe6f5', SOFT, 2);
  });
  mk('windmill', 200, 300, 4200, g => {
    poly(g, [-30, 0, 30, 0, 18, -170, -18, -170]); fillStroke(g, '#f6ecd9', SOFT, 2);
    rrect(g, -10, -40, 20, 40, 8); fillStroke(g, '#c08a5c', SOFT, 2);
    circ(g, 0, -120, 9); fillStroke(g, '#bfe6f5', SOFT, 2);
    poly(g, [-24, -168, 24, -168, 0, -200]); fillStroke(g, '#ef6b5a', SOFT, 2);
    g.save(); g.translate(0, -178);
    for (let i = 0; i < 4; i++) {
      g.rotate(TAU / 4 + 0.35 * (i === 0));
      rrect(g, -7, -95, 14, 88, 3); fillStroke(g, '#ffffff', SOFT, 1.8);
      g.strokeStyle = '#d9cbb3'; g.lineWidth = 1.5; for (let y = -88; y < -12; y += 12) { g.beginPath(); g.moveTo(-7, y); g.lineTo(7, y); g.stroke(); }
    }
    g.restore(); circ(g, 0, -178, 6); fillStroke(g, '#5b6f7a', null);
  });
}

// ============================================================ background
const bgOff = { sky: 0, far: 0, near: 0 };
const clouds = (() => { const r = rng(42), a = []; for (let i = 0; i < 9; i++) a.push({ u: r(), y: 0.12 + r() * 0.5, s: 0.6 + r() * 0.8, v: 0.002 + r() * 0.004 }); return a; })();
const birds = (() => { const r = rng(7), a = []; for (let i = 0; i < 4; i++) a.push({ u: r(), y: 0.25 + r() * 0.35, ph: r() * 6, s: 0.6 + r() * 0.5 }); return a; })();

// periodic noise for parallax hills: u in [0,1) wraps
function hillNoise(u, seed, oct) {
  let v = 0, a = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const f = (i + 1) * 2 + ((seed * (i + 3)) % 3);
    v += Math.sin(u * TAU * f + seed * 1.7 + i * 2.1) * a; n += a; a *= 0.55;
  }
  return v / n; // -1..1
}
function hillLayer(off, baseY, amp, color, seed, oct, mode = 0) {
  ctx.beginPath(); ctx.moveTo(-2, H + 2);
  const step = Math.max(4, W / 160);
  for (let x = -2; x <= W + step; x += step) {
    const u = x / (W * 1.6) + off;
    let n = hillNoise(u, seed, oct);
    if (mode === 1) n = Math.max(0, n - 0.15) * 2.2 - 0.02; // islands on the sea
    else n = 0.5 + 0.5 * n;
    ctx.lineTo(x, baseY - n * amp);
  }
  ctx.lineTo(W + step, H + 2); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
}
function drawCloud(x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.fillStyle = '#e7f3f8';
  rrect(ctx, -62, -8, 124, 26, 13); ctx.fill();
  ctx.fillStyle = '#ffffff';
  circ(ctx, -30, -6, 22); ctx.fill(); circ(ctx, 2, -20, 30); ctx.fill(); circ(ctx, 34, -4, 20); ctx.fill();
  rrect(ctx, -60, -10, 118, 24, 12); ctx.fill();
  ctx.restore();
}
function drawSun(x, y, r, t) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(255,236,150,0.35)'; circ(ctx, 0, 0, r * 1.7); ctx.fill();
  ctx.rotate(t * 0.15);
  ctx.fillStyle = '#ffe680';
  for (let i = 0; i < 12; i++) { ctx.rotate(TAU / 12); rrect(ctx, -r * 0.12, -r * 1.55, r * 0.24, r * 0.38, r * 0.12); ctx.fill(); }
  ctx.rotate(-t * 0.15);
  circ(ctx, 0, 0, r); fillStroke(ctx, '#ffd84d', '#f5bf3c', Math.max(1.5, r * 0.06));
  // face
  ctx.strokeStyle = '#8a5a32'; ctx.lineWidth = Math.max(1.5, r * 0.08); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(-r * 0.33, -r * 0.08, r * 0.13, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(r * 0.33, -r * 0.08, r * 0.13, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, r * 0.12, r * 0.3, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
  ctx.fillStyle = 'rgba(255,140,120,0.55)'; ell(ctx, -r * 0.55, r * 0.22, r * 0.15, r * 0.09); ctx.fill(); ell(ctx, r * 0.55, r * 0.22, r * 0.15, r * 0.09); ctx.fill();
  ctx.restore();
}
function drawBackground(t) {
  const r = route;
  const g = ctx.createLinearGradient(0, 0, 0, HY);
  g.addColorStop(0, r.skyTop); g.addColorStop(1, r.skyBot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, HY + 2);
  const m = Math.min(W, H);
  // sun (very slow parallax)
  // clouds
  for (const c of clouds) {
    const u = (((c.u - bgOff.sky * 1.5 + t * c.v * 0.2) % 1) + 1) % 1;
    drawCloud(u * (W + 300) - 150, HY * c.y, c.s * m / 700);
  }
  const sx = (((0.72 - bgOff.sky * 0.6) % 1) + 1) % 1 * (W * 1.4) - W * 0.2;
  drawSun(sx, HY * 0.3, m * 0.07, t);
  // birds
  ctx.strokeStyle = '#6f8792'; ctx.lineWidth = Math.max(1.2, m / 400); ctx.lineCap = 'round';
  for (const b of birds) {
    const u = (((b.u - bgOff.sky * 1.2 + t * 0.006) % 1) + 1) % 1;
    const x = u * (W + 100) - 50, y = HY * b.y + Math.sin(t + b.ph) * 4, s = b.s * m / 60, f = Math.sin(t * 5 + b.ph) * 0.4;
    ctx.beginPath(); ctx.moveTo(x - s, y - s * (0.3 + f)); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.5, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.5, x + s, y - s * (0.3 + f)); ctx.stroke();
  }
  const hs = Math.min(H / 720, W / 700);
  if (r.key === 'sea') {
    // open sea to the horizon
    const sg = ctx.createLinearGradient(0, HY - 4, 0, H);
    sg.addColorStop(0, '#9ad6ee'); sg.addColorStop(0.08, r.seaFar); sg.addColorStop(1, r.sea[1]);
    // distant islands/headlands sit on the horizon line
    hillLayer(bgOff.far, HY + 1, 60 * hs, '#b7dcc9', 3, 3, 1);
    hillLayer(bgOff.near + 0.37, HY + 1, 44 * hs, '#98cfae', 11, 3, 1);
    ctx.fillStyle = sg; ctx.fillRect(0, HY, W, H - HY);
    // sparkles
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const rr = rng(5);
    for (let i = 0; i < 28; i++) {
      const u = (((rr() - bgOff.near * 1.3) % 1) + 1) % 1, y = HY + 3 + rr() * rr() * 26 * hs;
      const a = 0.5 + 0.5 * Math.sin(t * 2.5 + i);
      ctx.globalAlpha = a * 0.8; ctx.fillRect(u * W, y, (6 + rr() * 10) * hs, Math.max(1, 1.5 * hs));
    }
    ctx.globalAlpha = 1;
  } else {
    hillLayer(bgOff.far, HY + 2, 95 * hs, '#bcdcd0', 5, 3);
    hillLayer(bgOff.near, HY + 2, 55 * hs, '#a6d68f', 9, 4);
    // little tree dots on the near hills
    ctx.fillStyle = '#86c475';
    for (let i = 0; i < 24; i++) {
      const u0 = i / 24 + 0.013 * i;
      const x = ((((u0 - bgOff.near) % 1) + 1) % 1) * W * 1.6;
      if (x > W + 10) continue;
      const u = x / (W * 1.6) + bgOff.near;
      const y = HY + 2 - (0.5 + 0.5 * hillNoise(u, 9, 4)) * 55 * hs;
      ell(ctx, x, y - 4 * hs, 5 * hs, 6 * hs); ctx.fill();
    }
    ctx.fillStyle = '#a6d68f'; ctx.fillRect(0, HY, W, H - HY);
  }
}

// ============================================================ road rendering
function project(p, camX, camY, camZ) {
  p.camera.x = -camX;
  p.camera.y = p.world.y - camY;
  p.camera.z = p.world.z - camZ;
  const sc = CAM_DEPTH / p.camera.z;
  p.screen.scale = sc;
  p.screen.x = Math.round((W / 2 + sc * p.camera.x * S / 2) * DPR) / DPR;
  p.screen.y = Math.round((HY - sc * p.camera.y * S / 2) * DPR) / DPR;
  p.screen.w = sc * ROAD_W * S / 2;
}
function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
// a band between offsets a..b (road half-widths, negative = left)
function band(p1, p2, a, b, color) {
  quad(p1.x + p1.w * a, p1.y, p1.x + p1.w * b, p1.y, p2.x + p2.w * b, p2.y, p2.x + p2.w * a, p2.y, color);
}

function renderSegment(seg, t) {
  const r = route, p1 = seg.p1.screen, p2 = seg.p2.screen;
  const alt = Math.floor(seg.index / RUMBLE) % 2;
  const y1 = p1.y, y2 = p2.y; // y already snapped to device pixels -> no seams
  const P1 = { x: p1.x, y: y1, w: p1.w }, P2 = { x: p2.x, y: y2, w: p2.w };
  ctx.fillStyle = r.grass[alt]; ctx.fillRect(0, y2, W, y1 - y2);
  if (r.key === 'sea') {
    const i = seg.index;
    const w1 = 0.07 * Math.sin(i * 0.35 + t * 1.6), w2 = 0.07 * Math.sin((i + 1) * 0.35 + t * 1.6);
    const s1 = shoreAt(i) + w1, s2 = shoreAt(i + 1) + w2;
    // sand from shore to right dunes
    quad(p1.x - p1.w * s1, y1, p1.x + p1.w * 1.25, y1, p2.x + p2.w * 1.25, y2, p2.x - p2.w * s2, y2, r.sand[alt]);
    // sea (left of the shoreline, out to the screen edge)
    const sx1 = p1.x - p1.w * s1, sx2 = p2.x - p2.w * s2, left = Math.min(-10, sx1, sx2) - 1;
    quad(left, y1, sx1, y1, sx2, y2, left, y2, r.sea[(i >> 2) % 2]);
    // wet sand + foam
    quad(sx1, y1, sx1 + p1.w * 0.22, y1, sx2 + p2.w * 0.22, y2, sx2, y2, '#ecd29a');
    quad(sx1 - p1.w * 0.06, y1, sx1 + p1.w * 0.07, y1, sx2 + p2.w * 0.07, y2, sx2 - p2.w * 0.06, y2, 'rgba(255,255,255,0.92)');
    if (i % 9 === 0) quad(sx1 - p1.w * 0.9, y1, sx1 - p1.w * 0.5, y1, sx2 - p2.w * 0.5, y2, sx2 - p2.w * 0.9, y2, 'rgba(255,255,255,0.45)');
  } else {
    const f = r.fields, a2 = seg.index % 2;
    if (seg.fl >= 0) band(P1, P2, -40, -2.3, f[seg.fl][a2]);
    if (seg.fr >= 0) band(P1, P2, 2.3, 40, f[seg.fr][a2]);
  }
  // path: soft edge, path, wheel tracks
  band(P1, P2, -1.1, 1.1, r.rumble[alt]);
  band(P1, P2, -1.0, 1.0, r.road[alt]);
  band(P1, P2, -0.42, -0.34, r.track);
  band(P1, P2, 0.34, 0.42, r.track);
  if (seg.fog > 0.01) { ctx.globalAlpha = seg.fog; ctx.fillStyle = r.haze; ctx.fillRect(0, y2, W, y1 - y2); ctx.globalAlpha = 1; }
}

function drawSprite(sp, seg) {
  const s = SPR[sp.anim ? sp.anim + (Math.floor(t * 2.4 + sp.ph) % 2) : sp.name]; if (!s) return;
  const p = seg.p1.screen;
  const destH = s.worldH * p.scale * S / 2;
  if (destH < 0.8) return;
  const destW = destH * s.w / s.h;
  const x = p.x + p.w * sp.offset - destW / 2;
  const y = p.y - destH;
  const clipY = seg.clip;
  const clipH = Math.max(0, y + destH - clipY);
  if (clipH >= destH) return;
  if (x > W || x + destW < 0) return;
  const frac = 1 - clipH / destH;
  ctx.drawImage(s.img, 0, 0, s.img.width, s.img.height * frac, x, y, destW, destH * frac);
}
function drawFence(seg, side) {
  const p1 = seg.p1.screen, p2 = seg.p2.screen;
  const off = 1.38 * side;
  const h1 = 380 * p1.scale * S / 2, h2 = 380 * p2.scale * S / 2;
  const x1 = p1.x + p1.w * off, x2 = p2.x + p2.w * off;
  if (p1.y - h1 > seg.clip) return;
  for (const k of [0.82, 0.45]) {
    const t1 = h1 * 0.07, t2 = h2 * 0.07;
    quad(x1, p1.y - h1 * k - t1, x2, p2.y - h2 * k - t2, x2, p2.y - h2 * k + t2, x1, p1.y - h1 * k + t1, '#f6e7c8');
    quad(x1, p1.y - h1 * k + t1 * 0.4, x2, p2.y - h2 * k + t2 * 0.4, x2, p2.y - h2 * k + t2, x1, p1.y - h1 * k + t1, '#d7b98b');
  }
  if (seg.index % 2 === 0) {
    const pw = Math.max(1, h1 * 0.11);
    ctx.fillStyle = '#c9a676'; ctx.fillRect(x1 - pw / 2 - Math.max(0.5, pw * 0.1), p1.y - h1 - 1, pw * 1.2, h1 + 1);
    ctx.fillStyle = '#fbefd6'; ctx.fillRect(x1 - pw / 2, p1.y - h1, pw, h1);
    ctx.beginPath(); ctx.moveTo(x1 - pw / 2, p1.y - h1); ctx.lineTo(x1, p1.y - h1 - pw * 0.6); ctx.lineTo(x1 + pw / 2, p1.y - h1); ctx.fill();
  }
}

let position = 0, playerX = 0, speed = 0, playerY = 0;
function renderRoad(t) {
  const base = findSegment(position);
  const basePct = (position % SEG) / SEG;
  const pSeg = findSegment(position + PLAYER_Z);
  const pPct = ((position + PLAYER_Z) % SEG) / SEG;
  playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);
  let maxy = H, x = 0, dx = -(base.curve * basePct);
  const camY = playerY + CAM_H;
  const n0 = base.index, N = segments.length;
  for (let n = 0; n < DRAW_DIST; n++) {
    const seg = segments[(n0 + n) % N];
    const looped = seg.index < n0;
    const camZ = position - (looped ? trackLength : 0);
    seg.clip = maxy; seg.vis = false;
    const d = n / DRAW_DIST;
    seg.fog = 1 - Math.exp(-d * d * 4.5);
    project(seg.p1, playerX * ROAD_W - x, camY, camZ);
    project(seg.p2, playerX * ROAD_W - x - dx, camY, camZ);
    x += dx; dx += seg.curve;
    if (seg.p1.camera.z <= CAM_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) {
      if (seg.p1.camera.z > CAM_DEPTH) seg.vis = true; // may still own sprites peeking over a crest
      continue;
    }
    seg.vis = true;
    renderSegment(seg, t);
    maxy = seg.p1.screen.y;
  }
  // sprites + fences, back to front
  for (let n = DRAW_DIST - 1; n > 0; n--) {
    const seg = segments[(n0 + n) % N];
    if (!seg.vis) continue;
    const a = 1 - seg.fog * 0.85;
    ctx.globalAlpha = a;
    if (seg.fence & 1) drawFence(seg, -1);
    if (seg.fence & 2) drawFence(seg, 1);
    for (const sp of seg.sprites) drawSprite(sp, seg);
    if (seg.items) for (const it of seg.items) if (!it.taken) drawItem(it, seg);
    if (seg.arch) drawArch(seg);
  }
  ctx.globalAlpha = 1;
  return pSeg;
}

// ============================================================ journey: landmarks, arches, collectibles
const LANDMARKS = {
  sea: [
    { id: 'icecream', name: '冰淇淋小摊', frac: 0.18 },
    { id: 'volley', name: '沙滩排球场', frac: 0.40 },
    { id: 'pier', name: '码头', frac: 0.62 },
    { id: 'lighthouse', name: '灯塔', frac: 0.85 },
  ],
  field: [
    { id: 'sunflower', name: '向日葵田', frac: 0.18 },
    { id: 'barn', name: '红谷仓', frac: 0.40 },
    { id: 'windmill', name: '风车', frac: 0.62 },
    { id: 'orchard', name: '苹果园', frac: 0.85 },
  ],
};
const lmIndex = lm => Math.round(lm.frac * JOURNEY);
const ZONE_BEFORE = 62, ZONE_AFTER = -3;       // photo zone: while the landmark is ahead of you       // photo zone around a landmark (segments)
const SMALL_SPRITES = new Set(['tuft', 'tuftS', 'flowerP', 'flowerY', 'flowerW', 'flowerV', 'shell', 'star']);
// collision widths (world units) for roadside things you can bump into
const SOLID_W = {
  palm: 230, tree: 270, tree2: 270, cypress: 300, bush: 520, umbrellaR: 220, umbrellaT: 220, hut: 1200, rock: 460,
  hay: 760, cow: 760, barn: 2600, cottage: 2100, lighthouse: 1100, windmill: 1400, icecream: 1050, volley: 1500,
  applecart: 850, sunflower: 170, balloons: 260,
};
const solidW = sp => (sp.anim ? 0 : (SOLID_W[sp.name] || (sp.name.startsWith('sign_') ? 220 : 0)));

function putAnim(i, anim, offset, ph = 0) {
  if (i < 0 || i >= segments.length) return;
  segments[i].sprites.push({ name: anim + '0', anim, offset, ph });
}
function clearAround(i0, i1) {
  for (let i = Math.max(0, i0); i <= Math.min(segments.length - 1, i1); i++)
    segments[i].sprites = segments[i].sprites.filter(sp => SMALL_SPRITES.has(sp.name) && Math.abs(sp.offset) > 1.15);
}
function placeJourney(r, rnd) {
  const R = (a, b) => a + rnd() * (b - a);
  // start + finish arches
  clearAround(START_IDX - 6, START_IDX + 6); segments[START_IDX].arch = 'start';
  clearAround(JOURNEY - 10, JOURNEY + 10); segments[JOURNEY].arch = 'finish';
  for (const k of [-6, -3, 3]) { put(JOURNEY + k, 'balloons', -1.45); put(JOURNEY + k, 'balloons', 1.45); }
  const local = r.key === 'sea' ? 'localS' : 'localF';
  for (const lm of LANDMARKS[r.key]) {
    const i = lmIndex(lm);
    clearAround(i - 16, i + 16);
    const side = (lm.id === 'volley' || lm.id === 'pier' || lm.id === 'windmill') ? -1 : 1;
    clearAround(i - ZONE_BEFORE + 6, i - ZONE_BEFORE + 10);
    put(i - ZONE_BEFORE + 8, 'sign_' + lm.id, side * 1.32);
    switch (lm.id) {
      case 'icecream':
        put(i, 'icecream', 1.95); put(i + 4, 'umbrellaR', 2.7); put(i - 6, 'umbrellaT', 2.9);
        putAnim(i - 3, local, 1.35, 0); putAnim(i + 2, local, 2.45, 1);
        break;
      case 'volley':
        put(i, 'volley', -2.0); putAnim(i - 4, local, -1.35, 0); putAnim(i + 1, local, -2.6, 1);
        break;
      case 'pier':
        put(i, 'pier', -(shoreAt(i) + 1.15)); put(i + 8, 'boat', -(shoreAt(i + 8) + 3.2));
        putAnim(i - 2, local, -1.35, 1);
        break;
      case 'lighthouse':
        put(i, 'lighthouse', 2.45); put(i + 3, 'rock', 1.85); put(i - 4, 'rock', 3.2);
        putAnim(i - 5, local, 1.35, 0);
        break;
      case 'sunflower':
        for (let k = i - 70; k < i + 24; k += 2) {
          segments[k].fr = 1;
          put(k, 'sunflower', R(2.12, 2.35)); put(k + 1, 'sunflower', R(2.6, 2.9)); put(k, 'sunflower', R(3.1, 3.5));
          if (k % 4 === 0) put(k, 'sunflower', -R(2.15, 2.4));
        }
        putAnim(i - 3, local, -1.35, 0);
        break;
      case 'barn':
        put(i, 'barn', 3.1); put(i + 5, 'hay', 2.35); put(i - 6, 'hay', 4.2); put(i - 2, 'cow', -2.5);
        putAnim(i - 4, local, 1.35, 1);
        break;
      case 'windmill':
        put(i, 'windmill', -3.2); put(i + 6, 'hay', -2.4); putAnim(i - 3, local, 1.35, 0);
        break;
      case 'orchard':
        for (let k = i - 56; k < i + 24; k += 7) { put(k, 'tree2', -2.2); put(k + 3, 'tree2', 2.25); put(k + 1, 'tree2', -3.3); put(k + 4, 'tree2', 3.4); }
        put(i, 'applecart', 1.62); putAnim(i - 2, local, 1.38, 1);
        break;
    }
  }
  // collectibles on the path: short lines of golden shells (seaside) / coins (countryside)
  for (let i = START_IDX + 45; i < JOURNEY - 40; i += Math.floor(R(70, 125))) {
    const n = 3 + Math.floor(rnd() * 3), o0 = R(-0.55, 0.55), d = R(-0.12, 0.12);
    for (let k = 0; k < n; k++) {
      const s = segments[i + k * 3];
      (s.items || (s.items = [])).push({ offset: clamp(o0 + d * k, -0.72, 0.72), taken: false });
    }
  }
}

function drawItem(it, seg) {
  const s = SPR[route.key === 'sea' ? 'gshell' : 'coin'];
  const p = seg.p1.screen;
  const dh = s.worldH * p.scale * S / 2;
  if (dh < 1.2) return;
  const dw = dh * s.w / s.h;
  const spin = route.key === 'field' ? 0.18 + 0.82 * Math.abs(Math.cos(t * 3 + seg.index * 0.4)) : 1;
  const bob = (0.5 + 0.5 * Math.sin(t * 4 + seg.index)) * dh * 0.22;
  const x = p.x + p.w * it.offset, y = p.y - dh * 1.15 - bob;
  if (y + dh > seg.clip + 2) return;
  ctx.fillStyle = 'rgba(80,90,60,0.18)'; ell(ctx, x, p.y, dw * 0.32, dw * 0.09); ctx.fill();
  ctx.drawImage(s.img, x - dw * spin / 2, y, dw * spin, dh);
}

function drawArch(seg) {
  const p = seg.p1.screen, k = p.scale * S / 2;
  const half = p.w * 1.3, xl = p.x - half, xr = p.x + half;
  const h = 1750 * k, pw = Math.max(1.5, 110 * k), bh = 340 * k;
  const top = p.y - h;
  if (top > seg.clip || xr < -50 || xl > W + 50) return;
  const fin = seg.arch === 'finish';
  const main = fin ? '#ff7a45' : '#2bb3a6', lw = Math.max(1, 14 * k);
  // posts with stripes
  for (const x of [xl, xr]) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - pw / 2, top, pw, h);
    ctx.fillStyle = main;
    for (let i = 0; i < 6; i++) ctx.fillRect(x - pw / 2, top + bh + i * (h - bh) / 6, pw, (h - bh) / 12);
    // balloons
    const bc = fin ? ['#ffd84d', '#ff8fb1', '#7cc9ea'] : ['#ffd84d', '#ffffff', '#ff8fb1'];
    for (let b = 0; b < 3; b++) {
      const bx = x + (b - 1) * 95 * k, by = top - (150 + (b % 2) * 70) * k + Math.sin(t * 2 + b + x * 0.01) * 12 * k;
      ctx.strokeStyle = 'rgba(90,110,120,0.6)'; ctx.lineWidth = Math.max(0.5, 5 * k);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(bx, by + 70 * k); ctx.stroke();
      ell(ctx, bx, by, 62 * k, 76 * k); fillStroke(ctx, bc[b], null);
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ell(ctx, bx - 20 * k, by - 25 * k, 14 * k, 20 * k); ctx.fill();
    }
  }
  // banner
  rrect(ctx, xl - pw, top, xr - xl + 2 * pw, bh, bh * 0.3);
  fillStroke(ctx, main, '#ffffff', lw);
  if (fin && bh > 8) { // checkered strip
    const n = Math.max(6, Math.floor((xr - xl) / (bh * 0.22))), cw = (xr - xl) / n, cy = top + bh * 0.8;
    for (let i = 0; i < n; i++) { ctx.fillStyle = i % 2 ? '#3d5562' : '#ffffff'; ctx.fillRect(xl + i * cw, cy, cw, bh * 0.11); ctx.fillStyle = i % 2 ? '#ffffff' : '#3d5562'; ctx.fillRect(xl + i * cw, cy + bh * 0.11, cw, bh * 0.09); }
  }
  if (bh > 5) {
    ctx.font = `900 ${Math.round(bh * (fin ? 0.5 : 0.56))}px ${FONT}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fin ? '终 点' : '起 点', p.x, top + bh * (fin ? 0.4 : 0.5));
  }
  // bunting
  const n = 12, by = top + bh + 30 * k, colors = ['#ff7b6b', '#ffd84d', '#2bb3a6', '#ff8fb1', '#7cc9ea'];
  for (let i = 0; i < n; i++) {
    const x0 = lerp(xl, xr, i / n), x1 = lerp(xl, xr, (i + 1) / n);
    const sag = Math.sin((i + 0.5) / n * Math.PI) * 60 * k;
    ctx.fillStyle = colors[i % colors.length];
    poly(ctx, [x0, by + Math.sin(i / n * Math.PI) * 60 * k, x1, by + Math.sin((i + 1) / n * Math.PI) * 60 * k, (x0 + x1) / 2, by + sag + 120 * k]); ctx.fill();
  }
}

function buildJourneySprites() {
  mk('coin', 44, 44, 175, g => {
    circ(g, 0, -22, 19); fillStroke(g, '#ffcf33', '#d99a14', 2.5);
    circ(g, 0, -22, 13); fillStroke(g, '#ffe27a', null);
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4 : 9; g.lineTo(Math.cos(a) * r, -22 + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = '#f2a900'; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; ell(g, -8, -31, 4, 2.5, -0.6); g.fill();
  });
  mk('gshell', 48, 42, 170, g => {
    g.beginPath(); g.moveTo(-20, -8); g.quadraticCurveTo(-24, -36, 0, -38); g.quadraticCurveTo(24, -36, 20, -8); g.quadraticCurveTo(0, -2, -20, -8); g.closePath();
    fillStroke(g, '#ffd451', '#d99a14', 2.4);
    g.strokeStyle = '#e8b030'; g.lineWidth = 2;
    for (const x of [-12, -6, 0, 6, 12]) { g.beginPath(); g.moveTo(x * 0.3, -6); g.lineTo(x * 1.25, -33); g.stroke(); }
    rrect(g, -7, -8, 14, 7, 3); fillStroke(g, '#ffc23a', '#d99a14', 1.6);
    g.fillStyle = 'rgba(255,255,255,0.75)'; ell(g, -9, -27, 4, 2.5, -0.5); g.fill();
  });
  mk('balloons', 70, 150, 1300, g => {
    g.strokeStyle = 'rgba(90,110,120,0.7)'; g.lineWidth = 1.5;
    const bs = [[-16, -118, '#ff8fb1'], [14, -126, '#ffd84d'], [0, -100, '#7cc9ea']];
    for (const [x, y] of bs) { g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(x * 0.5, y * 0.5, x, y + 18); g.stroke(); }
    for (const [x, y, c] of bs) { ell(g, x, y, 15, 19); fillStroke(g, c, SOFT, 1.6); g.fillStyle = 'rgba(255,255,255,0.55)'; ell(g, x - 5, y - 7, 3.5, 5); g.fill(); }
    rrect(g, -6, -8, 12, 8, 2); fillStroke(g, '#c9a676', SOFT, 1.5);
  });
  mk('icecream', 160, 210, 2000, g => {
    for (const x of [-44, 44]) { circ(g, x, -12, 11); fillStroke(g, '#5b6f7a', null); circ(g, x, -12, 5); fillStroke(g, '#c3ccd1', null); }
    rrect(g, -62, -86, 124, 70, 8); fillStroke(g, '#fff3dc', SOFT, 2);
    g.fillStyle = '#ff8fb1'; g.fillRect(-62, -44, 124, 10);
    for (let i = 0; i < 7; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#ff8fb1'; poly(g, [-70 + i * 20, -132, -50 + i * 20, -132, -50 + i * 20, -112, -60 + i * 20, -104, -70 + i * 20, -112]); g.fill(); }
    g.strokeStyle = SOFT; g.lineWidth = 2; g.strokeRect(-70, -132, 140, 20);
    g.fillStyle = '#c9a676'; g.fillRect(-64, -112, 5, 28); g.fillRect(59, -112, 5, 28);
    // giant cone on top
    poly(g, [-18, -150, 18, -150, 0, -132]); fillStroke(g, '#e9b25f', SOFT, 2);
    circ(g, -9, -158, 13); fillStroke(g, '#ff9fc0', SOFT, 2); circ(g, 9, -158, 13); fillStroke(g, '#bfe6f5', SOFT, 2);
    circ(g, 0, -174, 13); fillStroke(g, '#fff6c4', SOFT, 2); circ(g, 0, -190, 4); fillStroke(g, '#ff6b5b', null);
    g.fillStyle = '#3d5562'; g.font = `800 15px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('冰淇淋', 0, -64);
  });
  mk('volley', 230, 130, 1150, g => {
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.5; g.strokeRect(-100, -22, 200, 18);
    for (const x of [-86, 86]) { rrect(g, x - 3, -96, 6, 92, 2); fillStroke(g, '#ffffff', SOFT, 1.5); }
    rrect(g, -86, -94, 172, 30, 2); fillStroke(g, 'rgba(255,255,255,0.25)', '#5b6f7a', 2);
    g.strokeStyle = 'rgba(91,111,122,0.6)'; g.lineWidth = 1;
    for (let x = -80; x < 86; x += 8) { g.beginPath(); g.moveTo(x, -94); g.lineTo(x, -64); g.stroke(); }
    for (let y = -86; y < -64; y += 7) { g.beginPath(); g.moveTo(-86, y); g.lineTo(86, y); g.stroke(); }
    g.fillStyle = '#ffffff'; g.fillRect(-86, -96, 172, 5);
    circ(g, 30, -116, 10); fillStroke(g, '#ffffff', SOFT, 1.5);
    g.strokeStyle = '#ffd84d'; g.lineWidth = 3; g.beginPath(); g.arc(30, -116, 6, 0.3, 2.6); g.stroke();
    g.strokeStyle = '#2bb3a6'; g.beginPath(); g.arc(30, -116, 6, 3.5, 5.6); g.stroke();
  });
  mk('pier', 300, 120, 820, g => {
    g.fillStyle = '#9b7350';
    for (let x = -130; x <= 130; x += 26) g.fillRect(x - 3, -40, 6, 40);
    rrect(g, -140, -48, 280, 12, 3); fillStroke(g, '#c99a66', SOFT, 2);
    g.strokeStyle = '#b07f50'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-140, -66); g.lineTo(100, -66); g.stroke();
    for (let x = -136; x <= 100; x += 24) { g.beginPath(); g.moveTo(x, -48); g.lineTo(x, -66); g.stroke(); }
    // little hut at the end
    rrect(g, 98, -92, 44, 44, 3); fillStroke(g, '#ffffff', SOFT, 2);
    g.fillStyle = '#7ccfe0'; g.fillRect(104, -88, 8, 40); g.fillRect(120, -88, 8, 40);
    poly(g, [92, -90, 120, -114, 148, -90]); fillStroke(g, '#ff7b6b', SOFT, 2);
    g.strokeStyle = '#8b6a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(120, -114); g.lineTo(120, -132); g.stroke();
    g.fillStyle = '#ffd84d'; poly(g, [120, -132, 136, -127, 120, -122]); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; for (let x = -128; x < 130; x += 26) g.fillRect(x - 6, -2, 12, 2);
  });
  mk('applecart', 160, 120, 1000, g => {
    for (const x of [-40, 40]) { circ(g, x, -16, 15); fillStroke(g, '#a77a4e', SOFT, 2); circ(g, x, -16, 5); fillStroke(g, '#7a5532', null); }
    rrect(g, -62, -64, 124, 40, 4); fillStroke(g, '#c99a66', SOFT, 2);
    g.strokeStyle = '#a77a4e'; g.lineWidth = 2; for (const y of [-50, -38]) { g.beginPath(); g.moveTo(-62, y); g.lineTo(62, y); g.stroke(); }
    for (let i = 0; i < 9; i++) { circ(g, -48 + i * 12, -68 - (i % 2) * 6, 8); fillStroke(g, i % 3 ? '#ff6b5b' : '#9bd46a', SOFT, 1.4); }
    circ(g, -6, -82, 8); fillStroke(g, '#ff6b5b', SOFT, 1.4); circ(g, 8, -80, 8); fillStroke(g, '#ff6b5b', SOFT, 1.4);
    rrect(g, -30, -112, 60, 20, 4); fillStroke(g, '#fff3dc', SOFT, 1.6);
    g.strokeStyle = '#a77a4e'; g.beginPath(); g.moveTo(0, -92); g.lineTo(0, -84); g.stroke();
    g.fillStyle = '#e8604c'; g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('苹果', 0, -102);
  });
  for (const key of Object.keys(LANDMARKS)) for (const lm of LANDMARKS[key]) {
    mk('sign_' + lm.id, 140, 120, 760, g => {
      g.fillStyle = '#a77a4e'; g.fillRect(-4, -70, 8, 70);
      rrect(g, -62, -112, 124, 46, 9); fillStroke(g, '#fff6e2', key === 'sea' ? '#2bb3a6' : '#6dbb4f', 4);
      g.fillStyle = '#3d5562'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 22; g.font = `900 ${fs}px ${FONT}`;
      while (g.measureText(lm.name).width > 104 && fs > 12) { fs--; g.font = `900 ${fs}px ${FONT}`; }
      g.fillText(lm.name, 0, -92);
      g.fillStyle = '#ff7a45'; g.font = `700 10px ${FONT}`; g.fillText('拍照点', 0, -74);
    });
  }
  // waving locals: 2 frames each
  const person = (hat, shirt, stripe, pants, f) => g => {
    // legs
    g.fillStyle = pants; rrect(g, -12, -34, 10, 34, 4); g.fill(); rrect(g, 2, -34, 10, 34, 4); g.fill();
    g.fillStyle = '#5b4a45'; rrect(g, -14, -6, 13, 6, 3); g.fill(); rrect(g, 1, -6, 13, 6, 3); g.fill();
    // body
    rrect(g, -18, -74, 36, 44, 14); fillStroke(g, shirt, SOFT, 2);
    if (stripe) { g.save(); rrect(g, -18, -74, 36, 44, 14); g.clip(); g.fillStyle = stripe; for (let y = -70; y < -30; y += 10) g.fillRect(-20, y, 40, 4); g.restore(); g.strokeStyle = SOFT; g.lineWidth = 2; rrect(g, -18, -74, 36, 44, 14); g.stroke(); }
    // arms: one down, one waving
    g.strokeStyle = '#ffd9b8'; g.lineWidth = 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-16, -66); g.lineTo(-24, -40); g.stroke();
    const a = f ? -2.0 : -2.6;
    g.beginPath(); g.moveTo(16, -66); g.lineTo(16 + Math.cos(a + Math.PI) * -22, -66 + Math.sin(a) * 26); g.stroke();
    circ(g, 16 + Math.cos(a + Math.PI) * -22, -66 + Math.sin(a) * 26, 5); fillStroke(g, '#ffd9b8', null);
    // head
    circ(g, 0, -90, 17); fillStroke(g, '#ffd9b8', SOFT, 2);
    g.fillStyle = '#3d4a52'; circ(g, -6, -91, 2.2); g.fill(); circ(g, 6, -91, 2.2); g.fill();
    g.strokeStyle = '#c0605a'; g.lineWidth = 1.8; g.beginPath(); g.arc(0, -86, 5, 0.3, Math.PI - 0.3); g.stroke();
    g.fillStyle = 'rgba(255,140,150,0.55)'; ell(g, -10, -85, 3.5, 2.2); g.fill(); ell(g, 10, -85, 3.5, 2.2); g.fill();
    // hat
    ell(g, 0, -103, 26, 6); fillStroke(g, hat, SOFT, 1.6);
    g.beginPath(); g.ellipse(0, -104, 14, 12, 0, Math.PI, TAU); fillStroke(g, hat, SOFT, 1.6);
    g.fillStyle = shirt; g.fillRect(-14, -106, 28, 3);
  };
  for (const f of [0, 1]) {
    mk('localS' + f, 80, 120, 620, person('#ff9fc0', '#ffffff', '#5dbfe8', '#2bb3a6', f));
    mk('localF' + f, 80, 120, 620, person('#f2d06b', '#ff8a6b', null, '#5b8bd9', f));
  }
}

// ============================================================ the pelican (back view)
const C = {
  white: '#ffffff', shade: '#e4edf2', out: '#4f6470', beak: '#ffb347', pouch: '#f5892b', beakDark: '#e0661f',
  leg: '#f7a23a', legDark: '#d9802a', scarf: '#ff5f3a', scarfDark: '#e0442a', teal: '#25b2a4', tealDark: '#18897e',
  tire: '#3e4a52', tread: '#2a3338', black: '#3b4750',
};
function strokeLine(g, pts, w, color, outline = C.out) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  if (outline) { g.strokeStyle = outline; g.lineWidth = w + 4; g.stroke(); }
  g.strokeStyle = color; g.lineWidth = w; g.stroke();
}
// two-bone IK: knee pushed outward (side = -1 left, +1 right)
function knee(hx, hy, fx, fy, L1, L2, side) {
  const dx = fx - hx, dy = fy - hy; let d = Math.hypot(dx, dy);
  d = Math.min(d, L1 + L2 - 0.01);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const ux = dx / d, uy = dy / d;
  const mx = hx + ux * a, my = hy + uy * a;
  // perpendicular, choose the outward one
  let px = -uy, py = ux; if (px * side < 0) { px = -px; py = -py; }
  return [mx + px * h, my + py * h];
}
function scarfTail(g, bx, by, k, st) {
  const n = 11, seg = 7.2;
  const sp = st.speed;
  const side = (k === 0 ? -0.55 : 0.75) - st.steer * 0.6;
  const lift = 0.12 + sp * 0.42;          // how far the wind lifts the tail away from hanging straight down
  const pts = [];
  let x = bx, y = by, ang = Math.PI / 2 - side * lift * 1.5;
  for (let i = 0; i <= n; i++) {
    pts.push([x, y]);
    const wave = Math.sin(st.t * (5 + sp * 9) - i * 0.75 + k * 1.9);
    ang += wave * (0.13 + sp * 0.14);
    x += Math.cos(ang) * seg; y += Math.sin(ang) * seg * (0.95 - sp * 0.15);
  }
  // ribbon polygon
  const L = [], R = [];
  for (let i = 0; i <= n; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)], [x1, y1] = pts[Math.min(n, i + 1)];
    let nx = -(y1 - y0), ny = x1 - x0; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const w = lerp(6.5, 5, i / n) * (1 + 0.25 * Math.sin(st.t * 9 + i + k));
    L.push([pts[i][0] + nx * w, pts[i][1] + ny * w]); R.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
  }
  g.beginPath(); g.moveTo(L[0][0], L[0][1]);
  for (const p of L) g.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath(); fillStroke(g, k ? C.scarf : C.scarfDark, C.out, 2.2);
  // stripe near the end
  const i0 = n - 2;
  g.beginPath(); g.moveTo(L[i0][0], L[i0][1]); g.lineTo(L[i0 + 1][0], L[i0 + 1][1]); g.lineTo(R[i0 + 1][0], R[i0 + 1][1]); g.lineTo(R[i0][0], R[i0][1]); g.closePath();
  g.fillStyle = '#ffd27a'; g.fill();
}

function drawRider(g, cx, gy, s, st) {
  g.save();
  g.translate(cx, gy);
  // ground shadow (not rotated)
  g.fillStyle = 'rgba(60,90,70,0.22)'; ell(g, 0, 0, 58 * s, 9 * s); g.fill();
  g.rotate(st.lean);
  g.scale(s, s);
  const sp = st.speed;
  const bob = -Math.abs(Math.sin(st.crank)) * 2.2 * Math.min(1, sp * 3) + st.shake;

  // ---------- handlebar (farthest away)
  g.save(); g.translate(0, bob * 0.3);
  strokeLine(g, [0, -112, 0, -130], 6, C.teal);
  strokeLine(g, [-50, -122, -30, -132, 0, -134, 30, -132, 50, -122], 6, C.teal);
  for (const sx of [-1, 1]) { rrect(g, sx * 54 - 6, -128, 12, 11, 4); fillStroke(g, C.black, C.out, 2); }
  circ(g, 26, -137, 5); fillStroke(g, '#ffd84d', C.out, 2);           // bell
  rrect(g, -15, -128, 30, 14, 5); fillStroke(g, '#fff3dc', C.out, 2);  // little front basket
  g.restore();

  // ---------- crank, pedals, legs
  const bbY = -46;
  const pyL = bbY - 15 * Math.sin(st.crank), pyR = bbY + 15 * Math.sin(st.crank);
  const hipY = -110 + bob;
  for (const side of [-1, 1]) {
    const py = side < 0 ? pyL : pyR;
    strokeLine(g, [side * 13, bbY, side * 13, py], 4, '#9aa8b0');
    rrect(g, side * 21 - 7, py - 2.5, 14, 5, 2); fillStroke(g, C.black, null);
    const hx = side * 16, fx = side * 21, fy = py - 4;
    const [kx, ky] = knee(hx, hipY, fx, fy, 37, 38, side);
    strokeLine(g, [hx, hipY, kx, ky, fx, fy], 7.5, C.leg);
    circ(g, kx, ky, 4.6); fillStroke(g, C.leg, null);
    // webbed foot on the pedal (seen from behind: a little fan)
    g.beginPath(); g.moveTo(fx - side * 1, fy - 1); g.lineTo(fx - 9, fy + 3.5); g.quadraticCurveTo(fx, fy + 6.5, fx + 9, fy + 3.5); g.closePath();
    fillStroke(g, C.leg, C.out, 2);
  }

  // ---------- saddle & seat stays
  ell(g, 0, -103 + bob * 0.2, 14, 6); fillStroke(g, '#6b4a3a', C.out, 2);

  // ---------- neck + head + beak (behind the body)
  const yaw = st.yaw;                      // -1..1 head turn, beak pokes out toward this side
  const hx = yaw * 7 + st.steer * 3, hy = -240 + bob;
  g.lineCap = 'round';
  g.beginPath(); g.moveTo(0, -176 + bob);
  g.bezierCurveTo(-12, -196 + bob, 10 * yaw + 6, -214 + bob, hx, hy + 8);
  g.strokeStyle = C.out; g.lineWidth = 29; g.stroke();
  g.strokeStyle = C.white; g.lineWidth = 24.5; g.stroke();
  // beak: big, pointing forward and out to the side, with a hanging orange pouch
  const ay = Math.abs(yaw);
  const L = 108;
  const tipX = hx + yaw * L, tipY = hy - 2 - (1 - ay) * 16;
  if (ay > 0.08) {
    const bx = hx + yaw * 6;
    // pouch
    g.beginPath(); g.moveTo(bx, hy + 6);
    g.bezierCurveTo(hx + yaw * 22, hy + 34 + sp * 2, hx + yaw * L * 0.62, tipY + 22, tipX - yaw * 10, tipY + 5);
    g.lineTo(tipX - yaw * 6, tipY + 2); g.lineTo(bx + yaw * 4, hy - 1); g.closePath();
    fillStroke(g, C.pouch, C.out, 2.4);
    g.fillStyle = 'rgba(255,255,255,0.18)'; ell(g, hx + yaw * L * 0.35, hy + 14, 10 * ay + 2, 4, yaw * 0.25); g.fill();
    // upper mandible
    g.beginPath(); g.moveTo(bx - yaw * 2, hy - 9);
    g.quadraticCurveTo(hx + yaw * L * 0.5, tipY - 7, tipX, tipY - 2);
    g.quadraticCurveTo(tipX + yaw * 5, tipY + 2, tipX - yaw * 2, tipY + 5);
    g.quadraticCurveTo(hx + yaw * L * 0.5, tipY + 3, bx, hy + 3); g.closePath();
    fillStroke(g, C.beak, C.out, 2.4);
    g.strokeStyle = 'rgba(224,102,31,0.55)'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(bx + yaw * 6, hy - 3); g.quadraticCurveTo(hx + yaw * L * 0.5, tipY - 1, tipX - yaw * 8, tipY + 1); g.stroke();
    circ(g, tipX - yaw * 1, tipY + 2, 3.4); fillStroke(g, C.beakDark, null);
  }
  // head
  circ(g, hx, hy, 19); fillStroke(g, C.white, C.out, 2.4);
  g.fillStyle = C.shade; ell(g, hx - yaw * 5, hy + 9, 12, 6); g.fill();
  // crest feathers
  g.strokeStyle = C.out; g.lineWidth = 2.4;
  for (const [dx, h, c] of [[-5, 10, -7], [1, 14, 2], [7, 9, 9]]) {
    g.beginPath(); g.moveTo(hx + dx, hy - 16); g.quadraticCurveTo(hx + dx + c * 0.3, hy - 16 - h, hx + dx + c, hy - 18 - h); g.stroke();
  }
  // eye + blush on the side the head is turned to
  if (ay > 0.25) {
    const ex = hx + yaw * 13, ey = hy - 4;
    g.fillStyle = '#2d3a42'; ell(g, ex, ey, 2.6 * ay + 0.6, 3.4); g.fill();
    g.fillStyle = '#ffffff'; circ(g, ex + yaw * 0.6, ey - 1.3, 1); g.fill();
    g.fillStyle = 'rgba(255,140,150,0.6)'; ell(g, hx + yaw * 11, hy + 6, 4 * ay, 2.6); g.fill();
  }

  // ---------- body
  g.save(); g.translate(0, bob);
  const body = new Path2D();
  body.moveTo(0, -194);
  body.bezierCurveTo(28, -194, 46, -152, 45, -126);
  body.bezierCurveTo(44, -103, 24, -94, 0, -94);
  body.bezierCurveTo(-24, -94, -44, -103, -45, -126);
  body.bezierCurveTo(-46, -152, -28, -194, 0, -194); body.closePath();
  g.fillStyle = C.white; g.fill(body);
  g.save(); g.clip(body);
  g.fillStyle = C.shade; ell(g, 6, -94, 50, 22); g.fill();
  g.restore();
  g.strokeStyle = C.out; g.lineWidth = 2.6; g.lineJoin = 'round'; g.stroke(body);
  // tail feathers (closest to us)
  for (const [dx, rot] of [[-9, 0.35], [9, -0.35], [0, 0]]) {
    g.save(); g.translate(dx, -104); g.rotate(rot);
    g.beginPath(); g.moveTo(-6, 0); g.quadraticCurveTo(-7, 14, 0, 18); g.quadraticCurveTo(7, 14, 6, 0); g.closePath();
    fillStroke(g, '#f4f8fa', C.out, 2); g.restore();
  }
  // wings: folded along the sides of the body, tips holding the grips, black primaries at the tips
  const wing = new Path2D();
  wing.moveTo(14, -186);
  wing.bezierCurveTo(44, -190, 60, -164, 60, -138);
  wing.quadraticCurveTo(62, -124, 58, -118);
  wing.bezierCurveTo(52, -112, 40, -110, 30, -114);
  wing.bezierCurveTo(32, -138, 28, -166, 14, -186); wing.closePath();
  for (const side of [-1, 1]) {
    g.save(); g.scale(side, 1);
    g.fillStyle = C.white; g.fill(wing);
    g.save(); g.clip(wing);
    g.fillStyle = '#eef3f6'; ell(g, 26, -150, 9, 30, 0.1); g.fill();
    g.fillStyle = C.black;
    g.beginPath(); g.moveTo(28, -128);
    for (let k = 0; k < 4; k++) g.quadraticCurveTo(36 + k * 8, -136 + k * 1, 40 + k * 8, -130 - k * 1.5);
    g.lineTo(66, -100); g.lineTo(28, -100); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = C.out; g.lineWidth = 2.5; g.lineJoin = 'round'; g.stroke(wing);
    g.strokeStyle = '#8193a0'; g.lineWidth = 1.4;
    for (const o of [0, 7, 14]) { g.beginPath(); g.moveTo(38 + o * 0.8, -150 + o); g.quadraticCurveTo(44 + o * 0.7, -146 + o, 48 + o * 0.5, -150 + o * 1.2); g.stroke(); }
    g.restore();
  }
  g.restore();

  // ---------- scarf around the neck base, tails fluttering back toward us
  g.save(); g.translate(0, bob);
  const sy = -184;
  g.beginPath(); g.ellipse(0, sy, 17, 8.5, 0, 0, TAU); fillStroke(g, C.scarf, C.out, 2.2);
  g.fillStyle = C.scarfDark; g.beginPath(); g.ellipse(0, sy + 3, 14, 4, 0, 0, Math.PI); g.fill();
  scarfTail(g, -3, sy + 4, 0, st);
  scarfTail(g, 3, sy + 5, 1, st);
  circ(g, 0, sy + 3, 5.5); fillStroke(g, C.scarf, C.out, 2);
  g.restore();

  // ---------- rear wheel (closest to the camera)
  const wcY = -41, R = 41;
  strokeLine(g, [-9, wcY, -5, -100], 4.5, C.teal);   // seat stays
  strokeLine(g, [9, wcY, 5, -100], 4.5, C.teal);
  rrect(g, -10.5, wcY - R, 21, R * 2, 10); fillStroke(g, C.tire, C.out, 2);
  // tread blocks rolling down the visible back of the tyre
  g.save(); rrect(g, -10.5, wcY - R, 21, R * 2, 10); g.clip();
  g.fillStyle = C.tread;
  const NT = 16;
  for (let k = 0; k < NT; k++) {
    const th = ((st.wheel + k * TAU / NT) % TAU + TAU) % TAU;
    if (th <= 0.05 || th >= Math.PI - 0.05) continue;
    const y = wcY - R * Math.cos(th), hgt = 3.4 * Math.sin(th);
    g.fillRect(-7, y - hgt / 2, 14, hgt);
  }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-8, wcY - R, 4, R * 2);
  g.restore();
  // axle nuts
  for (const sx of [-1, 1]) { circ(g, sx * 12, wcY, 3.2); fillStroke(g, '#c3ccd1', C.out, 1.6); }
  // mudguard + reflector
  g.beginPath(); g.moveTo(-13, wcY - 6); g.lineTo(-13, wcY - R + 6); g.quadraticCurveTo(-13, wcY - R - 7, 0, wcY - R - 7); g.quadraticCurveTo(13, wcY - R - 7, 13, wcY - R + 6); g.lineTo(13, wcY - 6);
  g.quadraticCurveTo(0, wcY - 10, -13, wcY - 6); g.closePath();
  fillStroke(g, C.teal, C.out, 2.2);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-9, wcY - R + 2, 4, R - 12);
  rrect(g, -6, wcY - 26, 12, 9, 3); fillStroke(g, '#ff5a4f', C.out, 1.8);
  g.restore();
}

// ============================================================ controls (drawn on canvas)
const joy = { x: 0, y: 0, r: 50, id: null, kx: 0, ky: 0 };
const slider = { x: 0, top: 0, bottom: 0, w: 46, id: null };
let targetSpeed = 0;   // 0..1
function layoutControls() {
  const m = Math.min(W, H);
  joy.r = clamp(m * 0.11, 42, 72);
  const pad = Math.max(16, m * 0.04);
  joy.x = pad + joy.r * 1.25; joy.y = H - pad - joy.r * 1.25 - (PORTRAIT ? H * 0.02 : 0);
  slider.w = clamp(m * 0.085, 38, 56);
  slider.x = W - pad - slider.w * 0.9;
  const len = clamp(H * (PORTRAIT ? 0.26 : 0.36), 130, 280);
  slider.bottom = H - pad - slider.w * 0.6 - (PORTRAIT ? H * 0.02 : 0);
  slider.top = slider.bottom - len;
  if (typeof positionBell === 'function') positionBell();
}
function drawControls() {
  const g = ctx;
  // joystick
  g.save();
  g.globalAlpha = joy.id !== null ? 0.95 : 0.8;
  circ(g, joy.x, joy.y, joy.r); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
  g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  // arrows
  g.fillStyle = 'rgba(61,85,98,0.45)';
  for (const sd of [-1, 1]) { const ax = joy.x + sd * joy.r * 0.72; poly(g, [ax + sd * 8, joy.y, ax - sd * 4, joy.y - 9, ax - sd * 4, joy.y + 9]); g.fill(); }
  const kr = joy.r * 0.46;
  circ(g, joy.x + joy.kx, joy.y + joy.ky + 3, kr); g.fillStyle = 'rgba(40,90,110,0.18)'; g.fill();
  circ(g, joy.x + joy.kx, joy.y + joy.ky, kr); fillStroke(g, '#ffffff', 'rgba(43,179,166,0.9)', 3);
  circ(g, joy.x + joy.kx, joy.y + joy.ky, kr * 0.45); g.fillStyle = 'rgba(43,179,166,0.35)'; g.fill();
  g.font = `700 ${Math.round(clamp(joy.r * 0.26, 11, 15))}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillStyle = 'rgba(61,85,98,0.85)'; g.fillText('转向', joy.x, joy.y - joy.r - 6);
  // slider
  const sw = slider.w, x = slider.x, top = slider.top, bot = slider.bottom;
  g.globalAlpha = slider.id !== null ? 0.95 : 0.8;
  rrect(g, x - sw * 0.32, top - sw * 0.3, sw * 0.64, bot - top + sw * 0.6, sw * 0.32);
  g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  const ty = lerp(bot, top, targetSpeed);
  // filled part
  rrect(g, x - sw * 0.18, ty, sw * 0.36, bot - ty + sw * 0.12, sw * 0.18);
  const gr = g.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, '#ff6a3d'); gr.addColorStop(1, '#ffd84d');
  g.fillStyle = gr; g.fill();
  // ticks
  g.fillStyle = 'rgba(61,85,98,0.35)';
  for (let i = 1; i < 4; i++) g.fillRect(x + sw * 0.36, lerp(bot, top, i / 4) - 1, sw * 0.16, 2);
  // current speed marker
  const cy = lerp(bot, top, speed / MAX_SPEED);
  g.fillStyle = 'rgba(43,179,166,0.9)'; poly(g, [x - sw * 0.5, cy, x - sw * 0.72, cy - 6, x - sw * 0.72, cy + 6]); g.fill();
  // thumb
  rrect(g, x - sw * 0.55, ty - sw * 0.24, sw * 1.1, sw * 0.48, sw * 0.24); g.fillStyle = 'rgba(40,90,110,0.18)'; g.fill();
  rrect(g, x - sw * 0.55, ty - sw * 0.27, sw * 1.1, sw * 0.48, sw * 0.24); fillStroke(g, '#ffffff', 'rgba(255,106,61,0.9)', 3);
  g.fillStyle = 'rgba(255,106,61,0.7)'; for (const d of [-5, 0, 5]) g.fillRect(x + d - 1, ty - sw * 0.13, 2, sw * 0.22);
  g.fillStyle = 'rgba(61,85,98,0.85)'; g.fillText('速度', x, top - sw * 0.38);
  g.restore();
}
const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';

// ============================================================ input
let state = 'title';
const keys = {};
function setJoy(px, py) {
  let dx = px - joy.x, dy = py - joy.y; const d = Math.hypot(dx, dy), max = joy.r * 0.8;
  if (d > max) { dx *= max / d; dy *= max / d; }
  joy.kx = dx; joy.ky = dy;
}
function setSlider(py) { targetSpeed = clamp((slider.bottom - py) / (slider.bottom - slider.top), 0, 1); }
function inJoyZone(x, y) { return Math.hypot(x - joy.x, y - joy.y) < joy.r * 1.7 || (x < W * 0.42 && y > H * 0.5); }
function inSliderZone(x, y) { return Math.abs(x - slider.x) < slider.w * 1.4 && y > slider.top - slider.w && y < slider.bottom + slider.w; }
canvas.addEventListener('pointerdown', e => {
  if (state !== 'play') return;
  const x = e.clientX, y = e.clientY;
  if (joy.id === null && inJoyZone(x, y)) { joy.id = e.pointerId; setJoy(x, y); }
  else if (slider.id === null && (inSliderZone(x, y) || (x > W * 0.6 && y > H * 0.45))) { slider.id = e.pointerId; setSlider(y); }
  else return;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  e.preventDefault();
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) setJoy(e.clientX, e.clientY);
  else if (e.pointerId === slider.id) setSlider(e.clientY);
});
function release(e) {
  if (e.pointerId === joy.id) { joy.id = null; joy.kx = 0; joy.ky = 0; }
  if (e.pointerId === slider.id) slider.id = null;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', e => e.preventDefault());
// ============================================================ sound (100% Web Audio, generated at runtime)
const snd = (() => {
  const LS_KEY = 'pelicanRide.muted';
  let ac = null, master = null, musicBus, ambBus, sfxBus, seaGain, fieldGain, windGain, windFilter;
  let noiseBuf, tickBuf;
  let started = false, muted = false, paused = false, hidden = false, nodes = 0, bells = 0, ticks = 0;
  let suspendTimer = 0, musicTimer = 0, eventTimer = 0;
  const VOL = 0.75;
  try { muted = localStorage.getItem(LS_KEY) === '1'; } catch (_) { /* storage blocked */ }

  const reg = n => { nodes++; return n; };
  const gainNode = (v, to) => { const g = reg(ac.createGain()); g.gain.value = v; if (to) g.connect(to); return g; };
  const filt = (type, f, q, to) => { const b = reg(ac.createBiquadFilter()); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (to) b.connect(to); return b; };
  const osc = (type, f) => { const o = reg(ac.createOscillator()); o.type = type; o.frequency.value = f; return o; };
  const panner = (p, to) => {
    if (ac.createStereoPanner) { const s = reg(ac.createStereoPanner()); s.pan.value = p; s.connect(to); return s; }
    return to;
  };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const rand = (a, b) => a + Math.random() * (b - a);

  function makeBuffers() {
    // soft pink-ish noise, 3 s, loopable
    const len = Math.floor(ac.sampleRate * 3);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    // tiny metallic tick (chain / freewheel pawl)
    const tl = Math.floor(ac.sampleRate * 0.03);
    tickBuf = ac.createBuffer(1, tl, ac.sampleRate);
    const td = tickBuf.getChannelData(0);
    let prev = 0;
    for (let i = 0; i < tl; i++) {
      const w = Math.random() * 2 - 1, hp = w - prev; prev = w;     // crude high-pass
      const env = Math.exp(-i / (ac.sampleRate * 0.0035));
      td[i] = (hp * 0.6 + Math.sin(i / ac.sampleRate * TAU * 4200) * 0.5) * env;
    }
  }
  function noiseSrc() {
    const s = reg(ac.createBufferSource()); s.buffer = noiseBuf; s.loop = true;
    s.start(0, Math.random() * 2.5); return s;
  }
  function lfo(freq, depth, param, type = 'sine') {
    const o = osc(type, freq), g = gainNode(depth); o.connect(g); g.connect(param); o.start(); return o;
  }

  // ---------- ambient beds
  function buildSea() {
    seaGain = gainNode(0, ambBus);
    // rolling surf: low-passed noise swelling in and out
    const wave = gainNode(0.2, seaGain);
    const lp = filt('lowpass', 520, 0.4, wave);
    noiseSrc().connect(lp);
    lfo(0.105, 0.17, wave.gain);
    lfo(0.07, 260, lp.frequency);
    // foam hiss on top of each swell
    const hiss = gainNode(0.025, seaGain);
    const hp = filt('highpass', 2600, 0.5, hiss);
    noiseSrc().connect(hp);
    lfo(0.105, 0.022, hiss.gain);
  }
  function buildField() {
    fieldGain = gainNode(0, ambBus);
    const breeze = gainNode(0.07, fieldGain);
    const bp = filt('bandpass', 480, 0.7, breeze);
    noiseSrc().connect(bp);
    lfo(0.085, 0.05, breeze.gain);
    lfo(0.05, 160, bp.frequency);
    const leaves = gainNode(0.008, fieldGain);
    noiseSrc().connect(filt('highpass', 3800, 0.4, leaves));
    lfo(0.21, 0.006, leaves.gain);
  }
  function buildWind() {
    windGain = gainNode(0, ambBus);
    windFilter = filt('bandpass', 600, 0.8, windGain);
    const lowShelf = filt('lowpass', 2400, 0.3, windFilter);
    noiseSrc().connect(lowShelf);
  }
  // ---------- one-shot creatures
  function gull(when) {
    const out = panner(rand(-0.8, 0.8), seaGain);
    const v = rand(0.35, 1) * 0.05;
    const bp = filt('bandpass', 1500, 2.5, out);
    const n = Math.random() < 0.5 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const t0 = when + i * rand(0.24, 0.32);
      const o = osc('sawtooth', 1200), g = gainNode(0, bp);
      o.frequency.setValueAtTime(1150, t0);
      o.frequency.linearRampToValueAtTime(1650, t0 + 0.05);
      o.frequency.exponentialRampToValueAtTime(820, t0 + 0.24);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t0 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.25);
      o.connect(g); o.start(t0); o.stop(t0 + 0.3);
    }
  }
  function bird(when) {
    const out = panner(rand(-0.9, 0.9), fieldGain);
    const v = rand(0.4, 1) * 0.035;
    const base = rand(2600, 4200);
    const kind = Math.random();
    const n = kind < 0.4 ? Math.floor(rand(5, 9)) : Math.floor(rand(2, 5));
    let t0 = when;
    for (let i = 0; i < n; i++) {
      const dur = kind < 0.4 ? 0.045 : rand(0.07, 0.13);
      const o = osc('sine', base), g = gainNode(0, out);
      const up = Math.random() < 0.5;
      o.frequency.setValueAtTime(base * (up ? 0.8 : 1.25), t0);
      o.frequency.exponentialRampToValueAtTime(base * (up ? 1.3 : 0.85), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(v, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
      o.connect(g); o.start(t0); o.stop(t0 + dur + 0.02);
      t0 += dur + (kind < 0.4 ? 0.02 : rand(0.05, 0.14));
    }
  }
  let nextGull = 0, nextBird = 0;
  function events() {
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (route.key === 'sea') { if (now >= nextGull) { gull(now + 0.05); nextGull = now + rand(5, 13); } }
    else if (now >= nextBird) { bird(now + 0.05); if (Math.random() < 0.3) bird(now + rand(0.6, 1.2)); nextBird = now + rand(1.8, 5.5); }
  }

  // ---------- background music: gentle I–vi–IV–V loop, 96 BPM, generated note by note
  const BPM = 96, EIGHTH = 60 / BPM / 2, LOOP = 64;
  const MELODY = [ // [eighth index, midi, length in eighths]
    [0, 76, 2], [2, 79, 2], [4, 81, 1], [5, 79, 1], [6, 76, 2],
    [8, 72, 2], [10, 76, 2], [12, 74, 2], [14, 72, 2],
    [16, 69, 2], [18, 72, 2], [20, 77, 2], [22, 76, 1], [23, 74, 1],
    [24, 74, 3], [28, 67, 2], [30, 71, 2],
    [32, 76, 1], [33, 79, 1], [34, 84, 2], [36, 79, 2], [38, 76, 2],
    [40, 81, 2], [42, 79, 1], [43, 76, 1], [44, 74, 2], [46, 72, 2],
    [48, 77, 2], [50, 76, 2], [52, 74, 2], [54, 79, 2],
    [56, 72, 6],
  ];
  const CHORDS = [ // per bar: bass root + chord tones (C, Am, F, G, C, Am, F/G, C)
    [48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [43, [55, 59, 62]],
    [48, [60, 64, 67]], [45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]],
  ];
  const melodyAt = new Map(MELODY.map(n => [n[0], n]));
  let step = 0, nextT = 0, loopN = 0;
  function pluck(m, t0, len, v) {
    const f = mtof(m), lp = filt('lowpass', 2600, 0.5, musicBus), g = gainNode(0, lp);
    const o1 = osc('triangle', f), o2 = osc('sine', f * 2);
    const g2 = gainNode(0.25, g);
    o1.connect(g); o2.connect(g2);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + len + 0.45);
    o1.start(t0); o2.start(t0); o1.stop(t0 + len + 0.5); o2.stop(t0 + len + 0.5);
  }
  function flute(m, t0, len, v) {
    const f = mtof(m), g = gainNode(0, musicBus), o = osc('sine', f);
    const vib = osc('sine', 5.2), vg = gainNode(f * 0.004); vib.connect(vg); vg.connect(o.frequency);
    o.connect(g);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.06);
    g.gain.setValueAtTime(v, t0 + Math.max(0.07, len - 0.08)); g.gain.linearRampToValueAtTime(0, t0 + len + 0.12);
    o.start(t0); vib.start(t0); o.stop(t0 + len + 0.15); vib.stop(t0 + len + 0.15);
  }
  function bass(m, t0, v) {
    const g = gainNode(0, filt('lowpass', 700, 0.5, musicBus)), o = osc('triangle', mtof(m));
    o.connect(g);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.9);
    o.start(t0); o.stop(t0 + 0.95);
  }
  function shaker(t0, v) {
    const s = reg(ac.createBufferSource()); s.buffer = tickBuf; s.playbackRate.value = 0.55;
    const g = gainNode(v, musicBus); s.connect(g); s.start(t0);
  }
  function playStep(i, t0) {
    const bar = i >> 3, pos = i & 7, [root, tones] = CHORDS[bar];
    if (pos === 0 || pos === 4) bass(pos === 0 ? root : root + 7, t0, 0.13);
    if (pos % 2 === 1) pluck(tones[(pos >> 1) % 3] + (loopN % 2 ? 12 : 0), t0, EIGHTH * 0.8, 0.028);
    if (pos % 2 === 1) shaker(t0, 0.02);
    const n = melodyAt.get(i);
    if (n) {
      if (loopN % 2 === 0) pluck(n[1], t0, n[2] * EIGHTH, 0.075);
      else flute(n[1], t0, n[2] * EIGHTH, 0.05);
    }
  }
  function music() {
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (nextT < now - 0.05) nextT = now + 0.06;
    while (nextT < now + 0.18) {
      playStep(step, nextT);
      nextT += EIGHTH; step = (step + 1) % LOOP; if (step === 0) loopN++;
    }
  }

  // ---------- batch-1 effects
  function env(g, t0, peak, a, d) {
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0005, t0 + a + d);
  }
  function chime(n = 0) {           // collectible pickup: two bright sine notes
    if (!ac) return;
    const t0 = ac.currentTime + 0.005, base = [1318.5, 1480, 1568, 1760][n % 4];
    for (const [f, dt] of [[base, 0], [base * 1.5, 0.075]]) {
      const o = osc('sine', f), g = gainNode(0, sfxBus); env(g, t0 + dt, 0.055, 0.005, 0.35);
      o.connect(g); o.start(t0 + dt); o.stop(t0 + dt + 0.4);
    }
  }
  function boing() {                // soft spring bounce
    if (!ac) return;
    const t0 = ac.currentTime + 0.005, o = osc('sine', 150), g = gainNode(0, filt('lowpass', 1400, 0.5, sfxBus));
    o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(420, t0 + 0.07); o.frequency.exponentialRampToValueAtTime(220, t0 + 0.5);
    const v = osc('sine', 15), vg = gainNode(60); v.connect(vg); vg.connect(o.frequency);
    vg.gain.setValueAtTime(70, t0); vg.gain.exponentialRampToValueAtTime(2, t0 + 0.5);
    env(g, t0, 0.16, 0.01, 0.5);
    o.connect(g); o.start(t0); v.start(t0); o.stop(t0 + 0.6); v.stop(t0 + 0.6);
  }
  function shutter() {              // camera: two filtered noise clicks + a tiny whirr
    if (!ac) return;
    const t0 = ac.currentTime + 0.005;
    for (const [dt, f, v] of [[0, 2600, 0.32], [0.085, 1700, 0.24]]) {
      const src = reg(ac.createBufferSource()); src.buffer = noiseBuf;
      const g = gainNode(0, filt('bandpass', f, 1.2, sfxBus)); env(g, t0 + dt, v, 0.002, 0.045);
      src.connect(g); src.start(t0 + dt, Math.random() * 2); src.stop(t0 + dt + 0.08);
    }
    const o = osc('triangle', 900), g = gainNode(0, sfxBus);
    o.frequency.setValueAtTime(900, t0 + 0.12); o.frequency.linearRampToValueAtTime(1300, t0 + 0.3);
    env(g, t0 + 0.12, 0.018, 0.02, 0.2); o.connect(g); o.start(t0 + 0.12); o.stop(t0 + 0.36);
  }
  function jingle(notes, gap = 0.11, v = 0.08) {
    if (!ac) return;
    const t0 = ac.currentTime + 0.02;
    notes.forEach((m, i) => pluck(m, t0 + i * gap, i === notes.length - 1 ? 0.6 : 0.12, v));
  }
  function follower() { if (!ac || ac.state !== 'running') return; if (route.key === 'sea') gull(ac.currentTime + 0.05); else bird(ac.currentTime + 0.05); }

  // ---------- public
  function shouldRun() { return started && !paused && !hidden; }
  function refresh() {
    if (!ac) return;
    const now = ac.currentTime;
    clearTimeout(suspendTimer);
    if (shouldRun()) {
      const p = ac.state === 'suspended' ? ac.resume() : Promise.resolve();
      p.then(() => { master.gain.cancelScheduledValues(ac.currentTime); master.gain.setTargetAtTime(muted ? 0 : VOL, ac.currentTime, 0.15); }).catch(() => {});
    } else {
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.04);
      suspendTimer = setTimeout(() => { if (!shouldRun() && ac.state === 'running') ac.suspend().catch(() => {}); }, 220);
    }
  }
  function init() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ac = new AC(); } catch (_) { return; }
    started = true;
    master = gainNode(0);
    const comp = reg(ac.createDynamicsCompressor());
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    master.connect(comp); comp.connect(ac.destination);
    musicBus = gainNode(0.55, master);
    ambBus = gainNode(0.9, master);
    sfxBus = gainNode(0.9, master);
    makeBuffers();
    buildSea(); buildField(); buildWind();
    setRoute(route.key, true);
    nextT = ac.currentTime + 0.1;
    musicTimer = setInterval(music, 40);
    eventTimer = setInterval(events, 250);
    nextGull = ac.currentTime + 2; nextBird = ac.currentTime + 1;
    refresh();
  }
  function setRoute(key, instant = false) {
    if (!ac) return;
    const now = ac.currentTime, tc = instant ? 0.01 : 0.6;
    seaGain.gain.setTargetAtTime(key === 'sea' ? 1 : 0, now, tc);
    fieldGain.gain.setTargetAtTime(key === 'field' ? 1 : 0, now, tc);
  }
  let lastUpd = 0;
  function update(sp) {  // called every frame while simulating
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (now - lastUpd < 0.08) return; lastUpd = now;
    windGain.gain.setTargetAtTime(0.012 + sp * sp * 0.22, now, 0.3);
    windFilter.frequency.setTargetAtTime(450 + sp * 1300, now, 0.3);
  }
  function tick(sp) {
    if (!ac || ac.state !== 'running' || sp < 0.02) return;
    const s = reg(ac.createBufferSource()); s.buffer = tickBuf; s.playbackRate.value = rand(0.9, 1.15);
    const g = gainNode(0.035 + sp * 0.03, sfxBus); s.connect(g); s.start(); ticks++;
  }
  function bell() {
    if (!ac) return;
    bells++;
    const now = ac.currentTime + 0.01;
    for (const [k, t0] of [[1, now], [0.8, now + 0.17]]) {
      const out = gainNode(0.0, sfxBus);
      out.gain.setValueAtTime(0, t0); out.gain.linearRampToValueAtTime(0.11 * k, t0 + 0.004);
      out.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.5);
      const f0 = 2350;
      for (const [r, a] of [[1, 1], [1.0035, 0.6], [1.51, 0.3], [2.0, 0.35], [2.74, 0.18]]) {
        const o = osc('sine', f0 * r), g = gainNode(a * 0.45, out); o.connect(g); o.start(t0); o.stop(t0 + 1.6);
      }
    }
  }
  function click(up = true) {
    if (!ac) return;
    const t0 = ac.currentTime + 0.005, o = osc('sine', up ? 700 : 520), g = gainNode(0, sfxBus);
    o.frequency.exponentialRampToValueAtTime(up ? 1050 : 390, t0 + 0.06);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.07, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.11);
    o.connect(g); o.start(t0); o.stop(t0 + 0.13);
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(LS_KEY, muted ? '1' : '0'); } catch (_) { /* ignore */ }
    refresh();
  }
  return {
    init, refresh, setRoute, update, tick, bell, click, setMuted, chime, boing, shutter, follower,
    fanfare() { jingle([72, 76, 79, 84, 79, 84, 88], 0.12, 0.09); },
    success() { jingle([79, 84, 88], 0.09, 0.07); },
    get muted() { return muted; },
    setPaused(p) { paused = p; refresh(); },
    setHidden(h) { hidden = h; refresh(); },
    stats() {
      return { started, state: ac ? ac.state : 'none', nodes, muted, paused, hidden, bells, ticks,
        master: master ? master.gain.value : 0, time: ac ? ac.currentTime : 0, loop: loopN, step };
    },
  };
})();

// ============================================================ save data (localStorage)
const SAVE_KEY = 'pelicanRide.save.v1';
const save = (() => {
  const d = { totalDist: 0, coins: 0, best: {}, rides: {} };
  try { const v = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (v && typeof v === 'object') Object.assign(d, v); } catch (_) { /* fresh save */ }
  return d;
})();
let saveTimer = 0;
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { /* storage full/blocked */ } }
const pcKey = (r, id) => `pelicanRide.pc.${r}.${id}`;
const pcCache = {};
function getPostcard(r, id) {
  const k = pcKey(r, id);
  if (!(k in pcCache)) { let v = null; try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { v = null; } pcCache[k] = v; }
  return pcCache[k];
}
function storePostcard(r, id, img) {
  const k = pcKey(r, id), v = { img, t: Date.now() };
  try { localStorage.setItem(k, JSON.stringify(v)); pcCache[k] = v; return true; } catch (_) { return false; }
}
const postcardCount = rk => (rk ? [rk] : Object.keys(LANDMARKS)).reduce((n, k) => n + LANDMARKS[k].filter(l => getPostcard(k, l.id)).length, 0);
const POSTCARD_TOTAL = Object.values(LANDMARKS).reduce((n, a) => n + a.length, 0);
const fmtTime = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtDist = m => (m < 1000 ? `${Math.floor(m)} 米` : `${(m / 1000).toFixed(2)} 公里`);
const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日`; };

// ============================================================ UI wiring
const $ = id => document.getElementById(id);
const ui = {
  title: $('title'), hud: $('hud'), top: $('topright'), spd: $('spd'), dist: $('dist'), time: $('time'), coins: $('coins'),
  routeName: $('routeName'), fade: $('fade'), pause: $('pause'), pauseBtn: $('pauseBtn'), muteBtn: $('muteBtn'), bellBtn: $('bellBtn'),
  photoBtn: $('photoBtn'), toast: $('toast'), flash: $('flash'), pfill: $('pfill'), pme: $('pme'), pmarks: $('pmarks'), pnext: $('pnext'),
  results: $('results'), album: $('album'), albGrid: $('albGrid'), albStats: $('albStats'), totals: $('totals'),
};
let selectedRoute = 'sea';
const ride = { time: 0, coins: 0, photos: new Set(), lastIdx: 0, zone: null, collisions: 0 };
const counters = { collisions: 0, photos: 0, pickups: 0 };
function syncRouteButtons() {
  document.querySelectorAll('[data-route]').forEach(b => b.classList.toggle('active', b.dataset.route === route.key));
  ui.routeName.textContent = route.full;
  ui.routeName.classList.toggle('field', route.key === 'field');
}
function setRoute(key, fade = true, done = null) {
  if (!ROUTES[key]) return;
  const apply = () => {
    route = ROUTES[key]; selectedRoute = key;
    buildTrack(route);
    position = 0; playerX = 0;
    syncRouteButtons(); buildProgressMarks();
    if (state === 'play') resetRide();
    if (done) done();
  };
  if (!fade) { apply(); return; }
  if (route.key === key) { if (done) done(); return; }
  snd.setRoute(key);
  ui.fade.classList.add('on');
  setTimeout(() => { apply(); ui.fade.classList.remove('on'); }, 360);
}
document.querySelectorAll('#routes [data-route], #segctl [data-route]').forEach(b => b.addEventListener('click', () => { snd.click(); setRoute(b.dataset.route); }));
$('start').addEventListener('click', () => { snd.click(); startGame(); });

let paused = false;
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.5"/><rect x="14" y="5" width="4" height="14" rx="1.5"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5 9.8 4h4.4l1.3 1.5H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2z"/><circle cx="12" cy="12.3" r="3.6" fill="#fff"/><circle cx="12" cy="12.3" r="2.1"/></svg>';
function syncPauseBtn() {
  ui.pauseBtn.innerHTML = (paused ? ICON_PLAY : ICON_PAUSE) + `<span>${paused ? '继续' : '暂停'}</span>`;
  ui.pauseBtn.setAttribute('aria-label', paused ? '继续' : '暂停');
  ui.pauseBtn.classList.toggle('is-paused', paused);
}
function syncMuteBtn() {
  ui.muteBtn.innerHTML = snd.muted ? ICON_MUTE : ICON_SOUND;
  ui.muteBtn.classList.toggle('muted', snd.muted);
  ui.muteBtn.setAttribute('aria-label', snd.muted ? '打开声音' : '静音');
  ui.muteBtn.title = snd.muted ? '打开声音 (M)' : '静音 (M)';
}
function setPaused(p) {
  if (state !== 'play') p = false;
  if (p === paused) return;
  paused = p;
  document.body.classList.toggle('paused', p);
  ui.pause.classList.toggle('hidden', !p);
  if (p) { joy.id = null; joy.kx = 0; joy.ky = 0; slider.id = null; for (const k in keys) keys[k] = false; persist(); }
  syncPauseBtn();
  snd.setPaused(p);
}
function toggleMute() { snd.setMuted(!snd.muted); syncMuteBtn(); if (!snd.muted) snd.click(); }
function goTitle() {
  setPaused(false);
  closeAlbum();
  state = 'title';
  document.body.classList.remove('playing', 'finished');
  ui.results.classList.add('hidden');
  ui.title.classList.remove('hidden'); ui.hud.classList.add('hidden');
  updatePhotoBtn(); persist(); updateTotals();
}
let bellAnim = 0;
function ringBell() {
  snd.bell(); bellAnim = 1;
  ui.bellBtn.classList.remove('ring'); void ui.bellBtn.offsetWidth; ui.bellBtn.classList.add('ring');
}
ui.pauseBtn.addEventListener('click', () => { setPaused(!paused); snd.click(!paused); });
$('resumeBtn').addEventListener('click', () => { setPaused(false); snd.click(); });
$('pauseMenuBtn').addEventListener('click', () => { snd.click(false); goTitle(); });
$('pauseAlbumBtn').addEventListener('click', () => { snd.click(); openAlbum(); });
$('albumBtn').addEventListener('click', () => { snd.click(); openAlbum(); });
$('albumClose').addEventListener('click', () => { snd.click(false); closeAlbum(); });
$('home').addEventListener('click', () => { snd.click(false); goTitle(); });
$('againBtn').addEventListener('click', () => { snd.click(); startGame(); });
$('switchBtn').addEventListener('click', () => { snd.click(); ui.results.classList.add('hidden'); setRoute(route.key === 'sea' ? 'field' : 'sea', true, () => startGame()); });
$('resMenuBtn').addEventListener('click', () => { snd.click(false); goTitle(); });
document.querySelectorAll('#albTabs [data-atab]').forEach(b => b.addEventListener('click', () => { snd.click(); renderAlbum(b.dataset.atab); }));
ui.muteBtn.addEventListener('click', () => toggleMute());
ui.bellBtn.addEventListener('pointerdown', e => { e.preventDefault(); if (!paused) { snd.init(); ringBell(); } });
ui.bellBtn.addEventListener('click', e => e.preventDefault());
ui.photoBtn.addEventListener('pointerdown', e => { e.preventDefault(); snd.init(); takePhoto(); });
ui.photoBtn.addEventListener('click', e => e.preventDefault());
ui.photoBtn.innerHTML = ICON_CAM + '<span>拍照</span>';
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (state === 'play') setPaused(true); snd.setHidden(true); persist(); }
  else snd.setHidden(false);
});
window.addEventListener('pagehide', () => persist());

window.addEventListener('keydown', e => {
  if (e.repeat && ['KeyP', 'Escape', 'KeyB', 'KeyC', 'KeyM', 'Enter'].includes(e.code)) return;
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!ui.album.classList.contains('hidden')) { if (e.code === 'Escape') { snd.click(false); closeAlbum(); } return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (state === 'title') { if (e.code === 'Enter' || e.code === 'Space') { snd.click(); startGame(); } return; }
  if (state === 'finished') { if (e.code === 'Enter' && !ui.results.classList.contains('hidden')) { snd.click(); startGame(); } return; }
  if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!paused); snd.click(!paused); }
  else if (paused && (e.code === 'Enter' || e.code === 'Space')) { setPaused(false); snd.click(); }
  else if (e.code === 'KeyB' && !paused) ringBell();
  else if (e.code === 'KeyC' && !paused) takePhoto();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// audio may only start after a user gesture (autoplay policy)
const unlockAudio = () => { snd.init(); };
for (const ev of ['pointerdown', 'keydown', 'touchend', 'click']) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });

// ---------------------------------------------------------------- toast / flash
let toastTimer = 0;
function toast(text, img = null, ms = 2600) {
  ui.toast.innerHTML = (img ? `<img alt="" src="${img}">` : '') + `<span>${text}</span>`;
  ui.toast.classList.remove('hidden', 'show'); void ui.toast.offsetWidth; ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}
function flash() { ui.flash.classList.remove('on'); void ui.flash.offsetWidth; ui.flash.classList.add('on'); }

// ---------------------------------------------------------------- progress bar
function buildProgressMarks() {
  ui.pmarks.innerHTML = LANDMARKS[route.key].map(lm =>
    `<i class="pmk${getPostcard(route.key, lm.id) ? ' got' : ''}${ride.photos.has(lm.id) ? ' now' : ''}" style="left:${lm.frac * 100}%" title="${lm.name}"></i>`).join('');
}
function playerIndex() { return Math.floor((position + PLAYER_Z) / SEG); }
function updateProgress() {
  const idx = playerIndex(), f = clamp((idx - START_IDX) / (JOURNEY - START_IDX), 0, 1);
  ui.pfill.style.width = `${f * 100}%`; ui.pme.style.left = `${f * 100}%`;
  const next = LANDMARKS[route.key].find(lm => lmIndex(lm) + ZONE_AFTER > idx);
  const m = i => Math.max(0, (i - idx) * SEG * M_PER_UNIT);
  if (ride.zone) ui.pnext.innerHTML = `<b>${ride.zone.name}</b> · 拍张明信片吧`;
  else if (next) ui.pnext.innerHTML = `下一站 <b>${next.name}</b> · ${Math.round(m(lmIndex(next)))} 米`;
  else ui.pnext.innerHTML = `<b>终点</b> · ${Math.round(m(JOURNEY))} 米`;
}

// ---------------------------------------------------------------- photo spots & postcards
function updatePhotoBtn() {
  const lm = state === 'play' ? ride.zone : null;
  ui.photoBtn.classList.toggle('hidden', !lm);
  if (lm) {
    const have = !!getPostcard(route.key, lm.id);
    ui.photoBtn.classList.toggle('pulse', !ride.photos.has(lm.id));
    ui.photoBtn.querySelector('span').textContent = ride.photos.has(lm.id) || have ? '再拍一张' : '拍照';
  }
}
function checkZone(idx) {
  const lm = LANDMARKS[route.key].find(l => idx >= lmIndex(l) - ZONE_BEFORE && idx <= lmIndex(l) + ZONE_AFTER) || null;
  if (lm === ride.zone) return;
  ride.zone = lm;
  updatePhotoBtn();
  if (lm) {
    toast(`「${lm.name}」到啦 · 拍张明信片吧`);
    snd.success();
    if (Math.random() < 0.7) spawnFollowers(1 + Math.floor(Math.random() * 2));
  }
}
function makePostcardImage(lm) {
  const PW = 320, PH = 200, B = 8, CAP = 24;
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const g = c.getContext('2d');
  g.fillStyle = '#fffaf0'; g.fillRect(0, 0, PW, PH);
  const iw = PW - 2 * B, ih = PH - 2 * B - CAP, ar = iw / ih;
  const cw = canvas.width, ch = canvas.height;
  // frame = union of rider box and landmark box (CSS px), padded, fitted to the postcard aspect
  let x0 = W / 2 - 80 * RIDER_S, x1 = W / 2 + 80 * RIDER_S, y0 = RIDER_Y - 285 * RIDER_S, y1 = RIDER_Y + 6;
  const seg = segments[lmIndex(lm)], main = seg && seg.sprites.find(sp => sp.name === LM_SPRITE[lm.id]);
  if (main && seg.vis && seg.p1.camera.z > CAM_DEPTH) {
    const p = seg.p1.screen, spr = SPR[main.name], dh = spr.worldH * p.scale * S / 2, dw = dh * spr.w / spr.h;
    const cx = p.x + p.w * main.offset;
    x0 = Math.min(x0, cx - dw * 0.55); x1 = Math.max(x1, cx + dw * 0.55); y0 = Math.min(y0, p.y - dh * 1.05);
  }
  y0 = Math.min(y0, HY - H * 0.1);       // keep a strip of sky / horizon for a scenic shot
  x0 = Math.max(0, x0); x1 = Math.min(W, x1); y0 = Math.max(0, y0); y1 = Math.min(H, y1);
  let bw = (x1 - x0) * 1.12, bh = (y1 - y0) * 1.08;
  if (bw / bh < ar) bw = bh * ar; else bh = bw / ar;
  bw = Math.max(bw, W * 0.6); bh = bw / ar;
  if (bh > H) { bh = H; bw = bh * ar; } if (bw > W) { bw = W; bh = bw / ar; }
  const fx = (x0 + x1) / 2, fy = (y0 + y1) / 2;
  const sw = bw * DPR, sh = bh * DPR;
  const sx = clamp(fx * DPR - sw / 2, 0, cw - sw), sy = clamp(fy * DPR - sh / 2, 0, ch - sh);
  g.drawImage(canvas, sx, sy, sw, sh, B, B, iw, ih);
  // stamp
  g.save(); g.translate(PW - B - 34, B + 6);
  g.fillStyle = '#fffaf0'; g.fillRect(0, 0, 28, 32);
  g.strokeStyle = '#ff7a45'; g.setLineDash([2, 2]); g.lineWidth = 1.5; g.strokeRect(1, 1, 26, 30); g.setLineDash([]);
  g.fillStyle = route.key === 'sea' ? '#5dbfe8' : '#9ad37a'; g.fillRect(4, 18, 20, 10);
  g.fillStyle = '#ffd84d'; circ(g, 14, 12, 5); g.fill();
  g.restore();
  g.fillStyle = '#3d5562'; g.font = `800 13px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(`${lm.name} · ${route.name}`, B + 2, PH - B - CAP / 2 + 1);
  g.fillStyle = '#8aa4b0'; g.font = `600 10px ${FONT}`; g.textAlign = 'right';
  g.fillText(`鹈鹕骑行 · ${fmtDate(Date.now())}`, PW - B - 2, PH - B - CAP / 2 + 1);
  let url = c.toDataURL('image/jpeg', 0.72);
  if (url.length > 60000) url = c.toDataURL('image/jpeg', 0.5);
  return url;
}
const LM_SPRITE = { icecream: 'icecream', volley: 'volley', pier: 'pier', lighthouse: 'lighthouse', sunflower: 'sign_sunflower', barn: 'barn', windmill: 'windmill', orchard: 'applecart' };
function takePhoto() {
  if (state !== 'play' || paused) return;
  const lm = ride.zone;
  if (!lm) { toast('附近没有拍照点哦'); return; }
  render(true);                         // a clean frame (no on-screen controls) for the postcard
  const img = makePostcardImage(lm);
  flash(); snd.shutter();
  const ok = storePostcard(route.key, lm.id, img);
  ride.photos.add(lm.id); counters.photos++;
  buildProgressMarks(); updatePhotoBtn();
  toast(ok ? `获得明信片「${lm.name}」` : '存储空间不足，明信片没能保存', img, 3000);
  setTimeout(() => snd.success(), 350);
}

// ---------------------------------------------------------------- album
let albumTab = 'sea';
function openAlbum(tab = route.key) {
  if (state === 'play' && !paused) setPaused(true);
  renderAlbum(tab);
  ui.album.classList.remove('hidden');
}
function closeAlbum() { ui.album.classList.add('hidden'); }
function renderAlbum(tab) {
  albumTab = tab;
  document.querySelectorAll('#albTabs [data-atab]').forEach(b => b.classList.toggle('active', b.dataset.atab === tab));
  const best = k => (save.best[k] ? fmtTime(save.best[k]) : '—');
  ui.albStats.innerHTML =
    `<span>累计里程 <b>${fmtDist(save.totalDist)}</b></span><span>金币 <b>${save.coins}</b></span>` +
    `<span>明信片 <b>${postcardCount()}/${POSTCARD_TOTAL}</b></span><span>最佳 海边 <b>${best('sea')}</b> · 田野 <b>${best('field')}</b></span>`;
  ui.albGrid.innerHTML = LANDMARKS[tab].map(lm => {
    const pc = getPostcard(tab, lm.id);
    return pc
      ? `<figure class="pc got"><img alt="${lm.name}" src="${pc.img}"><figcaption><b>${lm.name}</b><small>${fmtDate(pc.t)}</small></figcaption></figure>`
      : `<figure class="pc"><div class="ph">${ICON_CAM}<span>未收集</span></div><figcaption><b>${lm.name}</b><small>骑到这里拍照</small></figcaption></figure>`;
  }).join('');
}
function updateTotals() {
  ui.totals.innerHTML = `累计 <b>${fmtDist(save.totalDist)}</b> · 金币 <b>${save.coins}</b> · 明信片 <b>${postcardCount()}/${POSTCARD_TOTAL}</b>`;
}

// ---------------------------------------------------------------- ride lifecycle
let distance = 0;
function resetRide() {
  position = 0; playerX = 0; distance = 0;
  ride.time = 0; ride.coins = 0; ride.photos = new Set(); ride.zone = null; ride.collisions = 0; ride.warped = false;
  ride.lastIdx = playerIndex();
  for (const s of segments) if (s.items) for (const it of s.items) it.taken = false;
  followers.length = 0; particles.length = 0; followTimer = 18;
  buildProgressMarks(); updatePhotoBtn(); updateProgress();
}
function startGame() {
  closeAlbum();
  ui.results.classList.add('hidden');
  state = 'play';
  document.body.classList.add('playing'); document.body.classList.remove('finished');
  ui.title.classList.add('hidden'); ui.hud.classList.remove('hidden');
  resetRide();
  speed = 0;
  if (targetSpeed < 0.05) targetSpeed = 0.5;
  setPaused(false);
  toast(`${route.full} · 出发！`, null, 1800);
}
function finishRide() {
  state = 'finished';
  document.body.classList.remove('playing'); document.body.classList.add('finished');
  joy.id = null; joy.kx = joy.ky = 0; slider.id = null;
  ride.zone = null; updatePhotoBtn();
  const time = ride.time, prev = save.best[route.key], isNew = !ride.warped && (!prev || time < prev);
  if (isNew) save.best[route.key] = time;
  save.rides[route.key] = (save.rides[route.key] || 0) + 1;
  persist();
  $('resTitle').textContent = `${route.full} 完成！`;
  $('resTime').textContent = fmtTime(time);
  $('resDist').textContent = fmtDist(distance);
  $('resAvg').textContent = `${(distance / Math.max(1, time) * 3.6).toFixed(1)} km/h`;
  $('resPc').textContent = `${ride.photos.size} / ${LANDMARKS[route.key].length}`;
  $('resCoins').textContent = `+${ride.coins}`;
  $('resBest').textContent = save.best[route.key] ? fmtTime(save.best[route.key]) : '—';
  $('resNew').classList.toggle('hidden', !isNew || !prev);
  $('resThumbs').innerHTML = LANDMARKS[route.key].map(lm => {
    const pc = ride.photos.has(lm.id) && getPostcard(route.key, lm.id);
    return pc ? `<img alt="${lm.name}" title="${lm.name}" src="${pc.img}">` : `<span class="miss" title="${lm.name}">${lm.name}</span>`;
  }).join('');
  $('switchBtn').textContent = route.key === 'sea' ? '换田野路线' : '换海边路线';
  snd.fanfare();
  for (let i = 0; i < 70; i++) particles.push({ kind: 'confetti', x: Math.random() * W, y: -Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 40, vy: 60 + Math.random() * 90, life: 4 + Math.random() * 2, age: 0, c: ['#ff7b6b', '#ffd84d', '#2bb3a6', '#ff8fb1', '#7cc9ea'][i % 5], r: Math.random() * 6 });
  setTimeout(() => { if (state === 'finished') ui.results.classList.remove('hidden'); }, 1100);
}

function positionBell() {
  if (typeof ui === 'undefined' || !ui.bellBtn) return;
  const r = clamp(slider.w * 0.58, 22, 28);
  const bt = slider.top - slider.w * 0.38 - 22 - r * 2;
  ui.bellBtn.style.width = ui.bellBtn.style.height = `${r * 2}px`;
  ui.bellBtn.style.left = `${slider.x - r}px`;
  ui.bellBtn.style.top = `${bt}px`;
  ui.photoBtn.style.right = `${Math.max(8, W - (slider.x + r + 6))}px`;
  ui.photoBtn.style.top = `${bt - 12 - 44}px`;
}

// ---------------------------------------------------------------- followers (gulls / little birds) & particles
const followers = [], particles = [];
let followTimer = 18;
function spawnFollowers(n) {
  if (followers.length >= 3) return;
  for (let i = 0; i < n; i++) followers.push({ side: Math.random() < 0.5 ? -1 : 1, ox: (Math.random() * 2 - 1), oy: Math.random(), ph: Math.random() * 6, age: -i * 0.6, life: 9 + Math.random() * 5 });
  snd.follower();
}
function drawFollower(f) {
  const enter = clamp(f.age / 2, 0, 1), ex = f.age > f.life ? (f.age - f.life) / 2.2 : 0;
  if (f.age < 0) return;
  const e = enter * enter * (3 - 2 * enter);
  const s = RIDER_S * 0.9;
  let x = W / 2 + (f.ox * 120 + Math.sin(t * 0.7 + f.ph) * 34) * RIDER_S;
  let y = RIDER_Y - (330 + f.oy * 70 + Math.sin(t * 1.3 + f.ph) * 12) * RIDER_S;
  x += f.side * ((1 - e) + ex) * W * 0.7; y -= ((1 - e) * 0.4 + ex) * H * 0.3;
  const flap = Math.sin(t * (route.key === 'sea' ? 7 : 16) + f.ph);
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  if (route.key === 'sea') { // seagull
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = C.out; ctx.lineWidth = 2;
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(sd * 16, -10 - flap * 12, sd * 34, -4 - flap * 18); ctx.quadraticCurveTo(sd * 18, 4, 0, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5b6f7a'; ctx.beginPath(); ctx.moveTo(sd * 26, -2 - flap * 14); ctx.lineTo(sd * 34, -4 - flap * 18); ctx.lineTo(sd * 24, 2 - flap * 10); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#ffffff'; }
    ell(ctx, 0, 2, 9, 7); fillStroke(ctx, '#ffffff', C.out, 2);
    circ(ctx, 0, -6, 6); fillStroke(ctx, '#ffffff', C.out, 2);
    ctx.fillStyle = '#ffb347'; poly(ctx, [-2, -6, 2, -6, 0, -12]); ctx.fill();
  } else {                  // little round songbird
    for (const sd of [-1, 1]) { ell(ctx, sd * 10, -2 - flap * 4, 9, 4 + Math.abs(flap) * 2, sd * (0.4 + flap * 0.5)); fillStroke(ctx, '#6aa9e8', C.out, 1.6); }
    circ(ctx, 0, 0, 10); fillStroke(ctx, '#7cc0f0', C.out, 2);
    ell(ctx, 0, 4, 6, 5); fillStroke(ctx, '#ffd84d', null);
    ctx.fillStyle = '#5b6f7a'; poly(ctx, [-3, 8, 3, 8, 0, 14]); ctx.fill();
  }
  ctx.restore();
}
function updateFx(dt) {
  for (let i = followers.length - 1; i >= 0; i--) { const f = followers[i]; f.age += dt; if (f.age > f.life + 2.4) followers.splice(i, 1); }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]; p.age += dt; p.x += (p.vx || 0) * dt; p.y += p.vy * dt;
    if (p.kind === 'confetti') p.r += dt * 5;
    if (p.age > p.life) particles.splice(i, 1);
  }
}
function drawParticles() {
  for (const p of particles) {
    const a = clamp(1 - p.age / p.life, 0, 1);
    ctx.globalAlpha = Math.min(1, a * 2);
    if (p.kind === 'confetti') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-4, -2.5, 8, 5); ctx.restore(); }
    else {
      const fs = Math.round(clamp(20 * RIDER_S, 13, 26));
      ctx.font = `900 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.c; ctx.fillText(p.text, p.x, p.y);
      if (p.kind === 'boing') for (let k = 0; k < 3; k++) { const an = t * 6 + k * 2.1; ctx.fillStyle = '#ffd84d'; circ(ctx, p.x + Math.cos(an) * fs, p.y + 10 + Math.sin(an) * fs * 0.4, 3.5); ctx.fill(); }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- pickups & gentle collisions
let collCool = 0, bounceV = 0, wobble = 0;
const RIDER_HALF = 0.1;
function collect(it) {
  it.taken = true; ride.coins++; save.coins++; counters.pickups++;
  snd.chime(ride.coins);
  particles.push({ kind: 'text', text: '+1', c: '#f2a900', x: W / 2 + 40 * RIDER_S, y: RIDER_Y - 200 * RIDER_S, vy: -60, life: 0.9, age: 0 });
}
function bump(off) {
  const dir = playerX >= off ? 1 : -1;
  bounceV = dir * 1.5; speed *= 0.5; wobble = 1; collCool = 0.7;
  ride.collisions++; counters.collisions++;
  snd.boing();
  particles.push({ kind: 'boing', text: '咚～', c: '#ff7a45', x: W / 2 + dir * -50 * RIDER_S, y: RIDER_Y - 280 * RIDER_S, vy: -30, life: 0.9, age: 0 });
}
function scanSegments(a, b) {
  const N = segments.length;
  if (b - a > 60) a = b - 60;
  for (let i = a; i <= b; i++) {
    const seg = segments[((i % N) + N) % N];
    if (seg.items) for (const it of seg.items) if (!it.taken && Math.abs(it.offset - playerX) < 0.2) collect(it);
    if (collCool > 0) continue;
    for (const sp of seg.sprites) {
      const w = solidW(sp);
      if (w && Math.abs(playerX - sp.offset) < w / 2 / ROAD_W + RIDER_HALF) { bump(sp.offset); break; }
    }
    if (collCool <= 0 && (seg.fence & 1) && playerX < -1.3) bump(-1.38);
    if (collCool <= 0 && (seg.fence & 2) && playerX > 1.3) bump(1.38);
  }
}

// ============================================================ simulation
let t = 0, crank = 0, wheel = 0, lean = 0, steer = 0, yaw = 0.6, shake = 0, offroad = false;
let curSegCurve = 0, lastTick = 0;
function update(dt) {
  t += dt;
  const pSeg = findSegment(position + PLAYER_Z);
  curSegCurve = pSeg.curve;
  let sp = speed / MAX_SPEED;
  // --- input
  let inSteer = 0;
  if (state === 'play') {
    const kL = keys.ArrowLeft || keys.KeyA, kR = keys.ArrowRight || keys.KeyD;
    if (joy.id !== null) { const v = joy.kx / (joy.r * 0.8); inSteer = Math.abs(v) < 0.08 ? 0 : v; }
    else inSteer = (kR ? 1 : 0) - (kL ? 1 : 0);
    if (keys.ArrowUp || keys.KeyW) targetSpeed = Math.min(1, targetSpeed + dt * 0.55);
    if (keys.ArrowDown || keys.KeyS) targetSpeed = Math.max(0, targetSpeed - dt * 0.7);
  } else {
    // title-screen autopilot / finish coast: keep to the middle of the path
    inSteer = clamp(sp * pSeg.curve * CENTRIFUGAL / (1.6 * Math.min(1, sp * 1.5) + 1e-3) - playerX * 1.2, -1, 1);
    if (state === 'title') targetSpeed = 0.45;
  }
  steer = approach(steer, inSteer, 10, dt);
  // --- speed
  offroad = Math.abs(playerX) > OFFROAD;
  let maxT = state === 'finished' ? 0 : targetSpeed * MAX_SPEED;
  if (offroad) maxT = Math.min(maxT, MAX_SPEED * 0.25);
  speed = approach(speed, maxT, speed < maxT ? 0.75 : (offroad ? 2.2 : (state === 'finished' ? 1.3 : 0.9)), dt);
  if (speed < 1) speed = 0;
  sp = speed / MAX_SPEED;
  const dz = speed * dt;
  position += dz;
  if (state === 'title') position %= trackLength;
  else position = Math.min(position, trackLength - SEG * 2);
  if (state === 'play') {
    const dm = dz * M_PER_UNIT;
    distance += dm; save.totalDist += dm; ride.time += dt;
    saveTimer += dt; if (saveTimer > 5) { saveTimer = 0; persist(); }
  }
  // --- lateral: steering vs. curve push (+ soft bounce after a bump)
  playerX += steer * 1.6 * Math.min(1, sp * 1.5) * dt;
  playerX -= CENTRIFUGAL * pSeg.curve * sp * sp * dt;
  playerX += bounceV * dt; bounceV = approach(bounceV, 0, 5, dt);
  const minX = route.key === 'sea' ? -(shoreAt(pSeg.index) - 0.35) : -2.4;
  playerX = clamp(playerX, minX, 2.4);
  // --- journey logic: pickups, bumps, photo zones, finish
  collCool -= dt; wobble = Math.max(0, wobble - dt * 1.3);
  if (state === 'play') {
    const idx = playerIndex();
    if (idx > ride.lastIdx) { scanSegments(ride.lastIdx + 1, idx); ride.lastIdx = idx; }
    checkZone(idx);
    followTimer -= dt;
    if (followTimer <= 0) { followTimer = 28 + Math.random() * 18; if (!followers.length) spawnFollowers(1 + Math.floor(Math.random() * 2)); }
    if (idx >= JOURNEY) finishRide();
  }
  updateFx(dt);
  // --- background parallax
  const segMoved = dz / SEG;
  bgOff.sky += 0.0006 * pSeg.curve * segMoved;
  bgOff.far += 0.0012 * pSeg.curve * segMoved;
  bgOff.near += 0.0022 * pSeg.curve * segMoved;
  // --- animation
  crank += dt * sp * 11;
  wheel += dt * Math.min(sp * 24, 20);
  const leanT = steer * 0.16 * Math.min(1, sp * 2.2) + pSeg.curve * sp * 0.012;
  lean = approach(lean, leanT, 6, dt);
  const yawT = clamp(0.62 + steer * 1.3, -0.75, 0.75);
  yaw = approach(yaw, Math.abs(yawT) < 0.2 ? Math.sign(yawT || 1) * 0.2 : yawT, 5, dt);
  shake = offroad && sp > 0.02 ? (Math.random() - 0.5) * 3 * Math.min(1, sp * 4) : 0;
  bellAnim = Math.max(0, bellAnim - dt * 1.1);
  // --- sound hooks: chain ticks follow the crank (6 per revolution), wind follows speed
  const tk = Math.floor(crank / (TAU / 6));
  if (tk !== lastTick) { lastTick = tk; snd.tick(sp); }
  snd.update(sp);
}

// ============================================================ loop
let hudTimer = 0;
function drawBellBubble() {
  if (bellAnim <= 0) return;
  const a = Math.min(1, bellAnim * 2.5), rise = (1 - bellAnim) * 30;
  const x = W / 2 + 70 * RIDER_S, y = RIDER_Y - 250 * RIDER_S - rise;
  const fs = Math.round(clamp(18 * RIDER_S * 1.1, 13, 24));
  ctx.save(); ctx.globalAlpha = a;
  ctx.font = `800 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText('叮铃～').width + fs;
  rrect(ctx, x - w / 2, y - fs * 0.85, w, fs * 1.7, fs * 0.85); fillStroke(ctx, '#fffaf0', 'rgba(255,170,60,0.9)', 2.5);
  ctx.fillStyle = '#ff8a3d'; ctx.fillText('叮铃～', x, y + 1);
  ctx.restore();
}
function render(clean = false) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground(t);
  renderRoad(t);
  for (const f of followers) drawFollower(f);
  const wob = Math.sin(t * 22) * 0.13 * wobble;
  drawRider(ctx, W / 2, RIDER_Y, RIDER_S, { crank, wheel, lean: lean + wob, steer, yaw, speed: speed / MAX_SPEED, t, shake: shake + wob * 8 });
  if (clean) return;
  drawParticles();
  drawBellBubble();
  if (state === 'play' && !paused) drawControls();
}
function updateHud(dt) {
  hudTimer -= dt; if (hudTimer > 0) return; hudTimer = 0.1;
  ui.spd.textContent = Math.round(speed / MAX_SPEED * KMH_MAX);
  ui.dist.textContent = fmtDist(distance);
  ui.time.textContent = fmtTime(ride.time);
  ui.coins.textContent = ride.coins;
  if (state !== 'title') updateProgress();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  if (!paused) update(dt);   // paused: simulation + animation clock frozen, scene redrawn as a still
  render();
  updateHud(dt);
  requestAnimationFrame(frame);
}

// debug/inspection hook (used by automated tests)
window.__pelican = {
  get stats() {
    return { state, paused, route: route.key, speedKmh: speed / MAX_SPEED * KMH_MAX, target: targetSpeed, playerX, distance, offroad, curve: curSegCurve, t,
      idx: playerIndex(), journey: JOURNEY, rideTime: ride.time, rideCoins: ride.coins, zone: ride.zone && ride.zone.id, photosThisRide: [...ride.photos],
      collisions: counters.collisions, pickups: counters.pickups, followers: followers.length, save: JSON.parse(JSON.stringify(save)) };
  },
  get audio() { return snd.stats(); },
  get layout() { return { W, H, joy: { x: joy.x, y: joy.y, r: joy.r }, slider: { x: slider.x, top: slider.top, bottom: slider.bottom, w: slider.w } }; },
  debug: {
    warp(frac) { ride.warped = true; position = Math.max(0, Math.round(frac * JOURNEY) * SEG - PLAYER_Z); ride.lastIdx = playerIndex(); },
    warpToLandmark(i, before = 40) { ride.warped = true; const lm = LANDMARKS[route.key][i]; position = (lmIndex(lm) - before) * SEG - PLAYER_Z; ride.lastIdx = playerIndex(); },
    setX(x) { playerX = x; },
    warpIdx(i) { ride.warped = true; position = Math.max(0, i * SEG - PLAYER_Z); ride.lastIdx = playerIndex(); },
    nextSolid(ahead = 6) {
      const i0 = playerIndex() + ahead;
      for (let i = i0; i < i0 + 400 && i < segments.length; i++) for (const sp of segments[i].sprites) if (solidW(sp) && Math.abs(sp.offset) <= 2.3) return { idx: i, offset: sp.offset, name: sp.name };
      return null;
    },
    nextItem(ahead = 6) {
      const i0 = playerIndex() + ahead;
      for (let i = i0; i < i0 + 600 && i < segments.length; i++) if (segments[i].items) for (const it of segments[i].items) if (!it.taken) return { idx: i, offset: it.offset };
      return null;
    },
  },
};

// ============================================================ boot
buildSprites();
buildJourneySprites();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();
setRoute('sea', false);
syncPauseBtn(); syncMuteBtn(); updateTotals();
speed = MAX_SPEED * 0.4;
requestAnimationFrame(frame);
})();
