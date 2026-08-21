#!/usr/bin/env node
/**
 * hash-bank [--write] <bank.jsonl>...
 * Verifies (default) or rewrites (--write) content-addressed item ids and
 * bank.sha256. Exit 1 if verification fails.
 */
import { hashBank } from "../bank.js";

const args = process.argv.slice(2);
const write = args.includes("--write");
const paths = args.filter((a) => a !== "--write");
if (paths.length === 0) {
  console.error("usage: hash-bank [--write] <bank.jsonl>...");
  process.exit(2);
}
let failed = false;
for (const p of paths) {
  const r = hashBank(p, write);
  const status = write ? "wrote" : r.changed || r.rewrittenIds > 0 ? "STALE" : "ok";
  console.log(
    `${status}  ${p}  items=${r.itemCount} rewrittenIds=${r.rewrittenIds} ` +
    `canonicalized=${r.canonicalizedLines} sha256=${r.sha256}`,
  );
  if (!write && (r.changed || r.rewrittenIds > 0)) failed = true;
}
process.exit(failed ? 1 : 0);
