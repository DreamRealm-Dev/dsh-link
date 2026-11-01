/**
 * dsh-link-interconnect - the peers surface and the sidebar footer entry that opens it.
 *
 * The footer entry is the one seat the shell gives a feature at the sidebar foot: a fresh id
 * beside Settings, an icon and a label, and the count of questions waiting. The surface it
 * opens is a panel anchored above that foot. Both are pure: data and callbacks arrive as
 * props, and neither knows where the snapshot came from.
 */
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AdapterStatus, AuditRecord, BindingState, Grant, PeerRecord, PluginSnapshot } from '../protocol/types.ts'
import type { AdapterOp, CopyFace, RouteReading } from './state.ts'
import { shortLinkId } from './state.ts'

/** Props of the sidebar footer entry. */
export interface InterconnectFooterProps {
  copy: CopyFace
  wide: boolean
  open: boolean
  route: RouteReading
  pending: number
  peers: number
  onToggle: () => void
}

/**
 * The sidebar foot entry: icon + label in the wide column, icon only in the 56px rail.
 * @param props - copy, column state, the waiting count and the open/close callback.
 * @returns the button.
 */
export function InterconnectFooter(props: InterconnectFooterProps) {
  const pending = props.pending
  const title = pending > 0
    ? props.copy.footerLabel + '：' + String(pending) + props.copy.footerPendingSuffix
    : props.copy.footerTitle
  return (
    <button
      type="button"
      className="dli-footerBtn"
      data-link-footer={props.open ? 'open' : 'closed'}
      data-link-footer-wide={props.wide ? 'true' : 'false'}
      data-link-footer-route={props.route}
      data-link-pending={String(pending)}
      data-link-footer-peers={String(props.peers)}
      data-open={props.open ? 'true' : 'false'}
      title={title}
      aria-label={props.copy.footerLabel}
      aria-pressed={props.open}
      onClick={props.onToggle}
    >
      <span className="dli-footerIcon"><IconLinkOutlineRegular size={16} /></span>
      {props.wide ? <span className="dli-footerLabel">{props.copy.footerLabel}</span> : null}
      {pending > 0 ? <span className="dli-footerCount" data-link-footer-count={String(pending)}>{pending}</span> : null}
    </button>
  )
}

/** Props of the peers surface. */
export interface PeersPanelProps {
  copy: CopyFace
  data: PluginSnapshot | null
  route: RouteReading
  lastAt: number | null
  open: boolean
  busy: readonly string[]
  actionError: string | null
  onClose: () => void
  onAdapterOp: (op: AdapterOp, id: string) => void
  onRevoke: (peerLinkId: string) => void
}

/**
 * The panel the footer opens: peers, adapters, grants and the last audit rows.
 * @param props - the last good snapshot, route reading, in-flight keys and callbacks.
 * @returns the open panel, or a hidden marker while closed.
 */
