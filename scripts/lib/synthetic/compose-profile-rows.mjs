#!/usr/bin/env node
/**
 * Synthetic stand-in for scripts/compose-profile-rows.mjs, used only by the self-attack harness.
 * Same contract: exports analyzeProfile(profileDir) and answers with layers, ids, mentions, winner,
 * deadConfigLayers and sourceDigest, deciding the winner by layer order (last layer wins).
 */
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readPatchFile } from "./read-composition-rows.mjs"

// The repository this stub speaks for: its own directory's parent, exactly as the real producer resolves
// it. A file under it is repository-derived; anything else is the machine's own (R53 debt B1).
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** @param {string} file @returns {string} the real path, as far as the filesystem allows. */
function realOf(file) {
  try { return realpathSync(file) } catch { return resolve(file) }
}

/**
 * Whether a layer file lives inside the repository this stub stands for.
 *
 * @param {string} file - a layer file path.
 * @returns true when the file's real location is under the repository root.
 */
export function underRepo(file) {
  const real = realOf(file).replace(/\\/g, "/").toLowerCase()
  const root = realOf(REPO).replace(/\\/g, "/").toLowerCase()
  return real === root || real.startsWith(root + "/")
}

/**
 * The report as a gate compares it: the live-machine half is recorded, never a criterion.
 *
 * @param {Record<string, any>} report - a composition report.
 * @returns the report text with the live section emptied.
 */
export function stableText(report) {
  const stable = { ...report, liveDigest: null, liveInputs: [] }
  stable.layers = (report.layers ?? []).map((layer) => ({ ...layer, files: layer.files.filter((file) => file.origin === "repo") }))
  return JSON.stringify(stable, null, 1) + String.fromCharCode(10)
}

export async function analyzeProfile(profileDir) {
  const layers = []
  const files = []
  let index = 0
  const manifest = join(profileDir, "package.json")
  const bundles = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")).dsh?.profile?.bundles ?? []) : []
  for (const bundle of bundles) {
    const dir = join(profileDir, "node_modules", bundle)
    const pkg = join(dir, "package.json")
    if (!existsSync(pkg)) { layers.push({ index, kind: "bundle", name: bundle, missing: true, files: [] }); index += 1; continue }
    const declared = JSON.parse(readFileSync(pkg, "utf8")).dsh?.bundle?.patch
    const list = (Array.isArray(declared) ? declared : [declared]).filter((p) => typeof p === "string").map((p) => ({ path: resolve(dir, p) }))
    // The content digest travels with each record: a split whose inputs are only paths and existence
    // answers the same after an edit, which is what made checks 10 and 11 unable to move the stub (R53 B1).
    const digestOf = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16) : "missing")
    const recorded = list.map((f) => ({ path: f.path, exists: existsSync(f.path), origin: underRepo(f.path) ? "repo" : "live", digest: digestOf(f.path) }))
    for (const file of recorded) files.push(file)
    layers.push({ index, kind: "bundle", name: bundle, missing: false, files: recorded })
    index += 1
  }
  const profilePatch = join(profileDir, "cordis.patch.yml")
  if (existsSync(profilePatch)) {
    const profileRecord = { path: profilePatch, exists: true, origin: underRepo(profilePatch) ? "repo" : "live", digest: createHash("sha256").update(readFileSync(profilePatch)).digest("hex").slice(0, 16) }
    files.push(profileRecord)
    layers.push({ index, kind: "profile", name: "cordis.patch.yml", missing: false, files: [profileRecord] })
    index += 1
  }
  const mentions = new Map()
  let rowsRead = 0
  for (const layer of layers) {
    for (const file of layer.files) {
      if (!existsSync(file.path)) continue
      const parsed = await readPatchFile(file.path)
      for (const row of parsed.rows) {
        rowsRead += 1
        const list = mentions.get(row.id) ?? []
        list.push({ layerIndex: layer.index, layer: layer.name, file: file.path, line: row.line, kind: row.origin === "insert-child" ? "insert" : "field", hasConfig: row.hasConfig === true })
        mentions.set(row.id, list)
      }
    }
  }
  const ids = []
  for (const [id, list] of mentions) {
    const ordered = [...list].sort((a, b) => a.layerIndex - b.layerIndex || a.line - b.line)
    const winner = ordered[ordered.length - 1]
    const flags = []
    if (ordered.length > 1) flags.push("contested")
    if (ordered.filter((item) => item.kind === "insert").length > 1) flags.push("duplicateInsert")
    if (ordered.some((item) => item.kind === "field") && !ordered.some((item) => item.kind === "insert")) flags.push("orphanTarget")
    const dead = ordered.filter((item) => item !== winner && item.hasConfig)
    if (dead.length > 0) flags.push("configSuperseded")
    ids.push({ id, flags, winner, supersededConfigLayers: dead.map((item) => ({ layer: item.layer, file: item.file, line: item.line })), mentions: ordered })
  }
  ids.sort((a, b) => (a.id < b.id ? -1 : 1))
  const kindCount = (kind) => ids.filter((item) => item.flags.includes(kind)).length
  return {
    format: "dsh-link.profile-composition/1",
    profileDir,
    bundles: layers.filter((l) => l.kind === "bundle").map((l) => l.name),
    layers,
    counts: { rowsRead, ids: ids.length, contested: kindCount("contested"), configSuperseded: kindCount("configSuperseded") },
    ids,
    limits: [],
    // Two digests, two jobs: the repository half is what a gate may turn on, the machine half is only
    // recorded (R53 debt B2).
    sourceDigest: createHash("sha256").update(JSON.stringify(files.filter((file) => file.origin === "repo"))).digest("hex"),
    liveDigest: createHash("sha256").update(JSON.stringify(files.filter((file) => file.origin === "live"))).digest("hex"),
    liveInputs: files.filter((file) => file.origin === "live"),
  }
}
