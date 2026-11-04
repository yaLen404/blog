// 发布到 GitHub Pages：把 dist/ 推到一个独立的 gh-pages 分支
//   node deploy.mjs            自动识别仓库名与地址
//   ORIGIN=https://blog.example.com node deploy.mjs   绑定自定义域名后
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const remote = git(['remote', 'get-url', 'origin']);
const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
if (!match) {
  console.error(`读不懂远程地址：${remote}`);
  process.exit(1);
}
const [, owner, repo] = match;
const isUserSite = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`;

const BASE = process.env.BASE || (isUserSite ? '/' : `/${repo}/`);
const ORIGIN = process.env.ORIGIN || `https://${owner.toLowerCase()}.github.io`;
const siteUrl = `${ORIGIN}${BASE}`;

console.log(`→ 构建 ${repo}（BASE=${BASE}）`);
execFileSync(process.execPath, ['build.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, BASE, ORIGIN },
});

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-deploy-'));
fs.cpSync(path.join(ROOT, 'dist'), stage, { recursive: true });
fs.writeFileSync(path.join(stage, '.nojekyll'), '');

git(['init', '-b', 'gh-pages'], stage);
git(['add', '-A'], stage);
git(['-c', 'user.name=deploy', '-c', 'user.email=deploy@local', 'commit', '-q', '-m', `deploy ${new Date().toISOString()}`], stage);
git(['remote', 'add', 'origin', remote], stage);
git(['push', '-f', 'origin', 'gh-pages'], stage);
fs.rmSync(stage, { recursive: true, force: true });

console.log(`✓ 已发布：${siteUrl}`);
console.log('  （首次需要到仓库 Settings → Pages 把 Source 设为 gh-pages 分支）');
