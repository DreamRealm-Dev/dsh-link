/* DSH Link: the right column's browser panel host (R144).
 *
 * It answers one question the shell cannot answer from the inside: WHERE IS THE RIGHT COLUMN RIGHT NOW?
 * Tauri's auto_resize scales a child webview proportionally with the window, so the column's pixel-level
 * geometry (a divider drag, a collapse, a tab of a different width) never reaches the native view unless
 * the page measures it and says so.
 *
 * The surface is found by a marker attribute rather than by a hashed class name. R178 changed WHICH marker:
 * the browser belongs in the rail's BROWSER PANE, not over the rail. Measured before the change, the panel was
 * placed at 1128,36 300x852 - the rail's own box - and that box contains the rail's tab strip (role=tab at
 * 1151,58 100x28) and the pane's own controls, so the browser was a lid on the control that switches panes.
 * The browser pane's body measured 1141,86 275x790, and DSH parks an INACTIVE pane's body at 0x0.
 * dsh-browser therefore declares the surface it wants filled, with data-dsh-link-surface="true".
 * Nothing here invents geometry: with no surface marker, when it is hidden, or when it is too small to hold
 * a browser, the panel is CLOSED rather than placed at 0x0.
 *
 * The window is decoration-free, so viewport coordinates ARE the window's client area: the CSS pixels
 * getBoundingClientRect reports are the logical pixels op=set-bounds wants.
 *
 * open is asynchronous (the child webview is created on its own thread), so a fresh placement retries
 * until the shell answers that the panel exists, and gives up loudly in the console.
 */
