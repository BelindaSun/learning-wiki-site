import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { toString as mdastToString } from "mdast-util-to-string";

const CACHE_DIR = path.join(process.cwd(), ".content-cache");

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface WikiDoc {
  /** slug relative to site root, e.g. "docs/ai-core/agent-architecture" or "mental-models" */
  slug: string;
  /** absolute path in the cloned repo */
  filePath: string;
  /** folder the file lives in, relative to repo root, e.g. "docs/ai-core" or "" for root */
  dir: string;
  title: string;
  highlight: string | null;
  highlightHtml: string | null;
  html: string;
  headings: Heading[];
  updatedLine: string | null;
  raw: string;
}

export interface CategoryMeta {
  key: string;
  label: string;
  icon: string;
  description: string;
}

// 顺序 = 导航顺序 = 依赖顺序（Computing Foundations 是地基，排第一）。
// 首页的依赖堆叠图会把这个顺序反过来画（地基在底），见 index.astro。
export const CATEGORIES: CategoryMeta[] = [
  { key: "computing-foundations", label: "Computing Foundations", icon: "🖥️", description: "计算基础：软件 / 硬件 / 基础设施 / 半导体——AI 的地基层" },
  { key: "ai-core", label: "AI Core", icon: "📚", description: "Agent 系统架构 · 大语言模型基础 · Prompt 工程 · 系统设计" },
  { key: "ai-application", label: "AI in Practice", icon: "🛠️", description: "Skill 设计与实现 · 工作流设计模式 · MCP 与集成 · 真实案例" },
  { key: "ai-research", label: "AI Research", icon: "🔬", description: "AI 模型的优化和评估方法" },
  { key: "career-impact", label: "Industry & Impact", icon: "🌍", description: "AI 遇上世界：职业冲击 · 个人能力建设 · 未来趋势" },
];

function slugForFile(repoRelativePath: string): string {
  return repoRelativePath.replace(/\.md$/i, "").replace(/\\/g, "/");
}

function walk(dir: string, base: string, out: string[]) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, path.join(base, entry), out);
    } else if (entry.toLowerCase().endsWith(".md")) {
      out.push(path.join(base, entry));
    }
  }
}

/** Rewrites relative .md links (with optional #anchor) found in raw markdown text
 * into site-absolute routes, resolved relative to the linking file's directory. */
function rewriteLinks() {
  return (tree: any, file: any) => {
    const fileDir: string = file.data.dir ?? "";
    visit(tree, "link", (node: any) => {
      const url: string = node.url || "";
      if (/^https?:\/\//i.test(url) || url.startsWith("mailto:")) return;
      const [pathPart, anchor] = url.split("#");
      if (!pathPart || !pathPart.toLowerCase().endsWith(".md")) return;
      const resolved = path.posix.normalize(path.posix.join(fileDir, pathPart));
      // `[...slug].astro` never routes a doc whose slug ends in "/index" (its
      // content is served at the category's own listing route instead, see
      // [category]/index.astro), so a link to e.g. "index.md" must resolve to
      // "/docs/foo/" (trailing slash), not "/docs/foo/index" (no page there).
      let route = resolved.replace(/\.md$/i, "");
      route = route.endsWith("/index") ? route.slice(0, -"index".length) : route;
      node.url = "/" + route + (anchor ? `#${anchor}` : "");
    });
  };
}

function extractHeadings(tree: any): Heading[] {
  const headings: Heading[] = [];
  visit(tree, "heading", (node: any) => {
    if (node.depth < 2 || node.depth > 3) return;
    const text = mdastToString(node);
    const id = (node.data && node.data.id) || slugify(text);
    headings.push({ depth: node.depth, text, id });
  });
  return headings;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(rewriteLinks)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSlug)
  .use(rehypeStringify);

const inlineProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkCjkFriendly)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeStringify);

/** Renders a short one-paragraph markdown snippet (e.g. the "**核心概念**: ..."
 * line) to inline HTML, stripping the wrapping <p> tag. */
