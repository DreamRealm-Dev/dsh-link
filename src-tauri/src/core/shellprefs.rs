//! The shell's own window preferences: the corner radius and the palette.
//!
//! Windows 11 rounds a framed window itself, and DWM will happily clip a window to
//! its own radius. This shell draws none of that: the radius is a *setting* — the
//! slider in 设置 → 主题 — anywhere from 0 to 28 CSS pixels, which no system constant
//! can express. So the window is transparent and undecorated, the page paints the
//! rounded surface (see [`super::frame`]), and what lives here is the value.
//!
//! Two facts about the value drive the design:
//!
//! - It is persisted in `shell.json` beside the kernel home, so a cold start draws the
//!   frame the user last chose rather than a default — and the boot page, which renders
//!   before any kernel exists, can be stamped with it.
//! - It is applied *live*. Nothing here rebuilds a window or restarts a session: the
//!   radius is a CSS custom property on the page and the palette is a document
//!   attribute, so one script evaluation is the whole handover.
//!
//! The palette is the application's preference, not the operating system's. That is the
//! point of the setting: the official client's own theme toggle is the single source of
//! truth, and the shell follows it — including on the boot page, which used to follow
//! `prefers-color-scheme` and therefore painted a black surface in a light workspace.
//! Until the client has ever chosen, the palette is the system's, which is what the
//! shell did before this setting existed.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// Smallest corner radius, in CSS pixels. Square corners are a legitimate choice.
pub const RADIUS_MIN: f64 = 0.0;

/// Largest corner radius, in CSS pixels. Past this the frame stops reading as a window
/// and starts eating the client's own top row.
pub const RADIUS_MAX: f64 = 28.0;

/// Radius a fresh install starts with. The skin's `--lg-radius-window` default matches
/// it, so the shell's frame and the client's own panels start life with one corner.
pub const RADIUS_DEFAULT: f64 = 12.0;

/// Content gap a fresh install starts with, in CSS pixels: the distance between the
/// client's own viewport and the window's edge, the same on all four sides. It is the
/// frame the window no longer has — with no system title bar or border, the client's
/// panels would otherwise *be* the window's edge — and it is also the canvas the shadow
/// in [`super::frame`] falls on.
pub const GAP_DEFAULT: f64 = 12.0;

/// Largest gap the endpoint accepts. Past this the client's viewport is a strip.
pub const GAP_MAX: f64 = 64.0;

/// The application's colour preference.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Palette {
    Light,
    Dark,
}

impl Palette {
    /// The wire and file spelling.
    pub fn as_str(self) -> &'static str {
        match self {
            Palette::Light => "light",
            Palette::Dark => "dark",
        }
    }

    pub fn is_dark(self) -> bool {
        matches!(self, Palette::Dark)
    }

    /// Read the spelling the control endpoint and `shell.json` use.
    pub fn parse(text: &str) -> Option<Self> {
        match text.trim().to_ascii_lowercase().as_str() {
            "light" => Some(Palette::Light),
            "dark" => Some(Palette::Dark),
            _ => None,
        }
    }

    /// The operating system's appearance, which is the palette until the client picks
    /// one of its own.
    pub fn from_system() -> Self {
        if crate::system_is_dark() {
            Palette::Dark
        } else {
            Palette::Light
        }
    }
}

/// The live values, plus where the palette came from.
#[derive(Clone, Copy, Debug)]
pub struct ShellPrefs {
    radius: f64,
    /// Content inset from the window's edge, in CSS pixels. One value for all four
    /// sides; the top also carries the frame's drag strip.
    gap: f64,
    palette: Palette,
    /// `true` once the client has chosen a palette through the endpoint. While it is
    /// false the palette tracks the operating system, so an appearance change still
    /// repaints the window the way it did before this setting existed.
    explicit: bool,
}

impl ShellPrefs {
    pub fn radius(&self) -> f64 {
        self.radius
    }

