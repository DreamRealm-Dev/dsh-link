window.__ModuleLoader__.load({ id: "dsh-liquid-glass", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/dsh-liquid-glass/src/client/index.ts
var index_exports = {};
__export(index_exports, {
  CORNER_EXPONENT_PROPERTY: () => CORNER_EXPONENT_PROPERTY,
  CORNER_NOMINAL_PROPERTY: () => CORNER_NOMINAL_PROPERTY,
  CORNER_SHAPE_PROPERTY: () => CORNER_SHAPE_PROPERTY,
  DRAG_ATTRIBUTE: () => DRAG_ATTRIBUTE,
  LIGHT_PROPERTY: () => LIGHT_PROPERTY,
  LiquidGlassRuntime: () => LiquidGlassRuntime,
  OFFICIAL_STYLE_ID: () => OFFICIAL_STYLE_ID,
  POINTER_X_PROPERTY: () => POINTER_X_PROPERTY,
  POINTER_Y_PROPERTY: () => POINTER_Y_PROPERTY,
  PRESS_ATTRIBUTE: () => PRESS_ATTRIBUTE,
  PRESS_DRAG_PROPERTY: () => PRESS_DRAG_PROPERTY,
  PRESS_PROPERTY: () => PRESS_PROPERTY,
  PRESS_SX_PROPERTY: () => PRESS_SX_PROPERTY,
  PRESS_SY_PROPERTY: () => PRESS_SY_PROPERTY,
  PRESS_X_PROPERTY: () => PRESS_X_PROPERTY,
  PRESS_Y_PROPERTY: () => PRESS_Y_PROPERTY,
  REFRACTION_FILTER_ID: () => REFRACTION_FILTER_ID,
  REFRACTION_PROPERTY: () => REFRACTION_PROPERTY,
  STYLE_ATTRIBUTE: () => STYLE_ATTRIBUTE,
  SURFACE_SELECTOR: () => SURFACE_SELECTOR,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// plugins/dsh-liquid-glass/src/client/material.css
var material_default = "/*\n * Apple Liquid Glass \u2014 the control material.\n *\n * Scope: controls and the surfaces that carry them, over the client's own\n * background. Nothing is recoloured, no element is added to the interface, and\n * no geometry changes beyond the gutter that makes the sidebar read as floating\n * and the corner radii, which come from the two tokens the theme control moves\n * (see \"Geometry\" below).\n * iOS 18 -> iOS 26: the same interface, wearing the new material.\n *\n * Four rules decide this file, and each one is a correction of an earlier\n * version that got it wrong:\n *\n *   1. The background stays the client's own near-black. Glass does not need a\n *      colourful backdrop to be glass \u2014 it needs *structure* behind it, and the\n *      structure here is the conversation and the panels themselves. A wallpaper\n *      invented to make the material visible is a recoloured interface.\n *   2. Glass is never nested inside glass. A control that sits on a glass surface\n *      keeps its own plain treatment; only a control standing on content becomes\n *      a glass capsule. A capsule inside a capsule reads as a box in a box.\n *   3. A refracting rule declares its backdrop filter twice. `backdrop-filter:\n *      url(#\u2026)` is Chromium-only, and an engine that rejects it would otherwise\n *      drop the whole declaration, frost included.\n *   4. A surface owns the ground it sits on. A layer the client paints behind an\n *      opaque surface to hide what is behind it \u2014 the composer seat's fade into\n *      the page colour \u2014 is not a fade behind a translucent one; it is content,\n *      and it draws the conversation to a stop a few pixels inside the pane. It\n *      is replaced, and the fact the replacement needs (the lip under the card) is\n *      measured rather than guessed.\n *\n * Selector basis, in order of preference, is noted per rule:\n *   [data-slot=\u2026]              official slot hooks (stable)\n *   [data-composer-card]       official styling hook (stable)\n *   [role=\u2026]                   ARIA roles (stable)\n *   [class*='_localName']      the official source's CSS-module local name\n *   [data-lg-square]           tagged by the engine on a square control\n *\n * Parameter names follow the ones Icon Composer exposes for a Liquid Glass\n * material \u2014 Specular, Blur, Translucency, Dark, Shadow.\n */\n\n/* The room's light, registered so its derived values are *numbers* and *lengths* a probe\n * can read, rather than the `calc()` source that produces them \u2014 `--lg-light-x` at a pointer\n * due right is 1, not \"calc(sin(90deg))\". A browser without `@property` ignores these rules\n * and keeps the material: the tokens then stay un-evaluated token streams, which is exactly\n * what the box-shadow below resolves them as. The initial values are the light this material\n * has always been lit by \u2014 above the surface \u2014 so a document the engine never writes to still\n * wears the top-lit rim it wore before there was a pointer position to read. */\n@property --lg-light-a { syntax: '<angle>'; inherits: true; initial-value: 0deg; }\n@property --lg-light-follow { syntax: '<number>'; inherits: true; initial-value: 1; }\n@property --lg-light-x { syntax: '<number>'; inherits: true; initial-value: 0; }\n@property --lg-light-y { syntax: '<number>'; inherits: true; initial-value: -1; }\n@property --lg-light-dx { syntax: '<length>'; inherits: true; initial-value: 0px; }\n@property --lg-pointer-x { syntax: '<length>'; inherits: true; initial-value: -100000px; }\n@property --lg-pointer-y { syntax: '<length>'; inherits: true; initial-value: -100000px; }\n@property --lg-light-dy { syntax: '<length>'; inherits: true; initial-value: 1px; }\n@property --lg-occ-dx { syntax: '<length>'; inherits: true; initial-value: 0px; }\n@property --lg-occ-dy { syntax: '<length>'; inherits: true; initial-value: -1px; }\n\nhtml[data-lg-style='liquid-glass'] {\n  /* Geometry. The gap is what makes a surface read as floating, and the radius is the\n   * corner the whole interface is cut from.\n   *\n   * The gap is 12px \u2014 the value this file has always shipped, measured as the panel's\n   * inset inside its own column (12px on each side). It is declared here, and both of its\n   * use sites below also carry it as a `var()` fallback: a layout that reads an undefined\n   * custom property loses the whole declaration at computed-value time and collapses\n   * silently, with no console error to point at it. That happened to this token once.\n   *\n   * Three radii, in CSS px: the window's, a panel's, and a control's. No rule in this\n   * file names a radius in px; every corner below reads one of these.\n   *\n   * The first two are the ones a person moves. Settings \u2192 Theme has a single slider, and\n   * it writes them as custom properties on `html` inline (window = r, panel = r + 6).\n   * That is why they are declared here and nowhere else, why nothing here is\n   * `!important`, and why no other rule in this file re-declares them: an inline value\n   * has to win outright and land on the next paint, with no transition in the way. The\n   * derived `--lg-radius-field` follows an inline write for the same reason a `var()`\n   * does \u2014 custom properties are substituted at computed-value time, per element, so a\n   * `var(--lg-radius-panel)` on `html` sees `html`'s own inline value. */\n  --lg-gap: 12px;\n  --lg-radius-window: 12px;\n  --lg-radius-panel: 18px;\n  --lg-radius-control: 999px;\n  /* A field is a well, not a capsule: rounded like the surface it is cut into rather than\n   * like a pill. It is not a fourth knob \u2014 it is the panel's radius at the proportion a\n   * field wants, which is exactly the 10px it has always been while the panel is 18px \u2014\n   * so the one theme control moves it too. */\n  --lg-radius-field: calc(var(--lg-radius-panel) * 10 / 18);\n  /* The card is derived by offset rather than by proportion. The composer card has a\n   * radius of its own in the client's design \u2014 28px \u2014 and a pane that came out 18px\n   * whenever the panel is 18px would be a change to a shape people already approved.\n   * +10px holds that 28px at the panel's default and still moves with the one control. */\n  --lg-radius-card: calc(var(--lg-radius-panel) + 10px);\n\n  /* Material.\n   *\n   * Each surface's own fill is the client's own token for that surface, at high\n   * opacity. That is not a compromise but the requirement: the client paints some\n   * of its own children with those same fills \u2014 the sidebar's list-fade, for\n   * instance \u2014 so any invented colour for the panel shows up as a band where a\n   * child paints the official one. Over a near-black backdrop the material then\n   * carries itself through the specular rim, the float, and the blur of whatever\n   * passes behind it, which is what dark-mode glass over black actually looks\n   * like. */\n  /* How much of the surface's own fill survives. The rest is the backdrop, blurred:\n   * legibility is the blur's job, not the fill's. */\n  --lg-translucency: 22%;\n  /* Blur is the one parameter that decides whether a backdrop survives. Measured on\n   * a content-free patch of the modal over the conversation, the detail reaching the\n   * surface was: 6px \u2192 39 values of variation, 10px \u2192 25, 14px \u2192 21, 18px \u2192 18,\n   * 26px \u2192 13. The fill barely moves it by comparison (30% \u2192 25, 8% \u2192 33, at the\n   * cost of a much darker panel), so transparency is governed here and the fill is\n   * left alone. 10px keeps a frost while leaving the backdrop as shapes. */\n  --lg-blur: 4px;\n  --lg-saturate: 180%;\n  /* Refraction: the band a surface bends inside its own edge, how far it bends there, and\n   * how far the red and blue passes separate from each other. The engine reads these off\n   * the surface and bakes a lens for it \u2014 see \"Refraction\" below. A panel carries a wider\n   * band than a card, because it is a bigger pane of glass. */\n  --lg-refract-band: 32px;\n  --lg-refract-bend: 30px;\n  --lg-refract-chroma: 0.1;\n  /* Boldness belongs to the structure \u2014 the blur, the float, the shadow \u2014 not to\n   * white paint. A rim is an edge highlight, and a sheen is the light a surface\n   * catches along one side; pushed past that they read as a washed-out control,\n   * which is exactly what 34%/8% did to the composer card. */\n  --lg-specular: 22%;\n  --lg-hairline: 12%;\n  --lg-sheen: 3%;\n  /* The light a rim catches, as opposed to the hairline that draws it: a soft glow just\n   * inside the top edge, which is what makes a float read as a pane of glass with\n   * thickness rather than a rounded rectangle with an outline. */\n  --lg-glow: 34%;\n  /* The material's Dark component \u2014 Icon Composer exposes exactly this as a slider\n   * (42% in Apple's own light-mode panel). It is the layer that keeps a pane of\n   * glass reading as a surface over a bright backdrop instead of dissolving into\n   * it, which is what a white fill alone does on a white page. Dark mode leaves it\n   * at zero: there the surface is already darker than what it floats over. */\n  --lg-veil: 0%;\n  --lg-inspector-tint: 88%;\n  /* The fill a control standing on a surface gets. Palette-dependent, like the\n   * edge: white on a dark pane is elevation, white on a light pane is nothing. */\n  --lg-elevation: rgb(255 255 255 / 7%);\n  --lg-elevation-hover: rgb(255 255 255 / 12%);\n  --lg-elevation-active: rgb(255 255 255 / 16%);\n  --lg-shadow: 0 20px 48px -22px rgb(0 0 0 / 95%), 0 3px 10px rgb(0 0 0 / 45%);\n\n  /* The pointer, in three parts: one light, one lift, one dent.\n   *\n   * ONE LIGHT. `--lg-light-a` is the direction the room's light comes from, an angle where\n   * 0deg is above the surface, 90deg to its right and 180deg below it. The engine writes it on\n   * `html` while the pointer moves \u2014 one property, at most once per animation frame \u2014 and\n   * everything else here is derived from it, so the pointer's whole cost is that one write.\n   * `--lg-light-x`/`--lg-light-y` are the same direction on the unit circle: -1 is the left\n   * (or top) edge, +1 the right (or bottom) one. `--lg-light-dx`/`--lg-light-dy` are it as the\n   * box-shadow offsets that put the lit hairline on the edge the light is on, and\n   * `--lg-occ-dx`/`--lg-occ-dy` are its negation, because the occlusion line under a floating\n   * surface belongs on the edge the light is *not* on. They are offsets rather than opacities\n   * for a reason worth stating: an inset shadow with no offset and no spread paints nothing, so\n   * \"no light\" would be a rim that vanished rather than a rim that moved.\n   *\n   * `--lg-light-follow: 0` parks the light back above the surface whatever the angle says, and\n   * it is the one number the whole pointer response is switched off from: the derived tokens\n   * blend towards the material's historic top light rather than towards zero, so the rim stays\n   * a rim.\n   *\n   * ONE LIFT. `--lg-lift` is the only lever the pointer pulls on a rim: 1 is the material's own\n   * specular, and hovering a glass control raises it by `--lg-hover-lift`. The lift multiplies\n   * the surface's *own* `--lg-specular`/`--lg-glow`, so a panel that is brighter than a card\n   * stays proportionally brighter when the pointer is on it, and the value of the multiplier is\n   * a measurement (the rim's own luminance rise against the capture's noise floor), not a taste.\n   *\n   * ONE DENT. A control standing on glass is pressed *into* the material: `--lg-dent-on` gates\n   * the response, `--lg-dent-darken`/`--lg-dent-blur`/`--lg-dent-drop` are the short dark inset\n   * that spreads in from the lit edge, and `--lg-dent-rim` is the hairline the control's own\n   * rim drops to while it is held \u2014 the same convention this file's field rule already uses for\n   * a well, so a press reads as the same kind of recess. `--lg-dent-on: 0` removes the whole\n   * press response in one place. */\n  --lg-light-a: 0deg;\n  --lg-light-follow: 1;\n  --lg-light-x: calc(sin(var(--lg-light-a)) * var(--lg-light-follow));\n  --lg-light-y: calc(-1 * cos(var(--lg-light-a)) * var(--lg-light-follow) - (1 - var(--lg-light-follow)));\n  --lg-light-dx: calc(var(--lg-light-x) * -1px);\n  --lg-light-dy: calc(var(--lg-light-y) * -1px);\n  --lg-occ-dx: calc(var(--lg-light-x) * 1px);\n  --lg-occ-dy: calc(var(--lg-light-y) * 1px);\n  /* How far a glow is pushed towards the light, relative to the hairline: 1 for a control's\n   * tight glow, more for a panel's longer one (see the sidebar rule). */\n  --lg-rim-glow-blur: 5px;\n  --lg-rim-glow-spread: -2px;\n  --lg-rim-glow-drop: 1;\n  --lg-control-hairline: 9%;\n  --lg-lift: 1;\n  /* 1.5 is the measured crossing, not a preference. The sweep of this token on the composer card\n   * (rim band = its top 1 CSS px over the middle 30% of its width, dark palette, pointer really\n   * on the card) reads: 1.0 -> 87.9 luma, 1.1 -> +3.0, 1.2 -> +7.0, 1.3 -> +11.2, 1.4 -> +14.3,\n   * 1.5 -> +18.5, 1.7 -> +25.6, 2.0 -> +35.5, against a capture-to-capture noise of 0.00 luma at\n   * that surface. The sidebar panel's own resting rim \u2014 the strongest rim this material has at\n   * rest, 28% specular \u2014 measures 106.8 luma on the same band geometry, and 1.5 is where the\n   * hovered card's rim arrives there: 106.4 luma, 18% x 1.5 = 27% against the panel's 28%. So a\n   * hovering control catches exactly as much light as the biggest pane in the room at rest, and\n   * never more. */\n  --lg-hover-lift: 1.5;\n  --lg-dent-on: 1;\n  --lg-dent-darken: 34%;\n  --lg-dent-blur: 2px;\n  --lg-dent-drop: 1px;\n  --lg-dent-rim: 3%;\n}\n\n/* The fill the shared surface rule uses for anything that does not name its own \u2014\n * the modal dialog and any `data-lg-surface` opt-in. It is named on `body`, not on\n * `html` with the rest of the parameters, because the client declares its\n * `--dsw-*` tokens on `body` (design-platform.css) and custom properties only\n * inherit downward: a `var(--dsw-\u2026)` written on `html` cannot resolve, which makes\n * the whole property the guaranteed-invalid value, and every surface inheriting it\n * silently drops its background declaration \u2014 a dialog rendered as nothing but a\n * blur. The surfaces that name their own fill (sidebar, inspector, composer) never\n * showed it; only the ones that inherit did. */\nhtml[data-lg-style='liquid-glass'] body {\n  --lg-fill: var(--dsw-specific-bubble);\n}\n\n/* ---------------------------------------------------------------------------\n * 1. Floating surfaces.\n *\n * The sidebar panel, the inspector pane, menus, listboxes and modal dialogs.\n * Each is translucent, blurs what is behind it, and carries a specular rim: a\n * hairline all round, brighter along the lit top edge, plus a thin occlusion\n * line where the material meets what it floats over.\n * ------------------------------------------------------------------------- */\n/* Menus and listboxes are absent from this list, and materialised by their own rule\n * below: the client ships a material for them (`div._material_`) that is a translucent\n * fill under `blur(40px) saturate(1.5)`, and repainting it *as a surface* \u2014 with this\n * list's fill \u2014 replaced an official glass with an invented darker one. The exception is\n * handled at the end of this section. */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [role='dialog'][aria-modal='true'],\n  [data-lg-surface]\n) {\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-tint, var(--lg-translucency)), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 18%);\n  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  /* The engine hands each surface its own lens, because a lens belongs to a shape. The\n   * fallback is deliberately *empty* rather than `none`: a filter list with `none` in it\n   * is invalid, and a declaration that is invalid *at computed-value time* does not fall\n   * back to the declaration above it \u2014 it throws the whole property away, which cost every\n   * surface its frost until the engine had dressed it. With an empty fallback the value is\n   * simply the plain pair, and the lens is appended once there is one. */\n  backdrop-filter: var(--lg-refraction, blur(var(--lg-blur)) saturate(var(--lg-saturate)));\n  /* No radius on this rule, because its three members are not cut from one term: the composer card\n   * and the modal dialog take the skin's card radius (`--lg-radius-card`) in their own rules below,\n   * and a `[data-lg-surface]` opt-in \u2014 the LAN bridge panel \u2014 is handed the panel's by its own\n   * inline `var(--lg-radius-panel)`. One number written here would have to be wrong for two of the\n   * three.\n   *\n   * The modal dialog is the surface this rule used to leave out on purpose. The client cuts it to\n   * its own radius (measured 28px on the settings dialog) so the controls set inside it stay\n   * concentric with the box they sit in \u2014 its navigation rows are 40px tall at their own 12px\n   * corner. A pane moved on its own leaves a step between the container's corner and everything in\n   * it, which is the mismatch Apple's concentricity rule exists to avoid. That is a fact about a\n   * *container*, though, and not a reason to keep its corner off the one control: the step is now\n   * closed from the inside, because the dialog's own chrome takes the same relation the menu rows\n   * take (see the concentric rule below). So the dialog follows the radius with every other\n   * surface, and every control inside it is still cut concentric with the corner it sits in.\n   *\n   * Every surface that wears this rule takes the skin's radius in its own rule: the sidebar and the\n   * inspector pane (`--lg-radius-panel`), the composer card and the modal dialog\n   * (`--lg-radius-card`), a `[data-lg-overlay]` or `[data-lg-popover]` panel, the client's own\n   * popup material, and an opt-in `[data-lg-surface]` such as the LAN bridge panel through its\n   * own inline `var(--lg-radius-panel)`. */\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) var(--lg-rim-glow-blur, 5px) var(--lg-rim-glow-spread, -2px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent),\n    inset var(--lg-occ-dx, 0px) var(--lg-occ-dy, -1px) 0 0 rgb(0 0 0 / 22%),\n    var(--lg-shadow);\n}\n\n/* The modal dialog's own corner: the skin's card term, because that is the shape the client\n * already cut for it.\n *\n * Measured with the client's own stylesheet alone, the settings dialog (800x800) is cut to 28px \u2014\n * and `--lg-radius-card` is `--lg-radius-panel + 10px`, which is exactly 28px at the panel's own\n * default of 18px. That is the same derivation the composer card already has, for the same reason:\n * the client's 28px is a shape people approved, so the derived term holds it at the default and\n * moves it with the one radius control from there, instead of replacing it. The panel term (18px)\n * would instead cut the container *tighter* than the card it floats over and than the surfaces\n * around it, which is the one direction a container must not move: concentricity is defined from the\n * outside in, so the outermost corner of a stack is the one that has to be the widest.\n *\n * The hook is the semantic one the engine's own sweep mirrors (`COVERED_SURFACES`), and it is what\n * tells this client's modal dialog apart from the \u4F1A\u8BDD\u7EDF\u8BA1 popover, which is a `role=\"dialog\"` with\n * no `aria-modal` and is adapted by the popover rules instead. It carries no class hash, and it is\n * the same hook the dialog's own controls are measured under. */\nhtml[data-lg-style='liquid-glass'] [role='dialog'][aria-modal='true'] {\n  border-radius: var(--lg-radius-card);\n}\n\n/* A popover is not the same piece of glass as a panel that sits in the layout.\n *\n * What floats over the conversation has a wallpaper *and* the composer's own hard-edged bar\n * behind it, and it carries its own text on top. At the panel defaults \u2014 a 4px frost and a\n * 30px bend \u2014 that reads wrong twice over: the bend drags the composer's edge into the\n * popover as a grey smear several tens of pixels wide, and the frost is far too thin to stop\n * the wallpaper's type from competing with the panel's own. Measured on the OpenCode Go usage\n * panel (280x326 over the composer, light palette): the composer's edge is bent inward by up\n * to 14px and lands as a smudge across the panel's lower third, while the wallpaper behind it\n * stays legible through the pane. So a popover gets the material a popover wants: a deeper\n * frost to separate its text from what is behind it, and a much shorter bend, because there\n * is no wide, quiet backdrop here for a long lens to work on \u2014 only edges. */\nhtml[data-lg-style='liquid-glass'] :is([data-lg-overlay], [data-lg-popover], [role='dialog'][aria-modal='true']) {\n  /* The fill is the lever that matters here, and it is a *readability* lever rather than a\n   * taste one. A popover is where dense text sits, and what is behind it is not one texture:\n   * the OpenCode Go usage panel straddles the wallpaper and the composer's grey bar, whose\n   * top edge cuts across its lower third \u2014 so at a 20% fill the panel comes out half bright\n   * and half grey with a seam between, and its own rows have to be read against both. A\n   * deeper frost alone does not fix that: blurring a large grey area still leaves a large\n   * grey area, the step is in value rather than in sharpness. So a popover carries more of\n   * its own fill than a panel does, and the frost is deep enough that what shows through is\n   * a wash rather than an object. */\n  --lg-blur: 14px;\n  --lg-tint: 68%;\n  --lg-refract-band: 22px;\n  --lg-refract-bend: 12px;\n}\n\n/* The panels the engine's own detector tags (`data-lg-overlay`) and the ones a plugin marks as\n * its own popover (`data-lg-popover`) are glass this material draws, so their corner is the\n * skin's too. The modal dialog in the rule above is not in this list, because its corner is the\n * card term rather than the panel's: its own rule writes it, and its own chrome is cut concentric\n * with it. */\nhtml[data-lg-style='liquid-glass'] :is([data-lg-popover], [data-lg-overlay]) {\n  border-radius: var(--lg-radius-panel);\n}\n\n/* The client's own glass \u2014 a popover that arrived wearing a material of its own \u2014 is adapted\n * to the skin, not repainted into it.\n *\n * The distinction is the one rule 1 of this file's four is about, and it was learned the\n * expensive way: repainting the client's own popup material *as* one of our surfaces once\n * replaced an official glass with an invented darker one. So what such a panel keeps is\n * everything the client measured for itself \u2014 its own translucent fill family, the blur that\n * separates its text from what is behind it, the shape it cut for the content inside it \u2014 and\n * what it takes from the skin is the three things that made it read as a foreign surface\n * beside the surfaces around it: the corner, the popover *shape* of the lens (the band and the\n * bend, so the bend is a popover's rather than a card's), and one lens of its own from the\n * engine, which it can only be given once the engine has tagged it \u2014 measured before this\n * rule, the \u4F1A\u8BDD\u7EDF\u8BA1 popover carried no `data-lg-*` at all: no fill of ours, no lens, and the\n * client's 16px corner beside the sidebar's 18px.\n *\n * The fill is the one parameter deliberately *moved*, and it is moved to the number the user\n * asked for rather than to a panel default. Measured by solving the two known backdrops\n * (L(b) = aF + (1-a)b) on the pixel band of each surface that floats over the conversation:\n * the composer input field renders at an effective opacity of **0.20** with its own fill at\n * luma **45** (`--dsw-specific-bubble` at 20%), and this popover rendered at **0.455** with a\n * fill luma of **69** (the client's `rgba(67,69,74,0.45)`) \u2014 half again as opaque as the field\n * it floats over, which is the \"\u900F\u5EA6\u4E0D\u8DB3\" the request named. At `--lg-tint: 20%` over the same\n * inherited `--lg-fill` the popover measures 0.20 / 45: the field's grade, to the number.\n *\n * The frost stays the popover's own 14px rather than the field's 6px, and that is the one\n * place this rule departs from the benchmark. Translucency is the fill; the frost is what\n * keeps a panel's dense rows legible over whatever passes behind it, and a popover is where\n * dense text sits. Measured on the same band, the fill is what moves the mean luma; the blur\n * moves only how much structure survives in it. */\nhtml[data-lg-style='liquid-glass'] [data-lg-overlay][data-lg-client-glass] {\n  --lg-tint: 20%;\n  --lg-blur: 14px;\n  --lg-refract-band: 22px;\n  --lg-refract-bend: 12px;\n}\n\n/* The sidebar: floats in its column's gutter, refracted because it is large\n * enough for the bend to be visible at its edges.\n *\n * Both the float and its column's gutter apply to the EXPANDED layout only, which\n * the engine marks as `data-lg-wide`. The 56px rail cannot host them: the client\n * lays out 36px control boxes in it against 10px of side padding, so any gutter at\n * all would clip them \u2014 the rail stays exactly as the client draws it. The panel's\n * width is an inline style, so the narrower box comes from `max-width`; a\n * stylesheet cannot beat an inline `width`, and `width: auto !important` would\n * squash the panel while the column collapses instead of letting the column clip\n * it. */\nhtml[data-lg-style='liquid-glass'] [data-lg-wide] > [data-slot='sidebar'] > * {\n  --lg-fill: var(--dsw-specific-sidebar-fill);\n  /* A panel carries a longer edge than a control, so its highlight can be a little\n   * stronger without reading as paint. */\n  --lg-specular: 28%;\n  --lg-sheen: 5%;\n  --lg-translucency: 22%;\n  /* What this panel actually renders over the frame. The client's session list\n   * fades its bottom edge by painting `--dsw-specific-sidebar-fill` \u2014 the opaque\n   * token \u2014 over the panel, so at any real translucency that child lands several\n   * values off and reads as a band across the panel. Publishing the composite to\n   * the subtree is what lets the panel be this thin at all. */\n  --lg-panel-composite: color-mix(in srgb,\n    rgb(0 0 0) var(--lg-veil, 0%),\n    color-mix(in srgb, var(--dsw-specific-sidebar-fill) var(--lg-translucency), var(--dsw-alias-bg-base)));\n  /* A panel is the biggest pane here, so its band is the widest and its bend is the\n   * longest: the same proportions on a 400px sheet read as a bevel rather than glass. */\n  --lg-refract-band: 36px;\n  --lg-refract-bend: 36px;\n  /* A panel's glow is the long one this file has always given it \u2014 14px of blur pulled in by\n   * 7px \u2014 and it is pushed twice as far towards the light as a control's, because a longer\n   * glow reads its direction from a longer way off. */\n  --lg-rim-glow-blur: 14px;\n  --lg-rim-glow-spread: -7px;\n  --lg-rim-glow-drop: 2;\n  max-width: 100%;\n  border-radius: var(--lg-radius-panel);\n  /* The material is split across two layers, and which half goes where is a fact about\n   * backdrop roots rather than a preference about tidiness.\n   *\n   * A backdrop root is created by exactly one of the things this material needs: the\n   * backdrop filter. The client anchors its own popovers to this panel \u2014 the LAN bridge\n   * panel is one of them, and it is our plugin \u2014 so this element must never be their\n   * backdrop root: with a filter here they had nothing behind them but the panel's own\n   * uniform interior to blur. So the filter is the one thing that does NOT live on this\n   * element; it stays on the pane below, and the pane is stripped of everything else.\n   *\n   * The fill and the rim are the other half, and they are the half that has to live HERE:\n   * neither `background-*` nor `box-shadow` creates a backdrop root, so putting them on a\n   * `::before` at `z-index: -1` buys nothing and risks everything \u2014 measured on this very\n   * panel, with the fill and the rim on the pane the panel's own pixels did not move at all\n   * when the pane was deleted, i.e. the material the pane was supposed to carry was simply\n   * not reaching the screen. Painting them on the element makes the material independent of\n   * where a negative-z child happens to land. */\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-translucency), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 30%);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n  /* Children carry their own fills, so the panel has to clip them for its radius\n   * to read at all. */\n  overflow: hidden;\n  /* The rim, on the element with the fill: a hairline all round, brighter along the lit top\n   * edge, a soft glow just inside it, and a thin occlusion line along the bottom, under the\n   * panel's own float. */\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) calc(var(--lg-light-dy, 1px) * var(--lg-rim-glow-drop, 1)) var(--lg-rim-glow-blur, 14px) var(--lg-rim-glow-spread, -7px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent),\n    inset var(--lg-occ-dx, 0px) var(--lg-occ-dy, -1px) 0 0 rgb(0 0 0 / 22%),\n    var(--lg-shadow);\n}\n\nhtml[data-lg-style='liquid-glass'] [data-lg-wide] > [data-slot='sidebar'] > *::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  border-radius: inherit;\n  pointer-events: none;\n  /* The filter, and nothing else. It is what has to leave the element (a filter on the panel\n   * would make the panel a backdrop root for every popover anchored to it), and it is also\n   * everything a layer of its own actually needs: the fill and the rim are on the element,\n   * and the pane's only job is to bend what is behind the panel. */\n  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: var(--lg-refraction, blur(var(--lg-blur)) saturate(var(--lg-saturate)));\n}\n\n/* Children of that panel inherit the composite, so anything painting the client's\n * own sidebar fill paints what the panel renders instead. */\nhtml[data-lg-style='liquid-glass'] [data-lg-wide] > [data-slot='sidebar'] > * > * {\n  --dsw-specific-sidebar-fill: var(--lg-panel-composite);\n}\n\n/* Its column stops painting and gives the panel its gutter \u2014 the only geometry\n * this material changes anywhere. */\nhtml[data-lg-style='liquid-glass'] div:has(> [data-slot='sidebar'])[data-lg-wide] {\n  background-color: transparent;\n  padding: var(--lg-gap, 12px);\n}\n\n/* The inspector column paints through a dockkit tab-host pane, not through the\n * sidebar-right plugin's own wrapper, so the pane is the element to materialise.\n * It is matched by the tab it hosts rather than by its generated class name. */\nhtml[data-lg-style='liquid-glass'] section:has([data-slot='sidebar.right.pane.tab']) {\n  --lg-fill: var(--dsw-alias-bg-base);\n  --lg-translucency: 22%;\n  margin: var(--lg-gap, 12px);\n  border-radius: var(--lg-radius-panel);\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-inspector-tint), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 30%);\n  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: var(--lg-refraction, blur(var(--lg-blur)) saturate(var(--lg-saturate)));\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) var(--lg-rim-glow-blur, 5px) var(--lg-rim-glow-spread, -2px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent),\n    var(--lg-shadow);\n}\n\n/* The composer card floats over the conversation: the one surface whose blur has\n * real content to work with, so it carries the refraction. Its corner is the skin's\n * too \u2014 but on its own derived term (`--lg-radius-card`), because the 28px the client\n * gives this card is the shape people already approved: keeping it at the default is\n * not the same as keeping it out of the control's reach. */\nhtml[data-lg-style='liquid-glass'] [data-composer-card] {\n  --lg-fill: var(--dsw-specific-bubble);\n  /* The one surface with conversation to reveal: it carries the strongest blur of\n   * the set, because what passes behind it is text. */\n  --lg-tint: 20%;\n  --lg-blur: 6px;\n  /* A control gets a tight rim and almost no sheen: the client already draws its\n   * own 0.5px stroke, and anything more turns the card milky. */\n  --lg-specular: 18%;\n  --lg-sheen: 2%;\n  --lg-hairline: 10%;\n  --lg-glow: 26%;\n  /* The card is a control, so its pane is thinner than a panel's: a narrower band and a\n   * shorter bend, which is what a small piece of glass does. */\n  --lg-refract-band: 30px;\n  --lg-refract-bend: 30px;\n  /* Named again here, not only in the shared surface rule, because the card is a stack:\n   * its pane \u2014 the layer that carries the rim \u2014 is a pseudo-element that inherits this\n   * box's radius, so the pane and the box have to be told the same corner. This\n   * declaration is outranked by the shared surface rule; see the `[data-lg-refract]` rule\n   * below for where the card's radius actually lands, and why. The two are kept in step\n   * so they can never disagree. */\n  border-radius: var(--lg-radius-card);\n  /* Same split as the sidebar panel, for the same measured reason \u2014 and the card needs the\n   * filter off its own box for a second time, because the client anchors popovers here too\n   * (the OpenCode Go usage card, the token-usage card): a backdrop filter anywhere on an\n   * element makes it a backdrop root, and those cards would have nothing behind them but the\n   * composer's own uniform interior instead of the conversation.\n   *\n   * The filter is therefore the only thing that lives on the pane; the fill and the rim live\n   * here, where `background-*` and `box-shadow` cost nothing and cannot be promoted out of\n   * the panel by a negative `z-index`. */\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-tint, var(--lg-translucency)), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 18%);\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) var(--lg-rim-glow-blur, 5px) var(--lg-rim-glow-spread, -2px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent),\n    var(--lg-shadow);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}\n\n/* The specificity above is not decoration: the shared surface rule's `:is(\u2026)` takes the\n * specificity of its *most specific* argument \u2014 `[role=\"dialog\"][aria-modal=\"true\"]` \u2014 so it\n * outranks a plain `[data-composer-card]` selector and kept handing the card its lens no\n * matter what the rule above said. Measured with a rule audit against the live stylesheet:\n * two rules matched the composer card and both set a backdrop filter, and the shared one won.\n * `[data-lg-refract]` is the attribute the engine sets on every surface it has dressed, so\n * requiring it raises this rule above the shared one without touching anything else. */\nhtml[data-lg-style='liquid-glass'] [data-composer-card][data-lg-refract] {\n  /* The card's radius, and the declaration that decides it: the shared surface rule's\n   * `:is(\u2026)` takes the specificity of its most specific argument\n   * (`[role=\"dialog\"][aria-modal=\"true\"]`, two class-level parts), so it outranks a plain\n   * `[data-composer-card]`. Requiring `[data-lg-refract]` \u2014 the attribute the engine sets\n   * on every surface it has dressed \u2014 matches that specificity from later in the file,\n   * which is the same lever the backdrop filter below uses. */\n  border-radius: var(--lg-radius-card);\n  /* The fill and the rim, restated at the specificity that actually wins, and no stacking\n   * context: the card must not become a backdrop root, and its material must not depend on\n   * where a negative-z layer lands. */\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-tint, var(--lg-translucency)), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 18%);\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) var(--lg-rim-glow-blur, 5px) var(--lg-rim-glow-spread, -2px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent),\n    var(--lg-shadow);\n  -webkit-backdrop-filter: none;\n  backdrop-filter: none;\n}\n\nhtml[data-lg-style='liquid-glass'] [data-composer-card]::before {\n  content: '';\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n  border-radius: inherit;\n  pointer-events: none;\n  /* The filter, and nothing else \u2014 the fill and the rim are on the card itself (see the rule\n   * above). A raster of the pane's own fill under its own blur was also the reason the rim had\n   * to be drawn here at all: with the pane carrying no paint, there is no second raster to keep\n   * the crisp 1px edge out of. */\n  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: var(--lg-refraction, blur(var(--lg-blur)) saturate(var(--lg-saturate)));\n}\n\n/* The client's own popup material \u2014 `_material_`, on menus, listboxes and anything else\n * it puts in a portal \u2014 is a 45\u201358% fill under `blur(40px) saturate(1.5)`. Over the\n * light palette's near-white page that is a white rectangle on white: the fill is almost\n * exactly the backdrop, the blur has nothing it can show, and the menu reads as unstyled.\n * So it is materialised like every other surface, with the client's own container colour as\n * its fill, a deeper blur than a panel gets because a menu carries its own text, a rim, and\n * a lens of its own \u2014 its band is narrow, because a menu is a small piece of glass. */\nhtml[data-lg-style='liquid-glass'] [class*='_material_'] {\n  /* The skin's corner, on this layer and on the surface around it at once.\n   *\n   * The client cuts this pane to `inherit` and the surface it sits in to `--dsw-radius-lg`\n   * (16px), so the two agree only while they are told the same thing. A radius here alone put\n   * the pane at 18px inside a surface still at 16px \u2014 the 2px mismatch this rule used to avoid\n   * by leaving both to the client. That trade-off is obsolete now the skin has one adjustable\n   * radius: one number has to reach both layers, which is why the surface's own rule\n   * (`[data-menu-material]`, below this one) moves with it. Measured after: both layers 18px\n   * at the panel default, both 24px when the token is 24px. */\n  border-radius: var(--lg-radius-panel);\n  --lg-fill: var(--dsw-alias-bg-layer-1);\n  --lg-tint: 28%;\n  --lg-blur: 8px;\n  /* The band is proportional to the pane, and a menu is short.\n   *\n   * At 24px/24px \u2014 a third of this pane's 76px \u2014 the lens did not bend the menu's own edge, it\n   * pulled the account row below it in. Measured on the open menu (pane 144x76 at (34,742), the\n   * account row's avatar band sitting 14..23px below the bottom edge, backdrop 66 luma against 35\n   * at 0..13px): the 14 CSS px above the bottom edge came out at 57.8 mean luma against 34.6 with\n   * the token at 0px \u2014 a +23 luma phantom row where the design has none. The two backdrops and the\n   * 28% fill account for the same number (0.28 * 35 + 0.72 * 66 = 57.3), so what arrives there is\n   * the neighbour displaced in, not paint. A sweep of the token on that pane, lift over the 0px\n   * capture in those same 14px: 24px -> +23.2, 20 -> +14.9, 16 -> +7.1, 12 -> +2.1, 10 -> +1.0,\n   * 8 -> +0.5, 6 -> +0.2, 4 -> +0.1. 8px is the widest band still inside the run's own noise\n   * (+-0.5 luma between two captures of one state), and it is 10.5% of the pane rather than 32% \u2014\n   * a menu's band is about a tenth of its height, not a panel's constant carried down to a box a\n   * tenth the size. */\n  --lg-refract-band: 8px;\n  --lg-refract-bend: 8px;\n  --lg-glow: 30%;\n  background-color: color-mix(in srgb, var(--lg-fill) var(--lg-tint), transparent);\n  background-image: linear-gradient(rgb(0 0 0 / var(--lg-veil, 0%)), rgb(0 0 0 / var(--lg-veil, 0%))), linear-gradient(180deg, rgb(255 255 255 / var(--lg-sheen)) 0%, rgb(255 255 255 / 0%) 30%);\n  -webkit-backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: blur(var(--lg-blur)) saturate(var(--lg-saturate));\n  backdrop-filter: var(--lg-refraction, blur(var(--lg-blur)) saturate(var(--lg-saturate)));\n  box-shadow:\n    /* The lit hairline and its glow, on the edge the room's light is on; the occlusion line is\n     * the same vector negated, so the two never share an edge (see the token group). */\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) 0 0 rgb(255 255 255 / calc(var(--lg-specular) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset var(--lg-light-dx, 0px) var(--lg-light-dy, 1px) var(--lg-rim-glow-blur, 5px) var(--lg-rim-glow-spread, -2px) rgb(255 255 255 / calc(var(--lg-glow) * var(--lg-lift) * var(--lg-near-edge, 1))),\n    inset 0 0 0 1px color-mix(in srgb, var(--lg-edge, #fff) var(--lg-hairline), transparent);\n}\n\n/* The surface the client's popup material is nested in is the layer that owns the corner.\n *\n * `data-menu-material=\"translucent\"` is written by the client's own `MenuSurface`, on the same\n * element that carries `role=\"menu\"` and the generated `_surface_<hash>` class, and it is the\n * hook the client's own palette rules key on \u2014 so the radius goes there rather than on a hash a\n * rebuild would rename. The `_material_` pane inside it inherits this box's corner, which is\n * exactly why the radius has to be written here as well as on that pane: told the same number,\n * the two layers are concentric at any radius; told different ones, the pane sits inset by the\n * difference (the 2px this file measured before). Measured on the account menu (144x76): both\n * layers 18px at the panel default, both 24px with `--lg-radius-panel: 24px`.\n *\n * A `compact` surface, which the client cuts to `--dsw-radius-md` (12px), takes the panel radius\n * too: one skin has one radius, which is what the control that moves it is for. */\nhtml[data-lg-style='liquid-glass'] [data-menu-material] {\n  border-radius: var(--lg-radius-panel);\n}\n\n/* A menu's rows are cut CONCENTRIC with the menu they sit in.\n *\n * A menu surface takes the skin's corner (`[data-menu-material]` above), but its rows kept the\n * client's own 12px \u2014 measured on the account menu with the panel token at 6px: the surface and its\n * `_material_` pane both 6px, and the two `button[role=menuitem]` rows 136x34, inset 4px, still at\n * 12px. The inner corner was *larger* than the outer one, and a row's corner is where that shows:\n * the rows are the elements that carry the hover and selected highlight, so the mismatch reads\n * exactly at the corners \u2014 the reported \"the corner adaptation is incomplete\".\n *\n * Apple's concentricity rule is the fix: inner = max(0, outer \u2212 the row's own inset). The inset is\n * the one number a stylesheet cannot read, because it is a child's box measured against its\n * parent's, so the engine measures it per row and publishes it as `--lg-menu-inset` (index.ts,\n * `markMenuRows`). What is left here is arithmetic: the corner is a `var()` of\n * `--lg-radius-panel`, so the radius control drags the rows with the panel, frame for frame, with\n * no engine pass in between \u2014 the engine only ever reports a *geometry*, never a radius.\n *\n * Written for menus in general rather than for the account menu, because a menu whose rows are not\n * concentric is the same defect anywhere. The hook is semantic \u2014 `role=\"menu\"`, the client's own\n * `data-menu-material`, and the three menuitem roles \u2014 never a CSS-module hash. It comes before\n * section 3b on purpose: a row the skin has already decided is a square control keeps that rule's\n * round shape (equal specificity, later wins), and the shell's own surfaces and the dialog's own\n * chrome are not touched by it \u2014 a dialog row is not a menu row, and it is cut by its own rule.\n *\n * The fallback inset is 4px, which is what every menu this client opens pads by \u2014 measured: the\n * account menu and the sidebar's \u66F4\u591A flyout both `padding: 4px` with rows inset 4px on every side\n * \u2014 so a row whose inset the engine has not measured yet is still concentric.\n */\nhtml[data-lg-style='liquid-glass'] :is([role='menu'], [data-menu-material]) :is(\n  [role='menuitem'],\n  [role='menuitemcheckbox'],\n  [role='menuitemradio']\n) {\n  border-radius: max(0px, calc(var(--lg-radius-panel) - var(--lg-menu-inset, 4px)));\n}\n\n/* A dialog's own chrome is cut CONCENTRIC with the dialog \u2014 the same relation the menu rows\n * above take, with the same mechanism, because it is the same defect when it is missing.\n *\n * The dialog now follows the skin's corner (the card term, 28px at the panel default), so the\n * controls the dialog lays out at its own edges have to be cut from that corner rather than from\n * whatever number their own module happens to carry: measured on the settings dialog, the\n * navigation rows sit 12px inside its left edge at their own 12px corner, the header's action\n * button 20px inside its top edge at 8px, and the close button 14px inside its right edge. Cut\n * concentric \u2014 inner = max(0, outer minus the control's own inset) \u2014 each of them stays inside\n * the container's corner at every value of the token, which is the whole of Apple's rule; left to\n * its own number, a control the radius control shrinks past its own corner becomes the *rounder*\n * box in a squarer container, which is the defect the menu rows were fixed for.\n *\n * The inset is the one number a stylesheet cannot read (a child's box against its parent's), so\n * the engine measures each control's ring inset \u2014 the smallest distance from its box to the\n * dialog's \u2014 and tags the controls that sit in the dialog's own chrome ring with\n * `data-lg-dialog-inset`, writing the measurement beside it as `--lg-dialog-inset` (index.ts,\n * `markDialogControls`). What is left here is arithmetic on a `var()` of the theme token, so the\n * radius control drags every one of them with the dialog in the same frame, with no engine pass\n * in between: the engine only ever reports a *geometry*, never a radius.\n *\n * Membership is that measurement rather than a class name: a page's *content* is a different\n * thing from the chrome that frames it. Measured across all nine settings pages, the chrome ring\n * is exactly the rows (12px), the header's action button (20px) and the close button (14px),\n * while the pages' content sits inside a scrolling column \u2014 its controls measure rings of\n * 5..17px on three of the nine pages, and those rings move with the scroll offset rather than with\n * the layout \u2014 so content keeps the shape its own design gives it.\n *\n * The fallback inset is 12px, the dialog's own chrome padding (measured on the navigation column),\n * so a control whose inset the engine has not measured yet is still concentric. The rule comes\n * before section 3b on purpose, exactly as the menu rule does: a control the skin has already\n * decided is a square one keeps that rule's round shape (equal specificity, later wins) \u2014 the\n * dialog's close button is one, and it stays a circle.\n */\nhtml[data-lg-style='liquid-glass'] [role='dialog'][aria-modal='true'] [data-lg-dialog-inset] {\n  border-radius: max(0px, calc(var(--lg-radius-card) - var(--lg-dialog-inset, 12px)));\n}\n\n/* The card floats on the client's own seat, and that seat carries a fade of its\n * own: a gradient from transparent to the opaque page colour across its first\n * 36px, whose whole job is to dissolve the conversation before it reaches a card\n * that does not let anything through. Behind a translucent card the same gradient\n * stops being a fade and becomes *content*: the conversation is visible at the top\n * of the glass and gone a few pixels lower, with the seam sitting right where the\n * card's own first text line is, which reads as the input's background breaking in\n * half \u2014 and, worse, gives away that the pane is not a pane. A floating surface\n * does not dissolve what is behind it, it blurs it, so the fade is replaced by one\n * that lives entirely *below* the card: transparent through the card's whole\n * height, then opaque across the lip under it, which is what still keeps the\n * scrolling conversation from running sharp into the window's bottom edge. The ramp\n * starts one pixel below the card's bottom edge and reaches full opacity four pixels\n * later, so both the seam and the ramp are covered by the card's own shadow instead\n * of landing beside it, and no conversation is left sharp under the pane.\n * The lip is measured rather than guessed \u2014 the engine publishes it as\n * `--lg-composer-lip` from the card's own box, so a taller composer keeps the fade\n * under itself.\n *\n * The selector mirrors the client's own `[data-phase='active'] \u2026composerSeat` rule\n * \u2014 it matches the same phase, and needs a third class-level part to outrank that\n * rule. The element itself is tagged by the engine after locating it from the\n * card's stable hook, so nothing here depends on which class name the client\n * generated. */\nhtml[data-lg-style='liquid-glass'] [data-phase='active'] [data-lg-seat] {\n  background-image: linear-gradient(\n    180deg,\n    rgb(0 0 0 / 0) 0,\n    rgb(0 0 0 / 0) calc(100% - var(--lg-composer-lip, 30px) + 1px),\n    var(--dsw-alias-bg-base) calc(100% - var(--lg-composer-lip, 30px) + 5px),\n    var(--dsw-alias-bg-base) 100%\n  );\n}\n\n/* ---------------------------------------------------------------------------\n * 2. Controls that stand on content.\n *\n * The header action seats and the assistant-action row sit on the conversation\n * itself, with no glass surface under them, so each control is its own capsule.\n * Controls inside a glass surface are deliberately absent from this list: a\n * capsule inside a capsule is the nesting Apple's guidance rules out.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-slot='conversation.session.header.actions'],\n  [data-slot='conversation.session.header.utilities'],\n  [data-slot='conversation.session.header.corner'],\n  [data-slot='conversation.chat.assistant-actions']\n) button {\n  border-radius: var(--lg-radius-control);\n}\n\n/* ---------------------------------------------------------------------------\n * 3. One-to-one controls are round.\n *\n * The engine tags every control whose box is square; its shape is a fact about\n * the rendered layout, not about a class name, so it is measured and tagged\n * rather than matched.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass'] [data-lg-square] {\n  border-radius: var(--lg-radius-control);\n}\n\n/* ---------------------------------------------------------------------------\n * 3b. Controls that stand ON a glass surface.\n *\n * Neither glass nor nothing. A capsule with a blur and a rim inside a pane of\n * glass is glass nested in glass, which the guidance rules out; leaving them\n * entirely to the client loses the one thing the surface owes them, which is to\n * read as sitting *above* it. So they get elevation: a flat translucent fill one\n * step up from the panel, a hairline, and the round shape of a control. No blur,\n * no specular rim, no sheen \u2014 those belong to the surface, and repeating them here\n * is what made the nested capsules look wrong.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-slot='sidebar'],\n  [role='dialog'][aria-modal='true'],\n  [role='menu'],\n  [role='listbox']\n) :is([class*='_iconButton'], [class*='_toggle'], [class*='_searchButton'], [data-lg-square]) {\n  border-radius: var(--lg-radius-control);\n  background-color: var(--lg-elevation);\n  /* The control's hairline is the one rim it has, so it is the one the pointer pulls. `--lg-lift`\n   * is reset to the material's own value first, so a hovered panel above a control cannot raise\n   * every rim inside it \u2014 only the control the pointer is actually on. */\n  --lg-lift: 1;\n  box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--lg-edge, #fff) calc(var(--lg-control-hairline) * var(--lg-lift)), transparent);\n}\n\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-slot='sidebar'],\n  [role='dialog'][aria-modal='true'],\n  [role='menu'],\n  [role='listbox']\n) :is([class*='_iconButton'], [class*='_toggle'], [class*='_searchButton'], [data-lg-square]):hover {\n  --lg-lift: var(--lg-hover-lift);\n  background-color: var(--lg-elevation-hover);\n}\n\n/* The control's *pressed* state is in section 7, with the other two pointer responses, so the\n * whole of the press \u2014 the lift, the dent and the light \u2014 is one block of the file. */\n\n/* ---------------------------------------------------------------------------\n * 4. Fields.\n *\n * A control you type into is recessed rather than raised, in the client's\n * language and Apple's alike. This is a well, not a glass surface, so it is safe\n * inside one.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass'] :is(\n  input:not([type='checkbox']):not([type='radio']):not([type='range']),\n  textarea\n) {\n  background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 45%, transparent);\n  border-radius: var(--lg-radius-field);\n  box-shadow: inset 0 1px 2px rgb(0 0 0 / 26%), inset 0 0 0 0.5px rgb(255 255 255 / 8%);\n}\n\n/* ---------------------------------------------------------------------------\n * 5. Light palette.\n *\n * Same material, lit from the other side: the surface's own light is its own\n * fill rather than a veil, and a small dark tint keeps text contrast.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass']:has(body:not([data-ds-dark-theme])) {\n  /* The fills are the client's own tokens, so they follow the palette on their\n   * own; only the opacities and the rim are per-palette \u2014 and they mirror the dark\n   * palette's structure rather than a second, older design. A pane of glass is as\n   * thin under a light backdrop as under a dark one; what changes is that a white\n   * rim is invisible on white, so the edge becomes a dark hairline instead. */\n  --lg-translucency: 24%;\n  --lg-specular: 52%;\n  --lg-hairline: 16%;\n  --lg-sheen: 12%;\n  /* Light from the other side is a shallower glow: a white one on a white pane is not an\n   * edge, it is a smudge. */\n  --lg-glow: 26%;\n  /* Enough to give the pane a body of its own, no more: the client's light sidebar\n   * fill is only six values darker than a white page, and the Dark component\n   * compounds with it. At 7% the panel landed twenty values off the client's own\n   * tone and read as a grey slab; at 2.5% it matches that tone while still being\n   * translucent. */\n  --lg-veil: 2.5%;\n  --lg-edge: rgb(15 23 42);\n  --lg-elevation: rgb(15 23 42 / 6%);\n  --lg-elevation-hover: rgb(15 23 42 / 10%);\n  --lg-elevation-active: rgb(15 23 42 / 14%);\n  --lg-inspector-tint: 32%;\n  --lg-shadow: 0 18px 40px -22px rgb(14 20 40 / 34%), 0 2px 8px rgb(14 20 40 / 12%);\n}\n\n/* ---------------------------------------------------------------------------\n * 6. Scrollbars.\n *\n * Apple's scrollbars are an overlay: a rounded translucent thumb, no track, and\n * no stepper buttons. The client's own sheet already consumes its\n * `--dsh-scrollbar-*` tokens for the width and the thumb, but it never hides\n * `::-webkit-scrollbar-button`, so the engine keeps drawing the platform's\n * arrow buttons at both ends of every bar. This closes that gap; the thumb\n * radius and colours stay the client's.\n * ------------------------------------------------------------------------- */\nhtml[data-lg-style='liquid-glass'] ::-webkit-scrollbar-button {\n  display: none;\n  width: 0;\n  height: 0;\n}\n\nhtml[data-lg-style='liquid-glass'] ::-webkit-scrollbar-corner,\nhtml[data-lg-style='liquid-glass'] ::-webkit-scrollbar-track {\n  background: transparent;\n}\n\nhtml[data-lg-style='liquid-glass'] ::-webkit-scrollbar-thumb {\n  border-radius: var(--lg-radius-control);\n  background-color: color-mix(in srgb, var(--dsh-scrollbar-thumb) 88%, transparent);\n  box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 8%);\n}\n\nhtml[data-lg-style='liquid-glass'] ::-webkit-scrollbar-thumb:hover {\n  background-color: var(--dsh-scrollbar-thumb-hover);\n}\n\n/* ---------------------------------------------------------------------------\n * 7. The pointer: hover, press, and the room's one light.\n *\n * Three responses, each one token, each reverting in one place:\n *\n * - **Hover** pulls `--lg-lift`, which multiplies a surface's *own* specular and glow, so a\n *   control the pointer rests on catches more light while its own compositing \u2014 fill, frost,\n *   lens \u2014 stays exactly what it was.\n * - **Press** takes that lift away and adds the dent (`--lg-dent-*`), so the control is\n *   recessed *into* the material instead of dimmed on top of it.\n * - **The light** is the derived offsets in the token group, which every rim in this file\n *   already reads: the shared surface rule, the sidebar panel, the inspector pane, the\n *   composer card, the menu's own pane, and the control hairline in 3b.\n *\n * What is deliberately NOT here is as much a measurement as what is. A menu, a popover and\n * the modal dialog all *open under the pointer*, so a hover lift on them is not a response to\n * the pointer at all \u2014 it is the state the panel would be born in and then hold for as long as\n * the pointer stayed on it. So the lift reaches the two glass surfaces a pointer can *arrive*\n * on \u2014 the composer card and the sidebar panel \u2014 and the controls standing on glass.\n *\n * The shell's own window frame is out of reach of all three by construction rather than by an\n * exception: `#dsh-shell-drag` is a plain div, and the three window buttons live in\n * `#dsh-shell-chrome`, which is not inside any surface these rules are scoped to. No rule here\n * matches an element the frame owns, so nothing about the frame's own hover, press or drag\n * regions changes.\n * ------------------------------------------------------------------------- */\n\n/* A glass surface a pointer can arrive on: the composer card, and the sidebar panel. */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [data-lg-wide] > [data-slot='sidebar'] > *\n):hover {\n  --lg-lift: var(--lg-hover-lift);\n}\n\n/* A control standing on glass, pressed: the lift goes, and the material dents. The dark inset\n * enters from the top \u2014 the same direction this file's field rule already recesses a well from\n * (section 4) \u2014 and its offset, spread and opacity are all scaled by `--lg-dent-on`, so the one\n * token removes the response outright: at 0 the inset is a zero-offset, zero-alpha shadow, which\n * paints nothing at all, and the hairline behind it is the material's own 9%. */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-slot='sidebar'],\n  [role='dialog'][aria-modal='true'],\n  [role='menu'],\n  [role='listbox']\n) :is([class*='_iconButton'], [class*='_toggle'], [class*='_searchButton'], [data-lg-square]):active {\n  --lg-lift: 1;\n  background-color: var(--lg-elevation-active);\n  box-shadow:\n    inset 0 calc(var(--lg-dent-drop) * var(--lg-dent-on)) var(--lg-dent-blur) 0 rgb(0 0 0 / calc(var(--lg-dent-darken) * var(--lg-dent-on))),\n    inset 0 0 0 0.5px color-mix(in srgb, var(--lg-edge, #fff) calc(var(--lg-control-hairline) * (1 - var(--lg-dent-on)) + var(--lg-dent-rim) * var(--lg-dent-on)), transparent);\n}\n\n/* The press, and the drag that follows it.\n *\n * The one part of this material that *moves*, ported from \u6DB2\u6001\u73BB\u7483.html \u2014 its button module\n * (lines 661-712: the lift of 4/48, the tanh follow, the critical springs) and the velocity\n * squash the switch, the slider and the tab lens all share (lines 509-512). The engine runs\n * the springs and publishes the frame's own numbers; every declaration here is one of them.\n *\n * Three terms, and the reason each is a *proportion* rather than a size: a control lifts by a\n * share of itself (a 48px button and a 28px icon grow by the same amount *of themselves*), it\n * follows the pointer through the reference's `size * tanh(0.05 * travel / size)` \u2014 so a drag\n * is answered for its first few pixels and then refused, which is what makes a long drag read\n * as the material holding its seat rather than as the control sliding away \u2014 and it stretches\n * along the drag by the velocity it is carrying, up to the reference's own fifth either way.\n *\n * The engine attaches this to a control only when its computed `transform` is `none`, so the\n * rule cannot overwrite a centring translate or the client's own animation; `data-lg-pressing`\n * is therefore also the statement \"this control was still when the press began\".\n *\n * Revert: one line in the engine \u2014 the `PressResponse` effect in `apply()`. With nothing\n * writing the attribute, every declaration here is inert. */\nhtml[data-lg-style='liquid-glass'] [data-lg-pressing]:not([role='switch']) {\n  transform:\n    translate3d(var(--lg-press-x, 0px), var(--lg-press-y, 0px), 0)\n    scale(var(--lg-press-sx, 1), var(--lg-press-sy, 1));\n  will-change: transform;\n}\n\n/* The switch: the one control whose thumb *is* the control.\n *\n * Ported from \u6DB2\u6001\u73BB\u7483.html, which builds its toggle out of the same parts the client already\n * draws (a track and a thumb) but proportioned as Apple's own: track 64x28, thumb 40x24 with\n * the track's inner height and a pill radius, travel 20 \u2014 the whole of the thumb's travel is\n * the track's inner width less the thumb's own (line 42's note on the source's metrics, and\n * lines 63-67 and 508-517 for the parts). The proportions are what is taken, on the client's\n * own box: the thumb is 22px wide in the client's 36px track (0.61, against the reference's\n * 0.625) and 16px tall in its 20px track, so the travel falls from the client's 16px to 10px\n * and the thumb still lands inside its own track.\n *\n * The pressed state is where the two designs differ most, and it is the reference's idea that\n * is kept: pressing a switch is a statement about its *thumb*, not about the control. The\n * reference scales the thumb 1.5x and lets it overhang; here the thumb takes the same lift\n * every other control takes \u2014 {@link PRESS_LIFT}, 4/48 \u2014 so a 16px thumb grows 1.3px and stays\n * inside its track, and it is the thumb that follows the drag while the track stays put. The\n * rim the reference's thumb wears at 0.5px while pressed is here the control's own hairline\n * and the material's own dent, because a switch in a settings dialog stands *on* glass: this\n * file's own rule is that a control there is elevation, not a second pane of glass.\n *\n * A *drag* on a switch is a statement about its value, and the thumb answers it: past the first\n * 3px of travel the engine publishes the pointer's own horizontal travel - clamped to the track,\n * the reference's `downF + dx / travel` (line 567) - as `--lg-drag-x`, and the thumb is painted\n * there instead of the tanh follow every other control gets. The token is written while the\n * gesture lasts and removed with it, so the painted thumb is always a function of the control's\n * own state plus one number on the element. The state itself is not written here, or anywhere\n * else, by this material: the release runs the reference's half-way test (lines 573-577) and\n * dispatches the control's own click, so `aria-checked` - and with it `--lg-switch-on` - stays\n * the client's business (engine: PressResponse.dragEnds).\n *\n * The drag term falls back to the press follow when it is absent, so the engine's own revert\n * (one line: the `dragEnds` call in `release`) leaves the thumb moving exactly as it did before\n * this rule changed - the follow simply becomes the fallback, which is still there.\n *\n * Revert: delete this block, and drop '[role=\"switch\"]' from the engine's PRESS_CONTROLS list\n * for the motion \u2014 the client's own 16px circle and its 16px travel come back untouched. */\nhtml[data-lg-style='liquid-glass'] [role='switch'] {\n  --lg-switch-on: 0;\n  --lg-switch-thumb: 22px;\n  --lg-switch-travel: 10px;\n}\nhtml[data-lg-style='liquid-glass'] [role='switch'][aria-checked='true'] { --lg-switch-on: 1; }\n\n/* The specificity here is load-bearing twice over: the client's own `.switch[aria-checked='true']\n * .thumb` is three classes deep, and `[aria-checked]` on the switch is what outranks it whatever\n * the thumb's generated class is called. */\nhtml[data-lg-style='liquid-glass'] [role='switch'][aria-checked] > span {\n  width: var(--lg-switch-thumb);\n  height: 16px;\n  border-radius: 8px;\n  corner-shape: round;\n  transform: translateX(calc(var(--lg-switch-travel) * var(--lg-switch-on)));\n}\n\n/* A dragged thumb is under the pointer, so the client's own 0.12s ease on its transform is off\n * for as long as the gesture lasts: with it on, the painted thumb trails the travel by most of\n * the drag (measured before this rule: 3.00px asked, 1.80px painted). The engine's spring is\n * the whole of the motion instead \u2014 it carries the thumb home after a release that did not\n * cross, and finishes the travel after one that did. `data-lg-dragged` is worn only past the\n * 3px slop, so a tap keeps the client's own easing exactly as it was. */\nhtml[data-lg-style='liquid-glass'] [role='switch'][aria-checked][data-lg-dragged] > span {\n  transition: none;\n}\n\nhtml[data-lg-style='liquid-glass'] [role='switch'][aria-checked][data-lg-pressing] > span {\n  transform:\n    translateX(calc(var(--lg-switch-travel) * var(--lg-switch-on) + var(--lg-drag-x, var(--lg-press-x, 0px))))\n    scale(var(--lg-press-sx, 1), var(--lg-press-sy, 1));\n  box-shadow:\n    inset 0 calc(var(--lg-dent-drop) * var(--lg-dent-on)) var(--lg-dent-blur) rgb(0 0 0 / calc(var(--lg-dent-darken) * var(--lg-dent-on) * var(--lg-press, 1))),\n    inset 0 0 0 0.5px color-mix(in srgb, var(--lg-edge, #fff) calc(var(--lg-control-hairline) * var(--lg-press, 1)), transparent);\n}\n\n/* ---------------------------------------------------------------------------\n * 7. Skin presets: two arrangements of the same material.\n *\n * A preset is not a second material. It is the same glass in two arrangements\n * Apple shipped two years apart, and every value below is a token this file\n * already had:\n *\n *   Tahoe       macOS 26. The sidebar is a floating glass layer, separated from\n *               the content by its own gutter and carrying its own shadow, and\n *               the material is the one this file has always shipped \u2014 so the\n *               preset is the identity: an unset document and `tahoe` are the\n *               same interface, token for token.\n *   Golden Gate macOS 27. In Apple's own words \"sidebars are no longer floating\n *               and are instead edge-to-edge \u2026 no unnecessary sidebar shadowing\",\n *               framed as *readability*. So the gutter is closed, the panel brings\n *               no corner of its own, the float shadow is gone, and the fill and\n *               frost are deepened \u2014 the refraction keeps working right up to the\n *               boundary with the content instead of stopping a gutter short of it.\n *\n * The two attributes are written by dsh-theme-settings on the root element, the\n * same way the radius row writes its two custom properties, and nothing here\n * knows that plugin exists.\n *\n * What a preset does NOT move is the unified radius: the window's corner and the\n * floating layer's corner are the radius row's to set (`--lg-radius-*`), and a\n * preset that fought that control would make one of the two unusable. So Tahoe's\n * panel is cut from `--lg-radius-panel` \u2014 the value the row writes \u2014 and Golden\n * Gate's is square, because an edge-to-edge pane has no corner of its own: the\n * only corner left on its side of the window is the window's.\n *\n * The fills, frosts and lens shapes below are the dark palette's, and they are\n * palette-independent tokens on purpose: every token the light palette retunes\n * (specular, hairline, sheen, glow, veil, edge, elevation, shadow, translucency)\n * is deliberately absent, so a preset cannot flatten the other palette's rim.\n * ------------------------------------------------------------------------- */\n\n/* Tahoe: the floating glass layer. Every value is this file's own default, so\n * this block documents the arrangement rather than changing it. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset='tahoe'] {\n  /* The float, on each side of the panel's column. */\n  --lg-gap: 12px;\n  --lg-preset-sidebar-radius: var(--lg-radius-panel);\n  /* More show: the panel's own fill stays as thin as it ships, and the lens is the\n   * long one a large pane was always given. */\n  --lg-preset-fill: 22%;\n  --lg-preset-blur: 4px;\n  --lg-preset-band: 36px;\n  --lg-preset-bend: 36px;\n  /* The glass the surfaces that inherit their material wear (an opt-in\n   * `data-lg-surface` and anything else that names no values of its own). */\n  --lg-blur: 4px;\n  --lg-saturate: 180%;\n  --lg-refract-band: 32px;\n  --lg-refract-bend: 30px;\n}\n\n/* Golden Gate: edge-to-edge and unified with the content. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'] {\n  /* The gutter is closed. Both of this token's use sites were written with a\n   * `var()` fallback precisely so that a zero here cannot collapse the layout\n   * silently: the column's padding and the inspector's margin both read it. */\n  --lg-gap: 0px;\n  /* No corner of its own: the panel fills its column and meets the content, so the\n   * only corner on screen is the window's. */\n  --lg-preset-sidebar-radius: 0px;\n  /* Readability, which is Apple's own framing for this arrangement: a denser fill\n   * and a deeper frost, because the pane now sits against content rather than\n   * against a gutter. */\n  --lg-preset-fill: 34%;\n  --lg-preset-blur: 12px;\n  /* The lens runs to the boundary rather than being cut off a gutter short of it,\n   * and is a little shorter than the floating layer's because the content's own\n   * edge is now immediately beside it. */\n  --lg-preset-band: 28px;\n  --lg-preset-bend: 24px;\n  --lg-blur: 10px;\n  /* One standardised, less dramatic material: the backdrop keeps less of its own\n   * saturation, so the pane reads as one surface with the content instead of as a\n   * second, louder one beside it. Saturation is the one material parameter no\n   * palette retunes, which is what makes it the right place for a document-wide\n   * change of character \u2014 and it is baked into a lens, so switching presets\n   * re-dresses every surface that is already on screen. */\n  --lg-saturate: 140%;\n  --lg-refract-band: 26px;\n  --lg-refract-bend: 22px;\n}\n\n/* The transparency axis is Golden Gate's: Apple shipped two fixed presets in\n * 26.1 and one continuous slider in 27, whose default is the middle of the range.\n * Three steps, and they move the fill and the frost only \u2014 a geometric token is\n * never among them, so \u6E05\u6670 and \u52A0\u6D53 are the same pane at two depths rather than\n * two layouts. The middle step is the default. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'][data-lg-transparency='clear'] {\n  --lg-preset-fill: 22%;\n  --lg-preset-blur: 6px;\n}\n\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'][data-lg-transparency='default'] {\n  --lg-preset-fill: 34%;\n  --lg-preset-blur: 12px;\n}\n\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'][data-lg-transparency='tinted'] {\n  --lg-preset-fill: 52%;\n  --lg-preset-blur: 16px;\n}\n\n/* The one consumer of the pair: the sidebar panel, whose own rule above names its\n * tokens as literals (it is the surface the presets are about). Only the tokens\n * the preset owns are re-declared, and each carries the shipped value as its\n * fallback, so an attribute this build does not know leaves the panel exactly as\n * it was rather than resolving a var() to nothing. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset] [data-lg-wide] > [data-slot='sidebar'] > * {\n  --lg-translucency: var(--lg-preset-fill, 22%);\n  --lg-blur: var(--lg-preset-blur, 4px);\n  --lg-refract-band: var(--lg-preset-band, 36px);\n  --lg-refract-bend: var(--lg-preset-bend, 36px);\n  border-radius: var(--lg-preset-sidebar-radius, var(--lg-radius-panel));\n  /* The boundary an eye reads is the one the browser draws: the preset names the radius\n   * through `border-radius` above, and the engine reads that radius and the element's own\n   * computed `corner-shape` when it bakes the lens, so boundary and lens stay one curve.\n   * There is no separate corner token to keep in step. */\n}\n\n/* Golden Gate keeps the rim \u2014 it is the material's own edge \u2014 and gives up the\n * float. The shadow is neutralised through the token the panel's shadow list\n * already ends with rather than by restating the list: the rim above carries the\n * pointer's lift and the room's light direction, and a second copy of it here\n * would be a copy that drifts. A zero-offset, zero-alpha shadow is a valid shadow\n * that paints nothing, which is what \"no unnecessary sidebar shadowing\" has to be\n * in a list that cannot drop one of its terms. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'] [data-lg-wide] > [data-slot='sidebar'] > * {\n  --lg-shadow: 0 0 0 0 rgb(0 0 0 / 0%);\n}\n\n/* The inspector column is the skin's other pane, so the same arrangement applies\n * to it: at a zero gap its gutter is already closed, and it must not keep a\n * rounded corner flush against the window's edge. */\nhtml[data-lg-style='liquid-glass'][data-lg-preset='golden-gate'] section:has([data-slot='sidebar.right.pane.tab']) {\n  border-radius: 0;\n}\n\n/* ---------------------------------------------------------------------------\n * 5b. The corner, defined once.\n *\n * Every corner in this stack is one shape, and this client already declares it\n * \u2014 once, for the whole application:\n *\n *     @supports (corner-shape: superellipse(1.5)) {\n *       :root { --dsw-corner-shape: superellipse(1.5); }\n *       *, ::before, ::after { corner-shape: var(--dsw-corner-shape); }\n *     }\n *\n * `corner-shape` is the modern CSS property (Chrome 139+) that turns a\n * border-radius corner into a *continuous* curve: superellipse(k) is\n * |x/a|^(2k) + |y/b|^(2k) = 1, so the client's k = 1.5 is the exponent n = 3 of the\n * family the material's own distance field uses, and n = 2 is the circular arc\n * `corner-shape: round` (and plain `border-radius`) draws. Measured in this\n * renderer, not taken from the spec: a plain border-radius box follows n = 2.95\u20263.02\n * at its nominal radius (rms 0.08px) where the best circular fit is 4.25px rms and\n * 25% off in radius, and the painted area of its corner is 801px\xB2 against 795\n * predicted at n = 3 and 707 for a circle.\n *\n * So the shape is not this stylesheet's to invent \u2014 it is the shape every surface is\n * *already* cut from. What the skin has to do is stop disagreeing with it, and the\n * disagreement was in the two places that are not border-radius at all:\n *\n *   1. the lens. The refraction map was baked from a circular rounded-rectangle\n *      distance field, so the glass bent as if the corner were round while the box\n *      had left the corner point 0.202\xB7r ago instead of 0.414\xB7r. The map now bakes\n *      the exponent it reads from the surface's own computed `corner-shape`\n *      (displacement.ts, cornerExponentOf) \u2014 one number, read from the declaration\n *      above, so a page that changes its corner shape moves every lens with it;\n *   2. the window frame, which clipped with `inset(0 round \u2026)` \u2014 explicitly round, i.e.\n *      circular, i.e. a different corner from every surface inside it. That one lives\n *      in the shell (src-tauri/src/core/frame.rs), and it now declares the shape\n *      itself (`--dsh-shell-corner-shape`) and clips with a `path()` the frame script\n *      builds from the same token, so the window's edge and every surface inside it are\n *      one curve rather than two.\n *\n * The token is the shell's, and this file reads it rather than declaring a second one:\n * `--lg-corner-shape: var(--dsh-shell-corner-shape, superellipse(1.5))` on the skin's\n * root, guarded by @supports, with the shipped shape as the fallback for a document\n * that has the skin without the frame. One token, so the window and the surfaces\n * cannot drift apart; the fallback keeps the skin's own corners right in a host that\n * never loaded the shell's stylesheet. On an engine without the property nothing is\n * declared, the corners really are circular, and the engine bakes n = 2 to match \u2014 the\n * lens follows the boundary on both, which is the invariant that matters.\n *\n * Nothing else in this file changes: no clip-path, no mask, no stand-down of\n * border-radius. The drawn boundary already follows the shape (the client declares\n * it for every element), and a per-geometry clip or a baked alpha corner mask would\n * have been the two ways to *fight* that \u2014 a clip-path cuts an element's own float\n * shadow off at the box, and a mask from the map's canvas would cut the corner in\n * 512-texel steps (1.6px on an 800px dialog).\n * ------------------------------------------------------------------------- */\n@supports (corner-shape: superellipse(1.5)) {\n  html[data-lg-style='liquid-glass'] {\n    /* The shell's token, not a second copy of its value: the window's corner and every\n     * corner in here are one shape because they are one declaration. The literal is the\n     * fallback for a document that runs the skin without the shell's frame. */\n    --lg-corner-shape: var(--dsh-shell-corner-shape, superellipse(1.5));\n  }\n  /* On the surfaces the skin draws, the shape is named rather than inherited, and it is\n   * named on the *value* the engine bakes from: the engine reads this computed property\n   * off each surface it dresses, so this line and the lens cannot drift apart. */\n  html[data-lg-style='liquid-glass'] :is(\n    [data-composer-card],\n    [role='dialog'][aria-modal='true'],\n    [data-lg-surface],\n    [data-lg-overlay],\n    [data-lg-popover],\n    [data-menu-material],\n    [class*='_material_'],\n    [data-lg-wide] > [data-slot='sidebar'] > *,\n    section:has([data-slot='sidebar.right.pane.tab'])\n  ) {\n    corner-shape: var(--lg-corner-shape, superellipse(1.5));\n  }\n}\n\n/* R468: the pointer light is a page-level overlay (PointerGlow in index.ts), not a per-surface gradient: every surface\n * carries backdrop-filter, and a filter turns its element into the containing block for fixed-attachment backgrounds, so\n * the gradient centre was resolved in the surface's own box and the effect never appeared. */\n\n/* R469 - the edge light, masked to the cursor.\n *\n * A glass surface may only show light on its RIM: the interior never glows (\"\u975E\u8FB9\u7F18\u5730\u533A\u6C38\u4E0D\u53D1\u5149\u624D\u5BF9\"). The paint is an\n * inset hairline plus a 1px top highlight, so it can only ever appear within a pixel of the boundary; a radial mask\n * centred on the pointer (in the surface's own coordinates, written by PointerRimLight) fades it out away from the\n * cursor, so the highlight travels along the edge as the mouse moves instead of lighting the whole rim at once.\n * --lg-near is the proximity weight (1 when the pointer is on the box, 0 one radius away).\n */\n/* inherits: true matters: the values are written on the SURFACE, and the ::after that paints the rim is a child -\n * with inheritance off the pseudo read the initial value (measured: the element carried 394.1px while the mask stayed\n * at -100000px). */\n@property --lg-near { syntax: '<number>'; inherits: true; initial-value: 0; }\n@property --lg-pointer-lx { syntax: '<length>'; inherits: true; initial-value: -100000px; }\n@property --lg-pointer-ly { syntax: '<length>'; inherits: true; initial-value: -100000px; }\n\n/* R474: position LESS, not more. Two selectors were wrong in one rule each, and both were\n * measured live:\n *\n *  - data-lg-overlay is the report flag the engine KEEPS on a popover it classified and then\n *    covers (it also adds data-lg-surface). Forcing position:relative on that element made the\n *    OpenCode Go usage panel flow INSIDE the composer, so the composer grew around it (\"\u8F93\u5165\u6846\n *    \u88AB\u6324\u538B\") and a bottom-anchored menu landed outside the window.\n *  - data-lg-refract is not a surface marker: the engine also writes it on the client's own\n *    popup pane (div._material_, which is position:absolute; inset:0 behind every menu). Forcing\n *    position:relative on it collapsed the pane to height 0, so menus lost their fill and frost\n *    (the reported \"\u6846\u80CC\u666F\u6CA1\u4E86\").\n *\n * What actually needs a containing block for the pointer rim is the flow surfaces: the composer\n * card, a named surface, and the two structural panes. Floating panels keep their own anchoring,\n * and the material pane keeps inset:0. */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [data-lg-surface],\n  [data-lg-wide] > [data-slot='sidebar'] > *,\n  section:has([data-slot='sidebar.right.pane.tab'])\n):not([data-lg-overlay]):not([role='dialog']) {\n  position: relative;\n}\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [data-lg-surface],\n  [role='dialog'][aria-modal='true']\n)::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: inherit;\n  pointer-events: none;\n  z-index: 1;\n  box-shadow:\n    inset 0 0 0 1px rgb(255 255 255 / calc(0.5 * var(--lg-near, 0))),\n    inset 0 1px 0 rgb(255 255 255 / calc(0.72 * var(--lg-near, 0)));\n  -webkit-mask-image: radial-gradient(\n    circle var(--lg-pointer-radius, 220px) at var(--lg-pointer-lx, -100000px) var(--lg-pointer-ly, -100000px),\n    #000 0%,\n    rgb(0 0 0 / 55%) 58%,\n    transparent 82%\n  );\n  mask-image: radial-gradient(\n    circle var(--lg-pointer-radius, 220px) at var(--lg-pointer-lx, -100000px) var(--lg-pointer-ly, -100000px),\n    #000 0%,\n    rgb(0 0 0 / 55%) 58%,\n    transparent 82%\n  );\n}\n\n\n/* R470 - ONE rim, and it is the masked one.\n *\n * The shared surface rules paint a rim from the ROOM light (--lg-light-dx/dy): every edge of every panel glows no matter\n * how far the pointer is - measured on the left sidebar, which kept a lit hairline while the pointer sat in the middle of\n * the conversation. That rim is now multiplied by --lg-near-edge, and every surface the engine has dressed (the\n * [data-lg-refract] attribute) turns that multiplier OFF: its only rim is the ::after band below, masked around the\n * cursor. A larger radius with a smooth falloff is what keeps this from looking like a hard cutoff.\n */\nhtml[data-lg-style='liquid-glass'] [data-lg-refract] {\n  --lg-near-edge: 0;\n}\nhtml[data-lg-style='liquid-glass'] [data-lg-surface] {\n  --lg-near-edge: 0;\n}\n/* The R470 rim's containing block, on the same explicit surface list as the block above: never\n * data-lg-refract (it marks the client's popup material pane too), never an overlay, never a\n * dialog. See that block's note for the two measured failures this avoids. */\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [data-lg-surface],\n  [data-lg-wide] > [data-slot='sidebar'] > *,\n  section:has([data-slot='sidebar.right.pane.tab'])\n):not([data-lg-overlay]):not([role='dialog']) {\n  position: relative;\n}\nhtml[data-lg-style='liquid-glass'] :is(\n  [data-composer-card],\n  [data-lg-surface],\n  [data-lg-refract],\n  [role='dialog'][aria-modal='true']\n)::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  border-radius: inherit;\n  pointer-events: none;\n  z-index: 1;\n  box-shadow:\n    inset 0 0 0 1px rgb(255 255 255 / calc(0.55 * var(--lg-near, 0))),\n    inset 0 1px 0 rgb(255 255 255 / calc(0.8 * var(--lg-near, 0)));\n  -webkit-mask-image: radial-gradient(\n    circle var(--lg-pointer-radius, 520px) at var(--lg-pointer-lx, -100000px) var(--lg-pointer-ly, -100000px),\n    #000 0%,\n    rgb(0 0 0 / 82%) 30%,\n    rgb(0 0 0 / 45%) 62%,\n    transparent 100%\n  );\n  mask-image: radial-gradient(\n    circle var(--lg-pointer-radius, 520px) at var(--lg-pointer-lx, -100000px) var(--lg-pointer-ly, -100000px),\n    #000 0%,\n    rgb(0 0 0 / 82%) 30%,\n    rgb(0 0 0 / 45%) 62%,\n    transparent 100%\n  );\n}\n\n";

// plugins/dsh-liquid-glass/src/client/displacement.ts
var CORNER_EXPONENT = 3;
var MAP_MAX = 512;
var MAP_MIN = 16;
var RIM_LINE_WIDTH = 1.6;
function exponentOf(geometry) {
  const exponent = geometry.exponent;
  return Number.isFinite(exponent) && exponent >= 2 ? exponent : CORNER_EXPONENT;
}
function cornerRadiusOf(geometry) {
  return Math.max(0, Math.min(geometry.radius, Math.min(geometry.width, geometry.height) / 2));
}
function shapeDistance(x, y, width, height, radius, exponent = CORNER_EXPONENT) {
  const halfWidth = Math.max(0, width / 2 - radius);
  const halfHeight = Math.max(0, height / 2 - radius);
  const qx = Math.abs(x - width / 2) - halfWidth;
  const qy = Math.abs(y - height / 2) - halfHeight;
  if (exponent === 2 || radius <= 0 || qx <= 0 || qy <= 0) {
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return outside + Math.min(Math.max(qx, qy), 0) - radius;
  }
  const length = Math.hypot(qx, qy);
  const longest = Math.max(qx, qy);
  const ratio = Math.min(qx, qy) / longest;
  const norm = longest * Math.pow(1 + Math.pow(ratio, exponent), 1 / exponent);
  return length * (1 - radius / norm);
}
function cornerExponentOf(value) {
  const text = value.trim().toLowerCase();
  const superellipse = /superellipse\(\s*([0-9.]+)\s*\)/.exec(text);
  if (superellipse !== null) {
    const k = Number.parseFloat(superellipse[1]);
    if (Number.isFinite(k) && k > 0) return Math.max(2, 2 * k);
  }
  if (text === "squircle") return 4;
  return 2;
}
function buildDisplacementMap(geometry) {
  if (typeof document === "undefined") return { url: "", width: 0, height: 0 };
  const { width, height, band } = geometry;
  const exponent = exponentOf(geometry);
  const radius = cornerRadiusOf(geometry);
  const longest = Math.max(width, height);
  const columns = Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round(width / longest * MAP_MAX)));
  const rows = Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round(height / longest * MAP_MAX)));
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  if (context === null) return { url: "", width: 0, height: 0 };
  const image = context.createImageData(columns, rows);
  const data = image.data;
  const step1 = longest / Math.max(columns, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns * width;
      const y = (row + 0.5) / rows * height;
      const distance = shapeDistance(x, y, width, height, radius, exponent);
      const into = Math.max(0, Math.min(1, 1 + distance / band));
      const eased = into * into * (3 - 2 * into);
      const edgeFade = Math.min(1, Math.max(0, -distance) / step1);
      const amount = eased * edgeFade;
      const dx = shapeDistance(x + step1, y, width, height, radius, exponent) - shapeDistance(x - step1, y, width, height, radius, exponent);
      const dy = shapeDistance(x, y + step1, width, height, radius, exponent) - shapeDistance(x, y - step1, width, height, radius, exponent);
      const length = Math.hypot(dx, dy) || 1;
      const normalX = dx / length;
      const normalY = dy / length;
      const pixel = (row * columns + column) * 4;
      const line = Math.max(0, Math.min(1, (RIM_LINE_WIDTH - Math.abs(distance)) / RIM_LINE_WIDTH));
      data[pixel] = Math.round((0.5 - normalX * amount * 0.5) * 255);
      data[pixel + 1] = Math.round((0.5 - normalY * amount * 0.5) * 255);
      data[pixel + 2] = Math.round(line * 255);
      data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL("image/png"), width: columns, height: rows };
}

