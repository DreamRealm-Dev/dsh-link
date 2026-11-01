#!/usr/bin/env node
/**
 * R503 B2 consistency gate: every number R497 quotes must exist in an archived JSON.
 *
 * R497 embeds a machine-readable claims block (<!-- R497-CLAIMS ... -->). Each claim names the
 * exact document line that quotes the number and the JSON pointer into one archived benchmark
 * run (or into rust/verification-snapshot.json for test counts). This gate fails when
 *
 *   - the quoted line is no longer in the document;
 *   - the archive file, pointer or run id is missing;
 *   - the archived value differs from the quoted value by more than the tolerance (1% by
 *     default, which allows a number to be rendered rounded in the table);
 *   - an aggregate claim (median/min/max across runs) no longer matches the archived runs.
 *
 * It also refuses duplicate run ids across archived runs, so "run1/run2/run3" cannot silently
 * point at the same file.
 *
 *   node rust/scripts/verify-r497-numbers.mjs
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const DOC_PATH = join(REPO_ROOT, 'docs', 'handoff', 'R497-compute-batching.md')
const RUNS_DIR = join(HERE, '..', 'bench-runs')
const CLAIMS_START = '<!-- R497-CLAIMS'
const CLAIMS_END = 'R497-CLAIMS -->'

/** Read a JSON file by repo-relative path. */
function loadJson(relativePath) {
  const absolute = join(REPO_ROOT, relativePath)
  if (!existsSync(absolute)) throw new Error('archive missing: ' + relativePath)
  return JSON.parse(readFileSync(absolute, 'utf8'))
}

/** Resolve an RFC 6901 JSON pointer ('' and '/' both mean the root). */
function resolvePointer(value, pointer) {
  if (pointer === '' || pointer === '/') return value
  let current = value
  for (const token of pointer.split('/').slice(1)) {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object') return undefined
    current = Array.isArray(current) ? current[Number(key)] : current[key]
  }
  return current
}

