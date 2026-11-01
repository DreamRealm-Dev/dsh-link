//! The shell's boot and recovery page.
//!
//! Served at `/__shell/` by [`super::proxy`] whenever the window asks for the root
//! before the kernel has a session. It is deliberately a single self-contained
//! document with no external assets: at that moment the kernel — and therefore the
//! official client's bundles — may not exist, so the page has to render from nothing.
//!
//! The layout is the official client's own boot overlay (`dsh-boot`): a centered
//! stack — the shell's own brand row (its mark and wordmark), 20px border spinner,
//! one hint line — on a flat light or dark surface, with failure details dropped
//! into the same palette. The brand is this project's own artwork: the upstream
//! mark is a registered trademark and this is a third-party desktop edition
//! (BRAND_GUIDELINES.zh.md). The values
//! (typography, colours, animation timing) are transcribed from the built client's
//! boot module so the handover from this page to the client's own overlay is
//! visually seamless.
//!
//! ## Which surface
//!
//! This page used to ask `(prefers-color-scheme: dark)` in a media query — the operating
//! system — which is the wrong question. The client's theme is a setting *inside* the
//! client, so a workspace the user had put in light mode still booted through a black page
//! whenever Windows was dark. The palette now comes from [`super::shellprefs`]: as this
//! document is served, the shell stamps `data-shell-palette` and the radius into it, so
//! the first paint is already the application's — not the system's — and a later change is
//! pushed to the live page by the same script that pushes it to the client's document.
//!
//! The window's frame ([`super::frame`]) is inlined here for the same reason it is served
//! separately for the client: both documents have to draw the same rounded corner, and
//! this one cannot fetch anything.

use super::brand_art::WORDMARK_SVG;
use super::frame::{FRAME_CSS, FRAME_JS};
use super::shellprefs::ShellPrefs;

/// Tokens [`render`] substitutes. Nothing else in the page is interpolated at request
/// time, so the template stays a document a reader can open as HTML.
const RADIUS_TOKEN: &str = "{{RADIUS}}";
const GAP_TOKEN: &str = "{{GAP}}";
const PALETTE_TOKEN: &str = "{{PALETTE}}";
const FILL_TOKEN: &str = "{{FILL}}";
const FRAME_CSS_TOKEN: &str = "{{FRAME_CSS}}";
const FRAME_JS_TOKEN: &str = "{{FRAME_JS}}";
const WORDMARK_TOKEN: &str = "{{WORDMARK_SVG}}";

