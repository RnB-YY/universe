// Planetary exploration: the two levels below the galactic overview.
//   LEVEL 02 · planetary observation — one planet fills the frame and turns slowly;
//             regional signal nodes sit on real latitude/longitude positions of its
//             surface, turn with it and disappear behind the limb.
//   LEVEL 03 · regional environment — an animated landscape of that region, built
//             from the planet's shared ecology (worlds-data.js) and the region's
//             local scene, with the real portfolio content of that category on top.
// Both levels share one WebGL canvas above the galaxy (cosmos.js), which pauses while
// they are open. Navigation is hash-based (#/bloom/tidal-mirror), so every level can
// be linked to, refreshed and reached with the browser's back button.
(() => {
'use strict';

const WORLDS = window.WORLDS, PRESETS = window.WORLD_PARTICLES, folio = window.portfolio;
if (!WORLDS || !folio) return;

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const body = document.body;
const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeIn = t => t * t * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
const reduced = () => body.dataset.motion === 'reduced';
const portrait = () => innerWidth / innerHeight < .9 || innerWidth <= 560;

const PLANET_IDS = Object.keys(WORLDS);
const byCode = Object.fromEntries(PLANET_IDS.map(id => [WORLDS[id].code.toLowerCase(), id]));
PLANET_IDS.forEach(id => {
  const w = WORLDS[id];
  w.id = id;
  w.rgb = Object.fromEntries(Object.entries(w.palette).map(([k, v]) => [k, hex(v)]));
  w.regions.forEach((r, i) => {
    r.planet = id; r.order = i;
    const la = r.lat * DEG, lo = r.lon * DEG;
    r.local = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
  });
});
const regionOf = (planet, id) => WORLDS[planet]?.regions.find(r => r.id === id) || null;

// ---------------------------------------------------------------------------
// Rotation: M = Rx(pitch) · Rz(tilt) · Ry(spin) takes planet-local coordinates to
// view space (x right, y up, z toward the viewer). Row-major 3×3 arrays.
const mul = (A, B) => { const C = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C.push(A[r*3]*B[c] + A[r*3+1]*B[3+c] + A[r*3+2]*B[6+c]); return C; };
const apply = (M, v) => [M[0]*v[0] + M[1]*v[1] + M[2]*v[2], M[3]*v[0] + M[4]*v[1] + M[5]*v[2], M[6]*v[0] + M[7]*v[1] + M[8]*v[2]];
const T = M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
const Ry = s => { const c = Math.cos(s), n = Math.sin(s); return [c, 0, n, 0, 1, 0, -n, 0, c]; };
const Rz = s => { const c = Math.cos(s), n = Math.sin(s); return [c, -n, 0, n, c, 0, 0, 0, 1]; };
const Rx = s => { const c = Math.cos(s), n = Math.sin(s); return [1, 0, 0, 0, c, -n, 0, n, c]; };

// Per-planet observation memory: user yaw/pitch and the last chosen region.
const memory = Object.fromEntries(PLANET_IDS.map(id => [id, {yaw:0, pitch:.1, vyaw:0, selected:null}]));
let spinClock = 0;
const spinAngle = w => TAU * spinClock / w.rotation.period + memory[w.id].yaw;
function orientation(w, cloud = false) {
  const m = memory[w.id], s = spinAngle(w) * (cloud ? w.rotation.clouds : 1) + (cloud ? 1.3 : 0);
  return mul(Rx(m.pitch), mul(Rz(w.rotation.tilt * DEG), Ry(s)));
}
// Yaw/pitch that bring a region to the centre of the visible disc.
function facing(w, r) {
  const m = memory[w.id];
  let yaw = r.lon * DEG - Math.PI / 2 - TAU * spinClock / w.rotation.period;
  yaw = m.yaw + (((yaw - m.yaw) % TAU) + TAU + Math.PI) % TAU - Math.PI;
  const v = apply(mul(Rz(w.rotation.tilt * DEG), Ry(yaw + TAU * spinClock / w.rotation.period)), r.local);
  return {yaw, pitch:clamp(Math.atan2(v[1], v[2]), -.75, .75)};
}

// ---------------------------------------------------------------------------
// Composition of the observed planet: centre (NDC) and radius (NDC height units),
// framed per planet (worlds-data.js `frame`) for wide, tablet and portrait screens.
function composition(id = view.planet) {
  const a = innerWidth / innerHeight, f = WORLDS[id]?.frame;
  const [cx, cy, R] = portrait() ? f.portrait : a < 1.3 ? f.tablet : f.wide;
  return {cx, cy, R};
}
// Apparent radius of a planet at the end of the galaxy fly-in, so the hand-over matches.
const galaxyRadius = () => window.cosmos?.focusRadius?.() || .36;

const view = {show:'none', planet:null, region:null, fade:0, cx:0, cy:0, R:.36, zoom:0, haze:0, envFog:1, settle:0};

// ---------------------------------------------------------------------------
// DOM: observation layer and regional layer, built from the data.
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const canvas = el('canvas'); canvas.id = 'worldview'; canvas.setAttribute('aria-hidden', 'true');
body.append(canvas);

const obsLayer = el('section', 'observation'); obsLayer.setAttribute('aria-label', '行星观测');
obsLayer.innerHTML = `
  <header class="world-bar"><button class="world-back" type="button" data-up><span aria-hidden="true">←</span> 返回星系</button><span class="world-coord"></span></header>
  <div class="obs-info">
    <p class="obs-eyebrow"></p>
    <h2 class="obs-title"></h2>
    <p class="obs-name"></p>
    <p class="obs-quote"></p>
    <p class="obs-text"></p>
    <dl class="obs-meta"></dl>
  </div>
  <div class="obs-nodes" role="group" aria-label="地表区域"></div>
  <p class="obs-hint" aria-hidden="true"></p>`;
const regionLayer = el('section', 'region'); regionLayer.setAttribute('aria-label', '区域');
regionLayer.innerHTML = `
  <header class="world-bar"><button class="world-back" type="button" data-up></button><span class="world-coord"></span></header>
  <article class="region-panel">
    <p class="region-eyebrow"></p>
    <h2 class="region-title"></h2>
    <p class="region-note"></p>
    <p class="region-biome"></p>
    <div class="region-projects"></div>
  </article>`;
body.append(obsLayer, regionLayer);
[obsLayer, regionLayer].forEach(l => { l.inert = true; l.setAttribute('aria-hidden', 'true'); });
const $ = (root, s) => root.querySelector(s);
const nodeRoot = $(obsLayer, '.obs-nodes');
let nodes = [];

function fmtLat(v) { return `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`; }
function fmtLon(v) { return `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'E' : 'W'}`; }

function buildObservation(w) {
  obsLayer.style.setProperty('--accent', w.palette.accent);
  obsLayer.style.setProperty('--atm', w.atmosphere.color);
  $(obsLayer, '.world-coord').textContent = `${w.code}–${w.index} · PLANETARY OBSERVATION`;
  $(obsLayer, '.obs-eyebrow').textContent = `${w.index} · ${w.code} · ${w.identity}`;
  $(obsLayer, '.obs-title').textContent = folio.taxonomy[w.id].label;
  $(obsLayer, '.obs-name').textContent = `${w.name} · ${w.classification}`;
  $(obsLayer, '.obs-quote').innerHTML = w.title;
  $(obsLayer, '.obs-text').textContent = w.text;
  const meta = $(obsLayer, '.obs-meta'); meta.replaceChildren();
  [['地表信号', ''], ['地质', w.ecology.geology], ['大气', w.ecology.atmosphere]].forEach(([k, v], i) => {
    const row = el('div'); row.append(el('dt', '', k), el('dd', i ? '' : 'obs-signals', v)); meta.append(row);
  });
  $(obsLayer, '.obs-hint').textContent = matchMedia('(pointer: coarse)').matches ? '拖动旋转星球 · 轻触信号查看，再次轻触降落' : '拖动旋转星球 · 点击地表信号降落';
  nodeRoot.replaceChildren();
  nodes = w.regions.map((r, i) => {
    const b = el('button', 'node'); b.type = 'button';
    b.setAttribute('aria-label', `降落到区域：${r.heading} · ${r.name}`);
    b.innerHTML = `<span class="node-ring" aria-hidden="true"></span><span class="node-core" aria-hidden="true"></span><span class="node-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
      <span class="node-label"><b></b><small></small></span>`;
    $(b, 'b').textContent = r.heading;
    $(b, 'small').textContent = `${String(i + 1).padStart(2, '0')} · ${r.name} · ${r.en}`;
    b.addEventListener('pointerdown', e => { b.dataset.pointer = e.pointerType; });
    b.addEventListener('click', e => onNodeClick(r, b, e));
    b.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') setHover(r.id); });
    b.addEventListener('pointerleave', () => setHover(null));
    b.addEventListener('focus', () => { setHover(r.id); if (b.classList.contains('is-back')) turnTo(w, r); });
    b.addEventListener('blur', () => setHover(null));
    nodeRoot.append(b);
    return {r, b, vis:-1, front:false, x:0, y:0};
  });
  signalsText = '';
}
let hoverId = null, signalsText = '';
function setHover(id) { hoverId = id; }

function buildRegion(w, r) {
  regionLayer.style.setProperty('--accent', w.palette.accent);
  const back = $(regionLayer, '.world-back');
  back.innerHTML = `<span aria-hidden="true">←</span> 返回 ${w.code} 观测`;
  $(regionLayer, '.world-coord').textContent = `${w.code} · LAT ${fmtLat(r.lat)} · LON ${fmtLon(r.lon)}`;
  $(regionLayer, '.region-eyebrow').textContent = `${w.code} · 区域 ${String(r.order + 1).padStart(2, '0')} · ${r.name} ${r.en}`;
  $(regionLayer, '.region-title').textContent = r.heading;
  $(regionLayer, '.region-note').textContent = r.note;
  $(regionLayer, '.region-biome').textContent = `${r.biome} · ${w.ecology.motion}`;
  const list = $(regionLayer, '.region-projects'); list.replaceChildren();
  const projects = folio.projectIndex.filter(p => p.world === w.id && p.category === r.heading);
  if (!projects.length) list.append(el('p', 'region-empty', '这个分类暂时还没有发布的项目，内容收录后会出现在这里。'));
  projects.forEach(p => {
    const a = folio.artifacts[p.id], card = el('article', 'project');
    card.append(el('p', 'project-meta', a.meta), el('h3', '', a.title), el('p', 'project-text', a.description));
    const links = el('div', 'project-links');
    a.links.forEach(([label, href]) => { const link = el('a', '', label); link.href = href; links.append(link); });
    if (!a.links.length) links.append(el('span', 'project-pending', '内容整理中'));
    card.append(links);
    list.append(card);
  });
}

function showLayer(layer, on) {
  layer.classList.toggle('is-visible', on);
  layer.inert = !on;
  layer.setAttribute('aria-hidden', String(!on));
}

// ---------------------------------------------------------------------------
// Node interaction. Desktop: click descends. Touch: the first tap selects and shows
// the label, a second tap on the same node descends. Dragging never activates a node.
let drag = null, selectedTouch = null;
function onNodeClick(r, b, e) {
  if (nav.busy || drag?.moved) return;
  const touch = b.dataset.pointer === 'touch';
  if (touch && selectedTouch !== r.id) {
    selectedTouch = r.id; memory[r.planet].selected = r.id;
    nodes.forEach(n => n.b.classList.toggle('is-selected', n.r.id === r.id));
    return;
  }
  memory[r.planet].selected = r.id;
  navigate({level:3, planet:r.planet, region:r.id});
}
obsLayer.addEventListener('pointerdown', e => {
  if (nav.level !== 2 || nav.busy || e.target.closest('button, a')) return;
  drag = {x:e.clientX, y:e.clientY, id:e.pointerId, moved:false, t:performance.now()};
  obsLayer.setPointerCapture?.(e.pointerId);
});
obsLayer.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) > 5) drag.moved = true;
  const m = memory[view.planet], k = 3.2 / Math.max(innerHeight * view.R, 200);
  m.yaw += dx * k; m.pitch = clamp(m.pitch + dy * k, -.75, .75);
  const now = performance.now();
  m.vyaw = dx * k / Math.max((now - drag.t) / 1000, .008);
  drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
});
const endDrag = e => {
  if (!drag || (e && e.pointerId !== drag.id)) return;
  const moved = drag.moved; drag = moved ? {moved:true} : null;
  if (moved) setTimeout(() => { drag = null; }, 0);
  else { selectedTouch = null; nodes.forEach(n => n.b.classList.remove('is-selected')); }
};
obsLayer.addEventListener('pointerup', endDrag);
obsLayer.addEventListener('pointercancel', endDrag);

