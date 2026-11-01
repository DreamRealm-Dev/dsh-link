# dsh-liquid-glass

Apple's Liquid Glass as a **control material** for the official DeepSeek Harness
client. The interface is not rewritten and not recoloured: the material is a
stylesheet gated by one attribute on `<html>`, applied on top of the client's own
markup, and switching back is one attribute write and no reload.

## Five rules

Each one is a correction of an earlier version of this file that got it wrong, and
each is load-bearing.

1. **The background stays the client's own near-black.** Glass does not need a
   colourful backdrop — it needs *structure* behind it, and the structure here is
   the conversation and the panels themselves. A wallpaper invented to make the
   material visible is a recoloured interface, however good the material looks on
   it.
2. **Each surface keeps the client's own fill.** Not a taste call: the client
   paints some of its own children with those fills — the sidebar fades its session
   list into `--dsw-specific-sidebar-fill` — so an invented panel colour shows up as
   a band wherever a child paints the official one. The material carries itself
   through the rim, the float and the blur instead, which is what dark-mode glass
   over black actually looks like.

   Two traps sit inside this rule, and both were live bugs here:

   - **Where the tokens live.** The client declares its `--dsw-*` tokens on `body`,
     not on `html`, and custom properties only inherit downward. A
     `var(--dsw-…)` written on `html` cannot resolve, which makes the whole custom
     property the guaranteed-invalid value — so every surface that *inherits* its
     fill silently drops the entire `background` declaration. The surfaces that name
     their own fill (sidebar, inspector, composer) looked perfect while the modal
     dialog rendered as nothing but a blur, and the blurred content behind it read
     as dirty smudges. Fills are therefore named on `body`.
   - **Where the client already ships a material.** `div._material_`, the client's
     own menu surface, is a 45%-alpha fill with `blur(40px) saturate(1.5)` and a
     0.5px highlight — this material's own recipe, already in place. Menus and
     listboxes are consequently *absent* from the surface list: repainting them
     replaced official glass with a darker invented fill. (Those numbers are also
     the reference point for this file's own: 35–40% fill, 32–40px blur.)
3. **Glass is never nested inside glass.** A control that sits on a glass surface
   keeps its own plain treatment; only a control standing on content becomes a
   glass capsule. A capsule inside a capsule reads as a box in a box, and Apple's
   guidance rules it out.
4. **A refracting rule declares its backdrop filter twice.** `backdrop-filter:
   url(#…)` is Chromium-only, and an engine that rejects it drops the entire
   declaration — frost included. The plain form stands wherever the refracting one
   is invalid.
5. **A surface owns the ground it sits on.** Two of the client's own layers exist
   only to hide content behind an opaque surface: the sidebar's list fade into
   `--dsw-specific-sidebar-fill`, and the composer seat's gradient from transparent
   to the page colour across its first 36px. Behind a translucent pane neither is a
   fade any more — each is *content*, and each draws itself on the glass: the
   sidebar's showed as a bright band across the panel, the composer's as the
   conversation dying a few pixels inside the input box, with the seam exactly where
   the card's own first line is. Neither is inherited; both are replaced. The
   sidebar's children are handed the composite fill to paint (`--lg-panel-composite`),
   and the seat's fade is rewritten to live entirely *below* the card, which needs
   the lip under the card — a measurement no stylesheet can make, so the engine
   publishes it (`--lg-composer-lip`). Both cases are the same lesson: a client
   layer that assumes an opaque surface has to be answered where the surface stops
   being opaque, not painted over.

## What the material is

`src/client/material.css` is the whole design. Its parameters are named after the
ones Icon Composer exposes for a Liquid Glass material, so each number has a
counterpart slider in Apple's own tool:

| Parameter | Dark | Effect |
|---|---|---|
| `--lg-blur` | 10px | Blur — the composer card asks for 12px, because the one thing that passes behind it is text |
| `--lg-saturate` | 160% | colour pulled back out of the backdrop |
| `--lg-fill` / `--lg-translucency` | the surface's own token at 92–96% | each surface keeps the client's own fill: sidebar `--dsw-specific-sidebar-fill`, inspector `--dsw-alias-bg-base`, composer `--dsw-specific-bubble`, menus `--dsw-alias-bg-layer-1` |
| `--lg-specular` | 22% dark / 48% light | the rim highlight along the lit top edge |
| `--lg-sheen` | 3% dark / 12% light | the soft top-light gradient |
| `--lg-veil` | 0% dark / 2.5% light | the material's **Dark** component — Icon Composer exposes exactly this as a slider (42% in Apple's own light-mode panel). The client's light sidebar fill is only six values darker than a white page, so the component compounds quickly: at 7% the panel sat twenty values off that tone and read as a grey slab |
| `--lg-shadow` | — | Shadow |
| `--lg-gap` | 12px | the inset that makes a surface read as floating |
| `--lg-composer-lip` | measured | how far the composer card's bottom sits above the seat's own bottom. Set from the card's box by the engine, not by hand: the stylesheet needs it to keep the client's fade under the card, and no stylesheet can read a descendant's box |

