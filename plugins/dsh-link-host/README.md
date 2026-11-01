# dsh-link-host

The embed surface: what makes DSH-LINK a thing ANOTHER Tauri app can carry as its right sidebar, and
switch to the full window, without either app owning the other's runtime.

Two read-only GET routes, and nothing else: a contract served as data, and one self-contained page a
host's child webview loads. Neither route writes a byte, reads a clock, or carries a counter, so two
calls answer identical bytes.

## What it contributes

| piece | name | what it is |
|---|---|---|
| route | `GET /api/dsh-link-host/contract` | the embed contract as JSON: version, embed path, both modes, both ways to select one, the query parameters, the bounds protocol the shell already speaks, the three host capabilities, and the four hardcoded-origin sites |
| route | `GET /api/dsh-link-host/embed` | one HTML page with no framework, no build step and no external ASSET of any kind: it reads `?mode=`, listens for `{type:'dsh-link:mode', mode}`, refuses an unknown mode by name, states the mode and the geometry it chose as document-level facts, and reads four same-origin GET routes of the kernel that serves it so the panel shows the live bus, board and ledger |
| row | `link-host` in `cordis.patch.yml` | binds the two routes through `ctx.get('webServer')`, with the lazy retry pattern `plugins/dsh-link-notes/src/index.ts:877-993` landed |

It registers no tool and injects no service, so nothing here is reachable by the model.

## The mode protocol

`sidebar` and `full` are the only two modes. Two ways in, one way out:

- in, at load: `?mode=sidebar` or `?mode=full`. A host that can only set a URL needs nothing else.
- in, any time after: `window.postMessage({type:'dsh-link:mode', mode:'full'}, '*')` in the page's own
  document; `window.parent.postMessage(...)` from a frame; `window.opener.postMessage(...)` from a tab.
- out: the page posts `{type:'dsh-link:mode', mode, accepted, requested, from, version}` back to the opener
  or the parent window, and states the mode on the document under all circumstances.

The two layouts are two CSS rules selected by the very attribute the page reports, so the script never
calculates a rectangle: it sets `data-dsh-link-mode` and reads back what the layout did.

**A child webview is not a frame.** Inside a Tauri child webview `window.parent === window` is true even
while a host carries it, so the page reports "no ancestor frame" and says it cannot tell the two cases
apart - the host knows which it did. A host that owns the child cannot post to `window.parent`; it evaluates
the message into the child instead, and reads `data-dsh-link-mode` / `window.__DSH_LINK_MODE` off the document.

## The four live sections

The page is a panel, not a spec sheet. Under the header it draws four cards, each one a real same-origin
`GET` on the origin that served it (`LIVE_ROUTES` in `src/index.ts` is the only list):

| card | reads | draws |
|---|---|---|
| Bus | `GET /api/dsh-link-collab/status` | teams, members, tasks and ledger rows; the log's writer/instance/damage; the relay (bound, accepted, refused, last code); the **R217 `messages` block** (`journal` / `inbox` / `source` / `scope`) with the scope spelled out; the recorder's four counts |
| Team board | `GET /api/dsh-link-teams/state` | `counts` (teams / members / tasks), the served team tree, the task rows, and **what is assignable** - the `pending` rows, counted from the answer rather than asserted; fixtures and withheld nodes are counted, never hidden |
| Notes | `GET /api/dsh-link-notes/state` | live notes against the route's own `limits.maxNotes`, tombstones, characters per note, and the three most recent live notes in ledger order |
| Browser panel | `GET /__shell/panel-start` | its reachability, and a real action: a button that opens that entry in a new tab |

**A route that is not there is stated, never drawn as a zero.** Each card owns a state chip
(`live` / `unavailable` / `error`) and its own line: `Route unavailable - HTTP 404 / GET <path>`, or the
network failure by name. The body of that card stays empty. Nothing in the page invents a figure.

**No cadence.** There is no `setInterval` and no `setTimeout` in the page: it reads once at load, again
when a person presses refresh, and again when the document becomes visible. A panel kept fresh by a clock
is only ever as true as its cadence.

The browser card is honest about a foreign host: `/__shell/panel-start` is DSH-LINK's own shell route, so
a host that carries this page on ITS origin owes that path to nobody - the card says so, and the
reachability line, not the note, is the answer.

The protocol belongs to the page but not to the product surface: the facts, the two layouts and both
selection paths live in a `<details>` drawer at the bottom, **closed by default**. The HTML comment block
at the top of the document still carries the same protocol for anyone reading the bytes.

The page's copy is localised through its own dictionary object (`DICT`, `en` and `zh`), selected from
`navigator.language`; the drawer's protocol prose stays English because it quotes the bytes.

## The named refusals

