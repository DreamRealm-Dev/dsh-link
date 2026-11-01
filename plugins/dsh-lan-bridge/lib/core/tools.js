/**
 * Agent-side bridge tools — data plane and control plane.
 *
 * Two families live here, and the split is the whole lifecycle contract:
 *
 *   DATA PLANE (`bridge_status`, `bridge_fs_list`, `bridge_fs_read`,
 *   `bridge_fs_write`, `bridge_fs_edit`, `bridge_shell`) is registered while
 *   `snapshot().toolsAvailable` is true — i.e. while at least one device is
 *   reachable, direct or relayed. Every one of them takes an OPTIONAL `device`
 *   argument and goes through `service.remoteCall(cap, op, args, { device })`,
 *   so one tool drives any machine in the topology and the topology can change
 *   under it without a re-registration.
 *
 *   CONTROL PLANE (`bridge_devices`, `bridge_connect`, `bridge_pair`,
 *   `bridge_approve`, `bridge_disconnect`) is registered while
 *   `snapshot().controlTools` is true. On a headless or 极简模式 host there is no
 *   browser panel at all, so these five tools ARE the user interface: they list
 *   peers, open a link, mint a pairing code, answer a pending request and drop a
 *   link. `bridge_devices`/`bridge_pair` stay ungated because they are read-only
 *   or purely local; the three that change state go through `gate()`.
 *
 * The registry re-assembles the model-facing catalog on every step and the agent
 * loop appends a durable `tool-addition` / `tool-removal` developer message, so a
 * registration edge changes the catalog without losing conversation context and
 * without restarting the session — which is exactly the product requirement.
 *
 * Registration is process-global on purpose: it makes the bridge tools visible
 * to every agent preset (标准模式 native presentation, PTC mode's generated SDK,
 * 创造模式, and 极简模式 alike) without touching any preset composition.
 *
 * Permission inheritance: every handler consults the SESSION's own sandbox mode
 * first, and only falls back to a one-shot approval when the session is not
 * already at full access. `never` then rejects deterministically, so a
 * low-permission session gets a readable refusal instead of a silent bypass.
 *
 * ## Telling local from relayed
 *
 * `service.resolveTarget(device)` is called before every RPC and its result is
 * resolved again through `listTargets()`, so each tool knows the key, the
 * display name, whether the route is `direct` or `relay`, and the relay path.
 * That descriptor is carried in the tool's own output (`device`), and every
 * rendered line names the machine plus `via <hops>` for a relayed one — a model
 * that cannot tell "C, reached through B" from "C here" will happily misreport
 * which filesystem it just wrote.
 */

import { log as rootLog } from './log.js'

const RENDER_TEXT = (text) => [{ type: 'text', text }]

/** Wrap a value and its rendered model-facing text into the mandatory `output`. */
function outputOf(schema, render) {
  return { schema, render }
}

const STR = { type: 'string' }
const NUM = { type: 'number' }
const INT = { type: 'integer' }
const BOOL = { type: 'boolean' }
/** Reused for records whose keys belong to another component (grants, requests). */
const LOOSE = { type: 'object', additionalProperties: true }

/**
 * The shared wording for the `device` argument.
 *
 * The matching rules are `service.resolveTarget`'s, and they are worth stating
 * in the schema because a model that guesses a hostname will get an error that
 * lists the real candidates instead of a call that silently picks the wrong
 * machine.
 */
const DEVICE_DESCRIPTION =
  'Which reachable device to act on; omit when only one is reachable. Matches the device key, its deviceId, its exact ' +
  'name, or a case-insensitive substring of its name. With several devices reachable and this omitted, the call fails ' +
  'and lists them.'

/** One reachable device, as `resolveTarget` describes it. */
const DEVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    key: STR,
    deviceId: STR,
    name: STR,
    kind: { type: 'string', enum: ['direct', 'relay'] },
    hops: INT,
    /** Relay hops between here and the device, nearest first. Empty for a direct peer. */
    path: { type: 'array', items: STR },
  },
}

const DEVICE_PARAM = { ...STR, description: DEVICE_DESCRIPTION }

/**
 * Strip the metadata the renderers need out of one bridge result.
 *
 * `remoteCall` answers with the raw RPC body, so the route belongs to the
 * resolver, not to the reply: this is the single place that copies it into a
 * shape the tool output schemas can declare.
 */
function deviceDescriptor(target) {
  if (target === undefined || target === null) return undefined
  return {
    key: target.key,
    deviceId: target.deviceId,
    name: target.name,
    kind: target.kind === 'relay' ? 'relay' : 'direct',
    hops: typeof target.hops === 'number' ? target.hops : undefined,
    path: Array.isArray(target.path) ? [...target.path] : [],
  }
}

/** `Name (abcdef12)` — the shortest label that is still unambiguous. */
function deviceLabel(device) {
  if (device === undefined || device === null) return 'the peer'
  const name = typeof device.name === 'string' && device.name !== '' ? device.name : device.key
  const key = typeof device.key === 'string' && device.key !== '' ? device.key : device.deviceId
  return key === undefined || key === name ? String(name) : `${name} (${key})`
}

