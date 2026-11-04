/* 叶志汉 · 个人博客 —— 交互脚本（无依赖） */
(() => {
  'use strict';

  const root = document.documentElement;
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ---------- 主题 ---------- */
  const themeKey = 'theme';
  $$('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem(themeKey, next); } catch (e) { /* 忽略 */ }
      window.dispatchEvent(new CustomEvent('themechange'));
    });
  });

  // 跟随系统（用户没手动选过时）
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener?.('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(themeKey); } catch (err) { /* 忽略 */ }
    if (!saved) root.dataset.theme = e.matches ? 'dark' : 'light';
  });

  /* ---------- 顶栏与阅读进度 ---------- */
  const head = $('[data-head]');
  const bar = $('[data-progress]');
  const prose = $('[data-prose]');
  let ticking = false;

  function onFrame() {
    const y = window.scrollY;
    if (head) head.classList.toggle('is-stuck', y > 6);
    if (bar && prose) {
      const start = prose.offsetTop - 140;
      const total = Math.max(1, prose.offsetHeight);
      const p = Math.min(1, Math.max(0, (y - start) / total));
      bar.style.transform = `scaleX(${p})`;
    }
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(onFrame);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onFrame();

  /* ---------- 目录跟随 ---------- */
  const tocLinks = $$('.toc a');
  if (tocLinks.length && prose) {
    const map = new Map();
    tocLinks.forEach((a) => {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      const el = document.getElementById(id);
      if (el) map.set(el, a);
    });
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? visible.add(en.target) : visible.delete(en.target)));
      tocLinks.forEach((a) => a.classList.remove('is-active'));
      const ordered = [...map.keys()].filter((el) => visible.has(el));
      const target = ordered[0] || null;
      if (target) map.get(target).classList.add('is-active');
    }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 });
    map.forEach((_, el) => io.observe(el));
  }

  /* ---------- 复制代码 ---------- */
  $$('.code-block').forEach((block) => {
    const btn = $('.copy-btn', block);
    const code = $('code', block);
    if (!btn || !code) return;
    btn.addEventListener('click', async () => {
      const text = code.innerText;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      btn.textContent = '已复制';
      btn.classList.add('is-done');
      setTimeout(() => {
        btn.textContent = '复制';
        btn.classList.remove('is-done');
      }, 1600);
    });
  });

  /* ---------- 搜索面板 ---------- */
  const palette = $('[data-palette]');
  if (palette) {
    const input = $('[data-palette-input]', palette);
    const list = $('[data-palette-list]', palette);
    const empty = $('[data-palette-empty]', palette);
    let index = null;
    let loading = null;
    let results = [];
    let active = 0;

    const load = () => {
      if (!index) {
        loading = loading || fetch(palette.dataset.index || 'search.json')
          .then((r) => r.json())
          .catch(() => []);
        index = loading;
      }
      return index;
    };

    function render(items) {
      results = items;
      active = 0;
      list.innerHTML = items.map((p, i) => `
        <li${i === 0 ? ' class="is-active"' : ''}>
          <a href="${p.url}">
            <span class="p-title">${escapeHtml(p.title)}</span>
            <span class="p-meta">${p.date}${p.tags.length ? ' · ' + p.tags.map(escapeHtml).join(' / ') : ''}</span>
          </a>
        </li>`).join('');
      empty.hidden = items.length > 0;
      list.hidden = items.length === 0;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function search(q) {
      const query = q.trim().toLowerCase();
      if (!query) return index.slice(0, 5);
      const words = query.split(/\s+/).filter(Boolean);
      return index
        .map((p) => {
          const title = p.title.toLowerCase();
          const tags = p.tags.join(' ').toLowerCase();
          const desc = (p.desc || '').toLowerCase();
          const text = (p.text || '').toLowerCase();
          let score = 0;
          for (const w of words) {
            let s = 0;
            if (title.includes(w)) s += 12;
            if (tags.includes(w)) s += 6;
            if (desc.includes(w)) s += 4;
            if (text.includes(w)) s += 2;
            if (!s) return null;
            score += s;
          }
          return { p, score };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((x) => x.p);
    }

    function paint() {
      $$('li', list).forEach((li, i) => li.classList.toggle('is-active', i === active));
      const el = list.children[active];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      palette.hidden = false;
      document.body.style.overflow = 'hidden';
      input.value = '';
      input.focus();
      load().then((idx) => { index = Array.isArray(idx) ? idx : []; render(index.slice(0, 5)); });
    }

    function close() {
      palette.hidden = true;
      document.body.style.overflow = '';
    }

    $('[data-palette-close]', palette)?.addEventListener('click', close);
    $$('[data-search]').forEach((btn) => btn.addEventListener('click', open));

    input.addEventListener('input', () => {
      if (!Array.isArray(index)) return;
      render(search(input.value));
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        active = (active + 1) % Math.max(1, results.length);
        paint();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active - 1 + results.length) % Math.max(1, results.length);
        paint();
      } else if (e.key === 'Enter') {
        const p = results[active];
        if (p) window.location.href = p.url;
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (palette.hidden) {
        if (e.key === '/' && !typing) {
          e.preventDefault();
          open();
        } else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          open();
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });
  }
})();
