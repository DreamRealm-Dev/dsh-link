//! The kernel proxy.
//!
//! DSH Link's window loads the **official DSH client UI**, served by the kernel and
//! re-originated through this proxy. That is deliberate: the kernel's own frontend
//! plugins (`dsh-chat-mode`, `dsh-svg-studio`, and anything else built on
//! `dsh.client`) extend the official client through its slot system, so a
//! hand-written interface would be invisible to all of them.
//!
//! Everything the official client needs is a same-origin resource on the page's own
//! origin, so the proxy is a complete reverse proxy for the kernel's HTTP surface:
//!
//! - `GET /` and `GET /index.html` — the kernel's index. The host injects the
//!   `window.__DSH_BOOT__` module manifest and the other page globals into this
//!   HTML, so the bytes are forwarded untouched.
//! - `GET /{path}` — the kernel's static assets. The built index references them
//!   relatively (`./assets/…`), so they resolve against this origin.
//! - `ANY /api/{*endpoint}` — unary Connection RPC.
//! - `GET /api/{downlink}` — the event sockets and the Remote stream socket.
//!
//! The one thing the proxy adds is credentials. DSH 0.2.x gates every route behind a
//! signed `HttpOnly` cookie minted by exchanging the launch token the kernel prints
//! on stdout (see [`super::session`]). A browser cannot present it — `Cookie` is a
//! forbidden fetch header and the cookie is unreadable from JavaScript — so the shell
//! holds it and attaches it here, to requests and to WebSocket upgrades alike.
//!
//! Because the page and the API share an origin, no CORS relaxation is needed and the
//! official client's CSP can stay strict.
//!
//! ## Recovery
//!
//! When the kernel is not up there is no UI to serve, so the shell answers `/` itself
//! with a small boot/recovery page (see [`super::shellpage`]). That keeps one origin
//! and one code path for the window: it always talks to this proxy.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, Bytes};
use axum::extract::ws::Message as FrontendMessage;
use axum::extract::{FromRequestParts, State, WebSocketUpgrade};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use tauri::Manager;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as UpstreamMessage;

use tauri_plugin_clipboard_manager::ClipboardExt;

use super::liveness::Liveness;
use super::session::CredentialStore;
use super::sidebar_panel;
use super::shellprefs::{Palette, ShellPrefs, ShellWindow};
use super::supervisor::KernelSupervisor;

/// Path of the shell's own readiness probe. The official client never calls it, so it
/// cannot collide with a kernel route.
pub const SESSION_PATH: &str = "/__shell/session";

/// Prefix for shell-owned pages. Everything else belongs to the kernel.
pub const SHELL_PREFIX: &str = "/__shell";

/// The software-facing interconnect prefix (/link/v1/*, see plugins/dsh-link-interconnect).
///
/// It is a kernel prefix like /api, not a shell page, so the proxy re-originates it onto the
/// kernel origin with the session cookie attached. The one thing software peers never send is a
/// cookie: they are not browsers and hold no launch token, so this is the only way they can reach
/// a kernel route.
pub const LINK_PREFIX: &str = "/link";

/// Largest unary RPC body forwarded upstream.
///
/// Binary endpoints post file attachments as `multipart/form-data`, so the ceiling has
/// to accommodate real files rather than just JSON. It is a guard against an unbounded
/// buffer, not a quota.
const MAX_BODY_BYTES: usize = 256 * 1024 * 1024;

/// Shared proxy state: the kernel credentials to present upstream, the supervisor
/// that produces them, and the liveness signals the window watchdog consumes.
#[derive(Clone)]
pub struct ProxyState {
    credentials: Arc<CredentialStore>,
    /// The kernel's DSH_HOME, which the injected bridge reads credential facts from.
    home: PathBuf,
    supervisor: KernelSupervisor,
    liveness: Arc<Liveness>,
    /// The last authorization link already copied, so a repeated attempt frame does not
    /// overwrite a clipboard the user may already have used.
    copied_authorize: Arc<Mutex<Option<String>>>,
    /// The application handle, for the two things a request can ask the shell to do:
    /// open a link in the system browser, and put one on the clipboard.
    app: tauri::AppHandle,
}

impl ProxyState {
    /// Put the Platform sign-in link in one relayed frame on the clipboard.
    ///
    /// The shell does not open this link itself. The Desktop shell does, from its main
    /// process, where it reads the account stream over IPC — and that automatic jump is
    /// exactly what makes a sign-in take over the desktop. Here the link is only copied,
    /// so the window stays where it is and the user decides when to leave for a browser:
    /// the sign-in dialog shows the same link, and pasting this copy works too.
    ///
    /// Nothing depends on reading the frame beyond the copy: the dialog carries the link
    /// whether this notices it or not.
    fn copy_sign_in_link(&self, payload: &str) {
        let Some(url) = super::bridge::authorize_url(payload) else {
            return;
        };
        {
            let mut copied = self
                .copied_authorize
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if copied.as_deref() == Some(url.as_str()) {
                return;
            }
            *copied = Some(url.clone());
        }
        match self.app.clipboard().write_text(url.clone()) {
            Ok(()) => {
                eprintln!("[shell] copied the Platform sign-in link to the clipboard ({url})")
            }
            Err(error) => eprintln!("[shell] could not copy the sign-in link: {error}"),
        }
    }
}

