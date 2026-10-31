// Orbital Archive renderer.
// One WebGL scene sits behind the homepage, in three layers:
//   far    – nebulae, a distant stellar stream and galaxy, the sky
//   middle – an immense spiral vortex (ray/plane intersection, so it shares the
//            exact perspective of the orbits) with fading gravitational arcs
//   near   – the star, four orbiting planets and a few out-of-focus motes
//   outer  – a gas giant on a vast orbit with the wreck of its shattered moon,
//            which the camera rides along with, so they frame the whole scene
// The planets stay real <button>s: every frame this file projects each orbit,
// moves its button over the rendered body and places its label away from
// collisions, so clicks, focus and keyboard navigation never depend on the canvas.
// Without WebGL the same projection drives a light 2D fallback.
(() => {
'use strict';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const body = document.body;
let canvas = document.getElementById('cosmos');
const starAnchor = document.getElementById('starAnchor');
if (!canvas) return;

// ---------------------------------------------------------------------------
// Configuration. Orbits are listed inner → outer; every value is a design knob.
// a: semi-major axis · e: eccentricity · incl/node: orbital plane (degrees)
// phase: start angle (rad) · period: seconds per revolution · dir: ±1
// radius: planet size · spin: seconds per axial turn · tilt: axial tilt (degrees)
const PLANETS = [
  {world:'academic', a:1.34, e:.05, incl:1.6, node:12, phase:.35, period:90, dir:1, radius:.165, spin:48, tilt:16,
    look:{c1:'#10291f', c2:'#3f6b52', c3:'#9fb38a', atm:'#78c9b2', bands:.08, ice:0, clouds:.18, spec:.10, freq:3.4, seed:3.1}},
  {world:'about', a:1.98, e:.07, incl:-2.2, node:74, phase:2.45, period:110, dir:1, radius:.19, spin:62, tilt:-12,
    look:{c1:'#3d2114', c2:'#a8703f', c3:'#d9b07a', atm:'#ffb57c', bands:.78, ice:0, clouds:0, spec:.04, freq:2.4, seed:7.4}},
  {world:'portfolio', a:2.74, e:.045, incl:2.8, node:146, phase:4.15, period:120, dir:1, radius:.215, spin:54, tilt:22,
    look:{c1:'#0c2d33', c2:'#3c807d', c3:'#a5d0c4', atm:'#86dbe0', bands:.16, ice:0, clouds:.3, spec:.42, freq:2.9, seed:11.8}},
  {world:'archive', a:3.6, e:.06, incl:-1.6, node:204, phase:5.55, period:160, dir:1, radius:.2, spin:80, tilt:-24,
    look:{c1:'#1c3350', c2:'#6f8fae', c3:'#e2edf4', atm:'#a6c8ee', bands:.05, ice:.85, clouds:.62, spec:.22, freq:3.1, seed:5.6}}
];
const STAR = {radius:.27, extent:9};
const OUTER = PLANETS[PLANETS.length - 1].a;
const DUST_SPIN = .045;   // rad/s of dust at r = 1.3, Keplerian falloff
const ARM_SPIN = .007;    // rad/s of the spiral density wave (rigid)
const FLOW_TRAIL = 2.6;   // seconds of orbital motion each flow streak spans
const ARM_PITCH = 2.3;    // logarithmic spiral winding

// Secondary gravitational structures: open arcs that fade into darkness at both ends.
// [a, e, incl, node, start°, span°, alpha, tint (0 warm … 1 cool)]
const ARCS = [
  [5.3, .05, 3.2, 20, 150, 240, .2, .15],
  [8.8, .07, -4.5, 110, 200, 210, .15, .6],
  [15, .06, 6.5, 250, 110, 190, .11, 1]
];

// Composition per viewport class: star position (lens shift, NDC), horizontal fit of
// the outermost planet orbit, camera elevation/roll, FOV and body scale.
// giant frames the outer gas giant: where its centre should sit on screen (x, y in
// NDC) and its apparent radius r (NDC height units). placeGiant() turns that into a
// real orbit in the system plane; nothing about it is drawn in screen space.
// moon, chunks and stream frame the wreck of a shattered moon in the same way:
// moon {x, y, r, depth} · chunks [x, y, depth, r, defocus] · stream: three NDC
// points of the curve along which smaller wreckage trails from the moon to the giant.
// depth is a fraction of the camera's distance to the star; small depth = near.
function composition(w, h) {
  const aspect = w / h;
  if (aspect < .9 || w <= 560) return {sx:0, sy:-.2, fit:.9, el:40, roll:-7, fov:46, scale:2.05,
    giant:{x:1.02, y:-1.26, r:.8},
    moon:{x:-1.02, y:-.78, r:.22, depth:.55},
    chunks:[[1.05, .1, .3, .065, .1], [-.7, -.84, .5, .024, 0], [-.58, -.72, .52, .016, 0], [.5, -.88, .45, .022, 0]],
    stream:[[-.8, -.8], [0, -1.0], [.62, -.84]]};
  if (aspect < 1.3) return {sx:.08, sy:-.16, fit:.8, el:24, roll:-10, fov:40, scale:1.7,
    giant:{x:1.0, y:-1.2, r:1.0},
    moon:{x:1.0, y:.98, r:.36, depth:.55},
    chunks:[[1.03, .3, .26, .12, .12], [.6, .66, .5, .04, 0], [.76, .5, .52, .028, 0], [.6, -.8, .42, .04, 0]],
    stream:[[.78, .68], [1.2, .02], [.7, -.68]]};
  return {sx:.29, sy:-.06, fit:.65, el:22, roll:-12, fov:36, scale:1.6,
    giant:{x:1.06, y:-1.34, r:1.0},
    moon:{x:.93, y:.9, r:.44, depth:.55},
    chunks:[[1.0, .32, .26, .15, .14], [.4, 1.07, .3, .1, .1],
      [.66, .64, .5, .045, 0], [.78, .5, .52, .03, 0], [.56, .82, .5, .028, 0], [.88, .4, .55, .022, 0],
      [.62, -.74, .42, .04, 0], [.82, -.58, .48, .028, 0]],
    stream:[[.8, .7], [1.25, .05], [.72, -.62]]};
}
const GIANT_PERIOD = 1800;   // seconds per revolution of the outer giant (and the camera riding with it)

// ---------------------------------------------------------------------------
// Math
const v3 = (x=0, y=0, z=0) => [x, y, z];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
const approach = (value, target, rate, dt) => value + (target - value) * (1 - Math.exp(-rate * dt));
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);

function orbitPoint(o, th, out = v3()) {
  const b = o.a * Math.sqrt(1 - o.e * o.e);
  const x = o.a * Math.cos(th), zr = b * Math.sin(th);
  const ci = Math.cos(o.incl * DEG), si = Math.sin(o.incl * DEG);
  const cn = Math.cos(o.node * DEG), sn = Math.sin(o.node * DEG);
  const y = zr * si, z = zr * ci;
  out[0] = x * cn - z * sn; out[1] = y; out[2] = x * sn + z * cn;
  return out;
}

let seed = 20261101;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rand(); return (s - 2) / .58; };
const armDensity = (r, th) => Math.pow(.5 + .5 * Math.cos(2 * (th - ARM_PITCH * Math.log(r))), 2.5);

// ---------------------------------------------------------------------------
// State
const planets = PLANETS.map(p => ({
  ...p, theta: p.phase, hover: 0, hoverTarget: 0, pos: v3(), screen: {x:0, y:0, z:1, r:0}, pr: 20,
  button: document.querySelector(`.system .planet[data-world="${p.world}"]`), lastR: -1, lastZ: -1,
  place: 'r', crowded: false, label: {w:90, h:34}
}));
const byWorld = Object.fromEntries(planets.map(p => [p.world, p]));
const cam = {pos:v3(), R:v3(1,0,0), U:v3(0,1,0), F:v3(0,0,-1), tan:.27, aspect:1, sx:0, sy:0, roll:0, D:12};
const pointer = {x:0, y:0, sx:0, sy:0};
const travel = {planet:null, k:0, from:0, to:0, start:0, duration:0, resolve:null};
let W = 1, H = 1, dpr = 1, comp = composition(innerWidth, innerHeight);
let orbitalClock = 0, driftClock = 0, globalMotion = 1, introStart = performance.now();
let last = performance.now(), dirty = true, quality = matchMedia('(max-width: 820px)').matches ? 1 : 0;
let frameEMA = 16, frameCount = 0;

// Living field: a slow stellar breath plus rare, calm events that reward a longer
// look — a halo swell, a wave of light through the dust, a streak across the sky.
const field = {breath:0, halo:0, waveR:0, waveA:0, streak:null};
const events = {
  halo:   {at:9,  dur:7,   gap:[26, 16]},
  wave:   {at:17, dur:11,  gap:[42, 22]},
  streak: {at:13, dur:1.7, gap:[24, 30]}
};
// Upper right sky only, so a streak never crosses the editorial text.
function streakPath() {
  const ang = Math.PI + (.18 + rand() * .3) * (rand() < .5 ? 1 : -1) * .6, len = .35 + rand() * .25;
  return {a:[.3 + rand() * .6, .5 + rand() * .4], d:[Math.cos(ang) * len, Math.sin(ang) * len - .12]};
}
events.streak.path = streakPath();
function updateField(t) {
  if (reducedMotion()) { Object.assign(field, {breath:0, halo:0, waveA:0, streak:null}); return; }
  field.breath = .5 + .5 * Math.sin(t * TAU / 11);
  Object.entries(events).forEach(([name, e]) => {
    if (t > e.at + e.dur) {
      e.at = t + e.gap[0] + rand() * e.gap[1];
      if (name === 'streak') e.path = streakPath();
    }
  });
  const k = name => { const e = events[name]; return (t - e.at) / e.dur; };
  const kh = k('halo'), kw = k('wave'), ks = k('streak');
  field.halo = kh > 0 && kh < 1 ? Math.pow(Math.sin(Math.PI * kh), 2) : 0;
  field.waveR = .4 + Math.max(kw, 0) * 13;
  field.waveA = kw > 0 && kw < 1 ? Math.min(kw / .08, 1) * (1 - kw) * .9 : 0;
  const path = events.streak.path;
  if (path && ks > 0 && ks < 1) {
    const head = ease(ks), tail = Math.max(0, head - .35 * Math.min(1, ks * 3));
    field.streak = {
      a:[path.a[0] + path.d[0] * head, path.a[1] + path.d[1] * head],
      b:[path.a[0] + path.d[0] * tail, path.a[1] + path.d[1] * tail],
      alpha:Math.sin(Math.PI * ks) * .55
    };
  } else field.streak = null;
}

// Outer gas giant: a real member of the system, on a circular orbit in the same plane
// and around the same star as the navigation planets, far larger in radius. The
// viewer rides along that orbit just behind it (the camera co-revolves at the same
// angular speed), so the giant stays close and stable in frame while the whole
// system slowly turns beyond it. Its apparent size comes from proximity alone.
const giant = {A:6, theta0:0, G:1, pos:v3(), screen:{x:0, y:0, z:1}, pr:0};
const giantAngle = () => TAU / GIANT_PERIOD * orbitalClock;
function placeGiant() {
  const g = comp.giant;
  cam.tan = Math.tan(comp.fov * DEG / 2); cam.aspect = W / H; cam.sx = comp.sx; cam.sy = comp.sy;
  setCameraFrame(v3(), baseDistance(), 0, comp.el * DEG, comp.roll * DEG);
  // Cast the ray through the wanted screen position down to the orbital plane.
  const dir = sub(restRay(g.x, g.y, 1), cam.pos);
  const z = -cam.pos[1] / dir[1];
  const P = restRay(g.x, g.y, z);
  giant.A = Math.hypot(P[0], P[2]);
  giant.theta0 = Math.atan2(P[2], P[0]);
  giant.G = g.r * z * cam.tan;
  giant.restZ = z;
  if (gl && progs.ring) buildGiantOrbit();
  placeWreck();
}
// World point at view depth `depth` behind NDC (x, y) of the resting camera.
function restRay(x, y, depth) {
  const qx = (x - comp.sx) * cam.tan * cam.aspect, qy = (y - comp.sy) * cam.tan;
  return [0, 1, 2].map(i => cam.pos[i] + (cam.F[i] + qx * cam.R[i] + qy * cam.U[i]) * depth);
}
const giantOrbit = () => ({a:giant.A, e:0, incl:0, node:0});