/** Aggregate the resolved values of several runs. */
function aggregate(values, method) {
  if (method === 'value') return values[0]
  const sorted = values.slice().sort((left, right) => left - right)
  if (method === 'min') return sorted[0]
  if (method === 'max') return sorted[sorted.length - 1]
  if (method === 'mean') return sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Compare an archived number with the number the document quotes. */
function close(actual, expected, tolerancePct, absoluteTolerance) {
  const tolerance = Math.max(Math.abs(expected) * (tolerancePct / 100), absoluteTolerance ?? 0.005)
  return Math.abs(actual - expected) <= tolerance
}

/** Extract the claims JSON block from the document. */
function claimsOf(documentText) {
  const start = documentText.indexOf(CLAIMS_START)
  const end = documentText.indexOf(CLAIMS_END)
  if (start < 0 || end < 0 || end < start) throw new Error('R497-CLAIMS block missing from the document')
  const jsonText = documentText.slice(start + CLAIMS_START.length, end).replace(/^\s*-->/, '').trim()
  const begin = jsonText.indexOf('{')
  return JSON.parse(jsonText.slice(begin))
}

/**
 * Mask tokens that are metadata rather than measured numbers, before the coverage scan.
 *
 * The coverage question is "is every NUMBER we measured traceable to CLAIMS", not "mask every
 * digit": dates, run ids, versions, section numbers, machine names, hex digests, p50/p99 and
 * scale labels are metadata. Everything numeric that survives this mask must be a claim or a
 * declared structural constant in CLAIMS.coverage.allow.
 */
function maskMetadata(text) {
  return text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<timestamp>')
    .replace(/\b\d{8}T\d{6}Z-r[\w-]+/g, '<run-id>')
    .replace(/[\w./-]+\.json/g, '<file>')
    .replace(/\bsha256\b/gi, '<hash-name>')
    .replace(/\bp(?:50|99)\b/g, '<percentile>')
    .replace(/\bR\d{3}\b/g, '<report>')
    .replace(/\bWindows \d+\b/g, 'Windows <n>')
    .replace(/\bi5-\d+[A-Za-z]*\b/g, 'i5-<model>')
    .replace(/\brun\d+\b/gi, '<run>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\bv?\d+\.\d+\.\d+\b/g, '<version>')
    .replace(/\bv\d+\b/g, 'v<n>')
    .replace(/\bx64\b/g, '<arch>')
    // Placeholders must not contain digits: they would re-enter the coverage tokenizer.
    .replace(/UTF-?8/gi, '<utf>')
    .replace(/UTF-16/gi, '<utf-sixteen>')
    .replace(/§\d+(?:\.\d+)*/g, '<section>')
    .replace(/\b\d+k\b/g, '<scale>')
    .replace(/\b\d+(?:\.\d+)?e[+-]?\d+\b/g, '<scientific>')
    .replace(/\b2\^53\b/g, '<safe-bound>')
    .replace(/0x[0-9a-f]+/gi, '<seed>')
}

/** The text of the measurement sections named by the coverage config. */
function coverageText(documentText, sections) {
  const bounds = sections.map((section) => {
    const start = documentText.indexOf('\n## ' + section + '.')
    if (start < 0) throw new Error('coverage section ' + section + ' not found')
    return start
  })
  const end = documentText.indexOf('\n## ' + String(Number(sections[sections.length - 1]) + 1) + '.')
  if (end < 0) throw new Error('coverage end section not found')
  return documentText.slice(Math.min(...bounds), end)
}

/** Whether one numeric token in one line is covered by a claim on that same line. */
function tokenCovered(claims, line, token, allow) {
  const raw = token.replace(/,/g, '')
  if (allow.some((entry) => String(entry.value) === raw)) return true
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return true
  return claims.some((claim) => {
    if (typeof claim.docLine !== 'string' || !line.includes(claim.docLine)) return false
    if (typeof claim.expected !== 'number') return false
    const tolerance = Math.max(Math.abs(claim.expected) * ((claim.tolerancePct ?? 1) / 100), claim.absoluteTolerance ?? 0.005)
    // The tokenizer keeps magnitude only (the sign is layout), so compare magnitudes.
    return Math.abs(Math.abs(numeric) - Math.abs(claim.expected)) <= tolerance
  })
}

/**
 * Coverage check: every number rendered in the measurement sections must resolve to a claim on
 * the same line (or a declared structural constant). A number that escapes CLAIMS is a failure.
 */
function coverageFailures(documentText, parsed) {
  const coverage = parsed.coverage
  if (coverage === undefined || !Array.isArray(coverage.sections)) throw new Error('CLAIMS block has no coverage config')
  const allow = Array.isArray(coverage.allow) ? coverage.allow : []
  const originalLines = coverageText(documentText, coverage.sections).split('\n')
  const region = maskMetadata(originalLines.join('\n'))
  const maskedLines = region.split('\n')
  const failures = []
  for (let index = 0; index < maskedLines.length; index += 1) {
    const line = maskedLines[index]
    const original = originalLines[index] ?? ''
    // Headings, table separator rows and the claims block itself are structure, not values.
    if (line.trimStart().startsWith('#') || /^\s*\|?[\s|:-]+\|?\s*$/.test(line) || line.includes('R497-CLAIMS')) continue
    const cleaned = line.replace(/`[^`]*`/g, (span) => span.replace(/[0-9]/g, '#'))
    for (const match of cleaned.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const token = match[0]
      // Claims quote the rendered table line, so coverage matches against the unmasked original.
      if (!tokenCovered(parsed.claims, original, token, allow)) {
        failures.push(token + ' in line: ' + original.trim().slice(0, 140))
      }
    }
  }
  return failures
}

/** The gate. */
function main() {
  const documentText = readFileSync(DOC_PATH, 'utf8')
  const parsed = claimsOf(documentText)
  const claims = parsed.claims
  const failures = []
  const runIds = new Set()

  // Archived runs must be individually addressable: no duplicate run id may exist.
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith('.json')) continue
    const candidate = loadJson(join('rust', 'bench-runs', name))
    if (Array.isArray(candidate.runs)) {
      if (typeof candidate.runId !== 'string' || candidate.runId === '') {
        failures.push(name + ': archived run has no runId')
        continue
      }
      if (runIds.has(candidate.runId)) failures.push(name + ': duplicate run id ' + candidate.runId)
      runIds.add(candidate.runId)
      continue
    }
    // A regression-gate manifest names other archives; its run ids must resolve to real ones.
    if (Array.isArray(candidate.files) && Array.isArray(candidate.runIds)) {
      for (const file of candidate.files) {
        if (!existsSync(join(REPO_ROOT, file))) failures.push(name + ': manifest file missing ' + file)
      }
      continue
    }
    failures.push(name + ': not a benchmark archive and not a manifest')
  }

  for (const claim of claims) {
    const label = claim.id + ' (' + claim.docLine + ')'
    if (!documentText.includes(claim.docLine)) {
      failures.push(label + ': quoted line is not in the document')
      continue
    }
    let files
    try {
      files = claim.source.files.map((file) => loadJson(file))
    } catch (error) {
      failures.push(label + ': ' + String(error instanceof Error ? error.message : error))
      continue
    }
    if (Array.isArray(claim.source.runIds)) {
      const archived = files.map((file) => file.runId)
      if (JSON.stringify(archived) !== JSON.stringify(claim.source.runIds)) {
        failures.push(label + ': run ids ' + JSON.stringify(archived) + ' do not match the claim ' + JSON.stringify(claim.source.runIds))
      }
    }
    // A derived percentage change aggregates the numerator from one run set and the denominator
    // from another (current vs baseline archives), which a per-file ratio cannot express.
    if (claim.source.transform === 'pctChange') {
      const aggregateMethod = claim.source.aggregate ?? 'median'
      const numeratorValues = files.map((file) => {
        const value = resolvePointer(file, claim.source.numerator)
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('numerator pointer is not a finite number')
        return value
      })
      const denominatorFiles = (claim.source.denominatorFiles ?? claim.source.files).map((file) => loadJson(file))
      const denominatorValues = denominatorFiles.map((file) => {
        const value = resolvePointer(file, claim.source.denominator)
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('denominator pointer is not a finite number')
        return value
      })
      const numerator = aggregate(numeratorValues, aggregateMethod)
      const denominator = aggregate(denominatorValues, aggregateMethod)
      const actual = ((numerator - denominator) / denominator) * 100
      if (!close(actual, claim.expected, claim.tolerancePct ?? 1, claim.absoluteTolerance)) {
        failures.push(label + ': derived ' + actual.toFixed(2) + ' vs quoted ' + String(claim.expected))
      }
      continue
    }
    const values = files.map((file) => {
      // A plain claim resolves one pointer; a ratio claim divides two pointers per run so a
      // native/TS or batch-500/batch-1 ratio can be checked directly against its two sources.
      if (claim.source.numerator !== undefined) {
        const numerator = resolvePointer(file, claim.source.numerator)
        const denominator = resolvePointer(file, claim.source.denominator)
        if (typeof numerator !== 'number' || typeof denominator !== 'number' || denominator === 0) {
          throw new Error('ratio pointers are not numbers: ' + claim.source.numerator + ' / ' + claim.source.denominator)
        }
        // A derived percentage change lets a document quote the regression gate's change column.
        if (claim.source.transform === 'pctChange') return ((numerator - denominator) / denominator) * 100
        return numerator / denominator
      }
      const value = resolvePointer(file, claim.source.pointer)
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('pointer ' + claim.source.pointer + ' is not a finite number')
      }
      // A unit divisor lets the document quote MiB while the archive stores bytes.
      return claim.source.divisor === undefined ? value : value / claim.source.divisor
    })
    const actual = aggregate(values, claim.source.aggregate ?? 'value')
    if (!close(actual, claim.expected, claim.tolerancePct ?? 1, claim.absoluteTolerance)) {
      failures.push(label + ': archived ' + String(actual) + ' vs quoted ' + String(claim.expected)
        + ' (tolerance ' + String(claim.tolerancePct ?? 1) + '%)')
    }
  }

  const uncovered = coverageFailures(documentText, parsed)
  for (const gap of uncovered) failures.push('uncovered number: ' + gap)

  if (failures.length > 0) {
    console.error('R497 NUMBER GATE FAIL (' + String(failures.length) + ' findings, ' + String(claims.length) + ' claims)')
    for (const failure of failures) console.error('  FAIL ' + failure)
    process.exit(1)
  }
  console.log('R497 NUMBER GATE PASS: ' + String(claims.length) + ' claims across ' + String(runIds.size)
    + ' archived runs; coverage clean in sections ' + parsed.coverage.sections.join(', '))
}

/** Self-test: prove the coverage check rejects a number that is not in CLAIMS. */
function selfTest() {
  const documentText = readFileSync(DOC_PATH, 'utf8')
  const parsed = claimsOf(documentText)
  if (coverageFailures(documentText, parsed).length !== 0) {
    console.error('SELF-TEST FAIL: the real document already has uncovered numbers')
    process.exit(1)
  }
  // Inject inside section 3.1 (inside the coverage region) so the gate must notice it.
  const start = documentText.indexOf('\n### 3.1')
  if (start < 0) throw new Error('SELF-TEST cannot find section 3.1')
  const injected = documentText.slice(0, start) + '\n| made up | 999,999 |\n' + documentText.slice(start)
  const findings = coverageFailures(injected, parsed)
  if (!findings.some((finding) => finding.includes('999,999'))) {
    console.error('SELF-TEST FAIL: an injected unclaimed number was not detected')
    process.exit(1)
  }
  console.log('SELF-TEST PASS: injected unclaimed number detected (' + String(findings.length) + ' finding(s))')
}

if (process.argv.includes('--self-test')) selfTest()
else main()
