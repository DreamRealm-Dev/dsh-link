#!/usr/bin/env node
/**
 * Gate 138 plugin-message-sources (R199): no installed plugin writes a session message with a
 * retired source shape. Offline. The profile is machine state; the fixture proves the scan can fail.
 *
 * R73 alive-control: present - the child this gate spawns is its own SELF with a synthetic fixture profile
 * (--profile <tmp>), not a kernel, so this file's class is the launcher: it mounts no row of its own and cannot
 * read a root service. Its witness is therefore the launcher pair, and both halves are values below - the child's
 * exit code (1 = the planted offenders were found) and the row it printed for the profile it was handed
 * (`examined 3 plugin package`), which the parent re-reads and the fixture checks read in turn. That pair is
 * `aliveVerdict`. The detection pattern that finds this file looks for a spawn carrying --profile; it cannot
 * tell a kernel launch from a fixture run, and the answer to that is to carry the witness, not to hide the flag.
 *
 * WHAT CRASHED, MEASURED ON THIS MACHINE
 *
 * A live task died before it delivered anything, with
 *
 *     Error: format v4 message requires a producer-owned source kind
 *
 * The producer was the third-party bundle @argszero/cordis-plugin-thinking-loop-guard@0.1.9, which
 * wrote NEW session messages with the RETIRED v3 source shape (its lib/index.js:163):
 *
 *     const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'thinking-loop-guard' };
 *
 * Session format v4 refuses that shape at ADMISSION, not at conversion, and the refusal is thrown
 * inside the turn, so the whole turn dies before it delivers. The shipped
 * dsh-session-format-v3-to-v4 bundle, module lib/types/message-sources.js, function source():
 *
 *     function source(message) {
 *         const value = message["source"];
 *         if (!isSessionFormatJsonObject(value) || typeof value["kind"] !== "string"
 *             || value["kind"].length === 0 || value["kind"] === "plugin")
 *             throw new SessionFormatError("format v4 message requires a producer-owned source kind");
 *     }
 *
 * Three fatal shapes are visible there and this gate grades all three (a fourth, "source is not an
 * object at all", cannot be produced by an object literal):
 *
 *     kind === 'plugin'      the retired v3 wrapper, the defect that killed the turn
 *     kind missing           a message source object with no kind key
 *     kind empty/not text    "", null, or a non-string
 *     source missing         a message-constructing call that supplies no source
 *
 * The converter is more forgiving than admission (same bundle, producerKind() 87-93), and that
 * asymmetry is the trap: replaying an OLD log rewrites { kind: 'plugin', plugin: 'X' } into the
 * producer-owned kind 'plugin:X'. A plugin writing NEW messages must use 'plugin:X' directly. The
 * guard was patched here to { kind: 'plugin:thinking-loop-guard' } and this gate keeps it that way.
 *
 * WHAT THE GATE JUDGES
 *
 *  (a) Every plugin package INSTALLED IN THE LIVE PROFILE is scanned for the retired shape. The
 *      roster is "the dsh-* packages plus every @scope/* package that declares a dsh or cordis
 *      plugin marker", because the name pattern alone would have MISSED the package that killed the
 *      turn: @argszero/cordis-plugin-thinking-loop-guard is neither dsh-* nor @scope/dsh-*. One
 *      line per package: clean, or offender with file:line.
 *  (b) Our own packages must be clean, and the scan must NAME the ones it actually opened. A clean
 *      verdict over a file it never opened is worthless, so every line carries the file count and
 *      the site count, and a package with a declared main and no readable JS is UNREADABLE (red),
 *      never clean.
 *  (c) A FIXTURE built under .tmp proves the scan can fail: three synthetic packages, two offenders
 *      (the retired wrapper reached through a spread, and an empty source reached through an
 *      aliased constructor) and one clean lookalike whose comment names the retired shape as prose.
 *      The gate spawns ITSELF against that profile and requires its own scan to name both offenders
 *      and to leave the lookalike clean. A scanner that only ever says "clean" does not pass.
 *  (d) The roster comes from the profile on disk, not from this repo's intent: the gate prints the
 *      profile path it read, the packages it examined, and, separately, the repo plugins that are
 *      NOT installed, so a reader can see the roster was not our wish list.
 *
 * THREE JUDGEMENTS THAT KEEP THIS GATE FROM LYING IN EITHER DIRECTION
 *
 *  Prose is not code. The PATCHED guard still contains the retired shape in the comment that
 *  explains the patch ("kind === 'plugin'"). A naive grep reports the fix as the defect. So the
 *  scan masks comments while preserving offsets (line numbers stay the ones an editor shows) and
 *  prints the prose it excluded, with the raw text.
 *
 *  A provider request body is not a session message. dsh-opencode-go builds
 *  { role, content, timestamp } rows for its own HTTP request array (lib/index.js:439); they carry
 *  no source because they are not session messages. Grading them would be a false red measured on
 *  this very machine. So a site exists only where the code constructs a message (createMessage,
 *  createUserMessage, createDeveloperMessage, createAssistantMessage, createToolResultMessage,
 *  createSystemMessage, aliased imports included) and the judgement comes from that call's source.
 *
 *  Which constructors need a source is a fact about the installed API, not a guess. createMessage,
 *  createUserMessage and createDeveloperMessage spread their input and add only a role, with no
 *  source default, so omitting source is fatal. createAssistantMessage merges into
 *  source.kind = "model", createToolResultMessage builds source.kind = "tool", and
 *  createSystemMessage takes a string: for those an omitted source is legal and is reported as such
 *  instead of being called a defect.
 *
 * KNOWN LIMIT, STATED RATHER THAN HIDDEN: a plugin could hand a retired source to a write API this
 * gate does not model (an event append, say). The gate counts those source keys and prints them as
 * "not graded", so the size of that blind spot is on screen on every run.
 *
 * OFFLINE: no port is opened (31761, 31760 and 9222 are never touched), no CDP, no kernel, no model
 * round, no client start or stop, no git. The scan reads files and nothing else, and the output
 * carries no timestamps, so two runs on one machine print the same bytes.
 *
 * EXIT CODES
 *   0  every installed plugin package is clean, our own were opened, and the fixture proved failability
 *   1  an offender, an unreadable package, a site the scan could not decide, none of our packages
 *      installed, or a fixture that failed to prove failability
 *   3  the profile is missing or unusable, machine state outside this repo, never a green
 *
 * Usage: node scripts/verify-plugin-message-sources.mjs [--profile <dir>] [--json]
 *        [--no-fixture] [--keep-fixture] [--fixture-profile]
 * (--check-fixture is accepted because scripts/verify-all.mjs passes it; the fixture runs by default.)
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_PLUGINS = join(PROJECT, 'plugins')
const SELF = fileURLToPath(import.meta.url)
const JSON_OUT = process.argv.includes('--json')
const WITH_FIXTURE = !process.argv.includes('--no-fixture')
const KEEP_FIXTURE = process.argv.includes('--keep-fixture')
const FIXTURE_PROFILE = process.argv.includes('--fixture-profile')
const FIXTURE_ROOT = join(PROJECT, '.tmp', 'plugin-message-sources-fixture')
const LITERAL_PROFILE = 'C:/Users/<user>/AppData/Roaming/dev.dshlink.client/dsh-link/kernel-home/profiles/web'
/* ------------------------------------------------------------------------- output */

