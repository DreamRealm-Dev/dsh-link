#!/usr/bin/env node
/**
 * R73 (task-132): an instrument that boots a kernel or a profile must be able to say whether the
 * composition it read was still alive at the instant it read it - or say why it cannot.
 *
 * Why this exists: R67 proved a taskless 'headless' boot has the launcher dispose the whole tree a moment
 * after the profile boot resolves, so every sample taken afterwards describes an app that no longer exists
 * (a root-provided service such as dshHomePath stops resolving at the same instant). Three rounds of timer
 * readings were spent on that dead app before anyone noticed.
 *
 * What is read: this repository's script tree - every .mjs under scripts and under tools. The gate holds a
 * CHECKED-IN manifest of the files that boot a kernel/profile and asserts the manifest equals what its
 * detection finds, so a new instrument cannot slip in without someone deciding how it answers the
 * aliveness question. Each booter must carry one of two forms:
 *   control: a WIRED read of a root-provided service (one line naming dshHomePath or profileContext and
 *            calling get on it) AND a recorded verdict whose identifier contains 'alive'.
 *   exempt:  a line 'alive-control-exempt: <reason>' (or 'R73 exempt: <reason>') with a real reason.
 *
 * The shape set is three ways of booting: calling runProfile, initializing a profile from a default, and
 * spawning the CLI with a profile flag. A CLI launch that names only a positional subcommand plus an
 * overlay is a KNOWN GAP - scripts/debug.mjs boots the web app that way and the detector does not claim
 * it - because widening the shape set would put a file outside this gate's writers in the manifest.
 * Known gaps are written down here rather than left silent; whoever widens the detector must also decide
 * how the files it newly catches answer the aliveness question.
 *
 * Structural but falsifiable: the self-attack builds throwaway worlds (a probe reading a service of our
 * own instead of a root one, an exemption with an emptied reason, a booter carrying neither form, an
 * emptied world) and patches copies of this gate (a manifest that drops a booter, a detection pattern
 * narrowed to match nothing, a manifest row that does not exist, a lax classifier, a duplicated anchor, a
 * drifted declaration). A mutant whose flip set differs from its declaration fails.
 *
 * Usage: node scripts/verify-probe-alive-control.mjs [--project DIR] [--json] [--write-manifest] [--self-attack]
 * Exit 0 every reading held; 1 a reading failed; 3 an input is missing.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const NL = String.fromCharCode(10)
const HERE = fileURLToPath(import.meta.url)
const argv = process.argv.slice(2)
const option = (name, fallback) => { const i = argv.indexOf(name); return i === -1 ? fallback : argv[i + 1] }
const has = (name) => argv.includes(name)
const PROJECT = resolve(option('--project', resolve(dirname(HERE), '..')))
const JSON_OUT = has('--json')
const SELF_ATTACK = has('--self-attack')

const MANIFEST = [
  'scripts/fixtures/acceptance-boot.mjs',
  'scripts/fixtures/ops-boot.mjs',
  'scripts/fixtures/t52-boot.mjs',
  'scripts/probe-compat-simple.mjs',
  'scripts/probe-kernel-live.mjs',
  'scripts/probe-loader-boot.mjs',
  'scripts/probe-mount-admission.mjs',
  'scripts/probe-retry-boot.mjs',
  'scripts/probe-row-lifecycle.mjs',
  'scripts/verify-compat-consumer.mjs',
]
const ROOT_SERVICES = ['dshHomePath', 'profileContext']
// A file that READS one of our own services instead of a root one is caught twice over: it classifies as
// 'neither' (R2) because the wiring is what makes a control a control, and the classifier's own negative
// case in R8 reads exactly that shape and must refuse it.
// What counts as READING a service: a get call or a project-local reader that takes the name. A control
// may go through a helper (one probe does), so the rule is about the act, not about the spelling.
const READ_CALL = /\bget\s*\(|\bget\?\.\s*\(|\bread\s*\(/
// Every pattern is assembled from pieces so its full text never appears twice in this file: a mutation
// anchor that also matched the mutation table is how R71 and R72 each lost a mutant to a silent no-op.
const BOOT_PATTERNS = [
  { id: 'profile-boot', source: 'run' + 'Profile' + '\\s*\\(' },
  { id: 'profile-default', source: 'initialize' + 'ProfileFromDefault' + '\\s*\\(' },
  { id: 'app-boot', source: 'await ' + 'boot' + '\\s*\\(' + '|' + 'boot\\.' + 'boot' + '\\s*\\(' },
  // The third way this repository boots something: it spawns the CLI. The shape read here is the CALL -
  // a spawn whose argument list carries the profile flag - and the argv is built over several lines, so
  // the window is bounded rather than anchored to one line. A launch that names only a positional
  // subcommand plus an overlay is deliberately NOT matched, and the header says so: that gap is a
  // documented limit of the shape set, not a silent hole.
  { id: 'cli-profile', source: 'spawn' + '(?:Sync)?' + '\\s*\\(' + '[\\s\\S]{0,300}?' + '[' + "'" + '"]' + '--profile' + '[' + "'" + '"]' },
]
// The fourth way this repository starts a kernel: it spawns the CLI with a POSITIONAL subcommand plus an
// overlay. That shape was the documented gap R73 left behind (STATUS debt 50): an instrument nobody detected
// is an instrument nobody classified. It is a LAUNCHER and not an in-process booter - it mounts no plugin row
// of its own, so its witness cannot be a root-provided service; its witness is the child's own announcement
// (which it requires before reporting success) and the child's exit code. Both are recorded in the file, and
// the launcher form below reads exactly that pair instead of a service read.
const LAUNCH_PATTERNS = [
  // The shape reads a spawn that names the CLI entry and carries an overlay flag: an overlay flag alone is
  // also how a harness runs its own reader (measured: a gate in this tree does exactly that), so the entry
  // name is what separates a launch from a subprocess with arguments.
  { id: 'cli-subcommand', source: 'spawn' + '(?:Sync)?' + '\\s*\\(' + '[\\s\\S]{0,120}?' + 'apps/cli' + '[\\s\\S]{0,200}?' + '[' + "'" + '"]' + '--patch' + '[' + "'" + '"]' },
]
const LAUNCHERS = [
  'scripts/debug.mjs',
  'scripts/probe-kernel-surface.mjs',
  'scripts/probe-live-composition.mjs',
  'scripts/verify-compat-mounted-live.mjs',
  'scripts/verify-plugin-message-sources.mjs',
]
const RECORDED = /(alive[A-Za-z0-9_$]*|[A-Za-z0-9_$]*[Aa]live)\s*[:=]/
const EXEMPTION = /alive-control-exempt\s*[:：]\s*([^\r\n]*)/i
const EXEMPTION_ALT = /R73\s*exempt\s*[:：]\s*([^\r\n]*)/i
// R73 ruling: one vocabulary, the one the instruments carry. 'R73 alive-control: present - <how it reads
// the control>' and 'R73 alive-control: EXEMPT, with the reason - <why it cannot>'. The legacy spellings
// above stay readable because the throwaway worlds and the synthetic cases are written with them.
const PRESENT_MARK = /R73\s+alive-control\s*:\s*present\b/i
const EXEMPT_MARK = /R73\s+alive-control\s*:\s*EXEMPT\b/i
const EXEMPT_REASON_HEAD = /R73\s+alive-control\s*:\s*EXEMPT\b\s*,?\s*(?:with\s+the\s+reason)?\s*[-:：]?\s*/i
const BANNED_REASONS = ['n/a', 'na', 'none', 'todo', 'tbd', 'skip', '-', 'x']
const MIN_REASON = 8
const FILES_FLOOR = 100
// The roster floor is what "every instrument" means in practice: today's probe set. A mutant that narrows
// the roster pattern has to fall below this line to stay green, which is the point.
const ROSTER_FLOOR = 22
// The launcher list is small and that is the point: the floor stops a mutant from emptying it and calling the
// result clean.
const LAUNCHER_FLOOR = 1
const SYNTHETIC_CONTROL = [
  '// R73 attack world only: a synthetic aliveness control, never shipped.',
  'const rootAliveAtRead = (ctx) => { try { return ctx.reflect.get(' + "'dshHomePath'" + ', false) !== undefined } catch { return false } }',
  'export const probeAliveControl = (ctx) => ({ rootAlive: rootAliveAtRead(ctx) })',
].join(NL)
const GREEN_REASON = 'the profile it boots settles and exits on its own, so an aliveness sample would read a tree that is already gone by construction'
const join2 = (a, b) => a + b
const countOf = (text, needle) => text.split(needle).length - 1
const MANIFEST_ROW = join2("  'scripts/probe-row-lifecycle", ".mjs',")
const MANIFEST_ROW_LIVE = join2("  'scripts/probe-kernel-live", ".mjs',")
const DETECTION_ROW = join2("'profile-boot', source: 'run'", " + 'Profile'")
const KIND_LINE = join2("const kind = wired && recorded ? 'control'", " : exemptions.length > 0 ? 'exempt' : 'neither'")
const DECLARED_LINE = join2('const DECLARED', ' = 13')
const ANCHORS = [
  // R115: this mutant grew from ['R6','R9'] to ['R1','R6','R9'] because the promotion added
  // scripts/fixtures/t52-boot.mjs to the manifest and THAT file is the one detected through this very
  // profile-boot pattern - narrowing the pattern now also breaks the manifest-equals-detection equality.
  // The declaration follows a real new file; the mutant itself was not touched.
  { name: 'detection-narrowed', declared: ['R1', 'R6', 'R9'], from: DETECTION_ROW, to: DETECTION_ROW.replace('Profile', 'ProfileNeverMatches') },
  { name: 'manifest-drops-a-booter', declared: ['R1', 'R2', 'R7', 'R9'], from: MANIFEST_ROW, to: join2("  '// dropped", " by the manifest-drops-a-booter mutant',") },
  { name: 'manifest-lists-a-missing-file', declared: ['R1', 'R2', 'R7'], from: MANIFEST_ROW_LIVE, to: MANIFEST_ROW_LIVE + NL + join2("  'scripts/probe-does", "-not-exist.mjs',") },
  { name: 'classifier-lax', declared: ['R8', 'R11', 'R9'], from: KIND_LINE, to: join2("const kind = 'control'", '') },
  // The launcher pair the roster gained this round: narrowing the shape that finds it, and emptying the list
  // that names it, are the two ways this new reading could stop meaning anything.
  { name: 'launcher-detection-narrowed', declared: ['R12', 'R9'],
    from: join2("+ 'apps/cli'", " +"), to: join2("+ 'apps/cli-nowhere'", " +") },
  { name: 'launcher-dropped-from-list', declared: ['R12', 'R9'],
    from: join2("  'scripts/debug", ".mjs',"), to: join2('  // dropped', " by the launcher-dropped-from-list mutant',") },
  { name: 'anchor-duplicated', declared: ['R9'], from: MANIFEST_ROW, to: MANIFEST_ROW + NL + MANIFEST_ROW },
  { name: 'declaration-drifts', declared: ['R9', 'RD'], from: DECLARED_LINE, to: join2('const DECLARED', ' = 99') },
  { name: 'roster-narrowed', declared: ['R10', 'R9'],
    from: join2('  ])].', 'sort()'),
    to: join2('  ])].slice(0, 1).', 'sort()') },
]
const DECLARED = 13