(function () {
  if (globalThis.__DSH_LINK_PANEL_HOST) { return }
  /* ABSOLUTE: the shell parses the url with tauri's Url::parse, which refuses a relative one
   * ("relative URL without a base"). Measured the hard way in R144: a relative HOME made every
   * open answer HTTP 400 and left the panel closed while the column was wide open. */
  // R169: the panel's own start page, NOT the client's UI. Opening it on '/__shell/' put the DSH shell inside the
// sidebar browser (measured in R164: the home screen with its own left rail, drawn inside the panel's rectangle).
var HOME = location.origin + '/__shell/panel-start';
  var MIN = 48; /* a surface smaller than this holds no browser */
  var STATE = { open: false, url: HOME, placed: null, last: null, healAt: null, settleUntil: 0, placing: false, again: null, drag: { dx: 0, dy: 0, dw: 0, dh: 0 } };
  function post(payload) {
    return fetch('/__shell/panel', {
      method: 'POST', credentials: 'omit',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    }).then(function (answer) { return answer.json() }).catch(function () { return null })
  }
  /* R178: the surface the native browser fills is declared by the plugin whose pane it is - not by the rail.
   * A missing marker (no browser pane mounted) and a 0x0 marker (DSH parks an inactive pane's body there) both
   * mean the same thing to this loop: no surface, so CLOSE. The rail's own tab strip stays uncovered, which is
   * what makes the pane switchable while a browser is open. */
  function column() {
    return document.querySelector('[data-dsh-link-surface="true"]')
  }
  /* R178: a COLLAPSED rail does not zero the pane - it keeps the body at 275x790 and pushes the whole rail
   * past the right edge of the viewport (measured: col x=1428 w=0, pane body x=1441 while innerWidth=1440).
   * A rect that is still non-zero but wholly outside the viewport is not a surface: placing the native panel
   * there leaves a live window parked off-screen, which is exactly what "collapsed" must not do. The
   * off-viewport test is the one that survives both shapes (zero size and pushed-out rect). */
  function onScreen(spot) {
    if (spot === null) { return null }
    var vw = window.innerWidth || 0
    var vh = window.innerHeight || 0
    var inside = spot.x < vw && spot.y < vh && spot.x + spot.w > 0 && spot.y + spot.h > 0
    return inside ? spot : null
  }
  function rect() {
    var box = column()
    if (box === null) { return null }
    var style = getComputedStyle(box)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') { return null }
    var measured = box.getBoundingClientRect()
    if (measured.width < MIN || measured.height < MIN) { return null }
    /* R395: during the settle window after a restore, a rect that suddenly covers the whole viewport is the deck's
     * transient reflow, not the sidebar's geometry - refuse it for this tick instead of painting the panel over the
     * window. Once the window is back (settleUntil passed) the same rect is accepted, so a real full-window mode still
     * works. */
    if (Date.now() < STATE.settleUntil && typeof window.innerWidth === 'number') {
      if (measured.width >= window.innerWidth - 8 && measured.height >= window.innerHeight - 8) { return null }
    }
    var spot = { x: Math.round(measured.left), y: Math.round(measured.top), w: Math.round(measured.width), h: Math.round(measured.height) }
    /* R178 (settled): the panel takes the pane body's rectangle EXACTLY - all four sides keep DSH's own inset.
     * The rail measures 791,36 637x852 and the pane body 804,86 612x790, so the frame reserves 13px left, 12px
     * right and 12px bottom (and the tab strip above). Two attempts to eat that reserved space both failed:
     * taking the rail's LEFT edge covered the centre of the rail's divider handle (787,36 8x852, reaching 4px
     * inside), so the divider could no longer be grabbed - WindowFromPoint at its centre returned the panel
     * window; taking the rail's BOTTOM edge put a square panel corner flush against the rail's rounded frame,
     * which the user reported as the corner radius breaking the frame (leading edge flush, other three sides
     * inset). The rule is therefore symmetry with DSH's frame, not maximal area. */
    /* R350: a PERSON may move or resize the panel; the rail keeps measuring. The override is an OFFSET from the
     * measured surface, not an absolute rect, so dragging the rail divider or resizing the window still carries the
     * panel with it - an absolute rect would strand the panel over a column that moved. */
    var moved = {
      x: Math.round(measured.left) + STATE.drag.dx,
      y: Math.round(measured.top) + STATE.drag.dy,
      w: Math.max(MIN, Math.round(measured.width) + STATE.drag.dw),
      h: Math.max(MIN, Math.round(measured.height) + STATE.drag.dh)
    }
    var vw = window.innerWidth || 0
    var vh = window.innerHeight || 0
    if (moved.x < 0) { moved.w += moved.x; moved.x = 0 }
    if (moved.y < 0) { moved.h += moved.y; moved.y = 0 }
    if (moved.x + moved.w > vw) { moved.w = Math.max(MIN, vw - moved.x) }
    if (moved.y + moved.h > vh) { moved.h = Math.max(MIN, vh - moved.y) }
    return onScreen(moved)
  }
  function key(spot) { return spot === null ? 'closed' : [spot.x, spot.y, spot.w, spot.h].join(',') }
  /* R396: ONE placement outstanding at a time, and the newest rect wins.
   *
   * A restore makes the answer slow (the shell is re-presenting the child webviews), and the 400 ms beat below
   * used to post the same rect again for as long as that took - each post a fresh round of native SetBounds calls
   * in the shell, on the one occasion where those calls are expensive. Now a tick that arrives while a placement
   * is in flight only records the rect it wanted; the answer schedules the next attempt. */
  function place(spot, tries) {
    if (STATE.placing === true) { STATE.again = spot; return }
    STATE.placing = true
    post({ op: 'set-bounds', x: spot.x, y: spot.y, w: spot.w, h: spot.h }).then(function (answer) {
      STATE.placing = false
      if (answer !== null && answer.exists === true) {
        STATE.placed = key(spot)
        if (STATE.again !== null) { var latest = STATE.again; STATE.again = null; place(latest, 0) }
        return
      }
      if (tries < 15) {
        setTimeout(function () {
          var wanted = STATE.again === null ? spot : STATE.again
          STATE.again = null
          place(wanted, tries + 1)
        }, 200)
      } else { console.warn('DSH Link panel: the shell never reported an existing panel to place') }
    })
  }
  var ticks = 0
  function sync() {
    var spot = rect()
    drawGrips(spot)
    var wanted = key(spot)
    // Reconcile with the shell now and then. The host's belief can go stale: anything else that closes the
    // panel (a gate, a future toolbar button, a crash) leaves STATE.open true while the shell has no panel,
    // and then the geometry never changes and the panel never comes back. Measured in R146: the column was
    // open and the panel stayed closed forever. A cheap state read on a slow beat fixes it without making
    // the fast path any heavier.
    ticks += 1
    if (spot !== null && STATE.open === true && ticks % 12 === 0) {
      post({ op: 'state' }).then(function (answer) {
        // While a lease is held the holder is doing the whole job itself (open, place, measure, close), so the
        // host stands down: it must not reopen, move or close anything. R152 got the ORDER wrong - it paused
        // the host while the gates still waited for it - and all four live gates went red; the gates are now
        // self-sufficient (R153), which is what makes this pause safe.
        if (answer !== null && answer.lease !== null && answer.lease !== undefined && answer.lease.held === true) {
          STATE.healAt = Date.now() + 5000
          return
        }
        if (answer !== null && answer.exists !== true) {
          // Somebody else closed it. Believe that for a while instead of reopening immediately: a control
          // that closes the panel and is overruled five seconds later is worse than one that closes it.
          // The panel is still recovered after the grace, because a panel lost to a crash must come back.
          STATE.open = false
          STATE.last = null
          STATE.healAt = Date.now() + 10000
        } else if (answer !== null && answer.exists === true) {
          /* R172: exists is NOT enough, and this is the hole R171 measured. The fast path above returns early while
           * `wanted === STATE.last`, and STATE.last is the HOST'S MEMORY, not the shell's reality. So a panel that
           * exists somewhere else - a rect left by whoever opened it, a panel a gate moved, a panel re-created after a
           * close/open cycle - stays there for as long as the column's own geometry does not change. Measured: the shell
           * reported the panel at 0,0 630x900 (the creation rectangle) with the column at 1128,36 300x852, and nothing
           * ever moved it. The slow beat therefore re-verifies the RECT, not just the fact that something exists, and
           * forgets what it thought it had placed so the next tick places it again. */
          var box = answer.bounds
          var factor = window.devicePixelRatio || 1
          var logical = box === null || box === undefined ? null : (box.units === 'logical' ? box : { x: box.x / factor, y: box.y / factor, w: box.w / factor, h: box.h / factor })
          var off = logical === null || spot === null || Math.max(Math.abs(logical.x - spot.x), Math.abs(logical.y - spot.y), Math.abs(logical.w - spot.w), Math.abs(logical.h - spot.h)) > 3
          if (off) { STATE.last = null }
        }
      })
    }
    if (spot !== null && STATE.open === false && STATE.healAt !== null && Date.now() < STATE.healAt) {
      return
    }
    if (spot !== null && STATE.open === false) { STATE.healAt = null }
    /* R393: a placement is trusted only once the SHELL confirmed it (STATE.placed is set in place() when the answer
     * says exists). Without that term the host skips a re-place whenever its own measurement matches its own memory -
     * and a restore can recreate the child windows from a surface the host never confirmed, so the native rect can
     * disagree with the page forever. (Diagnosed from the shell side: the panel is unmounted while the window is
     * minimised and rebuilt from the stale surface on restore; nothing in handle_run_event reacts to a restore.) */
    if (wanted === STATE.last && STATE.placed === wanted && (spot !== null) === STATE.open) { return }
    STATE.last = wanted
    if (spot === null) {
      if (STATE.open) { STATE.open = false; STATE.placed = null; post({ op: 'close' }) }
      return
    }
    if (STATE.open === false) {
      STATE.open = true
      var fresh = spot
      post({ op: 'open', url: STATE.url }).then(function (answer) {
        /* A refused open must NOT wedge the host in "open" forever: that is exactly what a relative
         * url did before this line existed - the state said open, the shell said exists=false, and
         * nothing ever tried again. A refusal resets the flag and lets the next sync retry. */
        if (answer === null || typeof answer.error === 'string') {
          STATE.open = false
          STATE.last = null
          console.warn('DSH Link panel: the shell refused the open: ' + (answer === null ? 'no answer' : answer.error))
          return
        }
        place(fresh, 0)
      })
      return
    }
    place(spot, 0)
  }

  /* R350: the two grips a person asked for - drag the bar above the panel to MOVE it, drag the corner to RESIZE it.
   * They live OUTSIDE the panel rectangle on purpose: the panel is a native child webview, so anything the page draws
   * inside that rect is covered by it and can never receive a pointer event. The bar sits just above the surface and the
   * corner just past its bottom-right; both are 12px of page, not a new chrome. Double-clicking the bar puts the panel
   * back where the rail says it should be. */
  var GRIP = null
  function grips() {
    if (GRIP !== null && document.documentElement.contains(GRIP.box) === true) { return GRIP }
    var box = document.createElement('div')
    box.setAttribute('data-dsh-link-grips', '')
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000'
    var bar = document.createElement('div')
    bar.setAttribute('data-dsh-link-grip', 'move')
    bar.title = '拖动这里移动浏览器窗口；双击复位'
    bar.style.cssText = 'position:fixed;pointer-events:auto;cursor:move;height:12px;border-radius:6px 6px 0 0;background:transparent'
    bar.addEventListener('pointerenter', function () { bar.style.background = 'rgba(120,170,255,0.35)' })
    bar.addEventListener('pointerleave', function () { bar.style.background = 'transparent' })
    var corner = document.createElement('div')
    corner.setAttribute('data-dsh-link-grip', 'resize')
    corner.title = '拖动这里改变大小'
    corner.style.cssText = 'position:fixed;pointer-events:auto;cursor:nwse-resize;width:16px;height:16px;border-radius:0 0 6px 6px;background:transparent'
    corner.addEventListener('pointerenter', function () { corner.style.background = 'rgba(120,170,255,0.45)' })
    corner.addEventListener('pointerleave', function () { corner.style.background = 'transparent' })
    box.appendChild(bar)
    box.appendChild(corner)
    document.documentElement.appendChild(box)
    GRIP = { box: box, bar: bar, corner: corner }
    return GRIP
  }

  /* One drag: pointer capture, the offsets it produced, and nothing else. The rect is re-reported through the same
   * `place()` the geometry loop uses, so a drag and a rail resize go down one path. */
  function draggable(element, kind) {
    element.addEventListener('pointerdown', function (event) {
      if (event.button !== 0) { return }
      event.preventDefault()
      var start = { x: event.clientX, y: event.clientY, dx: STATE.drag.dx, dy: STATE.drag.dy, dw: STATE.drag.dw, dh: STATE.drag.dh }
      /* A pointer id the browser does not know throws NotFoundError, and a drag nobody can start is worse than a drag
       * without capture: the move listeners below are what actually drive the gesture. (Measured while testing the grips
       * with synthetic PointerEvents: capture threw, and the resize grip did nothing at all.) */
      try { element.setPointerCapture(event.pointerId) } catch (error) { /* the listeners still drive the drag */ }
      var move = function (moveEvent) {
        var deltaX = moveEvent.clientX - start.x
        var deltaY = moveEvent.clientY - start.y
        if (kind === 'move') { STATE.drag.dx = start.dx + deltaX; STATE.drag.dy = start.dy + deltaY }
        else { STATE.drag.dw = start.dw + deltaX; STATE.drag.dh = start.dh + deltaY }
        var spot = rect()
        if (spot !== null) { place(spot, 0) }
      }
      var done = function () {
        element.removeEventListener('pointermove', move)
        element.removeEventListener('pointerup', done)
        element.removeEventListener('pointercancel', done)
        STATE.last = null
        sync()
      }
      element.addEventListener('pointermove', move)
      element.addEventListener('pointerup', done)
      element.addEventListener('pointercancel', done)
    })
  }

  function drawGrips(spot) {
    var handle = grips()
    var vw = window.innerWidth || 0
    var vh = window.innerHeight || 0
    var visible = spot !== null && spot.y - 12 >= 0
    handle.bar.style.display = visible ? 'block' : 'none'
    handle.corner.style.display = spot === null ? 'none' : 'block'
    if (spot === null) { return }
    handle.bar.style.left = spot.x + 40 + 'px'
    handle.bar.style.top = (spot.y - 12) + 'px'
    handle.bar.style.width = Math.max(24, spot.w - 80) + 'px'
    handle.bar.style.maxWidth = Math.max(24, vw - spot.x - 40) + 'px'
    handle.corner.style.left = Math.min(vw - 16, spot.x + spot.w - 8) + 'px'
    handle.corner.style.top = Math.min(vh - 16, spot.y + spot.h - 8) + 'px'
  }

  draggable(grips().bar, 'move')
  draggable(grips().corner, 'resize')
  grips().bar.addEventListener('dblclick', function () { STATE.drag = { dx: 0, dy: 0, dw: 0, dh: 0 }; STATE.last = null; sync() })
  globalThis.__DSH_LINK_PANEL_HOST = {
    sync: sync,
    resetDrag: function () { STATE.drag = { dx: 0, dy: 0, dw: 0, dh: 0 }; STATE.last = null; sync() },
    setUrl: function (url) {
      STATE.url = new URL(url, location.href).href
      if (STATE.open) { STATE.open = false; post({ op: 'close' }).then(function () { STATE.last = null; sync() }) }
    },
    state: function () { return { open: STATE.open, url: STATE.url, last: STATE.last, placed: STATE.placed } }
  }
  /* The column is React's element and can be replaced, so a cheap poll is the dependable trigger.
   * A ResizeObserver shortens the path where the browser has one; neither invents geometry. */
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () { sync() }).observe(document.documentElement)
  }

  /* R390: a MINIMISE + RESTORE leaves the native child webview at whatever geometry the window resize produced -
   * measured by the person using it as "the browser pane fills the whole window". The rect the page reports for the
   * surface is UNCHANGED by that round trip, so the early return above (wanted === STATE.last) never places it again,
   * and the slow beat only corrects bounds that differ from what the shell recorded. Both events therefore forget what
   * the host thought it had placed, so the next tick re-places from the current measurement. */
  /* R395: the restore is a RACE. Measured twice in one session: straight after a minimise+restore the page's deck can
   * report the WHOLE window (deck 612 -> 1415 logical, chrome 918 -> 2123 physical) and the client reflows back a moment
   * later. Placing during that window is what leaves the panel filling the screen, so for a short settle period the host
   * refuses a rect that suddenly covers almost the entire viewport, and places again as soon as the layout is back.
   * A legitimate full-window mode is unaffected: it survives the settle period, and a settled rect is never filtered. */
  window.addEventListener('resize', function () { STATE.last = null; STATE.settleUntil = Date.now() + 1500 })
  if (document.addEventListener) {
    /* R396: this handler USED to call sync() - i.e. it posted op=set-bounds from the visibilitychange event itself,
     * which is the worst moment to ask the shell for native work: the window has just been restored, its child
     * webviews are being re-presented by the compositor, and the rect being measured belongs to a layout that is
     * still reflowing (that is what settleUntil above is for). Forgetting what the host thought it had placed is
     * still the point of the handler - the shell re-places from its own stored surface on the same transition - so
     * the next beat places exactly once, on the settled layout, and the restore costs the renderer this tick
     * instead of a native round trip inside the event. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { STATE.last = null; STATE.placed = null; STATE.settleUntil = Date.now() + 1500 }
    })
  }

  setInterval(sync, 400)
})();
