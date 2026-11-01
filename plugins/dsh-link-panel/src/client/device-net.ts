/**
 * R406 - the device network, as a pure fold. The pane draws; this decides WHERE.
 *
 * Three rules come straight from the person who asked for it, and they are the reason this is not "a graph around the
 * current machine":
 *  1. the CENTRE is the NETWORK, not the local machine;
 *  2. the local machine keeps a FIXED position - twelve o'clock - so its place in the ring never depends on how many
 *     other devices happen to be connected (the ring grows, the local node does not move);
 *  3. a device that is not online stays ON the ring, drawn dim, and carries when it was last seen - nothing disappears
 *     because a list that silently shrinks cannot be trusted to say "all your devices are here".
 *
 * Measured state of the world it must handle first: this machine currently has NO peer at all
 * (`/__shell/bridge` answers {"phase":"stopped"}, the bridge state route needs a POST and answers no peers), so the
 * honest first picture is one lit node and an empty ring with a sentence saying so - not a decoration of invented nodes.
 */

/** Where a device sits in the ring, and how it is drawn. */
export interface DeviceNode {
  readonly id: string
  readonly label: string
  readonly kind: 'local' | 'lan' | 'phone' | 'unknown'
  readonly online: boolean
  /** Milliseconds since the epoch, or null when the route has never said. */
  readonly lastSeenAt: number | null
  /** Degrees, measured clockwise from twelve o'clock. */
  readonly angle: number
  readonly x: number
  readonly y: number
}

/** One ring, ready to draw. */
export interface DeviceRing {
  readonly cx: number
  readonly cy: number
  readonly radius: number
  readonly centreLabel: string
  readonly nodes: DeviceNode[]
  readonly online: number
  readonly offline: number
  /** The sentence a reader needs when the ring holds nothing but this machine. */
  readonly note: string | null
}

const DEG = Math.PI / 180

/**
 * Place the devices on the ring.
 * @param devices - what the routes reported, in any order.
 * @param options - the geometry and the words the caller wants.
 * @returns the ring, with the local machine pinned at twelve o'clock.
 */
export function ringLayout(
  devices: Array<{ id: string, label: string, kind?: DeviceNode['kind'], online?: boolean, lastSeenAt?: number | null }>,
  options: { size?: number, radius?: number, centreLabel?: string, localId?: string } = {},
): DeviceRing {
  const size = options.size ?? 240
  const radius = options.radius ?? size * 0.36
  const cx = size / 2
  const cy = size / 2
  const localId = options.localId ?? null
  const withKind = devices.map((device, index) => ({
    id: device.id,
    label: device.label,
    kind: device.kind ?? 'unknown',
    online: device.online !== false,
    lastSeenAt: device.lastSeenAt ?? null,
    index,
  }))
  // The local machine is whichever device is flagged local (or the one the caller named); it always takes twelve
  // o'clock, and the others are placed clockwise AFTER it in the order they were reported.
  const localAt = withKind.findIndex((device) => device.kind === 'local' || (localId !== null && device.id === localId))
  const local = localAt >= 0 ? withKind[localAt] : null
  const rest = withKind.filter((device) => device !== local)
  const ordered = local === null ? rest : [local, ...rest]
  const count = Math.max(ordered.length, 1)
  const step = ordered.length > 1 ? 360 / count : 0
  const nodes: DeviceNode[] = ordered.map((device, slot) => {
    const angle = slot * step
    return {
      id: device.id,
      label: device.label,
      kind: device.kind,
      online: device.online,
      lastSeenAt: device.lastSeenAt,
      angle,
      x: cx + radius * Math.sin(angle * DEG),
      y: cy - radius * Math.cos(angle * DEG),
    }
  })
  const online = nodes.filter((node) => node.online).length
  const offline = nodes.length - online
  return {
    cx, cy, radius,
    centreLabel: options.centreLabel ?? '局域网 · 互联层',
    nodes, online, offline,
    note: nodes.length <= 1 ? '环上只有本机：目前没有其他设备连上互联层' : null,
  }
}
