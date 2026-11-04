// 打开写作台：node write.mjs（会复用已在运行的预览服务）
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const BASE = `http://127.0.0.1:${PORT}`;

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function alive() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE}/api/posts`, { timeout: 700 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

if (await alive()) {
  console.log(`写作台已在运行：${BASE}/write/`);
  openBrowser(`${BASE}/write/`);
} else {
  console.log('正在启动本地服务…');
  process.chdir(ROOT);
  await import('./server.mjs');
  setTimeout(() => openBrowser(`${BASE}/write/`), 600);
}
