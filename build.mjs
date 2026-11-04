import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import site from './site.config.mjs';

// 部署时可以用环境变量覆盖，避免为了换域名改代码：
//   BASE=/blog/  ORIGIN=https://example.com  node build.mjs
if (process.env.BASE) site.base = process.env.BASE;
if (process.env.ORIGIN) site.origin = process.env.ORIGIN;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const BASE = site.base.endsWith('/') ? site.base : site.base + '/';
const u = (p = '') => BASE + String(p).replace(/^\/+/, '');

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
const stripTags = (s) => String(s).replace(/<[^>]*>/g, '');

function slugify(text) {
  const s = stripTags(text)
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\p{L}\p{N}\-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'section';
}

function fixSrc(src, ctx) {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  // 文章里习惯写 /images/xxx，实际资源统一放在 assets/ 下
  if (src.startsWith('/images/')) return u('assets/' + src.slice('/images/'.length));
  if (src.startsWith('/')) return u(src);
  return ctx.rel + src.replace(/^\.\//, '');
}

function readTime(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]{2,}/g) || []).length;
  const minutes = Math.max(1, Math.round(cjk / 380 + latin / 200));
  return minutes;
}

const fmtDate = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const fmtDateLong = (d) => `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;

/* ------------------------------------------------------------------ *
 * Markdown：够用就好的一小套语法
 * ------------------------------------------------------------------ */

const LANG_ALIAS = {
  js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash',
  yml: 'yaml', md: 'markdown', text: 'plaintext', cpp: 'cpp', c: 'c',
};

function inline(text, ctx) {
  if (!text) return '';
  const codes = [];
  const maths = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/(\$\$[^$]+\$\$|\$(?!\$)[^$\n]+?\$)/g, (m) => {
    if (m.startsWith('$$')) return `\u0001D${maths.push(m.slice(2, -2)) - 1}\u0001`;
    return `\u0001I${maths.push(m.slice(1, -1)) - 1}\u0001`;
  });
  s = esc(s);

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) => `<img src="${fixSrc(src, ctx)}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy" decoding="async">`);
  s = s.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, label, href, title) => {
    const external = /^(https?:)?\/\//.test(href);
    return `<a href="${fixSrc(href, ctx)}"${title ? ` title="${title}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<）)]+)/g, (m, pre, link) => `${pre}<a href="${link}" target="_blank" rel="noopener">${link}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  s = s.replace(/==([^=\n]+)==/g, '<mark>$1</mark>');

  s = s.replace(/\u0001D(\d+)\u0001/g, (_, n) => `<div class="math-display">$$${esc(maths[n])}$$</div>`);
  s = s.replace(/\u0001I(\d+)\u0001/g, (_, n) => `<span class="math-inline">$${esc(maths[n])}$</span>`);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[n])}</code>`);
  return s;
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function buildList(items, ctx) {
  let html = '';
  const stack = [];
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
    if (stack.length && it.indent === stack[stack.length - 1].indent) {
      if (stack[stack.length - 1].tag !== tag) html += `</li></${stack.pop().tag}>`;
      else html += '</li>';
    }
    if (!stack.length || it.indent > stack[stack.length - 1].indent) {
      html += `<${tag}>`;
      stack.push({ indent: it.indent, tag });
    }
    html += `<li>${inline(it.text, ctx)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function renderBlocks(lines, ctx) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 围栏代码块
    const fence = line.match(/^(\s*)```+\s*([\w+-]*)\s*$/);
    if (fence) {
      const langRaw = (fence[2] || '').toLowerCase();
      const lang = LANG_ALIAS[langRaw] || langRaw;
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const label = langRaw || 'text';
      out.push(
        `<div class="code-block" data-lang="${esc(label)}"><button class="copy-btn" type="button" aria-label="复制代码">复制</button>` +
        `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre></div>`
      );
      continue;
    }

    // 独立公式块
    if (/^\s*\$\$\s*$/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*\$\$\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<div class="math-display">$$${esc(buf.join('\n'))}$$</div>`);
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slugify(text);
      if (level === 2 || level === 3) ctx.toc.push({ level, id, text: stripTags(inline(text, ctx)) });
      out.push(`<h${level} id="${ctx.prefix}${id}">${inline(text, ctx)}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^\s*>/.test(lines[i]) || (buf.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|\|)/.test(lines[i])))) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(buf, ctx)}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = parseTableRow(line);
      const align = parseTableRow(lines[i + 1]).map((c) => {
        if (/^:-+:$/.test(c)) return 'center';
        if (/^-+:$/.test(c)) return 'right';
        return '';
      });
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      const th = head.map((c, k) => `<th${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, ctx)}</th>`).join('');
      const tb = rows.map((r) => `<tr>${head.map((_, k) => `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(r[k] ?? '', ctx)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    // 列表
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3] });
          i++;
        } else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else break;
      }
      out.push(buildList(items, ctx));
      continue;
    }

    // 原始 HTML 块
    if (/^\s*<(figure|div|iframe|video|details|table|p|section|img)/i.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]) && !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    const para = buf.join('\n');
    const imgOnly = para.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (imgOnly) {
      const [, alt, src, title] = imgOnly;
      out.push(`<figure><img src="${fixSrc(src, ctx)}" alt="${esc(alt)}" loading="lazy" decoding="async"><figcaption>${esc(alt)}${title ? ` · ${esc(title)}` : ''}</figcaption></figure>`);
    } else {
      out.push(`<p>${inline(para.replace(/\n/g, '<br>'), ctx)}</p>`);
    }
  }

  return out.join('\n');
}

function parseFrontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  let currentKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      currentKey = key;
      if (!value.trim()) { data[key] = []; continue; }
      if (/^\[.*\]$/.test(value.trim())) {
        data[key] = value.trim().slice(1, -1).split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        data[key] = value.trim().replace(/^["']|["']$/g, '');
      }
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return { data, body: raw.slice(m[0].length) };
}

/* ------------------------------------------------------------------ *
 * 读取内容
 * ------------------------------------------------------------------ */

const postsDir = path.join(ROOT, 'content/posts');
const pagesDir = path.join(ROOT, 'content/pages');

function loadPost(file) {
  const raw = fs.readFileSync(path.join(postsDir, file), 'utf8').replace(/^\uFEFF/, '');
  const { data, body } = parseFrontMatter(raw);
  const date = new Date(data.date || fs.statSync(path.join(postsDir, file)).mtime);
  const slug = data.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const ctx = { toc: [], rel: u(`posts/${slug}/`), prefix: '' };
  const cleanBody = body.replace(/<!--\s*more\s*-->/g, '');
  const html = renderBlocks(cleanBody.split(/\r?\n/), ctx);
  const plain = cleanBody.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#>*`|]/g, ' ');
  return {
    slug,
    title: data.title || slug,
    description: data.description || '',
    date,
    updated: data.updated ? new Date(data.updated) : null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    cover: data.cover || '',
    draft: data.draft === true || data.draft === 'true',
    html,
    toc: ctx.toc,
    minutes: readTime(cleanBody),
    plain: plain.replace(/\s+/g, ' ').trim(),
    hasMath: /\$[^$\n]+\$/.test(cleanBody.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')),
  };
}

const posts = fs.readdirSync(postsDir)
  .filter((f) => f.endsWith('.md'))
  .map(loadPost)
  .filter((p) => !p.draft)
  .sort((a, b) => b.date - a.date);

const tagMap = new Map();
for (const p of posts) for (const t of p.tags) {
  if (!tagMap.has(t)) tagMap.set(t, []);
  tagMap.get(t).push(p);
}
const tags = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh'));

/* ------------------------------------------------------------------ *
 * 模板
 * ------------------------------------------------------------------ */

const cssVer = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'src/styles.css'))).digest('hex').slice(0, 8);
const jsVer = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'src/app.js'))).digest('hex').slice(0, 8);

