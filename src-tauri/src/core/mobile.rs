//! Which engine renders the client on Android, and how a side-loaded WebView
//! provider would be selected.
//!
//! Desktop resolves the engine in two shapes: the platform webview (WKWebView on
//! macOS, WebKitGTK on Linux) or, on Windows, the Fixed Version WebView2 runtime
//! pinned by `pin_webview2_runtime` in the crate root. Android adds a third: the
//! WebView *provider* is a separate, replaceable APK, so "which engine renders the
//! client" is a device-level choice this app can observe and, on a debuggable
//! device, influence by side-loading a provider and selecting it.
//!
//! Nothing here installs or selects anything yet. The reserved contract is: the
//! Android build names a provider package through `DSH_LINK_WEBVIEW_PROVIDER`, and
//! [`select_provider`] is the single handoff that would act on it. Desktop builds
//! compile the same call and resolve [`ProviderPlan::System`], so the seam costs
//! nothing until an Android build exists.

/// The engine the Android build should render the client with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderPlan {
    /// Whatever the device has selected. Android's own default, and every desktop.
    System,
    /// A provider APK shipped with (or installed beside) the app, by package name.
    Sideloaded(String),
}

/// Environment variable naming the provider package to prefer.
///
/// Read on every platform so a misconfigured desktop build reports the
/// Android-only intent instead of silently ignoring it.
pub const PROVIDER_ENV: &str = "DSH_LINK_WEBVIEW_PROVIDER";

/// Resolve the plan from the environment.
///
/// An empty or whitespace-only value counts as unset: it would otherwise read as a
/// request for a provider named "".
pub fn plan() -> ProviderPlan {
    match std::env::var(PROVIDER_ENV) {
        Ok(package) if !package.trim().is_empty() => ProviderPlan::Sideloaded(package.trim().to_owned()),
        _ => ProviderPlan::System,
    }
}

/// Make `package` the device's WebView implementation.
///
/// Android gives an app no API for this. The paths that exist are the user picking
/// a provider under Developer options → WebView implementation, and, on a
/// debuggable device, `adb shell cmd webviewupdate set-webview-implementation
/// <package>`. An app can only observe the current provider
/// (`WebViewCompat.getCurrentWebViewPackage`) and hand the user to that screen.
///
/// The Android implementation is therefore reserved: it must report the observed
/// provider and route the user to the platform's chooser, and is deliberately not
/// written before an Android build exists to test it against.
#[cfg(target_os = "android")]
pub fn select_provider(package: &str) -> Result<(), String> {
    Err(format!(
        "reserved: selecting WebView provider {package} is not implemented on Android yet"
    ))
}

/// Provider selection is Android-only; desktop builds must not pretend otherwise.
#[cfg(not(target_os = "android"))]
pub fn select_provider(package: &str) -> Result<(), String> {
    Err(format!(
        "WebView provider selection is Android-only, unavailable for {package}"
    ))
}

/// The one refusal an Android build gives for a seam it still owes.
///
/// The sidebar browser is a set of child webviews placed by pixel inside a decorated desktop
/// window: `Window::add_child`, `Webview::set_bounds`, `Webview::set_focus` and
/// `Webview::close` are all compiled for desktop builds only, because a mobile webview is not a
/// window Tauri can parent another one to. Android renders the client in the activity's single
/// webview, so every entry point that would create or place a child answers with this reserved
/// refusal instead of reaching for an API that does not exist there. The wording is the same
/// "not implemented on Android yet" the provider handoff uses: both name a seam that a real
/// Android build still owes, not a permanent verdict.
///
/// Compiled on every platform on purpose: the device bridge (super::device_bridge) has to
/// answer an unimplemented operation with this same sentence, and that module's tests run on
/// the host, where a cfg(mobile) item would not exist at all.
pub fn reserved(what: &str) -> String {
    format!("reserved: {what} is not implemented on Android yet")
}

/// Report the resolved plan once at startup.
///
/// A side-loaded plan that cannot be acted on yet is reported rather than silently
/// downgraded: the app would otherwise render with the system provider while the
/// operator believes the side-loaded one is in use.
pub fn report() {
    if let ProviderPlan::Sideloaded(package) = plan() {
        match select_provider(&package) {
            Ok(()) => eprintln!("[shell] Android WebView provider: {package}"),
            Err(error) => eprintln!("[shell] Android WebView provider request: {error}"),
        }
    }
}