function renderInline(text: string): string {
  const html = String(inlineProcessor.processSync(text));
  return html.replace(/^<p>/, "").replace(/<\/p>\n?$/, "");
}

/** Plain-text version of a markdown snippet, for use in excerpts where HTML
 * would be unsafe to truncate. */
export function stripMd(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function parseDoc(repoRelativePath: string): WikiDoc {
  const filePath = path.join(CACHE_DIR, repoRelativePath);
  const raw = readFileSync(filePath, "utf-8");
  const dir = path.posix.dirname(repoRelativePath.replace(/\\/g, "/"));
  const normDir = dir === "." ? "" : dir;

  const lines = raw.split("\n");
  let title = repoRelativePath;
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+)$/);
    if (m) {
      title = m[1].trim();
      titleLineIdx = i;
      break;
    }
  }

  let highlight: string | null = null;
  let highlightLineIdx = -1;
  for (let i = titleLineIdx + 1; i < Math.min(lines.length, titleLineIdx + 15); i++) {
    const m = lines[i].match(/^\*\*([^*]+)\*\*[：:]\s*(.+)$/);
    if (m) {
      highlight = m[2].trim();
      highlightLineIdx = i;
      break;
    }
    if (lines[i].trim() !== "" && !lines[i].startsWith(">")) break;
  }

  const highlightHtml = highlight ? renderInline(highlight) : null;

  let updatedLine: string | null = null;
  const updatedMatch = raw.match(/\*\*最后更新\*\*[：:]\s*(.+)/);
  if (updatedMatch) updatedLine = updatedMatch[1].trim();

  // Strip the H1 title line and (if immediately following) the highlight
  // paragraph from what gets rendered as body HTML, so they aren't shown
  // twice (once in the styled header area, once again in the flow).
  const stripThrough = highlightLineIdx >= 0 ? highlightLineIdx : titleLineIdx;
  const bodyLines = titleLineIdx >= 0 ? lines.slice(stripThrough + 1) : lines;
  const bodyRaw = bodyLines.join("\n").replace(/^\s*\n+/, "");

  const tree = processor.parse(bodyRaw);
  (tree as any).data = { dir: normDir };
  const headings = extractHeadings(tree);
  const hastTree = processor.runSync(tree, { data: { dir: normDir } } as any);
  const html = processor.stringify(hastTree as any);

  return {
    slug: slugForFile(repoRelativePath),
    filePath,
    dir: normDir,
    title,
    highlight,
    highlightHtml,
    html,
    headings,
    updatedLine,
    raw,
  };
}

let _cache: WikiDoc[] | null = null;

export function getAllDocs(): WikiDoc[] {
  if (_cache) return _cache;
  if (!existsSync(CACHE_DIR)) {
    throw new Error(
      "Content cache not found. Run `npm run fetch-content` before building/dev."
    );
  }
  const files: string[] = [];
  walk(CACHE_DIR, "", files);
  _cache = files
    .filter((f) => !f.startsWith("CLAUDE.md"))
    .map((f) => parseDoc(f));
  return _cache;
}

export function getDocBySlug(slug: string): WikiDoc | undefined {
  return getAllDocs().find((d) => d.slug === slug);
}

export function getDocsInCategory(categoryKey: string): WikiDoc[] {
  return getAllDocs()
    .filter((d) => d.dir === `docs/${categoryKey}` && !d.slug.endsWith("/index"))
    .sort((a, b) => a.title.localeCompare(b.title, "zh"));
}

export function getChangelogLatest(): { date: string; topic: string } | null {
  const doc = getDocBySlug("CHANGELOG");
  if (!doc) return null;
  // Match the first "## [version] - date" block, then whatever "### " heading
  // comes right after it, regardless of emoji/prefix (Daily Update, 结构调整, etc.)
  const m = doc.raw.match(/## \[.*?\] - (.+?)\n+### (?:📝 Daily Update - )?(.+)/);
  if (!m) return null;
  return { date: m[1].trim(), topic: m[2].trim() };
}