const ICONS = {
  search: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  rss: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 19a1 1 0 1 0 0-.01"/><path d="M5 13a6 6 0 0 1 6 6M5 7a12 12 0 0 1 12 12"/></svg>',
};

const themeScript = `<script>(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})();</script>`;

function header(active) {
  const nav = [
    ['/', '文章', 'index'],
    ['/archive/', '归档', 'archive'],
    ['/tags/', '标签', 'tags'],
    ['/about/', '关于', 'about'],
  ].map(([href, label, key]) => `<a href="${u(href)}"${active === key ? ' class="is-active" aria-current="page"' : ''}>${label}</a>`).join('');

  return `<header class="site-head" data-head>
  <div class="wrap head-inner">
    <a class="brand" href="${u('/')}" aria-label="返回首页">
      <span class="brand-mark">叶</span>
      <span class="brand-text">${esc(site.title)}<em>${esc(site.handle)}</em></span>
    </a>
    <nav class="nav" aria-label="主导航">${nav}</nav>
    <div class="head-tools">
      <button class="icon-btn" type="button" data-search aria-label="搜索文章（快捷键 /）" title="搜索文章（/）">${ICONS.search}</button>
      <button class="icon-btn" type="button" data-theme-toggle aria-label="切换深浅色" title="切换深浅色">
        <span class="when-light">${ICONS.moon}</span><span class="when-dark">${ICONS.sun}</span>
      </button>
    </div>
  </div>
</header>`;
}

