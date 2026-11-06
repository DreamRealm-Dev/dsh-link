//! Application wiring.
//!
//! The window loads the **official DSH client**, served by the kernel and
//! re-originated through a loopback proxy. That is the whole point: DSH's frontend
//! plugins extend the official client through its slot system, so any interface this
//! project drew itself would be invisible to them.
//!
//! Two listeners back that. The kernel supervisor owns the DSH child process. The
//! proxy is how the window reaches it at all, because DSH 0.2.x authenticates every
//! route with a signed `HttpOnly` cookie that a browser cannot present — see
//! [`core::session`] — and because the shell, not the kernel, is what knows that
//! cookie.
//!
//! The window itself needs no IPC: the official client gets its native capabilities
//! from the kernel's own host plugins, so the shell grants no remote-domain IPC
//! access. When the kernel is not up, the proxy answers the window's root request
//! with the shell's boot page instead (`core::shellpage`).

use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

// The notification area and the application menu are desktop surfaces: Tauri gates
// the tauri::menu and tauri::tray modules behind cfg(desktop), so naming them on
// Android would not resolve at all.
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::window::Color;
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WindowEvent};
use tokio::net::TcpListener;

mod core;

/// Requirement D: the entry a HOST application calls, and the window label it may choose.
pub mod embed;
/// R388: the tray icon, on the Win32 mechanism measured to work on this machine.
#[cfg(desktop)]
mod tray;

use core::supervisor::KernelSupervisor;

/// Loopback port the proxy listens on. Distinct from the kernel's own port so the two
/// never contend, and away from the ports the other DSH installations on this machine
/// use.
pub const PROXY_PORT: u16 = 31761;

/// The proxy's own origin. Requests carrying any other `Origin` are refused, which is
/// what lets the CORS policy stay empty.
pub const SELF_ORIGIN: &str = "http://127.0.0.1:31761";

/// How often the window watchdog samples liveness.
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(30);

/// Reload attempts before escalating to the recovery page, and the cooldown after
/// the cycle gives up. Mirrors EAC's renderer recovery: bounded retries, then a
/// quiet period (their watchdog allows five restarts per ten minutes).
const WATCHDOG_RELOADS: u32 = 3;
const WATCHDOG_COOLDOWN: Duration = Duration::from_secs(600);

/// After a recovery action, give the page this long to reconnect before the next
/// sample decides whether the action worked.
const WATCHDOG_GRACE: Duration = Duration::from_secs(45);

/// Health must hold this long before the attempt counter clears. A crash that
/// returns for a few seconds at a time must not read as recovery. (Stability
/// window from the DSH EAC renderer recovery state machine; see
/// THIRD-PARTY-NOTICES.md.)
const WATCHDOG_STABLE: Duration = Duration::from_secs(30);

/// Whether the operating system is in its dark appearance.
///
/// The window paints a surface before any page renders, and WebView2's own default is
/// white — in dark mode that frame is a flashbang on every cold start. Reading the
/// system setting lets the shell paint the surface the client is about to paint. An
/// unreadable setting answers dark, which is what the client's own boot overlay uses.
#[cfg(windows)]
fn system_is_dark() -> bool {
    // No registry dependency for one value: HKCU's AppsUseLightTheme is 0 in dark mode.
    let output = std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "/v",
            "AppsUseLightTheme",
        ])
        .output();
    match output {
        Ok(output) => String::from_utf8_lossy(&output.stdout).contains("0x0"),
        Err(_) => true,
    }
}

/// macOS answer: `defaults` prints Dark only while the dark appearance is active.
#[cfg(target_os = "macos")]
fn system_is_dark() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("Dark"))
        .unwrap_or(true)
}

/// Other Unix answer: the desktop's colour-scheme preference.
#[cfg(all(unix, not(target_os = "macos")))]
fn system_is_dark() -> bool {
    std::process::Command::new("gsettings")
        .args(["get", "org.gnome.desktop.interface", "color-scheme"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains("dark"))
        .unwrap_or(true)
}

/// Set once the tray's Quit item is chosen, so the window's close handler stops
/// hiding and lets the process end. Nothing else clears it: a quit that a close
/// request interrupted would leave the window unable to be closed at all.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Kept as a deliberate no-op: this shell does not pin a WebView2 runtime.
///
/// It used to ship Microsoft's Fixed Version runtime beside the executable. That
/// runtime carries licence files this project cannot relicense — GPL-3.0 texts under
/// `Trust Protection Lists/{Mu,Sigma}` — so the shell stopped distributing it: the
/// installer now downloads Microsoft's own runtime (see `webviewInstallMode` in
/// `tauri.conf.json`) and the app uses the machine's evergreen build. The trade-off is
/// real and accepted: the rendering engine is no longer the exact build this app was
/// tested against. `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` still works for anyone who wants
/// to pin a runtime locally, which is a choice made by the machine's owner rather than
/// by what this repository redistributes.
#[cfg(windows)]
fn pin_webview2_runtime() {
    const ENV: &str = "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER";
    if let Some(folder) = std::env::var_os(ENV) {
        eprintln!("[shell] using the WebView2 runtime this machine pinned: {:?}", folder);
    }
}

/// No-op off Windows: the system webview is the only engine wry uses there.
#[cfg(not(windows))]
fn pin_webview2_runtime() {}

/// Report what the updater would install, then exit.
///
/// The tray item is the only other caller, and a check that can only speak through a
/// tray tooltip cannot be verified from a script. This runs the identical check.
fn check_update_cli() -> i32 {
    let version = env!("CARGO_PKG_VERSION").to_owned();
    let updater = core::update::Updater::new(&version);
    let (exit, report) = match tauri::async_runtime::block_on(updater.check()) {
        Ok(Some(update)) => (
            0,
            format!(
                "update available: {version} -> {} ({}) {}",
                update.version, update.asset.name, update.asset.url
            ),
        ),
        Ok(None) => (0, format!("up to date: {version}")),
        Err(why) => (2, format!("update check failed: {why}")),
    };
    println!("{report}");
    // A packaged build runs as a GUI subsystem executable, where a console a script
    // starts never sees stdout. The report file is what makes the check observable.
    if let Ok(path) = std::env::var("DSH_LINK_UPDATE_REPORT") {
        let _ = std::fs::write(&path, format!("{report}\n"));
    }
    exit
}

/// Release the writer locks one kernel home was left holding, then exit.
///
/// The recovery itself runs on every launch, before the child is spawned (see
/// core::writerlock, and the call in core::supervisor). This entry point exists so the
/// behaviour can be exercised over files alone, with no window and no child: it calls the
/// same function the launch path calls. A packaged build runs as a GUI subsystem executable,
/// where a console started by a script never sees stdout, so the lines are also written to
/// the file named by DSH_LINK_LOCK_REPORT when that variable is set.
fn release_writer_locks_cli(home: &str) -> i32 {
    let profiles = std::path::Path::new(home).join("profiles");
    let reports = core::writerlock::release_stale(&profiles);
    let mut report = String::new();
    for entry in &reports {
        println!("{}", entry.line);
        report.push_str(&entry.line);
        report.push('\n');
    }
    let released = reports
        .iter()
        .filter(|entry| entry.verdict == core::writerlock::Verdict::Released)
        .count();
    let summary = format!(
        "writer lock: examined {} lock file(s) under {} ({} released)",
        reports.len(),
        profiles.display(),
        released
    );
    println!("{summary}");
    report.push_str(&summary);
    report.push('\n');
    if let Ok(path) = std::env::var("DSH_LINK_LOCK_REPORT") {
        let _ = std::fs::write(&path, report);
    }
    0
}

/// The application entry point: run with the default configuration.
///
/// A host application calls crate::embed::run_with instead, which records its own window label and then
/// runs this same function - one code path, so an embedded launch and a standalone one cannot drift apart.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    embed::install(embed::HostEmbed::default()).ok();
    run_configured()
}