export function PeersPanel(props: PeersPanelProps) {
  const { copy, data } = props
  if (!props.open) return <div className="dli-panelHidden" data-link-panel="closed" aria-hidden="true" />
  const peers = data === null ? [] : data.peers
  const grants = data === null ? [] : data.grants
  const adapters = data === null ? [] : data.adapters
  const bindings = data === null ? [] : data.bindings
  const audit = data === null ? [] : data.audit
  const grantOf = (linkId: string): Grant | undefined => grants.find((grant) => grant.peerLinkId === linkId)
  const bindingOf = (adapterId: string): BindingState | undefined => bindings.find((binding) => binding.adapterId === adapterId)
  const content = (
    <div className="dli-panelHost" data-link-panel="open">
      <aside className="dli-panel" role="dialog" aria-label={copy.panelTitle}>
      <header className="dli-panelHead">
        <div className="dli-panelTitles">
          <h2 className="dli-panelTitle">{copy.panelTitle}</h2>
          <div className="dli-panelSub">{copy.panelSubtitle}</div>
        </div>
        <button type="button" className="dli-iconBtn" data-link-panel-close="" title={copy.close} aria-label={copy.close} onClick={props.onClose}>{'×'}</button>
      </header>
      <div className="dli-identity" data-link-own-id={data === null ? '' : data.linkId}>
        <span className="dli-dim">{copy.ownId}</span>
        <span className="dli-mono" title={data === null ? '' : data.linkId}>{data === null ? '—' : shortLinkId(data.linkId)}</span>
      </div>
      {props.route === 'live' ? null : (
        <div className="dli-routeNote" data-link-route={props.route}>
          {props.route === 'absent' ? copy.routePending : copy.routeStale}
        </div>
      )}
      {props.actionError === null ? null : (
        <div className="dli-actionError" data-link-action-error="">{props.actionError}</div>
      )}
      <div className="dli-scroll">
        <Section copy={copy} kind="peers" title={copy.peersTitle} count={peers.length} empty={copy.peersEmpty}>
          {peers.map((peer) => (
            <PeerRow
              key={peer.linkId}
              copy={copy}
              peer={peer}
              grant={grantOf(peer.linkId)}
              busy={props.busy.includes('revoke:' + peer.linkId)}
              onRevoke={props.onRevoke}
            />
          ))}
        </Section>
        <Section copy={copy} kind="adapters" title={copy.adaptersTitle} count={adapters.length} empty={copy.adaptersEmpty}>
          {adapters.map((adapter) => (
            <AdapterRow
              key={adapter.id}
              copy={copy}
              adapter={adapter}
              binding={adapter.binding ?? bindingOf(adapter.id)}
              busy={props.busy}
              onOp={props.onAdapterOp}
            />
          ))}
        </Section>
        <Section copy={copy} kind="grants" title={copy.grantsTitle} count={grants.length} empty={copy.grantsEmpty}>
          {grants.map((grant) => (
            <div className="dli-row" key={grant.peerLinkId} data-link-grant={grant.peerLinkId}>
              <div className="dli-rowMain">
                <span className="dli-mono" title={grant.peerLinkId}>{shortLinkId(grant.peerLinkId)}</span>
                {grant.rpm === undefined ? null : <span className="dli-dim">{String(grant.rpm) + copy.rpmSuffix}</span>}
              </div>
              <div className="dli-chips">
                {grant.scopes.length === 0
                  ? <span className="dli-dim">{copy.peerScopesEmpty}</span>
                  : grant.scopes.map((scope) => <span className="dli-chip" key={scope}>{scope}</span>)}
              </div>
            </div>
          ))}
        </Section>
        <Section copy={copy} kind="audit" title={copy.auditTitle} count={audit.length} empty={copy.auditEmpty}>
          {audit.slice(0, 8).map((record, index) => (
            <AuditRow key={record.at + ':' + String(index)} copy={copy} record={record} />
          ))}
        </Section>
      </div>
      <footer className="dli-panelFoot">
        {props.lastAt === null
          ? copy.noData
          : copy.updatedAt + ' ' + formatClock(props.lastAt) + ' · ' + copy.refreshing}
      </footer>
      </aside>
    </div>
  )
  // The panel lives on document.body: the shell's overlay layer sits inside the frame, whose
  // overflow clips an anchored panel and whose stacking order leaves it under the sidebar glass.
  // A body-level portal with its own fixed host is above both, and stays inside the viewport.
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

function Section(props: {
  copy: CopyFace
  kind: string
  title: string
  count: number
  empty: string
  children: ReactNode
}) {
  return (
    <section className="dli-section" data-link-section={props.kind}>
      <div className="dli-sectionHead">
        <span className="dli-sectionTitle">{props.title}</span>
        <span className="dli-sectionCount" data-link-section-count={String(props.count)}>{String(props.count)}</span>
      </div>
      {props.count === 0
        ? <div className="dli-empty" data-link-empty={props.kind}>{props.empty}</div>
        : <div className="dli-rows">{props.children}</div>}
    </section>
  )
}

function PeerRow(props: {
  copy: CopyFace
  peer: PeerRecord
  grant: Grant | undefined
  busy: boolean
  onRevoke: (peerLinkId: string) => void
}) {
  const scopes = props.grant === undefined ? props.peer.scopes : props.grant.scopes
  return (
    <div className="dli-row" data-link-peer={props.peer.linkId} data-link-peer-status={props.peer.status}>
      <div className="dli-rowMain">
        <span className="dli-rowName" title={props.peer.name}>{props.peer.name}</span>
        <span className="dli-mono" title={props.peer.linkId}>{shortLinkId(props.peer.linkId)}</span>
        <span className="dli-chip dli-chipState">{peerStatusLabel(props.copy, props.peer.status)}</span>
      </div>
      <div className="dli-chips">
        {scopes.length === 0
          ? <span className="dli-dim">{props.copy.peerScopesEmpty}</span>
          : scopes.map((scope) => <span className="dli-chip" key={scope}>{scope}</span>)}
      </div>
      <div className="dli-rowActions">
        <button
          type="button"
          className="dli-btn dli-btnGhost dli-btnSmall"
          disabled={props.busy}
          data-link-revoke={props.peer.linkId}
          onClick={() => props.onRevoke(props.peer.linkId)}
        >
          {props.busy ? props.copy.revoking : props.copy.revoke}
        </button>
      </div>
    </div>
  )
}

function AdapterRow(props: {
  copy: CopyFace
  adapter: AdapterStatus
  binding: BindingState | undefined
  busy: readonly string[]
  onOp: (op: AdapterOp, id: string) => void
}) {
  const detected = props.adapter.detected === true
  const binding = props.binding
  const opBusy = props.busy.some((key) => key.startsWith('adapter:') && key.endsWith(':' + props.adapter.id))
  const reason = props.adapter.reason ?? props.adapter.reasonCode ?? props.copy.adapterMissing
  return (
    <div
      className="dli-row"
      data-link-adapter={props.adapter.id}
      data-link-adapter-detected={detected ? 'true' : 'false'}
      data-link-adapter-binding={binding === undefined ? 'none' : binding.status}
    >
      <div className="dli-rowMain">
        <span className="dli-rowName" title={props.adapter.name}>{props.adapter.name}</span>
        <span className={'dli-chip ' + (detected ? 'dli-chipOk' : 'dli-chipMuted')} data-link-adapter-detection={detected ? 'detected' : 'missing'}>
          {detected ? props.copy.adapterDetected : props.copy.adapterMissing}
        </span>
        {binding === undefined || binding.providerId === undefined
          ? null
          : <span className="dli-mono" data-link-adapter-provider={binding.providerId} title={binding.providerId}>{binding.providerId}</span>}
      </div>
      <div className="dli-rowSub">
        {detected
          ? (binding === undefined
            ? <span className="dli-dim">{props.copy.adapterNoBinding}</span>
            : <span data-link-adapter-status={binding.status}>{bindingStatusLabel(props.copy, binding.status)}</span>)
          : <span className="dli-dim" data-link-adapter-reason={props.adapter.reasonCode ?? ''}>{reason}</span>}
      </div>
      <div className="dli-rowActions">
        <button
          type="button"
          className="dli-btn dli-btnGhost dli-btnSmall"
          disabled={opBusy}
          data-link-adapter-op="probe"
          onClick={() => props.onOp('probe', props.adapter.id)}
        >
          {opBusy ? props.copy.adapterBusy : props.copy.adapterProbe}
        </button>
        <button
          type="button"
          className="dli-btn dli-btnPrimary dli-btnSmall"
          disabled={opBusy || !detected || (binding !== undefined && binding.status === 'active')}
          data-link-adapter-op="connect"
          onClick={() => props.onOp('connect', props.adapter.id)}
        >
          {props.copy.adapterConnect}
        </button>
        <button
          type="button"
          className="dli-btn dli-btnGhost dli-btnSmall"
          disabled={opBusy || binding === undefined}
          data-link-adapter-op="disconnect"
          onClick={() => props.onOp('disconnect', props.adapter.id)}
        >
          {props.copy.adapterDisconnect}
        </button>
      </div>
    </div>
  )
}

function AuditRow(props: { copy: CopyFace; record: AuditRecord }) {
  const record = props.record
  const peer = record.peer === undefined ? null : shortLinkId(record.peer)
  return (
    <div className="dli-auditRow" data-link-audit={record.kind} data-link-audit-ok={record.ok ? 'true' : 'false'}>
      <span className="dli-chip dli-chipMuted">{record.kind}</span>
      {peer === null ? null : <span className="dli-mono" title={record.peer}>{peer}</span>}
      {record.cap === undefined ? null : <span className="dli-dim">{record.cap}</span>}
      <span className={record.ok ? 'dli-ok' : 'dli-fail'}>{record.ok ? props.copy.auditOk : props.copy.auditFail}</span>
      {record.ms === undefined ? null : <span className="dli-dim">{String(record.ms) + 'ms'}</span>}
    </div>
  )
}

function peerStatusLabel(copy: CopyFace, status: PeerRecord['status']): string {
  if (status === 'active') return copy.statusActive
  if (status === 'pending') return copy.statusPending
  if (status === 'unavailable') return copy.statusUnavailable
  if (status === 'rejoin-required') return copy.statusRejoin
  return copy.statusRevoked
}

function bindingStatusLabel(copy: CopyFace, status: BindingState['status']): string {
  if (status === 'active') return copy.bindingActive
  if (status === 'unavailable') return copy.bindingUnavailable
  if (status === 'rejoin-required') return copy.bindingRejoin
  return copy.bindingRevoked
}

/** HH:MM:SS without the page's locale formatter, so a reading is the same everywhere. */
function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => (value < 10 ? '0' + String(value) : String(value))
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}
