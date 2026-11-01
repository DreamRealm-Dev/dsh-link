#!/usr/bin/env node
/**
 * Self-check (R183-A) -- recruiting and being recruited: two Teams agreeing to become one tree.
 *
 * Subject: what landed in R183 (docs/handoff/R183-A-ledger.md) -- the team/merge fact (md:229/274), its
 * three disciplines, and the two model-visible tools that produce it. The hard rule of this half is the
 * one that keeps the team tree with a single writer: **an agreement is only ever written by the party
 * being merged in, and only that party's own team/state is ever touched.** A tool that let the asking
 * side write the other side's parent would give the tree two sources, which is the collision gates
 * team-parent-arbitration and subagent-contention exist to catch.
 *
 * Every reading is taken from the SHIPPED artifact (plugins/dsh-link-collab/lib/index.js) and from the
 * ledger FILES this script parses with its own JSON.parse, so "the call wrote two rows" is counted by
 * the file and not by the tool that wrote it. A batch of refusals is measured against the ledger's
 * sha256 and byte length before and after.
 *
 *   M1  THE PRODUCER IS REGISTERED AND ONE REQUEST IS ONE ROW   both tool names are in the shipped
 *       registry by default, a request gains exactly one team/merge row and the answer equals the row
 *       field by field, and a request changes no tree.
 *   M2  A GRANT IS TWO ROWS AND A DENIAL IS ONE                 the grant writes the merged-in party's
 *       own team/state and then the authorization; the denial writes one row and no tree; a later
 *       denial clears an earlier grant.
 *   M3  EVERY REFUSAL IS NAMED AND THE LEDGER DOES NOT MOVE     malformed arguments, a self merge, a
 *       pair with no handshake, a request against a standing grant, and the asker trying to write the
 *       other side's parent -- each with its own code, ledger byte-identical.
 *   M4  ONLY THE PARTY BEING MERGED IN WRITES ITS PARENT        a second writer (a real second ledger)
 *       answers an absorb: the row it writes is its OWN parent. The refusing side is measured as well:
 *       after the applicant's attempt is refused, the other team's node is exactly as it was.
 *   M5  SEQ DECIDES, NOT THE WORD                               three rows of one pair renumbered so the
 *       denial holds the smallest sequence must fold to granted, and the other way round.
 *   M6  A MERGE NEEDS BOTH FACTS                                mayMerge composes mayExchange; with the
 *       handshake row dropped the pair is still granted and the merge is still not allowed.
 *
 * Exit 0 every reading held | 1 a reading failed. Usage: node plugins/dsh-link-collab/test/merge-selfcheck.mjs [--module <path>] [--keep]
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT = resolve(HERE, '..', '..', '..')
const argv = process.argv.slice(2)
const KEEP = argv.includes('--keep')
const option = (name, fallback) => { const at = argv.indexOf(name); return at === -1 ? fallback : argv[at + 1] }
const MODULE_PATH = resolve(option('--module', join(PROJECT, 'plugins', 'dsh-link-collab', 'lib', 'index.js')))
const module = await import(pathToFileURL(MODULE_PATH).href)

const show = (value) => { try { return JSON.stringify(value) } catch { return String(value) } }
const clip = (text, max = 240) => String(text).length > max ? String(text).slice(0, max) + '...' : String(text)
const readings = []
const add = (id, ok, detail, evidence = []) => {
  readings.push({ id, ok })
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' :: ' + detail)
  for (const line of evidence) console.log('      ' + line)
}

const NOW = 1700000000000
const MERGE = 'team/merge'
const TEAM_KIND = 'team/state'
const TEAM_A = 'team-A'
const TEAM_B = 'team-B'
const TEAM_D = 'team-D'
const TEAM_E = 'team-E'
const REQUEST_TOOL = 'team_request_merge'
const ANSWER_TOOL = 'team_answer_merge'

const root = mkdtempSync(join(tmpdir(), 'r183-merge-'))
const buildWorld = async (homeDir) => {
  const home = homeDir
  const dir = join(home, 'collab')
  mkdirSync(dir, { recursive: true })
  const registry = new Map()
  const provided = new Map()
  const registryService = { register(definition) { registry.set(definition.name, definition); return () => { registry.delete(definition.name) } } }
  const server = { register() { return () => {} } }
  const ctx = {
    get(name) {
      if (name === 'tools') return registryService
      if (name === 'webServer') return server
      if (name === 'dshHomePath') return (sub) => join(home, sub)
      return provided.get(name)
    },
    inject(_dependencies, callback) { callback({ get: (name) => (name === 'tools' ? registryService : undefined) }) },
    provide(name, value) { provided.set(name, value) },
    effect(fn) { const dispose = fn(); return () => { void dispose } },
    on() { return () => {} },
    logger: { warn: () => {} },
  }
  const quiet = { log: console.log, error: console.error }
  let applied = null
  try {
    console.log = () => {}
    console.error = () => {}
    module.apply(ctx, {})
    applied = { ok: true }
  } catch (error) {
    applied = { ok: false, error: String(error && error.message ? error.message : error) }
  } finally {
    console.log = quiet.log
    console.error = quiet.error
  }
  return { home, dir, registry, collab: provided.get('linkCollab'), applied }
}

const rowsOf = (dir) => {
  const path = join(dir, 'control.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))
}
const bytesOf = (dir) => {
  const path = join(dir, 'control.jsonl')
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0)
  return { sha256: createHash('sha256').update(bytes).digest('hex'), length: bytes.length }
}
const factsOnly = (rows) => rows.map((row) => ({ seq: row.seq, kind: row.kind, at: row.at, actor: row.actor, subject: row.subject, payload: row.payload }))

const world = await buildWorld(join(root, 'home'))
console.log('world: apply() -> ' + (world.applied.ok ? 'ok' : show(world.applied.error)) + '; ledger ' + join(world.dir, 'control.jsonl'))
const log = world.collab.log
const state = () => world.collab.state()
const call = async (name, args) => {
  const definition = world.registry.get(name)
  if (definition === undefined) return { ok: false, error: name + ' is not in the registry (' + [...world.registry.keys()].join(', ') + ')', code: null }
  try { return { ok: true, value: await definition.execute(args) } } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error), code: error && error.code !== undefined ? String(error.code) : null, refusal: error instanceof module.MergeRefusal }
  }
}

// The seeded world: this ledger's writer leads team-A; team-B and team-D are declared as somebody
// else's teams, and the handshakes are already granted, because a merge needs one.
await log.append(module.teamRecord(TEAM_A, null, log.writer))
await log.append(module.teamRecord(TEAM_B, null, 'end-B'))
await log.append(module.teamRecord(TEAM_D, null, 'end-D'))
await log.append(module.peerRecord(TEAM_A, TEAM_B, 'merge talks', 'granted'))
await log.append(module.peerRecord(TEAM_A, TEAM_D, 'merge talks', 'granted'))
const seeded = rowsOf(world.dir)
console.log('teams: ' + show(state().teams.teams.map((team) => ({...team}))))

{
  const issues = []
  const names = world.collab?.tools?.names ?? []
  for (const name of [REQUEST_TOOL, ANSWER_TOOL]) if (names.includes(name) !== true) issues.push(name + ' is not in the shipped registry: ' + show(names))
  const before = rowsOf(world.dir).length
  const asked = await call(REQUEST_TOOL, { team: TEAM_B, mode: 'join' })
  const after = rowsOf(world.dir)
  if (asked.ok !== true) issues.push('a valid request was refused: ' + clip(asked.error))
  else {
    if (after.length !== before + 1) issues.push('the request gained ' + String(after.length - before) + ' rows; it must gain exactly one')
    const row = after[after.length - 1]
    if (row.kind !== MERGE) issues.push('the row is ' + show(row.kind) + ', not ' + MERGE)
    if (row.subject !== TEAM_A) issues.push('the subject is ' + show(row.subject) + '; the asking team is ' + TEAM_A)
    if (row.actor !== TEAM_A) issues.push('the actor is ' + show(row.actor) + '; the asking side caused it')
    for (const field of ['from', 'to', 'state', 'mode', 'by', 'at']) {
      if (show(row.payload?.[field]) !== show(asked.value[field])) issues.push('payload.' + field + ' ' + show(row.payload?.[field]) + ' vs answer ' + show(asked.value[field]))
    }
    if (asked.value.state !== 'requested') issues.push('the answer says state ' + show(asked.value.state))
    if (asked.value.mayMerge !== false || asked.value.mayExchange !== true) issues.push('a request reports ' + show({ mayMerge: asked.value.mayMerge, mayExchange: asked.value.mayExchange }) + '; a request is not permission')
    const tree = state().teams.teams.find((team) => team.id === TEAM_A)
    if (tree.parent !== null) issues.push('the request changed the tree: ' + TEAM_A + '\'s parent is ' + show(tree.parent))
  }
  add('M1-the-two-tools-ship-and-one-request-is-one-row', issues.length === 0,
    issues.length === 0
      ? REQUEST_TOOL + ' and ' + ANSWER_TOOL + ' are in the default registry; the request wrote one ' + MERGE + ' row ' + show(asked.value.seq) + ' and no tree row'
      : issues.join('; '),
    ['registry: ' + show(names)])
}

{
  const issues = []
  const before = rowsOf(world.dir)
  const granted = await call(ANSWER_TOOL, { from: TEAM_A, grant: true })
  const after = rowsOf(world.dir)
  if (granted.ok !== true) issues.push('a valid grant was refused: ' + clip(granted.error))
  else {
    const gained = after.slice(before.length)
    if (gained.length !== 2) issues.push('the grant gained ' + String(gained.length) + ' rows; an agreement writes exactly two (the tree, then the authorization)')
    else {
      const [treeRow, mergeRow] = gained
      if (treeRow.kind !== TEAM_KIND) issues.push('the first row is ' + show(treeRow.kind) + ', not the ' + TEAM_KIND + ' of the party being merged in')
      if (treeRow.payload?.team !== TEAM_A || treeRow.payload?.parent !== TEAM_B) issues.push('the tree row says ' + show(treeRow.payload) + '; ' + TEAM_A + ' is being merged into ' + TEAM_B)
      if (treeRow.payload?.lead !== log.writer) issues.push('the tree row dropped the lead it found: ' + show(treeRow.payload?.lead))
      if (mergeRow.kind !== MERGE || mergeRow.payload?.state !== 'granted') issues.push('the second row is ' + show(mergeRow.kind) + '/' + show(mergeRow.payload?.state))
      if (granted.value.seq !== mergeRow.seq) issues.push('the answer names sequence ' + show(granted.value.seq) + ' where the authorization row is ' + show(mergeRow.seq))
      if (granted.value.treeSeq !== treeRow.seq) issues.push('the answer names treeSeq ' + show(granted.value.treeSeq) + ' where the tree row is ' + show(treeRow.seq))
    }
    if (granted.value.mayMerge !== true) issues.push('after the grant mayMerge is ' + show(granted.value.mayMerge))
    const node = state().teams.teams.find((team) => team.id === TEAM_A)
    if (node.parent !== TEAM_B) issues.push('the fold does not read ' + TEAM_A + ' as a child of ' + TEAM_B + ': ' + show(node.parent))
    if (state().teams.children[TEAM_B]?.includes(TEAM_A) !== true) issues.push('the children table of ' + TEAM_B + ' does not hold ' + TEAM_A)
    if (state().teams.roots.includes(TEAM_A)) issues.push(TEAM_A + ' still reads as a root after the grant')
  }
  const mid = rowsOf(world.dir)
  const denied = await call(ANSWER_TOOL, { from: TEAM_A, grant: false })
  const afterDeny = rowsOf(world.dir)
  if (denied.ok !== true) issues.push('a valid denial was refused: ' + clip(denied.error))
  else {
    const gained = afterDeny.slice(mid.length)
    if (gained.length !== 1) issues.push('the denial gained ' + String(gained.length) + ' rows; a denial writes exactly one row')
    if (gained[0]?.kind !== MERGE || gained[0]?.payload?.state !== 'denied') issues.push('the denial row is ' + show(gained[0]?.kind) + '/' + show(gained[0]?.payload?.state))
    if (denied.value.mayMerge !== false) issues.push('after the denial mayMerge is still ' + show(denied.value.mayMerge))
    if (state().merges.pairs.find((pair) => pair.from === TEAM_A)?.state !== 'denied') issues.push('the fold does not read the pair as denied: ' + show(state().merges.pairs))
    if (state().merges.merges.length !== 3) issues.push('the history is ' + String(state().merges.merges.length) + ' rows; the history keeps every row, including the ones that lost')
  }
  add('M2-a-grant-is-two-rows-a-denial-is-one', issues.length === 0,
    issues.length === 0
      ? 'grant -> exactly 2 rows (' + TEAM_KIND + ' for ' + TEAM_A + ' with parent ' + TEAM_B + ', then ' + MERGE + ' granted); denial -> exactly 1 row; mayMerge true then false; history keeps all three rows'
      : issues.join('; '),
    ['pairs: ' + show(state().merges.pairs), 'children[' + TEAM_B + ']: ' + show(state().teams.children[TEAM_B])])
}

{
  const issues = []
  // A standing request whose merged-in party is NOT this ledger's team: the asker wants team-D in.
  const absorb = await call(REQUEST_TOOL, { team: TEAM_D, mode: 'absorb' })
  if (absorb.ok !== true) issues.push('the absorb request was refused: ' + clip(absorb.error))
  // A request against a DENIED pair is allowed (only a standing grant would be cleared), and the pair is
  // put back to granted so the refusal batch below has both a granted pair and a standing request.
  const again = await call(REQUEST_TOOL, { team: TEAM_B, mode: 'join' })
  if (again.ok !== true) issues.push('a request on a denied pair was refused: ' + clip(again.error))
  const regranted = await call(ANSWER_TOOL, { from: TEAM_A, team: TEAM_A, grant: true })
  if (regranted.ok !== true) issues.push('naming the party being merged in did not select the agreement to answer: ' + clip(regranted.error))
  else if (regranted.value.treeTeam !== TEAM_A) issues.push('the re-grant wrote a tree row for ' + show(regranted.value.treeTeam))
  const treeBefore = show(state().teams.teams)
  const before = bytesOf(world.dir)
  const cases = [
    [REQUEST_TOOL, null, 'MERGE_INPUT'],
    [REQUEST_TOOL, [TEAM_B], 'MERGE_INPUT'],
    [REQUEST_TOOL, {}, 'MERGE_TEAM_EMPTY'],
    [REQUEST_TOOL, { team: 7, mode: 'join' }, 'MERGE_TEAM_NAME'],
    [REQUEST_TOOL, { team: 'team-Z' }, 'MERGE_MODE'],
    [REQUEST_TOOL, { team: 'team-Z', mode: 'merge' }, 'MERGE_MODE'],
    [REQUEST_TOOL, { team: TEAM_A, mode: 'join' }, 'MERGE_SELF'],
    [REQUEST_TOOL, { team: TEAM_E, mode: 'join' }, 'MERGE_PEER_REQUIRED'],
    [REQUEST_TOOL, { team: TEAM_B, mode: 'join' }, 'MERGE_ALREADY_GRANTED'],
    [ANSWER_TOOL, null, 'MERGE_INPUT'],
    [ANSWER_TOOL, { grant: true }, 'MERGE_FROM_EMPTY'],
    [ANSWER_TOOL, { from: 7, grant: true }, 'MERGE_FROM_NAME'],
    [ANSWER_TOOL, { from: TEAM_A }, 'MERGE_GRANT'],
    [ANSWER_TOOL, { from: TEAM_A, grant: 'yes' }, 'MERGE_GRANT'],
    [ANSWER_TOOL, { from: 'team-Z', grant: true }, 'MERGE_REQUEST_NONE'],
    [ANSWER_TOOL, { from: TEAM_A, grant: true }, 'MERGE_REQUEST_AMBIGUOUS'],
    [ANSWER_TOOL, { from: TEAM_A, team: TEAM_D, grant: true }, 'MERGE_NOT_AUTHORIZED'],
    [ANSWER_TOOL, { from: TEAM_A, team: TEAM_D, grant: false }, 'MERGE_NOT_AUTHORIZED'],
  ]
  const seen = []
  for (const [tool, args, expected] of cases) {
    const result = await call(tool, args)
    if (result.ok !== false) { issues.push('a malformed call was accepted: ' + tool + ' ' + show(args)); seen.push(expected + '->accepted'); continue }
    if (result.code !== expected) issues.push(tool + ' ' + show(args) + ' refused with ' + show(result.code) + ' where ' + expected + ' was the rule: ' + clip(result.error))
    if (result.refusal !== true) issues.push('the refusal is not a MergeRefusal: ' + tool + ' ' + show(args))
    if (String(result.error).startsWith(expected + ':') !== true) issues.push('the code is not first in the message: ' + clip(result.error))
    seen.push(result.code)
  }
  const builderCases = [
    [{ from: TEAM_A, to: TEAM_A, mode: 'join', state: 'granted', by: 'local', at: NOW }, 'MERGE_SELF'],
    [{ from: TEAM_A, to: TEAM_D, mode: 'merge', state: 'granted', by: 'local', at: NOW }, 'MERGE_MODE'],
    [{ from: TEAM_A, to: TEAM_D, mode: 'join', state: 'yes', by: 'local', at: NOW }, 'MERGE_STATE'],
    [{ from: TEAM_A, to: TEAM_D, mode: 'join', state: 'granted', by: '', at: NOW }, 'MERGE_BY_EMPTY'],
    [{ from: TEAM_A, to: TEAM_D, mode: 'join', state: 'granted', by: 'local', at: 'now' }, 'MERGE_AT'],
  ]
  for (const [args, expected] of builderCases) {
    let code = null
    try { module.mergeRecord(args) } catch (error) { code = String(error.code) }
    if (code !== expected) issues.push('mergeRecord ' + show(args) + ' refused with ' + show(code) + ' where ' + expected + ' was the rule')
    seen.push(code)
  }
  const after = bytesOf(world.dir)
  if (after.sha256 !== before.sha256 || after.length !== before.length) issues.push('the ledger moved through the refusal batch: ' + show(before) + ' -> ' + show(after))
  if (show(state().teams.teams) !== treeBefore) issues.push('a refused merge changed the team tree: ' + show(state().teams.teams))
  add('M3-every-refusal-is-named-and-nothing-is-written', issues.length === 0,
    issues.length === 0
      ? String(cases.length) + ' tool refusals and ' + String(builderCases.length) + ' builder refusals, each with its own code; ledger sha256 ' + after.sha256.slice(0, 16) + ' and length ' + String(after.length) + ' identical, and the tree byte-identical'
      : issues.join('; '),
    ['codes: ' + seen.join(', ')])
}

{
  const issues = []
  // The party being merged in is team-D, and this ledger's writer leads team-A. A second real ledger
  // whose writer leads team-D is therefore the only place that agreement can be written.
  const dirB = join(root, 'writer-d')
  const logB = world.collab.open({ dir: dirB, writer: 'end-D' })
  const batch = {
    writer: log.writer,
    instance: log.instance,
    records: log.ownPage(0).map((row) => ({
      seq: row.originSeq,
      kind: row.kind,
      ...(row.actor === undefined ? {} : { actor: row.actor }),
      ...(row.subject === undefined ? {} : { subject: row.subject }),
      ...(row.payload === undefined ? {} : { payload: row.payload }),
      ...(row.at === undefined ? {} : { at: row.at }),
    })),
  }
  await logB.ingest(batch)
  const stateB = () => module.projectTeamState(logB.replay())
  if (stateB().teams.teams.find((team) => team.id === TEAM_D)?.lead !== 'end-D') issues.push('the second ledger does not read ' + TEAM_D + '\'s lead as its own writer')
  const answerToolB = module.mergeTools({ log: logB, now: () => NOW })[1]
  const treeBefore = stateB().teams.teams.map((team) => ({ id: team.id, parent: team.parent, lead: team.lead }))
  const beforeB = rowsOf(dirB).length
  // team names the party being merged in, which is the one fact that tells the two agreements from
  // team-A apart (the join with team-B and this absorb of team-D).
  const answered = await answerToolB.execute({ from: TEAM_A, team: TEAM_D, grant: true })
  const afterB = rowsOf(dirB)
  if (afterB.length !== beforeB + 2) issues.push('the absorbing side gained ' + String(afterB.length - beforeB) + ' rows; a grant writes exactly two')
  const gained = afterB.slice(afterB.length - 2)
  if (gained[0]?.kind !== TEAM_KIND) issues.push('the first row on the absorbing side is ' + show(gained[0]?.kind))
  if (gained[0]?.payload?.team !== TEAM_D || gained[0]?.payload?.parent !== TEAM_A) issues.push('the absorbing side wrote ' + show(gained[0]?.payload) + '; its OWN parent is what it may write')
  if (gained[0]?.actor !== 'end-D') issues.push('the actor on the tree row is ' + show(gained[0]?.actor) + ', not the writer that answered')
  if (gained[1]?.kind !== MERGE || gained[1]?.payload?.state !== 'granted' || gained[1]?.subject !== TEAM_A) issues.push('the authorization row is ' + show(gained[1]) + '; it must be a ' + MERGE + ' row about ' + TEAM_A)
  if (stateB().teams.teams.find((team) => team.id === TEAM_D)?.parent !== TEAM_A) issues.push('the absorbing ledger does not read ' + TEAM_D + ' as a child of ' + TEAM_A)
  // Measured as a diff of the whole tree: exactly one team's node moved, and it is the party being
  // merged in. Any other node moving would be the second writer of a tree this layer refuses to be.
  const treeAfter = stateB().teams.teams.map((team) => ({ id: team.id, parent: team.parent, lead: team.lead }))
  const moved = treeAfter.filter((team, at) => show(team) !== show(treeBefore[at]))
  if (moved.length !== 1 || moved[0].id !== TEAM_D) issues.push('the absorbing side moved ' + show(moved) + '; only the party being merged in may move')
  // The other half of the rule, measured on this ledger: an agreement about a pair whose asking team
  // is team-A (a join, whose party being merged in is team-A) cannot be answered by team-D's lead.
  const beforeCross = bytesOf(dirB)
  const cross = await answerToolB.execute({ from: TEAM_A, team: TEAM_A, grant: true }).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: String(error?.code), error: String(error?.message ?? error) }))
  if (cross.ok !== false || cross.code !== 'MERGE_NOT_AUTHORIZED') issues.push(TEAM_D + '\'s lead answered an agreement about ' + TEAM_A + ': ' + show(cross))
  const afterCross = bytesOf(dirB)
  if (afterCross.sha256 !== beforeCross.sha256 || afterCross.length !== beforeCross.length) issues.push('the refused cross answer wrote to the absorbing ledger: ' + show(beforeCross) + ' -> ' + show(afterCross))
  // The refusing side, measured: the asker's ledger still reads team-D as a root, and its own attempt
  // (already refused above) left nothing behind.
  if (state().teams.teams.find((team) => team.id === TEAM_D)?.parent !== null) issues.push('the asking ledger\'s fold of ' + TEAM_D + ' moved even though its attempt was refused')
  add('M4-only-the-party-being-merged-in-writes-its-own-parent', issues.length === 0,
    issues.length === 0
      ? 'the absorb was answered by a second ledger whose writer leads ' + TEAM_D + ': exactly 2 rows, the first being ' + TEAM_KIND + '{team:' + TEAM_D + ', parent:' + TEAM_A + '}; the asking ledger\'s tree for ' + TEAM_D + ' is untouched'
      : issues.join('; '),
    ['absorbing ledger rows: ' + show(gained)])
}

{
  const issues = []
  // The rows as the LEDGER holds them, so renumbering them renumbers the records themselves.
  const rows = rowsOf(world.dir).filter((row) => row.kind === MERGE && row.payload?.from === TEAM_A && row.payload?.to === TEAM_B)
  if (rows.length < 3) issues.push('the pair holds ' + String(rows.length) + ' rows; this reading needs the request, the grant and the denial')
  else {
    const renumber = (pick) => rows.map((row) => ({ ...row, seq: pick(row.payload.state) }))
    const foldedDenialFirst = module.projectMerges(renumber((state) => (state === 'denied' ? 1 : state === 'granted' ? 3 : 2)))
    const foldedGrantedFirst = module.projectMerges(renumber((state) => (state === 'granted' ? 3 : state === 'denied' ? 2 : 1)))
    const bothDenied = module.projectMerges(renumber((state) => (state === 'denied' ? 3 : state === 'granted' ? 1 : 2)))
    const winnerOf = (folded) => folded.pairs.find((pair) => pair.from === TEAM_A && pair.to === TEAM_B)?.state
    if (winnerOf(foldedDenialFirst) !== 'granted') issues.push('with the denial holding the SMALLEST sequence the pair reads ' + show(winnerOf(foldedDenialFirst)) + '; the highest sequence must win')
    if (winnerOf(foldedGrantedFirst) !== 'granted') issues.push('with the grant holding the largest sequence the pair reads ' + show(winnerOf(foldedGrantedFirst)))
    if (winnerOf(bothDenied) !== 'denied') issues.push('a denial with the largest sequence does not win: ' + show(winnerOf(bothDenied)))
    // The word does not decide, the sequence does: the same rows renumbered answer both ways.
    const seqs = foldedDenialFirst.merges.map((row) => row.seq)
    if (seqs.some((seq, at) => at > 0 && seq < seqs[at - 1])) issues.push('the history is not in sequence order: ' + show(seqs))
  }
  add('M5-the-sequence-decides-not-the-word', issues.length === 0,
    issues.length === 0
      ? 'the same pair renumbered: denial at seq 1 -> granted wins (the grant holds seq 3); denial at seq 3 -> denied wins; the history is ordered by sequence'
      : issues.join('; '))
}

{
  const issues = []
  const current = factsOnly(rowsOf(world.dir))
  const withHandshake = module.projectTeamState(current)
  if (module.mayExchange(withHandshake, TEAM_A, TEAM_B) !== true) issues.push('the seeded handshake does not read as granted')
  if (module.mayMerge(withHandshake, TEAM_A, TEAM_B) !== true) issues.push('a granted pair with a handshake does not allow a merge: ' + show(module.mayMerge(withHandshake, TEAM_A, TEAM_B)))
  const withoutHandshake = current.filter((row) => !(row.kind === 'peer/state' && row.payload?.from === TEAM_A && row.payload?.to === TEAM_B))
  const folded = module.projectTeamState(withoutHandshake)
  const pair = folded.merges.pairs.find((entry) => entry.from === TEAM_A && entry.to === TEAM_B)
  if (pair === undefined || pair.state !== 'granted') issues.push('the granted merge row must survive the handshake row being dropped: ' + show(pair))
  if (module.mayExchange(folded, TEAM_A, TEAM_B) !== false) issues.push('the handshake survives its own row being dropped')
  if (module.mayMerge(folded, TEAM_A, TEAM_B) !== false) issues.push('mayMerge answers true with no handshake: the two facts must both hold')
  if (module.mayMerge(module.projectTeamState(current), TEAM_D, TEAM_A) !== false) issues.push('mayMerge is not ordered: the reverse pair answers true')
  add('M6-a-merge-needs-both-the-handshake-and-the-grant', issues.length === 0,
    issues.length === 0
      ? 'handshake without grant -> mayMerge false; grant without handshake -> mayExchange false and mayMerge false; both -> true'
      : issues.join('; '))
}

if (KEEP !== true) rmSync(root, { recursive: true, force: true })
const failed = readings.filter((reading) => reading.ok !== true)
console.log(String(readings.length) + ' readings, ' + String(failed.length) + ' failed' + (failed.length === 0 ? '' : ' (' + failed.map((reading) => reading.id).join(', ') + ')'))
process.exit(failed.length === 0 ? 0 : 1)
