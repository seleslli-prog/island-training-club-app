import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOTS = ["app"];
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walk(path, acc);
      continue;
    }
    if (/\.(js|mjs|cjs)$/.test(name)) acc.push(path);
  }
  return acc;
}

const files = ROOTS.flatMap((root) => walk(root));
if (!files.length) {
  console.error("syntax-check: no JavaScript files found under app/");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || `${file}: syntax check failed\n`);
  }
}

if (failed) {
  console.error(`syntax-check: ${failed} file(s) failed`);
  process.exit(1);
}

console.log(`ok  syntax-check ${files.length} files`);
