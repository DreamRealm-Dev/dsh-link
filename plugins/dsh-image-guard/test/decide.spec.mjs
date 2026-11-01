/**
 * dsh-image-guard 的纯函数单测（不需要 DSH 在跑）。
 * 用法：node test/decide.spec.mjs
 */
import { countImagesInMessages, decideRead } from '../lib/index.js';

const results = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ ok, label, actual, expected });
};

// ── 计数：三种真实形状 ──────────────────────────────────────────────────────
const plain = { role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:aa' } }] };
const inToolResult = {
  role: 'user',
  content: [
    { type: 'tool-result', toolCallId: 'c1', content: [{ type: 'image', attachment: { attachmentId: 'sha256:bb' } }] },
  ],
};
const textOnly = { role: 'assistant', content: [{ type: 'text', text: '没有图片' }] };
const mixed = {
  role: 'user',
  content: [
    { type: 'text', text: '看这两张' },
    { type: 'image', attachment: { attachmentId: 'sha256:cc' } },
    { type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'ok' }, { type: 'image', attachment: { attachmentId: 'sha256:dd' } }] },
  ],
};

check('空数组', countImagesInMessages([]), 0);
check('非数组输入', countImagesInMessages(undefined), 0);
check('只有文本', countImagesInMessages([textOnly]), 0);
check('顶层 image 块', countImagesInMessages([plain]), 1);
check('工具结果内的 image 块', countImagesInMessages([inToolResult]), 1);
check('混合（1 顶层 + 1 工具内）', countImagesInMessages([mixed]), 2);
check('31 张（复现事故形状）',
  countImagesInMessages(Array.from({ length: 31 }, () => inToolResult)), 31);

// ── 决策：第 31 张必须被拒 ──────────────────────────────────────────────────
check('历史 0 + 本步 0 → 允许（第 1 张）', decideRead(0, 0, 30), null);
check('历史 28 + 本步 1 → 允许（第 30 张）', decideRead(28, 1, 30), null);
check('历史 29 + 本步 0 → 允许（第 30 张）', decideRead(29, 0, 30), null);
check('历史 29 + 本步 1 → 拒绝（第 31 张）', decideRead(29, 1, 30), { projected: 31, max: 30 });
check('历史 30 + 本步 0 → 拒绝（第 31 张）', decideRead(30, 0, 30), { projected: 31, max: 30 });
check('历史 31（已经出事）→ 拒绝', decideRead(31, 0, 30), { projected: 32, max: 30 });
check('上限改成 5 时第 6 张被拒', decideRead(5, 0, 5), { projected: 6, max: 5 });

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.label}`);
  else {
    failed += 1;
    console.log(`  ✗ ${r.label}\n      期望 ${JSON.stringify(r.expected)}，实际 ${JSON.stringify(r.actual)}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
process.exit(failed === 0 ? 0 : 1);
