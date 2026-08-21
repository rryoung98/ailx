import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, itemId } from "@ailx/core";
import { sha256Hex } from "./loader.js";

export interface BankHashReport {
  path: string;
  itemCount: number;
  rewrittenIds: number;
  canonicalizedLines: number;
  sha256: string;
  changed: boolean;
}

/**
 * Rewrite a bank.jsonl so every line is canonical JSON with a
 * content-addressed id (id = sha256(canonical_json(item minus id))),
 * and write bank.sha256 beside it.
 */
export function hashBank(bankPath: string, write: boolean): BankHashReport {
  const raw = readFileSync(bankPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  let rewrittenIds = 0;
  let canonicalizedLines = 0;
  const outLines = lines.map((line, i) => {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error(`${bankPath}:${i + 1}: not valid JSON`);
    }
    const { id: storedId, ...content } = obj;
    const expected = itemId(content);
    if (storedId !== expected) rewrittenIds += 1;
    const out = canonicalJson({ ...content, id: expected });
    if (out !== line) canonicalizedLines += 1;
    return out;
  });
  const outRaw = outLines.join("\n") + "\n";
  const digest = sha256Hex(outRaw);
  const changed = outRaw !== raw;
  if (write) {
    writeFileSync(bankPath, outRaw);
    writeFileSync(bankPath.replace(/\.jsonl$/, ".sha256"), digest + "  bank.jsonl\n");
  }
  return {
    path: bankPath,
    itemCount: outLines.length,
    rewrittenIds,
    canonicalizedLines,
    sha256: digest,
    changed,
  };
}
