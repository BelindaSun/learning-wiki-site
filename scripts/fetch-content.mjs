import { execSync } from "node:child_process";
import { existsSync, rmSync, readdirSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".content-cache");
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const REPO_URL = "https://github.com/BelindaSun/learning-wiki.git";

const force = process.argv.includes("--force");

// Markdown files reference images with relative paths like
// `docs/<category>/assets/foo.svg`, which the browser resolves relative to
// the article's own URL. Astro's static build only serves files that live
// under public/, so every `assets/` directory in the content repo needs to
// be mirrored into public/ at the matching path, or those images 404 no
// matter how correctly the markdown links to them.
function syncAssets() {
  // Full remirror each time, so assets renamed/removed upstream don't
  // linger as orphans across builds.
  rmSync(path.join(PUBLIC_DIR, "docs"), { recursive: true, force: true });
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (entry === "assets") {
        const rel = path.relative(CACHE_DIR, full);
        const dest = path.join(PUBLIC_DIR, rel);
        mkdirSync(dest, { recursive: true });
        for (const file of readdirSync(full)) {
          copyFileSync(path.join(full, file), path.join(dest, file));
        }
        console.log(`[fetch-content] synced assets: ${rel}`);
      } else {
        walk(full);
      }
    }
  };
  walk(CACHE_DIR);
}

// The film/ section documents Xiao De's films with relative links to the real
// project files sitting next to the READMEs (film.js, score.py, render.js,
// *.mp4). Mirror those files into public/film/ so the links resolve on the
// site instead of 404ing (and failing check-links, which breaks the build).
function syncFilm() {
  const src = path.join(CACHE_DIR, "film");
  if (!existsSync(src)) return;
  const dest = path.join(PUBLIC_DIR, "film");
  // Full remirror each time, so renamed/removed files don't linger as orphans.
  rmSync(dest, { recursive: true, force: true });
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (!entry.toLowerCase().endsWith(".md")) {
        const target = path.join(dest, path.relative(src, full));
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(full, target);
      }
    }
  };
  walk(src);
  console.log("[fetch-content] synced film files -> public/film/");
}

if (existsSync(CACHE_DIR)) {
  if (force) {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  } else {
    console.log("[fetch-content] .content-cache exists, refreshing via git pull");
    try {
      execSync("git pull --ff-only", { cwd: CACHE_DIR, stdio: "inherit" });
      syncAssets();
      syncFilm();
      process.exit(0);
    } catch (e) {
      console.warn("[fetch-content] pull failed, re-cloning:", e.message);
      rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  }
}

console.log("[fetch-content] cloning", REPO_URL);
execSync(`git clone --depth 1 ${REPO_URL} "${CACHE_DIR}"`, { stdio: "inherit" });
syncAssets();
syncFilm();
