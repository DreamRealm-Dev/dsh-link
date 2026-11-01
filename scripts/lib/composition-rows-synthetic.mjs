/**
 * The synthetic half of scripts/verify-composition-rows.mjs --self-attack.
 *
 * Builds a throwaway world whose producers are the stubs in ./synthetic/ (same contracts as the real
 * reader, composer and probe: reader --check, readPatchFile, analyzeProfile, a dump-diff artifact),
 * requires all nine checks of the gate to hold there, then mutates that world once per check and
 * requires exactly the matching check to go red. Nothing here touches the real tree.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const STUBS = join(HERE, "synthetic")
const stub = (name) => readFileSync(join(STUBS, name), "utf8")

const INDEX = {
  format: "dsh-link.row-fixtures/1",
  note: "synthetic pair",
  cites: {},
  fixtures: [
    { file: "08-layer-config-base.patch.yml", idiom: "base half", question: "synthetic", expectedByDocs: "synthetic" },
    { file: "09-layer-config-replace.patch.yml", idiom: "replace half", question: "stacked after 08", expectedByDocs: "synthetic" },
  ],
}
const TABLE = (rawExcerpt) => ({
  format: "dsh-link.loader-row-behaviour/1",
  kernel: { root: "synthetic", cliEntry: "apps/cli/src/bin.ts", profile: "web" },
  method: { compose: "synthetic", home: "synthetic", authority: "synthetic" },
  baseline: { exitStatus: 0, rows: 4, warnings: [] },
  cases: [
    { id: "case-measured", question: "synthetic", constructed: "synthetic", command: "node --import tsx/esm bin.ts --profile web --dump-config --patch layer.yml", exitStatus: 0, elapsedMs: 5, calibrationRowPresent: true, observed: { warnings: [] }, rawExcerpt, verdict: "composition kept the row", measured: true, labels: ["实测", "构造触发"] },
    { id: "case-code", question: "synthetic", constructed: "synthetic", command: "node --import tsx/esm bin.ts --profile web --dump-config --patch layer.yml", exitStatus: 0, elapsedMs: 4, observed: {}, rawExcerpt: "- id: other", verdict: "row skipped by the documented rule", measured: false, labels: ["代码可证"] },
  ],
})

export async function selfAttack(k) {
  const { runAll } = k
  const build = () => {
    const root = mkdtempSync(join(tmpdir(), "r33-world-"))
    const rowsOut = join(root, "compat", "adaptation", "rows")
    const rowsDir = join(root, "rows")
    const live = join(root, "live", "profiles", "web")
    const bundleDir = join(live, "node_modules", "bundle-early")
    const dirs = [join(root, "scripts"), join(root, "plugins", "dsh-link-mods"), rowsDir, join(rowsOut, "reports"), join(rowsOut, "fixtures"), join(root, ".tmp"), join(root, "node_modules", "tsx"), live, bundleDir]
    for (const dir of dirs) mkdirSync(dir, { recursive: true })
    for (const name of ["read-composition-rows.mjs", "compose-profile-rows.mjs", "probe-live-composition.mjs"]) writeFileSync(join(root, "scripts", name), stub(name))
    writeFileSync(join(root, "plugins", "dsh-link-mods", "presets.patch.yml"), stub("presets.patch.yml"))
    writeFileSync(join(rowsDir, "row-base.patch.yml"), stub("row-base.patch.yml"))
    writeFileSync(join(rowsOut, "fixtures", "08-layer-config-base.patch.yml"), stub("08-layer-config-base.patch.yml"))
    writeFileSync(join(rowsOut, "fixtures", "09-layer-config-replace.patch.yml"), stub("09-layer-config-replace.patch.yml"))
    writeFileSync(join(rowsOut, "fixtures", "index.json"), JSON.stringify(INDEX, null, 1) + "\n")
    writeFileSync(join(rowsOut, "loader-behaviour.json"), JSON.stringify(TABLE("- id: calibration\n  name: cal"), null, 1) + "\n")
    writeFileSync(join(live, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["bundle-early"] } } }, null, 1))
    writeFileSync(join(bundleDir, "package.json"), JSON.stringify({ name: "bundle-early", dsh: { bundle: { patch: "./cordis.patch.yml" } } }, null, 1))
    writeFileSync(join(bundleDir, "cordis.patch.yml"), "- insert:\n    - id: thinking-loop-guard\n      config:\n        k: dead\n")
    writeFileSync(join(live, "cordis.patch.yml"), "- id: thinking-loop-guard\n  config:\n    k: live\n")
    const world = {
      label: "synthetic (stub producers)",
      baseDir: root,
      tmpRoot: join(root, ".tmp"),
      rowsRoot: rowsDir,
      reader: join(root, "scripts", "read-composition-rows.mjs"),
      composer: join(root, "scripts", "compose-profile-rows.mjs"),
      probe: join(root, "scripts", "probe-live-composition.mjs"),
      reportsDir: join(rowsOut, "reports"),
      table: join(rowsOut, "loader-behaviour.json"),
      fixturesDir: join(rowsOut, "fixtures"),
      composition: join(rowsOut, "profile-composition.json"),
      dumpDiff: join(rowsOut, "dump-diff.json"),
      presetsFile: join(root, "plugins", "dsh-link-mods", "presets.patch.yml"),
      liveProfile: live,
      kernelCli: join(root, "scripts", "probe-live-composition.mjs"),
      kernelRoot: root,
      pendingUpstream: false,
    }
    regenerate(world)
    return { root, world }
  }
  const regenerate = (world) => {
    const run = spawnSync(process.execPath, [world.reader], { cwd: world.baseDir, encoding: "utf8" })
    if (run.status !== 0) throw new Error("regenerating the synthetic report failed")
  }
  const patch = (file, from, to) => {
    const before = readFileSync(file, "utf8")
    if (!before.includes(from)) throw new Error("attack target not found in " + file + ": " + from)
    writeFileSync(file, before.replace(from, to))
  }
  const attacks = {
    1: ({ world }) => { const file = join(world.reportsDir, "rows.json"); writeFileSync(file, readFileSync(file, "utf8") + " ") },
    2: ({ world }) => { patch(world.reader, "line: index + 1, origin", "line: index + 1001, origin"); regenerate(world) },
    3: ({ world }) => { patch(world.reader, "rows: all.length,", "rows: all.length + 1,"); regenerate(world) },
    4: ({ world }) => { writeFileSync(world.table, JSON.stringify(TABLE(""), null, 1) + "\n") },
    5: ({ world }) => { writeFileSync(join(world.fixturesDir, "index.json"), JSON.stringify({ ...INDEX, fixtures: [INDEX.fixtures[0]] }, null, 1) + "\n") },
    6: ({ world }) => { patch(world.composer, 'kind: "profile", name: "cordis.patch.yml", missing: false', 'kind: "profile", name: "cordis.patch.yml", index: -1, missing: false') },
    7: ({ world }) => { patch(world.composer, "const dead = ordered.filter((item) => item !== winner && item.hasConfig)", "const dead = []") },
    8: ({ world }) => { patch(world.reader, "if (/^\\s*config:\\s*$/.test(line))", "if (false && /^\\s*config:\\s*$/.test(line))"); regenerate(world) },
    9: ({ world }) => {
      patch(world.probe, "agree: true,", "agree: false,")
      patch(world.probe, "onlyInDump: [],", 'onlyInDump: ["ghost-id"],')
      patch(world.probe, "onlyInDump: 0,", "onlyInDump: 1,")
    },
  }

  const clean = build()
  const base = await runAll(clean.world)
  const baseOk = base.failed.length === 0 && base.skipped.length === 0
  console.log("")
  console.log("  synthetic baseline: " + (baseOk ? "all nine checks hold" : "FAILED failed=" + JSON.stringify(base.failed) + " skipped=" + JSON.stringify(base.skipped)))
  rmSync(clean.root, { recursive: true, force: true })

  const lines = []
  let localised = true
  for (const step of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    const built = build()
    let outcome = ""
    try {
      attacks[step](built)
      const seen = await runAll(built.world)
      const expected = Number(step)
      const ok = seen.failed.length === 1 && seen.failed[0] === expected
      outcome = ok ? "check " + String(expected) + " red, others green" : "expected only check " + String(expected) + " red, observed failed=" + JSON.stringify(seen.failed) + " skipped=" + JSON.stringify(seen.skipped)
      if (!ok) localised = false
    } catch (error) {
      outcome = "attack could not be applied: " + (error instanceof Error ? error.message : String(error))
      localised = false
    }
    lines.push("  attack " + step + ": " + outcome)
    rmSync(built.root, { recursive: true, force: true })
  }
  console.log("")
  console.log("with the synthetic world mutated, one check at a time:")
  for (const line of lines) console.log(line)
  console.log("")
  console.log((baseOk ? "the synthetic baseline held" : "the synthetic baseline did NOT hold") + "; every attack localised: " + String(localised))
  process.exit(baseOk && localised ? 0 : 1)
}
