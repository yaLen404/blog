---
title: 用 200 行 Node 写一个静态博客
date: 2026-11-04 09:30:00
description: 不装框架、不拉依赖：一个 Markdown 目录、一份模板、一个 build.mjs，就足够撑起一个写起来顺手的个人博客。记录这套站点的设计取舍。
tags:
  - 前端
  - 工程实践
  - 静态站点
toc: true
---

市面上的博客框架已经足够多了，但我最后只写了三百来行的 `build.mjs`。理由很朴素：**我想要的东西，只是一个把 Markdown 变成 HTML 的脚本。**

<!-- more -->

## 为什么不上框架

Next.js、Astro、Hugo 都很成熟，代价是：

- 一套需要跟进的构建链（每年都有 breaking change）；
- 一堆为了"通用"而存在的抽象，读一篇博客要穿越五层 layout；
- 出问题时，debug 的是框架而不是我的文章。

我一个人写、一个人维护，最需要的不是扩展性，而是**半年后打开还能看懂**。

所以这套站点的全部依赖是：Node 自带模块、一个 CSS 文件、一个 JS 文件。没有 `node_modules`。

## 目录长什么样

```text
personal-blog/
├── content/
│   ├── posts/          # 文章：一个 .md 一篇
│   └── pages/about.md  # 独立页面
├── src/
│   ├── styles.css      # 全部样式
│   ├── app.js          # 主题 / 搜索 / 目录 / 复制
│   └── math.js         # KaTeX 初始化
├── assets/             # 图片
├── build.mjs           # 生成器
├── server.mjs          # 本地预览
└── dist/               # 产物（不提交）
```

写新文章的流程只有两步：

```bash
# 1. 新建 content/posts/2026-11-20-whatever.md，写 front matter 和正文
# 2. 生成
node build.mjs
```

## front matter 就是全部配置

每篇文章头部的一小段 YAML 决定了它出现在哪里、带什么标签、要不要显示目录：

```yaml
---
title: 用 200 行 Node 写一个静态博客
date: 2026-11-04 09:30:00
description: 一句话摘要，会出现在列表页和搜索结果里。
tags:
  - 前端
  - 静态站点
cover: /images/cover.svg
toc: true
---
```

标题、摘要、标签、封面、目录开关都在这里。列表页、标签页、RSS、搜索索引，全部由这些字段推出来——写一次，六处生效。

## Markdown 只支持我真正会用的语法

写一个完整的 CommonMark 解析器是件吃力不讨好的事。我的选择是：**支持我写文章时会用到的子集**。

- 标题、段落、粗体、斜体、行内代码、链接、图片；
- 有序 / 无序列表（含一层嵌套）、引用、分隔线；
- 表格、围栏代码块、`$$` 公式块；
- 独立成段的图片自动变成 `figure` + 图注。

这个子集之外的东西（脚注、定义列表、嵌套三层的引用）我一篇也没用过，就不写。

代价是解析器只有两百行，好处是**每个分支我都知道为什么存在**。碰到 bug，改的是自己写的代码。

## 数学公式走离线 KaTeX

博客里会写推理相关的推导，公式必须好看。KaTeX 从 CDN 引最省事，但我不喜欢页面加载依赖别人的服务器——断网就变成一堆 `\frac`。

所以构建时把 `katex.min.css`、`katex.min.js`、字体一起拷进 `dist/vendor/`，只有正文里真的出现 `$...$` 的页面才加载它们。文章页体积多了几十 KB，换来的是**永远能打开、永远能渲染**。

## 搜索是一个 3 KB 的 JSON

全文搜索没必要上索引服务。构建时把每篇文章的标题、日期、标签、摘要和正文前 4000 字导出成一个 `search.json`，浏览器端按字段权重算分：

| 命中位置 | 权重 |
| --- | --- |
| 标题 | 12 |
| 标签 | 6 |
| 摘要 | 4 |
| 正文 | 2 |

按 `/` 或 `⌘K` 打开搜索面板，上下键选择，回车跳转。多关键词时每个词都必须命中——宁可少给结果，也不要给一堆不相关的。

## 深浅色不能闪

主题在 `<head>` 里同步决定，而不是等 JS 加载完再切换：

```html
<script>
  (function () {
    try {
      var t = localStorage.getItem('theme');
      if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
    } catch (e) {}
  })();
</script>
```

这段脚本在样式表之前执行，浏览器第一帧就已经是正确的颜色。整站的配色交给 CSS 变量，切换主题只是换一个 `data-theme` 属性。

## 部署

`dist/` 是一堆纯静态文件，扔到任何地方都能跑：GitHub Pages、Cloudflare Pages、一台装 nginx 的机器，甚至 U 盘。

唯一要注意的是路径：站点部署在子路径（比如 `username.github.io/blog/`）时，把 `site.config.mjs` 里的 `base` 从 `/` 改成 `/blog/`，全站链接会自动跟着变。

## 小结

这套东西没有解决任何"通用问题"，它只解决我的问题：**打开编辑器，写 Markdown，运行一条命令，得到一个好看的页面。**

工具的价值不在于它能做多少事，而在于它让你少做多少与写作无关的事。