    pub fn gap(&self) -> f64 {
        self.gap
    }

    pub fn palette(&self) -> Palette {
        self.palette
    }

    /// What the shell uses before anything has been stored: the default corner, and the
    /// operating system's appearance, which is the palette until the client picks one.
    pub fn from_system() -> Self {
        Self {
            radius: RADIUS_DEFAULT,
            gap: GAP_DEFAULT,
            palette: Palette::from_system(),
            explicit: false,
        }
    }

    /// The gap the contract asks for: a usable number, or the default.
    ///
    /// Unlike the radius — which is clamped, because every value in its range is a
    /// legitimate one — the gap is documented as falling back to [`GAP_DEFAULT`] when it
    /// is missing or unusable, so a typo in a settings file cannot leave the client
    /// flush against the window's edge.
    pub fn gap_or_default(gap: f64) -> f64 {
        if gap.is_finite() && (0.0..=GAP_MAX).contains(&gap) {
            gap
        } else {
            GAP_DEFAULT
        }
    }

    fn clamped(radius: f64) -> f64 {
        if radius.is_finite() {
            radius.clamp(RADIUS_MIN, RADIUS_MAX)
        } else {
            RADIUS_DEFAULT
        }
    }
}

/// What `shell.json` holds. Deliberately two flat keys: the file is a control surface a
/// script may write, so it stays readable and order-independent.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct Stored {
    radius: f64,
    #[serde(default)]
    gap: Option<f64>,
    palette: Palette,
}

/// The shared store: the values, where they came from, and where they are written.
///
/// Cloned into application state rather than kept behind a global, so the endpoint, the
/// window builder and the appearance watcher all reach the same values.
#[derive(Clone)]
pub struct ShellWindow {
    path: PathBuf,
    prefs: Arc<Mutex<ShellPrefs>>,
}

/// What the control endpoint answers with.
///
/// `radius` and `palette` are the contract; `explicit` and `path` answer the two
/// questions a caller would otherwise have to guess at — whether the palette is the
/// application's or still the operating system's, and which file the values are written
/// to — so one request is enough to report all four facts.
#[derive(Serialize)]
struct Wire<'a> {
    radius: f64,
    gap: f64,
    palette: Palette,
    explicit: bool,
    path: &'a str,
}

/// R179-A: the sidebar browser's persisted page-viewport choice, in its own file beside
/// `shell.json`.
///
/// The same pattern as the window preferences and for the same reason: it is a choice the user
/// made, it has to survive a restart, and a file that cannot be read must not stop the browser from
/// opening (the contract's 1280x800 is a legitimate answer, not a failure). It is a file of its own
/// because `ShellWindow::save` rewrites shell.json from its own three keys - anything the browser
/// stored in there would be dropped by the next theme change.
pub struct BrowserPrefs {
    pub viewport: (f64, f64),
    /// "fixed" or "fit", as the panel spells it. An empty string means the file said nothing, and
    /// the caller keeps the default.
    pub mode: String,
}

/// What `browser.json` holds. Two flat keys, like `shell.json`: the file is a control surface a
/// script may write, so it stays readable and order-independent.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct StoredBrowser {
    viewport: StoredViewport,
    #[serde(default)]
    mode: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
struct StoredViewport {
    w: f64,
    h: f64,
}

/// Where the browser's own choices live: the app's config directory, beside `shell.json`. The NAME of
/// the file is the browser's business (sidebar_panel::BROWSER_PREFS_FILE) and arrives as an argument, so
/// there is exactly one place that spells it.
pub fn browser_prefs_path(config_root: &Path, file: &str) -> PathBuf {
    config_root.join(file)
}

