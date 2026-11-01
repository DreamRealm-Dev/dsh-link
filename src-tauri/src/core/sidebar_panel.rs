//! The right column's browser panel: **one native child webview**, positioned by the page.
//!
//! The split is deliberate. The official client owns tab identity, the tab strip, the split and
//! the divider; the shell owns exactly one native webview per panel label and the WebView2 profile
//! it runs in. Two measured facts shape everything here:
//!
//! - **The rect comes from the page, not from Tauri.** `auto_resize` scales a child webview
//!   *proportionally* with the window, so dragging the right column's divider (a pixel-level
//!   layout change) does not move it. The page measures the container and calls `set-bounds`.
//! - **The profile directory is fixed and belongs to the panel.** Leaving it unset would put a
//!   third-party site's cookies in the *main window's* `EBWebView`, sharing a jar with the DSH
//!   client's own document. A fixed directory is also what makes the site data survive a restart
//!   (measured in R141: cookie/localStorage/IndexedDB read back on the next process, empty when
//!   the directory is new).
//!
//! Creation runs on its own thread: on Windows, adding a child webview from the shell's own thread
//! deadlocks. `open` therefore returns as soon as the work is *scheduled*, and `report` is how a
//! caller learns when the panel actually exists.
//!
//! ## R178-G: the host grew from one webview into a browser
//!
//! One child webview could only ever be *a page*: no tab strip, no page-size mode, and nothing the
//! shell itself draws. The host now owns four things and no browser semantics:
//!
//! - the **surface** the plugin declares (op=surface), cut in two: a CHROME_H-tall strip holding OUR
//!   OWN page (BROWSER_UI_HTML, served at BROWSER_UI_PATH) and the content area holding the page;
//! - **one child webview per tab**, labelled sidebar-browser-tab-<n>: the active tab sits in the
//!   content area, and every other tab is parked out of the client area at ZERO size - a hidden tab
//!   that still owns a non-zero rectangle is the one shape the contract forbids, and op=state
//!   reports each tab's real rect so it can be checked rather than believed;
//! - the two page-viewport **modes** - fixed (default) through Emulation.setDeviceMetricsOverride
//!   with the content-rect scale, fit through Emulation.clearDeviceMetricsOverride - applied through
//!   the in-process protocol;
//! - the **lease** (R166), which every write above is still refused by name for.
//!
//! The old names stay as aliases of the new ones (open = mount, close = unmount, set-bounds =
//! surface) because the page host that measures the column still speaks them; there is one
//! implementation behind both names, never two semantics.
//!
//! ## R179-A: the browser became a VM-style preview window
//!
//! Three things changed, each with a reading behind it:
//!
//! - The page viewport is now a **choice**, not a constant: op=viewport takes a named preset
//!   ([`VIEWPORT_PRESETS`]) or a custom W×H, refuses anything else BY NAME without touching the state,
//!   and writes the choice to [`BROWSER_PREFS_FILE`] so the next process starts on the same resolution.
//! - The content area is a **bay**, and the active tab is a **screen** inside it: the chrome page
//!   ([`BROWSER_UI_HTML`]) now owns the bar AND the bay, so it can paint the letterbox and the screen
//!   frame itself, and the tab's window is placed on screenPane - the viewport's aspect ratio centred
//!   in the bay - instead of being stretched over the bay. In fit mode there is no fixed viewport, so
//!   the screen IS the bay and scale stays null (the documented conversion factor of 1).
//! - A write that comes from the shell's own browser page ([`USER_SHELL_HOLDER`]) is the USER's hand:
//!   it takes the turn away from whoever holds the lease by name (revokedBy user-input, the same record
//!   [`note_user_input`] writes) and is then carried out, instead of being refused as a stranger's.
//!   R178-G measured that shape as a product bug (the user's own clicks were refused while an AI drove
//!   the panel); it is the R178-T rule applied to the one input device that had no name.
//!   An AI's own write is unchanged: refused by name under somebody else's lease, and refused after a
//!   takeover until it claims again.
//!
//! ## R184-D: the shell's OWN injection is not the user's hand
//!
//! R183-C measured the other half of that rule and handed it up as a design question: `op=cdp` with an
//! `Input.*` method delivers a TRUSTED event into the page it addresses, the panel's reporter beacons it
//! back as `?userInput=<kind>` (core/panel_reporter.js), and the shell revoked the caller's own lease for
//! it - so an AI that clicked its own panel handed the turn to the user, and the second half of one click
//! pair came back 502 (`the lease held by r183-ctl was REVOKED by user-input (pointerdown)`, reproduced in
//! `.tmp/r183-suite/r183-revoke-control.mjs`). The owner's ruling: the injection is the SHELL's own doing,
//! and the shell has the information to tell it apart from a real hand, so it must.
//!
//! [`INJECTION_GRACE`] is that information, and it is the only new rule: during and just after an
//! injecting protocol call, a report the panel sends back is attributed to the injection, recorded in
//! `lease.injection` (never silently dropped), and does NOT take the turn. Everything outside that window
//! is unchanged - a real input, and the bare `GET /__shell/panel/report?userInput=` beacon a page (or a
//! gate) can send with no gesture at all, still takes the panel by name.
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

// The child-webview geometry types and the builder that creates one are named only by the
// desktop entry points below. Android renders the client in the activity's one webview, where
// there is no second rectangle to place, so these have nothing to name on a mobile build.
#[cfg(desktop)]
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, Position, Rect, Size, WebviewUrl};

/// The pre-R178 child webview label. One panel per label, and that is exactly why the browser host no
/// longer creates it: a browser needs a window per tab (TAB_PREFIX) plus one for its own chrome
/// (CHROME_LABEL). It is kept as the record of what the single-panel shell used to create, and as the name
/// any older reading in docs/ or scripts/ is talking about; the allow is for that, not for an oversight.
/// (R178-T: core/panel_cdp.rs used to be its last consumer - that module is gone, merged into
/// `call_cdp_on` below, so the label-bound protocol wrapper exists exactly once now.)
#[allow(dead_code)]
pub const PANEL_LABEL: &str = "sidebar-panel";

/// The panel's own WebView2 profile, under the app's local data directory. Not the main
/// window's `EBWebView` (see the module docs), and not a temporary directory: the directory
/// *is* the login state.
pub const PANEL_PROFILE: &str = "sidebar-panels/p0";

/// The label of the shell's own browser page: the tab strip, the address and the mode switch. It is a
/// second child webview of the main window, placed in the surface's top CHROME_H pixels.
pub const CHROME_LABEL: &str = "sidebar-browser-chrome";

/// Tab labels are sidebar-browser-tab-<n> - the contract's own shape. One child webview each, so each
/// tab has its own renderer, history and session inside the panel's single profile.
pub const TAB_PREFIX: &str = "sidebar-browser-tab-";

/// The height of the chrome strip, in logical (CSS) pixels, cut off the TOP of the surface.
///
/// It is also written into the browser page as --dsh-browser-chrome-h and reported by the shell as
/// chromeH, and the page reports what it REALLY laid out (__DSH_BROWSER.readings().barH): a constant
/// that only lives in this file is a constant the layout can silently disagree with.
pub const CHROME_H: f64 = 36.0;

/// The chin: the strip of the surface left EMPTY below the content area (owner ruling, R178-U follow-up:
/// the user asked for a bottom inset the way the top has the chrome strip). Same rule as CHROME_H - the
/// number is cut off the content rect AND reported in op=state as `chinH`, so
/// `surface.h - chromeH - chinH == contentPane.h` can be checked rather than assumed.
pub const CHIN_H: f64 = 12.0;

/// How many tabs may exist at once. Each is a renderer process; a fifth is refused BY NAME (the op, the
/// id it asked for, the limit, and the tab ids that exist), never silently dropped.
pub const MAX_TABS: usize = 4;

/// The fixed mode's page viewport.
///
/// R439: the person asked for 1920x1080 as the starting UI size, adjustable from the chrome's two number fields and
/// through `op=viewport` (so an Agent can set it on demand). It is the first entry of `VIEWPORT_PRESETS` for the same
/// reason 1280x800 was: a fresh browser must start on the named preset a caller can read back.
pub const DEFAULT_VIEWPORT: (f64, f64) = (1920.0, 1080.0);

/// R179-A: the named page viewports op=viewport accepts. (name, width, height, label)
///
/// The names ARE the sizes ("1280x800"), because a name is what a caller repeats back and what the
/// refusal lists; the label is only what the chrome page prints beside it. The first entry is
/// [`DEFAULT_VIEWPORT`]: the contract's 1280x800 is still what a fresh browser starts on.
pub const VIEWPORT_PRESETS: &[(&str, f64, f64, &str)] = &[
    ("1920x1080", 1920.0, 1080.0, "默认 FHD"),
    ("1280x800", 1280.0, 800.0, "WXGA"),
    ("1024x768", 1024.0, 768.0, "XGA"),
    ("1366x768", 1366.0, 768.0, "笔记本"),
    ("1440x900", 1440.0, 900.0, "WXGA+"),
    ("1600x900", 1600.0, 900.0, "HD+"),
    ("834x1194", 834.0, 1194.0, "平板"),
    ("390x844", 390.0, 844.0, "手机"),
];

/// R179-A: what a custom W×H may be. Below the floor a page is not a page; above the ceiling the
/// screen pane is huge before it is small (and WebView2's device-metrics override has limits of its
/// own). A refusal names both numbers.
pub const VIEWPORT_MIN: f64 = 200.0;
pub const VIEWPORT_MAX: f64 = 5120.0;

/// R179-A: the file the chosen resolution and mode survive a restart in, inside the app's config
/// directory - the same directory `shell.json` (see [`super::shellprefs`]) lives in, and the same
/// pattern, but a FILE OF ITS OWN: `ShellWindow::save` rewrites shell.json from its own three keys, so
/// anything the browser stored there would be dropped by the next theme change.
pub const BROWSER_PREFS_FILE: &str = "browser.json";

/// The name of the page viewport a size IS a preset of, or `None` for a custom one.
fn preset_of(viewport: (f64, f64)) -> Option<&'static str> {
    VIEWPORT_PRESETS
        .iter()
        .find(|(_, w, h, _)| *w == viewport.0 && *h == viewport.1)
        .map(|(name, _, _, _)| *name)
}

/// The presets, as the JSON the chrome page renders and a reading can check.
fn presets_json() -> String {
    let rows: Vec<String> = VIEWPORT_PRESETS
        .iter()
        .map(|(name, w, h, label)| {
            format!(
                r#"{{"name":{},"w":{w},"h":{h},"label":{}}}"#,
                json_string(name),
                json_string(label)
            )
        })
        .collect();
    format!("[{}]", rows.join(","))
}

/// Our own browser chrome page, served by the shell from its own origin.
pub const BROWSER_UI_PATH: &str = "/__shell/browser";

/// The chrome page's bytes. Kept in its own file for the same reason the host script is: it is HTML
/// and JavaScript, and a Rust raw string would have to be re-read for every quote in it.
pub const BROWSER_UI_HTML: &str = include_str!("browser_ui.html");

/// The panel's own voice, injected into the child webview as an initialization script so it survives
/// navigation to a site the shell cannot script into. See the file for what it reports and why.
///
/// Only a child webview takes it, and only a desktop build can create one (see `spawn_child`),
/// so a mobile build carries no copy of it.
#[cfg(desktop)]
pub const PANEL_REPORTER: &str = include_str!("panel_reporter.js");

struct Panel {
    data_dir: Option<PathBuf>,
    url: Option<String>,
    last_error: Option<String>,
    pending: bool,
    /// The last thing the panel said about ITSELF (see [`PANEL_REPORTER`]): href, title, how much text,
    /// whether it has focus, and any script error it hit. Kept as parsed JSON so a caller can read fields
    /// rather than guess at a string.
    content: Option<serde_json::Value>,
    /// How many reports have arrived. A count of 0 after a load is itself a reading: the reporter never ran.
    content_reports: u64,
    /// The document the panel was on when `content` was stored. Whenever the webview moves, that content
    /// stops describing what is on screen, and a shell that keeps reporting it is describing a page the user
    /// cannot see. Measured in R145: after an external navigation the report never arrived, so without this
    /// the shell would have gone on answering with the previous page's title and text indefinitely.
    content_page: Option<String>,
    /// Who, if anyone, has the panel on loan. Four live gates drive the same panel object, and R151 measured
    /// what that does without a lease: whichever gate ran second failed, in different directions on different
    /// runs, while each gate passed alone. The lease is the single place that decides whose turn it is.
    lease: Option<Lease>,
    /// R178-G: the rect the plugin declared it wants filled, in CSS px in the page's coordinate space.
    /// `None` means no pane - and a 0x0 declaration clears it rather than placing anything.
    surface: Option<Surface>,
    /// The tab set. The plugin owns WHICH tabs exist; the shell owns the windows behind them.
    tabs: Vec<Tab>,
    /// The active tab's id, or `None` (a mounted chrome page with no tabs at all).
    active: Option<String>,
    /// The page-viewport mode in force, and whether the last attempt to apply it reached the page.
    /// `mode_applied = false` is how a caller learns the page did NOT take it: a mode is never
    /// reported as if it had been applied.
    mode: Mode,
    mode_applied: bool,
    mode_error: Option<String>,
    /// Fixed mode's page viewport (the contract's 1280x800) and the scale the last application used.
    /// In fit mode `scale` is `None`: there is no override, the viewport IS the content rect.
    viewport: (f64, f64),
    scale: Option<f64>,
    /// Whether the browser is up: the chrome page and the tab windows exist.
    mounted: bool,
    /// Tab ids count from 1 and never repeat inside one process, so a caller can name the tab it made.
    next_tab: u64,
    /// How hiding a tab was ACTUALLY performed: "zero" (the contract's first choice) or
    /// "off-view-1x1" (the renderer refused a 0x0 rect). Read back through op=state, not assumed.
    hidden_style: Option<String>,
    /// R178-T: the turn a real user input took away. `None` until somebody's lease is revoked; a CLAIM
    /// clears it, because a fresh claim is a fresh turn (the "whoever moved last holds it" half of the
    /// rule).
    revoked: Option<Revoked>,
    /// R179-A: whether [`BROWSER_PREFS_FILE`] has been read yet, and where it is. The panel state has no
    /// AppHandle of its own, so the file is read on the first call that HAS one ([`ensure_prefs`]) - which is
    /// why `viewport` can already hold a value from disk before anything is mounted.
    prefs_loaded: bool,
    prefs_path: Option<PathBuf>,
    /// The last real input the panel reported, which signal it was, and how many have arrived. Reported
    /// in op=state as `lastUserInput` / `userInputReports`, so a reading can tell "no input yet" from
    /// "input arrived but did not revoke anything".
    last_user_input: Option<String>,
    user_input_reports: u64,
    /// R184-D: the window in which an input report is the SHELL's own injection rather than the user's
    /// hand (see [`Injection`]), and the record of what it attributed to itself. An ignored report is
    /// deliberately NOT written into `last_user_input` / `user_input_reports`: those two are the "the
    /// user has the panel now" readings, and this window exists precisely to keep them meaning that.
    injection: Injection,
}