/// Whether a running shell answers on its own port. A refused connection, a timeout and a malformed answer all mean
/// "nothing is running" - the caller only needs the three-way split "yes / no / do not know", and "do not know" must not
/// be read as "yes" (that would start a second shell for a `--quit`).
fn shell_is_running() -> bool {
    let port = std::env::var("DSH_LINK_PORT").ok().and_then(|value| value.parse::<u16>().ok()).unwrap_or(31761);
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    match std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_millis(400)) {
        Ok(stream) => {
            // A connection has to be ANSWERED, not merely accepted: a socket in TIME_WAIT would otherwise read as running.
            use std::io::{Read, Write};
            let mut socket = stream;
            let _ = socket.set_read_timeout(Some(std::time::Duration::from_millis(600)));
            let request = format!("HEAD / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
            if socket.write_all(request.as_bytes()).is_err() {
                return false;
            }
            let mut buffer = [0u8; 16];
            match socket.read(&mut buffer) {
                Ok(count) => count > 0,
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

fn run_configured() {
    if std::env::args().any(|arg| arg == "--check-update") {
        std::process::exit(check_update_cli());
    }
    // R385: `--quit` asks the RUNNING shell to quit through its own tray path (the single-instance plugin forwards
    // these arguments to it). With nothing running there is nothing to forward to, so say that instead of starting a
    // shell the caller asked to close.
    if std::env::args().any(|arg| arg == "--quit") && !shell_is_running() {
        eprintln!("[shell] --quit: no running instance answered, so there is nothing to quit");
        std::process::exit(0);
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(at) = args.iter().position(|arg| arg == "--release-writer-locks") {
        match args.get(at + 1) {
            Some(home) => std::process::exit(release_writer_locks_cli(home)),
            None => {
                eprintln!("usage: dsh-link --release-writer-locks <kernel home>");
                std::process::exit(64);
            }
        }
    }
    pin_webview2_runtime();
    core::mobile::report();
    let builder = builder().setup(|app| boot(app.handle()));

    builder
        // No command surface. The window runs the official client, which is served over
        // HTTP and has no reason to reach into the shell; everything the proxy exposes
        // is derived from the supervisor, so there is nothing for an IPC bridge to add.
        .build(tauri::generate_context!())
        .expect("failed to build the DSH Link shell")
        .run(|app_handle, event| handle_run_event(app_handle, event));
}

/// The plugins an embedded shell needs, on a builder the HOST owns.
///
/// A host application keeps its own `tauri::Builder` - its own identifier, its own
/// `generate_context!`, its own plugins - and therefore cannot call `embed::run_with`: that entry builds the
/// application itself. It starts from this builder instead, adds its own `.setup(...)` that creates the
/// window it will hand over, and calls `embed::boot_into_host` from that setup. The two plugins below are the
/// ones the shell's own runtime code reaches for, so a host embedding the shell gets them without having to know
/// why they are there.
pub fn builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default();
    // Must be the first plugin: a second launch has to be told "already
    // running" before it spawns a second kernel supervisor racing the first
    // for DSH_HOME and port 31760. "A second launch" is a desktop situation, and
    // this plugin only exists there: Android starts the activity itself, so there
    // is no earlier process to hand the new one to.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        // R385: a second launch carrying `--quit` is the SAME request as the tray's 退出 item - the one graceful
        // shutdown this application has. Without it a script could only kill the process, and a killed shell leaves
        // its tray icon behind and never runs the run-event half that stops the kernel child.
        if args.iter().any(|arg| arg == "--quit") {
            QUITTING.store(true, Ordering::SeqCst);
            app.exit(0);
            return;
        }
        if let Some(window) = app.get_webview_window(embed::window_label()) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    let builder = builder
        // The copy-first policy needs the OS clipboard on every platform, mobile included.
        .plugin(tauri_plugin_clipboard_manager::init());
    // Android and iOS reach the default handler through the platform's own call, so the
    // plugin that wraps it is registered there and nowhere else.
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_opener::init());

    builder
}

/// Boot the shell inside an application that already exists.
///
/// Everything the shell does once an application is built lives here, not inside a `Builder::setup` closure,
/// because there are two callers now: the standalone entry point and a host that embedded the shell
/// (`embed::boot_into_host`). Both take the same path through this function, so an embedded launch and a
/// standalone one cannot drift apart.
pub fn boot(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.clone();
    let root = core::locator::kernel_root();
    let config_root = handle
        .path()
        .app_config_dir()
        .map(|dir| dir.join("dsh-link"))
        .map_err(|error| format!("resolve app config dir: {error}"))?;

    let supervisor = KernelSupervisor::new(root, config_root.clone());
    app.manage(supervisor.clone());

    // The self-updater reads this project's GitHub releases. It is state rather
    // than a service: the only caller is the tray item below.
    let version = app.package_info().version.to_string();
    app.manage(core::update::Updater::new(&version));

    // The window's own corner radius and palette, read from `shell.json` beside
    // the kernel home and shared from here on: the window builder paints itself
    // with them, `/__shell/window` changes them, and the boot page is stamped
    // with them. Managed before the router exists so all three see one store.
    let shell_window = core::shellprefs::ShellWindow::load(&config_root);
    app.manage(shell_window);

    // The phone is a *bridge end* of the device net (ADR-004: there is no kernel
    // here, so the slave half of the LAN bridge has to be spoken by this shell).
    // Started before the window so the pairing code is already on screen when the
    // page paints. On a desktop build this is a no-op unless DSH_LINK_BRIDGE_ROOTS
    // names what to serve; see core::device_bridge.
    // R332: `media.capture` records in the WebView (the only place getUserMedia exists), so the bridge keeps the app
    // handle and evals the capture script into the window when a host asks for audio.
    core::device_bridge::install_app(handle.clone());
    let bridge_state = config_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = core::device_bridge::boot(Some(&bridge_state)) {
            eprintln!("[bridge] the device bridge did not start: {error}");
        }
    });

    // The window loads this origin, so the proxy must be listening before the
    // window's first request rather than lazily on the first API call.
    let router = core::proxy::router(supervisor.clone(), handle.clone());
    let address = SocketAddr::from(([127, 0, 0, 1], PROXY_PORT));
    // Bind here rather than inside the serving task. The window is created below
    // and its very first request has to find the proxy already listening:
    // otherwise the webview paints its own connection-error page, which is a
    // white document in dark mode. A failed bind is reported and the window
    // still opens, in which case whatever holds this port is what answers.
    let bound = match std::net::TcpListener::bind(address) {
        Ok(listener) => Some(listener),
        Err(error) => {
            eprintln!("[proxy] cannot bind {address}: {error}");
            None
        }
    };
    if let Some(listener) = bound {
        tauri::async_runtime::spawn(async move {
            if let Err(error) = listener.set_nonblocking(true) {
                eprintln!("[proxy] non-blocking listener: {error}");
                return;
            }
            let listener = match TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("[proxy] adopt listener: {error}");
                    return;
                }
            };
            if let Err(error) = axum::serve(listener, router).await {
                eprintln!("[proxy] stopped: {error}");
            }
        });
    }

    // Boot the kernel eagerly. The proxy answers `/` with the shell's boot page
    // until a session exists, so the window has something to render either way.
    let boot_supervisor = supervisor.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = boot_supervisor.ensure_running().await {
            eprintln!("[kernel] auto-start failed: {error}");
        }
    });

    // Watch the window the way EAC's renderer recovery watches its own:
    // Tauri exposes no render-process-gone event, so a dead WebView2
    // renderer is detected through the proxy's liveness signals instead
    // (see core::liveness). Escalate reload → recovery page, then rate-limit
    // the whole cycle rather than retrying forever. (Strategy ported in
    // spirit from Deepseek Harness EAC, MIT; see THIRD-PARTY-NOTICES.md.)
    let watchdog_handle = handle.clone();
    tauri::async_runtime::spawn(async move {
        watch_window(watchdog_handle, supervisor).await;
    });

    build_window(&handle)?;
    // The window exists: hand the stored radius and palette to it and to the page
    // it has already started loading, so the frame is right from the first frame
    // rather than after the page's own read-back.
    if let Some(shell) = handle.try_state::<core::shellprefs::ShellWindow>() {
        shell.apply(&handle);
    }
    // The tray owns the app's lifetime: closing the window hides it, and
    // only the tray's Quit ends the kernel. A shell that dies with its
    // window cannot keep a long-running session alive in the background.
    // A notification-area icon is a desktop surface with nothing behind it on
    // Android, where Tauri has no tray module to build one with.
    #[cfg(desktop)]
    start_tray(&handle)?;
    Ok(())
}

