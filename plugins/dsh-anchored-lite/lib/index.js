/**
 * anchored-lite —— 按需工具申请（Anchored 思路的本机实现）
 *
 * 设计意图参考 `<eac-checkout>\dsh-desktop\assets\agent-presets\
 * anchored-standard\tool-bootstrap.mjs`，但按本机实际情况重写，不是照抄。
 * 与参考实现的三处实质差异（都来自本机实测约束，不是偏好）：
 *
 *  1. 发现工具不同。参考实现自带自研的 `dev_tool_search` / `skill_search` /
 *     `skill_load` 三个工具；本插件改用 DSH 内置的 `cordis_inspect_list`
 *     （实测存在于 @deepseek-ai/dsh-tool-cordis）作为申请入口，少一套要维护的代码。
 *
 *  2. 不设 `bootstrapMaxTokens`。参考实现的注释明确写：Minimal 工具 schema 只在
 *     adapter 默认 maxTokens（256000）下才锚定成功，设了 cap 会退回 standard 行为
 *     （26/32 跑出 "We need" 风格）。但那是官方 endpoint 的结论，本机引擎是另一回事：
 *     NInfer 的 KV 池只有 8192 token（--kv-capacity 8192），而引擎包 docs/04 §1
 *     第 11 条记载：客户端 max_tokens 远超池 token 数会触发
 *     `worker crash: Paged KV reservation invariant was violated`，且 /v1/models
 *     仍返回 200（健康检查骗人）。所以"不封顶"在本机会崩。
 *     取舍：不设 cap，让 --default-max-tokens 4096 兜底（已 <= 池，安全）。
 *
 *  3. 冷启动工具对按本机可用性裁剪。参考实现用 bash + str_replace_editor；
 *     本机 bash 已改指Git Bash（profiles/web/cordis.patch.yml 的 terminal-bash 行），
 *     str_replace_editor 存在（@deepseek-ai/dsh-tool-str-replace-editor）。
 *     少一个工具都不影响锚定意图，缺任一个则降级为完整目录而不是抛错。
 *
 *  阶段模型（R219 起与参考实现有一处实质不同，见下）：
 *    阶段1 冷启动 —— 只暴露 bootstrapTools。
 *                    **不再剥离自动注入的上下文**（AGENTS.md 摘要 + skill 目录）：那是本插件
 *                    第二个「请求前缀会变」的来源。请求前缀 = 工具块 + 系统/上下文 + 历史，
 *                    缓存按前缀逐字节命中，所以「工具变了」已经要重算一次；再剥一次上下文就是
 *                    同一会话里的第二次整段重算。R219 把两次变一次：只留工具裁剪。
 *                    代价讲清楚：参考实现的锚定现象依赖「无 skill 目录」，去掉剥离后锚定是否
 *                    仍出现，本插件不再保证——这里优先缓存与经济性，不优先复现参考行为。
 *    阶段2 提升后 —— 只保留 bootstrapTools + residentTools + 模型自己通过
 *                    cordis_inspect_list 显式解锁的。**不一次性倒出完整目录**，
 *                    参考实现说那会把轨迹拉回 standard 行为（zero 变体实测的回归）。
 *
 *  阶段判定从持久事件推导（session/event），因此 resume / reload 保持阶段。
 */

export const name = 'anchored-lite'

/**
 * 刻意不声明 inject：本插件只监听事件、不在加载期碰服务。
 * 它必须排在 agent.cordis.yml 的第一行——这样它先于 dsh-agent-instructions
 * 和 dsh-tool-skill 注册，而 waterfall 的 after-next 变换按注册顺序倒序生效，
 * 于是"剥离注入"这一步成为最后一道变换（真正移除后续监听器注入的内容）。
 * 另外下面两个监听器都用 prepend:true，保证不受宿主流监听器和行序变动影响。
 */
export const inject = []

/** 每一阶段都计入"提升信号"的持久事件类型。 */
const PROMOTE_EVENTS = ['tool/call', 'assistant/message']

/** 本插件接受的全部 config 键——多一个就是拼写错误，在挂载时就报错而不是静默。 */
const ALLOWED_KEYS = new Set(['bootstrapTools', 'residentTools', 'suppressedContextSources', 'logPhase'])

/** 冷启动阶段剥离的自动注入来源。两者都是 agent/pre-step 的自动注入。 */
// R219: the constant stays only so a config that names these sources is not rejected. The suppression
// itself was removed: it was the SECOND request-prefix change in every session, and one is the budget.
const REMOVED_SUPPRESSED_SOURCES = ['skill-catalog', 'agent-instructions']

