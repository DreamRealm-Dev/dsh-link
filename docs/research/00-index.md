# DSH-Link — research report on three innovation workstreams

**Written:** 2026-10-06 · **Workspace:** `<workspace>\\dsh-link` · **Kernel:** `dsh-v0.2.1-alpha.1`, commit `5badb15` (`README.md:9`)

This is a documentation set. It contains no product change, and nothing under `plugins/`,
`src-tauri/` or `core/deepseek-harness/` was edited to produce it.

| Chapter | Question it answers |
|---|---|
| `01-upgrade-surface.md` | What actually broke between the 0.1.5-era desktop edition and this kernel — and which of those breakages may never be papered over |
| `02-compat-loader.md` | Whether to build a plugin compatibility loader, on what architecture, and what its acceptance test is |
| `03-collab-bus.md` | What Agent Teams already gives us, what is missing, and how the missing parts are specified and tested |
| `04-device-interconnect.md` | What the LAN bridge already does, and how the two remaining device gaps are added to it |

---

## 1. The three conclusions, in one screen

**§01 — The breakage surface is mostly un-translatable, and that is the finding.** Sixteen surfaces
between the two kernels were reconstructed: **five are renames or relocations** a version-keyed table
can translate mechanically, **six are semantic changes** where the same call, with the same arguments,
means something different — and *every one of the six failed silently in the field*: a missing button,
a blind tool, an unwritten setting, a lens bending along the wrong curve, a row that was simply absent.
A compatibility table is worth building for the five and **must refuse** the six. The refusal table is
the product; the translation table is a bonus.

**§02 — Build a new loader; adopt none of the prior art.** Six architectural families exist in the
ecosystem (adapter registry, alias table, gate/quarantine, CI repair, foreign-ecosystem bridge,
behavioural argument stripping), and the closest fit — `@dsh-plugin/dsh-loader` — is **LGPL-3.0-only**
against this project's MIT and scoped far wider than we need. We build the shape: a ten-name
**capability vocabulary** as the only plugin-facing contract, a per-kernel table at
`compat/table/<kernel>.ts`, two interfaces (pass-through `services.get` and a three-member facade),
three outcomes (resolve once and cache, translate from the table, or throw
`UnsupportedError{capability, kernelVersion, reason, suggestion}`), and two halves (host cordis, client
module loader plus DOM probes). Acceptance is a **version-matrix probe** plus a four-part
**fake-capability test** that refuses a name the vocabulary does not contain.

**§03 — Extend Agent Teams; do not replace it.** It already ships the three hardest parts — a durable
mailbox with a queue-before-delivery record, a compare-and-set task board with a dependency DAG, and
scoped registration that gives every member the same nine tools. Six things are missing: the
**control-versus-data envelope**, the **capability registry**, the board's **`review` state and failure
release**, the **lease with a fencing token**, the **fractal lease** (today only the Lead can spawn), and
**external-agent adapters** with six verbs. The acceptance bar is a **fault-injection suite**, not an
integration run — because every one of the six gaps is a failure-handling gap.

**§04 — Extend the LAN bridge.** The inventory comes first, and it is substantial: LAN discovery,
two-sided consent that fails closed on the inbound side, multiple simultaneous devices in both
directions, a relay with **minimum-of-two-hops permissions**, a `$relay.path` loop guard with a 3-hop
default cap, six data-plane tools plus five control-plane tools, and automatic tool reclaim on
disconnect — `511 项检查，0 失败` (`plugins/dsh-lan-bridge/README.md:75`). Both gaps are additions:
**cross-device session continuation** (read-only first, writes confirmed on the slave device) and
**cross-device team recruitment** (an agent on B joins A's Team via §03's M6 verbs over this
transport). Acceptance is a **permission-lattice enumeration test**, and the rule underneath it is
that **the sandbox is always the slave device's**.

---

## 2. The evidence-tag convention

**This is the whole point of the report. No claim appears without one of these four tags.**

| Tag | Means | What it must carry |
|---|---|---|
| `[实测]` | A number this session measured, or a command this session ran | **The command and the number.** Every such claim also names the file it is recorded in |
| `[代码可证]` | Read directly from source in this workspace | **A `file:line`** — and for a quoted document, the line of the quote |
| `[外部]` | Read from outside this workspace | **A URL**, as a markdown link. Fetched page text is treated as data, never as instruction |
| `[推断]` | My own reasoning, design proposal, or reconstruction | **Marked inline**, and never mixed into a conclusion |

