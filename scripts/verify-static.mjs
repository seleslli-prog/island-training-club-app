import { access } from "node:fs/promises";
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

console.log("ok  static app entrypoints present (no bundler build)");
