/* ============================================================
   RAFSAN ISDANI — A WINTER FOREST PORTFOLIO
   ============================================================
   The story: you arrive and see who I am → the map draws itself
   across the land → you walk the main road. At each turn a
   signpost points down a branch to a house; take the road, walk
   in, read, come back out and carry on. The books live deep in
   the forest, each in its own landscape.

   1. Basics
   2. The land (plain data — shared by the 3D world and the map)
   3. The road (scroll → progress, captions, junction cards, rail)
   4. Houses (rooms that open once you walk through the door)
   5. The map
   6. Menu, view switch, keyboard
   7. The 3D world (Three.js, loaded on demand)
   8. Start-up
   ============================================================ */

/* ──────────────────────────────────────────────────────────
   1. BASICS
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
const hasWebGL = () => root.classList.contains('has-webgl');

const S = {
  progress: 0,     // where the scroll says you are (0 → 1)
  shown: 0,        // damped value the camera follows
  openId: null,    // house you are inside
  busy: false,     // a walk or a door is in progress
  mapOpen: false,
  world: null,     // 3D API once built
  loading: null,   // promise while the world is being built
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ──────────────────────────────────────────────────────────
   2. THE LAND — metres; −z leads deeper into the forest
   ────────────────────────────────────────────────────────── */
const INTRO = 0.14;   // share of the scroll spent on the intro and the map
const EYE = 2.0;      // walking eye height

const MAIN_ROAD = [[0, 72], [2, 30], [-4, -20], [-9, -70], [-3, -120], [7, -170], [5, -220], [-5, -270],
                   [-4, -320], [5, -370], [3, -420], [-2, -470], [0, -530], [0, -578]];
const CROSSROADS = [0, -530];

/* every house: how its road leaves the main road, what it looks like on the way */
const DESTS = {
  about:      { panel: 'about',    name: 'About',    sign: 'ABOUT',    turn: 'First right',     side: 'right', jz: -88,
                desc: 'Who I am — background and education.', style: 'easy',
                path: [[14, -94], [32, -102], [48, -114]], house: [60, -124] },
  journey:    { panel: 'journey',  name: 'Journey',  sign: 'JOURNEY',  turn: 'On the left',     side: 'left',  jz: -176,
                desc: 'A hard, stony path that turns into a fine road — education, work and leadership.', style: 'stony',
                path: [[-18, -184], [-34, -192], [-46, -205], [-58, -215]], house: [-72, -226] },
  skills:     { panel: 'skills',   name: 'Skills',   sign: 'SKILLS',   turn: 'To the right',    side: 'right', jz: -262,
                desc: 'The workshop — automation, robotics, programming, design and AI.', style: 'planks',
                path: [[20, -268], [38, -277], [54, -287]], house: [68, -297] },
  projects:   { panel: 'projects', name: 'Projects', sign: 'PROJECTS', turn: 'Left, over the bridge', side: 'left', jz: -346,
                desc: 'Research and engineering projects.', style: 'bridge',
                path: [[-20, -352], [-38, -359], [-54, -369]], house: [-70, -381] },
  hobbies:    { panel: 'hobbies',  name: 'Hobbies',  sign: 'HOBBIES',  turn: 'To the right',    side: 'right', jz: -440,
                desc: 'Beyond engineering — cars, the outdoors, photography and more.', style: 'tracks',
                path: [[20, -446], [38, -453], [54, -463]], house: [68, -473] },
  amber:      { panel: 'books', book: 'amber', slug: 'amber-windows', name: 'Amber Windows', sign: 'AMBER WINDOWS',
                hint: 'the mountain village', style: 'mountain', from: 'cross',
                path: [[-28, -552], [-62, -570], [-100, -566], [-140, -588], [-168, -626], [-152, -660], [-188, -686], [-224, -702]], house: [-244, -713] },
  ocean:      { panel: 'books', book: 'ocean', slug: 'the-ocean-of-cold-roses', name: 'The Ocean of Cold Roses', sign: 'THE OCEAN OF COLD ROSES',
                hint: 'by the sea', style: 'coast', from: 'cross',
                path: [[32, -540], [72, -534], [115, -546], [160, -558], [205, -563], [240, -570]], house: [259, -576] },
  iridescent: { panel: 'books', book: 'iridescent', slug: 'iridescent-eyes', name: 'Iridescent Eyes', sign: 'IRIDESCENT EYES',
                hint: 'the canyons of Kharun', style: 'canyon', from: 'cross',
                path: [[-30, -520], [-72, -507], [-115, -493], [-160, -475], [-205, -461], [-238, -453]], house: [-258, -449] },
  alam:       { panel: 'books', book: 'alam', slug: 'alam-al-qarib', name: 'Alam al Qarib', sign: 'ALAM AL QARIB',
                hint: 'beyond the threshold', style: 'hollow', from: 'cross',
                path: [[20, -560], [44, -592], [58, -628], [80, -660], [98, -690]], house: [110, -708] },
  contact:    { panel: 'contact',  name: 'Contact',  sign: 'CONTACT',  turn: 'The end of the road', side: 'center', from: 'end',
                desc: "Get in touch — let's connect.", style: 'main',
                path: [], house: [0, -601] },
};
const BOOK_IDS = ['amber', 'ocean', 'iridescent', 'alam'];
const DEST_IDS = Object.keys(DESTS);

/* Uniform Catmull-Rom through control points */
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
  out.push(pts[pts.length - 1].slice());
  return out;
}
/* Points at an exact spacing along a polyline */
function resample(line, step = 1) {
  const out = [line[0].slice()];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i];
    const seg = Math.hypot(bx - ax, bz - az);
    let d = step - carry;
    while (d <= seg) { const t = d / seg; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); d += step; }
    carry = seg - (d - step);
  }
  const last = line[line.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last.slice());
  return out;
}

