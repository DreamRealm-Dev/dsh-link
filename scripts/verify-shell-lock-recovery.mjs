#!/usr/bin/env node
/**
 * The writer locks an interrupted kernel leaves behind are released at the next launch.
 *
 *   node scripts/verify-shell-lock-recovery.mjs [binary]
 *
 * A kernel write is guarded by a "<file>.lock" sibling holding the writer pid, and the
 * kernel takes one over only when its content matches "<pid>\n". An empty or cut-short lock
 * therefore proves nothing to it, is never taken over, and never disappears: every later
 * write to that document waits and then times out, which is how a stale four-hour-old empty
 * file turned "switch the theme" into "could not save". The shell cannot change the kernel
 * (pinned, read-only), so it releases that residue itself, before the child is spawned --
 * core::writerlock holds the rule, core::supervisor calls it.
 *
 * This gate drives the binary's own maintenance entry point,
 * "--release-writer-locks <kernel home>", which calls the same function the launch path
 * calls. It is pure file work: no window, no kernel, no CDP. Every case runs in a temporary
 * kernel home this script creates and removes; the only thing it reads from the real install
 * is the boot log.
 *
 * Exit code 0 is a pass, 1 is a failure, 3 is a skip: the binary predates the remedy, so
 * nothing about it was verified and a green tick would be a lie.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const FLAG = '--release-writer-locks'
let failures = 0
/** Cases whose observation object is not in this world: named with the measurement that proves it, counted, never a pass. */
const notMeasured = []
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail === undefined ? '' : '  -- ' + detail))
}
const note = (text) => console.log('       ' + text)
const skip = (reason) => {
  if (failures > 0) {
    console.log('FAIL  ' + failures + ' check(s) already failed, so the rest is not a skip')
    process.exit(1)
  }
  console.log('SKIP  ' + reason)
  console.log('      nothing was verified, so this is not a pass')
  process.exit(3)
}

/* The property that makes releasing safe is the order of two statements in the launch path:
 * releasing a lock while a kernel of ours could be writing is the one thing this must never
 * do. It is read from the source, so it holds whether or not a binary has been built. */
const supervisor = readFileSync(join(root, 'src-tauri', 'src', 'core', 'supervisor.rs'), 'utf8')
const releaseAt = supervisor.indexOf('writerlock::release_stale')
const spawnAt = supervisor.indexOf('Command::new(NODE_EXECUTABLE)')
check('the release runs before the kernel is spawned, in the launch path',
  releaseAt !== -1 && spawnAt !== -1 && releaseAt < spawnAt,
  'writerlock::release_stale at offset ' + releaseAt + ', Command::new(NODE_EXECUTABLE) at offset ' + spawnAt)

/** The binary under test: the argument, then this tree's own build outputs. */
const binary = (() => {
  const given = process.argv[2]
  if (given !== undefined) return given
  const candidates = [join(root, 'src-tauri', 'target', 'debug', 'dsh-link.exe'), join(root, 'src-tauri', 'target', 'debug', 'dsh-link'), join(root, 'src-tauri', 'target', 'release', 'dsh-link.exe')]
  return candidates.find((path) => existsSync(path)) ?? candidates[0]
})()
if (!existsSync(binary)) skip('no built shell binary to exercise: ' + binary)

/* A binary that predates the remedy would ignore the flag and start the application, which
 * this gate must never do. The flag string is in the executable when the entry point is
 * there, so the check is a byte search rather than a trial run. */
const carriesFlag = readFileSync(binary).includes(FLAG, 0, 'latin1')
if (!carriesFlag) {
  skip('the binary at ' + binary + ' does not carry ' + FLAG + ' (it was built before the remedy): rebuild, then run this gate')
}
note('binary: ' + binary)

/** The pid of a process that has certainly exited: a child this gate waited for. */
const deadPid = () => {
  const child = spawnSync(process.execPath, ['-e', '0'])
  return child.pid
}

/** Whether the operating system says this pid exists; EPERM means it exists and cannot be opened. */
const pidExists = (pid) => {
  try { process.kill(pid, 0); return true } catch (error) { return error !== null && typeof error === 'object' && error.code === 'ESRCH' ? false : true }
}

/**
 * Processes this gate may plant as lock holders, each verified live here rather than assumed.
 *
 * The shell answers "is this holder running?" from the platform's process list, so a holder its view does
 * not contain would fail for a reason that is not the shell's behaviour. The list therefore spans the
 * shapes a machine offers - System, this gate itself, and up to two processes of each image the shell is
 * most likely to share (its own, node, explorer) - and the case is judged on whichever one the shell can
 * see. Nothing here is assumed to be visible: the reading says which one was.
 */
