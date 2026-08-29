/**
 * T1 ZIP validation + content-addressed snapshot — the pure scored-artifact
 * pipeline. Hostile archives (zip-slip, symlinks, bombs, encryption, lying
 * metadata) must be rejected with precise codes; honest archives must digest
 * deterministically regardless of ZIP encoding.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "@ailx/core";
import { SnapshotError } from "../src/t1/errors.js";
import { T1_LIMITS, T1_MIME_BY_EXTENSION, snapshotFromZip } from "../src/t1/snapshot.js";
import { readZip } from "../src/t1/zip.js";
import { buildZip, siteZip, type FixtureEntry } from "./t1-fixtures.js";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof SnapshotError) return err.code;
    throw err;
  }
  throw new Error("expected SnapshotError");
}

describe("readZip structural validation", () => {
  it("rejects non-ZIP bytes and truncated buffers", () => {
    expect(code(() => snapshotFromZip(new TextEncoder().encode("PK not really")))).toBe("bad_zip");
    expect(code(() => snapshotFromZip(new Uint8Array(3)))).toBe("bad_zip");
    expect(code(() => snapshotFromZip(new Uint8Array(0)))).toBe("bad_zip");
  });

  it("accepts an archive with a trailing comment", () => {
    const zip = buildZip([{ path: "index.html", data: "x" }], { comment: "hello" });
    expect(snapshotFromZip(zip).fileCount).toBe(1);
  });

  it("rejects encrypted entries", () => {
    const zip = buildZip([{ path: "index.html", data: "x", flags: 0x1 }]);
    expect(code(() => snapshotFromZip(zip))).toBe("unsupported_zip");
  });

  it("rejects unsupported compression methods", () => {
    const zip = buildZip([{ path: "index.html", data: "x", method: 12 }]);
    expect(code(() => snapshotFromZip(zip))).toBe("unsupported_zip");
  });

  it("rejects zip64 markers", () => {
    const zip = buildZip([{ path: "index.html", data: "x" }], { totalEntriesOverride: 0xffff });
    expect(code(() => snapshotFromZip(zip))).toBe("unsupported_zip");
  });

  it("rejects CRC mismatches", () => {
    const zip = buildZip([{ path: "index.html", data: "x", crcOverride: 0xdeadbeef }]);
    expect(code(() => snapshotFromZip(zip))).toBe("bad_zip");
  });

  it("rejects entries whose declared size disagrees with reality", () => {
    const zip = buildZip([{ path: "index.html", data: "xxxx", uncompSizeOverride: 2 }]);
    expect(code(() => snapshotFromZip(zip))).toBe("bad_zip");
  });

  it("skips directory entries but keeps files inside them", () => {
    const zip = buildZip([
      { path: "assets/", data: "" },
      { path: "index.html", data: "x" },
      { path: "assets/a.css", data: "b{}" },
    ]);
    const snap = snapshotFromZip(zip);
    expect(snap.manifest.map((f) => f.path)).toEqual(["assets/a.css", "index.html"]);
  });

  it("supports stored (method 0) entries", () => {
    const zip = buildZip([{ path: "index.html", data: "plain", method: 0 }]);
    expect(snapshotFromZip(zip).totalBytes).toBe(5);
  });

  it("rejects undecodable entry names", () => {
    const zip = buildZip([{ path: "index.html", data: "x" }]);
    // Corrupt the local+central name bytes ("index.html" occurs twice).
    const bad = Uint8Array.from(zip);
    let patched = 0;
    for (let i = 0; i < bad.length - 1; i++) {
      if (bad[i] === 0x69 && bad[i + 1] === 0x6e) {
        bad[i] = 0xff;
        patched++;
      }
    }
    expect(patched).toBe(2);
    expect(code(() => snapshotFromZip(bad))).toBe("bad_zip");
  });
});

describe("limits (declared sizes, before decompression)", () => {
  it("rejects too many files from the EOCD count", () => {
    const entries: FixtureEntry[] = [{ path: "index.html", data: "x" }];
    for (let i = 0; i < T1_LIMITS.maxFiles; i++) entries.push({ path: `f${i}.txt`, data: "x" });
    expect(code(() => snapshotFromZip(buildZip(entries)))).toBe("too_many_files");
  });

  it("rejects a single over-limit file WITHOUT inflating it", () => {
    // 10 MB + 1 declared: a real bomb would inflate to gigabytes; the declared
    // size alone must reject it.
    const zip = buildZip([
      { path: "big.txt", data: "tiny", uncompSizeOverride: T1_LIMITS.maxFileBytes + 1 },
    ]);
    expect(code(() => snapshotFromZip(zip))).toBe("file_too_large");
  });

  it("rejects when the declared total crosses the cap", () => {
    const limits = { maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 150 };
    const zip = buildZip([
      { path: "a.txt", data: "x".repeat(100) },
      { path: "b.txt", data: "y".repeat(100) },
    ]);
    expect(code(() => readZip(zip, limits))).toBe("total_too_large");
  });

  it("accepts an archive exactly at the file-count limit", () => {
    const entries: FixtureEntry[] = [{ path: "index.html", data: "x" }];
    for (let i = 0; i < T1_LIMITS.maxFiles - 1; i++) entries.push({ path: `f${i}.txt`, data: "x" });
    expect(snapshotFromZip(buildZip(entries)).fileCount).toBe(T1_LIMITS.maxFiles);
  });
});

describe("path and type policy", () => {
  const evilPaths = [
    "../evil.html",
    "a/../../evil.html",
    "/etc/passwd.txt",
    "a//b.css",
    "./index.html",
    "C:evil.html",
    "a\\b.html",
    "nul\u0000.html",
  ];
  for (const p of evilPaths) {
    it(`rejects unsafe path ${JSON.stringify(p)}`, () => {
      const zip = buildZip([
        { path: "index.html", data: "x" },
        { path: p, data: "x" },
      ]);
      expect(code(() => snapshotFromZip(zip))).toBe("unsafe_path");
    });
  }

  it("rejects over-long paths", () => {
    const zip = buildZip([
      { path: "index.html", data: "x" },
      { path: `${"a".repeat(T1_LIMITS.maxPathLength)}.txt`, data: "x" },
    ]);
    expect(code(() => snapshotFromZip(zip))).toBe("unsafe_path");
  });

  it("rejects symlink entries", () => {
    const zip = buildZip([
      { path: "index.html", data: "x" },
      { path: "link.css", data: "target.css", symlink: true },
    ]);
    expect(code(() => snapshotFromZip(zip))).toBe("symlink");
  });

  it("rejects disallowed extensions (server code, nested archives, none)", () => {
    for (const p of ["run.php", "inner.zip", "app.exe", "Makefile", "script.sh"]) {
      const zip = buildZip([
        { path: "index.html", data: "x" },
        { path: p, data: "x" },
      ]);
      expect(code(() => snapshotFromZip(zip))).toBe("disallowed_type");
    }
  });

  it("extensions are matched case-insensitively", () => {
    const snap = snapshotFromZip(buildZip([
      { path: "index.html", data: "x" },
      { path: "logo.PNG", data: "p" },
    ]));
    expect(snap.manifest.find((f) => f.path === "logo.PNG")?.contentType).toBe("image/png");
  });

  it("rejects duplicate paths, including case-insensitive duplicates", () => {
    const dup = buildZip([
      { path: "index.html", data: "a" },
      { path: "index.html", data: "b" },
    ]);
    expect(code(() => snapshotFromZip(dup))).toBe("duplicate_path");
    const caseDup = buildZip([
      { path: "index.html", data: "x" },
      { path: "A.css", data: "a" },
      { path: "a.css", data: "b" },
    ]);
    expect(code(() => snapshotFromZip(caseDup))).toBe("duplicate_path");
  });

  it("requires index.html at the root", () => {
    expect(code(() => snapshotFromZip(buildZip([{ path: "main.css", data: "x" }])))).toBe("missing_index");
    expect(code(() => snapshotFromZip(buildZip([{ path: "sub/index.html", data: "x" }])))).toBe("missing_index");
  });

  it("rejects an empty archive", () => {
    expect(code(() => snapshotFromZip(buildZip([])))).toBe("empty_zip");
    expect(code(() => snapshotFromZip(buildZip([{ path: "dir/", data: "" }])))).toBe("empty_zip");
  });

  it("every allowlisted extension maps to a non-empty content type", () => {
    for (const [ext, mime] of Object.entries(T1_MIME_BY_EXTENSION)) {
      expect(ext).toMatch(/^[a-z0-9]+$/);
      expect(mime).toMatch(/^[a-z]+\//);
    }
  });
});

describe("content-addressed digest", () => {
  it("is deterministic across entry order and compression method", () => {
    const a = snapshotFromZip(buildZip([
      { path: "index.html", data: "<h1>x</h1>" },
      { path: "style.css", data: "b{}" },
    ]));
    const b = snapshotFromZip(buildZip([
      { path: "style.css", data: "b{}", method: 0 },
      { path: "index.html", data: "<h1>x</h1>" },
    ]));
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any file's bytes change", () => {
    const a = snapshotFromZip(siteZip({}, "<h1>a</h1>"));
    const b = snapshotFromZip(siteZip({}, "<h1>b</h1>"));
    expect(a.digest).not.toBe(b.digest);
  });

  it("changes when a path changes, even with identical bytes", () => {
    const a = snapshotFromZip(siteZip({ "a.css": "b{}" }));
    const b = snapshotFromZip(siteZip({ "b.css": "b{}" }));
    expect(a.digest).not.toBe(b.digest);
  });

  it("is byte-identically recomputable from the manifest (the scoring invariant)", () => {
    const snap = snapshotFromZip(siteZip({ "a.css": "b{}" }));
    const recomputed = createHash("sha256")
      .update(canonicalJson({ version: 1, files: snap.manifest }))
      .digest("hex");
    expect(snap.digest).toBe(`sha256:${recomputed}`);
    // And each file hash matches its bytes.
    for (const f of snap.files) {
      expect(createHash("sha256").update(f.data).digest("hex")).toBe(f.sha256);
      expect(f.bytes).toBe(f.data.length);
    }
  });

  it("manifest is sorted by path and totals add up", () => {
    const snap = snapshotFromZip(siteZip({ "z.css": "zz", "a.css": "aaa" }));
    expect(snap.manifest.map((f) => f.path)).toEqual(["a.css", "index.html", "z.css"]);
    expect(snap.totalBytes).toBe(snap.files.reduce((s, f) => s + f.bytes, 0));
    expect(snap.fileCount).toBe(3);
  });
});