| code | when | what survives |
|---|---|---|
| `METHOD_NOT_ALLOWED` | any verb but GET on either route (405, `Allow: GET`) | nothing changes; HEAD is refused too, and its refusal cannot carry the code because HTTP forbids a body on HEAD |
| `EMBED_MODE_UNKNOWN` | `?mode=` or a message named a mode that is not `sidebar` or `full` | the last good mode |
| `EMBED_WIDTH_UNUSABLE` | `?sidebarWidth=` was not a number in 240..1200 | the default width |
| `EMBED_PANEL_UNKNOWN` | `?panel=` named a surface this build does not draw | `right-panel`, the one surface |

A message whose `type` is not `dsh-link:mode` is **ignored**: counted as ignored, never acted on.

## What it is not

- **Not a crate.** A host cannot link DSH-LINK and cannot acquire its webview: `Window::add_child` needs
  the parent window in the same app process (`src-tauri/Cargo.toml:17-20`). The debt named in
  `docs/handoff/R195-contract.md:39-40` - no `run_with`, no parameterised window label, no
  `#[tauri::command]` for the panel ops - is still debt.
- **Not the DSH shell.** The page loads no React bundle and writes nothing. It is what a host's child
  webview points at, and it draws only the panel. It READS the kernel that served it - four read-only GETs
  on its own origin - and it can reach nothing else: the shell proxy refuses a request carrying a foreign
  `Origin` outright, so a host document on another origin cannot read those routes at all.
- **Not a second bounds implementation.** The shell's own switch is one rect on one child webview
  (`src-tauri/src/core/proxy.rs:234`, `:332`); the contract NAMES that protocol so a host can make the same
  move in its own runtime. Nothing here calls it.

## Mounting this row (do this before the live routes exist)

The row is not mounted by this package. It has to be named in the world's profile, the same way its
neighbours are, and until then the two routes are 404 on the shell origin:

1. in the live profile's `package.json`, add `"dsh-link-host": "link:<workspace>//dsh-link/plugins/dsh-link-host"`
   to `dependencies` and `"dsh-link-host"` to `dsh.profile.bundles` - or, instead of the bundle list, insert
   the row `- insert: [{id: link-host, name: dsh-link-host}]` into the kernel home's `dsh-link.patch.yml`,
   which is passed as `--patch` on every boot (`src-tauri/src/core/supervisor.rs:362-364`, the overlay path at
   `src-tauri/src/core/profile.rs:165`);
2. make `node_modules` resolve the package (a `pnpm install` in the profile directory, or a junction - the
   neighbours are symlinks/junctions there);
3. restart. Boot prints `[dsh-link-host] ready — contract 1.0.0, ...` and then one
   `contract route bound on ...` / `embed route bound on ...` line per route.

**Add the `plugins/health-markers.json` entry in the same step as the mount, not before it.** The grader
reads a declared row that never announced itself as `NOT MOUNTED` and exits 1
(`scripts/verify-plugin-health.mjs:83`, `:99-101`, `:127`), so a marker for a row that is not in the
profile turns that gate red - which is the honest verdict, and the reason this package ships none yet.

## The self-check

`node plugins/dsh-link-host/test/embed-routes.spec.mjs` - 32 readings, exit 0, over a REAL socket on an
EPHEMERAL loopback port (nothing in it touches 31761 / 31760 / 9222). It measures the built artifact
(`lib/index.js`), not `src/`:

- both routes' status, `content-type`, `cache-control` and verb refusals, including the four origin sites
  read back off disk so a drift between this table and the tree is a failing reading;
- the contract's shape and values, and that the SERVED body equals the module's own `contractBody()`;
- the page as BYTES: no external ASSET of any kind (seven kinds counted, all zero) and exactly ONE
  network device - `window.fetch`, captured once, with one site that builds a request URL and that site is
  `location.origin + a frozen path`; both layouts, the refusal names, the mode attribute, the postMessage,
  the honesty line, and byte-identical repeats;
- the page's own inline script COMPILED, then RUN in a fake DOM: `?mode=full` grows the panel to the
  viewport, a `postMessage` of `sidebar` brings it back to the sidebar width, an unknown mode is refused by
  name without moving the attribute, an unknown type is ignored, a URL-only load draws sidebar with no
  message at all, and the mode is posted back to an opener;
- the live reads, RUN against a fake network that answers on one known origin: exactly four `GET`s, one per
  frozen path, every one of them addressed as `<this document origin> + a frozen path` and nothing else -
  and a card whose route answers `404` shows `HTTP 404` with an empty body while the card whose route
  answered draws the numbers it served. "Never fake a number" is measured, not promised.

What it does NOT measure, and does not claim to: a real webview, a real window, a real geometry change.
Those belong to the live gate (`docs/handoff/R195-contract.md:32`).
