# dsh-image-guard

给模型请求里的**图片数量**装一道硬上限：默认 **30 张**，**第 31 张读取即报错**。

## 为什么需要

2026-10-03 那个「操作 Chrome 做 Mensa 测试」的会话被烧死了：agent 每看一张截图调一次
`read_image`，共 31 次；工具结果**永久留在会话历史里**，于是此后每一次请求都携带 31 张图，
被上游 provider 直接拒绝：

```
400: {"type":"invalid_request_error","message":"Upstream request failed: [invalid_request_error] Too many images in request: 31 > 30"}
```

会话不是卡住，是每次派发都被拒——连用户说一句"继续"都会立刻再吃一次同样的 400。

DSH 自己有一条图片预算机制（`dsh-llm` 的 `offloadRequestImagesWithPolicy`），但它超限时是
**静默投影**：把最旧的图片换成占位符继续发。静默丢图会掩盖积累，而积累正是出事的根因。
本插件的取向相反：**失败要早、要说清楚**。

## 它怎么工作

两个接缝，两条防线（都不需要读任何服务，因此 `inject` 为空）：

| 接缝 | 时机 | 行为 |
|---|---|---|
| `tools/execute` | 工具执行**前** | 当「历史已有图片 + 本步已读图片 + 这 1 张」会超过上限时，**这一张不读**，直接返回可操作的错误结果（`isError: true`，`code: IMAGE_LIMIT`） |
| `agent/pre-step` | 请求**派发前** | 数一遍即将发送的 `messages` 里的图片块；若已超过上限，按 `onRequestExceed` 报错（默认 `error`），不让请求走到上游 |

计数口径是**持久历史里的图片块数量**，不是投影后的数量。每步开始时以新的历史重新计数，
所以「本步读了几张」不会跨步累积。

失败的工具结果（例如文件不存在）**不占额度**；非图片工具完全不受影响。

## 配置

```yaml
- insert:
    - id: image-guard
      name: dsh-image-guard
      config:
        maxImagesPerRequest: 30        # 上限，默认 30
        imageTools: [ read_image ]     # 算作"读图"的工具，默认 ['read_image']
        onRequestExceed: error         # error（默认，请求前报错）| warn（只记日志）
```

## 本机安装状态

已装到 `$DSH_HOME`，**没有**碰 `profiles/web/cordis.patch.yml`（那是别的任务在改的文件），
也没有跑 pnpm：

- junction：`$DSH_HOME\profiles\node_modules\dsh-image-guard` → `H:\mod\dsh-image-guard`
  （放共享层，`$DSH_HOME\profiles` 下所有 profile 都能解析到）
- 挂载行：`$DSH_HOME\cordis.patch.yml`（home 级补丁层，对每个 profile 生效）

卸载：删掉 home 补丁里那一段 + 删除 junction，重启 DSH。

> 生效方式：组合已包含该行（`dsh --profile web --dump-config` 可见）。profile 的
> `patchReload: live` 理论上会热加载，但宿主自己的 stdout 不落 `desktop.log`，我无法从
> 日志确认热加载是否已触发；要确定生效就**重启一次 DSH**。

## 验证（都已跑过）

```powershell
# 纯函数：计数与决策边界（14 项）
node H:\mod\dsh-image-guard\test\decide.spec.mjs

# 接缝行为：用假 ctx 驱动两个监听（9 项）
node H:\mod\dsh-image-guard\test\guard.spec.mjs

# 沙箱里真实加载（独立 DSH home，零 live 影响）
node H:\mod\dsh-anti-repeat-suite\scripts\verify-boot.mjs `
  "<install-dir>\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js" `
  H:\mod\_anti_repeat_sandbox\home2 49895
```

行为测试覆盖：历史 30 张放行 / 31 张在请求前报错；第 30 张放行、第 31 张被拒且**没有真正执行工具**；
拒绝结果带 `IMAGE_LIMIT` 与「第 31 张 / 上限 30 张」字样；`pwsh` 等非图片工具不受影响；
失败的读图不占额度；新一步按新历史重新计数。

## 与其它插件的分工

- 本插件管**图片条数**（防上游 400 把会话烧死）。
- `dsh-anti-repeat-suite`（`H:\mod\dsh-anti-repeat-suite`）管**复读/思考空转**，是另一件事。
- 两者互不依赖，可以单独装、单独卸。
