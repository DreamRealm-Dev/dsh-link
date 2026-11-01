/* DSH Link: what the PANEL itself is showing (R145).
 *
 * Injected into the panel's webview by the shell as an initialization script, so it runs in whatever page
 * the panel loads - including a real website the shell cannot script into. It answers the two questions a
 * one-line 'it opened' reading cannot: WHAT is displayed (title, href, how much text) and whether the
 * load FAILED (a navigation error or a page that never produced a body), which is the silent white screen
 * the sidebar is not allowed to have.
 *
 * The report is a cross-origin POST to the shell on loopback, so it is sent with mode: no-cors and a
 * text/plain body: that is a simple request (no preflight) and the shell parses the body itself. Chromium
 * treats 127.0.0.1 as a trustworthy origin, so an https page is not blocked from reaching it.
 */
(function () {
  if (globalThis.__DSH_LINK_PANEL_REPORTER) { return }
  globalThis.__DSH_LINK_PANEL_REPORTER = true
  var ENDPOINT = 'http://127.0.0.1:31761/__shell/panel/report'
  /* The three signals that mean "a human is driving this panel now" (see the note at the end of this
   * file). Kept in one place so this script and the shell cannot drift apart about what counts. */
  var USER_INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel']
  var failures = []
  window.addEventListener('error', function (event) {
    failures.push(String(event && event.message ? event.message : event))
    if (failures.length > 5) { failures.shift() }
    send()
  })
  window.addEventListener('unhandledrejection', function (event) {
    failures.push('unhandledrejection: ' + String(event && event.reason ? event.reason : ''))
    send()
  })
  function send() {
    var body = null
    try {
      body = document.body
    } catch (error) { body = null }
    var payload = {
      href: String(location.href),
      title: String(document.title || ''),
      readyState: String(document.readyState),
      textLength: body === null ? -1 : String(body.innerText || '').length,
      hasFocus: document.hasFocus() === true,
      failures: failures,
      at: Date.now()
    }
    payload.via = 'fetch'
    try {
      fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(payload) })
    } catch (error) { /* a panel that cannot report is still a panel; the shell's own readings stay */ }
    // A second, independent channel. R146 measured that a fetch from a real https page never arrives (the
    // only candidate left was that cross-origin POST itself), while the same reporter works fine from the
    // shell's own page. An image load is not a fetch: it triggers no preflight, it is not a CORS request at
    // all, and a handshake is all this needs. If THIS one does not arrive either, the conclusion is no longer
    // "use another page-side channel" but "the page cannot reach the shell, so read it through the webview's
    // own DevTools protocol instead" - which is where this is heading anyway for AI self-control.
    try {
      var query = 'via=beacon&href=' + encodeURIComponent(String(payload.href)) +
        '&title=' + encodeURIComponent(String(payload.title)) +
        '&readyState=' + encodeURIComponent(String(payload.readyState)) +
        '&textLength=' + encodeURIComponent(String(payload.textLength)) +
        '&hasFocus=' + (payload.hasFocus === true ? '1' : '0') +
        '&at=' + String(payload.at)
      var probe = new Image()
      probe.src = ENDPOINT + '?' + query + '&t=' + String(Date.now())
    } catch (error) { /* same as above */ }
  }
  send()
  document.addEventListener('DOMContentLoaded', send)
  window.addEventListener('load', send)
  window.addEventListener('focus', send)
  window.addEventListener('blur', send)
  setInterval(send, 2000)

  /* R178-T: THE USER WINS.
   *
   * A real input in this document - a pointer press, a key, a wheel - is the one signal a page cannot
   * fake and exactly what "the user took the browser back" means. It is reported IMMEDIATELY on the same
   * beacon channel (not on the 2 s beat) with a marker the shell acts on: the shell revokes the AI's lease
   * BY NAME, so the next AI write or protocol call is refused and must claim again.
   *
   * Capture phase, so a page that stops propagation still cannot hide the user's own input. Throttled: a
   * wheel burst is one report, not fifty. The keydown path is the one an external injector reaches
   * (CDP Input.dispatchKeyEvent produces a trusted key event) - which is how a gate can stage "the user
   * typed" without touching anything on the page.
   */
  var lastInputAt = 0
  function userInput(kind) {
    var at = Date.now()
    if (at - lastInputAt < 150) { return }
    lastInputAt = at
    try {
      var probe = new Image()
      probe.src = ENDPOINT + '?userInput=' + encodeURIComponent(String(kind)) + '&at=' + String(at) + '&t=' + String(at)
    } catch (error) { /* a panel that cannot report is still a panel */ }
  }
  /* R179-A: this script is injected into EVERY child window, the shell's own browser page included, and on
   * THAT page the input is already spoken for. Every control there posts an op of its own, and the shell
   * classifies it by its referer as USER_SHELL_HOLDER - a write that takes the turn by name and is then
   * carried out. Reporting the pointer events of the same click as well produced TWO signals for one
   * gesture, and the first one (pointerdown, fired before the control's click handler) revoked the lease
   * before the control's own op could run. Measured on the gate for this round: op=cdp mouseReleased came
   * back 400 "the lease held by ... was REVOKED by user-input (pointerdown)" and the click never completed,
   * so the control could not apply the change it was clicked for.
   *
   * The shell's browser page therefore reports no input events; every other document - a real site the user
   * is reading, which has no controls of ours to speak for it - reports them exactly as before.
   */
  var onShellBrowserPage = false
  try { onShellBrowserPage = String(location.pathname || '').indexOf('/__shell/browser') === 0 } catch (error) { onShellBrowserPage = false }
  if (!onShellBrowserPage) {
    for (var i = 0; i < USER_INPUT_EVENTS.length; i++) {
      window.addEventListener(USER_INPUT_EVENTS[i], (function (kind) {
        return function () { userInput(kind) }
      })(USER_INPUT_EVENTS[i]), { capture: true, passive: true })
    }
  }
})();