/// The record of a lease that a real user input ended (R178-T).
#[derive(Clone)]
struct Revoked {
    holder: String,
    /// Who ended it. Today always "user-input"; a field rather than a literal because the refusal message
    /// quotes it and the rule names it.
    by: String,
    /// Which signal did it (pointerdown / keydown / wheel).
    kind: String,
}

/// R184-D: how long an INJECTION WINDOW stays open after an injecting protocol call RETURNS.
///
/// The window is the shell's own record of "I am the one delivering input right now". It is open from
/// before the dispatch until the two moments below have both passed:
///
/// - the dispatch is no longer in flight (an `Input.*` call keeps it open however long the protocol
///   takes - the caller's deadline, normally 10 s, is the upper bound);
/// - at least this grace has passed since it RETURNED, because the page's report is a second loopback
///   hop that STARTS inside the page while the event is being delivered
///   (core/panel_reporter.js `userInput()` -> `new Image().src` -> proxy.rs `userInput_of`) and can
///   therefore land after the protocol's answer does.
///
/// 250 ms is deliberately short: a REAL hand that lands inside the window would be misread as ours, so the
/// window must be no longer than the hop it exists for needs. The readings
/// `lease.injection.lastIgnored.afterReturnMs` and `.duringDispatch` say how much of the grace was ever
/// used (`duringDispatch: true` means the report beat the dispatch's own return and the grace was not
/// needed at all), and `ignoredInputs` is the count a reader needs to see that a report was attributed to
/// an injection rather than never happening. The value this window was measured with, and the margin it
/// left, are recorded in `docs/handoff/R184-D-injected-input.md`; the constant is reported to every
/// reader as `lease.injection.graceMs` so no measurement can be read against the wrong number.
const INJECTION_GRACE: Duration = Duration::from_millis(250);

/// R184-D: is this protocol call one that INJECTS input into the page it addresses?
///
/// The whole `Input.*` domain: every method in it delivers events (or text) into a page, which is exactly
/// what the reporter cannot tell apart from the user's hand. Everything else - a read, a navigation, a
/// screenshot, an emulation override - injects no input event, so it opens no window, and a report that
/// arrives while it runs is still the user's.
fn injects_input(method: &str) -> bool {
    method.starts_with("Input.")
}

/// R184-D: the window during and just after an injecting protocol call, and the record of what it
/// explained away. One struct rather than loose fields, because the window and the counters are read
/// together (both are answered in `lease.injection`).
#[derive(Clone, Default)]
struct Injection {
    /// How many injecting (`Input.*`) protocol calls this process has dispatched, and the last method -
    /// so a reading can name what was injected instead of only counting reports.
    dispatches: u64,
    last_method: Option<String>,
    /// How many input reports arrived inside a window and were attributed to it instead of the user.
    /// NOT a drop: this counter is the difference between "no input happened" and "input was swallowed".
    ignored: u64,
    /// The last of those, with the detail a reader needs to judge the window's length.
    last_ignored: Option<IgnoredInput>,
    /// Injecting calls in flight RIGHT NOW. Above zero is an open window by itself, so a call that never
    /// returns still cannot be confused with "the grace expired".
    open: u32,
    /// When the last injecting call RETURNED. `None` while one is still in flight.
    returned_at: Option<Instant>,
    /// The deadline the last returned call left behind.
    until: Option<Instant>,
}

/// One input report that arrived inside an injection window (R184-D).
#[derive(Clone)]
struct IgnoredInput {
    /// The signal the page reported (pointerdown / keydown / wheel) - what WOULD have taken the turn.
    kind: String,
    /// Which injection it was attributed to (the last `Input.*` method the shell dispatched).
    method: String,
    /// True when the report arrived while the dispatch was still in flight. A different fact from one
    /// that needed the grace after it returned, so the two are never collapsed into one number.
    during_dispatch: bool,
    /// How many ms after the dispatch RETURNED this report arrived; `None` when it beat the return.
    after_return_ms: Option<u128>,
    /// Wall clock (ms since the epoch), so a caller can line it up with its own log of when it injected.
    at_ms: u128,
}

impl Injection {
    /// Open a window for one injecting call. A dispatch in flight IS the window, so any deadline left by
    /// an earlier one is dropped until this one returns.
    fn begin(&mut self, method: &str) {
        self.open = self.open.saturating_add(1);
        self.dispatches = self.dispatches.saturating_add(1);
        self.last_method = Some(method.to_string());
        self.until = None;
        self.returned_at = None;
    }

    /// Close it: with no dispatch left in flight, the window lives on for exactly the grace.
    fn end(&mut self) {
        self.open = self.open.saturating_sub(1);
        if self.open == 0 {
            let now = Instant::now();
            self.returned_at = Some(now);
            self.until = Some(now + INJECTION_GRACE);
        }
    }

    /// Is a window open at `now`? Decided on the read, like the lease's expiry and for the same reason:
    /// a caller that dies mid-call cannot leave a window open behind it.
    fn is_open(&self, now: Instant) -> bool {
        self.open > 0 || matches!(self.until, Some(until) if now < until)
    }

    /// Record one report as the injection's own doing. Never a silent drop: the count and the last record
    /// are what a later reader has instead of "nothing happened".
    fn note_ignored(&mut self, kind: &str, now: Instant) {
        let record = IgnoredInput {
            kind: kind.to_string(),
            method: self.last_method.clone().unwrap_or_default(),
            during_dispatch: self.open > 0,
            after_return_ms: match (self.open > 0, self.returned_at) {
                (false, Some(at)) => Some(now.saturating_duration_since(at).as_millis()),
                _ => None,
            },
            at_ms: epoch_ms(),
        };
        self.ignored = self.ignored.saturating_add(1);
        self.last_ignored = Some(record);
    }
}

/// Wall clock in ms since the epoch, for records a human lines up with their own log.
fn epoch_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or(0)
}

/// The plugin's declared surface, in CSS px in the page's own coordinate space.
#[derive(Clone, Copy)]
struct Surface {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Surface {
    /// The whole surface, as the caller declared it.
    fn json(&self) -> String {
        format!(r#"{{"units":"logical","x":{},"y":{},"w":{},"h":{}}}"#, self.x, self.y, self.w, self.h)
    }

    /// The top strip: our own browser page. Never taller than the surface itself.
    fn chrome(&self) -> (f64, f64, f64, f64) {
        (self.x, self.y, self.w, CHROME_H.min(self.h))
    }

    /// The rest: the page the user is looking at. The chin is the 12 px BELOW it, which no webview owns:
    /// the surface's own background shows through there, exactly as the rail's background does at the
    /// panel's own edges.
    fn content(&self) -> (f64, f64, f64, f64) {
        (self.x, self.y + CHROME_H, self.w, (self.h - CHROME_H - CHIN_H).max(0.0))
    }

    /// R179-A: the bar AND the bay - everything the chrome page itself paints. The chin stays out of it:
    /// it is the strip below the bay that no webview owns (the owner's R178-U ruling), so the client's own
    /// background keeps showing through it exactly as it did before the bay existed.
    ///
    /// The chrome page used to be CHROME_H tall. It is the whole deck now because the bay has to be painted
    /// by someone, and the only thing on our side of the surface that can paint it is our own page: that is
    /// what makes the letterbox black and the screen frame ours ("边框由 browser_ui.html 自己画").
    fn deck(&self) -> (f64, f64, f64, f64) {
        (self.x, self.y, self.w, (self.h - CHIN_H).max(CHROME_H.min(self.h)))
    }

    /// R179-A: the SCREEN inside the bay - where the active tab's window goes.
    ///
    /// fixed: the page viewport at the letterbox scale [`fixed_scale`] computes, centred in the bay, so the
    /// black bars around it ARE the bay. fit: there is no fixed viewport, so the screen IS the bay - that is
    /// what fit means, and `scale` stays null for the same reason (the conversion factor is 1).
    fn screen(&self, mode: Mode, viewport: (f64, f64)) -> (f64, f64, f64, f64) {
        let (bx, by, bw, bh) = self.content();
        if mode == Mode::Fit || bw <= 0.0 || bh <= 0.0 {
            return self.content();
        }
        let scale = fixed_scale((bw, bh), viewport);
        let sw = (viewport.0 * scale).min(bw);
        let sh = (viewport.1 * scale).min(bh);
        (bx + (bw - sw) / 2.0, by + (bh - sh) / 2.0, sw, sh)
    }
}

/// The letterbox scale of a fixed page viewport inside a content rect: `min(w/vw, h/vh)`, rounded to four
/// decimals. One implementation, because in R179-A TWO things must agree on it EXACTLY: the protocol
/// override that makes the page believe its viewport is `vw x vh`, and the rectangle the window is really
/// placed on (`screen = viewport x scale`). The rounding is R178-G's, kept so the existing scale readings
/// (0.5, 0.3125, 0.40625) still come out to the same numbers.
fn fixed_scale(content: (f64, f64), viewport: (f64, f64)) -> f64 {
    let (cw, ch) = content;
    if cw > 0.0 && ch > 0.0 {
        ((cw / viewport.0).min(ch / viewport.1) * 10000.0).round() / 10000.0
    } else {
        1.0
    }
}

/// One tab: the label of its child webview, the URL it should be on, and whether that window is up.
#[derive(Clone)]
struct Tab {
    id: String,
    label: String,
    url: String,
    live: bool,
}

/// The page viewport mode. `Fixed` is the default: a browser with a constant page size, scaled into
/// whatever the content area happens to be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Fixed,
    Fit,
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Fixed
    }
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::Fixed => "fixed",
            Mode::Fit => "fit",
        }
    }
}

/// Everything `report` answers with, read under one lock so a reply cannot mix two moments.
struct Snapshot {
    data_dir: Option<String>,
    url: Option<String>,
    last_error: Option<String>,
    pending: bool,
    content: Option<serde_json::Value>,
    content_reports: u64,
    lease: Option<Lease>,
    surface: Option<Surface>,
    tabs: Vec<Tab>,
    active: Option<String>,
    mounted: bool,
    mode: Mode,
    mode_applied: bool,
    mode_error: Option<String>,
    viewport: (f64, f64),
    scale: Option<f64>,
    hidden_style: Option<String>,
    /// R178-T: see the Panel field of the same name - the revocation travels with the snapshot too, so a
    /// reading of op=state can see that a turn was taken away even though no lease is held any more.
    revoked: Option<Revoked>,
    /// R179-A: where the resolution choice is persisted, so a reading can open the file itself instead of
    /// believing the running process about what a restart would find.
    prefs_path: Option<String>,
    last_user_input: Option<String>,
    user_input_reports: u64,
    /// R184-D: the injection window travels with the snapshot too - it is answered inside `lease` (see
    /// `injection_json`), so a reader watching op=state can see a report that was attributed to the
    /// shell's own injection.
    injection: Injection,
}

#[derive(Clone)]
struct Lease {
    holder: String,
    expires_at: std::time::Instant,
}

impl Default for Panel {
    /// Written out rather than derived: the derived default would leave the fixed-mode viewport at 0x0, and
    /// the protocol refuses a 0x0 device-metrics override (measured: "invalid argument" on every mode=fixed
    /// application). The contract's 1280x800 is the default, explicitly.
    fn default() -> Self {
        Panel {
            data_dir: None,
            url: None,
            last_error: None,
            pending: false,
            content: None,
            content_reports: 0,
            content_page: None,
            lease: None,
            surface: None,
            tabs: Vec::new(),
            active: None,
            mode: Mode::Fixed,
            mode_applied: false,
            mode_error: None,
            viewport: DEFAULT_VIEWPORT,
            scale: None,
            mounted: false,
            next_tab: 0,
            hidden_style: None,
            revoked: None,
            prefs_loaded: false,
            prefs_path: None,
            last_user_input: None,
            user_input_reports: 0,
            injection: Injection::default(),
        }
    }
}

