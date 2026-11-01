//! Locating the vendored DSH kernel and proving it is runnable.
//!
//! The kernel is a source checkout, not a compiled artifact of this crate, so
//! every launch re-verifies that the checkout exists and that its CLI entry and
//! web frontend are present. A missing build is reported as an actionable
//! instruction rather than a spawn failure the user cannot interpret.

use std::path::{Path, PathBuf};

/// What `locate` found, or why it could not proceed.
pub enum KernelLocation {
    /// A usable checkout at this path.
    Ready(PathBuf),
    /// The checkout is absent.
    Missing(PathBuf),
    /// Dependencies are not installed.
    NotInstalled(PathBuf),
    /// Dependencies are installed but `apps/web/dist` was never built.
    NotBuilt(PathBuf),
}

impl KernelLocation {
    /// A message suitable for the UI's kernel panel.
    pub fn describe(&self) -> String {
        match self {
            KernelLocation::Ready(path) => path.display().to_string(),
            KernelLocation::Missing(path) => format!(
                "DSH kernel checkout not found at {}. Run: npm run core:install",
                path.display()
            ),
            KernelLocation::NotInstalled(path) => format!(
                "DSH kernel dependencies are missing at {}. Run: npm run core:install",
                path.display()
            ),
            KernelLocation::NotBuilt(path) => format!(
                "DSH kernel web frontend is not built at {}. Run: npm run core:build",
                path.display()
            ),
        }
    }
}

/// Resolve the kernel checkout relative to this crate's manifest directory.
///
/// The checkout lives at `<repo>/core/deepseek-harness`, and `CARGO_MANIFEST_DIR`
/// is `<repo>/src-tauri` in both dev and bundled runs, so one parent hop finds it
/// either way.
pub fn kernel_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|repo| repo.join("core").join("deepseek-harness"))
        .unwrap_or_else(|| PathBuf::from("core").join("deepseek-harness"))
}

/// CLI entry booted with `node --import tsx/esm`.
pub fn cli_entry(root: &Path) -> PathBuf {
    root.join("apps").join("cli").join("src").join("bin.ts")
}

/// The web profile's built frontend, served by the kernel's static handler.
pub fn web_dist_index(root: &Path) -> PathBuf {
    root.join("apps").join("web").join("dist").join("index.html")
}

/// Classify the checkout at `root`.
pub fn locate(root: &Path) -> KernelLocation {
    if !cli_entry(root).is_file() {
        return KernelLocation::Missing(root.to_path_buf());
    }
    if !root.join("node_modules").is_dir() {
        return KernelLocation::NotInstalled(root.to_path_buf());
    }
    if !web_dist_index(root).is_file() {
        return KernelLocation::NotBuilt(root.to_path_buf());
    }
    KernelLocation::Ready(root.to_path_buf())
}

/// Read the kernel's declared version straight from its root manifest.
pub fn kernel_version(root: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(root.join("package.json")).ok()?;
    let manifest: serde_json::Value = serde_json::from_str(&raw).ok()?;
    manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}
