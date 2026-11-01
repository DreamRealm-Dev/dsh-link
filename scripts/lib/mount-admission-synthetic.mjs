/**
 * Synthetic half of scripts/verify-mount-admission.mjs --self-attack.
 *
 * Copies the four artifacts into a temp tree, mutates one copy per check and requires exactly the
 * matching check to go red. Check 6 (the probe can fail) needs the live kernel, so it reports SKIP here
 * and the attacks cover the other eight. Nothing touches the real tree.
 */
const MOUNT = {
  format: "dsh-link.mount-admission/1",
  kernel: "<synthetic>",
  method: { boot: "stub", home: "stub", calibration: "every case also inserts a calibration row that must mount", mode: "minimal" },
  cases: [
    { id: "control-plain-row", question: "plain row", constructed: 'rows: [{"insert":[{"id":"r21-plain","name":"./r21-plain.mjs"}]}]', rawExcerpt: '{"event":"apply","tag":"calibration"}\n{"event":"apply","tag":"plain"}\n', measured: true, labels: ["实测"], calibrationMounted: true, observed: { mountedTags: ["calibration", "plain"], configByTag: { calibration: null, plain: null }, reading: "mounted: [calibration, plain]" } },
    { id: "disabled-true", question: "positive control", constructed: 'rows: [{"insert":[{"id":"r21-disabled","name":"./r21-disabled.mjs","disabled":true}]}]', rawExcerpt: '{"event":"apply","tag":"calibration"}\n{"event":"settled"}\n', measured: true, labels: ["实测"], calibrationMounted: true, observed: { mountedTags: ["calibration"], configByTag: { calibration: null }, reading: "mounted: [calibration]" } },
    { id: "legacy-disable-true", question: "0.1.x spelling", constructed: 'rows: [{"insert":[{"id":"legacy-disable","name":"./legacy-disable.mjs","disable":true}]}]', rawExcerpt: '{"event":"apply","tag":"legacy-disable","config":null}\n', measured: true, labels: ["实测"], calibrationMounted: true, observed: { mountedTags: ["calibration", "legacy-disable"], configByTag: { calibration: null, "legacy-disable": null }, reading: "mounted: [calibration, legacy-disable] | legacy-disable config=null" } },
    { id: "legacy-enabled-and-options", question: "dead metadata", constructed: 'rows: [{"insert":[{"id":"legacy-enabled","name":"./legacy-enabled.mjs","enabled":true,"options":{"keepMe":true}}]}]', rawExcerpt: '{"event":"apply","tag":"legacy-enabled","config":null}\n', measured: true, labels: ["实测"], calibrationMounted: true, observed: { mountedTags: ["calibration", "legacy-enabled"], configByTag: { calibration: null, "legacy-enabled": null }, reading: "mounted: [calibration, legacy-enabled] | legacy-enabled config=null" } },
    { id: "same-id-two-rows", question: "two rows on one id", constructed: 'rows: [{"insert":[{"id":"dupe-a","name":"./dupe-a.mjs"},{"id":"dupe-b","name":"./dupe-b.mjs"}]}]', rawExcerpt: '{"event":"apply","tag":"dupe-b","config":null}\n', measured: true, labels: ["实测"], calibrationMounted: true, observed: { mountedTags: ["calibration", "dupe-b"], configByTag: { calibration: null, "dupe-b": null }, reading: "mounted: [calibration, dupe-b] | dupe-b config=null" } },
  ],
}
const PORT = {
  format: "dsh-link.port-verdicts/1",
  note: "No overall verdict on purpose; items stay concrete.",
  verdicts: [
    { name: "@argszero/cordis-plugin-thinking-loop-guard", version: "0.1.9", items: [{ category: "peer-range-excludes-kernel", severity: "rewrite", detail: "peer @deepseek-ai/dsh-agent declares \">=0.1.6-alpha.1 <0.2.0\" and this kernel is 0.2.1-alpha.1: installing it asks for an explicit exemption", evidence: "package.json peerDependencies" }], unknown: [] },
    { name: "dsh-repeat-guard", version: "0.1.13", items: [{ category: "writes-own-state", severity: "unknown", detail: "keeps a counter beside the profile", evidence: "readme" }], unknown: [] },
  ],
  counts: { plugins: 2, items: 2, rewrite: 1, unknown: 1 },
}
const BEHAVIOUR = {
  format: "dsh-link.loader-row-behaviour/1",
  baseline: { exitStatus: 0, rows: 203, warnings: [] },
  cases: [
    { file: "10-disabled-bang-js-expression.patch.yml", exitStatus: 1, baselineRows: 203, composedRows: 0, rootIds: 0, observed: { added: [], removed: ["a", "b", "c"], warnings: [] }, rawExcerpt: "YAMLException: unknown tag !<!js> (8:27)", rawStderrExcerpt: "failed to parse overlay", reading: "layer-fatal: the dump failed (YAMLException: unknown tag !<!js>) and produced no composed tree, so its removed list is a byproduct", verdict: "layer-fatal: the dump failed and produced no composed tree", measured: true, labels: ["实测", "构造触发"] },
    { file: "06-disabled-js-expression.patch.yml", exitStatus: 0, baselineRows: 203, composedRows: 204, rootIds: 204, observed: { added: ["r21-js"], removed: [], warnings: [] }, rawExcerpt: "--dump-config output", reading: "applied with no diagnostics: 1 row(s) added, 0 changed", verdict: "applied with no diagnostics: 1 row(s) added, 0 changed", measured: true, labels: ["实测", "构造触发"] },
  ],
}
const INDEX = { format: "dsh-link.row-fixtures/1", note: "synthetic", cites: {}, fixtures: [
  { file: "11-insert-into-non-group.patch.yml", idiom: "insert into a non-group row", question: "synthetic", expectedByDocs: "vendor/include/src/index.ts:86-88", rawWarning: "patch insert: entry r21-non-group is not a group" },
  { file: "12-name-mismatch.patch.yml", idiom: "name mismatch", question: "synthetic", expectedByDocs: "vendor/include/src/index.ts:115-117", rawWarning: "patch: name mismatch for r21-mismatch (expected r21-other-name, got r21-mismatch-name), skipping" },
] }
const README = "# fixtures\n\n11 -> patch insert: entry r21-non-group is not a group\n12 -> patch: name mismatch for r21-mismatch (expected r21-other-name, got r21-mismatch-name), skipping\n"
const PROBE_STUB = ["#!/usr/bin/env node", "// synthetic probe stub: mentions its calibration row and has a failing exit path", "const calibrationMounted = process.argv.includes(\"--calibration-missing\")", "process.exit(calibrationMounted ? 0 : 1)", ""].join("\n")
const PORT_STUB = ["#!/usr/bin/env node", "// synthetic port-verdicts stub: --check always recomputes cleanly", "process.exit(0)", ""].join("\n")
const FIXTURE_11 = "# synthetic fixture 11\n- id: r21-non-group\n  name: plain\n\n"
const FIXTURE_12 = "# synthetic fixture 12\n- id: r21-mismatch\n  name: r21-mismatch-name\n\n"