fn state() -> &'static Mutex<Panel> {
    static STATE: OnceLock<Mutex<Panel>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Panel::default()))
}

fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn json_option(value: &Option<String>) -> String {
    match value {
        Some(text) => json_string(text),
        None => "null".to_string(),
    }
}

/// Where the panel keeps its profile. Created up front so a failure is reported here rather
/// than as a silent fallback into the main window's user data folder.
fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("app local data dir: {error}"))?
        .join(PANEL_PROFILE);
    std::fs::create_dir_all(&dir).map_err(|error| format!("create {}: {error}", dir.display()))?;
    Ok(dir)
}

#[cfg(desktop)]
fn rect_json(rect: &Rect) -> String {
    let (units, x, y) = match rect.position {
        Position::Physical(position) => ("physical", position.x as f64, position.y as f64),
        Position::Logical(position) => ("logical", position.x, position.y),
        _ => ("unknown", 0.0, 0.0),
    };
    let (width, height) = match rect.size {
        Size::Physical(size) => (size.width as f64, size.height as f64),
        Size::Logical(size) => (size.width, size.height),
        _ => (0.0, 0.0),
    };
    format!(
        r#"{{"units":{},"x":{x},"y":{y},"w":{width},"h":{height}}}"#,
        json_string(units)
    )
}

/// The rect one child webview REALLY has, as the report's JSON, or `null` when there is no such
/// webview to ask.
///
/// Asking a child for its bounds is a desktop call: `Webview::bounds` is compiled for desktop
/// builds only, because a mobile webview is not a rectangle placed inside a parent window. An
/// Android build therefore reports the same `null` a webview that is not up has always reported,
/// rather than a number nobody measured.
#[cfg(desktop)]
fn bounds_json(app: &AppHandle, label: &str) -> String {
    app.get_webview(label)
        .and_then(|webview| webview.bounds().ok())
        .map(|rect| rect_json(&rect))
        .unwrap_or_else(|| "null".to_string())
}

/// No child webview can exist on a mobile build, so there is no rect to report for one.
#[cfg(mobile)]
fn bounds_json(_app: &AppHandle, _label: &str) -> String {
    "null".to_string()
}

/// What the shell knows right now: does the panel exist, where is it, which profile does it use,
/// and did the last attempt fail. This is the only channel a caller needs to watch progress.
pub fn report(app: &AppHandle) -> String {
    // R179-A: the persisted resolution is read before anything below can report it (once per process).
    ensure_prefs(app);
    // R178-G: "the page on screen" is the ACTIVE TAB's own document (the chrome page when there is no
    // tab). Read before the lock, because the live URL is itself a lock-holder.
    let live = live_url(app);
    let snapshot = {
        let mut panel = state().lock().unwrap();
        // Content describes a page, so it may only be reported while the panel is still on that page.
        // This is checked here - on the read - because the navigation is what changes it, and a read is
        // the only moment at which somebody is about to believe the answer.
        if panel.content.is_some() && panel.content_page != live {
            panel.content = None;
            panel.content_reports = 0;
            panel.content_page = live.clone();
        }
        Snapshot {
            data_dir: panel.data_dir.as_ref().map(|dir| dir.display().to_string()),
            url: panel.url.clone(),
            last_error: panel.last_error.clone(),
            pending: panel.pending,
            content: panel.content.clone(),
            content_reports: panel.content_reports,
            lease: panel.lease.clone(),
            surface: panel.surface,
            tabs: panel.tabs.clone(),
            active: panel.active.clone(),
            mounted: panel.mounted,
            mode: panel.mode,
            mode_applied: panel.mode_applied,
            mode_error: panel.mode_error.clone(),
            viewport: panel.viewport,
            scale: panel.scale,
            hidden_style: panel.hidden_style.clone(),
            revoked: panel.revoked.clone(),
            prefs_path: panel.prefs_path.as_ref().map(|dir| dir.display().to_string()),
            last_user_input: panel.last_user_input.clone(),
            user_input_reports: panel.user_input_reports,
            injection: panel.injection.clone(),
        }
    };
    let chrome = app.get_webview(CHROME_LABEL);
    let exists = chrome.is_some() || snapshot.tabs.iter().any(|tab| app.get_webview(&tab.label).is_some());
    // R178-G: `bounds` is the SURFACE the plugin declared, in logical pixels - the same numbers the
    // caller sent - because that is the rectangle the page host compares against to notice a stale
    // placement (R172 measured that "exists" alone was not enough). What the native views REALLY have
    // is reported separately, measured from the webviews themselves (chromeBounds, and each tab's own
    // bounds), so nothing that used to be checkable stopped being checkable.
    let bounds = snapshot
        .surface
        .map(|surface| surface.json())
        .unwrap_or_else(|| bounds_json(app, CHROME_LABEL));
    // The document the webview is REALLY on, asked of the webview itself. Without it, a stale self-report
    // and a navigation that never happened look identical: the shell's `url` field only says what the shell
    // requested. Measured in R145: the panel's content stopped updating right after a navigation was asked
    // for, and nothing in the readings could say whether the panel had moved at all.
    let page_url = live;
    // R179-A: the live page's own title, which is what a tab pill prefers over its URL when there is one.
    // It belongs to the ACTIVE tab and to no other, because `content` is dropped on the read above the
    // moment the live document changes - a hidden tab's title would be a page nobody is looking at.
    let live_title = snapshot
        .content
        .as_ref()
        .and_then(|content| content.get("title"))
        .and_then(|title| title.as_str())
        .map(|title| title.to_string());
    format!(
        r#"{{"exists":{},"label":{},"bounds":{},"dataDir":{},"url":{},"lastError":{},"pending":{},"pageUrl":{},"content":{},"contentReports":{},"lease":{},"mounted":{},"chromeH":{},"chinH":{},"chromeLabel":{},"surface":{},"chromePane":{},"contentPane":{},"active":{},"count":{},"limit":{},"tabs":[{}],"mode":{},"modeApplied":{},"modeError":{},"viewport":{},"scale":{},"hiddenStyle":{},"chromeBounds":{},"lastUserInput":{},"userInputReports":{},"deckPane":{},"bayPane":{},"screenPane":{},"viewportPreset":{},"presets":{},"prefsPath":{}}}"#,
        // Arguments follow the format string's order: first what the pre-R178 shell already answered...
        exists,
        json_string(CHROME_LABEL),
        bounds,
        json_option(&snapshot.data_dir),
        json_option(&snapshot.url),
        json_option(&snapshot.last_error),
        snapshot.pending,
        json_option(&page_url),
        snapshot.content.clone().map(|value| value.to_string()).unwrap_or_else(|| "null".to_string()),
        snapshot.content_reports,
        // The lease carries any REVOCATION with it (R178-T), so a caller can see that a turn was taken
        // away by the user even though nobody holds the panel any more.
        lease_json(&snapshot.lease, snapshot.revoked.as_ref(), &snapshot.injection),
        // ...then R178-G: is the browser up, where is the browser page, which tabs exist and where each
        // one REALLY is, what page-viewport mode is in force, and whether the last attempt reached the
        // page. The rects come from the webviews; the panes are the two halves and the chin of the surface
        // (surface.h - chromeH - chinH == contentPane.h, and all three numbers are reported).
        snapshot.mounted,
        CHROME_H,
        CHIN_H,
        json_string(CHROME_LABEL),
        snapshot.surface.map(|surface| surface.json()).unwrap_or_else(|| "null".to_string()),
        quad_json(snapshot.surface.map(|surface| surface.chrome())),
        quad_json(snapshot.surface.map(|surface| surface.content())),
        json_option(&snapshot.active),
        snapshot.tabs.len(),
        MAX_TABS,
        tabs_json(app, &snapshot.tabs, snapshot.active.as_deref(), live_title.as_deref()),
        json_string(snapshot.mode.name()),
        snapshot.mode_applied,
        json_option(&snapshot.mode_error),
        viewport_json(snapshot.viewport),
        match snapshot.scale {
            Some(scale) => format!("{scale}"),
            None => "null".to_string(),
        },
        json_option(&snapshot.hidden_style),
        bounds_json(app, CHROME_LABEL),
        json_option(&snapshot.last_user_input),
        snapshot.user_input_reports,
        // ...then R179-A: the VM-preview geometry, all of it logical and all of it in the page's own
        // coordinate space. deckPane is everything the chrome page paints (bar + bay, chin excluded),
        // bayPane is the content area under a name that says what it is now, and screenPane is the
        // letterboxed screen inside it - the rectangle the ACTIVE tab's window really occupies. In fixed
        // mode screenPane = viewport x scale (the same `scale` this report carries); in fit mode it IS the
        // bay, because there is no fixed viewport to letterbox.
        quad_json(snapshot.surface.map(|surface| surface.deck())),
        quad_json(snapshot.surface.map(|surface| surface.content())),
        quad_json(snapshot.surface.map(|surface| surface.screen(snapshot.mode, snapshot.viewport))),
        json_option(&preset_of(snapshot.viewport).map(|name| name.to_string())),
        presets_json(),
        json_option(&snapshot.prefs_path)
    )
}

/// The lease, as one JSON object. Expiry is decided on read: no timer can be left behind by a gate that
/// crashes, which is the whole point of a deadline rather than a release-only protocol.
fn lease_json(lease: &Option<Lease>, revoked: Option<&Revoked>, injection: &Injection) -> String {
    // R178-T: the revocation is reported even while NO lease is held, because that is exactly the state an
    // AI is in after the user took the browser back: nothing holds the panel, and the AI's own writes are
    // refused by name until it claims again.
    let revoked_by = match revoked {
        Some(record) => json_string(&record.by),
        None => "null".to_string(),
    };
    let revoked_holder = match revoked {
        Some(record) => json_string(&record.holder),
        None => "null".to_string(),
    };
    // R179-A: WHAT took the turn, beside WHO lost it. `revokedBy` says the user's side took it; the kind
    // says which of the user's two mouths said so - `shell-control:<op>` for a write from the shell's own
    // browser page, the event name (`pointerdown`, ...) for a real input inside a panel document. The two
    // are NOT the same evidence: the first is a control's own op and therefore names the control; the second
    // is a page-side signal that a synthetic event dispatcher can produce just as well. A reading that has to
    // tell them apart reads this field instead of inferring it from `revokedBy`.
    let revoked_kind = match revoked {
        Some(record) => json_string(&record.kind),
        None => "null".to_string(),
    };
    // R184-D: the injection window is reported HERE, beside the record it explains, and not as a new
    // top-level key: the op=state key set and KEY ORDER are read verbatim out of this file's format string
    // by gate 113 (scripts/verify-browser-tabs-offline.mjs reading 1 compares them with its own world), so
    // a new top-level key is not this round's to add. The six fields above keep their exact meaning and
    // order; everything below is additive.
    let injecting = injection_json(injection);
    match lease {
        Some(held) => {
            let left = held.expires_at.saturating_duration_since(std::time::Instant::now()).as_millis();
            format!(
                r#"{{"held":true,"holder":{},"expiresInMs":{left},"revokedBy":{revoked_by},"revokedHolder":{revoked_holder},"revokedKind":{revoked_kind},"injection":{injecting}}}"#,
                json_string(&held.holder),
            )
        }
        None => format!(
            r#"{{"held":false,"holder":null,"expiresInMs":0,"revokedBy":{revoked_by},"revokedHolder":{revoked_holder},"revokedKind":{revoked_kind},"injection":{injecting}}}"#
        ),
    }
}

/// R184-D: the injection window as one JSON object, nested in the lease record.
///
/// Every field is a reading rather than a summary: `open` (is a window open right now), `graceMs` (the
/// window's own length, so a measurement can be read against the constant it was taken with),
/// `dispatches`/`lastMethod` (what the shell injected), and `ignoredInputs`/`lastIgnored` (what the
/// injection explained away, and how much of the grace the last one needed). `lastIgnored.kind` is the
/// signal that WOULD have taken the turn - which is the whole point of keeping it.
fn injection_json(injection: &Injection) -> String {
    let last = match &injection.last_ignored {
        Some(record) => format!(
            r#"{{"kind":{},"method":{},"duringDispatch":{},"afterReturnMs":{},"atMs":{}}}"#,
            json_string(&record.kind),
            json_string(&record.method),
            record.during_dispatch,
            match record.after_return_ms {
                Some(ms) => ms.to_string(),
                None => "null".to_string(),
            },
            record.at_ms,
        ),
        None => "null".to_string(),
    };
    format!(
        r#"{{"open":{},"graceMs":{},"dispatches":{},"lastMethod":{},"ignoredInputs":{},"lastIgnored":{last}}}"#,
        injection.is_open(Instant::now()),
        INJECTION_GRACE.as_millis(),
        injection.dispatches,
        json_option(&injection.last_method),
        injection.ignored,
    )
}

