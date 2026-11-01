//! Embedding DSH-LINK into ANOTHER Tauri application (requirement D).
//!
//! The product shipped so far is an application, not a library: `run()` builds its own
//! `tauri::Builder::default()` and owns the process. A host application that wants this sidebar inside
//! its own window needs three things it cannot get from an application - a crate it can depend on, a way to
//! enter it with ITS configuration, and a window label that is not hard-coded to `"main"` (a host already
//! has a main window, and two windows cannot share one label).
//!
//! What this module is, measured rather than promised:
//!
//!   * `HostEmbed` is the configuration a host hands in. Today it carries the one thing the rest of the
//!     crate really reads - the window label - and nothing else, because a field nobody reads is a promise.
//!   * `window_label()` is what every site in this crate now asks for the label, instead of the literal
//!     that used to sit in seven places. Sets the default for the application entry point
//!     (`HostEmbed::default()`), so an ordinary launch keeps the label it always had.
//!   * `run_with(config)` is the entry a host calls. It records the configuration ONCE (a second call is
//!     refused by name rather than silently ignored) and then runs exactly the application entry point, so
//!     there is one code path and not two behaviours to keep in step.
//!
//!   * `attached_to(label)` is the last thing requirement D asks for: the name of a window the HOST already built.
//!     With it set, the shell stops creating a window and attaches its webview INTO that one (`Window::add_child`),
//!     so the host keeps its window, its decorations and its identity and the shell contributes the page inside it.
//!     Unset - which is every ordinary launch - nothing about the window changes.
//!   * `boot_into_host(app, config)` is the entry for a host that keeps its OWN `tauri::Builder`: it records the
//!     configuration and boots the shell inside the application the host built. `run_with` is for a host content
//!     to own the process rather than the application object.
//!
//! What this module is NOT: a plugin registry. `crate::builder()` carries the two plugins the shell's runtime
//! reaches for, because a host should not have to know why they are there; the rest of what the shell needs it
//! installs itself in `crate::boot()`.

use std::sync::OnceLock;

use tauri::Manager;

/// The crate-root halves of the shell a host needs, re-exported so that one module is enough to embed: the
/// builder to start from, the boot to run, and the run-event handler to end with. They live at the crate root
/// because their bodies read the shell's own internals (the proxy, the supervisor, the tray); what a host may
/// call is this surface, not those internals.
pub use crate::{boot, builder, handle_run_event};

/// What a host application hands in: the label the shell's webview runs under, and - when the host already
/// has a window - the label of the window to attach into.
///
/// `window_label` must differ from any label the host already uses: two webviews cannot share a label, and the
/// shell addresses this one by name in seven places (the single-instance handler, the tray's show/hide, the
/// boot-time window creation, and the sidebar panes that place a native panel on it).
#[derive(Clone, Debug, PartialEq)]
pub struct HostEmbed {
    /// The label of the webview this embed owns. The application default is `"main"`.
    ///
    /// Standalone this is the window's label too. Attached (see `attach_to`) the window belongs to the host, so
    /// this names only the webview inside it.
    pub window_label: String,
    /// The label of a window the HOST built, when the shell is to attach inside it instead of building its own.
    ///
    /// `None` is the application's own window. `Some(label)` means: that window exists already (a plain
    /// `tauri::Window`, with no webview of its own), it is the host's to decorate and to size, and the shell's
    /// webview is added as its child. A label this application does not have is refused at boot with the name in
    /// the message, because the alternative - quietly building a window of our own under the host's label - would
    /// look exactly like a successful embed while being none.
    pub attach_to: Option<String>,
    /// Where inside the host window the shell's webview is placed, in logical pixels.
    ///
    /// `None` means the whole client area, which is what an embed has always done. `Some(rect)` is the shape the product
    /// actually needs: a NORMAL application window with the shell as a PHONE-PROPORTION right sidebar, so the host keeps
    /// its own workspace on the left and the interconnect lives down the right edge - the same instance, the same kernel,
    /// the same session, just in a slot instead of over the whole window.
    pub slot: Option<Slot>,
}

/// A rectangle inside the host window, in logical pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Default for HostEmbed {
    fn default() -> Self {
        Self {
            window_label: String::from("main"),
            attach_to: None,
            slot: None,
        }
    }
}

impl HostEmbed {
    /// The default configuration under a different window label, which is what a host wants.
    pub fn with_window_label(label: impl Into<String>) -> Self {
        Self {
            window_label: label.into(),
            attach_to: None,
            slot: None,
        }
    }

    /// The same configuration, attaching the shell's webview into a window the host has already built.
    /// Place the shell in a rectangle inside the host window instead of over its whole client area.
    /// @param x - left edge, logical pixels.
    /// @param y - top edge, logical pixels.
    /// @param w - width, logical pixels.
    /// @param h - height, logical pixels.
    pub fn in_slot(mut self, x: f64, y: f64, w: f64, h: f64) -> Self {
        self.slot = Some(Slot { x, y, w, h });
        self
    }

    pub fn attached_to(mut self, host_window: impl Into<String>) -> Self {
        self.attach_to = Some(host_window.into());
        self
    }
}

/// The configuration this process is running with. Unset until `run_with` (or `run`) records it.
static CONFIG: OnceLock<HostEmbed> = OnceLock::new();

/// Record the configuration. The second caller is told its configuration was not applied.
pub fn install(next: HostEmbed) -> Result<HostEmbed, HostEmbed> {
    // OnceLock::set answers Result<(), T>; this crate's callers want the value back on success (a host
    // reading back what it installed), so the unit is turned into the configuration that is now in force.
    // The parameter is called `next` on purpose: naming it `config` shadows this module's own config() and
    // the compiler reads the call as a call to the parameter (E0618, measured once).
    CONFIG.set(next).map(|()| self::config())
}

