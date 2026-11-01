# dsh-link-brand

DSH Link's own brand marks, in the client's brand slots.

The upstream marks are DeepSeek's registered trademark, and this is a third-party
desktop edition, so the interface must not present them as the product's own
identity ([BRAND_GUIDELINES.zh.md](../../core/deepseek-harness/BRAND_GUIDELINES.zh.md)).
The client declares three brand slots and leaves them to fallbacks when nothing
registers: the sidebar mark falls back to the official fish logo, the sidebar name
to the local-build label, and the conversation hero mark to an animated official
fish. This plugin fills all three with the DSH Link artwork.

**One lettering per surface.** The wordmark already integrates the symbol — the whale
sits in the bowl of its `d` — so drawing the badge beside it would say LINK twice, once
in the badge's plain ring type. The badge is therefore only drawn where the surface is
square and stands alone.

| Slot | Owner props | Drawn |
|---|---|---|
| `sidebar.brand.mark` | `{ size: 24 }` | the badge in the collapsed rail only; nothing in the expanded row, whose wordmark carries the mark |
| `sidebar.brand.name` | `{}` | `assets/dsh-link-in-d.svg`, 16px tall (81.11px wide) |
| `conversation.hero.brand.mark` | `{ size: 34, className }` | `assets/symbol-v2.svg` |

## Why a priority of -1

A `single` slot renders its **lowest**-priority registration and throws on a
second registration at the same priority. Registering at -1 therefore shadows the
official occupant in an official-profile build, and is a plain registration in the
local-profile build this application runs. Nothing else changes: a slot the client
does not declare is never touched, and each registration waits for its declaration
through `ctx.slots.inject`.

## The artwork

`assets/` holds the design's own SVG copied from the logo project's `set3`
(rev 3) — see `assets/PROVENANCE.md`. Two generated artifacts derive from it, and
both are committed:

    node plugins/dsh-link-brand/scripts/gen-marks.mjs       # src/client/marks.tsx
    node plugins/dsh-link-brand/scripts/gen-shell-logo.mjs  # src-tauri/src/core/brand_art.rs

Both generators perform the same rewrite: the design's ink (`#0F1115`) becomes
`currentColor`, so one component is legible on the light and dark palettes while
the ring keeps the design's blue; and the artwork's fixed SVG mask id becomes a
per-instance id (React's in the client, a constant in the boot page, which renders
each mark once).

The boot page cannot fetch anything — it is served before the kernel exists — so
`src-tauri/src/core/brand_art.rs` inlines the artwork at compile time.

## Application icons

`scripts/gen-app-icons.py` builds the icon ladder from the same renders: every icon is a
white `#FBFBFB` rounded plate with the mark centred on it (plate 93.75% of the canvas and
radius 18.75% of the plate on Windows; 80.47% and 22.46% for the macOS `.icns`, both
measured from the upstream icon artwork). A plate rather than a bare mark, because the
taskbar and tray draw the icon over their own surface and the mark's ink is dark.

    python plugins/dsh-link-brand/scripts/gen-app-icons.py

It writes `assets/plated/{windows,macos}-<n>.png` (16 … 1024), the named slots under
`src-tauri/icons/`, a seven-frame `icon.ico` and an `icon.icns` (ic07…ic12). `build.rs`
declares `icons` as a cargo input, so the executable's own icon resource is rebuilt and
relinked whenever this runs; `python .tmp/brand/check-exe-icon.py` compares what the
executable actually carries with the 32px slot (currently 0.000 mean difference).

## Install into a profile

Ordinary dsh profile bundle: a `link:` dependency, a `dsh.profile.bundles`
entry, and the row this package's own `cordis.patch.yml` inserts (`id: link-brand`).

## Verify

    node plugins/build.mjs --check
    node .tmp/brand/probe-live.mjs   # reads the live brand surfaces over CDP

## Revert

Remove the `dsh-link-brand` entry from the profile's `dsh.profile.bundles`
(and its `link:` dependency) and restart the kernel: every slot falls back to what
it drew before this plugin existed. The boot page's brand row is reverted by
putting the `HARNESS` wordmark back in `src-tauri/src/core/shellpage.rs`.

## Licence

The plugin **code** in this package is MIT (see ../../pack/LICENSES.md). The **artwork** in
`assets/` is licensed **CC BY-NC-SA 4.0** in its canonical repository,
<https://github.com/DreamRealm-Dev/dsh-link-brand>; the copies kept here stay under that licence.
Scope, attribution and trademark rules: ../../BRAND-ASSETS.md.