/// Claim, release or read the panel's lease. A claim by somebody else is refused BY NAME - a gate that
/// silently proceeded would be exactly the race this exists to remove.
pub fn lease(op: &str, holder: &str, ttl_ms: u64) -> Result<String, String> {
    if holder.is_empty() {
        return Err("a lease needs a holder".to_string());
    }
    let mut panel = state().lock().unwrap();
    if let Some(held) = &panel.lease {
        if held.expires_at <= std::time::Instant::now() {
            panel.lease = None;
        }
    }
    match op {
        "status" => {}
        "claim" => match &panel.lease {
            Some(held) if held.holder != holder => {
                return Err(format!("the panel is leased by {}", held.holder));
            }
            _ => {
                panel.lease = Some(Lease {
                    holder: holder.to_string(),
                    expires_at: std::time::Instant::now() + std::time::Duration::from_millis(ttl_ms.max(1000)),
                });
                // R178-T: a fresh claim is a fresh turn. The revocation that ended the previous one is
                // history from here on, which is what makes "claim again and carry on" the AI's way back.
                panel.revoked = None;
                // R179-A, found by the round's own gate: note_shell_control() skips a write whose kind
                // equals the last one, so that ONE op passing through two enforcement points is one user
                // input rather than two. That guard reads last_user_input, and a claim did not clear it -
                // so a user's SECOND click on the same control (after an AI had claimed the panel back)
                // changed the resolution but did not take the panel away, once per process per op. The
                // measured repro is .tmp/r179-gate/repro-shell-control-dedup.mjs; clearing it here keeps
                // the one-request de-duplication and drops the one-per-process swallowing.
                panel.last_user_input = None;
            }
        },
        "release" => match &panel.lease {
            Some(held) if held.holder == holder => panel.lease = None,
            Some(held) => return Err(format!("the panel is leased by {} and not by {holder}", held.holder)),
            None => {}
        },
        // R326: a STALE lease must not park the harness behind a dead holder. Every gate names itself "<gate>-<pid>",
        // and a lease whose holder process is gone is a leftover, not a lease. `steal` takes it and RECORDS the
        // revocation by name, so the reading still says who lost it and why - measured need: three panel gates that
        // pass alone skipped inside one full run because the gate before them leaked its lease and the next one
        // declined ("the panel was already leased by ...").
        "steal" => {
            if let Some(held) = &panel.lease {
                if held.holder != holder {
                    panel.revoked = Some(Revoked {
                        holder: held.holder.clone(),
                        by: String::from("lease-steal"),
                        kind: String::from("stale-lease"),
                    });
                }
            }
            panel.lease = Some(Lease {
                holder: holder.to_string(),
                expires_at: std::time::Instant::now() + std::time::Duration::from_millis(ttl_ms.max(1000)),
            });
            panel.last_user_input = None;
        }
        other => return Err(format!("unknown lease op {other:?}")),
    }
    Ok(lease_json(&panel.lease, panel.revoked.as_ref(), &panel.injection))
}

/// The pre-R178 name for putting the browser up (contract section 2: open = mount). One
/// implementation, one semantics; the old name exists because the page host that measures the column
/// still speaks it.
pub fn open(app: &AppHandle, url: &str, holder: Option<&str>) -> Result<(), String> {
    mount(app, url, holder)
}

/// Take delivery of one report from the panel's own document. The body is the panel's JSON; anything
/// unparsable is kept as a string rather than dropped, because "the panel said something the shell could
/// not read" is a fact worth keeping.
pub fn note_report(body: &str, page: Option<String>) {
    let parsed = serde_json::from_str::<serde_json::Value>(body)
        .unwrap_or_else(|_| serde_json::Value::String(body.to_string()));
    let mut panel = state().lock().unwrap();
    panel.content = Some(parsed);
    panel.content_reports = panel.content_reports.saturating_add(1);
    panel.content_page = page;
}

/// One report that arrived as a query string (the beacon channel). Only the fields the reporter sends are
/// read; anything missing stays out rather than being invented. Percent-decoding is done here because the
/// page encodes with encodeURIComponent and this module deliberately carries no extra dependency.
pub fn note_report_query(query: &str, page: Option<String>) {
    let mut report = serde_json::Map::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = percent_decode(parts.next().unwrap_or(""));
        let value = percent_decode(parts.next().unwrap_or(""));
        let json = match key.as_str() {
            "textLength" | "at" => match value.parse::<i64>() {
                Ok(number) => serde_json::Value::from(number),
                Err(_) => serde_json::Value::String(value),
            },
            "hasFocus" => serde_json::Value::from(value == "1"),
            _ => serde_json::Value::String(value),
        };
        report.insert(key, json);
    }
    if report.is_empty() {
        return;
    }
    report.insert("channel".to_string(), serde_json::Value::from("beacon"));
    report.insert("failures".to_string(), serde_json::Value::Array(Vec::new()));
    let mut panel = state().lock().unwrap();
    panel.content = Some(serde_json::Value::Object(report));
    panel.content_reports = panel.content_reports.saturating_add(1);
    panel.content_page = page;
}

/// `encodeURIComponent`'s output as bytes: %XX plus '+' for space. Unknown escapes are kept verbatim.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'%' if at + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[at + 1..at + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        at += 3;
                    }
                    Err(_) => {
                        out.push(bytes[at]);
                        at += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                at += 1;
            }
            byte => {
                out.push(byte);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The pre-R178 name for taking the browser down (contract section 2: close = unmount).
pub fn close(app: &AppHandle, holder: Option<&str>) -> Result<(), String> {
    unmount(app, holder)
}

/// R166: the lease has to be ENFORCED, not merely published. R165 measured the panel being re-placed while a gate
/// held the lease, onto the live right column (1038,54 1104x1278 = 692,36 736x852 x 1.5) - the page host's own 400 ms
/// placement walked in through this door and nobody asked who held the panel. A placement now carries the caller's
/// holder name and is refused BY NAME while a different holder holds a live lease. It is read at the moment of the
/// write, because publishing a lease and enforcing it are two different promises.
/// R179-A: `op` is the write being attempted, because that is what a shell-page takeover is RECORDED as
/// (`shell-control:tab-new`). A caller that is not on the user's side never sees it: it is refused with the
/// same sentence it always was.
fn enforce_lease(op: &str, holder: Option<&str>) -> Result<(), String> {
    let mut panel = state().lock().unwrap();
    if let Some(held) = &panel.lease {
        if held.expires_at <= std::time::Instant::now() {
            panel.lease = None;
        }
    }
    // Read the holder out before touching the state: the shell-page path below takes a &mut panel.
    let held_by_other = panel
        .lease
        .as_ref()
        .filter(|held| !matches!(holder, Some(who) if who == held.holder.as_str()))
        .map(|held| held.holder.clone());
    if let Some(other) = held_by_other {
        if !is_shell_controls(holder) {
            // Unchanged (R166): somebody else's lease refuses an AI's write BY NAME, at the moment of the
            // write. Gate 105 / probe-panel-frame read this sentence.
            return Err(format!(
                "the panel is leased by {other} and not by {}: the placement was refused",
                holder.unwrap_or("nobody")
            ));
        }
        // R179-A: the user's own hand on the shell's browser page takes the turn - by name - and the write
        // then goes through. That is the whole point of this branch: the same click used to be refused
        // (R178-G section 5, item 5, measured).
        note_shell_control(&mut panel, op);
    } else if is_shell_controls(holder) {
        // Nobody's lease to take, but the turn is still the user's: the record is what tells an AI (with no
        // lease of its own) that it must claim the panel before writing. Same rule as a real input event.
        note_shell_control(&mut panel, op);
    }
    // R178-T: THE USER WINS (see `refuse_if_taken`).
    refuse_if_taken(&panel, holder)?;
    Ok(())
}

/// The name the shell's OWN documents post under when they send no holder of their own.
///
/// The chrome page and the page host that measures the column are the user's side of this panel - they send
/// no holder, and the proxy recognises them by their own document as the referer (a request from a page
/// carries one; an outside agent's does not). Anything else that arrives with no holder is an outside
/// caller, and R178-T is about exactly that caller.
pub const USER_PAGE_HOLDER: &str = "user-page";

/// R179-A: the shell's OWN browser page (BROWSER_UI_PATH) - the bar, its tabs and its resolution
/// control. A write under this name is not "somebody using the panel on the side": it is the user's
/// own hand on a control the user can see, so it takes the turn (see [`enforce_lease`]) instead of
/// being refused while an AI holds the lease.
///
/// It is a name of its own rather than [`USER_PAGE_HOLDER`] on purpose: the page host that measures the
/// column (core/panel_host.js, running inside the client's own document) also posts from our origin and
/// also sends no holder - but its 400 ms placement loop is NOT a user input, and treating it as one would
/// revoke a lease every few hundred milliseconds (that loop is exactly what R166 made the lease refuse).
pub const USER_SHELL_HOLDER: &str = "user-chrome";

/// Is this holder one of the shell's own documents - the user's side of the panel?
fn is_user_page(holder: Option<&str>) -> bool {
    matches!(holder, Some(USER_PAGE_HOLDER) | Some(USER_SHELL_HOLDER))
}

/// Is this holder the shell's browser page, whose writes ARE user input (R179-A)?
fn is_shell_controls(holder: Option<&str>) -> bool {
    holder == Some(USER_SHELL_HOLDER)
}

/// Refuse a caller that a real user input has taken the panel away from (R178-T).
///
/// The rule, in one place because two callers need it (the geometry writes through `enforce_lease`, and the
/// protocol through `enforce_revocation`):
///
/// - A user input TAKES the panel. The record is written whether or not a lease was held: a gate measured
///   that an AI caller *without* a lease must be stopped too, because the panel belongs to the user until
///   somebody claims it back.
/// - The shell's own documents are never refused: the tab strip and the column's placement are the user
///   driving the browser, which is the very thing this rule protects.
/// - A CLAIM (op=lease claim) clears it - that is the AI's way back, and it is why the refusal names the
///   takeover instead of just saying "held by somebody".
fn refuse_if_taken(panel: &Panel, holder: Option<&str>) -> Result<(), String> {
    let Some(record) = &panel.revoked else {
        return Ok(());
    };
    if is_user_page(holder) {
        return Ok(());
    }
    if record.holder.is_empty() {
        return Err(format!(
            "the panel was TAKEN by {} ({}): no lease was held, so nothing was revoked - claim it (op=lease claim) to continue",
            record.by, record.kind
        ));
    }
    Err(format!(
        "the lease held by {} was REVOKED by {} ({}): claim the panel again to continue",
        record.holder, record.by, record.kind
    ))
}

/// The revocation half of the rule, for ops that are not geometry writes (op=cdp).
///
/// Why not the full `enforce_lease`: five existing gates call the legacy `/__shell/panel/cdp` route WITHOUT
/// a holder while they hold a lease themselves, and a full active-lease check would turn all of them red in
/// one go - a decision the owner approved. Geometry writes (`surface`/`set-bounds`/`mount`/... ) keep the
/// full rule, because R166 put it there for a measured reason (the page host walked in and moved the panel
/// mid-lease). What task-203 adds to op=cdp is only this: a caller whose TURN was taken away by the user is
/// refused by name until it claims again. If cdp ever needs the full check, the five gates have to change
/// with it - that is one decision, not two.
fn enforce_revocation(holder: Option<&str>) -> Result<(), String> {
    let panel = state().lock().unwrap();
    refuse_if_taken(&panel, holder)
}

/// A real user input arrived in a panel document (R178-T). The lease, if any, is revoked BY NAME and the
/// signal is remembered; the next AI write or protocol call is refused by `enforce_lease` /
/// `enforce_revocation` until it claims the panel again.
///
/// Arriving with no lease held is a normal case, not an error: the user may drive a browser nobody lent out.
/// Take the turn away from whoever holds it, by name, and record WHO took it and WHAT did it.
///
/// One implementation behind both user inputs there are (R179-A): a real event in a panel document
/// ([`note_user_input`]) and a write from the shell's own browser page ([`note_shell_control`]). The two
/// used to be one signal and one caller; the record shape did not change, only who can write one.
fn take_turn(panel: &mut Panel, kind: &str) -> String {
    // The record is written even when NO lease was held: a gate measured that an AI caller without a lease
    // must be stopped too (readings 2/3 of verify-user-input-reclaim), because the panel belongs to the user
    // from this moment until somebody claims it. `holder` empty is what "nobody was holding it" looks like.
    let holder = match panel.lease.take() {
        Some(held) => {
            println!("[browser] the lease held by {} was revoked by user-input ({kind})", held.holder);
            held.holder
        }
        None => String::new(),
    };
    match panel.revoked.as_mut() {
        Some(record) => {
            // Still taken, and every later signal is recorded (the user is still driving).
            record.kind = kind.to_string();
            if !holder.is_empty() {
                record.holder = holder;
            }
        }
        None => {
            panel.revoked = Some(Revoked {
                holder,
                by: "user-input".to_string(),
                kind: kind.to_string(),
            });
        }
    }
    panel.revoked.as_ref().map(|record| record.holder.clone()).unwrap_or_default()
}

/// An input report from a panel document (R178-T/R179-A): the lease, if any, is revoked BY NAME and the
/// signal is remembered; the next AI write or protocol call is refused by `enforce_lease` /
/// `enforce_revocation` until it claims the panel again.
///
/// R184-D: a report that arrives inside an injection window is NOT that - it is the shell's own
/// `op=cdp` `Input.*` call coming back (see [`INJECTION_GRACE`]), so it is counted in
/// `lease.injection` and no turn changes hands. Everything outside the window behaves exactly as above,
/// including the bare `?userInput=` beacon with no gesture behind it.
pub fn note_user_input(kind: &str) {
    let mut panel = state().lock().unwrap();
    let now = Instant::now();
    // R184-D: THE SHELL'S OWN INJECTION IS NOT THE USER'S HAND. Inside an injection window this report is
    // the one `op=cdp` just caused, so it is recorded as such (`lease.injection`) and does NOT take the
    // turn - otherwise an AI clicking its own panel would revoke its own lease (R183-C's measured defect,
    // see [`INJECTION_GRACE`]).
    if panel.classify_input(kind, now) {
        return;
    }
    panel.user_input_reports = panel.user_input_reports.saturating_add(1);
    panel.last_user_input = Some(kind.to_string());
    take_turn(&mut panel, kind);
}

impl Panel {
    /// R184-D: is this input report the shell's own injection?
    ///
    /// `true` means the report was attributed to an injection window and the caller must NOT take the turn.
    /// Two things an ignored report deliberately does NOT do: it does not touch
    /// [`last_user_input`](Panel::last_user_input) / [`user_input_reports`](Panel::user_input_reports)
    /// (those two readings mean "the user has the panel"), and it does not write a [`Revoked`] record -
    /// that record is a trace of the user taking the turn, and leaving one here is the falsehood this round
    /// removes. What it DOES do is count itself into [`Injection::ignored`] with the lag it needed, so
    /// "no report arrived" and "a report was attributed to the shell" can never be read as the same thing.
    fn classify_input(&mut self, kind: &str, now: Instant) -> bool {
        if !self.injection.is_open(now) {
            return false;
        }
        self.injection.note_ignored(kind, now);
        true
    }
}

/// R179-A: the shell's own browser page drove one of its controls (a tab pill, "+", "×", the mode or the
/// resolution button). That IS the user, and R178-G measured what the old shape did with it: while an AI
/// held the lease the user's own clicks were refused by name and the browser did not move.
///
/// So the write is treated exactly like a trusted pointer event in the page - same record, same counters,
/// same `revokedBy: "user-input"` - and then carried out (the caller is on the user's side of
/// `refuse_if_taken`). `kind` names the op, because "which control" is the only thing that differs between
/// two of these.
///
/// One write can pass through two enforcement points (op=surface delegates to op=unmount when the pane
/// collapses). Passing the same op twice in a row is ONE user input, not two: the second call changes
/// nothing.
fn note_shell_control(panel: &mut Panel, op: &str) -> Option<String> {
    let kind = format!("shell-control:{op}");
    if panel.last_user_input.as_deref() == Some(kind.as_str()) {
        return None;
    }
    panel.user_input_reports = panel.user_input_reports.saturating_add(1);
    panel.last_user_input = Some(kind.clone());
    take_turn(panel, &kind);
    Some(kind)
}

/// The user-input marker in a report's query string, if that report IS one.
///
/// The reporter sends it as a beacon query (`?userInput=pointerdown`), so it arrives through the channel the
/// panel already had - no second endpoint, and nothing for a page to opt out of. Kept next to the reporter's
/// event list (core/panel_reporter.js) so the two cannot drift apart.
pub fn user_input_of(query: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some("userInput") {
            return Some(percent_decode(parts.next().unwrap_or("")));
        }
    }
    None
}

