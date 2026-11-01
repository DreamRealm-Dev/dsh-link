const name = "repetition-guard";
const inject = [];

/**
 * Detect a trailing run of the SAME word — the classic "wait wait wait …" /
 * "počkat počkat …" loop a model can fall into. Returns true once at least
 * `threshold` consecutive identical words sit at the end of the text.
 *
 * 只统计含字母的词（2026-10-06 修正）：`[\p{L}\p{N}]+` 会把每个数字段当一个
 * "单词"，于是 SVG feColorMatrix 的 values="1 0 0 0 0 0 …"、坐标表、补零这类
 * 合法的长零串在阈值 10 下必然误判（liquid-glass 会话实测连续数轮在矩阵行中间
 * 被掐断，用户只能一直点"继续"）。语言性空转（wait wait / 好 好 好）的重复词
 * 至少含一个字母，仍然照抓。
 */
function trailingRepeatRun(text, tailChars, threshold) {
  const tail = text.slice(-tailChars).toLowerCase();
  const words = tail.match(/[^\W_]*\p{L}[^\W_]*/gu);
  if (!words || words.length === 0) return false;
  const last = words[words.length - 1];
  let run = 1;
  for (let i = words.length - 2; i >= 0; i--) {
    if (words[i] === last) run++;
    else break;
  }
  return run >= threshold;
}

function apply(ctx, config = {}) {
  const threshold = typeof config.threshold === "number" && config.threshold > 0 ? config.threshold : 12;
  const tailChars = typeof config.tailChars === "number" && config.tailChars > 0 ? config.tailChars : 160;

  ctx.on("llm/stream", async function* (options, next) {
    let reasoning = "";
    let visible = "";
    for await (const chunk of next()) {
      if (chunk.type === "reasoning-delta") {
        reasoning += chunk.text;
        if (trailingRepeatRun(reasoning, tailChars, threshold)) {
          ctx.logger.warn("repetition-guard: stopped a repeated-word loop in reasoning (tail: " + JSON.stringify(reasoning.slice(-48)) + ")");
          break;
        }
      } else if (chunk.type === "text-delta") {
        visible += chunk.text;
        if (trailingRepeatRun(visible, tailChars, threshold)) {
          ctx.logger.warn("repetition-guard: stopped a repeated-word loop in visible text (tail: " + JSON.stringify(visible.slice(-48)) + ")");
          break;
        }
      }
      yield chunk;
    }
  }, { global: true, prepend: true });
}

export { apply, inject, name, trailingRepeatRun };
