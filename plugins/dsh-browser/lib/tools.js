/**
 * The model-facing tool set.
 *
 * Two input modes coexist deliberately:
 *
 *  - COORDINATE mode (`browser_click` on x/y read off a `browser_shot` image).
 *    The viewport is pinned by an emulation override, so one screenshot pixel IS
 *    one CSS pixel IS one click coordinate. This mode is what you use when the
 *    page must not be introspected at all.
 *
 *  - CONTROL mode (`browser_controls` → `browser_pick`). The page's interactive
 *    structure is summarised as a numbered list, and a pick clicks by number.
 *    Far cheaper in tokens and immune to controls that move between the
 *    screenshot and the click, because the click targets the control's own box
 *    at pick time instead of a remembered pixel.
 *
 * Either way a click is a real synthesized mouse event, never a DOM write.
 *
 * R184: the channel decides WHAT a tool addresses. On the PANEL channel (the default) there is one
 * browser - the shell's sidebar panel, shared with the user - and it has TABS: every tool that talks
 * to a page takes an optional `tab` (a tab id from browser_tabs; omitted means the active tab, which
 * is the shell's own rule), browser_goto navigates through the shell's per-tab op instead of
 * Page.navigate on whatever happens to be active, and open/close/activate are tools of their own.
 * On the CHROME channel (DSH_BROWSER_PANEL=0) there are instances instead: each is its own window and
 * there is no tab set at all, so a `tab` argument is refused by name rather than silently ignored.
 * The descriptions below are built per channel, because a description that describes the other
 * channel is a description that lies to the model.
 */

const str = (description) => ({ type: 'string', description })
const num = (description) => ({ type: 'number', description })
const int = (description) => ({ type: 'integer', description })
const bool = (description) => ({ type: 'boolean', description })

const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' } },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
  },
}

function imageBlock(image) {
  return {
    type: 'image',
    attachment: {
      attachmentId: image.attachmentId,
      mediaType: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
      ...(image.name === undefined ? {} : { name: image.name }),
    },
  }
}

const IMAGE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'image'],
    properties: { text: { type: 'string' }, image: IMAGE_VALUE_SCHEMA },
  },
  render: (_args, value) => [{ type: 'text', text: value.text }, imageBlock(value.image)],
}

/** Text always, image only when the caller asked for it. */
const TEXT_OR_IMAGE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string' }, image: IMAGE_VALUE_SCHEMA },
  },
  render: (_args, value) => (value.image === undefined ? [{ type: 'text', text: value.text }] : [{ type: 'text', text: value.text }, imageBlock(value.image)]),
}

const INSTANCE_PARAM = str('Browser instance id. Omit to use the most recently used one.')
/** A tab of the shell sidebar panel: a page-addressing tool's third coordinate. */
const TAB_PARAM = str(
  'Tab id from browser_tabs, e.g. "t2" ("chrome" addresses the shell\'s own browser page - the bar with the tabs). ' +
    'Omit to act on the ACTIVE tab, which is the page the user is looking at. Only the panel channel has tabs; on the chrome channel this argument is refused by name.',
)
const TAB_PARAM_OP = str(
  'Tab id from browser_tabs, e.g. "t2". Omit to act on the ACTIVE tab. The shell refuses an id it does not have, by name, and lists the ids it does have.',
)
const VIEWPORT_NOTE =
  'The page is rendered at a fixed viewport; screenshot pixels map 1:1 onto CSS pixels, so coordinates read off a browser_shot image are exactly the coordinates browser_click expects.'

/** Keys a browser UI actually needs; everything else must use browser_type. */
const KEY_TABLE = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  Space: { code: 'Space', vk: 32, text: ' ' },
}

function assertLive(exec) {
  if (exec?.signal?.aborted === true) throw new Error('browser tool call was cancelled')
}

/**
 * Where the pixels came from, said out loud: the model has to know whether it is
 * looking at the user's own panel (shared, one browser) or at a private Chrome
 * window nobody else can see. R178-N made the shared one the default.
 */
