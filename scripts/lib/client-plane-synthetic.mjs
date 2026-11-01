/**
 * Synthetic half of scripts/verify-client-plane.mjs --self-attack.
 *
 * Copies the scripts and the whole compat tree into a temp repository and mutates one copy per check,
 * requiring exactly the matching check to go red. The constructions still run against a real plugin
 * directory (read-only), so checks 3 and 5 SKIP where no plugin is installed.
 */
export async function selfAttack(k) {
  const { runAll, tmpdir, join, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, cpSync } = k
  const PROJECT = process.cwd()
  const build = () => {
    const root = mkdtempSync(join(tmpdir(), "r25-world-"))
    cpSync(join(PROJECT, "scripts"), join(root, "scripts"), { recursive: true })
    cpSync(join(PROJECT, "compat"), join(root, "compat"), { recursive: true })
    const world = {
      label: "synthetic (copied artifacts)",
      baseDir: root,
      surface: join(root, "compat", "surface", "client-0.2.1-alpha.1.json"),
      report: join(root, "compat", "adaptation", "client-plane.json"),
      targets: join(root, "compat", "adaptation", "usage-targets.json"),
      checker: join(root, "scripts", "check-client-plane.mjs"),
      kernelBase: PROJECT,
    }
    return { root, world }
  }
  const json = (file) => JSON.parse(readFileSync(file, "utf8"))
  const save = (file, doc) => writeFileSync(file, JSON.stringify(doc, null, 1) + "\n")
  const firstPresentSlot = (doc) => doc.plugins.flatMap((plugin) => (plugin.slotRows ?? []).map((row) => ({ plugin, row }))).find(({ row }) => row.class === "present") ?? null
  const attacks = {
    1: ({ world }) => { const doc = json(world.surface); doc.counts.slots += 1; save(world.surface, doc) },
    2: ({ world }) => { const doc = json(world.report); const found = firstPresentSlot(doc); found.row.class = "absent-from-slot-map"; save(world.report, doc) },
    3: ({ world }) => { const text = readFileSync(world.checker, "utf8"); writeFileSync(world.checker, text.replace("declared === null ? 'absent-from-slot-map' : 'present'", "'present'")) },
    4: ({ world }) => {
      const doc = json(world.report)
      for (const plugin of doc.plugins) for (const row of plugin.rows ?? []) if (row.name === "remote" && row.class === "present") row.declaredIn = ["core/deepseek-harness/packages/client/locale/src/client/index.ts:85"]
      save(world.report, doc)
    },
    5: ({ world }) => { const text = readFileSync(world.checker, "utf8"); writeFileSync(world.checker, text.replace("declared === null ? 'absent-from-client-surface' : 'present'", "'present'")) },
  }
  const clean = build()
  const base = await runAll(clean.world)
  const baseOk = base.failed.length === 0
  console.log("")
  console.log("  synthetic baseline: " + (baseOk ? "five checks hold" + (base.skipped.length > 0 ? " (" + JSON.stringify(base.skipped) + " skipped: no plugin on this machine)" : "") : "FAILED failed=" + JSON.stringify(base.failed) + " skipped=" + JSON.stringify(base.skipped)))
  rmSync(clean.root, { recursive: true, force: true })
  const lines = []
  let localised = baseOk
  for (const step of ["1", "2", "3", "4", "5"]) {
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
  console.log("with the copied artifacts mutated, one check at a time:")
  for (const line of lines) console.log(line)
  console.log("")
  console.log((baseOk ? "the synthetic baseline held" : "the synthetic baseline did NOT hold") + "; every attack localised: " + String(localised))
  process.exit(baseOk && localised ? 0 : 1)
}