const lines = []
const readings = []
let current = null

function say(text) { lines.push(text) }
function reading(title) {
  const record = { n: readings.length + 1, title, evidence: [] }
  readings.push(record)
  current = record
  say('')
  say('reading ' + String(record.n) + '  ' + title)
  return record
}
function ev(text) {
  say('           ' + text)
  if (current !== null) current.evidence.push(text)
}
function pad(text, width) {
  const s = String(text)
  return s.length >= width ? s + ' ' : s + ' '.repeat(width - s.length)
}
function clip(text, width) {
  const s = String(text)
  return s.length > width ? s.slice(0, width - 3) + '...' : s
}

/* ------------------------------------------------------- comment-aware source view */

// The scan has to tell a retired kind in CODE from the same words in the comment that explains the
// patch. Comments are blanked to spaces (newlines kept) so every offset, and every line number,
// is the one a reader sees in an editor. Strings stay intact on purpose: the retired kind IS a
// string literal.

function regexMayStart(tail) {
  if (tail.length === 0) return true
  if (/[({[,;:=!&|?+\-*%<>~^]$/.test(tail)) return true
  return /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(tail)
}

function skipQuoted(text, at) {
  const quote = text[at]
  let i = at + 1
  while (i < text.length) {
    const c = text[i]
    if (c === '\\') { i += 2; continue }
    if (c === quote) return i + 1
    if (c === '\n' && quote !== '\u0060') return i
    i += 1
  }
  return i
}

function maskComments(text) {
  const parts = []
  const prose = []
  let i = 0
  let codeStart = 0
  let line = 1
  let tail = ''
  const flush = (end) => { if (end > codeStart) parts.push(text.slice(codeStart, end)) }
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      flush(i)
      let j = i + 2
      while (j < text.length && text[j] !== '\n') j += 1
      const body = text.slice(i, j)
      prose.push({ line, text: body })
      parts.push(body.replace(/[^\n]/g, ' '))
      i = j
      codeStart = i
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      flush(i)
      let j = i + 2
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j += 1
      const end = Math.min(text.length, j + 2)
      const body = text.slice(i, end)
      prose.push({ line, text: body })
      parts.push(body.replace(/[^\n]/g, ' '))
      for (let k = 0; k < body.length; k += 1) if (body[k] === '\n') line += 1
      i = end
      codeStart = i
      continue
    }
    if (c === '"' || c === "'" || c === '\u0060') {
      const end = skipQuoted(text, i)
      for (let k = i; k < end; k += 1) if (text[k] === '\n') line += 1
      tail = ''
      i = end
      continue
    }
    if (c === '/' && regexMayStart(tail)) {
      let j = i + 1
      let inClass = false
      while (j < text.length) {
        const d = text[j]
        if (d === '\\') { j += 2; continue }
        if (d === '\n') break
        if (inClass) { if (d === ']') inClass = false } else if (d === '[') inClass = true
        else if (d === '/') { j += 1; break }
        j += 1
      }
      i = j
      continue
    }
    if (c === '\n') line += 1
    if (c !== ' ' && c !== '\t' && c !== '\r') tail = (tail + c).slice(-24)
    i += 1
  }
  flush(text.length)
  return { code: parts.join(''), prose }
}

function lineStartsOf(code) {
  const starts = [0]
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') starts.push(i + 1)
  return starts
}

function lineAt(starts, offset) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

function lineTextAt(code, starts, offset) {
  const n = lineAt(starts, offset)
  const from = starts[n - 1]
  let to = code.indexOf('\n', from)
  if (to === -1) to = code.length
  return code.slice(from, to).trim()
}
/* ------------------------------------------------------------- object literal reading */

function readBraced(code, at) {
  let depth = 0
  let i = at
  while (i < code.length) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '\u0060') { i = skipQuoted(code, i); continue }
    if (c === '{' || c === '[' || c === '(') { depth += 1; i += 1; continue }
    if (c === '}' || c === ']' || c === ')') {
      depth -= 1
      i += 1
      if (depth === 0) return { ok: true, bodyStart: at + 1, body: code.slice(at + 1, i - 1) }
      continue
    }
    i += 1
  }
  return { ok: false, bodyStart: at + 1, body: code.slice(at + 1) }
}

function entryBoundary(body, from) {
  let depth = 0
  let i = from
  while (i < body.length) {
    const c = body[i]
    if (c === '"' || c === "'" || c === '\u0060') { i = skipQuoted(body, i); continue }
    if (c === '(' || c === '[' || c === '{') { depth += 1; i += 1; continue }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; i += 1; continue }
    if (c === ',' && depth === 0) return i
    i += 1
  }
  return body.length
}

function topLevelColon(segment) {
  let depth = 0
  let i = 0
  while (i < segment.length) {
    const c = segment[i]
    if (c === '"' || c === "'" || c === '\u0060') { i = skipQuoted(segment, i); continue }
    if (c === '(' || c === '[' || c === '{') { depth += 1; i += 1; continue }
    if (c === ')' || c === ']' || c === '}') { depth -= 1; i += 1; continue }
    if (c === ':' && depth === 0) return i
    i += 1
  }
  return -1
}

function objectEntries(lit) {
  const list = []
  const body = lit.body
  let i = 0
  while (i < body.length) {
    while (i < body.length && (body[i] === ' ' || body[i] === '\t' || body[i] === '\r' || body[i] === '\n' || body[i] === ',')) i += 1
    if (i >= body.length) break
    const stop = entryBoundary(body, i)
    const segment = body.slice(i, stop).trim()
    const at = i
    i = stop + 1
    if (segment.length === 0) continue
    if (segment.startsWith('...')) { list.push({ spread: segment.slice(3).trim(), at }); continue }
    const colon = topLevelColon(segment)
    if (colon === -1) { list.push({ key: null, shorthand: segment, at }); continue }
    list.push({ key: segment.slice(0, colon).trim(), value: segment.slice(colon + 1).trim(), at })
  }
  return list
}

function bareKey(key) {
  if (typeof key !== 'string') return null
  const t = key.trim()
  if (t.length >= 2 && ((t[0] === "'" && t[t.length - 1] === "'") || (t[0] === '"' && t[t.length - 1] === '"'))) return t.slice(1, -1)
  return t
}