export async function selfAttack(k) {
  const { runAll, tmpdir, join, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } = k
  const build = () => {
    const root = mkdtempSync(join(tmpdir(), "r21-world-"))
    const rows = join(root, "compat", "adaptation", "rows")
    const fixtures = join(rows, "fixtures")
    const scripts = join(root, "scripts")
    for (const dir of [rows, fixtures, scripts]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(rows, "mount-admission.json"), JSON.stringify(MOUNT, null, 1) + "\n")
    writeFileSync(join(root, "compat", "adaptation", "port-verdicts.json"), JSON.stringify(PORT, null, 1) + "\n")
    writeFileSync(join(rows, "loader-behaviour.json"), JSON.stringify(BEHAVIOUR, null, 1) + "\n")
    writeFileSync(join(fixtures, "index.json"), JSON.stringify(INDEX, null, 1) + "\n")
    writeFileSync(join(fixtures, "README.md"), README)
    writeFileSync(join(fixtures, "11-insert-into-non-group.patch.yml"), FIXTURE_11)
    writeFileSync(join(fixtures, "12-name-mismatch.patch.yml"), FIXTURE_12)
    writeFileSync(join(scripts, "port-verdicts.mjs"), PORT_STUB)
    writeFileSync(join(scripts, "probe-mount-admission.mjs"), PROBE_STUB)
    const world = {
      label: "synthetic (copied artifacts)",
      baseDir: root,
      rowsRoot: rows,
      mount: join(rows, "mount-admission.json"),
      port: join(root, "compat", "adaptation", "port-verdicts.json"),
      portScript: join(scripts, "port-verdicts.mjs"),
      probe: join(scripts, "probe-mount-admission.mjs"),
      behaviour: join(rows, "loader-behaviour.json"),
      fixtures,
      kernelCli: join(root, "no-kernel-here.ts"),
      kernelRoot: root,
    }
    return { root, world }
  }
  const json = (file) => JSON.parse(readFileSync(file, "utf8"))
  const save = (file, doc) => writeFileSync(file, JSON.stringify(doc, null, 1) + "\n")
  const caseOf = (doc, id) => doc.cases.find((item) => item.id === id)
  const attacks = {
    1: ({ world }) => { const doc = json(world.mount); delete caseOf(doc, "legacy-disable-true").rawExcerpt; save(world.mount, doc) },
    2: ({ world }) => { const doc = json(world.mount); caseOf(doc, "disabled-true").observed.mountedTags.push("r21-disabled"); save(world.mount, doc) },
    3: ({ world }) => { const doc = json(world.mount); const entry = caseOf(doc, "legacy-disable-true"); entry.observed.mountedTags = ["calibration"]; save(world.mount, doc) },
    4: ({ world }) => { const doc = json(world.mount); caseOf(doc, "legacy-enabled-and-options").observed.configByTag["legacy-enabled"] = { enable: true }; save(world.mount, doc) },
    5: ({ world }) => { const doc = json(world.mount); caseOf(doc, "same-id-two-rows").observed.mountedTags = ["calibration", "dupe-a", "dupe-b"]; save(world.mount, doc) },
    7: ({ world }) => { const doc = json(world.port); doc.verdicts[0].items = []; save(world.port, doc) },
    8: ({ world }) => { const doc = json(join(world.fixtures, "index.json")); doc.fixtures = doc.fixtures.filter((item) => !item.file.startsWith("12-")); save(join(world.fixtures, "index.json"), doc) },
    9: ({ world }) => { const doc = json(world.behaviour); const entry = doc.cases.find((item) => item.file.startsWith("10-")); entry.reading = "removed 203 row(s) from the composed tree"; entry.verdict = "removed 203 row(s) from the composed tree"; save(world.behaviour, doc) },
  }
  const clean = build()
  const base = await runAll(clean.world)
  const baseOk = base.failed.length === 0 && base.skipped.every((n) => n === 6)
  console.log("")
  console.log("  synthetic baseline: " + (baseOk ? "eight checks hold (check 6 SKIPs: it needs the live kernel)" : "FAILED failed=" + JSON.stringify(base.failed) + " skipped=" + JSON.stringify(base.skipped)))
  rmSync(clean.root, { recursive: true, force: true })
  const lines = []
  let localised = baseOk
  for (const step of ["1", "2", "3", "4", "5", "7", "8", "9"]) {
    const built = build()
    let outcome = ""
    try {
      attacks[step](built)
      const seen = await runAll(built.world)
      const expected = Number(step)
      const ok = seen.failed.length === 1 && seen.failed[0] === expected
      outcome = ok ? "check " + String(expected) + " red, others green" : "expected only check " + String(expected) + " red, observed failed=" + JSON.stringify(seen.failed)
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

