/**
 * dsh-image-guard —— 给模型请求里的图片数量装一道硬上限。
 *
 * 为什么需要：DSH 自己有一条"图片预算"机制（dsh-llm 的 offloadRequestImagesWithPolicy），
 * 但它在超限时是**静默投影**——把最旧的图片换成占位符，继续发请求；而这次事故里，
 * 上游（opencode-go 路由）直接在 provider 侧拒了：`Too many images in request: 31 > 30`。
 * 结果是会话被自己烧死：31 张 read_image 结果永久留在历史里，此后每一次请求都必然 400。
 *
 * 本插件的取向是**失败要早、要说清楚**，而不是静默丢图：
 *   1) `tools/execute` 拦在工具执行前——当"历史已有图片 + 本步已读图片 + 这 1 张"会超过
 *      上限时，这一张**不读**，直接返回一条可操作的错误（第 31 张读取即报错）；
 *   2) `agent/pre-step` 兜底——如果图片从别的路径（用户上传附件等）进了上下文，
 *      在请求派发前就报错，而不是等上游回一个看不懂的 400。
 *
 * 计数口径是**持久历史里的图片块数量**，不是"请求投影后的数量"：投影会掩盖积累，
 * 而积累正是出事的根因。
 */

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'image-guard';

/** 不读任何服务：只用事件接缝，因此不需要 inject。 */
export const inject = [];

const DEFAULT_MAX = 30;
const DEFAULT_IMAGE_TOOLS = ['read_image'];
const DEFAULT_ON_EXCEED = 'error';

/**
 * 数一份消息数组里出现的图片块数量。
 * 只认 `{type:'image'}` 内容块——附件引用与内联图片都长这样。
 * @param messages - 即将派发的消息数组（durable 历史）。
 * @returns 图片块出现次数。
 */
export function countImagesInMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let count = 0;
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'image') count += 1;
      // 工具结果里的图片嵌在 tool-result 块内部
      if (block?.type === 'tool-result' && Array.isArray(block.content)) {
        for (const inner of block.content) if (inner?.type === 'image') count += 1;
      }
    }
  }
  return count;
}

/**
 * 这次读图会不会越过上限（纯函数，便于单测）。
 * @param historyImages - 本次请求历史里已有的图片数。
 * @param addedThisStep - 本步内已经读进来的图片数。
 * @param max - 上限。
 * @returns 允许则 null，否则返回拒绝原因所需的数字。
 */
export function decideRead(historyImages, addedThisStep, max) {
  const projected = historyImages + addedThisStep + 1;
  return projected > max ? { projected, max } : null;
}

/** 工具错误结果的形状与 @deepseek-ai/dsh-tool-call-timeout-policy 保持一致。 */
function refusalResult(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'ImageLimitError', code: 'IMAGE_LIMIT' } },
  };
}

/**
 * 装配插件。所有监听随插件卸载自动释放。
 * @param ctx - cordis 宿主上下文。
 * @param config - 行配置：{ maxImagesPerRequest, imageTools, onRequestExceed }。
 */
export function apply(ctx, config = {}) {
  const max = Number.isInteger(config.maxImagesPerRequest) && config.maxImagesPerRequest > 0
    ? config.maxImagesPerRequest
    : DEFAULT_MAX;
  const imageTools = Array.isArray(config.imageTools) && config.imageTools.length > 0
    ? config.imageTools.map(String)
    : DEFAULT_IMAGE_TOOLS;
  const onRequestExceed = config.onRequestExceed === 'warn' ? 'warn' : DEFAULT_ON_EXCEED;

  /** 每个 agent 一份状态；agent 被回收即随之消失。 */
  const perAgent = new WeakMap();
  const stateOf = (agent) => {
    let state = perAgent.get(agent);
    if (state === undefined) {
      state = { history: 0, addedThisStep: 0, warned: false };
      perAgent.set(agent, state);
    }
    return state;
  };

  // 加载自报：dsh 把插件的 stdout 收进 journal，便于确认插件确实被加载。
  console.log(`[image-guard] 已加载：图片上限 ${max} 张，拦截工具 ${imageTools.join('/')}，超限策略 ${onRequestExceed}`);

  // ── 兜底：请求派发前检查持久历史里的图片数 ────────────────────────────────
  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (signal?.aborted) return next();
    const state = stateOf(agent);
    state.history = countImagesInMessages(messages);
    state.addedThisStep = 0;
    if (state.history > max) {
      const message =
        `图片上限：本会话上下文里已有 ${state.history} 张图，超过上限 ${max} 张。` +
        `本次请求不会派发（上游也会拒：Too many images in request）。` +
        `请开一个新会话继续，或先把历史里的图片去掉——继续积累只会让每一步都失败。`;
      if (onRequestExceed === 'error') throw new Error(`image-guard: ${message}`);
      if (!state.warned) {
        state.warned = true;
        ctx.logger?.warn?.(`[image-guard] ${message}`);
      }
    }
    return next();
  });

  // ── 主闸：第 N+1 张图片读取时直接拒绝 ─────────────────────────────────────
  ctx.on('tools/execute', async (exec, next) => {
    if (!imageTools.includes(exec.name)) return next();
    const state = stateOf(exec.agent);
    const hit = decideRead(state.history, state.addedThisStep, max);
    if (hit !== null) {
      const message =
        `图片上限 ${hit.max} 张：本会话历史已有 ${state.history} 张，本步已读 ${state.addedThisStep} 张，` +
        `再读这张就是第 ${hit.projected} 张，已拒绝读取（不会进入上下文）。` +
        `请不要再读图：用已获得的信息继续，或让用户开新会话/先清掉旧图片。`;
      ctx.logger?.warn?.(`[image-guard] ${message}`);
      return refusalResult(message);
    }
    const result = await next();
    if (result?.isError !== true) state.addedThisStep += 1;
    return result;
  });
}
