# Licences for the DSH Link pack

This project **is MIT**: the licence text lives once, at [`../LICENSE`](../LICENSE), and it covers
every plugin this repository ships and every line of the shell beside them. MIT permits the same
text to apply to many packages, so the covered set is listed here rather than repeating the text
per package — one copy to read, one list to keep current.

## Covered by that text

`dsh-agent-context`, `dsh-anchored-lite`, `dsh-browser`, `dsh-continue-button`,
`dsh-delegation-model-choice`, `dsh-escalation-guard`, `dsh-image-guard`, `dsh-lan-bridge`,
`dsh-link-brand`, `dsh-link-collab`, `dsh-link-compat`, `dsh-link-groups`, `dsh-link-host`, `dsh-link-markdown`,
`dsh-link-mods`, `dsh-link-notes`, `dsh-link-panel`, `dsh-link-teams`, `dsh-link-upgrade`,
`dsh-link-responsive`, `dsh-link-toolbar`,
`dsh-liquid-glass`, `dsh-theme-settings`, and the Tauri shell in `src-tauri/`.

Packages that carry their own `LICENSE` file (`dsh-link-brand`, `dsh-liquid-glass`,
`dsh-theme-settings`) hold a pointer to this file, not a second copy.

## Code is MIT; the brand artwork is not

Every **line of code** this repository ships is MIT. The one deliberate exception is the DSH Link
brand artwork: the mark, the wordmark, their variants, the application-icon plates and the boot-page
mark are licensed **CC BY-NC-SA 4.0** in their own repository,
<https://github.com/DreamRealm-Dev/dsh-link-brand>. The copies kept here under
`plugins/dsh-link-brand/assets/` and the renders in `src-tauri/icons/` stay under that licence, not
MIT; the scope, attribution format and trademark rules are stated once in `../BRAND-ASSETS.md`.
That is an asset licence boundary, not a code licence: `dsh-link-brand` the package remains MIT in
`pack/pack.json` because its code is MIT.

The Microsoft WebView2 fixed-version runtime - which does contain GPL-3.0 and
proprietary licence files (`Trust Protection Lists/{Mu,Sigma}/LICENSE`, `WidevineCdm/LICENSE`) - is
**downloaded at build time and gitignored** (`scripts/fetch-webview2-fixed.mjs`, `.gitignore`), so it
is not part of what this repository redistributes. It is documented in
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) because a reader of the shell should know
what it runs on.
## Adding a plugin that is not ours

1. MIT (or another permissive licence whose text is compatible): add its copyright line to the list
   above rather than pasting the text again. The gate counts the copies.
2. Non-permissive (GPL/AGPL/LGPL/SSPL and similar): stop. Shipping it needs a decision this
   repository has not made, and `scripts/verify-pack.mjs` refuses the pack until an entry that names
   the package exists.

`node scripts/verify-pack.mjs` enforces all of that against `pack/pack.json`.
