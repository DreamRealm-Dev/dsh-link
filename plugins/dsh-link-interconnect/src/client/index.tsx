/**
 * dsh-link-interconnect - the client half (the browser's side of the interconnect framework).
 *
 * Two contributions, both owned by this plugin's fiber:
 *
 *   shell.overlay            the consent stack: a question waiting for the person has to find
 *                            them wherever they are, so it sits in the frame-wide floating layer.
 *   sidebar.footer.action    the "软件互联" entry at the sidebar foot, which opens
 *                            the peers/adapters/grants/audit surface (also an overlay entry).
 *
 * One poller is created here, inside apply(), and passed down as plain props: the components
 * never see ctx. Every registration is wrapped in ctx.effect, so disposing the fiber removes
 * the poller, the stylesheet and all three slot registrations together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: this half fills two slots the kernel declares, so their SlotMap entries must merge here.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, type ReactElement } from 'react'
import interconnectCss from './interconnect.css'
import { ConsentStack } from './consent.tsx'
import { InterconnectFooter, PeersPanel } from './peers.tsx'
import {
  createClientState,
  pendingConsentOf,
  type AdapterOp,
  type ClientSnapshotState,
  type ClientState,
  type CopyFace,
} from './state.ts'

/**
 * The two kernel slots this half fills. Their SlotMap entries are declared by kernel packages this
 * data-only half does not import for values, so the entries are merged here: each is a root-scoped
 * list slot, which is what the runtime declaration serves. Merging them (rather than casting the
 * names) is what makes the three `register` calls below check against the real SlotMap.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The frame-wide floating layer: a consent question has to find the person wherever they are. */
    'shell.overlay': { kind: 'list'; scope: 'root' }
    /** The sidebar's footer action row: the 软件互联 entry. */
    'sidebar.footer.action': { kind: 'list'; scope: 'root' }
  }
}

/** The client services this half waits for: without a slot registry there is nothing to draw into. */
export const inject = ['slots']

const PLUGIN_ID = 'dsh-link-interconnect'
const CONSENT_SLOT_ID = 'link-interconnect-consent'
const PANEL_SLOT_ID = 'link-interconnect-peers'
const FOOTER_SLOT_ID = 'link-interconnect-footer'
const CONSENT_ORDER = 55
const PANEL_ORDER = 54
const FOOTER_ORDER = 2
const MARKER = '__dshLinkInterconnectClient'

/** The one copy table this half draws; every user-visible sentence comes from here. */
export const COPY: CopyFace = {
  footerLabel: '软件互联',
  footerTitle: '软件互联：外部软件的接入、授权与审计',
  footerPendingSuffix: ' 个待确认',
  panelTitle: '软件互联',
  panelSubtitle: '外部软件与本机的连接、授权与审计',
  close: '关闭',
  ownId: '本机标识',
  peersTitle: '已接入软件',
  peersEmpty: '暂无外部软件接入',
  peerScopesEmpty: '未授予范围',
  revoke: '撤销',
  revoking: '撤销中…',
  adaptersTitle: '可接入软件',
  adaptersEmpty: '暂无适配器声明',
  adapterDetected: '已发现',
  adapterMissing: '未发现',
  adapterProbe: '探测',
  adapterConnect: '接入',
  adapterDisconnect: '断开',
  adapterBusy: '处理中…',
  adapterNoBinding: '未接入',
  grantsTitle: '授权范围',
  grantsEmpty: '暂无授权',
  auditTitle: '最近审计',
  auditEmpty: '暂无审计记录',
  auditOk: '成功',
  auditFail: '失败',
  riskLow: '低风险',
  riskMedium: '中风险',
  riskHigh: '高风险',
  allow: '允许',
  deny: '拒绝',
  deciding: '处理中…',
  consentAria: '外部软件接入请求',
  consentPeer: '来源',
  routePending: '主机路由尚未就绪，正在等待…',
  routeStale: '暂时读不到主机状态，显示上一次读数',
  updatedAt: '更新于',
  refreshing: '每 3 秒刷新',
  noData: '正在读取…',
  rpmSuffix: ' 次/分',
  statusActive: '已连接',
  statusPending: '待确认',
  statusUnavailable: '不可用',
  statusRejoin: '需重新接入',
  statusRevoked: '已撤销',
  bindingActive: '已接入',
  bindingUnavailable: '不可用',
  bindingRejoin: '需重新接入',
  bindingRevoked: '已撤销',
}

/** Subscribe one component to the one poller; the snapshot reference is stable between changes. */
function useClientSnapshot(state: ClientState): ClientSnapshotState {
  const [, setVersion] = useState(0)
  useEffect(() => state.subscribe(() => setVersion((version) => version + 1)), [state])
  return state.snapshot()
}