// plugins/dsh-liquid-glass/src/client/index.ts
var STYLE_ATTRIBUTE = "data-lg-style";
var OFFICIAL_STYLE_ID = "official";
var REFRACTION_FILTER_ID = "dsh-lg-refract";
var REFRACTION_PROPERTY = "--lg-refraction";
var CORNER_SHAPE_PROPERTY = "corner-shape";
var CORNER_EXPONENT_PROPERTY = "--lg-corner-exponent";
var CORNER_NOMINAL_PROPERTY = "--lg-corner-nominal";
var LIGHT_PROPERTY = "--lg-light-a";
var POINTER_X_PROPERTY = "--lg-pointer-x";
var SURFACE_SELECTOR = '[data-composer-card],[data-lg-surface],[data-lg-refract],[role="dialog"][aria-modal="true"]';
var POINTER_Y_PROPERTY = "--lg-pointer-y";
var LIGHT_DEADBAND = 0.2;
var REFRACTION_BAND = 24;
var REFRACTION_BEND = 16;
var REFRACTION_CHROMA = 0.06;
var REFRACTION_QUANTUM = 8;
var REFRACTION_CACHE = 24;
var REFRACTION_MAP_CACHE = 24;
var REFRACTION_FIT_SLACK = 0.5;
var REFRACTION_HOLD_MS = 120;
var LENS_REVISION = "4";
var REFRACTING_SURFACES = [
  "[data-composer-card]",
  '[role="dialog"][aria-modal="true"]',
  "[data-lg-surface]",
  // The client's own popup material, which the stylesheet materialises with its own rule.
  '[class*="_material_"]',
  '[data-lg-wide] > [data-slot="sidebar"] > *',
  'section:has([data-slot="sidebar.right.pane.tab"])'
].join(", ");
var PLUGIN_ID = "dsh-liquid-glass";
var OFFICIAL_STYLE = {
  id: OFFICIAL_STYLE_ID,
  label: () => OFFICIAL_STYLE_ID,
  css: "",
  refraction: false
};
var LiquidGlassRuntime = class {
  ctx;
  styles = [OFFICIAL_STYLE];
  styleId = OFFICIAL_STYLE_ID;
  snapshot;
  styleTag;
  vault;
  mountedId;
  /**
   * @param ctx - owning plugin context; teardown is registered through it.
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.snapshot = this.buildSnapshot();
    ctx.effect(() => () => {
      this.unmount();
    }, "dsh-liquid-glass: material teardown");
  }
  /**
   * Read the current material state.
   * @returns the current snapshot, stable until the next change.
   */
  getSnapshot() {
    return this.snapshot;
  }
  /**
   * Register one style. The first registrant of an id owns it.
   * @param input - id, localized label, stylesheet, and whether it refracts.
   * @returns the disposer removing the style; disposing the active style falls
   * back to the official material.
   */
  register(input) {
    if (this.styles.some((style) => style.id === input.id)) {
      throw new Error(`liquid glass style "${input.id}" is already registered`);
    }
    const definition = { ...input, refraction: input.refraction ?? false };
    this.styles = [...this.styles, definition];
    if (definition.id === this.styleId) this.mount();
    this.publish();
    return () => {
      if (!this.styles.some((style) => style.id === definition.id)) return;
      this.styles = this.styles.filter((style) => style.id !== definition.id);
      if (this.styleId === definition.id) {
        this.styleId = OFFICIAL_STYLE_ID;
        this.mount();
      }
      this.publish();
    };
  }
  /**
   * Switch the active style — the only material write entry.
   * @param id - a registered style id; unknown ids throw.
   */
  setStyle(id) {
    if (!this.styles.some((style) => style.id === id)) {
      throw new Error(`liquid glass style "${id}" is not registered`);
    }
    if (this.styleId === id) return;
    this.styleId = id;
    this.mount();
    this.publish();
  }
  publish() {
    this.snapshot = this.buildSnapshot();
    this.ctx.emit("liquid-glass/change", this.snapshot);
  }
  buildSnapshot() {
    return Object.freeze({
      styleId: this.styleId,
      styles: Object.freeze(this.styles.map((style) => Object.freeze({ id: style.id, label: style.label })))
    });
  }
  /**
   * Bring the document in line with the active style: the attribute, the
   * stylesheet, and the refraction filter. Runs on every style write and on
   * registration of the active style, and is idempotent.
   */
  mount() {
    if (typeof document === "undefined") return;
    const active = this.styles.find((style) => style.id === this.styleId);
    if (active === void 0) return;
    document.documentElement.setAttribute(STYLE_ATTRIBUTE, active.id);
    document.documentElement.style.setProperty(CORNER_EXPONENT_PROPERTY, String(CORNER_EXPONENT));
    this.mountedId = active.id;
    this.unmountAssets();
    if (active.css !== "") {
      const tag = document.createElement("style");
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = `${PLUGIN_ID}/${active.id}`;
      tag.textContent = active.css;
      document.head.appendChild(tag);
      this.styleTag = tag;
    }
    if (active.refraction) {
      this.vault = new RefractionVault();
      this.vault.dressAll();
    }
  }
  /**
   * Dress every refracting surface for its current geometry.
   *
   * Called from the layout sweep rather than from the style's mount: a surface's filter
   * belongs to the shape it currently has, and shapes change — the composer grows as it is
   * typed into, the sidebar column animates, a dialog opens at whatever size the client
   * chose. Doing nothing without a vault is deliberate: the official style refracts
   * nothing, so it dresses nothing.
   */
  dressRefractingSurfaces() {
    this.vault?.dressAll();
  }
  /**
   * Pass the pointer light's own write on to the active vault, so its token mutation is not read
   * as a surface whose shape moved. Does nothing without a vault: the official style refracts
   * nothing, and nothing of the material reads the light either.
   * @param styleText - the document element's inline style text right after the write.
   */
  noteLightWrite(styleText) {
    this.vault?.noteLightWrite(styleText);
  }
  unmount() {
    if (typeof document === "undefined") return;
    document.documentElement.removeAttribute(STYLE_ATTRIBUTE);
    this.unmountAssets();
  }
  unmountAssets() {
    this.styleTag?.remove();
    this.styleTag = void 0;
    this.vault?.destroy();
    this.vault = void 0;
    this.mountedId = void 0;
  }
};
function fitsLens(baked, box, tolerance) {
  return Math.abs(baked.width - box.width) <= tolerance && Math.abs(baked.height - box.height) <= tolerance;
}
function lensSignature(corner, band, exponent) {
  return `${Math.max(0, Math.round(corner * 2) / 2)}/${band}/${exponent}`;
}
function backgroundAlpha(value) {
  const open = value.indexOf("(");
  if (open < 0) return 1;
  const parts = value.slice(open + 1, value.lastIndexOf(")")).split(/[,s/]+/).filter((piece) => piece.length > 0);
  const alpha = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;
  return Number.isFinite(alpha) ? alpha : 1;
}
function styleNumber(style, name, fallback) {
  const parsed = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}