/// Build the reverse proxy.
///
/// # Arguments
///
/// * `supervisor` - the kernel supervisor, which owns the session credentials and
/// answers questions about the kernel's state.
/// * `app` - the application handle, for opening links and writing the clipboard.
pub fn router(supervisor: KernelSupervisor, app: tauri::AppHandle) -> Router {
    let state = ProxyState {
        credentials: supervisor.credentials(),
        home: supervisor.home(),
        supervisor: supervisor.clone(),
        liveness: supervisor.liveness(),
        copied_authorize: Arc::new(Mutex::new(None)),
        app,
    };

    Router::new()
        .route(SESSION_PATH, get(session_ready))
        .route(&format!("{SHELL_PREFIX}/status"), get(kernel_status))
        // The device net's bridge end (see core::device_bridge): listening address, the
        // pairing code, the last pairing and the last request. The boot page is the only
        // place the code can be read from on a phone, so it has to be a route.
        .route(&format!("{SHELL_PREFIX}/bridge"), get(device_bridge_status))
        // R374: is the OFM desktop app on this machine? Detected, never started and never configured: the panel asks the
        // user and the join path does the writing.
        .route(&format!("{SHELL_PREFIX}/ofm"), get(ofm_presence))
        // R375: the join the user just agreed to. POST because it writes a config file - and the file is written only after
        // /health identifies the service and /v1/models accepts the key.
        .route(&format!("{SHELL_PREFIX}/ofm/join"), post(ofm_join))
        // The window's own preferences — the frame's corner radius and the palette the
        // boot page follows. One path, read and written: the client PUTs what its theme
        // toggle chose, and reads back what a previous run persisted.
        .route(
            &format!("{SHELL_PREFIX}/window"),
            get(window_preferences).put(set_window_preferences),
        )
        // The self-drawn frame, injected into the client's own document because the shell
        // does not own it (see [`super::frame`]).
        // R331: the phone as an INPUT. A page on this origin posts what it captured (audio today) and the bytes land
        // in one fixed directory under the bridge roots, where the paired host reads them back with fs.list / fs.read.
        .route(super::capture::CAPTURE_PATH, post(super::capture::store_capture))
        .route(&format!("{SHELL_PREFIX}/frame.css"), get(frame_css))
        .route(&format!("{SHELL_PREFIX}/frame.js"), get(frame_script))
        // The panel host: the page side of the geometry loop. It measures the right column and
        // tells the shell where the native child webview goes (see sidebar_panel).
        .route(sidebar_panel::PANEL_HOST_PATH, get(panel_host_script))
        .route(sidebar_panel::PANEL_START_PATH, get(panel_start))
        // R178-G: the shell's own browser chrome page - the tab strip, the address and the mode switch.
        // Same origin as everything else this window loads, which is what lets that page post panel ops
        // with no second credential (the CORS rule below refuses every other origin outright).
        .route(sidebar_panel::BROWSER_UI_PATH, get(browser_ui_page))
        // The panel's own DevTools protocol, in process. This is the half a page-side reporter cannot give:
        // a call that ANSWERS. No debugging port is opened; see core/panel_cdp.rs.
        .route(&format!("{SHELL_PREFIX}/panel/cdp"), post(sidebar_panel_cdp))
        // The panel's own document reports in here. Its own path, because the sender is whichever site the
        // panel loaded: it cannot be asked to speak the five-op shape, only to post a body.
        .route(
            &format!("{SHELL_PREFIX}/panel/report"),
            get(sidebar_panel_report_beacon).post(sidebar_panel_report),
        )
        // The right column's browser panel. One path, five ops: the page measures its own
        // container and tells the shell where the native child webview goes. Same shape as
        // `/__shell/window` — the client needs no IPC permission of its own to use it.
        .route(&format!("{SHELL_PREFIX}/panel"), post(sidebar_panel))
        // R387: another WINDOW of this running instance - requirement D as the product means it (same process, same
        // origin, same kernel, same session), and what the comment above has been calling `/__shell/window` all along.
        .route(&format!("{SHELL_PREFIX}/window"), post(window_op))
        // The injected bridge and the two endpoints it calls. Axum prefers a static
        // route over the shell page's catch-all, so these cannot be swallowed by it.
        .route(super::bridge::BRIDGE_PATH, get(bridge_script))
        .route(super::bridge::HAS_API_KEY_PATH, get(has_api_key))
        .route(super::bridge::OPEN_PATH, post(open_link))
        .route(&format!("{SHELL_PREFIX}/"), get(shell_page))
        .route(&format!("{SHELL_PREFIX}/{{*path}}"), get(shell_page))
        // The kernel's API, as one route: `GET` is a downlink socket, anything else is
        // a unary Connection RPC call.
        .route("/api/{*endpoint}", any(forward_api))
        // The software-facing interconnect prefix, re-originated exactly like /api: the kernel
        // registers /link/v1/* (plugins/dsh-link-interconnect) behind the same signed-cookie gate
        // every other route sits behind, and a software peer is not a browser, so the shell carries
        // the credential. Registered ahead of the static catch-alls on purpose: /link is a protocol
        // prefix, never a client asset.
        .route(&format!("{LINK_PREFIX}/{{*path}}"), any(forward_link))
        // Everything else is the official client: its index, its bundles, its fonts.
        .route("/", any(forward_static))
        .route("/{*path}", any(forward_static))
        .layer(axum::middleware::from_fn(cors))
        // The readiness gate is given its own copy of the state, because a layer added
        // before `with_state` runs outside the router's state extractor and would not
        // be able to see it.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            reject_if_unauthenticated,
        ))
        .with_state(state)
}

