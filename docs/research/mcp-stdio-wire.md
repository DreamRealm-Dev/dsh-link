# MCP over stdio：我们实现的**线格式**依据（R55）

> 这份文件是 R55 的**判据来源**：门里每条关于「线上到底该写什么」的断言都要能指回这里的一行字，否则就是我在猜协议。
> 采集时间：本机实测（`web_fetch` 于 2026-10，R55）；引文按原样摘录，出处是官方规范页。

## 一、传输（stdio）

出处：<https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>（stdio 一节）

原样引文（我实测抓到的英文原文）：

> - 客户端把 MCP 服务器**作为子进程**启动，并通过它的标准输入/输出通信。
> - 「Messages are individual JSON-RPC **requests, notifications, or responses**.」
> - 「Messages are **delimited by newlines**, and **MUST NOT contain embedded newlines**.」
> - 「The server **MAY** write UTF-8 strings to its **standard error** (`stderr`) for logging purposes. Clients MAY capture, forward, or ignore this log.」

**我们据此实现的四条硬规则**：
1. 一条消息 = 一行（`\n` 结尾），**行内不许有真实换行**——所以任何字符串里的换行必须在 JSON 字符串里转义（`\n` 两个字符），不是原样输出。
2. stdout **只**跑协议帧；日志走 **stderr**（我们的客户端把 stderr 当**可读的证据**收集，不当协议）。
3. 三种消息：**请求**（有 `id`）、**通知**（无 `id`，不回）、**响应**（有 `id`）。
4. 编码 UTF-8；解析按行而不是按块（一次 `data` 事件可能含半行或多行 —— 必须缓冲）。

## 二、生命周期（initialize）

出处：<https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle>

原样引文（示例请求里出现的字段）：`"protocolVersion": "2025-06-18"`（连同 `capabilities`、`clientInfo` 一起在 `initialize` 的 `params` 里）。
另据该页流程：客户端发 `initialize` → 服务器答 `initialize` 结果 → **客户端再发 `notifications/initialized`** 通知，之后才进入正常请求期。

**我们据此实现的硬规则**：
5. `initialize` 请求必须带 `params.protocolVersion`；`params` 里同时给 `capabilities` 与 `clientInfo`。
6. `notifications/initialized` 必须在收到 `initialize` **结果之后**发（顺序本身要被门读到：服务器侧记录收到的消息序列）。
7. 服务器回的 `protocolVersion` 与我们请求的不一致时，**不许当成功**：答复里要能看到协商结果（`negotiated`），不一致就按 `refused`/`protocol-error` 报。

## 三、工具面（tools）

出处：<https://modelcontextprotocol.io/specification/2025-06-18/server/tools>

原样引文：服务器若要支持工具，**必须**声明 `capabilities.tools`（示例里是 `{ "tools": { "listChanged": true } }`）。

方法名与结果形状：`tools/list`、`tools/call`；调用的结果里带 `content` 数组，元素形如 `{ "type": "text", "text": ... }`；失败用结果里的 `isError: true` 表示（**这是结果，不是传输失败**）。
这两条我们**不在本仓自证**，而是拿**内核自己出货的夹具服务器**当本地权威证据：`core/deepseek-harness/packages/mcp/mcp-client/tests/fixture-server.ts`（用官方 SDK 的 `McpServer` 写）里，`add`/`greet`/`fail`/`image`/`crash`/`admin.reset` 六个工具的形状分别是：
- 成功：`{ content: [{ type: 'text', text: String(args.a + args.b) }] }`；
- 失败：`{ content: [{ type: 'text', text: 'Something went wrong' }], isError: true }`（**`isError` 与 `content` 并存**）；
- 图片块：`{ type: 'image', data: <base64>, mimeType: 'image/png' }`（与文本块混在同一个 `content` 数组里）。

**我们据此实现的硬规则**：
8. `isError: true` 是**结果**：判词是 `tool-error`，**不是** `transport-error`，客户端之后必须仍然可用（能再发一次请求）。
9. `content` 是**数组**且元素是异构块：客户端不许假设只有文本（保留 `type`；`text` 只在有 `text` 的块上出现）。
10. 服务器不认识工具名时的**协议级错误**（JSON-RPC 错误对象）与上面的 `isError` 是两件事：前者进 `unknown-tool`（并把错误码带出来），后者进 `tool-error`。

## 四、JSON-RPC 2.0 错误码（我们门里夹具用的那六个）

- `-32700` 解析错误（Parse error）：收到的不是合法 JSON；
- `-32600` 非法请求（Invalid Request）：是 JSON 但不是合法 JSON-RPC 对象；
- `-32601` 方法不存在（Method not found）；
- `-32602` 非法参数（Invalid params）——**未知工具名用这一档**（与官方 server 实现一致：`tools/call` 的 `params.name` 不合法）；
- `-32603` 内部错误（Internal error）；
- 服务器自定义的 `-32000..-32099` 区间留给实现。
这些是 JSON-RPC 2.0 本身的定义（<https://www.jsonrpc.org/specification#error_object>），**不是** MCP 新增的。

## 五、我们**没有**（也不能）在本机证的部分（如实）

- 本机**没有安装**官方 MCP SDK（`@modelcontextprotocol/client`、`/server` 在 `core/deepseek-harness/node_modules` 与活档案 `profiles/web/node_modules` 里**都不存在**），也**不新增第三方依赖**。所以本轮的「对端」是**我们自己按上面这份依据写的夹具服务器**（一个**真子进程**），**不是**官方 SDK 服务器：两边都按这份文档说话，风险是「两个说谎者意见一致」。
- 因此**每一处实现依据都要能被门逐条读到**（例如「行内不许有真实换行」要用一个**带换行的工具结果**去证），而不是只靠我们对协议的记忆。
- 与官方 SDK 服务器的**真互操作**是**未验**的一条，记在 `STATUS.md` 与 `R55` 记档里；等哪天允许联网装 SDK 时再补。