function footer() {
  const socials = site.socials.filter((s) => s.href).map((s) => `<a href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('');
  return `<footer class="site-foot">
  <div class="wrap foot-inner">
    <div class="foot-left">
      <p class="foot-sign">© ${new Date().getFullYear()} ${esc(site.title)}</p>
      <p class="foot-note">纯手工静态站 · 由 200 行 Node 脚本从 Markdown 生成</p>
    </div>
    <div class="foot-links">
      <a href="${u('rss.xml')}">${ICONS.rss}RSS</a>
      <a href="mailto:${esc(site.email)}">邮箱</a>
      ${socials}
    </div>
  </div>
</footer>`;
}

function searchOverlay() {
  return `<div class="palette" data-palette data-index="${u('search.json')}" hidden>
  <div class="palette-backdrop" data-palette-close></div>
  <div class="palette-panel" role="dialog" aria-modal="true" aria-label="搜索文章">
    <div class="palette-input">
      ${ICONS.search}
      <input type="search" data-palette-input placeholder="搜索标题、标签或正文…" autocomplete="off" spellcheck="false">
      <kbd>Esc</kbd>
    </div>
    <ul class="palette-list" data-palette-list></ul>
    <p class="palette-empty" data-palette-empty hidden>没有找到相关文章</p>
    <div class="palette-foot"><span>↑ ↓ 选择</span><span>↵ 打开</span><span>Esc 关闭</span></div>
  </div>
</div>`;
}

function layout({ title, description, content, active = '', bodyClass = '', math = false, canonical = '/', headExtra = '' }) {
  const fullTitle = title ? `${title} · ${site.title}` : `${site.title} · ${site.tagline}`;
  return `<!doctype html>
<html lang="${site.lang}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<meta name="author" content="${esc(site.title)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || site.description)}">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:url" content="${esc(site.origin + u(canonical))}">
<link rel="canonical" href="${esc(site.origin + u(canonical))}">
<link rel="alternate" type="application/rss+xml" title="${esc(site.title)}" href="${u('rss.xml')}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c1a17"/><text x="16" y="22" font-family="serif" font-size="18" fill="#f6f2ea" text-anchor="middle">叶</text></svg>`)}">
${themeScript}
<link rel="stylesheet" href="${u(`assets/styles.css?v=${cssVer}`)}">
${math ? `<link rel="stylesheet" href="${u('vendor/katex/katex.min.css')}">` : ''}
${headExtra}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">跳到正文</a>
${header(active)}
<main id="main">${content}</main>
${footer()}
${searchOverlay()}
<script src="${u(`assets/app.js?v=${jsVer}`)}" defer></script>
${math ? `<script src="${u('vendor/katex/katex.min.js')}" defer></script>
<script src="${u('vendor/katex/auto-render.min.js')}" defer></script>
<script src="${u('assets/math.js')}" defer></script>` : ''}
</body>
</html>`;
}

function tagLinks(list, { limit = 3 } = {}) {
  return list.slice(0, limit).map((t) => `<a class="tag" href="${u(`tags/${slugify(t)}/`)}">${esc(t)}</a>`).join('');
}

