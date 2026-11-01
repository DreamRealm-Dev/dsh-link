/**
 * The collaboration bus row's words, in both languages, under this package's own namespace.
 *
 * WHAT IS COPY AND WHAT IS NOT. The strings below are this half's own words about itself; a number, a
 * route code and a route's failure text are DATA and travel through their placeholders verbatim, so a
 * reading is shown as the bus answered it and never translated into a second opinion.
 *
 * ONE REGISTER, ONE KEY SET. The host half is a plugin with no product copy; this is the only place
 * this package speaks, it registers (zh, en) in one call (apply in index.ts), and the two dictionaries
 * carry the SAME key set - a key that exists in one and not the other is a row that answers a key name
 * in that language, which is the failure this pairing exists to prevent.
 *
 * The {name} placeholder form is the kernel locale service's own (it substitutes a named value into the
 * template), and every key carries the same placeholder names in both languages.
 */

/** Dictionary namespace owned by this plugin. One occupant per (namespace, locale): the service throws on a second. */
export const NS = 'dsh-link-collab'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.status.title': '协作总线',
  'panel.status.body': '团队 {teams} · 成员 {members} · 账本 {records} 条 · 中继 {relay}',
  // R217: the message count means different things on the two supported kernel lines, so the row says
  // which one it is. Both strings carry their own separator: the body is a template and the suffix is
  // only appended when the scope makes the count mean less than it looks.
  'panel.status.messagesThisEnd': ' · 消息仅本端收件',
  'panel.status.messagesNone': ' · 本内核不记消息队列',
  'panel.status.relayBound': '已绑定',
  'panel.status.relayUnbound': '未绑定',
  'panel.status.unread': '总线读数尚未到达',
  'panel.status.failed': '读不到总线：{code} · {detail}',
  'panel.status.noCode': '无代码',
}

/** The keys above, exactly - the type every t(...) call in this half is held to. */
export type BusKey = keyof typeof zh

/** English dictionary: the same key set, the same placeholder names. */
export const en: Record<BusKey, string> = {
  'panel.status.title': 'Collaboration bus',
  'panel.status.body': 'teams {teams} · members {members} · ledger {records} · relay {relay}',
  'panel.status.messagesThisEnd': ' · messages: this end only',
  'panel.status.messagesNone': ' · this kernel journals no message queue',
  'panel.status.relayBound': 'bound',
  'panel.status.relayUnbound': 'not bound',
  'panel.status.unread': 'the bus reading has not arrived yet',
  'panel.status.failed': 'the bus cannot be read: {code} · {detail}',
  'panel.status.noCode': 'no code',
}

/** What this half calls a translate: a key from {@link BusKey}, and the values its placeholders take. */
export type Translate = (key: BusKey, params?: Record<string, string | number>) => string