function turnTo(w, r) {
  const m = memory[w.id], f = facing(w, r), y0 = m.yaw, p0 = m.pitch;
  m.vyaw = 0;
  tween(reduced() ? 0 : 900, k => { m.yaw = lerp(y0, f.yaw, ease(k)); m.pitch = lerp(p0, f.pitch, ease(k)); });
}

// ---------------------------------------------------------------------------
// Tweens run on the frame loop; a timer finishes them if frames stall, so
// navigation never waits on rendering.
const tweens = new Set();
function tween(duration, fn) {
  return new Promise(resolve => {
    const t = {start:performance.now(), duration, fn, resolve};
    const finish = () => { if (!tweens.has(t)) return; tweens.delete(t); fn(1); resolve(); };
    t.finish = finish;
    if (duration <= 0) { fn(1); resolve(); return; }
    tweens.add(t); wake();
    setTimeout(finish, duration + 400);
  });
}
function runTweens(now) {
  tweens.forEach(t => { const k = clamp((now - t.start) / t.duration); t.fn(k); if (k >= 1) t.finish(); });
}

// ---------------------------------------------------------------------------
// Navigation state machine.
const nav = {level:1, planet:null, region:null, busy:false, pending:null, instant:false};
const same = (a, b) => a.level === b.level && (a.level < 2 || a.planet === b.planet) && (a.level < 3 || a.region === b.region);

async function go(target) {
  if (nav.busy) { nav.pending = target; return; }
  nav.busy = true; body.classList.add('world-busy');
  try {
    for (let guard = 0; guard < 6 && !same(nav, target); guard++) {
      if (nav.level === 3) await ascend();
      else if (nav.level === 2 && (target.level === 1 || target.planet !== nav.planet)) await leavePlanet();
      else if (nav.level === 1) await enterPlanet(target.planet);
      else if (nav.level === 2 && target.level === 3) await descend(target.region);
    }
  } finally {
    nav.busy = false; nav.instant = false; body.classList.remove('world-busy');
    const next = nav.pending; nav.pending = null;
    if (next && !same(nav, next)) go(next);
  }
}

async function enterPlanet(id) {
  const w = WORLDS[id], c = composition(id), instant = nav.instant || reduced();
  folio.closeCatalogue?.();
  buildObservation(w);
  view.planet = id; view.region = null; view.zoom = 0; view.haze = 0;
  body.classList.add('is-traveling');
  if (!instant && !nav.instant && window.cosmos) await window.cosmos.travel(id);
  if (!initGL()) body.classList.add('worlds-2d');
  else planetProgram(w);   // compile before the fade begins, so the hand-over stays smooth
  view.show = 'planet';
  const r0 = nav.instant ? c.R : galaxyRadius();
  Object.assign(view, {cx:nav.instant ? c.cx : 0, cy:nav.instant ? c.cy : 0, R:r0, fade:0});
  wake();
  await tween(instant ? (reduced() ? 250 : 0) : 450, k => { view.fade = k; });
  body.classList.add('surface-open'); body.classList.remove('is-traveling');
  setGalaxyInert(true);
  nav.level = 2; nav.planet = id; nav.region = null;
  showLayer(obsLayer, true);
  const sx = view.cx, sy = view.cy, sR = view.R;
  await tween(instant ? 0 : 1100, k => { const e = ease(k); view.cx = lerp(sx, c.cx, e); view.cy = lerp(sy, c.cy, e); view.R = lerp(sR, c.R, e); });
  focusSoon($(obsLayer, '.world-back'));
}

async function leavePlanet() {
  const instant = nav.instant || reduced(), id = nav.planet;
  showLayer(obsLayer, false);
  const sx = view.cx, sy = view.cy, sR = view.R, gR = galaxyRadius();
  await tween(instant ? 0 : 700, k => { const e = ease(k); view.cx = lerp(sx, 0, e); view.cy = lerp(sy, 0, e); view.R = lerp(sR, gR, e); });
  body.classList.remove('surface-open');
  setGalaxyInert(false);
  window.cosmos?.arrive();
  await tween(instant ? (reduced() ? 250 : 0) : 500, k => { view.fade = 1 - k; });
  view.show = 'none';
  nav.level = 1; nav.planet = null; nav.region = null;
  focusSoon(document.querySelector(`.system .planet[data-world="${id}"]`));
}

async function descend(regionId) {
  const w = WORLDS[nav.planet], r = regionOf(w.id, regionId);
  if (!r) { nav.level = 2; return; }
  const instant = nav.instant || reduced(), m = memory[w.id], c = composition();
  memory[w.id].selected = r.id; selectedTouch = null;
  showLayer(obsLayer, false);
  obsLayer.classList.add('is-descending');
  nodes.forEach(n => n.b.classList.toggle('is-selected', n.r.id === r.id));
  buildRegion(w, r);
  if (gl) envPrograms(w, r);   // compile now, before the camera starts moving
  // 1 · rotation stops and the region turns to face the viewer
  const f = facing(w, r), y0 = m.yaw, p0 = m.pitch, sx = view.cx, sy = view.cy, sR = view.R;
  m.vyaw = 0;
  await tween(instant ? 0 : 1300, k => {
    const e = ease(k);
    m.yaw = lerp(y0, f.yaw, e); m.pitch = lerp(p0, f.pitch, e);
    view.cx = lerp(sx, 0, e); view.cy = lerp(sy, 0, e); view.R = lerp(sR, c.R * 1.35, e);
  });
  // 2 · the surface rushes up, detail sharpens, the atmosphere closes in
  const R1 = view.R, R2 = 16;
  await tween(instant ? 0 : 1700, k => {
    const e = easeIn(k);
    view.R = R1 * Math.pow(R2 / R1, e); view.zoom = smooth(.2, 1, k); view.haze = smooth(.55, 1, k);
  });
  obsLayer.classList.remove('is-descending');
  // 3 · through the cloud deck the region appears and the camera settles
  setupEnv(w, r);
  view.show = 'env'; view.region = r.id; view.envFog = 1; view.settle = 1;
  nav.level = 3; nav.region = r.id;
  showLayer(regionLayer, true);
  await tween(instant ? (reduced() ? 300 : 0) : 2000, k => { const e = ease(k); view.envFog = 1 - e; view.settle = 1 - e; });
  focusSoon($(regionLayer, '.world-back'));
}

async function ascend() {
  const w = WORLDS[nav.planet], instant = nav.instant || reduced(), c = composition();
  showLayer(regionLayer, false);
  await tween(instant ? (reduced() ? 250 : 0) : 1000, k => { view.envFog = ease(k); view.settle = -ease(k) * .6; });
  view.show = 'planet'; view.region = null;
  const R2 = 16; view.R = R2; view.cx = 0; view.cy = 0; view.haze = 1; view.zoom = 1;
  nav.level = 2; nav.region = null;
  await tween(instant ? 0 : 1900, k => {
    const e = ease(k);
    view.R = R2 * Math.pow(c.R / R2, e); view.haze = 1 - smooth(0, .45, k); view.zoom = 1 - smooth(0, .7, k);
    view.cx = lerp(0, c.cx, smooth(.3, 1, k)); view.cy = lerp(0, c.cy, smooth(.3, 1, k));
  });
  showLayer(obsLayer, true);
  const sel = nodes.find(n => n.r.id === memory[w.id].selected);
  nodes.forEach(n => n.b.classList.toggle('is-selected', n === sel));
  focusSoon(sel?.b || $(obsLayer, '.world-back'));
}

function setGalaxyInert(on) {
  const stage = document.getElementById('orbit'), header = document.querySelector('.site-header');
  if (stage) stage.inert = on;
  if (header) header.inert = on;
}
const focusSoon = target => setTimeout(() => target?.focus({preventScroll:true}), 30);

// Hash routes: #/ · #/bloom · #/bloom/tidal-mirror
function parse(hash) {
  const [code, region] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const planet = byCode[(code || '').toLowerCase()];
  if (!planet) return {level:1};
  if (region && regionOf(planet, region)) return {level:3, planet, region};
  return {level:2, planet};
}
const hashOf = t => t.level === 1 ? '#/' : `#/${WORLDS[t.planet].code.toLowerCase()}${t.level === 3 ? '/' + t.region : ''}`;
function navigate(target, replace = false) {
  const hash = hashOf(target);
  if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState']({child:!replace && target.level > 1}, '', hash);
  go(target);
}
// One level up: step back through history when the parent is the previous entry.
function up() {
  if (nav.level === 1) return;
  const parent = nav.level === 3 ? {level:2, planet:nav.planet} : {level:1};
  if (history.state?.child) history.back(); else navigate(parent, true);
}
addEventListener('popstate', () => go(parse(location.hash)));
document.addEventListener('click', e => { if (e.target.closest('[data-up]')) up(); });

// Galaxy planets open the observation level instead of a surface.
document.querySelectorAll('.system .planet[data-world]').forEach(b => {
  b.addEventListener('click', () => navigate({level:2, planet:b.dataset.world}));
});

window.worlds = {up, navigate, level:() => nav.level};

// ---------------------------------------------------------------------------
// WebGL
let gl = null, progs = {}, buf = {}, fboSize = [0, 0], quality = matchMedia('(max-width: 820px)').matches ? 1 : 0;
let particleCount = 0, envConf = null;