/// The pre-R178 name for declaring the surface (contract section 2: set-bounds = surface). The
/// behaviour the page host measured in R144/R172 is unchanged: the rect is CSS px in the page's own
/// coordinates and it is NOT proportional to the window - it is exactly what the page says, now cut
/// into the chrome strip and the content area inside this module.
pub fn set_bounds(app: &AppHandle, x: f64, y: f64, width: f64, height: f64, holder: Option<&str>) -> Result<(), String> {
    surface(app, x, y, width, height, holder)
}

/// The page side of the geometry loop: injected into the official client's document beside the
/// frame and the bridge. It measures the right column (marked `data-rightbar-col`) and keeps the
/// shell told where the native child webview belongs, closing the panel while the column is
/// collapsed.
///
/// It lives in its own file because it is JavaScript: a Rust raw string would have to be re-read
/// for every quote in it, and a page script is easier to review on its own.
pub const PANEL_HOST_PATH: &str = "/__shell/panel.js";

/// R169: the panel's own start page. Until now the panel opened on `/__shell/` - the client's own UI - so the sidebar
/// browser showed the DSH shell inside itself (measured in R164's window picture: the home screen with its own left
/// rail). It is served by the shell, so the panel's reporter - an initialization script, not an injected tag - keeps
/// working, and it is deliberately local: no network call, and a URL box the user can type into.
pub const PANEL_START_PATH: &str = "/__shell/panel-start";

/// The tag the proxy injects into the kernel's index, beside the frame and the bridge.
pub const PANEL_HOST_TAG: &str = r##"<script src="/__shell/panel.js"></script>"##;

pub const PANEL_HOST_SCRIPT: &str = include_str!("panel_host.js");

/// Hand keyboard focus to the panel. wry does not forward the parent's focus into a child
/// webview, so "click the panel and type" needs this to exist.
#[cfg(desktop)]
pub fn focus(app: &AppHandle) -> Result<(), String> {
    let Some(webview) = app.get_webview(CHROME_LABEL) else {
        return Err("no browser: mount it before focusing it".to_string());
    };
    webview.set_focus().map_err(|error| format!("focus: {error}"))
}

/// Focusing a child webview is `Webview::set_focus`, a desktop-only call, and there is no
/// child webview on Android to hand the keyboard to in the first place.
#[cfg(mobile)]
pub fn focus(_app: &AppHandle) -> Result<(), String> {
    Err(super::mobile::reserved("focusing the sidebar browser"))
}

// ---------------------------------------------------------------------------------------------
// R178-G: the browser host - its own state, its own geometry, its own two modes
// ---------------------------------------------------------------------------------------------

/// Where a hidden tab is parked. Out of the client area AND zero-sized: a parked tab that still owns a
/// visible rectangle is the one shape the contract forbids (section 5).
const HIDDEN_POS: f64 = -20000.0;

/// How long the shell waits for a child webview to be created before answering that it was not.
#[cfg(desktop)]
const CREATE_TIMEOUT: Duration = Duration::from_secs(20);

/// What the page is REALLY on: the active tab's document, or the chrome page when there is no tab.
pub fn live_url(app: &AppHandle) -> Option<String> {
    let label = {
        let panel = state().lock().unwrap();
        active_label(&panel)
    };
    let webview = match label {
        Some(label) => app.get_webview(&label),
        None => app.get_webview(CHROME_LABEL),
    };
    webview.and_then(|webview| webview.url().ok()).map(|url| url.to_string())
}

/// The label of the active tab's window, if there is an active tab.
fn active_label(panel: &Panel) -> Option<String> {
    let id = panel.active.as_deref()?;
    panel.tabs.iter().find(|tab| tab.id == id).map(|tab| tab.label.clone())
}

/// Our own browser page, on the shell's own origin. That origin is what makes the page's own op calls
/// work with no second credential: the proxy's CORS rule refuses every other origin outright.
fn chrome_url() -> String {
    format!("{}{}", crate::SELF_ORIGIN, BROWSER_UI_PATH)
}

/// The URL a caller meant, or the shell's start page when it named none.
fn url_or_start(url: &str) -> String {
    if url.is_empty() {
        format!("{}{}", crate::SELF_ORIGIN, PANEL_START_PATH)
    } else {
        url.to_string()
    }
}

/// Keep the last failure where op=state can be read back, instead of losing it in a log.
fn record_error(error: &str) {
    let mut panel = state().lock().unwrap();
    panel.last_error = Some(error.to_string());
}

/// R179-A: the file the resolution and the mode are persisted in, under the app's config directory - the
/// directory `shell.json` lives in. Computed from the AppHandle rather than passed in, because the panel's
/// state is a process global with no handle of its own, and the place that boots the client is outside this
/// round's write scope.
fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|root| super::shellprefs::browser_prefs_path(&root, BROWSER_PREFS_FILE))
}

/// Is this a page viewport at all? The same bounds op=viewport refuses outside of, so a hand-edited file
/// (or one written by an older build) cannot put the panel into a state no op would accept.
fn viewport_is_usable(viewport: (f64, f64)) -> bool {
    let (w, h) = viewport;
    w.is_finite()
        && h.is_finite()
        && (VIEWPORT_MIN..=VIEWPORT_MAX).contains(&w)
        && (VIEWPORT_MIN..=VIEWPORT_MAX).contains(&h)
}

/// Read the persisted resolution and mode, once per process.
///
/// Called from every op that can read the viewport (op=state, op=mount, op=surface, op=mode, op=viewport)
/// because the FIRST call in a process may be any of them: the chrome page polls op=state, a check script
/// may open with op=viewport, and a boot opens with op=open. Once-guarded, so the file is read exactly once
/// and a later write is never overwritten by a stale read.
fn ensure_prefs(app: &AppHandle) {
    let mut panel = state().lock().unwrap();
    if panel.prefs_loaded {
        return;
    }
    panel.prefs_loaded = true;
    let Some(path) = prefs_path(app) else {
        return;
    };
    panel.prefs_path = Some(path.clone());
    let Some(stored) = super::shellprefs::read_browser_prefs(&path) else {
        return;
    };
    if viewport_is_usable(stored.viewport) {
        panel.viewport = stored.viewport;
    }
    // An unknown word (or none) is not an error: the default mode stands.
    match stored.mode.as_str() {
        "fit" => panel.mode = Mode::Fit,
        "fixed" => panel.mode = Mode::Fixed,
        _ => {}
    }
    println!(
        "[browser] restored the page viewport {}x{} in mode {} from {}",
        panel.viewport.0,
        panel.viewport.1,
        panel.mode.name(),
        path.display()
    );
}

/// Write a candidate (viewport, mode) pair out WITHOUT touching the state, so a caller can persist before
/// it changes anything and refuse BY NAME when the write failed: then op=state can never report a choice
/// that a restart would not restore.
fn persist_change(app: &AppHandle, viewport: (f64, f64), mode: Mode) -> Result<PathBuf, String> {
    let known = {
        let panel = state().lock().unwrap();
        panel.prefs_path.clone()
    };
    let path = match known {
        Some(path) => path,
        None => prefs_path(app).ok_or_else(|| {
            "the app has no config directory to persist the browser's resolution in".to_string()
        })?,
    };
    super::shellprefs::write_browser_prefs(&path, viewport, mode.name())?;
    let mut panel = state().lock().unwrap();
    panel.prefs_loaded = true;
    panel.prefs_path = Some(path.clone());
    Ok(path)
}

/// Resolve what op=viewport was asked for, refusing anything else BY NAME and without a value to apply.
fn resolve_viewport(preset: Option<&str>, width: Option<f64>, height: Option<f64>) -> Result<(f64, f64), String> {
    let names: Vec<&str> = VIEWPORT_PRESETS.iter().map(|(name, _, _, _)| *name).collect();
    if let Some(name) = preset {
        if width.is_some() || height.is_some() {
            return Err(format!(
                "named refusal: op=viewport got both a preset ({name:?}) and a size ({}x{}): name one or the other",
                width.map_or_else(|| "?".to_string(), |w| format!("{w}")),
                height.map_or_else(|| "?".to_string(), |h| format!("{h}"))
            ));
        }
        return match VIEWPORT_PRESETS.iter().find(|(candidate, _, _, _)| *candidate == name) {
            Some((_, w, h, _)) => Ok((*w, *h)),
            None => Err(format!(
                "named refusal: op=viewport got preset {name:?}, which is not one of the {} presets [{}]; or send width and height",
                names.len(),
                names.join(", ")
            )),
        };
    }
    match (width, height) {
        (Some(w), Some(h)) => {
            let rounded = (w.round(), h.round());
            if !viewport_is_usable(rounded) {
                return Err(format!(
                    "named refusal: op=viewport got a size of {w}x{h}: both numbers must be finite and between {} and {} px, and the state was not changed",
                    VIEWPORT_MIN as u32, VIEWPORT_MAX as u32
                ));
            }
            Ok(rounded)
        }
        _ => Err(format!(
            "named refusal: op=viewport needs either preset (one of [{}]) or both width and height",
            names.join(", ")
        )),
    }
}

fn quad_json(quad: Option<(f64, f64, f64, f64)>) -> String {
    match quad {
        Some((x, y, w, h)) => format!(r#"{{"units":"logical","x":{x},"y":{y},"w":{w},"h":{h}}}"#),
        None => "null".to_string(),
    }
}

fn viewport_json(viewport: (f64, f64)) -> String {
    format!(r#"{{"w":{},"h":{}}}"#, viewport.0, viewport.1)
}

#[cfg(desktop)]
fn logical_rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(x, y)),
        size: Size::Logical(LogicalSize::new(w, h)),
    }
}

/// Every tab, with the rect its window REALLY has (asked of Tauri, never remembered). A tab whose
/// window is gone reports live:false and a null rect, not the rectangle it used to occupy.
///
/// R179-A: a tab also carries a TITLE when there is one to carry, and only the ACTIVE one can have it (the
/// panel's last self-report describes the document on screen, which is the active tab's). It is what the
/// chrome page prints on the pill when the page names itself - the URL's hostname is the fallback, and null
/// is how a reading tells "the page has not introduced itself yet" from "the page is called 127.0.0.1".
fn tabs_json(app: &AppHandle, tabs: &[Tab], active: Option<&str>, title: Option<&str>) -> String {
    let mut out: Vec<String> = Vec::with_capacity(tabs.len());
    for tab in tabs {
        let bounds = bounds_json(app, &tab.label);
        let is_active = active == Some(tab.id.as_str());
        let title = match (is_active, title) {
            (true, Some(title)) if !title.is_empty() => json_string(title),
            _ => "null".to_string(),
        };
        out.push(format!(
            r#"{{"id":{},"label":{},"url":{},"live":{},"active":{},"title":{},"bounds":{}}}"#,
            json_string(&tab.id),
            json_string(&tab.label),
            json_string(&tab.url),
            tab.live,
            is_active,
            title,
            bounds
        ));
    }
    out.join(",")
}

