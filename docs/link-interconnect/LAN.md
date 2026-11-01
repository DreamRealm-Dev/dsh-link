# LAN peers — declaration and policy (M6)

## The declaration

Reaching a software peer beyond loopback is **off unless the host is named**. Two explicit sources, read
when the interconnect plugin applies:

    <DSH_HOME>/link-interconnect/lan-allowlist.json
    { "hosts": ["<lan-ip>", "laptop.local:19510"] }

    LINK_PEER_ALLOWLIST=<lan-ip>,laptop.local:19510

An entry is a host (any port on it) or a host:port authority. Matching is case-insensitive, on the
origin's authority only; loopback (127.0.0.1 / ::1 / localhost) needs no entry. A URL whose host is not
loopback and not allowlisted is refused by name: ~~BT~~link/bad-request~~BT~~ with the host in the sentence.

## Direction: LINK pulls, peers do not get an inbound door

DSH-LINK does not expose a LAN listener for the interconnect. In the software-active direction LINK is
the API client: it reads the peer's well-known declaration and later calls the peer's
~~BT~~POST {origin}/link/v1/invoke~~BT~~. So the LAN allowlist opens **egress**, not a port on the LINK side. The
only inbound surface remains the loopback shell origin.

## Discovery

Today: a person (or the pane) adds the peer origin URL; the origin must be allowlisted first.

Planned, and deliberately not invented here: reuse the lan-bridge announcement (deviceId, accepts,
effective grants) as the discovery channel, so a peer found on the LAN arrives with a device identity
and its grant intersection already computed by the existing multi-device contract
(~~BT~~plugins/dsh-lan-bridge/docs/MULTI-DEVICE-CONTRACT.md~~BT~~). No new broadcast format.

## What the grant means on a LAN

The per-peer consent is the same as on loopback: one question naming the peer, its capabilities and
its origin; scopes are the declaration's request intersected with what a person granted; tokens are
memory-only and restoring a peer after a restart is ~~BT~~rejoin-required~~BT~~. The peer's own ~~BT~~limits.rpm~~BT~~ is copied
into the grant.

## Measured M6 reading

A second process (the SDK echo service, bound to ~~BT~~0.0.0.0~~BT~~) was reached at this machine's LAN address
(~~BT~~<lan-ip>~~BT~~) after the allowlist named it, added by URL, consented, and bound (tools + model channel +
~~BT~~models:["echo-1"]~~BT~~), then removed. That is the "second process / second address" half of the M6 acceptance;
a literal second machine uses the same path, because the mechanism is an outbound HTTP client with an
allowlist, not a listener. See ~~BT~~READINGS-R475.md~~BT~~ for the rows and commands.
