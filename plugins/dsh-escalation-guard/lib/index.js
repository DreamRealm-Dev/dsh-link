/**
 * dsh-escalation-guard —— dsh-hotfix 的运行时移植。
 *
 * 为什么存在：DSH 的 sandbox 升级检查（approveEscalation）会拒绝一切
 * "不比当前有效模式严格更宽" 的 sandbox_permissions 请求并 throw，整个工具调用
 * 随之失败。模型陷进去时（danger-full-access 下交替请求两种升级目标），每个
 * 带 sandbox_permissions 的调用都必然失败——桌面版实测一个子代理会话因此连烧
 * 20 次调用。原 hotfix 直接改 @deepseek-ai/dsh-sandbox 的 lib（每个安装点都要
 * 重打）；本插件的取向是**不改内核**：包装 tools/execute，捕到这个特征错误后，
 * 把 sandbox_permissions 从参数里剥掉再放行一次——升级检查发生在工具体执行
 * 之前，首次 next() 没有任何副作用，重试是安全的。
 *
 * 语义与 hotfix 一致：不（更）宽的升级请求 = 按当前有效模式照常执行（no-op）。
 * 0.2.1 已把"请求等于有效模式"修成直接返回；剩下"向更窄模式请求"仍会 throw，
 * 本插件兜住的正是这一类。
 *
 * 注意：日志里的工具入参是模型原始请求（带 sandbox_permissions）；重试的执行
 * 用剥掉该字段的参数。差异仅此一处，且审计语义上"模型要了什么"本就该照原样记。
 */

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'escalation-guard';

/** 不读任何服务：只用事件接缝，因此不需要 inject。 */
export const inject = [];

/** 内核升级检查的特征错误片段（packages/sandbox/sandbox/src/escalation.ts）。 */
const TRAP = 'is not strictly wider than this call';

/**
 * 装配插件。所有监听随插件卸载自动释放。
 * @param ctx - cordis 宿主上下文。
 * @param config - 行配置：{ enabled }（默认 true；不需要时直接 disabled 行即可）。
 */
export function apply(ctx, config = {}) {
  if (config.enabled === false) return;

  // 加载自报：dsh 把插件的 stdout 收进 journal，便于确认插件确实被加载。
  console.log('[escalation-guard] 已加载：不（更）宽的 sandbox 升级请求将按有效模式放行（dsh-hotfix 的运行时移植）');

  ctx.on('tools/execute', async (exec, next) => {
    try {
      return await next();
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message : String(error);
      if (!message.includes(TRAP)) throw error;
      // 命中升级陷阱：剥掉 sandbox_permissions，按当前有效模式重试。
      const args = exec?.arguments;
      if (args === null || typeof args !== 'object' || !('sandbox_permissions' in args)) throw error;
      const requested = args.sandbox_permissions;
      delete args.sandbox_permissions;
      ctx.logger?.warn?.(
        `[escalation-guard] 升级请求 ${JSON.stringify(requested)} 不宽于当前有效模式，已按有效模式放行（工具 ${exec.name}）。`,
      );
      return next();
    }
  });
}