var RefractionVault = class {
  entries = /* @__PURE__ */ new Map();
  /**
   * The rasters, keyed by the surface's shape alone: the box, the corner radius and the band.
   *
   * Nothing an optics value can change appears in this key and nothing else can change the map, so
   * every optics tuple over one shape shares one raster.
   */
  maps = /* @__PURE__ */ new Map();
  /** Maps whose image has decoded, so handing one over cannot draw nothing. */
  decoded = /* @__PURE__ */ new Set();
  /** Maps currently decoding, so one burst of surfaces shares a single decode. */
  decoding = /* @__PURE__ */ new Map();
  /** The one observer every dressed surface is registered with. */
  watcher;
  /** Surfaces whose box changed, waiting for this frame's single re-dress. */
  pending = /* @__PURE__ */ new Set();
  /**
   * What the resize path has seen of each surface: when its box last changed, and how many
   * changes in a row.
   *
   * One change is a resize and is dressed exactly, on the spot. A second change inside the hold
   * window means the box is still moving, so the surface tracks its box from the cache instead —
   * one raster per quantisation cell of travel rather than one per frame. The record is what makes
   * that decision, and every writer of a lens reads it, so a sweep that happens to land mid-
   * animation cannot make the surface bake for the box it is passing through.
   */
  seen = /* @__PURE__ */ new Map();
  /**
   * The corner and band each dressed surface was last dressed for.
   *
   * This map is also the set the radius path re-reads: every surface the vault has ever dressed is
   * in it, and one that has left the document is dropped from it in the same pass, so the set
   * cannot grow with the menus a session opens and closes.
   */
  worn = /* @__PURE__ */ new Map();
  /** What re-reads the corners: a radius is not a box, so no `ResizeObserver` reports it moving. */
  tokenWatch;
  /** Frame handle for that pass; nothing schedules one when nothing changed. */
  pendingFrame;
  host;
  serial = 0;
  constructor() {
    this.watchTokens();
  }
  /**
   * Watch the two places a radius token can move: the document element, which carries the skin's
   * tokens inline (the theme control writes them there, and so does the shell's own frame), and the
   * head, where a stylesheet that redefines them is mounted.
   *
   * The callback re-reads a computed corner per dressed surface and schedules a pass only when one
   * of them differs from the corner its lens was baked for, so a mutation that moved no geometry
   * costs a style read and arms no frame of its own.
   */
  watchTokens() {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    this.tokenWatch = new MutationObserver(() => {
      this.onTokenMutation();
    });
    const hosts = [document.documentElement, document.body];
    for (const host of hosts) {
      if (host !== null) this.tokenWatch.observe(host, { attributes: true, attributeFilter: ["style", "class", "data-ds-dark-theme"] });
    }
    if (document.head !== null) this.tokenWatch.observe(document.head, { childList: true, subtree: true, characterData: true });
  }
  /**
   * The document element's inline style text the light writer last left there, or undefined when
   * the last style mutation was not the light's.
   *
   * The pointer light rewrites one custom property on the document element every frame it moves,
   * and a style mutation on `html` is also how the theme's radius control and the shell's own
   * frame arrive — so the cheap discriminator runs first, and the full pass below only runs when
   * the document element's inline style is not the string the light wrote. While the pointer
   * moves, that is one string comparison per frame instead of a computed corner per dressed
   * surface, which is what keeps a moving pointer off the lens path entirely.
   */
  lightWrite;
  /**
   * Record the light's own write, so its next mutation is recognised as its own.
   * @param styleText - the document element's inline style text right after the write.
   */
  noteLightWrite(styleText) {
    this.lightWrite = styleText;
  }
  /** One token mutation: the light's own writes are not a geometry change, everything else is. */
  onTokenMutation() {
    if (this.lightWrite !== void 0 && document.documentElement.getAttribute("style") === this.lightWrite) return;
    this.lightWrite = void 0;
    this.redressForShape();
  }
  /**
   * Re-dress the surfaces whose corner or band is no longer the one their lens was baked for.
   *
   * Read-only until something differs: a corner comes out of the computed style, which costs no
   * layout, so this cannot turn an unrelated mutation into a bake. The surfaces that did move are
   * handed to the same one-pass-per-frame path a resize uses.
   */
  redressForShape() {
    for (const [element, signature] of [...this.worn]) {
      if (!element.isConnected) {
        this.worn.delete(element);
        continue;
      }
      if (this.signatureOf(getComputedStyle(element)) !== signature) this.pending.add(element);
    }
    this.schedule();
  }
  /**
   * The corner and band a surface is cut at *now*.
   *
   * The corner is the nominal radius the stylesheet names, because a shaped surface's own
   * `border-radius` has stood down to zero; a surface that names none — the client's dialog — falls
   * back to the radius it was first dressed at, and only a surface that has never been dressed falls
   * back to its computed `border-radius`. Reading this costs no layout, which is what keeps the
   * token watch read-only until something actually differs.
   * @param element - the surface.
   * @param style - its computed style.
   * @returns the signature compared against {@link worn}.
   */
  signatureOf(style) {
    return lensSignature(
      Number.parseFloat(style.borderTopLeftRadius) || 0,
      styleNumber(style, "--lg-refract-band", REFRACTION_BAND),
      cornerExponentOf(style.getPropertyValue(CORNER_SHAPE_PROPERTY))
    );
  }
  /** Ensure every refracting surface in the document wears a lens of its own shape. */
  dressAll() {
    if (typeof document === "undefined") return;
    for (const element of document.querySelectorAll(REFRACTING_SURFACES)) this.dress(element);
  }
  /** Ensure one surface wears a lens of its current shape and parameters. */
  dress(element) {
    this.dressElement(element);
  }
  /**
   * Ensure one surface wears a lens for the box it has now.
   *
   * @param element - the surface to dress.
   */
  dressElement(element) {
    const box = element.getBoundingClientRect();
    if (box.width < 12 || box.height < 12) return;
    const style = getComputedStyle(element);
    const band = styleNumber(style, "--lg-refract-band", REFRACTION_BAND);
    const bend = styleNumber(style, "--lg-refract-bend", REFRACTION_BEND);
    const chroma = styleNumber(style, "--lg-refract-chroma", REFRACTION_CHROMA);
    const blur = styleNumber(style, "--lg-blur", 0);
    const saturate = styleNumber(style, "--lg-saturate", 100) / 100;
    const radius = Math.min(Number.parseFloat(style.borderTopLeftRadius) || 0, Math.min(box.width, box.height) / 2);
    const exponent = cornerExponentOf(style.getPropertyValue(CORNER_SHAPE_PROPERTY));
    this.worn.set(element, lensSignature(radius, band, exponent));
    const quantise = (value2) => Math.max(REFRACTION_QUANTUM, Math.round(value2 / REFRACTION_QUANTUM) * REFRACTION_QUANTUM);
    const geometry = {
      width: box.width,
      height: box.height,
      radius: Math.max(0, Math.round(radius * 2) / 2),
      band,
      exponent
    };
    const shape = `${quantise(box.width)}x${quantise(box.height)}r${Math.round(radius * 2) / 2}b${band}`;
    const key = `${shape}q${bend}c${chroma}f${blur}s${saturate}`;
    const record = this.seen.get(element);
    const tolerance = record !== void 0 && record.burst > 1 && performance.now() - record.at <= REFRACTION_HOLD_MS ? REFRACTION_QUANTUM : REFRACTION_FIT_SLACK;
    const map = this.mapFor(shape, geometry, tolerance);
    const nominalLabel = `${geometry.radius}px`;
    if (element.style.getPropertyValue(CORNER_NOMINAL_PROPERTY) !== nominalLabel) element.style.setProperty(CORNER_NOMINAL_PROPERTY, nominalLabel);
    const exponentLabel = String(exponent);
    if (element.style.getPropertyValue(CORNER_EXPONENT_PROPERTY) !== exponentLabel) element.style.setProperty(CORNER_EXPONENT_PROPERTY, exponentLabel);
    let entry = this.entries.get(key);
    if (entry === void 0 || entry.map !== map) {
      entry = this.buildFilter(geometry, map, bend, chroma, blur, saturate);
      this.entries.set(key, entry);
      while (this.entries.size > REFRACTION_CACHE) {
        const oldest = this.entries.keys().next();
        if (oldest.done === true) break;
        this.entries.delete(oldest.value);
      }
    }
    const value = `url(#${entry.id})`;
    if (element.hasAttribute("data-lg-refract") === false) element.dataset.lgRefract = "";
    if (entry.map.url === "" || this.decoded.has(entry.map.url)) {
      if (element.style.getPropertyValue(REFRACTION_PROPERTY) !== value) element.style.setProperty(REFRACTION_PROPERTY, value);
      this.watch(element);
      return;
    }
    if (!this.decoding.has(entry.map.url)) {
      const probe = new Image();
      probe.src = entry.map.url;
      const ready = typeof probe.decode === "function" ? probe.decode().catch(() => void 0) : Promise.resolve();
      this.decoding.set(entry.map.url, ready.then(() => {
        this.decoded.add(entry.map.url);
        this.decoding.delete(entry.map.url);
      }));
    }
    void this.decoding.get(entry.map.url)?.then(() => {
      if (!element.isConnected) return;
      if (element.style.getPropertyValue(REFRACTION_PROPERTY) !== value) element.style.setProperty(REFRACTION_PROPERTY, value);
    });
    this.watch(element);
  }
  /**
   * Register a dressed surface with the one observer, so a box that changes later re-dresses it.
   *
   * Called from {@link dress} rather than from a sweep of its own: every surface the vault has
   * ever dressed is exactly the set whose box a lens belongs to, and an element that has left
   * the document is unobserved by the callback below, so the observer's own size is the size of
   * the material on screen.
   * @param element - the surface just dressed.
   */
  watch(element) {
    if (typeof ResizeObserver === "undefined") return;
    if (this.watcher === void 0) this.watcher = new ResizeObserver((entries) => {
      this.onResize(entries);
    });
    this.watcher.observe(element);
  }
  /**
   * Collect the surfaces whose box changed, and re-dress them once, on the next frame.
   *
   * A resize callback runs inside the same rendering update as the frame's animation callbacks
   * and before the paint, so a surface marked here is dressed again in the frame its box changed.
   * The set is what makes this one pass per frame rather than one per record — a layout animation
   * that moves a box on every frame collapses into a single pass for that frame — and nothing
   * schedules a frame while the set is empty, so this adds no loop of its own: the observer
   * callback is the only new trigger.
   * @param entries - the boxes that changed since the last pass.
   */
  onResize(entries) {
    for (const entry of entries) {
      const element = entry.target;
      if (!element.isConnected) {
        this.watcher?.unobserve(element);
        continue;
      }
      this.pending.add(element);
    }
    this.schedule();
  }
  /** Arm one pass for the next frame, while there is anything left for it to do. */
  schedule() {
    if (this.pendingFrame !== void 0) return;
    if (this.pending.size === 0 && this.seen.size === 0) return;
    if (typeof requestAnimationFrame !== "function") {
      this.flushPending();
      return;
    }
    this.pendingFrame = requestAnimationFrame(() => {
      this.pendingFrame = void 0;
      this.flushPending();
    });
  }
  /**
   * One pass over the surfaces whose box changed, and over those that have stopped changing.
   *
   * A surface that reports a box on two consecutive passes is mid-animation and holds the lens it
   * wears; one whose box moved and then stopped is dressed for the box it has. The pass re-arms
   * itself only while something is still moving, so a resize that has settled costs one bake —
   * for its settled box — and leaves no frame loop behind.
   */
  flushPending() {
    const reported = [...this.pending];
    this.pending.clear();
    const now = performance.now();
    const seenNow = /* @__PURE__ */ new Set();
    for (const element of reported) {
      if (!element.isConnected) {
        this.watcher?.unobserve(element);
        this.seen.delete(element);
        continue;
      }
      const previous = this.seen.get(element);
      this.seen.set(element, previous !== void 0 && now - previous.at <= REFRACTION_HOLD_MS ? { at: now, burst: previous.burst + 1 } : { at: now, burst: 1 });
      seenNow.add(element);
      this.dressElement(element);
    }
    for (const [element, record] of [...this.seen]) {
      if (seenNow.has(element) || now - record.at <= REFRACTION_HOLD_MS) continue;
      this.seen.delete(element);
      if (!element.isConnected) {
        this.watcher?.unobserve(element);
        continue;
      }
      this.dressElement(element);
    }
    this.schedule();
  }
  /** The `<defs>` every filter and map image is appended to, created on first use. */
  defsHost() {
    return this.host?.firstElementChild ?? void 0;
  }
  /** Remove every lens, and every trace of one from the surfaces that wore it. */
  destroy() {
    if (typeof document === "undefined") return;
    for (const element of document.querySelectorAll("[data-lg-refract]")) {
      delete element.dataset.lgRefract;
      element.style.removeProperty(REFRACTION_PROPERTY);
      element.style.removeProperty(CORNER_NOMINAL_PROPERTY);
      element.style.removeProperty(CORNER_EXPONENT_PROPERTY);
    }
    this.host?.remove();
    this.host = void 0;
    this.entries.clear();
    this.maps.clear();
    this.pending.clear();
    this.seen.clear();
    this.worn.clear();
    this.tokenWatch?.disconnect();
    this.tokenWatch = void 0;
    if (this.pendingFrame !== void 0) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.pendingFrame);
      this.pendingFrame = void 0;
    }
    this.watcher?.disconnect();
    this.watcher = void 0;
  }
  /**
   * The raster for one shape, baked once and shared by every optics tuple placed over it.
   *
   * The map is a function of the box, the corner radius and the band — the displacement profile
   * reads nothing else — so an optics change reuses the map it already has, and only a box the
   * cached raster no longer fits is baked again.
   * @param key - the shape's cache key, which carries no optics.
   * @param geometry - the box to bake for, when a bake is needed.
   * @param tolerance - how far the cached raster may be from this box and still fit it.
   * @returns the raster, cached or freshly baked.
   */
  mapFor(key, geometry, tolerance) {
    const existing = this.maps.get(key);
    if (existing !== void 0 && fitsLens(existing.geometry, geometry, tolerance)) return existing;
    const map = { url: buildDisplacementMap(geometry).url, geometry };
    this.maps.set(key, map);
    while (this.maps.size > REFRACTION_MAP_CACHE) {
      let dropped = false;
      for (const [candidate, value] of this.maps) {
        if (value === map || this.filterUses(value)) continue;
        this.maps.delete(candidate);
        dropped = true;
        break;
      }
      if (!dropped) break;
    }
    return map;
  }
  /** Whether a live filter still samples one raster. */
  filterUses(map) {
    for (const entry of this.entries.values()) if (entry.map === map) return true;
    return false;
  }
  /**
   * Build one lens filter: the graph that bends the backdrop with this shape's raster.
   *
   * The graph bends the backdrop three times, once per channel, by slightly different
   * amounts — the fringing that gives a thick pane away, and the one cue a blurred
   * backdrop cannot imitate. Its *centre* is left untouched: the map's blue channel is the
   * bend's magnitude, which is what the graph reads to build the rim's mask, so the bend
   * and the fringe both stop where the pane stops bending and the flat middle is the
   * backdrop the rest of the material was tuned against.
   */
  buildFilter(geometry, map, bend, chroma, blur, saturate) {
    const ns = "http://www.w3.org/2000/svg";
    if (this.host === void 0) {
      const host = document.createElementNS(ns, "svg");
      host.setAttribute("width", "0");
      host.setAttribute("height", "0");
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("data-plugin", PLUGIN_ID);
      host.setAttribute("data-lg-lens-revision", LENS_REVISION);
      host.style.position = "fixed";
      host.style.pointerEvents = "none";
      const defs = document.createElementNS(ns, "defs");
      host.appendChild(defs);
      document.body.appendChild(host);
      this.host = host;
    }
    const id = `${REFRACTION_FILTER_ID}-${this.serial += 1}`;
    const filter = document.createElementNS(ns, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("x", "0%");
    filter.setAttribute("y", "0%");
    filter.setAttribute("width", "100%");
    filter.setAttribute("height", "100%");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    const round = (value) => Math.round(value * 100) / 100;
    const make = (tag, attributes) => {
      const node = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      return node;
    };
    const xlink = "http://www.w3.org/1999/xlink";
    const channel = (from, into, colour) => `<feColorMatrix in="${from}" type="matrix" values="${colour === 0 ? 1 : 0} 0 0 0 0  0 ${colour === 1 ? 1 : 0} 0 0 0  0 0 ${colour === 2 ? 1 : 0} 0 0  0 0 0 1 0" result="${into}"/>`;
    if (map.url !== "") {
      const primitives = [
        /* The frost and the colour are stages of *this* filter, not functions beside it in the
         * CSS declaration. That is not tidiness: on the surface the browser renders, a
         * `backdrop-filter` whose list is `blur() saturate() url(#…)` applies the two CSS
         * functions and silently ignores the filter, so the lens never ran — while the same
         * filter as `url(#…)` alone moves the backdrop. Measured on the composer card, one
         * region, toggling one declaration: `url(#flatMapShift)` alone changes the pixels,
         * the identical url inside the chain does not. */
        ["feGaussianBlur", { in: "SourceGraphic", stdDeviation: `${round(Math.max(0, blur) / 2)}`, result: "frost" }],
        ["feColorMatrix", { in: "frost", type: "saturate", values: `${round(saturate)}`, result: "tinted" }],
        ["feImage", { href: map.url, x: "0", y: "0", width: `${round(geometry.width)}`, height: `${round(geometry.height)}`, preserveAspectRatio: "none", result: "map" }],
        ["feDisplacementMap", { in: "tinted", in2: "map", scale: `${round(bend * (1 + chroma))}`, xChannelSelector: "R", yChannelSelector: "G", result: "bentRed" }],
        ["feDisplacementMap", { in: "tinted", in2: "map", scale: `${round(bend)}`, xChannelSelector: "R", yChannelSelector: "G", result: "bentGreen" }],
        ["feDisplacementMap", { in: "tinted", in2: "map", scale: `${round(bend * (1 - chroma))}`, xChannelSelector: "R", yChannelSelector: "G", result: "bentBlue" }],
        ["feColorMatrix", { in: "bentRed", type: "matrix", values: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "redChannel" }],
        ["feColorMatrix", { in: "bentGreen", type: "matrix", values: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "greenChannel" }],
        ["feColorMatrix", { in: "bentBlue", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0", result: "blueChannel" }],
        ["feBlend", { in: "greenChannel", in2: "blueChannel", mode: "screen", result: "cyanChannel" }],
        ["feBlend", { in: "redChannel", in2: "cyanChannel", mode: "screen", result: "bent" }]
        /* The bent glass is the whole output, and the edge highlight is *not* in this filter.
         *
         * It used to be: a line read from the map's edge channel and screened on top. The
         * problem is resolution. The map is raster — 512 texels across a 774px card is about
         * 1.5px per texel, so a 28px corner spans roughly eighteen texels, and a highlight
         * traced through it is visibly stepped however finely it is baked. A stylesheet can
         * draw the same line vectorially with an inset ring, which follows any radius exactly
         * at any size, and the material already had one. So the filter keeps what only a filter
         * can do — bend the backdrop — and the rim comes from the surface's own inset ring. */
      ];
      for (const [tag, attributes] of primitives) {
        const node = make(tag, attributes);
        if (tag === "feImage") node.setAttributeNS(xlink, "xlink:href", map.url);
        filter.appendChild(node);
      }
    }
    this.host.firstElementChild?.appendChild(filter);
    return { id, map };
  }
};
var SWEEP_DELAY_MS = 400;
var SQUARE_MAX_EDGE = 48;
var SEAT_FLAG = "lgSeat";
var SEAT_LIP_PROPERTY = "--lg-composer-lip";
var MENU_SURFACES = '[role="menu"], [data-menu-material]';
var MENU_ROWS = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
var MENU_INSET_PROPERTY = "--lg-menu-inset";
var MODAL_DIALOGS = '[role="dialog"][aria-modal="true"]';
var DIALOG_CONTROLS = "button, a[href], input, select, textarea";
var DIALOG_INSET_PROPERTY = "--lg-dialog-inset";
var DIALOG_INSET_FLAG = "lgDialogInset";
var DIALOG_RING_MAX = 20;
var SIDEBAR_WIDE_MIN = 120;
var OVERLAY_FLAG = "lgOverlay";
var CLIENT_GLASS_FLAG = "lgClientGlass";
function insideCoveredSurface(node, box) {
  const host = node.parentElement?.closest(COVERED_SURFACES) ?? null;
  if (host === null) return false;
  const outer = host.getBoundingClientRect();
  const slack = 1;
  return box.left >= outer.left - slack && box.right <= outer.right + slack && box.top >= outer.top - slack && box.bottom <= outer.bottom + slack;
}
var OVERLAY_MIN_WIDTH = 140;
var OVERLAY_MIN_HEIGHT = 100;
var OVERLAY_MIN_ALPHA = 0.3;
function escapesItsSurface(node, box) {
  const host = node.parentElement?.closest(COVERED_SURFACES) ?? null;
  if (host === null) return false;
  const outer = host.getBoundingClientRect();
  const slack = 1;
  return box.left < outer.left - slack || box.right > outer.right + slack || box.top < outer.top - slack || box.bottom > outer.bottom + slack;
}
var COVERED_SURFACES = [
  "[data-composer-card]",
  '[data-slot="sidebar"]',
  '[role="dialog"][aria-modal="true"]',
  "[data-lg-surface]",
  '[class*="_material_"]',
  '[class*="scrollBody"]'
].join(", ");
var PointerRimLight = class {
  /** Events seen, frames run, surfaces written, readable from a probe. */
  counters = { moves: 0, frames: 0, surfaces: 0 };
  frame;
  x = 0;
  y = 0;
  onMove = (event) => {
    this.counters.moves += 1;
    this.x = event.clientX;
    this.y = event.clientY;
    if (this.frame === void 0) this.frame = requestAnimationFrame(this.flush);
  };
  flush = () => {
    this.frame = void 0;
    this.counters.frames += 1;
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE);
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) return;
    if (typeof document === "undefined") return;
    const surfaces = document.querySelectorAll(SURFACE_SELECTOR);
    const radius = 220;
    for (const surface of surfaces) {
      const rect = surface.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (rect.bottom < -radius || rect.top > window.innerHeight + radius || rect.right < -radius || rect.left > window.innerWidth + radius) continue;
      const localX = this.x - rect.left;
      const localY = this.y - rect.top;
      const dx = Math.max(0, -localX, localX - rect.width);
      const dy = Math.max(0, -localY, localY - rect.height);
      const distance = Math.hypot(dx, dy);
      const near = Math.max(0, Math.min(1, 1 - distance / radius));
      surface.style.setProperty("--lg-pointer-lx", localX.toFixed(1) + "px");
      surface.style.setProperty("--lg-pointer-ly", localY.toFixed(1) + "px");
      surface.style.setProperty("--lg-near", near.toFixed(3));
      this.counters.surfaces += 1;
    }
  };
  /** Follow the pointer for as long as the plugin is applied. */
  install() {
    if (typeof window === "undefined") return () => {
    };
    window.addEventListener("pointermove", this.onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", this.onMove);
      if (this.frame !== void 0) cancelAnimationFrame(this.frame);
    };
  }
};
var PointerLight = class {
  /**
   * @param note - told the document element's inline style text after each write, so the vault can
   *   tell the light's own writes from a style change that moved a geometry.
   */
  constructor(note) {
    this.note = note;
  }
  /** What the pointer cost, readable from a probe: events seen, frames run, properties written. */
  counters = { moves: 0, frames: 0, writes: 0, skipped: 0, disabled: 0 };
  frame;
  x = 0;
  y = 0;
  written;
  /** Last coordinates actually written as the pointer position (R467). */
  pointerX;
  pointerY;
  onMove = (event) => {
    this.counters.moves += 1;
    this.x = event.clientX;
    this.y = event.clientY;
    if (this.frame === void 0) this.frame = requestAnimationFrame(this.flush);
  };
  flush = () => {
    this.frame = void 0;
    this.counters.frames += 1;
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE);
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) {
      this.counters.disabled += 1;
      return;
    }
    if (this.pointerX === void 0 || Math.abs(this.x - this.pointerX) >= 1 || this.pointerY === void 0 || Math.abs(this.y - (this.pointerY ?? 0)) >= 1) {
      this.pointerX = this.x;
      this.pointerY = this.y;
      document.documentElement.style.setProperty(POINTER_X_PROPERTY, this.x + "px");
      document.documentElement.style.setProperty(POINTER_Y_PROPERTY, this.y + "px");
      this.counters.writes += 1;
    }
    const angle = Math.atan2(this.x - window.innerWidth / 2, window.innerHeight / 2 - this.y) * 180 / Math.PI;
    if (this.written !== void 0 && Math.abs(angle - this.written) < LIGHT_DEADBAND) {
      this.counters.skipped += 1;
      return;
    }
    this.written = angle;
    document.documentElement.style.setProperty(LIGHT_PROPERTY, `${Math.round(angle * 100) / 100}deg`);
    this.counters.writes += 1;
    this.note(document.documentElement.getAttribute("style") ?? "");
  };
  /**
   * Start following the pointer.
   * @returns the disposer removing the listener, the counters and the global they are read from.
   */
  install() {
    if (typeof window === "undefined" || typeof document === "undefined") return () => {
    };
    window.addEventListener("pointermove", this.onMove, { passive: true });
    const host = window;
    host.__lgLight = this.counters;
    return () => {
      window.removeEventListener("pointermove", this.onMove);
      if (this.frame !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
      this.frame = void 0;
      delete host.__lgLight;
    };
  }
};
function trackLayoutFacts(dressRefraction) {
  if (typeof document === "undefined") return () => {
  };
  let observed;
  let resize;
  let observedCard;
  let seatResize;
  const sidebarColumn = () => document.querySelector('[data-slot="sidebar"]')?.parentElement ?? void 0;
  const composerCard = () => document.querySelector("[data-composer-card]") ?? void 0;
  const markComposerSeat = () => {
    const card = composerCard();
    if (card === void 0) return;
    let seat = card.parentElement;
    while (seat !== null && seat !== document.body && getComputedStyle(seat).backgroundImage === "none") {
      seat = seat.parentElement;
    }
    if (seat === null || seat === document.body) return;
    seat.dataset[SEAT_FLAG] = "";
    const lip = seat.getBoundingClientRect().bottom - card.getBoundingClientRect().bottom;
    seat.style.setProperty(SEAT_LIP_PROPERTY, `${Math.max(0, Math.round(lip))}px`);
  };
  const watchCard = () => {
    if (typeof ResizeObserver === "undefined") return;
    const card = composerCard();
    if (card === void 0 || card === observedCard) return;
    seatResize?.disconnect();
    seatResize = new ResizeObserver(() => {
      markComposerSeat();
      dressRefraction();
    });
    seatResize.observe(card);
    observedCard = card;
  };
  const markWidth = () => {
    const column = sidebarColumn();
    if (column === void 0) return;
    const wide = column.getBoundingClientRect().width >= SIDEBAR_WIDE_MIN;
    if (wide) column.dataset.lgWide = "";
    else delete column.dataset.lgWide;
    if (column !== observed && typeof ResizeObserver !== "undefined") {
      resize?.disconnect();
      resize = new ResizeObserver(() => {
        markWidth();
      });
      resize.observe(column);
      observed = column;
    }
  };
  const markSquares = () => {
    for (const node of document.querySelectorAll('button, [role="button"]')) {
      const box = node.getBoundingClientRect();
      const square = box.width > 0 && box.width <= SQUARE_MAX_EDGE && Math.abs(box.width - box.height) <= 2;
      if (square) {
        if (node.hasAttribute("data-lg-square") === false) node.dataset.lgSquare = "";
      } else if (node.hasAttribute("data-lg-square") === true) {
        delete node.dataset.lgSquare;
      }
    }
  };
  const markMenuRows = (root, includeRoot = false) => {
    const menus = [...root.querySelectorAll(MENU_SURFACES)];
    if (includeRoot && root instanceof HTMLElement && root.matches(MENU_SURFACES)) menus.unshift(root);
    for (const menu of menus) {
      const box = menu.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      for (const row of menu.querySelectorAll(MENU_ROWS)) {
        const item = row.getBoundingClientRect();
        const inset = Math.max(0, Math.min(item.left - box.left, box.right - item.right));
        const value = `${Math.round(inset * 10) / 10}px`;
        if (row.style.getPropertyValue(MENU_INSET_PROPERTY) !== value) row.style.setProperty(MENU_INSET_PROPERTY, value);
      }
    }
  };
  const markDialogControls = (root, includeRoot = false) => {
    const dialogs = [...root.querySelectorAll(MODAL_DIALOGS)];
    if (includeRoot && root instanceof HTMLElement && root.matches(MODAL_DIALOGS)) dialogs.unshift(root);
    for (const dialog of dialogs) {
      const box = dialog.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      for (const control of dialog.querySelectorAll(DIALOG_CONTROLS)) {
        const own = control.getBoundingClientRect();
        const inset = own.width < 4 || own.height < 4 ? Number.NaN : Math.min(own.left - box.left, box.right - own.right, own.top - box.top, box.bottom - own.bottom);
        if (!Number.isFinite(inset) || inset < 0 || inset > DIALOG_RING_MAX || scrollsBetween(control, dialog)) {
          if (control.hasAttribute(DIALOG_INSET_FLAG)) {
            delete control.dataset[DIALOG_INSET_FLAG];
            control.style.removeProperty(DIALOG_INSET_PROPERTY);
          }
          continue;
        }
        const value = `${Math.round(inset * 10) / 10}px`;
        if (!control.hasAttribute(DIALOG_INSET_FLAG)) control.dataset[DIALOG_INSET_FLAG] = "";
        if (control.style.getPropertyValue(DIALOG_INSET_PROPERTY) !== value) control.style.setProperty(DIALOG_INSET_PROPERTY, value);
      }
    }
  };
  const scrollsBetween = (control, dialog) => {
    const scrolling = /^(auto|scroll|hidden)$/;
    for (let node = control.parentElement; node !== null && node !== dialog; node = node.parentElement) {
      if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) continue;
      const style = getComputedStyle(node);
      if (scrolling.test(style.overflowY) || scrolling.test(style.overflowX)) return true;
    }
    return false;
  };
  const markOverlaysIn = (root, depth = 4) => {
    let tagged = false;
    const visit = (node, level) => {
      const kind = classifyOverlay(node);
      if (kind !== void 0) {
        tagOverlay(node, kind);
        tagged = true;
      }
      if (level >= depth) return;
      for (const child of node.children) visit(child, level + 1);
    };
    visit(root, 0);
    return tagged;
  };
  const tagOverlay = (node, kind) => {
    node.dataset[OVERLAY_FLAG] = "";
    node.dataset.lgSurface = "";
    if (kind === "client-glass") node.dataset[CLIENT_GLASS_FLAG] = "";
  };
  const classifyOverlay = (node) => {
    const box = node.getBoundingClientRect();
    if (box.width < OVERLAY_MIN_WIDTH || box.height < OVERLAY_MIN_HEIGHT) return void 0;
    if (box.width * box.height > window.innerWidth * window.innerHeight * 0.9) return void 0;
    const style = getComputedStyle(node);
    const ours = node.hasAttribute("data-lg-overlay");
    const above = Number.parseInt(style.zIndex, 10) > 0 || ours;
    const opaque = backgroundAlpha(style.backgroundColor) >= OVERLAY_MIN_ALPHA || ours;
    const bare = style.backdropFilter === "none" || ours;
    const covered = node.matches(COVERED_SURFACES) && !node.hasAttribute("data-lg-surface") || node.querySelector(COVERED_SURFACES) !== null;
    const popover = style.position === "fixed" && (node.parentElement === document.body || !insideCoveredSurface(node, box) || escapesItsSurface(node, box)) || style.position === "absolute" && escapesItsSurface(node, box);
    const clientGlass = node.getAttribute("role") === "dialog" && node.getAttribute("aria-modal") !== "true" && (style.backdropFilter !== "none" && !ours || node.hasAttribute(CLIENT_GLASS_FLAG));
    if (popover && !covered) {
      if (bare && above && opaque) return "plain";
      if (clientGlass) return "client-glass";
    }
    if (node.hasAttribute(OVERLAY_FLAG)) {
      delete node.dataset[OVERLAY_FLAG];
      delete node.dataset.lgSurface;
      delete node.dataset[CLIENT_GLASS_FLAG];
    }
    return void 0;
  };
  const overlayCandidate = (node) => classifyOverlay(node) !== void 0;
  const markOverlays = () => {
    for (const node of document.querySelectorAll("*")) {
      const kind = classifyOverlay(node);
      if (kind === void 0) continue;
      tagOverlay(node, kind);
    }
  };
  const sweep = () => {
    markSquares();
    markMenuRows(document);
    markDialogControls(document);
    markWidth();
    markComposerSeat();
    watchCard();
    markOverlays();
    dressRefraction();
  };
  sweep();
  let scheduled = false;
  const mutations = new MutationObserver((records) => {
    let tagged = false;
    let shown = false;
    for (const record of records) {
      if (record.type !== "attributes") continue;
      const target = record.target;
      if (target.nodeType !== 1 || !target.isConnected) continue;
      if (target.hasAttribute("data-lg-overlay") || target.hasAttribute("data-lg-refract")) continue;
      const box = target.getBoundingClientRect();
      if (box.width < OVERLAY_MIN_WIDTH || box.height < OVERLAY_MIN_HEIGHT) continue;
      shown = true;
    }
    let dressable = false;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node;
        tagged = markOverlaysIn(element) || tagged;
        const host = element.closest(MENU_SURFACES);
        if (host !== null) markMenuRows(host);
        else if (element.matches(MENU_SURFACES) || element.querySelector(MENU_SURFACES) !== null) markMenuRows(element, true);
        const modal = element.closest(MODAL_DIALOGS);
        if (modal !== null) markDialogControls(modal);
        else if (element.matches(MODAL_DIALOGS) || element.querySelector(MODAL_DIALOGS) !== null) markDialogControls(element, true);
        if (!dressable && (element.matches(REFRACTING_SURFACES) || element.querySelector(REFRACTING_SURFACES) !== null)) dressable = true;
      }
    }
    if (tagged || dressable) dressRefraction();
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => {
      scheduled = false;
      sweep();
    }, shown ? 0 : SWEEP_DELAY_MS);
  });
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true });
  const debugHost = window;
  debugHost.__lgSweep = { sweep, markOverlays, overlayCandidate, markOverlaysIn, dressRefraction, markDialogControls };
  window.addEventListener("resize", sweep);
  return () => {
    mutations.disconnect();
    resize?.disconnect();
    seatResize?.disconnect();
    window.removeEventListener("resize", sweep);
    delete sidebarColumn()?.dataset.lgWide;
    for (const seat of document.querySelectorAll("[data-lg-seat]")) {
      delete seat.dataset[SEAT_FLAG];
      seat.style.removeProperty(SEAT_LIP_PROPERTY);
    }
    for (const overlay of document.querySelectorAll("[data-lg-overlay]")) {
      delete overlay.dataset[OVERLAY_FLAG];
      delete overlay.dataset.lgSurface;
      delete overlay.dataset[CLIENT_GLASS_FLAG];
    }
    for (const row of document.querySelectorAll(MENU_ROWS)) row.style.removeProperty(MENU_INSET_PROPERTY);
    for (const control of document.querySelectorAll("[data-lg-dialog-inset]")) {
      delete control.dataset[DIALOG_INSET_FLAG];
      control.style.removeProperty(DIALOG_INSET_PROPERTY);
    }
  };
}
var PRESS_CONTROLS = [
  "[data-lg-square]",
  '[role="switch"]',
  '[class*="_iconButton"]',
  '[class*="_toggle"]',
  '[class*="_searchButton"]'
].join(", ");
var PRESS_TOGGLES = '[role="switch"][aria-checked], [role="checkbox"][aria-checked]';
var TOGGLE_TRAVEL_PROPERTY = "--lg-switch-travel";
var PRESS_DRAG_PROPERTY = "--lg-drag-x";
var PRESS_PROPERTY = "--lg-press";
var PRESS_X_PROPERTY = "--lg-press-x";
var PRESS_Y_PROPERTY = "--lg-press-y";
var PRESS_SX_PROPERTY = "--lg-press-sx";
var PRESS_SY_PROPERTY = "--lg-press-sy";
var PRESS_ATTRIBUTE = "data-lg-pressing";
var DRAG_ATTRIBUTE = "data-lg-dragged";
var PRESS_SLOP = 3;
var PRESS_FOLLOW = 0.05;
var PRESS_LIFT = 4 / 48;
var SPRING_POSITION = Math.sqrt(1e3);
var VELOCITY_SMOOTHING = 0.5;
var VELOCITY_DIVISOR = 1e3;
var VELOCITY_STRETCH = 0.2;
function criticalStep(x, v, target, dt, w) {
  const offset = x - target;
  const decay = Math.exp(-w * dt);
  return [
    target + (offset * decay + (v + w * offset) * dt * decay),
    -w * offset * decay + (v + w * offset) * (decay - w * dt * decay)
  ];
}
var PressResponse = class {
  /**
   * @param still - whether motion is switched off for this user, measured once at install.
   */
  constructor(still) {
    this.still = still;
    this.reduced = still;
  }
  /** What this response cost, readable from a probe: presses, drags, frames, and holds that slept. */
  counters = {
    presses: 0,
    drags: 0,
    moves: 0,
    frames: 0,
    writes: 0,
    slept: 0,
    skipped: 0,
    /** State changes dispatched through the control's own activation. */
    commits: 0,
    /** Trailing clicks of a drag, swallowed so they cannot change the state a second time. */
    swallowed: 0
  };
  /** The control the current press belongs to; held until the springs settle. */
  control;
  pointerId = -1;
  originX = 0;
  originY = 0;
  /** Where the drag asks the control to sit, in pixels from the press point. */
  targetX = 0;
  targetY = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** The press curve, its velocity, and what it is heading for. */
  press = 0;
  pressV = 0;
  targetPress = 0;
  /** The drag's own velocity, smoothed, in pixels per second. */
  speed = 0;
  speedX = 0;
  speedY = 0;
  tracking = false;
  lastX = 0;
  lastY = 0;
  /** The two-state control this press may commit: its track, and the end it started from. */
  toggle;
  /** Whether the next trusted click is this drag's own trailing click. */
  swallow = false;
  /** Whether the last release decided to cross the half-way line. */
  crossed = false;
  /** The control's smaller edge: the size its lift and its follow are proportions of. */
  size = 16;
  frame;
  last = 0;
  reduced = false;
  onDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (this.control !== void 0) return;
    const attribute = document.documentElement.getAttribute(STYLE_ATTRIBUTE);
    if (attribute === null || attribute === OFFICIAL_STYLE_ID) {
      this.counters.skipped += 1;
      return;
    }
    const node = event.target instanceof Element ? event.target.closest(PRESS_CONTROLS) : null;
    if (node === null || !node.isConnected) return;
    if (inert(node)) {
      this.counters.skipped += 1;
      return;
    }
    if (getComputedStyle(node).transform !== "none") {
      this.counters.skipped += 1;
      return;
    }
    const box = node.getBoundingClientRect();
    if (box.width < 8 || box.height < 8) return;
    this.counters.presses += 1;
    this.control = node;
    this.pointerId = event.pointerId;
    this.originX = event.clientX;
    this.originY = event.clientY;
    this.targetX = 0;
    this.targetY = 0;
    this.targetPress = 1;
    this.size = Math.min(box.width, box.height);
    this.lastX = this.x;
    this.lastY = this.y;
    this.tracking = false;
    this.swallow = false;
    this.crossed = false;
    this.toggle = readToggle(node);
    node.setAttribute(PRESS_ATTRIBUTE, "");
    if (this.reduced) {
      this.press = 1;
      this.render();
      return;
    }
    this.kick();
  };
  onMove = (event) => {
    if (this.control === void 0 || event.pointerId !== this.pointerId) return;
    this.counters.moves += 1;
    const dx = event.clientX - this.originX;
    const dy = event.clientY - this.originY;
    if (!this.tracking) {
      if (Math.abs(dx) < PRESS_SLOP && Math.abs(dy) < PRESS_SLOP) return;
      this.tracking = true;
      this.counters.drags += 1;
      if (this.toggle !== void 0) this.control?.setAttribute(DRAG_ATTRIBUTE, "");
    }
    this.targetX = dx;
    this.targetY = dy;
    if (this.reduced) {
      this.render();
      return;
    }
    this.kick();
  };
  onUp = (event) => {
    if (this.control === void 0 || event.pointerId !== this.pointerId) return;
    this.release(true);
  };
  /**
   * A gesture the browser took away — a cancelled pointer, a blurred window.
   *
   * It ends the press without deciding anything: a cancel is not a release, and a control that
   * was dragged half-way and then cancelled must be exactly where it was.
   */
  onCancel = (event) => {
    if (this.control === void 0) return;
    if (event !== void 0 && event.pointerId !== this.pointerId) return;
    this.release(false);
  };
  /**
   * End the press and let the springs take the control home.
   * @param commit - whether a drag on a two-state control may decide its state here.
   */
  release(commit) {
    const travelled = this.targetX;
    const dragging = this.tracking;
    this.pointerId = -1;
    this.targetPress = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.tracking = false;
    if (commit && this.toggle !== void 0) this.dragEnds(dragging, travelled);
    if (this.reduced) {
      this.press = 0;
      this.settle();
      return;
    }
    this.kick();
  }
  /**
   * The end of a drag on a two-state control.
   *
   * Three things happen here and nowhere else, and they are the whole of the gesture:
   *
   * - **The half-way test decides the state.** Where the pointer asked the thumb to be is the
   *   reference's own `tf` — its starting end plus the drag, clamped to the track (line 567) —
   *   and the release snaps by the same test the reference snaps its switch by (lines 573-577:
   *   the thumb's fraction of the track, rounded by `>= 0.5` to an end). Half-way exactly
   *   *keeps* the state the control is already in, which is what that comparison means there
   *   and what it means here.
   * - **The client's own activation changes it.** The engine never writes `aria-checked`: it
   *   dispatches the same click the control already answers, so the state that changes is the
   *   client's, taken through the client's own handler — and a control that ignores clicks
   *   simply does not change.
   * - **The browser's trailing click is swallowed.** A drag that ends on the control would
   *   otherwise arrive as a click and change the state a second time — or, when the drag never
   *   crossed, change it at all. The click belongs to this gesture, so this gesture answers
   *   for it.
   *
   * The thumb is handed to the spring from where it stands, measured against the home its *new*
   * state gives it, so a commit reads as the thumb finishing its travel instead of jumping the
   * last few pixels.
   * @param dragging - whether the pointer ever travelled past the slop.
   * @param travelled - how far the pointer went, in pixels, when the press ended.
   */
  dragEnds(dragging, travelled) {
    const control = this.control;
    const toggle = this.toggle;
    if (control === void 0 || toggle === void 0) return;
    if (!dragging) return;
    const travel = toggle.travel;
    const asked = Math.max(0, Math.min(travel, toggle.base + travelled));
    const next = asked / travel >= 0.5 ? travel : 0;
    this.crossed = next !== toggle.base;
    this.x = asked - next;
    this.lastX = this.x;
    this.vx = 0;
    this.swallow = true;
    if (!this.crossed) return;
    this.counters.commits += 1;
    control.click();
  }
  /**
   * Swallow the trailing click of a drag.
   *
   * Capture on the window, so the click never reaches the client's own listeners: React answers
   * clicks at the root container, and stopping the event here happens before it travels down to
   * it. Only a *trusted* click that carries a click count is a pointer's click — the activation
   * this engine dispatches itself is untrusted, and a keyboard's Space or Enter arrives with a
   * count of zero — so neither can be mistaken for one and swallowed.
   */
  onClick = (event) => {
    if (!this.swallow) return;
    if (!event.isTrusted || event.detail === 0) return;
    this.swallow = false;
    this.counters.swallowed += 1;
    event.stopPropagation();
    event.preventDefault();
  };
  /** A keyboard activation is never a drag's trailing click. */
  onKey = () => {
    this.swallow = false;
  };
  onBlur = () => {
    if (this.control !== void 0) this.release(false);
  };
  onFrame = (now) => {
    this.frame = void 0;
    const dt = Math.min((now - this.last) / 1e3, 0.05);
    this.last = now;
    this.counters.frames += 1;
    this.step(dt);
    this.render();
    if (!this.idle()) {
      this.kick();
      return;
    }
    if (this.targetPress === 0) this.settle();
    else this.counters.slept += 1;
  };
  step(dt) {
    const position = criticalStep(this.press, this.pressV, this.targetPress, dt, SPRING_POSITION);
    this.press = position[0];
    this.pressV = position[1];
    const along = criticalStep(this.x, this.vx, this.targetX, dt, SPRING_POSITION);
    this.x = along[0];
    this.vx = along[1];
    const across = criticalStep(this.y, this.vy, this.targetY, dt, SPRING_POSITION);
    this.y = across[0];
    this.vy = across[1];
    const now = performance.now();
    if (this.tracking || this.pointerId !== -1) {
      const dx = (this.x - this.lastX) / dt;
      const dy = (this.y - this.lastY) / dt;
      this.speedX += (dx - this.speedX) * VELOCITY_SMOOTHING;
      this.speedY += (dy - this.speedY) * VELOCITY_SMOOTHING;
      this.speed = Math.hypot(this.speedX, this.speedY) * Math.sign(this.speedX === 0 ? 1 : this.speedX);
    } else {
      this.speedX = 0;
      this.speedY = 0;
      this.speed = 0;
    }
    this.lastX = this.x;
    this.lastY = this.y;
    if (this.pointerId === -1 && this.targetX === 0 && this.targetY === 0) {
      this.speedX *= 0.6;
      this.speedY *= 0.6;
      this.speed *= 0.6;
    }
  }
  /** One frame's worth of paint, as properties on the control. */
  render() {
    const control = this.control;
    if (control === void 0) return;
    const press = Math.max(0, Math.min(1, this.press));
    const stretch = Math.max(-VELOCITY_STRETCH, Math.min(VELOCITY_STRETCH, 0.75 * this.speed / VELOCITY_DIVISOR));
    const squash = Math.max(-VELOCITY_STRETCH, Math.min(VELOCITY_STRETCH, 0.25 * this.speed / VELOCITY_DIVISOR));
    const scale = 1 + PRESS_LIFT * press;
    const offsetX = this.size * Math.tanh(PRESS_FOLLOW * this.x / this.size);
    const offsetY = this.size * Math.tanh(PRESS_FOLLOW * this.y / this.size);
    control.style.setProperty(PRESS_PROPERTY, press.toFixed(3));
    control.style.setProperty(PRESS_X_PROPERTY, `${offsetX.toFixed(2)}px`);
    control.style.setProperty(PRESS_Y_PROPERTY, `${offsetY.toFixed(2)}px`);
    control.style.setProperty(PRESS_SX_PROPERTY, (scale / (1 - stretch)).toFixed(4));
    control.style.setProperty(PRESS_SY_PROPERTY, (scale * (1 - squash)).toFixed(4));
    if (this.toggle !== void 0) {
      control.style.setProperty(PRESS_DRAG_PROPERTY, this.toggleOffset().toFixed(2) + "px");
    }
    this.counters.writes += 1;
  }
  /**
   * How far the thumb of a two-state control sits from the place its own state asks for, in
   * pixels, clamped to the track.
   *
   * While the pointer is down the answer is the pointer's own travel — the drag follows the
   * finger one for one and the track is what stops it, which is what makes the control read as
   * being dragged rather than as being deformed. The way home is read against the *current*
   * state on every frame, so a commit moves the thumb's own end and leaves the rest to the
   * spring.
   * @returns the offset in pixels.
   */
  toggleOffset() {
    const toggle = this.toggle;
    if (toggle === void 0) return 0;
    const home = this.controlHome();
    const asked = this.pointerId !== -1 && this.tracking ? this.targetX : this.x;
    return Math.max(-home, Math.min(toggle.travel - home, asked));
  }
  /** Where the control's own state puts its thumb: the far end of the track, or the near one. */
  controlHome() {
    const toggle = this.toggle;
    if (toggle === void 0) return 0;
    return this.control?.getAttribute("aria-checked") === "true" ? toggle.travel : 0;
  }
  /** Whether every spring is at its target and nothing is moving. */
  idle() {
    return Math.abs(this.press - this.targetPress) < 2e-3 && Math.abs(this.pressV) < 0.02 && Math.abs(this.x - this.targetX) < 0.1 && Math.abs(this.y - this.targetY) < 0.1 && Math.abs(this.vx) < 0.5 && Math.abs(this.vy) < 0.5 && Math.abs(this.speedX) < 2 && Math.abs(this.speedY) < 2;
  }
  /** Put the control back exactly as it was found, and forget it. */
  settle() {
    const control = this.control;
    this.control = void 0;
    this.press = 0;
    this.pressV = 0;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.speed = 0;
    this.speedX = 0;
    this.speedY = 0;
    if (control === void 0) return;
    this.toggle = void 0;
    control.removeAttribute(PRESS_ATTRIBUTE);
    control.removeAttribute(DRAG_ATTRIBUTE);
    control.style.removeProperty(PRESS_PROPERTY);
    control.style.removeProperty(PRESS_X_PROPERTY);
    control.style.removeProperty(PRESS_Y_PROPERTY);
    control.style.removeProperty(PRESS_SX_PROPERTY);
    control.style.removeProperty(PRESS_SY_PROPERTY);
    control.style.removeProperty(PRESS_DRAG_PROPERTY);
  }
  /** Arm the one frame, if it is not already armed. */
  kick() {
    if (this.frame !== void 0) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.onFrame);
  }
  /** The current state, for a probe that has to name what a press is doing. */
  state() {
    return {
      press: this.press,
      x: this.x,
      y: this.y,
      speed: this.speed,
      sx: this.control?.style.getPropertyValue(PRESS_SX_PROPERTY) ?? "",
      sy: this.control?.style.getPropertyValue(PRESS_SY_PROPERTY) ?? "",
      dragging: this.tracking,
      held: this.pointerId !== -1,
      /* The two-state side of the response: what the drag may commit, where the thumb is
       * painted against its own state, and what the last release decided. */
      toggle: this.toggle === void 0 ? "" : this.toggle.travel,
      home: this.controlHome(),
      thumb: this.toggle === void 0 ? "" : this.toggleOffset(),
      crossed: this.crossed,
      swallow: this.swallow,
      /* The spring terms the loop's own sleep test reads, so a probe can name the one that kept
       * a frame alive instead of guessing at it. */
      dPress: this.press - this.targetPress,
      pressV: this.pressV,
      dX: this.x - this.targetX,
      vx: this.vx,
      speedX: this.speedX,
      speedY: this.speedY,
      control: this.control === void 0 ? "" : `${this.control.tagName.toLowerCase()}.${String(this.control.className).slice(0, 30)}`
    };
  }
  /**
   * Start answering presses.
   * @returns the disposer removing the listeners, the counters and the global they are read from.
   */
  install() {
    if (typeof window === "undefined" || typeof document === "undefined") return () => {
    };
    document.addEventListener("pointerdown", this.onDown, { passive: true });
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerup", this.onUp, { passive: true });
    window.addEventListener("pointercancel", this.onCancel, { passive: true });
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("click", this.onClick, true);
    window.addEventListener("keydown", this.onKey, true);
    const host = window;
    host.__lgPress = { counters: this.counters, state: () => this.state() };
    return () => {
      document.removeEventListener("pointerdown", this.onDown);
      window.removeEventListener("pointermove", this.onMove);
      window.removeEventListener("pointerup", this.onUp);
      window.removeEventListener("pointercancel", this.onCancel);
      window.removeEventListener("blur", this.onBlur);
      window.removeEventListener("click", this.onClick, true);
      window.removeEventListener("keydown", this.onKey, true);
      if (this.frame !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
      this.frame = void 0;
      this.settle();
      delete host.__lgPress;
    };
  }
};
function inert(node) {
  if (node.getAttribute("aria-disabled") === "true") return true;
  if (node.hasAttribute("disabled")) return true;
  return node.readOnly === true;
}
function readToggle(node) {
  if (!node.matches(PRESS_TOGGLES)) return void 0;
  const travel = Number.parseFloat(getComputedStyle(node).getPropertyValue(TOGGLE_TRAVEL_PROPERTY));
  if (!Number.isFinite(travel) || travel <= 0) return void 0;
  return { travel, base: node.getAttribute("aria-checked") === "true" ? travel : 0 };
}
function quietMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
var inject = [];
function apply(ctx) {
  const runtime = new LiquidGlassRuntime(ctx);
  ctx.provide("liquidGlass", runtime);
  ctx.effect(() => trackLayoutFacts(() => runtime.dressRefractingSurfaces()), "dsh-liquid-glass: layout sweep");
  ctx.effect(() => new PointerLight((text) => runtime.noteLightWrite(text)).install(), "dsh-liquid-glass: pointer light");
  ctx.effect(() => new PointerRimLight().install(), "dsh-liquid-glass: pointer rim light");
  ctx.effect(() => new PressResponse(quietMotion()).install(), "dsh-liquid-glass: press response");
  ctx.effect(() => runtime.register({
    id: "liquid-glass",
    label: () => "liquid-glass",
    css: material_default,
    refraction: true
  }), "dsh-liquid-glass: built-in style");
}

return module.exports; } });
