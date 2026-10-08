import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const REQUIRED = [
  "app/index.html",
  "app/styles.css",
  "app/js/app.js",
  "app/js/store.js",
  "app/js/views.js",
  "app/js/data.js",
  "vercel.json",
];

for (const path of REQUIRED) {
  await access(path, constants.R_OK);
}

const vercel = JSON.parse(await readFile("vercel.json", "utf8"));
if (vercel.framework !== null || vercel.buildCommand !== null || vercel.outputDirectory !== ".") {
  console.error("vercel.json must pin a static no-build root (framework/buildCommand null, outputDirectory \".\")");
  process.exit(1);
}

console.log("ok  static app entrypoints present (no bundler build)");
