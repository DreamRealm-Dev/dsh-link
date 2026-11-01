#!/usr/bin/env node
/**
 * Every gate this project has, in one command.
 *
 * A gate is a check that can fail a release on its own evidence. They live in three
 * kinds, and the difference matters when one goes red:
 *
 *   offline   needs nothing running — versions, builds, tables
 *   live      needs the shell up with CDP on 9222 — everything that reads the page
 *   kernel    boots a throwaway kernel instance — the surface probe and its consumers
 *
 * Usage:
 *   node scripts/verify-all.mjs                        run every gate that can run now
 *   node scripts/verify-all.mjs --live                 require the live gates (fail if 9222 is absent)
 *   node scripts/verify-all.mjs --allow-skipped-live   accept a run whose live gates were skipped
 *   node scripts/verify-all.mjs --only theme,compat
 *   node scripts/verify-all.mjs --json
 *
 * Exit code 0 only when every gate it ran passed AND no live gate was skipped. A gate that
 * could not run is reported as SKIP with its reason, never as a pass — a skipped gate is the
 * shape of failure this project has already been bitten by.
 *
 * R196-P1, and the defect this comment replaces: until this round `exit 0` was reachable with
 * EVERY live gate skipped for want of CDP, because only `--live` made a skip red. "All the
 * live gates passed" and "no live gate ran" therefore printed the same exit code, and that is
 * what let the rest of the R196 gauntlet's findings go unnoticed. Now:
 *   - the summary counts live gates apart from the rest (ran / skipped / selected) and NAMES
 *     every skipped live gate, on its own line and in the count line;
 *   - a skipped live gate is FATAL unless the caller passes --allow-skipped-live on purpose,
 *     and the report prints a `policy:` line naming which of the two flags was in force;
 *   - a live gate that really FAILS is still named and still exits non-zero: that path is the
 *     `failed` filter below, untouched.
 * A skip from an OFFLINE/KERNEL gate (a gate's own exit 3) keeps its old, non-fatal weight on
 * purpose, so the offline-only segmented runs and recorded commands keep the exit code they had.
 */

import { spawn, spawnSync } from 'node:child_process'
// R326: the live lane puts the panel world back between gates. Measured: three panel gates that pass alone declined
// inside one full run because the gate before them had left a panel mounted, and the suite then reported them as
// "declined to measure" - a skip that says nothing about the product.
import { clearStaleLease, closeMountedPanel } from './panel-lease.mjs'
import { ensureBrowserPane, openBrowserPane, parkAwayFromBrowserPane, parkRailAway, railGuideOnly, setBridgeDiscovery } from './panel-world.mjs'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CDP_PORT = process.env.DSH_LINK_CDP_PORT ?? '9222'
/** The shell port the world settle talks to (the panel lease lives there). */
const PROXY_PORT_FOR_SETTLE = process.env.DSH_LINK_PROXY_PORT ?? 31761

const argv = process.argv.slice(2)
const jsonOut = argv.includes('--json')
const requireLive = argv.includes('--live')
// R196-P1: the one way a run whose live gates were skipped may still exit 0 - said out loud.
const allowSkippedLive = argv.includes('--allow-skipped-live')
const onlyAt = argv.indexOf('--only')
const only = onlyAt === -1 ? null : new Set(argv[onlyAt + 1].split(',').map((name) => name.trim()))

/**
 * One gate.
 * @property name - stable id, used by --only.
 * @property kind - offline | live | kernel.
 * @property cmd - argv to run.
 * @property needs - human-readable prerequisite, checked before running.
 * @property mutates - "tree" when running the gate WRITES tracked files (a derived artifact it regenerates).
 *   Such a gate is pinned to the serial lane: two writers of one derived artifact in parallel is a race, not a
 *   speed-up (R312).
 * @property budgetMs - how long THIS gate may take, when the default is the wrong shape for it (R311).
 *   A gate that spends a model round and drives another application is not hung, it is busy; the default
 *   budget exists to end hangs, and applying it to a slow gate just kills a measurement. Declaring it here
 *   keeps the anti-hang property for every gate that does not declare one.
 */