// Wreck of a moon the giant tore apart: the broken moon itself, chunks near and far,
// grit too small to resolve and fine dust lit by the star behind it. Half of the
// wreckage trails along the giant's orbit, half streams from the moon to the giant.
// It all travels with the giant (stored in the frame of the resting camera and
// turned with it every frame), so it holds its place while the system turns beyond.
const wreck = {moon:null, rocks:[], gritCount:0, hazeCount:0};
const coMove = (p, out = v3()) => {
  const a = -giantAngle(), c = Math.cos(a), s = Math.sin(a);
  out[0] = p[0] * c + p[2] * s; out[1] = p[1]; out[2] = -p[0] * s + p[2] * c;
  return out;
};
const isPortrait = () => W / H < .9 || W <= 560;

function placeWreck() {
  let s = 4021;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const G = () => { let t = 0; for (let i = 0; i < 4; i++) t += R(); return (t - 2) / .58; };
  const D = cam.D, m = comp.moon, mz = m.depth * D;
  const disc = (base, size, extra) => ({base, size, pos:v3(), screen:{x:0, y:0, z:1}, pr:0, ...extra});
  wreck.moon = disc(restRay(m.x, m.y, mz), m.r * mz * cam.tan);
  const rocks = comp.chunks.map(([x, y, depth, r, soft], i) =>
    disc(restRay(x, y, depth * D), r * depth * D * cam.tan, {soft, fg:r > .08, seed:3 + i * 1.37, spin:(R() - .5) * (r > .08 ? .012 : .05)}));

  const portrait = isPortrait(), pt = {}, gz = giant.restZ / D;
  const [a, b, c] = comp.stream;
  const stream = spread => {
    const u = R(), v = 1 - u, at = k => v * v * a[k] + 2 * u * v * b[k] + u * u * c[k];
    return restRay(at(0) + G() * spread, at(1) + G() * spread * .8, lerp(m.depth, gz, u) * (1 + G() * .12) * D);
  };
  const belt = () => {
    const th = giant.theta0 + (R() - .5) * 1.3, r = giant.A * (1 + G() * .03);
    return [Math.cos(th) * r, G() * giant.A * .012, Math.sin(th) * r];
  };
  // Keep wreckage on screen and off the editorial text.
  const sample = spread => {
    for (let k = 0; k < 24; k++) {
      const p = R() < .55 ? stream(spread) : belt();
      project(p, pt);
      const text = portrait ? pt.ny > .08 : pt.nx < -.26;
      if (pt.z > .6 && Math.abs(pt.nx) < 1.12 && Math.abs(pt.ny) < 1.12 && !text) return [p, pt.z];
    }
    return null;
  };
  const small = matchMedia('(max-width: 820px)').matches;
  for (let i = 0, n = small ? 14 : 26; i < n; i++) {
    const hit = sample(.06);
    if (hit) rocks.push(disc(hit[0], (.005 + Math.pow(R(), 3) * .026) * hit[1] * cam.tan, {soft:0, seed:20 + i * 2.31, spin:(R() - .5) * .08}));
  }
  wreck.rocks = rocks;

  // Grit: [x, y, z, world radius] + seed · haze: [x, y, z, brightness]
  const grit = [], haze = [];
  for (let i = 0, n = small ? 110 : 240; i < n; i++) {
    const hit = sample(.1);
    if (hit) grit.push(...hit[0], (.0016 + Math.pow(R(), 4) * .008) * hit[1] * cam.tan, R());
  }
  for (let i = 0, n = small ? 700 : 1600; i < n; i++) {
    const hit = sample(.16);
    if (hit) haze.push(...hit[0], .05 + Math.pow(R(), 3) * .3);
  }
  wreck.gritCount = grit.length / 5; wreck.hazeCount = haze.length / 4;
  if (gl && progs.grit) {
    [buffers.grit, buffers.haze].forEach(b => b && gl.deleteBuffer(b));
    buffers.grit = buffer(new Float32Array(grit)); buffers.haze = buffer(new Float32Array(haze));
  }
}

function updateWreck() {
  const t = driftClock, tmp = v3();
  [wreck.moon, ...wreck.rocks].forEach(o => {
    // Chunks bob and tumble very slowly around their places; the moon only turns with the giant.
    const w = o === wreck.moon ? 0 : o.size * .6, k = o.seed || 0, b = o.base;
    tmp[0] = b[0] + Math.sin(t * .03 + k) * w; tmp[1] = b[1] + Math.cos(t * .025 + k * 2) * w * .5; tmp[2] = b[2] + Math.sin(t * .028 + k * 3) * w;
    coMove(tmp, o.pos); project(o.pos, o.screen); o.pr = pxRadius(o.size, o.screen.z);
  });
  foreground = [giant, wreck.moon, ...wreck.rocks.filter(r => r.fg)];
}
let foreground = [];
const inForeground = (x, y) => foreground.some(o => Math.hypot(x - o.screen.x, y - o.screen.y) < o.pr);

const reducedMotion = () => body.dataset.motion === 'reduced';
const globallyPaused = () => body.classList.contains('orbits-paused') || reducedMotion();
const surfaceOpen = () => body.classList.contains('surface-open');

const baseDistance = () => OUTER / (comp.fit * Math.tan(comp.fov * DEG / 2) * (W / H)) * 1.04;

// Camera orbiting `target` at distance D; az = 0 looks along −z from the +z side.
function setCameraFrame(target, D, az, el, ro) {
  cam.D = D;
  cam.pos = [target[0] + D * Math.cos(el) * Math.sin(az), target[1] + D * Math.sin(el), target[2] + D * Math.cos(el) * Math.cos(az)];
  const F = norm(sub(target, cam.pos));
  const R0 = norm(cross(F, [0, 1, 0]));
  const U0 = cross(R0, F);
  const c = Math.cos(ro), s = Math.sin(ro);
  cam.F = F;
  cam.R = [R0[0]*c + U0[0]*s, R0[1]*c + U0[1]*s, R0[2]*c + U0[2]*s];
  cam.U = [U0[0]*c - R0[0]*s, U0[1]*c - R0[1]*s, U0[2]*c - R0[2]*s];
  cam.roll = ro;
}

function updateCamera(seconds) {
  const intro = reducedMotion() ? 1 : Math.min(seconds / 3.6, 1);
  cam.aspect = W / H; cam.tan = Math.tan(comp.fov * DEG / 2);
  const baseD = baseDistance();
  const still = reducedMotion();
  // The camera rides with the giant (co-revolving), so the giant stays put in frame.
  // Drift and pointer parallax stay small: the giant is close, so they move it most.
  const az = -giantAngle() + (still ? 0 : Math.sin(driftClock * .026) * .55 + pointer.sx * .5) * DEG;
  const el = (comp.el + (still ? 0 : Math.sin(driftClock * .023) * .25 + pointer.sy * .35) + 5 * (1 - ease(intro))) * DEG;

  const k = ease(travel.k);
  const target = travel.planet ? travel.planet.pos.map(c => c * k) : v3();
  const nearD = travel.planet ? travel.planet.radius * comp.scale * 9 : baseD;
  const D = baseD * Math.pow(nearD / baseD, k) * (1 + .3 * (1 - ease(intro)));
  cam.sx = comp.sx * (1 - k); cam.sy = comp.sy * (1 - k);
  setCameraFrame(target, D, az, el, comp.roll * DEG * (1 - k * .6));
}

function project(p, out) {
  const v = sub(p, cam.pos);
  const z = Math.max(dot(v, cam.F), .001);
  const nx = dot(v, cam.R) / (z * cam.tan * cam.aspect) + cam.sx;
  const ny = dot(v, cam.U) / (z * cam.tan) + cam.sy;
  out.x = (nx * .5 + .5) * W; out.y = (.5 - ny * .5) * H; out.z = z; out.nx = nx; out.ny = ny;
  return out;
}
const pxRadius = (r, z) => r / (z * cam.tan) * H / 2;

// ---------------------------------------------------------------------------
// Interaction wiring (hover/focus pause the planet under the pointer only)
function setHover(world, on) {
  const p = byWorld[world];
  if (!p) return;
  p.hoverTarget = on ? 1 : 0;
  p.button?.classList.toggle('is-hovered', on);
  dirty = true;
}
document.querySelectorAll('[data-world]').forEach(el => {
  const world = el.dataset.world;
  el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') setHover(world, true); });
  el.addEventListener('pointerleave', () => setHover(world, false));
  el.addEventListener('focus', () => setHover(world, true));
  el.addEventListener('blur', () => setHover(world, false));
});
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  pointer.x = (e.clientX / innerWidth - .5) * 2;
  pointer.y = (e.clientY / innerHeight - .5) * -2;
}, {passive:true});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

function animateTravel(planet, from, to, duration) {
  if (travel.resolve) travel.resolve();
  return new Promise(resolve => {
    Object.assign(travel, {planet, from, to, k:from, start:performance.now(), duration, resolve});
    // Navigation must never wait on rendering: if frames stall, finish on a timer.
    const finish = () => {
      if (travel.resolve !== resolve) return;
      travel.k = to; travel.resolve = null; dirty = true; resolve();
    };
    if (duration <= 0) finish(); else setTimeout(finish, duration + 250);
  });
}

window.cosmos = {
  // Camera glides into the chosen planet; resolves when the surface may appear.
  travel(world) {
    const p = byWorld[world];
    if (!p) return Promise.resolve();
    planets.forEach(q => { q.hoverTarget = q === p ? 1 : 0; });
    const instant = reducedMotion() || !gl;
    return animateTravel(p, travel.planet === p ? travel.k : 0, 1, instant ? 0 : 820);
  },
  // Camera pulls back out to the full system after a surface closes.
  arrive() {
    if (!travel.planet) return;
    const p = travel.planet;
    p.hoverTarget = 0; p.button?.classList.remove('is-hovered');
    animateTravel(p, travel.k, 0, reducedMotion() || !gl ? 0 : 1100).then(() => {
      if (travel.k === 0) travel.planet = null;
    });
  },
  invalidate() { dirty = true; }
};

// ---------------------------------------------------------------------------
// Label placement: each planet's label tries eight spots around its body and takes
// the one that collides least with other labels, bodies, the editorial column and
// the viewport edge. A switching cost keeps labels from flickering.
const PLACES = ['r', 'l', 'b', 't', 'tr', 'br', 'tl', 'bl'];
let obstacles = [];

function measureLabels() {
  planets.forEach(p => {
    const label = p.button?.querySelector('.planet-label');
    // Size the resting label only: the hover description is collapsed but still wide.
    if (label) p.label = {w: Math.max(...[...label.querySelectorAll('b, small')].map(el => el.offsetWidth)), h: label.offsetHeight};
  });
  obstacles = [...document.querySelectorAll('.orbit-copy h1, .orbit-intro, .site-header .identity, .site-header .header-actions')]
    .map(el => el.getBoundingClientRect())
    .filter(r => r.width && r.height)
    .map(r => ({x:r.left - 12, y:r.top - 8, w:r.width + 24, h:r.height + 16}));
}
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function labelRect(p, place) {
  const {x, y} = p.screen, {w, h} = p.label, g = 18;
  if (place === 'r') return {x:x + p.pr + g, y:y - h / 2, w, h};
  if (place === 'l') return {x:x - p.pr - g - w, y:y - h / 2, w, h};
  if (place === 'b') return {x:x - w / 2, y:y + p.pr + 11, w, h};
  if (place === 't') return {x:x - w / 2, y:y - p.pr - 11 - h, w, h};
  const dx = p.pr * .7 + 11, dy = p.pr * .7;
  if (place === 'tr') return {x:x + dx, y:y - dy - h, w, h};
  if (place === 'br') return {x:x + dx, y:y + dy, w, h};
  if (place === 'tl') return {x:x - dx - w, y:y - dy - h, w, h};
  return {x:x - dx - w, y:y + dy, w, h};
}