/// What the tray's menu items do. A free function because the tray holds a plain function pointer: the items are the
/// application's actions, and the tray module owns none of them.
#[cfg(desktop)]
fn tray_action(action: crate::tray::TrayAction) {
    // The tray's window is not the app's main window, so the actions go through the same helpers the menu used before.
    let app = match crate::TRAY_APP.get() {
        Some(app) => app,
        None => return,
    };
    match action {
        crate::tray::TrayAction::Toggle => toggle_window(app),
        crate::tray::TrayAction::NewWindow => {
            if let Err(why) = open_extra_window(app) {
                eprintln!("[shell] could not open another window: {why}");
            }
        }
        crate::tray::TrayAction::Browser => open_url(app, SELF_ORIGIN),
        crate::tray::TrayAction::Update => {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move { run_update(handle).await });
        }
        crate::tray::TrayAction::Quit => {
            QUITTING.store(true, Ordering::SeqCst);
            app.exit(0);
        }
    }
}

/// The app handle the tray's actions address, set once at boot (the tray callback has no context of its own).
#[cfg(desktop)]
static TRAY_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// The tray's host table, built once.
#[cfg(desktop)]
static TRAY_HOST: crate::tray::TrayHost = crate::tray::TrayHost { dispatch: tray_action };

/// Start the tray and pump its window: the shell's own Win32 tray (see src/tray.rs for why the crate is not used).
#[cfg(desktop)]
fn start_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let _ = TRAY_APP.set(handle.clone());
    // The window is created on THIS thread (boot runs on the main one), so the application's own event loop is what
    // dispatches its messages: Win32 delivers a window's messages to the thread that created it, and a second thread
    // pumping GetMessage would wait forever for messages it can never receive.
    match crate::tray::start(handle, &TRAY_HOST) {
        Ok(()) => {}
        Err(why) => {
            // Named, not silent: the window's own close still hides the app, and the log says the tray is missing.
            eprintln!("[shell] tray unavailable this run: {why}");
        }
    }
    Ok(())
}

