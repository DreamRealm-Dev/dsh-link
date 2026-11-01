/**
 * Declarative adapter probing (LINK adapts software): read-only detection of one
 * adapters/<id>/adapter.json declaration against this machine.
 *
 * A probe answers two questions and nothing else: is the software installed, and is the
 * service now answering the one the declaration names. It never prompts, never reads a
 * credential, and touches the network only at the declared identity URL. A missing file is
 * a normal reading; every refusal carries a stable reasonCode the pane prints verbatim.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import type {
  AdapterDeclaration,
  AdapterFileProbe,
  AdapterIdentityProbe,
  ProbeReasonCode,
  ProbeResult,
} from '../protocol/types.ts'

/** Everything a probe reads from the machine, injectable so a test never touches the real one. */
export interface ProbeEnvironment {
  /** Fetch implementation for the identity request. */
  fetch?: typeof fetch
  /** Environment for dollar-NAME expansion and the match.env presence signal. */
  env?: Record<string, string | undefined>
  /** Home directory for tilde expansion. */
  home?: string
  /** Clock for the reading's at field. */
  now?: () => Date
  /** Upper bound for one identity request, in ms. */
  timeoutMs?: number
}

/** What the declared file probes produced. */
interface ResolvedProbes {
  vars: Record<string, string>
  sawFile: boolean
  fileProblem?: string
  unresolved: string[]
}

/**
 * Expand a leading tilde and dollar-NAME references in one declaration path or URL.
 * @param template - the declaration string.
 * @param vars - values from earlier file probes, interpolated for brace-name references.
 * @param env - environment for dollar-NAME expansion.
 * @param home - home directory for tilde expansion.
 * @returns the expanded string, or undefined when a dollar-NAME it needs is unset.
 */
export function expandTemplate(
  template: string,
  vars: Record<string, string> = {},
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string | undefined {
  let text = template
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) text = home + text.slice(1)
  let unresolved = false
  const withEnv = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, bare) => {
    const name = String(braced ?? bare)
    const value = env[name]
    if (value === undefined || value === '') {
      unresolved = true
      return ''
    }
    return value
  })
  if (unresolved) return undefined
  return withEnv.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => (vars[name] === undefined ? match : vars[name]))
}

/**
 * Read one dot path out of parsed JSON.
 * @param value - parsed JSON value.
 * @param path - dot-separated path, e.g. "port".
 * @returns the value at the path, or undefined.
 */
export function readDotPath(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const key of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

/** Read every declared file probe, interpolating the variables earlier probes produced. */
function readFileProbes(declaration: AdapterDeclaration, environment: ProbeEnvironment): ResolvedProbes {
  const env = environment.env ?? process.env
  const home = environment.home ?? homedir()
  const probes: AdapterFileProbe[] = declaration.match?.files ?? []
  const resolved: ResolvedProbes = { vars: {}, sawFile: false, unresolved: [] }
  for (const probe of probes) {
    const path = expandTemplate(probe.path, resolved.vars, env, home)
    if (path === undefined) {
      resolved.unresolved.push(probe.path)
      continue
    }
    if (!existsSync(path)) continue
    resolved.sawFile = true
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      resolved.fileProblem = resolved.fileProblem ?? (probe.path + ' exists but can not be read')
      continue
    }
    if (probe.jsonPath === undefined) {
      resolved.vars[probe.as] = raw.trim()
      break
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      resolved.fileProblem = resolved.fileProblem ?? (probe.path + ' is not JSON, so ' + probe.jsonPath + ' can not be read')
      continue
    }
    const found = readDotPath(parsed, probe.jsonPath)
    if (found === undefined || found === null) {
      resolved.fileProblem = resolved.fileProblem ?? (probe.path + ' has no ' + probe.jsonPath + ' field')
      continue
    }
    if (typeof found === 'object') {
      resolved.fileProblem = resolved.fileProblem ?? (probe.path + '.' + probe.jsonPath + ' is an object, not a scalar')
      continue
    }
    resolved.vars[probe.as] = String(found)
    break
  }
  return resolved
}

/** One identity request outcome. */
type IdentityOutcome = { ok: true } | { ok: false; reasonCode: ProbeReasonCode; message: string }