const GATES = [
  { name: 'baseline', kind: 'offline', cmd: ['node', 'scripts/verify-baseline.mjs'],
    what: 'the kernel is unedited at its locked commit, and archived evidence still hashes to the lock' },
  { name: 'core-version', kind: 'offline', cmd: ['node', 'scripts/core-version.mjs'],
    what: 'the vendored kernel checkout names one version, and its tag agrees' },
  { name: 'upgrade-resume-cli', kind: 'offline', cmd: ['node', 'scripts/verify-upgrade-resume-cli.mjs'],
    what: 'the lock queue has a user: the CLI exits 75 only for a real lock (induced the way Windows behaves), 1 for a failure retrying will not fix, 2 for a wrong command line and 0 when the work is done, and the next lock-free window finishes exactly that work' },
  { name: 'user-input-reclaim', kind: 'live', cmd: ['node', 'scripts/verify-user-input-reclaim.mjs'],
    what: 'R178-T (adopted from Codex Browser Use): while the AI drives the sidebar panel, ONE real user input event on the panel page takes it back BY NAME - the very same op=cdp call that succeeded before the input must come back 400 with user-input named (paired control, so a panel that is merely broken cannot pass), op=set-bounds must be refused on the same rule (two independent channels, one reading each), and a fresh lease claim restores the AI call. Six mutants keep it falsifiable: unconditional refusal reddens the baseline and the control, refusing only cdp reddens the set-bounds reading, and a refusal that does not name the cause reddens both refusal readings' },

  { name: 'sidebar-viewport', kind: 'live', cmd: ['node', 'scripts/verify-sidebar-viewport.mjs'],
    what: 'R179: the sidebar browser is a little screen, not a stretched page - op=viewport takes a named preset or a WxH and the PAGE itself reports 1920x1080 while op=state keeps scale, bayPane and screenPane consistent with each other (scale ~= screenPane.w/1920); the virtual screen (screenPane) sits inside and centred in the bay (bayPane) at the viewport aspect ratio with a real letterbox, and what the shell page PAINTS agrees with the shell own geometry; an unusable resolution (zero, negative, not-a-number, neither) is refused BY NAME with viewport and modeApplied untouched; the choice is written to the file op=state names, so a restart would restore it, and it survives unmount->mount where the fresh page reports it again - the restart ITSELF is not measured, because the client lifecycle belongs to the shell producer; a REAL click on the shell page resolution control is USER INPUT: the lease the gate holds comes back revoked by name and the resolution the control names takes effect, while the same op=cdp WITHOUT a holder is refused (paired control); and the tab cap is a named boundary with the shell page disabling its own + at the cap. 22 mutants keep it falsifiable, one of them the PRE-R179 world itself (no op=viewport, no bayPane/screenPane, no control), which reddens exactly readings 1-5 and leaves the tab boundary green' },

  { name: 'markdown-edit-live', kind: 'live', cmd: ['node', 'scripts/verify-markdown-live.mjs'],
    what: 'R377: the Markdown tab type driven the way a PERSON reaches it, because until then it had three green offline gates and had never drawn a pixel - the served client half registered, the shipped controls (right rail, page-type menu or guide, workspace file tree) reach a file row, pressing it opens a markdown tab at that file own dsh-resource:// address, the body READS the file through the kernel (a bare line number where the wire declares a range object made every read fail), the pane offers 编辑, a typed draft is marked unsaved with 保存 enabled, 保存 is accepted (the version compared is the fs service own opaque token, not a locally recomputed mtime-size, which never matched) and the file ON DISK carries the typed line, 预览 re-reads it, and the run puts its scratch file and its tabs back. States its own precondition by name: a Session workspace the shell kernel cannot create entries in (a shell launched from inside a confined parent inherits that parent writable roots; measured as EPERM mkdir-ing the atomic write staging directory with mode danger-full-access, i.e. below DSH) is reported as the named third state instead of reddening the product' },

  // R377: this gate measures the surface of an OPEN browser pane, so its world is "browser pane open". Declaring it as
  // a prep (instead of hoping an earlier gate left the pane open) is what makes its verdict something the runner owns;
  // the helper walks the shipped doors when the pane is not there.
  { name: 'panel-surface', kind: 'live', prep: 'browser-pane', cmd: ['node', 'scripts/verify-panel-surface.mjs'],
    what: 'R178: the browser belongs in the rail BROWSER PANE, not over the rail - the native panel rectangle must equal the plugin-declared anchor [data-dsh-link-surface] (<=3px), the rail tab strip must be covered by 0 AREA while a real mouse click still switches the pane, an inactive pane must not leave the panel open, and the pre-R178 shape (the panel filling the whole rail) is asserted RED by the same judge - measured before the fix: the panel sat at 1128,36 300x852, exactly the rail box that contains the tab strip' },

  { name: 'sidebar-focus', kind: 'live', cmd: ['node', 'scripts/verify-sidebar-focus.mjs'],
    what: '点哪打哪: a click driven into the panel through its own protocol gives the panel document focus, a click on the main page takes that focus back (paired: the main page gains it and the panel gives it up), and a second click returns it - the round trip that makes the panel a browser rather than a picture' },

  { name: 'teams-panel', kind: 'live', cmd: ['node', 'scripts/verify-teams-panel.mjs'],
    what: 'R179: the right rail really shows the collaboration bus (dsh-link-teams) - the ONE read-only route is counted against control.jsonl by the gate itself (ledger.records == rows the gate read, and the stream is the file tail: min(40, records) rows, no invented seq, file rows outside the stream == records - stream.length), POST/PUT/DELETE there are 405 with the named METHOD_NOT_ALLOWED while GET on the same path answers 200 in the same run, the capability-absent branch the LIVE client cannot reach is measured on the shipped artifact in-process (no linkCollab -> 503 NO_CAPABILITY, a linkCollab with no state() reader -> 503 NO_STATE_READER, and the same harness with a stand-in -> 200, so the 503s are a branch and not the gate own world), and through CDP the rail is opened / + clicked / the guide entry picked until a tab titled 智能体团队 has a non-0x0 body carrying 任务板/成员/交流 AND the live ledger directory path. Two more readings keep the surface honest and world-sensitive: reading 5 COUNTS THE LEDGER first and then names the world it found - no declaration row in the file and none served by the route => the pane must SAY 未声明能力 / 树还建不起来 and paint no empty tree; the route serving declarations => the pane must DRAW them (every served capability of a member the ledger names appears in the pane text, and a served team brings 团队树（分形） and its first-8-character id), compared against the ROUTE and never against a fixture; declaration rows in the file that the route serves NONE of => FAILURE with the mechanism named, because that is the two halves of the chain disagreeing. Reading 6 then requires its 记录/成员/任务 chips to equal the ledger read around the pane. Reading 8 asks the surface the same question about the HANDSHAKE: the route serves peer/state pairs and the pane must draw the card Lead 之间的握手 with, for every pair the route serves, the arrow row built from that pair own ids (first eight characters, the way the pane shortens an id) and that pair state read inside the card - the slice ends where 交流（ begins, because the 交流 list prints the same state for the same record and a chip found anywhere in the pane would not be the chip. A world whose ledger holds no handshake row is NOT MEASURED by name, never green: before this reading existed the same gate passed 7 readings on a world carrying a granted pair while never looking at the card. Then a self-attack over the MEASURED world: ten base mutants + one control + the one to five mutants of whichever branch reading 5 landed in (the route losing what the file holds walks the judge into the third branch, and emptying both halves walks it into the first, so all three branches are exercised), each reddening exactly its declared reading (声明集 == 观测集)' },
  // R377: this gate refuses (exit 3) when the world declares no [data-dsh-link-surface] anchor - it samples frames across
  // a panel open and close, so the panel and its anchor are its premise. Declaring the world is what turns its named
  // third state into a measurement where the doors work.
  { name: 'window-transition', kind: 'live', prep: 'browser-pane', cmd: ['node', 'scripts/probe-window-transition.mjs'],
    what: 'contract criterion 1, measured: opening and closing the panel must not leave the main window black - frames are sampled across both transitions with the page-side control overlay injected, and every frame must still show the main page (green above a floor, near-black below a limit). It states its own limit: a single-frame tear between two samples cannot be seen, a black window lasting longer than the sample interval can' },
  { name: 'window-pixels', kind: 'live', cmd: ['node', 'scripts/probe-window-pixels.mjs'],
    what: 'the panel is really drawn on screen: the window is captured with PrintWindow (the R158 screen read was declared dead on a control that could never be visible - a body background behind the shell own opaque layout), a fixed top-z overlay is injected as a control that MUST appear, and then the panel rectangle must show NONE of it while the pixels beside it must show all of it - which is also what makes this reading impossible to satisfy with a stale picture' },
  { name: 'panel-frame', kind: 'live', cmd: ['node', 'scripts/probe-panel-frame.mjs'],
    what: 'the panel rectangle, described three ways at once and agreeing: the webview\'s own child window read natively in true physical pixels (the reader forces per-monitor DPI awareness), the shell\'s own report, and the panel document\'s innerWidth x devicePixelRatio - plus the logical rect the page asked for, so a scale error or a unit error has somewhere to show up' },
  { name: 'sidebar-native-focus', kind: 'live', cmd: ['node', 'scripts/verify-sidebar-native-focus.mjs'],
    what: 'the OS-level keyboard focus is read from the native child window trees, not from the page: op=focus moves it into the panel tree, a CDP click inside the panel leaves it alone because it drives the renderer rather than the OS, closing the panel hands it back to the main tree, and the win32 reading is void unless the window was foregrounded first - the page-side instrument cannot tell the two webviews apart because both report hasFocus()' },
  { name: 'sidebar-inproc-cdp', kind: 'live', cmd: ['node', 'scripts/verify-sidebar-inproc-cdp.mjs'],
    what: 'the shell can ASK the panel instead of waiting to be told: Runtime.evaluate returns a value that agrees with the page-side channel, Page.navigate moves the panel to a real site and the shell can read where it landed, Page.captureScreenshot answers with real image data, a call with no panel fails by name rather than succeeding emptily, and a method the browser does not know is an error - all of it in process, with no debugging port' },
  // R377: both gates read a panel that is UP on the browser pane's declared anchor. Their world is now DECLARED rather
  // than hoped for - the door chain opens the browser pane from any rail state, which is what makes these readings
  // reachable instead of a named skip about a missing anchor.
  { name: 'sidebar-content', kind: 'live', prep: 'browser-pane', cmd: ['node', 'scripts/verify-sidebar-content.mjs'],
    what: 'the panel tells the shell what it is showing, and only while it is showing it: a closed panel reports no content and no reports, an open one reports its own href/readyState/title/text length/errors, the reported content belongs to the page the webview is really on (never a page the user has left), and a panel closed from outside is brought back by the page host' },
  { name: 'sidebar-follow', kind: 'live', prep: 'browser-pane', cmd: ['node', 'scripts/verify-sidebar-follow.mjs'],
    what: 'the native panel follows the REAL right column: a collapsed column holds no panel and no panel process, the official open button brings the column up and the panel lands exactly on it (times the measured display scale), a real divider drag takes the panel with it, the gate restores the column, and the main window\'s own pool never moves' },
  { name: 'sidebar-panel', kind: 'live', cmd: ['node', 'scripts/verify-sidebar-panel.mjs'],
    what: 'the right column has a real native panel behind POST /__shell/panel: it opens asynchronously and reports itself, it runs in its own WebView2 profile rather than the main window\'s EBWebView, the rect the page sends lands at exactly the reported scale, it has its own browser process, and closing it takes that process with it and makes the geometry ops refuse' },
  { name: 'sidebar-persist', kind: 'offline', cmd: ['node', 'scripts/verify-sidebar-persist.mjs'],
    what: 'a sidebar child webview with a fixed data_directory keeps its site data (cookie / localStorage / IndexedDB) across a process restart and a fresh directory starts empty: six readings re-derived from the raw probe logs, plus a four-mutant self-attack' },
  { name: 'upgrade-pending-queue', kind: 'offline', cmd: ['node', 'scripts/verify-upgrade-pending-queue.mjs'],
    what: 'a lock is not retried hard (EAC S2): the queue is idempotent by key, the resume attempts each entry exactly once and keeps what failed, a corrupt queue is loud, and only EPERM/EBUSY/(1175) count as locks' },
  { name: 'kernel-range-wiring', kind: 'offline', cmd: ['node', 'scripts/verify-kernel-range-wiring.mjs'],
    what: 'the shipped dsh-link-upgrade artifact marks every registry entry against the kernel version read from the real closure, idempotently, flagging what it cannot scan instead of dropping it' },
  { name: 'kernel-range', kind: 'offline', cmd: ['node', 'scripts/verify-kernel-range.mjs'],
    what: 'kernel compatibility ranges: versions read from a real install closure, the spec\'s prerelease tolerance, unsupported syntax refused with a position, and an idempotent report' },
  { name: 'build', kind: 'offline', cmd: ['node', 'plugins/build.mjs', '--check'],
    what: 'every plugin lib/ artifact is what a fresh build would write' },
  // R488: strict TypeScript for plugin sources. The DEFAULT gate is strict and stays red while the
  // 489-error legacy baseline remains, by design; this suite runs --allow-baseline, which fails only
  // NEW errors (born-strict plugins never enter the baseline). Flip to default once the baseline is empty.
  { name: 'strict-ts', kind: 'offline', cmd: ['node', 'scripts/typecheck-plugins.mjs', '--allow-baseline'],
    what: 'plugin sources typecheck under the kernel own strict flags (7/7 parity re-verified on every run, drift exits 2); a new error is red, every legacy entry is allowlisted, a stale allowlist entry is reported STALE, and born-strict plugins (dsh-link-compute is the first) may never appear in the baseline' },
  { name: 'plugin-health', kind: 'offline', cmd: ['node', 'scripts/verify-plugin-health.mjs'],
    what: 'the kernel reports a clean activation, and no plugin this repository ships printed a failure line' },
  { name: 'scope-dispatch', kind: 'offline', cmd: ['node', 'scripts/verify-scope-dispatch.mjs'],
    what: 'in a throwaway kernel: the feed is alive, the plugin records from it, its hook is in the registry the host dispatches from, and the ledger folds back into a board' },
  { name: 'capability-live', kind: 'offline', cmd: ['node', 'scripts/verify-capability-live.mjs'],
    what: 'a throwaway kernel exercises the linkCollab capability the way a caller would: open, append, read back, data channel, recorder, close' },
  { name: 'theme', kind: 'live', cmd: ['node', 'scripts/verify-theme-section.mjs', CDP_PORT],
    what: 'the Theme section switches material both ways on the live client' },
  { name: 'accept', kind: 'live', cmd: ['node', 'scripts/verify-accept.mjs', CDP_PORT],
    what: 'the window-corner token, the menu timeline and both probes agree on the live client' },
  { name: 'radius', kind: 'live', cmd: ['node', 'scripts/verify-radius-audit.mjs', CDP_PORT],
    what: 'the window corner and every glass surface carry the material radius, with no leftover inline style' },
  { name: 'corner-shape', kind: 'live', cmd: ['node', 'scripts/verify-corner-shape.mjs', CDP_PORT],
    what: 'the window corner is a continuous curve, and the @supports-not fallback still renders a round one' },
  { name: 'lock-recovery', kind: 'offline', cmd: ['node', 'scripts/verify-shell-lock-recovery.mjs'],
    what: 'the writer locks an interrupted kernel leaves behind are released before the next kernel starts' },
  { name: 'compat-matrix', kind: 'offline', cmd: ['node', 'scripts/verify-compat-matrix.mjs'],
    what: 'the same table and resolver describe a validation set of kernels, and the constructive future-kernel proof holds' },
  { name: 'compat-consumer', kind: 'offline', cmd: ['node', 'scripts/verify-compat-consumer.mjs'],
    what: 'R197: a fixture whose ONLY registration path is the loader registers through capability(\'http\').registerRoute and answers 200; the wrong member word is refused by name with the handle real keys printed; without the row the same call fails naming the capability; and the loader has()/capability() answers still agree with the table' },
  { name: 'compat-mounted-live', kind: 'live', cmd: ['node', 'scripts/verify-compat-mounted-live.mjs'],
    what: 'R197: the loader is really mounted in the live world - the profile declares it as dependency AND bundle, the live composition names the row, and the panel own state route answers compat {present:true, via:link.compat, role:http.registerRoute, refused:null}. The loader own resolved/refused report is a NAMED not-measured: it only reaches ctx.logger, which this composition does not sink to any file' },
  { name: 'compat-table', kind: 'offline', cmd: ['node', 'scripts/verify-compat-table.mjs'],
    what: 'every capability resolves, translates or refuses as its kernel table declares, and the evidence hash matches' },
  { name: 'compat-table-bindings', kind: 'offline', cmd: ['node', 'scripts/verify-compat-table-bindings.mjs'],
    what: 'R216: EVERY table section this build carries is bound to an archived surface whose sha256 and composition counts match it, and every (service, member) binding names a member that surface recorded - the check the alpha.5 rehearsal had to do by hand, because a section could cite a moved surface or bind a renamed member and every other gate stayed green' },
  { name: 'compat-refusal', kind: 'offline', cmd: ['node', 'scripts/verify-compat-refusal.mjs'],
    what: 'the loader refuses what the vocabulary does not contain, and refuses a partially-satisfied capability' },
  { name: 'teams-log', kind: 'offline', cmd: ['node', 'scripts/verify-teams-log.mjs'],
    what: 'the collaboration bus control channel survives restart, keeps the data channel off the disk, and reports a truncated tail' },
  { name: 'collab-declare', kind: 'offline', cmd: ['node', 'scripts/verify-collab-declare.mjs'],
    what: 'R180: the three DECLARING tools write the ledger they claim to. Measured on the SHIPPED artifact with a fresh control log and a ctx that publishes a tools registry the way the kernel composes it: apply() registers exactly team_declare_capability / team_declare_subteam / team_heartbeat and linkCollab.tools reports them available in an empty 0-row ledger; each tool is CALLED and the value it returns must be the row the FILE gained (seq, kind, subject, actor and payload agree, the capability set comes back deduplicated and sorted, and the heartbeat instant is equal in the answer, the record and its payload); 19 malformed calls each raise the code their own rule names, with that code first in the message, while the ledger stays byte-identical around the batch and after every measurement (including the paired control of one member/state row the world seeds itself); the instant is data - the heartbeat tool writes the clock the factory is built with, and liveness is a function of (latest beat, now, timeoutMs): unknown before any beat, healthy one second after it, unhealthy exactly at the timeout, with the same fold minus the heartbeat row answering unknown; subteam declarations made through the tool read back as exactly a root / child / grandchild / orphan / two-team loop (children, pathOf root-first, descendantsOf, the orphan, the cycle and its edge) and dropping the team/state rows takes the tree away; and linkCollab.records({since, limit}) folds exactly its own prefix - the gate folds that prefix itself and compares - clamps the limit, refuses a bad cursor with a TypeError, and answers byte-identically with Date.now replaced by a thrower. 18 mutants + one control keep it falsifiable (声明集 == 观测集)' },
  { name: 'collab-reclaim', kind: 'offline', cmd: ['node', 'scripts/verify-collab-reclaim.mjs'],
    what: 'R181: a member that holds an in_progress task and stopped answering loses it BY NAME. Measured on the SHIPPED artifact, in THREE self-built worlds whose ctx publishes a tools registry the way the kernel composes it: the model-visible surface is pinned from both sides: the DEFAULT composition registers the three declaring tools plus exactly one name announcing reclaiming, the same admission gate 107 makes by name, so a smuggled second name reddens both gates, while {reclaim:{enabled:false}} leaves exactly the three and linkCollab.reclaim stays a function either way, a fresh control log that starts at 0 rows and the gate own seed (four in_progress tasks: three owned with their own heartbeat history, one owned by nobody) landing row for row, and a fillable input schema; the shipped verdict is DISCOVERED by behaviour - the one export that answers differently for a holder that never beat and one that beat a second ago - and then pinned at four instants of one state: never beat => reclaimable, a beat 1 s old => not, a beat EXACTLY timeoutMs old => reclaimable (the equality belongs to out of bounds), a beat a day old => reclaimable, with the two reclaimable causes NAMED APART, the same call twice byte-identical and Date.now a thrower changing nothing; one real call for the never-beat holder must write exactly the rows that carry the release (owner cleared, revision+1, agreeing with what the tool returned) and the isolation fact naming that member, with no row unexplained, while the fold shows both a task-shaped and a member-shaped change; the SAME call for a holder that beat one second ago must be refused with a name leading the message and must leave control.jsonl byte-identical and the fold unmoved (paired control); two counterfactuals over the same records must flip the verdict (drop the holder heartbeat row => reclaimable; keep the row but attribute it to another member => unchanged); a beat a day old must be reclaimed too, in its own rows and its own seq; and the live ledger own case - an in_progress row nobody owns - must be released with one row and add no isolation fact at all. 25 mutants + one control keep it falsifiable (声明集 == 观测集)' },
  { name: 'collab-peer', kind: 'offline', cmd: ['node', 'scripts/verify-collab-peer.mjs'],
    what: 'R182: two leads handshake on the ledger, and NEITHER TOOL NAME is written down in the gate. It calls every tool the registry holds with a bounded set of argument shapes (hand-written, and shapes derived from each tool OWN declared schema) and keeps the ones that append exactly one peer/state row: the tool that writes requested is the asking tool, the one that writes granted and denied answers - so the gate measures whatever the round registered instead of a spelling it guessed, and a face with no peer tool at all reddens BY NAME rather than passing seven readings about nothing. Eight readings: apply() publishes linkCollab over an empty control.jsonl and exactly TWO names in the face append peer/state (a third writer, or a name R181 already shipped, reddens); one asking call adds exactly ONE row whose subject and payload agree with what the shipped builder builds for the same four fields, and the value the tool returns carries that row seq and those four values; a request is not a permission (mayExchange false both ways, pendingRequests naming the asker, one row), a grant takes only for the ORDERED pair it names (forward true, reverse false, pending cleared, still one row per pair); a later denial clears the grant and leaves ONE row carrying the denial own seq; the same rows folded in reverse answer the same table, dropping the denial gives granted, dropping both answers gives requested, and renumbering the three rows so the DENIAL carries the lowest seq makes the fold answer requested - the highest seq decides, not the word - while a ledger the gate wrote ITSELF through the shipped log with no tool involved folds the same way; a batch of malformed calls, built from each tool own declared schema, is refused by name (an UPPER-CASE rule leading the message, the same call twice answering the same name) with control.jsonl byte-identical across the batch; the cross-writer case relays the asking log own page into a second log this gate opened with its own writer and instance, the second log writes the grant, the page is relayed back, and both logs hold both writers rows and fold the SAME table (mayExchange true forward and false in reverse on both sides) - with the concurrent same-pair case measured beside it rather than assumed away: two logs that wrote the same pair without having seen each other fold their own arrival order, and the reading pins what must hold anyway (both hold both rows, neither invents a third answer); and a copy of the file opened as a new log with no tools attached folds the same table and answers mayExchange the same way. 15 mutants + one control keep it falsifiable (声明集 == 观测集)' },
  { name: 'collab-manifest', kind: 'offline', cmd: ['node', 'scripts/verify-collab-manifest.mjs'],
    what: 'R183: an end declares what it can do, and a capability is only usable if every hop on the path declares it. The gate builds its own worlds (a real apply(), a ctx that publishes a tools registry, a real control.jsonl under its own temp directory) and counts the ledger itself: three appendManifest calls each add exactly one row whose six frozen fields equal what the caller gave and whose seq is what came back, while twenty-four calls through the registry write no end/manifest row at all (the writer is the constructor/append pair, not a tool). Folding is order independent three ways on one records array, and a real relayed batch carries the same fact table whichever order it arrives in - the local seq differs, and the evidence line names both numbers, because a relay assigns its own arrival sequence. Twenty-three malformed calls are each refused by name (MANIFEST_INPUT/END/VIA/VERSION/CAPABILITY/PLATFORM/AT, the same name twice per call) with the ledger byte-identical across the batch, paired with the recognised names all landing. Attenuation is the intersection along the path: a missing hop is NO_MANIFEST, a silent end is PEER_SILENT, a silent middle hop is ROUTE_DOWN with the break named, the two are never merged, and the equality boundary counts as stale (a heartbeat exactly at now-timeoutMs is silence, one millisecond earlier is a clear path). A capability name the build cannot read goes to malformed while its declared row stays visible and every recognised name in the same row still produces a key. The key space is exactly what the fold says (remote:<end>:<providerKey>, never the local end), all six verdicts are observed, and service-gone is a PAIRED reading: for one key, present and ok on a clear path, then absent from brokerKeys and answered service-gone after a withdrawn manifest, a silent end, a silent middle hop or a meet that drops the name - never unknown-key and never no-provider, next to the control where an end that never declared anything answers unknown-key. Eleven out-of-domain calls raise TypeError, paired with five that are answered once the arguments are supplied. 25 mutants, 24 of which declare a target, none uncovered. A name made of blanks is refused here too (the declaring family already refused one), because an end called three blanks would key a row no reader could address.' },
  { name: 'collab-merge', kind: 'offline', cmd: ['node', 'scripts/verify-collab-merge.mjs'],
    what: 'R183: two teams recruit each other on the ledger, and NEITHER TOOL NAME is written down in the gate - it calls every tool the registry holds with shapes derived from each tool OWN declared schema and keeps the calls that append exactly one team/merge row, so it recognises the asking tool and the answering tool by BEHAVIOUR. Seven readings on a real apply() world with a real control.jsonl the gate counts itself: a request appends exactly one row in the requested state and the answer it returns equals the row field by field (a model that reads a fact the ledger does not hold is the failure this pins), a denial appends exactly ONE row while a grant in the join direction appends exactly TWO (its own team/state first, then the authorisation) with no third row and none missing, and only the team being folded in may write its parent - an asking team writing someone else is refused MERGE_NOT_AUTHORIZED with the ledger byte-identical, paired with the honest batch of the same data landing. Re-numbering three rows so the denial takes the SMALLEST seq makes the fold follow the sequence rather than the word, both arrival orders of one records array fold byte for byte the same, and a merge without a standing handshake is refused MERGE_PEER_REQUIRED because mayExchange stays the only owner of that question. Bad inputs are refused by name across the whole vocabulary (MERGE_INPUT/SELF/MODE/STATE/GRANT/LOCAL_TEAM/ALREADY_GRANTED/REQUEST_NONE/REQUEST_AMBIGUOUS/FROM_*|TO_*|TEAM_*|BY_*) with the ledger unchanged. A world whose registry holds none of these tools is a NAMED NOT MEASURED and exit 3, never a pass; a half-lived world (only the asker) leaves readings 3/4/5/7 unmeasured by name. 27 mutants, 26 of which declare a target, none uncovered. Two more refusals are pinned the same way: a second request against a standing grant, and an answer from a writer that leads two teams.' },
  // R377: reading 10 hands the world back as it was found, so its entry has to be a world it can hand back. The
  // guide-only entry is the one every restore can return to (see panel-world.railGuideOnly); measured red 10 without it
  // once the panel gates started leaving browser tabs behind.
  { name: 'browser-tabs-live', kind: 'live', prep: 'rail-guide-only', cmd: ['node', 'scripts/verify-browser-tabs-live.mjs'],
    what: 'R184: the plugin\'s hand on the tabs, judged against the REAL shell. The gate loads the shipped lib in its own process with panelOrigin pointed at the live shell, so the subject is real plugin code plus a real shell rather than a fixture: ten readings cover the shell tab set being read as a fact (the answer follows a tab the shell itself created), a tab threading through the whole tool family, browser_goto going through op=tab-goto with the user current tab left untouched (the paired reading the round exists for), the four tab tools actually opening, switching and closing in the shell, and the shell own refusal sentences - the cap, an unknown id, and a lease held by somebody else - being carried out verbatim rather than paraphrased. A lease held by this gate makes the tools refuse by name, and releasing it makes the same call pass. The gate takes no pixels and no geometry: it reads op=state and the tools\' answers. It returns the world to its entry fingerprint in a finally block and prints both prints, and every unmeasurable world - a dead port, a module that will not load, another live consumer, a lease already held - is a NAMED skip with exit 3. 31 mutants attack the judge over the transcript measured in that same run, declared set equal to observed set, no reading uncovered, and three product-level counterproofs show the gate reddens on a lib with Page.navigate restored, with the tab set cached, or with the shell refusals reworded.' },
  // R377: this gate pays for a MODEL TURN, so its duration is the model's, not the machine's - measured 19.7 s and
  // 20.8 s in two runs and then killed at the 180 s default in a third while producing no verdict of its own. The
  // budget is declared here for the same reason `foreign-app-agent-live` declares one.
  { name: 'tool-groups-live', kind: 'live', cmd: ['node', 'scripts/verify-tool-groups-live.mjs'], budgetMs: 6 * 60 * 1000,
    what: 'R185: the tool face slides in the REAL client, and this gate pays for exactly one model turn to see it. It creates one session through the shell own API, sends one prompt asking for the directory and then for the declared group, and judges the transcript that turn produced: exactly one request/header with reason change and exactly one developer/message; the next step tool face differs from the declaring step by EXACTLY the group members, name for name; the declaring step does not see them (the change lands on the next step, which is what effective next-step means); and the cost the tool reported - entries, serialized bytes, startsSeries - is read off that same header. Nine readings, and the session is left in place as the evidence. Running it again is possible without spending a turn at all (--replay against a measured transcript, which is also how --self-attack works: 29 mutants over that transcript, declared set equal to observed set, none uncovered). Four named third states exit 3 with their reason and without a prompt: no page, another live consumer already in the window, a model that never called the declaration, and a declaration refused by name. SINGLE RUN ONLY - it must not go into a segment suite, because the suite would spend a model turn on every pass.' },
  { name: 'browser-tabs-offline', kind: 'offline', cmd: ['node', 'scripts/verify-browser-tabs-offline.mjs'],
    what: 'R184: the plugin gets a hand on the sidebar panel TABS without a window. The gate builds several fake panels on its own ephemeral ports (main, probe, away, present, env, dead), points the plugin at them through the row config or the environment (the fixture seam, whose default is unchanged), and judges the shipped lib/**: the tab set is read as a fact rather than a cache (a panel whose tabs change is answered with the new set), a tab threads through the whole tool family (the request body carries the tab verbatim, and omitting it means the field is ABSENT, not null), browser_goto on the panel channel goes through op=tab-goto and reads back that tab own location, the four tab tools answer the shell ops and refuse an unknown id, a full panel and an unmounted browser BY NAME (the shell own sentences, compared character by character), and the model-visible descriptions are generated per channel so the panel channel no longer claims what is only true of the chrome channel. The fake panel is not taken on trust: its op=state key set and key ORDER are compared against the shell own format string, and a world with no such tools is a NAMED not-measured and exit 3. Self-attack mutants declare the readings they move, and the declared set equals the observed set.' },
  { name: 'tool-groups', kind: 'offline', cmd: ['node', 'scripts/verify-tool-groups.mjs'],
    what: 'R185: the tool-group mechanism itself - three states, a group as a set of related tools that open and close together, an activating pair that is always on, and what one declaration costs. Twenty-two readings on a real kernel mount with the shipped artifact staged and applied, never against a fixture: a member of a closed group is indistinguishable from a tool that never existed AT EXECUTION rather than merely absent from the schema, the activating pair survives every group state because it is registered on the agent own context, and the cost of a slide is measured three ways - entries, serialized bytes, and whether that request started a new series - with (7, 1894, false) read at runtime out of the producer record and compared against the gate own measurement and against the header that really went out. The reading the producer flagged as unmeasured is measured here: the gate drives a real agent loop whose model is scripted, and after one declaration the session log holds exactly one request/header with reason change and exactly one developer/message whose content is three tool-addition lines and no removal, with the declaring step still seeing the old surface and the change landing on the next step. Eighteen mutants are anchored in the shipped lib own bytes, each rebuilding the world in its own subprocess, declared set equal to observed set, and a missing artifact or an unreadable producer row is a NAMED not-measured with exit 3.' },
  { name: 'tool-groups-prompt-incremental', kind: 'offline', cmd: ['node', 'scripts/verify-tool-groups-prompt-incremental.mjs'],
    what: 'R194: WHICH SURFACE a prompt change lands on, per route capability - an in-history route appends one system node and replaces no head, an incapable route replaces the head and appends nothing, and a tool-group declaration writes no system message on either; the two routes must not collapse into one surface, which is how the capability would be ignored' },
  { name: 'tool-groups-thirdparty-seam', kind: 'offline', cmd: ['node', 'scripts/verify-tool-groups-thirdparty-seam.mjs'],
    what: 'R194: a synthetic third-party plugin, using ONLY the public linkGroups seam, gets its group into the directory and the model face with hard gating; the config row is byte-identical at six checkpoints; the disposer restores the face bytes; a duplicate id is refused by name with nothing half-installed; and two instances still collide. Its own attack rewrites one string of the shipped artifact per mutant and every mutant reddens exactly what it declared' },
  { name: 'tool-groups-approval', kind: 'offline', cmd: ['node', 'scripts/verify-tool-groups-approval.mjs'],
    what: 'R185: the approval half of tool groups, in a REAL kernel mount - SystemPrompt, ToolRuntime, AgentRegistry, Session and ApprovalService, three agents (an ordinary scoped one, one already holding the tool_groups name, one whose ctx is not a scope), the shipped artifact staged by absolute path and applied for real, and no hand-written registry anywhere. Twenty-three readings: a user-disabled group is refused by name without ever asking for approval while an unapproved group asks EXACTLY once, a refusal leaves the directory byte-identical, an unavailable approval channel refuses rather than defaulting to yes, all nine refusal codes are observed with the tool face unchanged across them, and the only legal value of effective is next-step. The gate reads the kernel own approval/asked and approval/decided audit pairs and its tools/change events rather than the artifact own report or the producer selfcheck. Fourteen mutants are anchored in the shipped lib\'s own bytes - each anchor must occur exactly once or the mutant is a named not-measured - and each runs in its own subprocess with the world rebuilt, declared set equal to observed set fourteen of fourteen.' },
  { name: 'collab-relay', kind: 'offline', cmd: ['node', 'scripts/verify-collab-relay.mjs'],
    what: 'two logs relay a batch: both folds agree, a re-send is idempotent, a hole is refused, and writers reusing one sequence space keep both records' },
  { name: 'collab-relay-http', kind: 'offline', cmd: ['node', 'scripts/verify-collab-relay-http.mjs'],
    what: 'a real kernel binds the relay route from row config: an authorised batch lands and folds, an unauthorised one is refused, and a mismatched token makes the gate fail' },
  { name: 'collab-handshake', kind: 'offline', cmd: ['node', 'scripts/verify-collab-handshake.mjs', '--skip-regression'],
    what: 'lead-to-lead handshake: a request is not permission, a grant on the ordered pair takes effect, a later denial clears it, direction matters, and the fold is order independent' },
  { name: 'toolbar', kind: 'offline', cmd: ['node', 'scripts/verify-toolbar.mjs'],
    what: 'the toolbar entry into the official conversation header actions slot: the slot is proven to exist in the captured surface and its kind/scope/owner checked at the declaring file:line, the item model reads a fakeable attribute source with mounted, missing and empty-value told apart, copy lives in the dictionary and styles use tokens only, and the live reading skips by design this round' },
  { name: 'responsive', kind: 'offline', cmd: ['node', 'scripts/verify-responsive.mjs'],
    what: 'the responsive layout bands: bounds are inclusive on both sides, ties go to the table order, a width no band covers is refused rather than crowned with the nearest band, an illegal width is a TypeError rather than a verdict, applying the same plan twice writes nothing, and keys the previous layout had are removed rather than left behind' },
  { name: 'notes', kind: 'offline', cmd: ['node', 'scripts/verify-notes.mjs'],
    what: 'notes live outside the process: a store survives being closed and reopened byte for byte, a child process can write notes its parent then folds, the log is only ever appended to, a deleted note is a visible tombstone rather than a disappearance, and a damaged tail loses nothing that was readable' },
  // R370: its only red in a full run was reading 7 ("the world was put back") while every substantive reading held - the
  // entry world was whatever the gate before left. A deterministic entry fixes the comparison, not the product.
  { name: 'panel-contribution-render', kind: 'live', prep: 'rail-guide-only', cmd: ['node', 'scripts/verify-panel-contribution-render.mjs'],
    what: 'the contributed row is really drawn and it is really fresh: under its own lease the gate walks the rail to the guide, opens our panel tab and reads the DOM - the row carries the provider own zh title read out of its own bundle, its meta line is the panel own template over the route kind sinks, the body shows the reading the provider store holds rather than the placeholder it falls back to, the marker items still equal the host route declared rows byte for byte while contributed carries exactly one item, and the rail is put back on the entry tab afterwards. Single run only and never in a segment: six clicks, one evaluate per read, a screenshot, zero model turns, and named exit 3 when the world is not prepared' },
  { name: 'panel-contribution', kind: 'offline', cmd: ['node', 'scripts/verify-panel-contribution.mjs'],
    what: 'the panel seam is a real provided service in the real client plane: a provider injects it and activates beside it while the same half stays pending without it, a duplicate id refuses every claimant rather than picking a winner, an unknown kind and an empty source are refused with the same three names the host registry uses (and the host answers the same codes for the same inputs), a non-finite order keeps the passthrough wording instead of inventing a code, two arrival orders project byte-identically, a disposer takes exactly one item away, and the marker keeps items meaning host-declared rows byte for byte while the contributed rows arrive in their own field' },
  // R327: this gate measures a press that has an effect only from the AWAY world (the rail parked off the browser
  // pane). It says so itself when it declines ("prepare the AWAY world first"), so the world it needs is declared
  // here rather than remembered by whoever runs the suite.
  // R371: the away world stays declared here. With it the gate reading 4 (the chip this gate presses) holds; without it that
  // reading fails. Its restore reading 7 fails either way in a sequence - named, not papered over.
  // R377 measured BOTH preps for this gate: with 'away-panel' (its R371 prep) and with 'rail-guide-only' the same two
  // readings fail through the runner (4 the chrome before the click, 7 the world put back) while the gate passes 9/9
  // standalone in the same world. The prep is kept at its historical value rather than swapped for no gain.
  { name: 'panel-action-render', kind: 'live', prep: 'away-panel', cmd: ['node', 'scripts/verify-panel-action-render.mjs'],
    what: 'R193: an ACTION row is pressed in the real client - one click on the browser half own declaration opens its pane, nothing runs while the row is only drawn, and the world is put back on the tab it was on' },
  // R377: the deterministic entry the gate's own restore can return to (see rail-guide-only in this file). Measured:
  // this gate passes ALONE in this world and failed its restore reading when the suite ran it after other live gates
  // had churned the rail - the entry, not the product, was what moved.
  { name: 'panel-render', kind: 'live', prep: 'rail-guide-only', cmd: ['node', 'scripts/verify-panel-render.mjs'],
    what: 'the first pixel readings: the gate owns the panel under the shell lease, walks the rail to the guide, opens our extension capsule, and reads what is actually drawn - the tab title and the chip are literally the zh dictionary value, the item row carries the registry title while the note row carries the ledger text, the glyph sits on its own 16x16 canvas and is drawn at the size the SEAT own rule gives for this capsule (read from GuideBody source, the running skin and the seat own other glyphs, never hardcoded) in currentColor resolved to the holder own colour, the body is in the rail with real ink in it, and then the rail is put back on the tab it was entered with and the lease released. Single run only and never in a segment; exits 3 by name when the shell, the rail entrance, the world or the single-run guard is not there' },
  { name: 'client-copy-and-icons', kind: 'offline', cmd: ['node', 'scripts/verify-client-copy-and-icons.mjs'],
    what: 'our own client halves keep their copy in a locale namespace and their glyphs inside the measured rule: each declared package registers its own dictionary into the real kernel locale service under the one namespace its own source names, the shipped translator answers every key in both languages with a second registration refused by the service, the zh and en key sets are equal, no user-visible text is written straight into the client source while every t() key resolves, glyphs come from the first-party set with no brand piece anywhere, a package with no glyph slot is a NAMED not-applicable verdict rather than a green, and the coverage list names by id which packages are guarded and which are not' },
  { name: 'panel-live', kind: 'live', cmd: ['node', 'scripts/verify-panel-live.mjs'],
    what: 'the panel client half is delivered AND it read the world back: the served manifest is parsed across every plugins block (the union of 85 blocks is 79 unique rows and the panel row is not in the first one), a read-only evaluate answers the marker with mounted true, the marker own items and limits are byte-for-byte the two real state routes answers while the drawn count equals the ledger live count, the live negative controls stay out, the notes state route answers 200 with the two thresholds and the ledger is byte-identical before and after, and the boundary is a reading of its own: this proves a computed view and not one pixel, with zero panel operations. Single run only and never in a segment: shell GETs, kernel GETs and one evaluate, no POST anywhere, no model turn' },
  // R355: the editor own readings run in the suite. Three gates, each cheap and offline: the save route handler with its
  // seven rules, the decision layer the pane calls (dirty / saved / STALE / refused / no path), and the tab type own
  // claim+registration+copy readings that already existed but were never wired in.
  { name: 'markdown-save-route', kind: 'offline', cmd: ['node', 'plugins/dsh-link-markdown/test/save-route.spec.mjs'],
    what: 'the editor save route: POST only, an existing regular file, an optimistic version (409 STALE), an atomic replace with no temp file left behind, and no file ever created' },
  { name: 'markdown-save-rules', kind: 'offline', cmd: ['node', 'plugins/dsh-link-markdown/test/save-rules.spec.mjs'],
    what: 'the decision layer the pane uses: when an edit may be offered, what counts as dirty, and that a 409 is its own outcome and can never read as saved' },
  { name: 'markdown-tab-type', kind: 'offline', cmd: ['node', 'plugins/dsh-link-markdown/test/markdown-view.spec.mjs'],
    what: 'the tab type itself: the claim decision, the registration shape, the paging rule, and the copy/icon contract (no sentences in the client half)' },
  { name: 'notes-route', kind: 'offline', cmd: ['node', 'scripts/verify-notes-route.mjs'],
    what: 'the two write paths of one ledger stay one rule: the shipped apply() registers exactly two exact routes on the real host web server, a GET never moves a byte, a POST and a direct appendNote called with the same input produce ledgers that are byte-identical, the three named refusals are reachable over HTTP with the ledger unchanged, any other verb is a named 405 with an allow header, and the model cannot reach the route at all because the tool face holds two names and the route path answers UNKNOWN_TOOL' },
  { name: 'client-plugin-live-rows', kind: 'live', cmd: ['node', 'scripts/verify-client-plugin-live-rows.mjs'],
    what: 'the live page carries this client half and the half really ran: the served manifest is read from the running shell across every plugins block, dsh-link-markdown/client.js is in it, a read-only Runtime.evaluate answers the marker with registered true, and the two live negative controls (dsh-link-toolbar, dsh-link-responsive) are absent - a parser that loses our name or invents theirs reddens. Read-only by construction: shell GETs plus one evaluate, no panel, no lease, no input injection, no model turn, and a restart in the middle is a named exit 3 rather than a product red' },
  { name: 'client-plugin-mount', kind: 'offline', cmd: ['node', 'scripts/verify-client-plugin-mount.mjs'],
    what: 'a browser half is delivered as three separate facts and each can fail alone: the manifest really declares the web client face and its exports entry points at a built lib/client.js, the two new rows appear in a real composed profile, the markdown claim answers .md as markdown while the same address as .txt does not (flipping the kind reddens it), the panel registry projects order-independently with a closed vocabulary and named refusals, and the contract page own citation table holds with at least ten rows' },
  { name: 'collab-ready-set', kind: 'offline', cmd: ['node', 'scripts/verify-collab-ready-set.mjs'],
    what: 'R206/R207: the frontier the scheduler needs - readySet on the SHIPPED collab module. The diamond frontier and its phase change, blocked naming exactly the unmet ids, a done task never in ready (LATEST row wins both ways), an undeclared dep reported under unknown with its dependent not ready, a real cycle named while its neighbour stays ready, and purity proven under a dead clock, an emptied env and a module-only readable tree. Its own pre-flight cross-checks the hand-written expectation against the gate own fold, so a gate slip reports as an instrument fault' },
  { name: 'anchored-lite-prefix', kind: 'offline', cmd: ['node', 'scripts/verify-anchored-lite-prefix.mjs'],
    what: 'R219: anchored-lite changes exactly ONE thing about a request prefix - the tool surface. One prefix-changing hook (system-prompt/assemble) and no agent/pre-step hook at all, cold start narrowed to the bootstrap pair with system and messages untouched, promotion to bootstrap+resident, and a config naming suppressedContextSources accepted but NAMED in a warning instead of silently ignored' },
  { name: 'collab-message-sources', kind: 'offline', cmd: ['node', 'scripts/verify-collab-message-sources.mjs'],
    what: 'R217: the bus records Team message flow from BOTH kernel lines - the alpha.1 mailbox events (queued/delivered, both directions) and the alpha.5 inbox splice (accepted, this end only), with every non-team splice refused, and the status document + panel row naming which of the two a ledger actually holds instead of reporting a silent zero' },
  { name: 'collab-tools-live-turn', kind: 'live', cmd: ['node', 'scripts/verify-collab-tools-live-turn.mjs'],
    what: 'R204: a MODEL, not a script, calls the team tools - one session, one prompt, and the session own event log shows team_declare_capability and team_heartbeat called once each; the ledger grows by exactly two rows whose actor is that session id prefix (append byte-identical before them); the rows fold into the route registry; the tools were visible only because the group opened (61 -> 69 names); the world is put back. Closes the gauntlet finding that every declaration row came from a test script' },
  // R368: this gate measures the announce, so its world is "this machine IS announcing" - declared here instead of left to
  // whoever last toggled the panel.
  { name: 'lan-bridge-discovery-live', kind: 'live', prep: 'bridge-announce', cmd: ['node', 'scripts/verify-lan-bridge-discovery-live.mjs'],
    what: 'R203: the discoverability CLAIM against the evidence - every NIC the service announces from must have a post-bind result recorded by name (and the loopback leg too), and discoverable=true is only allowed when at least one egress really worked. Today it reads RED on this machine: 3/3 NIC egresses failed and the boot still claimed true' },
  { name: 'collab-relay-bound-live', kind: 'live', cmd: ['node', 'scripts/verify-collab-relay-bound-live.mjs'],
    what: 'R203: whether the collab relay is bound is a FACT, not a silence - with no token the live boot log carries a named line saying so; with a token the report says bound=true and no-token/wrong-token requests are refused 401 with a named code while a correct token lands, all measured in a throwaway kernel built from the live profile own bundles, with the live ledger byte-identical before and after' },
  // R311: this gate spends ONE model round and drives another application through the shell panel. The default
  // 180 s budget killed it while it was still working ("GATE TIMEOUT after 180s ... produced no verdict of its
  // own", .tmp/r309b-suite.log), which is the budget mis-shaped for the gate and not the gate hanging: it measured
  // 6/6 twice in R289/R296 when run standalone. It declares 8 minutes below.
  // R381: and it needs the PANEL mounted - it measured NO_PANEL ("the shell reports no panel, so there is no browser the
  // agent could drive") in every suite run, which is the environment's business, not the gate's. The browser-pane prep
  // builds that world through the shipped doors.
  { name: 'foreign-app-agent-live', kind: 'live', prep: 'browser-pane', cmd: ['node', 'scripts/verify-foreign-app-agent-live.mjs'], budgetMs: 8 * 60 * 1000,
    what: 'R200: DSH agent attached to a FOREIGN application - one session, one model round, and the agent really drives example-app through the browser tools; the judgement is the app own state face (controller.getSnapshot via window.__CHEMLAB__): selected null -> demo-1 and entryOpen true -> false with 13 other fields identical, the entry tab untouched, the panel surface and lease put back, pids identical' },
  { name: 'host-embed-live', kind: 'live', cmd: ['node', 'scripts/verify-host-embed-live.mjs'],
    what: 'R195/R198: the embed page in a REAL tab - loads at 420x842 against a 1191x842 viewport, a dsh-link:mode message grows it to the viewport (+771 px), a second message returns it to the load rect, an unknown mode is refused BY NAME with the geometry unmoved, and the gate closes its tab with the entry tab never navigated and the lease released' },
  { name: 'device-bridge-live', kind: 'live', cmd: ['node', 'scripts/verify-device-bridge-live.mjs'],
    what: 'R250: the phone serves the device net as its slave end, end to end and without a human - a device is attached, the app is installed and listening on 47600, /__shell/bridge hands out the six-digit code, the SHIPPED link.js/crypto.js pair with it, a file this gate wrote is listed and read back byte for byte, fs.write is refused by the reserved sentence, and the route reports paired+served afterwards' },
  { name: 'android-env', kind: 'offline', cmd: ['node', 'scripts/verify-android-env.mjs'],
    what: 'R222: the Android story is exactly as big as the evidence - the committed scaffold exists but the three gradle chain files it needs are ABSENT (never compiled), the mobile engine seam refuses by name, the environment probe names every missing prerequisite with its own value, and the emulator this machine would use is named (MuMu) with its guest VM state' },
  { name: 'responsive-live', kind: 'live', cmd: ['node', 'scripts/verify-responsive-live.mjs'],
    what: 'R222: dsh-link-responsive is REALLY running in the live shell - the document root carries data-dsh-link-layout, the band is wide at 1440px and not wide at 900px, returning to 1440 restores it, and the window is put back where it was found' },
  { name: 'android-vm-selfhost', kind: 'offline', cmd: ['node', 'scripts/verify-android-vm-selfhost.mjs'],
    what: 'R287 the objective\u2019s Android self-assembled VM: scripts/android-vm.mjs asks MuMuManager for an instance (status / ensure / release over its own verbs), and this gate holds what that is worth - the manager answers and its info parses, an instance is RUNNING with an adb endpoint, adb itself lists it as a live device, our app is installed on it, and controlling an index that does not exist is refused by name (the instrument can fail).',
    holds: 'the Android device the toolchain assembles for itself' },
  { name: 'host-embed-crate', kind: 'offline', cmd: ['node', 'scripts/verify-host-embed-crate.mjs'],
    what: 'R281 requirement D: the crate is enterable by ANOTHER Tauri app - pub mod embed with HostEmbed (a window_label a host chooses), run_with recording the configuration once and then running the one application entry point, and no window lookup left hard-coding "main" (the two remaining literals are the tray id). The compile is the evidence (cargo check --lib exit 0, cargo test --lib embed 3 passed); this gate stops the tree drifting from it.',
    holds: 'the embed entry point a host application calls, held to the tree' },
  { name: 'host-embed-route', kind: 'offline', cmd: ['node', 'scripts/verify-host-embed-route.mjs'],
    what: 'R195/R198/R221: the embed surface as data AND as a product - the contract route answers the whole shape a host needs (version, both modes, both selection paths, the bounds protocol, the four origin sites, the required host capabilities), a non-GET is 405 with a named code, and the embed page is a REAL panel: four live sections (bus/board/notes/browser) reading the kernel own routes same-origin through one captured fetch device, each card naming its own unavailable state instead of a number, the protocol prose moved into a closed-by-default drawer, still self-contained with all seven external-reference kinds at zero and both modes refused/drawn by name' },
  // R381: this gate's own restore reading compares the rail it found with the rail it leaves, so the rail it finds has
  // to be a world it can put back. The guide-only entry is that world: the gate opens the teams tab THROUGH the guide
  // entry (the strip's add control exists only on an empty pane), and closing the tab it opened brings the guide back.
  { name: 'teams-pane-truth', kind: 'live', prep: 'rail-guide-only', cmd: ['node', 'scripts/verify-teams-pane-truth.mjs'],
    what: 'R198: the pane draws the world it is looking at - one real session spawns one teammate (one model round), the ledger row is attributed by its own actor field, the route lists that team, and teams.teams.length == counts.teams == the pane own number == the rows actually DRAWN, with zero gate-invented nodes and withheld fixtures counted' },
  { name: 'notes-cost-live', kind: 'live', cmd: ['node', 'scripts/verify-notes-cost-live.mjs'],
    what: 'R198: what a note change COSTS on this provider - two interleaved arms with one variable (a note added between two prompts vs not), read from each session own usage.inputTokens / usage.cacheReadTokens at the rewrite step, against a threshold fixed in the file before the run. Today it answers MATERIAL: the rewrite collapses the cache read to 0-384 while the control reads ~21.4k' },
  { name: 'notes-live', kind: 'live', cmd: ['node', 'scripts/verify-notes-live.mjs'],
    what: 'the live client really loaded this feature and the model face follows the group: the boot lines naming section notes:ledger order 700 and two configured groups are read first, a fresh session carries neither notes tool while the group is closed, one declaration produces exactly one reason-change header and one developer message with the two members added and the cost trio reported from that header, a note appended from another process is honestly a named third state because the control log folds an in-process view, and an unanswered approval refuses notes_add by the kernel own wording with the ledger byte for byte unchanged. Single run only: it spends real model turns (two), never belongs in a segment suite, and exits 3 by name when the window is not prepared' },
  { name: 'notes-inject', kind: 'offline', cmd: ['node', 'scripts/verify-notes-inject.mjs'],
    what: 'a note reaches the model one step after it changes and never in the step that changed it, an unchanged ledger commits no system message at all, notes_add is refused by name whenever approval is missing, unanswered, rejected or cancelled and the ledger bytes do not move, an allowed call appends exactly one fact, a closed notes group makes both tools unknown at the execution face while the group opens on one declaration with exactly one reason-change header and one developer message, the mounted section carries order 700 with interpolation off, and the shipped group table is read rather than transcribed' },
  { name: 'notes-ledger', kind: 'offline', cmd: ['node', 'scripts/verify-notes-ledger.mjs'],
    what: 'the two thresholds hold at all three layers: the 200th live note is kept and the 201st is refused by name with the ledger bytes unchanged, the 100th code point is kept and the 101st refused, the fold and the rendered section are byte-identical whichever order the facts arrived in, the section text IS the fold rather than a second copy, an empty ledger contributes no text at all, a note carrying braces reaches the prompt unsubstituted, and a ledger holding unusable rows is still folded instead of throwing' },
    // R312: this gate NESTS two other gates (verify-roster, verify-composition-rows) and they write derived rows:
  // the serial lane is the only place it can be honest about what it measured.
  { name: 'roster-single-source', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-roster-single-source.mjs'],
    what: 'the roster has one source: exactly one scan over packages, apps and vendor, four consumers reading it, a specifier no source provides still refused, and a change the roster caused told apart from live state moving' },
    // R312: nests verify-plugin-contract and verify-composition-rows, both writers -> serial lane.
  { name: 'roster', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-roster.mjs'],
    what: 'the host-module roster: the kernel vendors a framework set and the web shell preloads a client baseline, both count as provided, the baseline lives in one file the build also reads, and a specifier nobody provides still fails - so the roster was fixed rather than the rule loosened' },
  { name: 'plugin-message-sources', kind: 'offline', cmd: ['node', 'scripts/verify-plugin-message-sources.mjs', '--check-fixture'],
    what: 'R199: scans what is INSTALLED in the live profile (junctions included, or it would judge exactly the packages this repo ships and call the silence clean) for a session-message source written with the retired word kind:plugin - the shape that killed a real turn with format v4 message requires a producer-owned source kind - and needs a fixture that proves the scan can find an offender' },
    // R312: R114 recorded this gate corrupting a real artifact through a mutant copy -> it writes the tree.
  { name: 'plugin-contract', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-plugin-contract.mjs'],
    what: 'the plugin contract: every rule cites its evidence and can be shown to redden alone, an unreadable judgement stays unknown instead of passing, the exit code separates a refusal from a rewrite, and the recorded verdicts for the real third-party packages are recomputed rather than trusted' },
  { name: 'upgrade', kind: 'offline', cmd: ['node', 'scripts/verify-upgrade.mjs'],
    what: 'the LINK upgrade path: a layout migration is planned from data before anything is written, conversations survive byte for byte, plugins are only ever added, no existing config key may disappear silently, unknown paths are left alone, a newer state refuses to be downgraded, and a second run changes nothing' },
  { name: 'collab-adapter', kind: 'offline', cmd: ['node', 'scripts/verify-collab-adapter.mjs'],
    what: 'multi-platform admission and its MCP face: an adapter is a declared member, an unrecognised protocol version is refused with the supported list rather than guessed at, the capability registry is the authority over what an adapter may offer, the tool list is derived from that registry from one end point of view, and a call is refused as unknown, unprovided or unreachable before it is allowed' },
  { name: 'collab-dispatch-timeout', kind: 'offline', cmd: ['node', 'scripts/verify-collab-dispatch-timeout.mjs'],
    what: 'a dispatched unit of work that is never answered goes stale once the caller names a threshold: the boundary is inclusive, no threshold means never stale, an answered or refused dispatch is never overwritten by the clock, and the batch travels over a real loopback HTTP route with an authorised push landing and an unauthorised one refused without touching the ledger' },
  { name: 'doc-citations', kind: 'offline', cmd: ['node', 'scripts/verify-doc-citations.mjs'],
    what: 'the pages that judge the project keep their citations: three tables (the device-net page, PLAN, STATUS) all resolve, an exact line number and a text that must occur exactly once each have their own way of reddening, a row that names no requirement fails loudly instead of vanishing, every cited file is under version control and every seam a table calls an export really exists on the built module' },
  { name: 'device-net-variants', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-variants.mjs'],
    what: 'the rest of the multi-hop shapes: a three-hop chain resolves and carries work both ways, a live transit behind a quiet member is member-silent while both fresh is ok and a quiet transit is route-down, all of it read from instants the harness chooses rather than waited for, a loop through the via chain is a cycle with the closed edge named in routeFailures too, the same chosen instant read twice gives the same verdict byte for byte, and the page rows that say ownPage is a one-hop export are really there' },
  { name: 'device-net-multihop', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-multihop.mjs'],
    what: 'a foreign transit carries a peer records two hops: the far member joins through it, the chain resolves hop by hop and admits work over the whole path, the work goes out two hops and the answer comes back with a value the far process computed, a transit that only forwards its own page carries nothing (so the regrouping by origin is load-bearing), a quiet transit stops the chain at itself while a quiet member behind a live transit is a different answer, and the page citations for that rule really exist' },
  { name: 'mcp-interop', kind: 'offline', cmd: ['node', 'scripts/verify-mcp-interop.mjs'],
    what: 'our MCP client against implementations nobody here wrote: the kernel own official-SDK fixture server and the official SDK client itself, both driven by the shipped artifact and compared fact by fact - handshake, tool names, a multi-line round trip, an isError result, an unknown tool, a server that dies - plus a strict server of the gate own making whose deliberately broken modes have to be visible to at least one side, and a recorded difference in the protocol version each client asks for' },
  { name: 'compat-mount-preflight', kind: 'offline', cmd: ['node', 'scripts/verify-compat-mount-preflight.mjs'],
    what: 'the mount window is a single command because the recipe was measured before the door opens: the live profile is only READ, the recipe is applied to a copy (still parseable, exactly two lines longer, and edited in the file own line ending so the style it arrived with is the style it leaves with - a CRLF document gains no bare LF and an LF document gains no CR, while a document that arrives mixed or changes style is a named failure (the live profile is LF today because a mount rewrote it with JSON.stringify, and this assertion now reddens for that too)), the path it writes really resolves to a package with a built artifact, the backup reverts byte for byte, a dry run writes nothing in the copy or in the live profile, and the package-manager step is load-bearing because a declared link dependency is not a resolved one' },
  { name: 'subagent-contention', kind: 'offline', cmd: ['node', 'scripts/verify-collab-subagent-contention.mjs'],
    what: 'a repeated parent declaration on one team warns loudly exactly once, stays on record as two facts, leaves the arbitration fold unchanged, and an already-recorded fact re-delivered announces nothing at all - a diagnosis that cries wolf on replay is worse than no diagnosis' },
  { name: 'team-parent-arbitration', kind: 'offline', cmd: ['node', 'scripts/verify-team-parent-arbitration.mjs'],
    what: 'the folded team tree decides a parent by the frozen rule and not by arrival order: a named parent beats null and equal specificity goes to the earlier record, both delivery orders fold byte-identically, the losers stay visible in the fold and in the ledger rows, a same-world control that removes only the second parent shows no contention, and a single-parent world still folds byte-identically to the artifact from before the change (the golden comes from git show, not from this gate own expectation)' },
  { name: 'collab-team-tree-from-events', kind: 'offline', cmd: ['node', 'scripts/verify-collab-team-tree-from-events.mjs'],
    what: 'the official subagent lifecycle is folded into the ledger as team/state facts, and the gate drives the plugin\'s exports while folding the tree itself: two official start events leave exactly two facts and fold to B -> C, the durable subagent/catalog path adds a third level, re-delivering either path leaves the line count and the fold byte-identical, a same-world control that only removes delivery writes nothing, a disposes ledger stops, an unnamed or payload-less event is refused loudly, end-without-start stays legal, and a missing event surface throws instead of installing an unobservable subscription' },
  { name: 'citation-realign', kind: 'offline', cmd: ['node', 'scripts/verify-citation-realign.mjs'],
    what: 'the repair path for line-form citations is judged by somebody other than the repairman: a +20-line shift reddens all 42 rows of the page, --check reports 42 stale and writes no bytes, the repair rewrites exactly those 42 cells with the line count unchanged and the SHIPPED checker (not the tool) goes green again, and a vanished or ambiguous anchor is refused loudly while the other 41 rows are still repaired' },
  { name: 'citation-drift', kind: 'offline', cmd: ['node', 'scripts/verify-citation-drift.mjs'],
    what: 'the price of each citation form is measured on the shipped tree rather than argued: a directed-copy world shifts the cited sources by 20 lines, the line-form page then reddens on every one of its 42 rows, the two text-form tables ride the shift, an unshifted control world stays green, and the broken-row count is quantified so the reading cannot go vacuous' },
  { name: 'handoff-index', kind: 'offline', cmd: ['node', 'scripts/verify-handoff-index.mjs'],
    what: 'the plan index does not quietly fall behind the records: every round record is cited by a plan section and every round the plan names has a record, differences are listed by round rather than summarised, an exemption needs a written reason, and a removed section or an invented round reddens it' },
  { name: 'plugin-apply-shape', kind: 'offline', cmd: ['node', 'scripts/verify-plugin-apply-shape.mjs'],
    what: 'a plugin apply written as a function declaration is constructible, so cordis mounts it with new and throws away the cleanup it returned - measured three ways against the vendored kernel, through the public mount verb and through the loader own registry verb so that shape and not path decides, with the four source lines it rests on asserted and an effect-registered teardown measured in every shape' },
  { name: 'probe-alive-control', kind: 'offline', cmd: ['node', 'scripts/verify-probe-alive-control.mjs'],
    what: 'every instrument that reads a live composition can say whether the composition was still alive when it read: the roster is asserted both ways against what detection finds, a file that boots a kernel or a profile must carry an executable reading of a root-provided service and not merely a claim, a file that does not boot must say why with a real reason, a written claim and the wired reading have to be the same story, and the roster floor stops a narrowed list from passing quietly' },
  { name: 'device-net-topologies', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-topologies.mjs'],
    what: 'the shapes a device net grows into: a four-hop chain where four real foreign ends carry work out and the answer all the way back, a transit that carries two far members which both answer without either answer landing on the other, two different chains to one far end that stay two chains, and a cycle reported with its closed edge while the bypass beside it still resolves in the same read - one bad chain is not allowed to poison the table' },
  { name: 'device-net-boundaries', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-boundaries.mjs'],
    what: 'every threshold this build decides is read at the equality instant itself: dispatch staleness, member liveness, the lock ttl and a lease all put the equality instant on the side that is already over, each with the millisecond before it as the contrast that proves the boundary is what is being read, the same instant read twice is byte-identical, a retry is planned exactly on the line and not one millisecond early, a transit and the member behind it answer differently at the same instant, the lease applies to retries and never to the work itself, and the second lease comparison that governs rather than ages is read on its own' },
  { name: 'device-net-leases', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-leases.mjs'],
    what: 'the page and the shipped build agree about leases: every kind the page promises is really read by this build, the page says which kinds it deliberately does not promise, both refusal words exist in the artifact, the citation table cannot hide a fragment behind a pipe and cannot hide a row outside its own markers, the equality boundary and the smallest-end rule the page states are re-measured rather than repeated, and a real foreign process that writes an attempt is admitted in a world with no lease and refused as lease-mismatch while another end holds one' },
  { name: 'device-net-protocol', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-protocol.mjs'],
    what: 'the device-net page stays true: every citation it makes resolves to the shipped source line that still holds the sentence it claims, a shifted line number, a reworded fragment and a missing file each have to redden the checker, every refusal code the page promises is cited somewhere, and the conflict code finally has a behaviour - a re-used sequence with different content is refused while an identical re-send is skipped' },
  { name: 'device-net-foreign', kind: 'offline', cmd: ['node', 'scripts/verify-device-net-foreign.mjs'],
    what: 'a foreign harness joins the device net by reading one page: a real child process that shares no code with us declares itself, is dispatched to and answers over a real loopback route, while a batch claiming our own writer name is refused however it is dressed, a gapped stream and a re-used identity are refused with the ledger untouched, an answer from anybody but the addressed member is visible as wrong-writer, and a second answer never overwrites the first' },
  { name: 'collab-retry-wiring', kind: 'offline', cmd: ['node', 'scripts/verify-collab-retry-wiring.mjs'],
    what: 'the retry rule wired to a host clock: nothing ticks unless a row asks for it and the default world never writes on its own, an installed timer really runs and the effect disposer really stops it, one pass at a time with an overlapping pass skipped rather than planned twice, a pass that cannot append is counted instead of thrown and the next one still works, a misconfigured interval fails loudly at load naming the field, and the rule itself still works with no host and no timer at all' },
  { name: 'collab-retry-ticks', kind: 'offline', cmd: ['node', 'scripts/verify-collab-retry-ticks.mjs'],
    what: 'the retry timer read as two separate facts: ticks counts interval callbacks and the outcome counters count work, so a timer that stopped firing can be told apart from a timer whose every pass was refused; a manual pass raises the work counters without ticking, the disabled world ticks not at all while the enabled one does, teardown freezes the clock, a pass that cannot append is named failed rather than silent, and every mutation anchor is still present in the shipped artifact' },
  { name: 'collab-retry-schedule', kind: 'offline', cmd: ['node', 'scripts/verify-collab-retry-schedule.mjs'],
    what: 'how long until the next retry pass: the delay is one pure function of the idle streak, absent backoff keeps the interval exactly as it was, a half-configured backoff and an out-of-range jitter are refused loudly at load by field name, the ceiling holds with the equality case included, the same streak always yields the same delay with the jitter included, the chained timer really waits the computed delay, a pass that writes an attempt resets the streak, and teardown clears the timer that has not fired yet' },
  { name: 'collab-retry-lease', kind: 'offline', cmd: ['node', 'scripts/verify-collab-retry-lease.mjs'],
    what: 'one owner for a root across ends: a lease is a fact in the ledger, the owner is a pure function of the live leases with the smallest end winning whatever order they arrived in, a planner refuses a root another end holds with lease-held, the writer claims before it writes and writes nothing when the recount says somebody else owns it, a fold refuses an attempt written by a non-holder as lease-mismatch, the service counts claims and losses, and two real logs racing one root settle on exactly one holder and at most one attempt' },
  { name: 'collab-redispatch', kind: 'offline', cmd: ['node', 'scripts/verify-collab-redispatch.mjs'],
    what: 'work that was never answered: a stale dispatch is planned as a named next attempt and nothing else, the threshold is inclusive while a fresh wait plans nothing, writing is idempotent and the attempt names itself in the ledger, the attempt cap and an existing attempt are two different reasons, the executor runs the new attempt and refuses the one it superseded, an unreachable member is blocked with the routing verdict rather than retried blindly, capability keeps its single owner in the projection, and a retry is the same unit of work with a new id' },
  { name: 'collab-mcp-dispatch', kind: 'offline', cmd: ['node', 'scripts/verify-collab-mcp-dispatch.mjs'],
    what: 'an MCP server tool becomes a dispatched unit of work: the tool list installs into the end-tools registry without writing the ledger, a call maps every verdict onto exactly one dispatch outcome with nothing flattened and an unknown verdict refused loudly, a tool that reports isError still answers the dispatch, and the reason a latched transport failed travels all the way into the recorded result' },
  { name: 'collab-mcp-transport', kind: 'offline', cmd: ['node', 'scripts/verify-collab-mcp-transport.mjs'],
    what: 'a real MCP server over stdio: the client spawns it, one newline-delimited JSON-RPC message per line with no embedded newline, logs never travel on stdout, the handshake order is initialize then notifications/initialized, a version the client did not ask for is refused, a tool that answers with isError is a result rather than a broken transport, an unknown tool name is a JSON-RPC error, a malformed frame latches the stream so later calls never write, a dead child or a slow one ends as transport-error or timeout instead of a hang, close() reaps the process, and the server tools become ledger capabilities byte for byte' },
  { name: 'collab-team-dispatch', kind: 'offline', cmd: ['node', 'scripts/verify-collab-team-dispatch.mjs'],
    what: 'cross-end dispatch: a unit of work is answered at most once by the member it addresses, work the capability ledger never allowed is refused before anything runs, an answer from anybody else is a visible refusal rather than an overwrite, an uninstalled tool is refused while the answer the dispatch has stays unspent, folding is order independent, and two real processes answer each other over their own logs' },
  { name: 'collab-teaming', kind: 'offline', cmd: ['node', 'scripts/verify-collab-teaming.mjs'],
    what: 'cross-end teaming: a member may run on another end and is reached through relays, absence of a host fact means this end, a chain that arrives back here is an arrival and not a cycle, a dead transit cuts the route while a silent target is a different answer, and a remote member is assignable over a real two-log relay' },
  { name: 'collab-relay-stream', kind: 'offline', cmd: ['node', 'scripts/verify-collab-relay-stream.mjs'],
    what: 'a writer numbers its own stream, not the merged log: after ingesting a peer\'s records a writer\'s own records still start at one, so the peer can take them back, while a genuinely missing record in a peer\'s stream is still refused and a re-send stays idempotent' },
  { name: 'collab-writeface', kind: 'offline', cmd: ['node', 'scripts/verify-collab-writeface.mjs', '--skip-regression'],
    what: 'the write face of continuation: the guard refuses to append at all when the end is not the author (the ledger does not grow), a turn that bypassed the guard stays visible in the rejected table, a turn is judged against the author at its own instant, and a turn is carried between two real logs over the relay path' },
  { name: 'collab-continuation', kind: 'offline', cmd: ['node', 'scripts/verify-collab-continuation.mjs', '--skip-regression'],
    what: 'one conversation has one author: an epoch that does not advance is refused, a healthy owner cannot be taken over, a silent owner can (and only with a threshold), an explicit handoff moves ownership exactly once, and two ends claiming the same epoch leave exactly one of them able to write' },
  { name: 'collab-lockfail', kind: 'offline', cmd: ['node', 'scripts/verify-collab-lockfail.mjs', '--skip-regression'],
    what: 'a member that stopped answering does not keep its lock: liveness decides whether a lock may be taken, silence is not death, an expired lock is takeable by expiry alone, and the default readings are measured byte-identical against the previous bundle' },
  { name: 'collab-board', kind: 'offline', cmd: ['node', 'scripts/verify-collab-board.mjs', '--skip-regression'],
    what: 'the shared task board: deps fold, a tombstoned dependency is named unreachable instead of silently blocking forever, a record without deps does not erase the graph, teams sharing an id neither satisfy each other nor share a lock, a lock crosses the relay, every node-referring field is spelled as a key, and the board agrees with the task fold on which claim won' },
  { name: 'collab-fractal', kind: 'offline', cmd: ['node', 'scripts/verify-collab-fractal.mjs', '--skip-regression'],
    what: 'the fractal team tree: ancestry is root-first, a cycle is reported with its closing edge instead of being walked, orphans stay visible, 200 levels do not overflow, and team facts leave the entity readings untouched' },
  { name: 'collab-failover', kind: 'offline', cmd: ['node', 'scripts/verify-collab-failover.mjs', '--skip-regression'],
    what: 'a caller-supplied clock decides liveness, exactly-at-threshold is unhealthy, a stale holder task becomes recoverable and stops being so after a beat, and candidates come from the capability registry plus health' },
  { name: 'collab-registry', kind: 'offline', cmd: ['node', 'scripts/verify-collab-registry.mjs', '--skip-regression'],
    what: 'the capability registry answers dynamic discovery from the ledger, an unknown capability is an empty list rather than an error, the higher seq wins under either arrival order, and capability records leave the entity readings untouched' },
  { name: 'collab-contested', kind: 'offline', cmd: ['node', 'scripts/verify-collab-contested.mjs', '--skip-regression'],
    what: 'the fold reports contests instead of picking by arrival: both arrival orders project the later-at claim for tasks and members, the ledger survives, and forcing arrival order reddens it' },
  { name: 'collab-multihop', kind: 'offline', cmd: ['node', 'scripts/verify-collab-multihop.mjs'],
    what: 'three logs, two hops: a middle hop forwards a peer\'s work by regrouping on the record origin, the naive forward carries nothing, and a wrong origin is accepted as the forwarder\'s' },
    // R312: builds packs into the tree -> serial lane.
  { name: 'pack', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-pack.mjs'],
    what: 'the shipped pack is derived from the plugin tree (not hand-written), its rows are unique, and one consolidated MIT text covers every MIT package it lists' },
  { name: 'name-drift', kind: 'offline', cmd: ['node', 'scripts/verify-name-drift.mjs'],
    what: 'the name-drift table is held to its own evidence: counts match, cited files resolve, unsupported rows offer no candidates, and a refusal is not translated anywhere' },
    // R312: re-derives the usage tickets it then compares -> a writer.
  { name: 'adaptation-usage', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-adaptation-usage.mjs'],
    what: 'per-plugin usage tickets are re-derived from the plugin artifacts, self-consistent, and name what each unresolved usage class means' },
    // R312: rewrites compat/adaptation/rows/* when it regenerates (measured: it moved loader-behaviour.json) -> serial.
  { name: 'composition-rows', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/verify-composition-rows.mjs'],
    what: 'row reports stay derived from the rows they describe, every citation lands on its own line, the composition matches the real loader, and each check can be shown to fail' },
  { name: 'bundle-resolution', kind: 'offline', cmd: ['node', 'scripts/check-bundle-resolution.mjs'],
    what: 'every bundle the live profile declares resolves and still carries the patch files it declares, and the check is shown to fail on a manifest that lies' },
  { name: 'client-plane-verify', kind: 'offline', cmd: ['node', 'scripts/verify-client-plane.mjs'],
    what: 'the client-plane capture and its verdicts are recounted, both controls hold in both directions, and every attack reddens exactly its own check' },
  { name: 'client-members', kind: 'offline', cmd: ['node', 'scripts/verify-client-members.mjs'],
    what: 'the client-plane member layer: a real member call is judged present with its citation, a constructed unknown member is absent, and an unparsable member set can only be unknown' },
  { name: 'compat-live', kind: 'offline', cmd: ['node', 'scripts/verify-compat-live.mjs'],
    what: 'the compat table is usable in a real boot, not only self-consistent with the archive: the loader publishes its layer under the shipped default, and the criteria red when it cannot attach' },
  { name: 'compat-simple-role-words', kind: 'offline', cmd: ['node', 'scripts/verify-compat-simple-role-words.mjs'],
    what: 'the simplified layer is built only on capability role words: no kernel member path, no service name used as a capability, no name outside the table' },
  { name: 'compat-simple-default-output', kind: 'offline', cmd: ['node', 'scripts/verify-compat-simple-default-output.mjs', '--self-attack'],
    what: 'the shipped simple.tools.add takes a call with no output while a copy forced back to {type:json} throws JsonSchemaError, and the four declared mutants move exactly the readings they declare, with the artifact byte-identical throughout' },
  { name: 'compat-simple-roles-mounted', kind: 'offline', cmd: ['node', 'scripts/verify-compat-simple-roles-mounted.mjs'],
    what: 'the three simplified roles in the REAL mirrored mount: the plugin is reached through a private copy, the rows/limit readings are reported absent while the store is empty, the hermetic compositions must refuse all three roles with the loader typed error, and the shipped artifact stays byte-identical' },
  { name: 'dsh-ops-mount', kind: 'offline', cmd: ['node', 'scripts/verify-dsh-ops-mount.mjs'],
    what: 'the third-party bundle dsh-ops: the vendored tree folds to its checked-in lock, the supply-chain facts hold, the composition carrying it mounts cleanly, our own layer still works beside it, and the measured truth is pinned - it publishes no tools in this construction, which R119 proved is not the missing payloads, not a subpath row name, not a missing dependency row and not a silent failure' },
  { name: 'dsh-ops-tools', kind: 'offline', cmd: ['node', 'scripts/verify-dsh-ops-tools.mjs'],
    what: 'the ops file tools in a PROVISIONED world: they execute, they answer the same query in far fewer bytes than the files they replace (glob 782x, grep 435x, inspect 5.3x when last measured), the interface R121 read out of the tools still holds, and the readings are credible; without the pinned payloads extracted it SKIPs with the reason and exit 3' },
  { name: 'skin-contract', kind: 'offline', cmd: ['node', 'scripts/check-skin-contract.mjs', '--self-test'],
    what: 'the community skin-package contract checker really bites: each rule reddens on a package built to break it' },
  { name: 'theme-surface', kind: 'offline', cmd: ['node', 'scripts/capture-theme-tokens.mjs', '--check'],
    what: 'the --dsw-* token surface still matches the client sources, and the plugin-side token usage and literal list are re-derived with it' },
  { name: 'client-surface', kind: 'offline', cmd: ['node', 'scripts/capture-client-surface.mjs', '--check'],
    what: 'the captured client-plane service and event names still match the kernel sources the client half declares them in' },
  { name: 'client-plane', kind: 'offline', cmd: ['node', 'scripts/check-client-plane.mjs', '--check'],
    what: 'every client-plane usage the four plugins make is judged against the captured client surface, and the committed report is re-derived' },
  { name: 'import-resolution', kind: 'offline', cmd: ['node', 'scripts/check-import-resolution.mjs', '--check'],
    what: 'every module specifier the four plugins import is classified against the kernel package roster and the profile installs, and the committed report is re-derived' },
  { name: 'mount-admission', kind: 'offline', cmd: ['node', 'scripts/verify-mount-admission.mjs'],
    what: 'measured admission: disabled keeps a row out, the 0.1.x spellings disable/enabled/options are inert, one id mounts the later row, and every check can be shown to fail' },
    // R312: measured writing compat/adaptation/rows/loader-behaviour.json -> serial lane.
  { name: 'row-behaviour', kind: 'offline', mutates: 'tree', cmd: ['node', 'scripts/probe-row-behaviour.mjs'],
    what: 'construct-triggered rows composed through the real loader: which old-style rows are rejected loudly, silently kept, or silently superseded' },
  { name: 'compat-future', kind: 'offline', cmd: ['node', 'scripts/verify-compat-future.mjs'],
    what: 'a synthetic future kernel is described by editing data only: red before the table section exists, green after, with no code moved' },
  { name: 'lan-bridge-relay', kind: 'offline', cmd: ['node', 'plugins/dsh-lan-bridge/test/relay-three-host.mjs'],
    what: 'the device layer: a real A-B-C relay handshake, the minimum permission across two hops, loop prevention, and a late-appearing target' },
  // R368: the reclaim suite inside this gate cannot pass while the live shell bridge is announcing itself on this machine
  // (measured R318-R320: its own log sees the shell arriving as a peer mid-run), so its world is "the bridge is quiet".
  { name: 'interconnect', kind: 'offline', prep: 'bridge-quiet', cmd: ['node', 'scripts/verify-interconnect.mjs'],
    what: 'the LAN bridge suites pass, the grant lattice obeys its laws, and every executed relay cell matches the meet prediction' },
  { name: 'theme-section', kind: 'offline', cmd: ['node', 'plugins/dsh-theme-settings/test/radius-apply.spec.mjs'],
    what: 'radius application rules hold' },
  { name: 'image-guard', kind: 'offline', cmd: ['node', '--test', 'plugins/dsh-image-guard/test/decide.spec.mjs', 'plugins/dsh-image-guard/test/guard.spec.mjs'],
    what: 'the image-count cap decides and guards as documented' },
]