function placeLabels() {
  const portrait = W / H < .9 || W <= 560;
  const bias = portrait
    ? {b:0, t:.04, br:.05, bl:.05, tr:.07, tl:.07, r:.08, l:.1}
    : {r:0, l:.03, tr:.05, br:.05, b:.06, tl:.07, bl:.07, t:.08};
  const bodies = planets.map(p => ({x:p.screen.x - p.pr - 4, y:p.screen.y - p.pr - 4, w:p.pr * 2 + 8, h:p.pr * 2 + 8}));
  const sr = pxRadius(STAR.radius * Math.sqrt(comp.scale), starScreen.z) * 1.8 + 6;
  bodies.push({x:starScreen.x - sr, y:starScreen.y - sr, w:sr * 2, h:sr * 2 + 26});
  // The star's own name steps back whenever a planet crosses it.
  const starLabel = {x:starScreen.x - 34, y:starScreen.y + sr - 6, w:68, h:22};
  const occluded = bodies.slice(0, planets.length).some(o => overlap(starLabel, o) > 0);
  if (starAnchor && occluded !== starAnchor.classList.contains('is-occluded')) starAnchor.classList.toggle('is-occluded', occluded);
  const placed = [];
  const order = [...planets].sort((a, b) => (b.hover - a.hover) || (a.screen.z - b.screen.z));
  order.forEach(p => {
    const area = p.label.w * p.label.h;
    let best = null, bestScore = Infinity;
    PLACES.forEach(place => {
      const r = labelRect(p, place);
      let score = bias[place] * area + (place === p.place ? 0 : .12 * area);
      placed.forEach(o => { score += overlap(r, o) * 8; });
      bodies.forEach((o, i) => { if (planets[i] !== p) score += overlap(r, o) * (i < planets.length ? 8 : 5); });
      obstacles.forEach(o => { score += overlap(r, o) * 5; });
      // Keep labels off the foreground giant (sampled on a 3×3 grid).
      let inside = 0;
      for (let i = 0; i < 9; i++) inside += inForeground(r.x + r.w * (i % 3) / 2, r.y + r.h * Math.floor(i / 3) / 2);
      score += inside / 9 * area * 4;
      const outside = area - overlap(r, {x:8, y:8, w:W - 16, h:H - 16});
      score += outside * 10;
      if (score < bestScore) { bestScore = score; best = place; }
    });
    p.place = best;
    const chosen = labelRect(p, best);
    // Dim only when the chosen spot still truly covers another label or body.
    let covered = 0;
    placed.forEach(o => { covered += overlap(chosen, o); });
    bodies.forEach((o, i) => { if (planets[i] !== p) covered += overlap(chosen, o); });
    placed.push(chosen);
    const crowded = covered > .3 * area && p.hover < .5;
    if (p.button) {
      if (p.button.dataset.lp !== best) p.button.dataset.lp = best;
      if (crowded !== p.crowded) { p.button.classList.toggle('label-crowded', crowded); p.crowded = crowded; }
    }
  });
}

// ---------------------------------------------------------------------------
// WebGL
const isSmall = matchMedia('(max-width: 820px)').matches;
let gl = canvas.getContext('webgl', {alpha:false, antialias:!isSmall, premultipliedAlpha:true, powerPreference:'high-performance'});
body.classList.add(gl ? 'has-webgl' : 'no-webgl');

const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
const GLSL_HEAD = `
uniform vec3 uCamPos, uR, uU, uF;
uniform float uTan, uAspect;
uniform vec2 uShift;
vec4 project(vec3 p){
  vec3 v = p - uCamPos; float z = dot(v, uF);
  return vec4(dot(v, uR) / (uTan * uAspect) + uShift.x * z, dot(v, uU) / uTan + uShift.y * z, 0.0, z);
}`;
const NOISE = `
float hash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }
float fbm3(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 3; i++){ s += a * noise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= .5; } return s * 1.14; }`;
const f3 = n => n.toFixed(4);

