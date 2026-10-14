/* ============================================================
   RAFSAN ISDANI — A WINTER FOREST PORTFOLIO
   ============================================================
   1. Basics & preferences
   2. World layout  (plain data — shared by the 3D scene and the map)
   3. The trail     (scroll → progress, captions, progress rail)
   4. Destinations  (rooms that open after the camera enters a door)
   5. Library shelf
   6. The map
   7. Menu, view toggle, keyboard
   8. The 3D world  (Three.js, loaded on demand from the CDN)
   9. Start-up
   ============================================================ */

/* ──────────────────────────────────────────────────────────
   1. BASICS & PREFERENCES
   ────────────────────────────────────────────────────────── */
const root = document.documentElement;
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
let reduceMotion = mqReduce.matches;
mqReduce.addEventListener?.('change', e => { reduceMotion = e.matches; });

const isWorld = () => root.classList.contains('world-mode');

/* Shared state */
const S = {
  progress: 0,     // trail progress from the scroll position (0 → 1)
  shown: 0,        // damped progress the camera actually follows
  openId: null,    // destination currently open
  busy: false,     // a transition is running
  mapOpen: false,
  world: null,     // 3D API once ready
};

/* ──────────────────────────────────────────────────────────
   2. WORLD LAYOUT — metres; −z leads deeper into the forest
   ────────────────────────────────────────────────────────── */
const LAYOUT = {
  path: [[0, 34], [1.5, 12], [-4, -12], [-10, -38], [-7, -64], [3, -90], [11, -116],
         [8, -142], [-2, -166], [-8, -190], [-5, -214], [1, -234], [0, -252]],
  village: { x: 0, z: -287, r: 44 },
  square:  { x: 0, z: -281 },
  lake:    { x: 37, z: -285, r: 11 },
  buildings: [
    { id: 'workshop',    name: 'Engineering Workshop', sub: 'Robotics & automation', sign: 'THE WORKSHOP',      x: -19, z: -273 },
    { id: 'library',     name: 'Literary House',       sub: 'Novels',                sign: 'LITERARY HOUSE',    x: -16, z: -299 },
    { id: 'observatory', name: 'Observatory',          sub: 'AI & computer vision',  sign: 'OBSERVATORY',       x: 1,   z: -312 },
    { id: 'archive',     name: 'Research Archive',     sub: 'Manuscripts',           sign: 'RESEARCH ARCHIVE',  x: 17,  z: -299 },
    { id: 'cabin',       name: "Traveler's Cabin",     sub: 'About & contact',       sign: "TRAVELER'S CABIN",  x: 22,  z: -271 },
  ],
  cottages: [[-34, -292], [-25, -319], [31, -318], [-6, -336]],
};
const DEST_IDS = LAYOUT.buildings.map(b => b.id);
const WALK_PORTION = 0.86;   // share of the scroll spent walking; the rest rises into the village view

/* Uniform Catmull-Rom through the path points (matches THREE's 'catmullrom', tension 0.5) */
function catmull2D(pts, perSeg = 24) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      const f = k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/* ──────────────────────────────────────────────────────────
   3. THE TRAIL — native scrolling drives the walk
   ────────────────────────────────────────────────────────── */
const journey = $('#journey');
const fadeEls = $$('[data-in]', journey);
const railBtns = $$('.rail button');
let scrollJob = null;

function journeyRange() {
  const top = journey.offsetTop;
  return { top, len: Math.max(1, journey.offsetHeight - innerHeight) };
}

function readProgress() {
  if (!isWorld()) { S.progress = 0; return; }
  const { top, len } = journeyRange();
  S.progress = clamp((scrollY - top) / len, 0, 1);
}