/** The live prerequisite: a CDP endpoint answering on the configured port. */

// ---------------------------------------------------------------------------
// Gate-list self-check: a verify-*.mjs that nobody registered is a gate that does
// not run, and this repository has already shipped two of those. Exceptions are
// listed with a reason rather than left implicit.
// ---------------------------------------------------------------------------
const ALLOWED_UNREGISTERED = [
  { file: 'verify-shell-radius.mjs', reason: 'legacy radius probe kept for archaeology; superseded by verify-radius-audit.mjs' },

  // verify-roster.mjs was declared debt for part of R50 while it crashed on an init-order bug;
  // it now runs green (7/7) with a 6-mutant self-attack, so it is registered above and the
  // exemption is gone - an unregistered gate is a gate that does not run.
  // The two entries that stood here (verify-compat-future, verify-interconnect) were
  // declared debt for work owned by another task; both are now registered above, so the
  // debt is paid and the entries are gone rather than left as dead exemptions.
]
{
  const { readdirSync, readFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const selfPath = fileURLToPath(import.meta.url)
  const self = readFileSync(selfPath, 'utf8')
  const unregistered = readdirSync(dirname(selfPath))
    .filter((name) => /^verify-.*\.mjs$/.test(name))
    .filter((name) => self.includes("scripts/" + name) === false)
    .filter((name) => ALLOWED_UNREGISTERED.some((entry) => entry.file === name) === false)
  if (unregistered.length > 0) {
    console.error('gate-list self-check: unregistered verify-*.mjs in scripts/: ' + unregistered.join(', '))
    console.error('register each one above, or add it to ALLOWED_UNREGISTERED with a reason.')
    process.exit(1)
  }
}

async function cdpReachable() {
  try {
    const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

/**
 * How long one gate may run before the runner takes its verdict away from it.
 *
 * R144 measured what happens without this: a gate whose own node process is gone but whose GRANDCHILDREN
 * still hold the pipes keeps `spawnSync` waiting for an EOF that never comes - the suite stops at that
 * gate with no error, no exit code and no output, which is indistinguishable from "still working". It
 * happened four times in one round, at four different gates, three of them untouched by that round's work.
 * The budget is the same one the project's efficiency rule gives a gate (60s); the default here is more
 * generous because a few gates boot a throwaway kernel on purpose.
 */
const GATE_TIMEOUT_MS = Number(process.env.DSH_LINK_GATE_TIMEOUT_MS ?? String(3 * 60 * 1000))

/** Run one gate and capture its verdict, with a real deadline and a real kill. */
function run(gate, tag = '') {
  // Fault-injection switches are read from the environment by the plugin under test, so a parent
  // shell that happens to export one would arm a defect inside what the runner believes is a clean
  // gate — and the green result would be a green result for the wrong build. The runner therefore
  // removes them: an attack run sets them on the gate process itself, not on the whole suite.
  const clean = { ...process.env, NO_COLOR: '1' }
  for (const name of ['DSH_LINK_COLLAB_ATTACKS', 'DSH_LINK_COLLAB_FORGET_SEQ', 'DSH_LINK_COLLAB_NO_LOCK',
    'DSH_LINK_COLLAB_DROP_OWNER', 'DSH_LINK_COLLAB_DROP_TEAM_KEY', 'DSH_LINK_COLLAB_LEGACY_EFFECT']) {
    delete clean[name]
  }
  return new Promise((resolve) => {
    const started = Date.now()
    // R311: a gate may declare its own budget; the default stays the anti-hang one.
    const budget = Number(process.env.DSH_LINK_GATE_TIMEOUT_MS ?? String(gate.budgetMs ?? GATE_TIMEOUT_MS))
    const child = spawn(gate.cmd[0], gate.cmd.slice(1), {
      cwd: PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: clean,
      windowsHide: true,
    })
    let text = ''
    let settled = false
    // Progress, not silence: the efficiency rule asks a long gate to say where it is, and the runner is
    // the only place that can say it for a gate that prints nothing while it works.
    const noise = setInterval(() => {
      process.stdout.write('    ' + (tag === '' ? '' : tag + ': ') + '... still running after ' + String(Math.round((Date.now() - started) / 1000)) + 's\n')
    }, 15000)
    const finish = (code, signal, note) => {
      if (settled) return
      settled = true
      clearInterval(noise)
      clearTimeout(timer)
      // A failing gate has to stay diagnosable. Keeping only the last 8 lines cost R159 the reading that actually
      // failed: a gate that prints five readings plus evidence pushes its own FAIL line out of the log, so the red
      // could not be named from the suite output at all. Every verdict line is kept; the raw tail is the fallback.
      const lines = ((note === null ? '' : note + '\n') + text.trim()).split('\n')
      const verdicts = lines.filter((line) => /^\s*(ok|FAIL|SKIP|n\/a)\s+\S/.test(line) || /readings?,\s*\d+/.test(line))
      const tail = (verdicts.length === 0 ? lines.slice(-8)
        : verdicts.length <= 80 ? verdicts
          : verdicts.slice(0, 40).concat(['    ...'], verdicts.slice(-40))).join('\n')
      resolve({
        name: gate.name,
        kind: gate.kind,
        what: gate.what,
        command: gate.cmd.join(' '),
        code,
        signal,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        /** Last lines of combined output: enough to see the verdict, not the whole run. */
        tail,
      })
    }
    const timer = setTimeout(() => {
      // Close our end of the pipes FIRST: a gate's grandchildren inherit them, and waiting for EOF on a
      // pipe a grandchild still holds is exactly the hang this timeout exists to end. Destroying our ends
      // is what actually frees the runner, whether or not the tree dies with it.
      try { child.stdout.destroy() } catch { /* no stream */ }
      try { child.stderr.destroy() } catch { /* no stream */ }
      // Then kill - but ONLY a child that is still alive. The first version killed by pid unconditionally,
      // and a pid the OS had already recycled in those 180 seconds is a kill aimed at somebody else: the
      // suite died silently right when its own timeout fired, which is how that hazard was found.
      const alive = child.exitCode === null && child.signalCode === null
      if (alive) {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        if (process.platform === 'win32') {
          try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* best effort */ }
        }
      }
      finish(1, null, 'GATE TIMEOUT after ' + String(Math.round(budget / 1000)) + 's: ' + (alive ? 'the runner killed pid ' + String(child.pid) + ' and its tree' : 'the gate process was already gone, so only the runner\'s pipe ends were closed') + '. It produced no verdict of its own.')
    }, budget)
    child.stdout.on('data', (chunk) => { text += chunk })
    child.stderr.on('data', (chunk) => { text += chunk })
    child.on('error', (error) => finish(1, null, 'the runner could not start the gate: ' + error.message))
    child.on('close', (code, signal) => finish(code, signal, null))
  })
}

const selected = GATES.filter((gate) => only === null || only.has(gate.name))
if (selected.length === 0) {
  console.error('no gate matched --only ' + [...(only ?? [])].join(','))
  process.exit(2)
}

const liveReady = await cdpReachable()
const results = []

// ---------------------------------------------------------------------------
// R312: the OFFLINE lane runs in parallel, the LIVE lane stays serial.
//
// Measured on the R309b pass: 146 gates, 1385 s of gate time end to end (23.1 min), offline 650 s and live
// 735 s, run one at a time. Offline gates build their own temp worlds and share nothing, so N of them can
// run at once; LIVE gates share ONE world - the panel lease, the rail, the browser panel, CDP - so they stay
// strictly serial (the R151 lesson: four live gates failed against each other when they overlapped). Gates
// that WRITE tracked files are pinned to the serial phase as well. DSH_LINK_SUITE_PARALLEL=1 restores the old
// one-at-a-time behaviour for any run that needs it.
const PARALLEL_OFFLINE = Math.max(1, Number(process.env.DSH_LINK_SUITE_PARALLEL ?? '4'))
// Measured (R312) by scanning every gate script for a throwaway kernel boot (`bin.ts`, `tsx/esm`, `probe-kernel-*`),
// a listener of its own (`.listen(`/`createServer(`) or a spawn of another gate: 28 offline gates are WORLD-HEAVY and
// must not run beside anything. The first parallel attempt proved it the expensive way - mount-admission went from 8.4 s
// to 51.6 s under contention and dsh-ops-mount / interconnect went red - so they are pinned to the serial lane by name
// rather than by hope. A gate that is heavy and NOT on this list is a gate this list has drifted from: the scan above is
// the check, and it is one grep.
const WORLD_HEAVY = new Set(['plugin-health', 'scope-dispatch', 'capability-live', 'compat-matrix', 'compat-consumer', 'browser-tabs-offline', 'collab-relay-http', 'client-copy-and-icons', 'client-plugin-mount', 'collab-dispatch-timeout', 'device-net-variants', 'device-net-multihop', 'mcp-interop', 'plugin-apply-shape', 'probe-alive-control', 'device-net-topologies', 'device-net-leases', 'device-net-protocol', 'device-net-foreign', 'collab-retry-lease', 'composition-rows', 'compat-live', 'compat-simple-default-output', 'compat-simple-roles-mounted', 'dsh-ops-mount', 'dsh-ops-tools', 'mount-admission', 'row-behaviour'])
const parallelLane = (gate) => gate.kind === 'offline' && gate.mutates !== 'tree' && WORLD_HEAVY.has(gate.name) === false
const inParallel = PARALLEL_OFFLINE > 1 ? selected.filter(parallelLane) : []
const inSerial = selected.filter((gate) => inParallel.includes(gate) === false)

const report = (gate, result) => {
  // Exit code 3 is a live gate's own "I did not measure anything" — a viewport too small to be a window, say.
  // It is a SKIP rather than a pass: reporting it green would be exactly the silent success this project keeps
  // removing.
  if (result.code === 3) {
    result.skipped = result.tail.split('\n').find((line) => line.includes('SKIP')) ?? 'the gate declined to measure'
    result.code = requireLive ? 1 : null
    const word = gate.kind === 'live' ? 'SKIPPED-LIVE' : 'SKIPPED'
    process.stdout.write(`    ${word}  ${result.command}\n    ${result.skipped}\n`)
  } else {
    process.stdout.write(`    ${result.code === 0 ? 'PASS' : 'FAIL'}  ${result.command}  (${result.seconds}s)\n`)
    if (result.code !== 0) process.stdout.write(`    ${result.tail.replaceAll('\n', '\n    ')}\n`)
  }
}

// The parallel lane: a fixed pool over the offline gates, each block printed when it finishes.
const parallelResults = new Map()
if (inParallel.length > 0) {
  process.stdout.write(`--- offline lane: ${inParallel.length} gate(s), ${PARALLEL_OFFLINE} at a time ---\n`)
  const queue = inParallel.slice()
  const worker = async () => {
    while (queue.length > 0) {
      const gate = queue.shift()
      process.stdout.write(`==> ${gate.name} (${gate.kind}, parallel)\n`)
      const result = await run(gate, gate.name)
      parallelResults.set(gate.name, result)
      report(gate, result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL_OFFLINE, inParallel.length) }, worker))
  process.stdout.write(`--- offline lane done; the live/writer lane follows, one at a time ---\n`)
}

for (const gate of inSerial) {
  if (gate.kind === 'live' && liveReady) {
    // A DEAD gate holder parks every panel gate behind it: each one pre-checks the lease and declines with
    // "the panel was already leased by <a gate that already exited>" (measured R326: three panel gates that pass
    // alone skipped inside one full run). The lease is the one piece of world state a gate cannot repair itself, so
    // the runner clears a stale one - and touches nothing else, because a gate that inherits a world it did not
    // choose fails its own "the world was put back" reading (measured on panel-contribution-render with a full
    // settle). A settle that cannot reach the shell is not a gate result, so it says so and moves on.
    try {
      const cleared = await clearStaleLease(PROXY_PORT_FOR_SETTLE)
      if (cleared.stolenFrom !== null) process.stdout.write(`    (a stale panel lease was reclaimed from ${cleared.stolenFrom})\n`)
      // And close a panel an earlier gate left mounted: the panel is ONE native object, so a leftover makes the next
      // gate decline ("the world is ACTIVE ... the browser pane is already open") and makes a later restore reading
      // disagree with what it inherited. The rail is NOT touched - parking it changes the world a gate records.
      // The gate owns its own world (R328: a gate that is handed a world it did not choose fails its own restore
      // readings). What the runner does is only the thing a gate cannot do for itself: drop a dead holder lease and
      // close a panel left mounted by an earlier gate.
      // R329 TRIED A PAGE RELOAD HERE AND IT IS MEASURED HARMFUL: `location.reload()` leaves the WebView2 page without
      // its rail (no tabs, no [data-dsh-link-surface]) for longer than any gate will wait, and the four gates that
      // were red before went to "no rail, no surface" reds instead. The rail is restored by the app, not by the
      // reload. Do not reintroduce it without a way to re-enter the page the way the warmer does.
      // R377: close a leftover panel BEFORE the prep, not after it. Closing the native panel is what drops the page's
      // [data-dsh-link-surface] anchor, so doing it after `browser-pane` left the gate with the world the prep had just
      // built minus the one thing it exists for - measured: prep says anchors=1, the gate then reads
      // {"count":0,"anchor":null} and declines.
      const closedPanel = await closeMountedPanel(PROXY_PORT_FOR_SETTLE)
      if (closedPanel.was !== null) process.stdout.write(`    (closed a panel left mounted by an earlier gate: ${closedPanel.was})\n`)
      if (gate.prep === 'away-panel') {
        // Park, do NOT close: this gate presses a browser CHIP that must still be in the rail (R363).
        const away = await parkAwayFromBrowserPane(PROXY_PORT_FOR_SETTLE, CDP_PORT)
        process.stdout.write(`    (away world for ${gate.name}: parked=${String(away.parked)} anchors=${String(away.anchors)})\n`)
      }
      if (gate.prep === 'rail-guide-only') {
        // R377: the one entry the panel gates' own restore can return to. Those gates reach our panel through the guide
        // capsule, and picking a capsule takes the guide chip with it - so a gate that entered on a rail holding the
        // guide PLUS other chips can close its own tab and never put the guide back. From guide-only the gate's tab is
        // the LAST tab: closing it empties the pane and the guide re-seeds itself.
        const rail = await railGuideOnly(PROXY_PORT_FOR_SETTLE, CDP_PORT)
        process.stdout.write(`    (guide-only rail for ${gate.name}: closed=${String(rail.closed)} from ${String(rail.before)} now ${String(rail.chips)})\n`)
      }
      if (gate.prep === 'rail-away') {
        // A deterministic entry: the rail on a non-browser tab, the panel untouched. The gate restore reading then compares
        // two worlds that both started from a known place instead of from whatever the gate before left.
        const rail = await parkRailAway(PROXY_PORT_FOR_SETTLE, CDP_PORT)
        process.stdout.write(`    (rail for ${gate.name}: ${String(rail.parked)})\n`)
      }
      if (gate.prep === 'bridge-announce' || gate.prep === 'bridge-quiet') {
        const want = gate.prep === 'bridge-announce'
        const bridge = await setBridgeDiscovery(PROXY_PORT_FOR_SETTLE, CDP_PORT, want)
        process.stdout.write(`    (bridge discovery for ${gate.name}: enabled=${String(want)} answer=${String(bridge.answer)})\n`)
      }
      if (gate.prep === 'browser-pane') {
        // R377: the add control this used to rely on exists only on an EMPTY pane, so a rail holding the guide made this
        // prep a no-op and the gate then declined. The door chain walks the shipped controls instead.
        const pane = await ensureBrowserPane(PROXY_PORT_FOR_SETTLE, CDP_PORT)
        process.stdout.write(`    (browser pane for ${gate.name}: door=${String(pane.door)} anchors=${String(pane.anchors)})\n`)
      }
    } catch (error) {
      process.stdout.write(`    (the stale-lease check did not run: ${error?.message ?? error})\n`)
    }
  }
  if (gate.kind === 'live' && !liveReady) {
    // A live gate that cannot run is never a pass, and --live turns the skip into a failure.
    results.push({ name: gate.name, kind: gate.kind, what: gate.what, command: gate.cmd.join(' '),
      code: requireLive ? 1 : null, skipped: `CDP ${CDP_PORT} is not answering` })
    continue
  }
  process.stdout.write(`==> ${gate.name} (${gate.kind})\n`)
  const result = await run(gate)
  results.push(result)
  report(gate, result)
}

// R348: put the panel world back AFTER the live lane, not only before each gate. The user noticed the leftovers
// ("为什么你测试留下的都是悬空的浏览器"): the last live gate leaves its panel mounted, and nothing in the runner ever closed
// it, so a finished run could leave a floating browser window on somebody desktop. This closes it and SAYS what it found,
// so the next run starts from the state the warmer describes.
if (results.some((row) => row.kind === 'live' && row.code !== null)) {
  try {
    const closed = await closeMountedPanel(PROXY_PORT_FOR_SETTLE, 'suite-teardown')
    process.stdout.write(closed.was === null ? '--- panel world: nothing was mounted at the end ---\n' : `--- panel world: closed a panel the last live gate left mounted (${closed.was}) ---\n`)
    try { await clearStaleLease(PROXY_PORT_FOR_SETTLE) } catch (error) { /* the lease is reported before each gate anyway */ }
  } catch (error) {
    process.stdout.write(`--- panel world: the teardown did not run (${error?.message ?? error}) ---\n`)
  }
}

// The tally reads in DECLARATION order whether a gate ran in the pool or in the serial lane.
for (const gate of selected) {
  const done = parallelResults.get(gate.name)
  if (done !== undefined) results.push(done)
}

const failed = results.filter((row) => row.code !== 0 && row.code !== null)
const skipped = results.filter((row) => row.skipped !== undefined)
const passed = results.filter((row) => row.code === 0)

// ---------------------------------------------------------------------------
// R196-P1: "no live gate ran" must never be able to call itself a green run.
//
// The count that matters is not `skipped` in the lump: it is a LIVE gate that did not
// measure. Before this change a run with every live gate skipped for want of CDP exited 0
// and printed the same shape as a run where they all passed (the gauntlet measured exactly
// that, report section 1). The two populations are now counted apart, the live skips are
// NAMED, and they are fatal unless the caller passed --allow-skipped-live on purpose.
//
// What is deliberately NOT changed: a FAILED gate still goes through this same `failed`
// filter to the same non-zero exit and is still printed by name with its `what:` - a live
// gate that really fails is not turned into a skip, and a skip is not softened into a pass.
// An OFFLINE/KERNEL gate's own exit 3 also keeps its old weight (skipped, not fatal), so the
// offline-only segmented runs and the recorded commands keep the exit code they had.
// ---------------------------------------------------------------------------
const liveRows = results.filter((row) => row.kind === 'live')
const liveSkipped = liveRows.filter((row) => row.skipped !== undefined)
const liveRan = liveRows.filter((row) => row.skipped === undefined)
const otherSkipped = skipped.filter((row) => row.kind !== 'live')
// --live already turns a skip into code 1 (so it lands in `failed`); it also wins over
// --allow-skipped-live, because "require the live gates" cannot mean "unless you ask nicely".
const liveSkipAccepted = allowSkippedLive && !requireLive
const liveSkipFatal = liveSkipped.length > 0 && !liveSkipAccepted
const exitCode = failed.length > 0 || liveSkipFatal ? 1 : 0
const liveSkipNames = liveSkipped.map((row) => row.name)
const policy = `--live ${requireLive ? 'passed' : 'not passed'}, --allow-skipped-live ${allowSkippedLive ? 'passed' : 'not passed'}: `
  + (liveSkipped.length === 0
    ? 'no live gate was skipped, so neither flag decided anything'
    : liveSkipFatal
      ? 'a skipped live gate is FATAL' + (requireLive && allowSkippedLive ? ' (--live wins: it cannot be accepted away)' : ' (pass --allow-skipped-live to accept it)')
      : 'skipped live gates are ACCEPTED by --allow-skipped-live')

if (jsonOut) {
  console.log(JSON.stringify({
    cdpPort: CDP_PORT,
    liveReady,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    // The reading this round exists for: a live gate that did not run is a number of its own.
    live: {
      selected: liveRows.length,
      ran: liveRan.length,
      skipped: liveSkipped.length,
      skippedNames: liveSkipNames,
      skippedReasons: liveSkipped.map((row) => ({ name: row.name, reason: row.skipped })),
    },
    offlineOrKernelSkipped: otherSkipped.map((row) => row.name),
    requireLive,
    allowSkippedLive,
    skippedLiveFatal: liveSkipFatal,
    policy,
    exitCode,
    results,
  }, null, 2))
} else {
  console.log('')
  console.log(`gates: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped`)
  console.log('live: ' + (liveRows.length === 0
    ? 'no live gate was selected, so none was skipped'
    : `${liveRan.length} ran / ${liveSkipped.length} skipped of ${liveRows.length} selected`
      + (liveSkipped.length === 0 ? '' : ` (${liveSkipNames.join(', ')})`)))
  for (const row of failed) console.log(`  FAIL    ${row.name}: ${row.what}`)
  for (const row of skipped) console.log(`  ${row.kind === 'live' ? 'SKIPPED-LIVE' : 'SKIPPED'} ${row.name}: ${row.skipped}`)
  if (otherSkipped.length > 0) {
    console.log(`  (${otherSkipped.length} offline/kernel gate(s) declined too: not fatal today, which is the old rule and what the offline segments run on)`)
  }
  if (liveSkipped.length > 0) {
    console.log('  (start the shell with DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=' + CDP_PORT + ', or pass --live to make a skip a failure, or --allow-skipped-live to accept one)')
  }
  console.log('policy: ' + policy)
}

process.exit(exitCode)