const SHADERS = {
  quadVS: `attribute vec2 aQ; varying vec2 vUv; void main(){ vUv = aQ * .5 + .5; gl_Position = vec4(aQ, 0.0, 1.0); }`,

  // Far layer (sky, nebulae, stellar stream, distant galaxy) and the middle layer:
  // the vortex plane, found per pixel by intersecting the view ray with y = 0.
  backgroundFS: FS_PRECISION + GLSL_HEAD + NOISE + `
uniform vec2 uRes, uStarNdc; uniform float uRT, uOT, uIntro, uStarR, uRoll, uBreath, uHalo, uWaveR, uWaveA, uGiantA, uPortrait;
uniform vec4 uOccA, uOccB;
// Share of a light shaft left after passing a disc (screen-space occluder o: xy, radius).
float shadowed(vec2 rd, float rl, vec4 o){
  vec2 c = (o.xy - uStarNdc) * vec2(uAspect, 1.0);
  float along = dot(c, rd), perp = abs(c.x * rd.y - c.y * rd.x);
  float inside = smoothstep(o.z * 1.03, o.z * .8, perp) * step(0.0, along);
  return 1.0 - inside * smoothstep(along - o.z * .6, along + o.z * .15, rl) * .9;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes, ndc = uv * 2.0 - 1.0, q = ndc - uShift;
  vec3 dir = normalize(uF + q.x * uTan * uAspect * uR + q.y * uTan * uU);
  float base = smoothstep(0.0, 1.4, uIntro), discIn = smoothstep(.5, 3.0, uIntro), glow = smoothstep(.3, 2.0, uIntro);

  // Deep space with cold atmospheric gradients; a violet haze bridges text and vortex.
  vec3 col = mix(vec3(.010, .016, .035), vec3(.024, .043, .095), smoothstep(-.2, 1.1, uv.y * .85 + (1.0 - uv.x) * .25));
  col += vec3(.05, .08, .17) * .55 * exp(-length((uv - vec2(.1, .92)) * vec2(1.0, 1.5)) * 2.0);
  col += vec3(.09, .065, .17) * .4 * exp(-length((uv - vec2(.36, .5)) * vec2(.8, 1.3)) * 2.3);

  // The far layer drifts: nebula volumes slide and fold slowly, haze flows across.
  vec3 np = dir * 1.9 + vec3(uRT * .006, sin(uRT * .01) * .15, uRT * .011);
  float warp = fbm3(np * 1.1 + vec3(0.0, uRT * .01, 0.0));
  float n = fbm(np + warp * 1.3);
  float neb = smoothstep(.4, .95, n);
  vec3 nebCol = mix(vec3(.13, .13, .32), vec3(.3, .12, .24), smoothstep(.35, .8, warp));
  nebCol = mix(nebCol, vec3(.42, .26, .16), smoothstep(.76, .98, n) * .35);
  col += nebCol * neb * .2;
  float haze = fbm3(vec3(uv * vec2(2.2, 1.4) + vec2(uRT * .007, -uRT * .0035), uRT * .015));
  col += vec3(.06, .07, .14) * smoothstep(.45, .9, haze) * .14;

  float band = exp(-pow(dot(dir, normalize(vec3(.25, .9, -.35))) / .16, 2.0));
  col += vec3(.22, .24, .38) * band * (.35 + smoothstep(.3, .85, fbm3(dir * 7.0))) * .08;

  vec3 gd = normalize(vec3(-.62, .1, -.78));
  vec3 e1 = normalize(cross(gd, vec3(0.0, 1.0, 0.0))), e2 = cross(e1, gd);
  vec2 g = vec2(dot(dir, e1), dot(dir, e2));
  g = mat2(.86, .5, -.5, .86) * g; g.y *= 3.2;
  float gal = exp(-length(g) * 160.0) * .5 + exp(-length(g) * 45.0) * .07;
  col += vec3(.8, .76, .92) * gal * step(0.0, dot(dir, gd));

  if (dir.y < 0.0) {
    float t = -uCamPos.y / dir.y;
    vec3 hit = uCamPos + dir * t;
    float r = length(hit.xz), th = atan(hit.z, hit.x), lr = log(max(r, .05));
    // Spiral arms are a rigid density wave; dust texture shears at Kepler speed.
    float s = th - uOT * ${f3(ARM_SPIN)} - ${f3(ARM_PITCH)} * lr;
    float arm = pow(.5 + .5 * cos(2.0 * s), 1.7);
    float arm2 = pow(.5 + .5 * cos(2.0 * s + 1.4 + .35 * lr), 7.0);
    float sd = th - uOT * ${f3(DUST_SPIN)} * pow(max(r, .4) / 1.3, -1.5) - ${f3(ARM_PITCH)} * lr;
    // Matter, not ribbons: domain-warped filaments, clumped dust, dark lanes and
    // slow luminosity variation along each arm, all irregular in spacing.
    vec2 pl = hit.xz;
    float warpA = fbm3(vec3(pl * .32 + vec2(uRT * .012, -uRT * .008), 1.7 + uRT * .012));
    float sw = sd + (warpA - .5) * 1.6;
    float fil = fbm3(vec3(cos(sw) * 7.0, sin(sw) * 7.0, lr * 1.6));
    float strands = pow(fbm3(vec3(cos(sw) * 15.0, sin(sw) * 15.0, lr * 3.2 + warpA * 2.0)), 3.2) * 2.4;
    float clumps = smoothstep(.42, .82, fbm(vec3(pl * .22, 4.3)));
    float lanes = smoothstep(.5, .74, fbm3(vec3(cos(sw) * 5.0, sin(sw) * 5.0, lr * 2.2 + 3.0)));
    float lumVar = .45 + 1.1 * fbm3(vec3(pl * .09, 8.1));
    float fine = clamp(1.6 - t * .03, 0.0, 1.0);

    // Luminous core haze · the planets' realm, crossed faintly by the arms that are
    // born at the star · the vast vortex beyond.
    float realm = smoothstep(3.6, 8.0, r);
    float vast = realm * pow(r / 6.0, -.55);
    float inner = (1.0 - realm) * smoothstep(.45, 1.6, r);
    float dens = exp(-r * 1.1) * .9 * (.4 + .6 * fil)
               + inner * (.05 + arm * .16) * (.3 + fil * 1.2)
               + vast * (arm * .8 + .05) * (.25 + fil * 1.1) * (.55 + clumps * .9)
               + vast * strands * fine * (.2 + arm) * .7
               + vast * arm2 * .3 * fil * clumps
               + vast * arm * .16;
    dens *= lumVar * (1.0 - lanes * .6 * smoothstep(4.0, 9.0, r));
    // The outer giant has swept a lane clear along its orbit.
    dens *= 1.0 - .55 * exp(-pow((r - uGiantA) / (.35 + r * .04), 2.0));

    float starLight = 1.0 / (1.0 + r * r * .08);
    vec3 dc = mix(vec3(1.0, .69, .38), vec3(.88, .9, 1.0), smoothstep(1.0, 7.0, r));
    dc = mix(dc, vec3(.36, .45, .8), smoothstep(7.0, 22.0, r));
    dc = mix(dc, vec3(.45, .3, .62), smoothstep(16.0, 40.0, r) * .6);
    dc = mix(dc, vec3(.62, .2, .3), arm * (1.0 - arm) * 2.2 * smoothstep(6.0, 14.0, r) * .7);
    // Starlight breathes; occasionally a soft wave of light runs out through the dust.
    float energy = 1.0 + .16 * uBreath + .35 * uHalo;
    float wave = exp(-pow((r - uWaveR) / (.45 + uWaveR * .08), 2.0)) * uWaveA;
    vec3 d = dc * dens * (starLight * 1.4 * energy + .22 + wave * .9);
    float fog = 1.0 - exp(-t * .022);
    d = mix(d, vec3(.09, .1, .2) * dens * .6, fog * .7) * exp(-t * .012);
    d *= smoothstep(48.0, 25.0, r);
    // Matter right under the camera falls out of focus and light, so the nearest
    // arm frames the system instead of competing with it.
    d *= mix(.2, 1.0, smoothstep(3.0, 12.0, t));
    col += d * .9 * discIn;
  }
  col += vec3(.16, .14, .3) * exp(-abs(dir.y) * 28.0) * .16 * discIn;

  vec2 ds = (ndc - uStarNdc) * vec2(uAspect, 1.0) / max(uStarR, .001);
  vec2 dr = mat2(cos(uRoll), sin(uRoll), -sin(uRoll), cos(uRoll)) * ds; dr.y *= 4.0;
  float pulse = 1.0 + .03 * sin(uRT * .55) + .14 * uBreath + .5 * uHalo;
  float sd2 = length(ds);
  col += vec3(1.0, .6, .32) * (.11 * exp(-sd2 * .7) + .065 * exp(-sd2 * .15 / (1.0 + uHalo * .5))) * glow * pulse;
  col += vec3(1.0, .74, .45) * .05 * exp(-length(dr) * .09) * glow;

  // Shafts of starlight through the haze, broken by unseen wreckage and cut off
  // behind the giant and the moon; they step back under the editorial text.
  vec2 rel = (ndc - uStarNdc) * vec2(uAspect, 1.0);
  float rl = length(rel); vec2 rd = rel / max(rl, 1e-4);
  float sh = pow(fbm3(vec3(rd * 2.4, uRT * .008)), 2.2) * 1.5 + pow(fbm3(vec3(rd * 11.0, 4.0 + uRT * .004)), 3.0) * 1.4;
  sh *= exp(-rl * .85) * smoothstep(.04, .3, rl) * shadowed(rd, rl, uOccA) * shadowed(rd, rl, uOccB);
  float text = uPortrait > 0.0 ? smoothstep(.1, .45, ndc.y) : 1.0 - smoothstep(-.8, -.25, ndc.x);
  col += vec3(1.0, .72, .46) * sh * .085 * glow * (1.0 - .75 * text) * (1.0 + .3 * uBreath + .6 * uHalo);

  // Deeper darkness toward the frame edges: the light is a pocket in a dark space.
  col *= 1.0 - .5 * smoothstep(.55, 1.5, length((uv - vec2(.58, .5)) * vec2(1.2, 1.0)));
  gl_FragColor = vec4(col * base, 1.0);
}`,

  copyFS: `precision mediump float; uniform sampler2D uTex; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){ vec3 c = texture2D(uTex, vUv).rgb; c += (h(gl_FragCoord.xy) - .5) / 160.0; gl_FragColor = vec4(c, 1.0); }`,

  skyVS: GLSL_HEAD + `
attribute vec3 aPos; attribute vec3 aMeta; uniform float uRT, uDpr, uFade, uTwinkle; varying vec3 vCol; varying float vA;
void main(){
  float sa = sin(uRT * .0016), ca = cos(uRT * .0016);   // the whole sky drifts, very slowly
  gl_Position = project(uCamPos + vec3(ca * aPos.x + sa * aPos.z, aPos.y, -sa * aPos.x + ca * aPos.z));
  float tw = 1.0 - uTwinkle * .45 * (.5 + .5 * sin(uRT * (.4 + aMeta.y * .9) + aMeta.y * 40.0));
  vA = aMeta.x * .4 * tw * uFade;
  vCol = mix(vec3(.82, .89, 1.0), vec3(1.0, .86, .7), aMeta.z);
  gl_PointSize = (1.0 + aMeta.x * 1.5) * uDpr;
}`,
  pointFS: `precision mediump float; varying vec3 vCol; varying float vA;
void main(){ float d = length(gl_PointCoord * 2.0 - 1.0); float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vCol * vA * a * a, 0.0); }`,

  dustVS: GLSL_HEAD + `
attribute vec3 aOrb; attribute vec3 aMeta; uniform float uOT, uRT, uDpr, uFade, uTwinkle, uBreath, uHalo, uWaveR, uWaveA; varying vec3 vCol; varying float vA;
void main(){
  float r = aOrb.x;
  float th = aOrb.y + uOT * ${f3(DUST_SPIN)} * pow(r / 1.3, -1.5);
  vec4 c = project(vec3(cos(th) * r, aOrb.z, sin(th) * r));
  gl_Position = c;
  float z = max(c.w, .3);
  float wave = exp(-pow((r - uWaveR) / (.45 + uWaveR * .08), 2.0)) * uWaveA;
  float light = 1.4 * (1.0 + .18 * uBreath + .4 * uHalo) / (1.0 + r * r * .08) + .25 + wave * 1.4;
  vec3 col = mix(vec3(1.0, .72, .42), vec3(.88, .9, 1.0), smoothstep(1.0, 6.0, r));
  col = mix(col, vec3(.48, .58, .9), smoothstep(7.0, 22.0, r));
  vCol = mix(col, vec3(.9, .45, .58), aMeta.z);
  float tw = 1.0 - uTwinkle * .35 * (.5 + .5 * sin(uRT * 1.3 + aOrb.y * 40.0));
  vA = aMeta.y * light * smoothstep(.4, .8, r) * exp(-z * .02) * tw * uFade;
  float ps = aMeta.x * uDpr * 13.0 / z;
  if (ps < 1.0) { vA *= ps; ps = 1.0; }
  gl_PointSize = min(ps, 4.5 * uDpr);
}`,

  // Orbital flow: fine matter circulating at the planets' own Kepler speeds, each
  // grain drawn as a short line from its position now to where it was a moment ago.
  flowVS: GLSL_HEAD + `
attribute vec4 aF; attribute float aB; uniform float uOT, uTrail, uFade, uBreath, uWaveR, uWaveA; varying vec3 vCol; varying float vA;
void main(){
  float r = aF.x;
  float w = ${f3(TAU / PLANETS[0].period)} * pow(r / ${f3(PLANETS[0].a)}, -1.5);
  float th = aF.y + w * (uOT - aF.w * uTrail);
  gl_Position = project(vec3(cos(th) * r, aF.z, sin(th) * r));
  vCol = mix(vec3(1.0, .78, .5), vec3(.8, .86, 1.0), smoothstep(.8, 3.8, r));
  float wave = exp(-pow((r - uWaveR) / .5, 2.0)) * uWaveA;
  vA = aB * (1.0 - aF.w) * uFade * (1.0 + .2 * uBreath + wave * 2.0);
}`,
  lineFS: `precision mediump float; varying vec3 vCol; varying float vA; void main(){ gl_FragColor = vec4(vCol * vA, 0.0); }`,

  // Outer gas giant (world-space billboard, view-space normals). Banded atmosphere in
  // the planet's own frame: the pole is the system's north, latitudes shear with
  // zonal winds, two cyclones twist the clouds. Lit by the distant star with a wide
  // scattering terminator, and by the cold glow of the vortex on its night side.
  giantFS: FS_PRECISION + NOISE + `
uniform vec3 uL, uPole; uniform float uRT, uSpin, uExtent, uPixel, uFade; varying vec2 vQ;
vec3 swirl(vec3 s, vec3 c, float size, float turn){
  float d = length(s - c);
  float k = exp(-d * d / (size * size)) * turn;
  float cs = cos(k), sn = sin(k);
  vec3 o = s - c;
  vec3 ax = normalize(c);
  return c + o * cs + cross(ax, o) * sn + ax * dot(ax, o) * (1.0 - cs);
}
void main(){
  vec2 q = vQ * uExtent; float d = length(q);
  vec3 col = vec3(0.0); float a = 0.0;
  vec3 L = normalize(uL), pole = normalize(uPole);
  if (d < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - d * d));
    // Planet frame: e1/e2 span the equator, lat runs pole to pole.
    vec3 e1 = normalize(cross(pole, vec3(0.0, 0.0, 1.0)));
    vec3 e2 = cross(pole, e1);
    float lat = dot(n, pole);
    float lon = atan(dot(n, e2), dot(n, e1)) + uSpin + uRT * .0025 * sin(lat * 9.0);
    float cl = sqrt(max(1.0 - lat * lat, 0.0));
    vec3 s = vec3(cos(lon) * cl, lat, sin(lon) * cl);
    s = swirl(s, normalize(vec3(.55, .3, .78)), .16, 5.0);
    s = swirl(s, normalize(vec3(-.4, -.22, .89)), .09, -6.0);

    s = swirl(s, normalize(vec3(.8, .12, -.58)), .12, 5.5);

    float w = fbm3(s * 2.6 + vec3(0.0, 0.0, uRT * .004));
    float y = s.y + (w - .5) * .09;
    float flow = fbm3(s * vec3(5.0, 1.2, 5.0));
    float belts = sin(y * 21.0 + flow * 3.2) + .45 * sin(y * 57.0 + flow * 5.0);
    float band = smoothstep(-1.1, 1.1, belts);
    float fine = fbm(vec3(s.x * 10.0, y * 52.0, s.z * 10.0));
    float storms = smoothstep(.15, .0, length(s - normalize(vec3(.55, .3, .78))))
                 + smoothstep(.1, .0, length(s - normalize(vec3(.8, .12, -.58)))) * .8;

    vec3 bronze = vec3(.2, .12, .075), amber = vec3(.62, .44, .26), violet = vec3(.36, .29, .4);
    vec3 slate = vec3(.21, .26, .36), gray = vec3(.55, .51, .46);
    vec3 albedo = mix(bronze, amber, band);
    albedo = mix(albedo, gray, smoothstep(.62, .95, band) * smoothstep(.45, .7, fine) * .6);
    albedo = mix(albedo, violet, smoothstep(.45, .9, abs(y)) * .55);
    albedo = mix(albedo, slate, smoothstep(.7, 1.0, abs(y)) * .5);
    albedo *= .7 + .6 * fine;
    albedo = mix(albedo, vec3(.78, .56, .34), clamp(storms, 0.0, 1.0) * .6);

    float ndl = dot(n, L);
    float day = smoothstep(-.42, .75, ndl);
    col = albedo * day * vec3(1.0, .86, .66) * 1.6;
    col += albedo * vec3(.32, .34, .52) * .5 * (1.0 - day * .6);             // vortex fill
    col += vec3(.9, .5, .3) * albedo * exp(-pow((ndl + .05) / .2, 2.0)) * .35; // reddened terminator
    float limb = pow(1.0 - n.z, 3.0);
    col = mix(col, vec3(.42, .48, .72) * (.25 + .75 * day), limb * .45);   // atmospheric haze
    col += vec3(1.0, .74, .48) * pow(1.0 - n.z, 7.0) * smoothstep(-.2, .6, ndl) * .55;
    a = smoothstep(1.0, 1.0 - uPixel * 1.6, d);
  }
  float side = smoothstep(-.4, .7, dot(normalize(vec3(q, .0001)), L));
  col += vec3(.45, .52, .82) * exp(-max(d - 1.0, 0.0) * 22.0) * (.05 + .3 * side) * (1.0 - a) * smoothstep(uExtent, uExtent * .9, d);
  gl_FragColor = vec4(col * uFade, a * uFade);
}`,

  // The broken moon. A jagged fracture front cuts the sphere; beyond it the body is
  // gone, and just inside it lies the raw broken face, angled toward the break. The
  // star is behind it, so most of what shows is a burning limb, light spilling round
  // the edge and through the gap, and the faint bronze glow of the giant below.
  moonFS: FS_PRECISION + NOISE + `
uniform vec3 uL, uGiantDir; uniform vec2 uCut; uniform float uExtent, uPixel, uFade; varying vec2 vQ;
void main(){
  vec2 q = vQ * uExtent; float d = length(q);
  vec3 L = normalize(uL); vec2 Ls = normalize(L.xy + 1e-4);
  float back = max(-L.z, 0.0);
  float j = fbm(vec3(q * 2.2, 3.0)) - .5;
  float front = dot(q, uCut) - .42 + j * .42 + (fbm3(vec3(q * 9.0, 1.0)) - .5) * .09;
  float frontLimb = dot(q / max(d, 1.0), uCut) - .42 + j * .42;
  vec3 col = vec3(0.0); float a = 0.0;
  if (d < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - d * d));
    float face = smoothstep(-.24, 0.0, front);
    vec3 nf = normalize(vec3(uCut * .9 + vec2(j, -j) * .7, .45));
    vec3 nn = normalize(mix(n, nf, face));
    float h = fbm(n * 3.0 + 5.0);
    float cr = 1.0 - abs(fbm3(n * 5.0 + 1.3) * 2.0 - 1.0);
    float fiss = smoothstep(.9, .985, cr);
    vec3 albedo = mix(vec3(.15, .14, .14), vec3(.33, .29, .26), h);
    albedo = mix(albedo, vec3(.08, .07, .065), face);
    albedo *= 1.0 - fiss * .7;
    float ndl = dot(nn, L);
    col = albedo * smoothstep(-.05, .6, ndl) * vec3(1.0, .82, .6) * 2.0;
    col += albedo * vec3(.3, .33, .5) * .2;                                       // vortex fill
    col += albedo * vec3(.6, .4, .22) * max(dot(nn, normalize(uGiantDir)), 0.0) * .3; // giant-shine
    // Heat still glows along the fissures nearest the break.
    col += vec3(1.0, .36, .1) * fiss * smoothstep(-.3, -.02, front) * .14;
    float rim = pow(1.0 - n.z, 4.0) * max(dot(normalize(q + 1e-4), Ls), 0.0);
    col += vec3(1.0, .76, .5) * rim * (.3 + back * 1.6);
    col += vec3(1.0, .7, .42) * face * pow(max(dot(nf.xy, Ls), 0.0), 2.0) * back * .35;
    a = (1.0 - smoothstep(-uPixel * 1.5, 0.0, front)) * smoothstep(1.0, 1.0 - uPixel * 1.6, d);
    col *= a;
  }
  // Light spilling round the limb and streaming out through the break.
  float od = max(d - 1.0, d < 1.0 ? front : 0.0);
  float side = pow(max(dot(normalize(q + 1e-4), Ls), 0.0), 2.0);
  float spill = exp(-max(od, 0.0) * 8.0) * (.04 + side * back * .7) * (1.0 - smoothstep(-.05, .1, frontLimb));
  float strands = smoothstep(.45, .85, fbm3(vec3(dot(q, vec2(-uCut.y, uCut.x)) * 6.0, dot(q, uCut) * 1.2, 2.0)));
  spill += strands * exp(-max(od, 0.0) * 2.5) * step(0.0, dot(q, uCut)) * .12 * back;
  col += vec3(1.0, .7, .45) * spill * (1.0 - a) * smoothstep(uExtent, uExtent * .8, d);
  gl_FragColor = vec4(col * uFade, a * uFade);
}`,

  // One chunk of wreckage: a shard cut by seven fracture planes, roughened, slowly
  // tumbling. Dark basalt; the star behind it catches the fracture edges facing it.
  // Near chunks are out of focus (uSoft), which keeps them a frame, not a subject.
  rockFS: FS_PRECISION + NOISE + `
uniform vec3 uL; uniform float uSeed, uRot, uExtent, uSoft, uFade; varying vec2 vQ;
void main(){
  vec2 q = vQ * uExtent;
  float c = cos(uRot), s = sin(uRot);
  vec2 p = mat2(c, s, -s, c) * q;
  float d = -1e3, facet = 0.0; vec2 en = vec2(1.0, 0.0);
  for (int k = 0; k < 7; k++) {
    float fk = float(k);
    float an = fk * .8976 + (hash(vec3(uSeed, fk, 1.0)) - .5) * .7;
    vec2 nk = vec2(cos(an), sin(an));
    float dk = dot(p, nk) - (.6 + .4 * hash(vec3(uSeed, fk, 7.0)));
    if (dk > d) { d = dk; en = nk; facet = fk; }
  }
  float b1 = fbm3(vec3(p * 5.0, uSeed));
  d += (fbm3(vec3(p * 3.5, uSeed + 2.0)) - .5) * .16;
  vec3 L = normalize(uL); vec2 Ls = normalize(L.xy + 1e-4);
  vec2 nr = mat2(c, -s, s, c) * en;
  float edge = smoothstep(-.3, 0.0, d);
  vec3 n = normalize(vec3(q * .5, 1.0));
  n = normalize(mix(n, vec3(nr, .35), edge * .85) + vec3(b1 - .5, fbm3(vec3(p * 5.0 + 9.1, uSeed)) - .5, 0.0) * .6);
  // Each fracture face takes its own tone, so the shard reads as planes, not a cut-out.
  float tone = mix(1.0, .45 + 1.1 * hash(vec3(uSeed, facet, 3.0)), smoothstep(-.45, -.15, d));
  vec3 albedo = mix(vec3(.06, .055, .056), vec3(.14, .12, .105), b1) * tone;
  vec3 col = albedo * max(dot(n, L), 0.0) * vec3(1.0, .82, .6) * 2.4;
  col += albedo * vec3(.3, .33, .52) * (.7 + .9 * (n.y * .5 + .5));
  float back = max(-L.z, 0.0);
  col += vec3(1.0, .7, .42) * pow(edge, 3.0) * max(dot(nr, Ls), 0.0) * (.15 + back * .9);
  float a = 1.0 - smoothstep(-uSoft, 0.0, d);
  col *= a;
  col +=vec3(1.0, .7, .45) * exp(-max(d, 0.0) * 14.0) * max(dot(nr, Ls), 0.0) * back * .22 * (1.0 - a) * smoothstep(uExtent, uExtent * .8, length(q));
  gl_FragColor = vec4(col * uFade, a * uFade);
}`,

  // Grit: wreckage too small to resolve, dark points with a glint on the star side.
  // Hidden where it falls behind the giant or the moon on screen.
  gritVS: GLSL_HEAD + `
attribute vec4 aG; attribute float aS; uniform float uT, uAz, uPxH, uFade; uniform vec4 uOccA, uOccB;
varying float vA, vS, vBack; varying vec2 vL;
float occ(vec4 c, vec4 o){ vec2 d = (c.xy / c.w - o.xy) * vec2(uAspect, 1.0); return c.w > o.w && length(d) < o.z ? 0.0 : 1.0; }
void main(){
  vec3 b = aG.xyz + vec3(sin(uT * .05 + aS * 20.0), cos(uT * .04 + aS * 13.0) * .5, sin(uT * .045 + aS * 7.0)) * aG.w * 2.0;
  float ca = cos(uAz), sa = sin(uAz);
  vec3 p = vec3(ca * b.x + sa * b.z, b.y, -sa * b.x + ca * b.z);
  vec4 c = project(p); gl_Position = c;
  float px = aG.w / (max(c.w, .1) * uTan) * uPxH * 2.0;
  gl_PointSize = clamp(px, 1.5, 48.0);
  vec3 Ls = normalize(-p);
  vL = normalize(vec2(dot(Ls, uR), dot(Ls, uU)) + 1e-4);
  vBack = max(dot(Ls, uF), 0.0);
  vS = aS;
  vA = uFade * occ(c, uOccA) * occ(c, uOccB) * min(px / 1.5, 1.0);
}`,
  gritFS: `precision mediump float; varying float vA, vS, vBack; varying vec2 vL;
void main(){
  vec2 pc = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * 2.0 - 1.0;
  float an = atan(pc.y, pc.x + 1e-5);
  float r = length(pc) * (1.0 + .18 * sin(an * 3.0 + vS * 20.0) + .1 * sin(an * 5.0 + vS * 41.0));
  float a = smoothstep(.85, .62, r) * vA;
  float rim = smoothstep(.2, .85, dot(normalize(pc + 1e-4), vL)) * smoothstep(.3, .75, r);
  gl_FragColor = vec4((vec3(.035, .032, .034) + vec3(1.0, .7, .42) * rim * (.15 + vBack * .8)) * a, a);
}`,

  // Fine dust of the wreck, lit by forward scattering: brightest where the star
  // shines through it toward the viewer.
  hazeVS: GLSL_HEAD + `
attribute vec4 aH; uniform float uT, uAz, uDpr, uFade, uBreath; uniform vec4 uOccA, uOccB; varying vec3 vCol; varying float vA;
float occ(vec4 c, vec4 o){ vec2 d = (c.xy / c.w - o.xy) * vec2(uAspect, 1.0); return c.w > o.w && length(d) < o.z ? 0.0 : 1.0; }
void main(){
  float k = aH.x * 3.1 + aH.z * 1.7;
  vec3 b = aH.xyz + vec3(sin(uT * .02 + k), cos(uT * .017 + k * 1.3) * .4, cos(uT * .019 + k * .7)) * .05;
  float ca = cos(uAz), sa = sin(uAz);
  vec3 p = vec3(ca * b.x + sa * b.z, b.y, -sa * b.x + ca * b.z);
  vec4 c = project(p); gl_Position = c;
  float ph = .2 + 1.8 * pow(max(dot(normalize(p), normalize(uCamPos - p)), 0.0), 6.0);
  vA = aH.w * ph * 1.8 * uFade * (1.0 + .2 * uBreath) * occ(c, uOccA) * occ(c, uOccB);
  vCol = mix(vec3(1.0, .74, .48), vec3(.78, .82, 1.0), .3);
  gl_PointSize = (1.0 + aH.w * 2.5) * uDpr;
}`,

  // Event layer: a rare streak of light crossing the far sky (screen space).
  streakVS: `attribute float aT; uniform vec2 uA, uB; uniform float uAlpha; varying vec3 vCol; varying float vA;
void main(){ gl_Position = vec4(mix(uA, uB, aT), 0.0, 1.0); vCol = vec3(.92, .9, 1.0); vA = uAlpha * pow(1.0 - aT, 1.6); }`,

  // Near layer: a handful of out-of-focus motes in camera space.
  moteVS: `attribute vec4 aM; attribute float aS; uniform float uRT, uTan, uPxH, uFade; uniform vec2 uShift, uPar; varying vec3 vCol; varying float vA;
void main(){
  vec2 xy = aM.xy + vec2(sin(uRT * .03 + aS * 6.0), cos(uRT * .025 + aS * 4.0)) * .04 + uPar / aM.z;
  gl_Position = vec4(xy + uShift, 0.0, 1.0);
  gl_PointSize = min(aM.w / (aM.z * uTan) * uPxH, 150.0);
  vA = .016 * uFade * (.6 + .4 * sin(uRT * .2 + aS * 9.0));
  vCol = mix(vec3(1.0, .76, .52), vec3(.62, .7, 1.0), step(.5, fract(aS * 3.7)));
}`,
  moteFS: `precision mediump float; varying vec3 vCol; varying float vA;
void main(){ float d = length(gl_PointCoord * 2.0 - 1.0); float a = smoothstep(1.0, .86, d) * (.5 + .5 * smoothstep(.45, .95, d)); gl_FragColor = vec4(vCol * vA * a, 0.0); }`,

  ringVS: GLSL_HEAD + `
attribute vec4 aP; uniform float uAlpha, uPU, uDir, uTrail, uHover, uRad, uFade, uArc, uTextFade, uPortrait; varying float vA;
void main(){
  vec4 c = project(aP.xyz); gl_Position = c;
  float zs = dot(-uCamPos, uF);
  float front = clamp((zs - c.w) / uRad * .5 + .5, 0.0, 1.0);
  float d = uDir > 0.0 ? fract(uPU - aP.w) : fract(aP.w - uPU);
  float a = uAlpha * (.3 + .7 * front) * (1.0 + uHover * 1.5) + uTrail * exp(-d * 11.0) * (.4 + uHover * .4);
  if (uArc > 0.0) a *= pow(sin(3.14159 * aP.w), 1.6);
  // Lines that sweep across the whole frame step back behind the editorial text.
  vec2 s = c.xy / max(c.w, .001);
  float text = uPortrait > 0.0 ? smoothstep(.12, .42, s.y) : 1.0 - smoothstep(-.82, -.3, s.x);
  a *= 1.0 - uTextFade * text * .85;
  vA = a * uFade;
}`,
  ringFS: `precision mediump float; uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol * vA, 0.0); }`,

  bodyVS: GLSL_HEAD + `
attribute vec2 aQ; uniform vec3 uCenter; uniform float uSize; varying vec2 vQ;
void main(){ vQ = aQ; gl_Position = project(uCenter + (uR * aQ.x + uU * aQ.y) * uSize); }`,

  // A compact, white-gold star; most of its presence is the light it throws.
  starFS: FS_PRECISION + NOISE + `
uniform float uRT, uExtent, uPixel, uFade, uBreath, uHalo; varying vec2 vQ;
void main(){
  vec2 q = vQ * uExtent; float d = length(q);
  float pulse = 1.0 + .03 * sin(uRT * 1.7) + .06 * uBreath;
  vec3 col = vec3(0.0); float a = 0.0;
  if (d < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - d * d));
    float ca = cos(uRT * .025), sa = sin(uRT * .025);
    vec3 p = vec3(ca * n.x + sa * n.z, n.y, -sa * n.x + ca * n.z);
    float flow = fbm(p * 3.2 + vec3(0.0, uRT * .035, 0.0));
    float cells = flow * .65 + noise(p * 17.0 + uRT * .08) * .35;
    float limb = pow(n.z, .6);
    // Amber photosphere with granulation and darker lanes; only the hottest cells near
    // the centre approach pale gold, and the limb darkens toward ember.
    vec3 c = mix(vec3(.86, .36, .12), vec3(1.0, .66, .3), smoothstep(.28, .62, cells));
    c = mix(c, vec3(1.0, .84, .56), smoothstep(.58, .82, cells) * limb);
    c *= .78 + .3 * smoothstep(.3, .7, flow);
    col = c * (.42 + .72 * limb) * pulse * 1.05;
    a = smoothstep(1.0, 1.0 - uPixel * 1.5, d);
  }
  float r = max(d, 1.0), ang = atan(q.y, q.x);
  float rays = fbm3(vec3(cos(ang) * 2.6, sin(ang) * 2.6, r * .9 - uRT * .05));
  float streamers = pow(fbm3(vec3(cos(ang) * 5.0, sin(ang) * 5.0, uRT * .02)), 3.0) * exp(-(r - 1.0) * .45);
  // The corona breathes on a slow cycle and swells further during a halo event.
  float reach = 1.0 + .16 * uBreath + .45 * uHalo;
  float corona = exp(-(r - 1.0) * 2.0 / reach) * (.4 + .6 * rays) * .95 + .2 * reach / (r * r) + streamers * .14;
  vec3 cc = mix(vec3(1.0, .5, .26), vec3(1.0, .78, .5), exp(-(r - 1.0) * 1.6));
  col += cc * corona * (pulse + .25 * uHalo) * (1.0 - a) * smoothstep(uExtent, uExtent * .45, d);
  gl_FragColor = vec4(col * uFade, a * uFade);
}`,

  planetFS: FS_PRECISION + NOISE + `
uniform vec3 uL, uC1, uC2, uC3, uAtm;
uniform float uSeed, uSpin, uTilt, uHover, uDim, uBands, uIce, uClouds, uSpec, uFreq, uExtent, uPixel, uFade;
varying vec2 vQ;
void main(){
  vec2 q = vQ * uExtent; float d = length(q);
  vec3 col = vec3(0.0); float a = 0.0;
  vec3 L = normalize(uL);
  if (d < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - d * d));
    float ct = cos(uTilt), st = sin(uTilt), cs = cos(uSpin), ss = sin(uSpin);
    vec3 p = vec3(ct * n.x - st * n.y, st * n.x + ct * n.y, n.z);
    p = vec3(cs * p.x + ss * p.z, p.y, -ss * p.x + cs * p.z);
    vec3 sp = p * uFreq + uSeed;
    float h = fbm(sp), h2 = fbm3(sp * 3.1 + 2.0);
    vec3 albedo = mix(uC1, uC2, smoothstep(.32, .68, h));
    albedo = mix(albedo, uC3, smoothstep(.5, .8, h2) * .55);
    float bands = .5 + .5 * sin(p.y * 13.0 + h * 5.0 + h2 * 2.0);
    albedo = mix(albedo, mix(uC1, uC3, bands), uBands * .65);
    float cap = smoothstep(.62, .86, abs(p.y) + h2 * .2);
    float cracks = smoothstep(.47, .5, h2) * smoothstep(.53, .5, h2);
    albedo = mix(albedo, uC3, uIce * (cap * .85 + cracks * .5));
    float cl = smoothstep(.52, .78, fbm3(p * 2.6 + vec3(uSpin * .35, 0.0, 9.0)));
    albedo = mix(albedo, vec3(.86, .9, .94), cl * uClouds * .55);
    float ndl = dot(n, L);
    float diff = pow(smoothstep(-.1, 1.0, ndl), 1.15);
    col = albedo * diff * vec3(1.0, .88, .7) * 1.75 + albedo * vec3(.05, .06, .09);
    // Night side catches the cold, diffuse light of the surrounding vortex.
    col += (albedo * .6 + .04) * vec3(.16, .18, .32) * (1.0 - diff) * (.35 + .65 * pow(1.0 - n.z, 1.5)) * .55;
    col += uAtm * pow(1.0 - n.z, 3.0) * .1;
    col += vec3(1.0, .5, .25) * albedo * exp(-pow((ndl - .08) / .18, 2.0)) * .18;
    float fres = pow(1.0 - n.z, 2.6);
    col += uAtm * fres * (smoothstep(-.3, .65, ndl) * .85 + uHover * .55);
    // Backlit: the star sits behind the planet, so the atmosphere glows as a thin crescent.
    col += uAtm * pow(1.0 - n.z, 3.5) * max(-L.z, 0.0) * (.9 + uHover * .5);
    col += mix(uAtm, vec3(1.0, .8, .55), .5) * pow(1.0 - n.z, 9.0) * max(-L.z, 0.0) * 1.2;
    vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
    col += pow(max(dot(n, hv), 0.0), 38.0) * uSpec * (1.0 - cl * uClouds) * vec3(1.0, .9, .74);
    col *= uDim;
    a = smoothstep(1.0, 1.0 - uPixel * 1.6, d);
  }
  float side = smoothstep(-.5, .7, dot(normalize(vec3(q, .0001)), L));
  float halo = exp(-max(d - 1.0, 0.0) * 13.0) * (.22 + uHover * .4) * (.25 + .75 * side);
  float ring = exp(-pow((d - 1.5) / .022, 2.0)) * uHover * .45;
  col += (uAtm * halo + vec3(.95, .87, .72) * ring) * (1.0 - a) * smoothstep(uExtent, uExtent * .8, d);
  gl_FragColor = vec4(col * uFade, a * uFade);
}`
};

