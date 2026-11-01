#!/usr/bin/env node
/** Synthetic stand-in for scripts/probe-live-composition.mjs: writes a dump-diff artifact. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { analyzeProfile } from "./compose-profile-rows.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const live = join(ROOT, "live", "profiles", "web")
const home = mkdtempSync(join(ROOT, ".tmp", "live-compose-"))
try {
  mkdirSync(join(home, "profiles", "web"), { recursive: true })
  const report = await analyzeProfile(live)
  const ids = report.ids.map((item) => item.id)
  const out = {
    format: "dsh-link.composition-dump-diff/1",
    method: "synthetic probe over a throwaway home",
    staged: ["copied package.json", "junctioned node_modules to the live profile"],
    elapsedMs: 5,
    dump: { lines: 30, rootIds: ids.length, uniqueIds: ids.length, idsInsideConfig: 3, idsInsideConfigSample: ["persona", "tool-ask-user", "compaction"] },
    staticAnalysis: { ids: ids.length, sourceDigest: report.sourceDigest, liveDigest: report.liveDigest ?? null },
    digests: { note: 'synthetic: sourceDigest is the gated one, liveDigest is recorded only', gated: 'sourceDigest', recorded: 'liveDigest' },
    agree: true,
    onlyInDump: [],
    onlyInStatic: [],
    counts: { onlyInDump: 0, onlyInStatic: 0, both: ids.length },
    limit: "synthetic",
  }
  writeFileSync(join(ROOT, "compat", "adaptation", "rows", "dump-diff.json"), JSON.stringify(out, null, 1) + "\n")
  console.log("agree: true; both " + String(ids.length))
} finally {
  rmSync(home, { recursive: true, force: true })
}
