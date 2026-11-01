/**
 * The «dsh-v0.2.1-alpha.1» section of the compat table.
 *
 * Every surface fact here was read from the archived document
 * «compat/surface/0.2.1-alpha.1.json», whose SHA-256 this section is bound to, so
 * the evidence cannot drift under the table. Every earlier-side fact was read from
 * a «0.1.1-rc.2» checkout, named by path and line.
 *
 * Roles are neutral («http.registerRoute»); the kernel member a role binds to on
 * this kernel is the only place a method name appears. No row carries behaviour: a
 * row records a binding, a mapping, or a refusal.
 *
 * The section is data. Adding the next kernel is adding one file of the same shape
 * and nothing else; the resolver in «compat/engine.ts» is version-blind.
 */
import type { CompatTable } from '../types.ts'

/** Archived surface this section describes. */
const SURFACE = 'compat/surface/0.2.1-alpha.1.json'

/** The earlier kernel every refusal's earlier side was read from. */
const EARLIER = '0.1.1-rc.2'

export const table: CompatTable = {
  kernel: 'dsh-v0.2.1-alpha.1',
  packageVersion: '0.2.1-alpha.1',
  commit: '5badb15',
  previousKernel: EARLIER,
  surface: {
    file: SURFACE,
    sha256: '2212e58e56132fbceb4a370c9a0468cd99896b479c452810c1a3df11023ced2c',
    // What the archived document says the composition was. A surface is a snapshot of a
    // kernel AND the plugin set mounted into it, so mounting one more plugin changes it
    // without changing the kernel: the counts below are what makes that visible instead of
    // letting a stale archive keep passing. Recapture with scripts/probe-kernel-surface.mjs,
    // re-archive with scripts/archive-surface.mjs, then update all three numbers here.
    composition: {
      declaredProperties: 122,
      reachableServices: 93,
      events: 78,
    },
  },
  roots: ['http', 'store', 'tools', 'settings', 'workspace', 'shell', 'team', 'agent', 'skill', 'telemetry', 'link'],
  notes: [
    'Surface: ' + SURFACE + ' (122 declared context properties, 93 reachable services, 78 event names, tools contract measured),',
    'produced by scripts/probe-kernel-surface.mjs against the pinned checkout core/deepseek-harness and archived by scripts/archive-surface.mjs.',
    'Roles: docs/handoff/R1-capability-vocabulary.md (revision 2, role-worded). Refusals: docs/research/01-upgrade-surface.md items B4, B5, B10,',
    'each re-derived against the 0.1.1-rc.2 checkout rather than inherited from that record.',
  ].join(' '),
  capabilities: {
    store: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['store.listSessions', 'store.readSession'],
      targets: [
        { service: 'sessions', binds: [{ role: 'store.listSessions', member: 'list' }], evidence: SURFACE + ' services.sessions' },
        {
          service: 'sessionPersistence',
          binds: [{ role: 'store.readSession', member: 'readStoredLog' }],
          evidence: SURFACE + ' services.sessionPersistence — the read entry on this kernel; there is no member called read',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.1',
    },
    tools: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['tools.register', 'tools.lookup', 'tools.schemas'],
      targets: [
        {
          service: 'tools',
          binds: [
            { role: 'tools.register', member: 'register' },
            { role: 'tools.lookup', member: 'get' },
            { role: 'tools.schemas', member: 'schemas' },
          ],
          evidence: SURFACE + ' services.tools — 39 members, of which these three are the ones the capability promises',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.2',
      suggestion: 'register through the tools service; the simplified call is ctx.link.compat.capability("tools").register',
    },
    settings: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['settings.schema', 'settings.update', 'settings.describe'],
      targets: [
        {
          service: 'settings',
          binds: [
            { role: 'settings.schema', member: 'schema' },
            { role: 'settings.update', member: 'update' },
            { role: 'settings.describe', member: 'describe' },
          ],
          evidence: SURFACE + ' services.settings (SettingsForms)',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.3',
    },
    workspace: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['workspace.listFiles', 'workspace.readFile', 'workspace.statFile'],
      targets: [
        {
          service: 'workspaceFiles',
          binds: [
            { role: 'workspace.listFiles', member: 'list' },
            { role: 'workspace.readFile', member: 'read' },
            { role: 'workspace.statFile', member: 'stat' },
          ],
          evidence: SURFACE + ' services.workspaceFiles — the main file entry; services.fs has three members only',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.4',
    },
    shell: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['shell.run', 'shell.resolveCommand'],
      targets: [
        {
          service: 'shell',
          binds: [
            { role: 'shell.run', member: 'execute' },
            { role: 'shell.resolveCommand', member: 'resolve' },
          ],
          evidence: SURFACE + ' services.shell (SandboxPwshExecutor); sandboxMode is a field, not a member',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.5',
    },
    http: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['http.registerRoute', 'http.renderIndex'],
      targets: [
        {
          service: 'webServer',
          binds: [
            { role: 'http.registerRoute', member: 'register' },
            { role: 'http.renderIndex', member: 'renderIndex' },
          ],
          evidence: SURFACE + ' services.webServer (WebServer, fields host/port)',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.6 — the httpServer to webServer rename of the research did not happen here: the earlier 0.1.1-rc.2 checkout also declares webServer (<workspace>/-studio/vendor/deepseek-harness/packages/host/webserver/lib/types/index.d.ts:19), so no translation row is justified yet',
    },
    team: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['team.createMember', 'team.sendMessage', 'team.createTask', 'team.updateTask', 'team.listTasks', 'team.waitForChange'],
      targets: [
        {
          service: 'agentTeams',
          binds: [
            { role: 'team.createMember', member: 'spawnTeammate' },
            { role: 'team.sendMessage', member: 'sendMessage' },
            { role: 'team.createTask', member: 'createTask' },
            { role: 'team.updateTask', member: 'updateTask' },
            { role: 'team.listTasks', member: 'listTasks' },
            { role: 'team.waitForChange', member: 'waitForChange' },
          ],
          evidence: SURFACE + ' services.agentTeams (TeamService, 14 members); lifecycle internals disposeRuntime/scheduleRecovery are deliberately not promised',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.7',
    },
    agent: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['agent.start', 'agent.prompt', 'agent.sendMessage'],
      targets: [
        {
          service: 'subagents',
          binds: [
            { role: 'agent.start', member: 'start' },
            { role: 'agent.prompt', member: 'prompt' },
            { role: 'agent.sendMessage', member: 'sendMessage' },
          ],
          evidence: SURFACE + ' services.subagents (SubagentRuntime, 19 members)',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.8',
    },
    skill: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['skill.list', 'skill.get'],
      targets: [
        {
          service: 'skills',
          binds: [
            { role: 'skill.list', member: 'list' },
            { role: 'skill.get', member: 'get' },
          ],
          evidence: SURFACE + ' services.skills (SkillRegistry)',
        },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.9',
    },
    telemetry: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['telemetry.emit'],
      targets: [
        { service: 'sessionTelemetry', binds: [{ role: 'telemetry.emit', member: 'emit' }], evidence: SURFACE + ' services.sessionTelemetry (two members only; the most easily renamed service in the set)' },
      ],
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.10',
    },
    link: {
      disposition: 'resolve',
      kind: 'passthrough',
      roles: ['link.capability', 'link.has', 'link.require', 'link.report', 'link.services'],
      targets: [],
      self: true,
      providedBy: 'dsh-link-compat',
      evidence: 'docs/handoff/R1-capability-vocabulary.md section 4.11 — the loader answers for itself, so this row needs no kernel support',
    },
    'agent.childRows': {
      disposition: 'translate',
      kind: 'field-rename',
      roles: ['agent.childRows'],
      targets: [
        { service: 'subagents', binds: [{ role: 'agent.childRows', member: 'listChildren' }], evidence: SURFACE + ' services.subagents.listChildren' },
      ],
      translation: { from: 'kind', to: 'mode' },
      evidence: 'docs/research/01-upgrade-surface.md:156-178 (B3, rename) and plugins/dsh-agent-context/lib/current.js:213-226 — the entries stopped carrying kind and carry { mode, label } instead; the meaning survives, so a mapping is safe',
    },
    'agent.presets': {
      disposition: 'translate',
      kind: 'carrier-relocation',
      roles: ['agent.declarePreset', 'agent.listPresets'],
      targets: [
        {
          service: 'agentPresets',
          binds: [
            { role: 'agent.declarePreset', member: 'register' },
            { role: 'agent.listPresets', member: 'list' },
          ],
          evidence: SURFACE + ' services.agentPresets (AgentPresetRegistry)',
        },
      ],
      translation: { from: 'directory', to: 'declarationRow' },
      evidence: 'docs/research/01-upgrade-surface.md:76-112 (B1, relocation) — the preset composition is unchanged and its carrier moved, so the row is a carrier mapping, provable by comparing the two documents',
    },
  },
  refused: {
    'settings.liveWrite': {
      disposition: 'refuse',
      class: 'semantic-changed',
      reason: 'a field being present in a settings schema no longer means it can be written at runtime: only fields the owning row declared with .volatile() accept a write, and a write to any other field is rejected. The schema is byte-identical across the change, so a name-keyed table would resolve a capability that then silently refuses every write.',
      suggestion: 'declare volatility yourself on your own profile row (the facade member the vocabulary calls settings.define), or move the value into the row config the settings form owns; do not read or write the namespace of another row.',
      evidenceRefs: [{ path: 'docs/research/01-upgrade-surface.md', line: 181, contains: 'B4' }],
      evidence: 'docs/research/01-upgrade-surface.md:181-234 (B4), re-derived here: core/deepseek-harness/packages/settings/settings/src/index.ts:388 rejects a non-volatile path, and .../settings/src/schema.ts:37-47 defines the predicate',
      wasThere: {
        kernel: EARLIER,
        path: 'packages/settings/settings/src/index.ts',
        line: 578,
        contains: 'private write(',
        fact: 'the earlier settings service wrote whatever path the caller named; searching that whole package for "volatile" returns nothing, so there was no gate to satisfy',
      },
      changedAt: {
        kernel: 'dsh-v0.2.1-alpha.1',
        path: 'core/deepseek-harness/packages/settings/settings/src/index.ts',
        line: 388,
        contains: 'is not volatile',
        fact: 'this kernel throws before writing unless every path lies under a volatile declaration',
      },
      discriminator: {
        introduced: 'isVolatilePath',
        presentAt: { path: 'core/deepseek-harness/packages/settings/settings/src/index.ts', line: 388 },
        absentIn: 'packages/settings/settings/src/index.ts',
        note: 'the gate is the token isVolatilePath; if this kernel stopped carrying it on that line, or the earlier kernel started carrying it, the two sides would no longer describe a change',
      },
      witness: [
        { claim: 'service-present', service: 'settings', because: 'the capability is asked for by name and the service is still called settings, which is exactly why a name-keyed table would let it through' },
        { claim: 'member-present', service: 'settings', member: 'schema', because: 'the schema is still published, so a caller can still read the field list and believe it is writable' },
        { claim: 'member-matching-absent', service: 'settings', pattern: 'volatile|writable', because: 'nothing on the settings service expresses per-field volatility; if a member ever does, this refusal must be re-decided' },
      ],
    },
    'tools.escalation': {
      disposition: 'refuse',
      class: 'semantic-changed',
      reason: 'the same field name sandbox_permissions kept its name and changed its contract: repeating the effective mode used to throw, and this kernel returns it. The correct handling is to catch a specific error, change the call arguments and retry on a seam where the retry provably has no side effect — behaviour a table has no field to express, and where either mechanical mapping (always drop, always pass through) restores a defect.',
      suggestion: 'wrap tools/execute exactly as plugins/dsh-escalation-guard does: catch the marker error, delete args.sandbox_permissions, retry next() once.',
      evidenceRefs: [{ path: 'docs/research/01-upgrade-surface.md', line: 237, contains: 'B5' }],
      evidence: 'docs/research/01-upgrade-surface.md:237-271 (B5), re-derived here: the earlier escalation resolver threw for a request that was not strictly wider, and this kernel returns early when the request repeats the effective mode',
      wasThere: {
        kernel: EARLIER,
        path: 'packages/sandbox/sandbox/src/escalation.ts',
        line: 162,
        contains: 'WIDER_MODES[effectiveMode]',
        fact: 'the earlier resolver compared the request against the strictly-wider table and threw otherwise; an equal mode is not in that table, so it threw',
      },
      changedAt: {
        kernel: 'dsh-v0.2.1-alpha.1',
        path: 'core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts',
        line: 173,
        contains: 'if (mode === effectiveMode) return effectiveMode',
        fact: 'this kernel returns the effective mode before the strictly-wider check, so the identical call now succeeds',
      },
      discriminator: {
        introduced: 'if (mode === effectiveMode) return effectiveMode',
        presentAt: { path: 'core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts', line: 173 },
        absentIn: 'packages/sandbox/sandbox/src/escalation.ts',
        note: 'the early return is the change; if either side stops matching, the refusal is describing a difference that no longer exists',
      },
      witness: [
        { claim: 'service-present', service: 'tools', because: 'the seam that consumes the request is still there, so the capability name still looks resolvable' },
        { claim: 'member-present', service: 'tools', member: 'execute', because: 'the wrapper seam the refusal routes to exists' },
        { claim: 'member-matching-absent', service: 'sandboxPolicy', pattern: 'permission|escalat', because: 'no member of the policy service normalises a per-call permission request; if one ever does, this refusal must be re-decided' },
      ],
    },
    'link.peerRange': {
      disposition: 'refuse',
      class: 'semantic-changed',
      reason: 'a declared peer range is a claim about compatibility, and this kernel now acts on it: a row whose declared upper bound excludes the running kernel is not loaded but disabled. The range is frequently wrong in both directions, so a loader that widened it would take on a correctness claim it cannot support, invisibly. The only answer this kernel offers is an explicit, human-recorded exemption.',
      suggestion: 'surface the row, its declared range and the running kernel, then record one explicit version exemption (dsh plugin allow-version <pkg>@<ver>) with its reason.',
      evidenceRefs: [{ path: 'docs/research/01-upgrade-surface.md', line: 421, contains: 'B10' }],
      evidence: 'docs/research/01-upgrade-surface.md:421-447 (B10), re-derived here: the earlier checkout carried declared peer ranges as manifest data and consulted none of them to veto a row; this kernel evaluates them and disables the row',
      wasThere: {
        kernel: EARLIER,
        path: 'packages/boot/app-boot/src/profile.ts',
        line: 68,
        contains: 'peerDependencies?: Record<string, string>',
        fact: 'the earlier kernel carried declared peer ranges as manifest data; no file under packages/boot consulted them to veto a row (a search for the preflight file and for includePrerelease returns nothing there)',
      },
      changedAt: {
        kernel: 'dsh-v0.2.1-alpha.1',
        path: 'core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts',
        line: 77,
        contains: 'includePrerelease',
        fact: 'this kernel satisfies the declared requirement against the runtime version with prereleases included, and disables the row when it fails',
      },
      discriminator: {
        introduced: 'includePrerelease',
        presentAt: { path: 'core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts', line: 77 },
        absentIn: 'packages/boot/app-boot/src/profile.ts',
        absentEverywhere: true,
        note: 'this file exists on the earlier kernel and does not carry the token, and a scan of that whole checkout finds includePrerelease nowhere: the preflight is new, not moved',
      },
      witness: [
        { claim: 'service-present', service: 'pluginManager', because: 'the component that owns rows and exemptions is still mounted' },
        { claim: 'member-present', service: 'pluginManager', member: 'setVersionExemption', because: 'the only automatic answer the kernel offers is a recorded human exemption, which is where this refusal routes' },
        { claim: 'member-matching-absent', service: 'pluginManager', pattern: 'widen|relax|allowVersion', because: 'nothing widens a declared range on its own; if a member ever does, this refusal must be re-decided' },
      ],
    },
  },
}