/// The right column's browser panel: one path, many ops (contract R178-B section 2).
///
/// The official client (and the plugin whose pane this is) owns tab identity, the divider and WHICH
/// rect the browser fills; the shell owns the native windows, the parking geometry, the tab cap and the
/// two page-viewport modes (see [`super::sidebar_panel`]). Geometry arrives from the page because
/// `auto_resize` only scales proportionally.
///
/// The pre-R178 names are still accepted and mean the same thing as their replacements: `open` =
/// `mount`, `close` = `unmount`, `set-bounds` = `surface`. There is one implementation behind each pair.
async fn sidebar_panel(State(state): State<ProxyState>, headers: HeaderMap, body: Bytes) -> Response {
    let request: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return json(
                StatusCode::BAD_REQUEST,
                &format!(
                    r#"{{"error":{}}}"#,
                    json_string(&format!("body is not JSON: {error}"))
                ),
            );
        }
    };
    let op = request.get("op").and_then(|value| value.as_str()).unwrap_or("");
    let number = |key: &str| request.get(key).and_then(|value| value.as_f64());
    // Two ops have an answer of their own, so they need somewhere to put it: the lease answers with the
    // lease, a protocol call answers with the protocol's JSON. Every other op answers with the panel's
    // report alone.
    let mut lease_answer: Option<String> = None;
    let mut cdp_answer: Option<String> = None;
    // The id of a tab this request created. A caller cannot name what it was never told.
    let mut tab_answer: Option<String> = None;
    let outcome = match op {
        // Read-only: the whole state, in the reply every op already carries.
        "state" => Ok(()),
        // The browser host (R178-G).
        "surface" => match (number("x"), number("y"), number("w"), number("h")) {
            (Some(x), Some(y), Some(w), Some(h)) => {
                sidebar_panel::surface(&state.app, x, y, w, h, panel_holder(&request, &headers))
            }
            _ => Err("surface needs numeric x, y, w and h".to_string()),
        },
        "mount" => sidebar_panel::mount(&state.app, text_of(&request, "url"), panel_holder(&request, &headers)),
        "unmount" => sidebar_panel::unmount(&state.app, panel_holder(&request, &headers)),
        "tab-new" => match sidebar_panel::tab_new(&state.app, text_of(&request, "url"), panel_holder(&request, &headers)) {
            Ok(id) => {
                tab_answer = Some(id);
                Ok(())
            }
            Err(error) => Err(error),
        },
        "tab-close" => match request.get("id").and_then(|value| value.as_str()) {
            Some(id) => sidebar_panel::tab_close(&state.app, id, panel_holder(&request, &headers)),
            None => Err("tab-close needs the id of the tab to close".to_string()),
        },
        "tab-activate" => match request.get("id").and_then(|value| value.as_str()) {
            Some(id) => sidebar_panel::tab_activate(&state.app, id, panel_holder(&request, &headers)),
            None => Err("tab-activate needs the id of the tab to activate".to_string()),
        },
        "tab-goto" => match (request.get("id").and_then(|value| value.as_str()), request.get("url").and_then(|value| value.as_str())) {
            (Some(id), Some(url)) => sidebar_panel::tab_goto(&state.app, id, url, panel_holder(&request, &headers)),
            _ => Err("tab-goto needs an id and a url".to_string()),
        },
        "mode" => match request.get("kind").and_then(|value| value.as_str()) {
            Some(kind) => sidebar_panel::mode(
                &state.app,
                kind,
                request.get("viewport").and_then(viewport_of),
                panel_holder(&request, &headers),
            ),
            None => Err("mode needs a kind: \"fixed\" or \"fit\"".to_string()),
        },
        // R179-A: the page viewport the fixed mode renders at - a named preset or a custom WxH, refused
        // by name otherwise, persisted so the next process starts on it.
        "viewport" => sidebar_panel::set_viewport(
            &state.app,
            request.get("preset").and_then(|value| value.as_str()),
            // R179-A: both spellings of a custom size are accepted. The frozen contract's first
            // spelling is `w`/`h` and the gate's first probe used it; refusing it made a correct
            // implementation look broken to an independent recount (R179-E, finding R3), and a
            // caller who reads the contract should not have to read this file to be right.
            number("width").or_else(|| number("w")),
            number("height").or_else(|| number("h")),
            panel_holder(&request, &headers),
        ),
        "cdp" => {
            let method = request.get("method").and_then(|value| value.as_str()).unwrap_or("");
            let params = request.get("params").map(|value| value.to_string()).unwrap_or_else(|| "{}".to_string());
            let timeout = request.get("timeoutMs").and_then(|value| value.as_u64()).unwrap_or(10000);
            match sidebar_panel::cdp(
                &state.app,
                request.get("tab").and_then(|value| value.as_str()),
                // R178-T: the caller's name, so a turn the user took away is refused by name here too.
                panel_holder(&request, &headers),
                method,
                &params,
                std::time::Duration::from_millis(timeout),
            ) {
                Ok(result) => {
                    cdp_answer = Some(result);
                    Ok(())
                }
                Err(error) => Err(error),
            }
        }
        // The pre-R178 names, as aliases of the ops above (never a second semantics).
        "open" => sidebar_panel::open(
            &state.app,
            request.get("url").and_then(|value| value.as_str()).unwrap_or(""),
            panel_holder(&request, &headers),
        ),
        "close" => sidebar_panel::close(&state.app, panel_holder(&request, &headers)),
        // The lease: whose turn it is to drive the panel. Four live gates share one panel object, and R151
        // measured what happens without this - whichever gate ran second failed, in different directions on
        // different runs, while each gate passed alone.
        "lease" => match sidebar_panel::lease(
            request.get("leaseOp").and_then(|value| value.as_str()).unwrap_or("status"),
            request.get("holder").and_then(|value| value.as_str()).unwrap_or(""),
            request.get("ttlMs").and_then(|value| value.as_u64()).unwrap_or(30000),
        ) {
            Ok(json) => {
                lease_answer = Some(json);
                Ok(())
            }
            Err(error) => Err(error),
        },
        // The panel's own document reporting in. It arrives from whatever site the panel loaded, so it is
        // read as data and stored; the shell never acts on it.
        "report" => {
            let page = report_page(&state, &headers);
            // R410: a report is logged as it arrives. For five rounds the shell could not answer "did the chrome page ever
            // send one?" - op=state.content is last-write-wins against the beacon, and the panel's webviews keep their own
            // WebView2 data directory so a client-side channel cannot exist. One line here settles it.
            {
                let text = String::from_utf8_lossy(&body);
                let preview: String = text.chars().take(96).collect();
                eprintln!("[panel-report] page={:?} bytes={} body={}", page, body.len(), preview);
            }
            sidebar_panel::note_report(&String::from_utf8_lossy(&body), page);
            Ok(())
        }
        "focus" => sidebar_panel::focus(&state.app),
        "set-bounds" => match (number("x"), number("y"), number("w"), number("h")) {
            (Some(x), Some(y), Some(w), Some(h)) => sidebar_panel::set_bounds(&state.app, x, y, w, h, panel_holder(&request, &headers)),
            _ => Err("set-bounds needs numeric x, y, w and h".to_string()),
        },
        other => Err(format!("unknown panel op {other:?}")),
    };
    match outcome {
        Ok(()) => match (lease_answer, cdp_answer, tab_answer) {
            (Some(lease), _, _) => json(
                StatusCode::OK,
                &format!(r#"{{"lease":{},"state":{}}}"#, lease, sidebar_panel::report(&state.app)),
            ),
            // A protocol call brings back an answer of its own, so it is the one op that does not reply
            // with the flat panel report: the protocol's JSON under `cdp`, and the state under `state`.
            (None, Some(result), _) => json(
                StatusCode::OK,
                &format!(
                    r#"{{"ok":true,"cdp":{},"state":{}}}"#,
                    json_string(&result),
                    sidebar_panel::report(&state.app)
                ),
            ),
            // A created tab has an identity of its own, so op=tab-new answers with it as well.
            (None, None, Some(id)) => json(
                StatusCode::OK,
                &format!(
                    r#"{{"ok":true,"tab":{},"state":{}}}"#,
                    json_string(&id),
                    sidebar_panel::report(&state.app)
                ),
            ),
            (None, None, None) => json(StatusCode::OK, &sidebar_panel::report(&state.app)),
        },
        Err(error) => json(
            StatusCode::BAD_REQUEST,
            &format!(
                r#"{{"error":{},"state":{}}}"#,
                json_string(&error),
                sidebar_panel::report(&state.app)
            ),
        ),
    }
}

/// The name a panel request is made under, once the shell's own documents are accounted for.
///
/// R178-T needs to tell the user's side of the panel from an outside agent, and the two differ in exactly one
/// observable way: the shell's own documents (the chrome page, and the page host the client carries) post from
/// a document, so their request carries that document as the referer; an outside script's does not. A request
/// from our own origin with no holder of its own is therefore the user's voice, and it is named here - one
/// place, so the op arms below stay a wire.
fn panel_holder<'a>(request: &'a serde_json::Value, headers: &HeaderMap) -> Option<&'a str> {
    holder_of(request).or_else(|| {
        if is_chrome_page(headers) {
            // R179-A: the shell's OWN browser page (the bar with its tabs, its mode and its resolution
            // control). Its writes are the user's hand, and the sidebar panel acts on them accordingly.
            Some(sidebar_panel::USER_SHELL_HOLDER)
        } else if is_own_page(headers) {
            Some(sidebar_panel::USER_PAGE_HOLDER)
        } else {
            None
        }
    })
}

/// Is this request coming from one of the shell's own documents?
fn is_own_page(headers: &HeaderMap) -> bool {
    referer(headers).map(|value| value.starts_with(crate::SELF_ORIGIN)).unwrap_or(false)
}

/// Is this request coming from the shell's browser page itself (BROWSER_UI_PATH)?
///
/// The distinction is not cosmetic: BOTH our own documents post from our origin with no holder - the
/// browser page when the user clicks a control, and the page host (core/panel_host.js, inside the client's
/// document) when its 400 ms loop re-measures the right column. Only the first is a user input; treating the
/// second as one would revoke a lease every few hundred milliseconds.
fn is_chrome_page(headers: &HeaderMap) -> bool {
    referer(headers)
        .and_then(|value| value.strip_prefix(crate::SELF_ORIGIN).map(|rest| rest.to_string()))
        .map(|rest| rest.starts_with(sidebar_panel::BROWSER_UI_PATH))
        .unwrap_or(false)
}

/// The document a request says it came from, if it says.
fn referer(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::REFERER).and_then(|value| value.to_str().ok())
}

/// The holder name a panel write carries, if any.
///
/// R166 made the lease ENFORCED rather than published: a write from somebody else while a lease is held
/// is refused by name, and it is read at the moment of the write.
fn holder_of(request: &serde_json::Value) -> Option<&str> {
    request.get("holder").and_then(|value| value.as_str())
}

/// One string field of a panel request, with the empty string for "not sent" - which every op that
/// accepts a URL already treats as "use the shell's start page".
fn text_of<'a>(request: &'a serde_json::Value, key: &str) -> &'a str {
    request.get(key).and_then(|value| value.as_str()).unwrap_or("")
}

/// A mode request's page viewport, if it named one.
fn viewport_of(value: &serde_json::Value) -> Option<(f64, f64)> {
    let w = value.get("w").and_then(|value| value.as_f64())?;
    let h = value.get("h").and_then(|value| value.as_f64())?;
    Some((w, h))
}