/** The route label used inside a line: `Name (abcdef12), via B`. */
function routeLabel(device) {
  if (device === undefined || device === null) return 'unknown device'
  const hops = Array.isArray(device.path) && device.path.length > 0 ? `, via ${device.path.join(' → ')}` : ''
  return `${deviceLabel(device)}${hops}`
}

/** `@ Name (abcdef12), via B` — appended to every rendered data-plane result. */
function routeSuffix(device) {
  return device === undefined || device === null ? '' : ` @ ${routeLabel(device)}`
}

/**
 * The pairing window as plain JSON.
 *
 * `snapshot().pairing` is the service's LIVE window, and a live window carries an
 * `answer` function; the tool output boundary requires lossless JSON, so this
 * copies only the fields that cross it. `null` becomes `undefined` because the
 * declared property is an object and `null` is not one.
 */
function pairingDescriptor(pairing) {
  if (pairing === null || pairing === undefined) return undefined
  return {
    code: pairing.code,
    pairId: pairing.pairId,
    attemptsLeft: pairing.attemptsLeft,
    expiresAtMs: pairing.expiresAtMs,
    openedAtMs: pairing.openedAtMs,
  }
}

/** One line per reachable device: route, limits, and where it sits in the chain. */
/**
 * One line per reachable device: route, limits, and where it sits in the chain.
 *
 * `since` maps a deviceId to when it became reachable, so a line can read
 * "connected since ..." without inventing a number the snapshot does not carry.
 */
function describeTargets(targets, since = new Map()) {
  return (targets ?? []).map((target) => {
    const grant = target.grant ?? {}
    const route = target.kind === 'relay' ? `relay, ${target.hops ?? '?'} hop(s)` : 'direct'
    const via = Array.isArray(target.path) && target.path.length > 0 ? `, via ${target.path.join(' → ')}` : ''
    const limits = [
      `write ${grant.write === true ? 'yes' : 'no'}`,
      `shell ${grant.shell === true ? 'yes' : 'no'}`,
      `roots ${(grant.roots ?? []).length}`,
    ].join(', ')
    const startedAt = since.get(target.deviceId) ?? since.get(target.key)
    const started = typeof startedAt === 'number' ? `, connected since ${new Date(startedAt).toISOString()}` : ''
    return `- ${target.name} [${target.key}] — ${route}${via}; ${limits}${started}`
  })
}

/** When each device became reachable, from the link that carries it. */
function reachabilityTimes(snapshot) {
  const map = new Map()
  for (const link of snapshot?.links ?? []) {
    if (link.state === 'connected' && typeof link.sinceMs === 'number') map.set(link.deviceId, link.sinceMs)
  }
  return map
}

function describePeers(peers) {
  return (peers ?? []).map((peer) => {
    const relayed = peer.relayDevices > 0 ? `, relays ${peer.relayDevices} device(s)` : ''
    return (
      `- ${peer.name} [${peer.deviceId}] — role ${peer.role ?? 'unknown'}, ` +
      `${peer.accepts === false ? 'not accepting connections' : 'accepting connections'}, ` +
      `${peer.trusted === true ? 'trusted' : 'not trusted'}${peer.connected === true ? ', connected' : ''}${relayed}`
    )
  })
}

function describeLinks(links) {
  return (links ?? []).map(
    (link) =>
      `- ${link.name} [${link.deviceId}] — ${link.state}` +
      `${link.protocolVersion === undefined ? '' : `, protocol v${link.protocolVersion}`}` +
      `${link.sas === undefined ? '' : `, safety code ${link.sas}`}` +
      `${link.error === null || link.error === undefined ? '' : `, error: ${link.error}`}`,
  )
}

function describeSessions(sessions) {
  return (sessions ?? []).map(
    (session) =>
      `- ${session.name} [${session.deviceId}] — ${session.exposes?.length ?? 0} target(s) exposed to it` +
      `${session.sas === undefined ? '' : `, safety code ${session.sas}`}`,
  )
}

/**
 * One line per pending request, safety code included.
 *
 * The SAS is derived from BOTH public keys, so reading it aloud and comparing it
 * with the other machine is the step that turns "someone clicked allow" into
 * "the owner of that key was allowed".
 */
function describeRequests(requests) {
  return (requests ?? []).map(
    (request) =>
      `- ${request.name ?? request.deviceId} [${request.deviceId}] — safety code ${request.sas ?? '?'}, ` +
      `requested ${request.createdAtMs === undefined ? 'now' : new Date(request.createdAtMs).toISOString()}` +
      `${request.expiresAtMs === undefined ? '' : `, ${request.expiresAtMs > Date.now() ? 'answer before' : 'expired at'} ${new Date(request.expiresAtMs).toISOString()}`}`,
  )
}

/**
 * One-shot permission gate shared by every bridge tool.
 *
 * @returns `{ ok: true }` or `{ ok: false, reason }` — never throws, so a
 *   refusal becomes a normal tool error the model can read and act on.
 */
