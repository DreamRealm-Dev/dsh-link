# DSH Link plugins

Two plugins add the Theme section and the Liquid Glass control material to the
official DeepSeek Harness client. They are ordinary dsh profile bundles: the
kernel loads them the same way it loads anything in `dsh.profile.bundles`, and
they reach the client through the official extension points (a settings section
slot, the settings document, and a gated stylesheet).

| Package | Half | What it owns |
|---|---|---|
| `dsh-liquid-glass` | browser | the material engine: style registry, the document attribute, the stylesheet, the refraction filter |
| `dsh-theme-settings` | Host + browser | the Theme section, and the durable `controlStyle` preference |

The split is deliberate: the material is reusable and carries its own
documentation and licence, and the settings surface is a consumer of it. A third
plugin can register another style through `ctx.liquidGlass.register()` without
touching either.

The material itself is two files: `src/client/material.css` (the design) and
`src/client/displacement.ts` (the lens map the refraction filter samples).
`src/client/index.ts` is the engine that mounts them and tags square controls.

## Build

```sh
node plugins/build.mjs            # write lib/ for both plugins
node plugins/build.mjs --check    # fail when lib/ is stale
```

Two artifacts per plugin, because a dsh plugin has two module contracts:

- `lib/index.js` — the Host half: ESM for Node, with `@deepseek-ai/*` left
  external so the running kernel's own instances are used.
- `lib/client.js` — the browser half: a CommonJS body wrapped in the
  `window.__ModuleLoader__.load` registration the client module system serves.
  React, `client-store`, `ui-slots`, `ui-primitives`, `ui-dockkit` and cordis stay
  external and come from the module table; everything else is bundled.

Stylesheets and the SVG filter are imported as text, so a half carries its own
CSS and mounts it for its own lifetime. esbuild is the whole toolchain; there is
no bundler configuration shared with the kernel.

## Install into a profile

The profile manifest is the record: a `link:` dependency plus a
`dsh.profile.bundles` entry, then one install.

```jsonc
// <DSH_HOME>/profiles/web/package.json
"dependencies": {
  "dsh-liquid-glass":  "link:<repo>/plugins/dsh-liquid-glass",
  "dsh-theme-settings": "link:<repo>/plugins/dsh-theme-settings"
},
"dsh": { "profile": { "bundles": [ /* …, */ "dsh-liquid-glass", "dsh-theme-settings" ] } }
```

```sh
# with the package manager dsh itself uses
pnpm install --dir <DSH_HOME>/profiles/web
```

`link:` keeps `lib/` live: editing a built artifact and reloading the page is
enough to see it, and only the browser half is fetched per page load. A change to
the Host half, to a manifest, or to `cordis.patch.yml` needs a kernel restart.

## Verify

```sh
node scripts/verify-theme-section.mjs     # drives the section over CDP and asserts both directions
node scripts/probe-refraction.mjs 9222    # proves the refraction filter bends a backdrop
node scripts/pixel.mjs 9222 x,y,w,h       # reads a region's rendered colour and its spread
node scripts/perf.mjs 9222                # frame times with the material off and on
node scripts/cdp-shot.mjs 9222 out.png    # a screenshot, for a human to look at
```

`dsh-link-compat` is verified without the browser, against a measured kernel surface:

```sh
node scripts/probe-kernel-surface.mjs     # boots a throwaway profile and writes .tmp/r1-surface/web.json
node scripts/verify-compat-table.mjs      # every capability row against that surface document
node scripts/verify-compat-refusal.mjs    # the refusal path, on fixture hosts
```

The first one boots the kernel (a throwaway profile, never the user's), so run it
before the other two; `verify-compat-table.mjs` takes `--surface <file>` for a
document produced against another kernel.

`pixel.mjs` is the one that matters when the material is being tuned: it decodes the
screenshot's own PNG (zlib plus the five scanline filters) and prints the mean colour
and the spread across a region, so "is it transparent enough" and "does anything
band" are numbers. `blur-sweep.mjs` injects a parameter combination for the same
purpose. Neither one needs an image viewer.

The shell must be running with `DSH_LINK_WEBVIEW2_ARGS=--remote-debugging-port=9222`.
`scripts/cdp-glass-live.mjs` injects the material's sources into the running page
without a rebuild, which is how the material is tuned by eye; its result is not
evidence, a rebuilt bundle and a reload are.