/// The whole page as one HTML document, with the shell-owned values left as tokens.
pub const BOOT_PAGE_TEMPLATE: &str = r##"<!doctype html>
<html lang="zh-CN" data-shell-palette="{{PALETTE}}" data-shell-radius="{{RADIUS}}" data-shell-gap="{{GAP}}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DSH Link</title>
    <style>
      /* The window frame first, so the transparent surface and the rounded corner are in
         force before this page paints anything of its own. */
{{FRAME_CSS}}
    </style>
    <style>
      /* The shell's own values, stamped as the page was served. They are what makes the
         first paint the application's palette rather than the operating system's. */
      :root {
        --dsh-shell-radius: {{RADIUS}}px;
        --dsh-shell-gap: {{GAP}}px;
        --dsh-shell-fill: {{FILL}};
        --boot-label-primary: #0f1115;
        --boot-label-secondary: #61666b;
        --boot-label-tertiary: #81858c;
        --boot-border: rgb(0 0 0 / 10%);
        --boot-bg: #ffffff;
        color-scheme: light;
      }
      html[data-shell-palette='dark'] {
        --boot-label-primary: #f9fafb;
        --boot-label-secondary: #cfd3d6;
        --boot-label-tertiary: #adb2b8;
        --boot-border: rgb(255 255 255 / 12%);
        --boot-bg: #151517;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        display: grid;
        place-items: center;
        color: var(--boot-label-primary);
        font: 14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
          'Microsoft YaHei', sans-serif;
      }
      .card { display: flex; flex-direction: column; align-items: center; gap: 16px; }
      /* The brand row, drawn from the artwork inlined at compile time: the wordmark
         alone, because it already carries the symbol inside its 'd' — the badge beside
         it would set LINK twice. The ink follows the page's own label colour, so one
         markup serves both palettes while the design's blue stays blue. */
      .brand {
        color: var(--boot-label-primary);
        user-select: none;
      }
      .brand svg { display: block; }
      .brand .brand-wordmark { width: 101px; height: 20px; }
      .spinner {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid var(--boot-border);
        animation: boot-spin 0.8s linear infinite;
      }
      @keyframes boot-spin { to { transform: rotate(360deg); } }
      #state { margin: 0; font-size: 12px; line-height: 18px; color: var(--boot-label-tertiary); }
      /* The device net's bridge end: what this device is, the code a host must type, and
         the last thing a peer asked for. Hidden until the service reports itself, so a
         desktop boot page (and the recovery page) are unchanged. */
      #bridge {
        display: none;
        width: min(520px, calc(100vw - 48px));
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
      }
      #bridge[data-shown='1'] { display: flex; }
      .bridge-row {
        margin: 0;
        display: flex;
        gap: 10px;
        align-items: baseline;
        font-size: 12px;
        line-height: 18px;
        color: var(--boot-label-secondary);
      }
      .bridge-label {
        flex: none;
        width: 5em;
        color: var(--boot-label-tertiary);
      }
      .bridge-value { min-width: 0; word-break: break-all; }
      #bridge-code {
        font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono',
          Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
        font-size: 22px;
        line-height: 28px;
        letter-spacing: 0.24em;
        color: var(--boot-label-primary);
      }
      #bridge-code[data-paired='1'] {
        font-family: inherit;
        font-size: 12px;
        line-height: 18px;
        letter-spacing: normal;
        color: var(--boot-label-secondary);
      }
      #detail { display: none; max-width: 480px; flex-direction: column; gap: 8px; }
      #detail .title {
        font-size: 14px;
        line-height: 22px;
        font-weight: 600;
        color: var(--boot-label-primary);
      }
      #detail .item {
        font-family: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono',
          Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
        font-size: 12px;
        line-height: 18px;
        color: var(--boot-label-secondary);
        white-space: pre-wrap;
        word-break: break-all;
        margin: 0;
      }
      #detail button {
        margin-top: 8px;
        align-self: flex-start;
        height: 32px;
        padding: 0 16px;
        border-radius: 8px;
        border: 1px solid var(--boot-border);
        background: transparent;
        color: var(--boot-label-primary);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
      }
      #detail button:hover { border-color: var(--boot-label-tertiary); }
    </style>
  </head>
  <body>
    <!-- The window's surface. Markup rather than something the frame script adds, so the
         page still shows a solid window with no script running at all. -->
    <div id="dsh-shell-surface"></div>
    <main class="card" id="card">
      <div class="brand" role="img" aria-label="DSH Link">{{WORDMARK_SVG}}</div>
      <div class="spinner" role="status" aria-label="加载中"></div>
      <p id="state">正在启动服务…</p>
      <!-- The device net's bridge end. The pairing code is the one thing on this screen a
           human has to carry to the other machine, so it is the largest thing here. -->
      <div id="bridge">
        <p class="bridge-row">
          <span class="bridge-label">监听</span>
          <span class="bridge-value" id="bridge-listen">—</span>
        </p>
        <p class="bridge-row">
          <span class="bridge-label">配对码</span>
          <span class="bridge-value" id="bridge-code">——————</span>
        </p>
        <p class="bridge-row">
          <span class="bridge-label">上次请求</span>
          <span class="bridge-value" id="bridge-last">还没有请求</span>
        </p>
      </div>
    </main>
    <main id="detail">
      <p class="title">启动失败</p>
      <p class="item" id="message"></p>
      <p class="item" id="log"></p>
      <button id="retry">重试</button>
    </main>
    <script>
{{FRAME_JS}}
    </script>
    <script>
      // Poll the shell's own probe. It answers with the supervisor's phase, so the
      // page mirrors that phase in the hint line and hands over to the official
      // client exactly when the shell holds a usable kernel session.
      const card = document.getElementById('card')
      const detail = document.getElementById('detail')
      const state = document.getElementById('state')
      const PHASE = {
        stopped: '正在启动服务…',
        starting: '正在启动服务…',
        ready: '正在进入工作区…',
        failed: '启动失败',
      }

      function fail(status) {
        card.style.display = 'none'
        detail.style.display = 'flex'
        document.getElementById('message').textContent = status.message ?? ''
        document.getElementById('log').textContent = '日志：' + (status.log ?? '')
      }

      async function poll() {
        try {
          const response = await fetch('/__shell/status', { credentials: 'omit' })
          if (response.ok) {
            const status = await response.json()
            if (status.message) { fail(status); return }
            state.textContent = PHASE[status.phase] ?? status.phase
            if (status.phase === 'ready') { location.replace('/'); return }
          }
        } catch (error) {
          // The proxy is the thing being polled, so a failure here is expected while
          // the shell is still binding its listener.
        }
        await readBridge()
        setTimeout(poll, 750)
      }
      // The bridge end's own reading (see core::device_bridge). It is a second fetch on the
      // same timer rather than a second timer: this page has one clock, and the status block
      // must never disagree with the line above it about whether the shell is alive.
      const bridge = document.getElementById('bridge')
      const bridgeListen = document.getElementById('bridge-listen')
      const bridgeCode = document.getElementById('bridge-code')
      const bridgeLast = document.getElementById('bridge-last')
      const BRIDGE_PHASE = {
        starting: '正在启动',
        listening: '监听中',
        paired: '监听中',
        failed: '启动失败',
        stopped: '未启动',
      }

      function showLast(last) {
        if (!last) return '还没有请求'
        const verdict = last.ok ? '成功' : '拒绝 ' + (last.detail || '')
        const target = last.target ? ' ' + last.target : ''
        return last.cap + target + ' · ' + verdict + ' · ' + (last.ms ?? 0) + 'ms'
      }

      async function readBridge() {
        let status
        try {
          const response = await fetch('/__shell/bridge', { credentials: 'omit' })
          if (!response.ok) return
          status = await response.json()
        } catch (error) {
          return // the proxy is the thing being polled; a failure here is that failure
        }
        if (status.phase === 'stopped' && !status.address) {
          bridge.removeAttribute('data-shown')
          return
        }
        bridge.setAttribute('data-shown', '1')
        const where = status.address ? ' ' + status.address : ''
        bridgeListen.textContent = (BRIDGE_PHASE[status.phase] ?? status.phase) + where
        if (status.paired) {
          // A paired peer owns the row where the code was: the code is spent, and showing
          // it again would invite a second host to type a number that no longer pairs.
          bridgeCode.textContent = '已配对 ' + (status.paired.name || status.paired.deviceId)
          bridgeCode.setAttribute('data-paired', '1')
        } else {
          bridgeCode.textContent = status.pairingCode || '——————'
          bridgeCode.removeAttribute('data-paired')
        }
        bridgeLast.textContent = showLast(status.last) +
          (status.note ? ' · ' + status.note : '')
      }

      document.getElementById('retry').addEventListener('click', () => location.reload())
      poll()
    </script>
  </body>
</html>
"##;

/// Stamp the shell's window preferences into the page.
///
/// Substitution rather than a template engine: the values are a bounded number and one of
/// two words, and the two frame assets are the verbatim text of what the shell serves at
/// its own frame URLs, so the boot page and the client's document cannot drift apart. The
/// radius is printed through the default f64 formatting, so a stored `12.0` is stamped as
/// `12` — a valid CSS length either way, but one that reads like the file it came from.
pub fn render(prefs: &ShellPrefs) -> String {
    let fill = if prefs.palette().is_dark() {
        "#151517"
    } else {
        "#ffffff"
    };
    BOOT_PAGE_TEMPLATE
        .replace(FRAME_CSS_TOKEN, FRAME_CSS)
        .replace(FRAME_JS_TOKEN, FRAME_JS)
        .replace(WORDMARK_TOKEN, WORDMARK_SVG)
        .replace(PALETTE_TOKEN, prefs.palette().as_str())
        .replace(RADIUS_TOKEN, &format!("{}", prefs.radius()))
        .replace(GAP_TOKEN, &format!("{}", prefs.gap()))
        .replace(FILL_TOKEN, fill)
}