/// The next tab id and label. Ids count from 1 and never repeat inside one process, so a caller can
/// name the tab it created even after other tabs have come and gone.
fn take_tab_id() -> (String, String) {
    let mut panel = state().lock().unwrap();
    panel.next_tab += 1;
    let n = panel.next_tab;
    (format!("t{n}"), format!("{TAB_PREFIX}{n}"))
}

/// Park a tab out of the visible area. Zero size is the contract's first choice; a renderer that
/// refuses a 0x0 rect gets a 1x1 at the same off-screen position instead, and WHICH one happened is
/// reported through op=state (hiddenStyle) rather than assumed.
#[cfg(desktop)]
fn hide_webview<R: tauri::Runtime>(webview: &tauri::webview::Webview<R>) -> Result<String, String> {
    if webview.set_bounds(logical_rect(HIDDEN_POS, HIDDEN_POS, 0.0, 0.0)).is_ok() {
        return Ok("zero".to_string());
    }
    webview
        .set_bounds(logical_rect(HIDDEN_POS, HIDDEN_POS, 1.0, 1.0))
        .map(|_| "off-view-1x1".to_string())
        .map_err(|error| format!("hide a tab: {error}; a 0x0 rect was refused first"))
}

/// Add one child webview, WAIT for it, and leave it on the rect it is meant to have.
///
/// The thread is not an optimisation: adding a child webview from the thread that handled the HTTP
/// request deadlocks on Windows, which is why the pre-R178 open scheduled it too. What is new is the
/// rendezvous - the op answers only once the window exists - so one reading is evidence rather than a
/// hope, and a window that never appears answers with an error that says so.
#[cfg(desktop)]
fn spawn_child(app: &AppHandle, label: &str, url: &str, data_dir: PathBuf, rect: (f64, f64, f64, f64)) -> Result<(), String> {
    if app.get_webview(label).is_some() {
        return Ok(());
    }
    let parsed = tauri::Url::parse(url).map_err(|error| format!("{label} url {url}: {error}"))?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let handle = app.clone();
    let owner = label.to_string();
    let (x, y, w, h) = (rect.0, rect.1, rect.2.max(1.0), rect.3.max(1.0));
    std::thread::spawn(move || {
        let outcome = match crate::embed::window(&handle) {
            Some(window) => {
                let builder = WebviewBuilder::new(owner.as_str(), WebviewUrl::External(parsed))
                    .data_directory(data_dir)
                    // The reporter is in place BEFORE the first document, for every tab: a tab that loads
                    // and fails inside its first second must not be a silent white rectangle.
                    .initialization_script(PANEL_REPORTER)
                    .focused(false);
                window
                    .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(w, h))
                    .map(|_| ())
                    .map_err(|error| format!("add_child({owner}): {error}"))
            }
            None => Err("the shell's window is gone: the browser panel has nothing to place its webview on".to_string()),
        };
        let _ = tx.send(outcome);
    });
    match rx.recv_timeout(CREATE_TIMEOUT) {
        Ok(Ok(())) => {
            println!("[browser] created {label} -> {url}");
            if let Some(webview) = app.get_webview(label) {
                let _ = webview.set_bounds(logical_rect(x, y, w, h));
            }
            // Measured: a window created milliseconds ago REFUSES the first in-process protocol call
            // (E_ACCESSDENIED on the mount-time mode application, while the same call succeeded later on the
            // same window). The renderer is given a moment here, once, instead of every caller retrying.
            std::thread::sleep(Duration::from_millis(250));
            Ok(())
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(format!("{label} was scheduled but did not report creation inside {CREATE_TIMEOUT:?}")),
    }
}

/// A child webview is a desktop object.
///
/// Creating one is `Window::add_child` and placing it is `Webview::set_bounds`; both are
/// compiled for desktop builds only, because a mobile webview is not a window Tauri can parent
/// another one to. Android renders the client in the activity's single webview, so the sidebar
/// browser cannot be mounted there yet and every call that would create or place one answers
/// with the reserved refusal instead of pretending a rectangle exists.
#[cfg(mobile)]
fn spawn_child(_app: &AppHandle, label: &str, _url: &str, _data_dir: PathBuf, _rect: (f64, f64, f64, f64)) -> Result<(), String> {
    Err(super::mobile::reserved(&format!("creating child webview {label}")))
}

/// Put the browser where the state says it goes: the chrome page over the bar and the bay, the ACTIVE tab
/// on the SCREEN inside the bay, every other tab parked - and then re-fit the page viewport, because the
/// scale is a function of the content rect the caller just changed.
///
/// R179-A changed two of those rectangles. The chrome page is the whole deck now (it paints the bay and the
/// screen frame itself), and the active tab is the letterboxed screen, not the bay: in fixed mode a 612x766
/// bay shows a centred screen at the viewport's aspect ratio with black bars around it, which is the shape
/// the user asked for. The two are placed from the same [`Surface`] and the same [`fixed_scale`], so the
/// page's own idea of its size and the rectangle it is drawn on cannot drift apart.
#[cfg(desktop)]
fn place_all(app: &AppHandle) -> Result<(), String> {
    // The resolution is a persisted choice (R179-A): read it before anything here uses it.
    ensure_prefs(app);
    // The ID of the active tab, NOT its label: this loop's job is to compare against `tab.id`, and the
    // first build of this function compared an id against the active LABEL - which never matches, so every
    // tab was parked and the content area stayed empty (measured: the active tab at -30000,-30000 0x0).
    let (mounted, surface, active_id, tabs, mode, viewport) = {
        let panel = state().lock().unwrap();
        (
            panel.mounted,
            panel.surface,
            panel.active.clone(),
            panel.tabs.clone(),
            panel.mode,
            panel.viewport,
        )
    };
    if !mounted {
        return Ok(());
    }
    let Some(surface) = surface else {
        return Ok(());
    };
    if let Some(chrome) = app.get_webview(CHROME_LABEL) {
        let (x, y, w, h) = surface.deck();
        chrome
            .set_bounds(logical_rect(x, y, w.max(1.0), h.max(1.0)))
            .map_err(|error| format!("place {CHROME_LABEL}: {error}"))?;
    }
    let (cx, cy, cw, ch) = surface.screen(mode, viewport);
    let mut hidden = None;
    for tab in tabs {
        let Some(webview) = app.get_webview(&tab.label) else {
            continue;
        };
        if Some(tab.id.as_str()) == active_id.as_deref() && cw > 1.0 && ch > 1.0 {
            webview
                .set_bounds(logical_rect(cx, cy, cw, ch))
                .map_err(|error| format!("place {}: {error}", tab.label))?;
        } else {
            hidden = Some(hide_webview(&webview)?);
        }
    }
    if hidden.is_some() {
        let mut panel = state().lock().unwrap();
        panel.hidden_style = hidden;
    }
    if let Err(error) = apply_mode(app) {
        // A placement is still a placement - the browser IS where the page said - but a viewport that did
        // not follow must not be silent, and op=state carries the mode as NOT applied.
        println!("[browser] the page viewport did not follow the content rect: {error}");
    }
    Ok(())
}

/// There is nothing to place on a mobile build: no child webview can have been created (see the
/// reserved refusal above), so a placement is a no-op rather than a failure.
#[cfg(mobile)]
fn place_all(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

/// Apply the stored mode to the active tab's page through the in-process protocol and record whether
/// the page took it. fit clears the override (the page's viewport IS the content rect); fixed sets the
/// contract's viewport with scale = min(contentW / w, contentH / h).
fn apply_mode(app: &AppHandle) -> Result<(), String> {
    let (mode, viewport, active, content) = {
        let panel = state().lock().unwrap();
        (panel.mode, panel.viewport, active_label(&panel), panel.surface.map(|surface| surface.content()))
    };
    let Some(label) = active else {
        // No page to put anything on, so nothing was applied - recorded as such rather than as success.
        let mut panel = state().lock().unwrap();
        panel.mode_applied = false;
        panel.mode_error = None;
        return Ok(());
    };
    let (cw, ch) = content.map(|quad| (quad.2, quad.3)).unwrap_or((0.0, 0.0));
    let (calls, scale) = match mode {
        Mode::Fit => {
            // fit: CLEAR the override (the contract's implementation), then ASSERT the content rect as the
            // page viewport with the default device scale factor (0 = do not override it) and no scaling.
            //
            // The second call is not belt-and-braces, it is the measurement: clearing an override restores
            // the renderer's CACHED default viewport, not the current one. Measured: the tab was created at
            // 612x766 under the boot override, the content area was then 640x484, and after the clear the page
            // still reported innerWidth/innerHeight 612x766; the only thing that refreshed it was a real
            // resize while no override was active (the content area became 520x564 and the page then reported
            // 520x564). The contract asks for "page viewport = the content rect", so it is asserted.
            (
                vec![
                    ("Emulation.clearDeviceMetricsOverride".to_string(), "{}".to_string()),
                    (
                        "Emulation.setDeviceMetricsOverride".to_string(),
                        format!(
                            r#"{{"width":{},"height":{},"deviceScaleFactor":0,"mobile":false,"scale":1}}"#,
                            cw.max(1.0),
                            ch.max(1.0)
                        ),
                    ),
                ],
                None,
            )
        }
        Mode::Fixed => {
            // The same number `Surface::screen` places the window with: the page is told it is `viewport`
            // wide and scaled by exactly the factor the screen rectangle was cut with.
            let fit = fixed_scale((cw, ch), viewport);
            (
                vec![(
                    "Emulation.setDeviceMetricsOverride".to_string(),
                    format!(
                        r#"{{"width":{},"height":{},"deviceScaleFactor":1,"mobile":false,"scale":{fit}}}"#,
                        viewport.0, viewport.1
                    ),
                )],
                Some(fit),
            )
        }
    };
    let mut outcome = Ok(String::new());
    for (method, params) in calls.iter() {
        outcome = call_cdp_on(app, &label, method, params, Duration::from_millis(8000));
        if outcome.is_err() {
            break;
        }
    }
    match outcome {
        Ok(_) => {
            let mut panel = state().lock().unwrap();
            panel.scale = scale;
            panel.mode_applied = true;
            panel.mode_error = None;
            Ok(())
        }
        Err(error) => {
            let mut panel = state().lock().unwrap();
            panel.mode_applied = false;
            panel.mode_error = Some(error.clone());
            Err(error)
        }
    }
}

/// One DevTools protocol call against ONE webview label, in process, with a deadline.
///
/// This is panel_cdp::call with the label as an argument: the pre-R178 version is bound to the single
/// panel label, and a browser has several windows. The WebView2 sequence is the same four steps
/// (controller -> CoreWebView2 -> CallDevToolsProtocolMethod -> a completed handler feeding an mpsc
/// channel). panel_cdp.rs is outside this round's write scope, so the two exist side by side; the
/// consolidation is to delete the label-bound wrapper and keep this one (and then the legacy
/// /__shell/panel/cdp route has exactly one implementation behind it).
#[cfg(target_os = "windows")]
fn call_cdp_on(app: &AppHandle, label: &str, method: &str, params: &str, timeout: Duration) -> Result<String, String> {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
    use windows_core::HSTRING;

    let Some(webview) = app.get_webview(label) else {
        return Err(format!("no webview labelled {label}: that window is not up"));
    };
    let asked = method.to_string();
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let method = method.to_string();
    let params = params.to_string();
    webview
        .with_webview(move |platform| {
            let controller = platform.controller();
            let core: ICoreWebView2 = match unsafe { controller.CoreWebView2() } {
                Ok(core) => core,
                Err(error) => {
                    let _ = tx.send(Err(format!("CoreWebView2: {error}")));
                    return;
                }
            };
            let answered = tx.clone();
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |error, result| {
                let outcome = match error {
                    Ok(()) => Ok(result.to_string()),
                    Err(error) => Err(format!("the protocol answered with an error: {error}")),
                };
                let _ = answered.send(outcome);
                Ok(())
            }));
            if let Err(error) = unsafe {
                core.CallDevToolsProtocolMethod(&HSTRING::from(method.as_str()), &HSTRING::from(params.as_str()), &handler)
            } {
                let _ = tx.send(Err(format!("CallDevToolsProtocolMethod: {error}")));
            }
        })
        .map_err(|error| format!("with_webview({label}): {error}"))?;
    match rx.recv_timeout(timeout) {
        Ok(outcome) => outcome,
        Err(_) => Err(format!("{label} did not answer {asked} inside the deadline")),
    }
}

#[cfg(not(target_os = "windows"))]
fn call_cdp_on(_app: &AppHandle, label: &str, _method: &str, _params: &str, _timeout: Duration) -> Result<String, String> {
    Err(format!("in-process CDP is implemented on Windows/WebView2 only (asked {label})"))
}
/// op=surface - the plugin declares the rect the browser should fill (contract section 2 and 3).
///
/// A 0x0 (or negative) declaration means the pane is GONE, so the browser goes with it: leaving an
/// invisible child webview behind is exactly the state the contract calls a bug, and the page host
/// relies on the same rule when the column collapses.
pub fn surface(app: &AppHandle, x: f64, y: f64, w: f64, h: f64, holder: Option<&str>) -> Result<(), String> {
    ensure_prefs(app);
    enforce_lease("surface", holder)?;
    if !(x.is_finite() && y.is_finite() && w.is_finite() && h.is_finite()) {
        return Err("surface needs finite x, y, w and h (CSS px)".to_string());
    }
    if w <= 0.0 || h <= 0.0 {
        unmount(app, holder)?;
        let mut panel = state().lock().unwrap();
        panel.surface = None;
        return Ok(());
    }
    {
        let mut panel = state().lock().unwrap();
        panel.surface = Some(Surface { x, y, w, h });
    }
    if state().lock().unwrap().mounted {
        place_all(app)?;
    }
    Ok(())
}