## Measured

Two numbers decide this material, and both are taken with
`scripts/pixel.mjs` — which decodes the screenshot's own PNG and reports a
region's rendered colour and the spread across it, so a judgement about
"is it transparent enough" is a measurement rather than an impression.
`scripts/png-profile.mjs` is the same reading one scanline at a time (and an
`--ascii` coarse map of a region, which is how a layout gets read without spending
an image on it), and `scripts/probe-backdrop.mjs` answers the question in front of
any surface: `node scripts/probe-backdrop.mjs '[role=dialog]'` captures the element
twice, once hidden, and prints what it is sitting on row by row.

**How much of a backdrop survives.** Measured on a content-free patch of the modal
sitting over the conversation, as the variation (spread) reaching the surface. The
official opaque dialog reads `#ffffff` with a spread of 0, so the floor is 0 and
everything above it is show-through:

| `--lg-blur` | 6px | **10px** | 14px | 18px | 26px |
|---|---|---|---|---|---|
| spread | 38.7 | **24.7** | 21.0 | 18.3 | 13.3 |

`--lg-translucency` barely moves it — 30% → 25, 22% → 28, 15% → 30, 8% → 33 — while
costing the panel twelve values of lightness, so **transparency is governed by the
blur** and the fill is left alone. 10px is the accepted value: the backdrop reads as
shapes, which is where the client's own menus sit too (`blur(40px)` over a 45%
fill, but over a colourful backdrop rather than over text).

**What it costs.** 240 frames of scrolling the conversation, median / p95 frame
time, with the material off and on:

| | median | p95 | worst | frames over 33 ms |
|---|---|---|---|---|
| off | 5.6 ms | 5.8 ms | 13.6 ms | 0 |
| on | 5.5 ms | 5.9 ms | 12.3 ms | 0 |

The difference is inside the noise. Caveat on the absolute figures: they are
measured in the live page, whose window may be hidden at the time — the comparison
between the two rows is the signal, not the frame rate itself.