const walk = (dir) => {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith('.mjs')) out.push(path)
  }
  return out
}
const relOf = (file) => relative(PROJECT, file).split(sep).join('/')
const scan = () => {
  const found = []
  for (const root of ['scripts', 'tools']) for (const file of walk(join(PROJECT, root))) found.push(relOf(file))
  return found.sort()
}
const classify = (text) => {
  const lines = text.split(/\r?\n/)
  // Prose about the control is not the control: comments are read out first, so a file that merely
  // documents the idea cannot pass, and a comment claiming a control the code does not implement is a
  // finding rather than a green.
  const code = lines.filter((line) => { const body = line.trim(); return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*') && !body.startsWith('#') })
  let named = null
  let reads = null
  for (const line of code) {
    const body = line.trim()
    if (named === null && ROOT_SERVICES.some((service) => line.includes(service))) named = body.slice(0, 110)
    if (reads === null && READ_CALL.test(line)) reads = body.slice(0, 110)
    if (named !== null && reads !== null) break
  }
  // The service name and the read may sit on different lines when the read is driven by a list of names:
  // that is the shape one probe uses, and it still answers "was the root service readable".
  const wired = named !== null && reads !== null
  const wiredLine = named === null ? reads : named
  // A recorded verdict means an identifier that says it is about aliveness, or a recorded root verdict.
  const recorded = code.some((line) => RECORDED.test(line) || /\broots?\s*[:=]/.test(line))
  // An exemption is read from EVERY line, comments included: a control must be executable, but a waiver is a
  // declared reason and prose is its natural form.
  const exemptions = exemptionsFrom(text)
  const kind = wired && recorded ? 'control' : exemptions.length > 0 ? 'exempt' : 'neither'
  return { kind, wired, wiredLine, recorded, exemptions }
}
const commentBody = (line) => line.replace(/^\s*(\/\/|\*|\/\*+|#)\s?/, '').replace(/\*\/\s*$/, '')
const exemptionsFrom = (text) => {
  const lines = text.split(/\r?\n/)
  const reasons = []
  for (let i = 0; i < lines.length; i += 1) {
    const legacy = EXEMPTION.exec(lines[i]) ?? EXEMPTION_ALT.exec(lines[i])
    if (legacy !== null) { reasons.push(legacy[1].trim()); continue }
    if (!EXEMPT_MARK.test(lines[i])) continue
    const body = commentBody(lines[i])
    const head = EXEMPT_REASON_HEAD.exec(body)
    const parts = head === null ? [] : [body.slice(head[0].length)]
    // The reason is prose and wraps: keep reading while the following lines are still comment text.
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]
      if (!/^\s*(\/\/|\*)/.test(next)) break
      parts.push(commentBody(next))
    }
    reasons.push(parts.join(' ').replace(/\s+/g, ' ').trim())
  }
  return reasons
}
const reasonIsReal = (reason) => reason.length >= MIN_REASON && !BANNED_REASONS.includes(reason.toLowerCase())
const detect = (files) => {
  const booters = []
  const cliLaunched = []
  const patternHits = new Map(BOOT_PATTERNS.map((pattern) => [pattern.id, []]))
  for (const file of files) {
    const text = readFileSync(join(PROJECT, file), 'utf8')
    const matched = BOOT_PATTERNS.filter((pattern) => new RegExp(pattern.source).test(text))
    if (matched.length === 0) continue
    // R6 reads this map as "does the documented shape still find a real file", so EVERY file a shape matched
    // is recorded here - including the ones classified as launchers two lines down. Diverting a whole shape
    // into the launcher class is a reason to change the class, not a reason to call the shape dead: before this
    // line moved, every file matched only by cli-profile went to cliLaunched and the shape reported 0 hits.
    for (const pattern of matched) patternHits.get(pattern.id).push(file)
    const inProcess = matched.filter((pattern) => pattern.id !== 'cli-profile')
    if (inProcess.length === 0) { cliLaunched.push(file); continue }
    booters.push(file)
  }
  const launchHits = new Map(LAUNCH_PATTERNS.map((pattern) => [pattern.id, []]))
  const launchers = []
  for (const file of files) {
    if (booters.includes(file)) continue
    if (cliLaunched.includes(file)) { launchers.push(file); continue }
    const text = readFileSync(join(PROJECT, file), 'utf8')
    const matched = LAUNCH_PATTERNS.filter((pattern) => new RegExp(pattern.source).test(text))
    if (matched.length === 0) continue
    launchers.push(file)
    for (const pattern of matched) launchHits.get(pattern.id).push(file)
  }
  return { booters: booters.sort(), patternHits, launchers: launchers.sort(), launchHits }
}

const readings = []
const held = (id, name, ok, detail) => readings.push({ id, name, ok: ok === true, detail })
const main = () => {
  const files = scan()
  const { booters, patternHits, launchers, launchHits } = detect(files)
  // The launcher list is asserted both ways for the same reason the booter manifest is: a shape nobody
  // detects is a shape that escapes the form checks, and a name nobody can find is a dead row.
  const missingLaunchers = launchers.filter((file) => !LAUNCHERS.includes(file))
  const launchersNotDetected = LAUNCHERS.filter((file) => !launchers.includes(file))
  held('R12', 'the launcher list equals what the detection finds, both ways',
    missingLaunchers.length === 0 && launchersNotDetected.length === 0 && launchers.length >= LAUNCHER_FLOOR,
    'detected=' + String(launchers.length) + ' listed=' + String(LAUNCHERS.length) + ' floor=' + String(LAUNCHER_FLOOR)
      + ' not-in-list=' + JSON.stringify(missingLaunchers) + ' not-detected=' + JSON.stringify(launchersNotDetected)
      + ' shapes=' + LAUNCH_PATTERNS.map((pattern) => pattern.id + '=' + String(launchHits.get(pattern.id).length)).join(' '))
  const missingFromManifest = booters.filter((file) => !MANIFEST.includes(file))
  const notDetected = MANIFEST.filter((file) => !booters.includes(file))
  held('R1', 'the checked-in manifest equals what the detection finds, both ways', missingFromManifest.length === 0 && notDetected.length === 0,
    'detected=' + String(booters.length) + ' manifest=' + String(MANIFEST.length) + ' not-in-manifest=' + JSON.stringify(missingFromManifest) + ' not-detected=' + JSON.stringify(notDetected))
  // The per-file readings read the union of what the manifest names and what the detection finds: a booter
  // that is missing from the manifest is a failure in its own right (R1), and it must not escape the form
  // checks just because nobody listed it.
  const union = [...new Set([...MANIFEST, ...booters])].sort()
  const table = union.map((file) => {
    const path = join(PROJECT, file)
    if (!existsSync(path)) return { file, kind: 'missing-file', wired: false, recorded: false, exemptions: [] }
    return { file, ...classify(readFileSync(path, 'utf8')) }
  })
  // R73 ruling: the roster is not only the booters. Every instrument that could read a live composition has
  // to say how it knows the composition was alive, and every probe that cannot boot has to say why not.
  // The roster gained the launchers this round: a file that starts a kernel by positional subcommand used to
  // be invisible to detection and therefore unclassified, which is the debt this change pays off. Every file
  // the gate detects, or lists for detection, is classified - that is what the roster means.
  const launcherForm = (text) => PRESENT_MARK.test(text) && RECORDED.test(text)
  const launcherFiles = [...new Set([...LAUNCHERS, ...launchers])]
  const roster = [...new Set([
    ...files.filter((file) => /^scripts\/probe-.*\.mjs$/.test(file)),
    // R115: the T52 gate's booter moved into scripts/fixtures/ during the promotion, and the
    // probe-* pattern alone would have let a file that boots a kernel sit outside the roster.
    ...files.filter((file) => /^scripts\/fixtures\/.*\.mjs$/.test(file)),
    ...booters.filter((file) => file.startsWith('tools/')),
    ...launcherFiles,
  ])].sort()
  const rosterTable = roster.map((file) => {
    const path = join(PROJECT, file)
    if (!existsSync(path)) return { file, kind: 'missing-file', text: '', exemptions: [] }
    const text = readFileSync(path, 'utf8')
    return { file, ...classify(text), text }
  })
  // Exemptions are judged wherever they appear: a probe that never boots can exempt itself, and a reason
  // that says nothing is a reason that says nothing no matter which kind of instrument carries it.
  const exemptSources = [...new Map([...table, ...rosterTable].map((row) => [row.file, row])).values()]
  const neither = table.filter((row) => row.kind === 'neither')
  const missingFiles = table.filter((row) => row.kind === 'missing-file')
  held('R2', 'every booter the manifest names carries a control reading or an exemption', neither.length === 0 && missingFiles.length === 0,
    'control=' + JSON.stringify(table.filter((row) => row.kind === 'control').map((row) => row.file))
      + ' exempt=' + JSON.stringify(table.filter((row) => row.kind === 'exempt').map((row) => row.file))
      + ' neither=' + JSON.stringify(neither.map((row) => row.file)) + ' missing-file=' + JSON.stringify(missingFiles.map((row) => row.file)))
  const unwired = table.filter((row) => row.recorded && !row.wired).map((row) => row.file)
  held('R3', 'an aliveness verdict in the tree is wired to a root service, never merely asserted', unwired.length === 0,
    'root-services=' + JSON.stringify(ROOT_SERVICES) + ' recorded-without-wiring=' + JSON.stringify(unwired))
  const badReasons = exemptSources.filter((row) => row.kind === 'exempt').flatMap((row) => row.exemptions.map((reason) => ({ file: row.file, reason, ok: reasonIsReal(reason) }))).filter((row) => !row.ok)
  held('R4', 'every exemption carries a reason that says something', badReasons.length === 0,
    'exemptions=' + JSON.stringify(exemptSources.filter((row) => row.kind === 'exempt').flatMap((row) => row.exemptions).map((reason) => reason.slice(0, 60))) + ' bad=' + JSON.stringify(badReasons.map((row) => row.file + ':' + row.reason)))
  held('R5', 'the scan really walked the tree it claims to walk',
    files.length >= FILES_FLOOR && files.some((file) => file.startsWith('scripts/')) && files.some((file) => file.startsWith('tools/')),
    'files=' + String(files.length) + ' floor=' + String(FILES_FLOOR) + ' scripts=' + String(files.filter((file) => file.startsWith('scripts/')).length) + ' tools=' + String(files.filter((file) => file.startsWith('tools/')).length))
  const deadPatterns = BOOT_PATTERNS.filter((pattern) => patternHits.get(pattern.id).length === 0)
  held('R6', 'every documented way of booting still matches a real file', deadPatterns.length === 0,
    BOOT_PATTERNS.map((pattern) => pattern.id + '=' + String(patternHits.get(pattern.id).length)).join(' ') + ' unmatched=' + JSON.stringify(deadPatterns.map((pattern) => pattern.id)))
  const absent = MANIFEST.filter((file) => !files.includes(file))
  held('R7', 'every manifest row is a file that exists', absent.length === 0, 'rows=' + String(MANIFEST.length) + ' absent=' + JSON.stringify(absent))
  const synthetic = [
    { text: SYNTHETIC_CONTROL, want: 'control' },
    { text: '// alive-control-exempt: ' + GREEN_REASON, want: 'exempt' },
    { text: 'const nothing = 1', want: 'neither' },
    { text: "const x = ctx.reflect.get('linkCollab', false)" + NL + 'const rootAlive = x', want: 'neither' },
    { text: "const y = ctx.reflect.get('dshHomePath', false)", want: 'neither' },
    { text: "const held = read('dshHomePath')" + NL + 'const rootAlive = held', want: 'control' },
    { text: '// reads dshHomePath and records rootAlive as a comment only', want: 'neither' },
    { text: '// R73 alive-control: present - reads a root service' + NL + "const rootAlive = ctx.reflect.get('dshHomePath', false) !== undefined", want: 'control' },
    { text: '// R73 alive-control: EXEMPT, with the reason - it never boots a kernel or a profile at all', want: 'exempt' },
    { text: '// R73 alive-control: EXEMPT, with the reason - n/a', want: 'exempt' },
    { text: "const rootNames = ['dshHomePath']" + NL + 'const held = ctx.reflect.get(name, false)' + NL + 'observation.root = rootState()', want: 'control' },
    { text: "const names = ['dshHomePath']" + NL + 'const held = ctx.reflect.get(name, false)', want: 'neither' },
    { text: '// R73 alive-control: present - samples rootState() (dshHomePath)' + NL + "const held = ctx.reflect.get('linkCollab', false)" + NL + 'const rootAlive = held', want: 'neither' },
  ]
  const misjudged = synthetic.filter((row) => classify(row.text).kind !== row.want).map((row) => row.want + '->' + classify(row.text).kind)
  held('R8', 'the classifier itself is exercised, including the shapes it must refuse', misjudged.length === 0,
    'cases=' + String(synthetic.length) + ' misjudged=' + JSON.stringify(misjudged))
  // Two rules, deliberately different. Every instrument must be CLASSIFIED: either it carries a wired
  // control reading, or it carries a real reason why it cannot. And an instrument that boots must carry the
  // control reading itself - an exemption is the answer for "I cannot read a live composition", not for
  // "I chose not to". A probe that never boots but does read the control is classified, not wrong: it meets
  // the stronger form, and asking it for an exemption as well would be asking it to say less.
  const unclassified = rosterTable.filter((row) => (row.kind === 'neither' && !(launcherFiles.includes(row.file) && launcherForm(row.text)))
    || row.kind === 'missing-file'
    || (row.kind === 'exempt' && !row.exemptions.some((reason) => reasonIsReal(reason))))
  const booterExempt = rosterTable.filter((row) => booters.includes(row.file) && row.kind === 'exempt').map((row) => row.file)
  // A launcher cannot read a root service (it mounts no row), so its accepted form is the launcher pair: the
  // marker that names the witness plus a recorded aliveness verdict. That is a reading, not a waiver - the
  // exemption path stays closed to it, exactly as it stays closed to an in-process booter.
  const launcherWrong = rosterTable
    .filter((row) => launcherFiles.includes(row.file) && row.kind !== 'control' && !launcherForm(row.text))
    .map((row) => row.file + ':launcher-without-a-witness')
  const wrongForm = [...unclassified.map((row) => row.file + ':' + row.kind), ...booterExempt.map((file) => file + ':booter-with-exemption'), ...launcherWrong]
  held('R10', 'every instrument in the roster is classified, and every instrument that boots carries the control reading itself',
    wrongForm.length === 0 && roster.length >= ROSTER_FLOOR,
    'roster=' + String(roster.length) + ' floor=' + String(ROSTER_FLOOR)
      + ' control=' + String(rosterTable.filter((row) => row.kind === 'control').length)
      + ' exempt=' + String(rosterTable.filter((row) => row.kind === 'exempt').length)
      + ' wrong-form=' + JSON.stringify(wrongForm)
      // R73: the roster is a list a reader has to be able to check, so every file it holds is named with
      // the classification this run gave it. A count without the names is a count nobody can audit.
      + ' classified=' + JSON.stringify(rosterTable.map((row) => row.file + ':' + row.kind)))
  const claimsPresentWithoutEvidence = rosterTable
    .filter((row) => PRESENT_MARK.test(row.text) && row.kind !== 'control' && !(launcherFiles.includes(row.file) && launcherForm(row.text)))
    .map((row) => row.file)
  // The contradiction this reads is a claim that says "I cannot read a live composition" beside the reading
  // itself: a file holding both is telling two stories about the same instant.
  const claimsExemptWhileReading = rosterTable.filter((row) => EXEMPT_MARK.test(row.text) && row.kind === 'control').map((row) => row.file)
  held('R11', 'what a file claims about its aliveness control is what this gate finds in the file',
    claimsPresentWithoutEvidence.length === 0 && claimsExemptWhileReading.length === 0,
    'present-claims-without-a-wired-read=' + JSON.stringify(claimsPresentWithoutEvidence)
      + ' exempt-claims-beside-a-control-reading=' + JSON.stringify(claimsExemptWhileReading))
  const source = readFileSync(HERE, 'utf8')
  const duplicated = ANCHORS.filter((anchor) => countOf(source, anchor.from) !== 1).map((anchor) => anchor.name)
  held('R9', 'every mutation anchor occurs exactly once in this gate source', duplicated.length === 0,
    'anchors=' + String(ANCHORS.length) + ' not-unique=' + JSON.stringify(duplicated))
  held('RD', 'the declared reading count matches the readings this run produced', readings.length + 1 === DECLARED,
    'declared=' + String(DECLARED) + ' produced=' + String(readings.length + 1))
  return readings
}

const runGate = (gateFile, project, target) => {
  const result = spawnSync(process.execPath, [gateFile, '--project', project, '--json'], { encoding: 'utf8', timeout: 300000 })
  const text = (result.stdout ?? '') + (result.stderr ?? '')
  const line = text.split(/\r?\n/).find((row) => row.trim().startsWith('{')) ?? ''
  let parsed = null
  try { parsed = JSON.parse(line) } catch { parsed = null }
  return { status: result.status, parsed, target, text }
}
const movedIds = (baseline, mutant) => {
  if (baseline.parsed === null || mutant.parsed === null) return null
  return baseline.parsed.readings.filter((row) => {
    const other = mutant.parsed.readings.find((row2) => row2.id === row.id)
    return other === undefined || other.ok !== row.ok
  }).map((row) => row.id)
}
const buildWorld = (root, name) => {
  const world = join(root, 'worlds', name)
  rmSync(world, { recursive: true, force: true })
  for (const part of ['scripts', 'tools']) {
    for (const file of walk(join(PROJECT, part))) {
      const target = join(world, relOf(file))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, readFileSync(file, 'utf8'))
    }
  }
  // Every instrument in the roster is classified, so a throwaway world is green only if each probe carries
  // the form its own kind requires: a booter needs the synthetic control, anything else needs the reason it
  // cannot read one. Without this the mutants would measure today's tree instead of measuring the readings.
  const worldProbes = walk(join(world, 'scripts')).filter((path) => /probe-.*\.mjs$/.test(path))
  for (const path of worldProbes) {
    const text = readFileSync(path, 'utf8')
    const row = classify(text)
    const booter = BOOT_PATTERNS.some((pattern) => new RegExp(pattern.source).test(text))
    if (booter && row.kind !== 'control') { writeFileSync(path, text + NL + SYNTHETIC_CONTROL + NL, 'utf8'); continue }
    if (!booter && row.kind !== 'control' && (row.kind !== 'exempt' || !row.exemptions.some((reason) => reasonIsReal(reason)))) {
      writeFileSync(path, text + NL + '// R73 alive-control: EXEMPT, with the reason - this throwaway world adds the classification the checked-in instrument does not carry yet' + NL, 'utf8')
    }
  }
  for (const file of MANIFEST) {
    const target = join(world, file)
    if (!existsSync(target)) continue
    if (classify(readFileSync(target, 'utf8')).kind !== 'neither') continue
    writeFileSync(target, readFileSync(target, 'utf8') + NL + SYNTHETIC_CONTROL + NL, 'utf8')
  }
  // The exemption branch needs a real exempt file to read, whatever the tree happens to look like, so one
  // probe becomes a stub that never boots and carries an exemption with a real reason. It is deliberately a
  // NON-booter: a booter with no control reading is the shape this gate is here to refuse, so the stub must
  // not be the one file the roster reading would have to fail on.
  const exemptFile = join(world, 'scripts', 'probe-proxy.mjs')
  if (existsSync(exemptFile)) {
    writeFileSync(exemptFile, [
      '// a stub that exists only so the exemption branch has something real to read',
      'export const run = () => ({ ready: true })',
      '// alive-control-exempt: ' + GREEN_REASON,
    ].join(NL) + NL, 'utf8')
  }
  return world
}
const WORLD_MUTANTS = [
  { name: 'control-reads-our-own-service', declared: ['R2', 'R3', 'R10', 'R11'], apply: (world) => {
      const file = join(world, 'scripts', 'probe-kernel-live.mjs')
      writeFileSync(file, readFileSync(file, 'utf8').split('dshHomePath').join('linkCollab'), 'utf8')
    } },
  // The launcher's witness is a recorded verdict, not a service read: remove the record and the file stops
  // being classified at all, which is exactly what R10 and R11 must say.
  { name: 'launcher-witness-removed', declared: ['R10', 'R11'], apply: (world) => {
      const file = join(world, 'scripts', 'debug.mjs')
      if (!existsSync(file)) return
      writeFileSync(file, readFileSync(file, 'utf8').replace('const recordAlive = (event, fields) => {', 'const noteSomething = (event, fields) => {'), 'utf8')
    } },
  { name: 'exemption-reason-emptied', declared: ['R4', 'R10'], apply: (world) => {
      const file = join(world, 'scripts', 'probe-proxy.mjs')
      writeFileSync(file, readFileSync(file, 'utf8').replace('alive-control-exempt: ' + GREEN_REASON, 'alive-control-exempt:'), 'utf8')
    } },
  { name: 'a-booter-with-neither-form', declared: ['R1', 'R2', 'R10'], apply: (world) => {
      mkdirSync(join(world, 'scripts'), { recursive: true })
      const text = ['const ready = true', 'const result = await ' + 'boot(' + "'r73-fake', 'C:/r73/cordis.yml', [], undefined" + ')', 'export const run = () => ({ ready, result })'].join(NL) + NL
      writeFileSync(join(world, 'scripts', 'probe-fake-boot.mjs'), text, 'utf8')
    } },
  { name: 'wired-read-dropped', declared: ['R2', 'R3', 'R10', 'R11'], apply: (world) => {
      const file = join(world, 'scripts', 'probe-row-lifecycle.mjs')
      writeFileSync(file, readFileSync(file, 'utf8').split('dshHomePath').join('r73ServiceNameOfOurOwn'), 'utf8')
    } },
  { name: 'world-emptied', declared: ['R12', 'R1', 'R2', 'R5', 'R6', 'R7', 'R10'], apply: (world) => {
      rmSync(join(world, 'scripts'), { recursive: true, force: true })
      rmSync(join(world, 'tools'), { recursive: true, force: true })
    } },
  { name: 'non-booter-claims-present', declared: ['R10', 'R11'], apply: (world) => {
      // A probe that never boots claiming the control form, with nothing behind the claim: the roster
      // reading and the claim reading are two different questions and this shape answers neither.
      const file = join(world, 'scripts', 'probe-refraction.mjs')
      if (!existsSync(file)) return
      writeFileSync(file, readFileSync(file, 'utf8').split('R73 alive-control: EXEMPT').join('R73 alive-control: present - it says so'), 'utf8')
    } },
  { name: 'exemption-marker-dropped', declared: ['R10'], apply: (world) => {
      const file = join(world, 'scripts', 'probe-refraction.mjs')
      if (!existsSync(file)) return
      writeFileSync(file, readFileSync(file, 'utf8').split('R73 alive-control: EXEMPT').join('R73 says nothing'), 'utf8')
    } },
]
const selfAttack = () => {
  const rows = []
  const root = join(PROJECT, '.tmp', 'r73-attack')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  const green = buildWorld(root, 'green')
  const baseline = runGate(HERE, green, 'baseline')
  const baseOk = baseline.parsed !== null && baseline.parsed.readings.every((row) => row.ok)
  rows.push({ id: 'SA1', name: 'the synthetic green world passes the baseline the mutants are measured against', ok: baseOk, detail: baseline.parsed === null ? 'no JSON from the baseline run (exit ' + String(baseline.status) + ')' : 'readings=' + String(baseline.parsed.readings.length) + ' failed=' + JSON.stringify(baseline.parsed.readings.filter((row) => !row.ok).map((row) => row.id)) })
  if (!baseOk) {
    rows.push({ id: 'SA2', name: 'every mutant is measured (refused: the baseline is not green)', ok: false, detail: 'no mutant can be trusted while the baseline fails' })
    return rows
  }
  const mutants = []
  for (const mutant of WORLD_MUTANTS) {
    const world = buildWorld(root, mutant.name)
    mutant.apply(world)
    mutants.push({ name: mutant.name, run: runGate(HERE, world, 'world:' + mutant.name), declared: mutant.declared })
  }
  const dir = join(root, 'gates')
  mkdirSync(dir, { recursive: true })
  const source = readFileSync(HERE, 'utf8')
  for (const anchor of ANCHORS) {
    if (!source.includes(anchor.from)) { rows.push({ id: 'SA-ANCHOR', name: 'anchor ' + anchor.name + ' exists in this gate source', ok: false, detail: 'missing anchor' }); continue }
    const file = join(dir, anchor.name + '.mjs')
    writeFileSync(file, source.replace(anchor.from, anchor.to), 'utf8')
    mutants.push({ name: anchor.name, run: runGate(file, green, 'gate:' + anchor.name), declared: anchor.declared })
  }
  const measured = new Map()
  const mismatches = []
  for (const mutant of mutants) {
    const moved = movedIds(baseline, mutant.run)
    measured.set(mutant.name, moved)
    if (moved === null) mismatches.push(mutant.name + ':no-json')
    else if (JSON.stringify([...moved].sort()) !== JSON.stringify([...mutant.declared].sort())) mismatches.push(mutant.name + ':declared=' + JSON.stringify(mutant.declared) + ' measured=' + JSON.stringify(moved))
  }
  rows.push({ id: 'SA2', name: 'every mutant moves exactly the readings it declares', ok: mismatches.length === 0, detail: 'mutants=' + String(mutants.length) + ' mismatches=' + JSON.stringify(mismatches) })
  const moduleIds = baseline.parsed.readings.map((row) => row.id).filter((id) => id !== 'RD')
  const covered = new Set()
  for (const moved of measured.values()) if (moved !== null) for (const id of moved) covered.add(id)
  const uncovered = moduleIds.filter((id) => !covered.has(id))
  rows.push({ id: 'SA3', name: 'every reading is moved by at least one mutant', ok: uncovered.length === 0, detail: 'readings=' + String(moduleIds.length) + ' moved=' + String(covered.size) + ' uncovered=' + JSON.stringify(uncovered) })
  rows.push({ id: 'SA4', name: 'no mutant silently does nothing', ok: [...measured.values()].every((moved) => moved !== null && moved.length > 0), detail: JSON.stringify([...measured.entries()].map(([name, moved]) => name + ':' + String(moved === null ? 'no-json' : moved.length))) })
  return rows
}

const produced = main()
const attackRows = SELF_ATTACK ? selfAttack() : []
const all = [...produced, ...attackRows]
if (has('--write-manifest')) {
  const { booters, launchers } = detect(scan())
  console.log('const MANIFEST = [' + NL + booters.map((file) => "  '" + file + "',").join(NL) + NL + ']')
  // The launcher list is rebuilt the same way as the booter manifest: this round's whole point was that a
  // launch shape nobody detected was a launch nobody classified, so the helper prints both lists.
  console.log('const LAUNCHERS = [' + NL + launchers.map((file) => "  '" + file + "',").join(NL) + NL + ']')
  process.exitCode = 0
} else if (JSON_OUT) {
  console.log(JSON.stringify({ declared: DECLARED, readings: all }))
} else {
  for (const row of all) console.log((row.ok ? '  ok    ' : '  FAIL  ') + String(row.id).padEnd(5) + row.name + '  |  ' + row.detail)
  const failed = all.filter((row) => !row.ok).length
  console.log(String(all.length - failed) + ' of ' + String(all.length) + ' readings held')
  process.exitCode = failed === 0 ? 0 : 1
}
