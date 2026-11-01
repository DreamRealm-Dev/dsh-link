# 标识（LOGO）使用说明

本文件回答一个问题：**界面各处的标志用哪一份素材、放在哪里、为什么。**
上位规范是 DSH 官方的 [BRAND_GUIDELINES.zh.md](../core/deepseek-harness/BRAND_GUIDELINES.zh.md)：
项目名可用缩写 "DSH"；**不要**在项目名与界面标识里使用完整的 "DeepSeek Harness" 商标或官方品牌素材，
以免让用户误以为有官方背书。本仓库是第三方桌面端，所以界面上的官方标志（鲸鱼 symbol、官方字标）
一律换成我们自己的设计。

## 素材来源

| 素材 | 出处 | 用途 |
|---|---|---|
| `set3/svg/symbol-v2.svg` | `C:\Users\<user>\Downloads\LOGO设计\dsh-link-logo\set3`（rev 3，作者自有设计） | 应用图标、侧边栏标志、首页标志、启动页标志 |
| `set3/svg/dsh-link-in-d.svg` | 同上（141.43 × 27.9 字标） | 侧边栏字标、启动页字标 |
| `set3/svg/symbol-v2-mono.svg` | 同上（同一几何、单一墨色） | 备选：需要单色标志的场合 |
| `set3/png/symbol-v2-{16…512}.png` | 同上 | 应用图标位图（已落盘，见下） |

仓库内的副本在 `plugins/dsh-link-brand/assets/`（见该目录的 PROVENANCE.md）。
两份生成物都由素材生成，均已入库：客户端 `src/client/marks.tsx`、外壳启动页 `src-tauri/src/core/brand_art.rs`。
生成命令见 `plugins/dsh-link-brand/README.md`。

## 用在哪（现状）

| 表面 | 素材 | 位置 | 现状 |
|---|---|---|---|
| 窗口 / 任务栏 / 开始菜单图标 | 白底板 + `symbol-v2`（见下节） | `src-tauri/icons/`（32/64/128/128@2x/icon.png + Square* + StoreLogo + icon.ico + icon.icns） | 已换 |
| 托盘图标 | 同上（32px 档） | `src-tauri/icons/32x32.png`（`lib.rs` 内嵌） | 已换 |
| 安装包图标 | `icon.ico` | `tauri.conf.json` 的 `bundle.icon`（NSIS 用同一份 ico） | 已换 |
| 侧边栏（展开）字标 | `dsh-link-in-d.svg`（高 16px） | `sidebar.brand.name` 槽位 | 本次接入 |
| 侧边栏（收起轨道）标志 24px | `symbol-v2.svg` | `sidebar.brand.mark` 槽位（仅轨道位） | 本次接入 |
| 首页（空会话）标志 34px | `symbol-v2.svg` | `conversation.hero.brand.mark` 槽位 | 本次接入 |
| 外壳启动页 / 失败页 | `dsh-link-in-d.svg`（内联，高 20px） | `src-tauri/src/core/shellpage.rs` | 本次接入 |

**一个表面只用一个字标**：字标 `dsh-link-in-d` 自己就含标志（鲸鱼在 `d` 的碗里），
所以展开态侧边栏只画字标；徽章 `symbol-v2`（环 + 鲸 + 平排的 LINK，设计上属于"没创意"的那版字样）
只在**方形且单独出现**的位置使用——收起轨道、首页标志、应用图标。两者并列会把 LINK 写两遍，
故不做联动锁排（lockup）。

槽位由客户端声明（`ui-sidebar`、`ui-conversation`）；未注册时它们的回退是**官方**鲸鱼图形
（侧边栏）、"DSH 本地构建"文本（名字）与官方动画鲸鱼（首页）——所以这三个槽位必须由我们填。
注册优先级取 `-1`：`single` 槽位渲染优先级最低的那一条，同优先级第二次注册会报错，
于是 `-1` 既能在官方 profile 构建里压过官方注册，又在本机 local 构建里只是普通注册。


## 应用图标：白底 + 多档

任务栏 / 托盘 / Explorer 是在**它们自己的底色**上画图标的，而我们的标志墨色是深色——
不带底板时，深色任务栏上只剩一圈蓝环。所以每个图标都是**白底小圆角矩形 + 居中标志**，
底板几何照抄上游图标的约定（只借几何，不借图形）：