/// The label every window lookup in this crate uses. `"main"` before a configuration is installed, which
/// is exactly what an ordinary launch installs - so a caller that never calls `run_with` sees no change.
pub fn window_label() -> &'static str {
    match CONFIG.get() {
        Some(config) => config.window_label.as_str(),
        None => "main",
    }
}

/// The configuration in force, for a host that wants to read back what it installed.
pub fn config() -> HostEmbed {
    match CONFIG.get() {
        Some(config) => config.clone(),
        None => HostEmbed::default(),
    }
}

/// Run DSH-LINK with a host's configuration.
///
/// This is the entry a host application calls from its own `main`/`setup`. It records the configuration
/// and then runs the one application entry point - not a second copy of it - so the embedded and the
/// standalone paths cannot drift.
///
/// # Panics
/// Panics when a configuration was already installed by somebody else: a host that believes its label is
/// in force while another label is would address a window that does not exist, and there is no reading
/// that could tell it so later.
pub fn run_with(config: HostEmbed) {
    let label = config.window_label.clone();
    if let Err(existing) = install(config) {
        panic!(
            "dsh-link: run_with was called with window label {label:?} but this process already runs as {:?}: \
             a window label is installed once per process",
            existing.window_label
        );
    }
    crate::run();
}

/// Boot the shell inside an application the HOST built.
///
/// A host that keeps its own `tauri::Builder` - its own identifier, its own `generate_context!`, its own plugins -
/// cannot call `run_with`: that entry builds the application. It starts from `crate::builder()` instead, creates the
/// window it wants to hand over in its own `setup`, and calls this:
///
/// ```no_run
/// `use dsh_link_lib::embed::{boot_into_host, HostEmbed, builder};`
/// `fn main() {`
/// `    builder()`
/// `        .setup(|app| {`
/// `            // The window the HOST built, with no webview of its own.`
/// `            tauri::WindowBuilder::new(app, "host-window").inner_size(1280.0, 800.0).build()?;`
/// `            let config = HostEmbed::with_window_label("dsh-link-sidebar").attached_to("host-window");`
/// `            boot_into_host(app.handle(), config)`
/// `        })`
/// `        .build(tauri::generate_context!())`
/// `        .expect("failed to build the host application")`
/// `        .run(|app, event| dsh_link_lib::embed::handle_run_event(app, event));`
/// `}`
/// ```
///
/// The window must exist before this is called, and it must be a window with no webview of its own: the shell
/// adds its webview as a child. A label this application does not have is an error naming that label - not a
/// window of our own under the host's name, which would look like an embed and not be one.
///
/// # Panics
/// Panics when a configuration was already installed, for the same reason `run_with` does: two labels in one
/// process means one of them is wrong, and nothing later could tell which.
pub fn boot_into_host(
    app: &tauri::AppHandle,
    config: HostEmbed,
) -> Result<(), Box<dyn std::error::Error>> {
    let label = config.window_label.clone();
    if let Err(existing) = install(config) {
        panic!(
            "dsh-link: boot_into_host was called with window label {label:?} but this process already runs as {:?}: \
             a window label is installed once per process",
            existing.window_label
        );
    }
    crate::boot(app)
}

/// The window the shell's webview lives in, whatever created it.
///
/// Standalone that is the window this crate built and labelled. Embedded (see `HostEmbed::attach_to`) the webview
/// is a child of the HOST's window, whose label belongs to the host: asking for our label there finds no window,
/// which would be the wrong answer twice over. The webview knows its parent either way, so the lookup goes through
/// it. The callers that need a window rather than a webview - the browser panel places a native child webview on
/// it, the frame pushes the palette and the radius into it - ask here.
pub fn window(app: &tauri::AppHandle) -> Option<tauri::Window> {
    webview(app).map(|webview| webview.window())
}

/// The shell's webview, whatever created it. See [`window`].
pub fn webview(app: &tauri::AppHandle) -> Option<tauri::Webview> {
    app.get_webview(window_label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_application_default_is_the_label_the_crate_always_used() {
        assert_eq!(HostEmbed::default().window_label, "main");
    }

    #[test]
    fn a_host_can_name_its_own_window() {
        let config = HostEmbed::with_window_label("host-sidebar");
        assert_eq!(config.window_label, "host-sidebar");
        assert_ne!(config, HostEmbed::default());
    }

    #[test]
    fn a_host_can_name_the_window_it_already_built() {
        let config = HostEmbed::with_window_label("dsh-link-sidebar").attached_to("host-window");
        assert_eq!(config.attach_to.as_deref(), Some("host-window"));
        assert_eq!(config.window_label, "dsh-link-sidebar");
        // The application's own configuration attaches to nothing: an ordinary launch keeps building its window.
        assert_eq!(HostEmbed::default().attach_to, None);
    }

    #[test]
    fn a_label_is_installed_once_per_process() {
        // The global is shared by every test in this binary, so this test asserts the CONTRACT rather than
        // calling `run_with` (which would run the whole application): the first install wins and the second
        // is refused with the value it tried to install.
        let first = install(HostEmbed::with_window_label("first-embed"));
        if first.is_ok() {
            let second = install(HostEmbed::with_window_label("second-embed"));
            assert!(second.is_err(), "a second install must be refused");
            assert_eq!(second.unwrap_err().window_label, "second-embed");
            assert_eq!(window_label(), "first-embed");
        } else {
            // Another test in this binary installed first: the refusal is the fact under test.
            assert_eq!(first.unwrap_err().window_label, "first-embed");
        }
    }
}