/**
 * The three registered components, closed over the one poller. Each one subscribes to the
 * poller and hands the pure component below it plain data and callbacks.
 * @param state - the poller this apply() created.
 * @returns the component types the slot registrations take.
 */
function createSlotComponents(state: ClientState) {
  function ConsentSlot(): ReactElement | null {
    const current = useClientSnapshot(state)
    return (
      <ConsentStack
        copy={COPY}
        pending={pendingConsentOf(current.data)}
        busy={current.busy}
        onDecide={(id, decision) => { void state.actions.decideConsent(id, decision) }}
      />
    )
  }

  function PanelSlot(): ReactElement {
    const current = useClientSnapshot(state)
    return (
      <PeersPanel
        copy={COPY}
        data={current.data}
        route={current.route}
        lastAt={current.lastAt}
        open={current.open}
        busy={current.busy}
        actionError={current.actionError}
        onClose={state.actions.closePanel}
        onAdapterOp={(op: AdapterOp, id: string) => { void state.actions.adapterOp(op, id) }}
        onRevoke={(peerLinkId: string) => { void state.actions.revokePeer(peerLinkId) }}
      />
    )
  }

  function FooterSlot(props: { wide?: boolean }): ReactElement {
    const current = useClientSnapshot(state)
    const counts = current.data === null ? null : current.data.counts
    return (
      <InterconnectFooter
        copy={COPY}
        wide={props.wide !== false}
        open={current.open}
        route={current.route}
        pending={counts === null ? 0 : counts.pendingConsent}
        peers={counts === null ? 0 : counts.peers}
        onToggle={state.actions.togglePanel}
      />
    )
  }

  return { consent: ConsentSlot, panel: PanelSlot, footer: FooterSlot }
}

/** Mount this package's stylesheet for exactly the plugin's lifetime (the repo's CSS-as-text idiom). */
function installStyles(ctx: ClientContext): void {
  // The effect contract takes a callback that returns a disposer; this one may return undefined when
  // there is no document (headless probe), which the runtime already treats as "nothing to dispose".
  // The assertion keeps that behaviour byte-identical instead of rewriting the callback.
  ctx.effect((() => {
    if (typeof document === 'undefined') return undefined
    const tag = document.createElement('style')
    tag.dataset.pluginCss = PLUGIN_ID + '/interconnect.css'
    tag.textContent = interconnectCss
    document.head.appendChild(tag)
    return () => {
      try {
        tag.remove()
      } catch (error) {
        void error
      }
    }
  }) as () => () => void, 'dsh-link-interconnect: stylesheet')
}

/** This half's own reading for a headless probe; data only, never a function, never a credential. */
function markClient(fields: Record<string, unknown>): void {
  try {
    const globals = globalThis as unknown as Record<string, unknown>
    const held = globals[MARKER]
    const base = held !== null && typeof held === 'object' ? held as Record<string, unknown> : {}
    globals[MARKER] = Object.assign({}, base, fields, { mounted: true })
  } catch (error) {
    void error
  }
}

/** Republish the live reading on every poll/state change. */
function publishMarker(current: ClientSnapshotState): void {
  const data = current.data
  markClient({
    route: current.route,
    lastAt: current.lastAt,
    open: current.open,
    busy: current.busy.length,
    linkId: data === null ? null : data.linkId,
    pendingConsent: data === null ? 0 : data.counts.pendingConsent,
    peers: data === null ? 0 : data.counts.peers,
    activePeers: data === null ? 0 : data.counts.activePeers,
    adapters: data === null ? 0 : data.adapters.length,
    bindings: data === null ? 0 : data.counts.bindings,
    audit: data === null ? 0 : data.audit.length,
    actionError: current.actionError,
  })
}

/**
 * Mount the browser half.
 * @param ctx - the client plugin context; every registration is bound to its fiber.
 */
export function apply(ctx: ClientContext): void {
  installStyles(ctx)
  const state = createClientState()
  ctx.effect(() => {
    state.start()
    return () => { state.stop() }
  }, 'dsh-link-interconnect: state poller')
  ctx.effect(() => {
    publishMarker(state.snapshot())
    return state.subscribe(() => { publishMarker(state.snapshot()) })
  }, 'dsh-link-interconnect: client marker')
  const components = createSlotComponents(state)
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: CONSENT_SLOT_ID, order: CONSENT_ORDER },
    components.consent,
  )), 'dsh-link-interconnect: consent card')
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: PANEL_SLOT_ID, order: PANEL_ORDER },
    components.panel,
  )), 'dsh-link-interconnect: peers surface')
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: FOOTER_SLOT_ID, order: FOOTER_ORDER },
    components.footer,
  )), 'dsh-link-interconnect: sidebar footer entry')
  markClient({
    slotIds: { consent: CONSENT_SLOT_ID, panel: PANEL_SLOT_ID, footer: FOOTER_SLOT_ID },
    pollIntervalMs: 3000,
  })
}