function stringLiteral(value) {
  const text = value.trim()
  const m = /^(['"])([\s\S]*)\1$/.exec(text)
  if (m === null) return null
  if (m[2].indexOf(m[1]) !== -1) return null
  return m[2]
}

// A bare identifier, resolved inside the file it appears in: the guard carried its retired source in
// a module constant and spread it into the message, so a scanner that only looked at the source
// object would have missed the defect it was written for.
function findConst(code, name) {
  const safe = name.replace(/[^A-Za-z0-9_$]/g, (ch) => '\\' + ch)
  const re = new RegExp('(?:const|let|var)\\s+' + safe + '\\s*=\\s*', 'g')
  let m = null
  while ((m = re.exec(code)) !== null) {
    const at = m.index + m[0].length
    const c = code[at]
    if (c === '{') {
      const lit = readBraced(code, at)
      return lit.ok ? { kind: 'object', lit } : { kind: 'unknown' }
    }
    if (c === '"' || c === "'" || c === '\u0060') {
      const literal = stringLiteral(code.slice(at, skipQuoted(code, at)))
      return literal === null ? { kind: 'unknown' } : { kind: 'string', value: literal }
    }
    return { kind: 'unknown' }
  }
  return { kind: 'none' }
}

/* ------------------------------------------------------------------- source judgement */

const RETIRED_KIND = 'plugin'

function judgeKindValue(value) {
  if (value === RETIRED_KIND) {
    return { verdict: 'offender', kind: value, reason: 'the source kind is the retired v3 wrapper "plugin"' }
  }
  if (value.length === 0) return { verdict: 'offender', kind: value, reason: 'the source kind is an empty string' }
  if (/^\s|\s$/.test(value)) return { verdict: 'offender', kind: value, reason: 'the source kind is blank padding: "' + value + '"' }
  return { verdict: 'clean', kind: value, reason: 'source kind "' + value + '" is producer-owned' }
}

function judgeSourceObject(code, lit, seen, depth) {
  const list = objectEntries(lit)
  const kindEntry = list.find((e) => e.spread === undefined && bareKey(e.key) === 'kind')
  const spreads = list.filter((e) => e.spread !== undefined)
  if (kindEntry !== undefined && spreads.some((s) => s.at > kindEntry.at)) {
    return { verdict: 'unjudged', reason: 'a spread after the kind key may replace it (' + spreads.map((s) => '...' + s.spread).join(', ') + ')' }
  }
  if (kindEntry !== undefined) {
    const literal = stringLiteral(kindEntry.value)
    if (literal !== null) return judgeKindValue(literal)
    const token = kindEntry.value.trim()
    if (/^(null|undefined|NaN)$/.test(token)) return { verdict: 'offender', reason: 'the source kind is ' + token + '; admission requires a non-empty string' }
    if (/^(true|false|[-0-9])/.test(token) || /^[[{]/.test(token)) return { verdict: 'offender', reason: 'the source kind is not a string: ' + clip(token, 48) }
    if (/^[A-Za-z_$][\w$]*$/.test(token)) {
      if (depth >= 3) return { verdict: 'unjudged', reason: 'the source kind is ' + token + ' and the chain of constants is deeper than three' }
      const found = findConst(code, token)
      if (found.kind === 'string') return judgeKindValue(found.value)
      if (found.kind === 'object') return { verdict: 'unjudged', reason: 'the source kind is the object ' + token + '; this file never makes it a string' }
      return { verdict: 'unjudged', reason: 'the source kind is ' + token + ', which this file does not define as a literal' }
    }
    return { verdict: 'unjudged', reason: 'the source kind is the expression ' + clip(token, 48) }
  }
  if (spreads.length > 0) {
    const deferred = []
    for (const spread of spreads) {
      const name = spread.spread
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) { deferred.push('...' + clip(name, 32)); continue }
      if (seen.has(name)) { deferred.push('...' + name); continue }
      const found = findConst(code, name)
      if (found.kind !== 'object') { deferred.push('...' + name); continue }
      seen.add(name)
      const nested = judgeSourceObject(code, found.lit, seen, depth + 1)
      if (nested.verdict === 'offender') return { verdict: 'offender', kind: nested.kind, reason: nested.reason + ' (carried by ...' + name + ')' }
      if (nested.verdict === 'clean') return { verdict: 'clean', kind: nested.kind, reason: 'source kind "' + nested.kind + '" arrives through ...' + name }
      deferred.push('...' + name)
    }
    return { verdict: 'unjudged', reason: 'the source object spreads ' + deferred.join(', ') + ' and no kind is resolvable in this file' }
  }
  return { verdict: 'offender', reason: 'the source object literal declares no kind at all' }
}

function judgeSourceValue(code, token, seen) {
  const text = token.trim()
  const literal = stringLiteral(text)
  if (literal !== null) return judgeKindValue(literal)
  if (text.startsWith('{')) {
    const lit = readBraced(text, 0)
    return judgeSourceObject(code, lit, seen, 0)
  }
  if (/^(null|undefined)$/.test(text)) return { verdict: 'offender', reason: 'the source is ' + text + '; admission requires an object with a producer-owned kind' }
  if (/^(true|false|[-0-9])/.test(text) || /^[[(]/.test(text)) return { verdict: 'offender', reason: 'the source is not an object: ' + clip(text, 48) }
  if (/^[A-Za-z_$][\w$]*$/.test(text)) {
    const found = findConst(code, text)
    if (found.kind === 'object') return judgeSourceObject(code, found.lit, seen, 0)
    if (found.kind === 'string') return judgeKindValue(found.value)
    return { verdict: 'unjudged', reason: 'the source is ' + text + ', which this file does not define as an object literal' }
  }
  return { verdict: 'unjudged', reason: 'the source is the expression ' + clip(text, 48) }
}
/* ----------------------------------------------------------- per-file message-source scan */

// Which constructors require a source is a fact about the installed API (@deepseek-ai/dsh-llm):
//   createMessage / createUserMessage / createDeveloperMessage  spread the input, add a role, and
//       set no source default, so a call without source is fatal at admission;
//   createAssistantMessage  merges into source.kind = "model";
//   createToolResultMessage  builds source.kind = "tool" (and takes callId, not a source);
//   createSystemMessage  takes a string and builds its own source.
const MESSAGE_CTORS = new Map([
  ['createMessage', 'required'],
  ['createUserMessage', 'required'],
  ['createDeveloperMessage', 'required'],
  ['createAssistantMessage', 'defaulted'],
  ['createToolResultMessage', 'own'],
  ['createSystemMessage', 'own'],
])

function constructorNames(code) {
  const names = new Set(MESSAGE_CTORS.keys())
  const aliases = new Map()
  const re = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*['"]/g
  for (const m of code.matchAll(re)) {
    for (const piece of m[1].split(',')) {
      const bits = piece.trim().split(/\s+as\s+/)
      const canonical = bits[0].trim()
      if (!MESSAGE_CTORS.has(canonical)) continue
      const local = bits.length === 2 ? bits[1].trim() : canonical
      names.add(local)
      if (local !== canonical) aliases.set(local, canonical)
    }
  }
  return { names: [...names].sort((a, b) => b.length - a.length), aliases }
}

const RETIRED_KIND_IN_CODE = /(?:\bkind|['"]kind['"])\s*:\s*(['"])plugin\1/g
const SOURCE_KEY = /(?:\bsource|['"]source['"])\s*:/g
const PROSE_MENTIONS_RETIRED = /kind\s*:\s*['"]plugin['"]|kind\s*===?\s*['"]plugin['"]/

function scanFile(rel, code, prose, starts) {
  const sites = []
  const findings = []
  const judgedOffsets = new Set()
  const { names, aliases } = constructorNames(code)

  // A session-message source exists only where the code constructs a message.
  const ctorRe = new RegExp('\\b(' + names.join('|') + ')\\s*\\(', 'g')
  for (const m of code.matchAll(ctorRe)) {
    const canonical = aliases.get(m[1]) ?? m[1]
    const role = MESSAGE_CTORS.get(canonical)
    if (role === 'own') continue
    const line = lineAt(starts, m.index)
    let at = m.index + m[0].length
    while (at < code.length && /\s/.test(code[at])) at += 1
    if (code[at] !== '{') {
      sites.push({ file: rel, line, ctor: canonical, verdict: 'unjudged', reason: 'the argument is not an object literal, so its source cannot be read here' })
      continue
    }
    const lit = readBraced(code, at)
    const list = objectEntries(lit)
    const sourceEntry = list.find((e) => e.spread === undefined && bareKey(e.key) === 'source')
    if (sourceEntry === undefined) {
      const spreads = list.filter((e) => e.spread !== undefined).map((e) => '...' + e.spread)
      if (role === 'required') {
        if (spreads.length > 0) {
          sites.push({ file: rel, line, ctor: canonical, verdict: 'unjudged', reason: 'the argument spreads ' + spreads.join(', ') + ' and declares no source key' })
        } else {
          sites.push({ file: rel, line, ctor: canonical, verdict: 'offender', reason: 'constructs a message with no source; admission requires a producer-owned source kind' })
        }
      } else {
        sites.push({ file: rel, line, ctor: canonical, verdict: 'clean', reason: canonical + ' fills source.kind itself; an omitted source is legal' })
      }
      continue
    }
    judgedOffsets.add(lit.bodyStart + sourceEntry.at)
    const judged = judgeSourceValue(code, sourceEntry.value, new Set([canonical]))
    sites.push({ file: rel, line, ctor: canonical, verdict: judged.verdict, reason: judged.reason })
    if (judged.verdict === 'offender') {
      findings.push({ file: rel, line, detector: 'B', verdict: 'offender', reason: judged.reason, raw: lineTextAt(code, starts, m.index) })
    }
  }

  // The retired kind anywhere in code: outside a judged source it is still the same literal, and a
  // plugin can reach a write API this gate does not model.
  for (const m of code.matchAll(RETIRED_KIND_IN_CODE)) {
    if (judgedOffsets.has(m.index)) continue
    const line = lineAt(starts, m.index)
    const raw = lineTextAt(code, starts, m.index)
    const sibling = /\bplugin\s*:/.test(raw)
    findings.push({
      file: rel, line, detector: 'A', verdict: 'offender',
      reason: sibling
        ? 'the retired v3 wrapper shape: kind "plugin" beside a plugin key, in shipped code'
        : 'the retired kind "plugin" in shipped code (fatal if it reaches a message source)',
      raw,
    })
  }

  // Every source key outside a judged construct is counted, so the blind spot has a size.
  const sourceOutside = []
  for (const m of code.matchAll(SOURCE_KEY)) {
    if (judgedOffsets.has(m.index)) continue
    let back = m.index - 1
    while (back >= 0 && /\s/.test(code[back])) back -= 1
    const before = back < 0 ? '' : code[back]
    if (before !== '' && before !== '{' && before !== ',' && before !== '(' && before !== ';') continue
    sourceOutside.push({ line: lineAt(starts, m.index), raw: clip(lineTextAt(code, starts, m.index), 96) })
  }

  // One location, one line: a retired literal inside a source that was already judged must not
  // print twice. The judged finding carries the more precise reason, so A yields to it.
  const judgedPlaces = new Set(findings.filter((f) => f.detector === 'B').map((f) => f.file + ':' + String(f.line)))
  const deduped = findings.filter((f) => f.detector !== 'A' || judgedPlaces.has(f.file + ':' + String(f.line)) === false)

  return {
    sites,
    findings: deduped,
    sourceOutside,
    prose: prose.filter((p) => PROSE_MENTIONS_RETIRED.test(p.text)),
  }
}
/* ------------------------------------------------------------------- package discovery */

const SKIP_DIRS = new Set(['node_modules', '.git', '.bin', 'test', 'tests', '__tests__', '__mocks__', 'coverage', '.nyc_output', 'fixtures'])
// node_modules entries that are storage rather than packages: the pnpm store, the bin shims, dot-files.
const NOT_A_PACKAGE = /^[.]/
const HISTORY_FILE = /\.(js|mjs|cjs|ts)\.(bak|orig|old|prev|rej)(-|$)|\.(bak|orig|old|prev)$/

function readJson(file) {
  try { return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) } } catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) } }
}

// A directory OR a junction to one: the link: dependencies of this profile are symlinks, and a scan
// that skipped them would have judged exactly the packages this repository ships least and called
// the silence clean.
function isDirectory(full, entry) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try { return statSync(full).isDirectory() } catch (error) { return false }
}

function isInside(child, parent) {
  const a = process.platform === 'win32' ? child.toLowerCase() : child
  const b = process.platform === 'win32' ? parent.toLowerCase() : parent
  return a === b || a.startsWith(b + sep)
}

function collectFiles(root, unread) {
  const code = []
  const history = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch (error) { unread.push(relative(root, dir) + ': ' + String(error && error.message)); return }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (isDirectory(full, entry)) { if (!SKIP_DIRS.has(entry.name)) walk(full); continue }
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) { try { isFile = statSync(full).isFile() } catch (error) { isFile = false } }
      if (!isFile) continue
      if (/\.(js|mjs|cjs)$/.test(entry.name)) code.push(full)
      else if (HISTORY_FILE.test(entry.name)) history.push(full)
    }
  }
  walk(root)
  return { code, history }
}

