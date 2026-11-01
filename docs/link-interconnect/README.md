# link-interconnect docs

One protocol, two directions, five layers. Start here.

| Document | What it is |
| --- | --- |
| [PLAN.md](PLAN.md) | The approved design and milestones M1–M6, plus the R472 decisions. |
| [PROTOCOL.md](PROTOCOL.md) | **The stable public spec**: discovery, identity, handshake, invoke/events, codes, the four capabilities, the contract document. |
| [SDK.md](SDK.md) | The peer-side zero-dependency SDK: manifest, `serve()`, `linkClient()`, echo example. |
| [ADAPTERS.md](ADAPTERS.md) | The declarative adapter format, the frozen lifecycle, the 120-line budget, OFM as adapter 0. |
| [SECURITY.md](SECURITY.md) | Trust boundaries, consent order, credential rules, token/revocation, embed CSP, LAN policy, known limits. |
| [LAN.md](LAN.md) | LAN allowlist (deny by default), direction (LINK pulls), discovery plan, measured M6 reading. |
| [OFM-INTEGRATION.md](OFM-INTEGRATION.md) | Real OFM standalone runbook and what the R472 live loop used. |
| [EMBED-AND-PROXY.md](EMBED-AND-PROXY.md) | M4 embed v2 and M5 models.proxy: routes, matrix, wiring, limits. |
| [READINGS-R472.md](READINGS-R472.md) / [READINGS-R473.md](READINGS-R473.md) / [READINGS-R475.md](READINGS-R475.md) / [READINGS-R476.md](READINGS-R476.md) | The measured readings per round (M1–M5, M3, M6, and the real OFM install). |

## Quickstart

    # apply the plugin (profile install) and restart the app, then
    node scripts/link-interconnect-parse-check.mjs        # the local gate
    node scripts/link-interconnect-check.mjs --standalone # M1: 12/12
    node scripts/link-interconnect-live-accept.mjs        # M1–M5 against the running app: 31/31
    node scripts/link-interconnect-edge-check.mjs         # M4+M5 offline: 16/16
    node scripts/link-interconnect-sdk-check.mjs          # SDK: 18/18
    node scripts/link-interconnect-lan-check.mjs --prepare  # write this machine's LAN address into the allowlist
    #   ... restart DSH-LINK so the plugin applies it, then:
    node scripts/link-interconnect-lan-check.mjs --run      # M6 LAN second-process check: 8/8

## Where it lives

- kernel plugin: `plugins/dsh-link-interconnect/` (host 21 routes + client half, cordis-free below src/index.ts)
- shell forwarding: `src-tauri/src/core/proxy.rs` (`/link/*` -> kernel with its cookie, protocol headers passed through)
- SDK: `packages/link-interconnect-sdk/` (zero dependencies)
- gates: `scripts/link-interconnect-*.mjs`, `scripts/verify-adapter-budget.mjs`, `scripts/lib/interconnect-harness.mjs`
