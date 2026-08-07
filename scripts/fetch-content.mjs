import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".content-cache");
const REPO_URL = "https://github.com/BelindaSun/learning-wiki.git";

const force = process.argv.includes("--force");

if (existsSync(CACHE_DIR)) {
  if (force) {
    rmSync(CACHE_DIR, { recursive: true, force: true });
  } else {
    console.log("[fetch-content] .content-cache exists, refreshing via git pull");
    try {
      execSync("git pull --ff-only", { cwd: CACHE_DIR, stdio: "inherit" });
      process.exit(0);
    } catch (e) {
      console.warn("[fetch-content] pull failed, re-cloning:", e.message);
      rmSync(CACHE_DIR, { recursive: true, force: true });
    }
  }
}

console.log("[fetch-content] cloning", REPO_URL);
execSync(`git clone --depth 1 ${REPO_URL} "${CACHE_DIR}"`, { stdio: "inherit" });