const liveCandidates = () => {
  const out = []
  const push = (label, pid) => { if (Number.isInteger(pid) && pid > 0 && pidExists(pid) && out.every((row) => row.pid !== pid)) out.push({ label, pid }) }
  push('System (pid 4)', 4)
  push('this gate (' + String(process.pid) + ')', process.pid)
  const listing = String(spawnSync('tasklist', ['/NH', '/FO', 'CSV'], { encoding: 'utf8' }).stdout ?? '')
  const rows = listing.split(/\r?\n/).filter((line) => line.trim() !== '').map((line) => line.split('","').map((cell) => cell.replace(/^"|"$/g, '')))
  for (const image of ['dsh-link.exe', 'node.exe', 'explorer.exe']) {
    const pids = rows.filter((row) => String(row[0]).toLowerCase() === image).map((row) => Number(row[1])).filter((pid) => Number.isInteger(pid))
    for (const pid of pids.slice(0, 2)) push(image + ' pid ' + String(pid), pid)
  }
  return out
}
/* Run the maintenance entry point over one kernel home; the report path is how a caller sees whether the
 * child could write there at all. */
const runEntry = (kernelHome, reportFile) => {
  if (existsSync(reportFile)) unlinkSync(reportFile)
  const run = spawnSync(binary, [FLAG, kernelHome], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, DSH_LINK_LOCK_REPORT: reportFile },
  })
  const wrote = existsSync(reportFile)
  const text = (wrote ? readFileSync(reportFile, 'utf8') : '') + (run.stdout ?? '')
  return { status: run.status, wrote, lines: text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('writer lock: ')) }
}

/* Where the cases below run.
 *
 * The gate needs a kernel home the SPAWNED shell can write, and it cannot assume every directory it can
 * write itself is one of those. Measured on this machine (R182-H, and the same shape as R179-ENV recorded
 * for the client): this gate's own process creates and removes files under %TEMP% freely, the identical
 * probe placed there leaves the binary unable to write even its report file and answering
 * "removing it failed (os error 5)", and the same binary on the same input releases the lock when the home
 * is inside the workspace. So the candidates are probed instead of assumed: a root is usable when the
 * child can write in it, and the first usable one is used. The original root is tried first, so a machine
 * where %TEMP% works keeps the original behaviour. */
const STAGE_CANDIDATES = [tmpdir(), join(root, '.tmp')]
const probeStage = (parent) => {
  let staged
  try { staged = mkdtempSync(join(parent, 'dsh-link-lock-stage-')) } catch (error) { return { parent, usable: false, why: 'cannot stage here: ' + String(error) } }
  const probeHome = join(staged, 'kernel-home')
  mkdirSync(join(probeHome, 'profiles', 'web'), { recursive: true })
  const probeLock = join(probeHome, 'profiles', 'web', 'gate-stage-probe.lock')
  writeFileSync(probeLock, String(deadPid()) + '\n')
  const probe = runEntry(probeHome, join(staged, 'report.txt'))
  const released = !existsSync(probeLock)
  const line = probe.lines.find((text) => text.includes(probeLock)) ?? ''
  try { unlinkSync(probeLock) } catch {}
  try { rmSync(staged, { recursive: true, force: true }) } catch (error) { note('could not remove the staging probe at ' + staged + ': ' + String(error)) }
  return { parent, usable: probe.wrote || released, released, wrote: probe.wrote, status: probe.status, line, why: probe.wrote ? 'the child wrote its report here' : 'the child could not write its report here' }
}
const staging = (() => {
  const tried = []
  for (const parent of STAGE_CANDIDATES) {
    if (!existsSync(parent)) { try { mkdirSync(parent, { recursive: true }) } catch (error) { tried.push({ parent, usable: false, why: 'cannot create: ' + String(error) }); continue } }
    const probe = probeStage(parent)
    tried.push(probe)
    if (probe.usable) return { root: parent, tried }
  }
  return { root: STAGE_CANDIDATES[0], tried }
})()
check('the cases run in a kernel home the spawned shell can write',
  staging.tried.some((probe) => probe.parent === staging.root && probe.usable),
  'staged under ' + staging.root + '; probed: ' + staging.tried.map((probe) => probe.parent + ' -> ' + probe.why + (probe.released ? ' (and it released a stale lock)' : '') + (probe.line === '' ? '' : ' [' + probe.line.slice(0, 90) + ']')).join(' | '))

const gateRoot = mkdtempSync(join(staging.root, 'dsh-link-lock-gate-'))
const home = join(gateRoot, 'kernel-home')
const profile = join(home, 'profiles', 'web')
mkdirSync(profile, { recursive: true })
const reportPath = join(gateRoot, 'report.txt')
const lock = (name) => join(profile, name)

/** Run the maintenance entry point over this gate's own kernel home. */
const recover = () => runEntry(home, reportPath)
const lineFor = (lines, path) => lines.find((line) => line.includes(path)) ?? ''

