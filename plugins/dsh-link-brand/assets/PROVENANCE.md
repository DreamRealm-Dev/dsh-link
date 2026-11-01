# Where this artwork comes from

`symbol-v2.svg`, `symbol-v2-mono.svg` and `dsh-link-in-d.svg` are copied
unchanged from the DSH Link logo project: `set3` (rev 3), the variant chosen for
the application icon, at

    C:\Users\<user>\Downloads\LOGO设计\dsh-link-logo\set3\svg\

They are this project's own design (no third-party artwork, no upstream logo).
The DeepSeek Harness marks are not used anywhere in the interface: see
`docs/brand.md` and the upstream `BRAND_GUIDELINES.zh.md`.

- `symbol-v2.svg` — the mark: ring, whale, and the `LINK` stem, 1:1 (96×96).
  `-mono` is the same geometry with every shape in one ink colour, kept as the
  flat fallback if a surface ever needs a single-colour mark.
- `dsh-link-in-d.svg` — the wordmark: `dsh` with the whale in the `d` bowl plus
  `LINK` (141.43×27.9). `-mono` / `-white` exist in the source project; this
  plugin does not ship them because the ink follows `currentColor` instead.

## Application icons

`assets/symbol-v2-<n>.png` are the design's own renders (16 … 1024), and
`assets/plated/` is generated from them by `scripts/gen-app-icons.py`: the mark on a white
rounded plate, in the two plate geometries the upstream icon artwork uses. Both directories
are committed so the icon build needs no network and no external renderer; rerun the script
after replacing a render.

Regenerate the React components after editing anything here:

    node plugins/dsh-link-brand/scripts/gen-marks.mjs