function channelLine(status) {
  if (status?.channel === 'panel') {
    const dpr = Number.isFinite(status.dpr) === true ? status.dpr : 1
    return 'channel: panel - the shell sidebar panel, the SAME browser the user is looking at' +
      '\npanel viewport: ' + status.width + 'x' + status.height + ' CSS px at dpr ' + dpr +
      ' (the panel\'s size belongs to the shell and the user; this tool cannot pin it)' +
      tabLineOf(status)
  }
  return 'channel: chrome - a private browser this plugin started; the user does not see it'
}

/**
 * WHICH tab an answer is about (R184), when the shell reported a tab set.
 *
 * A non-active tab is called out because the shell keeps exactly one tab in the content area and parks
 * the rest off-screen: a capture or an input aimed at a parked tab lands in that parked window, not in
 * the page the user has in front of them. Saying so in the same reply is the only honest option - the
 * alternative is a tool that silently returns a 1x1 image.
 */
function tabLineOf(status) {
  if (status?.channel !== 'panel') return ''
  const id = typeof status.tab === 'string' && status.tab !== '' ? status.tab : null
  const tabs = status.tabs
  if (id === null && tabs === undefined) return ''
  const label = status.tabActive === true ? ' (active)' : status.tabActive === false ? ' (NOT the active tab: the shell parks it off-screen - browser_tab_activate brings it forward)' : ''
  const set = tabs === undefined ? '' : '; ' + tabs.count + '/' + (tabs.limit ?? '?') + ' tabs (browser_tabs lists them)'
  return '\ntab: ' + (id ?? '(none)') + label + set
}

/** The same sentence for a tool that did not read a status: one line, only when a tab was named. */
async function tabSuffix(session, tab) {
  const named = typeof tab === 'string' && tab !== '' ? tab : undefined
  if (named === undefined || session.channel !== 'panel') return ''
  return '\n' + (await session.tabLine(named))
}

/** The tab set, as a tool reply: the shell's own count and rows, never a local list. */
function tabsText(tabs) {
  const rows = tabs.tabs.map((entry) => (entry.active === true ? '* ' : '  ') + entry.id + '  live=' + entry.live + '  ' + (entry.url ?? '(no url)') + (entry.title === null ? '' : '  "' + entry.title + '"'))
  const head = 'tabs (' + tabs.count + ' of ' + (tabs.limit ?? '?') + '); "*" marks the active tab ' + (tabs.active ?? '(none)')
  const drift = tabs.listed === tabs.count ? '' : '\nnote: the shell reports ' + tabs.count + ' tab(s) but its rows list ' + tabs.listed + '; both numbers are the shell\'s and they disagree'
  return head + '\n' + rows.join('\n') + drift
}

/**
 * How to get from this image to a coordinate browser_click accepts.
 *
 * In panel mode the image is the panel's device pixels: with a display scale other
 * than 1, a pixel read off the image is NOT a CSS pixel, so the mapping has to be
 * printed rather than assumed. dpr is measured per call, so this stays true when
 * the user moves the window to another monitor.
 */
function mappingNote(status) {
  if (status?.channel !== 'panel') return 'note: image pixels equal CSS pixels; pass coordinates read here straight to browser_click.'
  const dpr = Number.isFinite(status.dpr) === true ? status.dpr : 1
  return (
    'note: this image is ' + status.width + 'x' + status.height + ' DEVICE pixels of the panel (dpr ' + dpr + '); ' +
    'CSS = image / ' + dpr + '. Read the coordinate off the image, divide by dpr, then pass that to browser_click.'
  )
}

function endpointLine(status) {
  if (status?.port === undefined || status.port === null) return 'transport: the shell panel CDP op (/__shell/panel/cdp) - no debug port, no Chrome process'
  return 'debug port: ' + status.port + (status.pid === undefined ? '' : ', pid: ' + status.pid)
}

function statusLine(status) {
  return 'url: ' + status.url + '\ntitle: ' + status.title +
    '\nviewport: ' + status.width + 'x' + status.height + ' (pinned ' + status.configuredWidth + 'x' + status.configuredHeight + ')' +
    '\n' + channelLine(status)
}