function postRow(p, n) {
  return `<article class="post-row">
    <div class="row-meta">
      <span class="row-num">${String(n).padStart(2, '0')}</span>
      <time datetime="${p.date.toISOString()}">${fmtDate(p.date)}</time>
    </div>
    <div class="row-body">
      <h2 class="row-title"><a href="${u(`posts/${p.slug}/`)}">${esc(p.title)}</a></h2>
      <p class="row-desc">${esc(p.description)}</p>
      <div class="row-tags">${tagLinks(p.tags)}<span class="row-dot">·</span><span class="row-time">${p.minutes} 分钟</span></div>
    </div>
    <span class="row-arrow" aria-hidden="true">${ICONS.arrow}</span>
  </article>`;
}

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

const latest = posts.slice(0, 5);
const allTags = tags.length;

const homeContent = `<section class="hero">
  <div class="wrap">
    <p class="eyebrow"><span class="eyebrow-dot"></span>${esc(site.hero.eyebrow)}</p>
    <h1 class="hero-title">${site.hero.title}</h1>
    <p class="hero-lede">${esc(site.hero.lede)}</p>
    <div class="hero-meta">
      <span><strong>${posts.length}</strong> 篇文章</span>
      <span><strong>${allTags}</strong> 个标签</span>
      <span>最近更新 <strong>${latest[0] ? fmtDate(latest[0].date) : '—'}</strong></span>
    </div>
  </div>
</section>

<section class="wrap section" id="writing">
  <div class="section-head">
    <h2 class="section-title">近期文章</h2>
    <a class="more" href="${u('archive/')}">全部文章 ${ICONS.arrow}</a>
  </div>
  <div class="post-list">
    ${latest.map((p, i) => postRow(p, i + 1)).join('\n    ')}
  </div>
</section>

<section class="wrap section now-band">
  <div class="now-inner">
    <p class="eyebrow"><span class="eyebrow-dot"></span>Now</p>
    <p class="now-text">${esc(site.now)}</p>
    <div class="now-links">
      <a class="link-arrow" href="${u('about/')}">关于我 ${ICONS.arrow}</a>
      <a class="link-arrow" href="${u('rss.xml')}">订阅 RSS ${ICONS.arrow}</a>
    </div>
  </div>
</section>`;

const archiveContent = `<section class="wrap page-head">
  <p class="eyebrow"><span class="eyebrow-dot"></span>Archive</p>
  <h1 class="page-title">全部文章</h1>
  <p class="page-lede">共 ${posts.length} 篇。按时间倒序排列，${tags.length} 个标签可以在<a href="${u('tags/')}">标签页</a>里翻。</p>
</section>
<section class="wrap section archive">
  ${[...new Set(posts.map((p) => p.date.getFullYear()))].map((year) => {
    const group = posts.filter((p) => p.date.getFullYear() === year);
    return `<div class="year-block">
    <h2 class="year-label">${year}<span>${group.length}</span></h2>
    <ul class="year-list">
      ${group.map((p) => `<li>
        <a href="${u(`posts/${p.slug}/`)}">
          <span class="li-date">${String(p.date.getMonth() + 1).padStart(2, '0')}.${String(p.date.getDate()).padStart(2, '0')}</span>
          <span class="li-title">${esc(p.title)}</span>
          <span class="li-tags">${p.tags.slice(0, 2).join(' · ')}</span>
        </a>
      </li>`).join('\n      ')}
    </ul>
  </div>`;
  }).join('\n  ')}
</section>`;

const tagsContent = `<section class="wrap page-head">
  <p class="eyebrow"><span class="eyebrow-dot"></span>Tags</p>
  <h1 class="page-title">标签</h1>
  <p class="page-lede">${tags.length} 个标签，点进去是相关的全部文章。</p>
</section>
<section class="wrap section">
  <div class="tag-grid">
    ${tags.map(([t, list]) => `<a class="tag-card" href="${u(`tags/${slugify(t)}/`)}">
      <span class="tag-card-head"><span class="tag-name">${esc(t)}</span><em>${list.length}</em></span>
      <span class="tag-card-posts">${list.slice(0, 2).map((p) => esc(p.title)).join('<br>')}</span>
      <span class="tag-card-arrow">${ICONS.arrow}</span>
    </a>`).join('\n    ')}
  </div>
</section>`;

