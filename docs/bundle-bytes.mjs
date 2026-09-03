#!/usr/bin/env node
/**
 * Bundle yardstick, the ADR-zod-tanstack §3.1 one.
 *
 * Two numbers, and they answer different questions:
 *  - artifact bytes: every .js under the build's static directory, raw and
 *    gzipped. That is what the build emits, NOT what a visitor downloads.
 *  - per-page bytes: for every exported HTML file, the gzipped size of every
 *    `<script src>` the page requests on load. Next's own "First Load JS"
 *    UNDER-reports, because it does not count every chunk the HTML pulls in;
 *    this sum does. The DELTA between two builds is the comparable figure,
 *    never the absolute.
 *
 * WHAT THIS STILL DOES NOT SEE: a chunk fetched by a dynamic `import()` AFTER
 * hydration is not in the markup, so it is not in the per-page sum. Compare
 * the artifact total as well, which counts every emitted chunk whether a page
 * requests it or not, and treat a change that moves one and not the other as
 * a question rather than an answer.
 *
 * Usage: node docs/bundle-bytes.mjs <dir-with-html> <static-dir> [--json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";

function walk(dir, ext) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const [htmlRoot, staticRoot] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");

const js = walk(resolve(staticRoot), ".js");
let raw = 0;
let gz = 0;
for (const file of js) {
  const bytes = readFileSync(file);
  raw += bytes.length;
  gz += gzipSync(bytes, { level: 9 }).length;
}

const pages = {};
const unresolvedTotal = [];
// A mistyped build path must FAIL, not report plausible artifact totals with
// an empty page table that a reader would take for "no page changed".
const htmlFiles = walk(resolve(htmlRoot), ".html");
if (htmlFiles.length === 0) {
  throw new Error(`no prerendered HTML under ${resolve(htmlRoot)} — wrong build mode or wrong path?`);
}
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  let total = 0;
  let counted = 0;
  const unresolved = [];
  for (const src of new Set(srcs)) {
    // Strip any basePath/origin: the file is found under the static root.
    const idx = src.indexOf("/_next/");
    if (idx === -1) {
      if (!/^(https?:|data:)/.test(src)) unresolved.push(src);
      continue;
    }
    const candidate = join(resolve(staticRoot), "..", src.slice(idx + "/_next/".length));
    try {
      if (!statSync(candidate).isFile()) {
        unresolved.push(src);
        continue;
      }
      total += gzipSync(readFileSync(candidate), { level: 9 }).length;
      counted += 1;
    } catch {
      unresolved.push(src);
    }
  }
  // A script the page asks for and this tool could not find makes the sum too
  // SMALL — i.e. it flatters the measurement exactly when it is invalid. So it
  // is reported, and the run exits non-zero at the end.
  if (unresolved.length > 0) unresolvedTotal.push(...unresolved.map((u) => `${file}: ${u}`));
  const route = `/${relative(resolve(htmlRoot), file).replace(/\.html$/, "")}`.replace(/\/index$/, "/");
  pages[route === "/index" ? "/" : route] = { gzip: total, scripts: counted };
}

const result = { staticRoot, raw, gzip: gz, files: js.length, pages, unresolved: unresolvedTotal };
if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${js.length} JS files  raw ${raw}  gzip ${gz}`);
  for (const [route, v] of Object.entries(pages).sort()) {
    console.log(`${route.padEnd(28)} ${String(v.gzip).padStart(9)} B gzip  (${v.scripts} scripts)`);
  }
}
if (unresolvedTotal.length > 0) {
  console.error(`UNRESOLVED scripts, the numbers above are too small:\n${unresolvedTotal.join("\n")}`);
  process.exit(1);
}
