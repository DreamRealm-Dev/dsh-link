// plugins/dsh-link-compat/src/index.ts
import z from "@deepseek-ai/schemastery";

// compat/index.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// compat/table/dsh-v0.2.1-alpha.1.ts
var SURFACE = "compat/surface/0.2.1-alpha.1.json";
var EARLIER = "0.1.1-rc.2";
var table = {
  kernel: "dsh-v0.2.1-alpha.1",
  packageVersion: "0.2.1-alpha.1",
  commit: "5badb15",
  previousKernel: EARLIER,
  surface: {
    file: SURFACE,
    sha256: "2212e58e56132fbceb4a370c9a0468cd99896b479c452810c1a3df11023ced2c",
    // What the archived document says the composition was. A surface is a snapshot of a
    // kernel AND the plugin set mounted into it, so mounting one more plugin changes it
    // without changing the kernel: the counts below are what makes that visible instead of
    // letting a stale archive keep passing. Recapture with scripts/probe-kernel-surface.mjs,
    // re-archive with scripts/archive-surface.mjs, then update all three numbers here.
    composition: {
      declaredProperties: 122,
      reachableServices: 93,
      events: 78
    }
  },
  roots: ["http", "store", "tools", "settings", "workspace", "shell", "team", "agent", "skill", "telemetry", "link"],
  notes: [
    "Surface: " + SURFACE + " (122 declared context properties, 93 reachable services, 78 event names, tools contract measured),",
    "produced by scripts/probe-kernel-surface.mjs against the pinned checkout core/deepseek-harness and archived by scripts/archive-surface.mjs.",
    "Roles: docs/handoff/R1-capability-vocabulary.md (revision 2, role-worded). Refusals: docs/research/01-upgrade-surface.md items B4, B5, B10,",
    "each re-derived against the 0.1.1-rc.2 checkout rather than inherited from that record."
  ].join(" "),
  capabilities: {
    store: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["store.listSessions", "store.readSession"],
      targets: [
        { service: "sessions", binds: [{ role: "store.listSessions", member: "list" }], evidence: SURFACE + " services.sessions" },
        {
          service: "sessionPersistence",
          binds: [{ role: "store.readSession", member: "readStoredLog" }],
          evidence: SURFACE + " services.sessionPersistence \u2014 the read entry on this kernel; there is no member called read"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.1"
    },
    tools: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["tools.register", "tools.lookup", "tools.schemas"],
      targets: [
        {
          service: "tools",
          binds: [
            { role: "tools.register", member: "register" },
            { role: "tools.lookup", member: "get" },
            { role: "tools.schemas", member: "schemas" }
          ],
          evidence: SURFACE + " services.tools \u2014 39 members, of which these three are the ones the capability promises"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.2",
      suggestion: 'register through the tools service; the simplified call is ctx.link.compat.capability("tools").register'
    },
    settings: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["settings.schema", "settings.update", "settings.describe"],
      targets: [
        {
          service: "settings",
          binds: [
            { role: "settings.schema", member: "schema" },
            { role: "settings.update", member: "update" },
            { role: "settings.describe", member: "describe" }
          ],
          evidence: SURFACE + " services.settings (SettingsForms)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.3"
    },
    workspace: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["workspace.listFiles", "workspace.readFile", "workspace.statFile"],
      targets: [
        {
          service: "workspaceFiles",
          binds: [
            { role: "workspace.listFiles", member: "list" },
            { role: "workspace.readFile", member: "read" },
            { role: "workspace.statFile", member: "stat" }
          ],
          evidence: SURFACE + " services.workspaceFiles \u2014 the main file entry; services.fs has three members only"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.4"
    },
    shell: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["shell.run", "shell.resolveCommand"],
      targets: [
        {
          service: "shell",
          binds: [
            { role: "shell.run", member: "execute" },
            { role: "shell.resolveCommand", member: "resolve" }
          ],
          evidence: SURFACE + " services.shell (SandboxPwshExecutor); sandboxMode is a field, not a member"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.5"
    },
    http: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["http.registerRoute", "http.renderIndex"],
      targets: [
        {
          service: "webServer",
          binds: [
            { role: "http.registerRoute", member: "register" },
            { role: "http.renderIndex", member: "renderIndex" }
          ],
          evidence: SURFACE + " services.webServer (WebServer, fields host/port)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.6 \u2014 the httpServer to webServer rename of the research did not happen here: the earlier 0.1.1-rc.2 checkout also declares webServer (<workspace>/-studio/vendor/deepseek-harness/packages/host/webserver/lib/types/index.d.ts:19), so no translation row is justified yet"
    },
    team: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["team.createMember", "team.sendMessage", "team.createTask", "team.updateTask", "team.listTasks", "team.waitForChange"],
      targets: [
        {
          service: "agentTeams",
          binds: [
            { role: "team.createMember", member: "spawnTeammate" },
            { role: "team.sendMessage", member: "sendMessage" },
            { role: "team.createTask", member: "createTask" },
            { role: "team.updateTask", member: "updateTask" },
            { role: "team.listTasks", member: "listTasks" },
            { role: "team.waitForChange", member: "waitForChange" }
          ],
          evidence: SURFACE + " services.agentTeams (TeamService, 14 members); lifecycle internals disposeRuntime/scheduleRecovery are deliberately not promised"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.7"
    },
    agent: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["agent.start", "agent.prompt", "agent.sendMessage"],
      targets: [
        {
          service: "subagents",
          binds: [
            { role: "agent.start", member: "start" },
            { role: "agent.prompt", member: "prompt" },
            { role: "agent.sendMessage", member: "sendMessage" }
          ],
          evidence: SURFACE + " services.subagents (SubagentRuntime, 19 members)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.8"
    },
    skill: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["skill.list", "skill.get"],
      targets: [
        {
          service: "skills",
          binds: [
            { role: "skill.list", member: "list" },
            { role: "skill.get", member: "get" }
          ],
          evidence: SURFACE + " services.skills (SkillRegistry)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.9"
    },
    telemetry: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["telemetry.emit"],
      targets: [
        { service: "sessionTelemetry", binds: [{ role: "telemetry.emit", member: "emit" }], evidence: SURFACE + " services.sessionTelemetry (two members only; the most easily renamed service in the set)" }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.10"
    },
    link: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["link.capability", "link.has", "link.require", "link.report", "link.services"],
      targets: [],
      self: true,
      providedBy: "dsh-link-compat",
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.11 \u2014 the loader answers for itself, so this row needs no kernel support"
    },
    "agent.childRows": {
      disposition: "translate",
      kind: "field-rename",
      roles: ["agent.childRows"],
      targets: [
        { service: "subagents", binds: [{ role: "agent.childRows", member: "listChildren" }], evidence: SURFACE + " services.subagents.listChildren" }
      ],
      translation: { from: "kind", to: "mode" },
      evidence: "docs/research/01-upgrade-surface.md:156-178 (B3, rename) and plugins/dsh-agent-context/lib/current.js:213-226 \u2014 the entries stopped carrying kind and carry { mode, label } instead; the meaning survives, so a mapping is safe"
    },
    "agent.presets": {
      disposition: "translate",
      kind: "carrier-relocation",
      roles: ["agent.declarePreset", "agent.listPresets"],
      targets: [
        {
          service: "agentPresets",
          binds: [
            { role: "agent.declarePreset", member: "register" },
            { role: "agent.listPresets", member: "list" }
          ],
          evidence: SURFACE + " services.agentPresets (AgentPresetRegistry)"
        }
      ],
      translation: { from: "directory", to: "declarationRow" },
      evidence: "docs/research/01-upgrade-surface.md:76-112 (B1, relocation) \u2014 the preset composition is unchanged and its carrier moved, so the row is a carrier mapping, provable by comparing the two documents"
    }
  },
  refused: {
    "settings.liveWrite": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a field being present in a settings schema no longer means it can be written at runtime: only fields the owning row declared with .volatile() accept a write, and a write to any other field is rejected. The schema is byte-identical across the change, so a name-keyed table would resolve a capability that then silently refuses every write.",
      suggestion: "declare volatility yourself on your own profile row (the facade member the vocabulary calls settings.define), or move the value into the row config the settings form owns; do not read or write the namespace of another row.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 181, contains: "B4" }],
      evidence: "docs/research/01-upgrade-surface.md:181-234 (B4), re-derived here: core/deepseek-harness/packages/settings/settings/src/index.ts:388 rejects a non-volatile path, and .../settings/src/schema.ts:37-47 defines the predicate",
      wasThere: {
        kernel: EARLIER,
        path: "packages/settings/settings/src/index.ts",
        line: 578,
        contains: "private write(",
        fact: 'the earlier settings service wrote whatever path the caller named; searching that whole package for "volatile" returns nothing, so there was no gate to satisfy'
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/settings/settings/src/index.ts",
        line: 388,
        contains: "is not volatile",
        fact: "this kernel throws before writing unless every path lies under a volatile declaration"
      },
      discriminator: {
        introduced: "isVolatilePath",
        presentAt: { path: "core/deepseek-harness/packages/settings/settings/src/index.ts", line: 388 },
        absentIn: "packages/settings/settings/src/index.ts",
        note: "the gate is the token isVolatilePath; if this kernel stopped carrying it on that line, or the earlier kernel started carrying it, the two sides would no longer describe a change"
      },
      witness: [
        { claim: "service-present", service: "settings", because: "the capability is asked for by name and the service is still called settings, which is exactly why a name-keyed table would let it through" },
        { claim: "member-present", service: "settings", member: "schema", because: "the schema is still published, so a caller can still read the field list and believe it is writable" },
        { claim: "member-matching-absent", service: "settings", pattern: "volatile|writable", because: "nothing on the settings service expresses per-field volatility; if a member ever does, this refusal must be re-decided" }
      ]
    },
    "tools.escalation": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "the same field name sandbox_permissions kept its name and changed its contract: repeating the effective mode used to throw, and this kernel returns it. The correct handling is to catch a specific error, change the call arguments and retry on a seam where the retry provably has no side effect \u2014 behaviour a table has no field to express, and where either mechanical mapping (always drop, always pass through) restores a defect.",
      suggestion: "wrap tools/execute exactly as plugins/dsh-escalation-guard does: catch the marker error, delete args.sandbox_permissions, retry next() once.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 237, contains: "B5" }],
      evidence: "docs/research/01-upgrade-surface.md:237-271 (B5), re-derived here: the earlier escalation resolver threw for a request that was not strictly wider, and this kernel returns early when the request repeats the effective mode",
      wasThere: {
        kernel: EARLIER,
        path: "packages/sandbox/sandbox/src/escalation.ts",
        line: 162,
        contains: "WIDER_MODES[effectiveMode]",
        fact: "the earlier resolver compared the request against the strictly-wider table and threw otherwise; an equal mode is not in that table, so it threw"
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts",
        line: 173,
        contains: "if (mode === effectiveMode) return effectiveMode",
        fact: "this kernel returns the effective mode before the strictly-wider check, so the identical call now succeeds"
      },
      discriminator: {
        introduced: "if (mode === effectiveMode) return effectiveMode",
        presentAt: { path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts", line: 173 },
        absentIn: "packages/sandbox/sandbox/src/escalation.ts",
        note: "the early return is the change; if either side stops matching, the refusal is describing a difference that no longer exists"
      },
      witness: [
        { claim: "service-present", service: "tools", because: "the seam that consumes the request is still there, so the capability name still looks resolvable" },
        { claim: "member-present", service: "tools", member: "execute", because: "the wrapper seam the refusal routes to exists" },
        { claim: "member-matching-absent", service: "sandboxPolicy", pattern: "permission|escalat", because: "no member of the policy service normalises a per-call permission request; if one ever does, this refusal must be re-decided" }
      ]
    },
    "link.peerRange": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a declared peer range is a claim about compatibility, and this kernel now acts on it: a row whose declared upper bound excludes the running kernel is not loaded but disabled. The range is frequently wrong in both directions, so a loader that widened it would take on a correctness claim it cannot support, invisibly. The only answer this kernel offers is an explicit, human-recorded exemption.",
      suggestion: "surface the row, its declared range and the running kernel, then record one explicit version exemption (dsh plugin allow-version <pkg>@<ver>) with its reason.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 421, contains: "B10" }],
      evidence: "docs/research/01-upgrade-surface.md:421-447 (B10), re-derived here: the earlier checkout carried declared peer ranges as manifest data and consulted none of them to veto a row; this kernel evaluates them and disables the row",
      wasThere: {
        kernel: EARLIER,
        path: "packages/boot/app-boot/src/profile.ts",
        line: 68,
        contains: "peerDependencies?: Record<string, string>",
        fact: "the earlier kernel carried declared peer ranges as manifest data; no file under packages/boot consulted them to veto a row (a search for the preflight file and for includePrerelease returns nothing there)"
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts",
        line: 77,
        contains: "includePrerelease",
        fact: "this kernel satisfies the declared requirement against the runtime version with prereleases included, and disables the row when it fails"
      },
      discriminator: {
        introduced: "includePrerelease",
        presentAt: { path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts", line: 77 },
        absentIn: "packages/boot/app-boot/src/profile.ts",
        absentEverywhere: true,
        note: "this file exists on the earlier kernel and does not carry the token, and a scan of that whole checkout finds includePrerelease nowhere: the preflight is new, not moved"
      },
      witness: [
        { claim: "service-present", service: "pluginManager", because: "the component that owns rows and exemptions is still mounted" },
        { claim: "member-present", service: "pluginManager", member: "setVersionExemption", because: "the only automatic answer the kernel offers is a recorded human exemption, which is where this refusal routes" },
        { claim: "member-matching-absent", service: "pluginManager", pattern: "widen|relax|allowVersion", because: "nothing widens a declared range on its own; if a member ever does, this refusal must be re-decided" }
      ]
    }
  }
};

// compat/table/dsh-v0.2.1-alpha.5.ts
var SURFACE2 = "compat/surface/0.2.1-alpha.5.json";
var EARLIER2 = "0.1.1-rc.2";
var table2 = {
  kernel: "dsh-v0.2.1-alpha.5",
  packageVersion: "0.2.1-alpha.5",
  commit: "1517a4db",
  previousKernel: EARLIER2,
  surface: {
    file: SURFACE2,
    sha256: "6738a92fb3ca629b040544765b4c9958ebb3d38706f8dda2a10f081dac2605fc",
    // What the archived document says the composition was. A surface is a snapshot of a
    // kernel AND the plugin set mounted into it, so mounting one more plugin changes it
    // without changing the kernel: the counts below are what makes that visible instead of
    // letting a stale archive keep passing. Recapture with scripts/probe-kernel-surface.mjs,
    // re-archive with scripts/archive-surface.mjs, then update all three numbers here.
    composition: {
      declaredProperties: 126,
      reachableServices: 97,
      events: 79
    }
  },
  roots: ["http", "store", "tools", "settings", "workspace", "shell", "team", "agent", "skill", "telemetry", "link"],
  notes: [
    "Surface: " + SURFACE2 + " (" + String(126) + " declared context properties, " + String(97) + " reachable services, " + String(79) + " event names, 35 tools),",
    "produced by scripts/probe-kernel-surface.mjs against a worktree of tag dsh-v0.2.1-alpha.5 (commit 1517a4db) and archived by scripts/archive-surface.mjs.",
    "Re-derived, not copied, from the alpha.1 section: all 30 (service, member) bindings were checked against this surface, one-line targets included; 29 held and the one that moved is rebound (agent.start -> subagents.startActivation).",
    "Member drift on this kernel, which is why the counts are not the whole story: agentTeams +sendAdmitted -recoverFor; subagents +drainChildren/drainDescendants/requireManager/startActivation/waitForChildren -drainContinuableChildren/drainContinuableDescendants/requireContinuations/start/startContinuable; sessionPersistence +mapSessionDirectories; webServer +getOrigin (and webServer fields host/port -> host/port/protocol); events 78 -> 79 (+plugin-market/changed, none removed).",
    "Roles: docs/handoff/R1-capability-vocabulary.md (revision 2, role-worded). Refusals: docs/research/01-upgrade-surface.md items B4, B5, B10,",
    "each re-derived against the 0.1.1-rc.2 checkout rather than inherited from that record."
  ].join(" "),
  capabilities: {
    store: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["store.listSessions", "store.readSession"],
      targets: [
        { service: "sessions", binds: [{ role: "store.listSessions", member: "list" }], evidence: SURFACE2 + " services.sessions" },
        {
          service: "sessionPersistence",
          binds: [{ role: "store.readSession", member: "readStoredLog" }],
          evidence: SURFACE2 + " services.sessionPersistence \u2014 the read entry on this kernel; there is no member called read"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.1"
    },
    tools: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["tools.register", "tools.lookup", "tools.schemas"],
      targets: [
        {
          service: "tools",
          binds: [
            { role: "tools.register", member: "register" },
            { role: "tools.lookup", member: "get" },
            { role: "tools.schemas", member: "schemas" }
          ],
          evidence: SURFACE2 + " services.tools \u2014 39 members, of which these three are the ones the capability promises"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.2",
      suggestion: 'register through the tools service; the simplified call is ctx.link.compat.capability("tools").register'
    },
    settings: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["settings.schema", "settings.update", "settings.describe"],
      targets: [
        {
          service: "settings",
          binds: [
            { role: "settings.schema", member: "schema" },
            { role: "settings.update", member: "update" },
            { role: "settings.describe", member: "describe" }
          ],
          evidence: SURFACE2 + " services.settings (SettingsForms)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.3"
    },
    workspace: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["workspace.listFiles", "workspace.readFile", "workspace.statFile"],
      targets: [
        {
          service: "workspaceFiles",
          binds: [
            { role: "workspace.listFiles", member: "list" },
            { role: "workspace.readFile", member: "read" },
            { role: "workspace.statFile", member: "stat" }
          ],
          evidence: SURFACE2 + " services.workspaceFiles \u2014 the main file entry; services.fs has three members only"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.4"
    },
    shell: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["shell.run", "shell.resolveCommand"],
      targets: [
        {
          service: "shell",
          binds: [
            { role: "shell.run", member: "execute" },
            { role: "shell.resolveCommand", member: "resolve" }
          ],
          evidence: SURFACE2 + " services.shell (SandboxPwshExecutor); sandboxMode is a field, not a member"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.5"
    },
    http: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["http.registerRoute", "http.renderIndex"],
      targets: [
        {
          service: "webServer",
          binds: [
            { role: "http.registerRoute", member: "register" },
            { role: "http.renderIndex", member: "renderIndex" }
          ],
          evidence: SURFACE2 + " services.webServer (WebServer, fields host/port)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.6 \u2014 the httpServer to webServer rename of the research did not happen here: the earlier 0.1.1-rc.2 checkout also declares webServer (<workspace>/-studio/vendor/deepseek-harness/packages/host/webserver/lib/types/index.d.ts:19), so no translation row is justified yet"
    },
    team: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["team.createMember", "team.sendMessage", "team.createTask", "team.updateTask", "team.listTasks", "team.waitForChange"],
      targets: [
        {
          service: "agentTeams",
          binds: [
            { role: "team.createMember", member: "spawnTeammate" },
            { role: "team.sendMessage", member: "sendMessage" },
            { role: "team.createTask", member: "createTask" },
            { role: "team.updateTask", member: "updateTask" },
            { role: "team.listTasks", member: "listTasks" },
            { role: "team.waitForChange", member: "waitForChange" }
          ],
          evidence: SURFACE2 + " services.agentTeams (TeamService, 14 members); lifecycle internals disposeRuntime/scheduleRecovery are deliberately not promised"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.7"
    },
    agent: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["agent.start", "agent.prompt", "agent.sendMessage"],
      targets: [
        {
          service: "subagents",
          binds: [
            { role: "agent.start", member: "startActivation" },
            { role: "agent.prompt", member: "prompt" },
            { role: "agent.sendMessage", member: "sendMessage" }
          ],
          evidence: SURFACE2 + " services.subagents.startActivation - alpha.1 called this member start; alpha.5 carries startActivation (packages/subagent/subagent/src/index.ts:262-269) | services.subagents (SubagentRuntime, 19 members)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.8"
    },
    skill: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["skill.list", "skill.get"],
      targets: [
        {
          service: "skills",
          binds: [
            { role: "skill.list", member: "list" },
            { role: "skill.get", member: "get" }
          ],
          evidence: SURFACE2 + " services.skills (SkillRegistry)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.9"
    },
    telemetry: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["telemetry.emit"],
      targets: [
        { service: "sessionTelemetry", binds: [{ role: "telemetry.emit", member: "emit" }], evidence: SURFACE2 + " services.sessionTelemetry (two members only; the most easily renamed service in the set)" }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.10"
    },
    link: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["link.capability", "link.has", "link.require", "link.report", "link.services"],
      targets: [],
      self: true,
      providedBy: "dsh-link-compat",
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.11 \u2014 the loader answers for itself, so this row needs no kernel support"
    },
    "agent.childRows": {
      disposition: "translate",
      kind: "field-rename",
      roles: ["agent.childRows"],
      targets: [
        { service: "subagents", binds: [{ role: "agent.childRows", member: "listChildren" }], evidence: SURFACE2 + " services.subagents.listChildren" }
      ],
      translation: { from: "kind", to: "mode" },
      evidence: "docs/research/01-upgrade-surface.md:156-178 (B3, rename) and plugins/dsh-agent-context/lib/current.js:213-226 \u2014 the entries stopped carrying kind and carry { mode, label } instead; the meaning survives, so a mapping is safe"
    },
    "agent.presets": {
      disposition: "translate",
      kind: "carrier-relocation",
      roles: ["agent.declarePreset", "agent.listPresets"],
      targets: [
        {
          service: "agentPresets",
          binds: [
            { role: "agent.declarePreset", member: "register" },
            { role: "agent.listPresets", member: "list" }
          ],
          evidence: SURFACE2 + " services.agentPresets (AgentPresetRegistry)"
        }
      ],
      translation: { from: "directory", to: "declarationRow" },
      evidence: "docs/research/01-upgrade-surface.md:76-112 (B1, relocation) \u2014 the preset composition is unchanged and its carrier moved, so the row is a carrier mapping, provable by comparing the two documents"
    }
  },
  refused: {
    "settings.liveWrite": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a field being present in a settings schema no longer means it can be written at runtime: only fields the owning row declared with .volatile() accept a write, and a write to any other field is rejected. The schema is byte-identical across the change, so a name-keyed table would resolve a capability that then silently refuses every write.",
      suggestion: "declare volatility yourself on your own profile row (the facade member the vocabulary calls settings.define), or move the value into the row config the settings form owns; do not read or write the namespace of another row.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 181, contains: "B4" }],
      evidence: "docs/research/01-upgrade-surface.md:181-234 (B4), re-derived here: core/deepseek-harness/packages/settings/settings/src/index.ts:388 rejects a non-volatile path, and .../settings/src/schema.ts:37-47 defines the predicate",
      wasThere: {
        kernel: EARLIER2,
        path: "packages/settings/settings/src/index.ts",
        line: 578,
        contains: "private write(",
        fact: 'the earlier settings service wrote whatever path the caller named; searching that whole package for "volatile" returns nothing, so there was no gate to satisfy'
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/settings/settings/src/index.ts",
        line: 388,
        contains: "is not volatile",
        fact: "this kernel throws before writing unless every path lies under a volatile declaration"
      },
      discriminator: {
        introduced: "isVolatilePath",
        presentAt: { path: "core/deepseek-harness/packages/settings/settings/src/index.ts", line: 388 },
        absentIn: "packages/settings/settings/src/index.ts",
        note: "the gate is the token isVolatilePath; if this kernel stopped carrying it on that line, or the earlier kernel started carrying it, the two sides would no longer describe a change"
      },
      witness: [
        { claim: "service-present", service: "settings", because: "the capability is asked for by name and the service is still called settings, which is exactly why a name-keyed table would let it through" },
        { claim: "member-present", service: "settings", member: "schema", because: "the schema is still published, so a caller can still read the field list and believe it is writable" },
        { claim: "member-matching-absent", service: "settings", pattern: "volatile|writable", because: "nothing on the settings service expresses per-field volatility; if a member ever does, this refusal must be re-decided" }
      ]
    },
    "tools.escalation": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "the same field name sandbox_permissions kept its name and changed its contract: repeating the effective mode used to throw, and this kernel returns it. The correct handling is to catch a specific error, change the call arguments and retry on a seam where the retry provably has no side effect \u2014 behaviour a table has no field to express, and where either mechanical mapping (always drop, always pass through) restores a defect.",
      suggestion: "wrap tools/execute exactly as plugins/dsh-escalation-guard does: catch the marker error, delete args.sandbox_permissions, retry next() once.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 237, contains: "B5" }],
      evidence: "docs/research/01-upgrade-surface.md:237-271 (B5), re-derived here: the earlier escalation resolver threw for a request that was not strictly wider, and this kernel returns early when the request repeats the effective mode",
      wasThere: {
        kernel: EARLIER2,
        path: "packages/sandbox/sandbox/src/escalation.ts",
        line: 162,
        contains: "WIDER_MODES[effectiveMode]",
        fact: "the earlier resolver compared the request against the strictly-wider table and threw otherwise; an equal mode is not in that table, so it threw"
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts",
        line: 173,
        contains: "if (mode === effectiveMode) return effectiveMode",
        fact: "this kernel returns the effective mode before the strictly-wider check, so the identical call now succeeds"
      },
      discriminator: {
        introduced: "if (mode === effectiveMode) return effectiveMode",
        presentAt: { path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts", line: 173 },
        absentIn: "packages/sandbox/sandbox/src/escalation.ts",
        note: "the early return is the change; if either side stops matching, the refusal is describing a difference that no longer exists"
      },
      witness: [
        { claim: "service-present", service: "tools", because: "the seam that consumes the request is still there, so the capability name still looks resolvable" },
        { claim: "member-present", service: "tools", member: "execute", because: "the wrapper seam the refusal routes to exists" },
        { claim: "member-matching-absent", service: "sandboxPolicy", pattern: "permission|escalat", because: "no member of the policy service normalises a per-call permission request; if one ever does, this refusal must be re-decided" }
      ]
    },
    "link.peerRange": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a declared peer range is a claim about compatibility, and this kernel now acts on it: a row whose declared upper bound excludes the running kernel is not loaded but disabled. The range is frequently wrong in both directions, so a loader that widened it would take on a correctness claim it cannot support, invisibly. The only answer this kernel offers is an explicit, human-recorded exemption.",
      suggestion: "surface the row, its declared range and the running kernel, then record one explicit version exemption (dsh plugin allow-version <pkg>@<ver>) with its reason.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 421, contains: "B10" }],
      evidence: "docs/research/01-upgrade-surface.md:421-447 (B10), re-derived here: the earlier checkout carried declared peer ranges as manifest data and consulted none of them to veto a row; this kernel evaluates them and disables the row",
      wasThere: {
        kernel: EARLIER2,
        path: "packages/boot/app-boot/src/profile.ts",
        line: 68,
        contains: "peerDependencies?: Record<string, string>",
        fact: "the earlier kernel carried declared peer ranges as manifest data; no file under packages/boot consulted them to veto a row (a search for the preflight file and for includePrerelease returns nothing there)"
      },
      // R218: re-anchored to THIS kernel. The alpha.1 section cited line 77 of the same file; after the pin moved,
      // alpha.5 carries the same discriminator at line 52 - copied evidence would have pointed at a line that no
      // longer says what the row claims, which is exactly what the gate reported.
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.5",
        path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts",
        line: 52,
        contains: "includePrerelease",
        fact: "this kernel satisfies the declared requirement against the runtime version with prereleases included, and disables the row when it fails"
      },
      discriminator: {
        introduced: "includePrerelease",
        presentAt: { path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts", line: 52 },
        absentIn: "packages/boot/app-boot/src/profile.ts",
        absentEverywhere: true,
        note: "this file exists on the earlier kernel and does not carry the token, and a scan of that whole checkout finds includePrerelease nowhere: the preflight is new, not moved"
      },
      witness: [
        { claim: "service-present", service: "pluginManager", because: "the component that owns rows and exemptions is still mounted" },
        { claim: "member-present", service: "pluginManager", member: "setVersionExemption", because: "the only automatic answer the kernel offers is a recorded human exemption, which is where this refusal routes" },
        { claim: "member-matching-absent", service: "pluginManager", pattern: "widen|relax|allowVersion", because: "nothing widens a declared range on its own; if a member ever does, this refusal must be re-decided" }
      ]
    }
  }
};

// compat/table/dsh-v0.2.1-rc.2.ts
var SURFACE3 = "compat/surface/0.2.1-rc.2.json";
var EARLIER3 = "0.1.1-rc.2";
var table3 = {
  kernel: "dsh-v0.2.1-rc.2",
  packageVersion: "0.2.1-rc.2",
  commit: "687f282e",
  previousKernel: EARLIER3,
  surface: {
    file: SURFACE3,
    sha256: "32365619e2b73959f91f10ac7e230f927a10f3a5ced02e04762b7cc2e7ff5a3b",
    // What the archived document says the composition was. A surface is a snapshot of a
    // kernel AND the plugin set mounted into it, so mounting one more plugin changes it
    // without changing the kernel: the counts below are what makes that visible instead of
    // letting a stale archive keep passing. Recapture with scripts/probe-kernel-surface.mjs,
    // re-archive with scripts/archive-surface.mjs, then update all three numbers here.
    composition: {
      declaredProperties: 126,
      reachableServices: 97,
      events: 79
    }
  },
  roots: ["http", "store", "tools", "settings", "workspace", "shell", "team", "agent", "skill", "telemetry", "link"],
  notes: [
    "Surface: " + SURFACE3 + " (" + String(126) + " declared context properties, " + String(97) + " reachable services, " + String(79) + " event names, 35 tools),",
    "produced by scripts/probe-kernel-surface.mjs against a worktree of tag dsh-v0.2.1-alpha.5 (commit 1517a4db) and archived by scripts/archive-surface.mjs.",
    "Re-derived, not copied, from the alpha.1 section: all 30 (service, member) bindings were checked against this surface, one-line targets included; 29 held and the one that moved is rebound (agent.start -> subagents.startActivation).",
    "Member drift on this kernel, which is why the counts are not the whole story: agentTeams +sendAdmitted -recoverFor; subagents +drainChildren/drainDescendants/requireManager/startActivation/waitForChildren -drainContinuableChildren/drainContinuableDescendants/requireContinuations/start/startContinuable; sessionPersistence +mapSessionDirectories; webServer +getOrigin (and webServer fields host/port -> host/port/protocol); events 78 -> 79 (+plugin-market/changed, none removed).",
    "Roles: docs/handoff/R1-capability-vocabulary.md (revision 2, role-worded). Refusals: docs/research/01-upgrade-surface.md items B4, B5, B10,",
    "each re-derived against the 0.1.1-rc.2 checkout rather than inherited from that record."
  ].join(" "),
  capabilities: {
    store: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["store.listSessions", "store.readSession"],
      targets: [
        { service: "sessions", binds: [{ role: "store.listSessions", member: "list" }], evidence: SURFACE3 + " services.sessions" },
        {
          service: "sessionPersistence",
          binds: [{ role: "store.readSession", member: "readStoredLog" }],
          evidence: SURFACE3 + " services.sessionPersistence \u2014 the read entry on this kernel; there is no member called read"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.1"
    },
    tools: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["tools.register", "tools.lookup", "tools.schemas"],
      targets: [
        {
          service: "tools",
          binds: [
            { role: "tools.register", member: "register" },
            { role: "tools.lookup", member: "get" },
            { role: "tools.schemas", member: "schemas" }
          ],
          evidence: SURFACE3 + " services.tools \u2014 39 members, of which these three are the ones the capability promises"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.2",
      suggestion: 'register through the tools service; the simplified call is ctx.link.compat.capability("tools").register'
    },
    settings: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["settings.schema", "settings.update", "settings.describe"],
      targets: [
        {
          service: "settings",
          binds: [
            { role: "settings.schema", member: "schema" },
            { role: "settings.update", member: "update" },
            { role: "settings.describe", member: "describe" }
          ],
          evidence: SURFACE3 + " services.settings (SettingsForms)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.3"
    },
    workspace: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["workspace.listFiles", "workspace.readFile", "workspace.statFile"],
      targets: [
        {
          service: "workspaceFiles",
          binds: [
            { role: "workspace.listFiles", member: "list" },
            { role: "workspace.readFile", member: "read" },
            { role: "workspace.statFile", member: "stat" }
          ],
          evidence: SURFACE3 + " services.workspaceFiles \u2014 the main file entry; services.fs has three members only"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.4"
    },
    shell: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["shell.run", "shell.resolveCommand"],
      targets: [
        {
          service: "shell",
          binds: [
            { role: "shell.run", member: "execute" },
            { role: "shell.resolveCommand", member: "resolve" }
          ],
          evidence: SURFACE3 + " services.shell (SandboxPwshExecutor); sandboxMode is a field, not a member"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.5"
    },
    http: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["http.registerRoute", "http.renderIndex"],
      targets: [
        {
          service: "webServer",
          binds: [
            { role: "http.registerRoute", member: "register" },
            { role: "http.renderIndex", member: "renderIndex" }
          ],
          evidence: SURFACE3 + " services.webServer (WebServer, fields host/port)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.6 \u2014 the httpServer to webServer rename of the research did not happen here: the earlier 0.1.1-rc.2 checkout also declares webServer (<workspace>/-studio/vendor/deepseek-harness/packages/host/webserver/lib/types/index.d.ts:19), so no translation row is justified yet"
    },
    team: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["team.createMember", "team.sendMessage", "team.createTask", "team.updateTask", "team.listTasks", "team.waitForChange"],
      targets: [
        {
          service: "agentTeams",
          binds: [
            { role: "team.createMember", member: "spawnTeammate" },
            { role: "team.sendMessage", member: "sendMessage" },
            { role: "team.createTask", member: "createTask" },
            { role: "team.updateTask", member: "updateTask" },
            { role: "team.listTasks", member: "listTasks" },
            { role: "team.waitForChange", member: "waitForChange" }
          ],
          evidence: SURFACE3 + " services.agentTeams (TeamService, 14 members); lifecycle internals disposeRuntime/scheduleRecovery are deliberately not promised"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.7"
    },
    agent: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["agent.start", "agent.prompt", "agent.sendMessage"],
      targets: [
        {
          service: "subagents",
          binds: [
            { role: "agent.start", member: "startActivation" },
            { role: "agent.prompt", member: "prompt" },
            { role: "agent.sendMessage", member: "sendMessage" }
          ],
          evidence: SURFACE3 + " services.subagents.startActivation - alpha.1 called this member start; alpha.5 carries startActivation (packages/subagent/subagent/src/index.ts:262-269) | services.subagents (SubagentRuntime, 19 members)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.8"
    },
    skill: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["skill.list", "skill.get"],
      targets: [
        {
          service: "skills",
          binds: [
            { role: "skill.list", member: "list" },
            { role: "skill.get", member: "get" }
          ],
          evidence: SURFACE3 + " services.skills (SkillRegistry)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.9"
    },
    telemetry: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["telemetry.emit"],
      targets: [
        { service: "sessionTelemetry", binds: [{ role: "telemetry.emit", member: "emit" }], evidence: SURFACE3 + " services.sessionTelemetry (two members only; the most easily renamed service in the set)" }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.10"
    },
    link: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["link.capability", "link.has", "link.require", "link.report", "link.services"],
      targets: [],
      self: true,
      providedBy: "dsh-link-compat",
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.11 \u2014 the loader answers for itself, so this row needs no kernel support"
    },
    "agent.childRows": {
      disposition: "translate",
      kind: "field-rename",
      roles: ["agent.childRows"],
      targets: [
        { service: "subagents", binds: [{ role: "agent.childRows", member: "listChildren" }], evidence: SURFACE3 + " services.subagents.listChildren" }
      ],
      translation: { from: "kind", to: "mode" },
      evidence: "docs/research/01-upgrade-surface.md:156-178 (B3, rename) and plugins/dsh-agent-context/lib/current.js:213-226 \u2014 the entries stopped carrying kind and carry { mode, label } instead; the meaning survives, so a mapping is safe"
    },
    "agent.presets": {
      disposition: "translate",
      kind: "carrier-relocation",
      roles: ["agent.declarePreset", "agent.listPresets"],
      targets: [
        {
          service: "agentPresets",
          binds: [
            { role: "agent.declarePreset", member: "register" },
            { role: "agent.listPresets", member: "list" }
          ],
          evidence: SURFACE3 + " services.agentPresets (AgentPresetRegistry)"
        }
      ],
      translation: { from: "directory", to: "declarationRow" },
      evidence: "docs/research/01-upgrade-surface.md:76-112 (B1, relocation) \u2014 the preset composition is unchanged and its carrier moved, so the row is a carrier mapping, provable by comparing the two documents"
    }
  },
  refused: {
    "settings.liveWrite": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a field being present in a settings schema no longer means it can be written at runtime: only fields the owning row declared with .volatile() accept a write, and a write to any other field is rejected. The schema is byte-identical across the change, so a name-keyed table would resolve a capability that then silently refuses every write.",
      suggestion: "declare volatility yourself on your own profile row (the facade member the vocabulary calls settings.define), or move the value into the row config the settings form owns; do not read or write the namespace of another row.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 181, contains: "B4" }],
      evidence: "docs/research/01-upgrade-surface.md:181-234 (B4), re-derived here: core/deepseek-harness/packages/settings/settings/src/index.ts:388 rejects a non-volatile path, and .../settings/src/schema.ts:37-47 defines the predicate",
      wasThere: {
        kernel: EARLIER3,
        path: "packages/settings/settings/src/index.ts",
        line: 578,
        contains: "private write(",
        fact: 'the earlier settings service wrote whatever path the caller named; searching that whole package for "volatile" returns nothing, so there was no gate to satisfy'
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/settings/settings/src/index.ts",
        line: 388,
        contains: "is not volatile",
        fact: "this kernel throws before writing unless every path lies under a volatile declaration"
      },
      discriminator: {
        introduced: "isVolatilePath",
        presentAt: { path: "core/deepseek-harness/packages/settings/settings/src/index.ts", line: 388 },
        absentIn: "packages/settings/settings/src/index.ts",
        note: "the gate is the token isVolatilePath; if this kernel stopped carrying it on that line, or the earlier kernel started carrying it, the two sides would no longer describe a change"
      },
      witness: [
        { claim: "service-present", service: "settings", because: "the capability is asked for by name and the service is still called settings, which is exactly why a name-keyed table would let it through" },
        { claim: "member-present", service: "settings", member: "schema", because: "the schema is still published, so a caller can still read the field list and believe it is writable" },
        { claim: "member-matching-absent", service: "settings", pattern: "volatile|writable", because: "nothing on the settings service expresses per-field volatility; if a member ever does, this refusal must be re-decided" }
      ]
    },
    "tools.escalation": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "the same field name sandbox_permissions kept its name and changed its contract: repeating the effective mode used to throw, and this kernel returns it. The correct handling is to catch a specific error, change the call arguments and retry on a seam where the retry provably has no side effect \u2014 behaviour a table has no field to express, and where either mechanical mapping (always drop, always pass through) restores a defect.",
      suggestion: "wrap tools/execute exactly as plugins/dsh-escalation-guard does: catch the marker error, delete args.sandbox_permissions, retry next() once.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 237, contains: "B5" }],
      evidence: "docs/research/01-upgrade-surface.md:237-271 (B5), re-derived here: the earlier escalation resolver threw for a request that was not strictly wider, and this kernel returns early when the request repeats the effective mode",
      wasThere: {
        kernel: EARLIER3,
        path: "packages/sandbox/sandbox/src/escalation.ts",
        line: 162,
        contains: "WIDER_MODES[effectiveMode]",
        fact: "the earlier resolver compared the request against the strictly-wider table and threw otherwise; an equal mode is not in that table, so it threw"
      },
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.1",
        path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts",
        line: 173,
        contains: "if (mode === effectiveMode) return effectiveMode",
        fact: "this kernel returns the effective mode before the strictly-wider check, so the identical call now succeeds"
      },
      discriminator: {
        introduced: "if (mode === effectiveMode) return effectiveMode",
        presentAt: { path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts", line: 173 },
        absentIn: "packages/sandbox/sandbox/src/escalation.ts",
        note: "the early return is the change; if either side stops matching, the refusal is describing a difference that no longer exists"
      },
      witness: [
        { claim: "service-present", service: "tools", because: "the seam that consumes the request is still there, so the capability name still looks resolvable" },
        { claim: "member-present", service: "tools", member: "execute", because: "the wrapper seam the refusal routes to exists" },
        { claim: "member-matching-absent", service: "sandboxPolicy", pattern: "permission|escalat", because: "no member of the policy service normalises a per-call permission request; if one ever does, this refusal must be re-decided" }
      ]
    },
    "link.peerRange": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a declared peer range is a claim about compatibility, and this kernel now acts on it: a row whose declared upper bound excludes the running kernel is not loaded but disabled. The range is frequently wrong in both directions, so a loader that widened it would take on a correctness claim it cannot support, invisibly. The only answer this kernel offers is an explicit, human-recorded exemption.",
      suggestion: "surface the row, its declared range and the running kernel, then record one explicit version exemption (dsh plugin allow-version <pkg>@<ver>) with its reason.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 421, contains: "B10" }],
      evidence: "docs/research/01-upgrade-surface.md:421-447 (B10), re-derived here: the earlier checkout carried declared peer ranges as manifest data and consulted none of them to veto a row; this kernel evaluates them and disables the row",
      wasThere: {
        kernel: EARLIER3,
        path: "packages/boot/app-boot/src/profile.ts",
        line: 68,
        contains: "peerDependencies?: Record<string, string>",
        fact: "the earlier kernel carried declared peer ranges as manifest data; no file under packages/boot consulted them to veto a row (a search for the preflight file and for includePrerelease returns nothing there)"
      },
      // R218: re-anchored to THIS kernel. The alpha.1 section cited line 77 of the same file; after the pin moved,
      // alpha.5 carries the same discriminator at line 52 - copied evidence would have pointed at a line that no
      // longer says what the row claims, which is exactly what the gate reported.
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.5",
        path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts",
        line: 52,
        contains: "includePrerelease",
        fact: "this kernel satisfies the declared requirement against the runtime version with prereleases included, and disables the row when it fails"
      },
      discriminator: {
        introduced: "includePrerelease",
        presentAt: { path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts", line: 52 },
        absentIn: "packages/boot/app-boot/src/profile.ts",
        absentEverywhere: true,
        note: "this file exists on the earlier kernel and does not carry the token, and a scan of that whole checkout finds includePrerelease nowhere: the preflight is new, not moved"
      },
      witness: [
        { claim: "service-present", service: "pluginManager", because: "the component that owns rows and exemptions is still mounted" },
        { claim: "member-present", service: "pluginManager", member: "setVersionExemption", because: "the only automatic answer the kernel offers is a recorded human exemption, which is where this refusal routes" },
        { claim: "member-matching-absent", service: "pluginManager", pattern: "widen|relax|allowVersion", because: "nothing widens a declared range on its own; if a member ever does, this refusal must be re-decided" }
      ]
    }
  }
};

// compat/table/dsh-v0.2.2-alpha.2.ts
var SURFACE4 = "compat/surface/0.2.2-alpha.2.json";
var EARLIER4 = "0.1.1-rc.2";
var table4 = {
  kernel: "dsh-v0.2.2-alpha.2",
  packageVersion: "0.2.2-alpha.2",
  commit: "1ee84404fa",
  previousKernel: EARLIER4,
  surface: {
    file: SURFACE4,
    sha256: "64e0cd0a7916fef5b59a4f6af8f9bcc985fedff7fb040334f97681d057944922",
    // What the archived document says the composition was. A surface is a snapshot of a
    // kernel AND the plugin set mounted into it, so mounting one more plugin changes it
    // without changing the kernel: the counts below are what makes that visible instead of
    // letting a stale archive keep passing. Recapture with scripts/probe-kernel-surface.mjs,
    // re-archive with scripts/archive-surface.mjs, then update all three numbers here.
    composition: {
      declaredProperties: 129,
      reachableServices: 101,
      events: 82
    }
  },
  roots: ["http", "store", "tools", "settings", "workspace", "shell", "team", "agent", "skill", "telemetry", "link"],
  notes: [
    "Surface: " + SURFACE4 + " (" + String(129) + " declared context properties, " + String(101) + " reachable services, " + String(82) + " event names, 29 tools),",
    "produced by scripts/probe-kernel-surface.mjs against the pinned checkout at tag dsh-v0.2.2-alpha.2 (patch branch HEAD 1ee84404fa) and archived by scripts/archive-surface.mjs.",
    "Re-derived, not copied, from the rc.2 section: all 30 (service, member) bindings were checked against this surface, one-line targets included, and all held.",
    "Member drift on this kernel, which is why the counts are not the whole story: sessions +messageProjections; settings +documentPath/writable; workspaceFiles and subagents gain the typert remote-methods symbol field; shell +sandboxMode; webServer +host/port/protocol/readResource/responderFor/serveResource; agentTeams +policy; tools +checkGuards/definitions/executable/resolve/selectExecutor/setExecutor; every bound member (register/get/schemas) held.",
    "Roles: docs/handoff/R1-capability-vocabulary.md (revision 2, role-worded). Refusals: docs/research/01-upgrade-surface.md items B4, B5, B10,",
    "each re-derived against the 0.1.1-rc.2 checkout rather than inherited from that record. The probe isolates lan-bridge state, so the five bridge_* control tools are absent from this capture by construction."
  ].join(" "),
  capabilities: {
    store: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["store.listSessions", "store.readSession"],
      targets: [
        { service: "sessions", binds: [{ role: "store.listSessions", member: "list" }], evidence: SURFACE4 + " services.sessions" },
        {
          service: "sessionPersistence",
          binds: [{ role: "store.readSession", member: "readStoredLog" }],
          evidence: SURFACE4 + " services.sessionPersistence \u2014 the read entry on this kernel; there is no member called read"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.1"
    },
    tools: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["tools.register", "tools.lookup", "tools.schemas"],
      targets: [
        {
          service: "tools",
          binds: [
            { role: "tools.register", member: "register" },
            { role: "tools.lookup", member: "get" },
            { role: "tools.schemas", member: "schemas" }
          ],
          evidence: SURFACE4 + " services.tools \u2014 39 members, of which these three are the ones the capability promises"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.2",
      suggestion: 'register through the tools service; the simplified call is ctx.link.compat.capability("tools").register'
    },
    settings: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["settings.schema", "settings.update", "settings.describe"],
      targets: [
        {
          service: "settings",
          binds: [
            { role: "settings.schema", member: "schema" },
            { role: "settings.update", member: "update" },
            { role: "settings.describe", member: "describe" }
          ],
          evidence: SURFACE4 + " services.settings (SettingsForms)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.3"
    },
    workspace: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["workspace.listFiles", "workspace.readFile", "workspace.statFile"],
      targets: [
        {
          service: "workspaceFiles",
          binds: [
            { role: "workspace.listFiles", member: "list" },
            { role: "workspace.readFile", member: "read" },
            { role: "workspace.statFile", member: "stat" }
          ],
          evidence: SURFACE4 + " services.workspaceFiles \u2014 the main file entry; services.fs has three members only"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.4"
    },
    shell: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["shell.run", "shell.resolveCommand"],
      targets: [
        {
          service: "shell",
          binds: [
            { role: "shell.run", member: "execute" },
            { role: "shell.resolveCommand", member: "resolve" }
          ],
          evidence: SURFACE4 + " services.shell (SandboxPwshExecutor); sandboxMode is a field, not a member"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.5"
    },
    http: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["http.registerRoute", "http.renderIndex"],
      targets: [
        {
          service: "webServer",
          binds: [
            { role: "http.registerRoute", member: "register" },
            { role: "http.renderIndex", member: "renderIndex" }
          ],
          evidence: SURFACE4 + " services.webServer (WebServer, fields host/port)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.6 \u2014 the httpServer to webServer rename of the research did not happen here: the earlier 0.1.1-rc.2 checkout also declares webServer (<workspace>/-studio/vendor/deepseek-harness/packages/host/webserver/lib/types/index.d.ts:19), so no translation row is justified yet"
    },
    team: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["team.createMember", "team.sendMessage", "team.createTask", "team.updateTask", "team.listTasks", "team.waitForChange"],
      targets: [
        {
          service: "agentTeams",
          binds: [
            { role: "team.createMember", member: "spawnTeammate" },
            { role: "team.sendMessage", member: "sendMessage" },
            { role: "team.createTask", member: "createTask" },
            { role: "team.updateTask", member: "updateTask" },
            { role: "team.listTasks", member: "listTasks" },
            { role: "team.waitForChange", member: "waitForChange" }
          ],
          evidence: SURFACE4 + " services.agentTeams (TeamService, 14 members); lifecycle internals disposeRuntime/scheduleRecovery are deliberately not promised"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.7"
    },
    agent: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["agent.start", "agent.prompt", "agent.sendMessage"],
      targets: [
        {
          service: "subagents",
          binds: [
            { role: "agent.start", member: "startActivation" },
            { role: "agent.prompt", member: "prompt" },
            { role: "agent.sendMessage", member: "sendMessage" }
          ],
          evidence: SURFACE4 + " services.subagents.startActivation - alpha.1 called this member start; alpha.5 carries startActivation (packages/subagent/subagent/src/index.ts:262-269) | services.subagents (SubagentRuntime, 19 members)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.8"
    },
    skill: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["skill.list", "skill.get"],
      targets: [
        {
          service: "skills",
          binds: [
            { role: "skill.list", member: "list" },
            { role: "skill.get", member: "get" }
          ],
          evidence: SURFACE4 + " services.skills (SkillRegistry)"
        }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.9"
    },
    telemetry: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["telemetry.emit"],
      targets: [
        { service: "sessionTelemetry", binds: [{ role: "telemetry.emit", member: "emit" }], evidence: SURFACE4 + " services.sessionTelemetry (two members only; the most easily renamed service in the set)" }
      ],
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.10"
    },
    link: {
      disposition: "resolve",
      kind: "passthrough",
      roles: ["link.capability", "link.has", "link.require", "link.report", "link.services"],
      targets: [],
      self: true,
      providedBy: "dsh-link-compat",
      evidence: "docs/handoff/R1-capability-vocabulary.md section 4.11 \u2014 the loader answers for itself, so this row needs no kernel support"
    },
    "agent.childRows": {
      disposition: "translate",
      kind: "field-rename",
      roles: ["agent.childRows"],
      targets: [
        { service: "subagents", binds: [{ role: "agent.childRows", member: "listChildren" }], evidence: SURFACE4 + " services.subagents.listChildren" }
      ],
      translation: { from: "kind", to: "mode" },
      evidence: "docs/research/01-upgrade-surface.md:156-178 (B3, rename) and plugins/dsh-agent-context/lib/current.js:213-226 \u2014 the entries stopped carrying kind and carry { mode, label } instead; the meaning survives, so a mapping is safe"
    },
    "agent.presets": {
      disposition: "translate",
      kind: "carrier-relocation",
      roles: ["agent.declarePreset", "agent.listPresets"],
      targets: [
        {
          service: "agentPresets",
          binds: [
            { role: "agent.declarePreset", member: "register" },
            { role: "agent.listPresets", member: "list" }
          ],
          evidence: SURFACE4 + " services.agentPresets (AgentPresetRegistry)"
        }
      ],
      translation: { from: "directory", to: "declarationRow" },
      evidence: "docs/research/01-upgrade-surface.md:76-112 (B1, relocation) \u2014 the preset composition is unchanged and its carrier moved, so the row is a carrier mapping, provable by comparing the two documents"
    }
  },
  refused: {
    "settings.liveWrite": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a field being present in a settings schema no longer means it can be written at runtime: only fields the owning row declared with .volatile() accept a write, and a write to any other field is rejected. The schema is byte-identical across the change, so a name-keyed table would resolve a capability that then silently refuses every write.",
      suggestion: "declare volatility yourself on your own profile row (the facade member the vocabulary calls settings.define), or move the value into the row config the settings form owns; do not read or write the namespace of another row.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 181, contains: "B4" }],
      evidence: "docs/research/01-upgrade-surface.md:181-234 (B4), re-derived on 0.2.2-alpha.2: core/deepseek-harness/packages/settings/settings/src/index.ts:389 rejects a non-volatile path, and .../settings/src/schema.ts defines the predicate",
      wasThere: {
        kernel: EARLIER4,
        path: "packages/settings/settings/src/index.ts",
        line: 578,
        contains: "private write(",
        fact: 'the earlier settings service wrote whatever path the caller named; searching that whole package for "volatile" returns nothing, so there was no gate to satisfy'
      },
      changedAt: {
        kernel: "dsh-v0.2.2-alpha.2",
        path: "core/deepseek-harness/packages/settings/settings/src/index.ts",
        line: 389,
        contains: "is not volatile",
        fact: "this kernel throws before writing unless every path lies under a volatile declaration"
      },
      discriminator: {
        introduced: "isVolatilePath",
        presentAt: { path: "core/deepseek-harness/packages/settings/settings/src/index.ts", line: 389 },
        absentIn: "packages/settings/settings/src/index.ts",
        note: "the gate is the token isVolatilePath; if this kernel stopped carrying it on that line, or the earlier kernel started carrying it, the two sides would no longer describe a change"
      },
      witness: [
        { claim: "service-present", service: "settings", because: "the capability is asked for by name and the service is still called settings, which is exactly why a name-keyed table would let it through" },
        { claim: "member-present", service: "settings", member: "schema", because: "the schema is still published, so a caller can still read the field list and believe it is writable" },
        { claim: "member-matching-absent", service: "settings", pattern: "volatile", because: 'nothing on the settings service expresses per-field volatility; re-decided on 0.2.2-alpha.2: the service now carries a document-level "writable" flag (profile accepts form edits) that the earlier broad pattern also matched, and that flag is not a per-field volatility gate, so the premise still holds; if a volatile member ever appears, this refusal must be re-decided again' }
      ]
    },
    "tools.escalation": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "the same field name sandbox_permissions kept its name and changed its contract: repeating the effective mode used to throw, and this kernel returns it. The correct handling is to catch a specific error, change the call arguments and retry on a seam where the retry provably has no side effect \u2014 behaviour a table has no field to express, and where either mechanical mapping (always drop, always pass through) restores a defect.",
      suggestion: "wrap tools/execute exactly as plugins/dsh-escalation-guard does: catch the marker error, delete args.sandbox_permissions, retry next() once.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 237, contains: "B5" }],
      evidence: "docs/research/01-upgrade-surface.md:237-271 (B5), re-derived here: the earlier escalation resolver threw for a request that was not strictly wider, and this kernel returns early when the request repeats the effective mode",
      wasThere: {
        kernel: EARLIER4,
        path: "packages/sandbox/sandbox/src/escalation.ts",
        line: 162,
        contains: "WIDER_MODES[effectiveMode]",
        fact: "the earlier resolver compared the request against the strictly-wider table and threw otherwise; an equal mode is not in that table, so it threw"
      },
      changedAt: {
        kernel: "dsh-v0.2.2-alpha.2",
        path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts",
        line: 174,
        contains: "if (mode === effectiveMode) return effectiveMode",
        fact: "this kernel returns the effective mode before the strictly-wider check, so the identical call now succeeds"
      },
      discriminator: {
        introduced: "if (mode === effectiveMode) return effectiveMode",
        presentAt: { path: "core/deepseek-harness/packages/sandbox/sandbox/src/escalation.ts", line: 174 },
        absentIn: "packages/sandbox/sandbox/src/escalation.ts",
        note: "the early return is the change; if either side stops matching, the refusal is describing a difference that no longer exists"
      },
      witness: [
        { claim: "service-present", service: "tools", because: "the seam that consumes the request is still there, so the capability name still looks resolvable" },
        { claim: "member-present", service: "tools", member: "execute", because: "the wrapper seam the refusal routes to exists" },
        { claim: "member-matching-absent", service: "sandboxPolicy", pattern: "permission|escalat", because: "no member of the policy service normalises a per-call permission request; if one ever does, this refusal must be re-decided" }
      ]
    },
    "link.peerRange": {
      disposition: "refuse",
      class: "semantic-changed",
      reason: "a declared peer range is a claim about compatibility, and this kernel now acts on it: a row whose declared upper bound excludes the running kernel is not loaded but disabled. The range is frequently wrong in both directions, so a loader that widened it would take on a correctness claim it cannot support, invisibly. The only answer this kernel offers is an explicit, human-recorded exemption.",
      suggestion: "surface the row, its declared range and the running kernel, then record one explicit version exemption (dsh plugin allow-version <pkg>@<ver>) with its reason.",
      evidenceRefs: [{ path: "docs/research/01-upgrade-surface.md", line: 421, contains: "B10" }],
      evidence: "docs/research/01-upgrade-surface.md:421-447 (B10), re-derived here: the earlier checkout carried declared peer ranges as manifest data and consulted none of them to veto a row; this kernel evaluates them and disables the row",
      wasThere: {
        kernel: EARLIER4,
        path: "packages/boot/app-boot/src/profile.ts",
        line: 68,
        contains: "peerDependencies?: Record<string, string>",
        fact: "the earlier kernel carried declared peer ranges as manifest data; no file under packages/boot consulted them to veto a row (a search for the preflight file and for includePrerelease returns nothing there)"
      },
      // R218: re-anchored to THIS kernel. The alpha.1 section cited line 77 of the same file; after the pin moved,
      // alpha.5 carries the same discriminator at line 52 - copied evidence would have pointed at a line that no
      // longer says what the row claims, which is exactly what the gate reported.
      changedAt: {
        kernel: "dsh-v0.2.1-alpha.5",
        path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts",
        line: 52,
        contains: "includePrerelease",
        fact: "this kernel satisfies the declared requirement against the runtime version with prereleases included, and disables the row when it fails"
      },
      discriminator: {
        introduced: "includePrerelease",
        presentAt: { path: "core/deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts", line: 52 },
        absentIn: "packages/boot/app-boot/src/profile.ts",
        absentEverywhere: true,
        note: "this file exists on the earlier kernel and does not carry the token, and a scan of that whole checkout finds includePrerelease nowhere: the preflight is new, not moved"
      },
      witness: [
        { claim: "service-present", service: "pluginManager", because: "the component that owns rows and exemptions is still mounted" },
        { claim: "member-present", service: "pluginManager", member: "setVersionExemption", because: "the only automatic answer the kernel offers is a recorded human exemption, which is where this refusal routes" },
        { claim: "member-matching-absent", service: "pluginManager", pattern: "widen|relax|allowVersion", because: "nothing widens a declared range on its own; if a member ever does, this refusal must be re-decided" }
      ]
    }
  }
};

// compat/engine.ts
var UnsupportedError = class extends Error {
  /** The capability name the caller asked for. */
  capability;
  /** The kernel identity the question was asked on. */
  kernelVersion;
  /** Why this kernel cannot honour it. */
  reason;
  /** What to do instead. */
  suggestion;
  /**
   * @param details - the four fields, all required and all non-empty.
   */
  constructor(details) {
    super(`unsupported capability "${details.capability}" on ${details.kernelVersion}: ${details.reason} (suggestion: ${details.suggestion})`);
    this.name = "UnsupportedError";
    this.capability = details.capability;
    this.kernelVersion = details.kernelVersion;
    this.reason = details.reason;
    this.suggestion = details.suggestion;
  }
};
function roleWord(role) {
  const at = role.indexOf(".");
  return at === -1 ? role : role.slice(at + 1);
}
function tableProblems(table5) {
  const problems = [];
  const roots = new Set(table5.roots);
  if (roots.size === 0) problems.push("the table declares no neutral word roots");
  if (table5.surface.sha256.trim() === "") problems.push("the table is not bound to an archived surface document");
  if (table5.previousKernel.trim() === "") problems.push("the table names no earlier kernel for its refusals");
  const seen = /* @__PURE__ */ new Map();
  const roleOwners = /* @__PURE__ */ new Map();
  for (const [name2, row] of Object.entries(table5.capabilities)) seen.set(name2, row.disposition);
  for (const [name2, row] of Object.entries(table5.refused)) {
    const first = seen.get(name2);
    if (first !== void 0) {
      problems.push(`capability "${name2}" is declared as ${first} and as ${row.disposition}; a name has exactly one disposition`);
      continue;
    }
    seen.set(name2, row.disposition);
  }
  for (const [name2, row] of Object.entries(table5.capabilities)) {
    const root = name2.split(".")[0];
    if (!roots.has(root)) problems.push(`capability "${name2}" does not start with a neutral word root (${[...roots].join(", ")})`);
    if (row.evidence.trim() === "") problems.push(`capability "${name2}" carries no evidence`);
    if (row.disposition === "translate" && row.translation === void 0) problems.push(`capability "${name2}" translates but declares no translation`);
    if (row.disposition === "resolve" && row.translation !== void 0) problems.push(`capability "${name2}" resolves but declares a translation`);
    if (row.roles.length === 0) problems.push(`capability "${name2}" promises no roles`);
    if (row.self === true) {
      if (row.targets.length > 0) problems.push(`capability "${name2}" is self-provided but names kernel targets`);
      if ((row.providedBy ?? "") === "") problems.push(`capability "${name2}" is self-provided but names no providing package`);
    } else {
      if (row.targets.length === 0) problems.push(`capability "${name2}" names no kernel target`);
    }
    const bound = /* @__PURE__ */ new Map();
    for (const target of row.targets) {
      if (target.binds.length === 0) problems.push(`capability "${name2}" target "${target.service}" binds no roles`);
      if (target.evidence.trim() === "") problems.push(`capability "${name2}" target "${target.service}" carries no evidence`);
      for (const binding of target.binds) {
        checkBinding(problems, name2, target.service, binding, row.roles, roots, bound);
      }
    }
    for (const role of row.roles) {
      const root0 = role.split(".")[0];
      if (!roots.has(root0)) problems.push(`capability "${name2}" promises role "${role}", which is not a neutral name`);
      if (root0 !== root) problems.push(`capability "${name2}" promises role "${role}", whose root is not this capability's root`);
      const owner = roleOwners.get(role);
      if (owner !== void 0) problems.push(`role "${role}" is promised by both "${owner}" and "${name2}"; a role has one owner`);
      if (owner === void 0) roleOwners.set(role, name2);
      if (row.self !== true && bound.has(role) === false) {
        problems.push(`capability "${name2}" promises role "${role}", which no target binds; a promise with no binding cannot be honoured`);
      }
    }
    const extra = [...bound.keys()].filter((role) => row.roles.includes(role) === false);
    if (extra.length > 0) problems.push(`capability "${name2}" binds ${extra.join(", ")}, which it does not promise`);
  }
  for (const [name2, row] of Object.entries(table5.refused)) {
    const root = name2.split(".")[0];
    if (!roots.has(root)) problems.push(`capability "${name2}" does not start with a neutral word root`);
    if (row.reason.trim() === "") problems.push(`refusal "${name2}" gives no reason`);
    if (row.suggestion.trim() === "") problems.push(`refusal "${name2}" suggests nothing`);
    if (row.evidence.trim() === "") problems.push(`refusal "${name2}" carries no evidence`);
    if (row.witness.length === 0) problems.push(`refusal "${name2}" rests on no witness`);
    if (row.class === "semantic-changed") {
      if (row.wasThere === void 0) problems.push(`refusal "${name2}" claims a semantic change but shows no earlier-kernel line`);
      if (row.changedAt === void 0) problems.push(`refusal "${name2}" claims a semantic change but shows no this-kernel line`);
      if (row.discriminator === void 0) problems.push(`refusal "${name2}" claims a semantic change but declares no discriminator`);
      else if (row.discriminator.introduced.trim() === "") problems.push(`refusal "${name2}" has an empty discriminator token`);
    } else if (row.wasThere !== void 0 || row.changedAt !== void 0 || row.discriminator !== void 0) {
      problems.push(`refusal "${name2}" is class "${row.class}" and must not carry two-sided semantic evidence`);
    }
  }
  return problems;
}
function checkBinding(problems, name2, service, binding, roles, roots, bound) {
  if (binding.role.trim() === "" || binding.member.trim() === "") {
    problems.push(`capability "${name2}" has an empty binding on "${service}"`);
    return;
  }
  if (binding.member.startsWith("_")) problems.push(`capability "${name2}" binds role "${binding.role}" to private member "${binding.member}"`);
  const held = bound.get(binding.role);
  if (held !== void 0) problems.push(`capability "${name2}" binds role "${binding.role}" twice ("${held}" and "${binding.member}")`);
  bound.set(binding.role, binding.member);
  if (roles.includes(binding.role) === false) problems.push(`capability "${name2}" binds "${binding.role}" without promising it`);
  if (roots.has(binding.role.split(".")[0]) === false || binding.role.split(".")[0] !== name2.split(".")[0]) {
    problems.push(`capability "${name2}" binds "${binding.role}", whose root is not this capability's root`);
  }
}
function evaluateWitness(witness, lookup) {
  switch (witness.claim) {
    case "service-present": {
      const members = lookup.membersOf(witness.service);
      return members === void 0 ? { holds: false, observed: `service "${witness.service}" is absent` } : { holds: true, observed: `service "${witness.service}" present (${members.length} members)` };
    }
    case "service-absent": {
      if (lookup.serviceNames === void 0) {
        return { holds: false, established: false, observed: `the surface cannot enumerate its services, so "${witness.service}" being absent is not an observation` };
      }
      const members = lookup.membersOf(witness.service);
      return members === void 0 ? { holds: true, observed: `service "${witness.service}" is absent from ${lookup.serviceNames().length} declared properties` } : { holds: false, observed: `service "${witness.service}" is present with ${members.length} members` };
    }
    case "member-present": {
      const members = lookup.membersOf(witness.service);
      if (members === void 0) return { holds: false, observed: `service "${witness.service}" is absent, so "${witness.member}" cannot be present` };
      return members.includes(witness.member) ? { holds: true, observed: `"${witness.service}.${witness.member}" present` } : { holds: false, observed: `"${witness.service}.${witness.member}" is absent` };
    }
    case "member-absent": {
      const members = lookup.membersOf(witness.service);
      if (members === void 0) {
        return { holds: false, established: false, observed: `service "${witness.service}" is absent, so its members cannot be observed` };
      }
      return members.includes(witness.member) ? { holds: false, observed: `"${witness.service}.${witness.member}" is present` } : { holds: true, observed: `"${witness.service}.${witness.member}" absent` };
    }
    case "member-matching-absent": {
      const members = lookup.membersOf(witness.service);
      if (members === void 0) {
        return { holds: false, established: false, observed: `service "${witness.service}" is absent, so what its members match cannot be observed` };
      }
      const pattern = new RegExp(witness.pattern);
      const matched = members.filter((member) => pattern.test(member));
      return matched.length === 0 ? { holds: true, observed: `no member of "${witness.service}" matches /${witness.pattern}/` } : { holds: false, observed: `"${witness.service}" now exposes ${matched.map((member) => `"${member}"`).join(", ")}, matching /${witness.pattern}/` };
    }
    default:
      return { holds: false, observed: `unknown witness claim ${JSON.stringify(witness)}` };
  }
}
function evaluateRow(name2, row, lookup) {
  const detail = [];
  const failures = [];
  if (row.disposition === "refuse") {
    for (const witness of row.witness) {
      const { holds, observed, established } = evaluateWitness(witness, lookup);
      const mark = established === false ? "NOT-ESTABLISHED" : holds ? "ok  " : "STALE";
      detail.push(`${mark} ${observed} \u2014 ${witness.because}`);
      if (established === false) failures.push(`NOT ESTABLISHED \u2014 ${observed} (${witness.because})`);
      else if (!holds) failures.push(`${observed} \u2014 the refusal's premise no longer holds: ${witness.because}`);
    }
    return {
      capability: name2,
      disposition: "refuse",
      refusalClass: row.class,
      verdict: failures.length === 0 ? "ok" : "stale",
      detail,
      failures
    };
  }
  if (row.self === true) {
    detail.push(`ok   provided by ${row.providedBy ?? "(unnamed package)"}, not by the kernel`);
    return { capability: name2, disposition: row.disposition, verdict: "ok", detail, failures };
  }
  for (const target of row.targets) {
    const members = lookup.membersOf(target.service);
    if (members === void 0) {
      failures.push(`the capability resolves to service "${target.service}", which is absent from this kernel`);
      detail.push(`FAIL service "${target.service}" absent \u2014 ${target.evidence}`);
      continue;
    }
    detail.push(`ok   service "${target.service}" present (${members.length} members) \u2014 ${target.evidence}`);
    for (const binding of target.binds) {
      if (members.includes(binding.member)) {
        detail.push(`ok   role "${binding.role}" is served by "${target.service}.${binding.member}"`);
      } else {
        failures.push(`role "${binding.role}" binds to "${target.service}.${binding.member}", which this kernel does not expose`);
        detail.push(`FAIL "${target.service}.${binding.member}" absent`);
      }
    }
  }
  if (row.translation !== void 0 && row.kind === "service-rename") {
    const stillThere = lookup.membersOf(row.translation.from);
    if (stillThere !== void 0) {
      failures.push(`the row translates "${row.translation.from}" to "${row.translation.to}", but "${row.translation.from}" is still on this kernel`);
    }
  }
  return { capability: name2, disposition: row.disposition, verdict: failures.length === 0 ? "ok" : "fail", detail, failures };
}
function rename(record, from, to) {
  if (record === null || typeof record !== "object") throw new TypeError(`cannot translate ${typeof record} as a row`);
  const out = { ...record, [to]: record[from] };
  delete out[from];
  return out;
}
function createCompatLoader(options) {
  const { table: table5, membersOf, valueOf } = options;
  const strict = options.strict ?? true;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const problems = tableProblems(table5);
  if (problems.length > 0) {
    throw new Error(`compat table ${table5.kernel} is malformed: ${problems.join("; ")}`);
  }
  const byService = /* @__PURE__ */ new Map();
  const records = /* @__PURE__ */ new Map();
  const refusedNames = [];
  const refusedSemanticChanged = [];
  const refusedAbsent = [];
  const staleNames = [];
  const entries = [
    ...Object.entries(table5.capabilities),
    ...Object.entries(table5.refused)
  ];
  entries.sort(([left], [right]) => left.localeCompare(right));
  for (const [name2, row] of entries) {
    const rowStart = now();
    const verdict = evaluateRow(name2, row, { membersOf });
    const ms = now() - rowStart;
    if (row.disposition === "refuse") {
      const error = new UnsupportedError({
        capability: name2,
        kernelVersion: table5.kernel,
        reason: row.reason,
        suggestion: row.suggestion
      });
      const record = { capability: name2, disposition: "refuse", refusalClass: row.class, ms };
      if (verdict.verdict === "stale") {
        staleNames.push(name2);
        records.set(name2, { error, row: { ...record, status: "stale-refusal", failures: verdict.failures } });
      } else {
        refusedNames.push(name2);
        if (row.class === "semantic-changed") refusedSemanticChanged.push(name2);
        else refusedAbsent.push(name2);
        records.set(name2, { error, row: { ...record, status: "refused", failures: [] } });
      }
      continue;
    }
    for (const target of row.targets) {
      const list = byService.get(target.service) ?? [];
      list.push(row);
      byService.set(target.service, list);
    }
    if (verdict.verdict !== "ok") {
      refusedNames.push(name2);
      const error = new UnsupportedError({
        capability: name2,
        kernelVersion: table5.kernel,
        reason: verdict.failures[0] ?? "this kernel does not satisfy the capability",
        suggestion: row.suggestion ?? `use a capability this kernel offers, or add "${name2}" to compat/table/${table5.kernel}.ts after measuring it`
      });
      records.set(name2, {
        error,
        row: { capability: name2, disposition: row.disposition, status: "refused", ms, failures: verdict.failures }
      });
      continue;
    }
    if (row.self === true) {
      const provided = options.selfProvided?.[name2] ?? {};
      const missing = row.roles.filter((role) => provided[roleWord(role)] === void 0);
      if (missing.length > 0) {
        const error = new UnsupportedError({
          capability: name2,
          kernelVersion: table5.kernel,
          reason: `"${name2}" is provided by ${row.providedBy ?? "this loader"}, which supplied nothing for ${missing.join(", ")}`,
          suggestion: `pass ${name2} in selfProvided, keyed by role word`
        });
        records.set(name2, {
          error,
          row: { capability: name2, disposition: row.disposition, status: "refused", ms, failures: [error.reason] }
        });
        continue;
      }
      const value2 = {};
      for (const role of row.roles) value2[roleWord(role)] = provided[roleWord(role)];
      records.set(name2, { value: Object.freeze(value2), row: { capability: name2, disposition: row.disposition, status: "resolved", ms, failures: [] } });
      continue;
    }
    const value = {};
    for (const target of row.targets) {
      const raw = valueOf(target.service);
      for (const binding of target.binds) {
        const member = raw?.[binding.member];
        value[roleWord(binding.role)] = typeof member === "function" ? member.bind(raw) : member;
      }
    }
    if (row.translation !== void 0) {
      value.translation = Object.freeze({ kind: row.kind, from: row.translation.from, to: row.translation.to });
      if (row.kind === "field-rename") {
        const { from, to } = row.translation;
        value.mapping = Object.freeze({ from, to });
        value.toKernel = (record) => rename(record, from, to);
        value.fromKernel = (record) => rename(record, to, from);
      }
    }
    records.set(name2, { value: Object.freeze(value), row: { capability: name2, disposition: row.disposition, status: "resolved", ms, failures: [] } });
  }
  if (strict && staleNames.length > 0) {
    const lines = staleNames.map((name2) => {
      const record = records.get(name2);
      return `${name2}: ${record?.row.failures.join("; ") ?? "premise expired"}`;
    });
    throw new Error(`compat table ${table5.kernel} has ${staleNames.length} stale refusal(s); re-measure before shipping: ${lines.join(" | ")}`);
  }
  const resolveMs = now() - started;
  const names = [...records.keys()];
  const resolved = names.filter((name2) => records.get(name2)?.error === void 0);
  const vocabulary = names.join(", ");
  const loader = {
    kernel: table5.kernel,
    services: {
      get(service) {
        const rows = byService.get(service);
        if (rows === void 0) {
          throw new UnsupportedError({
            capability: service,
            kernelVersion: table5.kernel,
            reason: `service "${service}" is not named by this kernel's table`,
            suggestion: `ask for a capability instead (${vocabulary}), or add "${service}" to the table's ${table5.kernel} section`
          });
        }
        const value = valueOf(service);
        if (value === void 0) {
          throw new UnsupportedError({
            capability: service,
            kernelVersion: table5.kernel,
            reason: `service "${service}" is not mounted on this kernel`,
            suggestion: `guard the call with ctx.link.compat.has(...) before asking for a service by name`
          });
        }
        return value;
      }
    },
    capability(name2) {
      const record = records.get(name2);
      if (record === void 0) {
        throw new UnsupportedError({
          capability: name2,
          kernelVersion: table5.kernel,
          reason: `"${name2}" is not in the vocabulary for ${table5.kernel}`,
          suggestion: `the vocabulary is closed; use one of: ${vocabulary}`
        });
      }
      if (record.error !== void 0) throw record.error;
      return record.value;
    },
    has(name2) {
      const record = records.get(name2);
      return record !== void 0 && record.error === void 0;
    },
    require(name2) {
      return loader.capability(name2);
    },
    report() {
      return {
        kernel: table5.kernel,
        packageVersion: table5.packageVersion,
        commit: table5.commit,
        resolveMs,
        resolved,
        refused: refusedNames,
        refusedSemanticChanged,
        refusedAbsent,
        staleRefusals: staleNames,
        rows: names.map((name2) => records.get(name2).row)
      };
    }
  };
  return loader;
}

// compat/simple.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var pick = (record, keys) => {
  for (const key of keys) if (record[key] !== void 0) return record[key];
  return void 0;
};
var asTime = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};
var countEntries = (log) => {
  if (Array.isArray(log)) return log.length;
  if (isRecord(log)) {
    for (const key of ["entries", "events", "records", "lines"]) {
      const value = log[key];
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
};
function createSimpleLayer(source) {
  const registered = /* @__PURE__ */ new Map();
  const capability = (name2) => source.require(name2);
  const sessions = {
    async recent(sessionId, limit = 10) {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new RangeError("simple.sessions.recent: limit must be a positive integer, got " + String(limit));
      }
      const store = capability("store");
      const list = store.listSessions;
      if (typeof list !== "function") throw new TypeError("simple.sessions.recent: the store capability has no listSessions role");
      const read = store.readSession;
      let anchor;
      if (typeof read === "function") {
        try {
          anchor = await read(sessionId);
        } catch {
          anchor = void 0;
        }
      }
      const anchorKeys = isRecord(anchor) ? Object.keys(anchor) : [];
      const listed = await list();
      const rows = Array.isArray(listed) ? listed : Array.isArray(listed?.sessions) ? listed.sessions : [];
      const plain = rows.filter(isRecord).map((row) => ({
        id: String(pick(row, ["id", "sessionId", "session", ...anchorKeys]) ?? ""),
        title: pick(row, ["title", "name", "summary", ...anchorKeys]) ?? null,
        updatedAt: asTime(pick(row, ["updatedAt", "updated", "mtime", "modifiedAt", "at"])),
        // Always null here: the list role carries summaries, not stored logs. A caller that
        // needs the size asks for one session; this call stays one call.
        entries: anchorKeys.length > 0 ? countEntries(pick(row, anchorKeys)) : null,
        bytes: null
      }));
      const ordered = [...plain].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
      return ordered.slice(0, limit).map((row) => ({
        id: row.id,
        title: typeof row.title === "string" ? row.title : null,
        updatedAt: row.updatedAt,
        entries: row.entries,
        bytes: row.bytes
      }));
    }
  };
  const tools = {
    add(name2, handler) {
      if (typeof name2 !== "string" || name2 === "") throw new TypeError("simple.tools.add: name must be a non-empty string");
      const capabilityObject = capability("tools");
      const register = capabilityObject.register;
      if (typeof register !== "function") throw new TypeError("simple.tools.add: the tools capability has no register role");
      const spec = typeof handler === "function" ? { execute: handler } : handler;
      if (typeof spec.execute !== "function") throw new TypeError("simple.tools.add: a tool needs an execute function");
      const description = typeof spec.description === "string" && spec.description !== "" ? spec.description : name2;
      const parameters = spec.parameters ?? {};
      const output = spec.output ?? {};
      const render = spec.render ?? ((_args, value) => [{
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value ?? null)
      }]);
      const definition = {
        name: name2,
        description,
        parameters,
        output: { schema: output, render },
        execute: (args, exec) => spec.execute(args, exec)
      };
      const dispose = register(definition);
      const once = () => {
        if (!registered.has(name2)) return;
        registered.delete(name2);
        dispose();
      };
      registered.set(name2, once);
      return {
        name: name2,
        dispose: once,
        definition: { name: name2, description, parameters: Object.keys(parameters) }
      };
    },
    has(name2) {
      if (!source.has("tools")) return false;
      const capabilityObject = capability("tools");
      const lookup = capabilityObject.lookup;
      if (typeof lookup === "function") return lookup(name2) !== void 0;
      return registered.has(name2);
    },
    names() {
      if (!source.has("tools")) return [];
      const capabilityObject = capability("tools");
      const schemas = capabilityObject.schemas;
      if (typeof schemas === "function") {
        const listed = schemas();
        const rows = Array.isArray(listed) ? listed : [];
        return rows.map((row) => isRecord(row) ? String(row.name ?? "") : "").filter((value) => value !== "");
      }
      return [...registered.keys()];
    }
  };
  const settings = {
    async define(key, defaultValue, _schema) {
      if (typeof key !== "string" || key === "") throw new TypeError("simple.settings.define: key must be a non-empty string");
      const capabilityObject = capability("settings");
      const schemaAccepted = _schema !== void 0;
      let described;
      if (typeof capabilityObject.describe === "function") {
        try {
          described = capabilityObject.describe();
        } catch {
          described = void 0;
        }
      }
      const rows = Array.isArray(described) ? described.filter(isRecord) : [];
      const existing = rows.find((row) => pick(row, ["ns", "key", "name"]) === key);
      let schemaReadable = false;
      if (typeof capabilityObject.schema === "function") {
        try {
          schemaReadable = capabilityObject.schema(existing ?? key) !== void 0;
        } catch {
          schemaReadable = false;
        }
      }
      if (existing === void 0) {
        if (typeof capabilityObject.update !== "function") {
          return { key, status: "unreadable", reason: "the settings capability has no update role", schemaReadable, schemaAccepted };
        }
        try {
          await capabilityObject.update(key, defaultValue);
          return { key, status: "applied", reason: null, schemaReadable, schemaAccepted };
        } catch (error) {
          return { key, status: "rejected", reason: String(error?.message ?? error), schemaReadable, schemaAccepted };
        }
      }
      return {
        key,
        status: "already-present",
        reason: null,
        schemaReadable,
        schemaAccepted
      };
    }
  };
  return Object.freeze({
    sessions,
    tools,
    settings,
    available() {
      return { sessions: source.has("store"), tools: source.has("tools"), settings: source.has("settings") };
    },
    dispose() {
      for (const dispose of [...registered.values()]) dispose();
    }
  });
}

// compat/index.ts
var KERNEL_ROOT_PACKAGE = "@deepseek-ai/dsh-root";
var TABLES = [table, table2, table3, table4];
function tableFor(identity) {
  return TABLES.find((table5) => table5.kernel === identity || table5.packageVersion === identity);
}
function knownKernels() {
  return TABLES.map((table5) => table5.kernel);
}
function installedKernel() {
  const handed = process.env.DSH_LINK_KERNEL_VERSION ?? "";
  if (handed !== "") return handed;
  const global = globalThis.__DSH_VERSION__;
  if (typeof global === "string" && global !== "") return global.startsWith("dsh-v") ? global : "dsh-v" + global;
  const version = installedVersion();
  return version === null ? null : "dsh-v" + version;
}
function installedVersion() {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = readManifest(dir);
    if (manifest !== null) return manifest;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function readManifest(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (parsed.name === KERNEL_ROOT_PACKAGE && typeof parsed.version === "string") return parsed.version;
  } catch {
  }
  return null;
}

// plugins/dsh-link-compat/src/index.ts
var name = "dsh-link-compat";
var Config = z.object({
  kernel: z.string().default(""),
  strict: z.boolean().default(true)
});
var PRESENCE_CLAIMS = /* @__PURE__ */ new Set([
  "service-present",
  "member-present",
  "member-absent",
  "member-matching-absent"
]);
function servicesTheSectionPremisesOn(table5) {
  const needed = /* @__PURE__ */ new Set();
  for (const row of Object.values(table5.refused)) {
    for (const witness of row.witness) {
      if (PRESENCE_CLAIMS.has(witness.claim)) needed.add(witness.service);
    }
  }
  return [...needed].sort();
}
var inject = (() => {
  const kernel = installedKernel();
  const table5 = kernel === null ? void 0 : tableFor(kernel);
  return table5 === void 0 ? [] : servicesTheSectionPremisesOn(table5);
})();
function apply(ctx, config) {
  const kernel = config.kernel !== "" ? config.kernel : installedKernel();
  if (kernel === null) {
    throw new UnsupportedError({
      capability: "link",
      kernelVersion: "unknown",
      reason: "this process cannot tell which kernel it is running inside",
      suggestion: "set the row config kernel: to one of " + knownKernels().join(", ")
    });
  }
  const table5 = tableFor(kernel);
  if (table5 === void 0) {
    throw new UnsupportedError({
      capability: "link",
      kernelVersion: kernel,
      reason: "this build carries no compat table for " + kernel,
      suggestion: "add compat/table/" + kernel + ".ts with the same shape, then run: node plugins/build.mjs"
    });
  }
  const compat = {};
  const loader = createCompatLoader({
    table: table5,
    membersOf: (service) => membersOfService(ctx, service),
    valueOf: (service) => valueOfService(ctx, service),
    // The loader answers for "link" itself, keyed by role word. The facade is
    // filled immediately below, so these thunks only ever run after it exists.
    selfProvided: {
      link: {
        capability: (name2) => compat.capability(name2),
        has: (name2) => compat.has(name2),
        require: (name2) => compat.require(name2),
        report: () => compat.report(),
        services: { get: (service) => compat.services.get(service) }
      }
    },
    strict: config.strict
  });
  const simple = createSimpleLayer({ kernel: loader.kernel, has: (name2) => loader.has(name2), require: (name2) => loader.require(name2) });
  Object.assign(compat, {
    services: loader.services,
    capability: loader.capability,
    has: loader.has,
    require: loader.require,
    report: loader.report,
    simple
  });
  const effect = ctx.effect;
  if (typeof effect === "function") effect(() => () => {
    simple.dispose();
  });
  ctx.provide("link", { compat });
  const report = loader.report();
  const logger = ctx.logger?.("dsh-link-compat");
  logger?.info("kernel " + report.kernel + ": " + report.resolved.length + " capabilities resolved, " + report.refused.length + " refused, in " + report.resolveMs + "ms");
  for (const refused of report.refused) {
    const row = report.rows.find((entry) => entry.capability === refused);
    logger?.info("refused: " + refused + " \u2014 " + (row?.failures.join("; ") ?? "see the table"));
  }
  if (report.staleRefusals.length > 0) {
    logger?.error("compat table " + report.kernel + " has stale refusals: " + report.staleRefusals.join(", "));
  }
}
function valueOfService(ctx, service) {
  try {
    return ctx.reflect.get(service, false);
  } catch {
    return void 0;
  }
}
function membersOfService(ctx, service) {
  const value = valueOfService(ctx, service);
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "object" && typeof value !== "function") return void 0;
  const own = Object.getOwnPropertyNames(value).filter((member) => !member.startsWith("#"));
  const proto = Object.getPrototypeOf(value);
  const inherited = proto === null ? [] : Object.getOwnPropertyNames(proto).filter((member) => member !== "constructor" && !member.startsWith("#"));
  return [.../* @__PURE__ */ new Set([...own, ...inherited])].filter((member) => isCallableMember(value, member));
}
function isCallableMember(value, member) {
  try {
    return typeof value[member] === "function";
  } catch {
    return false;
  }
}
export {
  Config,
  apply,
  inject,
  name,
  servicesTheSectionPremisesOn
};
