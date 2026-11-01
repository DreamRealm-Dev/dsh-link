# dsh-link-notes

Notes whose data lives outside the process: an append-only note ledger on disk, folded through the
collaboration bus's own rule, with tombstones instead of deletions. The package was a library with no
bundle patch until R185; R186 gave it the three things md item 13 asks for - the two thresholds, one
prompt section, and the two tools of the `notes` group.

## What it contributes

| piece | name | where it comes from |
|---|---|---|
| data face | `note/state` facts in a control log | `openNotesStore`, `appendNote`, `setNoteState`, `projectNotes` |
| prompt section | `notes:ledger`, order 700, `interpolate: false` | registered in `apply()`; text is a provider evaluated at every assembly |
| tools | `notes_list` (read-only, never asks) and `notes_add` (asks every call) | registered on the host layer, so the `notes` group can mask them |
| routes | `GET /api/dsh-link-notes/state` (read-only) and `POST /api/dsh-link-notes/add` (narrow write) | registered in `apply()` on the loopback web server, shaped like `dsh-link-panel`'s state route |
| thresholds | `maxNotes` (200) and `maxChars` (100), both optional positive integers in `NotesConfig` | refused by name, or converged when rendering |

The section's text is the fold, read fresh at every assembly (`projectNotes(store.log.replay())` through
`notesOf`). There is no second copy of a note anywhere: a byte in the prompt is a byte the fold answered
with, or it is not in the prompt.

## The thresholds, at three layers

| layer | where | over the limit |
|---|---|---|
| (a) tool boundary | the body of `notes_add` | a tool error the model can read and rewrite around |
| (b) `appendNote` | every programmatic write | the same named code, thrown, and nothing is appended |
| (c) render | `renderNotesSection(state, limits)` | never refuses: it converges, deterministically |

Layer (c) is the one that has to be unconditional, because the ledger is append-only: a body an older
version wrote past either limit is on disk forever. So it renders the newest `maxNotes` live notes, states
how many older ones it left out in a line of its own (`… (+K older note(s) elided)` - not silent), and cuts
a body longer than `maxChars` at exactly `maxChars` code points with an ellipsis in the last one. Code
points, not UTF-16 units: cutting a surrogate pair in half would replace one character with two.

Named refusals, and nothing else is invented:

- `NOTES_INPUT` - the arguments are not usable (missing, empty, unknown or wrongly typed field).
- `NOTES_TOO_LONG` - one body is longer than `maxChars` code points.
- `NOTES_FULL` - the ledger already holds `maxNotes` live notes.