let progs = {}, buffers = {}, fbo = null, fboTex = null, fboSize = [0, 0];
let skyCount = 0, dustCount = 0, moteCount = 0, flowCount = 0, ringRanges = [];

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locs = {};
  return {p, u: name => (name in locs ? locs[name] : (locs[name] = gl.getUniformLocation(p, name))), a: name => gl.getAttribLocation(p, name)};
}
function buffer(data) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
}
function attribs(prog, buf, layout) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
  let offset = 0;
  layout.forEach(([name, n]) => {
    const loc = prog.a(name);
    if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, offset); }
    offset += n * 4;
  });
  return () => layout.forEach(([name]) => { const loc = prog.a(name); if (loc >= 0) gl.disableVertexAttribArray(loc); });
}

function buildGeometry() {
  buffers.quad = buffer(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

  // Distant stars live on a sphere around the camera, so only rotation moves them.
  skyCount = isSmall ? 650 : 1200;
  const sky = new Float32Array(skyCount * 6);
  for (let i = 0; i < skyCount; i++) {
    const u = rand() * 2 - 1, a = rand() * TAU, s = Math.sqrt(1 - u * u);
    const bright = Math.pow(rand(), 5);
    sky.set([Math.cos(a) * s * 100, u * 100, Math.sin(a) * s * 100, .22 + bright * 1.6, rand(), rand() < .2 ? rand() : 0], i * 6);
  }
  buffers.sky = buffer(sky);

  // Dust: faint arm-traced matter in the planets' realm, then the vortex beyond it,
  // where a share of the particles gathers in irregular clusters along the arms.
  dustCount = isSmall ? 4200 : 9000;
  const clusters = Array.from({length:70}, () => {
    const r = 5 + Math.pow(rand(), 1.6) * 30;
    let th = rand() * TAU;
    for (let k = 0; k < 8 && rand() > armDensity(r, th); k++) th = rand() * TAU;
    return [r, th, .15 + rand() * .5];
  });
  const dust = new Float32Array(dustCount * 6);
  for (let i = 0; i < dustCount; i++) {
    const kind = rand();
    let r, th;
    if (kind < .38) {
      const [cr, cth, spread] = clusters[Math.floor(rand() * clusters.length)];
      r = Math.max(4.5, cr + gauss() * spread * cr * .08);
      th = cth + gauss() * spread * .25;
    } else {
      r = kind < .5 ? .45 + Math.pow(rand(), 1.3) * 3.6 : 4.6 + Math.pow(rand(), 1.8) * 36;
      th = rand() * TAU;
      for (let k = 0; k < 6 && rand() > .1 + .9 * armDensity(r, th); k++) th = rand() * TAU;
    }
    const size = .4 + Math.pow(rand(), 9) * 2.2;
    dust.set([r, th, gauss() * .012 * (1 + r * .25), size, .25 + rand() * .75, r > 6 && rand() < .14 ? .5 + rand() * .5 : 0], i * 6);
  }
  buffers.dust = buffer(dust);

  // Orbital flow grains: [r, θ0, y, end] + brightness, two vertices per streak.
  flowCount = isSmall ? 260 : 520;
  const flow = new Float32Array(flowCount * 2 * 5);
  for (let i = 0; i < flowCount; i++) {
    const near = PLANETS[Math.floor(rand() * PLANETS.length)].a;
    const r = rand() < .45 ? near + gauss() * .12 : .7 + rand() * 3.8;
    const th = rand() * TAU, y = gauss() * .015, b = .05 + Math.pow(rand(), 2) * .2;
    flow.set([r, th, y, 0, b, r, th, y, 1, b], i * 10);
  }
  buffers.flow = buffer(flow);
  buffers.streak = buffer(new Float32Array([0, 1]));

  // Motes: camera-space [x, y, z, size] + seed, scattered toward the frame edges.
  moteCount = isSmall ? 8 : 14;
  const motes = new Float32Array(moteCount * 5);
  for (let i = 0; i < moteCount; i++) {
    const ang = rand() * TAU, rad = .45 + rand() * .55;
    motes.set([Math.cos(ang) * rad * 1.1, Math.sin(ang) * rad, 1.6 + rand() * 2.6, .05 + rand() * .12, rand()], i * 5);
  }
  buffers.motes = buffer(motes);

  // Orbit paths share orbitPoint() with the planets, so bodies never leave their lines.
  const all = [];
  ringRanges = [];
  const add = (o, from, span, segs, extra) => {
    const first = all.length / 4;
    for (let i = 0; i <= segs; i++) { const u = i / segs, p = orbitPoint(o, from + u * span); all.push(p[0], p[1], p[2], u); }
    ringRanges.push({first, count:segs + 1, a:o.a, ...extra});
  };
  ARCS.forEach(([a, e, incl, node, start, span, alpha, tint]) => add({a, e, incl, node}, start * DEG, span * DEG, 360, {alpha, tint, arc:true}));
  planets.forEach(p => add(p, 0, TAU, 360, {alpha:.16, planet:p}));
  buffers.rings = buffer(new Float32Array(all));
}

// The giant's orbit depends on the viewport framing, so it has its own buffer.
let giantOrbitCount = 0;
function buildGiantOrbit() {
  const segs = 720, data = new Float32Array((segs + 1) * 4), p = v3();
  for (let i = 0; i <= segs; i++) { orbitPoint(giantOrbit(), i / segs * TAU, p); data.set([p[0], p[1], p[2], i / segs], i * 4); }
  if (buffers.giantOrbit) gl.deleteBuffer(buffers.giantOrbit);
  buffers.giantOrbit = buffer(data);
  giantOrbitCount = segs + 1;
}

function initGL() {
  progs.bg = program(SHADERS.quadVS, SHADERS.backgroundFS);
  progs.copy = program(SHADERS.quadVS, SHADERS.copyFS);
  progs.sky = program(SHADERS.skyVS, SHADERS.pointFS);
  progs.dust = program(SHADERS.dustVS, SHADERS.pointFS);
  progs.mote = program(SHADERS.moteVS, SHADERS.moteFS);
  progs.flow = program(SHADERS.flowVS, SHADERS.lineFS);
  progs.streak = program(SHADERS.streakVS, SHADERS.lineFS);
  progs.giant = program(SHADERS.bodyVS, SHADERS.giantFS);
  progs.moon = program(SHADERS.bodyVS, SHADERS.moonFS);
  progs.rock = program(SHADERS.bodyVS, SHADERS.rockFS);
  progs.grit = program(SHADERS.gritVS, SHADERS.gritFS);
  progs.haze = program(SHADERS.hazeVS, SHADERS.pointFS);
  progs.ring = program(SHADERS.ringVS, SHADERS.ringFS);
  progs.star = program(SHADERS.bodyVS, SHADERS.starFS);
  progs.planet = program(SHADERS.bodyVS, SHADERS.planetFS);
  buildGeometry();
  fboTex = gl.createTexture();
  fbo = gl.createFramebuffer();
}

function sizeFbo() {
  const scale = [.55, .42, .32][quality];
  const w = Math.max(2, Math.round(W * scale)), h = Math.max(2, Math.round(H * scale));
  if (w === fboSize[0] && h === fboSize[1]) return;
  fboSize = [w, h];
  gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function setCamera(prog) {
  gl.uniform3fv(prog.u('uCamPos'), cam.pos);
  gl.uniform3fv(prog.u('uR'), cam.R);
  gl.uniform3fv(prog.u('uU'), cam.U);
  gl.uniform3fv(prog.u('uF'), cam.F);
  gl.uniform1f(prog.u('uTan'), cam.tan);
  gl.uniform1f(prog.u('uAspect'), cam.aspect);
  gl.uniform2f(prog.u('uShift'), cam.sx, cam.sy);
}

const fade = (t, a, b) => Math.min(Math.max((t - a) / (b - a), 0), 1);
const starScreen = {x:0, y:0, z:1};
const COLORS = {warm:hex('#ffc98a'), cool:hex('#9fbbd8'), pale:hex('#dfe6fb'), warmPale:hex('#ffe2b8')};

function renderGL(rt, intro) {
  const star = starScreen;
  const starR = STAR.radius * Math.sqrt(comp.scale);

  // Far + middle layers into a low-resolution target, then upscaled with dithering.
  sizeFbo();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, fboSize[0], fboSize[1]);
  gl.disable(gl.BLEND);
  let p = progs.bg; gl.useProgram(p.p); setCamera(p);
  gl.uniform2f(p.u('uRes'), fboSize[0], fboSize[1]);
  gl.uniform2f(p.u('uStarNdc'), star.nx, star.ny);
  gl.uniform1f(p.u('uStarR'), starR / (star.z * cam.tan));
  gl.uniform1f(p.u('uRT'), rt); gl.uniform1f(p.u('uOT'), orbitalClock); gl.uniform1f(p.u('uIntro'), intro);
  gl.uniform1f(p.u('uRoll'), -cam.roll);
  gl.uniform1f(p.u('uGiantA'), giant.A);
  gl.uniform1f(p.u('uPortrait'), isPortrait() ? 1 : 0);
  const mo = wreck.moon;
  const occA = [giant.screen.nx, giant.screen.ny, giant.pr / (H / 2), giant.screen.z];
  const occB = [mo.screen.nx, mo.screen.ny, mo.pr / (H / 2), mo.screen.z];
  gl.uniform4fv(p.u('uOccA'), occA); gl.uniform4fv(p.u('uOccB'), occB);
  setField(p);
  let off = attribs(p, buffers.quad, [['aQ', 2]]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); off();

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  p = progs.copy; gl.useProgram(p.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex);
  gl.uniform1i(p.u('uTex'), 0);
  off = attribs(p, buffers.quad, [['aQ', 2]]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); off();

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  const twinkle = reducedMotion() ? 0 : 1, pxScale = canvas.width / W;

  p = progs.sky; gl.useProgram(p.p); setCamera(p);
  gl.uniform1f(p.u('uRT'), rt); gl.uniform1f(p.u('uDpr'), pxScale); gl.uniform1f(p.u('uFade'), fade(intro, 0, 1.4)); gl.uniform1f(p.u('uTwinkle'), twinkle);
  off = attribs(p, buffers.sky, [['aPos', 3], ['aMeta', 3]]);
  gl.drawArrays(gl.POINTS, 0, skyCount); off();

  p = progs.dust; gl.useProgram(p.p); setCamera(p);
  gl.uniform1f(p.u('uOT'), orbitalClock); gl.uniform1f(p.u('uRT'), rt); gl.uniform1f(p.u('uDpr'), pxScale);
  gl.uniform1f(p.u('uFade'), fade(intro, .7, 3)); gl.uniform1f(p.u('uTwinkle'), twinkle);
  setField(p);
  off = attribs(p, buffers.dust, [['aOrb', 3], ['aMeta', 3]]);
  gl.drawArrays(gl.POINTS, 0, quality === 2 ? dustCount >> 1 : dustCount); off();

  p = progs.flow; gl.useProgram(p.p); setCamera(p);
  gl.uniform1f(p.u('uOT'), orbitalClock); gl.uniform1f(p.u('uTrail'), FLOW_TRAIL);
  gl.uniform1f(p.u('uFade'), fade(intro, 1.6, 3.6));
  setField(p);
  off = attribs(p, buffers.flow, [['aF', 4], ['aB', 1]]);
  gl.drawArrays(gl.LINES, 0, (quality === 2 ? flowCount >> 1 : flowCount) * 2); off();

  p = progs.ring; gl.useProgram(p.p); setCamera(p);
  off = attribs(p, buffers.rings, [['aP', 4]]);
  ringRanges.forEach(r => {
    const pl = r.planet;
    // Orbit lines take the same light as the vortex: warmer close to the star.
    const tint = pl ? Math.min(Math.max((pl.a - 1.2) / 3, 0), 1) : r.tint;
    gl.uniform3fv(p.u('uCol'), pl ? COLORS.warmPale.map((c, i) => lerp(c, COLORS.pale[i], tint)) : COLORS.warm.map((c, i) => lerp(c, COLORS.cool[i], tint)));
    gl.uniform1f(p.u('uFade'), pl ? fade(intro, 1.1, 2.8) : fade(intro, .6, 3.2));
    gl.uniform1f(p.u('uAlpha'), r.alpha);
    gl.uniform1f(p.u('uRad'), r.a);
    gl.uniform1f(p.u('uArc'), r.arc ? 1 : 0);
    gl.uniform1f(p.u('uTrail'), pl ? 1 : 0);
    gl.uniform1f(p.u('uHover'), pl ? pl.hover : 0);
    gl.uniform1f(p.u('uDir'), pl ? pl.dir : 1);
    gl.uniform1f(p.u('uPU'), pl ? ((pl.theta / TAU) % 1 + 1) % 1 : 0);
    gl.drawArrays(gl.LINE_STRIP, r.first, r.count);
  });
  off();

  // The giant's own orbit: the same circle its position is taken from, sweeping out
  // of frame below and returning far behind the star.
  const giantFade = fade(intro, 1.2, 3.8) * (1 - ease(travel.k));
  gl.uniform3fv(p.u('uCol'), COLORS.pale);
  gl.uniform1f(p.u('uFade'), giantFade);
  gl.uniform1f(p.u('uAlpha'), .24); gl.uniform1f(p.u('uRad'), giant.A);
  gl.uniform1f(p.u('uArc'), 0); gl.uniform1f(p.u('uTrail'), 0); gl.uniform1f(p.u('uHover'), 0);
  gl.uniform1f(p.u('uTextFade'), 1); gl.uniform1f(p.u('uPortrait'), W / H < .9 || W <= 560 ? 1 : 0);
  off = attribs(p, buffers.giantOrbit, [['aP', 4]]);
  gl.drawArrays(gl.LINE_STRIP, 0, giantOrbitCount); off();
  gl.uniform1f(p.u('uTextFade'), 0);

  // The giant and the wreck, all before the star and planets so navigation always
  // stays on top: glowing dust first, then solid bodies far to near, then grit.
  const wreckFade = fade(intro, 1, 3.6) * (1 - ease(travel.k)), az = -giantAngle();
  const quad = () => { off = attribs(p, buffers.quad, [['aQ', 2]]); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); off(); };
  const toView = v => [dot(v, cam.R), dot(v, cam.U), -dot(v, cam.F)];
  const points = (prog, buf, layout, count) => {
    p = prog; gl.useProgram(p.p); setCamera(p);
    gl.uniform1f(p.u('uT'), driftClock); gl.uniform1f(p.u('uAz'), az); gl.uniform1f(p.u('uDpr'), pxScale);
    gl.uniform1f(p.u('uPxH'), canvas.height / 2); gl.uniform1f(p.u('uFade'), wreckFade);
    gl.uniform4fv(p.u('uOccA'), occA); gl.uniform4fv(p.u('uOccB'), occB); setField(p);
    off = attribs(p, buf, layout); gl.drawArrays(gl.POINTS, 0, count); off();
  };
  points(progs.haze, buffers.haze, [['aH', 4]], quality === 2 ? wreck.hazeCount >> 1 : wreck.hazeCount);

  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const drawGiant = () => {
    p = progs.giant; gl.useProgram(p.p); setCamera(p);
    gl.uniform3fv(p.u('uL'), toView(norm(sub(v3(), giant.pos))));
    // Axial tilt: the pole leans away from us, so the equatorial belts cross the visible cap.
    const pv = toView([0, 1, 0]), tl = -38 * DEG, tw = 14 * DEG;
    const py = pv[1] * Math.cos(tl) - pv[2] * Math.sin(tl), pz = pv[1] * Math.sin(tl) + pv[2] * Math.cos(tl);
    gl.uniform3f(p.u('uPole'), pv[0] * Math.cos(tw) - py * Math.sin(tw), pv[0] * Math.sin(tw) + py * Math.cos(tw), pz);
    gl.uniform3fv(p.u('uCenter'), giant.pos);
    gl.uniform1f(p.u('uSize'), giant.G * 1.15); gl.uniform1f(p.u('uExtent'), 1.15);
    gl.uniform1f(p.u('uPixel'), 1 / Math.max(giant.pr * pxScale, 1));
    gl.uniform1f(p.u('uRT'), rt); gl.uniform1f(p.u('uSpin'), driftClock / 900 * TAU);
    gl.uniform1f(p.u('uFade'), giantFade);
    quad();
  };
  const drawMoon = () => {
    p = progs.moon; gl.useProgram(p.p); setCamera(p);
    const L = toView(norm(sub(v3(), mo.pos)));
    gl.uniform3fv(p.u('uL'), L);
    gl.uniform3fv(p.u('uGiantDir'), toView(norm(sub(giant.pos, mo.pos))));
    // The break opens beside the star-facing limb, so both the burning limb and the
    // raw broken face stay in the visible part of the disc.
    const la = Math.atan2(L[1], L[0]) - 50 * DEG;
    gl.uniform2f(p.u('uCut'), Math.cos(la), Math.sin(la));
    gl.uniform3fv(p.u('uCenter'), mo.pos);
    gl.uniform1f(p.u('uSize'), mo.size * 1.5); gl.uniform1f(p.u('uExtent'), 1.5);
    gl.uniform1f(p.u('uPixel'), 1 / Math.max(mo.pr * pxScale, 1));
    gl.uniform1f(p.u('uFade'), wreckFade);
    quad();
  };
  const drawRock = r => {
    p = progs.rock; gl.useProgram(p.p); setCamera(p);
    gl.uniform3fv(p.u('uL'), toView(norm(sub(v3(), r.pos))));
    gl.uniform3fv(p.u('uCenter'), r.pos);
    gl.uniform1f(p.u('uSize'), r.size * 1.6); gl.uniform1f(p.u('uExtent'), 1.6);
    gl.uniform1f(p.u('uSoft'), Math.max(1.5 / Math.max(r.pr * pxScale, 1), r.soft));
    gl.uniform1f(p.u('uSeed'), r.seed); gl.uniform1f(p.u('uRot'), r.seed * 4 + driftClock * r.spin);
    gl.uniform1f(p.u('uFade'), wreckFade);
    quad();
  };
  [{draw:drawGiant, z:giant.screen.z}, {draw:drawMoon, z:mo.screen.z}, ...wreck.rocks.map(r => ({draw:() => drawRock(r), z:r.screen.z}))]
    .sort((a, b) => b.z - a.z).forEach(s => s.draw());
  points(progs.grit, buffers.grit, [['aG', 4], ['aS', 1]], wreck.gritCount);

  // Star and planets, far to near, so the star's disc can hide planets behind it.
  const bodies = [{star:true, z:star.z}, ...planets.map(q => ({planet:q, z:q.screen.z}))].sort((a, b) => b.z - a.z);
  bodies.forEach(b => {
    if (b.star) {
      p = progs.star; gl.useProgram(p.p); setCamera(p);
      gl.uniform3f(p.u('uCenter'), 0, 0, 0);
      gl.uniform1f(p.u('uSize'), starR * STAR.extent);
      gl.uniform1f(p.u('uExtent'), STAR.extent);
      gl.uniform1f(p.u('uPixel'), 1 / Math.max(pxRadius(starR, star.z) * pxScale, 1));
      gl.uniform1f(p.u('uRT'), rt);
      gl.uniform1f(p.u('uFade'), fade(intro, .35, 2.1));
      setField(p);
    } else {
      const q = b.planet, look = q.look, r = q.radius * comp.scale * (1 + q.hover * .12);
      p = progs.planet; gl.useProgram(p.p); setCamera(p);
      const Lw = norm(sub(v3(), q.pos));
      gl.uniform3f(p.u('uL'), dot(Lw, cam.R), dot(Lw, cam.U), -dot(Lw, cam.F));
      ['c1', 'c2', 'c3', 'atm'].forEach(k => gl.uniform3fv(p.u('u' + k[0].toUpperCase() + k.slice(1)), look._rgb[k]));
      gl.uniform1f(p.u('uSeed'), look.seed); gl.uniform1f(p.u('uFreq'), look.freq);
      gl.uniform1f(p.u('uBands'), look.bands); gl.uniform1f(p.u('uIce'), look.ice);
      gl.uniform1f(p.u('uClouds'), look.clouds); gl.uniform1f(p.u('uSpec'), look.spec);
      gl.uniform1f(p.u('uSpin'), driftClock / q.spin * TAU + look.seed);
      gl.uniform1f(p.u('uTilt'), q.tilt * DEG);
      gl.uniform1f(p.u('uHover'), q.hover);
      gl.uniform1f(p.u('uDim'), q.dim);
      gl.uniform3fv(p.u('uCenter'), q.pos);
      gl.uniform1f(p.u('uSize'), r * 1.9);
      gl.uniform1f(p.u('uExtent'), 1.9);
      gl.uniform1f(p.u('uPixel'), 1 / Math.max(pxRadius(r, q.screen.z) * pxScale, 1));
      gl.uniform1f(p.u('uFade'), fade(intro, 1.5, 3));
    }
    off = attribs(p, buffers.quad, [['aQ', 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); off();
  });

  gl.blendFunc(gl.ONE, gl.ONE);
  p = progs.mote; gl.useProgram(p.p);
  gl.uniform1f(p.u('uRT'), rt); gl.uniform1f(p.u('uTan'), cam.tan);
  gl.uniform1f(p.u('uPxH'), canvas.height / 2); gl.uniform1f(p.u('uFade'), fade(intro, 1, 3.5));
  gl.uniform2f(p.u('uShift'), cam.sx * .3, cam.sy * .3);
  gl.uniform2f(p.u('uPar'), -pointer.sx * .04, -pointer.sy * .03);
  off = attribs(p, buffers.motes, [['aM', 4], ['aS', 1]]);
  gl.drawArrays(gl.POINTS, 0, moteCount); off();

  if (field.streak) {
    p = progs.streak; gl.useProgram(p.p);
    gl.uniform2fv(p.u('uA'), field.streak.a); gl.uniform2fv(p.u('uB'), field.streak.b);
    gl.uniform1f(p.u('uAlpha'), field.streak.alpha);
    off = attribs(p, buffers.streak, [['aT', 1]]);
    gl.drawArrays(gl.LINES, 0, 2); off();
  }
}
// Uniforms of the living field; programs that do not declare one simply ignore it.
function setField(p) {
  gl.uniform1f(p.u('uBreath'), field.breath); gl.uniform1f(p.u('uHalo'), field.halo);
  gl.uniform1f(p.u('uWaveR'), field.waveR); gl.uniform1f(p.u('uWaveA'), field.waveA);
}
planets.forEach(p => { p.look._rgb = {c1:hex(p.look.c1), c2:hex(p.look.c2), c3:hex(p.look.c3), atm:hex(p.look.atm)}; });

// ---------------------------------------------------------------------------
// 2D fallback: same projection, CSS draws the planet faces and the star core.
let ctx2d = null, fallbackStars = [];
function render2D() {
  const c = ctx2d, ratio = canvas.width / W;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#070d1d'); g.addColorStop(1, '#03050b');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const star = starScreen;
  const glow = c.createRadialGradient(star.x, star.y, 0, star.x, star.y, Math.max(W, H) * .5);
  glow.addColorStop(0, 'rgba(255,182,92,.26)'); glow.addColorStop(.3, 'rgba(120,110,190,.07)'); glow.addColorStop(1, 'rgba(60,70,140,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  fallbackStars.forEach(s => { c.fillStyle = `rgba(233,241,255,${s.a})`; c.fillRect(s.x * W, s.y * H, s.r, s.r); });
  const pt = {}, tmp = v3();
  const path = (o, from, span, alpha, color) => {
    c.beginPath();
    for (let i = 0; i <= 160; i++) { project(orbitPoint(o, from + i / 160 * span, tmp), pt); i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y); }
    c.strokeStyle = `rgba(${color},${alpha})`; c.lineWidth = 1; c.stroke();
  };
  ARCS.forEach(([a, e, incl, node, start, span, alpha]) => path({a, e, incl, node}, start * DEG, span * DEG, alpha, '200,205,235'));
  planets.forEach(p => path(p, 0, TAU, .22 + p.hover * .25, '233,241,255'));
  path(giantOrbit(), 0, TAU, .12, '220,228,250');
  const gs = giant.screen, gr = c.createRadialGradient(gs.x - giant.pr * .35, gs.y - giant.pr * .35, 0, gs.x, gs.y, giant.pr);
  gr.addColorStop(0, '#8a6844'); gr.addColorStop(.6, '#3b2c2a'); gr.addColorStop(1, '#14141f');
  c.fillStyle = gr; c.beginPath(); c.arc(gs.x, gs.y, giant.pr, 0, TAU); c.fill();
  c.fillStyle = '#0b0b10';
  [wreck.moon, ...wreck.rocks].forEach(o => { c.beginPath(); c.arc(o.screen.x, o.screen.y, o.pr, 0, TAU); c.fill(); });
}

// ---------------------------------------------------------------------------
// Frame loop
function resize() {
  W = innerWidth; H = innerHeight;
  comp = composition(W, H);
  dpr = Math.min(devicePixelRatio || 1, [2, 1.5, 1][quality]);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  if (!gl) fallbackStars = Array.from({length:160}, () => ({x:rand(), y:rand(), r:rand() * 1.4 + .4, a:rand() * .5 + .12}));
  placeGiant();
  measureLabels();
  dirty = true;
}
addEventListener('resize', resize);
document.fonts?.ready.then(() => { measureLabels(); dirty = true; });

function syncDom() {
  planets.forEach(p => {
    const s = p.screen, b = p.button;
    p.pr = pxRadius(p.radius * comp.scale, s.z);
    if (!b) return;
    if (Math.abs(p.pr - p.lastR) > .4) { b.style.setProperty('--pr', `${p.pr.toFixed(1)}px`); p.lastR = p.pr; }
    b.style.transform = `translate3d(${s.x.toFixed(1)}px,${s.y.toFixed(1)}px,0)`;
    const z = Math.round(40 - s.z * 2);
    if (z !== p.lastZ) { b.style.zIndex = z; p.lastZ = z; }
  });
  placeLabels();
  if (starAnchor) {
    starAnchor.style.transform = `translate3d(${starScreen.x.toFixed(1)}px,${starScreen.y.toFixed(1)}px,0)`;
    starAnchor.style.setProperty('--sr', `${pxRadius(STAR.radius * Math.sqrt(comp.scale), starScreen.z).toFixed(1)}px`);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(Math.max((now - last) / 1000, 0), .05);
  last = now;
  if (document.hidden) return;

  const reduced = reducedMotion();
  const rt = (now - introStart) / 1000;
  const intro = reduced ? 10 : rt;

  // Travel animation (independent of reduced-motion so state always settles).
  let travelling = false;
  if (travel.planet && travel.k !== travel.to) {
    const t = travel.duration > 0 ? Math.min((now - travel.start) / travel.duration, 1) : 1;
    travel.k = lerp(travel.from, travel.to, t);
    travelling = true;
    if (t >= 1 && travel.resolve) { const r = travel.resolve; travel.resolve = null; r(); }
  }
  if (surfaceOpen() && !travelling) return;

  const motionTarget = globallyPaused() || travel.planet ? 0 : 1;
  globalMotion = reduced ? 0 : approach(globalMotion, motionTarget, 2.6, dt);
  orbitalClock += dt * globalMotion;
  if (!reduced) driftClock += dt * Math.max(globalMotion, .25);
  pointer.sx = reduced ? 0 : approach(pointer.sx, pointer.x, 2.2, dt);
  pointer.sy = reduced ? 0 : approach(pointer.sy, pointer.y, 2.2, dt);

  let easing = false;
  planets.forEach(p => {
    const before = p.hover;
    p.hover = reduced ? p.hoverTarget : approach(p.hover, p.hoverTarget, 5, dt);
    if (Math.abs(p.hover - before) > .001) easing = true;
    p.theta += p.dir * TAU / p.period * dt * globalMotion * (1 - p.hover);
  });

  if (reduced && !dirty && !travelling && !easing) return;
  dirty = false;

  updateField(rt);
  updateCamera(intro);
  const starZ = dot(sub(v3(), cam.pos), cam.F);
  planets.forEach(p => {
    orbitPoint(p, p.theta, p.pos);
    project(p.pos, p.screen);
    p.dim = .74 + .26 * Math.min(Math.max((starZ - p.screen.z) / p.a * .5 + .5, 0), 1);
  });
  project(v3(), starScreen);
  orbitPoint(giantOrbit(), giant.theta0 + giantAngle(), giant.pos);
  project(giant.pos, giant.screen);
  giant.pr = pxRadius(giant.G, giant.screen.z);
  updateWreck();
  syncDom();

  if (gl) renderGL(rt, intro); else render2D();

  // Adaptive quality: step down when frames stay slow.
  frameEMA = lerp(frameEMA, dt * 1000, .05);
  if (++frameCount > 120 && frameEMA > 24 && quality < 2) { quality++; frameCount = 0; resize(); }
}

try {
  if (gl) {
    initGL();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); body.classList.replace('has-webgl', 'no-webgl'); }, false);
  }
} catch (error) {
  console.warn('Orbital Archive: WebGL unavailable, using fallback.', error);
}
if (!gl || !progs.planet) {
  // A canvas that already holds a WebGL context cannot switch to 2D, so swap it.
  if (gl) { const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); canvas = fresh; gl = null; }
  body.classList.replace('has-webgl', 'no-webgl');
  ctx2d = canvas.getContext('2d');
}
resize();
requestAnimationFrame(frame);
})();
