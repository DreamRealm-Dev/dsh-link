/**
 * dsh-continue-button —— 浏览器半：助手消息旁的「继续生成」按钮。
 *
 * 参考官网聊天在"已停止"回复下提供的同名入口。点击 =
 * `session.prompt([{type:'text',text:'继续'}], 'queue')`，与输入框发送同路径
 * ——关闭的 turn 没有别的续写接口，这是客户端唯一原生路径。
 *
 * 挂点：两版 `conversation.chat.turnTail` 的 kind 不同，而 kind 决定注册契约：
 *   · 0.1.5（桌面版）是 **chain**：register 必须给 `select`，否则内核直接
 *     throw（`ui-slots` 的 `chain slot ... requires options.select`），条目根本
 *     不上账——曾因此整条尾部路径失效；
 *   · 0.2.x 是 **list**：要 `id`，不看 `select`。
 * `id` + `select` 同时给，两种形态都合法，因此一个注册覆盖两版。
 *
 * 为什么必须挂 tail 位：0.1.5 的 `TurnTailNodeView` 只在收尾消息**可寻址**时
 * 渲染 `assistant-actions`（`messageId === undefined ? null : renderSlot(...)`），
 * 而收尾消息取的是"最后一个有非空 text 的已终局助手节点"
 * （`finalized.findLast(hasText) ?? null`）。于是：
 *   · 输出阶段被截断 → 有 text、有 messageId → 操作行存在 → `actions` 位生效；
 *   · **思考阶段被截断** → 只有 reasoning，`closing` 为 null → 操作行整行不存在，
 *     `actions` 位无处可挂，`turnTail` 的 chain 是唯一宿主。
 *
 * chain 选举（`select`）必须纯函数、不得抛错（渲染器把异常当"放弃"），而且
 * 一次只有第一个非空者渲染——所以只在**操作行挂不上**的冻结尾上认领：
 *   1. `turn-tail` 位置数据存在，且收尾消息为空（`closing === null`）或没有
 *      messageId（中断冻结的部分消息）；
 *   2. 本 turn 没有 deliverable（产出的文件 chip 由官方 `dsh-client-ui-deliverables`
 *      占同一链位，条件逐字对齐 `selectDeliverables`）——不抢别人的席位。
 * 选举只定**宿主**；"是否真被掐、该不该显示"由组件用快照判定（结束原因、
 * interrupted 的 assistant step、会话空闲、只挂最后一轮）——那些要 hook，而
 * `select` 必须是纯函数。多认领一份无害：当选而返回 null 时，那个尾部本来也不
 * 显示别的东西。
 */
export const inject = ['slots', 'sessions']

const SLOT_TURN_TAIL = 'conversation.chat.turnTail'
const SLOT_ASSISTANT_ACTIONS = 'conversation.chat.assistant-actions'
const PLUGIN_ID = 'dsh-continue-button'
const PROMPT_TEXT = '继续'

/** 自带样式：一枚低调的胶囊按钮，跟随主题的前景/边框变量，双值兜底。 */
const BUTTON_CSS = `
.${PLUGIN_ID} {
  appearance: none;
  border: 1px solid var(--dsh-border, var(--border-color, rgba(255,255,255,0.16)));
  background: var(--dsh-surface, rgba(255,255,255,0.04));
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 12px;
  border-radius: 999px;
  cursor: pointer;
  opacity: 0.82;
  margin: 2px 0;
}
.${PLUGIN_ID}:hover { opacity: 1; background: rgba(255,255,255,0.10); }
.${PLUGIN_ID}:active { transform: translateY(1px); }
.${PLUGIN_ID}:disabled { opacity: 0.5; cursor: default; }
`

/** turnTail 位本轮已渲染的会话/turn 键（actions 位用它让位）；超容量即清空。 */
const tailRenderedTurns = new Map()

