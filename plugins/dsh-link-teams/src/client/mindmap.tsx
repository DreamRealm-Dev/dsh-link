/** R455 - the team mind map: a VERTICAL tree with names, ids only as detail.
 *
 * R454 feedback from the person: (a) horizontal columns read as a flowchart, not as an org chart; (b) nodes printed
 * raw session ids instead of names; (c) when the reader sits on a teammate, the map must walk up to the lead - the
 * branch is the ancestors plus the current node plus its children, which is what they asked for originally. So:
 *
 *   x      centred over its children, so a lead sits above its team
 *   y      depth * ROW_STEP
 *   label  the team's member name (team-a), else '未命名团队', never a raw id
 *   id     tooltip + a small grey line under the name, i.e. detail rather than identity
 */
import { useEffect, useMemo, useState } from 'react'

interface RawTeam { id?: unknown, parent?: unknown, lead?: unknown }
interface RawMember { id?: unknown, team?: unknown, name?: unknown, state?: unknown }
interface Node { key: string, id: string, label: string, depth: number, x: number, y: number, state: string, self: boolean, parentId: string | null, children: string[] }

const ROW_STEP = 96
const NODE_W = 168
const NODE_H = 46
const GAP = 18
const PAD = 18

const ON = '#3fb950'
const IDLE = '#d29922'
const OFF = '#5c6a7a'

function colourOf(state: string): string {
  if (state === 'active' || state === 'online') return ON
  if (state === 'idle' || state === 'provisioning') return IDLE
  return OFF
}

function currentSession(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem('dsh.sessions.current')
    if (typeof raw !== 'string' || raw === '') return null
    const id = (JSON.parse(raw) as { sessionId?: unknown }).sessionId
    return typeof id === 'string' && id !== '' ? id : null
  } catch (error) { return null }
}

/**
 * R461: fit a label to the node box. SVG text does not wrap or ellipsize, so a long session title ran straight through
 * the rectangle (the person's report: 文字超出框). Width is estimated per character - CJK/fullwidth glyphs take a full
 * 12px cell, everything else about 6.6px at the node's 12px size - and the caller also clips, so an odd glyph cannot
 * escape either way.
 */
function fitLabel(text: string, maxWidth: number): string {
  let width = 0
  let out = ''
  for (const char of text) {
    const wide = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(char)
    const step = wide ? 12 : 6.6
    if (width + step > maxWidth) return out + '…'
    out += char
    width += step
  }
  return out
}

/** A short detail line: the id's first block plus the child-team count, never the whole id as the name. */
function detailOf(id: string, childCount: number): string {
  const short = id.replace(/^session-/, '').slice(0, 8)
  return childCount > 0 ? short + ' · ' + String(childCount) + ' 团队' : short
}