/**
 * Build the tool definitions.
 * @param registry - the BrowserRegistry both the tools and the sidebar address.
 * @param config - the ConfigStore (chrome path, viewport defaults).
 * @param getAttachments - lazy `ctx.get('attachments')` lookup.
 */
export function defineBrowserTools({ registry, config, getAttachments }) {
  /**
   * Which world these descriptions describe. The channel is fixed for the life of the registry (the
   * kernel reads DSH_BROWSER_PANEL once at apply time), so the words are built once, here - a
   * description that describes the other channel is a description that lies to the model.
   */
  const panel = registry.usePanel === true
  /**
   * The id every page tool takes, described for THIS channel: on the panel channel any id addresses
   * the one panel browser, and calling it an instance id (as the chrome channel truthfully can) is
   * the same lie `browser_open` used to tell.
   */
  const instanceParam = panel
    ? str('Handle that names the one panel browser (this channel has exactly one; any id addresses it). Omit to keep it simple.')
    : INSTANCE_PARAM

  async function target(args) {
    return await registry.ensureInstance(args.id)
  }

  return [
    {
      name: 'browser_open',
      description: panel
        ? 'Open the shell\'s own sidebar panel - the ONE browser on this channel, shared with the user - and optionally point its ACTIVE tab at a URL. `id` is a handle onto that same panel, not a second window: this channel cannot open more than one, and `browser_list`/`browser_tabs` list its TABS instead. ' +
          'A URL here navigates the page the user is looking at; to browse without taking their page away, open a tab of your own with `browser_tab_new`. ' +
          'The panel\'s size belongs to the user (they drag the divider), so this tool cannot pin it. ' +
          VIEWPORT_NOTE
        : 'Open a browser instance (or reuse the one named by `id`) and optionally navigate it. Multiple instances can be open at once, each with its own window, profile, and pinned viewport; `browser_list` shows them. ' +
          VIEWPORT_NOTE,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: str('Instance id to open or reuse (e.g. "b1", "shop"). Omit to auto-allocate.'),
          url: str('URL to open. Defaults to about:blank.'),
          width: int('Viewport width in CSS pixels (default from config, 1280).'),
          height: int('Viewport height in CSS pixels (default from config, 800).'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await registry.open({
          id: args.id,
          url: args.url,
          viewport: { width: args.width, height: args.height },
        })
        const status = await session.status()
        const head = panel === true ? `panel browser ready (handle ${session.id})` : `instance ${session.id} ready`
        const note = panel === true
          ? '\nnote: one browser on this channel (the shell\'s panel), and it has tabs - browser_tabs lists them; browser_tab_new opens one of your own.'
          : ''
        return { text: `${head}\n${statusLine(status)}\n${endpointLine(status)}${note}` }
      },
    },

    {
      name: 'browser_list',
      description: panel
        ? 'List the TABS of the shell sidebar panel: each row is a tab id, its URL, whether the tab is live, and which one is active ("*"). The tab set belongs to the shell (its \'op=state\' report) and is read fresh on every call - this tool keeps no list of its own. Pass a tab id as \'tab\' to any other browser_* tool to address that tab; without one they act on the active tab, which is the page the user is looking at.'
        : 'List every open browser instance with its id, url, title, viewport, and process. Use this to find the id to pass to other tools.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        assertLive(exec)
        if (panel === true) {
          const { tabs } = await registry.panelTabs()
          const extra = tabs.tabs.length === 0
            ? (tabs.mounted === true ? '\nno tabs yet: the browser is mounted with an empty tab set - browser_tab_new opens one' : '\nthe shell reports the browser is NOT mounted: open it with browser_open')
            : ''
          return { text: tabsText(tabs) + extra }
        }
        const rows = await registry.list()
        if (rows.length === 0) return { text: 'no browser instances are open' }
        const lines = rows.map(
          (r) => `${r.isDefault ? '*' : ' '} ${r.id}  ${r.viewport}  live=${r.live}  ${r.url}${r.title ? `  "${r.title}"` : ''}`,
        )
        return { text: `instances (${rows.length}); "*" marks the default target\n${lines.join('\n')}` }
      },
    },

    {
      name: 'browser_tabs',
      description: panel
        ? 'List the tabs of the shell sidebar panel - id, URL, whether each one is live, and which one is active ("*") - with the shell\'s \'limit\' (how many tabs may exist at once). The tab set is the SHELL\'s (its \'op=state\' report); this reads it fresh every call and keeps nothing of its own. A tab id from here is the name every other browser_* tool takes as \'tab\'; omitting \'tab\' means the active tab.'
        : 'There is no tab set on this channel: every browser instance is a separate window of its own. Calling this refuses by name (TABS_CHANNEL) - use browser_list for the instances.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: TEXT_OUTPUT,
      async execute(_args, exec) {
        assertLive(exec)
        const { tabs } = await registry.panelTabs()
        return { text: tabsText(tabs) }
      },
    },

    {
      name: 'browser_goto',
      description: panel
        ? 'Navigate ONE tab of the shell sidebar panel through the shell\'s own per-tab op, then read where that tab itself landed (the shell records the URL it was asked for, which is not the same thing when a site redirects). ' +
          'Without \'tab\' the ACTIVE tab is navigated - that is the page the user is looking at; pass a tab id, or open one with \'browser_tab_new\', to keep out of their way. Navigating does NOT change which tab is active. ' +
          VIEWPORT_NOTE
        : `Navigate one browser instance to a URL and wait for the page to load. ${VIEWPORT_NOTE}`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: { id: instanceParam, tab: panel ? TAB_PARAM_OP : TAB_PARAM, url: str('Absolute URL, e.g. https://example.com.') },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        const result = await session.goto(args.url, { tab: args.tab })
        if (session.channel === 'panel') {
          const document = result.landed?.document
          const lines = [`tab ${result.tab} navigated`]
          if (typeof document?.href === 'string' && document.href !== '') lines.push('url (read from the tab itself): ' + document.href)
          if (typeof document?.title === 'string' && document.title !== '') lines.push('title: ' + JSON.stringify(document.title))
          if (result.landed?.failure !== undefined && result.landed.failure !== null) {
            lines.push('the tab did not answer after the navigation (' + result.landed.failure + '), so what it shows now is UNVERIFIED')
          } else if (document === undefined || document === null) {
            lines.push('the tab did not answer after the navigation, so what it shows now is UNVERIFIED')
          }
          lines.push('shell record for ' + result.tab + ': ' + (result.record?.url ?? '(none)') + ' (the URL the shell was asked for)')
          if (Number.isFinite(result.tabs?.count) === true) lines.push('tabs: ' + result.tabs.count + '/' + (result.tabs.limit ?? '?') + '; active ' + (result.tabs.active ?? '(none)'))
          return { text: lines.join('\n') }
        }
        const status = await session.status()
        return { text: `instance ${session.id} navigated\nurl: ${result}\ntitle: ${status.title}\nviewport: ${status.width}x${status.height}` }
      },
    },

    {
      name: 'browser_tab_new',
      description: panel
        ? 'Open a NEW tab in the shell sidebar panel and make it the active one (what a browser does). The shell answers with the new tab\'s id - that id is what you pass as \'tab\' from then on, and this tool never invents one. The shell caps how many tabs may exist (browser_tabs reports it as \'limit\') and refuses BY NAME at the cap; its sentence is repeated here word for word. ' +
          'This is how to browse without navigating away the page the user is looking at.'
        : 'Tabs belong to the shell sidebar panel; this deployment runs the chrome channel (DSH_BROWSER_PANEL=0), where each browser instance is a window of its own. Calling this refuses by name (TABS_CHANNEL) - use browser_open.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { url: str('URL for the new tab. Defaults to about:blank.') },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const result = await registry.tabNew({ url: args.url })
        const head = typeof result.created === 'string'
          ? `opened tab ${result.created} (it is the active one now)`
          : 'the shell opened a tab but did not answer with its id; its report says ' + result.tabs.count + ' tab(s), active ' + (result.tabs.active ?? '(none)') + ' - read the rows below to see what exists'
        return { text: head + '\n' + tabsText(result.tabs) }
      },
    },

    {
      name: 'browser_tab_close',
      description: panel
        ? 'Close ONE tab of the shell sidebar panel (default: the active tab). After the active tab closes, the shell makes its LEFT neighbour active - the reply reports the tab set the shell itself reports afterwards, not what this tool asked for. An id the shell does not have is refused BY NAME, with the ids it does have. (browser_close closes the whole panel instead.)'
        : 'Tabs belong to the shell sidebar panel; this deployment runs the chrome channel (DSH_BROWSER_PANEL=0), where each browser instance is a window of its own. Calling this refuses by name (TABS_CHANNEL) - use browser_close.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { tab: panel ? TAB_PARAM_OP : TAB_PARAM },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const result = await registry.tabClose({ tab: args.tab })
        return { text: 'closed tab ' + result.closed + '\n' + tabsText(result.tabs) }
      },
    },

    {
      name: 'browser_tab_activate',
      description: panel
        ? 'Put ONE tab of the shell sidebar panel into the content area and park every other one. This is the tab the USER sees, so activating one takes the view away from whatever they were looking at; the reply reports the active tab the shell itself reports.'
        : 'Tabs belong to the shell sidebar panel; this deployment runs the chrome channel (DSH_BROWSER_PANEL=0), where each browser instance is a window of its own. Calling this refuses by name (TABS_CHANNEL).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { tab: panel ? TAB_PARAM_OP : TAB_PARAM },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const result = await registry.tabActivate({ tab: args.tab })
        return { text: 'activated tab ' + result.activated + '\n' + tabsText(result.tabs) }
      },
    },

    {
      name: 'browser_shot',
      description:
        'Take a real screenshot of the visible page and return the image itself, so you see exactly what the user sees. Optional clip region (x, y, width, height) magnifies part of the page for detail. ' +
        VIEWPORT_NOTE,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: instanceParam,
          tab: TAB_PARAM,
          x: num('Clip left edge in CSS pixels (needs y/width/height too).'),
          y: num('Clip top edge in CSS pixels.'),
          width: num('Clip width in CSS pixels.'),
          height: num('Clip height in CSS pixels.'),
          scale: num('Clip magnification, default 1. Use 2-3 to read small text or icons.'),
          label: str('Short note describing what this screenshot is for.'),
        },
      },
      output: IMAGE_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const attachments = getAttachments()
        if (attachments === undefined) throw new Error('browser_shot needs the attachments service, which this deployment does not compose')
        const session = await target(args)
        const data = await session.shotBytes({ x: args.x, y: args.y, width: args.width, height: args.height, scale: args.scale, tab: args.tab })
        const name = typeof args.label === 'string' && args.label.trim() !== '' ? `${args.label.trim().slice(0, 60)}.png` : `${session.id}-shot.png`
        const ref = await attachments.saveImage({ data, mediaType: 'image/png', name })
        // The tab the image is FROM, not the active one: with a tab named, the status is that tab's.
        const status = args.tab === undefined ? await session.status() : await session.status({ tab: args.tab })
        const clip = [args.x, args.y, args.width, args.height].every((v) => Number.isFinite(v))
          ? `clip ${args.x},${args.y} ${args.width}x${args.height} @${Number.isFinite(args.scale) ? args.scale : 1}x`
          : 'full viewport'
        return {
          text:
            `<browser-screenshot>\ninstance: ${session.id}\nurl: ${status.url}\ntitle: ${status.title}\n` +
            `viewport: ${status.width}x${status.height}\ncapture: ${clip}\n${channelLine(status)}\n` +
            `${mappingNote(status)}\n</browser-screenshot>${await tabSuffix(session, args.tab)}`,
          image: {
            attachmentId: String(ref.attachmentId),
            mediaType: ref.mediaType,
            bytes: ref.bytes,
            width: ref.width,
            height: ref.height,
            ...(ref.name === undefined ? {} : { name: ref.name }),
          },
        }
      },
    },

    {
      name: 'browser_controls',
      description:
        'List the page\'s interactive controls as a short numbered list (role, label, and box per control), and optionally return a screenshot with those numbers painted on the page. ' +
        'This is the cheap, robust way to act: read the numbers, then call browser_pick with a number. Numbers are valid only for the snapshot this call returns — pass that snapshot id back to browser_pick so a control that moved is rejected instead of mis-clicked. ' +
        'Controls that are off-screen are omitted; scroll first (browser_scroll) if the control you want is missing.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: instanceParam,
          tab: TAB_PARAM,
          markers: bool('Also return a screenshot with numbered markers (default true). Set false to save tokens when you already know the layout.'),
          max: int('Cap on listed controls (default from config, 150).'),
        },
      },
      output: TEXT_OR_IMAGE_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        const effective = config.read()
        const wantMarkers = args.markers !== false
        const { snapshot, image: markedPng } = await session.controls({
          markers: wantMarkers,
          maxControls: Number.isFinite(args.max) ? args.max : effective.maxControls,
          tab: args.tab,
        })
        let image
        if (markedPng !== undefined) {
          const attachments = getAttachments()
          if (attachments !== undefined) {
            const ref = await attachments.saveImage({ data: markedPng, mediaType: 'image/png', name: `${session.id}-controls.png` })
            image = {
              attachmentId: String(ref.attachmentId),
              mediaType: ref.mediaType,
              bytes: ref.bytes,
              width: ref.width,
              height: ref.height,
              ...(ref.name === undefined ? {} : { name: ref.name }),
            }
          }
        }
        const lines = snapshot.controls.map((c, i) => {
          const kind = c.k === undefined ? c.r : `${c.r}/${c.k}`
          const bits = [`${i + 1}`, kind]
          if (c.t) bits.push(JSON.stringify(c.t))
          if (c.v !== undefined && c.v !== false && c.v !== '') bits.push(`v=${JSON.stringify(c.v)}`)
          bits.push(`@${c.b.join(',')}`)
          return bits.join(' ')
        })
        const header = `instance=${session.id} snapshot=${snapshot.id} viewport=${snapshot.viewport.width}x${snapshot.viewport.height} controls=${snapshot.controls.length}${wantMarkers && image !== undefined ? ' (markers painted)' : ''}`
        return {
          text: `${header}\n${lines.join('\n')}\nnote: act with browser_pick {n, snapshot:"${snapshot.id}"}` + (await tabSuffix(session, args.tab)),
          ...(image === undefined ? {} : { image }),
        }
      },
    },

    {
      name: 'browser_pick',
      description:
        'Click a control by its number from the latest browser_controls snapshot. The click lands at a random point inside the control\'s own box (never its edge), approached in two mouse steps with human-like timing, so it neither looks synthetic nor breaks on small geometry drift. ' +
        'Pass the snapshot id you read the number from; a stale snapshot is rejected rather than guessed at.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['n'],
        properties: {
          id: instanceParam,
          tab: TAB_PARAM,
          n: int('Control number from the browser_controls listing.'),
          snapshot: str('Snapshot id the number came from (e.g. "b1:3"). Omit only if nothing changed since the listing.'),
          repeat: int('Click the same control N times (default 1), re-jittering each time.'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        const times = Number.isFinite(args.repeat) ? Math.max(1, Math.min(10, Math.round(args.repeat))) : 1
        let last
        for (let i = 0; i < times; i += 1) {
          last = await session.pick({ n: args.n, snapshot: args.snapshot, tab: args.tab })
        }
        const e = last.entry
        return {
          text:
            `picked #${args.n}${times > 1 ? ` x${times}` : ''} on ${session.id}\n` +
            `role: ${e.k === undefined ? e.r : `${e.r}/${e.k}`}${e.t ? `\nlabel: ${JSON.stringify(e.t)}` : ''}\n` +
            `box: ${e.b.join(',')}\nclicked: ${last.point.join(',')}\nsnapshot: ${last.snapshot}\n` +
            'verify with browser_shot, or call browser_controls again if the page changed.' + (await tabSuffix(session, args.tab)),
        }
      },
    },

    {
      name: 'browser_click',
      description:
        `Click at a point with a real synthesized mouse event (move, press, release). Coordinates come from a browser_shot image and are CSS pixels. ${VIEWPORT_NOTE}`,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          id: instanceParam,
          tab: TAB_PARAM,
          x: num('X in CSS pixels, from the left edge of the screenshot.'),
          y: num('Y in CSS pixels, from the top edge of the screenshot.'),
          button: str('left (default), middle, or right.'),
          click_count: int('1 for a single click (default), 2 for a double click.'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        await session.click({
          x: args.x,
          y: args.y,
          button: typeof args.button === 'string' && args.button !== '' ? args.button : 'left',
          clickCount: Number.isFinite(args.click_count) ? args.click_count : 1,
          tab: args.tab,
        })
        return { text: `clicked (${args.x}, ${args.y}) on ${session.id} button=${args.button ?? 'left'} count=${args.click_count ?? 1}. Take a browser_shot to confirm the effect.` + (await tabSuffix(session, args.tab)) }
      },
    },

    {
      name: 'browser_hover',
      description: 'Move the mouse to a point without clicking, to reveal hover menus or tooltips.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: { id: instanceParam, tab: TAB_PARAM, x: num('X in CSS pixels.'), y: num('Y in CSS pixels.') },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        await session.hover({ x: args.x, y: args.y, tab: args.tab })
        return { text: `hovering at (${args.x}, ${args.y}) on ${session.id}` + (await tabSuffix(session, args.tab)) }
      },
    },

    {
      name: 'browser_type',
      description: 'Insert text into the focused element (click or browser_pick the field first). Uses real text input, not a DOM write.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: { id: instanceParam, tab: TAB_PARAM, text: str('The exact text to insert.') },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        await session.insertText(args.text, { tab: args.tab })
        return { text: `inserted ${args.text.length} character(s) into ${session.id}` + (await tabSuffix(session, args.tab)) }
      },
    },

    {
      name: 'browser_key',
      description:
        'Press one named key with a real key event. Supported: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp, PageDown, Home, End, Space.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['key'],
        properties: { id: instanceParam, tab: TAB_PARAM, key: str('One of the supported key names.') },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        const spec = KEY_TABLE[args.key]
        if (spec === undefined) throw new Error(`unsupported key "${args.key}"; supported: ${Object.keys(KEY_TABLE).join(', ')}`)
        await session.pressKey({
          key: args.key,
          code: spec.code,
          windowsVirtualKeyCode: spec.vk,
          tab: args.tab,
          ...(spec.text === undefined ? {} : { text: spec.text }),
        })
        return { text: `pressed ${args.key} on ${session.id}` + (await tabSuffix(session, args.tab)) }
      },
    },

    {
      name: 'browser_scroll',
      description: 'Scroll the page with a real wheel event at an optional point.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['dy'],
        properties: {
          id: instanceParam,
          tab: TAB_PARAM,
          dy: num('Vertical wheel delta in CSS pixels; positive scrolls down.'),
          dx: num('Horizontal wheel delta; positive scrolls right.'),
          x: num('Pointer X for the wheel event (defaults to viewport centre).'),
          y: num('Pointer Y for the wheel event (defaults to viewport centre).'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        await session.scroll({ dy: args.dy, dx: args.dx ?? 0, x: args.x, y: args.y, tab: args.tab })
        return { text: `scrolled dy=${args.dy} dx=${args.dx ?? 0} on ${session.id}` + (await tabSuffix(session, args.tab)) }
      },
    },

    {
      name: 'browser_status',
      description: panel
        ? 'Report the panel browser\'s URL, title, viewport and transport, and WHICH tab the reading is about. Without \'tab\' it is the ACTIVE tab, read from its own renderer; with a tab id it is that tab\'s own document (/location.href/ and /document.title/ read inside that tab), with the panel-level viewport the shell reports - the shell keeps ONE page viewport for the whole panel, so a tab that is not active is never described with the size of its parked window. Reads only browser metadata — never page content, DOM, or site source.'
        : 'Report one instance\'s URL, title, viewport, and debug port. Reads only browser metadata — never page content, DOM, or site source.',
      parameters: { type: 'object', additionalProperties: false, properties: { id: instanceParam, tab: TAB_PARAM } },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const session = await target(args)
        const status = await session.status({ tab: args.tab })
        const head = panel === true ? `panel browser (handle ${session.id})` : `instance ${session.id}`
        return { text: `${head}\n${statusLine(status)}\n${endpointLine(status)}` }
      },
    },

    {
      name: 'browser_close',
      description: panel
        ? 'Let go of the shell sidebar panel (the ONE browser on this channel) or close it: kill=true closes the panel itself, and every tab in it goes with it; the default only detaches this handle and leaves the user\'s panel and its tabs alone. To close ONE tab, use browser_tab_close.'
        : 'Close one browser instance (or every instance with all=true). kill=true also terminates the Chrome window; the default only detaches, leaving the window for the user.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: instanceParam,
          kill: bool('Also terminate the Chrome window (default false: detach only).'),
          all: bool('Close every open instance instead of one.'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        if (args.all === true) {
          const closed = await registry.closeAll({ kill: args.kill === true })
          return { text: closed.length === 0 ? 'no instances to close' : `closed ${closed.length} instance(s): ${closed.join(', ')}` }
        }
        const session = registry.get(args.id)
        if (session === undefined) return { text: `no instance ${args.id ?? '(default)'} to close` }
        const result = await registry.close(session.id, { kill: args.kill === true })
        return { text: result.killed ? `closed instance ${result.id} and its window` : `detached instance ${result.id}; its window stays open` }
      },
    },

    {
      name: 'browser_config',
      description:
        'Read or update the browser capability\'s settings (Chrome executable path, default viewport, visibility, control-list cap). Changes apply to instances opened afterwards; the same values are editable from the sidebar panel.' +
        (panel === true ? ' On the panel channel the viewport values are remembered but NOT applied: the panel\'s size belongs to the shell and the user, and one page viewport serves every tab.' : ''),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          browserExecutable: str('Absolute path to chrome.exe / msedge.exe. Empty string clears it back to auto-detect.'),
          width: int('Default viewport width for new instances.'),
          height: int('Default viewport height for new instances.'),
          visible: bool('Whether new instances show a window (false adds --headless=new).'),
          maxControls: int('Default cap for browser_controls listings.'),
        },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        assertLive(exec)
        const patch = {}
        if (typeof args.browserExecutable === 'string') patch.browserExecutable = args.browserExecutable.trim() === '' ? null : args.browserExecutable.trim()
        if (Number.isFinite(args.width) || Number.isFinite(args.height)) {
          const current = config.read()
          patch.viewport = { width: args.width ?? current.viewport.width, height: args.height ?? current.viewport.height }
        }
        if (typeof args.visible === 'boolean') patch.visible = args.visible
        if (Number.isFinite(args.maxControls)) patch.maxControls = args.maxControls
        const effective = Object.keys(patch).length > 0 ? config.write(patch) : config.read()
        return {
          text:
            `config file: ${config.file}\n` +
            `browserExecutable: ${effective.browserExecutable ?? '(auto-detect)'}\n` +
            `viewport: ${effective.viewport.width}x${effective.viewport.height}\n` +
            `visible: ${effective.visible}\nmaxControls: ${effective.maxControls}`,
        }
      },
    },
  ]
}

export const BROWSER_TOOL_NAMES = Object.freeze([
  'browser_open',
  'browser_list',
  'browser_tabs',
  'browser_goto',
  'browser_tab_new',
  'browser_tab_close',
  'browser_tab_activate',
  'browser_shot',
  'browser_controls',
  'browser_pick',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_key',
  'browser_scroll',
  'browser_status',
  'browser_close',
  'browser_config',
])