/// op=mount - put the browser in the declared surface: our chrome page in the top strip and, the first
/// time, one tab in the content area. Idempotent: a mounted browser is left as it is; one that was taken
/// down comes back with the tabs the plugin had NAMED.
///
/// What does NOT come back is in-page state: the renderer is gone, so history, scroll and JS memory go
/// with it. The URL and the profile (cookies, logins) are what return.
pub fn mount(app: &AppHandle, url: &str, holder: Option<&str>) -> Result<(), String> {
    ensure_prefs(app);
    enforce_lease("mount", holder)?;
    let (surface, mounted, tabs) = {
        let panel = state().lock().unwrap();
        (panel.surface, panel.mounted, panel.tabs.clone())
    };
    // The surface may not have arrived yet, and that is a supported order: the page host that measures the
    // column opens the browser FIRST and declares the rect on its next tick (R144's retry loop). With no
    // surface the windows are created PARKED - nothing visible, nothing misplaced - and op=state says
    // surface:null until the rect lands, at which point the same op places everything in it.
    let (chrome_rect, content_rect) = match surface {
        Some(surface) => {
            let (chx, chy, chw, chh) = surface.chrome();
            let (cx, cy, cw, ch) = surface.content();
            (
                (chx, chy, chw.max(1.0), chh.max(1.0)),
                (cx, cy, cw.max(1.0), ch.max(1.0)),
            )
        }
        None => ((HIDDEN_POS, HIDDEN_POS, 1.0, 1.0), (HIDDEN_POS, HIDDEN_POS, 1.0, 1.0)),
    };
    let dir = data_directory(app)?;
    if let Err(error) = spawn_child(app, CHROME_LABEL, &chrome_url(), dir.clone(), chrome_rect) {
        record_error(&error);
        return Err(error);
    }
    if mounted && !tabs.is_empty() {
        return Ok(());
    }
    if tabs.is_empty() {
        let (id, label) = take_tab_id();
        let first = url_or_start(url);
        if let Err(error) = spawn_child(app, &label, &first, dir.clone(), content_rect) {
            record_error(&error);
            return Err(error);
        }
        let mut panel = state().lock().unwrap();
        panel.tabs.push(Tab { id: id.clone(), label, url: first.clone(), live: true });
        panel.active = Some(id);
        panel.mounted = true;
        panel.data_dir = Some(dir);
        panel.url = Some(first);
        panel.last_error = None;
        panel.pending = false;
    } else {
        let active = state().lock().unwrap().active.clone();
        for tab in tabs.iter() {
            let rect = if Some(tab.id.as_str()) == active.as_deref() {
                content_rect
            } else {
                (HIDDEN_POS, HIDDEN_POS, 1.0, 1.0)
            };
            if let Err(error) = spawn_child(app, &tab.label, &tab.url, dir.clone(), rect) {
                record_error(&error);
                return Err(error);
            }
        }
        let mut panel = state().lock().unwrap();
        for tab in panel.tabs.iter_mut() {
            tab.live = true;
        }
        panel.mounted = true;
        panel.data_dir = Some(dir);
        panel.last_error = None;
        panel.pending = false;
    }
    match place_all(app) {
        Ok(()) => Ok(()),
        Err(error) => {
            record_error(&error);
            Err(error)
        }
    }
}

/// Close one child webview, naming what could not be closed.
///
/// `Webview::close` is a desktop method; a label that has no webview closes nothing, which is
/// the answer both a mobile build and an already-closed tab give.
#[cfg(desktop)]
fn close_webview(app: &AppHandle, label: &str) -> tauri::Result<()> {
    match app.get_webview(label) {
        Some(webview) => webview.close(),
        None => Ok(()),
    }
}

/// A mobile build has no child webviews to close (see the reserved refusal in `spawn_child`),
/// so a teardown finds nothing to do.
#[cfg(mobile)]
fn close_webview(_app: &AppHandle, _label: &str) -> tauri::Result<()> {
    Ok(())
}

/// Hand the keyboard back to the main webview after a teardown. Measured in R157: after a close
/// the native focus window was 0 - the panel was gone and NOTHING had it, so a user who typed
/// next typed into nothing until they clicked again.
#[cfg(desktop)]
fn restore_main_focus(app: &AppHandle) {
    if let Some(main) = crate::embed::webview(app) {
        let _ = main.set_focus();
    }
}

/// `Webview::set_focus` is a desktop call, and an Android build never moved the keyboard away
/// from the activity's webview in the first place.
#[cfg(mobile)]
fn restore_main_focus(_app: &AppHandle) {}

/// op=unmount - take the browser down: every tab window and the chrome window are closed.
///
/// The tab SET (ids and URLs) is kept, because the plugin owns it; the windows are the shell's to
/// destroy. A lease held by somebody else refuses this by name, like every other write.
pub fn unmount(app: &AppHandle, holder: Option<&str>) -> Result<(), String> {
    enforce_lease("unmount", holder)?;
    // R438: PARK, do not close. A browser the person has open behind another rail tab is not a browser they want
    // reloaded: the mockup they gave us draws exactly that state (a blurred "session ghost") and asked for keep-alive in
    // words. The child webviews are hidden off-screen instead of destroyed, and `spawn_child` already reuses a label that
    // still has a live webview, so a later mount re-places the SAME page instead of reloading it. Memory is the price and
    // MAX_TABS bounds it.
    let mut labels: Vec<String> = {
        let panel = state().lock().unwrap();
        panel.tabs.iter().map(|tab| tab.label.clone()).collect()
    };
    labels.push(CHROME_LABEL.to_string());
    let mut problems: Vec<String> = Vec::new();
    for label in labels {
        match app.get_webview(&label) {
            Some(webview) => {
                if let Err(error) = hide_webview(&webview) {
                    problems.push(format!("park {label}: {error}"));
                }
            }
            None => {}
        }
    }
    {
        let mut panel = state().lock().unwrap();
        panel.mounted = false;
        panel.scale = None;
        panel.mode_applied = false;
        panel.hidden_style = None;
        // The webviews are PARKED: the tabs stay live so a remount can reuse them. `mount` re-places them from the tab
        // set, so keeping `live` true is the whole keep-alive contract.
        for tab in panel.tabs.iter_mut() {
            tab.live = app.get_webview(&tab.label).is_some();
        }
        // A closed browser has no content: leaving the last page's title behind would let a caller read a
        // page that is not on screen at all (the R145 rule, applied at the teardown).
        panel.content = None;
        panel.content_reports = 0;
        panel.content_page = None;
    }
    // Hand the keyboard back to the main webview: it is where the keyboard was before the panel
    // existed, so it is where it goes back (see `restore_main_focus`).
    restore_main_focus(app);
    if problems.is_empty() {
        Ok(())
    } else {
        Err(problems.join("; "))
    }
}

/// op=tab-new - one more tab, which becomes the active one (what a browser does).
///
/// The cap is MAX_TABS and the refusal NAMES the tab it will not open, the limit, and the tabs that are
/// live: a caller that is over the limit must be able to say WHICH request was refused.
pub fn tab_new(app: &AppHandle, url: &str, holder: Option<&str>) -> Result<String, String> {
    enforce_lease("tab-new", holder)?;
    let (mounted, surface, tabs, next) = {
        let panel = state().lock().unwrap();
        (panel.mounted, panel.surface, panel.tabs.clone(), panel.next_tab)
    };
    if !mounted {
        return Err("tab-new needs a mounted browser: call op=mount first".to_string());
    }
    // The value is not needed here (the new tab is created parked, and place_all puts it in the content
    // area); the GUARD is: a mounted browser always has a surface, and a caller that got here without one
    // must be told rather than given a tab nobody can see.
    if surface.is_none() {
        return Err("tab-new needs a surface: declare one with op=surface first".to_string());
    }
    if tabs.len() >= MAX_TABS {
        let ids: Vec<&str> = tabs.iter().map(|tab| tab.id.as_str()).collect();
        return Err(format!(
            "named refusal: op=tab-new is not opening tab t{} because the limit is {MAX_TABS} tabs and {} are live ({}); close one first",
            next + 1,
            tabs.len(),
            ids.join(", ")
        ));
    }
    let dir = data_directory(app)?;
    let (id, label) = take_tab_id();
    let target = url_or_start(url);
    // Created out of the client area and activated right away: a tab that appeared at content size and was
    // then parked would flash a page the user did not ask to see.
    if let Err(error) = spawn_child(app, &label, &target, dir, (HIDDEN_POS, HIDDEN_POS, 1.0, 1.0)) {
        record_error(&error);
        return Err(error);
    }
    {
        let mut panel = state().lock().unwrap();
        panel.tabs.push(Tab { id: id.clone(), label, url: target, live: true });
        panel.active = Some(id.clone());
    }
    place_all(app)?;
    Ok(id)
}

/// op=tab-close - close one tab by id. A refusal names the id asked for and the tabs that exist.
pub fn tab_close(app: &AppHandle, id: &str, holder: Option<&str>) -> Result<(), String> {
    enforce_lease("tab-close", holder)?;
    let (tab, index, was_active) = {
        let panel = state().lock().unwrap();
        match panel.tabs.iter().position(|tab| tab.id == id) {
            Some(index) => (
                panel.tabs[index].clone(),
                index,
                panel.active.as_deref() == Some(id),
            ),
            None => {
                let ids: Vec<&str> = panel.tabs.iter().map(|tab| tab.id.as_str()).collect();
                return Err(format!(
                    "named refusal: op=tab-close for tab {id:?}, which is not one of [{}]",
                    ids.join(", ")
                ));
            }
        }
    };
    close_webview(app, &tab.label).map_err(|error| format!("close {}: {error}", tab.label))?;
    {
        let mut panel = state().lock().unwrap();
        if let Some(at) = panel.tabs.iter().position(|tab| tab.id == id) {
            panel.tabs.remove(at);
        }
        if was_active {
            // The neighbour to the left, as a browser does; the new first tab when there is no left one.
            panel.active = if panel.tabs.is_empty() {
                None
            } else {
                let at = index.saturating_sub(1).min(panel.tabs.len() - 1);
                Some(panel.tabs[at].id.clone())
            };
        }
    }
    place_all(app)
}

/// op=tab-activate - put one tab in the content area and park every other one.
pub fn tab_activate(app: &AppHandle, id: &str, holder: Option<&str>) -> Result<(), String> {
    enforce_lease("tab-activate", holder)?;
    {
        let mut panel = state().lock().unwrap();
        if !panel.tabs.iter().any(|tab| tab.id == id) {
            let ids: Vec<&str> = panel.tabs.iter().map(|tab| tab.id.as_str()).collect();
            return Err(format!(
                "named refusal: op=tab-activate for tab {id:?}, which is not one of [{}]",
                ids.join(", ")
            ));
        }
        panel.active = Some(id.to_string());
    }
    place_all(app)
}

/// op=tab-goto - send one tab to a URL. A tab whose window is down keeps the URL for the next mount.
pub fn tab_goto(app: &AppHandle, id: &str, url: &str, holder: Option<&str>) -> Result<(), String> {
    enforce_lease("tab-goto", holder)?;
    if url.is_empty() {
        return Err("tab-goto needs a url".to_string());
    }
    let parsed = tauri::Url::parse(url).map_err(|error| format!("tab-goto url {url}: {error}"))?;
    let label = {
        let panel = state().lock().unwrap();
        match panel.tabs.iter().find(|tab| tab.id == id) {
            Some(tab) => tab.label.clone(),
            None => {
                let ids: Vec<&str> = panel.tabs.iter().map(|tab| tab.id.as_str()).collect();
                return Err(format!(
                    "named refusal: op=tab-goto for tab {id:?}, which is not one of [{}]",
                    ids.join(", ")
                ));
            }
        }
    };
    if let Some(webview) = app.get_webview(&label) {
        webview.navigate(parsed).map_err(|error| format!("navigate {label}: {error}"))?;
    }
    let mut panel = state().lock().unwrap();
    if let Some(tab) = panel.tabs.iter_mut().find(|tab| tab.id == id) {
        tab.url = url.to_string();
    }
    drop(panel);
    Ok(())
}