/** 正文里代码围栏（```）出现奇数次 = 有未闭合的围栏 = 截断在代码中间。 */
function hasUnclosedFence(text: string): boolean {
  return (text.match(/```/g) ?? []).length % 2 === 1
}

/** 快照里全部 turn-tail 节点的 data（TurnTailChatData：turn/closing/…）。 */
function tailDatas(chat: any): readonly any[] {
  const values = chat?.nodes?.values?.()
  if (typeof values !== 'object' || values === null) return []
  const out = []
  for (const node of values) {
    if (node?.kind === 'turn-tail' && node?.data !== undefined && node?.data !== null) out.push(node.data)
  }
  return out
}

/**
 * 内容块是否可见正文。判别字段两版不同：0.1.5 的 assistant 块用 `kind`
 * （见其 `assistantText` / `hasText`），0.2.x 用 `type`；只认 `type` 会让
 * 0.1.5 上"正文"恒为空串，于是"结束消息没有正文"这条判据恒真——完篇消息
 * 也挂按钮。两个字段都认。
 * @param block - 内容块。
 * @returns 是带非空字符串正文的 text 块时为 true。
 */
function isTextBlock(block: any): boolean {
  return (block?.kind === 'text' || block?.type === 'text') && typeof block?.text === 'string'
}

/** 收尾助手的可见正文（text 块拼接；reasoning 不算）。 */
function closingTextOf(closing: any): string | undefined {
  if (closing === null || closing === undefined) return undefined
  const blocks = closing.blocks
  if (!Array.isArray(blocks)) return undefined
  return blocks
    .filter((block: any) => isTextBlock(block))
    .map((block: any) => block.text)
    .join('')
}

/**
 * 读 0.1.5 turn 位置对象上按名发布的数据（`TurnLocation.data` 是 Map）：
 * `turn-tail` 是结尾数据，`assistant-step` 按 step 挂在各自的 step 上。
 * 形状不认识就返回 undefined——选举宁可放弃，不抛错。
 * @param loc - chain owner 的 `turn`（0.1.5 的位置对象）。
 * @param key - 数据名。
 * @returns 该位置发布的数据，缺失为 undefined。
 */
function locationData(loc: any, key: string): any {
  try {
    return loc?.data?.get?.(key)
  } catch {
    return undefined
  }
}

/** 本 turn 是否含被中断的 assistant step（流被掐断的内核签名）。 */
function hasInterruptedStep(loc: any): boolean {
  const steps = loc?.steps
  if (!Array.isArray(steps)) return false
  for (const step of steps) {
    if (locationData(step, 'assistant-step')?.status === 'interrupted') return true
  }
  return false
}

/**
 * 官方 `dsh-client-ui-deliverables` 是否要占本链位：条件与其
 * `selectDeliverables` 逐字一致（`produced.seq > seq` 排除、`presented.seq < seq` 计入）。
 * @param loc - chain owner 的 `turn`。
 * @param seq - chain owner 的收尾 seq。
 * @returns 有产出或已交付文件时为 true。
 */
function deliverablesClaim(loc: any, seq: any): boolean {
  const data = locationData(loc, 'deliverables')
  if (data === null || data === undefined) return false
  const produced = Array.isArray(data.produced) ? data.produced : []
  const presented = Array.isArray(data.presented) ? data.presented : []
  const bound = typeof seq === 'number' ? seq : Number.POSITIVE_INFINITY
  return produced.some((entry: any) => !(typeof entry?.seq === 'number' && entry.seq > bound))
    || presented.some((file: any) => !(typeof file?.seq === 'number' && file.seq >= bound))
}

/**
 * 0.1.5 chain 选举：认领"操作行挂不上、且没交付物"的结尾。
 *
 * 选举只判**宿主**，不判是否真的被掐：后者要读会话快照（结束原因、step 状态），
 * 那要 hook，而 `select` 必须是纯函数。认领多了也不伤别人——同一链位上只有
 * deliverables 一个对手，条件已逐字对齐；我们当选而返回 null 时，尾部本来就
 * 什么都不显示（`closing` 为空时官方连操作行都不渲染）。
 * @param owner - chain owner（`{turn, seq, openFile}`，turn 是位置对象）。
 * @returns 选举结果（组件收作 `matched`），放弃为 null。
 */
function selectFrozenTail(owner: any): any {
  try {
    const loc = owner?.turn
    const tail = locationData(loc, 'turn-tail')
    if (tail === null || tail === undefined) return null
    const closing = tail.closing
    // 收尾消息可寻址时操作行会渲染，按钮由 actions 位挂——别抢链位。
    if (closing !== null && closing !== undefined && closing?.finalNode?.messageId !== undefined) return null
    if (deliverablesClaim(loc, owner?.seq)) return null
    return { turn: tail.turn, frozen: closing === null || closing === undefined }
  } catch {
    return null
  }
}

/**
 * 注册 slot 条目。
 * @param ctx - client cordis 上下文（inject 已带入 slots/sessions）。
 */
export function apply(ctx: any): void {
  const sessions = ctx.sessions

  if (typeof document !== 'undefined') {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.textContent = BUTTON_CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, 'dsh-continue-button: stylesheet')
  }

  const label = /^zh/i.test(typeof navigator !== 'undefined' ? navigator.language : 'zh')
    ? '继续生成'
    : 'Continue'

  const makeButton = (variant: 'tail' | 'actions') => (props: any): any => {
    const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : ''
    // chain 选举结果（0.1.5 冻结尾）；list 形态没有它，走下面的旧判据。
    const matched: any = variant === 'tail' && props?.matched !== null && props?.matched !== undefined
      ? props.matched
      : undefined
    // —— owner 直读（0.2.x list 位）：数字或整个 TurnLocation 对象。
    const owner: any = variant === 'tail' && matched === undefined ? props?.turn : undefined
    const ownerTurn: number | undefined = typeof owner === 'number'
      ? owner
      : typeof owner?.turn === 'number' ? owner.turn : undefined
    let ownerReason: string | undefined
    if (owner !== null && typeof owner === 'object') {
      const kind = owner?.end?.data?.reason?.kind
      if (typeof kind === 'string') ownerReason = kind
    }
    // actions 位按 messageId 反查（0.1.5 的 owner 只有 messageId）。
    const messageId: string | undefined = typeof props?.messageId === 'string' ? props.messageId : undefined

    const running = props.useSession?.((snapshot: any) => snapshot?.running ?? false) ?? false
    // hook 顺序纪律：以下 useChat 一律无条件调用，选择器只返回原语。
    let myTurn = typeof matched?.turn === 'number' ? matched.turn : -1
    let maxTurn = -1
    let lastOrderTurn = -1
    let endReason: string | undefined
    let text: string | undefined
    try {
      myTurn = props.useChat?.((chat: any): number => {
        if (typeof matched?.turn === 'number') return matched.turn
        if (ownerTurn !== undefined) return ownerTurn
        if (messageId !== undefined) {
          for (const data of tailDatas(chat)) {
            const mid = data?.closing?.finalNode?.messageId ?? data?.closing?.messageId
            if (mid === messageId && typeof data?.turn === 'number') return data.turn
          }
        }
        return -1
      }) ?? myTurn
      maxTurn = props.useChat?.((chat: any): number => {
        let m = -1
        for (const data of tailDatas(chat)) {
          // 只统计有收尾消息的 tail："继续"空轮次也有 turn-tail 节点（closing 为
          // null），但不构成可寻址的消息行——算进去会把真正的截断行遮住。
          if (data?.closing === null || data?.closing === undefined) continue
          if (typeof data?.turn === 'number' && data.turn > m) m = data.turn
        }
        return m
      }) ?? -1
      lastOrderTurn = props.useChat?.((chat: any): number => {
        const order = chat?.timeline?.turnOrder
        return Array.isArray(order) && order.length > 0 ? order[order.length - 1] : -1
      }) ?? -1
      if (ownerReason === undefined && myTurn >= 0) {
        endReason = props.useChat?.((chat: any): string | undefined => {
          const kind = chat?.timeline?.turns?.get?.(myTurn)?.end?.data?.reason?.kind
          return typeof kind === 'string' ? kind : undefined
        })
      } else {
        // 保持 hook 调用数稳定：占位选择器。
        props.useChat?.((): undefined => undefined)
      }
      text = props.useChat?.((chat: any): string | undefined => {
        if (myTurn < 0) return undefined
        for (const data of tailDatas(chat)) {
          if (data?.turn === myTurn) return closingTextOf(data?.closing)
        }
        return undefined
      })
    } catch { /* 快照形状变化时放弃相应判据 */ }

    if (running || myTurn < 0) return null
    // actions 位：本轮已由 turnTail 位渲染（0.2.x 同 commit 内先渲染）就让位。
    const dedupeKey = sessionId + '/' + myTurn
    if (variant === 'actions' && tailRenderedTurns.has(dedupeKey)) return null

    let reason: string
    if (matched !== undefined) {
      // 0.1.5 冻结尾：选举已确认"操作行挂不上 + 无交付物"。是否真的被掐、以及
      // 显示的时机在这里用快照判据定：只挂最后一轮，且要有被掐信号——结束原因
      // 非 completed（内核直接区分 aborted / max-tokens / error / blocked），或
      // 本 turn 存在 interrupted 的 assistant step。
      if (lastOrderTurn >= 0 && myTurn !== lastOrderTurn) return null
      const abnormal = endReason !== undefined && endReason !== 'completed'
      if (!abnormal && !hasInterruptedStep(props?.turn) && text !== '') return null
      reason = matched.frozen === true ? '思考阶段被截断' : '输出被截断'
    } else {
      // 只挂最后一个 turn tail：有更晚的 tail 就让位。
      if (maxTurn >= 0 && myTurn !== maxTurn) return null
      // 未完篇判定（任一即显示；全部拿不到就不显示）。
      const laterEmptyTurns = lastOrderTurn > myTurn
      const incomplete = (endReason !== undefined && endReason !== 'completed')
        || (typeof text === 'string' && text.length === 0)
        || laterEmptyTurns
        || (text !== undefined && hasUnclosedFence(text))
      if (!incomplete) return null
      reason = endReason !== undefined && endReason !== 'completed' ? `本轮结束原因 ${endReason}` : '本轮流式输出被截断'
    }

    const send = (): void => {
      try {
        const session = sessions?.binding?.(sessionId)?.session
        void session?.prompt?.([{ type: 'text', text: PROMPT_TEXT }], 'queue')
      } catch (error) {
        console.warn(`[${PLUGIN_ID}] 发送「${PROMPT_TEXT}」失败：`, error)
      }
    }

    if (variant === 'tail') {
      tailRenderedTurns.set(dedupeKey, true)
      if (tailRenderedTurns.size > 64) tailRenderedTurns.clear()
    }

    return (
      <button
        type="button"
        className={PLUGIN_ID}
        title={`${reason}——向会话发送「${PROMPT_TEXT}」`}
        onClick={send}
      >
        {label}
      </button>
    )
  }

  // 0.1.5 的 turnTail 是 chain：`select` 必填（缺了 register 直接 throw，条目不上
  // 账）；0.2.x 是 list：`id` 必填、`select` 被忽略。两个字段都给，两版同一份注册。
  ctx.slots.inject(SLOT_TURN_TAIL, () => ctx.slots.register({
    name: SLOT_TURN_TAIL,
    id: 'continue-generation',
    select: selectFrozenTail,
    order: 0,
  }, makeButton('tail')))
  ctx.slots.inject(SLOT_ASSISTANT_ACTIONS, () => ctx.slots.register({
    name: SLOT_ASSISTANT_ACTIONS,
    id: 'continue-generation-actions',
    order: 0,
  }, makeButton('actions')))
}