| 平台 | 底板占画布 | 圆角占底板 | 依据 |
|---|---|---|---|
| Windows / 通用 | 93.75%（四周留 3.125%） | 18.75% | `apps/desktop/resources/icon-windows.svg` 的 `rx=192 / 1024` 与外层 `scale(0.9375)` |
| macOS（icns） | 80.47%（四周留 9.77%） | 22.46% | `icon-macos.svg` 的 `rx=230` 与外层 `scale(0.8046875)` |

底板色 `#FBFBFB`（同上游），标志占底板 84%。档位（多分辨率）：

| 产物 | 档位 |
|---|---|
| `assets/plated/windows-<n>.png`、`macos-<n>.png` | 16 / 24 / 32 / 48 / 64 / 128 / 256 / 512 / 1024 |
| `src-tauri/icons/*.png` | Tauri/商店槽位：32 / 48 / 64 / 128 / 256 / 512（`Square*` 按最近档映射） |
| `src-tauri/icons/icon.ico` | 16 / 24 / 32 / 48 / 64 / 128 / 256（PNG 帧） |
| `src-tauri/icons/icon.icns` | ic07(128) / ic08(256) / ic09(512) / ic10(1024) / ic11(32) / ic12(64)，用 macOS 底板几何 |

生成（可重跑，幂等）：

```sh
python plugins/dsh-link-brand/scripts/gen-app-icons.py
```

**换图标只有一半是"换文件"**：exe 的图标是 `tauri_build` 生成的 Windows 资源
（`resource.rc` 里 `32512 ICON "icons/icon.ico"`），而它既不声明图标为输入、cargo 也不会
因图标变化重跑——曾经出现"文件换了、exe 里还是旧图标"。`src-tauri/build.rs` 现在写了
`cargo:rerun-if-changed=icons`，图标一变资源就重建、重链。改完图标请跑一次
`cargo build`（或 `node scripts/debug.mjs`），并用下面这条核对 exe 里真正嵌的那份：

```sh
python .tmp/brand/check-exe-icon.py     # 与 src-tauri/icons/32x32.png 逐像素比对（当前 mean |Δ| = 0.000）
```

## 刻意不动的（以及原因）

- **客户端自绘的启动遮罩**（`dsh-boot` 的 "HARNESS" 文本）：那是官方客户端自己的界面，
  由官方 bundle 绘制，插件拿不到；我们的外壳只负责自己那份启动页（已换成自己的标志）。
- **favicon**（`favicon.svg` / `favicon-dark.svg`）：官方 bundle 提供，随内核一起发；
  桌面窗口没有标签页，不构成产品标识问题。要换得改官方 dist，暂不做。
- **窗口标题里的品牌词**：来自客户端 i18n 的 "DSH 本地构建"/"DSH Local Build"，
  用的是官方推荐的缩写 "DSH"，合规，因此保留。

## 回退方式（一处一动作）

- 侧边栏 / 首页三个槽位：从 profile 的 `dsh.profile.bundles` 去掉 `dsh-link-brand`，重启内核。
- 启动页标志：把 `shellpage.rs` 的 `.brand` 段换回 `<div class="wordmark">HARNESS</div>`。
- 应用图标：`src-tauri/icons/` 换成上一版文件（基线记录见 `.tmp/baseline/BASELINE.md`）。

## 验证

```sh
node plugins/build.mjs --check          # 四个插件的 8 份产物与源码一致
node .tmp/brand/probe-live.mjs          # 读实时页面：三个槽位画的是不是我们的标志
node scripts/screenshot.ps1 ...         # 桌面截图（启动页、任务栏图标）
```

## 素材许可与使用范围

本仓库的**代码**是 MIT；本文件涉及的**品牌素材**（标志、字标、变体、应用图标、启动页标志）不是 MIT，
而是 **CC BY-NC-SA 4.0**，规范仓库为 <https://github.com/DreamRealm-Dev/dsh-link-brand>
（tag `v1.0.0`；含完整 LICENSE、USAGE.md 与署名格式）。

- 本仓库内的副本（`plugins/dsh-link-brand/assets/`、`src-tauri/icons/` 的位图产物、启动页标志）
  仍适用 CC BY-NC-SA 4.0，不因所在仓库是 MIT 而变成 MIT。
- 允许：非商业共享/改编（署名 + 同许可）；原样使用以指向本项目（不暗示背书）。
- 不允许：商业使用、商标性使用、暗示与 DSH Link 或 DeepSeek 官方关联、换成别的名称的衍生品牌。
- 完整范围与署名格式：主仓库根目录 [`BRAND-ASSETS.md`](../BRAND-ASSETS.md)，素材仓库 `USAGE.md`。
