# dsh-link-panel

The floor of the unified "interconnection" panel, and the pane that shows it: what is in the panel is
**data**, the projection is a **pure function**, an item the registry cannot place is refused **by
name** — and the right rail (the client half, kind `pane`) draws the visible items, the refusals, and
the note ledger, with one box that writes one note at a time.

The pane is also a **seam**: other LINK features declare their own items into it through the
`linkPanel` client-plane service (`ctx.provide`/`inject`, the same family as `ctx.locale`), with the
same three refusal names and the same ordering rule as the host registry. That is the section
[The contribution seam](#the-contribution-seam-ctxprovidelinkpanel-) below.

## The three pieces

**1. An item is data.** `{ id, kind, title, source, order }` — five fields, no more. `kind` is drawn
from a closed set:

| kind | sink | what it is |
|---|---|---|
| `pane` | `right-rail` | a place with content (the reference is dsh-link-teams' pane) |
| `action` | `right-rail` | a control on the panel itself |
| `status` | `header` | a state a person should see without opening anything (the lan-bridge notice area) |

Items arrive from **row config** (`config.entries`), so "what is in the panel" is readable in the
composition itself. A plugin that wants an item declares one there — by data, not by code. `pane` is
also the `kind` the tab type registers under (below): the registry's word for a right-rail place, not a
new name invented by the shell.

**2. The projection is a pure function.**

```js
import { projectPanel, PANEL_KINDS, PANEL_REJECT, PANEL_SINKS } from 'dsh-link-panel'

const { visible, rejected } = projectPanel(entries, { sinks: PANEL_SINKS })
```

No clock, no environment, no locale, no I/O. Same input, same bytes out — *including two different
arrival orders of the same items*, which is why:

- `visible` is sorted by `order`, and a tie is broken by the item's own canonical JSON (data, never
  arrival order);
- a **duplicated id refuses every claimant** (PANEL_DUP_ID), rather than letting the first arrival win:
  keeping one of two claimants is the registry guessing about a fact nobody stated.

`sinks` names the sinks **mounted in the world you are asking about**. Omitted means "all of them"
(the registry's own view); `{ sinks: [] }` is a world with no shell, where every item is refused with
the missing sink named and `code: null` (the item is fine, the shell is not there yet).

**3. A refusal is named.** The whole family is three names (R188-contract.md §9 R3):

| code | when |
|---|---|
| `PANEL_UNKNOWN_KIND` | `kind` is outside the closed set — never translated to the nearest known kind |
| `PANEL_EMPTY_SOURCE` | `source` is empty, blank or not a string |
| `PANEL_DUP_ID` | more than one item claims the same id (every claimant) |

Everything else that is refused keeps its **own text** and carries `code: null`: a non-finite or
missing `order`, a blank `title`, an id that is not a string, an item that is not an object, a field
whose getter threw. **No fourth code is invented** — a second name for a fact that already has a name
is a second opinion about that fact.

### Two channels, one truth

```js
projectPanel(entries, { sinks })                 // -> { visible, rejected }; a refusal is NAMED in
                                                 //    rejected and never appears in visible.
                                                 //    An empty registry returns an empty projection.
projectPanel(entries, { sinks, strict: true })   // -> THROWS PanelRefusal listing every offender
                                                 //    (error.code is one of the three names, or null);
                                                 //    error.rejected carries the whole list.
```

World-refusals (a sink that is not mounted) never throw, not even in strict mode: the batch is fine,
the shell is not there. Argument-shape errors (`entries` not an array, `sinks` not an array) throw a
plain `TypeError` with no `PANEL_` code, because a caller's bug is not a refused item.

## The read-only route (the registry)

```
GET /api/dsh-link-panel/state        (row config: path, sinks, entries)
```

Its shape follows `plugins/dsh-link-teams`' `GET /api/dsh-link-teams/state` — read the same file for
the reference implementation: `lib/index.js:38` (default path), `:43-49` (`sendJson`: status,
`content-type: application/json; charset=utf-8`, `cache-control: no-store`), `:88-163` (one snapshot
builder), `:165-188` (GET/HEAD only, `405 METHOD_NOT_ALLOWED` otherwise), `:196-207` (lazy
`webServer` binding, retried when the service appears, disposed with the row), `:229` (the ready line).

```jsonc
{
  "ok": true,
  "at": 1760000000000,                 // only the ROUTE reads a clock; the projection never does
  "path": "/api/dsh-link-panel/state",
  "readOnly": true,
  "registry": {
    "entries": 1,                      // declared items
    "kinds": ["pane", "action", "status"],
    "sinks": ["right-rail", "header"],
    "kindSinks": { "pane": "right-rail", "action": "right-rail", "status": "header" },
    "sinksMounted": ["right-rail"],    // what the shell has mounted HERE (the client half below)
    "route": "/api/dsh-link-panel/state"
  },
  "declared": { "visible": [ /* sorted items */ ], "rejected": [ /* named refusals */ ] },
  "mounted":  { "visible": [ /* the right-rail items */ ], "rejected": [ /* the rest, with the sink named */ ] },
  "served": 1,
  "compat": {                          // which registration face bound this route (R197)
    "present": true,                   // the loader's consumer face, read AT REGISTRATION time
    "via": "link.compat",              // or "ctx.server" when no loader took the route
    "role": "http.registerRoute",      // the vocabulary role that face bound, or null on the plain face
    "refused": null                    // the loader's own message when it was there and refused
  }
}
```

`declared` and `mounted` are the same pure projection of the same items under two sink sets. Serving
only one of them is how "there is nothing in the registry" and "there is no shell to draw it" become
the same reading — the confusion this row exists to prevent.

### Which face registers the route

The route has two registration faces and the answer names the one that took it:

| face | when | `compat` |
|---|---|---|
| `ctx.link.compat.capability('http').registerRoute(route)` | the cross-version loader `dsh-link-compat` is mounted and its `http` capability resolves | `via: 'link.compat'`, `role: 'http.registerRoute'` |
| `ctx.server.register(route)` (the context's own `webServer`) | no loader, or a loader that refused | `via: 'ctx.server'`, `role: null`, and `refused` carrying the loader's own text |

**The handle is keyed by ROLE WORD.** `capability('http')` is `{ registerRoute, renderIndex }`
(measured in a booted kernel: R197-contract.md §1), so the member this row asks for is the role's own
word. The table's `binds[]` row — `role: http.registerRoute -> member: register` — names the kernel
member that the role resolves to; it is not a key of the handle. Asking the handle for `.register` finds
nothing, and that is exactly how this row once refused a loader that was mounted, reachable and willing.
`PANEL_COMPAT_MEMBER` is derived from `PANEL_COMPAT_ROLE` with the loader's own rule, so the two cannot
drift apart.

**The moment is the web server's arrival, not `apply()`.** In the live client `apply()` runs before the
web application mounts. The whole binding is one function, run from `apply()` and again from this row's
own `ctx.inject(['webServer'])` retry; while `webServer` is pending it returns without asking anything,
because a loader asked then can only answer about a world that has not mounted and its answer is not a
refusal the loader ever made. The loader is read with `ctx.get('link')` **at that moment** and is never
listed in this package's `inject`. A world without the loader therefore binds the same route, answers
the same bytes and does not wait for anything; `ctx.link` is never dereferenced, because in cordis that
read is an error and this row must not have it. A loader that throws is not swallowed: its message
travels back in `compat.refused` and the route still binds through `ctx.server` — the fallback is not a
degraded mode, it is the same route, the same handler and the same answer with a different registration
behind it. Every field above `compat` keeps the bytes it had before R197 — `compat` is appended, never
woven in.

A row whose own configuration is malformed is refused **at mount** (a plain `Error`, no code): an
unknown sink name would silently show an empty panel, and an empty panel must not look like a broken one.

## The pane (the client half)

One package, two halves. The browser half reaches the right rail through the public path only: the type
into `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab` seat, the chip text into
`sidebar.right.pane.tab.title`, all under the definition `id` = `dsh-link-panel`. The type is a **page**
(`kind: 'pane'`, no `patterns`), so it claims no address and reaches a person through its **guide
entry** — the guide page's capsule, which opens `sidebar://pane`.

What the pane draws, and where each piece comes from:

| on screen | from |
|---|---|
| the visible items | `GET /api/dsh-link-panel/state` → `declared.visible`, **verbatim** (each row also shows its `kind`, its sink from `registry.kindSinks`, its `order` and its `source`) |
| the refused items, each with its code | the same answer → `declared.rejected` |
| the ledger | `GET /api/dsh-link-notes/state` → `notes`, plus the route's own `limits` |
| one new note | `POST /api/dsh-link-notes/add` with `{ text, author: 'user' }` — one note per submission |

**The pane does not have a second copy of any rule.** The text is sent exactly as typed — not trimmed,
not clipped to `maxChars`, not refused for being blank — because those three refusals belong to the
ledger (`NOTES_INPUT` / `NOTES_TOO_LONG` / `NOTES_FULL`): a client-side copy of them would be a second
rule that can disagree with the first (R189 §4.1). What the route refuses is shown **with the route's
own code and its own message**, so the three frozen names arrive on screen as themselves — and a code
this build does not know arrives as itself too, never translated into one of the three. An accepted note
clears the box; a refused one keeps the text so it can be fixed.

Read-only with respect to the registry: **there is no write-back**, no item editor, no reordering, no
persistence. The only write in the whole tab is the one note the person types.

Nothing in the half throws: the three registrations, both reads and the write are all fail-closed, and a
failure is written into the marker with the original text.

### The marker (what a live page reads, with zero panel operations)

```js
globalThis.__dshLinkPanel = { mounted: true, tabId: 'dsh-link-panel', items: [ /* the route's visible items */ ],
                              notes: { count: 1, limits: { maxNotes: 200, maxChars: 100 } },
                              contributed: [ /* the seam's rows */ ], failed: null }
```

| state | shape | when |
|---|---|---|
| mounted | `{ mounted: true, tabId, items, notes: { count, limits }, contributed, failed: null }` | every read holds; `items` is the route's own list, `contributed` the seam's rows, `limits` the route's own thresholds |
| failed | `{ mounted: true, failed: '<the original text>' }` | a route answered something unreadable, a route refused with a name, or a registration threw — the half stays mounted and says why |
| taken down | `{ mounted: false, disposed: true }` | the half was disposed |

A fourth, transient state exists for the moment between registering and the first answer: the mounted
shape with `items: []` and `limits: null`. It lasts one round trip; a reader that sees it should read
again rather than conclude the registry is empty (`reads` in the view — and the pane's own line
"registry pending · ledger pending" — says exactly that).

**What the marker does NOT prove.** It proves the client half ran, registered, folded the two route
answers, and computed a view. It does **not** prove a single pixel: not that the pane is open, not that
anything laid out, not that a click works. Reading pixels needs the pane open in a window, which is a
different (and dearer) reading — R189 keeps the naive "the user can see it" claim out of the record
(R189 §4.2).

**Two sources, never mixed.** `items` and `contributed` are different facts. `items` is
`GET /api/dsh-link-panel/state` → `declared.visible`, verbatim — a live reader holds it to the real
route byte for byte (gate 124 does exactly that). `contributed` is what other features declared
through the seam, and is `[]` when nothing declared or when the half has no seam at all. Mixing the
two would make that byte comparison meaningless, which is why the seam has a field of its own.

### The contribution seam (`ctx.provide('linkPanel', …)`)

The pane is not only the registry's screen: another LINK feature declares its own item into it through
a **client-plane service**, the same family as `ctx.locale`. This package provides it when its client
half activates, and the reference consumer is `dsh-link-lan-bridge`'s connection state.

```js
// in a contributor's client half:
export const inject = ['linkPanel', 'locale']

const disposed = ctx.linkPanel.declare({
  id: 'lan-bridge-status',        // unique: two declarations of one id are BOTH refused
  kind: 'status',                 // the registry's closed set: pane | action | status
  title: () => t('status.title'), // the feature's own word for it, read from its own dictionary
  source: 'dsh-link-lan-bridge',  // who it belongs to; drawn on the row beside the kind
  order: 200,                     // optional; omitted means 0
  body: () => reading(),          // optional: the row's own text
})
// the returned disposer takes that exact declaration back out again
```

The definition is the host registry's item — `{ id, kind, title, source, order }` — plus **`body`**,
the row's own text. `title` and `body` are each a **string or a function read once per projection**:
a feature's title usually comes from its own dictionary (`title: () => t('panel.item.title')` — the same
thunk rule this package's own tab type uses, so a language switch needs no re-declaration) and a body
can be a live reading (a connection state, a count) that this pane knows nothing about. Text that
throws is drawn as its own error text, and text that is neither a string nor a function refuses the
row: a contributor must not be able to take the panel down.

**The service is the whole contract:**

| member | meaning |
|---|---|
| `declare(definition)` | hand one declaration in; returns an **idempotent disposer** that removes exactly that declaration |
| `entries()` | the rows the pane draws now: sorted, frozen, and **projected on this call** — every `title`/`body` thunk is read again here, so two calls answer two arrays |
| `rejected()` | every declaration refused over the current claims, each with its own name and text, projected on this call too |
| `notify()` | **the named refresh path**: "my reading moved — take a fresh projection". It reads nothing itself and tells every listener that a projection is due. Never throws |
| `subscribe(listener)` | hear about every refresh (`declare`, a disposer, `notify`); returns the unsubscribe |

**Nothing is cached but the claims.** `entries()` and `rejected()` take a projection **on every call**:
they re-read each declaration's `title`/`body` thunk, so a row drawn after the reading moved carries the
reading as it is now — not the text the item answered when it was declared. That is the defect this rule
replaced: a projection frozen at `declare` time, with the provider's own reading moving on while the drawn
row stood still, because nothing ever asked the seam to look again.

**`notify()` is how a provider says "project again".** It is not a re-declaration (the item stays exactly
as declared; no second item is invented for it) and not a poll (this seam owns no clock and starts no
interval). A provider whose `body` answers a live value — a store, a reading, a count — calls `notify()`
when that value moves; this pane's loader is one of the subscribers, so the marker and the drawn row move
in the same step as the notification. `dsh-link-lan-bridge` is the reference consumer: it declares one
item and calls `notify()` from its own store subscription, and that subscription is released by the same
disposer that takes the item back out.

**One vocabulary, not two.** A refusal reuses the host registry's own three names and invents no
fourth:

| code | when |
|---|---|
| `PANEL_DUP_ID` | more than one declaration claims one id — **every** claimant is refused, so arrival order never picks a winner |
| `PANEL_UNKNOWN_KIND` | `kind` is outside the closed set — never translated to the nearest known kind |
| `PANEL_EMPTY_SOURCE` | `source` is empty, blank or not a string |

Everything else keeps its **own text** with `code: null`: a non-finite `order`, a `title` or
`body` that is neither a string nor a function (or answers nothing), an `id` that is not a non-empty
string, a `source` that is not a string, a field whose getter threw. A refused declaration never reaches the list; the pane draws it in its refusal block
with its own code and text, and `rejected()` reports it to the feature that declared it.

**The order is data, never arrival.** Rows are sorted by `order` ascending, a tie broken by the row's
own canonical JSON. Two arrival orders of the same declarations project to byte-identical rows and
refusals: no arrival index is kept anywhere in the seam.

**Fail-closed.** `declare`, `entries` and `rejected` never throw. A context that cannot `provide` (a
hand-driven mount) still gets a working pane — it simply has no seam to hand out, and the marker then
carries `contributed: []`.

**What the seam is not.** Not a registry write surface (the only write in the package is still one
note), not a sink router (every contributed row is drawn in this pane, in the order above), and not an
arbiter: a declaration it cannot place is refused, never placed somewhere close.

### Copy: a namespace of its own, and what is NOT copy

The pane's own words are a locale namespace, `dsh-link-panel`, registered at activation
(`ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-link-panel: dictionaries')` in
`src/client/index.tsx`) and read through the seat's `t` (both registrations declare `locale: NS`). The
dictionary is `src/client/locales.ts`: **zh and en carry the same keys**, and the type
`Record<PanelCopyKey, string>` on `en` is what holds them together.

| key | what it is |
|---|---|
| `tab.title` | the chip text and the guide entry's title |
| `guide.description` | the guide entry's one line |
| `panel.readonly` | the pane's read-only chip |
| `panel.reads` | the two reads: `registry {panel} · ledger {notes}` |
| `state.pending` / `state.ok` / `state.failed` | the three states inside that line |
| `items.empty` / `refused.empty` / `notes.empty` | the three empty states |
| `item.meta` | an item's field labels: `kind {kind} · sink {sink} · order {order} · {source}` |
| `notes.count` | the note count (**parameterised**: `{count}`) |
| `notes.limits` | the route's thresholds (**parameterised**: `{maxNotes}`, `{maxChars}`) |
| `notes.limitsUnread` | the threshold line before the ledger has answered |
| `input.label` | the box's placeholder **and** its `aria-label` (one string, one key) |
| `submit.idle` / `submit.busy` | the button, idle and working |
| `failure.line` | a named failure (**parameterised**: `{slot}`, `{code}`, `{detail}`) |
| `copy.format.line` | a refusal row and a submission result (**parameterised**: `{code}`, `{detail}`) |
| `refusal.noCode` | the refusal row with no code at all |

**What stays data (never translated, drawn verbatim):** everything the routes carry — an item's
`title`/`kind`/`source`/`order`, a note's text, author and tags, a refusal's `detail`, a route's code
(`NOTES_INPUT`, `NOTES_TOO_LONG`, `NOTES_FULL`, `PANEL_UNKNOWN_KIND`, …), a route path, and the
diagnostic sentences `view.ts`/`load.ts` build around them ("… HTTP 404 and the body is not a JSON
object: no route"). A refusal keeps the route's own name and message: a second name for a fact that
already has a name is a second opinion about that fact (view.ts: "those three refusals belong to the
route"). The line a failure is shown on is copy; the detail inside it is the original text.

**Two keys carry the same value in zh and en on purpose.** `failure.line` and `copy.format.line` are
punctuation around data — `{slot}: {code}: {detail}` — not sentences; translating the punctuation
would mean inventing a second spelling for the route's own words. Every other key differs between the
two dictionaries, and `node plugins/dsh-link-panel/test/panel-client-view.spec.mjs` reads the frozen
cells of `docs/dev/notes-ui.md` §4.2 and requires the `en` dictionary to be exactly those strings,
placeholder for placeholder (C3).

### The glyph

The one icon is `IconFlatListOutlineRegular`, imported from `@deepseek-ai/dsh-client-ui-primitives` —
a **baseline module** the shell preloads (the kernel's `packages/client/web/src/platform.ts`
`PLATFORM_MODULES`, mirrored in `compat/host-modules.json` `clientBaseline`), so the bundle leaves the
import external and the page supplies it from the module table.

It is drawn on the **guide entry** (`guide[].icon`): a tab type has no `icon` field at all — the
registry's only icon seat is the guide entry's, beside the title and the one-line description — and
the guide draws its own cube for a type that offers none.

Rules for a glyph here (measured off the first-party set, and the ones this package's self-check
enforces): **16×16**, **`currentColor`** (so light and dark both come from the surrounding text ink),
**one-pixel or 1.3-pixel stroke**, and no fixed colour or gradient anywhere. A first-party piece is
preferred; a self-drawn one would have to satisfy the same bytes (C7 reads `<svg>` in the source and
reddens on a 36×36 size, a fixed `#rrggbb`, `rgb()`/`hsl()`, or a gradient). Nothing in the set is
drawn at 36×36 or with a fixed fill.

## Known boundaries (this round, named)

- **The registry is read-only and the pane cannot add items.** `GET` is the registry's only verb; a
  registration endpoint would need an authorization story of its own (the teams row says the same about
  POST). The pane draws the registry, it does not edit it.
- **The marker is not pixels** (see above).
- **The pane consumes `GET /api/dsh-link-notes/state` in one exact shape**: `ok: true`, `notes` an
  array of note objects with a string `text`, and `limits` an object carrying numeric `maxNotes` and
  `maxChars`. Anything else is a **named client failure** (`response-shape`, naming the field and the
  keys that arrived) rather than a quieter reading — an empty ledger and a ledger this half cannot read
  must not look the same. The write route is `POST /api/dsh-link-notes/add` and its refusal envelope is
  `{ ok: false, error: { code, message } }`.
- **The default paths are hard-coded in the client half** (`/api/dsh-link-panel/state`,
  `/api/dsh-link-notes/*`); a row that renames the registry route with `config.path` moves the route and
  the pane does not follow it this round. Named, not hidden.
- **No persistence, no store, no `keepMounted`**: the pane re-reads both routes when it mounts.
- **No override/priority arbitration** for items: two items claiming one id are both refused, in the
  registry and in the seam alike.
- **The seam has no sink of its own.** Every contributed row is drawn in this pane, in the order the
  seam sorts it; a contribution is not routed to the notice area or anywhere else. `kind` says what the
  item IS, not where it goes.
- **Nothing is discovered automatically.** A feature that wants a row declares one through
  `ctx.linkPanel`; the seam reads no configuration, no directory and no network, so a feature that
  never declares leaves no trace — and `contributed` stays `[]`.
- **A refused declaration is visible, not fatal.** It is drawn in the pane's refusal block with its own
  code and text and is reported by `rejected()`; the rest of the panel is untouched, and nothing a
  contributor does can make the two route reads fail (the body of a row is read fail-closed).
- **No stylesheet.** The pane's copy now rides the `dsh-link-panel` locale namespace (above), but the
  rendering is still deliberately plain text, lists and data attributes. A pixel reading would need a
  stylesheet; this round does not claim one.
- **The locale seat is required to draw words.** Both registrations declare `locale: NS`, so the shell
  binds `t` for them; a mount that is handed props without that seat spells the key out rather than
  throwing (the kernel's own lookup does the same for an unanswered key), which is visible, not silent.
- **The client half costs one live delivery row** (`dsh-link-panel/client.js`): the profile already
  mounts this package, so a restart is what puts the row on the shell's preload list.
- **The loader is read, never injected (R197).** This package does not depend on `dsh-link-compat`: a
  profile that does not mount it loses nothing a person can feel (the same route, the same answer, only
  `compat.via` says `ctx.server`). What `compat` reports is the face that bound the route WHEN THE WEB
  SERVER ARRIVED — a loader mounted after that does not migrate an already-bound route, a loader whose
  `http` capability was refused when it mounted does not become willing later (the loader resolves its
  rows once, at its own apply), and this package's specs cannot see whether the live profile actually
  mounts it: that is the mount's gate and the live read's gate.

## Self-check

```
node plugins/dsh-link-panel/test/panel-projection.spec.mjs     # the host half: the projection + the route
node plugins/dsh-link-panel/test/compat-customer.spec.mjs      # the route's two registration faces (R197)
node plugins/dsh-link-panel/test/panel-client-view.spec.mjs    # the client half: the view, the marker, the bundle
node plugins/dsh-link-panel/test/panel-client-view.spec.mjs --self-attack
node plugins/dsh-link-panel/test/compat-customer.spec.mjs --self-attack
```

The third spec is the R197 customer plane: the **built host artifact mounted into throwaway kernels**
built from the pinned kernel's own vendored cordis — one whose context carries `link.compat` (the
cross-version loader's consumer face), one that does not, one whose loader refuses, and the last two with
the **live arrival order** (the row mounts first, `webServer` arrives afterwards). Thirteen readings:
`W1` the loader world binds `via: 'link.compat'` with `role: 'http.registerRoute'` and the loader's own
`registerRoute` is the one that received the route (counted at the loader, and exactly one route reaches
the web server), `W2` a world with no loader answers `present: false` / `via: 'ctx.server'` /
`role: null` and still binds exactly one route, `W3` a loader that throws leaves `refused` holding its
own message verbatim (on the answer AND on the error stream) while the route still binds and answers,
`W4` **the live order**: with `webServer` provided AFTER the row, the route is bound through the loader
late, and the route the loader received is the one the sink holds, `W5` the counter-case of the same
order with no loader — the fallback binds late, exactly one route, nothing asked of any loader, `W6` the
row asks the loader ZERO times before the web server is there and exactly once after it (`['http']`),
`A1` the route answers 200 with the same projection in all three original worlds, `A2` `compat` is the
LAST member and every earlier field keeps its position and bytes, `A3` the three answers minus `compat`
are byte-identical (the face is the only difference), `E1` the artifact's own `inject` names no `link`
and the no-loader mount does not throw, `D1` disposing the row disposes the route through the disposer
the binding face returned, `N1` the role the row reports is read as data out of `dsh-link-compat`'s
built table (role `http.registerRoute` → member `register` on service `webServer`), and `K1` `compat`
is readable data (four keys, no function, JSON round-trip unchanged). Its `--self-attack` stages SIX
one-line edits of the artifact's bytes under `.tmp/r197-p2` and demands exact movement: a loader the row
ignores, a refusal swallowed into nothing, a fallback that stops handing the route to the web server, a
field woven in before `compat` instead of appended after it, **the handle asked by the table's kernel
member name instead of the role word** (the defect a live customer hit: `W1`, `W4` and `N1`), and **the
loader asked in `apply()`, before the web server is there** (`W6` alone — the row still ends up bound
through the loader, only the moment is wrong).

The first spec is 26 readings over the **built host artifact** (`lib/index.js`): the four promised
properties (order-insensitivity, the closed set, duplicate ids, an empty registry), the passthrough
family, purity, the package's own structural truth (`dsh.client` + `exports["./client"]` + the built
client artifact, and the row's declared sink and item), and the read-only route over a real socket.
Its `--self-attack` replaces the closed-set guard with a **translation to the nearest kind** and
demands that exactly the declared readings move.

The second is 48 readings over the client half: the pure view module imported as source (the marker,
the two arrival orders folding to the same bytes, every named failure, the three frozen codes verbatim
plus a fourth code left alone, the text sent as typed, totality over hostile values), the wiring over
stubs (the definition, the three seats, the marker filled by the reads with no panel operation, the
disposal, a registration that throws), the **built `lib/client.js`** loaded with the module table
stubbed (including `apply()` reading both routes and filling the marker), and one byte reading of the
ledger half's built artifact: the two paths it binds are the two paths this half reads. That last one
is NOT MEASURED (named, and not counted as a failure) when `dsh-link-notes` has not been built; it
does not prove a route is bound or that an answer carries the consumed fields — that is the live
window's reading. Its `--self-attack` stages
copies of `src/client/view.ts` in which a bad response is **translated into the nearest good one (an
empty list)** and demands that exactly `V4`+`V9` (registry) or `V7` (ledger) move: a mutant that moves
nothing, or moves more than it declared, fails.

The thirteen readings R192 added are the **seam plane**: `P1` two claimants of one id are both refused,
`P2` an unknown kind is refused by name and never translated, `P3` a source that says nothing,
`P4` everything else keeps its own text with `code: null`, `P5` two arrival orders render
byte-identically, `P6` the disposer, `P7` an empty seam (two empty arrays, not an error), `P8` one
vocabulary with the host half (kinds, codes, and the same five declarations refused the same way),
`P9` the body (string, function read at projection, a throwing one, a non-string answer), `P10` the
marker's `items` byte-identical to what the **pre-R192** `view.ts` (read out of git at `HEAD`) wrote
for the same inputs, with the seam arriving as the ONE new field, `P11` a declaration that lands after
the reads republishes the marker and the pane in the same step, and `P12` the built bundle provides
`linkPanel` and the pane body draws one row per contribution, each with its own title, kind, source
and body (rendered from the built artifact with a JSX stub — a render reading, not a pixel), and `P13` a
reading that MOVED: the same claim, projected again, answers the new text — the row read *before*
`notify()` is already the new one, because nothing is cached — and `notify()` is the named path that says
so, heard once by every subscriber, with no second declaration invented for it. Its three
seam counter-proofs stage the browser half under `.tmp/r192-p1` and demand exact, printed movement:
`contributions.ts` with the closed-set gate removed (an unknown kind drawn instead of refused ⇒
`P2`+`P8` move), `contributions.ts` with a claim table where a later declaration for an id replaces
the earlier one (⇒ `P1` moves), and `view.ts` with the marker's `items` made to carry the seam's rows
too (⇒ `P10` moves).

The eight readings R190 added are the copy plane: `C1` the zh and en key sets are equal, `C2` the
placeholder names agree per key, `C3` the frozen cells of `docs/dev/notes-ui.md` §4.2 are the `en`
dictionary (placeholders positionally identical, read from the page itself), `C4` the six
parameterised keys substitute their parameters, `C5` no user-visible string is written into the
source (a word drawn straight after a JSX tag, a quoted `placeholder`/`aria-label`/`title`/`alt`, a
literal that is neither a name nor a route field nor a dictionary key, a Chinese character outside
`locales.ts`), `C6` the dictionary is exactly the key set this half reads, `C7` the glyph is a
first-party export wired to the guide entry and no self-drawn `<svg>` breaks 16×16/`currentColor`/
stroke 1 or 1.3/no fixed colour, `C8` the locale wiring (`inject` names `locale`, the dictionaries are
registered at an effect, both seats declare `locale: NS`). `W7` reads the chip text and the guide
entry in both languages.

Its three counter-proofs stage copies of the browser half under `.tmp/r190-p1/stage/` and each must
move exactly the readings it declares: delete one `zh` key ⇒ `C1`; hardcode the items empty state in
the JSX ⇒ `C5`+`C6`; replace the glyph with an inline 36×36 fixed-fill SVG ⇒ `C5`+`C7`.

**What the copy plane cannot see** (named): an English sentence hardcoded in `view.ts`/`load.ts` — the
route's diagnostics live there and are data, so only the Chinese-character rule reaches them; whether
the words are actually DRAWN (that is pixels, and this spec does not claim it); and whether the
first-party glyph renders at the size the guide asks for.

Exit codes for both: `0` held, `1` a reading failed, `3` NOT MEASURED (no built artifact, or a mutant
anchor that no longer exists).