// A package is a plugin when the package itself says so. The name pattern alone would have missed
// @argszero/cordis-plugin-thinking-loop-guard, the package that killed the turn.
function pluginMarker(name, json) {
  const hasDshField = json !== null && json !== undefined && json.dsh !== undefined && json.dsh !== null
  const peers = json !== null && typeof json.peerDependencies === 'object' && json.peerDependencies !== null ? Object.keys(json.peerDependencies) : []
  const cordisPeer = peers.some((key) => key.indexOf('cordis') !== -1)
  const nameRule = /^dsh-/.test(name) || /^@[^/]+\/dsh-/.test(name) || /(?:^|\/)(?:cordis-)?plugin-/.test(name)
  const reasons = []
  if (hasDshField) reasons.push('declares a dsh field')
  if (cordisPeer) reasons.push('declares a cordis peerDependency')
  if (nameRule) reasons.push('name follows the dsh-/plugin pattern')
  return reasons
}

function discover(nodeModules) {
  const entries = readdirSync(nodeModules, { withFileTypes: true })
  const candidates = []
  let scoped = 0
  let topLevel = 0
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = join(nodeModules, entry.name)
    if (!isDirectory(full, entry)) continue
    if (NOT_A_PACKAGE.test(entry.name)) continue
    if (entry.name.startsWith('@')) {
      let inner = []
      try { inner = readdirSync(full, { withFileTypes: true }) } catch (error) { continue }
      for (const child of inner.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const childFull = join(full, child.name)
        if (!isDirectory(childFull, child)) continue
        scoped += 1
        candidates.push({ name: entry.name + '/' + child.name, dir: childFull })
      }
      continue
    }
    topLevel += 1
    candidates.push({ name: entry.name, dir: full })
  }

  const plugins = []
  const libraries = []
  for (const candidate of candidates) {
    const pkgJsonPath = join(candidate.dir, 'package.json')
    const file = existsSync(pkgJsonPath) ? readJson(pkgJsonPath) : { ok: false, error: 'no package.json' }
    const json = file.ok ? file.value : null
    const reasons = pluginMarker(candidate.name, json)
    const record = {
      name: candidate.name,
      dir: candidate.dir,
      json,
      jsonError: file.ok ? null : file.error,
      declaredMain: json !== null && (typeof json.main === 'string' || typeof json.exports === 'object'),
      markers: reasons,
      ours: false,
      real: null,
      realError: null,
    }
    try { record.real = realpathSync(candidate.dir) } catch (error) { record.realError = String(error && error.message) }
    try { record.link = lstatSync(candidate.dir).isSymbolicLink() } catch (error) { record.link = false }
    record.ours = record.real !== null && isInside(record.real, REPO_PLUGINS)
    if (reasons.length > 0) plugins.push(record)
    else libraries.push(record)
  }
  return { plugins, libraries, topLevel, scoped }
}

