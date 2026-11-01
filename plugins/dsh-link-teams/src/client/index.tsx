/**
 * dsh-link-teams — Client half: the right-rail pane over the collaboration bus's control ledger.
 *
 * Registered the way every browser module is: the loader executes this file only to register a factory,
 * then materialises it on first import.
 *
 * The pane is a READER: it polls one GET route (`/api/dsh-link-teams/state`, served by this package's host
 * half) and draws the world that answer carries. It holds no state beyond the last document it read and
 * never sends a write - directing the team is a message to the lead in the chat box, which is what the
 * footer says.
 *
 * The words are not this file's: `locales.ts` owns the copy, `apply` registers both dictionaries in one
 * call on the kernel's own locale service, and every slot registration declares `locale: NS` so the
 * framework hands the components their `t` seat. The pure half (`view.ts`) turns the route's document
 * into the rows and labels drawn here, which is what lets a self-check read the pane's own view in both
 * languages without a browser.
 *
 * Three shapes of "nothing" are told apart on purpose, because a reader cannot act on them the same way:
 * the bus is not mounted (503 + named code), the ledger is empty, or the ledger has activity but no
 * declarations (members and tasks, yet no team tree and no capability registry - that is what the
 * declaring tools exist to fill).
 *
 * The task board draws the dependency graph the bus folds (edges, ready, blocked, missing/orphans,
 * cycles, tombstones), because that graph is the only structure the official Team service still produces
 * under depth 1 - the work is what gets split, not the agents. A task with no recorded blocker gets no
 * dependency line: the pane does not dress "no blockers" up as a field.
 *
 * R196: the tree draws the team the ROUTE serves, which now includes a team the ledger only names in its
 * task/member rows (a real session team never declared itself). A team whose id carries the round's
 * fixture naming is withheld by the host half and only its count is shown.
 *
 * R193: this half ALSO puts one `action` row into the LINK panel's contribution seam, and that row opens
 * the tab kind this file registers - so the team tree, the task board and the control ledger are
 * reachable from the panel rather than only from the rail. The row is declared fail-closed: a page with
 * no panel service, no locale service or a right column that refuses the open keeps this half's tab
 * type, its two slots and its page, and the refusal is named in this package's own marker.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import teamsCss from './teams.css'
import { en, NS, zh, type TeamsKey, type Translate } from './locales.ts'
import { TeamMindmap } from './mindmap.tsx'
import {
  boardCycles, boardOrphans, boardSummary, declaredOnlyCapabilities, fixturesNote, headChips, ledgerLine, malformedNote,
  agentNetwork, currentSessionId, hiddenTestRecords, memberEntries, peerEntries, quarantineEntries, streamEntries, taskEntries, treeEntries, withheldNote,
  type NetGroup, type NetNode,
} from './view.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This package's copy: the pane chrome, the board, the member rows and the ledger list. */
    'dsh-link-teams': TeamsKey
  }
}

type Doc = Record<string, unknown>

/** Where the pane reads the folded world. */
const API_PATH = '/api/dsh-link-teams/state'
/** How often the pane re-reads it. */
const POLL_MS = 2000

/**
 * Kernel session list: the one reading that says whether a session's agent is running right now.
 *
 * R479: the control ledger names a teammate's session but never says it is working (its own team row has
 * `members: 0`, so the mind map's "first member's state" falls back to idle). This route is the same origin the
 * pane already reads, so the runtime fact arrives beside the ledger fact.
 */
const RUNTIME_PATH = '/api/session/list'
/** The tab type this package fills in the right Sidebar. */
const TAB_KIND = 'link-teams'
/** The key both slot registrations use, so the body and the chip are one seat. */
const TAB_ID = 'dsh-link-teams:panel'
/** The client-face service the LINK panel publishes: `declare(definition) -> disposer`. */
const LINK_PANEL_SERVICE = 'linkPanel'
/** The client-face service that owns the right column; `openTab(kind)` is its method. */
const SIDEBAR_RIGHT_SERVICE = 'sidebarRight'
/** This package's one contribution. Namespaced, so two packages cannot collide on an id. */
const PANEL_ITEM_ID = 'dsh-link-teams:open-panel'
/** The seam's word for "something to do": its closed kind set is pane / action / status. */
const PANEL_ITEM_KIND = 'action'
/** Who the item belongs to: this package, spelled as its package name. */
const PANEL_ITEM_SOURCE = 'dsh-link-teams'
/** After the connection reading (20) and the browser's own action (30), before the guide entry (40). */
const PANEL_ITEM_ORDER = 32
/** Where this half records what its contribution did; the panel's own marker is the panel's. */
const PANEL_MARKER = '__dshLinkTeamsPanel'
/** How many times the panel's action was asked for, in this page. */
let PANEL_INVOKES = 0

/** Required services: the slot registry, the tab-type registry, and the dictionaries the seat draws from. */
/* R452: 'sessions' joined the list so the pane may select a session: Cordis resolves ctx.get against the declared
 * injections in this scope, and without the declaration the strict read answered null while the service existed. */
export const inject = ['slots', 'sidebarRightTabs', 'locale', 'sessions']

/** The props the seat hands a pane: the namespace-bound translate. */
interface PaneProps {
  readonly t: Translate
}

const TOK = {
  border: 'var(--dsw-alias-border-l2, #3a3a3a)',
  ink: 'var(--dsw-alias-label-primary, #ddd)',
  ink2: 'var(--dsw-alias-label-secondary, #bbb)',
  ink3: 'var(--dsw-alias-label-tertiary, #999)',
  fill: 'var(--dsw-alias-fill-l1, #1b1b1b)',
  active: 'var(--dsw-alias-interactive-bg-active, #2d3a4d)',
}

const S = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 8,
    padding: '8px 10px', fontSize: 12, color: TOK.ink, overflow: 'auto',
  },
  head: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  chip: (active: boolean) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 10,
    border: '1px solid ' + TOK.border, background: active ? TOK.active : 'transparent',
    fontSize: 11, color: TOK.ink2, whiteSpace: 'nowrap' as const,
  }),
  card: { border: '1px solid ' + TOK.border, borderRadius: 8, background: TOK.fill, padding: '6px 8px' },
  cardTitle: { fontSize: 11, color: TOK.ink3, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', lineHeight: 1.5 },
  grow: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  btn: {
    padding: '2px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 11,
    border: '1px solid ' + TOK.border, background: 'transparent', color: TOK.ink,
  },
  meta: { color: TOK.ink3, fontSize: 11, lineHeight: 1.6, wordBreak: 'break-all' as const },
  dep: { color: TOK.ink3, fontSize: 11, lineHeight: 1.6, paddingLeft: 13, wordBreak: 'break-word' as const },
  errWide: { color: '#ff8a8a', fontSize: 11, wordBreak: 'break-word' as const },
  err: { color: '#ff8a8a', fontSize: 11, wordBreak: 'break-all' as const },
  dot: (color: string) => ({ width: 7, height: 7, borderRadius: 4, background: color, flex: '0 0 auto' as const }),
}

const TASK_COLOR: Record<string, string> = { pending: '#c9a227', in_progress: '#3f8cff', completed: '#3fa46a', deleted: '#777' }
const MEMBER_COLOR: Record<string, string> = { provisioning: '#c9a227', active: '#3fa46a', failed: '#e05252' }

/**
 * The rail entry's glyph: the first-party set's users icon, the one name in this half that draws a
 * glyph. It is drawn at 16x16 in `currentColor` with the set's one-pixel stroke, like the panel's and
 * the markdown tab's glyphs, and `IconUsersOutline*` is not the shell's own sidebar chrome, so the rail
 * entry cannot read as another tab.
 * @param props - the size and class the seat asks for.
 * @returns the icon.
 */
function Glyph(props: { readonly size?: number; readonly className?: string }) {
  return <IconUsersOutlineRegular size={props.size} className={props.className} />
}

/**
 * The pane body: poll the route, then draw the world it answered with.
 * @param props - the seat's props for this body (the translate seat).
 * @returns the pane.
 */
