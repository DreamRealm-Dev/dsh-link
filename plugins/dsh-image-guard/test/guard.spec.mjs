/**
 * dsh-image-guard 的接缝行为测试：用一个假 ctx 抓取插件注册的监听，
 * 然后按真实载荷形状驱动 agent/pre-step 与 tools/execute，
 * 验证「第 30 张放行、第 31 张被拒、非图片工具不受影响、兜底在请求前报错」。
 *
 * 不需要 DSH 在跑。用法：node test/guard.spec.mjs
 */
import { apply } from '../lib/index.js';

const handlers = new Map();
const logs = [];
const ctx = {
  on: (name, fn) => { handlers.set(name, fn); },
  logger: { info: (m) => logs.push(['info', m]), warn: (m) => logs.push(['warn', m]) },
};
apply(ctx, { maxImagesPerRequest: 30, imageTools: ['read_image'], onRequestExceed: 'error' });

const preStep = handlers.get('agent/pre-step');
const toolExec = handlers.get('tools/execute');
if (!preStep || !toolExec) throw new Error('插件没有注册两个接缝');

const results = [];
const check = (label, ok, detail = '') => results.push({ ok, label, detail });

const img = () => ({ type: 'image', attachment: { attachmentId: 'sha256:x' } });
const toolResultImg = () => ({ type: 'tool-result', toolCallId: 'c', content: [img()] });
const messagesWith = (n) => Array.from({ length: n }, () => ({ role: 'user', content: [toolResultImg()] }));

// ── 1) pre-step：30 张放行、31 张报错 ───────────────────────────────────────
const agent = {};
let preNext = 0;
await preStep({ agent, messages: messagesWith(30), signal: { aborted: false } }, async () => { preNext += 1; });
check('pre-step：历史 30 张 → 放行', preNext === 1, `next 调用 ${preNext} 次`);

let threw = null;
try {
  await preStep({ agent, messages: messagesWith(31), signal: { aborted: false } }, async () => {});
} catch (error) {
  threw = error;
}
check('pre-step：历史 31 张 → 请求派发前报错（兜底）', threw !== null && /图片上限/.test(threw.message), threw?.message ?? '没有报错');

// ── 2) tools/execute：第 30 张放行、第 31 张被拒 ───────────────────────────
const agent2 = {};
await preStep({ agent: agent2, messages: messagesWith(29), signal: { aborted: false } }, async () => {});

const exec = { name: 'read_image', agent: agent2, signal: undefined };
let ran = 0;
const okResult = await toolExec(exec, async () => { ran += 1; return { content: [img()], isError: false }; });
check('第 30 张：放行（真正执行了工具）', ran === 1 && okResult?.isError !== true, `ran=${ran}`);

const refused = await toolExec(exec, async () => { ran += 1; return { content: [img()], isError: false }; });
check('第 31 张：被拒（没有执行工具）', ran === 1, `ran=${ran}`);
check('第 31 张：返回工具错误结果', refused?.isError === true && refused?.error?.info?.code === 'IMAGE_LIMIT', JSON.stringify(refused?.error?.info));
check('第 31 张：错误文案点明第几张与上限', /第 31 张/.test(refused?.content?.[0]?.text ?? '') && /上限 30 张/.test(refused?.content?.[0]?.text ?? ''), refused?.content?.[0]?.text);

// ── 3) 非图片工具不受影响 ─────────────────────────────────────────────────
const agent3 = {};
await preStep({ agent: agent3, messages: messagesWith(31), signal: { aborted: false } }, async () => {}).catch(() => {});
let otherRan = 0;
await toolExec({ name: 'pwsh', agent: agent3 }, async () => { otherRan += 1; return {}; });
check('非图片工具（pwsh）不受上限影响', otherRan === 1, `ran=${otherRan}`);

// ── 4) 失败的工具结果不计数 ───────────────────────────────────────────────
const agent4 = {};
await preStep({ agent: agent4, messages: messagesWith(28), signal: { aborted: false } }, async () => {});
const failingExec = { name: 'read_image', agent: agent4 };
await toolExec(failingExec, async () => ({ isError: true, content: [{ type: 'text', text: 'Error: 文件不存在' }] }));
const afterFail = await toolExec(failingExec, async () => ({ content: [img()], isError: false }));
check('失败的读图不占额度（28+1 → 第 29 张仍放行）', afterFail?.isError !== true, JSON.stringify(afterFail?.error?.info));

// ── 5) 每步重置：新的一步重新按历史计数 ───────────────────────────────────
const agent5 = {};
await preStep({ agent: agent5, messages: messagesWith(29), signal: { aborted: false } }, async () => {});
await toolExec({ name: 'read_image', agent: agent5 }, async () => ({ content: [img()], isError: false }));
await preStep({ agent: agent5, messages: messagesWith(30), signal: { aborted: false } }, async () => {});
const afterStep = await toolExec({ name: 'read_image', agent: agent5 }, async () => ({ content: [img()], isError: false }));
check('新一步以新历史计数：历史 30 → 第 31 张被拒', afterStep?.isError === true, JSON.stringify(afterStep?.error?.info));

// ── 报告 ───────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.label}`);
  else { failed += 1; console.log(`  ✗ ${r.label}\n      ${r.detail}`); }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