/// The document a report came from, as the report is stamped with it.
///
/// R178-G: a browser has more than one page, so "the page on screen" can no longer be read off the one
/// panel label. The reporter's own request says which document sent it (`Referer`), and that is used
/// first: a report from a HIDDEN tab is then stamped with the hidden document and never presented as the
/// page the user is looking at. Without a referer - the beacon from a page that suppressed it - the
/// active tab's own URL is the fallback, which is what the pre-R178 code did with its single label.
fn report_page(state: &ProxyState, headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::REFERER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.starts_with("http"))
        .map(|value| value.to_string())
        .or_else(|| sidebar_panel::live_url(&state.app))
}

/// Report whether the shell holds kernel credentials.
async fn session_ready(State(state): State<ProxyState>) -> Response {
    match state.credentials.get() {
        Some(credentials) => json(
            StatusCode::OK,
            &format!(
                r#"{{"ready":true,"base":{}}}"#,
                json_string(&credentials.base)
            ),
        ),
        None => json(
            StatusCode::SERVICE_UNAVAILABLE,
            r#"{"ready":false,"base":""}"#,
        ),
    }
}

/// Report the kernel's phase, pid, and paths, as the boot page shows them.
async fn kernel_status(State(state): State<ProxyState>) -> Response {
    let status = state.supervisor.status();
    match serde_json::to_string(&status) {
        Ok(body) => json(StatusCode::OK, &body),
        Err(error) => internal(&format!("encode kernel status: {error}")),
    }
}

/// `POST /__shell/window` - the windows of THIS running instance, and the way to open another one.
///
/// A second window is not a second instance: it loads the shell's own origin, so the same proxy, kernel, plugin rows and
/// session storage back it. Body: `{"op":"open"}`, `{"op":"list"}`, or `{"op":"close","label":"window-2"}`. The main
/// window's label is refused for close, because the tray's show/hide and the panel host address that one.
async fn window_op(State(state): State<ProxyState>, body: Bytes) -> Response {
    let request: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let op = request.get("op").and_then(|value| value.as_str()).unwrap_or("list");
    let answer = match op {
        "open" => match crate::open_extra_window(&state.app) {
            Ok(label) => serde_json::json!({ "ok": true, "opened": label, "windows": crate::window_labels(&state.app) }),
            Err(why) => serde_json::json!({ "ok": false, "error": why, "windows": crate::window_labels(&state.app) }),
        },
        "list" => serde_json::json!({ "ok": true, "windows": crate::window_labels(&state.app) }),
        "close" => {
            let label = request.get("label").and_then(|value| value.as_str()).unwrap_or("");
            if label.is_empty() {
                serde_json::json!({ "ok": false, "error": "label must name the window to close" })
            } else if label == crate::embed::window_label() {
                serde_json::json!({ "ok": false, "error": "the main window is the tray's to show and hide, so this route does not close it" })
            } else {
                match state.app.get_webview_window(label) {
                    Some(window) => match window.close() {
                        Ok(()) => serde_json::json!({ "ok": true, "closed": label, "windows": crate::window_labels(&state.app) }),
                        Err(error) => serde_json::json!({ "ok": false, "error": format!("close {label}: {error}") }),
                    },
                    None => serde_json::json!({ "ok": false, "error": format!("no window is labelled {label}") }),
                }
            }
        }
        other => serde_json::json!({ "ok": false, "error": format!("unknown op {other:?}; use open, list or close") }),
    };
    match serde_json::to_string(&answer) {
        Ok(text) => json(StatusCode::OK, &text),
        Err(error) => internal(&format!("encode window answer: {error}")),
    }
}

/// What the phone's bridge end says about itself, as the boot page shows it.
/// `GET /__shell/ofm` - what this machine offers as far as the OFM desktop app goes (see core::ofm).
async fn ofm_presence() -> Response {
    let presence = super::ofm::detect();
    match serde_json::to_string(&presence) {
        Ok(body) => json(StatusCode::OK, &body),
        Err(error) => internal(&format!("encode ofm presence: {error}")),
    }
}

/// `POST /__shell/ofm/join` - verify OFM, use its key once, and store where it lives.
async fn ofm_join(State(state): State<ProxyState>) -> Response {
    let root = match state.app.path().app_config_dir() {
        Ok(dir) => dir.join("dsh-link"),
        Err(error) => return internal(&format!("resolve app config dir: {error}")),
    };
    let joined = super::ofm::join(&root);
    match serde_json::to_string(&joined) {
        // A refusal is still an ANSWER here (the user asked, the machine said why), so it carries 200 and ok:false rather
        // than pretending the request itself was malformed.
        Ok(body) => json(StatusCode::OK, &body),
        Err(error) => internal(&format!("encode ofm join: {error}")),
    }
}

async fn device_bridge_status() -> Response {
    json(StatusCode::OK, &super::device_bridge::status_json())
}

/// The shell's boot and recovery page, stamped with the window preferences.
///
/// The stamping is what makes the page follow the *application's* palette rather than
/// the operating system's: the first paint is already the colour the client's own theme
/// toggle last chose, with no flash of the other one and no request of its own.
async fn shell_page(State(state): State<ProxyState>) -> Response {
    let prefs = state
        .app
        .try_state::<ShellWindow>()
        .map(|shell| shell.get())
        .unwrap_or_else(super::shellprefs::ShellPrefs::from_system);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        super::shellpage::render(&prefs),
    )
        .into_response()
}

/// The window preferences in force, as the frame and the boot page see them.
async fn window_preferences(State(state): State<ProxyState>) -> Response {
    match state.app.try_state::<ShellWindow>() {
        Some(shell) => json(StatusCode::OK, &shell.wire()),
        None => internal("the window preferences are not set up"),
    }
}

/// Change the window preferences: clamp, apply to the live window, persist.
///
/// Either key may be sent alone; an unknown palette or a non-numeric radius is refused
/// rather than guessed at, because this is the one endpoint that decides how the window
/// looks. The reply echoes what is now in force — including a radius that was clamped
/// to the 0..28 range — so a caller never has to assume its request was taken literally.
async fn set_window_preferences(State(state): State<ProxyState>, body: Bytes) -> Response {
    let Some(shell) = state.app.try_state::<ShellWindow>() else {
        return internal("the window preferences are not set up");
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return refuse_preferences("the body is not JSON");
    };
    let radius = match value.get("radius") {
        None | Some(serde_json::Value::Null) => None,
        Some(number) => match number.as_f64() {
            Some(radius) if radius.is_finite() => Some(radius),
            _ => return refuse_preferences("radius must be a finite number of CSS pixels"),
        },
    };
    // The gap is the one field the contract gives a fallback instead of an error: a
    // missing or unusable value is the default, never a refusal, so a settings file with
    // a typo cannot leave the client flush against the window's edge.
    let gap = match value.get("gap") {
        None | Some(serde_json::Value::Null) => None,
        Some(number) => Some(number.as_f64().map_or(
            super::shellprefs::GAP_DEFAULT,
            ShellPrefs::gap_or_default,
        )),
    };
    let palette = match value.get("palette") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(text)) => match Palette::parse(text) {
            Some(palette) => Some(palette),
            None => return refuse_preferences("palette must be light or dark"),
        },
        _ => return refuse_preferences("palette must be light or dark"),
    };
    if radius.is_none() && gap.is_none() && palette.is_none() {
        return refuse_preferences("none of radius, gap or palette was given");
    }
    match shell.update(&state.app, radius, gap, palette) {
        Ok(live) => {
            eprintln!(
                "[shell] window preferences applied: radius={}px gap={}px palette={}",
                live.radius(),
                live.gap(),
                live.palette().as_str()
            );
            json(StatusCode::OK, &shell.wire())
        }
        Err(why) => internal(&format!("applied, but could not persist: {why}")),
    }
}

