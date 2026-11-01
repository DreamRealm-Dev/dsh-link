/**
 * `dsh-link-markdown` namespace dictionaries — the only file in this package that holds copy.
 *
 * Every word the browser half shows comes from here through the framework's `t` seat: the pane's
 * read-only chip, the empty state, the named failure page, and the three Markdown chrome labels this
 * package forwards to the kernel renderer. A component passes keys, never sentences, so a check can
 * read the client half and see that no product text is written into it, and a translation is a data
 * change rather than a search through components.
 *
 * The namespace is unique per package: the kernel locale registry throws when the same
 * (namespace, locale) pair is registered twice, so no other package may take this name. `zh` and
 * `en` carry the same key set — the `satisfies` on each dictionary makes a missing or extra key a
 * compile error — because the registry resolves a missing key by walking the fallback chain and then
 * showing the key itself.
 */

/** Namespace owning this package's copy (single occupant: a re-registration of the same pair throws). */
export const NS = 'dsh-link-markdown'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'body.readonly': '只读',
  'empty.noAddress': '这个标签没有可读的地址',
  'failure.reason.notFileAddress': '不是 dsh-resource://file/ 地址',
  'failure.reason.malformed': '地址不完整（缺 session id 或路径，或转义不合法）',
  'failure.reason.unknownScope': '不认识的地址范围',
  'failure.reason.absoluteScope': '绝对路径地址不带 Session，读不了',
  'failure.reason.notMarkdown': '不是 .md / .markdown 文件',
  'failure.reason.readRejected': '读取请求被拒绝',
  'failure.reason.noProgress': '分页停在原地：同一 offset 返回 0 行且没有 eof',
  'failure.reason.unreadable': '这个文件没能读出来',
  'body.edit': '编辑',
  'body.preview': '预览',
  'body.save': '保存',
  'body.saved': '已保存',
  'body.dirty': '未保存',
  'body.saveHint': 'Ctrl+S 保存；保存前不会写入磁盘',
  'body.savedHint': '已写入磁盘',
  'body.stale': '文件在你编辑期间被改过，保存已拒绝：先重新打开再改',
  'body.refused': '保存被拒绝（原因见文件名右侧状态）',
  'markdown.copy': '复制',
  'markdown.copied': '已复制',
  'markdown.footnotes': '脚注',
} satisfies Record<string, string>

/** The namespace's key union. */
export type MarkdownKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  'body.readonly': 'read-only',
  'empty.noAddress': 'This tab carries no readable address',
  'failure.reason.notFileAddress': 'Not a dsh-resource://file/ address',
  'failure.reason.malformed': 'The address is incomplete (no session id or path, or a bad escape)',
  'failure.reason.unknownScope': 'Unknown address scope',
  'failure.reason.absoluteScope': 'An absolute-path address carries no Session to read through',
  'failure.reason.notMarkdown': 'Not a .md / .markdown file',
  'failure.reason.readRejected': 'The read request was rejected',
  'failure.reason.noProgress': 'Paging stopped where it stood: one offset returned 0 lines without eof',
  'failure.reason.unreadable': 'This file could not be read',
  'body.edit': 'Edit',
  'body.preview': 'Preview',
  'body.save': 'Save',
  'body.saved': 'Saved',
  'body.dirty': 'unsaved changes',
  'body.saveHint': 'Ctrl+S saves; nothing is written until you do',
  'body.savedHint': 'written to disk',
  'body.stale': 'The file changed while you were editing, so the save was refused - reopen it and edit again',
  'body.refused': 'The save was refused (the status beside the file name says why)',
  'markdown.copy': 'Copy',
  'markdown.copied': 'Copied',
  'markdown.footnotes': 'Footnotes',
} satisfies Record<MarkdownKey, string>
