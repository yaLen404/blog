# 叶志汉 · 个人博客

一个零依赖的静态博客：Markdown 写作，一条命令生成整站，双主题、全文搜索、公式渲染都内置。

```
content/posts/*.md   →   node build.mjs   →   dist/
```

## 快速开始

```bash
npm run write            # 打开写作台（推荐）：写文章、看实时预览
npm run build            # 只生成 dist/
npm run serve            # 本地预览 http://127.0.0.1:4173
npm run deploy           # 发布到 GitHub Pages
```

需要 Node 18+，没有任何第三方依赖（KaTeX 已提前放进 `vendor/`）。

## 写作台（不用开编辑器）

```bash
npm run write
```

浏览器会打开 `http://127.0.0.1:4173/write/`：

- 左边列出所有文章，点一篇就能改；搜索框按标题 / 标签过滤；
- 中间是元信息（标题、日期、标签、摘要、封面、目录开关）+ Markdown 正文，带常用语法按钮；
- 「保存」直接把内容写回 `content/posts/*.md`，并自动重新构建站点；右侧「预览」是**真实页面**，不是模拟渲染；
- 图片可以直接选文件上传，自动存进 `assets/` 并插入 Markdown 引用；
- 删除会移到 `content/.trash/`，不会真的丢；
- 快捷键：`Ctrl/⌘ + S` 保存，`Tab` 缩进。

写作台只存在于本地（`admin/` 目录不会进 `dist/`，也不会被发布到线上），所以可以放心改。

## 写一篇新文章（手动方式）

在 `content/posts/` 下新建 `2026-11-20-hello.md`：

```markdown
---
title: 文章标题
date: 2026-11-20 10:00:00
description: 一句话摘要，会出现在列表页、搜索结果和 RSS 里。
tags:
  - 大模型
  - 系统
cover: /images/cover.svg   # 可选
toc: true                  # 可选，正文标题足够多时自动生成目录
---

正文从这里开始，支持标题、列表、表格、代码块、引用、图片与 `$...$` 公式。
```

跑一次 `node build.mjs`，首页、归档、标签页、RSS、搜索索引都会自动更新。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `content/posts/` | 文章，一篇文章一个 `.md` |
| `content/pages/about.md` | 关于页 |
| `src/styles.css` | 所有样式（配色靠 CSS 变量） |
| `src/app.js` | 主题切换、搜索面板、目录跟随、复制代码 |
| `src/math.js` | KaTeX 初始化 |
| `assets/` | 图片资源 |
| `vendor/katex/` | 离线公式渲染 |
| `build.mjs` | 生成器 |
| `server.mjs` | 本地静态服务器 |
| `dist/` | 构建产物 |

## 想改哪里

- **名字、简介、邮箱、社交链接**：`site.config.mjs`
- **首页大标题**：`site.config.mjs` 里的 `hero`
- **配色**：`src/styles.css` 顶部 `:root` 与 `[data-theme="dark"]` 的 CSS 变量
- **按钮、间距、字号**：同一个文件里的对应区块
- **网站图标**：`build.mjs` 里 head 中的内联 SVG

## 部署

`dist/` 是纯静态文件，没有任何服务端依赖，放到任何能托管的静态空间都能跑。
构建支持两个环境变量，**换域名不需要改代码**：

```bash
BASE=/blog/ ORIGIN=https://example.com node build.mjs
```

### 方案 A：GitHub Pages（免费，当前站点就是这么发的）

仓库里带了 `deploy.mjs`：本地构建 → 把 `dist/` 推到独立的 `gh-pages` 分支，不需要 Actions、不需要改代码。

```bash
npm run deploy          # 等价于 node deploy.mjs
```

它会自动判断仓库是「用户站点」（`用户名.github.io`，用根路径）还是「项目站点」（`仓库名`，用 `/仓库名/`）。
绑定自定义域名后：

```bash
ORIGIN=https://blog.example.com node deploy.mjs
```

首次发布后，到仓库 **Settings → Pages → Build and deployment → Source** 选 **Deploy from a branch**，
分支选 `gh-pages`、目录 `/`。以后每次 `npm run deploy` 都会自动更新。

> 想要「push 就自动发布」也可以：把 `deploy/github-pages-workflow.yml` 拷回 `.github/workflows/deploy.yml`，
> 再用一个有 `workflow` 权限的 token 推送（`gh auth refresh -s workflow`），然后在 Pages 里把 Source 切成 **GitHub Actions**。

### 方案 B：Cloudflare Pages（国内访问通常更顺）

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git；
2. 构建命令 `node build.mjs`，输出目录 `dist`，Node 版本选 20；
3. 环境变量：`BASE=/`、`ORIGIN=https://<项目名>.pages.dev`（绑定自定义域名后改成你的域名）。

也可以在本地 `npx wrangler pages deploy dist` 直接上传，不用连仓库。

### 方案 C：国内云（需要备案域名）

阿里云 OSS / 腾讯云 COS 的「静态网站托管」：上传 `dist/`，开启静态托管，绑定一个**已备案**的域名走 CDN。
没备案只能用平台默认测试域名，可能会被限速或弹提示，不适合正式分享。

### 绑定自己的域名

在平台添加自定义域名，DNS 加一条 CNAME；然后 `ORIGIN` 改成新域名、`BASE` 保持 `/` 重新构建。
GitHub Pages 还需要在仓库 Settings → Pages 的 Custom domain 填一次域名。

### 只想临时发给别人看

```bash
HOST=0.0.0.0 node server.mjs     # 同一 Wi-Fi 下用手机看：http://<你的内网IP>:4173
```

要发给外网的人，可以开一个临时隧道（电脑关掉就失效）：

```bash
npx localtunnel --port 4173      # 或 cloudflared tunnel --url http://127.0.0.1:4173
```

## 换风格

内置四套视觉风格，改 `site.config.mjs` 里的 `skin` 即可切换：

| skin | 风格 |
| --- | --- |
| `paper` | 纸墨：暖白纸、宋体、朱红（默认） |
| `minimal` | 极简：纯白、黑白灰、无圆角、无衬线 |
| `terminal` | 终端：近黑、等宽、薄荷绿、虚线 |
| `aurora` | 极光：冷色渐变、玻璃卡片、大圆角 |

预览全部：`/styles/`；临时看某一套：在任意地址后面加 `?skin=terminal`。
样式代码集中在 `src/skins.css`，每套都以 `[data-skin="名字"]` 开头，互不影响。

## 已内置的细节

- 深浅色主题，首屏不闪白（在 `<head>` 里同步决定）
- `/` 或 `⌘K` 唤出搜索面板，本地 `search.json` 按字段权重打分
- 文章目录跟随滚动高亮，顶部阅读进度条
- 代码块带语言标签与一键复制
- 公式离线渲染（KaTeX），只有出现 `$...$` 的页面才加载
- RSS、sitemap、robots.txt、自定义 404