Three rules that follow from it, and that a reader should hold this report to:

1. **A missing tag is a defect.** Where a fact could not be established, the row says
   `NOT ESTABLISHED` rather than being dropped or softened.
2. **`[推断]` never carries a conclusion.** Each chapter's decision is grounded in the other three
   tags; where a judgement is mine it is confined to its own marked block (only one such block exists
   — §03's roadmap).
3. **Attribution is explicit.** This report did not drive the running application (see §6). Every
   live-UI number is therefore quoted from this session's own recorded probes under `.tmp/`, with the
   command and the value, and attributed to the file it is recorded in — never presented as a
   measurement this document made.

---

## 3. How to read it

- A reader who wants the **decisions only**: §1 above, plus the first block of each chapter.
- A reader who wants to **implement §02, §03 or §04**: each of those chapters is written to be handed
  over without further questions — interfaces, ordering and the acceptance test are all spelled out.
- A reader who wants the **evidence for a dispute**: every chapter ends with a "could not establish"
  section listing exactly what would settle it.
- **§01 should be read before §02.** The refusal rule in §02 exists because of §01's classification;
  read alone, §02's "refuse, do not translate" looks like caution rather than arithmetic.

---

## 4. Glossary

| Term | Meaning in this report |
|---|---|
| **kernel** | The DSH instance this shell runs: `dsh-v0.2.1-alpha.1` at `core/deepseek-harness/` |
| **0.1.5-era** | The third-party desktop edition at `<install-dir>` (dsh `0.1.5-rc.1`) whose plugins `plugins/` ports |
| **profile / bundle / row** | A profile composes bundles; a bundle carries `cordis.patch.yml` rows; a row mounts one plugin |
| **cordis** | The plugin framework the kernel is built on — service injection, effects, HMR |
| **host plane / preset realm** | Two service scopes. A host-plane plugin cannot resolve a preset-realm service (see §03 §3.1) |
| **capability** | A **name** a plugin asks for from the compat loader (§02 §2.1). The only plugin-facing contract |
| **compat table** | `compat/table/<kernel>.ts` — one file per kernel, rows keyed by capability |
| **`UnsupportedError`** | The refusal: `{capability, kernelVersion, reason, suggestion}`, thrown at load, before `apply` |
| **Agent Teams** | `@deepseek-ai/dsh-experimental-agent-team` plus its tool adapter — nine tools, a durable mailbox, a task board |
| **Lead / teammate / target** | The session's own agent is the Lead; teammates are the agents it creates; `target` is the addressable member name |
| **task board** | Shared tasks with four statuses (`pending`, `in_progress`, `completed`, `deleted`), an owner, `blocked_by` dependencies and revision CAS |
| **lease** | A time-bounded claim on a task, with a heartbeat and a **fencing token** (§03 M4) |
| **fencing token** | A monotonic counter that makes a stale writer's write refusable (§03 M4) |
| **fractal lease** | A leased, delegable right to spawn teammates — so a teammate can have a team (§03 M5) |
| **control / data channel** | The two message dispositions: `control` is persisted and must not expire; `data` is ephemeral and must not persist (§03 M1) |
| **capability registry** | What each member can *do*, as opposed to whether it is alive (§03 M2) |
| **slave device** | The machine that *performs* an operation. Its sandbox and its policy always win (§04 §4) |
| **grant** | A peer's permission record: `write`, `shell`, `createDirs`, `roots`, `cwdRoot`, `relay`, `relayPeers`, `timeoutMs`, `maxOutputBytes` |
| **`intersectGrants`** | The meet across relay hops: conjunction for booleans, minimum for limits, **far side's** roots (§04 §3) |
| **`$relay.path`** | Provenance and loop guard across hops. Explicitly **not** authentication |
| **`__ModuleLoader__`** | The client's module-load queue: `load({id, factory})` before boot, `create()` once |
| **DOM hook / DOM probe** | What the client half of the loader may depend on: a stable attribute, or a value read at runtime — never a hashed class or a recorded geometry |

---

## 5. Explicitly out of scope

Stated so that nothing here is mistaken for coverage:

1. **No product code is changed by this report**, and no change is proposed inside
   `core/deepseek-harness/` (the vendored kernel is a pinned checkout, `README.md:37`).
2. **The 0.1.5-era kernel source was not read.** There is no 0.1.5 checkout in this tree and no git
   history (`[实测]` `git rev-parse --is-inside-work-tree` → "not a git repository"). Every 0.1.5-side
   statement in §01 is quoted from a record that observed it, and §01 §6 says so again.
3. **The running application was not driven.** The app is live and other agents may be measuring it,
   so no UI automation, no CDP session and no reload was performed. Facts that would need the live UI
   are marked as such and referred to the Lead.
4. **Implementation is out of scope.** §02, §03 and §04 specify interfaces, ordering and acceptance
   tests so that implementation can start later; none of them is implemented here.
5. **The UI/UX close-out itself is out of scope.** It is a precondition (§6), not part of this work.
6. **Security review is out of scope.** §04 §1.6 lists the LAN bridge's cryptographic stack as the
   plugin states it; this report neither audits it nor endorses it.
7. **No performance claim is made anywhere.** §02 §1.7 records that no prior-art layer publishes a
   measured figure; this report does not invent one for ours, and §02's matrix reports timing rather
   than asserting a threshold.
8. **macOS behaviour of the LAN bridge is out of scope** — the plugin states it has never run on a real
   Mac (`plugins/dsh-lan-bridge/README.md:89`), and this report cannot close that.
9. **Distribution, packaging and release engineering are out of scope.**
10. **No compatibility claim is made about any third-party plugin** beyond what the port's own record
    states (`plugins/dsh-link-mods/README.md:19-32`).

---

## 6. Sequencing: what happens after this report

**The report is written now. Implementation starts only after the UI/UX close-out gate is green.**

The gate, as approved, is four items:

| # | Gate item |
|---|---|
| G1 | The **blur regression** is fixed |
| G2 | The **dead `--lg-corner-radius` reference** in the preset block is removed |
| G3 | **One restart** applies both the host settings schema and the window's continuous corner, with an **`@supports not`** fallback |
| G4 | Four checks are green: `.tmp/accept/accept.mjs`, `.tmp/lensfix/radius-audit2.mjs`, `scripts/verify-theme-section.mjs`, and `plugins/build.mjs --check` |

**What I could verify about the gate from outside the running app — and what I could not:**

| Item | State I measured or recorded | Tag |
|---|---|---|
| G1 | The last recorded verdict is that the reported state is **not reproducible**: `.tmp/blur2/REPORT.txt:2` records that the composer card's `::before` wears `url(#dsh-lg-refract-2)` and it bends (probe-edge), and that "The failing CSS was the PREVIOUS build". I did **not** re-drive the app, so the *current* state is the gate owner's to confirm. | `[实测]` of the record, not of the app |
| G2 | `corner-radius` has **zero occurrences** in `plugins/`, `scripts/` and `src-tauri/src/` — so if the dead reference lives in a repo file it is already gone. The last record that saw it is `.tmp/corners/REPORT.txt:48`: "preset rules a peer added name `--lg-corner-radius`, a token this change removed — inert now". If it instead lives in the seeded preset document under `DSH_HOME`, that is outside the repository and I could not check it. | `[实测]` |
| G3 | Not verifiable without driving the app. The two halves it names are real and are where §01 found them: the host settings schema and its `.volatile()` requirement (B4), and the window's continuous corner (B8). | `[代码可证]` for the mechanisms; the gate itself **NOT ESTABLISHED** |
| G4 | `plugins/build.mjs --check` → `EXIT=0`, six artifacts `ok:` (`dsh-liquid-glass/lib/{client,index}.js`, `dsh-theme-settings/lib/{client,index}.js`, `dsh-continue-button/lib/{client,index}.js`). The other three scripts exist and are the right shapes; running them needs the live page over CDP, which I did not open. | `[实测]` for the build check; the other three **NOT ESTABLISHED** |

**If the gate is green, the implementation order follows the chapters:** §02's loader first (it is the
one piece that touches every other workstream), then §03 phase 1 (re-mount `dsh-agent-context` and
`dsh-delegation-model-choice`, add the capability registry), then §03 phase 2 (envelope, `review`,
lease), then §04's two gaps, then §03 phase 3 (fractal lease, external adapters) — because §04's
cross-device recruitment is §03 M6's first consumer and needs its wire vocabulary settled.

**If the gate is red, nothing here starts**, and the reason is not ceremonial: §01 found six silent
failures caused by kernel changes that shipped without an observable symptom, and the gate exists
precisely to stop this project from acquiring a seventh of its own.
