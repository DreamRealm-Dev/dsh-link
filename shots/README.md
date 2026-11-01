# Screenshots

Six files, each earning its place, plus the refraction proof. They exist so the
material can be reviewed without re-deriving what changed — and so reviewing it
costs nothing but a look at one of these paths.

| File | What it shows | What to look at |
|---|---|---|
| `dark-app.png` | the whole client, dark palette, Liquid Glass applied | the floating sidebar, the composer card, the black background staying black |
| `dark-sidebar.png` | the sidebar panel and its controls, dark | the panel's rim and gutter; the icon chips are *elevation*, not nested glass |
| `light-app.png` | the whole client, light palette | that the light panel reads as a pale sheet rather than as the page |
| `light-sidebar.png` | the sidebar panel and its controls, light | the dark hairline that gives the panel its edge on white; grey chips |
| `light-dialog-over-content.png` | the settings dialog over a conversation with content behind it | whether the blurred content behind is visible *enough* — measured at 24.7 values of variation at `--lg-blur: 10px` |
| `refraction.png` | a striped test pattern, right half behind a glass surface | the stripes bending at the glass edge; the left half stays straight |

Reproduce any of them with `scripts/cdp-shot.mjs` (see `plugins/README.md`).
`scripts/pixel.mjs` reads a region's rendered colour and its spread without an
image viewer, which is how the numbers quoted above were taken.