/**
 * 冷启动默认工具对。参考实现的实测：Minimal 这一对在 5/5 跑中锚定成功，
 * 而所有 standard 系schema（pwsh/read、pwsh only、sandboxed bash/read）全部
 * 11/11 退回 standard 行为。所以这里就用这一对，不加不减。
 */
const DEFAULT_BOOTSTRAP_TOOLS = ['bash', 'str_replace_editor']

/**
 * 提升后常驻的发现工具。只留 DSH 内置的那个申请入口 + skill 检索。
 * read/write/edit/glob/grep 刻意不常驻——bash + str_replace_editor 已覆盖文件工作。
 */
const DEFAULT_RESIDENT_TOOLS = ['cordis_inspect_list', 'skill_search']

function stringListOrEmpty(value, field) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
    throw new TypeError(`${name}: ${field} must be an array of non-empty strings`)
  }
  return [...new Set(value)]
}

function stringList(value, field, fallback) {
  const list = stringListOrEmpty(value, field)
  return list.length === 0 ? fallback : list
}

export function apply(ctx, config) {
  const source = config === undefined ? {} : config
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter((k) => !ALLOWED_KEYS.has(k))
  if (unknown.length > 0) {
    throw new TypeError(`${name}: unknown config key(s) ${unknown.join(', ')} — allowed: ${[...ALLOWED_KEYS].sort().join(', ')}`)
  }

  const bootstrapTools = stringList(source.bootstrapTools, 'bootstrapTools', DEFAULT_BOOTSTRAP_TOOLS)
  const residentTools = stringList(source.residentTools, 'residentTools', DEFAULT_RESIDENT_TOOLS)
  // R219: the key is still read so an existing config is not rejected, and it is NAMED in a warning
  // instead of being silently ignored. Nothing is suppressed any more.
  if (source.suppressedContextSources !== undefined) {
    void stringListOrEmpty(source.suppressedContextSources, 'suppressedContextSources')
    ctx.logger.warn(name + ': suppressedContextSources is accepted but IGNORED since R219 - stripping the injected context was a second request-prefix change per session; only the tool surface is narrowed now')
  }
  const logPhase = source.logPhase === true

  /** sessionId -> 是否已提升。事件流持久，重启后重扫一次即可恢复，无需落盘。 */
  const promoted = new Set()

  ctx.on('session/event', (session, event) => {
    if (promoted.has(session.id)) return
    if (PROMOTE_EVENTS.includes(event.type)) promoted.add(session.id)
  })

  const isPromoted = (agent) => {
    const sid = agent?.session?.id ?? agent?.sessionId
    return sid !== undefined && promoted.has(sid)
  }

  /** 把已组装好的目录裁剪到 keep 集合；缺工具时降级而非抛错。 */
  const narrow = (assembled, keep, allowFullOnMissing) => {
    if (!Array.isArray(assembled?.tools)) return assembled
    const available = new Set(assembled.tools.map((t) => t.name))
    const missing = [...keep].filter((n) => !available.has(n))
    if (missing.length > 0) {
      ctx.logger.warn(
        `${name}: 缺少 ${missing.join(', ')} —— ${allowFullOnMissing ? '冷启动裁剪已停用，暴露完整目录' : '按现有可用工具继续'}`,
      )
      if (allowFullOnMissing) return assembled
    }
    return { ...assembled, tools: assembled.tools.filter((t) => keep.has(t.name)) }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      if (isPromoted(context.agent)) {
        const keep = new Set([...bootstrapTools, ...residentTools])
        return narrow(assembled, keep, false)
      }
      if (logPhase) ctx.logger.info(`${name}: 冷启动阶段（仅 ${bootstrapTools.join(', ')}）`)
      return narrow(assembled, new Set(bootstrapTools), true)
    } catch (error) {
      // 过滤器的 bug 绝不能搞死整个会话——降级为完整目录。
      ctx.logger.warn(`${name}: 工具裁剪失败，暴露完整目录: ${String(error?.message ?? error)}`)
      return assembled
    }
  })

  // R219: the agent/pre-step listener is GONE. It filtered the injected context messages, which was the
  // second thing a session could change about its own request prefix. One change per session is the budget:
  // the tool surface narrows through the hook above, and nothing else touches the prefix.
}