/// A refused preference change, with a readable reason and no echo of the body.
fn refuse_preferences(why: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("dsh-link: refused a window preference ({why})\n"),
    )
        .into_response()
}

/// The self-drawn frame's stylesheet.
async fn frame_css() -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/css; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        super::frame::FRAME_CSS,
    )
        .into_response()
}

/// The self-drawn frame's script.
async fn frame_script() -> Response {
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        super::frame::FRAME_JS,
    )
        .into_response()
}

/// The panel's report arriving as a beacon: an image load carries its data in the query string, which is
/// the one page-side channel that triggers neither a preflight nor a CORS check.
async fn sidebar_panel_cdp(State(state): State<ProxyState>, body: Bytes) -> Response {
    let request: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return json(
                StatusCode::BAD_REQUEST,
                &format!(r#"{{"error":{}}}"#, json_string(&format!("body is not JSON: {error}"))),
            );
        }
    };
    let method = request.get("method").and_then(|value| value.as_str()).unwrap_or("");
    if method.is_empty() {
        return json(StatusCode::BAD_REQUEST, r#"{"error":"a cdp call needs a method"}"#);
    }
    let params = request
        .get("params")
        .map(|value| value.to_string())
        .unwrap_or_else(|| "{}".to_string());
    let timeout = request.get("timeoutMs").and_then(|value| value.as_u64()).unwrap_or(10000);
    // R178-G: one implementation for the protocol, addressed by window. The legacy route keeps answering
    // for whoever used it, and it follows the ACTIVE tab exactly like op=cdp does (a `tab` field, or the
    // string "chrome", selects another window); the shell's own WebView2 callback lives in sidebar_panel.
    match super::sidebar_panel::cdp(
        &state.app,
        request.get("tab").and_then(|value| value.as_str()),
        request.get("holder").and_then(|value| value.as_str()),
        method,
        &params,
        std::time::Duration::from_millis(timeout),
    ) {
        Ok(result) => json(
            StatusCode::OK,
            &format!(r#"{{"ok":true,"method":{},"result":{}}}"#, json_string(method), json_string(&result)),
        ),
        Err(error) => json(
            StatusCode::BAD_GATEWAY,
            &format!(r#"{{"ok":false,"method":{},"error":{}}}"#, json_string(method), json_string(&error)),
        ),
    }
}

async fn sidebar_panel_report_beacon(state: State<ProxyState>, headers: HeaderMap, uri: axum::http::Uri) -> Response {
    // R178-T: a user-input beacon is NOT a page report - it is the signal that the user took the browser
    // back. It is acted on here (the shell revokes the lease by name) and it is deliberately not stored as
    // content: a click would otherwise overwrite the report of the page that is on screen.
    let query = uri.query().unwrap_or("");
    match sidebar_panel::user_input_of(query) {
        Some(kind) => sidebar_panel::note_user_input(&kind),
        None => sidebar_panel::note_report_query(query, report_page(&state, &headers)),
    }
    // One transparent pixel: the reply only has to be a successful image load.
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "image/gif")],
        vec![0x47u8, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
             0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
             0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b],
    )
        .into_response()
}

/// One report from the panel's own document. Stored as data; the shell never acts on it.
async fn sidebar_panel_report(state: State<ProxyState>, headers: HeaderMap, body: Bytes) -> Response {
    // Stamped with the document the report actually came from, so a report that arrives late (or from a
    // hidden tab, or from a document the panel has already left) can never be presented as the page the
    // user is looking at.
    let page = report_page(&state, &headers);
    sidebar_panel::note_report(&String::from_utf8_lossy(&body), page);
    json(StatusCode::OK, r#"{"ok":true}"#)
}

/// The panel host script the shell injects into the client's document.
async fn panel_host_script() -> Response {
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        super::sidebar_panel::PANEL_HOST_SCRIPT,
    )
        .into_response()
}

/// The bridge script the shell injects into the client's document.
async fn bridge_script() -> Response {
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                "application/javascript; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        super::bridge::BRIDGE_SCRIPT,
    )
        .into_response()
}

/// Answer whether a model credential is configured, as the official onboarding asks.
async fn has_api_key(State(state): State<ProxyState>) -> Response {
    let configured = super::bridge::api_key_configured(&state.home);
    json(
        StatusCode::OK,
        if configured { "true" } else { "false" },
    )
}

/// Open an external link in the system browser on the page's behalf.
///
/// The page cannot do this itself: the navigation fence keeps the window on the proxy
/// origin, and `window.open` has no shell behind it. This is the click path, and only the
/// click path — nothing calls it on its own, which is what keeps a link the shell merely
/// learns about from taking over the desktop. Only http(s) passes, so a page cannot ask
/// the shell to launch an arbitrary handler.
async fn open_link(State(state): State<ProxyState>, body: Bytes) -> Response {
    let requested = serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("url").and_then(|url| url.as_str()).map(str::to_owned));
    let Some(url) = requested else {
        return refuse_open("no url");
    };
    let lowered = url.to_ascii_lowercase();
    if !(lowered.starts_with("http://") || lowered.starts_with("https://")) || url.len() > 4096 {
        return refuse_open("not an http(s) link");
    }
    eprintln!("[shell] page asked to open {url}");
    crate::open_url(&state.app, &url);
    StatusCode::NO_CONTENT.into_response()
}

/// Reject an open request without echoing what was sent.
fn refuse_open(why: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("dsh-link: refused to open a link ({why})\n"),
    )
        .into_response()
}

/// Answer preflight requests and no others.
///
/// The window and everything it loads share this origin, so no cross-origin allowance
/// is granted at all: an unlisted `Origin` gets no CORS headers, and a request that
/// carries one is refused outright rather than answered unreadable.
async fn cors(request: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    // The interconnect prefix is the one surface a FOREIGN origin may address, and it must be able
    // to: the embed page is loaded inside a software vendor's iframe, so its navigation request
    // carries that vendor's Origin, and the embed route validates the audience itself (token aud).
    // It bypasses this refusal entirely and receives no CORS headers: the vendor's JavaScript can
    // frame the page, never read it. Every other path keeps the same-origin-only rule.
    if request.uri().path().starts_with(LINK_PREFIX) {
        return next.run(request).await;
    }

    if let Some(origin) = origin.as_deref() {
        if origin != crate::SELF_ORIGIN {
            return (
                StatusCode::FORBIDDEN,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                "dsh-link: cross-origin requests are not served\n",
            )
                .into_response();
        }
    }

    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };

    let Some(origin) = origin else {
        return response;
    };
    let headers = response.headers_mut();
    if let Ok(value) = HeaderValue::from_str(&origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, PUT, OPTIONS"),
    );
    response
}

/// Serve the shell's own page while the kernel has no session.
///
/// Without this the window would get the kernel's `401`, which looks like a broken
/// install rather than a kernel that has not finished booting.
async fn reject_if_unauthenticated(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    // Every route passes through here, so this is the cheapest place to observe
    // that the window is still issuing requests at all.
    state.liveness.touch_request();
    if state.credentials.get().is_none() && !request.uri().path().starts_with(SHELL_PREFIX) {
        if request.uri().path() == "/" {
            return shell_page(State(state)).await;
        }
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
            r#"{"error":"kernel is not ready"}"#,
        )
            .into_response();
    }
    next.run(request).await
}