function postPage(p, index) {
  const prev = posts[index + 1];
  const next = posts[index - 1];
  const tocHtml = p.toc.length >= 2
    ? `<aside class="toc" data-toc><p class="toc-title">本文目录</p><ul>${p.toc.map((t) => `<li class="lvl-${t.level}"><a href="#${t.prefix}${t.id}">${esc(t.text)}</a></li>`).join('')}</ul></aside>`
    : '';

  return `<div class="reading-bar" data-progress></div>
<article class="wrap post">
  <header class="post-head">
    <p class="post-kicker">
      <time datetime="${p.date.toISOString()}">${fmtDateLong(p.date)}</time>
      <span class="dot">·</span><span>约 ${p.minutes} 分钟</span>
      ${p.tags.length ? `<span class="dot">·</span>${p.tags.map((t) => `<a href="${u(`tags/${slugify(t)}/`)}">${esc(t)}</a>`).join('<span class="sep">/</span>')}` : ''}
    </p>
    <h1 class="post-title">${esc(p.title)}</h1>
    ${p.description ? `<p class="post-lead">${esc(p.description)}</p>` : ''}
  </header>
  ${p.cover ? `<figure class="post-cover"><img src="${fixSrc(p.cover, { rel: u(`posts/${p.slug}/`) })}" alt="" loading="eager" decoding="async"></figure>` : ''}
  <div class="post-layout">
    <div class="prose" data-prose data-toc-source>${p.html}</div>
    ${tocHtml}
  </div>
  <footer class="post-foot">
    <div class="post-tags">${tagLinks(p.tags, { limit: 8 })}</div>
    <nav class="post-nav">
      ${prev ? `<a class="nav-prev" href="${u(`posts/${prev.slug}/`)}"><span>← 上一篇</span><strong>${esc(prev.title)}</strong></a>` : '<span></span>'}
      ${next ? `<a class="nav-next" href="${u(`posts/${next.slug}/`)}"><span>下一篇 →</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
    </nav>
  </footer>
</article>`;
}

function tagPage(name, list) {
  return `<section class="wrap page-head">
  <p class="eyebrow"><span class="eyebrow-dot"></span>Tag</p>
  <h1 class="page-title">${esc(name)}</h1>
  <p class="page-lede">共 ${list.length} 篇 · <a href="${u('tags/')}">返回全部标签</a></p>
</section>
<section class="wrap section post-list">
  ${list.map((p, i) => postRow(p, i + 1)).join('\n  ')}
</section>`;
}

/* ------------------------------------------------------------------ *
 * 写入
 * ------------------------------------------------------------------ */

function writeFile(rel, content) {
  const target = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

fs.rmSync(DIST, { recursive: true, force: true });

writeFile('index.html', layout({
  content: homeContent,
  active: 'index',
  bodyClass: 'page-home',
  canonical: '/',
}));

writeFile('archive/index.html', layout({
  title: '归档',
  description: `全部 ${posts.length} 篇文章，按时间倒序。`,
  content: archiveContent,
  active: 'archive',
  bodyClass: 'page-archive',
  canonical: 'archive/',
}));

writeFile('tags/index.html', layout({
  title: '标签',
  description: '按标签浏览文章。',
  content: tagsContent,
  active: 'tags',
  bodyClass: 'page-tags',
  canonical: 'tags/',
}));

for (const [name, list] of tags) {
  writeFile(`tags/${slugify(name)}/index.html`, layout({
    title: `标签：${name}`,
    description: `标签 ${name} 下的 ${list.length} 篇文章。`,
    content: tagPage(name, list),
    active: 'tags',
    bodyClass: 'page-tag',
    canonical: `tags/${slugify(name)}/`,
  }));
}

posts.forEach((p, i) => {
  writeFile(`posts/${p.slug}/index.html`, layout({
    title: p.title,
    description: p.description,
    content: postPage(p, i),
    active: 'index',
    bodyClass: 'page-post',
    math: p.hasMath,
    canonical: `posts/${p.slug}/`,
  }));
});

// 关于页
const aboutRaw = fs.readFileSync(path.join(pagesDir, 'about.md'), 'utf8').replace(/^\uFEFF/, '');
const aboutParsed = parseFrontMatter(aboutRaw);
const aboutCtx = { toc: [], rel: u('about/'), prefix: '' };
const aboutHtml = renderBlocks(aboutParsed.body.split(/\r?\n/), aboutCtx);
const contact = `<div class="contact-card">
  <p class="eyebrow"><span class="eyebrow-dot"></span>Contact</p>
  <p>想聊推理优化、聊比赛，或者只是指出文中的错误，都欢迎来信。</p>
  <a class="mailto" href="mailto:${esc(site.email)}">${esc(site.email)}</a>
  <div class="contact-links">
    ${site.socials.filter((s) => s.href).map((s) => `<a href="${esc(s.href)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join('')}
    <a href="${u('rss.xml')}">RSS</a>
  </div>
</div>`;

writeFile('about/index.html', layout({
  title: '关于',
  description: aboutParsed.data.description || `关于 ${site.title}`,
  content: `<section class="wrap about-shell">
  <div class="page-head">
    <p class="eyebrow"><span class="eyebrow-dot"></span>About</p>
    <h1 class="page-title">${esc(aboutParsed.data.title || '关于')}</h1>
  </div>
  <div class="post-layout about-layout">
    <div class="prose">${aboutHtml}</div>
    <aside class="about-aside">${contact}</aside>
  </div>
</section>`,
  active: 'about',
  bodyClass: 'page-about',
  canonical: 'about/',
}));

writeFile('404.html', layout({
  title: '页面不存在',
  description: '这个地址好像没有内容。',
  content: `<section class="wrap notfound">
  <p class="nf-code">404</p>
  <h1>这一页还没写</h1>
  <p>你要找的地址不存在，或者已经被我改名了。</p>
  <div class="nf-actions">
    <a class="btn" href="${u('/')}">回到首页</a>
    <button class="btn btn-ghost" type="button" data-search>搜索一下</button>
  </div>
</section>`,
  canonical: '404.html',
}));

// 搜索索引
writeFile('search.json', JSON.stringify(posts.map((p) => ({
  title: p.title,
  url: u(`posts/${p.slug}/`),
  date: fmtDate(p.date),
  tags: p.tags,
  desc: p.description,
  text: p.plain.slice(0, 4000),
})), null, 0));

// RSS
const rssItems = posts.slice(0, 20).map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${site.origin}${u(`posts/${p.slug}/`)}</link>
      <guid isPermaLink="true">${site.origin}${u(`posts/${p.slug}/`)}</guid>
      <pubDate>${p.date.toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
      ${p.tags.map((t) => `<category>${esc(t)}</category>`).join('\n      ')}
    </item>`).join('\n');

writeFile('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.title)}</title>
    <link>${site.origin}${BASE}</link>
    <description>${esc(site.description)}</description>
    <language>${site.lang}</language>
    <atom:link href="${site.origin}${u('rss.xml')}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${rssItems}
  </channel>
</rss>
`);

// sitemap
const sitemapUrls = ['', 'archive/', 'tags/', 'about/', ...posts.map((p) => `posts/${p.slug}/`), ...tags.map(([t]) => `tags/${slugify(t)}/`)];
writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((s) => `  <url><loc>${site.origin}${u(s)}</loc></url>`).join('\n')}
</urlset>
`);

writeFile('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.origin}${u('sitemap.xml')}\n`);

// 静态资源
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/styles.css'), path.join(DIST, 'assets/styles.css'));
fs.copyFileSync(path.join(ROOT, 'src/app.js'), path.join(DIST, 'assets/app.js'));
fs.copyFileSync(path.join(ROOT, 'src/math.js'), path.join(DIST, 'assets/math.js'));

const assetsDir = path.join(ROOT, 'assets');
for (const f of fs.readdirSync(assetsDir)) {
  if (fs.statSync(path.join(assetsDir, f)).isFile()) fs.copyFileSync(path.join(assetsDir, f), path.join(DIST, 'assets', f));
}

const katexDir = path.join(ROOT, 'vendor/katex');
if (fs.existsSync(katexDir)) {
  fs.mkdirSync(path.join(DIST, 'vendor/katex'), { recursive: true });
  fs.cpSync(katexDir, path.join(DIST, 'vendor/katex'), { recursive: true });
}

console.log(`✓ 生成 ${posts.length} 篇文章 / ${tags.length} 个标签 → dist/`);
for (const p of posts) console.log(`  · ${fmtDate(p.date)}  ${p.title}  (${p.minutes} min${p.hasMath ? ', math' : ''})`);