const FS_PRECISION = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
const NOISE = `
float hash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }
float fbm3(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 3; i++){ s += a * noise(p); p = p * 2.07 + vec3(4.1, 1.3, 7.7); a *= .5; } return s * 1.14; }
float ridge(vec3 p){ return 1.0 - abs(fbm3(p) * 2.0 - 1.0); }`;

const SHADERS = {
  quadVS: `attribute vec2 aQ; varying vec2 vUv; void main(){ vUv = aQ * .5 + .5; gl_Position = vec4(aQ, 0.0, 1.0); }`,
  copyFS: `precision mediump float; uniform sampler2D uTex; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb + (h(gl_FragCoord.xy) - .5) / 150.0, 1.0); }`,

  // LEVEL 02 · the observed planet. An orthographic sphere: q is the position on the
  // disc, n its view-space normal, and uInv turns n back into planet-local coordinates,
  // where every surface pattern lives — so markings, regions and nodes turn together.
  // Each planet compiles only its own surface model (KIND) and its own cloud deck;
  // region stamps shape the geography around the real coordinates of its regions.
  // Relief comes from screen-space derivatives of the surface height (when available),
  // so the terminator reveals structure instead of a smooth gradient.
  // A planet with surface maps (worlds-data.js `maps`) compiles with MAPS: its surface is
  // read from baked equirectangular textures instead of the procedural model below.
  planetFS: (kind, deriv, maps) => (deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV\n' : '') + (maps ? '#define MAPS\n' : '') + `#define KIND ${kind}\n` + FS_PRECISION + NOISE + `
uniform vec2 uRes; uniform vec3 uC; uniform mat3 uRot, uInv, uCloud;
uniform float uAspect, uT, uZoom, uHaze, uRing, uAtmT, uAtmIn, uCloudAmt, uBump;
uniform vec3 uAtm, uTerm, uL, uHazeCol; uniform vec4 uReg[4];
vec3 gN;        // planet-local surface normal, when the surface provides one (MAPS)
float gGloss;   // 1 - roughness, when the surface provides it (MAPS)

float fbm6(vec3 p){ float s = 0.0, a = .5; for (int i = 0; i < 6; i++){ s += a * noise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= .5; } return s; }
vec3 warp3(vec3 p, float f){ return vec3(fbm3(p * f), fbm3(p * f + vec3(5.2, 1.3, 2.8)), fbm3(p * f + vec3(2.1, 7.7, 4.4))) - .5; }
float near(vec3 p, float code){ float c = -1.0; for (int i = 0; i < 4; i++) if (abs(uReg[i].w - code) < .5) c = max(c, dot(p, uReg[i].xyz)); return c; }
vec3 dirOf(float code){ vec3 d = vec3(0.0, 1.0, 0.0); for (int i = 0; i < 4; i++) if (abs(uReg[i].w - code) < .5) d = uReg[i].xyz; return d; }
float stamp(vec3 p, float code, float a, float b){ return smoothstep(a, b, near(p, code)); }
vec3 swirl(vec3 s, vec3 c, float size, float turn){
  float k = exp(-dot(s - c, s - c) / (size * size)) * turn, cs = cos(k), sn = sin(k);
  vec3 o = s - c, ax = normalize(c);
  return c + o * cs + cross(ax, o) * sn + ax * dot(ax, o) * (1.0 - cs);
}

#if KIND == 0 && defined(MAPS)
// ORIGIN · baked geological maps (origin-material/ in the project root rebuilds them).
//   uAlb  albedo · uNx, uNy  tangent normal x (east) and y (north), square-root encoded,
//   greyscale · uAux  R roughness, G geothermal. The geological mask and height map that
//   drove the bake are not needed at run time. Equirectangular: u = longitude, v = latitude.
uniform sampler2D uAlb, uNx, uNy, uAux; uniform float uNormal;
vec2 uvOf(vec3 p){
  float u = atan(p.z, p.x) * .15915494 + .5, v = .5 - asin(clamp(p.y, -1.0, 1.0)) * .31830989;
#ifdef DERIV
  // The longitude seam: where u wraps, pick the copy of u that is continuous here,
  // so mip selection does not jump to the smallest level along a line.
  float u2 = fract(u + .5) - .5;
  u = fwidth(u) < fwidth(u2) + 1e-5 ? u : u2;
#endif
  return vec2(u, v);
}
void surface(vec3 p, out vec3 alb, out vec3 em, out float spec, out float h){
  vec2 uv = uvOf(p);
  alb = texture2D(uAlb, uv).rgb;
  vec2 aux = texture2D(uAux, uv).rg;
  h = 0.0;
  // Tangent normal into planet-local space (east / north tangents, p is up).
  vec2 t = vec2(texture2D(uNx, uv).r, texture2D(uNy, uv).r) * 2.0 - 1.0, s = t * abs(t) * uNormal;
  float cl = max(length(p.xz), .02);
  vec3 e = vec3(-p.z, 0.0, p.x) / cl, nn = vec3(-p.y * p.x / cl, cl, -p.y * p.z / cl);
  gN = normalize(s.x * e + s.y * nn + sqrt(max(1.0 - dot(s, s), 0.0)) * p);
  gGloss = 1.0 - aux.r;
  // Geothermal light only where the map puts it; one slow, planet-wide breath.
  // The planet is framed with its night side mostly off screen, so the glow must also
  // read faintly in daylight (the lighting keeps ~15% of emission on the day side).
  em = vec3(1.0, .4, .12) * aux.g * aux.g * (.8 + .2 * sin(uT * .25)) * 2.4;
  spec = mix(.015, .07, gGloss * gGloss);   // rock is a weak dielectric reflector
}
// A thin, broken dust veil: no latitudinal banding.
float clouds(vec3 c){
  vec3 w = c + warp3(c, 2.0) * .22;
  return smoothstep(.6, .8, fbm6(w * vec3(3.0, 4.0, 3.0))) * .3;
}
const vec3 CLOUD = vec3(.8, .68, .54);

#elif KIND == 0
// ORIGIN · an ancient terrestrial world. Sediment laid down by long circulation runs in
// latitudinal, eddying strata of cream, ochre and copper; dark basalt basins are cut by
// thermal fractures; the Primordial Basin is a vast oval caldera of swirled red rock.
void surface(vec3 p, out vec3 alb, out vec3 em, out float spec, out float h){
  float plateau = stamp(p, 5.0, .9, .985);
  vec3 w = p + warp3(p, 2.2) * .45;
  w += warp3(w, 5.5) * .12;
  float cont = fbm(p * 1.6 + 3.1) + plateau * .2;
  float flow = fbm6(w * vec3(3.0, 11.0, 3.0));
  float strata = .5 + .5 * sin(w.y * 26.0 + flow * 7.0);
  float fine = fbm3(p * 42.0);
  vec3 cream = vec3(.78, .64, .45), ochre = vec3(.64, .38, .17), copper = vec3(.46, .19, .08), rust = vec3(.3, .1, .05), coal = vec3(.06, .045, .04);
  vec3 sed = mix(ochre, cream, smoothstep(.35, .85, strata));
  sed = mix(sed, copper, smoothstep(.55, .78, flow) * .85);
  sed *= .8 + .32 * fine;
  float low = 1.0 - smoothstep(.36, .49, cont);
  vec3 basalt = mix(coal, rust * .7, fbm3(w * 14.0)) * (.8 + .4 * fine);
  alb = mix(sed, basalt, low);
  vec3 bd = dirOf(4.0);
  float bc = dot(p, bd) - pow(p.y - bd.y, 2.0) * 3.0;   // stretched along latitude: an oval, not a disc
  vec3 sp = swirl(p, bd, .2, 3.5);
  float storm = fbm6((sp + warp3(sp, 6.0) * .1) * vec3(7.0, 12.0, 7.0));
  float oval = smoothstep(.928, .955, bc);
  alb = mix(alb, mix(vec3(.5, .13, .05), vec3(.86, .43, .17), storm) * (.82 + .3 * fine), oval);
  alb = mix(alb, coal * 2.0, exp(-pow((bc - .929) / .006, 2.0)) * .3 * (.5 + fbm3(p * 30.0)));
  float fr = pow(ridge(w * 6.0 + 3.0), 14.0) + pow(ridge(w * 15.0 + 8.0), 20.0) * .5;
  float glow = fr * (low * .7 + oval * .4 + .02);
  em = vec3(1.0, .36, .07) * glow * (.6 + .4 * sin(uT * .3 + fbm3(p * 4.0) * 8.0)) * .75;
  alb *= 1.0 - min(glow, 1.0) * .55;
  h = cont * .6 + flow * .3 + fine * .12 - fr * .15 - oval * .1;
  spec = .04;
}
float clouds(vec3 c){
  vec3 w = c + warp3(c, 3.0) * .3;
  float b = smoothstep(.25, .95, sin(w.y * 11.0 + fbm3(w * 4.0) * 3.0));
  return b * smoothstep(.48, .74, fbm6(w * vec3(4.0, 10.0, 4.0))) * .6;
}
const vec3 CLOUD = vec3(.86, .74, .58);

#elif KIND == 1
// CANOPY · continents under continuous forest. Vegetation density zones (rainforest,
// moss plains, old dark forest), jade wetland basins, khaki uplands where nothing grows,
// dendritic river systems, the dark sinkhole of the Root Abyss.
void surface(vec3 p, out vec3 alb, out vec3 em, out float spec, out float h){
  float dense = stamp(p, 6.0, .88, .975), pit = near(p, 7.0), clear = stamp(p, 8.0, .965, .992);
  vec3 w = p + warp3(p, 1.8) * .35;
  float cont = fbm6(w * 1.7 + 7.3) + dense * .12;
  float land = smoothstep(.43, .45, cont);
  float relief = ridge(w * 3.2 + 1.3);
  float mount = smoothstep(.7, .95, relief) * smoothstep(.52, .66, cont) * (1.0 - dense);
  float zone = fbm3(w * 2.6 + 4.0), zone2 = fbm3(w * 5.5 + 9.0), tex = fbm6(p * 30.0);
  vec3 veg = mix(vec3(.035, .15, .065), vec3(.15, .25, .09), smoothstep(.45, .72, zone));
  veg = mix(veg, vec3(.015, .07, .045), smoothstep(.55, .75, zone2) * .75);
  veg = mix(veg, vec3(.06, .19, .16), smoothstep(.55, .78, fbm3(w * 9.0 + 1.0)) * .75);
  veg *= .68 + .6 * tex;
  vec3 rock = mix(vec3(.28, .24, .17), vec3(.46, .4, .3), fbm3(p * 22.0));
  float wet = smoothstep(.62, .8, fbm3(w * 4.0 + 2.0)) * (1.0 - mount) * land;
  vec3 sea = mix(vec3(.008, .04, .05), vec3(.03, .11, .11), smoothstep(.3, .43, cont));
  alb = mix(sea, veg, land);
  alb = mix(alb, vec3(.03, .1, .1), wet * .65);
  alb = mix(alb, rock, mount);
  float riv = (pow(ridge(w * 7.0 + 2.0), 18.0) + pow(ridge(w * 15.0 + 5.0), 24.0) * .6) * land * (1.0 - mount);
  alb = mix(alb, vec3(.025, .09, .1), min(riv, 1.0) * .85);
  alb = mix(alb, vec3(.24, .27, .16), clear * .5);
  float sink = smoothstep(.993, .997, pit), sinkRim = exp(-pow((pit - .9915) / .0018, 2.0));
  alb = mix(alb, vec3(0.0, .008, .01), sink);
  em = vec3(.9, .74, .34) * (riv * .06 + sinkRim * .5);
  h = cont * .5 + mount * .45 + tex * .1 - riv * .12 - sink * .3;
  spec = (1.0 - land) * .4 + wet * .25 + riv * .2;
}
float clouds(vec3 c){
  vec3 w = c + warp3(c, 2.5) * .25;
  float big = fbm6(w * 3.0 + 1.0), puff = fbm3(c * 16.0);
  return smoothstep(.56, .74, big) * (.55 + .6 * puff) + smoothstep(.48, .6, big) * .12;
}
const vec3 CLOUD = vec3(.84, .9, .86);

#elif KIND == 2
// BLOOM · one connected ocean: deep basins, turquoise shelves, island chains along
// arcs, a tectonic trench, wetland coasts; currents stretch along latitude.
void surface(vec3 p, out vec3 alb, out vec3 em, out float spec, out float h){
  float shelf = stamp(p, 1.0, .88, .98), trench = stamp(p, 2.0, .84, .97), coast = stamp(p, 3.0, .9, .985);
  vec3 w = p + warp3(p, 1.5) * .3;
  float h0 = fbm6(w * 1.9 + 11.0) - .04;
  float chain = pow(ridge(w * 4.5 + 2.0), 6.0);
  h0 = mix(h0, .54 + chain * .12 + fbm3(p * 14.0) * .04, shelf);
  h0 = mix(h0, max(h0, .6 + fbm3(p * 5.0) * .05), coast);
  float rift = pow(ridge(w * 2.6 + 6.0), 12.0);
  h0 -= rift * trench * .5;
  float sea = .6, land = smoothstep(sea, sea + .01, h0);
  float shal = smoothstep(sea - .09, sea, h0) * (1.0 - land), mid = smoothstep(.3, .52, h0);
  float cur = fbm3(vec3(w.x * 4.0, w.y * 16.0, w.z * 4.0) + uT * .003);
  vec3 ocean = mix(vec3(.008, .045, .11), vec3(.018, .13, .23), mid) * (.8 + .4 * cur);
  ocean = mix(ocean, vec3(.04, .24, .28), smoothstep(.0, .55, shal));
  ocean = mix(ocean, vec3(.08, .4, .4), smoothstep(.55, 1.0, shal));
  ocean *= 1.0 - rift * trench * .7;
  float fine = fbm3(p * 40.0);
  vec3 ground = mix(vec3(.12, .25, .16), vec3(.36, .37, .31), smoothstep(.65, .75, h0)) * (.8 + .4 * fine);
  ground = mix(ground, vec3(.5, .47, .38), exp(-pow((h0 - sea - .012) / .008, 2.0)) * .6);
  ground = mix(ground, vec3(.14, .22, .14), coast * smoothstep(sea + .05, sea, h0));
  alb = mix(ocean, ground, land);
  em = vec3(.3, .9, .85) * exp(-pow((h0 - sea) / .01, 2.0)) * .06;
  h = land * (h0 - sea) * 2.0 + fine * .05 * land;
  spec = 1.0 - land;
}
float clouds(vec3 c){
  c = swirl(c, normalize(vec3(.5, .35, .8)), .3, 5.0);
  c = swirl(c, normalize(vec3(-.6, -.3, -.7)), .24, -4.0);
  c = swirl(c, normalize(vec3(.2, -.55, .8)), .16, 4.5);
  vec3 w = c + warp3(c * vec3(1.0, 2.0, 1.0), 2.0) * .32;
  float s = fbm6(w * vec3(3.0, 7.0, 3.0));
  float eye = 1.0 - exp(-dot(c - normalize(vec3(.5, .35, .8)), c - normalize(vec3(.5, .35, .8))) / .0006);
  float streak = fbm3(w * vec3(8.0, 30.0, 8.0));
  return smoothstep(.52, .72, s) * smoothstep(.25, .75, streak) * 1.2 * eye;
}
const vec3 CLOUD = vec3(.95, .97, 1.0);

#else
// STRATA · an old, silent mineral world: cratered graphite and violet highlands, rust
// mineral zones, folded strata, a pale smooth basin of mineral ice with polygonal
// cracks, fracture networks with a faint magenta luminescence.
vec2 cells(vec3 p){
  vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(hash(i + g), hash(i + g + 19.1), hash(i + g + 47.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(d1, d2);
}
void surface(vec3 p, out vec3 alb, out vec3 em, out float spec, out float h){
  float vault = stamp(p, 9.0, .93, .99), fault = stamp(p, 10.0, .86, .98);
  vec3 w = p + warp3(p, 1.7) * .3;
  float terr = fbm6(w * 2.2 + 5.0), fine = fbm3(p * 44.0);
  vec3 graphite = vec3(.1, .09, .11), violet = vec3(.27, .19, .33), rustv = vec3(.31, .15, .18), obsidian = vec3(.025, .02, .03), ice = vec3(.5, .47, .56);
  alb = mix(graphite, violet, smoothstep(.38, .66, terr));
  alb = mix(alb, rustv, smoothstep(.55, .8, fbm3(w * 3.0 + 2.0)) * .65);
  alb = mix(alb, obsidian, smoothstep(.6, .8, fbm3(w * 6.0 + 8.0)) * .75);
  alb *= .9 + .12 * sin((p.y * 1.2 + terr * .8) * 60.0);
  vec2 c1 = cells(p * 6.0), c2 = cells(p * 17.0);
  float bowl = smoothstep(.36, .12, c1.x) * .8 + smoothstep(.3, .1, c2.x) * .4;
  float rim = exp(-pow((c1.x - .38) / .05, 2.0)) + exp(-pow((c2.x - .32) / .045, 2.0)) * .5;
  alb *= 1.0 - bowl * .3; alb += vec3(.07, .06, .08) * rim;
  float edge = dot(p, dirOf(11.0)) + (fbm3(p * 4.0) - .5) * .14;
  float plain = smoothstep(.76, .8, edge);
  vec2 pc = cells(p * 26.0);
  vec3 iceCol = ice * (.9 + .12 * fine) * (1.0 - smoothstep(.05, .0, pc.y - pc.x) * .3);
  alb = mix(alb, iceCol, plain);
  float fr = pow(ridge(w * 5.0 + 1.0), 18.0) * (1.0 + fault * 2.5) * (1.0 - plain);
  alb *= 1.0 - min(fr, 1.0) * .55;
  float g = hash(floor(p * 220.0)), glint = step(.985, g) * vault;
  em = vec3(.72, .28, .78) * (fr * .06 + glint * (.6 + .4 * sin(uT * 2.0 + g * 40.0)));
  h = mix(terr * .6 - bowl * .35 + rim * .25 + fine * .08 - fr * .2, .25 + fine * .03, plain);
  spec = .08 + plain * .1;
}
float clouds(vec3 c){ return smoothstep(.6, .82, fbm3(c * vec3(2.0, 5.0, 2.0))) * .35; }
const vec3 CLOUD = vec3(.62, .56, .7);
#endif

void main(){
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec2 q = (ndc - uC.xy) * vec2(uAspect, 1.0) / uC.z;
  float d = length(q);
  vec3 L = normalize(uL);
  // Deep space: black, a few stars, the parent star's glow from the light side.
  float hs = hash(vec3(floor(gl_FragCoord.xy / 2.0), 1.0));
  vec3 col = vec3(.003, .004, .009) + vec3(.03, .034, .06) * exp(-length(ndc - L.xy * 1.6) * 1.4);
  col += vec3(.8, .85, 1.0) * step(.9975, hs) * (hs - .9975) * 300.0 * (.6 + .4 * sin(uT * (1.0 + hs * 3.0) + hs * 50.0)) * (1.0 - uHaze);
  float zS = -2.0;
  if (d < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - d * d));
    zS = n.z;
    vec3 p = uInv * n, alb, em; float spec, h;
    surface(p, alb, em, spec, h);
    alb *= 1.0 + (fbm3(p * 90.0) - .5) * .5 * uZoom;   // finer structure on approach
    vec3 nb = n;
#ifdef MAPS
    nb = normalize(mix(uRot * gN, n, uZoom * .5));
#elif defined(DERIV)
    vec2 g = vec2(dFdx(h), dFdy(h)) * uC.z * uRes.y * .5;
    nb = normalize(n - vec3(g * uBump, 0.0) * (1.0 - uZoom * .7));
#endif
    float ns = dot(n, L), nl = dot(nb, L);
    float day = smoothstep(-.12, .4, ns);
    vec3 sun = vec3(1.0, .94, .84);
    // Clouds and the shadows they cast a little way from the light.
    float cl = min(clouds(uCloud * n) * uCloudAmt, 1.0);
    float shadow = min(clouds(uCloud * normalize(n - L * .02)) * uCloudAmt, 1.0);
    vec3 c = alb * sun * (max(nl, 0.0) * 1.55 + .1 * day) * day * (1.0 - shadow * .5);
    c += alb * uTerm * exp(-pow((ns - .03) / .13, 2.0)) * .45;            // scattering at the terminator
    c += alb * uAtm * .025 * (1.0 - day);                                  // faint bounce on the night side
    vec3 rf = reflect(-L, nb);
#ifdef MAPS
    // Roughness sets the width of the starlight sheen; the lobe is energy-normalised so
    // smooth basalt shows a tighter, brighter highlight and rough upland a faint broad one.
    float ex = mix(4.0, 60.0, gGloss * gGloss);
    c += sun * pow(max(rf.z, 0.0), ex) * (ex + 2.0) * .125 * spec * day;
#else
    c += sun * (pow(max(rf.z, 0.0), 24.0) * .12 + pow(max(rf.z, 0.0), 260.0) * .45) * spec * day;
#endif
    c += em * (1.0 - day * .85);
    float cday = smoothstep(-.18, .35, ns);
    c = mix(c, CLOUD * (cday * (max(ns, 0.0) * .9 + .45) + .01) + uTerm * exp(-pow((ns - .02) / .12, 2.0)) * .25, cl);
    // Atmosphere seen through its depth toward the limb, lit on the day side.
    float path = 1.0 - exp(-uAtmIn / max(n.z, .04));
    c = mix(c, uAtm * (smoothstep(-.25, .5, ns) * .85 + .02), path * .55);
    col = mix(col, c, smoothstep(1.0, 1.0 - 3.0 / (uC.z * uRes.y), d));
  }
  // Atmosphere beyond the limb: brightest on the lit side, a thin forward-scattered arc on the dark side.
  vec2 rd = q / max(d, 1e-4);
  float lit = dot(rd, normalize(L.xy + 1e-4));
  float halo = exp(-max(d - 1.0, 0.0) / uAtmT);
  col += uAtm * halo * (smoothstep(-.3, .9, lit) * (.25 + .5 * max(L.z, 0.0)) + .04) * step(1.0, d) * .9;
  // Rings in the equatorial plane, shadowed by the planet.
  vec3 ax = uRot[1];
  if (uRing > .5 && abs(ax.z) > .02) {
    float zr = -(ax.x * q.x + ax.y * q.y) / ax.z;
    vec3 x = vec3(q, zr); float r = length(x);
    if (r > 1.35 && r < 2.3 && (d >= 1.0 || zr > zS)) {
      float dens = smoothstep(1.35, 1.45, r) * smoothstep(2.3, 2.12, r) * (.35 + .65 * fbm3(vec3(r * 26.0, 0.0, 1.0))) * (1.0 - .7 * smoothstep(1.78, 1.8, r) * smoothstep(1.86, 1.84, r));
      float s = -dot(x, L);
      float shade = s > 0.0 && length(x + L * s) < 1.0 ? .1 : 1.0;
      col = mix(col, vec3(.42, .37, .5) * (.2 + .8 * abs(dot(ax, L))) * shade, dens * .65);
    }
  }
  // Atmospheric entry: the haze of this planet's sky closes over the view.
  float hz = uHaze * (.8 + .2 * fbm3(vec3(ndc * 2.5, uT * .25 + uHaze * 3.0)));
  col = mix(col, uHazeCol, clamp(hz, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`,
};

// ---------------------------------------------------------------------------
// LEVEL 03 · regional environment shaders, generated per region from its scene data.
// Only the terrain profiles, ground, backdrop and landmark that the region uses are
// compiled, and each terrain layer becomes straight-line code with its constants
// baked in, so every program stays small enough to compile quickly on any GPU.
// Two passes: 'upper' renders the backdrop and far layers (and is also the mirror
// image for water); 'main' adds the ground, near layers, cave roofs and the arrival.
const glf = n => Number(n).toFixed(4);
const ENV_HEAD = FS_PRECISION + NOISE + `
uniform vec2 uRes; uniform float uAspect, uT, uHor, uFogAmt, uCloudAmt, uIntro, uTide, uAurora, uParX, uParY;
uniform vec3 uSun, uSkyTop, uSkyHor, uSunCol, uFog, uRock, uRock2, uAccent, uVeg, uWater;
uniform vec4 uMark; uniform sampler2D uUpper;
float h1(float n){ return fract(sin(n * 127.1) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float f1(float x){ float s = 0.0, a = .5; for (int i = 0; i < 5; i++){ s += a * n1(x); x = x * 2.03 + 1.7; a *= .5; } return s; }
#ifdef UNDER
vec3 fogAt(vec2 uv){ return uWater * (.1 + .5 * uv.y * uv.y); }
#else
vec3 fogAt(vec2 uv){ vec2 sd = (uv - uSun.xy) * vec2(uAspect, 1.0); return uFog * (.75 + .55 * exp(-length(sd) * 2.0)); }
#endif
vec3 terrainCol(float t, vec2 uv, float edge, float depth){
  float strata = .5 + .5 * sin(uv.y * (24.0 + 120.0 * depth) + f1(uv.x * uAspect * 6.0) * 4.0);
  float tex = noise(vec3(uv * vec2(uAspect, 1.0) * 40.0, depth * 9.0));
  vec3 c = mix(uRock, uRock2, strata * (t > .5 && t < 1.5 ? .6 : .3) + tex * .25);
  if (t > 3.5 && t < 4.5) c = uVeg * (.55 + .8 * tex);
  if (t > 4.5 && t < 5.5) c = mix(uRock * 1.3, uAccent * .3, .25 + .4 * tex) + uAccent * .25 * exp(-edge * 60.0);
  if (t > 6.5 && t < 7.5) c = mix(uRock * .7, uVeg * .45, .5 + .4 * tex) + uAccent * (exp(-edge * 90.0) * .35 + smoothstep(.75, .95, tex) * .12) * (.6 + .4 * sin(uv.y * 50.0 - uT * 1.2));
  c *= .45 + .55 * exp(-edge * 6.0);
#ifdef UNDER
  c *= .35;
#endif
  c += uSunCol * exp(-edge * 260.0) * (.1 + .5 * exp(-abs(uv.x - uSun.x) * uAspect * 1.5));
  return c;
}
`;
// Terrain profiles: RIDGE MESA STACK DUNE CROWN CRYSTAL SLAB ROOT HILL
const ENV_PROFILES = [
  `float prof0(float x, float s){ float h = 0.0, a = .55, f = 1.0; for (int i = 0; i < 5; i++){ float n = 1.0 - abs(n1(x * f + s * 7.0) * 2.0 - 1.0); h += a * n * n; a *= .5; f *= 2.1; } return h; }`,
  `float prof1(float x, float s){ float n = f1(x * .8 + s); return mix(n, floor(n * 6.0) / 6.0, .65) + f1(x * 7.0) * .04; }`,
  `float prof2(float x, float s){ float c = floor(x), f = fract(x), h = h1(c + s), w = .07 + .14 * h1(c * 1.7 + s);
  float pil = (1.0 - smoothstep(w * .6, w, abs(f - .5))) * step(.35, h) * (.5 + h * 1.2); return pil * (.85 + (f1(x * 9.0 + s) - .3) * .5) + f1(x * .5 + s) * .15; }`,
  `float prof3(float x, float s){ float u = x + sin(x * .37 + s) * 1.6; return pow(.5 + .5 * sin(u), 1.6) * .8 + f1(x * .6 + s) * .3; }`,
  `float prof4(float x, float s){ float c = floor(x), f = fract(x), r1 = .35 + .18 * h1(c + s);
  float a1 = sqrt(max(r1 * r1 - (f - .5) * (f - .5), 0.0)) + h1(c * 3.1 + s) * .3;
  float x2 = x + .5, c2 = floor(x2), f2 = fract(x2), r2 = .3 + .18 * h1(c2 + s + 9.0);
  float a2 = sqrt(max(r2 * r2 - (f2 - .5) * (f2 - .5), 0.0)) + h1(c2 * 2.3 + s) * .25 - .05;
  return max(a1, a2) + n1(x * 9.0) * .05; }`,
  `float prof5(float x, float s){ float c = floor(x), f = fract(x), h = h1(c + s);
  float tri = max(0.0, 1.0 - abs(f - .3 - .4 * h1(c * 1.3 + s)) * (3.0 + 4.0 * h1(c * 2.1 + s))) * (.3 + h);
  float x2 = x * 1.7 + .3, c2 = floor(x2), f2 = fract(x2);
  return max(tri, max(0.0, 1.0 - abs(f2 - .5) * (5.0 + 4.0 * h1(c2 + s))) * (.2 + .5 * h1(c2 * 3.7 + s))); }`,
  `float prof6(float x, float s){ float c = floor(x), f = fract(x), h = h1(c + s), w = .06 + .08 * h1(c * 1.9 + s);
  return (1.0 - step(w, abs(f - .5))) * step(.5, h) * (.4 + h) + f1(x * .7 + s) * .08; }`,
  `float prof7(float x, float s){ float c = floor(x), f = fract(x), h = h1(c + s);
  float strand = exp(-pow((f - .5) / (.04 + .06 * h), 2.0)) * (.3 + .7 * h);
  float x2 = x * 2.3 + .4, s2 = exp(-pow((fract(x2) - .5) / .05, 2.0)) * .5 * h1(floor(x2) + s);
  return max(strand, s2) + f1(x * .6 + s) * .25; }`,
  `float prof8(float x, float s){ return f1(x * .9 + s); }`
];

// Backdrops: open sky (with STRATA's optional aurora), water column, cave.
const ENV_BACKDROP = {
  open: aurora => `vec3 backdrop(vec2 uv){
  float t = clamp((uv.y - uHor) / (1.0 - uHor), 0.0, 1.0);
  vec3 c = mix(uSkyHor, uSkyTop, pow(t, .55));
  vec2 sd = (uv - uSun.xy) * vec2(uAspect, 1.0); float s = length(sd);
  c += uSunCol * (exp(-s * 3.0) * .3 + exp(-s * 14.0) * .35);
  float ang = atan(sd.y, sd.x);
  c += uSunCol * pow(noise(vec3(cos(ang) * 4.0, sin(ang) * 4.0, uT * .02)), 3.0) * exp(-s * 1.5) * .12;
  c += uSunCol * 1.6 * (1.0 - smoothstep(uSun.z * .9, uSun.z, s));
  float cy = max(uv.y - uHor, .002);
  vec2 cp = vec2((uv.x - .5) * uAspect / cy * .3 + uT * .012, .3 / cy);
  float cl = smoothstep(.45, .85, fbm3(vec3(cp * vec2(.6, .9), uT * .01))) * smoothstep(0.0, .08, cy) * uCloudAmt;
  vec3 cc = mix(uSkyHor * .85, uSunCol, .25 + .5 * exp(-s * 2.0)) * (.75 + .35 * noise(vec3(cp * 2.0, 3.0)));
  c = mix(c, cc, cl * .75);
  ${aurora ? `float x = uv.x * uAspect, yc = .8 + .06 * sin(x * 1.3 + uT * .05);
  c += uAccent * exp(-pow((uv.y - yc) / .07, 2.0)) * (.5 + .5 * sin(x * 14.0 + uT * .4 + noise(vec3(x * 2.0, uT * .1, 0.0)) * 6.0)) * uAurora * .3;` : ''}
  return c;
}`,
  under: () => `vec3 backdrop(vec2 uv){
  vec3 c = mix(uWater * .03, uWater * .75, pow(uv.y, 1.8));
  float x = uv.x * uAspect;
  float rays = pow(noise(vec3(x * 3.0 + uv.y * .8, uT * .08, 1.0)), 4.0) + pow(noise(vec3(x * 7.0 - uv.y * .5, uT * .12, 4.0)), 6.0) * .6;
  c += mix(uWater, uSunCol, .3) * rays * pow(uv.y, 2.2) * .7;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 o = vec2(fract(.2 + fi * .37 + uT * (.004 + fi * .0015)) * 1.4 - .2, .25 + .45 * h1(fi * 7.0) + .04 * sin(uT * .2 + fi * 2.0));
    vec2 d = (uv - o) * vec2(uAspect, 1.0);
    float bell = exp(-dot(d * vec2(1.0, 1.6), d * vec2(1.0, 1.6)) * 2200.0 / (1.0 + fi * .5));
    float tent = exp(-pow(d.x * 140.0 + sin(d.y * 60.0 + uT) * 2.0, 2.0)) * smoothstep(0.0, -.08, d.y) * smoothstep(-.14, -.02, d.y);
    c += uAccent * (bell * .9 + tent * .3) * (.6 + .4 * sin(uT * 1.3 + fi * 3.0));
  }
  return c;
}`,
  cave: () => `vec3 backdrop(vec2 uv){
  vec3 c = uFog * .05 + uSkyHor * .05 * uv.y;
  float sx = (uv.x - uSun.x - (1.0 - uv.y) * .12) * uAspect, w = uSun.z + (1.0 - uv.y) * .22;
  float shaft = exp(-pow(sx / w, 2.0)) * (.6 + .4 * noise(vec3(sx * 8.0, uv.y * 2.0 - uT * .05, uT * .05)));
  c += uSunCol * shaft * .35 * smoothstep(-.1, 1.0, uv.y);
  c += uAccent * .05 * exp(-length((uv - vec2(.5, .3)) * vec2(uAspect, 1.0)) * 1.5);
  return c;
}`
};

// Ground planes in perspective. Water and marsh mirror the upper pass.
const ENV_GROUND_HEAD = `vec3 ground(vec2 uv){
  float dy = max(uHor - uv.y, .0015), z = .22 / dy;
  vec2 pl = vec2((uv.x - .5) * uAspect * z + uParX * .6, z);
  vec3 fogc = fogAt(vec2(uv.x, uHor)), c;
  float fd = 1.0 - exp(-z * .05 * uFogAmt);
`;
const waterGround = marsh => `
  float rip = noise(vec3(pl.x * 2.0, pl.y * 1.2 - uT * .25, uT * .15)) - .5;
  float ringD = length(pl - vec2(-1.5, 6.0));
  float ring = sin(ringD * 9.0 - uT * 1.6) * exp(-ringD * .25);
  vec2 m = vec2(uv.x + rip * ${marsh ? '.012' : '.004'}, 2.0 * uHor - uv.y + (rip * .012 + ring * .004) * dy * 8.0);
  vec3 refl = texture2D(uUpper, clamp(m, .002, .998)).rgb;
  float fres = .25 + .75 * pow(clamp(1.0 - dy * 3.0, 0.0, 1.0), 2.0);
  c = mix(uWater * .35, refl * ${marsh ? '.67' : '.92'}, fres);
  float tide = .5 + .06 * sin(uT * .157);
  ${marsh ? `float reeds = smoothstep(.48, .6, noise(vec3(pl * vec2(.8, .5), 7.0)) + (tide - .5) * uTide);
  c = mix(c, uVeg * (.35 + .6 * noise(vec3(pl.x * 20.0, pl.y * 3.0 + sin(uT * .6 + pl.x) * .1, 1.0))), reeds);`
  : `float flats = smoothstep(tide, tide + .05, noise(vec3(pl * vec2(.5, .35), 1.0)) * .65 + noise(vec3(pl * 2.0, 3.0)) * .35) * uTide;
  vec3 sand = mix(uRock2 * .5, uRock2 * .75, noise(vec3(pl * 3.0, 5.0)));
  c = mix(c, mix(sand, refl, .22), flats);`}`;
const ENV_GROUND = {
  water: waterGround(false),
  marsh: waterGround(true),
  lava: `
  float ch = pow(1.0 - abs(noise(vec3(pl * vec2(.9, .6), 1.0)) * 2.0 - 1.0), 10.0) + pow(1.0 - abs(noise(vec3(pl * 2.3, 4.0)) * 2.0 - 1.0), 14.0) * .6;
  ch *= exp(-z * .08);
  float pulse = .6 + .4 * sin(uT * .5 + noise(vec3(pl * .3, uT * .05)) * 8.0);
  c = mix(uRock * .7, uRock2 * .45, noise(vec3(pl * 4.0, 2.0))) + uAccent * ch * pulse * 1.3 + uAccent * .05 * exp(-dy * 20.0);`,
  sand: `
  float r = sin(pl.x * 7.0 + pl.y * 1.2 + noise(vec3(pl * .8, 1.0)) * 5.0);
  c = uRock2 * .45 * (.75 + .25 * r) * (.6 + .5 * noise(vec3(pl * 3.0, 2.0))) + uSunCol * .05 * pow(max(r, 0.0), 8.0);
  c = mix(c, fogc * .8, .25 * smoothstep(.5, .9, noise(vec3(pl.x * .5 - uT * .2, pl.y * 2.0, uT * .1))));`,
  canopy: `
  vec2 g = pl * vec2(1.6, 2.4) + vec2(sin(uT * .4 + pl.y) * .04, 0.0);
  float top = mix(.45, smoothstep(.35, .8, noise(vec3(g, 1.0)) * .7 + noise(vec3(g * 3.1, 2.0)) * .3), exp(-z * .35));
  c = uVeg * (.35 + .9 * top) + uSunCol * .05 * top;
  c = mix(c, fogc, smoothstep(.55, .85, noise(vec3(pl * .4 + vec2(uT * .02, 0.0), uT * .03))) * .6);`,
  rock: `
  float tex = noise(vec3(pl * 2.0, 1.0)) * .6 + noise(vec3(pl * 7.0, 2.0)) * .4;
  c = mix(uRock, uRock2, tex * .5 + (.5 + .5 * sin(pl.x * 3.0 + tex * 5.0)) * .2) * .8;
  c *= 1.0 - .5 * pow(1.0 - abs(noise(vec3(pl * 1.5, 6.0)) * 2.0 - 1.0), 20.0);`
};

// Landmarks as signed-distance silhouettes, one body per type.
const ENV_MARK = {
  observatory: `
  float ring = abs(length(p - vec2(0.0, .55)) - .5) - .035;
  float dome = max(length(p - vec2(.2, 0.0)) - .24, -p.y);
  float arc = max(abs(length(p - vec2(-.15, -.2)) - .9) - .012, -p.y);
  float plat = max(abs(p.x - .05) - .6, abs(p.y - .02) - .04);
  sd = min(min(ring, dome), min(plat, arc));
  lights = exp(-pow(ring / .01, 2.0)) * step(.85, fract(atan(p.y - .55, p.x) * 3.0)) * .6;`,
  tree: `
  float w = .06 + .05 * smoothstep(.4, 0.0, p.y) + max(0.0, .12 - p.y) * .9;
  float trunk = max(abs(p.x + sin(p.y * 3.0) * .03) - w, p.y - 1.6);
  float crown = length((p - vec2(0.0, 1.75)) * vec2(.55, 1.1)) - .55 + (noise(vec3(p * 6.0, 1.0)) - .5) * .25;
  float crown2 = length((p - vec2(.38, 1.5)) * vec2(.7, 1.3)) - .35 + (noise(vec3(p * 7.0, 2.0)) - .5) * .2;
  sd = min(trunk, min(crown, crown2));
  lights = step(.97, noise(vec3(p * 30.0, 3.0))) * step(crown, 0.0) * .5;
  veg = 1.0;`,
  arch: `
  float r1 = abs(length(p - vec2(0.0, -.1)) - .62) - .06 + (noise(vec3(p * 9.0, 1.0)) - .5) * .02;
  float r2 = abs(length(p - vec2(.95, -.2)) - .3) - .035;
  sd = min(r1, r2);
  lights = exp(-pow((length(p - vec2(0.0, -.1)) - .56) / .008, 2.0)) * step(.3, p.y) * .4;`,
  ring: `
  float ring = abs(length(p - vec2(0.0, .75)) - .62) - .045;
  float slab = max(abs(p.x) - .08, abs(p.y - .45) - .45);
  sd = min(ring, slab);
  lights = exp(-pow((length(p - vec2(0.0, .75)) - .565) / .006, 2.0)) * .7;`,
  platform: `
  float mast = max(abs(p.x) - .018, p.y - 1.9);
  float d1 = max(abs(p.x) - .32, abs(p.y - .9) - .02), d2 = max(abs(p.x) - .22, abs(p.y - 1.3) - .015), d3 = max(abs(p.x) - .12, abs(p.y - 1.62) - .012);
  vec2 ca = vec2(abs(p.x), p.y) - vec2(0.0, 1.9), cb = vec2(.65, 0.0) - vec2(0.0, 1.9);
  float cable = length(ca - cb * clamp(dot(ca, cb) / dot(cb, cb), 0.0, 1.0)) - .004;
  sd = min(min(mast, cable), min(d1, min(d2, d3)));
  lights = (exp(-pow(d1 / .01, 2.0)) * step(.8, fract(p.x * 12.0)) + exp(-length(p - vec2(0.0, 1.92)) * 60.0) * (.5 + .5 * sin(uT * 2.0))) * .7;`,
  volcano: `
  sd = max(p.y - (.62 - abs(p.x) * .85 + (noise(vec3(p.x * 8.0, 0.0, 1.0)) - .5) * .05), -p.y);
  lights = exp(-length((p - vec2(0.0, .6)) * vec2(1.0, 2.0)) * 12.0) * (.6 + .4 * sin(uT * .7));
  smoke = fbm3(vec3(p.x * 3.0 - uT * .02, p.y * 2.0 - uT * .07, 1.0)) * smoothstep(.55, .9, p.y) * exp(-abs(p.x - (p.y - .6) * .5) * 3.0) * smoothstep(3.0, 1.5, p.y);`,
  arcade: `
  float f = fract(p.x * 1.2) - .5;
  float hole = length(vec2(f / 1.2, max(p.y - .2, 0.0))) - .3 + (noise(vec3(p * 10.0, 4.0)) - .5) * .03;
  sd = max(max(abs(p.y - .28) - .3, abs(p.x) - 2.2), -hole);
  lights = exp(-pow((p.y - .52) / .01, 2.0)) * step(abs(p.x), 2.2) * step(.75, fract(p.x * 6.0)) * .5;`
};
const envLandmark = (type, open) => `vec4 landmark(vec2 uv){
  vec2 p = vec2((uv.x - uMark.y) * uAspect + uParX * (1.0 - uMark.w) * .6, uv.y - ${open ? 'uHor' : '0.0'} - uParY * (1.0 - uMark.w)) / uMark.z;
  float sd = 1.0, lights = 0.0, smoke = 0.0, veg = 0.0;
  ${ENV_MARK[type]}
  float a = 1.0 - smoothstep(0.0, .012, sd);
  vec3 c = mix(uRock, uRock2, .25) * (.5 + .3 * clamp(-sd * 3.0, 0.0, 1.0));
  c = mix(c, mix(uRock, uVeg, .5) * (.6 + .4 * noise(vec3(p * 20.0, 1.0))), veg);
  c += uSunCol * exp(-max(-sd, 0.0) * 120.0) * .25;
  c = mix(c, fogAt(uv), clamp(pow(uMark.w, 1.3) * uFogAmt * 1.1, 0.0, .95));
  c += uAccent * lights * (1.0 - uMark.w * .5);
  vec3 sm = mix(fogAt(uv) * .7, uRock2 * .6, .4);
  return vec4(mix(sm, c, a) + uAccent * lights * (1.0 - a) * .5, max(a, smoke * .7));
}
`;

function envSource(w, r, pass) {
  const s = r.scene, open = s.mode === 'open', upper = pass === 'upper';
  const layers = [...s.layers].sort((a, b) => b[4] - a[4]).map((l, i) => ({t:l[0], base:l[1], amp:l[2], freq:l[3], depth:l[4], valley:l[5],
    seed:1.37 * i + r.order * 3.1 + w.kind * 7.7, far:open && l[4] > .55}));
  const roofs = upper ? [] : (s.roof || []).slice().sort((a, b) => b[4] - a[4]).map((l, i) => ({t:l[0], base:l[1], amp:l[2], freq:l[3], depth:l[4], valley:l[5], seed:5.3 + 1.91 * i}));
  const list = layers.filter(l => l.far === upper);
  const mark = s.landmark && (open && s.landmark.depth > .55) === upper ? s.landmark : null;
  const fn = (l, name) => `float ${name}(float ux){
  float x = (ux * uAspect + uParX * ${glf((1 - l.depth) * .6)}${l.t === 4 ? ` + sin(uT * .5 + ux * 6.0) * ${glf(.0025 * (1 - l.depth))}` : ''}) * ${glf(l.freq)} + ${glf(l.seed * 13.1)};
  return ${glf(l.base)} + ${glf(l.amp)} * prof${l.t}(x, ${glf(l.seed)}) + ${glf(l.valley * .25)} * pow(abs(ux - .5) * 2.0, 3.0) + uParY * ${glf(1 - l.depth)};
}`;
  let src = (s.mode === 'under' ? '#define UNDER\n' : '') + ENV_HEAD + [...new Set([...list, ...roofs].map(l => l.t))].map(t => ENV_PROFILES[t]).join('\n') + '\n';
  src += list.map((l, i) => fn(l, 'layer' + i)).concat(roofs.map((l, i) => fn(l, 'roof' + i))).join('\n') + '\n';
  if (mark) src += envLandmark(mark.type, open);
  const drawMark = '  { vec4 m = landmark(uv); col = mix(col, m.rgb, m.a); }\n';
  let body = '', marked = !mark;
  list.forEach((l, i) => {
    if (!marked && l.depth < mark.depth) { body += drawMark; marked = true; }
    const fog = glf(clamp(Math.pow(l.depth, 1.3) * s.fog * 1.25, 0, .97));
    body += `  { float y = layer${i}(uv.x);\n    if (uv.y < y${l.far ? ' && uv.y > uHor - .002' : ''}) col = mix(terrainCol(${glf(l.t)}, uv, y - uv.y, ${glf(l.depth)}), fogAt(uv), ${fog});\n`;
    if (l.far) body += `    else col = mix(col, fogAt(uv), exp(-max(uv.y - uHor, 0.0) * 28.0) * fbm3(vec3(uv.x * uAspect * 3.0 + uT * .012, uv.y * 18.0, uT * .02)) * ${glf(.45 * s.fog)});\n`;
    body += '  }\n';
  });
  if (!marked) body += drawMark;
  roofs.forEach((l, i) => {
    body += `  { float y = 1.0 - roof${i}(uv.x); if (uv.y > y) col = mix(terrainCol(${glf(l.t)}, uv, uv.y - y, ${glf(l.depth)}), fogAt(uv) * .25, ${glf(clamp(l.depth * s.fog * .7, 0, .8))}); }\n`;
  });
  src += `vec3 terrain(vec2 uv, vec3 col){\n${body}  return col;\n}\n`;
  if (upper) {
    src += ENV_BACKDROP[s.mode](!!s.aurora);
    return src + `\nvoid main(){ vec2 uv = gl_FragCoord.xy / uRes; gl_FragColor = vec4(terrain(uv, backdrop(uv)), 1.0); }`;
  }
  const hasGround = open && s.ground !== 'none';
  if (hasGround) src += ENV_GROUND_HEAD + ENV_GROUND[s.ground] + '\n  return mix(c, fogc, fd);\n}\n';
  return src + `
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  ${hasGround ? `vec2 su = uv; su.x += (noise(vec3(uv.x * 40.0, uv.y * 30.0, uT * 1.5)) - .5) * .002 * exp(-abs(uv.y - uHor) * 40.0);
  vec3 col = su.y < uHor ? ground(su) : texture2D(uUpper, su).rgb;` : 'vec3 col = texture2D(uUpper, uv).rgb;'}
  col = terrain(uv, col);
  // Arrival through the cloud deck.
  float hz = uIntro * (.8 + .2 * fbm3(vec3(uv * vec2(uAspect, 1.0) * 2.5, uT * .2)));
  col = mix(col, uFog * 1.1 + uSunCol * .08, clamp(hz, 0.0, 1.0));
  col *= 1.0 - .35 * smoothstep(.55, 1.25, length((uv - .5) * vec2(1.25, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`;
}

Object.assign(SHADERS, {
  // Environmental particles in screen space with depth: embers, dust, spores, mist,
  // marine snow, mineral glints. Near ones fall out of focus.
  particleVS: `attribute vec4 aP; uniform float uT, uAspect, uSize, uTurb, uGlow, uParX, uParY, uFade, uMix, uDpr; uniform vec2 uVel; uniform vec3 uCol, uCol2;
varying vec3 vCol; varying float vA, vSoft;
void main(){
  float d = aP.z, s = aP.w, sp = mix(1.8, .35, d);
  vec2 p = aP.xy + uVel * uT * .006 * sp + uTurb * .02 * vec2(sin(uT * .21 + s * 30.0), cos(uT * .17 + s * 21.0));
  p = fract(p);
  p.x -= uParX * .6 * (1.0 - d) / uAspect; p.y += uParY * (1.0 - d);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  float near = smoothstep(.12, 0.0, d);
  gl_PointSize = uSize * uDpr * mix(2.6, .6, d) * (1.0 + near * 5.0);
  vCol = mix(uCol, uCol2, step(1.0 - uMix, fract(s * 7.31)));
  vA = uGlow * uFade * (.35 + .65 * fract(s * 3.7)) * (1.0 - near * .75) * (.6 + .4 * sin(uT * (.5 + fract(s * 5.0)) + s * 40.0));
  vSoft = near;
}`,
  particleFS: `precision mediump float; varying vec3 vCol; varying float vA, vSoft;
void main(){ float r = length(gl_PointCoord * 2.0 - 1.0); float a = 1.0 - smoothstep(mix(.2, .55, vSoft), 1.0, r); gl_FragColor = vec4(vCol * vA * a * .35, 0.0); }`
});

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locs = {};
  return {p, u:n => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))), a:n => gl.getAttribLocation(p, n)};
}
function initGL() {
  if (gl !== null) return !!gl;
  try {
    gl = canvas.getContext('webgl', {alpha:false, antialias:false, premultipliedAlpha:true}) || false;
    if (!gl) return false;
    progs.copy = program(SHADERS.quadVS, SHADERS.copyFS);
    progs.particle = program(SHADERS.particleVS, SHADERS.particleFS);
    buf.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    buf.particles = gl.createBuffer();
    targets = [target(), target()];
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = false; body.classList.add('worlds-2d'); });
    Object.values(WORLDS).forEach(surfaceMaps);
    return true;
  } catch (error) {
    console.warn('Planetary worlds: WebGL unavailable, using fallback.', error);
    gl = false;
    return false;
  }
}
// Programs are compiled when first needed: one per planet, two per region.
function lazy(key, make) {
  if (!(key in progs)) {
    try { progs[key] = make(); } catch (error) { console.warn(`Planetary worlds: could not compile ${key}.`, error); progs[key] = null; }
  }
  return progs[key];
}
// Surface maps (worlds-data.js `maps`) load once per planet; until all of them are
// ready, or if any fails, the planet keeps its procedural surface.
// Texture unit and sampler of each map the shader reads.
const MAP_UNITS = {albedo:[0, 'uAlb'], normalX:[1, 'uNx'], normalY:[2, 'uNy'], aux:[3, 'uAux']};
function surfaceMaps(w) {
  if (!w.maps) return null;
  if (w._maps) return w._maps.ready ? w._maps : null;
  const m = w._maps = {ready:false, tex:{}};
  const names = Object.keys(MAP_UNITS);
  // 4K maps on desktops (fine pointer, large screen), 2K on phones and tablets or GPUs
  // that cannot hold 4096 textures. Decided by the device, not the window, so a narrow
  // window on a desktop still gets the sharp set.
  const desktop = matchMedia('(pointer: fine)').matches && Math.max(screen.width, screen.height) >= 1024;
  const res = desktop && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096 ? w.maps.hd : w.maps.sd;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  let left = names.length;
  names.forEach(name => {
    const img = new Image();
    img.onload = () => {
      if (!gl) return;
      const t = m.tex[name] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Toward the limb the surface is seen edge-on; anisotropic filtering keeps it sharp there.
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      if (--left === 0) { m.ready = true; wake(); }
    };
    const src = w.maps[name].replace('{res}', res);
    img.onerror = () => console.warn(`Planetary worlds: could not load ${src}; keeping the procedural surface.`);
    img.src = src;
  });
  return null;
}
const planetProgram = w => {
  const maps = !!surfaceMaps(w);
  return lazy('planet:' + w.kind + (maps ? ':maps' : ''), () => program(SHADERS.quadVS, SHADERS.planetFS(w.kind, !!gl.getExtension('OES_standard_derivatives'), maps)));
};
const envPrograms = (w, r) => lazy('env:' + r.id, () => ({upper:program(SHADERS.quadVS, envSource(w, r, 'upper')), main:program(SHADERS.quadVS, envSource(w, r, 'main'))}));
function attrib(p, name, buffer, size) {
  const loc = p.a(name);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return () => gl.disableVertexAttribArray(loc);
}
const quad = p => { const off = attrib(p, 'aQ', buf.quad, 2); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); off(); };

let W = 1, H = 1, scale = 1, targets = [];
function sizeCanvas() {
  W = innerWidth; H = innerHeight;
  scale = Math.min(devicePixelRatio || 1, [1.5, 1, .75][quality]);
  const w = Math.round(W * scale), h = Math.round(H * scale);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function target() { return {tex:gl.createTexture(), fb:gl.createFramebuffer()}; }
// The environment renders at reduced resolution into two targets: upper pass, then main.
function sizeTargets() {
  const k = [.62, .5, .4][quality];
  const w = Math.max(2, Math.round(canvas.width * k)), h = Math.max(2, Math.round(canvas.height * k));
  if (w === fboSize[0] && h === fboSize[1]) return;
  fboSize = [w, h];
  targets.forEach(({tex, fb}) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k2 => gl.texParameteri(gl.TEXTURE_2D, k2, gl.LINEAR));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k2 => gl.texParameteri(gl.TEXTURE_2D, k2, gl.CLAMP_TO_EDGE));
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// Starlight always comes from the parent star on the left; its elevation and how far
// it falls behind each planet differ, so each world shows its own terminator.
const lightOf = w => w._light || (w._light = (v => v.map(c => c / Math.hypot(...v)))(w.light));
const KIND_FEATURES = w => {
  const out = new Float32Array(16);
  w.regions.slice(0, 4).forEach((r, i) => out.set([...r.local, r.feature], i * 4));
  return out;
};

function drawPlanet(t) {
  const w = WORLDS[view.planet], p = planetProgram(w);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  if (!p) { gl.clearColor(...w.rgb.skyTop, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
  gl.useProgram(p.p);
  const M = orientation(w), C = orientation(w, true);
  gl.uniform2f(p.u('uRes'), canvas.width, canvas.height);
  gl.uniform3f(p.u('uC'), view.cx, view.cy, view.R);
  gl.uniformMatrix3fv(p.u('uRot'), false, T(M));
  gl.uniformMatrix3fv(p.u('uInv'), false, M);
  gl.uniformMatrix3fv(p.u('uCloud'), false, C);
  gl.uniform1f(p.u('uAspect'), W / H); gl.uniform1f(p.u('uT'), t);
  gl.uniform1f(p.u('uKind'), w.kind); gl.uniform1f(p.u('uZoom'), view.zoom); gl.uniform1f(p.u('uHaze'), view.haze);
  gl.uniform1f(p.u('uRing'), w.ring ? 1 : 0);
  gl.uniform1f(p.u('uAtmT'), w.atmosphere.thickness); gl.uniform1f(p.u('uCloudAmt'), w.atmosphere.clouds * 1.6);
  gl.uniform3fv(p.u('uAtm'), hex(w.atmosphere.color));
  gl.uniform3fv(p.u('uL'), lightOf(w));
  gl.uniform3fv(p.u('uTerm'), hex(w.atmosphere.terminator)); gl.uniform1f(p.u('uAtmIn'), w.atmosphere.inner); gl.uniform1f(p.u('uBump'), w.relief);
  gl.uniform3fv(p.u('uHazeCol'), w.rgb.fog.map((c, i) => c * 1.1 + w.rgb.sun[i] * .08));
  gl.uniform4fv(p.u('uReg'), w._features || (w._features = KIND_FEATURES(w)));
  const maps = surfaceMaps(w);
  if (maps) {
    Object.entries(MAP_UNITS).forEach(([name, [unit, sampler]]) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, maps.tex[name]);
      gl.uniform1i(p.u(sampler), unit);
    });
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(p.u('uNormal'), w.maps.normalScale);
  }
  quad(p);
}

function setupEnv(w, r) {
  const s = r.scene;
  envConf = {w, r, s, mark:s.landmark ? [0, s.landmark.x, s.landmark.scale, s.landmark.depth] : [0, 0, 1, 1]};
  if (gl) envConf.prog = envPrograms(w, r);
  // Particles: positions in screen space with depth, from the planet's preset.
  const pr = PRESETS[s.particles], n = Math.round(pr.count * [1, .7, .45][quality]);
  const data = new Float32Array(n * 4);
  let seed = r.order * 97 + w.kind * 13 + 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) data.set([rnd(), rnd(), Math.pow(rnd(), .7), rnd()], i * 4);
  if (gl) { gl.bindBuffer(gl.ARRAY_BUFFER, buf.particles); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); }
  particleCount = n;
  envConf.pr = pr;
  aurora.next = 6 + Math.random() * 10;
}
// STRATA's rare magnetic disturbance: an aurora every half-minute or so.
const aurora = {next:10, value:0};

function drawEnv(t) {
  const {w, s, mark, pr, prog} = envConf, c = w.rgb;
  if (!prog) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clearColor(...c.fog, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; }
  sizeTargets();
  gl.disable(gl.BLEND);
  if (s.aurora && !reduced()) {
    if (t > aurora.next + 9) aurora.next = t + 24 + Math.random() * 18;
    const k = (t - aurora.next) / 9;
    aurora.value = k > 0 && k < 1 ? Math.sin(Math.PI * k) ** 2 : 0;
  } else aurora.value = 0;
  const parX = drift.x, parY = drift.y - view.settle * .14;
  const pass = (p, out, input) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
    gl.viewport(0, 0, fboSize[0], fboSize[1]);
    gl.useProgram(p.p);
    gl.uniform2f(p.u('uRes'), fboSize[0], fboSize[1]);
    gl.uniform1f(p.u('uAspect'), W / H); gl.uniform1f(p.u('uT'), t);
    gl.uniform1f(p.u('uHor'), s.horizon); gl.uniform1f(p.u('uFogAmt'), s.fog); gl.uniform1f(p.u('uCloudAmt'), s.clouds || 0);
    gl.uniform1f(p.u('uIntro'), view.envFog); gl.uniform1f(p.u('uTide'), s.tide ? 1 : 0); gl.uniform1f(p.u('uAurora'), aurora.value);
    gl.uniform1f(p.u('uParX'), parX); gl.uniform1f(p.u('uParY'), parY);
    gl.uniform3f(p.u('uSun'), ...s.sun);
    [['uSkyTop', 'skyTop'], ['uSkyHor', 'skyHorizon'], ['uSunCol', 'sun'], ['uFog', 'fog'], ['uRock', 'rock'], ['uRock2', 'rock2'], ['uAccent', 'accent'], ['uVeg', 'veg'], ['uWater', 'water']]
      .forEach(([u, k]) => gl.uniform3fv(p.u(u), c[k]));
    gl.uniform4fv(p.u('uMark'), mark);
    if (input) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input.tex); gl.uniform1i(p.u('uUpper'), 0); }
    quad(p);
  };
  pass(prog.upper, targets[0]);
  pass(prog.main, targets[1], targets[0]);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  let p = progs.copy; gl.useProgram(p.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets[1].tex); gl.uniform1i(p.u('uTex'), 0);
  quad(p);

  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  p = progs.particle; gl.useProgram(p.p);
  gl.uniform1f(p.u('uT'), reduced() ? 0 : t); gl.uniform1f(p.u('uAspect'), W / H);
  gl.uniform1f(p.u('uSize'), pr.size); gl.uniform1f(p.u('uTurb'), pr.turb); gl.uniform1f(p.u('uGlow'), pr.glow);
  gl.uniform1f(p.u('uParX'), parX); gl.uniform1f(p.u('uParY'), parY);
  gl.uniform1f(p.u('uFade'), 1 - view.envFog); gl.uniform1f(p.u('uMix'), pr.mix); gl.uniform1f(p.u('uDpr'), scale);
  gl.uniform2fv(p.u('uVel'), pr.vel);
  gl.uniform3fv(p.u('uCol'), c[pr.colour]); gl.uniform3fv(p.u('uCol2'), c[pr.colour2]);
  const off = attrib(p, 'aP', buf.particles, 4);
  gl.drawArrays(gl.POINTS, 0, particleCount); off();
  gl.disable(gl.BLEND);
}

// ---------------------------------------------------------------------------
// Fallback without WebGL: CSS draws a lit disc and a palette gradient; nodes and
// navigation behave the same.
function draw2D() {
  const w = WORLDS[view.planet];
  if (!w) return;
  const c = w.palette;
  body.style.setProperty('--w2d-sky', c.skyTop); body.style.setProperty('--w2d-hor', c.skyHorizon);
  body.style.setProperty('--w2d-rock', c.rock2); body.style.setProperty('--w2d-atm', w.atmosphere.color);
  const R = view.R * H / 2, x = (view.cx * .5 + .5) * W, y = (.5 - view.cy * .5) * H;
  body.style.setProperty('--w2d-x', `${x}px`); body.style.setProperty('--w2d-y', `${y}px`); body.style.setProperty('--w2d-r', `${R}px`);
  body.dataset.w2d = view.show;
}

// ---------------------------------------------------------------------------
// Frame loop: runs only while a planetary level is visible or a tween is active.
const drift = {x:0, y:0, px:0, py:0};
addEventListener('pointermove', e => { if (e.pointerType !== 'touch') { drift.px = (e.clientX / innerWidth - .5) * .04; drift.py = (e.clientY / innerHeight - .5) * -.02; } }, {passive:true});
let running = false, last = performance.now(), clock = 0, frameEMA = 16, frames = 0;
function wake() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } }

function updateNodes() {
  const w = WORLDS[view.planet];
  if (!w || view.show !== 'planet') return;
  const M = orientation(w), a = W / H;
  let front = 0;
  nodes.forEach(n => {
    const v = apply(M, n.r.local).map(x => x * (1 + n.r.alt));
    const vis = smooth(.04, .22, v[2]);
    n.x = ((view.cx + v[0] * view.R / a) * .5 + .5) * W;
    n.y = (.5 - (view.cy + v[1] * view.R) * .5) * H;
    n.b.style.transform = `translate3d(${n.x.toFixed(1)}px,${n.y.toFixed(1)}px,0)`;
    const isFront = vis > .5;
    if (isFront) front++;
    if (Math.abs(vis - n.vis) > .01) { n.b.style.opacity = vis.toFixed(2); n.vis = vis; }
    if (isFront !== n.front) { n.front = isFront; n.b.classList.toggle('is-back', !isFront); }
    n.b.classList.toggle('is-hovered', hoverId === n.r.id);
    // Labels open toward the outside of the disc.
    const side = n.x + 210 > W ? 'l' : n.x < 210 ? 'r' : v[0] >= 0 ? 'r' : 'l';
    if (n.b.dataset.side !== side) n.b.dataset.side = side;
  });
  const text = `${nodes.length} 处 · ${front} 处在可见半球${nodes.length - front ? ` · ${nodes.length - front} 处位于背面` : ''}`;
  if (text !== signalsText) { signalsText = text; const dd = $(obsLayer, '.obs-signals'); if (dd) dd.textContent = text; }
}

function frame(now) {
  const dt = Math.min(Math.max((now - last) / 1000, 0), .05);
  last = now;
  runTweens(now);
  if (view.show === 'none' && !tweens.size) { running = false; canvas.style.opacity = 0; return; }
  requestAnimationFrame(frame);
  if (document.hidden) return;
  if (!reduced()) clock += dt;
  // The planet turns only while it is being observed.
  if (nav.level === 2 && !nav.busy && !reduced()) {
    const m = memory[view.planet];
    const hold = hoverId || drag ? .15 : 1;
    spinClock += dt * hold;
    if (!drag) { m.yaw += m.vyaw * dt; m.vyaw *= Math.exp(-dt * 2.5); }
  }
  drift.x = lerp(drift.x, reduced() ? 0 : drift.px + Math.sin(clock * .05) * .012, 1 - Math.exp(-dt * 1.5));
  drift.y = lerp(drift.y, reduced() ? 0 : drift.py, 1 - Math.exp(-dt * 1.5));
  canvas.style.opacity = view.fade.toFixed(3);
  sizeCanvas();
  if (gl) {
    if (view.show === 'planet') drawPlanet(clock);
    else if (view.show === 'env') drawEnv(clock);
  } else draw2D();
  updateNodes();
  frameEMA = lerp(frameEMA, dt * 1000, .05);
  if (++frames > 90 && frameEMA > 26 && quality < 2) { quality++; frames = 0; fboSize = [0, 0]; }
}

addEventListener('resize', () => { if (view.show === 'planet' && nav.level === 2 && !nav.busy) Object.assign(view, composition()); });

// Direct links: open the requested level without the fly-in.
const initial = parse(location.hash);
history.replaceState({child:false}, '', location.hash || location.pathname + location.search);
if (initial.level > 1) { nav.instant = true; go(initial); }
})();
