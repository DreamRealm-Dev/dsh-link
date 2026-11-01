# dsh-theme-settings

The **Theme** section of the DeepSeek Harness settings panel. It currently holds
one preference — the control style — and it is the plugin whose entry id is the
settings namespace, so the preference lives in the settings document like every
other preference in the client.

## The section

`控件风格 / Control style` renders as a row of material cubes, in the shape of the
client's own Appearance row (fetched metrics: title over a cube row, 16px
padding, `--dsw-*` tokens only), because a setting this plugin adds should be
indistinguishable from a setting that shipped with the client. Each cube carries a
small preview of the two controls over the same backdrop, so the choice is made by
looking.

Selecting a cube writes the preference; it does not touch the material directly.
The applied material follows the document:

```
cube click → form.set('controlStyle', id) → Host settings document → describe mirror
           → adopt() → ctx.liquidGlass.setStyle(id) + the row's own store
```

One adoption path for every source of truth means a refused write leaves the
interface exactly as it was, and a document edited outside the section (the
settings document is editable from the panel's own action) takes effect the same
way. A style the document names but the composition cannot register is kept as the
row's selection and logged, rather than silently reverting.

## The preference

```ts
// src/index.ts — the Host half
export const Config = z.object({
  controlStyle: z.union(['official', 'liquid-glass']).default('official').volatile(),
})
```

The entry is a settings namespace because it has a `Config` schema, the field is
`volatile` because switching material is live-editable without a restart, and the
entry id in `cordis.patch.yml` must equal `SETTINGS_NAMESPACE` — that identity is
what `ctx.configForms.get()` reads.

## Adding a style

A style is registered by the plugin that owns it, through the material engine:

```ts
ctx.effect(() => ctx.liquidGlass.register({ id: 'my-style', label: () => t('nav'), css }), '…')
```

It then appears in the section automatically — the cubes are built from
`ctx.liquidGlass.getSnapshot().styles`, so no edit to this package is needed. Add
the id to `CONTROL_STYLES` in `src/settings.ts` to make it persistable.

## Dependencies

Required services: `slots`, `locale`, `remote`, `configForms` (the settings
transport), and `liquidGlass` (the material engine, provided by
`dsh-liquid-glass`). Injection of the last one is what orders this half after it,
and it is the only coupling between the two plugins.
