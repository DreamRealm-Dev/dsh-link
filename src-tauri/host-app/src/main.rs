//! Requirement D, the last boundary, as an application: a HOST that builds its own window and has DSH-LINK
//! attach the shell's webview INSIDE it.
//!
//! This is not another binary of the shell package. It is a separate crate with its own `identifier`, its own
//! `tauri.conf.json`, its own `generate_context!` and its own `setup` - an application in the build sense, which is
//! what "接入其他 Tauri 应用" asks for. The shell contributes three things and nothing else:
//!
//!   * `embed::builder()` - the plugins the shell's runtime reaches for, on the host's builder.
//!   * `embed::boot_into_host(handle, config)` - the shell boots inside this application and attaches its webview
//!     into `config.attach_to`, a window THIS file built.
//!   * `embed::handle_run_event` - the shell's run-event half (close hides, appearance follows, exit stops the
//!     kernel child), which a host gets by passing it to `App::run`.
//!
//! What the host decides and the shell must not: the window's size, decorations, theme, title and lifetime.
//! What the shell still owns: the proxy on 127.0.0.1:31761, the kernel supervisor, the tray, and the page inside
//! the webview. Two consequences worth knowing before running this: the proxy port is fixed, so this host cannot
//! run beside the shipped shell, and the tray is part of the shell's lifetime model, so an embedded shell grows a
//! tray icon of its own.
//!
//! Run it with `cargo run -p host-app` (or `-- --window=host-window --webview=dsh-link-sidebar`).

fn labels_from_args() -> (String, String) {
    let mut window = String::from("host-window");
    let mut webview = String::from("dsh-link-sidebar");
    for arg in std::env::args().skip(1) {
        if let Some(value) = arg.strip_prefix("--window=") {
            window = value.to_string();
        } else if let Some(value) = arg.strip_prefix("--webview=") {
            webview = value.to_string();
        }
    }
    (window, webview)
}

fn main() {
    let (window_label, webview_label) = labels_from_args();
    eprintln!(
        "host-app: building window {window_label:?}, then asking dsh-link to attach its webview as {webview_label:?}"
    );
    let attach_to = window_label.clone();
    let shell_label = webview_label.clone();
    dsh_link_lib::embed::builder()
        .setup(move |app| {
            // The host's own window: a plain Window, no webview of its own, decorated and sized here. This is the
            // whole difference from `run_with`, which would build a window of the shell's own instead.
            // R411: a NORMAL application window with the interconnect as a PHONE-PROPORTION right sidebar. The host owns
            // the left workspace (860 logical px here); the shell gets a 420x800 slot down the right edge - the same
            // running instance, the same kernel and the same session, in a slot rather than over the whole window.
            tauri::WindowBuilder::new(app, window_label.as_str())
                .title("Host application")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 640.0)
                .build()?;
            // The shell boots inside THIS application and attaches into the window above.
            dsh_link_lib::embed::boot_into_host(
                app.handle(),
                dsh_link_lib::embed::HostEmbed::with_window_label(shell_label)
                    .attached_to(attach_to)
                    .in_slot(860.0, 0.0, 420.0, 800.0),
            )
        })
        .build(tauri::generate_context!())
        .expect("failed to build the host application")
        .run(|app, event| dsh_link_lib::embed::handle_run_event(app, event));
}