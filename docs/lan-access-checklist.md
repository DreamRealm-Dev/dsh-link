# 手机 / LAN 访问 — 落地前必读清单（经验存档）

> 计划中的"手机访问"插件动工前，先过这张清单。全部条目来自 DSH EAC 桌面端
> `sidecar/phone-bridge.js`（748 行完整 Web UI 反向代理）的实测教训，
> 细节见 `docs/eac-pitfalls-full.md` 第 4 节（#29-#37）。思路参照、未复制代码。

## 0. 先看 0.2.1 内核给了什么（能官方化的不自己造）

- `trustedHosts` 配置 + `resolveLanTrust`（`packages/bundle/web-app/src/index.ts`）：
  内核自带 LAN 信任围栏。EAC 时代的"Host/Origin 头改写"方案在 0.2.x 可以换成
  把 LAN 地址登记进 trustedHosts（或改写头，二选一，别都做）。
- 内核会为 LAN 打印 `(LAN: http://<addr>:<port>/?token=…)` 就绪行——token URL
  兑换 cookie 的语义与回环一致（30 天、authority 绑定、可重复兑换）。

## 1. 鉴权（三步，缺一步全 401 或整体卡死）

1. **token→cookie 服务端自兑 + 缓存**：手机带不来 HttpOnly cookie；桥持一份
   （内核重启 token 轮换 → 自动重兑）；手机自带的 dsh-auth-* 透传优先于缓存。
2. **兑换请求必须有界超时（EAC 用 8s）**：内核 accept 后不应答时 Promise 永不
   settle，整桥卡死在 await 上——这是"手机全挂但桌面正常"的经典形态。
3. cookie 绑定 **authority**（Host 头）：LAN 地址访问时 authority 是
   `192.168.x.x:port`，兑换与后续请求的 Host 必须一致。

## 2. WebSocket（phone-bridge 血泪最集中处）

- **WS 半开悬挂**：手机断网/杀进程常无 FIN/RST，pipe 永不 end → 内核会话永不
  回收。TCP keepalive 30s + 一端 close 显式 destroy 对端 + 活跃 socket 集合
  stop() 全量回收。（dsh-link 壳内 relay 已有心跳拆链实现 `relay_sockets`，
  LAN 面如另起服务直接复用同款心跳参数：15s 探测 / 45s 拆链。）
- **升级头必须发出前定稿**：HTTP 可以 401 后重试，WS 不行——cookie 先兑换
  （缓存命中同步走）再升级；兑换失败按无 cookie 尝试让上游 401 透传。
- **101 后已到达的初始 head 必须写给浏览器方向**——写错方向丢帧断流。
- 上游拒绝（426 等）状态码原样透传给浏览器。

## 3. HTTP 代理层

- **401 重放前先整缓冲请求体**：流只能消费一次；重放空体 + 原 content-length
  = 内核按空载荷 200 收场（静默数据丢失）。BODY_CAP 64MB 超限 413。
- 体重建（缓冲/gzip/HTML 注入）后 **delete transfer-encoding** 并显式
  content-length——双 framing 非法，Node http 直接 HPE 拒收。
- gzip 只压 unary JSON（`POST /api/*` + application/json），SSE/WS/静态透传；
  **首字节后撤销空闲超时**（`setTimeout(0)`）防长间隔 SSE 被掐。
- `up.on('error')` 统一 destroy res；`res.on('close')` 未写完 → destroy 上游——
  三个分支共用缺兜底则缓冲分支 end 永不触发。

## 4. 浏览器侧（手机端页面）

- **crypto.randomUUID polyfill**：LAN 明网 `http://192.168.x.x` 是非安全上下文，
  Chrome 92+ 不暴露 randomUUID → 内核 RpcId 生成崩、**全部 RPC 失败**、界面退回
  "选择工作区"冷启动。往 HTML `<head>` 注入 polyfill（getRandomValues 可用，
  手工拼 v4 UUID），内核源码不动。
- 回环 API 的 CSRF：浏览器里任意网页都能 `<img src=http://127.0.0.1:PORT/...>`
  打进来 → 只收 POST 且 `Sec-Fetch-Site: cross-site` 拒绝（浏览器自动附带；
  非浏览器工具不带该头放行）。
- **TOCTOU**：批准接口读 body 会 await 让出事件循环，期间 pairing 可能已轮换 →
  先捕获本请求看到的 pairing 对象，写回前复核不一致回 409。
- 配对 token 轮换语义：**断开连接必须轮换 cookie 值**（EAC 曾静态 "1" 一年有效）；
  重启密钥不变免重配对；`start` 重入但 pairing 过期/已决定时也要 rotate。
- LAN 地址选择优先 RFC1918（192.168/10./172.16-31），避开虚拟网卡 169.254.x。

## 5. 端到端验收清单（照 EAC 的回归思路，每条都要能失败）

- 手机扫码 → 配对 → 同意卡片弹出（面板关着也要弹）
- 会话/工作区列表非空（randomUUID polyfill 生效）
- 流式输出跨 SSE 长间隔不断流（空闲超时撤销生效）
- 手机断网 30s+ 再恢复：内核侧 WS 会话已回收、重连可用（半开拆链生效）
- 断开连接后旧 cookie 立即失效（轮换生效）
- 浏览器恶意页打 `http://<lan>:<port>/decide` 被拒（CSRF 生效）
