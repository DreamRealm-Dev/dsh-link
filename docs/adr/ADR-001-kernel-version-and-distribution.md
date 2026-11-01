# ADR-001：内核版本模型与分发模型

**状态**：生效（版本模型部分为用户直接下发；分发模型部分为本轮决定，含 1 项未测事实）。
**前置**：`docs/handoff/R1-adr-version-scope.md`（版本范围）在本文档体系里即本 ADR 的上半条，正文不重复。

## 决定

1. **支持面**：跨版本加载器只面向**当前内核**（`dsh-v0.2.1-alpha.1` @ `5badb15`）与**未来更高版本**；`0.1.1` / `0.1.5` 只作**验证集**（证明方法与表通用），不为其提供落地支持。通用性靠「同一个版本无关解析器 + 每版本一个表文件」来承担（三条构造性断言见 R1 ADR；verifier 已在冻结 sha 上复核 **3/3 绿**）。
   **措辞更正（verifier 复核 B4）**：此前「加一段数据即可支持新版本，不改代码」**当前不成立**——新增版本段还要在 `compat/index.ts:12`（import）与 `:27`（TABLES 登记）各加一行，即两行代码。两个诚实选项：(a) 把表登记改成**目录自动发现**（glob `compat/table/*.ts`），口径才真正回到「只加数据」；(b) ADR 就按现状写「加一个表文件 + 两行登记」。在 compat 线选定之前，任何报告不得使用「零代码改动」的说法。
2. **分发模型**：**内核必须随安装包分发**。发布物对用户而言是「装完即可用」的单体，不得要求用户执行 `pnpm install` / `pnpm build`。

## 为什么

- 现状（代码可证）：`src-tauri/tauri.conf.json:25-27` 的 `bundle.resources` 只带 `resources/pnpm`（一个 pnpm 二进制），内核不是资源；`README.md:239-241` 自述「The kernel is a source checkout, so a fresh clone has no dependencies and no built web frontend until the setup steps run」；`package.json:11-16` 的可用启动路径是 `core:install` + `core:build`（即 `npm run setup`）。
- 于是**一台干净机器装完我们发布的 exe 跑不起来**——它没有内核。第 322 行「DSH-LINK 应该能升级而不丢失对话 / 缺失功能 / 无法启动」在当前形态下**没有实现路径**。
- 这一条同时是三条下游的前置：C12 升级、C3 手机版、创新部件 #1 的验收对象（版本矩阵需要"第二个内核版本"是**可获取的产物**，而不是只能在开发机上存在的 checkout）。

## 影响面（会返工什么）

| 不做 | 后果 |
|---|---|
| 加载器/矩阵 | 只能拿开发机 checkout 当第二列，验收结果不可分发、不可复现 |
| 升级（C12） | 「升级不丢对话」无从设计：没有随包内核就没有"旧包→新包"的实体 |
| 手机版（C3） | 手机不内置内核的前提成立，但"电脑端内核可被发现/被连接"依赖它是个可安装物 |

## 实现形态（可选，未定稿）

| 方案 | 代价 | 评价 |
|---|---|---|
| A. 随包带**预构建内核产物** + 本地 node/pnpm 运行时 | 包体大（未测）；需处理 node 运行时授权 | 与「轻量」目标冲突，需实测体积再定 |
| B. 首启在线执行 `pnpm install && pnpm build`（现状外挂） | 需要网络、首启数分钟、失败即"无法启动" | 与行 322 直接冲突 |
| C. A 的裁剪版：只带 `web` profile 实际用到的产物 + 固定 node | 需先产出"实际用到的产物"清单 | **倾向此路**，但清单与体积**未测**，下一轮用一次构建去量 |

## 未测 / 需实测的事实（不写成结论）

- 安装包体积（A/C 两种形态各是多少 MB）；`core/deepseek-harness` 构建产物中 `web` profile 实际加载的比例；首启时长（现状 B 形态）。
- 磁盘约束：本机 C/Q 盘各剩约 13–14 GB（行 45 要求 ≥20 GB），任何"多带一份内核产物"的方案必须先过体积关。

## 补充验收项：内核身份必须可判定（critic 复核 §2.1 的反例）

现状机制是**探测**：`compat/index.ts` 用 `DSH_LINK_KERNEL_VERSION` → `globalThis.__DSH_VERSION__` → 从 `process.cwd()` 逐级向上找 `@deepseek-ai/dsh-root` 的 `package.json`（最多 8 层）。于是：

- 方案 C（裁剪产物随包）如果不带根 `package.json`、或 cwd 不在 checkout 内，`installedKernel()` 返回 `null`，加载器抛 `UnsupportedError` —— **加载器在最想支持的分发形态上认不出内核**（实测：环境变量交什么信什么，`DSH_LINK_KERNEL_VERSION='dsh-v9.9.9-fake'` 原样返回，`tableFor('dsh-v9.9.9-fake')` → `undefined`）。
- 表里的 `commit` / `packageVersion` **从不与运行内核核对**（critic 变异体：把它们篡改成 `0000000` / `9.9.9` 仍然全绿）。

**决定**：内核身份从「探测」降级为「声明 + 校验」——随包分发时由壳把 `DSH_LINK_KERNEL_VERSION`（以及 commit）**显式注入**内核进程，并把「身份可用」写成 C12 / C3 的验收项之一；`installedKernel()` 增补 commit 校验口（表与运行内核不一致 → **报红，不静默**）。

## 门禁的作用域与例外（critic 复核 §3.2 第 6 条）

`docs/research/00-index.md` 写过「G1–G4 未绿不开工」。按线设门，且**不得**当作全项目总闸门：

| 线 | 门 | 何时跑 |
|---|---|---|
| 所有线共通 | `node scripts/verify-baseline.mjs`（内核 pin + 工作树干净 + surface sha 绑定）+ `node plugins/build.mjs --check` | 每轮第一步 |
| UI 线 | G1–G4（G3 含 `@supports not` 兜底三态） | 改 UI 的人合并前 |
| compat 线 | `verify-baseline` + `verify-compat-table` + `verify-compat-refusal` + `build --check`，且必须**先钉一个 commit sha** | 改 compat 的人合并前 |

**例外（已发生，正式记录）**：compat 线在 R1/R2 事实上绕过了「G3 未绿不开工」——理由是与 UI 线接口零重叠、且 G3 的关键路径尾部需要重启应用。此例外在 `docs/handoff/R2-freeze.md` 冻结后成立。门禁不得按「产物个数」断言（插件增减会误伤）。

## 回滚方式

本文档只锁「内核随包分发」这一条**性质**；实现形态（A/B/C）可替换。若要回滚，回滚的是性质本身——即接受"干净机器不可用、仅开发机可用"，并把该限制写进 README 首屏。回滚成本：0（只是一句话），但会让 C12/C3 与 #1 的验收标准各自降一档。