/// Route one `/api` request to the right upstream shape.
///
/// The kernel exposes two different things under the same prefix: unary Connection
/// RPC calls, which are ordinary request/response, and the event and Remote sockets,
/// which are WebSocket upgrades. Axum keys routes by path rather than by method, so
/// one catch-all handler has to tell them apart itself. The `Upgrade` header is the
/// discriminator the kernel itself uses, and it is the only reliable one — the socket
/// paths and the RPC endpoints share a naming style, not a namespace.
///
/// # Arguments
///
/// * `state` - the credential store.
/// * `method` - the client's method.
/// * `endpoint` - the path after `/api/`.
/// * `headers` - the client's headers, inspected for the upgrade request.
/// * `upgrade` - present only when the client asked for a WebSocket.
/// * `body` - the client's request body, forwarded unchanged on the unary path.
async fn forward_api(State(state): State<ProxyState>, request: axum::extract::Request) -> Response {
    let (mut parts, body) = request.into_parts();
    // The endpoint path is rebuilt rather than read off the URI so that a `?` inside
    // it survives; the client bundle URLs use one as a path separator.
    let mut endpoint = parts.uri.path().trim_start_matches("/api/").to_owned();
    if let Some(query) = parts.uri.query() {
        endpoint.push('?');
        endpoint.push_str(query);
    }

    let upgrading = parts
        .headers
        .get(header::UPGRADE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.eq_ignore_ascii_case("websocket"));

    if upgrading {
        // Building the upgrade by hand, rather than as an extractor, is what lets the
        // unary path below read the body: an extractor would have to be ordered before
        // it, and the two are mutually exclusive.
        match WebSocketUpgrade::from_request_parts(&mut parts, &()).await {
            Ok(upgrade) => return relay_websocket(state, upgrade, &endpoint).await,
            Err(rejection) => return rejection.into_response(),
        }
    }

    let method = parts.method.clone();
    let headers = parts.headers.clone();
    let bytes = match axum::body::to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(error) => return internal(&format!("read request body: {error}")),
    };
    forward_unary(state, method, "/api", &endpoint, &headers, bytes).await
}

/// Forward one /link/* request to the kernel.
///
/// The interconnect protocol is ordinary HTTP: JSON in, JSON (or an SSE stream) out. What makes it
/// different from /api is only who calls it - external software instead of the official client -
/// and that software has no session cookie. So this handler is deliberately the same shape as
/// [forward_api]: rebuild the channel-relative path (query preserved), read the body up to
/// [MAX_BODY_BYTES], forward method/body/content type, and stream the reply through [relay_body].
/// The latter is what keeps GET /link/v1/events an actual SSE stream rather than a reply that only
/// arrives once the socket closes.
///
/// The upstream path is {base}/link/{path}. Unlike /api, a link peer's own credential IS part of
/// the protocol (the Bearer token its handshake minted), so an allowlist of request headers travels
/// upstream - authorization, accept, content-type, idempotency-key, dsh-link-client - and the reply
/// carries allow/cache-control in addition to content-type: a 405 without its Allow header, or a
/// JSON error without its content type, is a protocol answer the peer cannot read.
async fn forward_link(
    State(state): State<ProxyState>,
    request: axum::extract::Request,
) -> Response {
    let (parts, body) = request.into_parts();
    // Rebuilt rather than read off the URI, for the same reason as forward_api: a percent-encoded
    // or literal '?' inside the path must survive as a path character. The query is appended apart.
    let path = parts
        .uri
        .path()
        .strip_prefix(LINK_PREFIX)
        .unwrap_or(parts.uri.path());
    let mut endpoint = path.trim_start_matches('/').to_owned();
    if let Some(query) = parts.uri.query() {
        endpoint.push('?');
        endpoint.push_str(query);
    }

    let method = parts.method.clone();
    let headers = parts.headers.clone();
    let bytes = match axum::body::to_bytes(body, MAX_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(error) => return internal(&format!("read request body: {error}")),
    };

    let Some(credentials) = state.credentials.get() else {
        return unavailable("kernel is not ready");
    };
    let Ok(url) = reqwest::Url::parse(&format!("{}/link/{endpoint}", credentials.base)) else {
        return internal("kernel base is not a valid URL");
    };
    let Some(client) = build_client() else {
        return internal("could not build the upstream client");
    };

    // The protocol's own request headers travel upstream; everything else stops here (the
    // peer's user agent, tracing headers and cookies are not facts the kernel route needs).
    const FORWARDED: [&str; 8] = [
        "authorization",
        "accept",
        "content-type",
        "idempotency-key",
        "dsh-link-client",
        // The embed audience check reads Origin; anthropic-shaped calls carry their own version header.
        "origin",
        "anthropic-version",
        "x-api-key",
    ];
    let mut outgoing = client.request(method, url).header(header::COOKIE, &credentials.cookie);
    for name in FORWARDED {
        if let Some(value) = headers.get(name) {
            outgoing = outgoing.header(name, value.clone());
        }
    }
    if !bytes.is_empty() {
        outgoing = outgoing.body(bytes.to_vec());
    }

    let upstream = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => return internal(&format!("upstream link request failed: {error}")),
    };
    relay_link_body(upstream).await
}

/// Forward one unary RPC call upstream with the session cookie attached.
///
/// # Arguments
///
/// * `state` - the credential store.
/// * `method` - the client's method, used verbatim upstream.
/// * `prefix` - the upstream prefix the endpoint hangs off: /api for the official client,
///   /link for the interconnect protocol.
/// * `endpoint` - the channel-relative endpoint path.
/// * `headers` - the client's headers; only content negotiation is honoured.
/// * `body` - the client's request body, forwarded unchanged.
async fn forward_unary(
    state: ProxyState,
    method: Method,
    prefix: &str,
    endpoint: &str,
    headers: &HeaderMap,
    body: Bytes,
) -> Response {
    let Some(credentials) = state.credentials.get() else {
        return unavailable("kernel is not ready");
    };

    let Ok(url) = reqwest::Url::parse(&format!("{}{prefix}/{endpoint}", credentials.base)) else {
        return internal("kernel base is not a valid URL");
    };
    let Some(client) = build_client() else {
        return internal("could not build the upstream client");
    };

    // Rebuild the request with only what the endpoint contract needs: the body, the
    // content type, and the session cookie. Forwarding the client's own headers would
    // leak shell internals upstream and cannot help, because the cookie is the only
    // credential in play.
    let mut outgoing = client.request(method, url).header(header::COOKIE, &credentials.cookie);
    if let Some(content_type) = headers.get(header::CONTENT_TYPE) {
        outgoing = outgoing.header(header::CONTENT_TYPE, content_type.clone());
    }
    if !body.is_empty() {
        outgoing = outgoing.body(body.to_vec());
    }

    let upstream = match outgoing.send().await {
        Ok(response) => response,
        Err(error) => return internal(&format!("upstream request failed: {error}")),
    };
    relay_body(upstream).await
}