/// Read the browser's persisted choice. `None` means "nothing usable was stored" - no file, an
/// unreadable file, or numbers that are not a viewport - and the caller keeps its default.
pub fn read_browser_prefs(path: &Path) -> Option<BrowserPrefs> {
    let text = fs::read_to_string(path).ok()?;
    let stored: StoredBrowser = match serde_json::from_str(&text) {
        Ok(stored) => stored,
        Err(error) => {
            eprintln!(
                "[shell] {} is not usable ({error}); the browser keeps its default resolution",
                path.display()
            );
            return None;
        }
    };
    let (w, h) = (stored.viewport.w, stored.viewport.h);
    if !(w.is_finite() && h.is_finite()) || w <= 0.0 || h <= 0.0 {
        eprintln!("[shell] {} stores a viewport of {w}x{h}, which is not one", path.display());
        return None;
    }
    Some(BrowserPrefs {
        viewport: (w, h),
        mode: stored.mode.unwrap_or_default(),
    })
}

/// Write the browser's choice out. Reported rather than fatal, the same rule `ShellWindow::save`
/// follows: a read-only config directory must not stop the browser from being used.
pub fn write_browser_prefs(path: &Path, viewport: (f64, f64), mode: &str) -> Result<(), String> {
    let stored = StoredBrowser {
        viewport: StoredViewport {
            w: viewport.0,
            h: viewport.1,
        },
        mode: Some(mode.to_string()),
    };
    let body = serde_json::to_string_pretty(&stored)
        .map_err(|error| format!("encode {}: {error}", path.display()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    fs::write(path, format!("{body}\n")).map_err(|error| format!("write {}: {error}", path.display()))
}

impl ShellWindow {
    /// The control endpoint's reply, as JSON.
    pub fn wire(&self) -> String {
        let live = self.get();
        let path = self.path.to_string_lossy();
        let wire = Wire {
            radius: live.radius,
            gap: live.gap,
            palette: live.palette,
            explicit: live.explicit,
            path: path.as_ref(),
        };
        serde_json::to_string(&wire).unwrap_or_else(|_| String::from("{}"))
    }

    /// Read `shell.json` from the shell's own config directory (`<app config>/dsh-link`,
    /// the directory the kernel home sits in), falling back to defaults.
    ///
    /// A file that cannot be read is not an error worth refusing to start over: the
    /// window still opens, with the default corner and the system palette.
    pub fn load(config_root: &Path) -> Self {
        let path = config_root.join("shell.json");
        let prefs = match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Stored>(&text) {
                Ok(stored) => ShellPrefs {
                    radius: ShellPrefs::clamped(stored.radius),
                    // An older file has no gap at all, and that has to read as the
                    // default rather than as zero.
                    gap: stored.gap.map_or(GAP_DEFAULT, ShellPrefs::gap_or_default),
                    palette: stored.palette,
                    // A file only ever exists because something chose a palette.
                    explicit: true,
                },
                Err(error) => {
                    eprintln!("[shell] {} is not usable ({error}); using defaults", path.display());
                    ShellPrefs {
                        radius: RADIUS_DEFAULT,
                        gap: GAP_DEFAULT,
                        palette: Palette::from_system(),
                        explicit: false,
                    }
                }
            },
            Err(_) => ShellPrefs {
                radius: RADIUS_DEFAULT,
                gap: GAP_DEFAULT,
                palette: Palette::from_system(),
                explicit: false,
            },
        };
        let store = Self {
            path,
            prefs: Arc::new(Mutex::new(prefs)),
        };
        // A first launch has no file yet. Writing one immediately keeps the value the
        // window is actually using observable — by the endpoint, by a verification
        // script, and by the user.
        if !store.path.is_file() {
            if let Err(why) = store.save() {
                eprintln!("[shell] could not write {}: {why}", store.path.display());
            }
        }
        let live = store.get();
        eprintln!(
            "[shell] window preferences: radius={}px gap={}px palette={} ({}) from {}",
            live.radius,
            live.gap,
            live.palette.as_str(),
            if live.explicit { "chosen" } else { "system" },
            store.path.display()
        );
        store
    }

    pub fn get(&self) -> ShellPrefs {
        *self.prefs.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// Write the live values out. Reported rather than fatal: a read-only config
    /// directory must not take the window down.
    pub fn save(&self) -> Result<(), String> {
        let live = self.get();
        let stored = Stored {
            radius: live.radius,
            gap: Some(live.gap),
            palette: live.palette,
        };
        let body = serde_json::to_string_pretty(&stored)
            .map_err(|error| format!("encode shell.json: {error}"))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("create {}: {error}", parent.display()))?;
        }
        fs::write(&self.path, format!("{body}\n"))
            .map_err(|error| format!("write {}: {error}", self.path.display()))
    }

    /// Apply an update from the control endpoint: clamp, store, push to the live window,
    /// then persist.
    ///
    /// The order matters. The window is updated first, so an unwritable config directory
    /// still leaves the user's change in force for this session; the write follows, and
    /// its failure is handed back to the caller to report.
    pub fn update(
        &self,
        app: &tauri::AppHandle,
        radius: Option<f64>,
        gap: Option<f64>,
        palette: Option<Palette>,
    ) -> Result<ShellPrefs, String> {
        {
            let mut prefs = self.prefs.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(radius) = radius {
                prefs.radius = ShellPrefs::clamped(radius);
            }
            if let Some(gap) = gap {
                prefs.gap = ShellPrefs::gap_or_default(gap);
            }
            if let Some(palette) = palette {
                prefs.palette = palette;
                prefs.explicit = true;
            }
        }
        self.apply(app);
        self.save()?;
        Ok(self.get())
    }

    /// Follow the operating system's appearance, unless the client has chosen one.
    ///
    /// Returns whether anything moved; the caller uses that to decide whether the
    /// window needs its surface repainted.
    pub fn follow_system(&self, app: &tauri::AppHandle) -> bool {
        let system = Palette::from_system();
        let moved = {
            let mut prefs = self.prefs.lock().unwrap_or_else(|error| error.into_inner());
            if prefs.explicit || prefs.palette == system {
                false
            } else {
                prefs.palette = system;
                true
            }
        };
        if moved {
            self.apply(app);
            if let Err(why) = self.save() {
                eprintln!("[shell] could not persist the system appearance: {why}");
            }
        }
        moved
    }

    /// Put the current values on the live window.
    ///
    /// No window is rebuilt and no session is touched: the radius and the palette are
    /// page state, so this is one evaluation into the document the window already
    /// shows — the client's, or the boot page when the kernel is down. The frame script
    /// is installed by both documents ([`super::frame`]), so the evaluation lands
    /// either way; when it has not been installed yet the page reads the same values
    /// back from `GET /__shell/window` on its own.
    pub fn apply(&self, app: &tauri::AppHandle) {
        let live = self.get();
        // The shell's webview, wherever it lives: standalone it IS the window, and embedded (see
        // crate::embed::HostEmbed::attach_to) it is a child of the host's window. Its parent is the window either
        // way, which is what the theme belongs to; the frame script belongs to the webview.
        let Some(webview) = crate::embed::webview(app) else {
            return;
        };
        let window = webview.window();
        // `prefers-color-scheme` inside the webview is the window's own theme, and the
        // palette is the application's preference, not the system's: handing it to the
        // platform here is what keeps a scrollbar, a select or the client's own boot
        // overlay from painting light inside a dark workspace.
        let theme = if live.palette.is_dark() {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        };
        let _ = window.set_theme(Some(theme));
        let palette = serde_json::to_string(live.palette.as_str())
            .unwrap_or_else(|_| String::from("\"dark\""));
        let script = format!(
            "window.__dshShellFrame && window.__dshShellFrame.apply({{ radius: {}, gap: {}, palette: {} }})",
            live.radius, live.gap, palette
        );
        if let Err(error) = webview.eval(&script) {
            eprintln!("[shell] could not push the window preferences: {error}");
        }
    }
}