/* R452: "click a team row to enter that session". The client runtime provides `sessions` with an
 * `open(id)` that selects a listed session as current (dsh-client-runtime/lib/client.js: "Select a listed or
 * retained catalog-addressed session as current"), so the pane binds it once at apply() and the rows call it.
 * A page without that service keeps the rows as plain read-only text and says so in the panel mark. */
let openSessionById: ((id: string) => void) | null = null

/** The session id a team row addresses, or null for a row that is not a session (synthetic team ids). */
function sessionIdOf(teamId: unknown): string | null {
  if (typeof teamId !== 'string' || teamId === '') return null
  if (teamId.startsWith('session-') && teamId.length > 'session-'.length) return teamId
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(teamId)) return 'session-' + teamId
  return null
}

/**
 * Open the session a team row names.
 *
 * Two paths, in order: the page's own `sessions.open` when this bundle can see that service, otherwise the sidebar
 * item whose title matches (the title comes from the host's read-only session-title route). The DOM path exists
 * because the service is NOT visible from this page bundle (measured: every accessor answers null), while the sidebar
 * is the same document this pane renders in.
 * @param teamId - the row's team id (a session id, or a synthetic team id that opens nothing).
 * @returns whether something was actually clicked.
 */
function openTeamSession(teamId: unknown, memberName?: string, parentId?: string): boolean {
  const id = sessionIdOf(teamId)
  const raw = typeof teamId === 'string' ? teamId : ''
  if (id === null) return false
  /* R459: the SHELL's own navigation bridge (published by the session-controller client). This is the API the person
   * asked for: the loader-side wrapper owns sessions + uiWorkspace, and a page plugin calls two moves instead of
   * driving the official popover through the DOM. */
  type NavBridge = {
    openSession?: (target: unknown) => boolean
    openTeammate?: (sessionId: string, childSessionId: string) => boolean
  }
  const nav = (globalThis as unknown as { __dshSessionNav?: NavBridge }).__dshSessionNav
  if (nav !== undefined && nav !== null) {
    try {
      /* openTeammate takes the CHILD's own session id, which for a subagent is the bare uuid: `sessionIdOf` adds the
       * `session-` prefix for the sidebar path, and passing that prefixed form here recorded an address whose
       * childSessionId did not exist. The raw team id is the child id. */
      const childId = raw !== '' && !raw.startsWith('session-') ? raw : id
      if (parentId !== undefined && parentId !== '' && typeof nav.openTeammate === 'function' && nav.openTeammate(parentId, childId)) {
        return true
      }
      if (typeof nav.openSession === 'function' && nav.openSession(id)) return true
    } catch (error) {
      /* fall through to the DOM paths */
    }
  }
  if (openSessionById !== null) {
    try {
      openSessionById(id)
      return true
    } catch (error) {
      /* fall through to the DOM paths */
    }
  }
  /* A teammate's session is not in the sidebar, so the title path cannot reach it; the official popover can. Try the
   * sidebar first (leads), then the official popover (teammates). Both report success honestly. */
  void (async () => {
    const viaSidebar = await openSessionThroughSidebar(id)
    if (!viaSidebar && memberName !== undefined && memberName !== '') await openThroughOfficialPopover(memberName)
  })()
  return true
}

/**
 * Drive the OFFICIAL agent-team popover, which is the one component in this document that can open a teammate: its
 * browser plugin injects `sessions` + `uiWorkspace` and calls `uiWorkspace.openSession({parentSessionId, childSessionId,
 * mode: 'continuable'})` (client-ui-agent-team/src/client/mount.ts:37-51). A page plugin cannot reach those services
 * (measured), but it CAN click the popover's own member row - the official popover lists the current session's team,
 * which is exactly the branch this map draws. So: open the official popover, click the row whose label is the teammate
 * name, close it. A name that is not in that team is a false return, never a blind click.
 * @param name - the teammate's member name (the map's node label for a child node).
 * @returns whether a row was clicked.
 */
async function openThroughOfficialPopover(name: string): Promise<boolean> {
  if (typeof document === 'undefined' || name === '') return false
  const trigger = Array.from(document.querySelectorAll<HTMLElement>('button'))
    .find((button) => (button.textContent ?? '').includes('智能体团队'))
  if (trigger === undefined) return false
  trigger.click()
  await new Promise((resolve) => setTimeout(resolve, 350))
  const clickable = (element: HTMLElement): HTMLElement => element.closest<HTMLElement>('button,[role="button"],a') ?? element
  /* The roster row reads `top-a未运行 · 模型: …` - the name is glued to the status, so the match is a prefix, not a
   * word: the measured DOM had no separator at all. Longer names win over shorter prefixes by the sort below. */
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('button,[role="button"],li,div'))
    .filter((element) => {
      const text = (element.textContent ?? '').trim()
      return text === name || text.startsWith(name)
    })
  if (candidates.length === 0) {
    trigger.click()
    return false
  }
  candidates.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)
  clickable(candidates[0]).click()
  await new Promise((resolve) => setTimeout(resolve, 120))
  trigger.click()
  return true
}

/** Click the sidebar session whose title starts with the title the host route reports for this session id. */
async function openSessionThroughSidebar(id: string): Promise<boolean> {
  try {
    if (typeof document === 'undefined' || typeof fetch !== 'function') return false
    const answer = await fetch('/api/dsh-link-teams/session-title?id=' + encodeURIComponent(id), { headers: { accept: 'application/json' } })
    if (!answer.ok) return false
    const body = await answer.json() as { title?: unknown }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (title === '') return false
    const key = title.slice(0, 24)
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('button,a,[role="button"],span,div'))
      .filter((element) => (element.textContent ?? '').trim().startsWith(key))
    if (nodes.length === 0) return false
    nodes.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)
    const smallest = nodes[0]
    const clickable = smallest.closest<HTMLElement>('button,a,[role="button"]') ?? smallest
    clickable.click()
    return true
  } catch (error) {
    return false
  }
}