/// The run-event half of the shell, shared by both entries for the same reason `boot` is.
///
/// Five behaviours: a close hides the window instead of quitting, a system appearance change is followed only
/// while the palette is still the system's, a foreground transition schedules one coalesced re-place of the sidebar
/// panel on a worker thread (see [`core::sidebar_panel::replace_after_foreground`]), a window resize copies the real
/// client size onto the window's own webview on Windows (see [`resize_window_webview`]), and `RunEvent::Exit` stops
/// the kernel child explicitly. A host that embedded the shell gets all five by passing this function to `App::run`.
pub fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        // Closing the window is not quitting. The kernel keeps running and the
        // tray brings the window back; the watchdog already treats a hidden
        // window as neither healthy nor dead, so hiding one costs nothing.
        // (Same split as the DSH desktop clients: the official shell hides
        // after a one-time confirmation, the community shells hide always.)
        //
        // This must be handled here rather than in Builder::on_window_event:
        // with Tauri 2.12/wry 0.57 that hook receives Focused and Resized but
        // never CloseRequested, and an unhandled close takes the process down
        // with the window.
        // A system appearance change repaints the window's own surface, so the next
        // cold frame is already the right colour instead of the previous one.
        tauri::RunEvent::WindowEvent {
            event: WindowEvent::ThemeChanged(_),
            ..
        } => {
            // The window's surface is transparent and the page paints itself, so an
            // appearance change is only ever a *palette* change — and only while the
            // palette is still the system's. Once the client's own theme toggle has
            // chosen one, the operating system's appearance stops being an answer to
            // anything, and the stored value wins.
            if let Some(shell) = app_handle.try_state::<core::shellprefs::ShellWindow>() {
                shell.follow_system(&app_handle);
            }
    }
    // A window that has been minimised and brought back is a window the compositor is
    // re-presenting, so NOTHING that costs a native call may run here: this thread is the one
    // that owns the window, and a placement on it is a placement the user waits behind.
    //
    // Two facts make this the right place for the work rather than the page's:
    //   * `Focused` does arrive for this window - the comment above records that Tauri 2.12/wry
    //     0.57 deliver Focused and Resized to this hook (only CloseRequested is missing);
    //   * a restore is exactly when a child webview's rectangle can be left behind. The page
    //     that measures the right column can only re-place it from a layout it is still
    //     reflowing (R395 measured the deck reporting the whole window for ~1.5s after a
    //     restore), and R393's note in core/panel_host.js records the gap in the shell:
    //     "nothing in handle_run_event reacts to a restore".
    // The work is therefore SCHEDULED: one coalesced, off-thread re-place from the shell's own
    // stored surface (core::sidebar_panel::replace_after_foreground), which reuses the child
    // webviews the window already has instead of creating, closing or reloading any of them.
    tauri::RunEvent::WindowEvent {
        event: WindowEvent::Focused(true) | WindowEvent::ScaleFactorChanged { .. },
        ..
    } => core::sidebar_panel::replace_after_foreground(app_handle),
    // A window resize is the one native size the shell still has to copy by hand on Windows: Tauri's
    // proportional resize pass is switched off for these windows (see keep_webview_sized_by_wry), so
    // the window's own webview gets its new client size here. The minimized event is skipped inside
    // resize_window_webview: its "size" is the placeholder rect, which is exactly the title-bar strip
    // this fix keeps out of the page.
    tauri::RunEvent::WindowEvent {
        label,
        event: WindowEvent::Resized(size),
        ..
    } => resize_window_webview(app_handle, &label, size),
    tauri::RunEvent::WindowEvent { label, event, .. } => {
        if let WindowEvent::CloseRequested { api, .. } = &event {
            if !QUITTING.load(Ordering::SeqCst) {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(&label) {
                    let _ = window.hide();
                }
                eprintln!(
                    "[shell] window hidden to the tray; the kernel keeps running (tray Quit stops it)"
                );
            }
        }
    }
    // Managed state destructors are not guaranteed to run on every exit path,
    // so the kernel child is terminated here explicitly.
    tauri::RunEvent::Exit => {
        if let Some(supervisor) = app_handle.try_state::<KernelSupervisor>() {
            supervisor.stop_all_sync();
        }
    }
    _ => {}
    }
}