function updateTrailUI() {
  const p = S.progress;
  for (const el of fadeEls) {
    const on = p >= parseFloat(el.dataset.in) && p < parseFloat(el.dataset.out);
    el.classList.toggle('on', on);
  }
  let here = 0;
  railBtns.forEach((b, i) => { if (p >= parseFloat(b.dataset.p) - 0.04) here = i; });
  railBtns.forEach((b, i) => {
    b.classList.toggle('here', i === here);
    if (i === here) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
}

/* Glide the page (and so the camera) to a point on the trail */
function scrollToProgress(p, duration) {
  if (scrollJob) scrollJob.cancelled = true;
  if (!isWorld()) { $('#top').scrollIntoView(); return Promise.resolve(true); }
  const { top, len } = journeyRange();
  const target = Math.round(top + p * len);
  const start = scrollY;
  const dist = Math.abs(target - start);
  if (duration == null) duration = reduceMotion ? 0 : clamp((dist / len) * 4200, 500, 3800);
  if (duration === 0 || dist < 2) {
    window.scrollTo({ top: target, behavior: 'instant' });
    readProgress(); updateTrailUI();
    return Promise.resolve(true);
  }
  const job = { cancelled: false };
  scrollJob = job;
  return new Promise(resolve => {
    const t0 = performance.now();
    const step = now => {
      if (job.cancelled) { resolve(false); return; }
      const t = clamp((now - t0) / duration, 0, 1);
      window.scrollTo({ top: start + (target - start) * easeInOut(t), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(step);
      else { scrollJob = null; resolve(true); }
    };
    requestAnimationFrame(step);
  });
}
const cancelScrollJob = () => { if (scrollJob) scrollJob.cancelled = true; };
addEventListener('wheel', cancelScrollJob, { passive: true });
addEventListener('touchstart', cancelScrollJob, { passive: true });

addEventListener('scroll', () => { readProgress(); updateTrailUI(); }, { passive: true });

railBtns.forEach(b => b.addEventListener('click', () => scrollToProgress(parseFloat(b.dataset.p))));

/* ──────────────────────────────────────────────────────────
   4. DESTINATIONS
   ────────────────────────────────────────────────────────── */
const panels = Object.fromEntries($$('[data-dest-panel]').map(el => [el.dataset.destPanel, el]));
const veil = $('.veil');

function setVeil(v) { veil.style.opacity = String(v); }

function markCurrent(id) {
  $$('.menu a').forEach(a => a.setAttribute('aria-current', String(a.dataset.dest === id)));
}

/* Keep keyboard and screen-reader focus inside whatever is on top */
function applyInert() {
  const blockers = [$('.topbar'), journey, $('.footer'), $('#labels'), $('.skip-link')];
  const top = S.mapOpen ? $('#map') : (S.openId ? panels[S.openId] : null);
  blockers.forEach(el => el && (el.inert = !!top));
  Object.values(panels).forEach(p => {
    p.inert = isWorld() ? (S.mapOpen || (S.openId ? p !== panels[S.openId] : true)) : S.mapOpen;
  });
}

async function goTo(id) {
  if (!panels[id]) return;
  if (!isWorld()) {
    panels[id].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#' + id);
    return;
  }
  if (S.busy) return;
  if (S.openId === id) return;
  closeMenu();
  if (S.openId) { switchPanel(id); return; }

  S.busy = true;
  try {
    if (S.progress < 0.995) {
      const arrived = await scrollToProgress(1);
      if (!arrived) return;                      // the visitor took over the scroll
      if (S.world && !reduceMotion) await S.world.settle();
    }
    if (S.world) await S.world.flyIn(id);
    else { setVeil(1); await wait(reduceMotion ? 0 : 250); }
    showPanel(id);
  } finally {
    S.busy = false;
  }
}

function showPanel(id) {
  const el = panels[id];
  S.openId = id;
  el.classList.add('is-open');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  root.classList.add('panel-open');
  $('.dest-scroll', el).scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-shown')));
  applyInert();
  $('h2', el).focus({ preventScroll: true });
  history.replaceState(null, '', '#' + id);
  markCurrent(id);
  S.world?.pause(true);
  if (id === 'library') selectBook(currentBook);
}

function hidePanelNow(id) {
  const el = panels[id];
  el.classList.remove('is-open', 'is-shown');
  el.removeAttribute('role');
  el.removeAttribute('aria-modal');
}

function switchPanel(id) {
  const from = S.openId;
  hidePanelNow(from);
  S.world?.jumpToDoor(id);
  showPanel(id);
}

async function closePanel() {
  const id = S.openId;
  if (!id || S.busy) return;
  S.busy = true;
  const el = panels[id];
  el.classList.remove('is-shown');
  S.world?.pause(false);
  const flight = S.world ? S.world.flyOut(id) : (async () => { await wait(reduceMotion ? 0 : 300); setVeil(0); })();
  await wait(reduceMotion ? 0 : 420);
  hidePanelNow(id);
  root.classList.remove('panel-open');
  S.openId = null;
  applyInert();
  history.replaceState(null, '', location.pathname + location.search);
  markCurrent(null);
  $(`#directory a[data-dest="${id}"]`)?.focus({ preventScroll: true });
  await flight;
  S.busy = false;
}

document.addEventListener('click', e => {
  const link = e.target.closest('a[data-dest], button[data-dest]');
  if (link) {
    if (!isWorld()) { closeMenu(); return; }      // the simple page scrolls to the section natively
    e.preventDefault();
    goTo(link.dataset.dest);
    return;
  }
  if (e.target.closest('[data-close]')) { closePanel(); return; }
  if (e.target.closest('[data-open-map]')) { openMap(e.target.closest('[data-open-map]')); return; }
  if (e.target.closest('[data-close-map]')) { closeMap(); return; }
  const go = e.target.closest('[data-go]');
  if (go) {
    if (!isWorld()) return;
    e.preventDefault();
    const where = go.dataset.go === 'village' ? 1 : 0;
    if (S.openId) closePanel().then(() => scrollToProgress(where));
    else scrollToProgress(where);
  }
});

/* ──────────────────────────────────────────────────────────
   5. LIBRARY SHELF — pick a cover, read its page
   ────────────────────────────────────────────────────────── */
let currentBook = 'amber';
function selectBook(key) {
  currentBook = key;
  $$('.shelf-book').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.book === key)));
  $$('[data-book-detail]').forEach(a => { a.hidden = isWorld() && a.dataset.bookDetail !== key; });
}
$$('.shelf-book').forEach(b => b.addEventListener('click', () => selectBook(b.dataset.book)));

/* ──────────────────────────────────────────────────────────
   6. THE MAP — drawn from the same layout as the 3D world
   ────────────────────────────────────────────────────────── */
const mapEl = $('#map');
let mapDrawn = false;
let mapReturnFocus = null;

/* Illustrated, not literal: the village is drawn larger than the trail */
function toMap(x, z) {
  const u = 400 + x * 5.2;
  const v = z > -252 ? 250 + ((z + 252) / 304) * 270 : 250 - ((-252 - z) / 84) * 180;
  return [u, v];
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawMap() {
  const svg = $('#mapArt');
  const rnd = mulberry32(11);
  const trail = catmull2D(LAYOUT.path, 16).map(([x, z]) => toMap(x, z));
  const d = 'M' + trail.map(p => p.map(n => n.toFixed(1)).join(' ')).join(' L');
  const near = (u, v) => trail.some(([a, b]) => (a - u) ** 2 + (b - v) ** 2 < 26 ** 2);
  const inVillage = (u, v) => ((u - 420) / 200) ** 2 + ((v - 160) / 120) ** 2 < 1;

  let trees = '';
  for (let i = 0; i < 420 && trees.length < 60000; i++) {
    const u = 40 + rnd() * 720, v = 70 + rnd() * 460;
    if (near(u, v) || inVillage(u, v)) continue;
    const s = 5 + rnd() * 5, w = s * 0.62;
    trees += `<path d="M${u.toFixed(1)} ${(v - s).toFixed(1)} L${(u - w).toFixed(1)} ${(v + s * 0.5).toFixed(1)} L${(u + w).toFixed(1)} ${(v + s * 0.5).toFixed(1)} Z M${u.toFixed(1)} ${(v + s * 0.5).toFixed(1)} v3"/>`;
  }

  const sq = toMap(LAYOUT.square.x, LAYOUT.square.z);
  let spokes = '', houses = '';
  for (const b of LAYOUT.buildings) {
    const [u, v] = toMap(b.x, b.z);
    spokes += `<path d="M${sq[0]} ${sq[1]} L${u.toFixed(1)} ${(v + 9).toFixed(1)}"/>`;
    houses += `<path d="M${(u - 9).toFixed(1)} ${(v + 9).toFixed(1)} v-9 l9 -8 l9 8 v9 z"/>`;
  }
  for (const [x, z] of LAYOUT.cottages) {
    const [u, v] = toMap(x, z);
    houses += `<path opacity=".55" d="M${(u - 6).toFixed(1)} ${(v + 6).toFixed(1)} v-6 l6 -5 l6 5 v6 z"/>`;
  }
  const [lu, lv] = toMap(LAYOUT.lake.x, LAYOUT.lake.z);

  let ridge = 'M30 58';
  for (let u = 30; u <= 770; u += 20) ridge += ` L${u + 10} ${(34 + rnd() * 16).toFixed(1)} L${u + 20} ${(52 + rnd() * 8).toFixed(1)}`;

  let lanterns = '';
  for (let i = 10; i < trail.length - 4; i += 14) lanterns += `<circle cx="${trail[i][0].toFixed(1)}" cy="${trail[i][1].toFixed(1)}" r="2.2"/>`;

  svg.innerHTML = `
    <rect x="10" y="10" width="780" height="540" fill="none" stroke="#c9a86a" stroke-opacity=".45" stroke-width="1.5"/>
    <rect x="17" y="17" width="766" height="526" fill="none" stroke="#c9a86a" stroke-opacity=".22"/>
    <path d="${ridge}" fill="none" stroke="#c9a86a" stroke-opacity=".4" stroke-width="1.2" stroke-linejoin="round"/>
    <g fill="none" stroke="#c9a86a" stroke-opacity=".38" stroke-width="1" stroke-linejoin="round">${trees}</g>
    <ellipse cx="${lu}" cy="${lv + 4}" rx="44" ry="26" fill="#8fa6c4" fill-opacity=".06" stroke="#9fb3cf" stroke-opacity=".45"/>
    <g stroke="#9fb3cf" stroke-opacity=".3"><path d="M${lu - 26} ${lv} h30 M${lu - 14} ${lv + 9} h34 M${lu - 20} ${lv - 8} h22"/></g>
    <g fill="none" stroke="#c9a86a" stroke-opacity=".45" stroke-dasharray="2 5">${spokes}</g>
    <path d="${d}" fill="none" stroke="#0d0c09" stroke-width="7" stroke-linecap="round" opacity=".6"/>
    <path d="${d}" fill="none" stroke="#d9bb7f" stroke-width="2" stroke-dasharray="7 6" stroke-linecap="round"/>
    <g fill="#eaa95c">${lanterns}</g>
    <circle cx="${sq[0]}" cy="${sq[1]}" r="16" fill="none" stroke="#c9a86a" stroke-opacity=".35"/>
    <g fill="#16140f" stroke="#e0c58e" stroke-width="1.3">${houses}</g>
    <g transform="translate(722 480)" fill="none" stroke="#c9a86a" stroke-opacity=".6">
      <circle r="22"/><path d="M0 -30 L5 0 L0 30 L-5 0 Z" fill="#c9a86a" fill-opacity=".25"/><path d="M-30 0 H30"/>
      <text y="-36" text-anchor="middle" fill="#c9a86a" stroke="none" font-family="Cormorant Garamond, serif" font-size="14">N</text>
    </g>`;

  const markers = $('#mapMarkers');
  const pct = ([u, v]) => `left:${(u / 8).toFixed(2)}%;top:${(v / 5.6).toFixed(2)}%`;
  const at = f => trail[Math.round(f * (trail.length - 1))];
  const side = { workshop: 'left', library: 'left', observatory: 'right', archive: 'right', cabin: 'right' };
  let html = '';
  for (const b of LAYOUT.buildings) {
    const [u, v] = toMap(b.x, b.z);
    html += `<button type="button" class="map-marker ${side[b.id]}" style="${pct([u, v - 4])}" data-map-dest="${b.id}"><span class="mm-dot" aria-hidden="true"></span><span>${b.name}</span></button>`;
  }
  html += `<button type="button" class="map-marker minor right" style="${pct(at(0.02))}" data-map-p="0"><span class="mm-dot" aria-hidden="true"></span><span>Trailhead</span></button>`;
  html += `<button type="button" class="map-marker minor left" style="${pct(at(0.5))}" data-map-p="0.66"><span class="mm-dot" aria-hidden="true"></span><span>Lantern path</span></button>`;
  html += `<button type="button" class="map-marker minor right" style="${pct([sq[0] + 4, sq[1] + 26])}" data-map-p="1"><span class="mm-dot" aria-hidden="true"></span><span>Village square</span></button>`;
  html += `<span class="map-marker minor you right" id="mapYou" hidden><span class="mm-dot" aria-hidden="true"></span><span>You are here</span></span>`;
  markers.innerHTML = html;

  markers.addEventListener('click', e => {
    const m = e.target.closest('.map-marker');
    if (!m) return;
    if (m.dataset.mapDest) {
      const id = m.dataset.mapDest;
      closeMap(false);
      goTo(id);
    } else if (m.dataset.mapP != null) {
      closeMap(false);
      const p = parseFloat(m.dataset.mapP);
      if (!isWorld()) { (p >= 1 ? $('#directory') : $('#top')).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
      if (S.openId) closePanel().then(() => scrollToProgress(p));
      else scrollToProgress(p);
    }
  });
  mapDrawn = true;
}

function updateYouAreHere() {
  const you = $('#mapYou');
  if (!you) return;
  if (!isWorld() || S.openId) { you.hidden = true; return; }
  const pts = catmull2D(LAYOUT.path, 16);
  const f = clamp(S.progress / WALK_PORTION, 0, 1);
  const [x, z] = f >= 1 ? [LAYOUT.square.x, LAYOUT.square.z + 26] : pts[Math.round(f * (pts.length - 1))];
  const [u, v] = toMap(x, z);
  you.style.left = (u / 8) + '%';
  you.style.top = (v / 5.6) + '%';
  you.hidden = false;
}

function openMap(opener) {
  if (!mapDrawn) drawMap();
  updateYouAreHere();
  mapReturnFocus = opener || document.activeElement;
  closeMenu();
  mapEl.hidden = false;
  S.mapOpen = true;
  applyInert();
  $('.map-marker', mapEl)?.focus();
}

function closeMap(restore = true) {
  if (!S.mapOpen) return;
  mapEl.hidden = true;
  S.mapOpen = false;
  applyInert();
  if (restore && mapReturnFocus && document.contains(mapReturnFocus)) mapReturnFocus.focus({ preventScroll: true });
}
mapEl.addEventListener('click', e => { if (e.target === mapEl) closeMap(); });

/* ──────────────────────────────────────────────────────────
   7. MENU, VIEW TOGGLE, KEYBOARD
   ────────────────────────────────────────────────────────── */
const menu = $('#menu');
const menuToggle = $('.menu-toggle');
function closeMenu() { menu.classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false'); }
menuToggle.addEventListener('click', () => {
  const open = !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
});

$('#viewToggle').addEventListener('click', () => {
  store.set('ri-view', isWorld() ? 'simple' : 'world');
  location.href = location.pathname + location.hash;
});

function trapFocus(e, container) {
  const items = $$('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', container)
    .filter(el => !el.hidden && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (S.mapOpen) { closeMap(); return; }
    if (menu.classList.contains('open')) { closeMenu(); menuToggle.focus(); return; }
    if (S.openId) { closePanel(); return; }
  }
  if (e.key === 'Tab') {
    if (S.mapOpen) trapFocus(e, mapEl);
    else if (S.openId && isWorld()) trapFocus(e, panels[S.openId]);
    return;
  }
  const typing = /input|textarea|select/i.test(e.target.tagName);
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
    if (S.mapOpen) closeMap(); else openMap();
  }
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)) cancelScrollJob();
});

