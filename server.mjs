// 本地预览 + 写作台：node server.mjs（默认 http://127.0.0.1:4173）
// 写作台：http://127.0.0.1:4173/write/
// 想让同一 Wi-Fi 下的手机也能看：HOST=0.0.0.0 node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SITE, 'dist');
const ADMIN = path.join(SITE, 'admin');
const POSTS = path.join(SITE, 'content', 'posts');
const PAGES = path.join(SITE, 'content', 'pages');
const ASSETS = path.join(SITE, 'assets');
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const ORIGIN = `http://127.0.0.1:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

/* ---------------- 文章读写 ---------------- */

const FILE_RE = /^[\p{L}\p{N}_-]+\.md$/u;

function readFront(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const data = {};
  if (!m) return { data, body: raw };
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      data[key] = v ? v.replace(/^["']|["']$/g, '') : [];
      continue;
    }
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(item[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return { data, body: raw.slice(m[0].length) };
}

function listPosts() {
  if (!fs.existsSync(POSTS)) return [];
  return fs.readdirSync(POSTS)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(POSTS, file), 'utf8');
      const { data } = readFront(raw);
      return {
        file,
        title: data.title || file.replace(/\.md$/, ''),
        date: data.date || '',
        tags: Array.isArray(data.tags) ? data.tags : [],
        draft: data.draft === true || data.draft === 'true',
        words: raw.replace(/\s/g, '').length,
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function rebuild() {
  const r = spawnSync(process.execPath, ['build.mjs'], {
    cwd: SITE,
    encoding: 'utf8',
    env: { ...process.env, BASE: '/', ORIGIN },
  });
  return {
    ok: r.status === 0,
    log: `${r.stdout || ''}${r.stderr || ''}`.trim(),
  };
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

function readJson(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/* ---------------- 写作台接口 ---------------- */

// 写作台没有登录（单人本地工具），所以只认本机请求：
// 即使以后用 HOST=0.0.0.0 把站点共享到局域网，别人也只能看，不能改。
function isLoopback(req) {
  const addr = req.socket.remoteAddress || '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isLocalOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // 本机 curl / 脚本
  try {
    const { hostname, protocol } = new URL(origin);
    return (protocol === 'http:' || protocol === 'https:') &&
      (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]');
  } catch {
    return false;
  }
}

async function api(req, res, pathname, query) {
  if (!isLoopback(req) || !isLocalOrigin(req)) {
    return json(res, 403, { error: '写作台只允许从本机访问' });
  }

  if (pathname === '/api/posts' && req.method === 'GET') {
    return json(res, 200, { posts: listPosts() });
  }

  if (pathname === '/api/post' && req.method === 'GET') {
    const file = query.get('file') || '';
    const kind = query.get('kind') === 'page' ? 'page' : 'post';
    const dir = kind === 'page' ? PAGES : POSTS;
    if (!FILE_RE.test(file) || !fs.existsSync(path.join(dir, file))) return json(res, 404, { error: '文章不存在' });
    return json(res, 200, { file, kind, content: fs.readFileSync(path.join(dir, file), 'utf8') });
  }

  if (pathname === '/api/save' && req.method === 'POST') {
    const body = await readJson(req);
    const file = body.file || '';
    const kind = body.kind === 'page' ? 'page' : 'post';
    const dir = kind === 'page' ? PAGES : POSTS;
    if (!FILE_RE.test(file)) return json(res, 400, { error: '文件名不合法' });
    fs.writeFileSync(path.join(dir, file), String(body.content || ''), 'utf8');
    const build = rebuild();
    const url = kind === 'page'
      ? `/${file.replace(/\.md$/, '')}/`
      : `/posts/${file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')}/`;
    return json(res, build.ok ? 200 : 500, { ...build, url });
  }

  if (pathname === '/api/create' && req.method === 'POST') {
    const body = await readJson(req);
    let file = String(body.file || '').trim();
    if (!file) {
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      file = `${stamp}-untitled.md`;
    }
    if (!file.endsWith('.md')) file += '.md';
    if (!FILE_RE.test(file)) return json(res, 400, { error: '文件名不合法（只能中英文、数字、下划线、短横线）' });
    if (fs.existsSync(path.join(POSTS, file))) return json(res, 409, { error: '同名文章已存在' });

    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const template = `---
title: 未命名文章
date: ${date}
description: 一句话摘要，会出现在列表页和搜索结果里。
tags:
  - 随笔
toc: true
---

正文从这里开始。

## 小标题

写点什么。
`;
    fs.writeFileSync(path.join(POSTS, file), template, 'utf8');
    rebuild();
    return json(res, 200, { file, content: template });
  }

  if (pathname === '/api/delete' && req.method === 'POST') {
    const body = await readJson(req);
    const file = body.file || '';
    if (!FILE_RE.test(file)) return json(res, 400, { error: '文件名不合法' });
    const target = path.join(POSTS, file);
    if (!fs.existsSync(target)) return json(res, 404, { error: '文章不存在' });
    const trash = path.join(SITE, 'content', '.trash');
    fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(target, path.join(trash, `${Date.now()}-${file}`));
    rebuild();
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    const body = await readJson(req);
    const m = String(body.data || '').match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
    if (!m) return json(res, 400, { error: '只支持 png / jpg / gif / webp / svg' });
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1];
    const base = String(body.name || 'image')
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-|-$/g, '') || 'image';
    const name = `${base}-${Date.now().toString(36)}.${ext}`;
    fs.mkdirSync(ASSETS, { recursive: true });
    fs.writeFileSync(path.join(ASSETS, name), Buffer.from(m[2], 'base64'));
    return json(res, 200, { path: `/images/${name}` });
  }

  if (pathname === '/api/site' && req.method === 'GET') {
    return json(res, 200, { copy: JSON.parse(fs.readFileSync(path.join(SITE, 'content', 'site.json'), 'utf8')) });
  }

  if (pathname === '/api/site' && req.method === 'POST') {
    const body = await readJson(req);
    const data = body.copy;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json(res, 400, { error: '数据格式不对' });
    fs.writeFileSync(path.join(SITE, 'content', 'site.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
    const build = rebuild();
    return json(res, build.ok ? 200 : 500, build);
  }

  if (pathname === '/api/build' && req.method === 'POST') {
    const build = rebuild();
    return json(res, build.ok ? 200 : 500, build);
  }

  return json(res, 404, { error: 'not found' });
}

/* ---------------- 静态服务 ---------------- */

function serveFile(res, file) {
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  let pathname;
  let query;
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
    query = url.searchParams;
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  try {
    if (pathname.startsWith('/api/')) {
      await api(req, res, pathname, query);
      return;
    }

    // 写作台（只存在于本地，不会进 dist，也不会被发布）
    if (pathname === '/write' || pathname.startsWith('/write/')) {
      if (!isLoopback(req)) {
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8"><p style="font-family:monospace;padding:40px">写作台只允许从本机访问。</p>');
        return;
      }
      if (pathname === '/write' || pathname === '/write/') {
        return serveFile(res, path.join(ADMIN, 'index.html'));
      }
      const f = path.join(ADMIN, pathname.slice('/write/'.length));
      if (f.startsWith(ADMIN) && fs.existsSync(f) && fs.statSync(f).isFile()) return serveFile(res, f);
    }

    let file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, '404.html'), 'utf8'));
      return;
    }

    serveFile(res, file);
  } catch (err) {
    json(res, 500, { error: String(err && err.message ? err.message : err) });
  }
}).listen(PORT, HOST, () => {
  console.log(`站点预览 http://127.0.0.1:${PORT}/`);
  if (HOST === '0.0.0.0') {
    console.log('（写作台已自动限制为本机访问：局域网里的设备只能阅读站点）');
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`局域网 http://${net.address}:${PORT}/`);
      }
    }
  } else {
    console.log(`写作台   http://127.0.0.1:${PORT}/write/`);
  }
});