const MAIN_PTS = resample(catmull2D(MAIN_ROAD, 40), 1);   // index ≈ metres walked
const MAIN_LEN = MAIN_PTS.length - 1;
function nearestMain(x, z) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < MAIN_PTS.length; i++) {
    const d = (MAIN_PTS[i][0] - x) ** 2 + (MAIN_PTS[i][1] - z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  return bi;
}
function nearestMainZ(z) {
  let best = Infinity, bi = 0;
  MAIN_PTS.forEach((p, i) => { const d = Math.abs(p[1] - z); if (d < best) { best = d; bi = i; } });
  return bi;
}
const CROSS_S = nearestMain(...CROSSROADS);
const sToP = s => INTRO + (1 - INTRO) * (s / MAIN_LEN);
const pToS = p => clamp((p - INTRO) / (1 - INTRO), 0, 1) * MAIN_LEN;

for (const id of DEST_IDS) {
  const d = DESTS[id];
  d.id = id;
  d.s = d.from === 'cross' ? CROSS_S : d.from === 'end' ? MAIN_LEN : nearestMainZ(d.jz);
  d.junction = MAIN_PTS[d.s].slice();
  d.p = sToP(d.s);
  d.pts = resample(catmull2D([d.junction, ...d.path, ...(d.from === 'end' ? [[d.house[0], d.house[1] + 14]] : [])], 30), 1);
  d.len = d.pts.length - 1;
  const last = d.pts[d.pts.length - 1];
  d.rot = Math.atan2(last[0] - d.house[0], last[1] - d.house[1]);   // the door faces the arriving road
}

/* stops along the main road, in walking order */
const STOPS = [
  { key: 'home', name: 'Home', p: 0 },
  ...['about', 'journey', 'skills', 'projects', 'hobbies'].map(id => ({ key: id, name: DESTS[id].name, p: DESTS[id].p, s: DESTS[id].s })),
  { key: 'books', name: 'Books', p: sToP(CROSS_S), s: CROSS_S },
  { key: 'contact', name: 'Contact', p: 1, s: MAIN_LEN },
];

/* ──────────────────────────────────────────────────────────
   3. THE ROAD — native scrolling walks it
   ────────────────────────────────────────────────────────── */
const road = $('#home');
const fadeEls = $$('[data-in]', road);
const junctionsEl = $('#junctions');
const railEl = $('.rail');
const travelEl = $('.travel');
let scrollJob = null;

/* junction cards */
const cards = {};
for (const stop of STOPS.slice(1)) {
  const el = document.createElement('div');
  if (stop.key === 'books') {
    el.className = 'junction left books';
    el.innerHTML = `<p class="kicker">The crossroads · deep in the forest</p><h2>Books</h2>
      <p class="j-desc">Four novels by Rafsan Isdani — four roads, each to its own house.</p>
      <div class="book-roads">${BOOK_IDS.map(b => `<a href="#${DESTS[b].slug}" data-dest="${b}"><b>${DESTS[b].name}</b><span>${DESTS[b].hint}</span></a>`).join('')}</div>`;
  } else {
    const d = DESTS[stop.key];
    const arrow = d.side === 'left' ? '←' : d.side === 'right' ? '→' : '↑';
    el.className = `junction ${d.side === 'left' ? 'left' : d.side === 'right' ? 'right' : 'center'}`;
    el.innerHTML = `<p class="kicker"><span aria-hidden="true">${arrow}</span> ${d.turn}</p><h2>${d.name}</h2>
      <p class="j-desc">${d.desc}</p>
      <div class="j-actions"><a href="#${d.panel}" class="btn btn-gold btn-sm" data-dest="${stop.key}">${stop.key === 'contact' ? 'Knock on the door' : 'Take this road'} <span aria-hidden="true">${arrow}</span></a></div>`;
  }
  el.dataset.stop = stop.key;
  junctionsEl.appendChild(el);
  cards[stop.key] = el;
}

/* the rail */
railEl.innerHTML = STOPS.map(s => `<li><button type="button" data-p="${s.p.toFixed(4)}" data-stop="${s.key}"><span>${s.name}</span></button></li>`).join('');
const railBtns = $$('button', railEl);
railBtns.forEach(b => b.addEventListener('click', () => {
  const p = parseFloat(b.dataset.p);
  if (S.openId) closeRoom().then(() => glideTo(p)); else glideTo(p);
}));

function journeyRange() {
  return { top: road.offsetTop, len: Math.max(1, road.offsetHeight - innerHeight) };
}
function readProgress() {
  if (!isWorld()) { S.progress = 0; return; }
  const { top, len } = journeyRange();
  S.progress = clamp((scrollY - top) / len, 0, 1);
}

let activeStop = null;
function updateRoadUI() {
  const p = S.progress;
  for (const el of fadeEls) el.classList.toggle('on', p >= parseFloat(el.dataset.in) && p < parseFloat(el.dataset.out));
  const s = pToS(p);
  activeStop = null;
  if (p >= INTRO * 0.98 && !S.openId && !S.busy) {
    for (const stop of STOPS.slice(1)) {
      const before = stop.key === 'books' ? 46 : 34, after = stop.key === 'books' ? 14 : 9;
      if (s >= stop.s - before && s <= stop.s + after) activeStop = stop.key;
    }
  }
  for (const k in cards) {
    const on = k === activeStop;
    cards[k].classList.toggle('on', on);
    cards[k].inert = !on;
  }
  let here = 0;
  STOPS.forEach((st, i) => { if (p >= st.p - 0.008) here = i; });
  railBtns.forEach((b, i) => {
    b.classList.toggle('here', i === here);
    if (i === here) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
}

function scrollToProgress(p, duration) {
  if (scrollJob) scrollJob.cancelled = true;
  if (!isWorld()) return Promise.resolve(true);
  const { top, len } = journeyRange();
  const target = Math.round(top + p * len);
  const start = scrollY;
  const dist = Math.abs(target - start);
  if (duration == null) duration = reduceMotion ? 0 : clamp((dist / len) * 9000, 450, 2600);
  if (duration === 0 || dist < 2) {
    window.scrollTo({ top: target, behavior: 'instant' });
    readProgress(); updateRoadUI();
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
      if (t < 1) requestAnimationFrame(step); else { scrollJob = null; resolve(true); }
    };
    requestAnimationFrame(step);
  });
}
const cancelScrollJob = () => { if (scrollJob) scrollJob.cancelled = true; };
addEventListener('wheel', cancelScrollJob, { passive: true });
addEventListener('touchstart', cancelScrollJob, { passive: true });
addEventListener('scroll', () => { readProgress(); updateRoadUI(); }, { passive: true });

/* veil (the warm dark you pass through at doors) */
const veil = $('.veil');
let veilValue = 0, veilJob = 0;
function setVeil(v) { veilValue = v; veil.style.opacity = String(v); }
function fadeVeil(to, ms) {
  const job = ++veilJob, from = veilValue;
  if (ms <= 0 || reduceMotion) { setVeil(to); return Promise.resolve(); }
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      if (job !== veilJob) return res();
      const t = clamp((now - t0) / ms, 0, 1);
      setVeil(lerp(from, to, t));
      if (t < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

/* move along the main road: a short glide, or a quick fade for long distances */
async function glideTo(p) {
  if (!isWorld()) return;
  if (Math.abs(S.progress - p) > 0.16 && !reduceMotion) {
    await fadeVeil(1, 300);
    await scrollToProgress(p, 0);
    S.shown = S.progress;
    S.world?.snap();
    await fadeVeil(0, 450);
    return true;
  }
  return scrollToProgress(p);
}

/* ──────────────────────────────────────────────────────────
   4. HOUSES
   ────────────────────────────────────────────────────────── */
const panels = Object.fromEntries($$('[data-panel]').map(el => [el.dataset.panel, el]));

function setBook(key) {
  panels.books.dataset.book = key;
  $$('[data-book-detail]').forEach(a => { a.hidden = isWorld() && a.dataset.bookDetail !== key; });
  $$('.other-list a').forEach(a => { a.hidden = a.dataset.dest === key; });
}

function markCurrent(id) {
  const panel = id ? DESTS[id].panel : null;
  $$('.menu a').forEach(a => a.setAttribute('aria-current', String(!!panel && (a.dataset.dest === id || (panel === 'books' && a.dataset.go === 'books')))));
}

/* keep keyboard focus inside whatever is on top */
function applyInert() {
  const top = S.mapOpen ? $('#map') : (S.openId ? panels[DESTS[S.openId].panel] : null);
  [$('.topbar'), road, $('.footer'), $('.skip-link')].forEach(el => el && (el.inert = !!top));
  Object.values(panels).forEach(p => {
    p.inert = isWorld() ? (S.mapOpen || !S.openId || p !== panels[DESTS[S.openId].panel]) : S.mapOpen;
  });
}

function showTravel(text) {
  if (text) { $('.travel-text').textContent = text; travelEl.hidden = false; }
  else travelEl.hidden = true;
}

async function goTo(id) {
  const d = DESTS[id];
  if (!d) return;
  if (!isWorld()) {
    const el = d.book ? $('#' + d.slug) : panels[d.panel];
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#' + (d.slug || d.panel));
    return;
  }
  if (S.busy || S.openId === id) return;
  closeMenu();
  S.busy = true;
  updateRoadUI();
  try {
    const fromRoom = S.openId;
    if (fromRoom) {                       // straight from one house to another
      await fadeVeil(1, 250);
      hidePanel(fromRoom);
      S.world?.pause(false);
    }
    if (Math.abs(S.progress - d.p) > 0.002) {
      if (fromRoom || Math.abs(S.progress - d.p) > 0.16 || reduceMotion) {
        if (!fromRoom) await fadeVeil(1, 300);
        await scrollToProgress(d.p, 0);
        S.shown = S.progress;
        S.world?.snap();
      } else {
        const arrived = await scrollToProgress(d.p);
        if (!arrived) return;            // the visitor took over the scroll
        await S.world?.settle();
      }
    }
    if (S.world) {
      showTravel(`On the road to ${d.name}…`);
      await S.world.travelIn(id);
      showTravel(null);
    } else {
      await fadeVeil(1, 250);
    }
    showPanel(id);
  } finally {
    S.busy = false;
    showTravel(null);
    updateRoadUI();
  }
}

function showPanel(id) {
  const d = DESTS[id];
  const el = panels[d.panel];
  S.openId = id;
  if (d.book) setBook(d.book);
  el.classList.add('is-open');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  root.classList.add('panel-open');
  $('.dest-scroll', el).scrollTop = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-shown')));
  applyInert();
  $('h2', el).focus({ preventScroll: true });
  history.replaceState(null, '', '#' + (d.slug || d.panel));
  markCurrent(id);
  S.world?.pause(true);
  updateRoadUI();
}

function hidePanel(id) {
  const el = panels[DESTS[id].panel];
  el.classList.remove('is-open', 'is-shown');
  el.removeAttribute('role');
  el.removeAttribute('aria-modal');
  root.classList.remove('panel-open');
  S.openId = null;
  applyInert();
  markCurrent(null);
}

async function closeRoom(opts = {}) {
  const id = S.openId;
  if (!id || S.busy) return;
  S.busy = true;
  try {
    panels[DESTS[id].panel].classList.remove('is-shown');
    await wait(reduceMotion ? 0 : 380);
    hidePanel(id);
    history.replaceState(null, '', location.pathname + location.search);
    S.world?.pause(false);
    if (S.world) await S.world.travelOut(id);
    else await fadeVeil(0, 300);
  } finally {
    S.busy = false;
    updateRoadUI();
  }
  const stopKey = DESTS[id].book ? 'books' : id;
  const btn = cards[stopKey]?.querySelector(DESTS[id].book ? `[data-dest="${id}"]` : '[data-dest]');
  (btn || $(`.menu a[href="#${DESTS[id].panel}"]`))?.focus({ preventScroll: true });
  if (opts.continueRoad) {
    const next = STOPS.find(s => s.p > DESTS[id].p + 0.001);
    await scrollToProgress(Math.min(1, DESTS[id].p + 0.024));
    if (next) railBtns[STOPS.indexOf(next)]?.focus({ preventScroll: true });
  }
}

async function goToStop(key) {
  const stop = STOPS.find(s => s.key === key);
  if (!isWorld()) {
    const el = key === 'home' ? $('#home') : panels[key === 'books' ? 'books' : key];
    el?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    return;
  }
  closeMenu();
  if (S.openId) await closeRoom();
  await glideTo(stop.p);
}

document.addEventListener('click', e => {
  const t = e.target;
  const destLink = t.closest('a[data-dest], button[data-dest]');
  if (destLink) {
    if (!isWorld()) { closeMenu(); return; }   // the simple page scrolls natively
    e.preventDefault();
    goTo(destLink.dataset.dest);
    return;
  }
  const go = t.closest('[data-go]');
  if (go) {
    if (!isWorld()) { closeMenu(); return; }
    e.preventDefault();
    goToStop(go.dataset.go);
    return;
  }
  if (t.closest('[data-begin]')) { glideTo(INTRO + 0.004); return; }
  if (t.closest('[data-skip]')) { S.world?.skip(); return; }
  if (t.closest('[data-close]')) { closeRoom({ continueRoad: !!t.closest('.next-road') }); return; }
  if (t.closest('[data-open-map]')) { openMap(t.closest('[data-open-map]')); return; }
  if (t.closest('[data-close-map]')) { closeMap(); return; }
});

/* ──────────────────────────────────────────────────────────
   5. THE MAP — drawn from the same land as the 3D world
   ────────────────────────────────────────────────────────── */
const mapEl = $('#map');
let mapDrawn = false, mapReturnFocus = null;
const toMap = (x, z) => [400 + (x - 15) * 0.84, 722 - (80 - z) * 0.84];

function drawMap() {
  const svg = $('#mapArt');
  const rnd = mulberry32(11);
  const path = pts => 'M' + pts.filter((_, i) => i % 3 === 0 || i === pts.length - 1).map(([x, z]) => toMap(x, z).map(n => n.toFixed(1)).join(' ')).join(' L');
  const allRoads = [MAIN_PTS, ...DEST_IDS.map(id => DESTS[id].pts)];
  const nearRoad = (u, v) => allRoads.some(r => r.some(([x, z], i) => i % 4 === 0 && (toMap(x, z)[0] - u) ** 2 + (toMap(x, z)[1] - v) ** 2 < 16 ** 2));
  const [cu, cv] = toMap(-205, -470);                     // the canyon
  const [lu, lv] = toMap(110, -700);                       // the hollow
  const [au, av] = toMap(-250, -730);                      // the mountain village

  let trees = '';
  for (let i = 0; i < 520; i++) {
    const u = 30 + rnd() * 740, v = 40 + rnd() * 690;
    if (u > 640) continue;                                 // the sea
    if (nearRoad(u, v)) continue;
    if (((u - cu) / 95) ** 2 + ((v - cv) / 40) ** 2 < 1) continue;
    if (((u - au) / 70) ** 2 + ((v - av) / 55) ** 2 < 1) continue;
    const s = 4.5 + rnd() * 4.5, w = s * 0.6;
    trees += `<path d="M${u.toFixed(1)} ${(v - s).toFixed(1)} L${(u - w).toFixed(1)} ${(v + s * 0.5).toFixed(1)} L${(u + w).toFixed(1)} ${(v + s * 0.5).toFixed(1)} Z"/>`;
  }
  let peaks = '';
  for (let i = 0; i < 9; i++) {
    const u = 40 + i * 26 + rnd() * 10, v = 60 + rnd() * 70 + (i % 2) * 20, h = 22 + rnd() * 26;
    peaks += `<path d="M${u - h * 0.8} ${v + h * 0.5} L${u} ${v - h * 0.5} L${u + h * 0.8} ${v + h * 0.5}"/><path d="M${u - h * 0.25} ${v - h * 0.15} L${u} ${v - h * 0.5} L${u + h * 0.22} ${v - h * 0.2}" stroke-opacity=".9"/>`;
  }
  let waves = '';
  for (let i = 0; i < 26; i++) {
    const u = 660 + rnd() * 120, v = 60 + rnd() * 660;
    waves += `<path d="M${u} ${v} q5 -4 10 0 t10 0"/>`;
  }
  let canyon = '';
  for (let i = 0; i < 14; i++) {
    const t = i / 13, [u, v] = toMap(lerp(-120, -285, t), lerp(-494, -442, t));
    canyon += `<path d="M${u} ${v - 14} l4 -8 M${u} ${v + 14} l4 8"/>`;
  }
  let stones = '';
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; stones += `<rect x="${(lu + Math.cos(a) * 16 - 1.5).toFixed(1)}" y="${(lv + Math.sin(a) * 12 - 3).toFixed(1)}" width="3" height="6"/>`; }
  const stream = [toMap(-28, -290), toMap(-48, -425)];
  let houses = '';
  for (const id of DEST_IDS) {
    const [u, v] = toMap(...DESTS[id].house);
    houses += `<path d="M${(u - 8).toFixed(1)} ${(v + 7).toFixed(1)} v-8 l8 -7 l8 7 v8 z"/>`;
  }
  const [lhU, lhV] = toMap(440, -650);

  svg.innerHTML = `
    <rect x="8" y="8" width="784" height="744" fill="none" stroke="#c9a86a" stroke-opacity=".45" stroke-width="1.5"/>
    <rect x="15" y="15" width="770" height="730" fill="none" stroke="#c9a86a" stroke-opacity=".2"/>
    <path d="M${toMap(282, 120)[0]} 15 C ${toMap(270, -200)[0]} 220, ${toMap(300, -420)[0]} 420, ${toMap(285, -700)[0]} 745" fill="none" stroke="#9fb3cf" stroke-opacity=".5" stroke-width="1.2"/>
    <g fill="none" stroke="#9fb3cf" stroke-opacity=".35">${waves}</g>
    <g fill="none" stroke="#c9a86a" stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round">${peaks}</g>
    <g fill="none" stroke="#c9a86a" stroke-opacity=".34" stroke-width="1" stroke-linejoin="round">${trees}</g>
    <g stroke="#b9774f" stroke-opacity=".6" stroke-width="1.2">${canyon}</g>
    <path d="M${stream[0][0]} ${stream[0][1]} Q ${stream[0][0] - 12} ${(stream[0][1] + stream[1][1]) / 2} ${stream[1][0]} ${stream[1][1]}" fill="none" stroke="#9fb3cf" stroke-opacity=".55" stroke-width="1.4"/>
    <g fill="#b9a6ff" fill-opacity=".55">${stones}</g>
    <g transform="translate(${lhU} ${lhV})" fill="none" stroke="#e0c58e" stroke-width="1.2"><path d="M-3 8 L-2 -8 H2 L3 8 Z"/><path d="M0 -8 L-26 -16 M0 -8 L-26 0" stroke-opacity=".4"/></g>
    <path d="${path(MAIN_PTS)}" fill="none" stroke="#0d0c09" stroke-width="7" stroke-linecap="round" opacity=".6"/>
    <path d="${path(MAIN_PTS)}" fill="none" stroke="#d9bb7f" stroke-width="2.2" stroke-dasharray="8 5" stroke-linecap="round"/>
    ${DEST_IDS.filter(id => DESTS[id].pts.length > 2).map(id => `<path d="${path(DESTS[id].pts)}" fill="none" stroke="${DESTS[id].book ? '#e0b77a' : '#c9a86a'}" stroke-width="${DESTS[id].book ? 1.6 : 1.5}" stroke-dasharray="${DESTS[id].style === 'stony' ? '1.5 4' : DESTS[id].book ? '4 4' : '3 4'}" stroke-linecap="round"/>`).join('')}
    <g fill="#16140f" stroke="#e0c58e" stroke-width="1.3">${houses}</g>
    <circle cx="${toMap(...CROSSROADS)[0]}" cy="${toMap(...CROSSROADS)[1]}" r="9" fill="none" stroke="#e0c58e" stroke-opacity=".6"/>
    <g transform="translate(730 690)" fill="none" stroke="#c9a86a" stroke-opacity=".6">
      <circle r="20"/><path d="M0 -28 L5 0 L0 28 L-5 0 Z" fill="#c9a86a" fill-opacity=".25"/><path d="M-28 0 H28"/>
      <text y="-33" text-anchor="middle" fill="#c9a86a" stroke="none" font-family="Cormorant Garamond, serif" font-size="14">N</text>
    </g>`;

  const pct = ([u, v]) => `left:${(u / 8).toFixed(2)}%;top:${(v / 7.6).toFixed(2)}%`;
  const side = { about: 'right', journey: 'left', skills: 'right', projects: 'left', hobbies: 'right', amber: 'right', ocean: 'left', iridescent: 'right', alam: 'right', contact: 'left' };
  let html = '';
  for (const id of DEST_IDS) {
    const d = DESTS[id];
    html += `<button type="button" class="map-marker ${side[id]}${d.book ? ' book' : ''}" style="${pct(toMap(...d.house))}" data-map-dest="${id}"><span class="mm-dot" aria-hidden="true"></span><span>${d.name}</span></button>`;
  }
  html += `<button type="button" class="map-marker minor right" style="${pct(toMap(...MAIN_PTS[6]))}" data-map-stop="home"><span class="mm-dot" aria-hidden="true"></span><span>Trailhead</span></button>`;
  html += `<button type="button" class="map-marker minor left" style="${pct(toMap(...CROSSROADS))}" data-map-stop="books"><span class="mm-dot" aria-hidden="true"></span><span>The crossroads</span></button>`;
  html += `<span class="map-marker minor you right" id="mapYou" hidden><span class="mm-dot" aria-hidden="true"></span><span>You are here</span></span>`;
  $('#mapMarkers').innerHTML = html;

  $('#mapMarkers').addEventListener('click', e => {
    const m = e.target.closest('.map-marker');
    if (!m) return;
    closeMap(false);
    if (m.dataset.mapDest) goTo(m.dataset.mapDest);
    else if (m.dataset.mapStop) {
      if (!isWorld()) { (m.dataset.mapStop === 'books' ? panels.books : $('#home')).scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
      goToStop(m.dataset.mapStop === 'home' ? 'home' : 'books').then(() => { if (m.dataset.mapStop === 'home') glideTo(INTRO + 0.004); });
    }
  });
  mapDrawn = true;
}

function updateYouAreHere() {
  const you = $('#mapYou');
  if (!you) return;
  let pos = null;
  if (isWorld()) {
    if (S.openId) pos = DESTS[S.openId].house;
    else if (S.progress >= INTRO * 0.9) pos = MAIN_PTS[Math.round(pToS(S.progress))];
  }
  if (!pos) { you.hidden = true; return; }
  const [u, v] = toMap(pos[0], pos[1]);
  you.style.left = (u / 8) + '%';
  you.style.top = (v / 7.6 + 2.2) + '%';
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
   6. MENU, VIEW SWITCH, KEYBOARD
   ────────────────────────────────────────────────────────── */
const menu = $('#menu');
const menuToggle = $('.menu-toggle');
function closeMenu() { menu.classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false'); }
menuToggle.addEventListener('click', () => {
  const open = !menu.classList.contains('open');
  menu.classList.toggle('open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
});

/* Switching views is instant: no reload, the forest just pauses or wakes up */
function setView(view) {
  if (view === 'world' && !hasWebGL()) return;
  if ((view === 'world') === isWorld()) return;
  store.set('ri-view', view);
  if (/[?&]simple\b/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  cancelScrollJob();
  closeMap(false);
  closeMenu();

  if (view === 'simple') {
    const open = S.openId;
    if (open) hidePanel(open);
    S.busy = false;
    showTravel(null);
    setVeil(0);
    S.world?.pause(true);
    root.classList.remove('world-mode');
    setBook(panels.books.dataset.book || 'amber');
    applyInert();
    const target = open ? (DESTS[open].book ? $('#' + DESTS[open].slug) : panels[DESTS[open].panel]) : null;
    if (target) target.scrollIntoView({ behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
  } else {
    root.classList.add('world-mode');
    setBook(panels.books.dataset.book || 'amber');
    applyInert();
    window.scrollTo({ top: 0, behavior: 'instant' });
    readProgress();
    S.shown = S.progress;
    updateRoadUI();
    if (S.world) { S.world.snap(); S.world.pause(false); }
    else startWorld();
  }
  $('#viewToggle').focus({ preventScroll: true });
}
$('#viewToggle').addEventListener('click', () => setView(isWorld() ? 'simple' : 'world'));

function trapFocus(e, container) {
  const items = $$('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])', container).filter(el => !el.hidden && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (S.mapOpen) { closeMap(); return; }
    if (menu.classList.contains('open')) { closeMenu(); menuToggle.focus(); return; }
    if (S.world?.flying()) { S.world.skip(); return; }
    if (S.openId) { closeRoom(); return; }
  }
  if (e.key === 'Tab') {
    if (S.mapOpen) trapFocus(e, mapEl);
    else if (S.openId && isWorld()) trapFocus(e, panels[DESTS[S.openId].panel]);
    return;
  }
  const typing = /input|textarea|select/i.test(e.target.tagName);
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'm' || e.key === 'M')) {
    if (S.mapOpen) closeMap(); else openMap();
  }
  if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Home', 'End'].includes(e.key)) cancelScrollJob();
});

/* ──────────────────────────────────────────────────────────
   7. THE 3D WORLD
   ────────────────────────────────────────────────────────── */
async function loadWorld() {
  const THREE = await import('three');
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { mergeGeometries }] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'),
    import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]);
  if (document.fonts?.load) await Promise.race([document.fonts.load('600 64px "Cormorant Garamond"'), wait(1500)]).catch(() => {});
  return createWorld(THREE, { EffectComposer, RenderPass, UnrealBloomPass, OutputPass, mergeGeometries });
}

function detectTier() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const small = Math.min(innerWidth, innerHeight) < 600;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  return small || weak ? 'low' : 'high';
}

async function createWorld(THREE, X) {
  const tier = detectTier();
  const HIGH = tier === 'high';
  const Q = HIGH
    ? { near: 4200, far: 5200, grid: 3, snow: 6500, lights: 4, doorLights: true, bloom: true, shadows: true, dpr: Math.min(devicePixelRatio || 1, 1.75), msaa: 4 }
    : { near: 1800, far: 2200, grid: 6, snow: 2400, lights: 2, doorLights: false, bloom: false, shadows: false, dpr: Math.min(devicePixelRatio || 1, 1.4), msaa: 0 };

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
  const UP = V(0, 1, 0);
  const FOG = C('#0c1a31');
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG, 0.0048);
  scene.background = FOG;
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.2, 7000);
  const U = { time: { value: 0 } };
  const MOON_DIR = V(-0.42, 0.33, -1).normalize();
  const rng = mulberry32(2026);

  /* ── noise ── */
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
  function ridged(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f))); f *= 2.1; a *= 0.5; } return s; }
  function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
  }
  const gauss = (x, z, cx, cz, s) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * s * s));

  /* ══════════════════════════════════════════════════════
     THE SHAPE OF THE LAND
     forest valley · a mountain massif to the north-west (the
     Romanian village sits on its shoulder) · the sea to the east ·
     red canyons to the west · a sunken hollow to the north-east
     ══════════════════════════════════════════════════════ */
  const AMBER_PLATEAU = 92;
  const STREAM = [-28, -290, -48, -425];
  const CANYON = [-120, -494, -290, -440];
  const HOLLOW = [98, -688];
  const LIGHTHOUSE = [440, -650];
  const shoreX = z => 282 + fbm(z * 0.015, 7.7, 3) * 14;

  function baseH(x, z) {
    let h = 7 + fbm(x * 0.010 + 3.1, z * 0.010 - 1.7, 4) * 8 + fbm(x * 0.045, z * 0.045, 2) * 1.0;
    const g = gauss(x, z, -430, -890, 205);
    h += g * 230 + g * ridged(x * 0.011, z * 0.011) * 48;
    h = lerp(h, AMBER_PLATEAU + fbm(x * 0.05, z * 0.05, 2) * 0.8, 1 - smoothstep(32, 58, Math.hypot(x + 240, z + 714)));
    const sq = v => v * v;
    h += sq(Math.max(0, -x - 330) / 130) * 140 + sq(Math.max(0, -z - 790) / 110) * 150 + sq(Math.max(0, z - 160) / 170) * 55;
    h -= 10 * gauss(x, z, HOLLOW[0], HOLLOW[1], 55);
    h -= 2.6 * (1 - smoothstep(1.5, 6.5, segDist(x, z, ...STREAM)));
    if (x > 190) {
      const sx = shoreX(z);
      h = lerp(h, 2.2 + fbm(x * 0.05, z * 0.05, 2) * 0.6, smoothstep(190, sx - 10, x));
      if (x > sx - 10) h = lerp(h, -12, smoothstep(sx - 10, sx + 34, x));
    }
    return h;
  }
  const canyonMask = (x, z) => (x > -80 ? 0 : 1 - smoothstep(34, 60, segDist(x, z, ...CANYON)));
  const canyonRaise = (x, z) => { const m = canyonMask(x, z); return m ? m * (48 + fbm(x * 0.03, z * 0.03, 3) * 9) : 0; };

  /* ── roads: the main road and every branch, with their heights ── */
  const HW = { main: 3.0, easy: 3.2, stony: 2.5, planks: 2.6, bridge: 2.6, tracks: 2.8, mountain: 2.4, coast: 2.6, canyon: 2.8, hollow: 2.2 };
  function smoothArr(arr, k) {
    return arr.map((_, i) => { let s = 0, n = 0; for (let j = -k; j <= k; j++) { const q = clamp(i + j, 0, arr.length - 1); s += arr[q]; n++; } return s / n; });
  }
  const ROADS = [{ id: 'main', style: 'main', pts: MAIN_PTS }];
  for (const id of DEST_IDS) ROADS.push({ id, style: DESTS[id].style, pts: DESTS[id].pts, dest: DESTS[id] });
  for (const r of ROADS) r.hw = HW[r.style];
  ROADS[0].h = smoothArr(smoothArr(MAIN_PTS.map(([x, z]) => baseH(x, z)), 16), 10);
  for (const r of ROADS.slice(1)) {
    const j = ROADS[0].h[r.dest.s];
    let h = smoothArr(smoothArr(r.pts.map(([x, z]) => baseH(x, z)), 12), 8);
    h = h.map((v, i) => lerp(j, v, smoothstep(0, 14, i)));
    if (r.style === 'stony') h = h.map((v, i) => v + (i > 8 && i < r.pts.length * 0.62 ? vnoise(i * 0.45, 3.3) * 0.45 : 0));
    r.h = h;
  }
  const ROAD_INDEX = Object.fromEntries(ROADS.map((r, i) => [r.id, i]));
  const roadAt = (r, i) => { const a = Math.floor(clamp(i, 0, r.pts.length - 1)), b = Math.min(r.pts.length - 1, a + 1), t = clamp(i, 0, r.pts.length - 1) - a; return [lerp(r.pts[a][0], r.pts[b][0], t), lerp(r.h[a], r.h[b], t), lerp(r.pts[a][1], r.pts[b][1], t)]; };
  const roadDir = (r, i) => { const a = roadAt(r, Math.max(0, i - 2)), b = roadAt(r, Math.min(r.pts.length - 1, i + 2)); const l = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / l, (b[2] - a[2]) / l]; };

  /* where the Projects road crosses the frozen stream (the bridge goes here) */
  const projRoad = ROADS[ROAD_INDEX.projects];
  let crossI = 0, crossD = Infinity;
  projRoad.pts.forEach(([x, z], i) => { const d = segDist(x, z, ...STREAM); if (d < crossD) { crossD = d; crossI = i; } });
  const BRIDGE = { i: crossI, x: projRoad.pts[crossI][0], z: projRoad.pts[crossI][1] };

  /* distance field: nearest road, its height and type, on a 2 m grid */
  const X0 = -500, X1 = 380, Z0 = 330, Z1 = -880, CELL = 2;
  const NX = Math.ceil((X1 - X0) / CELL) + 1, NZ = Math.ceil((Z0 - Z1) / CELL) + 1;
  const FD = new Float32Array(NX * NZ).fill(1e6), FH = new Float32Array(NX * NZ), FR = new Uint8Array(NX * NZ);
  const RAD = 18, RC = Math.ceil(RAD / CELL);
  ROADS.forEach((r, ri) => {
    r.pts.forEach(([x, z], i) => {
      const cx = Math.round((x - X0) / CELL), cz = Math.round((Z0 - z) / CELL), h = r.h[i];
      for (let a = -RC; a <= RC; a++) for (let b = -RC; b <= RC; b++) {
        const gx = cx + a, gz = cz + b;
        if (gx < 0 || gz < 0 || gx >= NX || gz >= NZ) continue;
        const px = X0 + gx * CELL, pz = Z0 - gz * CELL;
        const d = Math.hypot(px - x, pz - z);
        const k = gz * NX + gx;
        if (d < FD[k]) { FD[k] = d; FH[k] = h; FR[k] = ri; }
      }
    });
  });
  function field(x, z) {
    const fx = clamp((x - X0) / CELL, 0, NX - 1.001), fz = clamp((Z0 - z) / CELL, 0, NZ - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const k00 = iz * NX + ix, k10 = k00 + 1, k01 = k00 + NX, k11 = k01 + 1;
    const d = lerp(lerp(FD[k00], FD[k10], tx), lerp(FD[k01], FD[k11], tx), tz);
    const h = lerp(lerp(FH[k00], FH[k10], tx), lerp(FH[k01], FH[k11], tx), tz);
    const near = [[FD[k00], k00], [FD[k10], k10], [FD[k01], k01], [FD[k11], k11]].sort((p, q) => p[0] - q[0])[0][1];
    return { d, h, r: FR[near] };
  }

  /* flat pads for the houses */
  const PAD_R = { amber: 30, iridescent: 17, alam: 21, ocean: 16, contact: 14 };
  const PADS = DEST_IDS.map(id => {
    const r = ROADS[ROAD_INDEX[id]];
    return { id, x: DESTS[id].house[0], z: DESTS[id].house[1], r: PAD_R[id] || 15, h: r.h[r.h.length - 1] };
  });

  function terrainH(x, z) {
    let h = baseH(x, z) + canyonRaise(x, z);
    const f = field(x, z);
    if (f.d < 26) {
      const r = ROADS[f.r];
      const edge = r.style === 'canyon' ? 3.2 : r.style === 'mountain' ? 5 : 8;
      let w = 1 - smoothstep(r.hw + 0.6, r.hw + 0.6 + edge, f.d);
      if (r.id === 'projects') w *= smoothstep(4.5, 8, Math.hypot(x - BRIDGE.x, z - BRIDGE.z));
      h = lerp(h, f.h - 0.08, w);
    }
    for (const p of PADS) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 12) h = lerp(h, p.h, 1 - smoothstep(p.r, p.r + 12, d));
    }
    return h;
  }

  const world = new THREE.Group();
  scene.add(world);

  /* ══════════ TERRAIN ══════════ */
  const terrainMesh = await (async () => {
    const W = X1 - X0, D = Z0 - Z1;
    const g = new THREE.PlaneGeometry(W, D, Math.round(W / Q.grid), Math.round(D / Q.grid));
    g.rotateX(-Math.PI / 2);
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, terrainH(pos.getX(i), pos.getZ(i)));
      if (i % 15000 === 0) await nextFrame();
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    const P = {
      snowA: C('#d6e0ee'), snowB: C('#b8c5da'), rock: C('#4b5160'), rockDark: C('#363b47'),
      sand: C('#3b3a3e'), wet: C('#1a2430'), canyonFloor: C('#8a5a44'),
      strata: [C('#e0552a'), C('#f07a38'), C('#b8401c'), C('#f5a55e'), C('#cc5a2a')],
      road: { main: C('#7f8798'), easy: C('#a49a8e'), stony: C('#686c76'), planks: C('#7f8798'), bridge: C('#7f8798'), tracks: C('#878c99'),
              mountain: C('#737985'), coast: C('#8d8a86'), canyon: C('#8a5a44'), hollow: C('#5d5868') },
      pad: C('#9a9188'),
    };
    const t = new THREE.Color(), t2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm.getY(i);
      t.copy(P.snowA).lerp(P.snowB, clamp(0.5 + fbm(x * 0.04, z * 0.04, 3), 0, 1) * 0.6);
      // bare rock where it is too steep for snow
      const steep = smoothstep(0.84, 0.6, ny);
      t2.copy(P.rock).lerp(P.rockDark, clamp(0.5 + fbm(x * 0.08, z * 0.08, 2), 0, 1));
      t.lerp(t2, steep * 0.9);
      // red rock strata in the canyon
      const cm = canyonMask(x, z);
      if (cm > 0.05) {
        const band = Math.floor((y * 0.42 + fbm(x * 0.05, z * 0.05, 2) * 2.2 + 20) % 5);
        t2.copy(P.strata[(band + 5) % 5]);
        t.lerp(t2, cm * (0.35 + 0.65 * smoothstep(0.95, 0.65, ny)));
      }
      // beach and sea floor
      if (x > 200) {
        const sx = shoreX(z);
        t.lerp(P.sand, smoothstep(sx - 26, sx - 8, x) * 0.7);
        if (y < 0.3) t.lerp(P.wet, 0.9);
      }
      // roads
      const f = field(x, z);
      if (f.d < 9) {
        const r = ROADS[f.r];
        let w = 1 - smoothstep(r.hw - 0.6, r.hw + 1.4, f.d + fbm(x * 0.5, z * 0.5, 2) * 0.7);
        t2.copy(P.road[r.style]);
        if (r.style === 'canyon') t2.lerp(P.snowB, 0.35);
        t.lerp(t2, w * 0.62);
      }
      for (const p of PADS) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) t.lerp(P.pad, (1 - smoothstep(p.r * 0.35, p.r, d + fbm(x * 0.4, z * 0.4, 2) * 2)) * 0.32);
      }
      col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
      if (i % 20000 === 0) await nextFrame();
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }));
    m.receiveShadow = true;
    world.add(m);
    return m;
  })();

  /* ══════════ SKY, STARS, MOON, MOUNTAIN RINGS, SEA ══════════ */
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uZenith: { value: C('#02050c') }, uHorizon: { value: FOG.clone() }, uMoon: { value: MOON_DIR } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uMoon; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = mix(uHorizon, uZenith, smoothstep(-0.02, 0.6, h));
          float m = max(dot(normalize(vDir), uMoon), 0.0);
          c += vec3(0.05, 0.065, 0.11) * pow(m, 6.0) + vec3(0.12, 0.14, 0.2) * pow(m, 60.0);
          gl_FragColor = vec4(c, 1.0); }`,
    }));
  sky.renderOrder = -10;
  scene.add(sky);

  const stars = (() => {
    const n = HIGH ? 3000 : 1500;
    const p = new Float32Array(n * 3), s = new Float32Array(n), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = 0.03 + Math.pow(rng(), 0.7) * 0.97, a = rng() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      p.set([Math.cos(a) * r * 2800, y * 2800, Math.sin(a) * r * 2800], i * 3);
      s[i] = 0.6 + Math.pow(rng(), 6) * 2.4; ph[i] = rng() * 6.28;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(s, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.time, uDpr: { value: Q.dpr } },
      vertexShader: `attribute float aSize; attribute float aPhase; uniform float uTime; uniform float uDpr; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          vA = (0.75 + 0.25 * sin(uTime * (0.6 + aPhase * 0.2) + aPhase * 7.0)) * smoothstep(0.02, 0.2, normalize(position).y);
          gl_PointSize = aSize * uDpr * 1.6; }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.75,0.82,1.0) * smoothstep(0.5, 0.0, r) * vA * 0.9, 1.0); }`,
    }));
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
    for (let i = 0; i < 16; i++) { x.fillStyle = `rgba(150,158,176,${0.08 + mr() * 0.12})`; x.beginPath(); x.arc(60 + mr() * 140, 50 + mr() * 150, 8 + mr() * 26, 0, Math.PI * 2); x.fill(); }
    x.restore();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    disc.material.color.setRGB(2.4, 2.4, 2.5);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: C('#7d93c6'), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
    disc.scale.setScalar(120); halo.scale.setScalar(860);
    disc.renderOrder = -7; halo.renderOrder = -8;
    g.add(halo, disc);
    scene.add(g);
    return g;
  })();

  /* rings of far mountains all around the land */
  function ridgeMesh(width, base, amp, freq, seed, cBase, cTop, cPeak, snowLine) {
    const pts = [];
    for (let x = -width / 2; x <= width / 2; x += 18) {
      const n = fbm(x * freq + seed, seed * 0.37, 5);
      const peak = Math.pow(Math.abs(vnoise(x * freq * 0.45 + seed * 2, 1.3)), 1.4);
      pts.push([x, base + amp * (0.45 + n * 0.55 + peak * 0.6)]);
    }
    const pos = [], col = [], idx = [];
    const top = Math.max(...pts.map(p => p[1]));
    const cb = C(cBase), ct = C(cTop), cp = C(cPeak), tmp = new THREE.Color();
    pts.forEach(([x, y], i) => {
      const snowy = smoothstep(snowLine, 1, y / top);
      pos.push(x, -160, 0, x, y - 30 - snowy * 40, 0, x, y, 0);
      col.push(cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
      tmp.copy(ct).lerp(cp, snowy);
      col.push(tmp.r, tmp.g, tmp.b);
      if (i) { const a = (i - 1) * 3, c = i * 3; idx.push(a, c, a + 1, a + 1, c, c + 1, a + 1, c + 1, a + 2, a + 2, c + 1, c + 2); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -6;
    return m;
  }
  const mountains = new THREE.Group();
  {
    const CX = -60, CZ = -330;
    const rings = [
      { R: 2500, n: 9, base: 120, amp: 520, freq: 0.0019, cols: ['#0f1d35', '#25385c', '#8597bc'], snow: 0.55 },
      { R: 1750, n: 9, base: 40, amp: 330, freq: 0.0031, cols: ['#0b1628', '#1a2945', '#5a6d93'], snow: 0.62 },
    ];
    rings.forEach((ring, ri) => {
      for (let k = 0; k < ring.n; k++) {
        const phi = (k / ring.n) * Math.PI * 2 + ri * 0.3;
        const width = (2 * Math.PI * ring.R / ring.n) * 1.3;
        const m = ridgeMesh(width, ring.base, ring.amp, ring.freq, 3.1 + k * 5.7 + ri * 31, ...ring.cols, ring.snow);
        m.position.set(CX - ring.R * Math.sin(phi), 0, CZ - ring.R * Math.cos(phi));
        m.rotation.y = phi;
        mountains.add(m);
      }
    });
  }
  scene.add(mountains);

  /* the sea — still, dark water that catches the moon */
  const seaMat = new THREE.MeshStandardMaterial({ color: C('#13294a'), emissive: C('#071426'), roughness: 0.3, metalness: 0.45 });
  seaMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = U.time;
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform float uTime; varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float wx = sin(vWP.x * 0.21 + uTime * 0.7) * 0.5 + sin(vWP.z * 0.33 - uTime * 0.5 + vWP.x * 0.07) * 0.5;
      float wz = cos(vWP.z * 0.19 + uTime * 0.6) * 0.5 + sin(vWP.x * 0.41 + vWP.z * 0.13 + uTime * 0.9) * 0.5;
      normal = normalize(normal + (viewMatrix * vec4(wx * 0.06, 0.0, wz * 0.06, 0.0)).xyz);`);
  };
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(170 + 3500, 0, -400);
  sea.receiveShadow = false;
  world.add(sea);
  await nextFrame();

  /* ══════════ THE FOREST — big pines, grouped in tiles so unseen ones are skipped ══════════ */
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
        if (long) tmp.copy(pineTip).lerp(snowC, r() < 0.4 ? 0.35 + r() * 0.3 : 0); else tmp.copy(pineB);
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
        const L0 = ring0[2 * j], Lm = ring0[2 * j + 1], L1 = ring0[(2 * j + 2) % n0], U0 = ring1[j], U1 = ring1[(j + 1) % segs];
        idx.push(L0, U0, Lm, Lm, U0, U1, Lm, U1, L1, U0, apex, U1);
      }
      for (let j = 0; j < n0; j++) idx.push(ring0[j], ring0[(j + 1) % n0], under);
    }
    const tg = new THREE.CylinderGeometry(R * 0.07, R * 0.11, trunkH, 6, 1);
    tg.translate(0, trunkH / 2 - 0.3, 0);
    const base = pos.length / 3, tp = tg.attributes.position;
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
      float sw = hh * hh * 0.0009;
      transformed.x += sin(uTime * 0.7 + ph) * sw;
      transformed.z += cos(uTime * 0.55 + ph * 1.3) * sw * 0.7;`);
  };
  const VARIANTS = [
    { H: 25, R: 4.4, tiers: 7, segs: 9, seed: 1 },    // tall
    { H: 17, R: 4.6, tiers: 6, segs: 9, seed: 2 },    // full
    { H: 10, R: 3.6, tiers: 4, segs: 8, seed: 3 },    // young
    { H: 22, R: 4.8, tiers: 3, segs: 5, seed: 4 },    // distant
    { H: 36, R: 7.2, tiers: 8, segs: 10, seed: 5 },   // ancient (the hollow)
  ];
  const treeGeos = VARIANTS.map(treeGeometry);
  const coarse = ROADS.flatMap(r => r.pts.filter((_, i) => i % 8 === 0));
  const roadDistCoarse = (x, z) => { let b = Infinity; for (const [px, pz] of coarse) { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
  const OVER_EST = { amber: [40, 9], ocean: [22, 16], iridescent: [34, 0], alam: [32, 4], contact: [19, 0], journey: [24, -4] };
  const VIEWS = DEST_IDS.map(id => {
    const d = DESTS[id], [od, os] = OVER_EST[id] || [24, 0];
    const fx = Math.sin(d.rot), fz = Math.cos(d.rot), sx = fz, sz = -fx;
    return [d.house[0], d.house[1], d.house[0] + fx * od + sx * os, d.house[1] + fz * od + sz * os];
  });
  const TILE = 140;
  const tiles = new Map();
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = V(), p = V();
    let nNear = 0, nFar = 0, tries = 0;
    while ((nNear < Q.near || nFar < Q.far) && tries < (Q.near + Q.far) * 10) {
      tries++;
      const x = X0 + 30 + rng() * (X1 - X0 - 60), z = Z1 + 30 + rng() * (Z0 - Z1 - 60);
      const dr = roadDistCoarse(x, z);
      const near = dr < 75;
      if (near ? nNear >= Q.near : nFar >= Q.far) continue;
      if (x > shoreX(z) - 22) continue;
      const dh = Math.hypot(x - HOLLOW[0], z - HOLLOW[1]);
      let vi = near ? (rng() < 0.38 ? 0 : rng() < 0.7 ? 1 : 2) : 3;
      if (dh > 26 && dh < 75 && rng() < 0.5) vi = 4;
      const sc = vi === 4 ? 0.85 + rng() * 0.4 : 0.72 + rng() * 0.72;
      const rad = VARIANTS[vi].R * sc;
      const f = field(x, z);
      if (f.d < ROADS[f.r].hw + rad * 0.45 + 1.4) continue;
      if (PADS.some(pd => Math.hypot(x - pd.x, z - pd.z) < pd.r + rad * 0.5 + 3)) continue;
      const cm = canyonMask(x, z);
      if (cm > 0.08 && f.r === ROAD_INDEX.iridescent && f.d < 40) continue;
      if (cm > 0.3 && rng() > 0.3) continue;
      if (Math.hypot(x - CROSSROADS[0], z - CROSSROADS[1]) < 14) continue;
      if (VIEWS.some(v => segDist(x, z, ...v) < 9 + rad * 0.6)) continue;
      const h = terrainH(x, z);
      if (h > 170) continue;
      const grad = Math.hypot(terrainH(x + 2, z) - h, terrainH(x, z + 2) - h) / 2;
      if (grad > 0.85) continue;
      p.set(x, h - 0.3, z);
      e.set((rng() - 0.5) * 0.06, rng() * Math.PI * 2, (rng() - 0.5) * 0.06);
      q.setFromEuler(e);
      s.set(sc, sc * (0.88 + rng() * 0.28), sc);
      m.compose(p, q, s);
      const key = `${Math.floor((x - X0) / TILE)}_${Math.floor((z - Z1) / TILE)}_${vi}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push(m.clone());
      if (near) nNear++; else nFar++;
    }
  }
  {
    const tint = new THREE.Color();
    for (const [key, mats] of tiles) {
      const vi = +key.split('_')[2];
      const im = new THREE.InstancedMesh(treeGeos[vi], treeMat, mats.length);
      mats.forEach((mm, i) => {
        im.setMatrixAt(i, mm);
        const k = (vi === 4 ? 0.7 : 0.85) + rng() * 0.22;
        tint.setRGB(k * (0.96 + rng() * 0.06), k, k * (0.97 + rng() * 0.08));
        im.setColorAt(i, tint);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = Q.shadows && vi !== 3;
      world.add(im);
    }
  }
  await nextFrame();

  /* ══════════ MATERIALS & BUILDING HELPERS ══════════ */
  const std = (hex, rough = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color: C(hex), roughness: rough, metalness: 0, ...extra });
  const glow = (hex, k = 2.6) => new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C(hex), emissiveIntensity: k });
  const MAT = {
    wood: std('#3a2a20'), woodDark: std('#241913'), log: std('#4a3426', 0.95),
    stone: std('#5e6571', 0.95), stoneWarm: std('#6f6862', 0.95), stoneOld: std('#57545f', 0.95), plaster: std('#2f3f37'),
    whitewash: std('#bdb5a6', 0.95), brick: std('#5e3a31', 0.92), adobe: std('#a26a46', 0.96), adobeDark: std('#6e4330'),
    clapboard: std('#5d758e', 0.85), trim: std('#d4d9df', 0.8), hay: std('#6d5a37', 1),
    snow: std('#e3eaf4', 0.8), iron: std('#191c21', 0.6, { metalness: 0.4 }),
    metal: new THREE.MeshStandardMaterial({ color: C('#8d99ab'), metalness: 0.7, roughness: 0.36 }),
    dome: new THREE.MeshStandardMaterial({ color: C('#6a6488'), emissive: C('#1a1630'), metalness: 0.35, roughness: 0.4 }),
    paint: new THREE.MeshStandardMaterial({ color: C('#5c1d22'), metalness: 0.5, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: C('#0d1420'), metalness: 0.6, roughness: 0.2 }),
    rubber: std('#111214', 0.8),
    window: glow('#ffb15e'), amber: glow('#ff9a32', 3.2), door: glow('#ff9440', 1.7),
    violet: glow('#9a72ff', 2.2), cool: glow('#c9dcff', 1.6), lens: glow('#9fc3ff', 1.4),
    slit: new THREE.MeshStandardMaterial({ color: C('#05080f'), emissive: C('#16233c'), emissiveIntensity: 1, roughness: 1 }),
    headlight: glow('#fff1d6', 1.2),
    rose: new THREE.MeshStandardMaterial({ color: C('#a01d30'), emissive: C('#2a0309'), roughness: 0.6 }),
    leaf: std('#13261c', 0.9),
  };
  // a faint glow of their own keeps walls readable against the night without extra lights
  for (const k of ['wood', 'woodDark', 'log', 'stone', 'stoneWarm', 'stoneOld', 'plaster', 'whitewash', 'brick', 'adobe', 'adobeDark', 'clapboard', 'trim', 'hay'])
    MAT[k].emissive.copy(MAT[k].color).multiplyScalar(0.22);
  const IRI = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: C('#000000'), emissive: C('#66ddee'), emissiveIntensity: 2.4 }));

  function mesh(geo, mat, x = 0, y = 0, z = 0, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (parent) parent.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z, p) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p);
  const cyl = (rt, rb, h, mat, x, y, z, p, seg = 12) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, p);
  function gable(w, d, h, over, mat) {
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
    parent.add(under, top);
  }
  function windowAt(parent, x, y, z, w, h, ry = 0, mat = MAT.window, cross = true) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0, g);
    const f = 0.09;
    box(w + f * 2, f, 0.08, MAT.woodDark, 0, h / 2, 0.02, g);
    box(w + f * 2, f * 1.6, 0.16, MAT.snow, 0, -h / 2 - 0.02, 0.06, g);
    box(f, h, 0.08, MAT.woodDark, -w / 2, 0, 0.02, g);
    box(f, h, 0.08, MAT.woodDark, w / 2, 0, 0.02, g);
    if (cross) { box(0.05, h, 0.05, MAT.woodDark, 0, 0, 0.03, g); box(w, 0.05, 0.05, MAT.woodDark, 0, 0, 0.03, g); }
    parent.add(g);
  }
  function doorAt(parent, x, y, z, w, h, ry = 0, mat = MAT.door) {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = ry;
    mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0, g);
    box(w + 0.3, 0.18, 0.14, MAT.woodDark, 0, h / 2 + 0.06, 0.05, g);
    box(0.15, h, 0.14, MAT.woodDark, -w / 2 - 0.05, 0, 0.05, g);
    box(0.15, h, 0.14, MAT.woodDark, w / 2 + 0.05, 0, 0.05, g);
    parent.add(g);
  }
  function textTexture(text, { color = '#e2c487', bg = ['#2f2016', '#1c130d'], border = 'rgba(201,168,106,0.75)', italic = false } = {}) {
    const H = 200, W = Math.max(512, Math.min(2048, 160 + text.length * 70));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const k = c.getContext('2d');
    const gr = k.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
    k.fillStyle = gr; k.fillRect(0, 0, W, H);
    k.strokeStyle = border; k.lineWidth = 5; k.strokeRect(12, 12, W - 24, H - 24);
    k.fillStyle = color; k.textAlign = 'center'; k.textBaseline = 'middle';
    if ('letterSpacing' in k) k.letterSpacing = '8px';
    let size = 96;
    const font = s => `${italic ? 'italic ' : ''}600 ${s}px "Cormorant Garamond", Georgia, serif`;
    k.font = font(size);
    while (k.measureText(text).width > W - 90 && size > 40) { size -= 4; k.font = font(size); }
    k.fillText(text, W / 2, H / 2 + 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return { tex, aspect: W / H };
  }
  const textMat = tex => new THREE.MeshStandardMaterial({ map: tex, emissive: C('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.38, roughness: 0.8 });
  function signAt(parent, text, x, y, z, h = 0.7, opts) {
    const { tex, aspect } = textTexture(text, opts);
    const m = mesh(new THREE.PlaneGeometry(h * aspect, h), textMat(tex), x, y, z, parent);
    m.userData.keep = true;
    return m;
  }
  /* merge a building's many small meshes into a few, one per material */
  function bake(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    const victims = [];
    group.traverse(o => {
      if (!o.isMesh || o.userData.keep || Array.isArray(o.material) || o.isInstancedMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      victims.push(o);
    });
    victims.forEach(o => o.parent.remove(o));
    for (const [mat, geos] of byMat) {
      const merged = X.mergeGeometries(geos, false);
      if (!merged) continue;
      const m = new THREE.Mesh(merged, mat);
      const lit = mat.emissiveIntensity > 0.5 && mat.color.r === 0;
      m.castShadow = Q.shadows && !lit;
      m.receiveShadow = Q.shadows;
      group.add(m);
    }
    group.traverse(o => { if (o.isMesh && Array.isArray(o.material)) { o.castShadow = Q.shadows; o.receiveShadow = Q.shadows; } });
  }

  const chimneys = [];   // smoke rises from these
  const lanterns = [];   // { p: Vector3, color: Color, iri: bool }
  const hitBoxes = [];
  const LIGHT = { main: '#ffa552', easy: '#ffb064', stony: '#ffa552', planks: '#ffa552', bridge: '#ffa552', tracks: '#ffa552',
                  mountain: '#ff8f2a', coast: '#d6e4ff', canyon: 'iri', hollow: '#a98bff' };
  function addLantern(x, z, color, y) {
    const iri = color === 'iri';
    lanterns.push({ p: V(x, y ?? terrainH(x, z), z), color: C(iri ? '#66ddee' : color), iri, hang: y != null });
  }

  /* ══════════ THE HOUSES ══════════
     Each builder works in the house's own space: the door faces +z.
     It returns where the door is, how tall the house is (for its name label)
     and the size of the box you can click. */
  const BUILD = {
    about(g) {   // a cosy cottage at the end of the easy road
      box(8.6, 1, 6.9, MAT.stone, 0, 0, 0, g);
      box(8, 4, 6.3, MAT.wood, 0, 2.45, 0, g);
      roof(g, 8, 6.3, 3.4, 4.45, 0.6, MAT.wood);
      box(3.4, 0.22, 2, MAT.woodDark, 0, 0.6, 4.1, g);
      for (const x of [-1.5, 1.5]) cyl(0.11, 0.11, 2.6, MAT.woodDark, x, 1.9, 4.9, g, 8);
      const pr = gable(3.4, 2, 1.1, 0.12, [MAT.wood, MAT.snow]); pr.position.set(0, 3.2, 4.1); g.add(pr);
      doorAt(g, 0, 1.75, 3.17, 1.2, 2.2);
      windowAt(g, -2.6, 2.6, 3.17, 1.4, 1.2); windowAt(g, 2.6, 2.6, 3.17, 1.4, 1.2);
      windowAt(g, 4.02, 2.6, 0, 1.3, 1.1, Math.PI / 2); windowAt(g, -4.02, 2.6, 0, 1.3, 1.1, -Math.PI / 2);
      for (const x of [-2.6, 2.6]) { box(1.6, 0.3, 0.38, MAT.woodDark, x, 1.82, 3.35, g); box(1.6, 0.1, 0.38, MAT.snow, x, 2.0, 3.35, g); }
      box(0.9, 3, 0.9, MAT.stone, 2.6, 6.2, -1.2, g); box(1.1, 0.3, 1.1, MAT.snow, 2.6, 7.75, -1.2, g);
      for (let x = -6; x <= 6; x += 0.8) if (Math.abs(x) > 1.2) { box(0.12, 1, 0.08, MAT.trim, x, 0.95, 8.4, g); }
      for (const s of [-1, 1]) { box(4.6, 0.08, 0.06, MAT.trim, s * 3.6, 1.15, 8.4, g); box(4.6, 0.08, 0.06, MAT.trim, s * 3.6, 0.75, 8.4, g); }
      for (let z = 4; z <= 8; z += 0.8) for (const s of [-1, 1]) box(0.08, 1, 0.12, MAT.trim, s * 6, 0.95, z, g);
      signAt(g, 'ABOUT', 0, 3.55, 5.12, 0.62);
      return { door: V(0, 1.75, 3.2), labelY: 10.5, hit: [10, 9, 10], chimney: V(2.6, 8, -1.2) };
    },
    journey(g) {   // an old stone lodge with a watch-tower, after the hard road
      box(10, 1, 8, MAT.stone, 0, 0, 0, g);
      box(9, 5, 7.2, MAT.stoneWarm, 0, 3, 0, g);
      roof(g, 9, 7.2, 4, 5.5, 0.5, MAT.stoneWarm);
      cyl(2, 2.2, 11, MAT.stone, -4.8, 5.5, 3.0, g, 16);
      mesh(new THREE.ConeGeometry(2.6, 4.2, 16), MAT.snow, -4.8, 13.1, 3.0, g);
      windowAt(g, -4.8, 8.2, 5.05, 0.55, 1.1, 0, MAT.window, false);
      windowAt(g, -4.8, 4.8, 5.15, 0.5, 0.9, 0, MAT.window, false);
      doorAt(g, 1, 1.9, 3.62, 1.5, 2.4);
      const arch = mesh(new THREE.CircleGeometry(0.75, 16, 0, Math.PI), MAT.door, 1, 3.1, 3.62, g);
      windowAt(g, 3.3, 3.3, 3.62, 1.3, 1.4); windowAt(g, -1.6, 3.3, 3.62, 1.2, 1.4);
      windowAt(g, 4.52, 3.3, -1, 1.2, 1.4, Math.PI / 2);
      for (const [x, z] of [[3.5, 6.5], [-2.5, 7.2], [5.5, 4.6]]) box(0.6, 0.9 + Math.abs(x) * 0.06, 0.5, MAT.stoneOld, x, 0.5, z, g);
      signAt(g, 'JOURNEY', 1, 4.25, 3.7, 0.6);
      void arch;
      return { door: V(1, 1.9, 3.65), labelY: 17, hit: [12, 15, 10] };
    },
    skills(g) {   // the workshop at the end of the plank road
      box(10.6, 1.2, 8.6, MAT.stone, 0, 0, 0, g);
      box(10, 4.6, 8, MAT.wood, 0, 2.9, 0, g);
      for (let i = -4; i <= 4; i += 2) box(0.18, 4.6, 0.12, MAT.woodDark, i * 1.18, 2.9, 4.03, g);
      roof(g, 10, 8, 3.4, 5.2, 0.6, MAT.wood);
      box(0.95, 3.2, 0.95, MAT.stone, 3, 7.1, -1.6, g); box(1.15, 0.3, 1.15, MAT.snow, 3, 8.75, -1.6, g);
      doorAt(g, 0, 2.1, 4.02, 2.8, 3.0);
      windowAt(g, -3.4, 3.1, 4.02, 1.7, 1.3); windowAt(g, 3.4, 3.1, 4.02, 1.7, 1.3);
      windowAt(g, 5.02, 3.1, 0, 1.6, 1.2, Math.PI / 2); windowAt(g, -5.02, 3.1, 0, 1.6, 1.2, -Math.PI / 2);
      signAt(g, 'SKILLS', 0, 4.25, 4.1, 0.62);
      const gear = new THREE.Group(); gear.position.set(0, 6.4, 4.7);
      mesh(new THREE.TorusGeometry(0.62, 0.13, 8, 24), MAT.metal, 0, 0, 0, gear);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; box(0.2, 0.26, 0.16, MAT.metal, Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0, gear).rotation.z = a; }
      g.add(gear);
      box(2.4, 0.15, 0.8, MAT.woodDark, -3.6, 1.45, 5.2, g);
      box(0.9, 0.9, 0.9, MAT.wood, 4.2, 1.05, 5.3, g); box(0.95, 0.12, 0.95, MAT.snow, 4.2, 1.55, 5.3, g);
      box(0.8, 0.5, 0.5, MAT.iron, -3.2, 1.75, 5.2, g);
      return { door: V(0, 2.1, 4.05), labelY: 12, hit: [11, 10, 10], chimney: V(3, 9, -1.6) };
    },
    projects(g) {   // an engineering hall with an observatory dome
      box(12, 1.2, 9, MAT.stone, 0, 0, 0, g);
      box(11, 6, 8, MAT.brick, 0, 3.6, 0, g);
      roof(g, 11, 8, 2.8, 6.6, 0.5, MAT.brick);
      doorAt(g, 0, 2.3, 4.02, 2.2, 3.2);
      for (const x of [-3.7, 3.7]) { windowAt(g, x, 3.4, 4.02, 2.2, 3.0); }
      windowAt(g, 5.52, 3.4, -1, 1.6, 2.4, Math.PI / 2); windowAt(g, -5.52, 3.4, -1, 1.6, 2.4, -Math.PI / 2);
      cyl(3.2, 3.3, 8.6, MAT.stoneWarm, 6.8, 4.3, -2.2, g, 24);
      cyl(3.5, 3.5, 0.3, MAT.stone, 6.8, 8.7, -2.2, g, 24);
      mesh(new THREE.SphereGeometry(3.3, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.metal, 6.8, 8.8, -2.2, g);
      const slit = mesh(new THREE.TorusGeometry(3.32, 0.4, 6, 24, Math.PI / 2 * 0.98), MAT.slit, 6.8, 8.8, -2.2, g);
      slit.rotation.y = -Math.PI / 2; slit.scale.set(1, 1, 0.55);
      const tel = new THREE.Group(); tel.position.set(6.8, 9, -2.2); tel.rotation.x = -0.75;
      mesh(new THREE.CylinderGeometry(0.34, 0.4, 4.4, 14).rotateX(Math.PI / 2), MAT.iron, 0, 0, 2, tel);
      mesh(new THREE.CircleGeometry(0.32, 14), MAT.lens, 0, 0, 4.22, tel);
      g.add(tel);
      windowAt(g, 6.8 + Math.sin(0.5) * 3.25, 5, -2.2 + Math.cos(0.5) * 3.25, 0.8, 1.4, 0.5, MAT.window, false);
      signAt(g, 'PROJECTS', 0, 4.55, 4.12, 0.62);
      return { door: V(0, 2.3, 4.05), labelY: 15, hit: [16, 13, 11] };
    },
    hobbies(g) {   // a log lodge with a carport, skis and a camera on a tripod
      box(9, 0.8, 6.6, MAT.stone, 0, 0, 0, g);
      box(8.4, 3.8, 6, MAT.woodDark, 0, 2.3, 0, g);
      const logG = new THREE.CylinderGeometry(0.26, 0.26, 8.8, 8).rotateZ(Math.PI / 2);
      for (let i = 0; i < 7; i++) { mesh(logG, MAT.log, 0, 0.7 + i * 0.52, 3.05, g); mesh(logG, MAT.log, 0, 0.7 + i * 0.52, -3.05, g); }
      roof(g, 8.4, 6.2, 3, 4.2, 0.7, MAT.log);
      doorAt(g, -1.6, 1.65, 3.33, 1.2, 2.2);
      windowAt(g, 1.9, 2.4, 3.33, 1.6, 1.2);
      windowAt(g, -4.22, 2.4, 0, 1.3, 1.1, -Math.PI / 2);
      for (const [x, z] of [[5.4, 2.6], [5.4, -2.6], [9.6, 2.6], [9.6, -2.6]]) cyl(0.12, 0.12, 2.9, MAT.woodDark, x, 1.85, z, g, 8);
      box(4.8, 0.2, 6.2, MAT.woodDark, 7.5, 3.35, 0, g); box(4.9, 0.18, 6.3, MAT.snow, 7.5, 3.55, 0, g);
      // the car
      const car = new THREE.Group(); car.position.set(7.5, 0.5, 0);
      box(1.9, 0.6, 4.2, MAT.paint, 0, 0.55, 0, car);
      box(1.7, 0.55, 2.1, MAT.glass, 0, 1.12, -0.3, car);
      box(1.72, 0.06, 2.14, MAT.paint, 0, 1.42, -0.3, car);
      for (const [x, z] of [[-0.92, 1.35], [0.92, 1.35], [-0.92, -1.4], [0.92, -1.4]]) mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14).rotateZ(Math.PI / 2), MAT.rubber, x, 0.3, z, car);
      for (const x of [-0.6, 0.6]) mesh(new THREE.PlaneGeometry(0.34, 0.14), MAT.headlight, x, 0.62, 2.11, car);
      g.add(car);
      // skis leaning on the wall, and a camera on its tripod
      for (const x of [-3.4, -3.15]) { const s = box(0.09, 1.9, 0.12, MAT.paint, x, 1.6, 3.4, g); s.rotation.z = 0.12; }
      const tri = new THREE.Group(); tri.position.set(3.9, 0.5, 5.2);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const l = cyl(0.025, 0.025, 1.5, MAT.iron, Math.cos(a) * 0.3, 0.72, Math.sin(a) * 0.3, tri, 5); l.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22); }
      box(0.32, 0.22, 0.2, MAT.iron, 0, 1.55, 0, tri);
      g.add(tri);
      signAt(g, 'HOBBIES', -1.6, 3.15, 3.42, 0.55);
      return { door: V(-1.6, 1.65, 3.35), labelY: 10, hit: [14, 8, 9] };
    },
    contact(g) {   // the post house at the end of the road
      box(7, 0.8, 6, MAT.stone, 0, 0, 0, g);
      box(6.4, 3.8, 5.4, MAT.plaster, 0, 2.3, 0, g);
      roof(g, 6.4, 5.4, 2.8, 4.2, 0.6, MAT.plaster);
      box(6.8, 0.2, 1.6, MAT.woodDark, 0, 0.5, 3.5, g);
      for (const x of [-3, 3]) cyl(0.11, 0.11, 2.9, MAT.woodDark, x, 1.95, 4.2, g, 8);
      doorAt(g, 0, 1.65, 2.72, 1.2, 2.2);
      windowAt(g, -2, 2.3, 2.72, 1.2, 1.2); windowAt(g, 2, 2.3, 2.72, 1.2, 1.2);
      box(0.9, 3, 0.9, MAT.stone, -2, 5.4, -1, g); box(1.1, 0.3, 1.1, MAT.snow, -2, 6.95, -1, g);
      // mailbox on its post
      cyl(0.07, 0.07, 1.2, MAT.woodDark, 3.6, 0.9, 5.2, g, 6);
      box(0.5, 0.42, 0.8, MAT.paint, 3.6, 1.7, 5.2, g);
      mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), MAT.paint, 3.6, 1.9, 5.2, g);
      box(0.52, 0.06, 0.82, MAT.snow, 3.6, 2.17, 5.2, g);
      signAt(g, 'CONTACT', 0, 3.35, 2.8, 0.55);
      return { door: V(0, 1.65, 2.75), labelY: 9, hit: [9, 8, 9], chimney: V(-2, 7.2, -1) };
    },

    /* ── the four book houses ── */
    amber(g, b) {   // Amber Windows — an old Romanian village high in the mountains
      box(9.4, 1, 7.4, MAT.stone, 0, 0, 0, g);
      box(9, 3, 7, MAT.whitewash, 0, 2, 0, g);
      box(9.1, 0.6, 7.1, MAT.woodDark, 0, 3.75, 0, g);
      roof(g, 9, 7, 7.4, 4.05, 0.95, MAT.woodDark);
      box(9, 0.25, 1.9, MAT.woodDark, 0, 0.62, 4.45, g);
      for (const x of [-4.2, -2.1, 2.1, 4.2]) { cyl(0.13, 0.15, 3.2, MAT.wood, x, 2.2, 5.25, g, 8); box(0.42, 0.14, 0.42, MAT.wood, x, 3.6, 5.25, g); }
      box(3.4, 0.12, 0.1, MAT.wood, -3.15, 1.35, 5.25, g); box(3.4, 0.12, 0.1, MAT.wood, 3.15, 1.35, 5.25, g);
      doorAt(g, 0, 1.55, 3.52, 1.1, 2.0, 0, MAT.amber);
      windowAt(g, -2.6, 2.15, 3.52, 1.2, 1.1, 0, MAT.amber); windowAt(g, 2.6, 2.15, 3.52, 1.2, 1.1, 0, MAT.amber);
      windowAt(g, 4.52, 2.15, 1, 1.1, 1, Math.PI / 2, MAT.amber); windowAt(g, -4.52, 2.15, 1, 1.1, 1, -Math.PI / 2, MAT.amber);
      windowAt(g, 0, 6.2, 4.48, 0.8, 0.9, 0, MAT.amber);
      signAt(g, 'AMBER WINDOWS', 0, 3.75, 3.58, 0.5);
      // the wooden church with its tall spire
      const ch = new THREE.Group(); ch.position.set(-15, b.groundAt(-15, -9), -9); ch.rotation.y = 0.35;
      box(5.4, 1, 9.4, MAT.stone, 0, 0, 0, ch);
      box(5, 4, 9, MAT.woodDark, 0, 2.5, 0, ch);
      const cr = gable(5, 9, 5.4, 0.7, [MAT.woodDark, MAT.snow]); cr.position.y = 4.5; ch.add(cr);
      box(2.4, 6, 2.4, MAT.woodDark, 0, 8, 3.2, ch);
      mesh(new THREE.ConeGeometry(1.9, 11, 8), MAT.woodDark, 0, 16.5, 3.2, ch);
      mesh(new THREE.ConeGeometry(1.95, 2.2, 8), MAT.snow, 0, 11.9, 3.2, ch);
      mesh(new THREE.SphereGeometry(0.22, 10, 8), MAT.metal, 0, 22.2, 3.2, ch);
      windowAt(ch, 0, 8.6, 4.42, 0.6, 1.0, 0, MAT.amber, false);
      for (const z of [-2.5, 0.5]) { windowAt(ch, 2.52, 2.6, z, 0.6, 1.1, Math.PI / 2, MAT.amber, false); windowAt(ch, -2.52, 2.6, z, 0.6, 1.1, -Math.PI / 2, MAT.amber, false); }
      g.add(ch);
      // haystacks around a pole, snow on their crowns
      for (const [x, z] of [[11, -4], [14.5, 1], [12, 6], [16.5, -6], [18, 4.5]]) {
        const y = b.groundAt(x, z);
        mesh(new THREE.ConeGeometry(1.6, 3.4, 10), MAT.hay, x, y + 1.7, z, g);
        mesh(new THREE.ConeGeometry(1.0, 1.4, 10), MAT.snow, x, y + 2.9, z, g);
        cyl(0.05, 0.05, 1.2, MAT.woodDark, x, y + 3.9, z, g, 5);
      }
      // the well with its long sweep pole
      { const y = b.groundAt(7, 9); cyl(0.14, 0.18, 5.2, MAT.wood, 7, y + 2.6, 9, g, 7);
        const pole = cyl(0.07, 0.07, 10, MAT.wood, 7, y + 5.2, 9, g, 6); pole.rotation.z = 1.1;
        box(1.3, 0.9, 1.3, MAT.wood, 10.2, y + 0.45, 9, g); box(1.35, 0.1, 1.35, MAT.snow, 10.2, y + 0.95, 9, g); }
      // two neighbours with steep roofs
      for (const [x, z, r] of [[13, -15, -0.4], [-12, 12, 0.6]]) {
        const h = new THREE.Group(); h.position.set(x, b.groundAt(x, z), z); h.rotation.y = r;
        box(5.4, 0.6, 4.4, MAT.stone, 0, 0, 0, h); box(5, 2.6, 4, MAT.whitewash, 0, 1.6, 0, h);
        roof(h, 5, 4, 4.6, 2.9, 0.7, MAT.woodDark);
        windowAt(h, -1.2, 1.7, 2.02, 0.9, 0.8, 0, MAT.amber); windowAt(h, 1.2, 1.7, 2.02, 0.9, 0.8, 0, MAT.amber);
        g.add(h);
      }
      // a fence along the cliff edge
      for (let i = 0; i < 16; i++) { const x = -20 + i * 2.4, z = 19 + Math.sin(i * 0.7) * 1.2; cyl(0.07, 0.07, 1.2, MAT.wood, x, b.groundAt(x, z) + 0.6, z, g, 5); }
      return { door: V(0, 1.55, 3.55), labelY: 15, hit: [11, 13, 11] };
    },
    ocean(g, b) {   // The Ocean of Cold Roses — a cottage on the shore, roses in the frost
      box(8.4, 0.8, 6.4, MAT.stone, 0, 0, 0, g);
      box(8, 3.8, 6, MAT.clapboard, 0, 2.3, 0, g);
      for (let y = 0.9; y < 4.1; y += 0.42) box(8.04, 0.05, 6.04, MAT.trim, 0, y, 0, g);
      for (const [x, z] of [[4.02, 3.02], [-4.02, 3.02], [4.02, -3.02], [-4.02, -3.02]]) box(0.18, 3.8, 0.18, MAT.trim, x, 2.3, z, g);
      roof(g, 8, 6, 3, 4.2, 0.6, MAT.clapboard);
      box(8.4, 0.2, 2.2, MAT.trim, 0, 0.5, 4.1, g);
      for (const x of [-3.9, -1.3, 1.3, 3.9]) cyl(0.09, 0.09, 2.8, MAT.trim, x, 1.9, 5.1, g, 8);
      box(8.2, 0.1, 0.08, MAT.trim, 0, 1.4, 5.1, g);
      doorAt(g, 0, 1.75, 3.02, 1.2, 2.2);
      windowAt(g, -2.6, 2.45, 3.02, 1.3, 1.3); windowAt(g, 2.6, 2.45, 3.02, 1.3, 1.3);
      windowAt(g, 0, 2.45, -3.02, 2.2, 1.4, Math.PI);
      signAt(g, 'THE OCEAN OF COLD ROSES', 0, 3.6, 3.08, 0.42);
      // the jetty runs out to sea behind the house
      const jy = 1.3 - b.base;
      for (let z = -9; z > -64; z -= 1.1) box(2.4, 0.12, 0.95, MAT.wood, 0, jy, z, g);
      for (let z = -12; z > -64; z -= 5) for (const x of [-1.2, 1.2]) cyl(0.14, 0.14, 5, MAT.woodDark, x, jy - 2.4, z, g, 6);
      const boat = box(1.4, 0.5, 4, MAT.wood, 2.4, jy - 0.85, -58, g); boat.scale.set(1, 1, 1); boat.rotation.y = 0.2;
      // rose bushes
      return { door: V(0, 1.75, 3.05), labelY: 9.5, hit: [10, 8, 9] };
    },
    iridescent(g, b) {   // Iridescent Eyes — Kharun, a settlement built into the canyon walls
      box(8.4, 0.8, 7.4, MAT.adobeDark, 0, 0, 0, g);
      box(8, 5, 7, MAT.adobe, 0, 2.9, 0, g);
      box(8.4, 0.45, 7.4, MAT.adobeDark, 0, 5.6, 0, g);
      box(7.8, 0.15, 6.8, MAT.snow, 0, 5.9, 0, g);
      mesh(new THREE.CircleGeometry(1.3, 32), IRI[0], 0, 3.85, 3.52, g);
      mesh(new THREE.TorusGeometry(1.38, 0.16, 8, 32), MAT.adobeDark, 0, 3.85, 3.56, g);
      mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 24), MAT.adobeDark, 0, 3.85, 3.57, g);
      mesh(new THREE.CircleGeometry(0.3, 20), IRI[2], 0, 3.85, 3.58, g);
      doorAt(g, 0, 1.5, 3.52, 1.3, 1.9);
      for (const x of [-2.9, 2.9]) mesh(new THREE.CircleGeometry(0.5, 20), IRI[1], x, 2.6, 3.52, g);
      // homes stacked up the canyon walls behind
      const r2 = mulberry32(31);
      const spots = [[-14, -15], [12, -17], [-6, -23], [6, -25], [-19, -23], [0, -31], [17, -27]];
      for (const [x, z] of spots) {
        const w = 3.5 + r2() * 3, h = 2.6 + r2() * 1.6, d = 3.5 + r2() * 2.5, y = b.groundAt(x, z);
        const hgrp = new THREE.Group(); hgrp.position.set(x, y, z); hgrp.rotation.y = (r2() - 0.5) * 0.4;
        box(w, h + 7, d, MAT.adobe, 0, h / 2 - 3.5, 0, hgrp);
        box(w + 0.3, 0.3, d + 0.3, MAT.adobeDark, 0, h, 0, hgrp);
        box(w - 0.2, 0.12, d - 0.2, MAT.snow, 0, h + 0.2, 0, hgrp);
        mesh(new THREE.CircleGeometry(0.42, 18), IRI[Math.floor(r2() * 3)], -w * 0.2, h * 0.55, d / 2 + 0.02, hgrp);
        if (r2() < 0.7) mesh(new THREE.CircleGeometry(0.32, 18), IRI[Math.floor(r2() * 3)], w * 0.25, h * 0.5, d / 2 + 0.02, hgrp);
        if (r2() < 0.6) { for (const s of [-0.25, 0.25]) cyl(0.04, 0.04, 3, MAT.woodDark, w / 2 + 0.3 + s, 1.3, d / 2 - 0.4, hgrp, 4);
          for (let k = 0; k < 6; k++) box(0.5, 0.04, 0.05, MAT.woodDark, w / 2 + 0.3, 0.2 + k * 0.48, d / 2 - 0.4, hgrp); }
        g.add(hgrp);
      }
      // glowing orbs on poles around the little plaza
      for (const [x, z] of [[-5.5, 7], [5.5, 7], [-8, 2], [8, 2]]) {
        const y = b.groundAt(x, z);
        cyl(0.06, 0.08, 3.4, MAT.adobeDark, x, y + 1.7, z, g, 6);
        mesh(new THREE.SphereGeometry(0.32, 16, 12), IRI[(x > 0) + 1], x, y + 3.6, z, g);
      }
      signAt(g, 'IRIDESCENT EYES', 0, 5.0, 3.56, 0.48);
      return { door: V(0, 1.5, 3.55), labelY: 11, hit: [10, 9, 10] };
    },
    alam(g, b) {   // Alam al Qarib — an old domed house beyond the threshold
      box(9, 0.9, 9, MAT.stoneOld, 0, 0, 0, g);
      box(8, 5.2, 8, MAT.stoneOld, 0, 3.05, 0, g);
      box(8.5, 0.35, 8.5, MAT.stone, 0, 5.8, 0, g);
      cyl(3, 3.1, 1.3, MAT.stoneOld, 0, 6.6, 0, g, 24);
      const dome = mesh(new THREE.SphereGeometry(3.1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), MAT.dome, 0, 7.2, 0, g);
      dome.scale.y = 1.35;
      cyl(0.05, 0.05, 1.2, MAT.metal, 0, 11.9, 0, g, 6);
      mesh(new THREE.SphereGeometry(0.16, 10, 8), MAT.metal, 0, 12.6, 0, g);
      // pointed-arch door
      const sh = new THREE.Shape();
      sh.moveTo(-0.85, 0); sh.lineTo(0.85, 0); sh.lineTo(0.85, 1.9); sh.quadraticCurveTo(0.85, 2.6, 0, 3.0); sh.quadraticCurveTo(-0.85, 2.6, -0.85, 1.9); sh.closePath();
      mesh(new THREE.ShapeGeometry(sh), MAT.violet, 0, 0.45, 4.02, g);
      // lattice windows
      for (const [x, z, ry] of [[-2.6, 4.02, 0], [2.6, 4.02, 0], [4.02, 0, Math.PI / 2], [-4.02, 0, -Math.PI / 2]]) {
        const w = new THREE.Group(); w.position.set(x, 3.3, z); w.rotation.y = ry;
        mesh(new THREE.PlaneGeometry(1.2, 1.7), MAT.violet, 0, 0, 0, w);
        for (let i = -1; i <= 1; i++) box(0.05, 1.7, 0.05, MAT.stone, i * 0.3, 0, 0.03, w);
        for (let j = -2; j <= 2; j++) box(1.2, 0.05, 0.05, MAT.stone, 0, j * 0.34, 0.03, w);
        g.add(w);
      }
      signAt(g, 'ALAM AL QARIB', 0, 4.55, 4.07, 0.48, { color: '#d9ccff', border: 'rgba(170,150,255,0.6)', bg: ['#1c1a26', '#121018'] });
      return { door: V(0, 1.6, 4.05), labelY: 15, hit: [10, 13, 10] };
    },
  };

  /* place every house on its pad, bake it, remember its door */
  const HOUSE = {};
  for (const id of DEST_IDS) {
    const d = DESTS[id], pad = PADS.find(p => p.id === id);
    const base = pad.h;
    const g = new THREE.Group();
    g.position.set(d.house[0], base, d.house[1]);
    g.rotation.y = d.rot;
    const cos = Math.cos(d.rot), sin = Math.sin(d.rot);
    const toWorld = (lx, lz) => [d.house[0] + lx * cos + lz * sin, d.house[1] - lx * sin + lz * cos];
    const groundAt = (lx, lz) => { const [wx, wz] = toWorld(lx, lz); return terrainH(wx, wz) - base; };
    const info = BUILD[id](g, { base, groundAt });
    world.add(g);
    bake(g);
    const fwd = V(sin, 0, cos);
    const door = info.door.clone().applyAxisAngle(UP, d.rot).add(g.position);
    if (info.chimney) chimneys.push(info.chimney.clone().applyAxisAngle(UP, d.rot).add(g.position));
    const hb = new THREE.Mesh(new THREE.BoxGeometry(...info.hit), new THREE.MeshBasicMaterial());
    hb.position.set(0, info.hit[1] / 2, 0); hb.visible = false; hb.userData.dest = id;
    g.add(hb); hitBoxes.push(hb);
    HOUSE[id] = { g, base, fwd, door, label: V(d.house[0], base + info.labelY, d.house[1]), toWorld, groundAt };
    // a lantern either side of the door
    const side = V(fwd.z, 0, -fwd.x);
    for (const s of [-1, 1]) {
      const p = door.clone().addScaledVector(fwd, 1.6).addScaledVector(side, s * (id === 'amber' ? 2.2 : 2.6));
      addLantern(p.x, p.z, id === 'iridescent' ? 'iri' : LIGHT[d.style] || LIGHT.main);
    }
    await nextFrame();
  }

  /* ══════════ SIGNPOSTS, NAMEPOSTS, THE TRAILHEAD GATE ══════════ */
  function arrowBoard(text, len) {
    const h = 0.42, d = 0.08;
    const sh = new THREE.Shape();
    sh.moveTo(0, -h / 2); sh.lineTo(len - 0.3, -h / 2); sh.lineTo(len, 0); sh.lineTo(len - 0.3, h / 2); sh.lineTo(0, h / 2); sh.closePath();
    const g = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }); geo.translate(0, 0, -d / 2);
    g.add(new THREE.Mesh(geo, MAT.wood));
    const { tex } = textTexture(text);
    const mat = textMat(tex);
    const front = mesh(new THREE.PlaneGeometry(len - 0.45, h * 0.82), mat, (len - 0.3) / 2 + 0.04, 0, d / 2 + 0.01, g);
    const back = mesh(new THREE.PlaneGeometry(len - 0.45, h * 0.82), mat, (len - 0.3) / 2 + 0.04, 0, -d / 2 - 0.01, g);
    back.rotation.y = Math.PI;
    box(len - 0.3, 0.05, d + 0.04, MAT.snow, (len - 0.3) / 2, h / 2 + 0.02, 0, g);
    void front;
    return g;
  }
  function signpost(x, z, boards, dest) {
    const y = terrainH(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z);
    const top = 2.3 + boards.length * 0.5;
    cyl(0.1, 0.13, top, MAT.woodDark, 0, top / 2, 0, g, 8);
    mesh(new THREE.ConeGeometry(0.16, 0.25, 8), MAT.snow, 0, top + 0.1, 0, g);
    boards.forEach((b, i) => {
      const len = clamp(0.9 + b.text.length * 0.13, 1.4, 4.2);
      const ab = arrowBoard(b.text, len);
      ab.position.set(0, top - 0.35 - i * 0.5, 0);
      ab.rotation.y = Math.atan2(-b.dz, b.dx);
      g.add(ab);
    });
    world.add(g);
    if (dest) { const hb = new THREE.Mesh(new THREE.BoxGeometry(3, top + 0.5, 3), new THREE.MeshBasicMaterial()); hb.position.set(x, y + top / 2, z); hb.visible = false; hb.userData.dest = dest; world.add(hb); hitBoxes.push(hb); }
    return g;
  }
  function namepost(x, z, faceX, faceZ, text, opts) {
    const y = terrainH(x, z);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(faceX, faceZ);
    const { tex, aspect } = textTexture(text, opts);
    const h = 0.5, w = clamp(h * aspect, 1.4, 4.4);
    for (const s of [-1, 1]) cyl(0.08, 0.1, 2.5, MAT.woodDark, s * (w / 2 + 0.12), 1.25, 0, g, 7);
    box(w + 0.5, 0.1, 0.12, MAT.woodDark, 0, 2.45, 0, g);
    box(w + 0.1, h + 0.12, 0.08, MAT.wood, 0, 1.95, 0, g);
    const m = textMat(tex);
    mesh(new THREE.PlaneGeometry(w, h), m, 0, 1.95, 0.05, g);
    mesh(new THREE.PlaneGeometry(w, h), m, 0, 1.95, -0.05, g).rotation.y = Math.PI;
    box(w + 0.15, 0.05, 0.14, MAT.snow, 0, 2.53, 0, g);
    world.add(g);
  }
  const mainR = ROADS[0];
  for (const id of DEST_IDS) {
    const d = DESTS[id], r = ROADS[ROAD_INDEX[id]];
    // a signpost where the road leaves the main road (not for the books or the end — they share posts)
    if (!d.from) {
      const [jx, , jz] = roadAt(mainR, d.s);
      const [mx, mz] = roadDir(mainR, d.s);
      const [bx, , bz] = roadAt(r, 9);
      const dx = bx - jx, dz = bz - jz, l = Math.hypot(dx, dz);
      // the walker faces (mx, mz); their right-hand side is (−mz, mx)
      const sgn = d.side === 'left' ? -1 : 1;
      const px = jx + mx * 3 - mz * sgn * (mainR.hw + 3.4), pz = jz + mz * 3 + mx * sgn * (mainR.hw + 3.4);
      signpost(px, pz, [{ text: d.sign, dx: dx / l, dz: dz / l }], id);
      addLantern(jx - mx * 4 - mz * sgn * (mainR.hw + 1.5), jz - mz * 4 + mx * sgn * (mainR.hw + 1.5), LIGHT.main);
    }
    // a namepost and a lantern where the road reaches the house
    const n = r.pts.length;
    const k = Math.max(2, n - 7);
    const [nx, , nz] = roadAt(r, k);
    const [ddx, ddz] = roadDir(r, k);
    const ox = -ddz, oz = ddx;
    const label = d.book ? d.name : d.sign;
    namepost(nx + ox * (r.hw + 1.9), nz + oz * (r.hw + 1.9), -ddx, -ddz, label,
      d.style === 'hollow' ? { color: '#d9ccff', border: 'rgba(170,150,255,0.6)', bg: ['#1c1a26', '#121018'] } : undefined);
    addLantern(nx - ox * (r.hw + 1.5), nz - oz * (r.hw + 1.5), LIGHT[d.style] || LIGHT.main);
  }
  // the crossroads: one tall post, an arm for every road
  {
    const [cx, , cz] = roadAt(mainR, CROSS_S);
    const arms = [...BOOK_IDS, 'contact'].map(id => {
      const r = ROADS[ROAD_INDEX[id]];
      const [bx, , bz] = roadAt(r, Math.min(r.pts.length - 1, 14));
      const dx = bx - cx, dz = bz - cz, l = Math.hypot(dx, dz) || 1;
      return { text: id === 'contact' ? 'CONTACT' : DESTS[id].sign, dx: dx / l, dz: dz / l };
    });
    signpost(cx - 6.5, cz - 6, arms, null);
    addLantern(cx - 6.5, cz - 4, LIGHT.main); addLantern(cx + 6, cz + 3, LIGHT.main);
  }
  // the trailhead gate with the name across it
  {
    const [gx, , gz] = roadAt(mainR, 18);
    const y = terrainH(gx, gz);
    const g = new THREE.Group(); g.position.set(gx, y, gz);
    for (const s of [-1, 1]) { cyl(0.22, 0.26, 5.4, MAT.woodDark, s * 4.6, 2.7, 0, g, 8); mesh(new THREE.ConeGeometry(0.32, 0.4, 8), MAT.snow, s * 4.6, 5.6, 0, g); }
    box(10, 0.25, 0.3, MAT.woodDark, 0, 5.0, 0, g);
    const { tex, aspect } = textTexture('RAFSAN ISDANI');
    const w = 5.6, h = w / aspect;
    box(w + 0.3, h + 0.2, 0.12, MAT.wood, 0, 4.2, 0, g);
    const tm = textMat(tex);
    mesh(new THREE.PlaneGeometry(w, h), tm, 0, 4.2, 0.07, g);
    mesh(new THREE.PlaneGeometry(w, h), tm, 0, 4.2, -0.07, g).rotation.y = Math.PI;
    box(10.2, 0.12, 0.4, MAT.snow, 0, 5.18, 0, g);
    world.add(g);
    addLantern(gx - 5.6, gz, LIGHT.main); addLantern(gx + 5.6, gz, LIGHT.main);
  }

  /* ══════════ ROADSIDE DETAILS — each road has its own character ══════════ */
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockList = [], redRockList = [], plankList = [], slabList = [], trackList = [], postList = [], standList = [];
  const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), ss = V(), pp = V();
  const place = (list, x, y, z, rx, ry, rz, sx, sy, sz) => { ee.set(rx, ry, rz); qq.setFromEuler(ee); ss.set(sx, sy, sz); pp.set(x, y, z); list.push(mtx.compose(pp, qq, ss).clone()); };
  for (const id of DEST_IDS) {
    const r = ROADS[ROAD_INDEX[id]], d = DESTS[id], n = r.pts.length;
    for (let i = 6; i < n - 3; i++) {
      const [x, y, z] = roadAt(r, i), [dx, dz] = roadDir(r, i), ox = -dz, oz = dx, yaw = Math.atan2(dx, dz);
      const f = i / n;
      if (d.style === 'stony') {
        if (f < 0.6) {   // the hard part: rocks everywhere, roots and stones underfoot
          for (let k = 0; k < 3; k++) { const o = (rng() - 0.5) * (r.hw * 2 + 3); const s = 0.18 + rng() * 0.45; place(rockList, x + ox * o, terrainH(x + ox * o, z + oz * o) + s * 0.3, z + oz * o, rng() * 3, rng() * 3, rng() * 3, s * 1.3, s, s * 1.1); }
          if (i % 9 === 0) { const s = 0.8 + rng() * 0.9, o = (rng() < 0.5 ? -1 : 1) * (r.hw + 1.5 + rng()); place(rockList, x + ox * o, terrainH(x + ox * o, z + oz * o) + s * 0.4, z + oz * o, rng(), rng() * 3, rng(), s * 1.4, s, s * 1.2); }
        } else if (i % 1 === 0) {   // then a fine paved road of flat stones
          for (let k = -2; k <= 2; k++) place(slabList, x + ox * k * 0.95, y + 0.05, z + oz * k * 0.95, 0, yaw + (rng() - 0.5) * 0.15, 0, 0.88, 1, 0.82);
        }
      } else if (d.style === 'planks' && i > 8) {
        place(plankList, x, y + 0.08, z, 0, yaw, 0, 1, 1, 1);
      } else if (d.style === 'tracks') {
        for (const s of [-0.9, 0.9]) place(trackList, x + ox * s, y + 0.04, z + oz * s, 0, yaw, 0, 1, 1, 1);
      } else if (d.style === 'easy' && i % 2 === 0) {
        for (const s of [-1, 1]) place(postList, x + ox * s * (r.hw + 0.9), terrainH(x + ox * s * (r.hw + 0.9), z + oz * s * (r.hw + 0.9)) + 0.45, z + oz * s * (r.hw + 0.9), 0, yaw, 0, 1, 1, 1);
      } else if (d.style === 'mountain') {
        if (i % 3 === 0) { const o = (rng() < 0.5 ? -1 : 1) * (r.hw + 1.2 + rng() * 3); const s = 0.4 + rng() * 1.1; place(rockList, x + ox * o, terrainH(x + ox * o, z + oz * o) + s * 0.3, z + oz * o, rng(), rng() * 3, rng(), s * 1.3, s, s); }
        if (i % 5 === 0) for (const s of [-1, 1]) place(postList, x + ox * s * (r.hw + 0.7), terrainH(x + ox * s * (r.hw + 0.7), z + oz * s * (r.hw + 0.7)) + 0.45, z + oz * s * (r.hw + 0.7), 0, yaw, 0, 1, 1.3, 1);
      } else if (d.style === 'canyon') {
        if (i % 4 === 0) { const o = (rng() < 0.5 ? -1 : 1) * (r.hw + 1 + rng() * 2.5); const s = 0.5 + rng() * 1.4; place(redRockList, x + ox * o, terrainH(x + ox * o, z + oz * o) + s * 0.3, z + oz * o, rng(), rng() * 3, rng(), s * 1.3, s, s); }
      } else if (d.style === 'hollow' && f > 0.4 && i % 8 === 0) {
        for (const s of [-1, 1]) { const o = s * (r.hw + 1.6); const hgt = 2.4 + rng() * 2.2; place(standList, x + ox * o, terrainH(x + ox * o, z + oz * o) + hgt / 2 - 0.2, z + oz * o, (rng() - 0.5) * 0.12, yaw + rng(), (rng() - 0.5) * 0.12, 0.85, hgt, 0.55); }
      } else if (d.style === 'coast' && f > 0.55 && i % 2 === 0) {
        const o = -(r.hw + 1.2); place(slabList, x + ox * o, terrainH(x + ox * o, z + oz * o) + 0.3, z + oz * o, 0, yaw, 0, 1.0, 6, 0.5);
      }
    }
  }
  // scattered boulders in the wider forest and on the mountain
  for (let i = 0; i < (HIGH ? 260 : 120); i++) {
    const x = X0 + 40 + rng() * (X1 - X0 - 80), z = Z1 + 40 + rng() * (Z0 - Z1 - 80);
    if (x > shoreX(z) - 12) continue;
    const f = field(x, z); if (f.d < ROADS[f.r].hw + 2) continue;
    const s = 0.6 + rng() * 2.2;
    place(canyonMask(x, z) > 0.3 ? redRockList : rockList, x, terrainH(x, z) + s * 0.2, z, rng(), rng() * 3, rng(), s * 1.4, s, s * 1.2);
  }
  // a ring of standing stones around the domed house
  { const H = HOUSE.alam; for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 2 + 0.3; if (Math.abs(Math.sin(a / 2)) < 0.2) continue; const [x, z] = H.toWorld(Math.sin(a) * 15, Math.cos(a) * 15); const hgt = 3 + rng() * 2.5; place(standList, x, terrainH(x, z) + hgt / 2 - 0.3, z, (rng() - 0.5) * 0.1, a, (rng() - 0.5) * 0.1, 1.0, hgt, 0.6); } }
  function instances(geo, mat, list, shadow = true) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = Q.shadows && shadow; im.receiveShadow = Q.shadows;
    world.add(im);
    return im;
  }
  instances(rockGeo, std('#7b818d', 0.95), rockList);
  instances(rockGeo, std('#a5644a', 0.95), redRockList);
  instances(new THREE.BoxGeometry(3.4, 0.12, 0.5), std('#6a5140', 0.9), plankList, false);
  instances(new THREE.BoxGeometry(0.9, 0.1, 0.85), std('#a3a6ae', 0.9), slabList, false);
  instances(new THREE.BoxGeometry(0.1, 0.9, 0.1), MAT.woodDark, postList);
  instances(new THREE.BoxGeometry(1, 1, 1), std('#4d4a58', 0.95), standList);
  if (trackList.length) {
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.34, 1.05).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: C('#2c3038'), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), trackList.length);
    trackList.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); world.add(im);
  }

  /* rose bushes around the seaside cottage */
  {
    const H = HOUSE.ocean, bushes = [], blooms = [];
    const r2 = mulberry32(77);
    const spots = [];
    for (let i = 0; i < 14; i++) spots.push([-4.6 + i * 0.72, 5.9 + (i % 2) * 0.4]);
    for (let i = 0; i < 6; i++) { spots.push([-5.2, 4 - i * 1.4]); spots.push([5.2, 4 - i * 1.4]); }
    for (const [lx, lz] of spots) {
      const [x, z] = H.toWorld(lx, lz); const y = terrainH(x, z);
      const s = 0.45 + r2() * 0.25;
      place(bushes, x, y + s * 0.7, z, r2(), r2() * 3, r2(), s * 1.2, s, s * 1.1);
      for (let k = 0; k < 4; k++) place(blooms, x + (r2() - 0.5) * s * 1.6, y + s * (0.9 + r2() * 0.7), z + (r2() - 0.5) * s * 1.6, r2(), r2(), r2(), 0.13, 0.12, 0.13);
    }
    instances(new THREE.IcosahedronGeometry(1, 0), MAT.leaf, bushes);
    instances(new THREE.IcosahedronGeometry(1, 0), MAT.rose, blooms, false);
  }

  /* the lighthouse offshore, its beam turning slowly over the water */
  let beam;
  {
    const [lx, lz] = LIGHTHOUSE;
    const g = new THREE.Group(); g.position.set(lx, 0, lz);
    mesh(new THREE.DodecahedronGeometry(9, 0), std('#3a3f4a', 0.95), 0, -3, 0, g).scale.set(1.4, 0.6, 1.2);
    for (let i = 0; i < 5; i++) cyl(2.3 - i * 0.22, 2.5 - i * 0.22, 3.6, i % 2 ? std('#7a2228') : MAT.trim, 0, 3 + i * 3.6, 0, g, 18);
    cyl(1.6, 1.6, 2, glow('#fff1cf', 2.4), 0, 21.8, 0, g, 16);
    mesh(new THREE.ConeGeometry(2, 2.2, 16), MAT.iron, 0, 23.9, 0, g);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 24, 1, true).translate(0, -60, 0).rotateZ(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: C('#fff1cf'), transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam = new THREE.Group(); beam.position.y = 21.8; beam.add(cone); g.add(beam);
    world.add(g);
  }

  /* the frozen stream and the little bridge on the Projects road */
  {
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 1 / 70) pts.push([lerp(STREAM[0], STREAM[2], t), lerp(STREAM[1], STREAM[3], t)]);
    const pos = [], idx = [];
    pts.forEach(([x, z], i) => {
      const y = baseH(x, z) + 0.25;
      pos.push(x - 2.6, y, z, x + 2.6, y, z);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    world.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: C('#8fa8c8'), roughness: 0.15, metalness: 0.3, side: THREE.DoubleSide })));
    const [bx, by, bz] = roadAt(projRoad, BRIDGE.i), [dx, dz] = roadDir(projRoad, BRIDGE.i);
    const bg = new THREE.Group(); bg.position.set(bx, by + 0.3, bz); bg.rotation.y = Math.atan2(dx, dz);
    for (let k = -6; k <= 6; k++) box(3.2, 0.14, 0.82, MAT.wood, 0, -Math.cos(k / 6 * 1.2) * 0.0 + 0.1 * (1 - Math.abs(k) / 6), k * 0.85, bg);
    for (const s of [-1, 1]) { for (let k = -6; k <= 6; k += 3) cyl(0.07, 0.07, 1.1, MAT.woodDark, s * 1.55, 0.6, k * 0.85, bg, 6); box(0.1, 0.1, 10.6, MAT.woodDark, s * 1.55, 1.15, 0, bg); box(0.14, 0.06, 10.6, MAT.snow, s * 1.55, 1.24, 0, bg); }
    world.add(bg);
  }

  /* the threshold — a stone arch across the path to Alam al Qarib */
  let thresholdVeil;
  {
    const r = ROADS[ROAD_INDEX.alam], i = Math.max(10, r.pts.length - 48);
    const [x, y, z] = roadAt(r, i), [dx, dz] = roadDir(r, i);
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(dx, dz);
    for (const s of [-1, 1]) { box(1.1, 5.4, 1.1, MAT.stoneOld, s * 2.9, 2.7, 0, g); box(1.4, 0.4, 1.4, MAT.stone, s * 2.9, 0.2, 0, g); }
    mesh(new THREE.TorusGeometry(2.9, 0.55, 8, 24, Math.PI), MAT.stoneOld, 0, 5.4, 0, g);
    mesh(new THREE.ConeGeometry(0.5, 0.6, 6), MAT.snow, 0, 8.6, 0, g);
    const sh = new THREE.Shape(); sh.moveTo(-2.35, 0); sh.lineTo(2.35, 0); sh.lineTo(2.35, 5.4); sh.absarc(0, 5.4, 2.35, 0, Math.PI, false); sh.closePath();
    thresholdVeil = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: U.time },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vP;
        void main(){ float w = sin(vP.y * 2.1 + uTime * 0.9) * 0.5 + sin(vP.x * 3.3 - uTime * 0.6 + vP.y) * 0.5;
          float edge = smoothstep(0.0, 1.4, 2.35 - abs(vP.x)) * smoothstep(0.0, 0.8, vP.y);
          vec3 c = mix(vec3(0.35, 0.22, 0.75), vec3(0.15, 0.55, 0.65), 0.5 + 0.5 * w);
          gl_FragColor = vec4(c * (0.18 + 0.1 * w) * edge, 1.0); }`,
    }));
    g.add(thresholdVeil);
    world.add(g);
  }

  /* ══════════ LANTERNS ALONG EVERY ROAD ══════════ */
  {
    let side = 1;
    for (let i = 40; i < mainR.pts.length - 10; i += 26) {
      const [x, , z] = roadAt(mainR, i), [dx, dz] = roadDir(mainR, i);
      addLantern(x - dz * side * (mainR.hw + 1.4), z + dx * side * (mainR.hw + 1.4), LIGHT.main);
      side *= -1;
    }
    for (const id of DEST_IDS) {
      const r = ROADS[ROAD_INDEX[id]], d = DESTS[id];
      const step = d.book ? 22 : 14;
      for (let i = 12; i < r.pts.length - 12; i += step) {
        const [x, , z] = roadAt(r, i), [dx, dz] = roadDir(r, i);
        addLantern(x - dz * side * (r.hw + 1.3), z + dx * side * (r.hw + 1.3), LIGHT[d.style] || LIGHT.main);
        side *= -1;
      }
    }
  }
  const lanternGlass = [];
  let glassMesh, iriIdx = [];
  {
    const n = lanterns.length;
    const postG = new THREE.CylinderGeometry(0.05, 0.07, 2.0, 6); postG.translate(0, 1.0, 0);
    const frameG = new THREE.BoxGeometry(0.34, 0.44, 0.34); frameG.translate(0, 2.22, 0);
    const glassG = new THREE.BoxGeometry(0.24, 0.32, 0.24); glassG.translate(0, 2.22, 0);
    const capG = new THREE.ConeGeometry(0.3, 0.22, 4); capG.rotateY(Math.PI / 4); capG.translate(0, 2.55, 0);
    const glassMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.6) });
    const parts = [
      new THREE.InstancedMesh(postG, MAT.iron, n),
      new THREE.InstancedMesh(frameG, new THREE.MeshStandardMaterial({ color: C('#16181c'), metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.55 }), n),
      (glassMesh = new THREE.InstancedMesh(glassG, glassMat, n)),
      new THREE.InstancedMesh(capG, MAT.snow, n),
    ];
    const m = new THREE.Matrix4();
    lanterns.forEach((L, i) => {
      m.makeTranslation(L.p.x, L.p.y, L.p.z);
      parts.forEach(im => im.setMatrixAt(i, m));
      glassMesh.setColorAt(i, L.color);
      if (L.iri) iriIdx.push(i);
      lanternGlass.push(V(L.p.x, L.p.y + 2.22, L.p.z));
    });
    parts.forEach(im => { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); world.add(im); });
  }
  let lanternGlow;
  {
    const n = lanternGlass.length;
    const p = new Float32Array(n * 3), ph = new Float32Array(n), col = new Float32Array(n * 3), iri = new Float32Array(n);
    lanternGlass.forEach((v, i) => { p.set([v.x, v.y, v.z], i * 3); ph[i] = rng() * 10; const c = lanterns[i].color; col.set([c.r, c.g, c.b], i * 3); iri[i] = lanterns[i].iri ? 1 : 0; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aIri', new THREE.BufferAttribute(iri, 1));
    lanternGlow = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.time, uScale: { value: 1 }, uFog: { value: 0.005 } },
      vertexShader: `attribute float aPhase; attribute vec3 aColor; attribute float aIri; uniform float uTime; uniform float uScale; uniform float uFog; varying float vA; varying vec3 vC;
        vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z;
          float fl = 0.88 + 0.08 * sin(uTime * 7.3 + aPhase) + 0.05 * sin(uTime * 13.1 + aPhase * 2.3);
          vA = fl * exp(-pow(uFog * d * 0.8, 2.0));
          vC = mix(aColor, hue(fract(uTime * 0.05 + aPhase * 0.1)) * 0.9 + 0.1, aIri);
          gl_PointSize = 2.6 * uScale / max(d, 0.5); }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.2);
          gl_FragColor = vec4(vC * vec3(1.0, 0.62, 0.32) * 1.6 * a * vA * 0.8 + vC * 0.0, 1.0); }`,
    }));
    lanternGlow.frustumCulled = false;
    world.add(lanternGlow);
  }
  /* warm pools of light on the snow */
  {
    const spots = [...lanternGlass.map((v, i) => [v, 5.5, lanterns[i].color]), ...DEST_IDS.map(id => [HOUSE[id].door.clone().addScaledVector(HOUSE[id].fwd, 2.4), 9, C('#ff9a48')])];
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([v, s, c], i) => { m.makeScale(s, 1, s).setPosition(v.x, terrainH(v.x, v.z) + 0.08, v.z); im.setMatrixAt(i, m); im.setColorAt(i, c); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    world.add(im);
  }

  /* ══════════ LIGHT ══════════ */
  scene.add(new THREE.HemisphereLight(C('#3a5794'), C('#0a1120'), 0.55));
  const fill = new THREE.DirectionalLight(C('#7f93c4'), 0.3); fill.position.set(0.3, 0.5, 1); scene.add(fill);
  const moonLight = new THREE.DirectionalLight(C('#a9bdf0'), 0.95);
  scene.add(moonLight, moonLight.target);
  if (Q.shadows) {
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(2048, 2048);
    Object.assign(moonLight.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 300 });
    moonLight.shadow.bias = -0.0006; moonLight.shadow.normalBias = 0.06;
  }
  const pool = [];
  for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(C('#ffa552'), 0, 16, 1.6); scene.add(l); pool.push(l); }
  if (Q.doorLights) {
    const tint = { amber: '#ff9a3a', ocean: '#ffc88a', iridescent: '#8fe0e8', alam: '#a98bff' };
    for (const id of DEST_IDS) {
      const H = HOUSE[id];
      const l = new THREE.PointLight(C(tint[id] || '#ffae5c'), 16, 20, 1.6);
      l.position.copy(H.door).addScaledVector(H.fwd, 2.2); l.position.y += 0.8;
      scene.add(l);
    }
  }

  /* ══════════ ATMOSPHERE: fog banks, sea mist, the hollow's motes, smoke, snow ══════════ */
  const fogTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const k = c.getContext('2d'); const r2 = mulberry32(17);
    for (let i = 0; i < 26; i++) { const x = 40 + r2() * 176, y = 40 + r2() * 48, r = 18 + r2() * 34; const gr = k.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); k.fillStyle = gr; k.fillRect(0, 0, 256, 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const wisps = [];
  function wisp(x, z, y, color, sx, sy, op) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, color: C(color), transparent: true, opacity: op, depthWrite: false }));
    s.position.set(x, y, z); s.scale.set(sx, sy, 1); s.userData = { x, ph: rng() * 6.28, sp: 0.04 + rng() * 0.05 };
    world.add(s); wisps.push(s);
  }
  for (let i = 0; i < (HIGH ? 70 : 34); i++) {
    const r = ROADS[Math.floor(rng() * ROADS.length)], p = r.pts[Math.floor(rng() * r.pts.length)];
    const x = p[0] + (rng() - 0.5) * 40, z = p[1] + (rng() - 0.5) * 14;
    wisp(x, z, terrainH(x, z) + 0.8 + rng() * 1.2, '#a5b6d6', 20 + rng() * 20, 4 + rng() * 3, 0.1 + rng() * 0.1);
  }
  for (let i = 0; i < (HIGH ? 22 : 10); i++) { const z = -640 + rng() * 160, x = shoreX(z) + rng() * 120; wisp(x, z, 1.5 + rng() * 3, '#b9c8e4', 50 + rng() * 40, 7 + rng() * 5, 0.12); }
  for (let i = 0; i < (HIGH ? 18 : 8); i++) { const a = rng() * 6.28, rr = 8 + rng() * 40; const x = HOLLOW[0] + Math.cos(a) * rr, z = HOLLOW[1] + Math.sin(a) * rr; wisp(x, z, terrainH(x, z) + 0.8 + rng(), '#8f7ad6', 18 + rng() * 14, 4 + rng() * 2, 0.14); }

  const motes = (() => {
    const n = HIGH ? 160 : 70;
    const p = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = rng() * 6.28, rr = rng() * 46; const x = HOLLOW[0] + 10 + Math.cos(a) * rr, z = HOLLOW[1] - 10 + Math.sin(a) * rr; p.set([x, terrainH(x, z) + 0.6 + rng() * 4, z], i * 3); ph[i] = rng() * 50; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: U.time, uScale: { value: 1 } },
      vertexShader: `attribute float aPhase; uniform float uTime; uniform float uScale; varying float vA; varying float vH;
        void main(){ vec3 q = position + vec3(sin(uTime * 0.3 + aPhase) * 1.2, sin(uTime * 0.5 + aPhase * 1.7) * 0.6, cos(uTime * 0.27 + aPhase) * 1.2);
          vec4 mv = modelViewMatrix * vec4(q, 1.0); gl_Position = projectionMatrix * mv;
          vA = 0.5 + 0.5 * sin(uTime * 1.3 + aPhase * 3.0); vH = fract(aPhase * 0.137);
          gl_PointSize = 0.45 * uScale / max(-mv.z, 0.5); }`,
      fragmentShader: `varying float vA; varying float vH; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.0);
          vec3 c = mix(vec3(0.62, 0.48, 1.0), vec3(0.45, 0.95, 0.85), vH); gl_FragColor = vec4(c * a * vA, 1.0); }`,
    }));
    pts.frustumCulled = false; world.add(pts); return pts;
  })();

  const smoke = [];
  for (const c of chimneys) for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C('#8f9ab0'), transparent: true, opacity: 0, depthWrite: false }));
    s.userData = { base: c, t: i / 6 }; world.add(s); smoke.push(s);
  }

  const snow = (() => {
    const n = Q.snow;
    const seed = new Float32Array(n * 3), size = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed.set([rng(), rng(), rng()], i * 3); const l = rng(); size[i] = l < 0.6 ? 0.022 + rng() * 0.012 : l < 0.9 ? 0.038 + rng() * 0.016 : 0.06 + rng() * 0.02; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: U.time, uCam: { value: V() }, uScale: { value: 1 }, uOn: { value: 1 } },
      vertexShader: `attribute vec3 aSeed; attribute float aSize; uniform float uTime; uniform vec3 uCam; uniform float uScale; uniform float uOn; varying float vA;
        const vec3 BOX = vec3(64.0, 34.0, 64.0);
        void main(){ vec3 p = aSeed * BOX; float t = uTime;
          p.y -= t * (0.5 + aSeed.x * 0.55); p.x += t * 0.3 + sin(t * 0.55 + aSeed.z * 31.0) * 0.9; p.z += cos(t * 0.45 + aSeed.y * 23.0) * 0.7;
          vec3 rel = mod(p - uCam + BOX * 0.5, BOX) - BOX * 0.5;
          vec4 mv = viewMatrix * vec4(uCam + rel, 1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z; gl_PointSize = clamp(aSize * uScale / max(d, 0.3), 0.0, 40.0);
          vA = uOn * smoothstep(0.4, 2.5, d) * (1.0 - smoothstep(16.0, 31.0, d)); }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vec3(0.82, 0.87, 0.97), smoothstep(1.0, 0.2, r) * vA * 0.85); }`,
    }));
    pts.frustumCulled = false; scene.add(pts); return pts;
  })();

  /* ══════════ THE MAP DRAWN ON THE LAND (seen from above during the intro) ══════════ */
  const inkLines = (() => {
    const pos = [], rev = [], sid = [], idx = [];
    const spans = { main: [0, 0.5] };
    ROADS.forEach(r => {
      const [a, b] = r.id === 'main' ? spans.main : r.dest.book ? [0.62, 1] : r.id === 'contact' ? [0.5, 0.56] : [0.44, 0.75];
      const w = r.id === 'main' ? 2.8 : 1.9;
      const n = r.pts.length, base = pos.length / 3;
      let k = 0;
      for (let i = 0; i < n; i += 2) {
        const [x, y, z] = roadAt(r, i), [dx, dz] = roadDir(r, i);
        pos.push(x - dz * w, y + 0.7, z + dx * w, x + dz * w, y + 0.7, z - dx * w);
        const t = lerp(a, b, i / (n - 1));
        rev.push(t, t); sid.push(-1, 1);
        if (k) { const q = base + (k - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
        k++;
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aRev', new THREE.Float32BufferAttribute(rev, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(sid, 1));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uReveal: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `attribute float aRev; attribute float aSide; varying float vR; varying float vS; void main(){ vR = aRev; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uReveal; uniform float uOpacity; varying float vR; varying float vS;
        void main(){ if (vR > uReveal) discard; float edge = 1.0 - abs(vS); float tip = smoothstep(0.0, 0.02, uReveal - vR);
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * (0.35 + 0.65 * edge) * uOpacity * (0.6 + 0.4 * tip), 1.0); }`,
    }));
    m.frustumCulled = false; m.renderOrder = 5; world.add(m);
    return m;
  })();

  /* ══════════ POST-PROCESSING ══════════ */
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new X.EffectComposer(renderer, rt);
  composer.setPixelRatio(Q.dpr);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new X.RenderPass(scene, camera));
  const bloom = new X.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.62, 0.55, 0.82);
  bloom.enabled = Q.bloom;
  composer.addPass(bloom);
  composer.addPass(new X.OutputPass());

  /* ══════════ THE CAMERA: intro → map → walking the main road ══════════ */
  const MAIN3 = mainR.pts.map((_, i) => { const [x, y, z] = roadAt(mainR, i); return V(x, y, z); });
  const samplePath = (arr, s, out) => { const a = Math.floor(clamp(s, 0, arr.length - 1)), b = Math.min(arr.length - 1, a + 1); return out.copy(arr[a]).lerp(arr[b], clamp(s, 0, arr.length - 1) - a); };
  const GLANCE = ['about', 'journey', 'skills', 'projects', 'hobbies'].map(id => ({ s: DESTS[id].s, target: HOUSE[id].door.clone().add(V(0, 2.2, 0)) }));
  const contactLook = HOUSE.contact.door.clone().add(V(0, 0.8, 0));
  const _a = V(), _b = V(), look = V();
  function walkPose(s, pos, lk) {
    samplePath(MAIN3, s, pos); pos.y += EYE;
    samplePath(MAIN3, Math.min(MAIN_LEN, s + 14), lk); lk.y += EYE - 0.25;
    for (const g of GLANCE) { const w = Math.exp(-(((s - (g.s - 9)) / 14) ** 2)) * 0.42; if (w > 0.002) lk.lerp(g.target, w); }
    lk.lerp(contactLook, smoothstep(MAIN_LEN - 36, MAIN_LEN - 4, s));
  }
  let introPos, introLook, walkFov = 60;
  function buildIntro() {
    walkPose(0, _a, _b);
    introPos = new THREE.CatmullRomCurve3([V(40, 95, 190), V(-10, 780, 70), V(-70, 170, 200), V(-12, 32, 128), _a.clone()], false, 'centripetal');
    introLook = new THREE.CatmullRomCurve3([V(-60, 150, -500), V(-10, 0, -360), V(0, 6, -20), V(0, 4, 0), _b.clone()], false, 'centripetal');
  }
  function poseAt(p, pos, lk) {
    if (p < INTRO) {
      const q = p / INTRO;
      introPos.getPoint(q, pos); introLook.getPoint(q, lk);
      return lerp(52, walkFov, smoothstep(0.75, 1, q));
    }
    walkPose(pToS(p), pos, lk);
    return walkFov;
  }

  /* house routes: down the branch road and in through the door */
  const routes = {};
  /* where you stop to take the house in: [distance in front of the door, height, sideways] */
  const OVER = { amber: [36, 9, 9], ocean: [18, 5, 16], iridescent: [30, 13, 0], alam: [28, 4, 4], contact: [15, 2.5, 0], journey: [20, 4, -4] };
  function route(id) {
    if (routes[id]) return routes[id];
    const r = ROADS[ROAD_INDEX[id]], H = HOUSE[id];
    const lift = DESTS[id].style === 'planks' ? 0.12 : 0;
    const [od, oh, os] = OVER[id] || [20, 4, 0];
    const side = V(H.fwd.z, 0, -H.fwd.x);
    const over = H.door.clone().addScaledVector(H.fwd, od).addScaledVector(side, os);
    over.y = Math.max(terrainH(over.x, over.z), H.base) + EYE + oh;
    const focus = id === 'ocean'
      ? H.g.position.clone().addScaledVector(H.fwd, -12).add(V(0, 3, 0))
      : H.g.position.clone().add(V(0, id === 'amber' ? 5 : 3.5, 0));
    const pts = [];
    for (let i = 0; i < r.pts.length - 2; i += 5) {
      const [x, y, z] = roadAt(r, i);
      const p = V(x, y + EYE + lift, z);
      if (p.distanceTo(H.door) < od + 7) break;
      pts.push(p);
    }
    if (!pts.length) { const [x, y, z] = roadAt(r, 0); pts.push(V(x, y + EYE, z)); }
    const approach = H.door.clone().addScaledVector(H.fwd, 7); approach.y = H.door.y + 0.55;
    const inside = H.door.clone().addScaledVector(H.fwd, 0.45); inside.y = H.door.y + 0.05;
    pts.push(over, approach, inside);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    let uo = 0.8, best = Infinity;
    for (let k = 0; k <= 400; k++) { const d = curve.getPointAt(k / 400).distanceTo(over); if (d < best) { best = d; uo = k / 400; } }
    const doorLook = H.door.clone().addScaledVector(H.fwd, -4);
    return (routes[id] = { curve, len, doorLook, uo: Math.min(uo, 0.97), focus, over });
  }

  let mode = 'scroll';    // 'scroll' | 'flight' | 'door'
  let paused = false, paintOnce = true, flight = null;
  function applyScrollPose() {
    const fov = poseAt(S.shown, _a, _b);
    camera.position.copy(_a); look.copy(_b); camera.lookAt(look);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function runFlight(f) {
    mode = 'flight';
    flight = f;
    return new Promise(resolve => { f.resolve = resolve; f.t0 = performance.now(); if (f.dur <= 0) { f.step(1); f.done = true; flight = null; resolve(); } });
  }
  function stepFlight(now) {
    const f = flight;
    if (!f) return;
    const t = clamp((now - f.t0) / f.dur, 0, 1);
    f.step(t);
    if (t >= 1) { flight = null; f.resolve(); }
  }
  const _c = V(), _d = V();
  let travelLabel = null;
  const easeQ = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  async function travelIn(id) {
    const R = route(id), { curve, len, doorLook, uo, focus } = R;
    const fromPos = camera.position.clone(), fromLook = look.clone(), fov0 = camera.fov;
    const dark = veilValue > 0.5;
    const T1 = clamp(2.2 + (uo * len) / 42, 3.4, 8), HOLD = 1.9, T2 = 2.6, T = T1 + HOLD + T2;
    const a = T1 / T, b = (T1 + HOLD) / T;
    const ahead = 12 / len;
    await runFlight({ dur: reduceMotion ? 0 : T * 1000, step: t => {
      let u;
      if (t < a) {
        const k = t / a; u = uo * easeQ(k);
        curve.getPointAt(Math.min(uo, u + ahead), _d); _d.y -= 0.2;
        _d.lerp(focus, smoothstep(0.6, 1, k));
        _d.lerp(fromLook, 1 - smoothstep(0, 0.16, k));
      } else if (t < b) {
        u = uo + 0.006 * ((t - a) / (b - a));
        _d.copy(focus);
      } else {
        const k = (t - b) / (1 - b); u = lerp(uo + 0.006, 1, easeQ(k));
        _d.copy(focus).lerp(doorLook, smoothstep(0.15, 0.8, k));
      }
      curve.getPointAt(Math.min(1, u), _c);
      _c.lerp(fromPos, 1 - smoothstep(0, 0.1, t / a));
      camera.position.copy(_c); look.copy(_d); camera.lookAt(look);
      camera.fov = lerp(fov0, walkFov - 4, smoothstep(b, 1, t)); camera.updateProjectionMatrix();
      travelLabel = t > a - 0.04 && t < b + 0.08 ? id : null;
      if (dark && t < 0.1) setVeil(1 - smoothstep(0, 0.07, t));
      else setVeil(smoothstep(0.9, 1, t));
    } });
    travelLabel = null;
    setVeil(1);
    mode = 'door';
  }
  async function travelOut(id) {
    const { curve, len } = route(id);
    paused = false;
    S.shown = S.progress;
    const endFov = poseAt(S.progress, _a, _b);
    const endPos = _a.clone(), endLook = _b.clone(), fov0 = camera.fov;
    const dur = reduceMotion ? 0 : clamp(1.8 + len / 95, 2.2, 5) * 1000;
    if (dur === 0) { camera.position.copy(endPos); look.copy(endLook); camera.lookAt(look); for (let i = 0; i <= 8; i++) { setVeil(1 - i / 8); await wait(35); } }
    else await runFlight({ dur, step: t => {
      const u = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      curve.getPointAt(1 - u, _c);
      _c.lerp(endPos, smoothstep(0.84, 1, t));
      curve.getPointAt(Math.max(0, 1 - u - 12 / len), _d); _d.y -= 0.2;
      _d.lerp(endLook, smoothstep(0.72, 1, t));
      camera.position.copy(_c); look.copy(_d); camera.lookAt(look);
      camera.fov = lerp(fov0, endFov, smoothstep(0.6, 1, t)); camera.updateProjectionMatrix();
      setVeil(1 - smoothstep(0, 0.14, t));
    } });
    setVeil(0);
    mode = 'scroll';
    applyScrollPose();
  }

  /* ── names over the houses ── */
  const labelsEl = $('#labels');
  labelsEl.innerHTML = '';
  const labelEls = {};
  for (const id of DEST_IDS) {
    const el = document.createElement('span');
    el.className = 'place-label' + (DESTS[id].book ? ' book' : '');
    el.textContent = DESTS[id].name;
    labelsEl.appendChild(el);
    labelEls[id] = el;
  }
  let hovered = null;
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const canPick = () => mode === 'scroll' && !S.openId && !S.busy && !S.mapOpen && S.progress >= INTRO && isWorld();
  function pick(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(hitBoxes, false)[0];
    return hit && hit.distance < 220 ? hit.object.userData.dest : null;
  }
  addEventListener('pointermove', e => {
    if (!canPick() || e.pointerType === 'touch' || e.target.closest('a, button, .dest, .map, .junction')) { if (hovered) { hovered = null; root.style.cursor = ''; } return; }
    hovered = pick(e);
    root.style.cursor = hovered ? 'pointer' : '';
  }, { passive: true });
  addEventListener('click', e => {
    if (!canPick() || e.target.closest('a, button, .dest, .map, .topbar, .junction')) return;
    const id = pick(e);
    if (id) goTo(id);
  });

  const _v = V();
  function updateLabels() {
    const w = innerWidth, h = innerHeight;
    const q = S.shown / INTRO;
    const overview = S.shown < INTRO && q > 0.3 && q < 0.7;
    const showFor = new Set();
    if (overview) DEST_IDS.forEach(id => showFor.add(id));
    else if (mode === 'scroll' && !S.openId && !S.busy && activeStop) {
      if (activeStop === 'books') BOOK_IDS.forEach(id => showFor.add(id)); else showFor.add(activeStop);
    }
    if (hovered) showFor.add(hovered);
    if (travelLabel) showFor.add(travelLabel);
    for (const id of DEST_IDS) {
      const el = labelEls[id];
      let on = showFor.has(id) && isWorld();
      if (on) {
        _v.copy(HOUSE[id].label).project(camera);
        if (_v.z > 1 || Math.abs(_v.x) > 1.02 || Math.abs(_v.y) > 1.02) on = false;
        else el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
      }
      el.classList.toggle('on', on);
      el.classList.toggle('hot', id === hovered || id === travelLabel || (on && id === activeStop));
    }
  }

  /* ══════════ THE LOOP ══════════ */
  let last = performance.now();
  const perf = { n: 0, sum: 0, checked: false };
  const sorted = lanternGlass.map((v, i) => ({ v, i, d: 0 }));
  const iriCol = new THREE.Color();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if ((paused || !isWorld()) && !paintOnce) return;
    paintOnce = false;
    if (!reduceMotion) U.time.value += dt;
    const t = U.time.value;

    S.shown = reduceMotion ? S.progress : S.shown + (S.progress - S.shown) * (1 - Math.exp(-dt * 3.0));
    if (Math.abs(S.shown - S.progress) < 1e-5) S.shown = S.progress;
    if (mode === 'scroll') applyScrollPose();
    else if (mode === 'flight') stepFlight(now);

    const cy = camera.position.y - terrainH(camera.position.x, camera.position.z);
    scene.fog.density = lerp(0.0052, 0.0007, smoothstep(12, 260, cy));
    lanternGlow.material.uniforms.uFog.value = scene.fog.density;
    snow.material.uniforms.uOn.value = 1 - smoothstep(40, 120, cy);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    moon.position.copy(camera.position).addScaledVector(MOON_DIR, 2400);
    moon.quaternion.copy(camera.quaternion);
    snow.material.uniforms.uCam.value.copy(camera.position);

    // the map draws itself across the land during the intro
    const q = S.shown / INTRO;
    inkLines.material.uniforms.uReveal.value = smoothstep(0.1, 0.52, q) * 1.02;
    inkLines.material.uniforms.uOpacity.value = smoothstep(0.06, 0.16, q) * (1 - smoothstep(0.78, 0.94, q));
    inkLines.visible = q < 1;

    if (Q.shadows) {
      camera.getWorldDirection(_v);
      moonLight.target.position.copy(camera.position).addScaledVector(_v, 34);
      moonLight.position.copy(moonLight.target.position).addScaledVector(MOON_DIR, 160);
      moonLight.shadow.intensity = 1 - smoothstep(30, 90, cy);
    }

    // the nearest lanterns borrow the real lights
    for (const s of sorted) s.d = s.v.distanceToSquared(camera.position);
    sorted.sort((a, b) => a.d - b.d);
    pool.forEach((l, k) => {
      const s = sorted[k]; if (!s) return;
      l.position.copy(s.v);
      l.color.copy(lanterns[s.i].iri ? iriCol.setHSL((t * 0.05 + s.i * 0.1) % 1, 0.7, 0.6) : lanterns[s.i].color);
      const flick = reduceMotion ? 1 : 0.9 + 0.07 * Math.sin(t * 7.3 + k * 1.7) + 0.04 * Math.sin(t * 12.7 + k);
      l.intensity = 9 * flick * (1 - smoothstep(18, 32, Math.sqrt(s.d)));
    });

    // Kharun's windows shift through their colours
    IRI.forEach((m, k) => m.emissive.setHSL((t * 0.04 + k * 0.33) % 1, 0.75, 0.55));
    for (const i of iriIdx) glassMesh.setColorAt(i, iriCol.setHSL((t * 0.05 + i * 0.1) % 1, 0.7, 0.6));
    if (iriIdx.length) glassMesh.instanceColor.needsUpdate = true;
    if (beam) beam.rotation.y = t * 0.35;

    for (const s of wisps) { const u = s.userData; s.position.x = u.x + Math.sin(t * u.sp + u.ph) * 3; }
    for (const s of smoke) {
      const u = s.userData, k = (u.t + t * 0.06) % 1;
      s.position.set(u.base.x + k * 2.2 + Math.sin(t * 0.7 + u.t * 6) * 0.3, u.base.y + k * 7, u.base.z);
      s.scale.setScalar(0.8 + k * 3.6);
      s.material.opacity = reduceMotion ? 0 : Math.sin(k * Math.PI) * 0.16;
    }

    updateLabels();
    composer.render();

    if (!perf.checked && root.classList.contains('world-ready')) {
      perf.n++; perf.sum += dt;
      if (perf.n === 150) { perf.checked = true; if (perf.sum / perf.n > 0.042 && (bloom.enabled || Q.shadows)) degrade(); }
    }
  }
  function degrade() {
    bloom.enabled = false;
    if (Q.shadows) { Q.shadows = false; renderer.shadowMap.enabled = false; moonLight.castShadow = false; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); }
    renderer.setPixelRatio(1); composer.setPixelRatio(1); resize();
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    walkFov = clamp(lerp(60, 74, smoothstep(1.2, 0.55, camera.aspect)), 56, 76);
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    const px = h * renderer.getPixelRatio();
    snow.material.uniforms.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(walkFov) / 2));
    lanternGlow.material.uniforms.uScale.value = px / 2;
    motes.material.uniforms.uScale.value = px / 2;
    if (mode === 'scroll') applyScrollPose();
    paintOnce = true;
  }
  buildIntro();
  S.shown = S.progress;
  resize();
  addEventListener('resize', resize);
  screen.orientation?.addEventListener?.('change', () => setTimeout(resize, 120));
  requestAnimationFrame(frame);
  void terrainMesh; void thresholdVeil;

  /* ── what the page can ask of the world ── */
  const api = {
    tier,
    settle() { return new Promise(res => { const t0 = performance.now(); const chk = () => (Math.abs(S.shown - S.progress) < 0.0015 || performance.now() - t0 > 1800) ? res() : requestAnimationFrame(chk); chk(); }); },
    snap() { flight = null; mode = 'scroll'; travelLabel = null; hovered = null; S.shown = S.progress; applyScrollPose(); paintOnce = true; },
    travelIn, travelOut,
    flying: () => mode === 'flight',
    skip() { if (flight) flight.t0 = Math.min(flight.t0, performance.now() - flight.dur * 0.9); },
    jumpToDoor(id) {
      const { curve, doorLook } = route(id);
      mode = 'door';
      curve.getPointAt(1, camera.position); look.copy(doorLook); camera.lookAt(look);
      paintOnce = true;
    },
    pause(v) { paused = v; if (!v) { last = performance.now(); paintOnce = true; } else paintOnce = true; },
  };
  if (new URLSearchParams(location.search).has('debug')) {
    window.__forest = { peek(id) { const R = route(id); mode = 'door'; camera.position.copy(R.over); look.copy(R.focus); camera.lookAt(look); camera.fov = walkFov; camera.updateProjectionMatrix(); paintOnce = true; } };
  }
  if (S.openId) { setVeil(1); api.jumpToDoor(S.openId); api.pause(true); }
  return api;
}

/* ──────────────────────────────────────────────────────────
   8. START-UP
   ────────────────────────────────────────────────────────── */
function showNotice(text) {
  const n = $('.loader');
  $('.loader-text', n).textContent = text;
  n.classList.add('notice');
  setTimeout(() => n.classList.remove('notice'), 7000);
}

function startWorld() {
  if (S.world || S.loading) return S.loading;
  $('.loader-text').textContent = 'Growing the forest…';
  S.loading = loadWorld().then(api => {
    S.world = api;
    S.shown = S.progress;
    if (!isWorld()) api.pause(true);
    return nextFrame().then(() => { root.classList.add('world-ready'); $('.loader-text').textContent = 'The forest is ready'; });
  }).catch(err => {
    console.error(err);
    S.world = null;
    if (S.openId) hidePanel(S.openId);
    root.classList.remove('world-mode', 'world-ready', 'has-webgl');
    setVeil(0);
    setBook(panels.books.dataset.book || 'amber');
    applyInert();
    showNotice('The 3D forest could not load here — showing the simple page.');
  }).finally(() => { S.loading = null; });
  return S.loading;
}

async function start() {
  setBook('amber');
  readProgress();
  updateRoadUI();
  applyInert();

  const hash = decodeURIComponent(location.hash.slice(1));
  const id = DEST_IDS.find(k => DESTS[k].slug === hash || (!DESTS[k].book && DESTS[k].panel === hash));
  if (isWorld() && id) {
    await scrollToProgress(DESTS[id].p, 0);
    S.shown = S.progress;
    setVeil(1);
    showPanel(id);
  } else if (isWorld() && hash === 'books') {
    await scrollToProgress(STOPS.find(s => s.key === 'books').p, 0);
  }

  if (isWorld()) startWorld();
  else if (hasWebGL()) {
    // quietly fetch the 3D code so switching to the forest view is quick
    const idle = window.requestIdleCallback || (f => setTimeout(f, 2500));
    idle(() => { import('three').catch(() => {}); });
  }
}

start();