/** Ask the declared identity endpoint whether the service on that port is the declared one. */
async function fetchIdentity(
  identity: AdapterIdentityProbe,
  vars: Record<string, string>,
  environment: ProbeEnvironment,
): Promise<IdentityOutcome> {
  const env = environment.env ?? process.env
  const home = environment.home ?? homedir()
  const url = expandTemplate(identity.url, vars, env, home)
  if (url === undefined) {
    return { ok: false, reasonCode: 'probe-failed', message: 'the declared identity URL ' + identity.url + ' needs an environment variable this machine does not set' }
  }
  const fetchImpl: typeof fetch = environment.fetch ?? fetch
  const timeoutMs = environment.timeoutMs ?? 4000
  const method = identity.method === 'HEAD' ? 'HEAD' : 'GET'
  let response: Response
  try {
    response = await fetchImpl(url, {
      method,
      redirect: 'error',
      headers: { accept: 'application/json, text/plain;q=0.9' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause
    const code = cause?.code ?? (error as { code?: string })?.code ?? ''
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, reasonCode: 'not-running', message: method + ' ' + url + ' answered nothing: ' + (code !== '' ? code : detail.slice(0, 160)) }
  }
  const expected = identity.expectStatus ?? 200
  if (response.status !== expected) {
    return { ok: false, reasonCode: 'foreign-service', message: method + ' ' + url + ' answered HTTP ' + response.status + ' (expected ' + expected + '): the service there is not the declared one' }
  }
  if (identity.contains === undefined && identity.jsonPath === undefined) return { ok: true }
  const text = method === 'HEAD' ? '' : (await response.text()).slice(0, 65536)
  if (identity.contains !== undefined && !text.includes(identity.contains)) {
    return { ok: false, reasonCode: 'foreign-service', message: 'something answered on that port, but its response does not contain ' + JSON.stringify(identity.contains) + ': it is a foreign service' }
  }
  if (identity.jsonPath !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { ok: false, reasonCode: 'foreign-service', message: 'the identity response at ' + url + ' is not JSON, so it can not be the declared service' }
    }
    const found = readDotPath(parsed, identity.jsonPath)
    if (identity.equals !== undefined && String(found) !== identity.equals) {
      return { ok: false, reasonCode: 'foreign-service', message: 'the identity response carries ' + identity.jsonPath + '=' + JSON.stringify(String(found)) + ', expected ' + JSON.stringify(identity.equals) }
    }
    if (identity.equals === undefined && found === undefined) {
      return { ok: false, reasonCode: 'foreign-service', message: 'the identity response has no ' + identity.jsonPath + ' field' }
    }
  }
  return { ok: true }
}

/**
 * Probe one declaration against this machine.
 * @param declaration - the adapter.json document.
 * @param environment - injectable machine access.
 * @returns one reading; detected false never triggers a consent card.
 */
export async function probeDeclaration(declaration: AdapterDeclaration, environment: ProbeEnvironment = {}): Promise<ProbeResult> {
  const at = (environment.now?.() ?? new Date()).toISOString()
  const env = environment.env ?? process.env
  const home = environment.home ?? homedir()
  const probes = readFileProbes(declaration, environment)
  const envNames = declaration.match?.env ?? []
  const envSignals = envNames.filter((name) => (env[name] ?? '').trim() !== '')
  const files = (declaration.match?.files ?? []).map((probe) => probe.path)
  const refuse = (reasonCode: ProbeReasonCode, reason: string): ProbeResult => ({ adapterId: declaration.id, detected: false, reasonCode, reason, at })
  const unresolvedNote = probes.unresolved.length > 0 ? ' (' + probes.unresolved.join(', ') + ' needs an environment variable that is not set)' : ''
  const envNote = envNames.length > 0 ? ' and none of ' + JSON.stringify(envNames) + ' is set' : ''
  const identity = declaration.match?.identity
  if (identity === undefined) {
    if (probes.fileProblem !== undefined && !probes.sawFile) return refuse('probe-failed', probes.fileProblem)
    if (!probes.sawFile && envSignals.length === 0) {
      return refuse('not-installed', declaration.name + ' is not installed: ' + (files.length > 0 ? files.join(', ') + ' does not exist' : 'the declaration names no installation file') + envNote + unresolvedNote)
    }
    const baseUrl = expandTemplate(declaration.connect.baseUrl, probes.vars, env, home)
    return { adapterId: declaration.id, detected: true, baseUrl, detail: { ...probes.vars }, at }
  }
  if (probes.vars.port === undefined) {
    if (probes.fileProblem !== undefined) return refuse('probe-failed', probes.fileProblem)
    if (!probes.sawFile && envSignals.length === 0) {
      return refuse('not-installed', declaration.name + ' is not installed: ' + (files.length > 0 ? files.join(', ') + ' does not exist' : 'the declaration names no installation file') + envNote + unresolvedNote)
    }
    return refuse('not-running', declaration.name + ' is installed but not serving: ' + (files[0] ?? 'the lock file') + ' names no port' + unresolvedNote)
  }
  const identityOutcome = await fetchIdentity(identity, probes.vars, environment)
  if (!identityOutcome.ok) return refuse(identityOutcome.reasonCode, identityOutcome.message)
  const baseUrl = expandTemplate(declaration.connect.baseUrl, probes.vars, env, home)
  return { adapterId: declaration.id, detected: true, baseUrl, detail: { ...probes.vars }, at }
}
