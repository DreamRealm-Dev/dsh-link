# dsh-link-interconnect

The software interconnect framework (link-interconnect/1). Design and milestones:
`docs/link-interconnect/PLAN.md` in the repository.

Two directions, one protocol:

- **LINK adapts software (adapter)**: a declarative `adapters/<id>/adapter.json` probes,
  identifies, asks the person, then binds a capability. OFM is adapter 0.
- **Software adapts to LINK (SDK)**: a peer exposes
  `GET /.well-known/link-interconnect.json`, implements `POST /link/v1/invoke`, and the
  zero-dependency SDK in `packages/link-interconnect-sdk` does the rest.

Surfaces:

| Route | Direction | Purpose |
| --- | --- | --- |
| `GET /link/v1/contract` | software reads LINK | read-only protocol document |
| `POST /link/v1/handshake[/confirm]` | pairing | challenge + signed confirm -> tokens |
| `POST /link/v1/invoke` | software -> LINK | one capability call, idempotent |
| `GET /link/v1/events` | software reads LINK | SSE call progress |
| `POST /link/v1/embed/token` | software -> LINK | short-lived embed token (M4) |
| `/link/v1/openai/v1/*`, `/link/v1/anthropic/v1/*` | software -> LINK | proxied model calls (M5) |
| `GET /api/dsh-link-interconnect/state` | the pane reads | the one snapshot the client draws |