export function TeamMindmap({ teams, members, onOpen, runtime }: {
  teams: unknown
  members: unknown
  onOpen?: (id: string, memberName?: string, parentId?: string) => void
  /** R479: sessionId -> agent running, read from the kernel's session list. Absent means "fall back to the ledger". */
  runtime?: Record<string, boolean> | null
}) {
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [zoom, setZoom] = useState(1)
  const [scope, setScope] = useState<'branch' | 'all'>('branch')
  const doc = (teams ?? {}) as { teams?: RawTeam[], children?: Record<string, unknown> }
  const rows = Array.isArray(members) ? (members as RawMember[]) : []
  const teamRows = Array.isArray(doc.teams) ? doc.teams : []
  const children = (doc.children ?? {}) as Record<string, unknown>
  const me = currentSession()
  /* R479: a node names a session, and the ledger cannot say whether that session's agent is streaming. The session list
   * can. Ids arrive both with and without the `session-` prefix, so two spellings of one id are both tried. */
  const runtimeState = (id: string): string | undefined => {
    if (runtime === null || runtime === undefined) return undefined
    const candidates: string[] = [id]
    if (id.startsWith('session-')) candidates.push(id.slice('session-'.length))
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(id)) candidates.push('session-' + id)
    for (const key of candidates) {
      if (Object.prototype.hasOwnProperty.call(runtime, key)) return runtime[key] === true ? 'active' : 'idle'
    }
    return undefined
  }
  const layout = useMemo(() => {
    /* R513: one session id arrives in two spellings - the root team carries the `session-` prefix, a teammate's
     * session is the bare uuid, and a nested team's `parent` can name the prefixed form of a bare id. Joining the
     * graph on the raw strings therefore left a depth-2 teammate orphaned (measured live: "ab9e47bd…" sat in
     * teams.orphans while its parent "e4763216…" existed). Every join below runs on the canonical form; the node
     * keeps the original spelling as its identity so opening the session still addresses the real id. */
    const canon = (value: unknown): string => typeof value === 'string' ? value.replace(/^session-/, '') : ''
    const originalOf = new Map<string, string>()
    const remember = (value: unknown): string => {
      const canonical = canon(value)
      if (canonical !== '' && !originalOf.has(canonical)) originalOf.set(canonical, String(value))
      return canonical
    }
    const byTeam = new Map<string, RawMember[]>()
    /* A spawned teammate's OWN session team carries no title, but the parent team's member row names it: the member id
     * IS the child session id. That name is the right label for such a node; the id stays as the detail line. */
    const memberNameById = new Map<string, string>()
    for (const member of rows) {
      const id = remember(member.id)
      const name = typeof member.name === 'string' ? member.name : ''
      if (id !== '' && name !== '') memberNameById.set(id, name)
    }
    for (const member of rows) {
      const team = canon(member.team)
      if (team === '') continue
      const list = byTeam.get(team) ?? []
      list.push(member)
      byTeam.set(team, list)
    }
    const parentOf = new Map<string, string | null>()
    const leadOf = new Map<string, string | null>()
    for (const team of teamRows) {
      const id = remember(team.id)
      if (id === '') continue
      parentOf.set(id, canon(team.parent) || null)
      leadOf.set(id, canon(team.lead) || null)
    }
    /* Edges from BOTH directions: the ledger's children map and each team's own parent field. Either one missing
     * (the measured depth-2 orphan) must not hide a real child. */
    const childrenOf = new Map<string, string[]>()
    const addEdge = (parent: string, kid: string): void => {
      if (parent === '' || kid === '' || parent === kid) return
      const list = childrenOf.get(parent) ?? []
      if (!list.includes(kid)) list.push(kid)
      childrenOf.set(parent, list)
    }
    for (const [parent, value] of Object.entries(children)) {
      if (!Array.isArray(value)) continue
      const parentId = canon(parent)
      for (const kid of value) addEdge(parentId, canon(kid))
    }
    for (const [id, parent] of parentOf) if (parent !== null) addEdge(parent, id)
    const meId = me === null ? null : canon(me)
    /* The branch: walk up from the current session to the root, then take the WHOLE subtree under it. R454's rule
     * was ancestors + direct children; a nested team's grandchildren belong to the same branch and must draw. */
    const inBranch = new Set<string>()
    if (scope === 'branch' && meId !== null) {
      let cursor: string | null = parentOf.has(meId) ? meId : null
      const guard = new Set<string>()
      while (cursor !== null && !guard.has(cursor)) {
        guard.add(cursor)
        inBranch.add(cursor)
        cursor = parentOf.get(cursor) ?? null
      }
      const queue = [...(childrenOf.get(meId) ?? [])]
      const seen = new Set<string>(inBranch)
      while (queue.length > 0) {
        const next = queue.shift() as string
        if (seen.has(next)) continue
        seen.add(next)
        inBranch.add(next)
        queue.push(...(childrenOf.get(next) ?? []))
      }
    }
    const visible = (id: string): boolean => inBranch.size === 0 || inBranch.has(id)
    const kidsOf = (id: string): string[] => (childrenOf.get(id) ?? []).filter(visible)
    const roots = [...parentOf.keys()].filter((id) => {
      if (!visible(id)) return false
      const parent = parentOf.get(id) ?? null
      return parent === null || !parentOf.has(parent)
    })
    let cursorX = 0
    const nodes: Node[] = []
    /* Post-order: leaves take the next slot, parents centre over their children. */
    const place = (id: string, depth: number): Node => {
      const kids = kidsOf(id)
      const placed = kids.map((kid) => place(kid, depth + 1))
      const list = byTeam.get(id) ?? []
      const original = originalOf.get(id) ?? id
      /* A node is a SESSION team, so its name is the session title, not the first member's name: printing 'top-a' over
       * the lead's node read as if top-a were the lead. The title route fills this; until it answers the label is neutral. */
      const title = titles[original] ?? titles[id] ?? ''
      const named = memberNameById.get(id) ?? ''
      const label = fitLabel(title !== '' ? title : (named !== '' ? named : (id === meId ? '本会话' : '未命名会话')), NODE_W - 36)
      const x = placed.length === 0 ? cursorX : (placed[0].x + placed[placed.length - 1].x) / 2
      if (placed.length === 0) cursorX += NODE_W + GAP
      const state = runtimeState(original) ?? runtimeState(id) ?? (list.length === 0 ? 'idle' : String(list[0].state ?? 'idle'))
      const node: Node = { key: 'mm-' + id, id: original, label, depth, x, y: depth * ROW_STEP, state, self: me !== null && id === meId, parentId: parentOf.get(id) ?? null, children: kids }
      nodes.push(node)
      return node
    }
    roots.slice(0, 40).forEach((id) => place(id, 0))
    const maxX = nodes.reduce((max, node) => Math.max(max, node.x), 0)
    const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0)
    const width = Math.max(NODE_W + PAD * 2, maxX + NODE_W + PAD * 2)
    const height = Math.max(ROW_STEP, PAD * 2 + maxDepth * ROW_STEP + NODE_H)
    return { nodes, links: nodes.flatMap((node) => node.children.map((kid) => ({ from: node.key, to: 'mm-' + kid }))), width, height }
  }, [teams, members, scope, me, titles, runtime])
  /* Ask the host for the titles of the nodes this layout draws, once per layout change. */
  useEffect(() => {
    const ids = layout.nodes.map((node) => node.id).filter((id) => !id.startsWith('team-') && id !== '')
    if (ids.length === 0) return
    const wanted = ids.join(',')
    let live = true
    void fetch('/api/dsh-link-teams/session-title?ids=' + encodeURIComponent(wanted), { headers: { accept: 'application/json' } })
      .then((answer) => (answer.ok ? answer.json() as Promise<{ titles?: Record<string, string> }> : null))
      .then((body) => {
        if (!live || body === null || body.titles === undefined) return
        // R482: only a REAL title change may replace the map. Spreading unconditionally minted a new object on
        // every answer, which the layout memo above depends on, which re-ran this effect, which fetched again -
        // a ~50 Hz render/fetch loop (measured: 12 session-title requests in ~250 ms) that made the pane thrash
        // and its status read stale. Returning the previous object when nothing changed stops the loop.
        setTitles((old) => {
          const next: Record<string, string> = { ...old }
          let changed = false
          for (const [key, value] of Object.entries(body.titles)) {
            if (typeof value === 'string' && next[key] !== value) { next[key] = value; changed = true }
          }
          return changed ? next : old
        })
      })
      .catch(() => { /* no titles: the nodes keep the neutral label */ })
    return () => { live = false }
  }, [layout])
  const byKey = new Map(layout.nodes.map((node) => [node.key, node]))
  return (
    <div className="dsh-link-mindmap" data-mindmap="" data-mindmap-nodes={layout.nodes.length} data-mindmap-scope={scope} data-mindmap-self={me ?? ''}>
      <div className="dsh-link-mindmap-tools">
        <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10))}>+</button>
        <button type="button" onClick={() => setZoom(1)}>适配</button>
        <button type="button" data-mindmap-toggle="" onClick={() => setScope((current) => current === 'branch' ? 'all' : 'branch')}>{scope === 'branch' ? '只看本分支' : '显示全部'}</button>
      </div>
      <div className="dsh-link-mindmap-legend">
        <span><i style={{ background: ON }} />在线</span>
        <span><i style={{ background: IDLE }} />空闲</span>
        <span><i style={{ background: OFF }} />离线</span>
      </div>
      <div className="dsh-link-mindmap-canvas" style={{ overflow: 'auto' }}>
        <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={'0 0 ' + String(layout.width) + ' ' + String(layout.height)}>
          <defs>
            {layout.nodes.map((node) => (
              <clipPath key={'clip-' + node.key} id={'mmclip-' + node.key}>
                <rect x={node.x + 24} y={node.y + 2} width={NODE_W - 32} height={NODE_H - 4} rx={4} />
              </clipPath>
            ))}
          </defs>
          {layout.links.map((link) => {
            const from = byKey.get(link.from); const to = byKey.get(link.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W / 2; const y1 = from.y + NODE_H
            const x2 = to.x + NODE_W / 2; const y2 = to.y
            const mid = (y1 + y2) / 2
            return <path key={link.from + '->' + link.to} d={'M ' + String(x1) + ' ' + String(y1) + ' C ' + String(x1) + ' ' + String(mid) + ', ' + String(x2) + ' ' + String(mid) + ', ' + String(x2) + ' ' + String(y2)} fill="none" stroke="#2f3a46" strokeWidth={1.4} />
          })}
          {layout.nodes.map((node) => (
            <g key={node.key} data-mindmap-node={node.key} data-mindmap-id={node.id} data-mindmap-state={node.state} data-mindmap-self={node.self ? 'true' : 'false'}
              onClick={() => { if (onOpen !== undefined) onOpen(node.id, node.label, node.parentId ?? undefined) }}
              style={{ cursor: 'pointer' }} title={'进入会话 ' + node.id}>
              <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10}
                fill={node.self ? '#22303c' : '#1b1b1c'}
                stroke={node.self ? ON : (node.depth === 0 ? '#3a4756' : '#2a2a2a')} strokeWidth={node.self ? 1.6 : 1} />
              <circle cx={node.x + 14} cy={node.y + 17} r={4} fill={colourOf(node.state)} />
              <text x={node.x + 26} y={node.y + 21} fontSize={12} fontWeight={node.depth === 0 ? 600 : 400} fill="#e5e9ef" clipPath={'url(#mmclip-' + node.key + ')'}>{node.label}</text>
              <text x={node.x + 14} y={node.y + 37} fontSize={9.5} fill="#7b8b9e">{detailOf(node.id, node.children.length)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}