/// Stop Tauri's proportional resize pass from sizing the shell's own window webviews (Windows only).
///
/// The shell enables tauri's `unstable` feature because the sidebar browser needs `Window::add_child`, and with
/// that feature a `WebviewWindow`'s own webview is registered for the runtime's auto-resize pass. That pass does
/// not filter `SIZE_MINIMIZED`: tao forwards the minimized `WM_SIZE`, and this shell's undecorated window reports
/// its minimized placeholder rectangle there (measured 158x26 at 150% DPI). Every minimize therefore squeezed the
/// webview - and the page laid out inside it - down to a title-bar-sized strip, and the restore animation showed
/// exactly that strip until the window was foregrounded and the webview was sized again.
///
/// What sizes the webview instead: wry skips `SIZE_MINIMIZED` in its own `WM_SIZE` handler, but with `unstable` a
/// window's webview is a child webview in wry's terms, so that handler is never attached to it; the real client size
/// is copied over by [`resize_window_webview`] from the window's `Resized` event instead. That copy is a message to
/// the runtime (no native call on the event-loop thread), which is the discipline the sidebar's child webviews are
/// placed with.
///
/// Only Windows needs this: `SIZE_MINIMIZED` and the minimized placeholder rectangle are Win32 facts. Other desktop
/// platforms keep Tauri's pass in charge.
fn keep_webview_sized_by_wry(window: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        if let Err(error) = window.as_ref().set_auto_resize(false) {
            eprintln!("[shell] could not keep the window's webview out of the proportional resize pass: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = window;
}

/// Give a window's own webview the window's real client size: the other half of
/// [`keep_webview_sized_by_wry`], called from [`handle_run_event`] for every `Resized` event.
///
/// Skipped when the event is not a layout: a minimized window reports its placeholder rectangle - the title-bar
/// strip this path exists to keep out of the page - and a zero size carries nothing to apply. The size arrives in
/// physical pixels, which is what wry's placement wants, and the call is a message to the runtime, so the window's
/// event-loop thread does not wait for a native resize.
fn resize_window_webview(app: &tauri::AppHandle, label: &str, size: tauri::PhysicalSize<u32>) {
    #[cfg(windows)]
    {
        if size.width == 0 || size.height == 0 {
            return;
        }
        let Some(window) = app.get_webview_window(label) else {
            // A host-embedded shell sits in a plain host Window, whose child webview keeps its own auto_resize
            // (the shell does not own that window's frame): there is nothing to copy here.
            return;
        };
        if window.is_minimized().unwrap_or(false) {
            return;
        }
        let webview: &tauri::Webview = window.as_ref();
        if let Err(error) = webview.set_size(size) {
            eprintln!("[shell] could not give the window's webview its client size: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = (app, label, size);
}

/// Open ANOTHER WINDOW of this running instance.
///
/// R387: requirement D, as the product means it. The shell already serves the client on one origin; a second window
/// loads that SAME origin, so it is backed by the same process, the same proxy, the same kernel, the same plugin rows and
/// the same session storage - a second window, not a second instance with its own home and port. (The `host-app` crate
/// remains the OTHER shape: a foreign application carrying the shell webview.)
///
/// The window is built the way the main one is (same fence, same look, same browser arguments), except that it has its
/// own label so the main window's plumbing - the tray's show/hide and the panel host's placement - keeps addressing the
/// window it has always addressed.
/// @param handle - the running application.
/// @returns the label of the window it opened, or why it could not.
pub fn open_extra_window(handle: &tauri::AppHandle) -> Result<String, String> {
    let taken: Vec<String> = handle.webview_windows().keys().cloned().collect();
    let mut index = 2usize;
    let label = loop {
        let candidate = format!("window-{index}");
        if taken.iter().any(|existing| existing == &candidate) != true {
            break candidate;
        }
        index += 1;
        if index > 64 {
            return Err("this application already has 64 windows open".to_owned());
        }
    };
    let url = tauri::Url::parse(&format!("{SELF_ORIGIN}/")).map_err(|error| error.to_string())?;
    let palette = handle
        .try_state::<core::shellprefs::ShellWindow>()
        .map(|shell| shell.get().palette())
        .unwrap_or_else(core::shellprefs::Palette::from_system);
    let theme = if palette.is_dark() { tauri::Theme::Dark } else { tauri::Theme::Light };
    let builder = tauri::WebviewWindowBuilder::new(handle, label.as_str(), WebviewUrl::External(url))
        .title("DSH Link")
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .theme(Some(theme))
        .additional_browser_args(&std::env::var("DSH_LINK_WEBVIEW2_ARGS").unwrap_or_default())
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .disable_drag_drop_handler()
        .on_navigation({
            let navigation_handle = handle.clone();
            move |url| allow_navigation(&navigation_handle, url)
        })
        .on_new_window({
            let new_window_handle = handle.clone();
            move |url, _features| {
                if matches!(url.scheme(), "http" | "https") {
                    open_url(&new_window_handle, url.as_str());
                }
                tauri::webview::NewWindowResponse::Deny
            }
        });
    #[cfg(desktop)]
    let builder = builder.decorations(false).shadow(false).center();
    let window = builder.build().map_err(|error| format!("could not build {label}: {error}"))?;
    // Another window built the same way is the same shape: without this its restore would show the same
    // title-bar strip (see keep_webview_sized_by_wry).
    keep_webview_sized_by_wry(&window);
    eprintln!("[shell] opened another window {label:?} on {SELF_ORIGIN} (same instance, same kernel, same session)");
    Ok(label)
}

/// The labels of every window this application currently has.
/// @param handle - the running application.
/// @returns the labels, sorted.
pub fn window_labels(handle: &tauri::AppHandle) -> Vec<String> {
    let mut labels: Vec<String> = handle.webview_windows().keys().cloned().collect();
    labels.sort();
    labels
}

/// Create the main window in Rust rather than the config so the navigation fence can
/// be attached: a config-declared window offers no hook for it.
fn build_window(handle: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let url = tauri::Url::parse(&format!("{SELF_ORIGIN}/"))
        .map_err(tauri::Error::InvalidUrl)?;
    // Requirement D, shape A: a host that already has a window keeps it. The shell installs its webview INTO
    // that window instead of building one of its own, which is the only difference between an embed and a
    // launch - everything after this function is the same code, because the window lookups go through
    // embed::window/embed::webview rather than through a label only a window this crate built would have.
    if let Some(host_label) = embed::config().attach_to {
        #[cfg(desktop)]
        return attach_into_host_window(handle, &host_label, url);
        // Android hosts the shell's webview in the activity it was given, so there is no second window to
        // attach into: the configuration is named as unsupported instead of being quietly dropped. This line
        // is the same `Err(format!(...).into())` shape the missing-window refusal below compiles on desktop.
        #[cfg(not(desktop))]
        return Err(format!(
            "dsh-link: HostEmbed::attached_to({host_label:?}) is a desktop shape; on this target the shell's \
             webview is the activity's and there is no host window to attach into"
        )
        .into());
    }
    // The palette is the *application's* preference — whatever the client's own theme
    // toggle last persisted — and only the operating system's reading until it has ever
    // chosen. The window's theme and the boot page are stamped from it for the same
    // reason: the shell must not show the system's theme where the client shows its own.
    let palette = handle
        .try_state::<core::shellprefs::ShellWindow>()
        .map(|shell| shell.get().palette())
        .unwrap_or_else(core::shellprefs::Palette::from_system);
    let theme = if palette.is_dark() {
        tauri::Theme::Dark
    } else {
        tauri::Theme::Light
    };
    let builder = tauri::WebviewWindowBuilder::new(handle, embed::window_label(), WebviewUrl::External(url))
        .title("DSH Link")
        // The surface itself is transparent everywhere: the page paints it, and the shell only
        // has to stop the webview's own opaque default from showing through.
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .theme(Some(theme))
        // A debug endpoint on request, so a script can ask the live page what it sees.
        // Tauri replaces its own browser arguments with these, so the seam is opt-in
        // rather than always on.
        .additional_browser_args(
            &std::env::var("DSH_LINK_WEBVIEW2_ARGS").unwrap_or_default(),
        )
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .disable_drag_drop_handler();
    // No decorations and no drop shadow, centred: the title strip, the three window buttons
    // and the rounded corner are drawn by the page (`core::frame`), because the radius is a
    // 0..28 setting rather than a system constant. `decorations(false)` is what makes that
    // possible, and `shadow(false)` is part of the same decision: for an undecorated window
    // Tauri would otherwise extend the DWM frame into the client area, which inflates the
    // window rect by the shadow insets and clips whatever corner the page drew. The cost is
    // no system drop shadow — the frame is the window's own edge now.
    //
    // All three are desktop-only builder methods: Android puts this webview inside the
    // activity it was given, where it has no frame, no drop shadow and no screen rectangle
    // of its own to be centred in.
    #[cfg(desktop)]
    let builder = builder.decorations(false).shadow(false).center();
    let built = builder
        // The fence hands refused links to the system browser, which needs the handle.
        .on_navigation({
            let navigation_handle = handle.clone();
            move |url| allow_navigation(&navigation_handle, url)
        })
        // A `target="_blank"` link does not call `window.open`; it asks the webview for a
        // new window, which is how the account page's Platform links, the usage and top-up
        // links and the bonus notice's link are written. Left to the default the page opens
        // in a second window of this application, so that path is fenced the same way as
        // navigation: http(s) goes to the system browser and nothing else opens.
        .on_new_window({
            let new_window_handle = handle.clone();
            move |url, _features| {
                if matches!(url.scheme(), "http" | "https") {
                    eprintln!("[shell] external link handed to the system browser: {url}");
                    open_url(&new_window_handle, url.as_str());
                } else {
                    eprintln!("[shell] refused new window: {url}");
                }
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .build();
    // A desktop build must not start without its window; a mobile one has one
    // activity-hosted webview to work with and no second window to make, so a refusal
    // there is reported and the proxy stays up rather than taking the process down.
    #[cfg(desktop)]
    {
        let window = built?;
        // The webview stops following Tauri's proportional resize pass, which would otherwise squeeze it to
        // the minimized placeholder on every minimize (see keep_webview_sized_by_wry); the Resized arm in
        // handle_run_event then copies the real client size onto it.
        keep_webview_sized_by_wry(&window);
    }
    #[cfg(mobile)]
    if let Err(error) = built {
        eprintln!("[shell] mobile webview: {error}");
    }

    Ok(())
}
/// Attach the shell's webview to a window the HOST built (requirement D, shape A).
///
/// `Window::add_child` is the only path that puts a webview into a window this crate did not create, and it is
/// what makes "embed" mean embed: the host keeps its window, its decorations, its size and its identity, and the
/// shell contributes the page inside it. What stays the shell's: the navigation fence and the new-window fence
/// (both webview-level, so they carry over unchanged), the clipboard policy, and the debug-endpoint argument.
/// What changes: no `decorations`/`shadow`/`center`/`inner_size` call - on a host window those would
/// re-decorate something the host already decided - and no transparent surface: the page paints its own palette
/// and the host owns the frame, so asking for a transparent child webview would add a compositing controller to
/// keep in step for a corner nobody would see.
#[cfg(desktop)]
fn attach_into_host_window(
    handle: &tauri::AppHandle,
    host_label: &str,
    url: tauri::Url,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(host) = handle.get_window(host_label) else {
        return Err(format!(
            "dsh-link: HostEmbed::attached_to({host_label:?}) names a window this application does not have: the \
             host must build it (a plain Window, with no webview of its own) before the shell boots"
        )
        .into());
    };
    // The child starts at the host's own client area, and `auto_resize` keeps it there on every resize: the shell
    // has no opinion about the size of a window it does not own.
    let scale = host.scale_factor()?;
    let size = host.inner_size()?.to_logical::<f64>(scale);
    let webview = tauri::webview::WebviewBuilder::new(embed::window_label(), WebviewUrl::External(url))
        .auto_resize()
        .disable_drag_drop_handler()
        .additional_browser_args(&std::env::var("DSH_LINK_WEBVIEW2_ARGS").unwrap_or_default())
        .on_navigation({
            let navigation_handle = handle.clone();
            move |url| allow_navigation(&navigation_handle, url)
        })
        .on_new_window({
            let new_window_handle = handle.clone();
            move |url, _features| {
                if matches!(url.scheme(), "http" | "https") {
                    eprintln!("[shell] external link handed to the system browser: {url}");
                    open_url(&new_window_handle, url.as_str());
                } else {
                    eprintln!("[shell] refused new window: {url}");
                }
                tauri::webview::NewWindowResponse::Deny
            }
        });
    // R411: the slot. A host that wants the shell as a right sidebar names a rectangle; the default is still the whole
    // client area, so an embed that says nothing keeps behaving exactly as before.
    let (at, extent) = match embed::config().slot {
        Some(slot) => (tauri::LogicalPosition::new(slot.x, slot.y), tauri::LogicalSize::new(slot.w, slot.h)),
        None => (tauri::LogicalPosition::new(0., 0.), tauri::LogicalSize::new(size.width, size.height)),
    };
    host.add_child(webview, at, extent)?;
    eprintln!(
        "[shell] attached webview {:?} into the host window {host_label:?} at ({}, {}) size {}x{} (window {}x{})",
        embed::window_label(),
        at.x,
        at.y,
        extent.width,
        extent.height,
        size.width,
        size.height
    );
    Ok(())
}


/// Build the notification-area icon and its menu.
///
/// This is the only surface left once the window is hidden, so it carries the
/// three actions the window itself cannot: bring it back, open the same origin
/// in a real browser (the proxy attaches the session cookie upstream, so the
/// browser needs no token), and end the process — the one path that sets
/// QUITTING and lets the close handler stop intercepting.
#[cfg(desktop)]
fn build_tray(handle: &tauri::AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(handle, "toggle", "显示 / 隐藏主窗口", true, None::<&str>)?;
    let browser = MenuItem::with_id(handle, "browser", "在浏览器中打开", true, None::<&str>)?;
    // R387: another window of THIS instance - the same proxy, kernel, plugin rows and session, not a second copy of the
    // application. A person reaches it here; a script reaches the same thing at POST /__shell/window {"op":"open"}.
    let newwindow = MenuItem::with_id(handle, "newwindow", "新窗口", true, None::<&str>)?;
    let update = MenuItem::with_id(handle, "update", "检查并安装更新", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(handle)?;
    let separator2 = PredefinedMenuItem::separator(handle)?;
    let quit = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(handle, &[&toggle, &newwindow, &browser, &separator, &update, &separator2, &quit])?;

    // The window icon is the one the bundle config already ships; the embedded
    // PNG is the fallback for a build without a bundled icon set.
    let icon = handle.default_window_icon().cloned().or_else(|| {
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")).ok()
    });

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip(format!("DSH Link — {SELF_ORIGIN}"))
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_window(app),
            "newwindow" => {
                if let Err(why) = open_extra_window(app) {
                    eprintln!("[shell] could not open another window: {why}");
                }
            }
            "browser" => open_url(app, SELF_ORIGIN),
            "update" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move { run_update(handle).await });
            }
            "quit" => {
                QUITTING.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    // R388: BUILD, then ASK THE SHELL WHETHER IT TOOK IT.
    //
    // The tray-icon crate tolerates a refused Shell_NotifyIcon(NIM_ADD) by doing nothing and waiting for a TaskbarCreated
    // message that only arrives when the taskbar restarts (tray-icon 0.25.1, windows/mod.rs:159-162). This application
    // printed "tray icon ready" either way, so a refused registration was invisible in the log and in the tray: measured
    // on this machine as "tray rect: the shell reports NO rect for this icon" while Windows' own settings page still
    // listed an entry left by an earlier run. The registration is therefore verified through the shell's own answer and
    // retried a bounded number of times; the line that follows says which attempt worked, or that none did.
    let mut kept: Option<tauri::tray::TrayIcon<tauri::Wry>> = None;
    for attempt in 1..=3u8 {
        let mut attempt_builder = TrayIconBuilder::with_id("main")
            .menu(&menu)
            .tooltip(format!("DSH Link — {SELF_ORIGIN}"))
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "toggle" => toggle_window(app),
                "newwindow" => {
                    if let Err(why) = open_extra_window(app) {
                        eprintln!("[shell] could not open another window: {why}");
                    }
                }
                "browser" => open_url(app, SELF_ORIGIN),
                "update" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move { run_update(app_handle).await });
                }
                "quit" => {
                    QUITTING.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_window(tray.app_handle());
                }
            });
        if let Some(icon) = icon.clone() {
            attempt_builder = attempt_builder.icon(icon);
        }
        match attempt_builder.build(handle) {
            Ok(candidate) => {
                // Give the shell a moment to place it, then ask. A few hundred milliseconds is what a busy taskbar needs.
                let mut rect = candidate.rect().ok().flatten();
                for _ in 0..6 {
                    if rect.is_some() {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    rect = candidate.rect().ok().flatten();
                }
                match rect {
                    Some(rect) => {
                        eprintln!("[shell] tray registered on attempt {attempt}: the shell reports {:?}", rect);
                        kept = Some(candidate);
                        break;
                    }
                    None => {
                        eprintln!("[shell] tray attempt {attempt}: the shell reports NO rect, so this registration did not take - rebuilding");
                        drop(candidate);
                    }
                }
            }
            Err(error) => eprintln!("[shell] tray attempt {attempt} could not build: {error}"),
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    let Some(tray) = kept else {
        // Named, not silent: the app keeps running without a tray, and the window's own close still hides it.
        eprintln!("[shell] tray: THREE registrations and the shell placed none of them - the tray icon is MISSING this run");
        return Ok(());
    };
    let _ = tray.set_visible(true);
    match tray.rect() {
        Ok(Some(rect)) => eprintln!("[shell] tray icon ready at {:?}: 显示/隐藏 · 新窗口 · 在浏览器中打开 · 退出", rect),
        _ => eprintln!("[shell] tray icon ready (the shell did not report a rect on the final read)"),
    }
    handle.manage(tray);
    eprintln!("[shell] tray icon ready: 显示/隐藏 · 在浏览器中打开 · 退出");
    Ok(())
}

/// Check the project's GitHub releases and install a newer one.
///
/// Everything happens from one tray item, which is the whole update story for an
/// install with no vendor feed: the releases list answers, the newest release carrying
/// an asset for this platform is downloaded with resume, and a helper installs it after
/// this process exits. The tray tooltip carries the phase, because there is no window
/// to put it in while the window is hidden.
#[cfg(desktop)]
async fn run_update(app: tauri::AppHandle) {
    let Some(updater) = app
        .try_state::<core::update::Updater>()
        .map(|state| state.inner().clone())
    else {
        return;
    };
    let directory = app
        .path()
        .app_config_dir()
        .map(|dir| dir.join("dsh-link").join("updates"))
        .ok();
    let checked = updater.check().await;
    match (checked, directory) {
        (Ok(Some(update)), Some(directory)) => {
            updater.set(core::update::UpdatePhase::Available(update.version.clone()));
            match updater.download(&update, &directory).await {
                Ok(asset) => {
                    updater.set(core::update::UpdatePhase::Installing(update.version.clone()));
                    match std::env::current_exe()
                        .map_err(|error| format!("locate this executable: {error}"))
                        .and_then(|executable| updater.apply(&asset, &directory, &executable))
                    {
                        Ok(()) => {
                            report_update(&app, &updater);
                            // The helper is waiting for this process to end before it
                            // installs; leaving the loop is what releases the files.
                            app.exit(0);
                            return;
                        }
                        Err(why) => updater.set(core::update::UpdatePhase::Failed(why)),
                    }
                }
                Err(why) => updater.set(core::update::UpdatePhase::Failed(why)),
            }
        }
        (Ok(None), _) => updater.set(core::update::UpdatePhase::UpToDate),
        (Err(why), _) => updater.set(core::update::UpdatePhase::Failed(why)),
        (Ok(Some(_)), None) => updater
            .set(core::update::UpdatePhase::Failed("no writable updates directory".to_owned())),
    }
    report_update(&app, &updater);
}

/// Put the updater's phase in the tray tooltip, where the hidden window cannot.
#[cfg(desktop)]
fn report_update(app: &tauri::AppHandle, updater: &core::update::Updater) {
    if let Some(tray) = app.tray_by_id("main") {
        let text = format!("DSH Link — {}\n{SELF_ORIGIN}", updater.phase().describe());
        let _ = tray.set_tooltip(Some(text));
    }
}

/// Show and focus the main window, or hide it when it is already in front.
#[cfg(desktop)]
fn toggle_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window(embed::window_label()) else {
        return;
    };
    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Decide whether the webview may navigate to `url`.
///
/// The whole app is one origin — the proxy's. Anything else the official client
/// points at stays out of the window: an external http(s) link opens in the system
/// browser instead, and what is neither the app origin nor a browser-openable link
/// is refused outright. The comparison must be exact scheme/host/port — a prefix
/// match would let `http://127.0.0.1:31761.evil.example` and userinfo tricks
/// through. (Navigation fence after the DSH EAC desktop's H1 handler; see
/// THIRD-PARTY-NOTICES.md.)
fn allow_navigation(app: &tauri::AppHandle, url: &tauri::Url) -> bool {
    let same_origin = url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(PROXY_PORT);
    if same_origin || url.as_str() == "about:blank" {
        return true;
    }
    if matches!(url.scheme(), "http" | "https") {
        eprintln!("[shell] external link handed to the system browser: {url}");
        open_url(app, url.as_str());
    } else {
        eprintln!("[shell] refused navigation: {url}");
    }
    false
}

/// Hand a URL to the operating system's default handler.
///
/// The mechanism differs per platform, and none of them is a shell invocation:
///
/// | Platform | Mechanism |
/// |---|---|
/// | Windows | `ShellExecuteW` — what the OS routes a URL through, and what Electron's `shell.openExternal` makes |
/// | macOS | `open`, the LaunchServices entry point (`NSWorkspace` as a command) |
/// | Linux | `xdg-open`, or an embedded copy of that script when the machine has none |
///
/// The `opener` crate carries that table so this shell does not guess at it. The
/// obvious-looking Windows alternative, `explorer <url>`, resolves its argument as a shell
/// item and opens a file-manager window — on this machine the user's Documents folder — for
/// every external link here, including the tray's "open in browser".
///
/// Android and iOS have no desktop call to make: there the handoff is the platform's own
/// Intent or UIApplication request, which the official opener plugin wraps. That plugin is
/// registered for those targets only, so a desktop build keeps the in-process call above
/// rather than adding a second implementation behind it.
///
/// A refused launch is reported rather than swallowed. A caller has already refused the
/// navigation it asked about, so nothing here is fatal.
pub(crate) fn open_url(app: &tauri::AppHandle, url: &str) {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        use tauri_plugin_opener::OpenerExt;
        if let Err(error) = app.opener().open_url(url, None::<&str>) {
            eprintln!("[shell] no handler accepted {url}: {error}");
        }
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        if let Err(error) = opener::open(url) {
            eprintln!("[shell] no handler accepted {url}: {error}");
        }
    }
}

/// Whether a watchdog sample can say anything about this window's renderer.
///
/// `is_visible` alone is not that question. On Windows it is `IsWindowVisible`, which stays
/// true for a MINIMIZED window (tao reads exactly that flag,
/// `platform_impl/windows/util.rs:203`), and a minimized window is exactly the shape whose page
/// the compositor stops driving: its timers are throttled and the kernel may have dropped its
/// sockets. Sampling that page's silence reads "nobody is looking" as "the renderer died", so the
/// window has to be both shown and not minimized before its quiet counts.
fn window_observable(window: &tauri::WebviewWindow) -> bool {
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    #[cfg(desktop)]
    {
        !window.is_minimized().unwrap_or(false)
    }
    // A mobile webview is the activity's own and has no minimized state to be excluded.
    #[cfg(not(desktop))]
    {
        true
    }
}

/// Watch the main window for a dead renderer and try to bring it back.
///
/// A reload re-runs the official client's boot in place; if three reloads cannot
/// revive the page, the window is sent to the shell's own boot/recovery page,
/// which shows the kernel state and offers a manual retry. After a full cycle
/// fails, the watchdog stays quiet for ten minutes — a persistent failure has a
/// cause a reload cannot fix, and reloading it in a loop only churns the kernel.
///
/// Two disciplines are lifted from the DSH EAC renderer recovery state machine:
/// a hidden (or suspended, or RDP-detached) renderer throttles its own timers and
/// may legitimately go quiet, so windows the user cannot see are judged neither
/// healthy nor dead — the cycle skips them AND restarts their silence clock (see
/// [`window_observable`]); and the attempt counter clears only after health has
/// held for [`WATCHDOG_STABLE`], so a crash that re-appears seconds after every
/// recovery is never mistaken for a cure.
async fn watch_window(handle: tauri::AppHandle, supervisor: KernelSupervisor) {
    let mut reloads: u32 = 0;
    let mut healthy_since: Option<tokio::time::Instant> = None;
    let mut cooldown: Option<tokio::time::Instant> = None;
    loop {
        tokio::time::sleep(WATCHDOG_INTERVAL).await;
        if let Some(until) = cooldown {
            if tokio::time::Instant::now() < until {
                continue;
            }
            cooldown = None;
            reloads = 0;
        }

        let Some(window) = handle.get_webview_window(embed::window_label()) else {
            continue;
        };
        if !window_observable(&window) {
            // Neither healthy nor dead: the page is allowed to be silent while the user
            // cannot see it, so this sample says nothing about the renderer. Restarting
            // the silence clock here is what keeps the first sample after the window is
            // brought back from reading the whole unseen stretch as a crash - which made
            // every reopen reload a live page and spend its first seconds booting the
            // client again instead of showing the interface that was already there.
            supervisor.liveness().note_unobserved();
            continue;
        }
        if supervisor.status().phase != core::supervisor::KernelPhase::Ready {
            // A dead kernel is the supervisor's problem, not the renderer's; and
            // while it is down the page legitimately has no sockets to offer.
            reloads = 0;
            healthy_since = None;
            continue;
        }
        if !supervisor.liveness().window_stale() {
            match healthy_since {
                None => healthy_since = Some(tokio::time::Instant::now()),
                Some(since) if since.elapsed() >= WATCHDOG_STABLE => {
                    healthy_since = None;
                    reloads = 0;
                }
                _ => {}
            }
            continue;
        }
        healthy_since = None;

        reloads += 1;
        if reloads <= WATCHDOG_RELOADS {
            eprintln!(
                "[watchdog] window silent while the kernel is ready; reload {reloads}/{WATCHDOG_RELOADS}"
            );
            let _ = window.reload();
        } else if reloads == WATCHDOG_RELOADS + 1 {
            eprintln!("[watchdog] reloads did not revive the window; showing the recovery page");
            let _ = window.eval("location.replace('/__shell/')");
        } else {
            eprintln!(
                "[watchdog] window still dead after a full cycle; cooling down for {}s",
                WATCHDOG_COOLDOWN.as_secs()
            );
            cooldown = Some(tokio::time::Instant::now() + WATCHDOG_COOLDOWN);
            continue;
        }
        tokio::time::sleep(WATCHDOG_GRACE).await;
    }
}