**What the pane shows, and what the client hides from it.** The composer is the one
surface with real content behind it, so it is where the material can be read as glass
— and where the client's own seat fade was visible as a defect. Measured with
`scripts/probe-composer-fade.mjs`, which brings a measured line of conversation under
the card and captures it over four grounds (the card alone, the backdrop, the backdrop
with the client's fade forced back on, and the material as it ships), the fade flattens
**42 rows of the card in the light palette and 21 in the dark** that carry conversation
behind them. Through the material every one of those rows still shows what is behind
it — a mean shift of 5–7 values against the same row over an empty ground — and the
glass adds only **2% of the backdrop's contrast in light, 5% in dark**: softened, not
deleted, and not sharp either. The client's own ground is intact below the card; the
worst drift from it is 0.7 values.

## Coverage

**Floating surfaces**: the sidebar panel, the inspector pane, modal dialogs, the
composer card. (Menus and listboxes are left to the client, which already ships a
material for them.)

**Controls sit at one of two levels**, and picking the right one is most of the
design:

| Level | Where | Treatment |
|---|---|---|
| **Glass** | a surface standing on content — the composer card | fill, blur, refraction, specular rim |
| **Elevation** | a control standing *on* a glass surface — the sidebar's icon buttons, the dialog's | a flat translucent fill one step up from the surface, a hairline, a round shape — **no** blur, rim or sheen |

A control with the full material *inside* a pane of glass is glass nested in glass,
which the guidance rules out and which read as a box in a box when it was tried
here. Leaving the same control entirely to the client was the other failure: it lost
the one thing the surface owes it, which is to read as sitting above the surface
rather than on it. Elevation is the middle rung.

**One-to-one controls** are rounded — the engine tags every control whose box is
square with `data-lg-square`, because a control's shape is a fact about the rendered
layout rather than about a class name, and a new icon button would otherwise keep a
square corner beside rounded ones.

Everything else keeps the client's own treatment, deliberately: controls inside a
sidebar, a composer card or a menu are *not* glass, list rows are content, and
nothing inside the conversation is restyled.

The sidebar's float applies to the **expanded layout only**, marked `data-lg-wide`
by the same sweep. The 56px rail lays its 36px control boxes against 10px of side
padding, so any gutter at all clips them; the rail therefore keeps the client's
geometry exactly. The sidebar column's gutter is the only geometry this material
changes anywhere.

Two of those constraints were bugs first, and both were found by measuring rather
than looking:

- The panel's width is set by the client as an **inline style**, so padding the
  column did not narrow it — the panel overran its column by 12px and sat on top of
  the conversation. It is narrowed with `max-width: 100%`, which is the only
  declaration that can beat an inline `width`, and only while the column is
  expanded: clamping it during the collapse would squash the content instead of
  letting the column clip it, which is what the client's crossfade is built on.
- Without `overflow: hidden` on the panel, its children painted their square
  corners over its rounding.

## Refraction

The refraction is a **baked lens map**: one 128×128 canvas holds a radial profile —
flat through the middle of a surface, rising to its maximum at the rim, fading to
neutral over the outermost two pixels — encoded the way `feDisplacementMap` reads
it, and stretched over each surface with `feImage`. The engine builds it once per
mount (`src/client/displacement.ts`).

This replaced an `feTurbulence` map, for two reasons found by looking at the
pixels: turbulence is uniform noise, which reads as a wobble rather than a lens,
and its alpha channel contaminates the backdrop — a displacement map that carries
it washes a whole panel out to mid grey. That was a real bug in the first version
of this material.

Over the client's own near-black background the refraction has little to bend
except where a surface overlaps content — the composer card over a scrolled
conversation, a menu over a message. That is inherent, not a shortcoming of the
port: glass bends what is behind it, and behind the sidebar there is a black
column.

`node scripts/probe-refraction.mjs` drops a striped pattern into the page and
covers half of it with a surface wearing the same filter: straight lines turning
near the covered edge are the lens, unchanged lines would mean the filter is doing
nothing. `node scripts/probe-composer-fade.mjs` is the same idea aimed at the
composer's backdrop: it fails if the client's fade is ever inherited again, in either
palette.

## Light palette

Same material, lit from the other side, and the three things that have to flip are
named rather than hardcoded:

| | Dark | Light |
|---|---|---|
| edge (hairline) | `rgb(255 255 255 / …)` | `--lg-edge: rgb(15 23 42)` — a white hairline on a white panel is no hairline |
| control elevation | `--lg-elevation: rgb(255 255 255 / 7%)` | `rgb(15 23 42 / 6%)` — white on a white panel is no elevation |
| Dark component | `--lg-veil: 0%` | `--lg-veil: 7%` |

**The Dark component is part of a surface's rendered colour, not a coat on top of
it.** Anything that repaints a surface's own fill — the sidebar's list fade — has to
paint the composite *including* the veil, which is why `--lg-panel-composite` nests
the veil over the fill-over-base mix. Leaving it out put the fade eighteen values
above the panel and drew a bright band across the bottom of the sidebar.

That last parameter is the difference between light-mode glass and a white rectangle.
A translucent *white* fill over a white page composites to white: the panel
dissolves into the page. Apple's material carries a **Dark** component for exactly
this reason — the pane darkens what it floats over, so it reads as a surface
whatever is behind it. With it, the light sidebar is a pale grey sheet with a bright
rim, which is what the reference images show.

What this material cannot do in light mode is pick up a **hue** from behind: the
client's backdrop is a flat base colour, so there is nothing to tint the pane.
Apple's own light panels look blue because a blue wallpaper is behind them. That is
the deferred backdrop question, not a parameter — and when a backdrop does arrive,
the existing `backdrop-filter` starts picking its colours up with no further change.

## Selector basis

Every rule names the most stable hook available, in this order: `[data-slot=…]`
slots, `[data-composer-card]`, ARIA roles, `[class*='_localName']` for the
client's CSS-module local names, and `[data-lg-square]` for a measured shape. Each
rule says which basis it uses. A kernel update that renames a local name degrades
one rule, not the material.

## API

The browser half provides `ctx.liquidGlass`:

```ts
ctx.liquidGlass.register({ id, label: () => string, css, refraction?: boolean })
ctx.liquidGlass.setStyle('liquid-glass' | 'official' | …)
ctx.liquidGlass.getSnapshot()          // { styleId, styles }
ctx.on('liquid-glass/change', …)
```

`official` is the empty style: the client's own material, untouched. Styles are
registered by whoever owns them — this package registers `liquid-glass` itself.

## Deferred, by decision

- **A backdrop for the glass.** Over the client's near-black background a thin
  surface has nothing to reveal, so the float is carried by the gutter, the radius
  and the rim alone. Giving the window a wallpaper would make the transparency read
  as glass, but a wallpaper is a recoloured interface; it waits until the backdrop
  is a user-facing setting in its own right.
- **The document preview's scrollbar.** It belongs to the previewed file inside a
  sandboxed, opaque-origin iframe, which this stylesheet cannot reach. Reaching it
  would take a shell-level injection into every frame, which would also restyle
  embedded pages and would change the official material's own state; not worth the
  compatibility surface.

## Licence

MIT (this repository). The canvas → `feImage` → `feDisplacementMap` structure is
a port of the technique MIT-licensed references use, and the lens profile is this
package's own; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
