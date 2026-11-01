# Security model — link-interconnect

Deny by default, ask the person once, read no secret before they answer, and make every grant
revocable. This page states what the current build actually enforces and what it does not.

## 1. Trust boundaries

| Boundary | Rule in this build |
| --- | --- |
| Transport | Loopback HTTP only for LINK itself (the shell proxy listens on 127.0.0.1). A software peer may be reached beyond loopback only when named by the LAN allowlist (~~BT~~LAN.md~~BT~~). No TLS inside the process: the kernel is loopback, and the LAN path is the peer's own TLS if it serves https. |
| Inbound to LINK | The shell origin forwards ~~BT~~/link/*~~BT~~ to the kernel with its own session cookie; the protocol's own token is the only credential a peer presents. ~~BT~~/link/*~~BT~~ is the one path a foreign ~~BT~~Origin~~BT~~ may address (the embed page lives in a vendor iframe) and it receives no CORS headers, so a vendor page may frame the embed document but cannot read protocol answers. |
| Outbound from LINK | Only declared targets: adapter declarations (loopback bases, declared verify paths), peer origins (well-known + endpoints.invoke), and the models.proxy upstream (a deployment env channel). ~~BT~~redirect: 'error'~~BT~~ everywhere; no useragent-controlled URL is fetched on a peer's say-so. |
| A software peer | Untrusted until the person grants its scopes. Its declaration is data: unknown capability kinds are ignored, bodies are ceilings-checked, and its tool results are returned as text, never evaluated. |

## 2. Consent

- One question per peer binding (and per adapter connection). The card carries: who (peer name/vendor),
  what (capabilities and scopes), where (origin), and risk. It carries **no credential**.
- Credentials are read only after the answer is ~~BT~~granted~~BT~~; a denied question mints nothing, binds nothing,
  and rolls back.
- Every question, grant, denial, bind, unbind, invoke and revoke lands in ~~BT~~audit.jsonl~~BT~~ (kind, peer, cap, op,
  ok, code, ms, short detail) — arguments and secrets are never recorded.
- A grant is revocable: removing a peer releases its tools and provider, revokes the grant, and the
  next call answers ~~BT~~link/consent-required~~BT~~ / is simply absent.

## 3. Credentials and tokens

- Adapter credentials are read from the declared source at bind time and kept in memory. They are
  never written to ~~BT~~adapters.json~~BT~~, the audit, the log, the snapshot or the pane — the adapter suite asserts
  "the rotated key and the pre-consent key are absent from every written file".
- Protocol tokens are compact JWS (EdDSA), with a persisted ~~BT~~jti~~BT~~ blacklist. Revocation is immediate
  (~~BT~~POST /api/dsh-link-interconnect/tokens/revoke~~BT~~ for the app's own surface). Access 15 min,
  refresh 30 d, embed 10 min with ~~BT~~aud = framing origin~~BT~~.
- A software peer's bearer that LINK presents for peer tool/model calls is minted per add and held in
  memory only: after a restart the peer row is ~~BT~~rejoin-required~~BT~~, and no token is ever persisted.
- Proxy keys (~~BT~~lk_...~~BT~~) are stored **only as sha256**, with a model whitelist and a per-minute ceiling;
  the raw key is shown once at creation and never by any listing.

## 4. Embedding

A software UI embeds one LINK session by minting a 10-minute token for an explicit origin. The served
document carries ~~BT~~Content-Security-Policy: frame-ancestors <origin>~~BT~~ naming exactly that origin (never a
wildcard), runs no external script, and postMessages a one-time ~~BT~~nonce~~BT~~ to the framing page. Without the
token: 401. With a revoked ~~BT~~jti~~BT~~: 401. An ~~BT~~Origin~~BT~~ that does not equal the token audience: 401.

## 5. LAN policy (M6)

Loopback is always reachable. Any other host must be named by the LAN allowlist, read at apply from
~~BT~~<DSH_HOME>/link-interconnect/lan-allowlist.json~~BT~~ (~~BT~~{"hosts": ["<lan-ip>", "laptop.local:19510"]}~~BT~~) or from
~~BT~~LINK_PEER_ALLOWLIST~~BT~~ (comma-separated ~~BT~~host~~BT~~ / ~~BT~~host:port~~BT~~). There is no allow-all switch. Discovery over
multicast (reusing lan-bridge announce/grants) is planned, not shipped: today a LAN peer is added by its
origin URL, and its grant is the ordinary per-peer consent (see ~~BT~~LAN.md~~BT~~).

## 6. Known limits (named, not implied)

- Peer authentication is declaration-level today: a peer that accepts any bearer is trusted as far as
  the person's consent goes. Mutual key handshake (peer verifying LINK's JWS against LINK's published
  key) is the next step; the pairing-code handshake exists on the LINK side.
- The models.proxy upstream is one deployment-level OpenAI-compatible channel, not a per-peer routing
  table; a proxy key cannot select a model provider outside its whitelist.
- The shell proxy forwards the kernel session cookie for ~~BT~~/link/*~~BT~~; loopback is the boundary that makes that
  safe today. Binding the shell to a LAN interface requires its own authentication design (not shipped).
