# Third-party notices — dsh-liquid-glass

This package ships **no third-party code**. Everything in `src/` is original, and
the built bundles contain only this package's own sources plus the module-table
externals the shell already serves.

## References consulted, and their licences

Checked against the published tarballs (licence file read directly, not the
metadata alone).

| Package | Version | Licence | Evidence |
|---|---|---|---|
| [`liquid-glass-react`](https://www.npmjs.com/package/liquid-glass-react) ([rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)) | 1.1.1 | MIT | `package/LICENSE`: MIT permission text, "Copyright 2025 MAX ROVENSKY"; npm metadata `"license": "MIT"` |
| [`liquid-glass-js`](https://www.npmjs.com/package/liquid-glass-js) ([eamonliu/liquid-glass-js](https://github.com/eamonliu/liquid-glass-js)) | 0.1.0 | MIT | `package/LICENSE`: "MIT License / Copyright (c) 2026 Eamon Liu" |
| [shuding/liquid-glass](https://github.com/shuding/liquid-glass) | — | MIT | GitHub `/license`: `spdx_id: MIT`, "Copyright (c) 2025 Shu Ding" |

A broader audit of ~35 packages in this ecosystem found no copyleft anywhere
(MIT / ISC / Apache-2.0 only). The real risks in it are packages that ship **no
licence file** at all (`react-liquid-glass-effect`, `@liquidglass/react`,
`@mizuui/liquid-glass-core`, `@tinymomentum/liquid-glass-react`) and the
Chromium-only refraction noted below.

## What was ported, and what was not

`src/client/displacement.ts` is a **port of the structure**, not of the code:
`liquid-glass-react` bakes a displacement map on an offscreen canvas, hands it to
the filter through `feImage`, and displaces the backdrop with
`feDisplacementMap`; this package does the same, and `liquid-glass-js` does the
same with per-channel maps for chromatic aberration.

Two deliberate differences:

- **The lens profile is this package's own.** The reference implements a
  per-element fragment function whose refraction vector also follows a pointer;
  this material is a skin over controls that do not follow the cursor, so the map
  is a single radial profile, baked once per mount and shared by every surface.
- **No `feTurbulence`.** Both references avoid it; an earlier version of this file
  used it and paid for it — turbulence is noise rather than a lens, and its alpha
  channel washes the backdrop out to mid grey unless an `feColorMatrix` forces it
  opaque.

**On depending on the package instead of porting it:** the audit's first
recommendation was `liquid-glass-react@1.1.1`, whose declared peer is
`react >= 19`. Reading its shipped bundle, it imports only `forwardRef`,
`useCallback`, `useEffect`, `useId`, `useRef` and `useState` — all React 18 APIs —
so the peer range is conservative and it would in fact run on this client's React
18. It was still not adopted, because it is a *component*: it wants to wrap the
element it renders, while the requirement here is a skin over a client whose markup
must not change. If a component-level Liquid Glass is ever wanted inside DSH, it is
the one to take, and its notice belongs here.

## DSH-native alternatives that already exist

Discovered *after* this package was written, and worth knowing before adopting it:
three plugins for the same DSH client are published on npm.

| Package | Licence | Note |
|---|---|---|
| `dsh-theme-liquid-glass` 0.4.2 | MIT (tarball LICENSE, "Copyright (c) 2025 dsh-theme-liquid-glass contributors") | purpose-built for DSH; same refraction primitive, plus theme-token overrides; declares the same client peers this composition provides |
| `dsh-liquid-glass-ui` 0.2.1 | MIT (LICENSE 1086 B; GitHub `xiaoxianasd/dsh-liquid-glass-ui`) | DSH client peers: `ui-settings`, `ui-plugins`, `ui-slots`, `ui-theme` |
| `dsh-liquid-glass-input` 1.32.9 | Apache-2.0 (keep LICENSE/NOTICE if adopted) | README states the refraction is Chromium-only |

This package is still the one wired into this repo because it owns the parts the
material needed to read as glass here — the sheet architecture the sidebar and the
inspector pane required, the inspector's dockkit tab host, the square-control
sweep, the fallback declarations — and because keeping the material in-repo keeps
its licence story to one MIT file. Switching to either alternative is a profile
manifest change, not a code change; neither was evaluated here, and their
compatibility with the kernel checkout this shell pins
(`dsh-v0.2.1-alpha.1`) would have to be checked first.

## Browser support

`backdrop-filter: url(#…)` is **Chromium-only**; rdev's own README warns that
Safari and Firefox show no displacement. This package therefore declares the
backdrop filter twice in the refracting rules — frost everywhere, refraction only
where the browser implements it — so a non-Chromium page keeps the blur and the
rim instead of losing the whole declaration. The shell renders in WebView2
(Chromium), so the refraction is always present there; the tray's "open in a
browser" path is the one where another engine could be used.

## Design references

Apple's Human Interface Guidelines, *Materials* and the Liquid Glass technology
overview, plus the WWDC25 "Meet Liquid Glass" session, for the material's
parameters, its rule that it belongs to controls and navigation rather than to
content, and its prohibition on nesting one glass element inside another. Icon
Composer's Liquid Glass inspector (Specular / Blur / Translucency / Dark / Shadow)
is the source of this package's parameter names.
