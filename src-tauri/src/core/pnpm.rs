//! The package manager this install ships.
//!
//! `dsh plugin add` shells out to pnpm — the plugin manager's `pnpmCommand`, resolved
//! through `PATH` by default — so a desktop install cannot assume the machine has one.
//! The shell therefore ships the pnpm package's own bundle and runs it under the same
//! Node the kernel runs under, behind a shim handed to the kernel two ways.
//!
//! The explicit way is a generated `--patch` overlay naming the shim as
//! `pnpmCommand`. The reserved way is a `PATH` entry for the child, which covers every
//! other caller that spawns a bare `pnpm` — a plugin's own install script, for
//! instance. Both name the same shim, so an install that resolves one and not the other
//! still gets this pnpm, and a machine with no bundle at all falls back to whatever
//! `pnpm` the user has, exactly as the kernel does without this shell.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::locator;

/// The bundled pnpm entry, relative to a resources directory.
const ENTRY: &str = "pnpm/bin/pnpm.mjs";

/// The row whose `pnpmCommand` this install overrides.
const PLUGIN_MANAGER_ROW: &str = "plugin-manager";

/// A bundled pnpm, ready to hand to the kernel.
pub struct PnpmRuntime {
    /// Directory holding the shims; also prepended to the child's `PATH`.
    pub bin: PathBuf,
    /// The shim itself, which is what `pnpmCommand` names.
    pub command: PathBuf,
    /// The bundled entry the shim runs.
    pub entry: PathBuf,
}

impl PnpmRuntime {
    /// Write the generated overlay that names this pnpm, and return its path.
    ///
    /// Written on every launch rather than seeded once: it describes where the shell
    /// found its own bundle, which is an install fact, not a preference. A failure to
    /// write is reported and drops the overlay — the child's `PATH` still carries the
    /// same shim.
    ///
    /// # Arguments
    ///
    /// * `home` - the kernel's `DSH_HOME`.
    pub fn write_overlay(&self, home: &Path) -> Option<PathBuf> {
        let path = home.join("dsh-link.runtime.patch.yml");
        let document = format!(
            "# DSH Link 每次启动重写：本安装自带的包管理器。\n\
             # 与用户可编辑的 dsh-link.patch.yml 分开，避免覆盖用户的选择。\n\
             # 入口: {}\n\
             - id: {PLUGIN_MANAGER_ROW}\n\
             \x20 name: \"@deepseek-ai/dsh-plugin-manager\"\n\
             \x20 config:\n\
             \x20   pnpmCommand: '{}'\n",
            self.entry.display(),
            self.command.display()
        );
        match std::fs::write(&path, document) {
            Ok(()) => Some(path),
            Err(error) => {
                eprintln!("[pnpm] could not write {}: {error}", path.display());
                None
            }
        }
    }

    /// The child's `PATH`, with the shim directory ahead of the machine's own.
    ///
    /// # Returns
    ///
    /// `None` when the resulting list cannot be joined, in which case the child keeps
    /// the inherited `PATH` and the overlay remains the only route to this pnpm.
    pub fn child_path(&self) -> Option<OsString> {
        let mut dirs = vec![self.bin.clone()];
        dirs.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        std::env::join_paths(dirs).ok()
    }
}

/// Locate the bundled pnpm and write its shims.
///
/// # Arguments
///
/// * `config_root` - app config root; the shims live in a writable directory under it
///   because an installed app directory may not be writable.
/// * `exe_dir` - directory of the running executable, where bundled resources sit.
///
/// # Returns
///
/// `None` when this install ships no bundle, which is the documented fallback.
pub fn prepare(config_root: &Path, exe_dir: Option<PathBuf>) -> Option<PnpmRuntime> {
    let entry = locate_entry(exe_dir)?;
    let bin = config_root.join("bin");
    std::fs::create_dir_all(&bin).ok()?;
    let command = write_shim(&bin, &entry)?;
    eprintln!("[pnpm] bundled package manager: {}", entry.display());
    Some(PnpmRuntime { bin, command, entry })
}

/// The bundled entry, under any of the layouts an executable can find its resources in.
fn locate_entry(exe_dir: Option<PathBuf>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe_dir {
        candidates.push(dir.join(ENTRY));
        candidates.push(dir.join("resources").join(ENTRY));
        // macOS app bundles keep resources beside the executable's parent.
        candidates.push(dir.join("..").join("Resources").join(ENTRY));
    }
    // The development run has no resource copy at all: take the checkout's own tree. The
    // directory is derived at run time so a published binary does not carry the build path.
    if let Some(crate_dir) = locator::dev_manifest_dir() {
        candidates.push(crate_dir.join("resources").join(ENTRY));
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// Write the platform shim that runs `entry` under `node`, and return its path.
fn write_shim(bin: &Path, entry: &Path) -> Option<PathBuf> {
    let quoted = entry.display().to_string();
    if cfg!(windows) {
        let path = bin.join("pnpm.cmd");
        let script = format!("@echo off\r\nnode \"{quoted}\" %*\r\n");
        std::fs::write(&path, script).ok()?;
        return Some(path);
    }
    let path = bin.join("pnpm");
    let script = format!("#!/bin/sh\nexec node \"{quoted}\" \"$@\"\n");
    std::fs::write(&path, script).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::Permissions::from_mode(0o755);
        std::fs::set_permissions(&path, mode).ok()?;
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_bundled_entry_in_the_generated_overlay() {
        let home = std::env::temp_dir().join("dsh-link-pnpm-overlay");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let runtime = PnpmRuntime {
            bin: home.join("bin"),
            command: home.join("bin").join("pnpm.cmd"),
            entry: home.join("pnpm").join("bin").join("pnpm.mjs"),
        };
        let path = runtime.write_overlay(&home).expect("overlay");
        let written = std::fs::read_to_string(&path).unwrap();
        assert!(written.contains("- id: plugin-manager"));
        assert!(written.contains("pnpmCommand:"));
        assert!(written.contains("pnpm.cmd"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn prepends_its_own_bin_directory_to_the_child_path() {
        let runtime = PnpmRuntime {
            bin: PathBuf::from("C:\\dsh-link\\bin"),
            command: PathBuf::from("C:\\dsh-link\\bin\\pnpm.cmd"),
            entry: PathBuf::from("C:\\dsh-link\\pnpm\\bin\\pnpm.mjs"),
        };
        let joined = runtime.child_path().expect("path");
        let first = std::env::split_paths(&joined).next().unwrap();
        assert_eq!(first, runtime.bin);
    }
}