/// Forward one static resource — including the injected index — unchanged.
///
/// The index HTML is the important case: the host writes the `window.__DSH_BOOT__`
/// module manifest into it, so anything that rewrites it would leave the official
/// client with nothing to boot from.
async fn forward_static(
    State(state): State<ProxyState>,
    method: Method,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    let Some(credentials) = state.credentials.get() else {
        return unavailable("kernel is not ready");
    };

    // `set_path` percent-encodes `?`, so the query has to be set separately. The client
    // bundle URLs make this load-bearing rather than academic: they are
    // `plugins/??@deepseek-ai/dsh-client-<name>/client.js&rev=<hash>`, where the `??` is
    // part of the path and the `rev` is the query. Folding them together turns the
    // `??` into `%3F%3F` and the kernel answers 404 for a bundle it does serve.
    let url = match reqwest::Url::parse(&credentials.base) {
        Ok(mut base) => {
            base.set_path(uri.path());
            base.set_query(uri.query());
            base
        }
        Err(_) => return internal("kernel base is not a valid URL"),
    };
    let Some(client) = build_client() else {
        return internal("could not build the upstream client");
    };

    // `Accept` matters: the kernel serves the injected index only for a document
    // request, and negotiates HTML against a bare `*/*`.
    let accept = headers
        .get(header::ACCEPT)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("text/html,application/xhtml+xml,*/*"));

    // The root document is the one reply that is not forwarded as-is: the shell's
    // bridge is added to it. Every other reply streams through untouched, which keeps
    // bundles and attachments off this task's heap.
    let is_document = matches!(uri.path(), "/" | "/index.html");

    let upstream = match client
        .request(method, url)
        .header(header::ACCEPT, accept)
        .header(header::COOKIE, &credentials.cookie)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => return internal(&format!("upstream asset request failed: {error}")),
    };
    if is_document {
        return inject_bridge(upstream).await;
    }
    relay_body(upstream).await
}

/// Serve the official client's index with the shell bridge added.
///
/// The kernel's bytes are forwarded unchanged — the host writes the
/// `window.__DSH_BOOT__` module manifest into this document, and the client has
/// nothing to boot from without it — so the bridge is one extra same-origin script
/// tag before `</head>`. A document with no head still gets the tag rather than
/// silently losing it, because the bridges it installs are what the Desktop-only
/// surfaces read.
/// R178-G: the shell's own browser chrome page - the tab strip, the address readout and the mode switch.
///
/// It is served from OUR origin on purpose. The page drives `/__shell/panel` itself, and the proxy's CORS
/// rule refuses any origin other than `SELF_ORIGIN` outright, so being on the shell's origin is what makes
/// that possible without a second credential being handed to a page.
async fn browser_ui_page() -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        super::sidebar_panel::BROWSER_UI_HTML,
    )
        .into_response()
}