/* ──────────────────────────────────────────────────────────
   8. THE 3D WORLD
   ────────────────────────────────────────────────────────── */
async function loadWorld() {
  const THREE = await import('three');
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
  ]);
  // signs use the page's serif; don't wait long for it
  if (document.fonts?.load) await Promise.race([document.fonts.load('600 64px "Cormorant Garamond"'), wait(1500)]).catch(() => {});
  return createWorld(THREE, { EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
}

function detectTier() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const small = Math.min(innerWidth, innerHeight) < 600;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return (small || (coarse && weak)) ? 'low' : (weak ? 'low' : 'high');
}

async function createWorld(THREE, PP) {
  const tier = detectTier();
  const HIGH = tier === 'high';
  const Q = HIGH
    ? { trees: 2600, seg: [180, 260], snow: 6500, lanternLights: 4, doorLights: true, bloom: true, shadows: true, dpr: Math.min(devicePixelRatio || 1, 1.75), msaa: 4 }
    : { trees: 1150, seg: [110, 160], snow: 2400, lanternLights: 2, doorLights: false, bloom: false, shadows: false, dpr: Math.min(devicePixelRatio || 1, 1.4), msaa: 0 };

  const canvas = $('#world');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Q.dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (Q.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  const C = hex => new THREE.Color(hex);
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const FOG = C('#0c1a31');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG, 0.0105);
  scene.background = FOG;
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2400);

  const U = { time: { value: 0 } };
  const MOON_DIR = V(-0.42, 0.33, -1).normalize();

  /* ── noise & helpers ── */
  function hash2(ix, iy) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), ux), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux), uy) * 2 - 1;
  }
  function fbm(x, y, oct = 4) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  }
  const rng = mulberry32(2026);

  /* ── the trail ── */
  const curve2 = new THREE.CatmullRomCurve3(LAYOUT.path.map(([x, z]) => V(x, 0, z)), false, 'catmullrom', 0.5);
  const PS = curve2.getSpacedPoints(360);
  function pathInfo(x, z) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < PS.length; i += 8) {
      const d = (PS[i].x - x) ** 2 + (PS[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    const a = Math.max(0, bi - 10), b = Math.min(PS.length - 1, bi + 10);
    for (let i = a; i <= b; i++) {
      const d = (PS[i].x - x) ** 2 + (PS[i].z - z) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return { d: Math.sqrt(best), i: bi };
  }

  /* ── terrain height ── */
  const VL = LAYOUT.village, LK = LAYOUT.lake;
  function rawH(x, z) {
    let h = fbm(x * 0.016 + 3.1, z * 0.016 - 1.7, 4) * 5 + fbm(x * 0.07, z * 0.07, 2) * 0.5;
    const sx = Math.max(0, Math.abs(x) - 34) / 120; h += sx * sx * 26;
    const back = Math.max(0, -z - 350) / 100; h += back * back * 24;
    const front = Math.max(0, z - 45) / 60; h += front * front * 12;
    return h;
  }
  const pathRaw = PS.map(p => rawH(p.x, p.z));
  const pathH = pathRaw.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -14; k <= 14; k++) { const j = clamp(i + k, 0, PS.length - 1); s += pathRaw[j]; n++; }
    return s / n;
  });
  const VH = pathH[pathH.length - 1];
  // ease the last stretch of trail down to the village floor
  for (let i = 0; i < pathH.length; i++) pathH[i] = lerp(pathH[i], VH, smoothstep(0.75, 1, i / (pathH.length - 1)));

  const OBS = LAYOUT.buildings.find(b => b.id === 'observatory');
  function height(x, z) {
    let h = rawH(x, z);
    const { d, i } = pathInfo(x, z);
    h = lerp(h, pathH[i] - 0.12, 1 - smoothstep(2.5, 9, d));
    const dv = Math.hypot(x - VL.x, z - VL.z);
    h = lerp(h, VH + fbm(x * 0.08, z * 0.08, 2) * 0.22, 1 - smoothstep(VL.r * 0.55, VL.r, dv));
    h += 1.6 * (1 - smoothstep(5, 14, Math.hypot(x - OBS.x, z - OBS.z)));
    const dl = Math.hypot(x - LK.x, z - LK.z);
    if (dl < LK.r + 5) h = lerp(VH - 0.55, h, smoothstep(LK.r - 1.5, LK.r + 5, dl));
    return h;
  }

  /* ── building placement (needed before terrain colours) ── */
  const SQ = LAYOUT.square;
  const BLD = {};
  const DOOR_LOCAL = {
    workshop:    V(0, 1.55, 4.05),
    observatory: V(0, 2.1, 4.3),
    archive:     V(0, 2.3, 3.55),
    library:     V(0, 1.95, 3.55),
    cabin:       V(-0.6, 1.4, 2.75),
  };
  const LABEL_Y = { workshop: 9.4, observatory: 13.4, archive: 11.2, library: 13.2, cabin: 7.2 };
  for (const b of LAYOUT.buildings) {
    const rot = Math.atan2(SQ.x - b.x, SQ.z - b.z);
    const base = b.id === 'observatory' ? VH + 1.6 : VH;
    const fwd = V(Math.sin(rot), 0, Math.cos(rot));
    const dl = DOOR_LOCAL[b.id].clone().applyAxisAngle(V(0, 1, 0), rot);
    BLD[b.id] = {
      ...b, rot, base, fwd,
      pos: V(b.x, base, b.z),
      door: V(b.x + dl.x, base + dl.y, b.z + dl.z),
      label: V(b.x, base + LABEL_Y[b.id], b.z),
    };
  }
  function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  }

  const world = new THREE.Group();
  scene.add(world);

  /* ── terrain ── */
  {
    const W = 380, D = 540, cz = -205;
    const g = new THREE.PlaneGeometry(W, D, Q.seg[0], Q.seg[1]);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, cz);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const snowA = C('#d5dfee'), snowB = C('#b9c6db'), track = C('#7f8798'), warm = C('#9a9188');
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, height(x, z));
      const { d } = pathInfo(x, z);
      tmp.copy(snowA).lerp(snowB, clamp(0.5 + fbm(x * 0.05, z * 0.05, 3), 0, 1) * 0.6);
      let t = 1 - smoothstep(1.2, 3.1, d + fbm(x * 0.6, z * 0.6, 2) * 0.6);
      let s = 1 - smoothstep(0, 9, Math.hypot(x - SQ.x, z - SQ.z));
      for (const id in BLD) {
        const b = BLD[id];
        s = Math.max(s, (1 - smoothstep(0.6, 1.9, segDist(x, z, SQ.x, SQ.z, b.door.x, b.door.z) + fbm(x * 0.7, z * 0.7, 2) * 0.4)) * 0.85);
      }
      tmp.lerp(track, t * 0.55);
      tmp.lerp(warm, s * 0.45);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
    m.receiveShadow = true;
    world.add(m);
  }
  await nextFrame();

  /* ── frozen lake ── */
  {
    const g = new THREE.CircleGeometry(LK.r + 1.2, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C('#7f96b6'), roughness: 0.18, metalness: 0.35 }));
    m.position.set(LK.x, VH - 0.32, LK.z);
    m.scale.set(1, 1, 0.82);
    m.receiveShadow = true;
    world.add(m);
  }

  /* ── sky, stars, moon, mountains ── */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uZenith: { value: C('#02050c') }, uHorizon: { value: FOG.clone() }, uMoon: { value: MOON_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uMoon; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = mix(uHorizon, uZenith, smoothstep(-0.02, 0.6, h));
          float m = max(dot(normalize(vDir), uMoon), 0.0);
          c += vec3(0.05, 0.065, 0.11) * pow(m, 6.0) + vec3(0.12, 0.14, 0.2) * pow(m, 60.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  const stars = (() => {
    const n = HIGH ? 2600 : 1400;
    const p = new Float32Array(n * 3), s = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = 0.04 + Math.pow(rng(), 0.7) * 0.96, a = rng() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      p.set([Math.cos(a) * r * 1400, y * 1400, Math.sin(a) * r * 1400], i * 3);
      s[i] = 0.6 + Math.pow(rng(), 6) * 2.4; ph[i] = rng() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.time, uDpr: { value: Q.dpr } },
      vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uDpr; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float tw = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase * 0.2) + aPhase * 7.0);
          vA = tw * smoothstep(0.02, 0.2, normalize(position).y);
          gl_PointSize = aSize * uDpr * 1.6; }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vec3(0.75,0.82,1.0) * a * vA * 0.9, 1.0); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = -9;
    scene.add(pts);
    return pts;
  })();

  function radialTexture(stops, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    x.fillStyle = gr; x.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const glowTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);

  const moon = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(118, 112, 10, 128, 128, 120);
    gr.addColorStop(0, '#fbf8ee'); gr.addColorStop(0.85, '#e4e6ec'); gr.addColorStop(1, '#c9cfdc');
    x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.fillStyle = gr; x.fill();
    x.save(); x.clip();
    const mr = mulberry32(5);
    for (let i = 0; i < 16; i++) {
      x.fillStyle = `rgba(150,158,176,${0.08 + mr() * 0.12})`;
      x.beginPath(); x.arc(60 + mr() * 140, 50 + mr() * 150, 8 + mr() * 26, 0, Math.PI * 2); x.fill();
    }
    x.restore();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    disc.material.color.setRGB(2.4, 2.4, 2.5);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: C('#7d93c6'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    disc.scale.setScalar(58); halo.scale.setScalar(420);
    disc.renderOrder = -7; halo.renderOrder = -8;
    g.add(halo, disc);
    scene.add(g);
    return g;
  })();

  function ridge(z, width, base, amp, freq, seed, cBase, cTop, cPeak, snowLine) {
    const pts = [];
    for (let x = -width / 2; x <= width / 2; x += 14) {
      const n = fbm(x * freq + seed, seed * 0.37, 5);
      const peak = Math.pow(Math.abs(vnoise(x * freq * 0.45 + seed * 2, 1.3)), 1.4);
      pts.push([x, base + amp * (0.45 + n * 0.55 + peak * 0.55)]);
    }
    const pos = [], col = [], idx = [];
    const top = Math.max(...pts.map(p => p[1]));
    const cb = C(cBase), ct = C(cTop), cp = C(cPeak), tmp = new THREE.Color();
    pts.forEach(([x, y], i) => {
      const snowy = smoothstep(snowLine, 1, y / top);
      pos.push(x, -40, 0, x, y - 18 - snowy * 26, 0, x, y, 0);
      col.push(cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
      tmp.copy(ct).lerp(cp, snowy);
      col.push(tmp.r, tmp.g, tmp.b);
      if (i) {
        const a = (i - 1) * 3, c = i * 3;
        idx.push(a, c, a + 1, a + 1, c, c + 1, a + 1, c + 1, a + 2, a + 2, c + 1, c + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    m.position.z = z;
    m.renderOrder = -6;
    return m;
  }
  const mountains = new THREE.Group();
  mountains.add(
    ridge(-1050, 3600, 120, 330, 0.0026, 4.2, '#0f1d35', '#24365a', '#7d90b6', 0.6),
    ridge(-860,  3200, 60,  220, 0.0042, 9.7, '#0b1628', '#1a2945', '#55688e', 0.7),
  );
  scene.add(mountains);

  /* ── trees ── */
  const pineA = C('#1e3c2d'), pineB = C('#0f2219'), pineTip = C('#2b4d3b'), snowC = C('#e2eaf4'), bark = C('#2b1f19');

  function treeGeometry({ H, R, tiers, segs, seed }) {
    const r = mulberry32(seed);
    const pos = [], col = [], idx = [];
    const pushV = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); return pos.length / 3 - 1; };
    const tmp = new THREE.Color();
    const trunkH = H * 0.16;
    const yStart = trunkH * 0.75, yEnd = H * 0.66;
    for (let t = 0; t < tiers; t++) {
      const k = tiers === 1 ? 0 : t / (tiers - 1);
      const yb = lerp(yStart, yEnd, k);
      const ya = t === tiers - 1 ? H : Math.min(H, yb + (yEnd - yStart) / Math.max(1, tiers - 1) * 2.1);
      const th = ya - yb;
      const rad = R * (1 - k * 0.78) * (0.92 + r() * 0.16);
      const off = r() * Math.PI;
      const ring0 = [], ring1 = [];
      for (let j = 0; j < segs * 2; j++) {
        const long = j % 2 === 0;
        const a = off + (j / (segs * 2)) * Math.PI * 2 + (r() - 0.5) * 0.12;
        const rr = rad * (long ? 1 : 0.7) * (0.88 + r() * 0.24);
        const y = yb + (long ? -0.16 * rad * (0.6 + r() * 0.6) : 0.1 * rad);
        if (long) tmp.copy(pineTip).lerp(snowC, r() < 0.4 ? 0.35 + r() * 0.3 : 0);
        else tmp.copy(pineB);
        ring0.push(pushV(Math.cos(a) * rr, y, Math.sin(a) * rr, tmp));
      }
      for (let j = 0; j < segs; j++) {
        const a = off + ((j * 2) / (segs * 2)) * Math.PI * 2 + (r() - 0.5) * 0.15;
        const rr = rad * (0.5 + r() * 0.08);
        tmp.copy(pineA).lerp(snowC, 0.62 + r() * 0.38);
        ring1.push(pushV(Math.cos(a) * rr, yb + th * (0.38 + r() * 0.06), Math.sin(a) * rr, tmp));
      }
      const apex = pushV((r() - 0.5) * 0.08, ya, (r() - 0.5) * 0.08, snowC);
      const under = pushV(0, yb + 0.22 * rad, 0, pineB);
      const n0 = segs * 2;
      for (let j = 0; j < segs; j++) {
        const L0 = ring0[2 * j], Lm = ring0[2 * j + 1], L1 = ring0[(2 * j + 2) % n0];
        const U0 = ring1[j], U1 = ring1[(j + 1) % segs];
        idx.push(L0, U0, Lm, Lm, U0, U1, Lm, U1, L1);
        idx.push(U0, apex, U1);
      }
      for (let j = 0; j < n0; j++) idx.push(ring0[j], ring0[(j + 1) % n0], under);
    }
    // trunk
    const tg = new THREE.CylinderGeometry(R * 0.07, R * 0.11, trunkH, 6, 1);
    tg.translate(0, trunkH / 2 - 0.3, 0);
    const base = pos.length / 3;
    const tp = tg.attributes.position;
    for (let i = 0; i < tp.count; i++) pushV(tp.getX(i), tp.getY(i), tp.getZ(i), bark);
    for (const i of tg.index.array) idx.push(base + i);
    tg.dispose();

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  treeMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float hh = max(position.y, 0.0);
      float ph = ip.x * 0.37 + ip.y * 0.23;
      float sw = hh * hh * 0.0014;
      transformed.x += sin(uTime * 0.8 + ph) * sw;
      transformed.z += cos(uTime * 0.63 + ph * 1.3) * sw * 0.7;`);
  };

  const VARIANTS = [
    { H: 15, R: 2.7, tiers: 6, segs: 9, seed: 1 },   // tall and slender
    { H: 10, R: 2.9, tiers: 5, segs: 9, seed: 2 },   // full
    { H: 7.5, R: 3.3, tiers: 4, segs: 8, seed: 3 },  // broad, young
    { H: 13, R: 3.0, tiers: 3, segs: 5, seed: 4 },   // distant (cheap)
  ];
  const geos = VARIANTS.map(treeGeometry);
  const lists = VARIANTS.map(() => []);
  const avoid = [...Object.values(BLD).map(b => ({ x: b.x, z: b.z, r: 9 })), ...LAYOUT.cottages.map(([x, z]) => ({ x, z, r: 7 }))];
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = V(), p = V();
    let placed = 0, tries = 0;
    while (placed < Q.trees && tries < Q.trees * 14) {
      tries++;
      const x = (rng() * 2 - 1) * 180, z = 58 - rng() * 520;
      const { d } = pathInfo(x, z);
      if (d > 50 && rng() > 0.42) continue;
      if (d > 100 && rng() > 0.55) continue;
      const far = d > 72;
      const vi = far ? 3 : (rng() < 0.36 ? 0 : rng() < 0.6 ? 1 : 2);
      const sc = 0.72 + rng() * 0.62;
      const rad = VARIANTS[vi].R * sc;
      if (d < rad + 1.8 + rng() * 3.2) continue;
      const dv = Math.hypot(x - VL.x, z - VL.z);
      if (dv < VL.r - 6 + rng() * 10) continue;
      if (Math.hypot(x - LK.x, z - LK.z) < LK.r + 3) continue;
      // keep the view from the trail's end into the village clear
      if (z < -196 && z > -272) {
        const half = lerp(5, 40, smoothstep(-196, -262, z));
        if (Math.abs(x - 1) < half + rad * 0.5) continue;
      }
      if (avoid.some(a => Math.hypot(x - a.x, z - a.z) < a.r + rad * 0.6)) continue;
      p.set(x, height(x, z) - 0.25, z);
      e.set((rng() - 0.5) * 0.06, rng() * Math.PI * 2, (rng() - 0.5) * 0.06);
      q.setFromEuler(e);
      s.set(sc, sc * (0.88 + rng() * 0.28), sc);
      m.compose(p, q, s);
      lists[vi].push(m.clone());
      placed++;
    }
  }
  const tint = new THREE.Color();
  lists.forEach((mats, vi) => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geos[vi], treeMat, mats.length);
    mats.forEach((mm, i) => {
      im.setMatrixAt(i, mm);
      const k = 0.85 + rng() * 0.22;
      tint.setRGB(k * (0.96 + rng() * 0.06), k, k * (0.97 + rng() * 0.08));
      im.setColorAt(i, tint);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = vi !== 3 && Q.shadows;
    im.receiveShadow = false;
    world.add(im);
  });
  await nextFrame();

  /* ── materials for the village ── */
  const std = (hex, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color: C(hex), roughness: rough, metalness: 0, ...extra });
  const MAT = {
    wood: std('#3a2a20'), woodDark: std('#241913'), log: std('#4a3426', 0.95),
    stone: std('#5e6571', 0.95), stoneWarm: std('#6f6862', 0.95), plaster: std('#2f3f37', 0.9),
    snow: std('#e3eaf4', 0.8), iron: std('#191c21', 0.6, { metalness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: C('#8d99ab'), metalness: 0.7, roughness: 0.36 }),
    window: new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C('#ffb15e'), emissiveIntensity: 2.6 }),
    door: new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C('#ff9440'), emissiveIntensity: 1.7 }),
    lens: new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C('#9fc3ff'), emissiveIntensity: 1.4 }),
    slit: new THREE.MeshStandardMaterial({ color: C('#05080f'), emissive: C('#16233c'), emissiveIntensity: 1, roughness: 1 }),
  };

  function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = Q.shadows && mat !== MAT.window && mat !== MAT.door;
    m.receiveShadow = Q.shadows;
    if (parent) parent.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z, p) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p);

  function gable(w, d, h, over, mat) {   // mat may be [caps, slopes]
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2 - over, 0); sh.lineTo(w / 2 + over, 0); sh.lineTo(0, h); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: d + over * 2, bevelEnabled: false });
    g.translate(0, 0, -(d + over * 2) / 2);
    return new THREE.Mesh(g, mat);
  }
  function roof(parent, w, d, h, y, over = 0.6, cap = MAT.wood) {
    const under = gable(w + 0.1, d + 0.1, h, over + 0.05, MAT.woodDark);
    under.position.y = y - 0.12;
    const top = gable(w, d, h, over, [cap, MAT.snow]);
    top.position.y = y + 0.08;
    [under, top].forEach(m => { m.castShadow = Q.shadows; m.receiveShadow = Q.shadows; parent.add(m); });
  }
  function windowAt(parent, x, y, z, w, h, ry = 0, cross = true) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    mesh(new THREE.PlaneGeometry(w, h), MAT.window, 0, 0, 0, g);
    const f = 0.09;
    box(w + f * 2, f, 0.08, MAT.woodDark, 0, h / 2, 0.02, g);
    box(w + f * 2, f * 1.6, 0.16, MAT.snow, 0, -h / 2 - 0.02, 0.06, g);
    box(f, h, 0.08, MAT.woodDark, -w / 2, 0, 0.02, g);
    box(f, h, 0.08, MAT.woodDark, w / 2, 0, 0.02, g);
    if (cross) { box(0.05, h, 0.05, MAT.woodDark, 0, 0, 0.03, g); box(w, 0.05, 0.05, MAT.woodDark, 0, 0, 0.03, g); }
    parent.add(g);
    return g;
  }
  function doorAt(parent, x, y, z, w, h, ry = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    mesh(new THREE.PlaneGeometry(w, h), MAT.door, 0, 0, 0, g);
    box(w + 0.3, 0.18, 0.14, MAT.woodDark, 0, h / 2 + 0.06, 0.05, g);
    box(0.15, h, 0.14, MAT.woodDark, -w / 2 - 0.05, 0, 0.05, g);
    box(0.15, h, 0.14, MAT.woodDark, w / 2 + 0.05, 0, 0.05, g);
    parent.add(g);
  }
  function signAt(parent, text, x, y, z, w = 3.4) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 220;
    const k = c.getContext('2d');
    const gr = k.createLinearGradient(0, 0, 0, 220);
    gr.addColorStop(0, '#2f2016'); gr.addColorStop(1, '#1c130d');
    k.fillStyle = gr; k.fillRect(0, 0, 1024, 220);
    k.strokeStyle = 'rgba(201,168,106,0.75)'; k.lineWidth = 5; k.strokeRect(14, 14, 996, 192);
    k.fillStyle = '#e2c487';
    k.font = '600 104px "Cormorant Garamond", Georgia, serif';
    k.textAlign = 'center'; k.textBaseline = 'middle';
    if ('letterSpacing' in k) k.letterSpacing = '10px';
    let size = 104;
    while (k.measureText(text).width > 920 && size > 50) { size -= 4; k.font = `600 ${size}px "Cormorant Garamond", Georgia, serif`; }
    k.fillText(text, 512, 116);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 220 / 1024),
      new THREE.MeshStandardMaterial({ map: tex, emissive: C('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.32, roughness: 0.8 }));
    m.position.set(x, y, z);
    parent.add(m);
  }

  const chimneys = [];
  const lanternSpots = [];   // world positions of lanterns
  const doorGlows = [];

  /* ── the five destinations ── */
  const BUILDERS = {
    workshop(g) {
      box(10.6, 1.2, 8.6, MAT.stone, 0, 0, 0, g);
      box(10, 4.6, 8, MAT.wood, 0, 2.9, 0, g);
      for (let i = -4; i <= 4; i += 2) box(0.18, 4.6, 0.12, MAT.woodDark, i * 1.18, 2.9, 4.03, g);
      roof(g, 10, 8, 3.4, 5.2);
      box(0.95, 3.2, 0.95, MAT.stone, 3, 7.1, -1.6, g);
      box(1.15, 0.3, 1.15, MAT.snow, 3, 8.75, -1.6, g);
      chimneys.push(V(3, 9, -1.6).applyAxisAngle(V(0, 1, 0), BLD.workshop.rot).add(BLD.workshop.pos));
      doorAt(g, 0, 2.1, 4.02, 2.8, 3.0);
      windowAt(g, -3.4, 3.1, 4.02, 1.7, 1.3);
      windowAt(g, 3.4, 3.1, 4.02, 1.7, 1.3);
      windowAt(g, 5.02, 3.1, 0, 1.6, 1.2, Math.PI / 2);
      windowAt(g, -5.02, 3.1, 0, 1.6, 1.2, -Math.PI / 2);
      signAt(g, 'THE WORKSHOP', 0, 4.25, 4.1, 3.6);
      // gear emblem in the gable
      const gear = new THREE.Group();
      gear.position.set(0, 6.4, 4.7);
      mesh(new THREE.TorusGeometry(0.62, 0.13, 8, 24), MAT.metal, 0, 0, 0, gear);
      mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12).rotateX(Math.PI / 2), MAT.metal, 0, 0, 0, gear);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const t = box(0.2, 0.26, 0.16, MAT.metal, Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0, gear);
        t.rotation.z = a;
      }
      g.add(gear);
      // workbench and crates on the porch side
      box(2.4, 0.15, 0.8, MAT.woodDark, -3.6, 1.45, 5.2, g);
      box(0.12, 0.85, 0.7, MAT.woodDark, -4.7, 1.0, 5.2, g);
      box(0.12, 0.85, 0.7, MAT.woodDark, -2.5, 1.0, 5.2, g);
      box(0.9, 0.9, 0.9, MAT.wood, 4.2, 1.05, 5.3, g);
      box(0.95, 0.12, 0.95, MAT.snow, 4.2, 1.55, 5.3, g);
    },
    observatory(g) {
      mesh(new THREE.CylinderGeometry(5.2, 5.5, 1.4, 32), MAT.stone, 0, 0.1, 0, g);
      mesh(new THREE.CylinderGeometry(4.2, 4.3, 6.6, 32), MAT.stoneWarm, 0, 4.1, 0, g);
      mesh(new THREE.CylinderGeometry(4.55, 4.55, 0.4, 32), MAT.stone, 0, 7.5, 0, g);
      mesh(new THREE.CylinderGeometry(4.75, 4.75, 0.12, 32), MAT.snow, 0, 7.75, 0, g);
      const dome = mesh(new THREE.SphereGeometry(4.3, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), MAT.metal, 0, 7.7, 0, g);
      dome.castShadow = Q.shadows;
      const slit = mesh(new THREE.TorusGeometry(4.33, 0.5, 6, 30, Math.PI / 2 * 0.98), MAT.slit, 0, 7.7, 0, g);
      slit.rotation.y = -Math.PI / 2;
      slit.scale.set(1, 1, 0.55);
      // telescope peering out of the slit
      const tel = new THREE.Group();
      tel.position.set(0, 7.9, 0);
      tel.rotation.x = -0.75;
      mesh(new THREE.CylinderGeometry(0.42, 0.5, 5.4, 16).rotateX(Math.PI / 2), MAT.iron, 0, 0, 2.5, tel);
      mesh(new THREE.CircleGeometry(0.4, 16), MAT.lens, 0, 0, 5.22, tel);
      g.add(tel);
      for (const a of [-0.75, 0.75, Math.PI - 0.6, Math.PI + 0.6]) {
        windowAt(g, Math.sin(a) * 4.24, 4.8, Math.cos(a) * 4.24, 0.85, 1.6, a, false);
      }
      doorAt(g, 0, 2.1, 4.28, 1.6, 2.6);
      box(2.6, 0.3, 1.4, MAT.stone, 0, 0.75, 5.0, g);
      box(3.2, 0.3, 1.4, MAT.stone, 0, 0.45, 5.6, g);
      signAt(g, 'OBSERVATORY', 0, 3.85, 4.34, 3.0);
    },
    archive(g) {
      box(10.2, 1.4, 8.2, MAT.stone, 0, 0, 0, g);
      box(9, 6.4, 7, MAT.stoneWarm, 0, 3.9, 0, g);
      box(9.4, 0.4, 7.4, MAT.stone, 0, 7.2, 0, g);
      const hip = mesh(new THREE.ConeGeometry(7.1, 3, 4), MAT.snow, 0, 8.9, 0, g);
      hip.rotation.y = Math.PI / 4;
      hip.scale.set(1, 1, 0.8);
      // portico
      for (const x of [-3.4, -1.2, 1.2, 3.4]) {
        mesh(new THREE.CylinderGeometry(0.3, 0.34, 4.7, 14), MAT.stone, x, 3.1, 4.65, g);
      }
      box(8.6, 0.6, 1.8, MAT.stone, 0, 5.75, 4.55, g);
      const ped = gable(8.6, 1.6, 1.3, 0.05, [MAT.stone, MAT.snow]);
      ped.position.set(0, 6.05, 4.55); g.add(ped);
      box(8.8, 0.25, 2.6, MAT.stone, 0, 0.75, 4.6, g);
      doorAt(g, 0, 2.3, 3.52, 1.8, 3.0);
      for (const x of [-3.1, 3.1]) windowAt(g, x, 3.1, 3.52, 1.0, 2.0);
      for (const x of [-3.1, -1.05, 1.05, 3.1]) windowAt(g, x, 6.0, 3.52, 0.8, 1.1);
      for (const z of [-1.8, 1.8]) { windowAt(g, 4.52, 3.4, z, 1.0, 2.0, Math.PI / 2); windowAt(g, -4.52, 3.4, z, 1.0, 2.0, -Math.PI / 2); }
      signAt(g, 'RESEARCH ARCHIVE', 0, 5.75, 5.47, 4.4);
    },
    library(g) {
      box(8.6, 1.2, 7.6, MAT.stone, 0, 0, 0, g);
      box(8, 7.2, 7, MAT.plaster, 0, 4.2, 0, g);
      box(8.2, 0.25, 7.2, MAT.woodDark, 0, 4.6, 0, g);
      roof(g, 8, 7, 4.8, 7.8, 0.55, MAT.plaster);
      box(0.9, 3.4, 0.9, MAT.stone, -2.4, 10.9, -1.4, g);
      box(1.1, 0.3, 1.1, MAT.snow, -2.4, 12.65, -1.4, g);
      chimneys.push(V(-2.4, 12.9, -1.4).applyAxisAngle(V(0, 1, 0), BLD.library.rot).add(BLD.library.pos));
      doorAt(g, 0, 1.95, 3.52, 1.5, 2.7);
      windowAt(g, -2.55, 2.4, 3.52, 2.0, 1.9);
      windowAt(g, 2.55, 2.4, 3.52, 2.0, 1.9);
      for (const x of [-2.6, 0, 2.6]) windowAt(g, x, 6.1, 3.52, 1.05, 1.45);
      for (const z of [-1.6, 1.6]) { windowAt(g, 4.02, 2.6, z, 1.2, 1.6, Math.PI / 2); windowAt(g, -4.02, 2.6, z, 1.2, 1.6, -Math.PI / 2); }
      mesh(new THREE.CircleGeometry(0.85, 24), MAT.window, 0, 9.3, 4.12, g);
      mesh(new THREE.TorusGeometry(0.88, 0.1, 6, 24), MAT.woodDark, 0, 9.3, 4.16, g);
      signAt(g, 'LITERARY HOUSE', 0, 4.05, 3.62, 3.6);
    },
    cabin(g) {
      box(6.2, 0.7, 5.2, MAT.stone, 0, 0, 0, g);
      box(5.8, 3.4, 4.8, MAT.woodDark, 0, 2.05, 0, g);
      const logG = new THREE.CylinderGeometry(0.27, 0.27, 6.6, 8).rotateZ(Math.PI / 2);
      const logS = new THREE.CylinderGeometry(0.27, 0.27, 5.6, 8).rotateX(Math.PI / 2);
      for (let i = 0; i < 7; i++) {
        const y = 0.6 + i * 0.5;
        mesh(logG, MAT.log, 0, y, 2.5, g); mesh(logG, MAT.log, 0, y, -2.5, g);
        mesh(logS, MAT.log, 3, y, 0, g); mesh(logS, MAT.log, -3, y, 0, g);
      }
      roof(g, 6.2, 6.6, 2.8, 3.85, 0.75, MAT.log);
      box(1.0, 3.6, 1.0, MAT.stone, 2.1, 4.8, -1.2, g);
      box(1.2, 0.3, 1.2, MAT.snow, 2.1, 6.7, -1.2, g);
      chimneys.push(V(2.1, 6.9, -1.2).applyAxisAngle(V(0, 1, 0), BLD.cabin.rot).add(BLD.cabin.pos));
      box(6.6, 0.22, 1.7, MAT.woodDark, 0, 0.45, 3.4, g);
      for (const x of [-3, 3]) box(0.22, 3.2, 0.22, MAT.log, x, 2.1, 4.1, g);
      doorAt(g, -0.6, 1.45, 2.78, 1.1, 2.1);
      windowAt(g, 1.6, 1.95, 2.79, 1.3, 1.05);
      windowAt(g, 3.29, 1.95, 0, 1.2, 1.0, Math.PI / 2);
      signAt(g, "TRAVELER'S CABIN", 0.9, 3.25, 2.9, 3.0);
      // woodpile
      for (let i = 0; i < 3; i++) for (let j = 0; j < 4 - i; j++) mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 7).rotateX(Math.PI / 2), MAT.log, -3.9 + j * 0.34 + i * 0.17, 0.5 + i * 0.3, 1.2, g);
    },
  };

  const hitBoxes = [];
  for (const id of DEST_IDS) {
    const b = BLD[id];
    const g = new THREE.Group();
    g.position.copy(b.pos);
    g.rotation.y = b.rot;
    BUILDERS[id](g);
    world.add(g);
    const size = { workshop: [11, 10, 9], observatory: [10, 13, 10], archive: [10, 11, 10], library: [9, 13, 8], cabin: [8, 7, 7] }[id];
    const hb = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial());
    hb.position.set(0, size[1] / 2, 0.5);
    hb.visible = false;
    hb.userData.dest = id;
    g.add(hb);
    hitBoxes.push(hb);
    doorGlows.push(b.door.clone().addScaledVector(b.fwd, 2.4));
    const side = V(b.fwd.z, 0, -b.fwd.x);
    const lp = b.door.clone().addScaledVector(b.fwd, 1.3).addScaledVector(side, id === 'cabin' ? 2.2 : 2.6);
    lanternSpots.push(V(lp.x, b.base, lp.z));
    if (id === 'library') {
      const lp2 = b.door.clone().addScaledVector(b.fwd, 1.3).addScaledVector(side, -2.6);
      lanternSpots.push(V(lp2.x, b.base, lp2.z));
    }
  }

  // cottages
  for (const [x, z] of LAYOUT.cottages) {
    const g = new THREE.Group();
    const r2 = mulberry32(Math.abs(x * 31 + z));
    const w = 5 + r2() * 2, d = 4.5 + r2() * 1.5, h = 3 + r2() * 0.8;
    g.position.set(x, height(x, z), z);
    g.rotation.y = Math.atan2(SQ.x - x, SQ.z - z) + (r2() - 0.5) * 0.4;
    box(w + 0.4, 0.8, d + 0.4, MAT.stone, 0, 0, 0, g);
    box(w, h, d, r2() < 0.5 ? MAT.wood : MAT.plaster, 0, h / 2 + 0.3, 0, g);
    roof(g, w, d, 2.3 + r2(), h + 0.3, 0.5, g.children[1].material);
    windowAt(g, w * 0.22, h * 0.55 + 0.3, d / 2 + 0.02, 1.0, 0.9);
    if (r2() < 0.7) windowAt(g, -w * 0.25, h * 0.55 + 0.3, d / 2 + 0.02, 1.0, 0.9);
    box(1, 2.4, 1, MAT.stone, -w * 0.3, h + 2, -d * 0.2, g);
    world.add(g);
  }

  // village square: a stone well-ring and a two-lantern post
  {
    const g = new THREE.Group();
    g.position.set(SQ.x, VH, SQ.z);
    mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.7, 20), MAT.stone, 0, 0.25, 0, g);
    mesh(new THREE.CylinderGeometry(1.52, 1.52, 0.12, 20), MAT.snow, 0, 0.64, 0, g);
    mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.6, 8), MAT.iron, 0, 2.3, 0, g);
    box(1.8, 0.08, 0.08, MAT.iron, 0, 3.9, 0, g);
    world.add(g);
    lanternSpots.push(V(SQ.x - 0.85, VH + 3.45, SQ.z), V(SQ.x + 0.85, VH + 3.45, SQ.z));
  }

  /* ── lanterns along the trail ── */
  {
    let side = 1;
    for (let i = 26; i < PS.length - 6; i += 19) {
      const p = PS[i], q = PS[Math.min(PS.length - 1, i + 1)];
      const tx = q.x - p.x, tz = q.z - p.z, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l;
      const x = p.x + nx * 2.6 * side, z = p.z + nz * 2.6 * side;
      lanternSpots.push(V(x, height(x, z), z));
      side *= -1;
    }
  }
  const lanternLights = [];   // glass positions
  {
    const n = lanternSpots.length;
    const postG = new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6); postG.translate(0, 1.0, 0);
    const frameG = new THREE.BoxGeometry(0.34, 0.44, 0.34); frameG.translate(0, 2.22, 0);
    const glassG = new THREE.BoxGeometry(0.24, 0.32, 0.24); glassG.translate(0, 2.22, 0);
    const capG = new THREE.ConeGeometry(0.3, 0.22, 4); capG.rotateY(Math.PI / 4); capG.translate(0, 2.55, 0);
    const parts = [
      new THREE.InstancedMesh(postG, MAT.iron, n),
      new THREE.InstancedMesh(frameG, new THREE.MeshStandardMaterial({ color: C('#16181c'), metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.55 }), n),
      new THREE.InstancedMesh(glassG, new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C('#ffb05a'), emissiveIntensity: 3.2 }), n),
      new THREE.InstancedMesh(capG, MAT.snow, n),
    ];
    const m = new THREE.Matrix4();
    lanternSpots.forEach((p, i) => {
      // square lanterns hang from the post's arm, so skip their own posts
      const hanging = p.y > VH + 1.5 && Math.abs(p.z - SQ.z) < 0.01;
      const y0 = hanging ? p.y - 2.22 + 0 : p.y;
      m.makeTranslation(p.x, y0, p.z);
      parts.forEach((im, k) => {
        if (k === 0 && hanging) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        else im.setMatrixAt(i, m);
      });
      lanternLights.push(V(p.x, y0 + 2.22, p.z));
    });
    parts.forEach(im => { im.instanceMatrix.needsUpdate = true; im.castShadow = false; world.add(im); });
  }

  /* glow sprites for lanterns (one draw call, flickers in the shader) */
  {
    const n = lanternLights.length;
    const p = new Float32Array(n * 3), ph = new Float32Array(n);
    lanternLights.forEach((v, i) => { p.set([v.x, v.y, v.z], i * 3); ph[i] = rng() * 10; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.time, uScale: { value: 1 }, uFog: { value: scene.fog.density } },
      vertexShader: `attribute float aPhase; uniform float uTime; uniform float uScale; uniform float uFog; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          float fl = 0.88 + 0.08 * sin(uTime * 7.3 + aPhase) + 0.05 * sin(uTime * 13.1 + aPhase * 2.3);
          float fogF = exp(-pow(uFog * d * 0.8, 2.0));
          vA = fl * fogF;
          gl_PointSize = 2.6 * uScale / max(d, 0.5); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.2);
          gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a * vA * 0.8, 1.0); }`,
    });
    var lanternGlow = new THREE.Points(g, m);
    lanternGlow.frustumCulled = false;
    world.add(lanternGlow);
  }

  /* warm pools of light on the snow (fake bounce — cheap and soft) */
  {
    const spots = [...lanternLights.map(v => [v, 5.5]), ...doorGlows.map(v => [v, 8])];
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({
      map: glowTex, color: C('#ff9a48'), transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([v, s], i) => {
      m.makeScale(s, 1, s).setPosition(v.x, height(v.x, v.z) + 0.07, v.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    world.add(im);
  }

  /* ── lights ── */
  const hemi = new THREE.HemisphereLight(C('#3a5794'), C('#0a1120'), 0.55);
  scene.add(hemi);
  // soft fill from behind the walker so facades facing the trail aren't lost against the moon
  const fill = new THREE.DirectionalLight(C('#7f93c4'), 0.32);
  fill.position.set(0.3, 0.5, 1);
  scene.add(fill);
  const moonLight = new THREE.DirectionalLight(C('#a9bdf0'), 0.95);
  moonLight.position.copy(MOON_DIR).multiplyScalar(100);
  scene.add(moonLight, moonLight.target);
  if (Q.shadows) {
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    const sc = moonLight.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 10; sc.far = 260;
    moonLight.shadow.bias = -0.0006;
    moonLight.shadow.normalBias = 0.06;
  }
  const pool = [];
  for (let i = 0; i < Q.lanternLights; i++) {
    const l = new THREE.PointLight(C('#ffa552'), 0, 16, 1.6);
    scene.add(l); pool.push(l);
  }
  if (Q.doorLights) {
    for (const id of DEST_IDS) {
      const b = BLD[id];
      const l = new THREE.PointLight(C('#ffae5c'), 16, 20, 1.6);
      l.position.copy(b.door).addScaledVector(b.fwd, 2.2);
      l.position.y += 0.8;
      scene.add(l);
    }
  }

  /* ── atmosphere: ground fog, distant village glow, chimney smoke ── */
  const fogTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const k = c.getContext('2d');
    const r2 = mulberry32(17);
    for (let i = 0; i < 26; i++) {
      const x = 40 + r2() * 176, y = 40 + r2() * 48, r = 18 + r2() * 34;
      const gr = k.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      k.fillStyle = gr; k.fillRect(0, 0, 256, 128);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const wisps = [];
  {
    const n = HIGH ? 46 : 24;
    for (let i = 0; i < n; i++) {
      const village = i >= n - 8;
      let x, z;
      if (village) { const a = rng() * Math.PI * 2, r = 12 + rng() * 26; x = VL.x + Math.cos(a) * r; z = VL.z + Math.sin(a) * r * 0.7; }
      else { const p = PS[Math.floor(rng() * (PS.length - 1))]; x = p.x + (rng() - 0.5) * 34; z = p.z + (rng() - 0.5) * 10; }
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, color: C('#a5b6d6'), transparent: true, opacity: 0.1 + rng() * 0.12, depthWrite: false }));
      s.position.set(x, height(x, z) + 0.7 + rng() * 1.1, z);
      s.scale.set(18 + rng() * 18, 4 + rng() * 3, 1);
      s.userData = { x, ph: rng() * 6.28, sp: 0.05 + rng() * 0.06 };
      world.add(s); wisps.push(s);
    }
  }
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C('#ffae63'), transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  beacon.position.set(VL.x, VH + 7, VL.z);
  beacon.scale.set(110, 38, 1);
  world.add(beacon);

  const smoke = [];
  for (const c of chimneys) {
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C('#8f9ab0'), transparent: true, opacity: 0, depthWrite: false }));
      s.userData = { base: c, t: i / 6 };
      world.add(s); smoke.push(s);
    }
  }

  /* ── falling snow (wraps around the camera; three depths of flake size) ── */
  const snow = (() => {
    const n = Q.snow;
    const seed = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      seed.set([rng(), rng(), rng()], i * 3);
      const layer = rng();
      size[i] = layer < 0.6 ? 0.022 + rng() * 0.012 : layer < 0.9 ? 0.038 + rng() * 0.016 : 0.06 + rng() * 0.02;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: U.time, uCam: { value: V() }, uScale: { value: 1 } },
      vertexShader: `attribute vec3 aSeed; attribute float aSize; uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vA;
        const vec3 BOX = vec3(64.0, 34.0, 64.0);
        void main(){
          vec3 p = aSeed * BOX;
          float t = uTime;
          p.y -= t * (0.5 + aSeed.x * 0.55);
          p.x += t * 0.3 + sin(t * 0.55 + aSeed.z * 31.0) * 0.9;
          p.z += cos(t * 0.45 + aSeed.y * 23.0) * 0.7;
          vec3 rel = mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5;
          vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          gl_PointSize = clamp(aSize * uScale / max(d, 0.3), 0.0, 40.0);
          vA = smoothstep(0.4, 2.5, d) * (1.0 - smoothstep(16.0, 31.0, d));
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r);
          gl_FragColor = vec4(vec3(0.82, 0.87, 0.97), a * vA * 0.85); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  })();

  /* ── post-processing ── */
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new PP.EffectComposer(renderer, rt);
  composer.setPixelRatio(Q.dpr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new PP.RenderPass(scene, camera));
  const bloom = new PP.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.55, 0.82);
  bloom.enabled = Q.bloom;
  composer.addPass(bloom);
  composer.addPass(new PP.OutputPass());

  /* ── camera poses ── */
  const camCurve = new THREE.CatmullRomCurve3(
    PS.filter((_, i) => i % 6 === 0 || i === PS.length - 1).map(p => {
      const { i } = pathInfo(p.x, p.z);
      return V(p.x, pathH[i] - 0.12, p.z);
    }), false, 'catmullrom', 0.5);
  const lengths = camCurve.getLengths(400);
  const totalLen = lengths[lengths.length - 1];

  let hub, walkEnd, walkFov, hubFov;
  function computeView() {
    const a = camera.aspect;
    const portrait = smoothstep(1.25, 0.55, a);
    // on tall phone screens the outer houses may sit at the edges; the directory below lists all five
    const z = lerp(-232, -217, portrait);
    hub = { pos: V(1, VH + lerp(7, 13, portrait), z), look: V(2, VH + lerp(2.4, 0.8, portrait), -293) };
    const dist = Math.abs(z - -270);
    const half = Math.atan(31 / dist);
    hubFov = clamp(2 * Math.atan(Math.tan(half) / a) * 180 / Math.PI, 46, lerp(82, 70, portrait));
    walkFov = clamp(lerp(55, 72, portrait), 50, 74);
    // walk until a little short of where the village view begins
    const targetZ = z + 9;
    let u = 1;
    for (let k = 0; k <= 200; k++) { const t = k / 200; if (camCurve.getPointAt(t).z < targetZ) { u = t; break; } }
    walkEnd = u;
  }

  const _p = V(), _l = V(), look = V();
  function poseAt(p, outPos, outLook) {
    const t = clamp(p / WALK_PORTION, 0, 1) * walkEnd;
    camCurve.getPointAt(t, outPos);
    outPos.y += 1.85;
    camCurve.getPointAt(Math.min(walkEnd, t + 0.035), outLook);
    if (t + 0.035 > walkEnd) outLook.addScaledVector(camCurve.getTangentAt(walkEnd), (t + 0.035 - walkEnd) * totalLen);
    outLook.y += 1.7 + (1 - smoothstep(0, 0.14, p)) * 4.2;
    const b = smoothstep(WALK_PORTION - 0.1, 1, p);
    outPos.lerp(hub.pos, b);
    outLook.lerp(hub.look, b);
    return lerp(walkFov, hubFov, b);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    computeView();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    const px = h * renderer.getPixelRatio();
    snow.material.uniforms.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    lanternGlow.material.uniforms.uScale.value = px / 2;
    if (mode === 'scroll') applyScrollPose();
    paintOnce = true;
  }

  /* ── camera control ── */
  let mode = 'scroll';        // 'scroll' | 'flight' | 'door'
  let paused = false, paintOnce = true;
  function applyScrollPose() {
    const fov = poseAt(S.shown, _p, _l);
    camera.position.copy(_p);
    look.copy(_l);
    camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function doorPoses(id) {
    const b = BLD[id];
    const approach = { pos: b.door.clone().addScaledVector(b.fwd, 9).setY(b.door.y + 1.5), look: b.door.clone() };
    const inside = { pos: b.door.clone().addScaledVector(b.fwd, 0.5), look: b.door.clone().addScaledVector(b.fwd, -4) };
    return { approach, inside };
  }

  function bez(a, b, c, t, out) {
    const u = 1 - t;
    return out.set(
      u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      u * u * a.y + 2 * u * t * b.y + t * t * c.y,
      u * u * a.z + 2 * u * t * b.z + t * t * c.z);
  }

  function flight(from, via, to, duration, fovTo, veilFn) {
    mode = 'flight';
    const fovFrom = camera.fov;
    return new Promise(resolve => {
      if (duration <= 0) {
        camera.position.copy(to.pos); look.copy(to.look); camera.lookAt(look);
        camera.fov = fovTo; camera.updateProjectionMatrix();
        veilFn?.(1); paintOnce = true; resolve(); return;
      }
      const t0 = performance.now();
      const step = now => {
        const t = clamp((now - t0) / duration, 0, 1), e = easeInOut(t);
        bez(from.pos, via.pos, to.pos, e, camera.position);
        bez(from.look, via.look, to.look, e, look);
        camera.lookAt(look);
        camera.fov = lerp(fovFrom, fovTo, e); camera.updateProjectionMatrix();
        veilFn?.(t);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /* ── hovering buildings from the village view ── */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null, pointerIn = false;
  const labelsEl = $('#labels');
  const labelEls = {};
  for (const id of DEST_IDS) {
    const b = BLD[id];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'place-label';
    el.tabIndex = -1;
    el.setAttribute('aria-hidden', 'true');
    el.dataset.dest = id;
    el.innerHTML = `<span class="pl-name">${b.name}</span><span class="pl-sub">${b.sub}</span>`;
    labelsEl.appendChild(el);
    labelEls[id] = el;
  }
  const hubActive = () => mode === 'scroll' && S.shown > 0.965 && !S.openId && !S.mapOpen && !S.busy;

  function setHover(id) {
    if (hovered === id) return;
    hovered = id;
    for (const k in labelEls) labelEls[k].classList.toggle('hot', k === id);
    $$('#directory a').forEach(a => a.classList.toggle('hot', a.dataset.dest === id));
    root.style.cursor = id ? 'pointer' : '';
  }
  addEventListener('pointermove', e => {
    pointerIn = true;
    if (!hubActive() || e.pointerType === 'touch' || e.target.closest('a, button, .dest, .map')) { if (hovered) setHover(null); return; }
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitBoxes, false)[0];
    setHover(hit ? hit.object.userData.dest : null);
  }, { passive: true });
  addEventListener('click', e => {
    if (!hubActive() || e.target.closest('a, button, .dest, .map, .topbar')) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitBoxes, false)[0];
    if (hit) goTo(hit.object.userData.dest);
  });

  const _v = V();
  function updateLabels() {
    const on = hubActive();
    labelsEl.classList.toggle('on', on);
    if (!on) { if (hovered) setHover(null); return; }
    const w = innerWidth, h = innerHeight;
    for (const id of DEST_IDS) {
      _v.copy(BLD[id].label).project(camera);
      const el = labelEls[id];
      const off = _v.z > 1 || Math.abs(_v.x) > 1.05 || _v.y > 1.05 || _v.y < -1;
      el.classList.toggle('off-screen', off);
      if (!off) el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px) translate(-50%, calc(-100% - 12px))`;
    }
  }

  /* ── the loop ── */
  let last = performance.now();
  const perf = { n: 0, sum: 0, checked: false };
  const sorted = lanternLights.map(v => ({ v, d: 0 }));

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused && !paintOnce) return;
    paintOnce = false;
    if (!reduceMotion) U.time.value += dt;
    const t = U.time.value;

    S.shown = reduceMotion ? S.progress : S.shown + (S.progress - S.shown) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(S.shown - S.progress) < 1e-4) S.shown = S.progress;
    if (mode === 'scroll') applyScrollPose();

    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    mountains.position.set(camera.position.x * 0.9, 0, camera.position.z * 0.25);
    moon.position.copy(camera.position).addScaledVector(MOON_DIR, 1200);
    moon.quaternion.copy(camera.quaternion);
    snow.material.uniforms.uCam.value.copy(camera.position);

    // moonlight shadows follow the walker
    if (Q.shadows) {
      camera.getWorldDirection(_v);
      moonLight.target.position.copy(camera.position).addScaledVector(_v, 30);
      moonLight.position.copy(moonLight.target.position).addScaledVector(MOON_DIR, 140);
    }

    // the nearest lanterns borrow the real lights
    for (const s of sorted) s.d = s.v.distanceToSquared(camera.position);
    sorted.sort((a, b) => a.d - b.d);
    pool.forEach((l, i) => {
      const s = sorted[i];
      if (!s) return;
      l.position.copy(s.v);
      const flick = reduceMotion ? 1 : 0.9 + 0.07 * Math.sin(t * 7.3 + i * 1.7) + 0.04 * Math.sin(t * 12.7 + i);
      l.intensity = 9 * flick * (1 - smoothstep(18, 32, Math.sqrt(s.d)));
    });

    for (const s of wisps) {
      const u = s.userData;
      s.position.x = u.x + Math.sin(t * u.sp + u.ph) * 3;
    }
    for (const s of smoke) {
      const u = s.userData;
      const k = (u.t + t * 0.06) % 1;
      s.position.set(u.base.x + k * 2.2 + Math.sin(t * 0.7 + u.t * 6) * 0.3, u.base.y + k * 7, u.base.z);
      s.scale.setScalar(0.8 + k * 3.6);
      s.material.opacity = reduceMotion ? 0 : Math.sin(k * Math.PI) * 0.16;
    }
    const dVillage = Math.hypot(camera.position.x - VL.x, camera.position.z - VL.z);
    beacon.material.opacity = smoothstep(330, 160, dVillage) * (1 - smoothstep(110, 55, dVillage)) * 0.55;

    updateLabels();
    composer.render();

    // gentle self-tuning: if frames are slow, drop the expensive extras
    if (!perf.checked && root.classList.contains('world-ready')) {
      perf.n++; perf.sum += dt;
      if (perf.n === 150) {
        perf.checked = true;
        if (perf.sum / perf.n > 0.042 && (bloom.enabled || Q.shadows)) degrade();
      }
    }
  }

  function degrade() {
    bloom.enabled = false;
    if (Q.shadows) {
      Q.shadows = false;
      renderer.shadowMap.enabled = false;
      moonLight.castShadow = false;
      scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    }
    renderer.setPixelRatio(1);
    composer.setPixelRatio(1);
    resize();
  }

  S.shown = S.progress;
  resize();
  addEventListener('resize', resize);
  screen.orientation?.addEventListener?.('change', () => setTimeout(resize, 120));
  requestAnimationFrame(frame);

  /* ── public API ── */
  const api = {
    settle() {
      return new Promise(res => {
        const t0 = performance.now();
        const chk = () => (Math.abs(S.shown - S.progress) < 0.004 || performance.now() - t0 > 1600) ? res() : requestAnimationFrame(chk);
        chk();
      });
    },
    async flyIn(id) {
      const { approach, inside } = doorPoses(id);
      const from = { pos: camera.position.clone(), look: look.clone() };
      const dur = reduceMotion ? 0 : 2300;
      await flight(from, approach, inside, dur, Math.max(40, camera.fov - 8), t => setVeil(smoothstep(0.55, 1, t)));
      setVeil(1);
      mode = 'door';
    },
    async flyOut(id) {
      paused = false;
      const { approach, inside } = doorPoses(id);
      poseAt(1, _p, _l);
      const to = { pos: _p.clone(), look: _l.clone() };
      const fovTo = poseAt(1, _p, _l);
      S.shown = S.progress;
      const via = { pos: approach.pos.clone().lerp(to.pos, 0.25), look: approach.look.clone().lerp(to.look, 0.3) };
      const dur = reduceMotion ? 0 : 1900;
      if (dur === 0) {
        camera.position.copy(to.pos); look.copy(to.look); camera.lookAt(look);
        camera.fov = fovTo; camera.updateProjectionMatrix();
        for (let i = 0; i <= 8; i++) { setVeil(1 - i / 8); await wait(40); }
      } else {
        await flight({ pos: inside.pos, look: inside.look }, via, to, dur, fovTo, t => setVeil(1 - smoothstep(0, 0.45, t)));
      }
      setVeil(0);
      mode = 'scroll';
    },
    jumpToDoor(id) {
      const { inside } = doorPoses(id);
      mode = 'door';
      camera.position.copy(inside.pos); look.copy(inside.look); camera.lookAt(look);
      paintOnce = true;
    },
    pause(v) { paused = v; if (!v) { last = performance.now(); paintOnce = true; } },
    tier,
  };

  // if a room was opened before the world finished loading, stand in its doorway
  if (S.openId) { setVeil(1); api.jumpToDoor(S.openId); api.pause(true); }
  return api;
}

/* ──────────────────────────────────────────────────────────
   9. START-UP
   ────────────────────────────────────────────────────────── */
function showNotice(text) {
  const n = $('.loader');
  $('.loader-text', n).textContent = text;
  n.style.display = 'inline-flex';
  n.style.opacity = '1';
  setTimeout(() => { n.style.opacity = '0'; }, 7000);
}

function fallbackToSimple(reason) {
  console.warn('[forest] switching to the simple page:', reason);
  if (S.openId) { hidePanelNow(S.openId); S.openId = null; root.classList.remove('panel-open'); }
  root.classList.remove('world-mode', 'world-ready');
  setVeil(0);
  selectBook(currentBook);
  applyInert();
  showNotice('The 3D forest could not load here — showing the simple page.');
}

async function start() {
  selectBook('amber');
  readProgress();
  updateTrailUI();
  applyInert();

  const hash = location.hash.slice(1);
  if (isWorld() && DEST_IDS.includes(hash)) {
    await scrollToProgress(1, 0);
    S.shown = S.progress;
    setVeil(1);
    showPanel(hash);
  } else if (isWorld() && hash === 'contact') {
    await scrollToProgress(1, 0);
    showPanel('cabin');
    $('#contact')?.scrollIntoView();
  }

  if (!isWorld()) return;
  try {
    S.world = await loadWorld();
    S.shown = S.progress;
    await nextFrame();
    root.classList.add('world-ready');
    $('.loader-text').textContent = 'The forest is ready';
  } catch (err) {
    console.error(err);
    S.world = null;
    fallbackToSimple(err?.message || err);
  }
}

start();
