/**
 * dsh-continue-button —— host 半。
 *
 * 本插件的能力全在浏览器半（lib/client.js）：宿主半存在的唯一原因是让本包
 * 拥有一个 loader 行——客户端半扫描器按"组合里每一行所在的包"读 package.json
 * 的 `dsh.client` 字段。这里什么都不做，加载自报一行便于确认挂载。
 */

export const name = 'continue-button';

export const inject = [];

export function apply(ctx) {
  console.log('[continue-button] host row mounted (能力在浏览器半：助手消息操作行的「继续生成」)');
}
