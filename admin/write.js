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
  };

  let current = null; // { file, content }
  let dirty = false;
  let allPosts = [];
  let previewOpen = false;

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
  async function openPost(file) {
    const data = await api(`/api/post?file=${encodeURIComponent(file)}`);
    current = { file: data.file, content: data.content, extra: [] };
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
    els.form.hidden = false;
    els.empty.hidden = true;
    setDirty(false);
    updateCount();
    renderPosts();
    if (previewOpen) showPreview(`/posts/${slugOf(data.file)}/`);
  }

  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function createPost() {
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
    const meta = {
      title: els.title.value.trim() || '未命名文章',
      date: fromInputDate(els.date.value),
      description: els.desc.value.trim(),
      tags: els.tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      cover: els.cover.value.trim(),
      toc: els.toc.checked,
      extra: current.extra || [],
    };
    const content = serialize(meta, els.body.value);
    const btn = $('btn-save');
    btn.disabled = true;
    try {
      const data = await postJSON('/api/save', { file: current.file, content });
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
      save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
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
