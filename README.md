# Learning Wiki Site

`Belinda's Learning Wiki`（[github.com/BelindaSun/learning-wiki](https://github.com/BelindaSun/learning-wiki)）的展示网站。这是一个**独立的**项目——内容仓库（learning-wiki）本身保持纯 Markdown、没有 front matter、没有任何建站相关的东西，这个网站只是在构建时把内容拉过来渲染成好看的页面。

## 怎么工作的

1. `npm run build`（或 `npm run dev`）先跑 `scripts/fetch-content.mjs`，把 `github.com/BelindaSun/learning-wiki` 浅克隆到本地 `.content-cache/`（这个目录被 gitignore，不提交）
2. `src/lib/content.ts` 读取 `.content-cache` 里所有 `.md` 文件：
   - 标题 = 文件里第一个 `# ` 标题
   - 分类 = 文件所在的文件夹路径（`docs/ai-core/` → AI Core，以此类推）
   - 高亮框 = 标题后第一行 `**xxx**: ...` 格式的加粗行（`**核心概念**` 或 `**核心洞察**` 都认）
   - 正文里的相对路径链接（`[Agent 架构](agent-architecture.md)` 这种）会自动改写成网站自己的 URL
3. Astro 用 `src/layouts/Article.astro` 统一套用样式渲染成文章页

**不需要给内容仓库的任何文件加 front matter 或其他标记**——所有信息都是从文件内容和路径自动推断的。

## 本地开发

```bash
npm install
npm run dev
```

## 构建 / 部署前检查

```bash
npm run build           # 会自动重新拉取最新内容再构建
node scripts/check-links.mjs   # 检查有没有站内死链接
```

## 部署

部署在 Vercel，构建命令 `npm run build`，输出目录 `dist/`。

**关键**：这个网站只在自己被重新构建时才会拉取 learning-wiki 的最新内容。也就是说光是往 `learning-wiki` 仓库 push 新文章，网站不会自动更新——需要触发一次 Vercel 重新构建。在 Vercel 项目设置里配一个 **Deploy Hook**，然后在 `learning-wiki` 仓库加一个 GitHub Action，每次 push 到 `main` 就 curl 一下这个 hook（见下方"自动更新"）。

### 自动更新（Deploy Hook）

1. Vercel 项目 → Settings → Git → Deploy Hooks，新建一个，随便起个名字（比如 `content-update`），分支填 `main`，会生成一个 URL
2. 在 `learning-wiki` 仓库里加 `.github/workflows/notify-site.yml`：

```yaml
name: Notify site to rebuild
on:
  push:
    branches: [main]
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST "$DEPLOY_HOOK_URL"
        env:
          DEPLOY_HOOK_URL: ${{ secrets.SITE_DEPLOY_HOOK }}
```

3. 把第 1 步生成的 URL 存进 `learning-wiki` 仓库的 Settings → Secrets → Actions，命名为 `SITE_DEPLOY_HOOK`

这样以后每天往 `learning-wiki` push 新内容，网站会在几分钟内自动重新构建、更新。