/// op=mode - fixed (a constant page viewport, scaled; the default) or fit (the page follows the
/// content area). An unknown kind or an unusable viewport is refused BY NAME, and if the page does not
/// take the mode the stored mode is put back: a mode is never reported as applied when it was not.
pub fn mode(app: &AppHandle, kind: &str, viewport: Option<(f64, f64)>, holder: Option<&str>) -> Result<(), String> {
    ensure_prefs(app);
    enforce_lease("mode", holder)?;
    let wanted = match kind {
        "fixed" => Mode::Fixed,
        "fit" => Mode::Fit,
        other => {
            return Err(format!(
                "named refusal: op=mode got kind {other:?}; the two modes are \"fixed\" (a constant {}x{} page viewport, the default) and \"fit\" (the page follows the content area)",
                DEFAULT_VIEWPORT.0 as u32, DEFAULT_VIEWPORT.1 as u32
            ));
        }
    };
    if let Some((w, h)) = viewport {
        // R179-A: a viewport that arrives with a mode is the same number op=viewport would take, so it is
        // held to the same bounds - a size op=viewport refuses must not sneak in through op=mode, and a
        // number the file could not restore must not be written to it.
        if !viewport_is_usable((w, h)) {
            return Err(format!(
                "named refusal: op=mode got a viewport of {w}x{h}: both numbers must be finite and between {} and {} px",
                VIEWPORT_MIN as u32, VIEWPORT_MAX as u32
            ));
        }
    }
    let previous = {
        let panel = state().lock().unwrap();
        (panel.mode, panel.viewport)
    };
    let wanted_viewport = viewport.unwrap_or(previous.1);
    // The choice is persisted BEFORE the state is changed, so a mode op that cannot be written to disk
    // refuses by name and leaves the panel exactly as it was (the same rule op=viewport follows).
    if let Err(error) = persist_change(app, wanted_viewport, wanted) {
        return Err(format!(
            "named refusal: op=mode could not persist {kind:?}: {error}; the panel is still on {} in mode {}",
            previous.1 .0,
            previous.0.name()
        ));
    }
    {
        let mut panel = state().lock().unwrap();
        panel.mode = wanted;
        panel.viewport = wanted_viewport;
    }
    match apply_mode(app) {
        Ok(()) => Ok(()),
        Err(error) => {
            let mut panel = state().lock().unwrap();
            panel.mode = previous.0;
            panel.viewport = previous.1;
            drop(panel);
            // Put the file back with it: what is stored must describe what the page is really doing.
            if let Err(restore) = persist_change(app, previous.1, previous.0) {
                eprintln!("[browser] the persisted mode could not be restored: {restore}");
            }
            Err(format!("the page did not take mode {kind:?}: {error}"))
        }
    }
}

/// op=viewport - the page viewport the fixed mode renders at, and the one choice the user asked to be able
/// to change (R179-A).
///
/// Two ways to say it, and a refusal that names what was wrong for everything else:
/// - `preset: "1920x1080"` - one of [`VIEWPORT_PRESETS`], by name;
/// - `width` and `height` - a custom size inside [`VIEWPORT_MIN`]..[`VIEWPORT_MAX`];
/// - anything else (both, neither, an unknown preset, a size out of bounds, a non-number) is refused BY NAME
///   and the state is NOT touched - the viewport, the mode and the file are all left as they were.
///
/// The order is persist -> state -> page, so `op=state` never reports a resolution a restart would not
/// restore. In fit mode there is no fixed viewport on screen, so the op stores the size and re-applies the
/// (fit) mode; the size is what the next switch to fixed renders at, which is why the store still happens.
pub fn set_viewport(
    app: &AppHandle,
    preset: Option<&str>,
    width: Option<f64>,
    height: Option<f64>,
    holder: Option<&str>,
) -> Result<(), String> {
    ensure_prefs(app);
    enforce_lease("viewport", holder)?;
    let wanted = resolve_viewport(preset, width, height)?;
    let (previous, mode) = {
        let panel = state().lock().unwrap();
        (panel.viewport, panel.mode)
    };
    if previous == wanted {
        // Nothing to change - but the call still counts as a successful op, and the page is re-asserted in
        // case it drifted (a tab that navigated since the last application has no override of its own).
        return apply_mode(app).map_err(|error| format!("the page did not take the viewport again: {error}"));
    }
    if let Err(error) = persist_change(app, wanted, mode) {
        return Err(format!(
            "named refusal: op=viewport could not persist {}x{}: {error}; the panel is still on {}x{}",
            wanted.0, wanted.1, previous.0, previous.1
        ));
    }
    {
        let mut panel = state().lock().unwrap();
        panel.viewport = wanted;
    }
    match apply_mode(app) {
        Ok(()) => Ok(()),
        Err(error) => {
            let mut panel = state().lock().unwrap();
            panel.viewport = previous;
            drop(panel);
            if let Err(restore) = persist_change(app, previous, mode) {
                eprintln!("[browser] the persisted viewport could not be restored: {restore}");
            }
            Err(format!(
                "named refusal: op=viewport got {}x{} but the page did not take it: {error}",
                wanted.0, wanted.1
            ))
        }
    }
}

/// op=cdp - one protocol call against a tab's own window: the active tab by default, any tab by id, or
/// the string \"chrome\" for the shell's browser page itself (which is how a check script reads the
/// chrome's real DOM and sizes). The result is the protocol's own JSON, as a string.
pub fn cdp(
    app: &AppHandle,
    tab: Option<&str>,
    holder: Option<&str>,
    method: &str,
    params: &str,
    timeout: Duration,
) -> Result<String, String> {
    // R178-T: a caller whose turn the user took away is refused here too, not only on the geometry writes.
    enforce_revocation(holder)?;
    if method.is_empty() {
        return Err("a cdp call needs a method".to_string());
    }
    let label = {
        let panel = state().lock().unwrap();
        match tab {
            Some("chrome") => CHROME_LABEL.to_string(),
            Some(id) => match panel.tabs.iter().find(|tab| tab.id == id) {
                Some(tab) => tab.label.clone(),
                None => {
                    let ids: Vec<&str> = panel.tabs.iter().map(|tab| tab.id.as_str()).collect();
                    return Err(format!(
                        "named refusal: op=cdp for tab {id:?}, which is not one of [{}]",
                        ids.join(", ")
                    ));
                }
            },
            None => match active_label(&panel) {
                Some(label) => label,
                None => return Err("no active tab: mount a browser with a tab before asking it anything".to_string()),
            },
        }
    };
    // R184-D: the one place an injection window is opened and closed, for BOTH routes into this function
    // (`op=cdp` on the panel path and the legacy `/__shell/panel/cdp`). The window opens BEFORE the
    // dispatch, so a report that arrives while the event is still being delivered is already attributed to
    // it, and closes into [`INJECTION_GRACE`] after it RETURNS, so the beacon's second loopback hop lands
    // inside it too. A window is opened even if the call then fails: the failure says the shell could not
    // answer, not that no event was delivered, and the conservative direction is to attribute a report to
    // an injection we asked for rather than to revoke a caller's lease for it.
    let injecting = injects_input(method);
    if injecting {
        state().lock().unwrap().injection.begin(method);
    }
    let outcome = call_cdp_on(app, &label, method, params, timeout);
    if injecting {
        state().lock().unwrap().injection.end();
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    /// R184-D: which protocol calls open a window at all. The domain matters: `Input.*` delivers events
    /// (or text) into a page, everything else the panel is asked for injects no input event.
    #[test]
    fn only_the_input_domain_injects() {
        assert!(injects_input("Input.dispatchMouseEvent"));
        assert!(injects_input("Input.dispatchKeyEvent"));
        assert!(injects_input("Input.insertText"));
        assert!(!injects_input("Runtime.evaluate"));
        assert!(!injects_input("Page.navigate"));
        assert!(!injects_input("Emulation.setDeviceMetricsOverride"));
        // The prefix must be the domain separator, not the first five letters of some other method.
        assert!(!injects_input("Input"));
        assert!(!injects_input("Inputs.x"));
        assert!(!injects_input(""));
    }

    /// R184-D: the window is open while a dispatch is in flight however long that takes, and then for
    /// exactly the grace - and it is decided ON THE READ, so a call that never returns cannot leave a
    /// window open for the rest of the process's life.
    #[test]
    fn a_window_is_open_in_flight_and_then_only_for_the_grace() {
        let mut injection = Injection::default();
        injection.begin("Input.dispatchMouseEvent");
        assert!(injection.is_open(Instant::now() + Duration::from_secs(3600)), "an in-flight dispatch IS the window");
        assert_eq!(injection.dispatches, 1);
        assert_eq!(injection.last_method.as_deref(), Some("Input.dispatchMouseEvent"));
        injection.end();
        let returned = injection.returned_at.expect("the return is stamped");
        let until = injection.until.expect("the grace deadline is stamped");
        assert_eq!(until.saturating_duration_since(returned), INJECTION_GRACE);
        assert!(injection.is_open(returned), "the grace starts at the return");
        assert!(injection.is_open(until - Duration::from_millis(1)));
        assert!(!injection.is_open(until), "the deadline is exclusive");
        assert!(!injection.is_open(until + Duration::from_millis(1)));
    }

    /// R184-D: an ignored report is RECORDED, with enough detail to tell a report that beat the dispatch's
    /// return from one that needed the grace.
    #[test]
    fn an_ignored_report_is_recorded_with_the_lag_it_needed() {
        let mut injection = Injection::default();
        injection.begin("Input.dispatchKeyEvent");
        injection.note_ignored("keydown", Instant::now());
        let first = injection.last_ignored.clone().expect("recorded");
        assert_eq!(first.kind, "keydown");
        assert_eq!(first.method, "Input.dispatchKeyEvent");
        assert!(first.during_dispatch, "it beat the return");
        assert_eq!(first.after_return_ms, None);
        assert!(first.at_ms > 0, "a wall clock, so a caller can line it up with its own log");
        injection.end();
        // The grace case: the report lands after the dispatch returned.
        injection.returned_at = Some(Instant::now() - Duration::from_millis(7));
        injection.note_ignored("pointerdown", Instant::now());
        let second = injection.last_ignored.clone().expect("recorded");
        assert!(!second.during_dispatch);
        assert!(second.after_return_ms.expect("a lag") >= 7, "the lag is measured from the return");
        assert_eq!(injection.ignored, 2);
    }

    /// R184-D, the invariant the round is about: a report attributed to the shell's injection takes NO
    /// turn. Nothing that a reader uses to mean "the user has the panel" moves, and no revocation record is
    /// left behind - the ignored report is visible in the injection counters instead.
    #[test]
    fn an_injected_report_leaves_no_takeover_trace_but_is_counted() {
        let mut panel = Panel::default();
        let now = Instant::now();
        panel.injection.begin("Input.dispatchMouseEvent");
        assert!(panel.classify_input("pointerdown", now), "inside the window it is ours");
        panel.injection.end();
        assert!(panel.classify_input("pointerdown", Instant::now()), "the grace is part of the window");
        assert!(panel.revoked.is_none(), "the user did NOT take the turn");
        assert_eq!(panel.user_input_reports, 0, "no user input was reported");
        assert_eq!(panel.last_user_input, None);
        assert_eq!(panel.injection.ignored, 2, "and it is not a silent drop either");
    }

    /// R184-D: outside the window nothing changed - the report is the user's, with the same record shape
    /// R178-T/R179-A always wrote.
    #[test]
    fn a_report_outside_the_window_still_takes_the_turn() {
        let mut panel = Panel::default();
        panel.lease = Some(Lease {
            holder: "r184-d-test".to_string(),
            expires_at: Instant::now() + Duration::from_secs(30),
        });
        let mut injection = Injection::default();
        injection.begin("Input.dispatchMouseEvent");
        injection.end();
        injection.until = Some(Instant::now() - Duration::from_millis(1)); // the grace has passed
        panel.injection = injection;
        assert!(!panel.classify_input("pointerdown", Instant::now()));
        assert!(panel.injection.ignored == 0);
        // What the caller does next is the old path, exercised directly: the record names who lost the turn.
        let lost = take_turn(&mut panel, "pointerdown");
        assert_eq!(lost, "r184-d-test");
        assert!(panel.lease.is_none(), "a takeover ends the lease");
        let record = panel.revoked.as_ref().expect("a takeover is recorded");
        assert_eq!(record.by, "user-input");
        assert_eq!(record.kind, "pointerdown");
    }

    /// R184-D: the lease record keeps its six fields, in their order, with their exact meaning - the
    /// injection window is additive, and the six are still what a reader sees first.
    #[test]
    fn the_lease_record_keeps_its_six_fields_and_gains_the_window() {
        let empty = lease_json(&None, None, &Injection::default());
        assert!(
            empty.starts_with(r#"{"held":false,"holder":null,"expiresInMs":0,"revokedBy":null,"revokedHolder":null,"revokedKind":null,"injection":{"#),
            "the six fields and their order are frozen; got {empty}"
        );
        assert!(empty.contains(r#""open":false"#));
        assert!(empty.contains(r#""graceMs":250"#));
        assert!(empty.contains(r#""dispatches":0"#));
        assert!(empty.contains(r#""lastMethod":null"#));
        assert!(empty.contains(r#""ignoredInputs":0"#));
        assert!(empty.contains(r#""lastIgnored":null"#));
        // The revoked shape keeps naming WHO lost the turn and WHAT took it, and carries the window too.
        let revoked = Revoked { holder: "r183-ctl".to_string(), by: "user-input".to_string(), kind: "pointerdown".to_string() };
        let taken = lease_json(&None, Some(&revoked), &Injection::default());
        assert!(taken.starts_with(r#"{"held":false,"holder":null,"expiresInMs":0,"revokedBy":"user-input","revokedHolder":"r183-ctl","revokedKind":"pointerdown","injection":{"#), "got {taken}");
        // A held lease is still the same six fields, then the window.
        let held = lease_json(
            &Some(Lease { holder: "r184-ctl".to_string(), expires_at: Instant::now() + Duration::from_secs(30) }),
            None,
            &Injection::default(),
        );
        assert!(held.starts_with(r#"{"held":true,"holder":"r184-ctl","expiresInMs":"#), "got {held}");
        assert!(held.contains(r#","revokedKind":null,"injection":{"#), "got {held}");
    }
}