async function gate(ctx, exec, toolName, reason) {
  const agent = exec?.agent
  if (agent === undefined || agent === null) {
    return { ok: false, reason: 'bridge tools require an owning agent session (this call had none)' }
  }
  const session = agent.session
  let mode
  try {
    mode = ctx.get('sandboxPolicy')?.resolve?.({ session })?.mode
  } catch (error) {
    mode = undefined
    rootLog.warn('sandbox policy read failed', error?.message ?? error)
  }
  // Full access already means "this session may touch the machine"; the peer's
  // own grant table is still the authority for what the remote side allows.
  if (mode === 'danger-full-access') return { ok: true }

  const approval = ctx.get('approval')
  if (approval?.request === undefined) {
    return {
      ok: false,
      reason:
        'remote bridge operations need either a full-access session (no approval seam is composed here) — ' +
        'switch this session to the full-access permission preset, or ask the user to compose an approval answerer',
    }
  }
  let outcome
  try {
    outcome = await approval.request({
      agent,
      toolName,
      callId: exec.callId,
      reason,
      signal: exec.signal,
    })
  } catch (error) {
    return { ok: false, reason: `approval channel failed: ${error?.message ?? String(error)}` }
  }
  if (outcome === 'allowed-once') return { ok: true }
  return {
    ok: false,
    reason:
      `remote bridge operation was not approved (${outcome}). ` +
      'The session permission preset still applies to bridge tools; switch it to full access to allow remote work.',
  }
}

/** The live service, or a readable failure. Never throws a bare TypeError. */
function requireService(service) {
  if (service === undefined || service === null) {
    throw new Error('dsh-lan-bridge is not loaded in this host')
  }
  return service
}

/**
 * The live service with at least one reachable device.
 *
 * The trigger is `toolsAvailable` (`targets.length > 0`), NOT "a connection
 * exists": a link can be up while the peer exposes nothing, and a peer can be
 * reachable only through a relay. A rejected promise here means the registration
 * edge is racing a link that just dropped, so the message points at the repair.
 */
function requireTargets(service) {
  const live = requireService(service)
  const snapshot = live.snapshot()
  if (snapshot.toolsAvailable !== true) {
    throw new Error(
      'no device is reachable over the DSH LAN bridge right now. Run bridge_devices to see what is connected, ' +
        'bridge_connect to open a link, or open the sidebar 连接 panel (or disconnect/reconnect if a link just dropped).',
    )
  }
  return live
}

/**
 * Resolve the `device` argument ONCE per call and hand the route to the renderer.
 *
 * Resolving here (rather than letting `remoteCall` do it) is what makes the
 * output name the machine and mark a relayed hop. The result is re-resolved
 * through `listTargets()` so a concurrent topology change cannot label a reply
 * with a stale route; the call itself still goes through `remoteCall`, which
 * performs the authoritative permission checks and the one retry on a moved
 * target.
 */
function resolveDevice(service, requested) {
  const live = requireTargets(service)
  const resolved = live.resolveTarget(requested)
  const fresh = (live.listTargets?.() ?? []).find((target) => target.key === resolved.key) ?? resolved
  return { service: live, target: fresh, selector: fresh.key }
}