/// R169: the panel's start page. Local, same-origin, no network call - the panel's reporter is an initialization
/// script, so it reports this document exactly as it reports any other.
async fn panel_start() -> Response {
    let html = r#"<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>侧边栏浏览器</title>
<style>
  html, body { margin: 0; height: 100%; background: #14161a; color: #e6e8ea;
    font: 14px/1.6 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }
  main { display: flex; flex-direction: column; justify-content: center; gap: 14px; padding: 28px; height: 100%; box-sizing: border-box; }
  h1 { font-size: 15px; font-weight: 600; margin: 0; color: #cfd3d7; }
  p { margin: 0; color: #8b929a; font-size: 12px; }
  form { display: flex; gap: 8px; }
  input { flex: 1; padding: 9px 11px; border-radius: 8px; border: 1px solid #2c3138; background: #1b1f24; color: #e6e8ea; outline: none; }
  input:focus { border-color: #3d6ea8; }
  button { padding: 9px 14px; border-radius: 8px; border: 0; background: #2f6fbf; color: #fff; cursor: pointer; }
</style></head>
<body><main>
  <h1>侧边栏浏览器</h1>
  <p>输入网址后回车。这个面板是一个独立的 WebView，登录状态保存在它自己的目录里。</p>
  <form id="go"><input id="url" placeholder="https://example.com" autocomplete="off" autofocus><button>打开</button></form>
  <p>AI 也可以直接驱动这个面板（进程内 CDP），不需要在这里输入。</p>
</main>
<script>
  document.getElementById('go').addEventListener('submit', function (event) {
    event.preventDefault()
    var value = document.getElementById('url').value.trim()
    if (value === '') { return }
    if (/^[a-z]+:\/\//i.test(value) === false) { value = 'https://' + value }
    location.href = value
  })
</script></body></html>"#;
    (StatusCode::OK, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

async fn inject_bridge(upstream: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .cloned()
        .unwrap_or_else(|| HeaderValue::from_static("text/html; charset=utf-8"));
    let body = match upstream.text().await {
        Ok(body) => body,
        Err(error) => return internal(&format!("read the kernel index: {error}")),
    };
    // Not deferred: the client's own bundles are module scripts, which run after the
    // document is parsed, but its inline boot script runs during parsing. A blocking
    // tag at the end of the head removes every ordering question about whether the
    // bridge exists by the time a plugin's apply() asks for it. The frame goes in
    // first for the same reason — its stylesheet has to be in force before the client
    // paints, or the first frame is a square window with a rounded one inside it.
    let bridge = format!("<script src=\"{}\" ></script>", super::bridge::BRIDGE_PATH);
    let tag = format!(
        "{}{}{}",
        super::frame::FRAME_TAG,
        super::sidebar_panel::PANEL_HOST_TAG,
        bridge
    );
    // Lowercasing is byte-for-byte length preserving, so an offset found in the copy
    // indexes the original safely even with multi-byte characters in the document.
    let lowered = body.to_ascii_lowercase();
    let html = match lowered.find("</head>") {
        Some(at) => format!("{}{}{}", &body[..at], tag, &body[at..]),
        None => format!("{body}{tag}"),
    };
    (status, [(header::CONTENT_TYPE, content_type)], html).into_response()
}

/// Bridge one client WebSocket to the kernel's, presenting the cookie upstream.
///
/// # Arguments
///
/// * `state` - the credential store.
/// * `upgrade` - the client's upgrade request.
/// * `path` - the kernel socket path, e.g. `events.host` or `remote.mux`.
async fn relay_websocket(state: ProxyState, upgrade: WebSocketUpgrade, path: &str) -> Response {
    let Some(credentials) = state.credentials.get() else {
        return unavailable("kernel is not ready");
    };

    let authority = credentials
        .base
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let scheme = if credentials.base.starts_with("https") { "wss" } else { "ws" };
    let socket_url = format!("{scheme}://{authority}/api/{path}");

    let Ok(mut request) =
        tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(socket_url.as_str())
    else {
        return internal("build upstream socket request").into_response();
    };
    // The upgrade handshake is a plain HTTP request, so the cookie rides along in the
    // headers exactly as it would on a unary call.
    if let Ok(value) = HeaderValue::from_str(&credentials.cookie) {
        request
            .headers_mut()
            .insert(HeaderName::from_static("cookie"), value);
    }

    let upstream = match tokio_tungstenite::connect_async(request).await {
        Ok((socket, _)) => socket,
        Err(error) => {
            return internal(&format!("upstream socket failed: {error}")).into_response();
        }
    };

    upgrade.on_upgrade(move |frontend| async move {
        state.liveness.ws_opened();
        relay_sockets(&state, frontend, upstream).await;
        state.liveness.ws_closed();
    })
}

/// Bridge one relayed socket pair until either side ends.
///
/// Each hop answers its own Ping (see the select arms), and the relay also probes
/// silent hops itself. That last part is load-bearing, not hygiene: a peer that
/// vanishes without a TCP close — a phone leaving Wi-Fi, a WebView2 renderer dying
/// mid-frame — produces no FIN/RST, so a plain `pipe` would hang half-open forever
/// and the kernel would keep the session. Each side that stays silent across two
/// unanswered probes tears the pair down, which frees both hops and lets the
/// client's own reconnect logic do its job. The cadence is ported from Deepseek
/// Harness EAC's phone bridge (MIT, see THIRD-PARTY-NOTICES.md), which measured the
/// same failure against a LAN peer.
async fn relay_sockets(
    state: &ProxyState,
    frontend: axum::extract::ws::WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    const HEARTBEAT: Duration = Duration::from_secs(15);
    /// Silence across two unanswered probes means the hop is gone.
    const SILENCE_LIMIT: Duration = Duration::from_secs(45);

    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    let (mut frontend_tx, mut frontend_rx) = frontend.split();
    let mut heartbeat = tokio::time::interval(HEARTBEAT);
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_upstream = Instant::now();
    let mut last_frontend = Instant::now();

    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                if last_upstream.elapsed() > SILENCE_LIMIT || last_frontend.elapsed() > SILENCE_LIMIT {
                    break;
                }
                // Probe a hop that has been quiet since the last tick. The kernel
                // pings every two seconds, so only the browser branch normally fires;
                // browsers answer pings at the protocol level, without page code.
                if last_upstream.elapsed() > HEARTBEAT
                    && upstream_tx.send(UpstreamMessage::Ping(Vec::new())).await.is_err()
                {
                    break;
                }
                if last_frontend.elapsed() > HEARTBEAT
                    && frontend_tx.send(FrontendMessage::Ping(Bytes::new())).await.is_err()
                {
                    break;
                }
            }
            incoming = upstream_rx.next() => match incoming {
                // The kernel's Gateway pings every two seconds and drops a
                // socket that has not answered by the next interval. That Pong
                // is generated here rather than copied from the browser: a relayed Ping would draw a Pong from the browser, whose Pong
                // this layer would relay on, and the two hops would keep each
                // other awake forever.
                Some(Ok(UpstreamMessage::Ping(payload))) => {
                    last_upstream = Instant::now();
                    if upstream_tx.send(UpstreamMessage::Pong(payload)).await.is_err() {
                        break;
                    }
                }
                Some(Ok(UpstreamMessage::Pong(_) | UpstreamMessage::Frame(_))) => {
                    last_upstream = Instant::now();
                }
                Some(Ok(UpstreamMessage::Text(text))) => {
                    last_upstream = Instant::now();
                    state.copy_sign_in_link(text.as_str());
                    let onward: FrontendMessage = text.as_str().into();
                    if frontend_tx.send(onward).await.is_err() {
                        break;
                    }
                }
                Some(Ok(UpstreamMessage::Binary(bytes))) => {
                    last_upstream = Instant::now();
                    // The account stream is not guaranteed to be text, and decoding
                    // every binary frame would cost this hot path for nothing, so a
                    // frame is only decoded when it can hold the marker at all.
                    if super::bridge::may_carry_authorize_url(&bytes) {
                        state.copy_sign_in_link(&String::from_utf8_lossy(&bytes));
                    }
                    let onward = FrontendMessage::Binary(bytes.into());
                    if frontend_tx.send(onward).await.is_err() {
                        break;
                    }
                }
                Some(Ok(UpstreamMessage::Close(_))) | Some(Err(_)) | None => break,
            },
            // The uplink is load-bearing. `remote.mux` carries the client's
            // `ready` frame and its answers to Host-initiated events, so this
            // socket is not downlink-only: dropping what the client sends is
            // what left the interface stuck re-establishing its connection.
            incoming = frontend_rx.next() => match incoming {
                Some(Ok(FrontendMessage::Ping(payload))) => {
                    last_frontend = Instant::now();
                    if frontend_tx.send(FrontendMessage::Pong(payload)).await.is_err() {
                        break;
                    }
                }
                Some(Ok(FrontendMessage::Pong(_))) => {
                    last_frontend = Instant::now();
                }
                Some(Ok(FrontendMessage::Text(text))) => {
                    last_frontend = Instant::now();
                    let onward = UpstreamMessage::text(text.as_str());
                    if upstream_tx.send(onward).await.is_err() {
                        break;
                    }
                }
                Some(Ok(FrontendMessage::Binary(bytes))) => {
                    last_frontend = Instant::now();
                    let onward = UpstreamMessage::binary(bytes);
                    if upstream_tx.send(onward).await.is_err() {
                        break;
                    }
                }
                Some(Ok(FrontendMessage::Close(_))) | Some(Err(_)) | None => break,
            },
        }
    }

    let _ = upstream_tx.send(UpstreamMessage::Close(None)).await;
    let _ = frontend_tx.send(FrontendMessage::Close(None)).await;
}

/// Stream an upstream reply back, preserving status and content type.
///
/// `content-type` is the only header that matters: it carries both the
/// `multipart/form-data` marker binary endpoints use for byte attachments and the
/// asset types the official client negotiates against. The kernel's own cookies and
/// cache headers are irrelevant to the client.
/// Stream an upstream /link reply back, preserving the headers the protocol answers with.
///
/// status + content-type + allow + cache-control: the protocol's refusals are read by software
/// (405 carries Allow, every envelope carries its content type, and "no-store" keeps a proxy from
/// caching a token-minting answer). Streaming is unchanged, so SSE stays a stream.
async fn relay_link_body(upstream: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut builder = Response::builder().status(status);
    // The protocol's own answer headers travel too: x-link-* carries facts a peer must read
    // (the idempotent-replay marker among them), and dropping it turns a replay into an
    // indistinguishable second answer.
    for (name, value) in upstream.headers().iter() {
        let lower = name.as_str();
        let wanted = lower == "content-type"
            || lower == "allow"
            || lower == "cache-control"
            // The embed document's frame policy and the proxy's retry hint are protocol answers:
            // a 429 without Retry-After, or an embed page without its frame-ancestors policy, is
            // not the answer the kernel sent.
            || lower == "content-security-policy"
            || lower == "x-frame-options"
            || lower == "retry-after"
            || lower == "www-authenticate"
            || lower.starts_with("x-link-");
        if wanted {
            if let Ok(text) = value.to_str() {
                builder = builder.header(name.as_str(), text.to_owned());
            }
        }
    }
    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(std::io::Error::other));
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| internal("build upstream response").into_response())
}

async fn relay_body(upstream: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok().map(str::to_owned));
    let stream = upstream
        .bytes_stream()
        .map(|chunk| chunk.map_err(std::io::Error::other));

    let mut builder = Response::builder().status(status);
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| internal("build upstream response").into_response())
}

/// An upstream client that ignores the machine's proxy settings.
///
/// The kernel is on loopback; routing it through a configured proxy would break every
/// call.
fn build_client() -> Option<reqwest::Client> {
    reqwest::Client::builder().no_proxy().build().ok()
}

/// A JSON reply with the given status.
fn json(status: StatusCode, body: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body.to_owned()).into_response()
}

/// The shell has no kernel session yet.
fn unavailable(message: &str) -> Response {
    json(StatusCode::SERVICE_UNAVAILABLE, &format!(r#"{{"error":{}}}"#, json_string(message)))
}

/// A 500 with a readable message, so a proxy bug is visible rather than looking like a
/// kernel failure.
fn internal(message: &str) -> Response {
    json(
        StatusCode::INTERNAL_SERVER_ERROR,
        &format!(r#"{{"error":{}}}"#, json_string(message)),
    )
}

/// Serialise a Rust string as a JSON string literal.
fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_owned())
}