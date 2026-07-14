/* ============================================================
   RAFSAN ISDANI — Showcase Portfolio JS
   ============================================================
   1. Circuit-grid canvas animation (coffee tones)
   2. Mobile nav toggle
   3. Navbar scroll + active section
   4. Smooth scroll
   5. Scroll-triggered reveals
   6. Expandable cards (Journey, Skills, Projects)
   7. Skill bar animation
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ──────────────────────────────────────────────────────────
     1. CIRCUIT CANVAS (coffee palette)
     ────────────────────────────────────────────────────────── */
  const canvas = document.getElementById('gridCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let w, h, nodes = [], edges = [];

    function resize() {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      buildGrid();
    }

    function buildGrid() {
      nodes = []; edges = [];
      const sp = 90;
      const cols = Math.ceil(w / sp) + 1;
      const rows = Math.ceil(h / sp) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.5) {
            nodes.push({
              x: c * sp + (Math.random() - 0.5) * 24,
              y: r * sp + (Math.random() - 0.5) * 24,
              r: Math.random() * 1.8 + 0.8,
              p: Math.random() * Math.PI * 2,
              s: 0.008 + Math.random() * 0.015
            });
          }
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < sp * 1.5 && Math.random() > 0.65) {
            edges.push([i, j]);
          }
        }
      }
    }

    let raf;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(212,165,116,0.06)';
      ctx.lineWidth = 1;
      edges.forEach(([a, b]) => {
        ctx.beginPath();
        ctx.moveTo(nodes[a].x, nodes[a].y);
        ctx.lineTo(nodes[a].x, nodes[b].y);
        ctx.lineTo(nodes[b].x, nodes[b].y);
        ctx.stroke();
      });
      nodes.forEach(n => {
        n.p += n.s;
        const alpha = 0.12 + Math.sin(n.p) * 0.08;
        ctx.fillStyle = `rgba(212,165,116,${alpha})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    }

    resize(); draw();
    window.addEventListener('resize', () => { cancelAnimationFrame(raf); resize(); draw(); });
  }

  /* ──────────────────────────────────────────────────────────
     2. MOBILE NAV
     ────────────────────────────────────────────────────────── */
  const toggle = document.getElementById('navToggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => { toggle.classList.toggle('open'); links.classList.toggle('open'); });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { toggle.classList.remove('open'); links.classList.remove('open'); }));
  }

  /* ──────────────────────────────────────────────────────────
     3. NAVBAR SCROLL + ACTIVE SECTION
     ────────────────────────────────────────────────────────── */
  const nav = document.getElementById('navbar');
  const secs = document.querySelectorAll('section[id]');
  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', scrollY > 50);
    let cur = '';
    secs.forEach(s => { if (scrollY >= s.offsetTop - 140) cur = s.id; });
    if (links) links.querySelectorAll('a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ──────────────────────────────────────────────────────────
     4. SMOOTH SCROLL
     ────────────────────────────────────────────────────────── */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const t = document.querySelector(a.getAttribute('href'));
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth' }); }
    });
  });

  /* ──────────────────────────────────────────────────────────
     5. SCROLL REVEALS
     ────────────────────────────────────────────────────────── */
  const anims = document.querySelectorAll('[data-anim]');
  if ('IntersectionObserver' in window) {
    let stagger = 0;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), stagger * 60);
          stagger++;
          obs.unobserve(entry.target);
          setTimeout(() => { stagger = 0; }, 500);
        }
      });
    }, { threshold: 0.1 });
    anims.forEach(el => obs.observe(el));
  } else {
    anims.forEach(el => el.classList.add('visible'));
  }

  /* ──────────────────────────────────────────────────────────
     6. EXPANDABLE CARDS
     ────────────────────────────────────────────────────────── */
  document.querySelectorAll('[data-expand]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      card.classList.toggle('expanded');

      if (card.classList.contains('expanded')) {
        card.querySelectorAll('.bar-fill').forEach(bar => {
          bar.style.width = bar.dataset.level + '%';
        });
      }
    });
  });

  /* ──────────────────────────────────────────────────────────
     7. SKILL BAR FILL (standalone bars triggered by scroll)
     ────────────────────────────────────────────────────────── */
  const standaloneBars = document.querySelectorAll('.bar-fill:not([data-expand] .bar-fill)');
  if ('IntersectionObserver' in window && standaloneBars.length) {
    const bObs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.width = entry.target.dataset.level + '%';
          bObs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.25 });
    standaloneBars.forEach(b => bObs.observe(b));
  }

});