function TeamsBody(props: PaneProps) {
  const { t } = props
  const [data, setData] = useState<Doc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seenAt, setSeenAt] = useState<number | null>(null)
  // R313: the network board's one piece of state - which node a person picked. Picking a node does not write anything;
  // it lights up the rows that belong to that node (its tasks, its ledger records) across the whole pane, which is the
  // difference between a pane you read and a pane you can poke at.
  const [picked, setPicked] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // R479: sessionId -> running, from the kernel's own list. Null until the first answer; the ledger stays the fallback.
  const [runtime, setRuntime] = useState<Record<string, boolean> | null>(null)

  // The highlight is applied to the DOM, not re-rendered into every row: the rows keep the exact text the gates read,
  // and the mark is one class on the elements that name the selected id (data-net-target carries the ids a row is
  // about). Re-applied whenever the selection or the document changes, because the poll redraws the rows.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const marked = document.querySelectorAll('[data-net-target]')
    for (const node of marked) {
      const ids = String(node.getAttribute('data-net-target') ?? '').split(' ').filter((id) => id !== '')
      node.classList.toggle('dlt-focus', picked !== null && ids.includes(picked))
    }
  }, [picked, data])

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const response = await fetch(API_PATH, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
      let payload: Doc | null = null
      try {
        payload = (await response.json()) as Doc
      } catch {
        payload = null
      }
      if (payload !== null && payload.ok === true) {
        setData(payload)
        setError(null)
      } else {
        const failure = payload !== null && typeof payload.error === 'object' && payload.error !== null ? payload.error as Doc : null
        const code = failure !== null && failure.code !== undefined && failure.code !== null ? String(failure.code) : 'HTTP ' + response.status
        const message = failure !== null && typeof failure.message === 'string' ? failure.message : ''
        setData(null)
        setError(code + (message !== '' ? t('teams.error.separator') + message : ''))
      }
      setSeenAt(Date.now())
    } catch (e) {
      setData(null)
      setError(String((e as { message?: unknown })?.message ?? e))
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (typeof setInterval !== 'function') return undefined
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refresh()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  // R479: read the kernel's session list beside the ledger, so a node says "运行中" when its agent is actually running.
  useEffect(() => {
    if (typeof setInterval !== 'function' || typeof fetch !== 'function') return undefined
    let live = true
    const loadRuntime = async (): Promise<void> => {
      try {
        const response = await fetch(RUNTIME_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'dlt-runtime-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8),
            method: 'session/list',
            payload: { args: { _request: {} } },
          }),
        })
        if (!response.ok) return
        const body = await response.json() as {
          result?: { ok?: boolean, value?: { items?: Array<{ sessionId?: unknown, running?: unknown }> } }
        }
        if (!live || body.result?.ok !== true) return
        const map: Record<string, boolean> = {}
        for (const item of body.result.value?.items ?? []) {
          if (typeof item.sessionId === 'string' && item.sessionId !== '') map[item.sessionId] = item.running === true
        }
        setRuntime(map)
      } catch {
        /* the ledger reading still draws; the runtime fact is an enhancement, never a blocker */
      }
    }
    void loadRuntime()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void loadRuntime()
    }, POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [])

  // R283: the header is a title row plus a BOARD of the four numbers, not one run-on line. Each chip keeps its own
  // exact text - label, space, count - because the teams gate reads those tokens out of the pane's text with
  // /<label>\s+(\d+)/ patterns, so splitting a chip into a label element and a value element would break it. The
  // labels are dictionary copy; nothing in this half spells them.
  const head = (
    <div className="dlt-head">
      <div className="dlt-titleRow">
        <span className="dlt-title">{t('teams.title')}</span>
        <button type="button" className="dlt-refresh" disabled={busy} onClick={() => void refresh()}>{busy ? t('teams.refreshing') : t('teams.refresh')}</button>
      </div>
      {data === null ? null : (
        <div className="dlt-metrics">
          {headChips(data, t).map((chip) => {
            const text = String(chip.text)
            const at = text.search(/\s/)
            return (
              <div className="dlt-metric" key={chip.key} data-teams-chip={chip.key}>
                <span className="dlt-metricLabel">{at === -1 ? text : text.slice(0, at)}</span>
                {/* the value keeps a LEADING SPACE: the pane's textContent must still be label-space-count, because
                    the teams gate parses /<label>\s+(\d+)/ out of it and a split with no whitespace would read
                    label immediately followed by the number, which does not match. */}
                <span className="dlt-metricValue">{at === -1 ? '' : ' ' + text.slice(at + 1)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  if (data === null) {
    return (
      <div style={S.root}>
        {head}
        {error !== null
          ? <div style={S.card}><div style={S.cardTitle}>{t('teams.error.title')}</div><div style={S.err}>{error}</div></div>
          : <div style={S.meta}>{t('teams.loading')}</div>}
        <div style={S.meta}>{t('teams.source')}</div>
      </div>
    )
  }

  // R457: the pane shows ONE card - the mind map - as asked ("只留团队结构 · 思维导图 就行"). Every other card below is
  // still folded from the same document (the code is untouched and reachable by removing this early return); only what
  // the pane DRAWS changed.
  return (
    <div style={S.root} data-teams-mindmap-only="">
      {head}
      <div style={S.card} data-mindmap-card="">
        <div style={S.cardTitle}>{'团队结构 · 思维导图'} <span style={S.meta}>{'滚轮缩放 · 点节点进入会话'}</span></div>
        <TeamMindmap teams={data.teams} members={data.members} onOpen={openTeamSession} runtime={runtime} />
      </div>
    </div>
  )

  // R390: the pane is about THIS conversation. Teams whose ids name another session are still shown, but folded and
  // dimmed, because a team that belongs to a different conversation is noise here (the user's own words: 团队只在那个
  // 会话中展示和工作才有价值).
  const sessionId = currentSessionId()
  const tree = treeEntries(data.teams, sessionId)
  const tasks = taskEntries(data, t)
  // the ONE place the pane's clock is read for the member rows: the fold itself stays a pure function of its
  // arguments, so two folds of the same document answer the same way as long as the caller passes the same instant.
  const members = memberEntries(data, t, Date.now())
  const orphanCaps = declaredOnlyCapabilities(data)
  const peers = peerEntries(data)
  const quarantine = quarantineEntries(data, t)
  const stream = streamEntries(data, t)
  // R337: the ledger also holds what the gates wrote into it. Those rows are counted, not shown - see isTestRecord.
  const hiddenRecords = hiddenTestRecords(data)
  const cycles = boardCycles(data, t)
  const orphans = boardOrphans(data, t)
  const withheld = withheldNote(data, t)
  const fixtures = fixturesNote(data, t)
  const malformed = malformedNote(data, t)
  // R313: the network board. Columns are teams, nodes are members, and a node carries what a person needs in order to
  // decide what to look at: whether it is alive, when it last beat, what it declares, and which task it holds. The
  // facts themselves are still drawn verbatim below, because that is where the gates read them.
  const net = agentNetwork(data, t, Date.now())
  const pickedNode = net.groups.flatMap((group) => group.members).concat(net.loose).filter((node) => node.id === picked)[0] ?? null
  const copyId = async (value: string) => {
    try {
      const nav = typeof navigator === 'undefined' ? null : navigator
      if (nav === null || nav.clipboard === undefined || typeof nav.clipboard.writeText !== 'function') { setCopied('!'); return }
      await nav.clipboard.writeText(value)
      setCopied(value)
    } catch { setCopied('!') }
  }
  const nodeButton = (node: NetNode, group: NetGroup | null) => (
    <button
      type="button"
      key={node.key}
      className={'dlt-node' + (picked === node.id ? ' dlt-nodeOn' : '')}
      data-net-node={node.id}
      data-net-state={node.stateRaw}
      onClick={() => { setPicked(node.id === picked ? null : node.id); setCopied(null) }}
      title={node.id}
    >
      <span className="dlt-nodeDot" data-state={node.dot} data-busy={node.busy ? 'true' : undefined} />
      <span className="dlt-nodeName">{node.label}</span>
      <span className="dlt-nodeBeat">{node.beat}</span>
      {node.task === null ? null : <span className="dlt-nodeTask">{t('teams.net.task') + ' ' + node.task}</span>}
      {node.capabilities.length === 0 ? null : (
        <span className="dlt-nodeCaps">{node.capabilities.slice(0, 3).join(' · ') + (node.capabilities.length > 3 ? ' +' + String(node.capabilities.length - 3) : '')}</span>
      )}
      {group === null ? null : <span className="dlt-nodeTeam" hidden>{group.id}</span>}
    </button>
  )
  const network = net.groups.length === 0 && net.loose.length === 0 ? null : (
    <div className="dlt-net" data-teams-net="">
      <div style={S.cardTitle}>{t('teams.net.title')} <span style={S.meta}>{t('teams.net.subtitle', { teams: net.groups.length, members: net.members })}</span></div>
      <div className="dlt-netBoard">
        {net.groups.map((group) => (
          <div className={'dlt-netTeam' + (group.declared ? ' dlt-netTeamDeclared' : '')} key={group.key} data-net-team={group.id}>
            <div className="dlt-netTeamHead" title={group.id}>
              <span className="dlt-netTeamId">{group.label}</span>
              <span className="dlt-netTeamCount">{group.members.length}</span>
              <span className="dlt-netTeamState">{group.declared ? t('teams.net.declared') : t('teams.net.observed')}</span>
            </div>
            {group.members.map((node) => nodeButton(node, group))}
          </div>
        ))}
        {net.loose.length === 0 ? null : (
          <div className="dlt-netTeam" key="loose-net">
            <div className="dlt-netTeamHead">
              <span className="dlt-netTeamId">{t('teams.net.loose')}</span>
              <span className="dlt-netTeamCount">{net.loose.length}</span>
            </div>
            {net.loose.map((node) => nodeButton(node, null))}
          </div>
        )}
      </div>
      {pickedNode === null
        ? <div style={S.meta}>{t('teams.net.hint')}</div>
        : (
          <div className="dlt-nodeDetail" data-net-detail={pickedNode.id}>
            <div className="dlt-nodeDetailHead">
              <span className="dlt-nodeDot" data-state={pickedNode.dot} data-busy={pickedNode.busy ? 'true' : undefined} />
              <span className="dlt-nodeDetailName">{pickedNode.label}</span>
              <span style={S.chip(false)}>{pickedNode.state}</span>
              <button type="button" className="dlt-refresh" onClick={() => setPicked(null)}>{t('teams.net.clear')}</button>
            </div>
            <div className="dlt-nodeDetailRow" title={pickedNode.id}>{pickedNode.id}</div>
            <div className="dlt-nodeDetailRow">{t('teams.net.beat') + ' ' + pickedNode.beat + '　' + t('teams.net.task') + ' ' + (pickedNode.task === null ? t('teams.net.noTask') : pickedNode.task)}</div>
            <div className="dlt-nodeDetailRow">{t('teams.net.caps') + ' ' + (pickedNode.capabilities.length === 0 ? t('teams.net.noCaps') : pickedNode.capabilities.join(' / '))}</div>
            <div className="dlt-nodeDetailRow">
              <button type="button" className="dlt-refresh" onClick={() => void copyId(pickedNode.id)}>
                {copied === pickedNode.id ? t('teams.net.copied') : t('teams.net.copy')}
              </button>
              {copied === '!' ? <span style={S.err}>{t('teams.net.copyFailed')}</span> : null}
            </div>
          </div>
        )}
    </div>
  )

  const ledgerEmpty = members.length === 0 && tasks.length === 0 && stream.length === 0
  const seen = seenAt === null ? '' : t('teams.footer.seen', { time: new Date(seenAt).toLocaleTimeString() })

  return (
    <div style={S.root} className="dsh-link-teams">
      {head}
      <div style={S.meta}>{ledgerLine(data, t)}</div>
      {data.ledger !== null && typeof data.ledger === 'object' && (data.ledger as Doc).damage
        ? <div style={S.err}>{t('teams.damage', { damage: JSON.stringify((data.ledger as Doc).damage) })}</div>
        : null}
      {fixtures === null ? null : <div style={S.meta}>{fixtures}</div>}

      {ledgerEmpty
        ? <div style={S.card}><div style={S.cardTitle}>{t('teams.empty.title')}</div><div style={S.meta}>{t('teams.empty.text')}</div></div>
        : null}

      {tree.length === 0 && withheld === null && ledgerEmpty === false
        ? <div style={S.meta}>{t('teams.tree.empty')}</div>
        : null}

      {tree.length === 0 && withheld === null ? null : (
        <div style={S.card}>
          <div style={S.cardTitle}>{t('teams.tree.title')} <span style={S.meta}>{t('teams.tree.subtitle')}</span></div>
          {tree.filter((entry) => entry.observedOnly !== true && entry.foreign !== true).map((entry) => (
            <div key={entry.key} className="dlt-treeRow" style={{ ...S.row, paddingLeft: 12 * entry.depth, cursor: 'pointer' }} data-teams-row={entry.id} onClick={() => { openTeamSession(entry.id) }} title={'打开会话 ' + entry.id}>
              <span style={S.grow} title={entry.id}>{(entry.depth > 0 ? '└ ' : '') + entry.label}</span>
              {entry.lead === null ? null : <span style={S.chip(false)}>{t('teams.tree.lead', { id: entry.lead })}</span>}
              {entry.contested ? <span style={S.chip(true)}>{t('teams.tree.contested')}</span> : null}
            </div>
          ))}
          {tree.filter((entry) => entry.foreign === true).length === 0 ? null : (
            <details className="dlt-fold" data-teams-fold="other-sessions">
              <summary className="dlt-foldSummary">{t('teams.tree.otherSessions') + ' \u00b7 ' + String(tree.filter((entry) => entry.foreign === true).length)}</summary>
              <ul className="dlt-foldList">
                {tree.filter((entry) => entry.foreign === true).map((entry) => (
                  <li className="dlt-foldRow dlt-treeRow" key={entry.key} data-teams-row={entry.id} style={{ opacity: 0.55, cursor: 'pointer' }} onClick={() => { openTeamSession(entry.id) }} title={'打开会话 ' + entry.id}>
                    <span title={entry.id}>{(entry.depth > 0 ? '└ ' : '') + entry.label}</span>
                    {entry.lead === null ? null : ' \u00b7 ' + t('teams.tree.lead', { id: entry.lead })}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {/* R283: the teams that appear ONLY in task/member rows - 29 session ids in this world - are folded by
              default. They are the ledger's own fact and the row still says so; a reader who opens the fold gets
              every id, and the pane's default view is about the teams that exist, not about the ones that are only
              mentioned. */}
          {tree.filter((entry) => entry.observedOnly === true).length === 0 ? null : (
            <details className="dlt-fold" data-teams-fold="observed-only" open={undefined}>
              <summary className="dlt-foldSummary">{t('teams.tree.observedOnly') + ' \u00b7 ' + String(tree.filter((entry) => entry.observedOnly === true).length)}</summary>
              <ul className="dlt-foldList">
                {tree.filter((entry) => entry.observedOnly === true).map((entry) => (
                  <li className="dlt-foldRow dlt-treeRow" key={entry.key} data-teams-row={entry.id} style={{ cursor: 'pointer' }} onClick={() => { openTeamSession(entry.id) }} title={'打开会话 ' + entry.id}>
                    <span title={entry.id}>{(entry.depth > 0 ? '└ ' : '') + entry.label}</span>
                    {entry.lead === null ? null : ' \u00b7 ' + t('teams.tree.lead', { id: entry.lead })}
                    {entry.contested ? ' \u00b7 ' + t('teams.tree.contested') : null}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data.teams !== null && typeof data.teams === 'object' && Array.isArray((data.teams as Doc).orphans) && ((data.teams as Doc).orphans as unknown[]).length > 0
            ? <div style={S.err}>{t('teams.tree.orphans', { ids: ((data.teams as Doc).orphans as string[]).map((id) => (typeof id === 'string' && id.length > 12 ? id.slice(0, 12) : String(id))).join(', ') })}</div>
            : null}
          {data.teams !== null && typeof data.teams === 'object' && Array.isArray((data.teams as Doc).cycles) && ((data.teams as Doc).cycles as unknown[]).length > 0
            ? <div style={S.err}>{t('teams.tree.cycles', { cycles: JSON.stringify((data.teams as Doc).cycles) })}</div>
            : null}
          {withheld === null ? null : <div style={S.meta}>{withheld}</div>}
        </div>
      )}

      {/* R443: the team mind map, drawn where the design reference draws it: a vertical tree with edges and the three
          status colours. `teams.children` carries the parent edges when the ledger has them; without them the same
          layout still renders the teams side by side instead of inventing a hierarchy. */}
      <div style={S.card} data-mindmap-card="">
        <div style={S.cardTitle}>{'团队结构 · 思维导图'} <span style={S.meta}>{'缩放 / 适配'}</span></div>
        <TeamMindmap teams={data.teams} members={data.members} />
      </div>

      {/* R455: the agent network card is commented out on request ("这个Agent网可以先注释掉"). The folded data still
          carries it; only the card stopped rendering, so re-enabling is one uncomment. */}
      {/* {network === null ? null : <div style={S.card}>{network}</div>} */}

      <div style={S.card}>
        <div style={S.cardTitle}>{t('teams.board.title')} <span style={S.meta}>{t('teams.board.subtitle', { count: tasks.length, summary: boardSummary(data, t) })}</span></div>
        {/* R289: TEST-WRITTEN ROWS DO NOT DRESS AS PRODUCT DATA. The ledger carries rows written by our own gates and
            harnesses (the 夹具 chip), and a pane that mixes them into the board makes a test's leftovers look like the
            user's work. They keep their count and their ids - one click away - and leave the first screen alone. */}
        {tasks.length === 0 ? <div style={S.meta}>{t('teams.board.empty')}</div> : tasks.filter((task) => task.fixture !== true).map((task) => (
          <div key={task.key}>
            <div style={{ ...S.row, flexWrap: 'wrap' }} data-net-target={task.ownerId ?? ''}>
              <span style={S.dot(TASK_COLOR[task.state] ?? '#888')} />
              <span style={S.chip(false)}>{task.status}</span>
              <span style={{ ...S.grow, minWidth: 70 }} title={task.id}>{task.label}</span>
              {task.owner === null ? <span style={S.meta}>{t('teams.board.unclaimed')}</span> : <span style={S.chip(false)}>{task.owner}</span>}
              {task.contested ? <span style={S.chip(true)}>{t('teams.board.contested')}</span> : null}
              {task.readiness === null ? null : <span style={S.chip(task.readinessOn)}>{task.readiness}</span>}
              {task.records > 1 ? <span style={S.meta}>{t('teams.board.records', { count: task.records })}</span> : null}
              {task.fixture ? <span style={S.chip(true)}>{t('teams.fixture')}</span> : null}
            </div>
            {task.dependency === null ? null : <div style={S.dep}>{task.dependency}</div>}
          </div>
        ))}
        {tasks.filter((task) => task.fixture === true).length === 0 ? null : (
          <details className="dlt-fold" data-teams-fold="fixture-tasks">
            <summary className="dlt-foldSummary">{t('teams.fixtureFold', { count: tasks.filter((task) => task.fixture === true).length })}</summary>
            <ul className="dlt-foldList">
              {tasks.filter((task) => task.fixture === true).map((task) => (
                <li className="dlt-foldRow" key={task.key} title={task.id}>{task.status + ' · ' + task.label + ' · ' + task.state}</li>
              ))}
            </ul>
          </details>
        )}
        {cycles === null ? null : <div style={S.errWide}>{cycles}</div>}
        {orphans === null ? null : <div style={S.errWide}>{orphans}</div>}
      </div>

      <div style={S.card}>
        <div style={S.cardTitle}>{t('teams.members.title')} <span style={S.meta}>{t('teams.members.subtitle', { count: members.length })}</span></div>
        {members.length === 0 ? <div style={S.meta}>{t('teams.members.empty')}</div> : members.filter((member) => member.fixture !== true).map((member) => (
          <div key={member.key} style={{ ...S.row, flexWrap: 'wrap' }} data-net-target={member.id}>
            <span style={S.dot(MEMBER_COLOR[member.state] ?? '#888')} />
            <span style={{ ...S.grow, minWidth: 70 }} title={member.id}>{member.label}</span>
            <span style={S.chip(false)}>{member.state}</span>
            <span style={S.chip(false)}>{member.beat}</span>
            <span style={S.meta}>{member.capabilities}</span>
            {member.fixture ? <span style={S.chip(true)}>{t('teams.fixture')}</span> : null}
          </div>
        ))}
        {members.filter((member) => member.fixture === true).length === 0 ? null : (
          <details className="dlt-fold" data-teams-fold="fixture-members">
            <summary className="dlt-foldSummary">{t('teams.fixtureFold', { count: members.filter((member) => member.fixture === true).length })}</summary>
            <ul className="dlt-foldList">
              {/* a folded row still carries ITS OWN FACTS: the teams gate requires every capability the route serves to
                  appear in the pane's text, and a fold that dropped them would answer "not drawn" for a row that is only
                  out of the reading order. */}
              {members.filter((member) => member.fixture === true).map((member) => (
                <li className="dlt-foldRow" key={member.key} title={member.id}>{member.label + ' · ' + member.state + ' · ' + member.beat + ' · ' + member.capabilities}</li>
              ))}
            </ul>
          </details>
        )}
        {/* R291: ALWAYS RENDERED, never folded. A closed <details> is not rendered, so its content is absent from
            innerText - and a gate that reads the pane's innerText cannot see a folded fact at all. Capability names are
            the one thing a reader may need to grep for, so they stay out of the folds and out of the way: one dim
            paragraph, one line per declaration that has no member row to sit on. */}
        {orphanCaps.length === 0 ? null : (
          <div className="dlt-caps" data-teams-caps="">
            <div className="dlt-capsHead">{t('teams.declaredOnlyFold', { count: orphanCaps.length })}</div>
            {orphanCaps.map((row) => (
              <div className="dlt-capsRow" key={row.id} title={row.id}>{row.id + ' · ' + row.capabilities.join(' / ')}</div>
            ))}
          </div>
        )}
        {malformed === null ? null : <div style={S.err}>{malformed}</div>}
      </div>

      {peers.length === 0 ? null : (
        <div style={S.card}>
          <div style={S.cardTitle}>{t('teams.peers.title')}</div>
          {peers.map((peer) => (
            <div key={peer.key} style={S.row}>
              <span style={S.grow}>{peer.label}</span>
              <span style={S.chip(peer.state === 'granted')}>{peer.state}</span>
            </div>
          ))}
        </div>
      )}

      {quarantine.length === 0 ? null : (
        <div style={S.card}>
          <div style={S.cardTitle}>{t('teams.quarantine.title', { count: quarantine.length })}</div>
          {quarantine.map((entry) => (
            <div key={entry.key} style={{ ...S.row, flexWrap: 'wrap' }}>
              <span style={S.dot('#e05252')} />
              <span style={S.grow} title={entry.label}>{entry.label}</span>
              {entry.reason === null ? null : <span style={S.chip(false)}>{entry.reason}</span>}
              {entry.task === null ? null : <span style={S.meta}>{entry.task}</span>}
            </div>
          ))}
        </div>
      )}

      <div style={S.card}>
        <div style={S.cardTitle}>{t('teams.stream.title')} <span style={S.meta}>{t('teams.stream.subtitle', { count: stream.length })}</span></div>
        {hiddenRecords === 0 ? null : <div style={S.meta} data-teams-hidden-records={hiddenRecords}>{t('teams.stream.hidden', { count: hiddenRecords })}</div>}
        {stream.length === 0 ? <div style={S.meta}>{t('teams.stream.empty')}</div> : stream.map((record) => (
          <div key={record.key} style={S.row} data-net-target={record.actors.join(' ')}>
            <span style={S.chip(false)}>{record.kind}</span>
            <span style={S.grow}>{record.label}</span>
            {record.fixture ? <span style={S.chip(true)}>{t('teams.fixture')}</span> : null}
            {record.state === null ? null : <span style={S.meta}>{record.state}</span>}
          </div>
        ))}
      </div>

      <div style={S.meta}>{t('teams.footer', { seen })}</div>
    </div>
  )
}

/**
 * The chip's text: the pane's own name, so the tab reads in the active language.
 * @param props - the seat's props for a title.
 * @returns the chip.
 */
function TeamsTitle(props: PaneProps) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Glyph size={14} />{props.t('teams.title')}</span>
}

/**
 * The page's locale service, or null when this page has none.
 *
 * ctx.get is the strict read (the service store); ctx.locale covers a context that is a plain object.
 * Neither read may throw: a page without the locale service is a page whose words come from this
 * package's own dictionary.
 * @param ctx - client root context.
 * @returns the service, or null.
 */
function localeService(ctx: ClientContext): LocaleFace | null {
  const strict = safe(() => (typeof ctx.get === 'function' ? ctx.get('locale') : null), null)
  if (strict !== null && strict !== undefined) return strict as LocaleFace
  const direct = safe(() => (ctx as unknown as { locale?: unknown }).locale, null)
  return direct === null || direct === undefined ? null : direct as LocaleFace
}

/**
 * The translate seat this half binds for the rail's own functions (the tab type's title, the guide
 * entry's description and the panel action's title are called by the Sidebar and the panel, not rendered
 * through a slot, so they read the bound function directly). A page with no locale service answers from
 * the zh dictionary rather than drawing a key.
 * @param ctx - client root context.
 * @returns the translate function for this package's namespace.
 */
function bindTranslate(ctx: ClientContext): Translate {
  const service = localeService(ctx)
  const bind = service === null ? undefined : (service as { bind?: unknown }).bind
  if (typeof bind === 'function') {
    try {
      return (bind as (ns: string) => Translate).call(service, NS)
    } catch {
      /* a service that cannot bind answers from the dictionary below */
    }
  }
  return (key, params) => {
    const template = zh[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}

/* ------------------------------------------------------------------ *
 * The LINK panel's one action (R193), declared into the shared seam.
 *
 * WHY. The panel is the surface where a LINK feature becomes reachable, and what this half draws - the
 * team tree, the task board, the member rows and the control ledger - is otherwise a tab somebody has to
 * find in the rail. The row declared here opens THAT tab, so the team board is one press from the panel.
 *
 * WHERE openTab LIVES, read off the shipped kernel instead of assumed:
 *   packages/client/ui-sidebar-right/src/client/index.ts:151  ctx.reflect.provide('sidebarRight', controller)
 *   packages/client/ui-sidebar-right/src/client/service.ts:332  openTab(kind, options = {})
 * so the action calls openTab on `sidebarRight`; the registry this half registers INTO (sidebarRightTabs)
 * only takes registrations and has no openTab.
 *
 * Four rules this section obeys:
 *   its own words    the row's copy is this package's own dictionary (teams.panel.action, in zh and en),
 *                    read through the translate bindTranslate bound, so a language switch is a
 *                    re-projection rather than a re-declaration.
 *   read, not copy   the kind handed to openTab is READ out of the one object apply hands
 *                    sidebarRightTabs.register. A second spelling of 'link-teams' inside invoke would be
 *                    a second answer to the same question, free to drift from the tab the row opens.
 *   fail-closed      no `linkPanel`, a `declare` that throws, no `sidebarRight` and an `openTab` that
 *                    throws are each caught and named in THIS package's own marker
 *                    (globalThis.__dshLinkTeamsPanel); none of them is thrown, and the tab type, the two
 *                    slots and the page keep working either way.
 *   read, not injected   the seam is read with ctx.get rather than named in `inject`: injecting it would
 *                    make the WHOLE half wait for the panel, and this half's tab type must not wait for
 *                    it (the reason dsh-browser reads `sidebarRight` the same way).
 * ------------------------------------------------------------------ */

/** The kernel locale service's faces, as far as this half reads them. */
interface LocaleFace {
  /** Take this package's dictionaries, in one call, under its own namespace. */
  register(namespace: string, dictionaries: { readonly zh: Record<string, string>; readonly en: Record<string, string> }): unknown
  /** The namespace-bound translate; it reads the active locale at call time. */
  bind(namespace: string): Translate
  /** The change subscription a language switch arrives on; a page may not offer one. */
  subscribe?(listener: () => void): unknown
}

/** The tab type this half registers; the action reads the KIND out of this very object. */
interface RailTabType {
  readonly id: string
  readonly kind: string
  readonly priority: string
  readonly title: () => string
  readonly guide: readonly {
    readonly order: number
    readonly title: () => string
    readonly description: () => string
    readonly icon: typeof Glyph
  }[]
}

/** What one press of the action settled to, as this half records it. */
interface PanelInvoke {
  readonly ok: boolean
  readonly kind: string
  readonly failed: string | null
}

/** Run a step that must not be able to take the page down; the fallback answers when it throws. */
function safe<T>(step: () => T, fallback: T): T {
  try {
    return step()
  } catch {
    return fallback
  }
}

/** One error's own words, whatever shape it arrived in. */
function messageOf(error: unknown): string {
  const held = error as { message?: unknown } | null
  return held !== null && held !== undefined && held.message !== undefined ? String(held.message) : String(error)
}

/** This half's own record of what its contribution did; never throws, never carries a function. */
function markPanel(fields: Record<string, unknown>): void {
  safe(() => {
    const held = (globalThis as unknown as Record<string, unknown>)[PANEL_MARKER]
    const base = held !== null && typeof held === 'object' ? held as Record<string, unknown> : {}
    ;(globalThis as unknown as Record<string, unknown>)[PANEL_MARKER] = Object.assign({}, base, fields, { mounted: true })
  }, undefined)
}

/** The static face of this half's contribution, as data a reader can check without calling anything. */
function markDeclaration(declared: boolean, failed: string | null, tabType: RailTabType): void {
  markPanel({
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    ns: NS,
    tabId: tabType.id,
    tabKind: tabType.kind,
    declared,
    failed,
  })
}

/** Record one ask of the panel's action, in this package's own marker. */
function markInvoke(result: PanelInvoke): void {
  PANEL_INVOKES += 1
  markPanel({ invokes: PANEL_INVOKES, lastInvoke: result })
}

/**
 * One service read by its own name and the method that is looked for, or null when this page offers none.
 *
 * ctx.get is the strict read (the service store); the property covers a ctx that is a plain object.
 * Neither read may throw: a page without the service is a page this half must leave alone.
 * @param ctx - client root context.
 * @param name - the service name, as the client plane spells it.
 * @param method - the member the caller is going to use.
 * @returns the service, or null.
 */
function serviceOf(ctx: ClientContext, name: string, method: string): Record<string, unknown> | null {
  const read = (value: unknown): Record<string, unknown> | null => {
    if (value === null || value === undefined) return null
    const held = value as Record<string, unknown>
    return typeof held[method] === 'function' ? held : null
  }
  const fromGet = safe(() => (typeof ctx.get === 'function' ? ctx.get(name) : null), null)
  const strict = read(fromGet)
  if (strict !== null) return strict
  return read(safe(() => (ctx as unknown as Record<string, unknown>)[name], null))
}

/** The panel's contribution service, or null when this page has none. */
function linkPanelService(ctx: ClientContext): Record<string, unknown> | null {
  return serviceOf(ctx, LINK_PANEL_SERVICE, 'declare')
}

/** The right column's service, or null when this page has none; openTab is what it is read for. */
function sidebarRightService(ctx: ClientContext): Record<string, unknown> | null {
  return serviceOf(ctx, SIDEBAR_RIGHT_SERVICE, 'openTab')
}

/**
 * Open this half's own tab type - the kind READ out of the registration object.
 *
 * Nothing here may throw: the press lands on a page whose right column may have no session surface
 * mounted at all ("sidebarRight: no session surface is mounted"), or may not be there, and neither is
 * the panel's fault.
 * @param ctx - client root context.
 * @param tabType - the object this half handed sidebarRightTabs.register.
 */
function openOwnTab(ctx: ClientContext, tabType: RailTabType): void {
  const service = sidebarRightService(ctx)
  if (service === null) {
    markInvoke({ ok: false, kind: tabType.kind, failed: 'sidebarRight-unavailable: this page offers no ' + SIDEBAR_RIGHT_SERVICE + ' service, so the team panel was not opened' })
    return
  }
  try {
    (service.openTab as (kind: string) => unknown)(tabType.kind)
    markInvoke({ ok: true, kind: tabType.kind, failed: null })
  } catch (error) {
    markInvoke({ ok: false, kind: tabType.kind, failed: 'openTab-refused: ' + messageOf(error) })
  }
}

/**
 * The one definition this half declares.
 *
 * An action carries no body: it is not a reading, it is a thing to do. The title is a thunk over this
 * package's own dictionary, so a language switch is a re-projection rather than a re-declaration.
 * @param ctx - client root context.
 * @param t - the translate bound to this package's namespace.
 * @param tabType - the type this half registered; the action opens THAT kind.
 * @returns the item: the registry's identity fields plus the action's own invoke.
 */
function panelItemDefinition(ctx: ClientContext, t: Translate, tabType: RailTabType): Record<string, unknown> {
  return {
    id: PANEL_ITEM_ID,
    kind: PANEL_ITEM_KIND,
    source: PANEL_ITEM_SOURCE,
    order: PANEL_ITEM_ORDER,
    title: () => t('teams.panel.action'),
    invoke: () => openOwnTab(ctx, tabType),
  }
}

/** Run the seam's disposer, whatever shape it came back in; never throws. */
function releasePanelItem(disposer: unknown): void {
  safe(() => {
    if (typeof disposer === 'function') {
      (disposer as () => unknown)()
      return
    }
    const loose = disposer as { dispose?: unknown } | null
    if (loose !== null && typeof loose === 'object' && typeof loose.dispose === 'function') (loose.dispose as () => unknown)()
  }, undefined)
}

/**
 * Declare this package's one item, fail-closed, and bind the panel's refresh to this page's language.
 * @param ctx - client root context.
 * @param t - the translate bound to this package's namespace.
 * @param tabType - the type this half registered; the action opens that kind.
 * @param locale - the page's locale service, or null.
 * @returns the disposer that takes the item back out and drops the language subscription; a call with
 *   no panel to declare to, or one the panel refuses, leaves this half's marker naming which of the two
 *   it was and every other registration standing.
 */
function declarePanelItem(ctx: ClientContext, t: Translate, tabType: RailTabType, locale: LocaleFace | null): () => void {
  const service = linkPanelService(ctx)
  if (service === null) {
    markDeclaration(false, 'linkPanel-unavailable: this page offers no ' + LINK_PANEL_SERVICE + ' service, so the team panel action was not declared', tabType)
    return () => {}
  }
  let disposer: unknown = null
  try {
    disposer = (service.declare as (definition: unknown) => unknown)(panelItemDefinition(ctx, t, tabType))
  } catch (error) {
    markDeclaration(false, 'linkPanel-declare-refused: ' + messageOf(error), tabType)
    return () => {}
  }
  markDeclaration(true, null, tabType)
  // The drawn row carries this half's words, and a word can move without the item being re-declared: the
  // locale service says when the language moved, and the seam's own notify() asks the panel to take a
  // fresh projection. An event, not a cadence - this half starts no timer.
  const notify = service.notify
  let off: unknown = null
  if (locale !== null && typeof locale.subscribe === 'function' && typeof notify === 'function') {
    safe(() => {
      off = (locale.subscribe as (listener: () => void) => unknown)(() => {
        safe(() => (notify as () => unknown).call(service), undefined)
      })
    }, undefined)
  }
  return () => {
    const unsubscribe = off
    off = null
    safe(() => { if (typeof unsubscribe === 'function') (unsubscribe as () => unknown)() }, undefined)
    releasePanelItem(disposer)
  }
}

/**
 * Bind the contribution to this plugin's lifetime through ctx.effect, with the fallback the slot
 * registrations use: a runtime without an effect API still gets the item, and a runtime whose effect API
 * throws does not get it twice.
 * @param ctx - client root context.
 * @param t - the translate bound to this package's namespace.
 * @param tabType - the type this half registered.
 * @param locale - the page's locale service, or null.
 */
function registerPanelItem(ctx: ClientContext, t: Translate, tabType: RailTabType, locale: LocaleFace | null): void {
  if (typeof ctx.effect === 'function') {
    let ran = false
    try {
      ctx.effect(() => {
        ran = true
        const dispose = declarePanelItem(ctx, t, tabType, locale)
        return () => dispose()
      }, 'dsh-link-teams: panel action')
      return
    } catch (error) {
      if (ran) return
      safe(() => console.warn('[dsh-link-teams] ctx.effect failed for the panel action', messageOf(error)), undefined)
    }
  }
  safe(() => declarePanelItem(ctx, t, tabType, locale), undefined)
}

/**
 * Client plugin body: register the dictionaries, the tab type, the body, the chip and the LINK panel's
 * own action row.
 * @param ctx - client root context carrying the slot and tab registries and the locale service.
 */
/** The kernel's session list as a sessionId -> running map, or null when the reading fails. */
async function kernelRuntime(): Promise<Record<string, boolean> | null> {
  try {
    const answer = await fetch('/api/session/list', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'dlt-runtime-' + String(Date.now()) + '-' + String(Math.random()).slice(2, 8),
        method: 'session/list',
        payload: { args: { _request: {} } },
      }),
    })
    if (!answer.ok) return null
    const body = await answer.json() as { result?: { ok?: boolean, value?: { items?: Array<{ sessionId?: unknown, running?: unknown }> } } }
    if (body.result?.ok !== true) return null
    const map: Record<string, boolean> = {}
    for (const item of body.result.value?.items ?? []) {
      if (typeof item.sessionId === 'string' && item.sessionId !== '') map[item.sessionId] = item.running === true
    }
    return map
  } catch { return null }
}

/** The runtime word for one ledger id (ids arrive with and without the session- prefix), or undefined. */
function runtimeStateOf(runtime: Record<string, boolean> | null, id: unknown): string | undefined {
  if (runtime === null || typeof id !== 'string' || id === '') return undefined
  const candidates = [id]
  if (id.startsWith('session-')) candidates.push(id.slice('session-'.length))
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(id)) candidates.push('session-' + id)
  for (const key of candidates) if (Object.prototype.hasOwnProperty.call(runtime, key)) return runtime[key] === true ? '在线' : '空闲'
  return undefined
}

/**
 * R454: the member structure AT THE TOP, next to the official agent-team entry.
 *
 * The right-rail pane stays the full view; this contribution answers the question a person asks while reading a
 * conversation: "is anyone else in this team right now?" It reads the same read-only route the pane reads, on open and
 * every four seconds while open, so it costs nothing when closed and never invents a member the ledger does not have.
 */
function TeamStructureAction(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [doc, setDoc] = useState<{ teams?: { teams?: unknown[] }, members?: unknown[] } | null>(null)
  // R483: the ledger's member.state is a claim fact, not "is this agent working"; the kernel's session list is.
  const [runtime, setRuntime] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    if (!open) return undefined
    let live = true
    const load = (): void => {
      void fetch('/api/dsh-link-teams/state', { headers: { accept: 'application/json' } })
        .then((answer) => (answer.ok ? answer.json() as Promise<never> : null))
        .then((body) => { if (live && body !== null) setDoc(body) })
        .catch(() => { /* a structure card that cannot read says nothing, like the pane's own failure state */ })
    }
    load()
    const timer = setInterval(load, 4000)
    let runtimeLive = true
    const loadRuntime = (): void => {
      void kernelRuntime().then((map) => { if (runtimeLive && map !== null) setRuntime(map) }).catch(() => {})
    }
    loadRuntime()
    const runtimeTimer = setInterval(loadRuntime, 2000)
    return () => { live = false; clearInterval(timer); runtimeLive = false; clearInterval(runtimeTimer) }
  }, [open])
  const me = (() => {
    try { return currentSessionId() } catch (error) { return null }
  })()
  const members = Array.isArray(doc?.members) ? (doc?.members as { id?: unknown, team?: unknown, name?: unknown, state?: unknown }[]) : []
  /* R513: member.team and the stored current session can be the two spellings of one id. */
  const canonId = (value: unknown): string => typeof value === 'string' ? value.replace(/^session-/, '') : ''
  const mine = me === null ? [] : members.filter((member) => canonId(member.team) === canonId(me))
  const teams = Array.isArray(doc?.teams?.teams) ? (doc?.teams?.teams as unknown[]) : []
  const dot = (state: unknown): string => (state === 'active' || state === 'online' ? '#3fb950' : (state === 'idle' || state === 'provisioning' ? '#d29922' : '#5c6a7a'))
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="dlt-headAction" data-team-structure-toggle="" data-open={open ? 'true' : 'false'} title="成员结构"
        onClick={() => setOpen((v) => !v)}>
        <IconUsersOutlineRegular width={14} height={14} />
        <span>成员结构</span>
        {mine.length > 0 ? <span className="dlt-headActionCount" data-team-structure-count="">{mine.length}</span> : null}
      </button>
      {open ? (
        <div className="dlt-headPopover" data-team-structure-popover="">
          <div className="dlt-headPopoverTitle">
            <span>本会话团队</span><span>{me === null ? '会话未知' : (mine.length === 0 ? '暂无队友' : String(mine.length) + ' 名')}</span>
          </div>
          {mine.length === 0
            ? <div style={{ color: 'var(--dsw-alias-label-tertiary, #8b929c)', lineHeight: 1.5 }}>这条会话里还没有队友。让 agent 用 <code>spawn_teammate</code> 建队后，成员会出现在这里。</div>
            : mine.map((member) => {
              const memberState = runtimeStateOf(runtime, member.id) ?? (typeof member.state === 'string' ? member.state : '')
              return (
                <div key={String(member.id)} className="dlt-headRow" data-team-structure-member="">
                  <span className="dlt-headDot" style={{ background: dot(memberState) }} />
                  <span className="dlt-headName">{String(member.name ?? member.id)}</span>
                  <span className="dlt-headState">{memberState}</span>
                </div>
              )
            })}
          <div className="dlt-headFoot">
            全部 {teams.length} 个团队 · {members.length} 名成员
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * R464: the SHIPPED agent-team cell, replaced - not added beside it.
 *
 * The slot's register contract says a register reusing a shipped id "puts you in THAT cell and replaces it"
 * (slot-catalog.ts:1633). So registering with `id: 'agent-team'` takes over the official trigger and popover while
 * keeping the same position, the same slot and the same visual language. The content is the sidebar's: the multi-level
 * map from the ledger (which is the one thing the official projection cannot draw - it is flat, [lead, ...members]).
 */
function TeamPanelAction(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [doc, setDoc] = useState<{ teams?: unknown, members?: unknown } | null>(null)
  // R483: the floating team map is the one the chip opens; it must read the same runtime fact the rail pane does.
  const [runtime, setRuntime] = useState<Record<string, boolean> | null>(null)
  const [anchor, setAnchor] = useState<{ top: number, left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popover = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => {
    if (!open) return undefined
    let live = true
    const load = (): void => {
      void fetch('/api/dsh-link-teams/state', { headers: { accept: 'application/json' } })
        .then((answer) => (answer.ok ? answer.json() as Promise<never> : null))
        .then((body) => { if (live && body !== null) setDoc(body) })
        .catch(() => { /* no data: the popover says so */ })
    }
    load()
    const timer = setInterval(load, 3000)
    let runtimeLive = true
    const loadRuntime = (): void => {
      void kernelRuntime().then((map) => { if (runtimeLive && map !== null) setRuntime(map) }).catch(() => {})
    }
    loadRuntime()
    const runtimeTimer = setInterval(loadRuntime, 2000)
    /* A floating panel is the only way to survive the header's own clipping: the shipped action uses createPortal and a
     * position hook for exactly this reason (client-ui-agent-team/TeamAction.tsx:1-13). The popover is portal-ed to the
     * body and anchored to the trigger's rect, so expanding the sidebar cannot squeeze it. */
    const place = (): void => {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = 392
      const margin = 12
      const left = Math.min(Math.max(margin, rect.left - width + rect.width), Math.max(margin, window.innerWidth - width - margin))
      setAnchor({ top: rect.bottom + 8, left })
    }
    place()
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (popover.current?.contains(target) === true || trigger.current?.contains(target) === true) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    const onResize = (): void => { close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      live = false
      clearInterval(timer)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])
  const me = (() => { try { return currentSessionId() } catch (error) { return null } })()
  const members = Array.isArray(doc?.members) ? (doc?.members as { team?: unknown }[]) : []
  const mine = me === null ? 0 : members.filter((member) => member.team === me).length
  return (
    <div style={{ display: 'inline-flex' }}>
      <button type="button" ref={trigger} data-agent-team-replacement="" className="dlt-headAction" data-open={open ? 'true' : 'false'}
        title="智能体团队" onClick={() => setOpen((v) => !v)}>
        <IconUsersOutlineRegular width={14} height={14} />
        <span>智能体团队</span>
        {mine > 0 ? <span className="dlt-headActionCount">{mine}</span> : null}
      </button>
      {open && anchor !== null && typeof document !== 'undefined' ? createPortal(
        <div ref={popover} className="dlt-headPopover" data-agent-team-popover=""
          style={{ position: 'fixed', top: anchor.top, left: anchor.left, right: 'auto', width: 392, maxHeight: 560, overflow: 'auto', zIndex: 2147483000 }}>
          <div className="dlt-headPopoverTitle">
            <span>团队结构</span><span>{mine === 0 ? '本会话暂无队友' : '本会话 ' + String(mine) + ' 名'}</span>
          </div>
          {doc === null
            ? <div style={{ color: 'var(--dsw-alias-label-tertiary, #8b929c)', fontSize: 11 }}>正在读取账本…</div>
            : <TeamMindmap teams={doc.teams} members={doc.members} onOpen={openTeamSession} runtime={runtime} />}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const t = bindTranslate(ctx)
  const locale = localeService(ctx)
  // R283: this pane's stylesheet, mounted for exactly this plugin's lifetime - the same idiom dsh-link-toolbar and
  // dsh-link-panel use (import as text, one <style> tag this plugin owns). A panel that draws without one is how
  // this pane ended up as a wall of session ids.
  ctx.effect(() => {
    if (typeof document === 'undefined') return undefined
    const tag = document.createElement('style')
    tag.dataset.pluginCss = 'dsh-link-teams/teams.css'
    tag.textContent = teamsCss
    document.head.appendChild(tag)
    return () => { try { tag.remove() } catch (error) { /* a removed head is fine */ } }
  }, 'dsh-link-teams: pane stylesheet')
  ctx.effect(() => {
    if (locale === null || typeof locale.register !== 'function') {
      markPanel({ dictionaries: 'locale-unavailable: this page offers no locale service, so this package dictionaries were not registered' })
      return undefined
    }
    const registered = locale.register(NS, { zh, en })
    markPanel({ dictionaries: 'registered' })
    return registered
  }, 'dsh-link-teams: dictionaries')

  // ONE object, with two readers: sidebarRightTabs.register takes it, and the panel's action reads the
  // KIND IT MUST OPEN out of it (never a second copy of the word).
  const tabType: RailTabType = {
    id: TAB_ID,
    kind: TAB_KIND,
    priority: 'builtin',
    title: () => t('teams.title'),
    guide: [
      {
        order: 30,
        title: () => t('teams.title'),
        description: () => t('teams.guide'),
        icon: Glyph,
      },
    ],
  }
  // The session-selector seam. Read with ctx.get (the strict service store), never injected: a page without it must
  // keep every other feature, and the rows then say "read only" instead of pretending to navigate.
  const sessionCandidates: Record<string, unknown> = {
    get: (() => { try { return typeof ctx.get === 'function' ? ctx.get('sessions') : undefined } catch (error) { return null } })(),
    prop: (ctx as unknown as { sessions?: unknown }).sessions,
    reflectGet: (() => { try { const reflect = (ctx as unknown as { reflect?: { get?: (n: string) => unknown } }).reflect; return reflect !== undefined && typeof reflect.get === 'function' ? reflect.get('sessions') : undefined } catch (error) { return null } })(),
    rootGet: (() => { try { const root = (ctx as unknown as { root?: { get?: (n: string) => unknown } }).root; return root !== undefined && typeof root.get === 'function' ? root.get('sessions') : undefined } catch (error) { return null } })(),
  }
  const seen = Object.keys(sessionCandidates).filter((key) => sessionCandidates[key] !== undefined && sessionCandidates[key] !== null)
  const sessions = (seen.length > 0 ? sessionCandidates[seen[0]] : null) as { open?: (id: string) => void } | null
  const navBridge = (globalThis as unknown as { __dshSessionNav?: unknown }).__dshSessionNav
  markPanel({ navBridge: navBridge === undefined ? 'absent' : 'present' })
  if (sessions !== null && typeof sessions.open === 'function') {
    const open = sessions.open.bind(sessions)
    openSessionById = (id: string) => { open(id) }
    markPanel({ sessionSelection: 'available', sessionSource: seen.join(',') })
  } else {
    openSessionById = null
    markPanel({ sessionSelection: 'unavailable: this page exposes no sessions service', sessionSeen: Object.keys(sessionCandidates).join(',') })
  }
  // R465: the shipped `ui-agent-team` client row is disabled in the profile patch, so the cell is free; this entry takes
  // the same position (order -20) with a fresh id. Replacing by reusing the shipped id was tried first and made the
  // loader fail the shipped plugin ("Failed to load plugins ...client-ui-agent-team") - the row has to be composed out,
  // not raced at registration time.
  // R465: the same-id replacement was REVERTED. Taking over the shipped `agent-team` cell from a page plugin made the
  // loader report "Failed to load plugins @deepseek-ai/dsh-experimental-client-ui-agent-team" and blanked the cell - the
  // shipped plugin's own registration then loses its cell. A replacement has to suppress the shipped ROW in the bundle
  // composition (kernel-side patch), not race its registration from a dynamic plugin.
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    { name: 'conversation.session.header.actions', id: 'link-teams-structure', order: -20, locale: NS },
    TeamPanelAction,
  )), 'dsh-link-teams: sidebar-style team panel in the shipped position')
  ctx.effect(() => ctx.sidebarRightTabs.register(tabType), 'dsh-link-teams: rail tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
    TeamsBody,
  )), 'dsh-link-teams: pane body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS },
    TeamsTitle,
  )), 'dsh-link-teams: pane title')

  // The panel action (R193): one action row, declared fail-closed. A page with no panel service, no
  // locale service or a right column that refuses the open keeps this half's tab type, its two slots
  // and its page.
  registerPanelItem(ctx, t, tabType, locale)
}