/** Build the six data-plane tool definitions. `getService` is a thunk so late mounting works. */
export function defineBridgeTools({ ctx, getService, controlOnly = false }) {
  /**
   * Pick the machine, gate the call, run it, and remember the route so the
   * renderer can name it. `cap` is the negotiated capability; `op` is the
   * handler name on the bridge.
   */
  const call = async (cap, op, args, exec, { device, timeoutMs, action, toolName } = {}) => {
    const service = requireService(getService())
    const gateResult = await gate(ctx, exec, toolName, `${action ?? `${cap}/${op}`} over the DSH LAN bridge`)
    if (!gateResult.ok) throw new Error(gateResult.reason)
    const route = resolveDevice(service, device)
    const value = await route.service.remoteCall(cap, op, args, {
      device: route.selector,
      signal: exec.signal,
      timeoutMs,
      toolName: exec.name,
    })
    return { value, route: route.target }
  }

  const dataTools = [
    {
      name: 'bridge_status',
      description:
        'Report the DSH LAN bridge: this machine\'s side and identity, and EVERY reachable device with its route ' +
        '(direct or relayed), hop count and the grant this machine received (allowed roots, write, shell). Call it ' +
        'before remote file or shell work so the target and its limits are known. Registered whenever the bridge is ' +
        'usable, so it also answers with the reason nothing is reachable.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { device: { ...DEVICE_PARAM, description: `${DEVICE_DESCRIPTION} Also sets which device the round-trip time is measured against.` } },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['connected', 'role'],
          properties: {
            connected: BOOL,
            role: STR,
            // The negotiated protocol is a dotted STRING ("0.2"), not a number.
            protocolVersion: STR,
            /** This machine, so a reply can never be mistaken for the peer's. */
            device: {
              type: 'object',
              additionalProperties: false,
              properties: { deviceId: STR, name: STR, os: STR, arch: STR, port: INT, accepts: BOOL, listenError: STR },
            },
            targets: { type: 'array', items: { ...DEVICE_SCHEMA, additionalProperties: true } },
            links: { type: 'array', items: LOOSE },
            sessions: { type: 'array', items: LOOSE },
            rttMs: NUM,
            note: STR,
          },
        },
        (_args, value) => {
          const local = value.device ?? {}
          const lines = [
            `DSH LAN bridge: ${value.connected === true ? 'usable' : 'no reachable device'} (protocol v${value.protocolVersion}).`,
            `This machine: ${local.name ?? '?'} [${local.deviceId ?? '?'}] — role ${value.role}, ${local.os ?? '?'}/${local.arch ?? '?'}, ` +
              `listening on ${local.port ?? '-'} (${local.accepts === true ? 'accepting connections' : 'not accepting'}).`,
          ]
          if (value.connected !== true) {
            lines.push(value.note ?? 'Run bridge_devices to see discovered peers, or bridge_connect to open a link.')
            return RENDER_TEXT(lines.join('\n'))
          }
          lines.push(
            `Reachable devices (${value.targets?.length ?? 0}):`,
            ...describeTargets(value.targets, reachabilityTimes(value)),
            `Round trip: ${typeof value.rttMs === 'number' ? `${Math.round(value.rttMs)} ms` : 'n/a'}.`,
          )
          if (value.note !== undefined) lines.push(value.note)
          return RENDER_TEXT(lines.join('\n'))
        },
      ),
      async execute(args, exec) {
        const gateResult = await gate(ctx, exec, 'bridge_status', 'read the DSH LAN bridge state and its devices')
        if (!gateResult.ok) throw new Error(gateResult.reason)
        const service = requireService(getService())
        const snapshot = service.snapshot()
        const targets = snapshot.targets ?? []
        // Ping only when there is exactly one device: with several there is no
        // single honest round-trip number, and pinging all of them would turn a
        // status read into N remote calls.
        let rttMs
        let note
        if (targets.length === 1) {
          try {
            rttMs = await service.ping(targets[0].key, 2000)
          } catch (error) {
            rttMs = undefined
            note = `the reachable device did not answer a ping: ${error?.message ?? String(error)}`
          }
        } else if (targets.length > 1) {
          note = `${targets.length} devices are reachable; pass "device" to measure one round trip or to target an operation.`
        } else {
          note = 'Run bridge_devices to see discovered peers, or bridge_connect to open a link.'
        }
        return {
          connected: targets.length > 0,
          role: snapshot.role,
          protocolVersion: snapshot.protocolVersion,
          device: {
            deviceId: snapshot.deviceId,
            name: snapshot.deviceName,
            os: snapshot.os,
            arch: snapshot.arch,
            port: snapshot.port,
            accepts: snapshot.accepts === true,
            listenError: snapshot.listenError === null ? undefined : snapshot.listenError,
          },
          targets,
          links: snapshot.links,
          sessions: snapshot.sessions,
          rttMs,
          note,
        }
      },
    },

    {
      name: 'bridge_fs_list',
      description:
        'List a directory ON A REACHABLE DEVICE (not this machine). Returns entries with type and size. ' +
        'Paths are resolved and confined to the roots that device granted. If the device was reached through ' +
        'another machine the result says so.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { ...STR, description: 'Directory to list on the target device, absolute or relative to its grant root.' },
          device: DEVICE_PARAM,
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'entries'],
          properties: {
            path: STR,
            truncated: BOOL,
            device: DEVICE_SCHEMA,
            entries: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: { name: STR, type: STR, size: INT, mtimeMs: NUM },
              },
            },
          },
        },
        (_args, value) => {
          const rows = (value.entries ?? []).map(
            (e) => `${e.type === 'dir' ? 'd' : e.type === 'link' ? 'l' : '-'} ${String(e.size ?? 0).padStart(8)} ${e.name}`,
          )
          const head = `${value.path}${routeSuffix(value.device)}: ${(value.entries ?? []).length} entries${value.truncated === true ? ' (truncated)' : ''}`
          return RENDER_TEXT([head, ...rows].join('\n'))
        },
      ),
      async execute(args, exec) {
        const { value, route } = await call('fs.list', 'list', { path: args.path }, exec, {
          device: args.device,
          toolName: 'bridge_fs_list',
          action: `list a directory on the remote device (${args.path})`,
        })
        return { ...value, device: deviceDescriptor(route) }
      },
    },

    {
      name: 'bridge_fs_read',
      description:
        'Read a text file ON A REACHABLE DEVICE (not this machine). Returns the content plus the total line count. ' +
        'Use offset/limit for large files. Paths are confined to the roots that device granted.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { ...STR, description: 'File to read on the target device.' },
          offset: { type: 'integer', description: '1-based first line to return. Defaults to 1.' },
          limit: { type: 'integer', description: 'Maximum number of lines to return. Defaults to 2000.' },
          device: DEVICE_PARAM,
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'content'],
          properties: {
            path: STR,
            content: STR,
            offset: INT,
            totalLines: INT,
            truncated: BOOL,
            device: DEVICE_SCHEMA,
          },
        },
        (_args, value) => {
          const head = `${value.path}${routeSuffix(value.device)} (lines ${value.offset ?? 1}+ of ${value.totalLines ?? '?'}${value.truncated === true ? ', truncated' : ''})`
          return RENDER_TEXT(`${head}\n${value.content ?? ''}`)
        },
      ),
      async execute(args, exec) {
        const { value, route } = await call(
          'fs.read',
          'read',
          { path: args.path, offset: args.offset, limit: args.limit },
          exec,
          { device: args.device, toolName: 'bridge_fs_read', action: `read a file on the remote device (${args.path})` },
        )
        return { ...value, device: deviceDescriptor(route) }
      },
    },

    {
      name: 'bridge_fs_write',
      description:
        'Create or overwrite a text file ON A REACHABLE DEVICE (not this machine). Requires that device to have ' +
        'granted write access. Write with a temporary sibling then rename, or use bridge_fs_edit for in-place changes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'content'],
        properties: {
          path: { ...STR, description: 'File to write on the target device.' },
          content: { ...STR, description: 'Full file content to write.' },
          device: DEVICE_PARAM,
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'bytes'],
          properties: { path: STR, bytes: INT, created: BOOL, device: DEVICE_SCHEMA },
        },
        (_args, value) =>
          RENDER_TEXT(`${value.created === true ? 'Created' : 'Overwrote'} ${value.path}${routeSuffix(value.device)} (${value.bytes} bytes).`),
      ),
      async execute(args, exec) {
        const { value, route } = await call(
          'fs.write',
          'write',
          { path: args.path, content: args.content },
          exec,
          { device: args.device, toolName: 'bridge_fs_write', action: `write a file on the remote device (${args.path})` },
        )
        return { ...value, device: deviceDescriptor(route) }
      },
    },

    {
      name: 'bridge_fs_edit',
      description:
        'Replace an exact string inside a text file ON A REACHABLE DEVICE (not this machine). Same semantics as the ' +
        'local edit tool: old_string must match exactly and must be unique unless replace_all is true. Requires write ' +
        'access. Prefer this over bridge_fs_write for targeted changes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'old_string', 'new_string'],
        properties: {
          path: { ...STR, description: 'File to edit on the target device.' },
          old_string: { ...STR, description: 'Exact text to replace. Must be unique in the file unless replace_all is true.' },
          new_string: { ...STR, description: 'Replacement text. Empty string deletes the match.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence. Defaults to false.' },
          device: DEVICE_PARAM,
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'replaced'],
          properties: { path: STR, replaced: INT, totalLines: INT, device: DEVICE_SCHEMA },
        },
        (_args, value) => RENDER_TEXT(`Edited ${value.path}${routeSuffix(value.device)} — ${value.replaced} replacement(s).`),
      ),
      async execute(args, exec) {
        const { value, route } = await call(
          'fs.edit',
          'edit',
          { path: args.path, oldString: args.old_string, newString: args.new_string, replaceAll: args.replace_all === true },
          exec,
          { device: args.device, toolName: 'bridge_fs_edit', action: `edit a file on the remote device (${args.path})` },
        )
        return { ...value, device: deviceDescriptor(route) }
      },
    },

    {
      name: 'bridge_shell',
      description:
        'Run a shell command ON A REACHABLE DEVICE (not this machine) and return its exit code, stdout and stderr. ' +
        'Only available when that device granted shell access. Windows targets run the command through PowerShell, ' +
        'macOS/Linux targets through /bin/sh. Standard output is capped; long-running commands are killed on timeout.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['command'],
        properties: {
          command: { ...STR, description: 'Command line to execute on the target device.' },
          cwd: { ...STR, description: 'Working directory on the target device. Defaults to its granted root.' },
          timeoutMs: { type: 'integer', description: 'Kill the command after this many milliseconds.' },
          device: DEVICE_PARAM,
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['exitCode'],
          properties: {
            exitCode: INT,
            signal: STR,
            stdout: STR,
            stderr: STR,
            truncated: BOOL,
            durationMs: NUM,
            cwd: STR,
            device: DEVICE_SCHEMA,
          },
        },
        (_args, value) => {
          const parts = [
            `${routeLabel(value.device)} — exit ${value.exitCode}${value.signal === undefined ? '' : ` (${value.signal})`} in ${Math.round(value.durationMs ?? 0)} ms`,
          ]
          if (value.cwd !== undefined) parts.push(`cwd: ${value.cwd}`)
          if (value.stdout !== undefined && value.stdout !== '') parts.push(`--- stdout ---\n${value.stdout}`)
          if (value.stderr !== undefined && value.stderr !== '') parts.push(`--- stderr ---\n${value.stderr}`)
          if (value.truncated === true) parts.push('(output truncated)')
          return RENDER_TEXT(parts.join('\n'))
        },
      ),
      async execute(args, exec) {
        const { value, route } = await call(
          'shell.exec',
          'exec',
          { command: args.command, cwd: args.cwd, timeoutMs: args.timeoutMs },
          exec,
          {
            device: args.device,
            timeoutMs: args.timeoutMs,
            toolName: 'bridge_shell',
            action: `run a shell command on the remote device (${args.command})`,
          },
        )
        return { ...value, device: deviceDescriptor(route) }
      },
    },
  ]

  const controlTools = [
    {
      name: 'bridge_devices',
      description:
        'List the DSH LAN bridge topology from this machine: discovered peers (role, whether each accepts connections, ' +
        'trust), outbound links, inbound sessions, devices this machine can call, and any connection request waiting ' +
        'for a human answer. Read-only and local: it never touches the network. Run it first on a headless host, then ' +
        'bridge_connect / bridge_pair / bridge_approve as needed.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['role'],
          properties: {
            role: STR,
            accepts: BOOL,
            discoverable: BOOL,
            port: INT,
            device: {
              type: 'object',
              additionalProperties: false,
              properties: { deviceId: STR, name: STR, os: STR, arch: STR },
            },
            peers: { type: 'array', items: LOOSE },
            links: { type: 'array', items: LOOSE },
            sessions: { type: 'array', items: LOOSE },
            targets: { type: 'array', items: LOOSE },
            requests: { type: 'array', items: LOOSE },
            pairing: LOOSE,
          },
        },
        (_args, value) => {
          const local = value.device ?? {}
          const lines = [
            `This machine: ${local.name ?? '?'} [${local.deviceId ?? '?'}] — role ${value.role}, ${local.os ?? '?'}/${local.arch ?? '?'}, ` +
              `port ${value.port ?? '-'}, ${value.accepts === true ? 'listening for inbound connections' : 'not listening (open a pairing window or set 桥接侧)'}.`,
          ]
          const peers = describePeers(value.peers)
          lines.push(`Discovered peers (${peers.length}):`, ...(peers.length === 0 ? ['- none yet; run a probe or connect by host:port'] : peers))
          const links = describeLinks(value.links)
          lines.push(`Outbound links (${links.length}):`, ...(links.length === 0 ? ['- none'] : links))
          const sessions = describeSessions(value.sessions)
          lines.push(`Inbound sessions (${sessions.length}):`, ...(sessions.length === 0 ? ['- none'] : sessions))
          const targets = describeTargets(value.targets)
          lines.push(`Reachable devices (${targets.length}):`, ...(targets.length === 0 ? ['- none'] : targets))
          const requests = describeRequests(value.requests)
          lines.push(
            `Pending requests (${requests.length}):`,
            ...(requests.length === 0
              ? ['- none']
              : [...requests, 'Compare the safety code out of band before bridge_approve decision "allow".']),
          )
          if (value.pairing !== null && value.pairing !== undefined) {
            lines.push(`Pairing window: code ${value.pairing.code}, expires ${new Date(value.pairing.expiresAtMs).toISOString()}.`)
          }
          return RENDER_TEXT(lines.join('\n'))
        },
      ),
      async execute() {
        const service = requireService(getService())
        const snapshot = service.snapshot()
        return {
          role: snapshot.role,
          accepts: snapshot.accepts === true,
          discoverable: snapshot.discoverable === true,
          port: snapshot.port,
          device: {
            deviceId: snapshot.deviceId,
            name: snapshot.deviceName,
            os: snapshot.os,
            arch: snapshot.arch,
          },
          peers: snapshot.peers ?? [],
          links: snapshot.links ?? [],
          sessions: snapshot.sessions ?? [],
          targets: snapshot.targets ?? [],
          requests: snapshot.requests ?? [],
          pairing: pairingDescriptor(snapshot.pairing),
        }
      },
    },

    {
      name: 'bridge_connect',
      description:
        'Open a link to another machine from this one. Give deviceId for a discovered peer, or host+port for a manual ' +
        'address (the reliable path when multicast discovery is blocked). Pass code when the other machine has a ' +
        'pairing window open and this machine has never been approved there. THIS BLOCKS while the other machine\'s ' +
        'user decides — the first pairing can take up to about two minutes — so tell the user to answer 同意 there ' +
        'before calling it. A second device is ADDED; an existing link is never replaced by a different one.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deviceId: { ...STR, description: 'A discovered peer\'s deviceId (from bridge_devices). Omit when using host+port.' },
          host: { ...STR, description: 'Manual address of the other machine. Use with port.' },
          port: { type: 'integer', description: 'TCP port the other machine listens on (default 47654). Use with host.' },
          code: { ...STR, description: 'The 6-digit pairing code shown on the other machine, when it has a pairing window open.' },
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['connected'],
          properties: {
            connected: BOOL,
            deviceId: STR,
            name: STR,
            state: STR,
            protocolVersion: STR,
            trust: STR,
            sas: STR,
            grant: LOOSE,
            targets: { type: 'array', items: LOOSE },
            notice: STR,
          },
        },
        (_args, value) => {
          const lines = [
            `Connected to ${value.name ?? value.deviceId ?? 'the peer'} [${value.deviceId ?? '?'}] — protocol v${value.protocolVersion ?? '?'}, trust ${value.trust ?? 'unknown'}, safety code ${value.sas ?? '?'}.`,
            `Devices now reachable from here: ${(value.targets ?? []).map((t) => t.name).join(', ') || '(none)'}.`,
          ]
          if (value.notice !== undefined) lines.push(value.notice)
          return RENDER_TEXT(lines.join('\n'))
        },
      ),
      async execute(args, exec) {
        const gateResult = await gate(
          ctx,
          exec,
          'bridge_connect',
          `open a connection to another machine on the LAN (${args.deviceId ?? `${args.host}:${args.port}`})`,
        )
        if (!gateResult.ok) throw new Error(gateResult.reason)
        const service = requireService(getService())
        const deviceId = typeof args.deviceId === 'string' && args.deviceId.trim() !== '' ? args.deviceId.trim() : undefined
        const host = typeof args.host === 'string' && args.host.trim() !== '' ? args.host.trim() : undefined
        const port = Number.isFinite(args.port) ? args.port : undefined
        const code = typeof args.code === 'string' && args.code.trim() !== '' ? args.code.trim() : undefined
        if (deviceId === undefined && host === undefined) {
          throw new Error(
            'bridge_connect needs either deviceId (a discovered peer from bridge_devices) or host+port (a manual address).',
          )
        }
        if (host !== undefined && port === undefined && deviceId === undefined) {
          throw new Error('bridge_connect needs a port alongside host — the other machine listens on 47654 by default.')
        }
        let record
        try {
          record = await service.connect({ deviceId, host, port, code }, { automatic: false })
        } catch (error) {
          const detail = error?.message ?? String(error)
          throw new Error(
            `${detail} The other machine has to be accepting connections: set it to 桥接侧, or open a pairing window ` +
              'there and pass its 6-digit code as "code". This call waits for that user\'s decision (up to about two minutes).',
          )
        }
        const snapshot = service.snapshot()
        return {
          connected: record.state === 'connected',
          deviceId: record.deviceId ?? deviceId,
          name: record.peerName,
          state: record.state,
          protocolVersion: record.protocolVersion,
          trust: record.trust,
          sas: record.sas,
          grant: record.grant === null ? undefined : record.grant,
          targets: snapshot.targets ?? [],
          notice:
            'Data-plane tools for this device are available from the next step (the tool catalog is re-assembled per step). ' +
            'Use bridge_disconnect to drop it.',
        }
      },
    },

    {
      name: 'bridge_pair',
      description:
        'Open (or reuse) a pairing window on THIS machine and return the 6-digit code to hand to the other machine\'s ' +
        'user, plus when it expires. This is how a terminal-only or headless host gets a code with no browser panel. ' +
        'Also starts the inbound listener, so this machine accepts a connection afterwards. Local and read-only: it ' +
        'needs no permission prompt.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: {
            code: STR,
            expiresAtMs: NUM,
            attemptsLeft: INT,
            accepts: BOOL,
            role: STR,
            port: INT,
            notice: STR,
          },
        },
        (_args, value) => {
          const lines = [
            `Pairing window open on this machine — code ${value.code}, valid until ${new Date(value.expiresAtMs).toISOString()} (${value.attemptsLeft ?? '?'} attempt(s) left).`,
            `This machine is now ${value.accepts === true ? `accepting connections on port ${value.port}` : 'still NOT accepting connections'} (role ${value.role}).`,
          ]
          if (value.notice !== undefined) lines.push(value.notice)
          return RENDER_TEXT(lines.join('\n'))
        },
      ),
      async execute() {
        const service = requireService(getService())
        let pairing
        try {
          pairing = service.openPairingWindow(false)
        } catch (error) {
          throw new Error(`could not open a pairing window: ${error?.message ?? String(error)}`)
        }
        const snapshot = service.snapshot()
        return {
          code: pairing.code,
          expiresAtMs: pairing.expiresAtMs,
          attemptsLeft: pairing.attemptsLeft,
          accepts: snapshot.accepts === true,
          role: snapshot.role,
          port: snapshot.port,
          notice:
            'Give this code to the other machine\'s user; codes are single-use. When their machine connects, this ' +
            'machine\'s user answers with bridge_approve (compare the safety codes out of band first).',
        }
      },
    },

    {
      name: 'bridge_approve',
      description:
        'Answer a connection request that is waiting on THIS machine — the same decision the panel\'s approval card ' +
        'makes. Compare the safety code (sas, shown by bridge_devices) with the other machine out of band first: it is ' +
        'derived from both public keys, so a match is what proves there is no machine in the middle. Without deviceId ' +
        'it decides the only pending request. "deny" rejects the peer; "allow" also sets what it may do.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['allow', 'deny'] },
          deviceId: { ...STR, description: 'Which pending request. Omit to decide the only one that is waiting.' },
          grant: {
            // A grant belongs to policy.js and is allowed to grow (cwdRoot,
            // createDirs, relay, relayPeers, ...), so it is permissive on purpose.
            type: 'object',
            additionalProperties: true,
            description: 'Grant to apply when allowing. Defaults to the request\'s defaultGrant.',
            properties: {
              roots: { type: 'array', items: STR },
              cwdRoot: STR,
              write: BOOL,
              shell: BOOL,
              createDirs: BOOL,
              relay: BOOL,
              timeoutMs: INT,
              maxOutputBytes: INT,
            },
          },
          remember: { type: 'boolean', description: 'Persist the grant and the trust decision. Defaults to true.' },
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['decision'],
          properties: { decision: STR, deviceId: STR, sharing: BOOL, notice: STR },
        },
        (_args, value) => {
          const lines = [
            `${value.decision === 'allow' ? 'Allowed' : 'Denied'} ${value.deviceId ?? 'the pending request'}.`,
          ]
          if (value.notice !== undefined) lines.push(value.notice)
          return RENDER_TEXT(lines.join('\n'))
        },
      ),
      async execute(args, exec) {
        const gateResult = await gate(
          ctx,
          exec,
          'bridge_approve',
          `answer a remote device's connection request with "${args.decision}"`,
        )
        if (!gateResult.ok) throw new Error(gateResult.reason)
        const service = requireService(getService())
        const decision = args.decision === 'allow' ? 'allow' : 'deny'
        const deviceId = typeof args.deviceId === 'string' && args.deviceId.trim() !== '' ? args.deviceId.trim() : undefined
        let result
        try {
          result = service.decideRequest({
            deviceId,
            decision,
            grant: args.grant,
            remember: args.remember !== false,
          })
        } catch (error) {
          throw new Error(
            `${error?.message ?? String(error)} Run bridge_devices to list the requests that are waiting.`,
          )
        }
        return {
          decision: result.decided,
          deviceId: result.deviceId,
          sharing: decision === 'allow',
          notice:
            decision === 'allow'
              ? 'The grant is in force for that device and the peer is connecting. Data-plane tools appear from the next step.'
              : 'The peer was rejected; it will have to pair again with a fresh code.',
        }
      },
    },

    {
      name: 'bridge_disconnect',
      description:
        'Drop a bridge connection. With deviceId it drops that device (an outbound link, or an inbound session when ' +
        'that is what the device has); without it, every link this machine holds is dropped. Inbound sessions held by ' +
        'other machines need deviceId — this tool will not silently drop a peer that is driving this machine.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deviceId: { ...STR, description: 'Device to disconnect. Omit to drop every outbound link this machine holds.' },
        },
      },
      output: outputOf(
        {
          type: 'object',
          additionalProperties: false,
          required: ['summary'],
          properties: {
            summary: STR,
            deviceId: STR,
            scope: { type: 'string', enum: ['device', 'all-links'] },
            remaining: { type: 'array', items: LOOSE },
          },
        },
        (_args, value) => {
          const remaining = (value.remaining ?? []).map((link) => `${link.name ?? link.deviceId} [${link.state}]`)
          return RENDER_TEXT(
            `${value.summary} Remaining links: ${remaining.length === 0 ? 'none' : remaining.join(', ')}. ` +
              'Data-plane tools are withdrawn when the last reachable device goes away.',
          )
        },
      ),
      async execute(args, exec) {
        const gateResult = await gate(
          ctx,
          exec,
          'bridge_disconnect',
          args.deviceId === undefined ? 'drop every bridge link this machine holds' : `disconnect ${args.deviceId}`,
        )
        if (!gateResult.ok) throw new Error(gateResult.reason)
        const service = requireService(getService())
        const deviceId = typeof args.deviceId === 'string' && args.deviceId.trim() !== '' ? args.deviceId.trim() : undefined

        if (deviceId === undefined) {
          // `disconnect()` with NO argument is the "every link" form; passing an
          // empty string would make it look for a device named ''.
          const result = await service.disconnect()
          return {
            summary: 'Dropped every outbound link this machine held.',
            scope: 'all-links',
            remaining: result?.links ?? [],
          }
        }

        const snapshot = service.snapshot()
        const nameOf = (id) => snapshot.links?.find((link) => link.deviceId === id)?.name ?? id
        let linkError
        let droppedLink = false
        try {
          await service.disconnect(deviceId)
          droppedLink = true
        } catch (error) {
          linkError = error?.message ?? String(error)
        }
        if (!droppedLink) {
          try {
            await service.disconnectPeer(deviceId)
          } catch {
            throw new Error(
              `${deviceId} has neither an outbound link nor an inbound session here` +
                `${linkError === undefined ? '' : ` (${linkError})`}. Run bridge_devices for the current topology.`,
            )
          }
        }
        const after = service.snapshot()
        return {
          summary: droppedLink
            ? `Disconnected ${nameOf(deviceId)} [${deviceId}] (outbound link).`
            : `Disconnected ${nameOf(deviceId)} [${deviceId}] (inbound session).`,
          deviceId,
          scope: 'device',
          remaining: after.links ?? [],
        }
      },
    },
  ]

  return controlOnly === true ? controlTools : dataTools
}

/** The data plane: registered while at least one device is reachable. */
export const BRIDGE_TOOL_NAMES = Object.freeze([
  'bridge_status',
  'bridge_fs_list',
  'bridge_fs_read',
  'bridge_fs_write',
  'bridge_fs_edit',
  'bridge_shell',
])

/**
 * The control plane: registered while `snapshot().controlTools` is true.
 *
 * On a headless or 极简模式 host these five tools are the entire user interface,
 * which is why they are a separate family with a separate registration trigger.
 */
export const BRIDGE_CONTROL_TOOL_NAMES = Object.freeze([
  'bridge_devices',
  'bridge_connect',
  'bridge_pair',
  'bridge_approve',
  'bridge_disconnect',
])