/* ---------------------------------------------------------------------- package analysis */

function analyse(pkg) {
  const record = {
    name: pkg.name,
    dir: pkg.dir,
    real: pkg.real,
    realError: pkg.realError,
    ours: pkg.ours,
    link: pkg.link === true,
    markers: pkg.markers,
    declaredMain: pkg.declaredMain,
    files: [],
    history: [],
    sites: [],
    findings: [],
    prose: [],
    unread: [],
    sourceOutside: [],
    bytes: 0,
    verdict: 'clean',
  }
  const collected = collectFiles(pkg.dir, record.unread)
  for (const file of collected.code) {
    const rel = relative(pkg.dir, file)
    let text = null
    try { text = readFileSync(file, 'utf8') } catch (error) { record.unread.push(rel + ': ' + String(error && error.message)); continue }
    record.bytes += text.length
    let masked = null
    try { masked = maskComments(text) } catch (error) { record.unread.push(rel + ' (comment mask failed): ' + String(error && error.message)); continue }
    const starts = lineStartsOf(masked.code)
    const scanned = scanFile(rel, masked.code, masked.prose, starts)
    record.files.push(rel)
    record.sites.push(...scanned.sites)
    record.findings.push(...scanned.findings)
    record.prose.push(...scanned.prose.map((p) => ({ file: rel, line: p.line, text: p.text })))
    record.sourceOutside.push(...scanned.sourceOutside.map((s) => ({ file: rel, line: s.line, raw: s.raw })))
  }
  // A file that shipped beside the loaded one (a .bak, say) is not graded, but the detector is run
  // over it: it is the only place on this machine where the real pre-patch code still exists.
  for (const file of collected.history) {
    const rel = relative(pkg.dir, file)
    let text = null
    try { text = readFileSync(file, 'utf8') } catch (error) { continue }
    const masked = maskComments(text)
    const starts = lineStartsOf(masked.code)
    const hits = []
    for (const m of masked.code.matchAll(RETIRED_KIND_IN_CODE)) hits.push({ line: lineAt(starts, m.index), raw: lineTextAt(masked.code, starts, m.index) })
    if (hits.length > 0) record.history.push({ file: rel, hits })
  }

  const offenders = record.findings.filter((f) => f.verdict === 'offender')
  const unjudged = record.sites.filter((s) => s.verdict === 'unjudged')
  const cleanSites = record.sites.filter((s) => s.verdict === 'clean')
  record.offenders = offenders
  record.unjudged = unjudged
  record.cleanSites = cleanSites
  if (offenders.length > 0) record.verdict = 'OFFENDER'
  else if (record.unread.length > 0) record.verdict = 'UNREADABLE'
  else if (record.files.length === 0) record.verdict = pkg.declaredMain ? 'UNREADABLE' : 'NO CODE'
  else if (unjudged.length > 0) record.verdict = 'unjudged'
  else record.verdict = cleanSites.length > 0 ? 'clean' : 'clean 0-site'
  return record
}

function coverageText(record) {
  const files = record.files.length
  const shown = record.files.length === 0 ? '' : ' [' + (record.files.length <= 3 ? record.files.join(', ') : record.files.slice(0, 3).join(', ') + ', ...') + ']'
  return String(files) + ' file(s)' + shown + ', ' + String(record.sites.length) + ' site(s)'
}
/* --------------------------------------------------------------------- the fixture */

// Three planted worlds, because one is not enough to show a scan discriminates:
//   retired      the defect verbatim, a module constant spread into the message source;
//   empty        an empty source object, reached through an ALIASED constructor;
//   lookalike    the right shape, with the retired shape named only in a comment.
const FIXTURE_PACKAGES = [
  {
    name: 'dsh-fixture-retired-source',
    files: {
      'lib/index.js': [
        "import { createUserMessage } from '@deepseek-ai/dsh-llm'",
        '',
        '// The retired v3 wrapper source, exactly as the guard shipped it in 0.1.9.',
        "const PLUGIN_SOURCE = { kind: 'plugin', plugin: 'fixture-retired' }",
        '',
        'export function notice(text) {',
        '  return createUserMessage({',
        "    content: [{ type: 'text', text }],",
        "    source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'fixture-retired' },",
        '  })',
        '}',
        '',
      ],
    },
  },
  {
    name: 'dsh-fixture-empty-source',
    files: {
      'lib/index.js': [
        "import { createUserMessage as mkUser } from '@deepseek-ai/dsh-llm'",
        '',
        'export function notice(text) {',
        '  return mkUser({ content: [{ type: "text", text }], source: {} })',
        '}',
        '',
      ],
    },
  },
  {
    name: 'dsh-fixture-clean-lookalike',
    files: {
      'lib/index.js': [
        "import { createUserMessage } from '@deepseek-ai/dsh-llm'",
        '',
        '// A comment that names the retired shape must not turn this package red:',
        "// { kind: 'plugin', plugin: 'prose-only' } is prose, not code.",
        "const SOURCE = { kind: 'plugin:fixture-clean' }",
        '',
        'export function notice(text) {',
        "  return createUserMessage({ content: [{ type: 'text', text }], source: { ...SOURCE, form: 'notice', summary: 'clean' } })",
        '}',
        '',
      ],
    },
  },
]

