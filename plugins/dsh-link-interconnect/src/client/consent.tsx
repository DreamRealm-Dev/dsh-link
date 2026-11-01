/**
 * dsh-link-interconnect - the consent card.
 *
 * A pending question is a decision that unblocks a peer, so it has to find the person: the
 * stack sits fixed at the top-right, in the sidebar's own glass material, and shows at most
 * MAX_VISIBLE_CARDS questions at a time. Every card carries the question's title, the peer it
 * came from, the scopes it asks for and its risk badge; the two buttons answer through the
 * callback the apply world handed in - a card never reaches the host itself.
 */
import type { ConsentRequest } from '../protocol/types.ts'
import type { CopyFace } from './state.ts'
import { shortLinkId } from './state.ts'

/** The stack never grows past this many cards; the host's pending list may. */
export const MAX_VISIBLE_CARDS = 3

/** Props the apply world hands the stack; every member is plain data or a callback. */
export interface ConsentStackProps {
  copy: CopyFace
  pending: readonly ConsentRequest[]
  busy: readonly string[]
  onDecide: (id: string, decision: 'granted' | 'denied') => void
}

/**
 * The fixed top-right stack.
 * @param props - pending questions, in-flight write keys and the answer callback.
 * @returns the stack, or null when nothing is waiting.
 */
export function ConsentStack(props: ConsentStackProps) {
  const cards = props.pending.slice(0, MAX_VISIBLE_CARDS)
  if (cards.length === 0) return null
  return (
    <div
      className="dli-consentStack"
      data-link-consent-stack={String(cards.length)}
      data-link-pending={String(props.pending.length)}
    >
      {cards.map((request) => (
        <ConsentCard
          key={request.id}
          copy={props.copy}
          request={request}
          busy={props.busy.includes('consent:' + request.id)}
          onDecide={props.onDecide}
        />
      ))}
    </div>
  )
}

interface ConsentCardProps {
  copy: CopyFace
  request: ConsentRequest
  busy: boolean
  onDecide: (id: string, decision: 'granted' | 'denied') => void
}

function ConsentCard(props: ConsentCardProps) {
  const { copy, request } = props
  const details = detailRows(request.detail)
  return (
    <section
      className="dli-consent"
      role="group"
      aria-label={copy.consentAria}
      data-link-consent-card={request.id}
      data-link-consent-peer={request.peerLinkId}
      data-link-consent-risk={request.risk}
      data-link-consent-busy={props.busy ? 'true' : 'false'}
    >
      <header className="dli-consentHead">
        <span className={'dli-risk dli-risk-' + request.risk} data-link-consent-risk-badge={request.risk}>
          {riskLabel(copy, request.risk)}
        </span>
        <span className="dli-consentTitle" title={request.title}>{request.title}</span>
      </header>
      <div className="dli-consentPeer">
        <span className="dli-dim">{copy.consentPeer}</span>
        <span className="dli-peerName" title={request.peerName}>{request.peerName}</span>
        <span className="dli-mono" title={request.peerLinkId}>{shortLinkId(request.peerLinkId)}</span>
      </div>
      <div className="dli-chips" data-link-consent-scopes={request.scopes.join(' ')}>
        {request.scopes.map((scope) => <span className="dli-chip" key={scope}>{scope}</span>)}
      </div>
      {details.length === 0 ? null : (
        <dl className="dli-details">
          {details.map((row) => (
            <div className="dli-detailRow" key={row.label}>
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="dli-consentActions">
        <button
          type="button"
          className="dli-btn dli-btnGhost"
          disabled={props.busy}
          data-link-consent-decision="denied"
          onClick={() => props.onDecide(request.id, 'denied')}
        >
          {props.busy ? copy.deciding : copy.deny}
        </button>
        <button
          type="button"
          className="dli-btn dli-btnPrimary"
          disabled={props.busy}
          data-link-consent-decision="granted"
          onClick={() => props.onDecide(request.id, 'granted')}
        >
          {props.busy ? copy.deciding : copy.allow}
        </button>
      </div>
    </section>
  )
}

function riskLabel(copy: CopyFace, risk: ConsentRequest['risk']): string {
  if (risk === 'high') return copy.riskHigh
  if (risk === 'medium') return copy.riskMedium
  return copy.riskLow
}

/** At most four display rows from the request's detail map; never a credential (host guarantee). */
function detailRows(detail: Record<string, string> | undefined): { label: string; value: string }[] {
  if (detail === undefined) return []
  const rows: { label: string; value: string }[] = []
  for (const label of Object.keys(detail)) {
    if (rows.length >= 4) break
    rows.push({ label, value: String(detail[label]) })
  }
  return rows
}
