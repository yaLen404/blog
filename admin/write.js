/* 写作台：本地编辑 Markdown，保存即写回文件并重新构建 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    app: $('app'), posts: $('posts'), filter: $('filter'), empty: $('empty'), form: $('form'),
    title: $('f-title'), date: $('f-date'), tags: $('f-tags'), cover: $('f-cover'),
    toc: $('f-toc'), desc: $('f-desc'), body: $('f-body'), file: $('f-file'),
    dirty: $('dirty'), count: $('count'), toast: $('toast'),
    preview: $('preview'), frame: $('preview-frame'), openPost: $('open-post'),
    fileInput: $('file-input'), sideEmpty: $('side-empty'),
    siteform: $('siteform'), siteFields: $('siteform-fields'), siteDirty: $('site-dirty'),
  };

  let current = null; // { file, content }
  let dirty = false;
  let allPosts = [];
  let previewOpen = false;
  let tab = 'posts';
  let siteCopy = null;
  let siteDirty = false;

  /* ---------- 小工具 ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, isErr) {
    const t = els.toast;
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  const postJSON = (url, body) => api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /* ---------- front matter ---------- */
  const KNOWN_KEYS = new Set(['title', 'date', 'description', 'tags', 'cover', 'toc']);

  function parseFront(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const meta = { tags: [], toc: false, extra: [] };
    let body = raw;
    if (!m) return { meta, body };
    body = raw.slice(m[0].length);

    let block = [];
    let key = null;
    const flush = () => {
      if (block.length && key && !KNOWN_KEYS.has(key)) meta.extra.push(block.join('\n'));
      block = [];
    };

    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) {
        flush();
        key = kv[1];
        block = [line];
        const v = kv[2].trim().replace(/^["']|["']$/g, '');
        if (key === 'tags') meta.tags = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
        else if (key === 'toc') meta.toc = v === 'true';
        else if (KNOWN_KEYS.has(key)) meta[key] = v;
        continue;
      }
      if (!line.trim()) continue;
      block.push(line);
      const item = line.match(/^\s*-\s+(.*)$/);
      if (item && key === 'tags') meta.tags.push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
    flush();
    return { meta, body: body.replace(/^\r?\n/, '') };
  }

  function yamlValue(v) {
    const s = String(v || '').trim();
    if (!s) return '""';
    if (/^[\s"'#&*!|>%@`\-?:,[\]{}]/.test(s) || /:\s|#/.test(s)) return JSON.stringify(s);
    return s;
  }

  function serialize(meta, body) {
    const lines = ['---'];
    lines.push(`title: ${yamlValue(meta.title)}`);
    if (meta.date) lines.push(`date: ${meta.date}`);
    if (meta.description) lines.push(`description: ${yamlValue(meta.description)}`);
    if (meta.tags && meta.tags.length) {
      lines.push('tags:');
      meta.tags.forEach((t) => lines.push(`  - ${yamlValue(t)}`));
    }
    if (meta.cover) lines.push(`cover: ${yamlValue(meta.cover)}`);
    if (meta.toc) lines.push('toc: true');
    // 保留 keywords / categories / draft 等原有字段，避免编辑时丢信息
    (meta.extra || []).forEach((block) => lines.push(block));
    lines.push('---', '');
    return lines.join('\n') + body.replace(/^\n+/, '');
  }

  /* ---------- 时间 ---------- */
  const toInputDate = (s) => {
    const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    return m ? `${m[1]}T${m[2]}` : '';
  };
  const fromInputDate = (v) => {
    if (!v) return '';
    const [d, t] = v.split('T');
    return `${d} ${t || '00:00'}:00`;
  };
  const slugOf = (file) => file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');

  /* ---------- 站点文案 ---------- */
  const SITE_LABELS = {
    'site.title': '站点名',
    'site.handle': '英文名 / 副标题',
    'site.description': '站点描述（SEO / 分享卡片）',
    'site.tagline': '一句话标语',
    'site.email': '邮箱（留空则不显示）',
    'nav.posts': '导航 · 文章',
    'nav.archive': '导航 · 归档',
    'nav.tags': '导航 · 标签',
    'nav.about': '导航 · 关于',
    'home.eyebrow': '首页顶部小字',
    'home.title': '首页大标题',
    'home.lede': '首页介绍段',
    'home.statPosts': '统计 · 文章数',
    'home.statTags': '统计 · 标签数',
    'home.updated': '统计 · 最近更新',
    'home.recent': '版块标题 · 近期文章',
    'home.more': '链接 · 全部文章',
    'home.nowLabel': 'Now 小标题',
    'home.nowText': 'Now 正文',
    'home.nowAbout': 'Now 链接 · 关于我',
    'home.nowRss': 'Now 链接 · 订阅',
    'pages.archive.eyebrow': '归档页 · 小标题',
    'pages.archive.title': '归档页 · 标题',
    'pages.archive.lede': '归档页 · 说明（{n} = 篇数）',
    'pages.archive.tagsLink': '归档页 · 标签链接',
    'pages.archive.metaTitle': '归档页 · 浏览器标题',
    'pages.archive.metaDescription': '归档页 · 搜索摘要',
    'pages.tags.eyebrow': '标签页 · 小标题',
    'pages.tags.title': '标签页 · 标题',
    'pages.tags.lede': '标签页 · 说明（{n} = 标签数）',
    'pages.tags.metaTitle': '标签页 · 浏览器标题',
    'pages.tags.metaDescription': '标签页 · 搜索摘要',
    'pages.tag.eyebrow': '单标签页 · 小标题',
    'pages.tag.lede': '单标签页 · 说明（{n} = 篇数）',
    'pages.tag.back': '单标签页 · 返回链接',
    'pages.tag.metaTitle': '单标签页 · 浏览器标题（{name}）',
    'pages.tag.metaDescription': '单标签页 · 搜索摘要',
    'pages.about.eyebrow': '关于页 · 小标题',
    'pages.about.title': '关于页 · 标题',
    'pages.about.contactTitle': '关于页 · 联系卡片标题',
    'pages.about.contactLead': '关于页 · 有邮箱时',
    'pages.about.contactLeadNoEmail': '关于页 · 无邮箱时',
    'pages.about.metaDescription': '关于页 · 搜索摘要',
    'pages.post.minutes': '文章页 · 阅读时长（{n} = 分钟）',
    'pages.post.minutesShort': '列表页 · 阅读时长',
    'pages.post.toc': '文章页 · 目录标题',
    'pages.post.prev': '文章页 · 上一篇',
    'pages.post.next': '文章页 · 下一篇',
    'pages.post.dateFormat': '文章页 · 日期格式（{y} {m} {d}）',
    'pages.notFound.code': '404 · 大数字',
    'pages.notFound.title': '404 · 标题',
    'pages.notFound.text': '404 · 说明',
    'pages.notFound.home': '404 · 回首页按钮',
    'pages.notFound.search': '404 · 搜索按钮',
    'pages.notFound.metaTitle': '404 · 浏览器标题',
    'pages.notFound.metaDescription': '404 · 搜索摘要',
    'search.placeholder': '搜索框占位文字',
    'search.empty': '搜索无结果提示',
    'search.hintSelect': '搜索 · 选择提示',
    'search.hintOpen': '搜索 · 打开提示',
    'search.hintClose': '搜索 · 关闭提示',
    'search.dialogLabel': '搜索 · 无障碍名称',
    'footer.note': '页脚说明',
    'footer.rss': '页脚 · RSS',
    'footer.email': '页脚 · 邮箱',
    'meta.skip': '无障碍 · 跳到正文',
    'meta.brandAria': '无障碍 · 品牌链接',
    'meta.searchAria': '无障碍 · 搜索按钮',
    'meta.themeAria': '无障碍 · 主题按钮',
    'meta.navLabel': '无障碍 · 导航',
    'meta.titleTemplate': '浏览器标题格式（{page} · {site}）',
    'meta.copyCode': '代码块 · 复制按钮',
    'meta.copiedCode': '代码块 · 已复制提示',
    'styles.metaTitle': '样式页 · 浏览器标题',
    'styles.metaDescription': '样式页 · 搜索摘要',
    'styles.eyebrow': '样式页 · 小标题',
    'styles.title': '样式页 · 大标题',
    'styles.lede': '样式页 · 说明',
    'styles.preview': '样式页 · 预览按钮',
    'styles.readPost': '样式页 · 看文章按钮',
  };

  const SITE_GROUPS = {
    site: '站点信息',
    nav: '导航',
    home: '首页',
    pages: '各页面',
    search: '搜索面板',
    footer: '页脚',
    meta: '无障碍标签',
    styles: '样式预览页（/styles/）',
  };

  const PAGE_NAMES = {
    archive: '归档页',
    tags: '标签页',
    tag: '单个标签页',
    about: '关于页',
    post: '文章页',
    notFound: '404 页面',
  };

  const LONG_KEYS = new Set(['title', 'lede', 'description', 'text', 'note', 'contactLead', 'contactLeadNoEmail', 'nowText', 'tagline']);

  function siteField(path, value, label) {
    const id = `sf-${path.replace(/\./g, '-')}`;
    const key = path.split('.').pop();
    const len = String(value).length;
    const isLong = len > 40 || (LONG_KEYS.has(key) && len > 12);
    const control = isLong
      ? `<textarea id="${id}" rows="2" data-site-path="${path}">${esc(value)}</textarea>`
      : `<input id="${id}" type="text" data-site-path="${path}" value="${esc(value)}">`;
    return `<div class="sf-row" data-row="${path}">
      <label for="${id}">${esc(label || path)}</label>
      ${control}
    </div>`;
  }

  function renderSiteForm(copy) {
    let html = '';
    for (const [key, section] of Object.entries(copy)) {
      if (!section || typeof section !== 'object') continue;
      html += `<div class="sf-group"><h3>${esc(SITE_GROUPS[key] || key)}</h3>`;
      for (const [sub, value] of Object.entries(section)) {
        if (value && typeof value === 'object') {
          // pages 下面再分一层
          html += `<p class="sf-sub">${esc(PAGE_NAMES[sub] || sub)}</p>`;
          for (const [leaf, text] of Object.entries(value)) {
            const path = `${key}.${sub}.${leaf}`;
            html += siteField(path, text, SITE_LABELS[path]);
          }
        } else {
          const path = `${key}.${sub}`;
          html += siteField(path, value, SITE_LABELS[path]);
        }
      }
      html += '</div>';
    }
    els.siteFields.innerHTML = html;
    markSiteDirty(false);
  }

  async function loadSite(force = false) {
    if (siteCopy && !force) return;
    const data = await api('/api/site');
    siteCopy = data.copy;
    renderSiteForm(siteCopy);
  }

  function collectSite() {
    const out = {};
    els.siteFields.querySelectorAll('[data-site-path]').forEach((el) => {
      const path = el.dataset.sitePath.split('.');
      let node = out;
      path.slice(0, -1).forEach((k) => {
        node[k] = node[k] || {};
        node = node[k];
      });
      node[path[path.length - 1]] = el.value;
    });
    return out;
  }

  function markSiteDirty(v) {
    siteDirty = v;
    if (els.siteDirty) els.siteDirty.textContent = v ? '● 未保存' : '';
  }

  async function saveSite() {
    try {
      const data = await postJSON('/api/site', { copy: collectSite() });
      siteCopy = collectSite();
      markSiteDirty(false);
      els.siteFields.querySelectorAll('.sf-row.is-dirty').forEach((r) => r.classList.remove('is-dirty'));
      toast(data.ok ? '文案已保存并重新构建' : '构建失败，看控制台');
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function switchTab(next) {
    tab = next;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === next));
    const siteMode = next === 'site';
    const docMode = next === 'about';
    els.app.classList.toggle('site-mode', siteMode);
    els.app.classList.toggle('doc-mode', docMode);
    els.siteform.hidden = !siteMode;
    $('btn-new').hidden = siteMode || docMode;

    if (siteMode) {
      previewOpen = false;
      els.preview.hidden = true;
      els.app.classList.remove('with-preview');
      try {
        await loadSite();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    if (docMode) {
      try {
        await openPost('about.md', 'page');
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

    // 回到文章列表
    els.form.classList.remove('is-page');
    if (!current || current.kind === 'page') {
      current = null;
      els.form.hidden = true;
      els.empty.hidden = false;
    } else {
      els.form.hidden = false;
      els.empty.hidden = true;
    }
  }

  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.tab === tab) return;
      if (tab !== 'site' && dirty && !window.confirm('还有没保存的改动，确定离开吗？')) return;
      if (tab === 'site' && siteDirty && !window.confirm('文案还没保存，确定离开吗？')) return;
      switchTab(b.dataset.tab);
    });
  });

  els.siteFields.addEventListener('input', (e) => {
    if (!e.target.dataset.sitePath) return;
    markSiteDirty(true);
    e.target.closest('.sf-row')?.classList.add('is-dirty');
  });

  $('btn-site-save').addEventListener('click', saveSite);

  /* ---------- 列表 ---------- */
  async function loadPosts() {
    const data = await api('/api/posts');
    allPosts = data.posts || [];
    renderPosts();
  }

  function renderPosts() {
    const q = els.filter.value.trim().toLowerCase();
    const list = allPosts.filter((p) => !q || p.title.toLowerCase().includes(q) || p.tags.join(' ').toLowerCase().includes(q));
    els.posts.innerHTML = list.map((p) => `
      <li>
        <button type="button" data-file="${esc(p.file)}" class="${current && current.file === p.file ? 'active' : ''}">
          <span class="t">${esc(p.title)}</span>
          <span class="m">${esc((p.date || '').slice(0, 10))}${p.tags.length ? ' · ' + esc(p.tags.join('/')) : ''}${p.draft ? ' · <span class="draft">草稿</span>' : ''}</span>
        </button>
      </li>`).join('');
    els.sideEmpty.hidden = allPosts.length > 0;
  }

  /* ---------- 打开 / 新建 ---------- */
  async function openPost(file, kind = 'post') {
    const data = await api(`/api/post?kind=${kind}&file=${encodeURIComponent(file)}`);
    current = { kind, file: data.file, content: data.content, extra: [] };
    const { meta, body } = parseFront(data.content);
    current.extra = meta.extra || [];
    els.title.value = meta.title || '';
    els.date.value = toInputDate(meta.date) || toLocalInput(new Date());
    els.tags.value = (meta.tags || []).join(', ');
    els.cover.value = meta.cover || '';
    els.desc.value = meta.description || '';
    els.toc.checked = !!meta.toc;
    els.body.value = body;
    els.file.textContent = data.file;
    els.form.classList.toggle('is-page', kind === 'page');
    els.form.hidden = false;
    els.empty.hidden = true;
    setDirty(false);
    updateCount();
    renderPosts();
    if (previewOpen) showPreview(kind === 'page' ? `/${data.file.replace(/\.md$/, '')}/` : `/posts/${slugOf(data.file)}/`);
  }

  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function createPost() {
    if (tab === 'site') await switchTab('posts');
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const guess = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-untitled.md`;
    const name = window.prompt('文件名（中英文、数字、短横线；留空则用默认）', guess);
    if (name === null) return;
    try {
      const data = await postJSON('/api/create', { file: (name || guess).trim() });
      await loadPosts();
      await openPost(data.file);
      els.title.focus();
      els.title.select();
      toast('已新建，写好标题后保存');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ---------- 保存 ---------- */
  async function save({ silent = false } = {}) {
    if (!current) return;
    const isPage = current.kind === 'page';
    const meta = {
      title: els.title.value.trim() || (isPage ? '未命名页面' : '未命名文章'),
      description: els.desc.value.trim(),
      extra: current.extra || [],
      ...(isPage ? {} : {
        date: fromInputDate(els.date.value),
        tags: els.tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        cover: els.cover.value.trim(),
        toc: els.toc.checked,
      }),
    };
    const content = serialize(meta, els.body.value);
    const btn = $('btn-save');
    btn.disabled = true;
    try {
      const data = await postJSON('/api/save', { kind: current.kind || 'post', file: current.file, content });
      current.content = content;
      setDirty(false);
      await loadPosts();
      if (previewOpen) showPreview(data.url);
      else if (!silent) toast('已保存并重新构建');
      els.openPost.href = data.url;
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- 预览 ---------- */
  function showPreview(url) {
    els.frame.src = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    els.openPost.href = url;
  }

  async function togglePreview() {
    previewOpen = !previewOpen;
    els.preview.hidden = !previewOpen;
    els.app.classList.toggle('with-preview', previewOpen);
    if (previewOpen) await save({ silent: true });
  }

  /* ---------- 状态 ---------- */
  function setDirty(v) {
    dirty = v;
    els.dirty.textContent = v ? '● 未保存' : '';
  }

  function updateCount() {
    const n = els.body.value.replace(/\s/g, '').length;
    els.count.textContent = `${n} 字`;
  }

  /* ---------- 编辑辅助 ---------- */
  function surround(before, after = '', placeholder = '') {
    const ta = els.body;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end) || placeholder;
    const text = before + selected + after;
    ta.setRangeText(text, start, end, 'end');
    ta.focus();
    ta.selectionStart = start + before.length;
    ta.selectionEnd = start + before.length + selected.length;
    setDirty(true);
    updateCount();
  }

  function insertText(text) {
    const ta = els.body;
    const start = ta.selectionStart;
    ta.setRangeText(text, start, ta.selectionEnd, 'end');
    ta.focus();
    setDirty(true);
    updateCount();
  }

  const INSERTS = {
    h2: () => surround('## ', '', '小标题'),
    h3: () => surround('### ', '', '小标题'),
    bold: () => surround('**', '**', '加粗文字'),
    code: () => surround('```python\n', '\n```', 'code'),
    math: () => surround('$$\n', '\n$$', 'E = mc^2'),
    table: () => insertText('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n'),
    quote: () => surround('> ', '', '引用'),
    list: () => insertText('\n- 第一项\n- 第二项\n'),
    hr: () => insertText('\n---\n'),
  };

  /* ---------- 事件 ---------- */
  els.posts.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-file]');
    if (!btn) return;
    if (dirty && !window.confirm('当前文章还没保存，确定切换吗？')) return;
    openPost(btn.dataset.file).catch((err) => toast(err.message, true));
  });

  els.filter.addEventListener('input', renderPosts);

  document.querySelectorAll('[data-insert]').forEach((btn) => {
    btn.addEventListener('click', () => INSERTS[btn.dataset.insert]?.());
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  [els.title, els.date, els.tags, els.cover, els.desc, els.toc].forEach((el) => {
    el.addEventListener('input', () => setDirty(true));
    el.addEventListener('change', () => setDirty(true));
  });

  els.body.addEventListener('input', () => { setDirty(true); updateCount(); });

  els.body.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertText('  ');
    }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (tab === 'site') saveSite();
      else save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!dirty && !siteDirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  $('btn-new').addEventListener('click', createPost);
  $('btn-new-2').addEventListener('click', createPost);
  $('btn-preview').addEventListener('click', togglePreview);
  $('btn-close-preview').addEventListener('click', togglePreview);

  $('btn-build').addEventListener('click', async () => {
    try {
      const data = await postJSON('/api/build', {});
      toast(data.ok ? '构建完成' : '构建失败，看控制台');
      if (previewOpen && current) await save({ silent: true });
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('btn-del').addEventListener('click', async () => {
    if (!current) return;
    if (!window.confirm(`删除《${els.title.value || current.file}》？文件会移到 content/.trash/`)) return;
    try {
      await postJSON('/api/delete', { file: current.file });
      current = null;
      els.form.hidden = true;
      els.empty.hidden = false;
      els.file.textContent = '—';
      await loadPosts();
      toast('已移到 .trash');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('btn-image').addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', async () => {
    const file = els.fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = await postJSON('/api/upload', { name: file.name, data: reader.result });
        insertText(`![${file.name.replace(/\.[^.]+$/, '')}](${data.path})`);
        toast('图片已上传到 assets/');
      } catch (err) {
        toast(err.message, true);
      }
    };
    reader.readAsDataURL(file);
    els.fileInput.value = '';
  });

  loadPosts().catch((err) => toast(err.message, true));
})();
