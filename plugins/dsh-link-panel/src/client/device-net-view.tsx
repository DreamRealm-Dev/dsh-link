/** R407 - the device ring, drawn. Geometry and semantics come from ./device-net (ringLayout); this file only paints,
 * so the rules that matter - network in the centre, the local machine pinned at twelve o'clock, offline devices kept on
 * the ring and dimmed - live in one tested function rather than in JSX. */
import { ringLayout, type DeviceRing } from './device-net'

interface DeviceLike { id: string, label: string, kind?: 'local' | 'lan' | 'phone' | 'unknown', online?: boolean, lastSeenAt?: number | null }

/**
 * @param props.devices - what the routes reported; the caller passes the local machine even when nothing else is connected.
 * @param props.note - an extra sentence (the ring's own note is drawn when it has one).
 */
export function DeviceNet({ devices, note }: { devices: DeviceLike[], note?: string | null }) {
  const ring: DeviceRing = ringLayout(devices, { size: 240 })
  const line = note ?? ring.note
  return (
    <div className="dsh-link-devices" data-device-ring="" data-device-online={ring.online} data-device-offline={ring.offline}>
      <svg viewBox={'0 0 240 240'} width="240" height="240" role="img" aria-label="设备网">
        <circle cx={ring.cx} cy={ring.cy} r={ring.radius} fill="none" stroke="var(--dsw-alias-border-l2, #2a2a2a)" strokeDasharray="3 5" />
        <circle cx={ring.cx} cy={ring.cy} r={34} fill="var(--dsw-alias-bg-layer-2, #1b1b1c)" stroke="var(--dsw-alias-border-l2, #2a2a2a)" />
        <text x={ring.cx} y={ring.cy + 4} textAnchor="middle" fontSize="10" fill="var(--dsw-alias-label-tertiary, #979da6)">互联层</text>
        {ring.nodes.map((node) => (
          <g key={node.id} data-device-node={node.id} data-device-online={node.online ? 'true' : 'false'}>
            <line x1={ring.cx} y1={ring.cy} x2={node.x} y2={node.y} stroke="var(--dsw-alias-border-l1, #1f1f1f)" />
            <circle cx={node.x} cy={node.y} r={11}
              fill={node.online ? 'var(--dsw-alias-bg-layer-2, #1b1b1c)' : 'var(--dsw-alias-bg-layer-1, #0f1115)'}
              stroke={node.online ? 'var(--dsw-alias-state-success, #22c55e)' : 'var(--dsw-alias-state-idle-primary, #d4d4d4)'}
              strokeWidth={2} opacity={node.online ? 1 : 0.5} />
            <text x={node.x} y={node.y + 24} textAnchor="middle" fontSize="9"
              fill={node.online ? 'var(--dsw-alias-label-secondary, #b8bec8)' : 'var(--dsw-alias-state-idle-primary, #d4d4d4)'}
              opacity={node.online ? 1 : 0.6}>{node.label}</text>
          </g>
        ))}
      </svg>
      <p className="dsh-link-devices-note" data-device-note="">{line ?? ('在线 ' + String(ring.online) + ' · 离线 ' + String(ring.offline))}</p>
    </div>
  )
}
