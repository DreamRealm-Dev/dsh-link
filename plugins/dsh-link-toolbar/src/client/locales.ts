/**
 * The toolbar entry's copy: one namespace, two dictionaries, and no other copy anywhere in this package.
 *
 * The entry does not read these tables itself. It declares this namespace at its registration
 * (`locale: NS`) and draws every word through the `t` seat the shell hands it, so a translation is a
 * data change and a language switch reaches the header without a re-registration. The component
 * passes keys, never sentences — which is also what lets a check read the half and see that no
 * product text is written into it.
 *
 * zh is the key-set source of truth; en is typed against it, so a key present in one dictionary and
 * missing from the other is a compile error. One (namespace, locale) has exactly one owner: the
 * kernel's locale service throws on a second registration of the same pair, so this name belongs to
 * this package alone.
 *
 * `toolbar.open` carries the SAME value in both dictionaries on purpose: `DSH LINK` is the
 * product's name on the button rather than a sentence, and it is declared as kept-English (with its
 * reason) in test/keep-verbatim.json and in README.md.
 */

/** Dictionary namespace owned by this plugin. One occupant per (namespace, locale): the kernel throws on a second. */
export const NS = 'dsh-link-toolbar'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'toolbar.open': 'DSH LINK',
  'toolbar.openHint': '打开 DSH LINK 状态',
  'toolbar.menu': 'DSH LINK 状态',
  'toolbar.close': '关闭',
  'item.layout': '响应式档位',
  'item.notes': '便条',
  'item.glass': '玻璃皮肤',
  'item.browser': '内置浏览器',
  'reason.not-mounted': '未装载',
  'reason.empty-value': '已装载但未给值',
  'state.on': '已就绪',
  'state.off': '不可用',
}

/** English dictionary. Its type is what holds the two key sets equal at compile time. */
export const en: Record<ToolbarCopyKey, string> = {
  'toolbar.open': 'DSH LINK',
  'toolbar.openHint': 'Open DSH LINK status',
  'toolbar.menu': 'DSH LINK status',
  'toolbar.close': 'Close',
  'item.layout': 'Responsive band',
  'item.notes': 'Notes',
  'item.glass': 'Glass skin',
  'item.browser': 'Built-in browser',
  'reason.not-mounted': 'Not mounted',
  'reason.empty-value': 'Mounted with no value',
  'state.on': 'Ready',
  'state.off': 'Unavailable',
}

/** Union of this namespace's dictionary keys. */
export type ToolbarCopyKey = keyof typeof zh

/** One translation of this namespace: a key of {@link ToolbarCopyKey} plus the kernel's `{name}` parameters. */
export type Translate = (key: ToolbarCopyKey, params?: Record<string, unknown>) => string