Approval and kernel-side refusals are passed through verbatim. The `ask` decision carries no reason of its
own, so what the model reads is the kernel's sentence (`the user rejected tool "notes_add"`, `tool
"notes_add" requires approval, but no approval channel is available`) rather than a synonym written here.
With no approval channel the call is denied before the body runs, and the ledger does not move.

## The two write paths (R189)

One rule, two doors. Both doors call `writeOneNote`, which is this package's only `appendNote` call site, so
the allowed fields, the tag normalisation, the two thresholds and the three named refusals are the same code
on both paths. `test/notes-route.spec.mjs` reads that as bytes: exactly one `appendNote(` call site in the
shipped artifact, reached by the tool and by the route.

| who writes | path | what it costs | where |
|---|---|---|---|
| the agent (model) | `notes_add` tool | every call goes through `tools/pre-execute` and is put to the user for approval; with no approval channel the call is denied before the body runs and nothing is written | `installTools` |
| the user (panel input) | `POST /api/dsh-link-notes/add`, body `{ text, tags?, author? }`, `author` defaults to `"user"` | no approval prompt: a person typing does not ask themselves; the write stays narrow instead - one note per call, three fixed fields, the same three refusals | `installRoutes` |

The read side is one route. `GET /api/dsh-link-notes/state` answers
`{ ok, path, readOnly: true, limits, counts, notes }`: the fold's live notes (`id`, `text`, `tags`, `state`,
`author`, `at`, `seq`), the tombstone count and `counts.malformed`, and `limits` taken from the row's own
resolved thresholds. Nothing in it writes - no clock, no served counter, no ledger byte moves - so two calls
over an unchanged ledger answer the same bytes.

The write route answers `{ ok: true, seq, notes }` (`notes` is the live count after the append), or
`{ ok: false, error: { code, message } }` where `code` is `NOTES_INPUT` (400), `NOTES_TOO_LONG` (400) or
`NOTES_FULL` (409) and `message` is the original sentence, byte-identical to the one the same call gets from
`appendNote`. Anything else keeps `code: null` with status 500: this build failed, it did not refuse the
caller's note. Any verb other than the one a route takes is `405` + `METHOD_NOT_ALLOWED` and an `Allow` header.

`test/notes-route.spec.mjs` is this face's self-check: 18 readings over a real socket, and `--self-attack`
injects one route-local second rule into the artifact's own bytes (a boundary one code point laxer than the
shared one) and demands that exactly the two readings it declares move.

## What it costs

- **A note change is one prompt-head rewrite on the next request.** The section is re-evaluated at every
  assembly, but a prompt node is only replaced when its text changed, so an unchanged ledger commits
  nothing - and a changed one rewrites the head once. Not zero cost, and not once per step.
- **A section change is the whole section, not the note.** Measured with this build: 200 live notes of 100
  ASCII code points render to 20,640 code points / 20,642 UTF-8 bytes (201 lines); the same ledger with one
  more (over-long) note renders 20,668 code points and carries the elision line; 200 notes of CJK text
  render 13,040 code points but 33,042 bytes. The byte count is the one a request pays.
- **Ids, authors and tags are not in the section.** It is a budgeted projection of the body; `notes_list`
  is the on-demand read that carries them.

## Known boundaries

1. **The group's membership lives in another package, and a restart takes the declaration with it.** The
   two names are written down in `plugins/dsh-link-groups/cordis.patch.yml` (no package manifest carries a
   tool list), and a group's open state is session state: after a restart or resume the `notes` group falls
   back to its configured state and has to be declared again. Until it is, `notes_add` answers approval but
   the two tools are masked from the model's face.
2. **The tools are host-layer registrations.** That is what lets the group mask them, and it also means they
   exist in every preset's tool face until a group closes; there is no per-mode hiding in this package.
   (The section is the safer half: a persona that is `complete` suppresses other sections.)
3. **Layer (c) is a projection, not a promise about the data.** Over-limit history renders; it is not
   repaired, truncated on disk or deleted. `NOTES_FULL` says nothing was appended - it does not say a note
   may be removed, because removing one is `setNoteState(id, 'deleted')`, a tombstone, and no tool here does it.
4. **The producer did not verify the live client.** No restart was taken this round: the boot line, the group's
   masking in a live session, the real `request/header` cost trio and the live prompt length are unmeasured
   here. Gate 119 `notes-inject` owns those readings; gate 118 `notes-ledger` owns the ledger-level ones.
5. **The built lib imports two bare kernel specifiers** (`@deepseek-ai/schemastery`, `@deepseek-ai/dsh-tools`)
   and one relative neighbour (the collaboration bus's own built module). They resolve in a loaded profile;
   offline, `scripts/verify-notes.mjs` stages the artifact onto absolute paths, and
   `test/notes-invariants.mjs` stages the same way.
6. **`test/notes-invariants.mjs` is a producer self-check, not a gate.** It reads 34 claims against the shipped
   artifact's own bytes and can inject five defects (`--mutant …`) whose declared sets must match what moves.
   It is not registered in `scripts/verify-all.mjs` and does not replace gates 118/119. The same goes for
   `test/notes-route.spec.mjs` (18 route readings, one declared mutant).
7. **The agent has no path to the narrow write.** The route is not registered as a tool: the tool face this
   row contributes is `notes_list` and `notes_add`, and nothing else (the self-check reads the registry the
   row registered into, and no tool carries a URL). The only way in is HTTP, and nothing in this package
   hands a model an HTTP client pointed at it.
8. **The two routes are NOT behind the kernel's `/api` browser-trust fence.** That fence is a check the Client
   Connection service runs on its own `/api` prefix route
   (`core/deepseek-harness/packages/client/connection/src/api-request-trust.ts:91`, applied at
   `core/deepseek-harness/packages/client/connection/src/index.ts:141-158`); the web server consults its EXACT
   route table first (`core/deepseek-harness/packages/host/webserver/src/index.ts:319-328`), so an exact route a
   plugin registers answers before that prefix is reached and sees no cookie, token or `Origin` check. What
   keeps these routes local is the bind, not a check here: the kernel refuses `--host 0.0.0.0` at startup
   (`core/deepseek-harness/packages/bundle/web-app/src/startup.ts:85-87`) and its web server config admits only
   that literal and `127.0.0.1` (`core/deepseek-harness/packages/host/webserver/src/index.ts:127`). Anything
   that can reach the loopback port can POST this route; the shell's proxy (31761 → 31760) forwards `/api`
   paths to the same handler (R188 measured the panel's route answering 200 on both ports).
9. **The thresholds reach the route as the row's own resolution, never as a second copy of the numbers.**
   `installRoutes` is handed the same `limits` object the tools and the section use, so a later layer that
   overrides `maxNotes`/`maxChars` changes both what the route REPORTS and what it ENFORCES. The reading that
   pins it runs with non-default limits and compares the wire answer with the row's own boot line.