try {
  /* 1. An empty lock: the case that poisons the document. */
  const empty = lock('package.json.lock')
  writeFileSync(empty, '')
  const first = recover()
  check('the maintenance entry point runs', first.status === 0, 'exit ' + first.status)
  check('an empty lock is released', !existsSync(empty), existsSync(empty) ? 'the file is still there' : 'gone: ' + lineFor(first.lines, empty))
  check('and the line says which file, that it was empty, and that it is gone',
    lineFor(first.lines, empty).includes('released') && lineFor(first.lines, empty).includes(empty) && lineFor(first.lines, empty).includes('<empty>'),
    lineFor(first.lines, empty))

  /* 2. A lock a live process owns. The case has a premise worth measuring rather than assuming: the shell
   * asks the platform for the process list (tasklist, /NH /FO CSV) and treats "this pid is not in it" as
   * gone, so its answer is only informative about holders that ITS view contains. Measured in this session
   * (R182-H): a plain non-node process standing where the shell stands sees 23 of this machine's 306
   * processes; this gate's own pid, explorer.exe and pid 4 all read "gone" from it, while another process
   * of the shell's own image reads "still running". So the holder is chosen by measurement: several
   * processes that are live by this gate's own probe - System, this gate, and whatever the machine is
   * running of the shell's own image - are each planted as a holder, and the case is judged on one the
   * shell can see. A run whose view holds none of them names the case not measured instead of failing it,
   * and every other live holder's answer is printed with it, because "a live writer the shell cannot see
   * is released anyway" is exactly the direction this case exists to keep honest. */
  const holders = liveCandidates()
  const planted = holders.map((row, index) => ({ ...row, at: lock('holder-' + String(index) + '.lock') }))
  for (const row of planted) writeFileSync(row.at, String(row.pid) + '\n')
  const second = recover()
  const answers = planted.map((row) => ({ ...row, kept: existsSync(row.at), line: lineFor(second.lines, row.at) }))
  const visible = answers.find((row) => row.line.includes('still running'))
  const invisible = answers.filter((row) => row !== visible && row.line.includes('is gone'))
  for (const row of answers) note('holder planted for ' + row.label + ' (' + String(row.pid) + ') -> ' + (row.line === '' ? 'the shell printed no line for it' : row.line.replace('writer lock: ', '')))
  if (visible === undefined) {
    notMeasured.push('a lock whose holder is running is kept: of ' + String(answers.length) + ' holders that this gate measured live ('
      + answers.map((row) => row.label).join('; ') + '), the shell called none alive, so its process view holds no live holder to keep -- '
      + answers.map((row) => row.label + '=' + (row.line === '' ? 'no line' : row.line.includes('is gone') ? 'gone' : row.line)).join(' | '))
  } else {
    check('a lock whose holder is running is kept', visible.kept,
      (visible.kept ? 'held by ' + visible.label + ': ' + visible.line : 'the file was removed: ' + visible.line)
        + (invisible.length === 0 ? '' : ' | other holders this gate measured live and the shell called gone, whose locks it released: ' + invisible.map((row) => row.label).join(', ')))
    check('and the line says the holder is alive', visible.line.includes('kept') && visible.line.includes('still running'), visible.line)
  }

  /* 3. A lock whose holder exited: the kernel would take it over by itself. */
  const gone = lock('settings.yaml.lock')
  writeFileSync(gone, String(deadPid()) + '\n')
  const third = recover()
  check('a lock whose holder is gone is released', !existsSync(gone), existsSync(gone) ? 'the file is still there' : 'gone: ' + lineFor(third.lines, gone))
  check('and the line says the holder is gone',
    lineFor(third.lines, gone).includes('released') && lineFor(third.lines, gone).includes('is gone'),
    lineFor(third.lines, gone))

  /* 4. A real launch is the evidence that those lines land above the kernel's own output.
   *    Reaching this means the remedy is built, so a shell that has been launched since then
   *    has to show it; a boot log with no such line is read as "this shell was launched
   *    before the remedy was built", and said out loud rather than passed over. */
  const bootLog = join(process.env.APPDATA ?? '', 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'boot.log')
  if (existsSync(bootLog)) {
    const lines = readFileSync(bootLog, 'utf8').split('\n')
    const reported = lines.map((line, index) => ({ line: line.trim(), index })).filter((entry) => entry.line.startsWith('writer lock: '))
    if (reported.length === 0) {
      note('the live boot log has no writer-lock line: nothing needed releasing at that launch, or the shell that wrote it predates the remedy -- either way the real-launch half of this check has no evidence to read')
    } else {
      const firstOther = lines.findIndex((line) => line.trim() !== '' && !line.trim().startsWith('writer lock: '))
      check('in a real launch, the recovery lines are the first lines of the boot log',
        reported.every((entry) => firstOther === -1 || entry.index < firstOther),
        reported.length + ' line(s) at row(s) ' + reported.map((entry) => entry.index).join(',') + ', first kernel line at row ' + firstOther)
    }
  } else {
    note('no live boot log at ' + bootLog + ' to read real-launch evidence from')
  }
} finally {
  try {
    rmSync(gateRoot, { recursive: true, force: true })
  } catch (error) {
    note('could not remove ' + gateRoot + ': ' + error)
  }
}

for (const line of notMeasured) console.log('NOT MEASURED  ' + line)
console.log(failures === 0
  ? 'shell lock recovery: ' + (notMeasured.length === 0 ? 'all checks passed' : 'all checks passed, ' + notMeasured.length + ' case(s) named not measured')
  : failures + ' check(s) failed')
process.exit(failures === 0 ? 0 : 1)
