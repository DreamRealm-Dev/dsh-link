/**
 * The pane's copy, in one place: the tab chip, the guide entry, the pane chrome, and the two
 * parameterised lines (the note count and the route's thresholds).
 *
 * WHAT IS COPY AND WHAT IS NOT (the boundary this file draws, and the README repeats):
 *
 *   copy      the strings below. They are this half's own words about itself, they read the same in
 *             every deployment, and they are what a person reads in the pane.
 *   data      everything the routes carry: an item's `title`, its `kind`, its `source`, a note's
 *             text, a refusal's `detail`, a route code (`NOTES_TOO_LONG`, `PANEL_UNKNOWN_KIND`), a path.
 *             A refusal is shown with the route's own code and message VERBATIM (view.ts: "those three
 *             refusals belong to the route"); a second name for a fact that already has a name is a
 *             second opinion about that fact. Nothing here translates data.
 *
 * `{name}` placeholders are the kernel's own substitution form (`locale/src/client/index.ts`: the
 * template is read with `template.replace(/\{(\w+)\}/g, ...)`), and zh/en carry the same placeholder
 * names for every key, so a language switch cannot drop a value.
 *
 * `copy.format.line` carries the SAME value in both dictionaries on purpose: `{code}: {detail}` is
 * punctuation around two pieces of data (a route's code and its message), not a sentence, and
 * translating it would mean inventing a second spelling for the route's own words.
 */

/** Dictionary namespace owned by this plugin. One occupant per (namespace, locale): the kernel throws on a second. */
export const NS = 'dsh-link-panel'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.title': 'LINK 面板',
  'guide.description': '面板注册表声明了什么 —— 可见条目、按名拒绝的条目 —— 以及便条账本，还有一个每次写一条便条的输入框。',
  'panel.readonly': '只读',
  'panel.reads': '注册表 {panel} · 账本 {notes}',
  'state.pending': '待读',
  'state.ok': '已读',
  'state.failed': '读取失败',
  'items.empty': '没有可见条目',
  'item.meta': '类型 {kind} · 落点 {sink} · 次序 {order} · {source}',
  'contrib.title': '贡献项',
  'registry.summary': '注册表原始行',
  'contrib.empty': '没有贡献项',
  'contrib.noBody': '没有正文',
  'refused.empty': '没有拒绝项',
  'notes.count': '{count} 条便条',
  'notes.limits': '限额：{maxNotes} 条活便条，每条 {maxChars} 个字符',
  'notes.limitsUnread': '限额：未读到',
  'notes.empty': '账本里没有便条',
  'input.label': '一条便条',
  'submit.idle': '添加便条',
  'submit.busy': '正在添加…',
  'failure.line': '{slot}: {code}: {detail}',
  'copy.format.line': '{code}: {detail}',
  'refusal.noCode': '没有码',
}

/** English dictionary. Its type is what holds the two key sets equal at compile time. */
export const en: Record<PanelCopyKey, string> = {
  'tab.title': 'LINK panel',
  'guide.description': 'What the panel registry declares — its visible items, the items it refused by name — and the note ledger, with a box to add one note.',
  'panel.readonly': 'read-only',
  'panel.reads': 'registry {panel} · ledger {notes}',
  'state.pending': 'pending',
  'state.ok': 'ok',
  'state.failed': 'failed',
  'items.empty': 'no visible item',
  'item.meta': 'kind {kind} · sink {sink} · order {order} · {source}',
  'contrib.title': 'contributions',
  'registry.summary': 'registry rows',
  'contrib.empty': 'no contribution',
  'contrib.noBody': 'no body',
  'refused.empty': 'nothing refused',
  'notes.count': '{count} note(s)',
  'notes.limits': 'limits: {maxNotes} live note(s), {maxChars} character(s) each',
  'notes.limitsUnread': 'limits: not read',
  'notes.empty': 'no note in the ledger',
  'input.label': 'one note',
  'submit.idle': 'add note',
  'submit.busy': 'adding…',
  'failure.line': '{slot}: {code}: {detail}',
  'copy.format.line': '{code}: {detail}',
  'refusal.noCode': 'no code',
}

/** Union of this namespace's dictionary keys. */
export type PanelCopyKey = keyof typeof zh

/** One translation of this namespace: a key of {@link PanelCopyKey} plus the kernel's `{name}` parameters. */
export type Translate = (key: PanelCopyKey, params?: Record<string, unknown>) => string