function buildFixture(root) {
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  for (const pkg of FIXTURE_PACKAGES) {
    const dir = join(root, 'node_modules', pkg.name)
    mkdirSync(dir, { recursive: true })
    const manifest = {
      name: pkg.name,
      version: '0.0.0-fixture',
      type: 'module',
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    writeFileSync(join(dir, 'cordis.patch.yml'), '# fixture: no rows\n', 'utf8')
    for (const rel of Object.keys(pkg.files)) {
      const target = join(dir, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, pkg.files[rel].join('\n'), 'utf8')
    }
  }
}

function proveFailability() {
  buildFixture(FIXTURE_ROOT)
  const child = spawnSync(process.execPath, [SELF, '--profile', FIXTURE_ROOT, '--no-fixture', '--fixture-profile'], {
    cwd: PROJECT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 32 * 1024 * 1024,
  })
  const output = String(child.stdout === null || child.stdout === undefined ? '' : child.stdout) + String(child.stderr === null || child.stderr === undefined ? '' : child.stderr)
  // R73 launcher witness, recorded as a value rather than only printed: the child announced the profile it
  // examined, and it exited 1 because the planted offenders were there. Either half missing means the
  // comparison below is against output that never described a run.
  const aliveVerdict = child.status === 1 && /examined\s+3 plugin package/.test(output)
  // The per-package row is: verdict, origin, package. A package is named on an OFFENDER line, not
  // directly after the verdict word, so the origin column is allowed for.
  const escapeName = (text) => text.replace(/[.*+?^$()[\]{}|\\/-]/g, (ch) => '\\' + ch)
  const offenderLine = (name) => new RegExp('OFFENDER[^\\n]*' + escapeName(name)).test(output)
  const cleanLine = (name) => new RegExp('clean[^\\n]*' + escapeName(name)).test(output)
  const checks = [
    ['the scan exits 1 on a planted offender', child.status === 1, 'child exit ' + String(child.status)],
    ['it examined the fixture profile it was given', /examined\s+3 plugin package/.test(output), (/examined\s+\d+ plugin package[^\n]*/.exec(output) ?? ['not printed'])[0]],
    ['the retired wrapper is named at its own line, with the reason', offenderLine('dsh-fixture-retired-source') && /lib[\\/]index\.js:4: the retired v3 wrapper shape: kind "plugin" beside a plugin key/.test(output), (/lib[\\/]index\.js:\d+: the retired v3 wrapper shape[^\n]*/.exec(output) ?? ['not printed'])[0]],
    ['the empty source is named, through an aliased constructor', offenderLine('dsh-fixture-empty-source') && /declares no kind at all/.test(output), (/declares no kind at all/.exec(output) ?? ['reason not printed'])[0]],
    ['the lookalike stays clean although its comment names the retired shape', cleanLine('dsh-fixture-clean-lookalike') && !offenderLine('dsh-fixture-clean-lookalike'), cleanLine('dsh-fixture-clean-lookalike') ? 'graded clean' : 'not graded clean'],
  ]
  if (!KEEP_FIXTURE) rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  return {
    output,
    checks,
    aliveVerdict,
    proved: aliveVerdict && checks.every((check) => check[1] === true),
    kept: KEEP_FIXTURE,
    profile: FIXTURE_ROOT,
    packages: FIXTURE_PACKAGES.length,
  }
}
/* ------------------------------------------------------------------------ main */

const report = {
  gate: 'plugin-message-sources',
  offline: true,
  profile: null,
  nodeModules: null,
  origin: null,
  packages: [],
  skippedLibraries: [],
  repoOnly: [],
  proseMentions: [],
  sourceOutsideConstructs: [],
  historical: [],
  fixture: null,
  reasons: [],
  exitCode: null,
}

function flush(code) {
  report.exitCode = code
  report.readings = readings.map((r) => ({ n: r.n, title: r.title, evidence: r.evidence }))
  report.summary = 'exit ' + String(code)
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
  else console.log(lines.join('\n'))
  return code
}

function namedOption(name) {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const value = process.argv[i + 1]
  if (value === undefined || value === null || String(value).startsWith('--')) return null
  return String(value)
}

function resolveProfile() {
  const named = namedOption('--profile')
  const appdata = process.env.APPDATA
  if (named !== null) return { profile: resolve(named), origin: '--profile' }
  if (typeof appdata === 'string' && appdata.length > 0) {
    return { profile: join(appdata, 'dev.dshlink.client', 'dsh-link', 'kernel-home', 'profiles', 'web'), origin: '$APPDATA' }
  }
  return { profile: LITERAL_PROFILE, origin: 'literal default (APPDATA is unset)' }
}

function main() {
  const resolved = resolveProfile()
  let profile = resolved.profile
  let nodeModules = join(profile, 'node_modules')
  if (!existsSync(nodeModules) && basename(profile) === 'node_modules' && existsSync(profile)) {
    nodeModules = profile
    profile = dirname(profile)
  }
  report.profile = profile
  report.nodeModules = nodeModules
  report.origin = resolved.origin

  say('gate 138 plugin-message-sources (R199) - offline; the profile is machine state, the fixture proves the scan can fail')
  say('the retired shape is a session message source written with kind:plugin; format v4 refuses it at admission')

  /* --- reading 1 ------------------------------------------------------------------ */
  reading('the profile this scan read, and the roster it took from that profile')
  ev('profile      ' + profile + '   (resolved from ' + resolved.origin + ')')
  if (!existsSync(profile)) {
    ev('MISSING      this path does not exist')
    say('')
    say('exit 3  PROFILE MISSING: ' + profile)
    say('        the live profile is machine state outside this repo; a missing profile is not a green.')
    report.reasons.push('PROFILE MISSING: ' + profile)
    return flush(3)
  }
  if (!existsSync(nodeModules)) {
    ev('MISSING      ' + nodeModules + ' does not exist')
    say('')
    say('exit 3  NO node_modules: ' + nodeModules)
    say('        a profile with no installed tree cannot say which plugins are installed; not a green.')
    report.reasons.push('NO node_modules: ' + nodeModules)
    return flush(3)
  }
  let discovered = null
  try { discovered = discover(nodeModules) } catch (error) {
    ev('UNREADABLE   ' + nodeModules + ': ' + String(error && error.message))
    say('')
    say('exit 3  UNREADABLE PROFILE: ' + nodeModules)
    report.reasons.push('UNREADABLE PROFILE: ' + nodeModules)
    return flush(3)
  }
  if (discovered.plugins.length === 0) {
    ev('examined     0 plugin package(s) under ' + nodeModules)
    say('')
    say('exit 3  NO PLUGIN PACKAGES in ' + nodeModules)
    say('        an empty roster proves nothing; this is not a green.')
    report.reasons.push('NO PLUGIN PACKAGES in ' + nodeModules)
    return flush(3)
  }

  const analysed = discovered.plugins.map((pkg) => analyse(pkg))
  report.packages = analysed.map((p) => ({
    name: p.name, ours: p.ours, real: p.real, verdict: p.verdict,
    files: p.files, sites: p.sites.map((s) => ({ file: s.file, line: s.line, ctor: s.ctor, verdict: s.verdict, reason: s.reason })),
    offenders: p.offenders,
  }))
  report.skippedLibraries = discovered.libraries.map((p) => p.name)

  const ours = analysed.filter((p) => p.ours)
  const thirdParty = analysed.filter((p) => !p.ours)
  const filesRead = analysed.reduce((sum, p) => sum + p.files.length, 0)
  const bytesRead = analysed.reduce((sum, p) => sum + p.bytes, 0)
  const sites = analysed.reduce((sum, p) => sum + p.sites.length, 0)
  const sitePackages = analysed.filter((p) => p.sites.length > 0).length

  ev('node_modules ' + nodeModules)
  ev('examined     ' + String(analysed.length) + ' plugin package(s) = ' + String(ours.length) + ' ours + ' + String(thirdParty.length) + ' third-party')
  ev('read         ' + String(filesRead) + ' JS file(s), ' + String(Math.round(bytesRead / 1024)) + ' KiB, ' + String(sites) + ' message-source site(s) in ' + String(sitePackages) + ' package(s)')
  ev('directories  ' + String(discovered.topLevel) + ' top-level + ' + String(discovered.scoped) + ' scoped')
  ev('roster rule  a package counts as a plugin when it declares dsh/cordis markers or follows the dsh-/plugin naming pattern')
  ev('skipped      ' + String(discovered.libraries.length) + ' package(s) declare no plugin marker and were not graded: '
    + (discovered.libraries.length === 0 ? '(none)' : discovered.libraries.slice(0, 5).map((p) => p.name).join(', ') + (discovered.libraries.length > 5 ? ', ...' : '')))
  const linked = analysed.filter((p) => p.link === true).length
  const outsideProfile = analysed.filter((p) => p.real !== null && isInside(p.real, profile) === false).length
  ev('links        ' + String(linked) + ' of ' + String(analysed.length) + ' installed entries are symlinks; ' + String(outsideProfile) + ' resolve to bytes outside the profile path above')
  let profileReal = null
  try { profileReal = realpathSync(profile) } catch (error) { profileReal = null }
  if (profileReal !== null && isInside(profileReal, profile) === false) {
    ev('junction     that profile path is itself a link; the bytes this run read live at:')
    ev('             ' + profileReal)
  }

  /* --- reading 2 ------------------------------------------------------------------ */
  reading('one line per installed plugin package: verdict, what was actually opened, and where it lives')
  say('  ' + pad('verdict', 14) + pad('origin', 12) + pad('package', 46) + pad('opened', 40) + 'installed entry, and where its bytes are')
  for (const record of analysed) {
    const installed = join('node_modules', record.name)
    const where = record.link === true && record.real !== null ? installed + ' -> ' + record.real : installed
    say('  ' + pad(record.verdict, 14) + pad(record.ours ? 'ours' : 'third-party', 12) + pad(record.name, 46) + pad(clip(coverageText(record), 40), 40) + clip(where, 110))
    if (current !== null) current.evidence.push(pad(record.verdict, 14) + pad(record.ours ? 'ours' : 'third-party', 12) + pad(record.name, 46) + coverageText(record))
    for (const finding of record.offenders) {
      say('      ' + finding.file + ':' + String(finding.line) + ': ' + finding.reason)
      say('      ' + finding.raw)
    }
    for (const site of record.unjudged) say('      ' + site.file + ':' + String(site.line) + ': not decided: ' + site.reason)
    for (const note of record.unread) say('      unreadable: ' + note)
    for (const site of record.cleanSites) say('      ' + site.file + ':' + String(site.line) + ': clean: ' + site.reason)
  }
  if (current !== null) current.evidence.push(String(analysed.length) + ' package(s), ' + String(filesRead) + ' file(s) opened, ' + String(sites) + ' site(s) judged')

  /* --- reading 3 ------------------------------------------------------------------ */
  reading('our own packages: which of them this gate opened, and the repo plugins that are not installed')
  ev('ours installed   ' + String(ours.length) + ' of ' + String(analysed.length) + ' installed package(s) resolve into ' + REPO_PLUGINS)
  for (const record of ours) ev('  read           ' + pad(record.name, 40) + coverageText(record) + ' -> ' + String(record.real))
  let repoOnly = []
  try {
    repoOnly = readdirSync(REPO_PLUGINS, { withFileTypes: true })
      .filter((entry) => isDirectory(join(REPO_PLUGINS, entry.name), entry))
      .map((entry) => entry.name)
      .sort()
      .filter((name) => !analysed.some((p) => p.name === name))
  } catch (error) { repoOnly = [] }
  report.repoOnly = repoOnly
  ev('not installed    ' + String(repoOnly.length) + ' repo plugin(s) are absent from this profile and were NOT graded: ' + (repoOnly.length === 0 ? '(none)' : repoOnly.join(', ')))
  ev('our offenders    ' + String(ours.filter((p) => p.offenders.length > 0).length) + ' of ' + String(ours.length) + ' (the code this repository can fix)')

  /* --- reading 4 ------------------------------------------------------------------ */
  const proseMentions = []
  for (const p of analysed) for (const mention of p.prose) proseMentions.push({ pkg: p.name, file: mention.file, line: mention.line, text: mention.text })
  report.proseMentions = proseMentions
  reading('prose excluded: the retired shape inside a comment is not a write')
  ev('mentions         ' + String(proseMentions.length) + ' comment(s) in ' + String(new Set(proseMentions.map((m) => m.pkg)).size) + ' package(s) name the retired shape and were excluded from the verdict')
  for (const mention of proseMentions.slice(0, 6)) ev('  ' + mention.pkg + ' ' + mention.file + ':' + String(mention.line) + ': ' + clip(mention.text, 108))
  if (proseMentions.length > 6) ev('  ... ' + String(proseMentions.length - 6) + ' more')

  /* --- reading 5 ------------------------------------------------------------------ */
  const outside = []
  for (const p of analysed) for (const item of p.sourceOutside) outside.push({ pkg: p.name, file: item.file, line: item.line, raw: item.raw })
  report.sourceOutsideConstructs = outside
  const historical = []
  for (const p of analysed) for (const item of p.history) historical.push({ pkg: p.name, file: item.file, hits: item.hits })
  report.historical = historical
  reading('not graded: source keys outside a message construct, and the pre-patch file still on disk')
  ev('outside          ' + String(outside.length) + ' source-key occurrence(s) outside any judged construct (counted textually, so a string literal counts)')
  for (const item of outside.slice(0, 4)) ev('  ' + item.pkg + ' ' + item.file + ':' + String(item.line) + ': ' + item.raw)
  if (outside.length > 4) ev('  ... ' + String(outside.length - 4) + ' more')
  ev('unloadable       ' + String(historical.length) + ' non-loadable sibling file(s) carry the retired shape; they are not graded because the profile loads the named entry')
  for (const item of historical) {
    ev('  ' + item.pkg + ' ' + item.file + ':' + String(item.hits[0].line) + ': ' + clip(item.hits[0].raw, 108))
    const same = analysed.find((p) => p.name === item.pkg)
    ev('  -> the same package now writes ' + (same !== undefined && same.cleanSites.length > 0 ? same.cleanSites[0].reason : 'a source this gate could not read'))
  }
  if (historical.length === 0) ev('  (none on this machine)')

  /* --- reading 6 ------------------------------------------------------------------ */
  let fixture = null
  if (WITH_FIXTURE) {
    reading('the fixture proves the scan can fail: two planted offenders named, one lookalike left clean')
    fixture = proveFailability()
    ev('fixture profile  ' + fixture.profile + ' (' + String(fixture.packages) + ' synthetic package(s); removed after the run: ' + String(!fixture.kept) + ')')
    for (const check of fixture.checks) ev((check[1] === true ? 'PASS ' : 'FAIL ') + check[0] + ' - ' + check[2])
    if (!fixture.proved) {
      say('')
      say('  the scan did not name a planted offender; a gate that only ever says clean is not a gate. child output:')
      for (const line of fixture.output.split('\n').slice(-40)) say('  | ' + line)
    }
  } else {
    reading('the fixture was skipped (--no-fixture): this run does NOT prove failability')
    ev('skipped          run the default invocation for a graded run')
  }
  report.fixture = fixture === null ? null : { proved: fixture.proved, checks: fixture.checks, profile: fixture.profile, packages: fixture.packages }

  /* --- reading 7 ------------------------------------------------------------------ */
  const offenders = []
  for (const p of analysed) for (const f of p.offenders) offenders.push({ pkg: p.name, file: f.file, line: f.line, reason: f.reason })
  // R245: a package the RUNTIME refuses to load cannot write a session message, and the boot log says so by name
  // ("skipping profile bundle \"<name>\""). The gate still names such a finding - it stays visible - but "installed
  // and never loaded" is not the same fact as "loaded and writing a retired shape", and only the second one can
  // corrupt a session. The evidence is the runtime's own line, quoted here, not an assumption this gate invented.
  const bootLog = (() => { try { return readFileSync(join(profile, '..', '..', 'boot.log'), 'utf8') } catch (error) { return '' } })()
  const skippedByRuntime = (name) => bootLog.indexOf('skipping profile bundle "' + name + '"') !== -1
  const skippedOffenders = offenders.filter((one) => skippedByRuntime(one.pkg))
  const liveOffenders = offenders.filter((one) => !skippedByRuntime(one.pkg))
  const unreadable = analysed.filter((p) => p.verdict === 'UNREADABLE')
  const undecided = analysed.filter((p) => p.unjudged.length > 0)
  const cleanSites = analysed.reduce((sum, p) => sum + p.cleanSites.length, 0)
  const undecidedSites = analysed.reduce((sum, p) => sum + p.unjudged.length, 0)
  const reasons = []
  if (liveOffenders.length > 0) {
    reasons.push(String(liveOffenders.length) + ' offender finding(s) in ' + String(new Set(liveOffenders.map((o) => o.pkg)).size) + ' package(s): ' + liveOffenders.map((o) => o.pkg + ' ' + o.file + ':' + String(o.line)).join('; '))
  }
  if (unreadable.length > 0) reasons.push(String(unreadable.length) + ' UNREADABLE package(s): ' + unreadable.map((p) => p.name).join(', '))
  if (undecided.length > 0) reasons.push(String(undecided.length) + ' package(s) hold a source site the scan could not decide: ' + undecided.map((p) => p.name).join(', '))
  if (!FIXTURE_PROFILE && ours.length === 0) reasons.push('no package of ours is installed in this profile, so "our own plugins are clean" cannot be graded')
  if (fixture !== null && !fixture.proved) reasons.push('the fixture did not prove failability')
  report.reasons = reasons

  reading('summary')
  ev('profile          ' + profile)
  ev('packages         ' + String(analysed.length) + ' plugin package(s): ' + String(ours.length) + ' ours (opened ' + String(ours.reduce((sum, p) => sum + p.files.length, 0)) + ' file(s)) + ' + String(thirdParty.length) + ' third-party')
  ev('offenders        ' + String(offenders.length) + (offenders.length === 0 ? '' : ': ' + offenders.map((o) => o.pkg + ' ' + o.file + ':' + String(o.line)).join('; ')))
  ev('not loaded       ' + String(skippedOffenders.length) + ' of those sit in a package the runtime SKIPS (named in the boot log), so they cannot reach a session: '
    + (skippedOffenders.length === 0 ? '(none)' : skippedOffenders.map((o) => o.pkg).join(', ')))
  ev('sites judged     ' + String(cleanSites) + ' clean, ' + String(undecidedSites) + ' undecided, ' + String(sites) + ' total')
  ev('no-site packages ' + String(analysed.filter((p) => p.sites.length === 0).length) + ': for those the verdict is "no site can be wrong", not "a source proven right"')
  ev('fixture          ' + (fixture === null ? 'skipped' : fixture.proved === true ? 'proved failability' : 'FAILED to prove failability'))
  say('')
  say('summary: ' + String(analysed.length) + ' installed plugin package(s) examined in ' + nodeModules + '; ' + String(offenders.length)
    + ' offender(s); ' + String(sites) + ' message-source site(s) judged (' + String(cleanSites) + ' clean, ' + String(undecidedSites) + ' undecided); '
    + String(proseMentions.length) + ' prose mention(s) excluded; ' + String(historical.length) + ' unloadable pre-patch file(s) named; fixture '
    + (fixture === null ? 'skipped' : fixture.proved === true ? 'proved failability' : 'FAILED') + '; exit ' + (reasons.length === 0 ? '0' : '1'))
  for (const reason of reasons) say('  red: ' + reason)
  say('exit ' + (reasons.length === 0 ? '0' : '1'))
  return flush(reasons.length === 0 ? 0 : 1)
}

process.exitCode = main()






