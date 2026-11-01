//! The on-disk profile the kernel is launched with.
//!
//! `DSH_HOME` is the kernel's single source of truth for sessions, settings,
//! credentials, skills, and plugin state. We own it under the app config dir so
//! two installs never share state, and we seed two editable documents there: a
//! cordis patch overlay (kernel composition) and the launch metadata the UI
//! reports. Both are seeded once and then belong to the user.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Absolute paths this app owns for one kernel launch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePaths {
    /// `DSH_HOME` for the kernel process.
    pub home: PathBuf,
    /// Cordis patch overlay handed to `dsh web --patch`.
    pub overlay: PathBuf,
    /// Where the kernel writes its own boot log for this app.
    pub log: PathBuf,
    /// User settings document (`settings.yaml`).
    pub settings: PathBuf,
    /// Writable agent-preset root.
    pub presets: PathBuf,
    /// Where the kernel stores plugin bundles.
    pub profiles: PathBuf,
}

/// Seeded cordis overlay. The shipped `web` profile already composes every
/// official plugin, and the listen address is supplied on the command line, so
/// the seed carries one decision only: which directory picker the window gets.
///
/// It exists because `--patch` is the supported extension point for adjusting
/// kernel composition without forking DSH. Rows use the loader's two forms:
/// `- id: <row>` replaces one entry's `config`, and `- insert: [...]` adds
/// entries. Editing this file and restarting the app is how you add or trim
/// kernel plugins.
///
/// The document must parse as a top-level YAML **array**: the loader rejects a
/// mapping, and a comment-only file parses as null and is rejected the same way,
/// so the seed carries its entries as array items rather than as a mapping.
pub const OVERLAY_SEED: &str = r#"# DSH Link 内核覆盖层
#
# 每次启动内核都会以 `--patch` 传入本文件。
#
# DSH 官方 `web` profile 已经组合了全部官方插件；监听地址由命令行
# `--host 127.0.0.1 --port 31760` 决定。
# 在这里增删插件或改写 config，无需改动 DSH 源码。
#
# 两种写法：
#   - id: <row>            替换该行 config（可加 disabled: true 关掉该行）
#   - insert:              追加新行
#
# 例：给每个会话加一段工作目录提示
# - id: system-prompt
#   config:
#     personaSuffix: Your working directory is {{cwd}}.
#
# 例：开启全文会话检索（默认是关闭的内存索引）
# - id: session-query-sqlite
#   config:
#     path: ':memory:'
#     openAt: first-search

# 注意：不要在这里覆盖"设置"页面会编辑的行（例如 session-log-deepseek）。
# 被 home patch 或命令行覆盖层盖住的条目，在设置表单里会变成只读——
# config-editor 会以 "overridden by a home patch or command-line overlay" 拒绝写入。
# 这类"默认值"应当写进 profile 自己的 patch 文档（见 PROFILE_PATCH_SEED）。

# 目录选择器固定为应用内浏览式选择器。
#
# 默认行 `directory-picker`（dsh-host-directory-picker-auto）在本机解析为
# Windows 原生选择器：它由 Node 子进程弹窗，任务栏里因此显示 Node 图标，且
# 在远程桌面/受控会话（RDP、向日葵等）下会以 "win32 folder dialog worker
# exited before reporting a result" 崩溃。关掉该行并显式组合 browse 后端与其
# 浏览器界面即可绕开，无需伪装 SSH_CONNECTION（那会让 dsh-host-open-in-app
# 把"打开方式"解析成空表，会话头部的打开方式整块消失）。
# 行对与官方 apps/web/tests/pin-browse-picker.overlay.yml 一致。
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
"#;

/// Rows this app seeds once into the profile's own patch document.
///
/// The settings form writes that same document, and it refuses to edit an entry
/// a home patch or a `--patch` overlay already overrides (see the config-editor
/// contract). A default therefore belongs here rather than in the overlay seed:
/// seeded here, the switch keeps working and the user's later choice wins.
///
/// `session-log-deepseek` defaults to `enabled: true` upstream, which uploads
/// Session Log with DeepSeek API requests. DSH Link ships it off.
const PROFILE_PATCH_SEED: &[(&str, &str)] = &[(
    "session-log-deepseek",
    r#"# DSH Link 写入一次：默认关闭「在使用官方模型 API 时上传 Session Log」。
# 放在 profile patch 而不是 --patch 覆盖层，是为了让"设置 → 通用"里的开关保持可写。
- id: session-log-deepseek
  name: "@deepseek-ai/dsh-session-log-deepseek"
  config:
    enabled: false
"#,
)];

/// Append any missing seeded row to the profile's own patch document.
///
/// The kernel creates `profiles/web/` (and its patch document) on its first run,
/// so a launch before that seeds nothing and the next launch seeds it. Existing
/// content — including the user's own rows and comments — is preserved.
fn seed_profile_patch(home: &Path) {
    let path = home.join("profiles").join("web").join("cordis.patch.yml");
    let Ok(existing) = std::fs::read_to_string(&path) else {
        return;
    };
    let missing: Vec<&str> = PROFILE_PATCH_SEED
        .iter()
        .filter(|(id, _)| !existing.contains(&format!("id: {id}")))
        .map(|(_, body)| *body)
        .collect();
    if missing.is_empty() {
        return;
    }
    let mut document = existing;
    // A document that is exactly the empty array has to lose it: YAML cannot
    // carry array items after a closed flow sequence.
    let trimmed = document.trim_end();
    if let Some(head) = trimmed.strip_suffix("[]") {
        document = head.to_owned();
    }
    if !document.ends_with('\n') {
        document.push('\n');
    }
    for body in missing {
        document.push('\n');
        document.push_str(body);
    }
    if let Err(error) = std::fs::write(&path, document) {
        eprintln!("[profile] could not seed {}: {error}", path.display());
    }
}

/// Create the profile directories and seed the overlay if it is absent.
///
/// The listen address is not a profile concern: it is passed to the kernel on the
/// command line by [`super::supervisor`].
///
/// # Errors
///
/// Propagates any filesystem error; a half-created profile would make the kernel
/// fail with a much less legible message.
pub fn ensure(config_root: &Path) -> Result<ProfilePaths, String> {
    let home = config_root.join("kernel-home");
    let profiles = home.join("profiles");
    let presets = home.join(".agent-presets");
    for dir in [&home, &profiles, &presets] {
        std::fs::create_dir_all(dir)
            .map_err(|error| format!("create {}: {error}", dir.display()))?;
    }

    let overlay = home.join("dsh-link.patch.yml");
    if !overlay.exists() {
        std::fs::write(&overlay, OVERLAY_SEED)
            .map_err(|error| format!("seed {}: {error}", overlay.display()))?;
    }
    seed_profile_patch(&home);

    let log = home.join("boot.log");
    let settings = home.join("settings.yaml");
    Ok(ProfilePaths {
        home,
        overlay,
        log,
        settings,
        presets,
        profiles,
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    fn profile_patch(home: &Path) -> PathBuf {
        home.join("profiles").join("web").join("cordis.patch.yml")
    }

    #[test]
    fn seeds_the_switch_off_into_an_empty_template() {
        let home = std::env::temp_dir().join("dsh-link-seed-empty");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(profile_patch(&home).parent().unwrap()).unwrap();
        std::fs::write(profile_patch(&home), "# template only\n").unwrap();
        seed_profile_patch(&home);
        let seeded = std::fs::read_to_string(profile_patch(&home)).unwrap();
        assert!(seeded.contains("id: session-log-deepseek"));
        assert!(seeded.contains("enabled: false"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn replaces_an_empty_array_instead_of_appending_to_it() {
        let home = std::env::temp_dir().join("dsh-link-seed-array");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(profile_patch(&home).parent().unwrap()).unwrap();
        std::fs::write(profile_patch(&home), "[]\n").unwrap();
        seed_profile_patch(&home);
        let seeded = std::fs::read_to_string(profile_patch(&home)).unwrap();
        assert!(!seeded.contains("[]"));
        assert!(seeded.contains("- id: session-log-deepseek"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn keeps_an_existing_row_and_the_users_own_edits() {
        let home = std::env::temp_dir().join("dsh-link-seed-present");
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(profile_patch(&home).parent().unwrap()).unwrap();
        let existing = "- id: session-log-deepseek\n  config:\n    enabled: true\n";
        std::fs::write(profile_patch(&home), existing).unwrap();
        seed_profile_patch(&home);
        assert_eq!(std::fs::read_to_string(profile_patch(&home)).unwrap(), existing);
        let _ = std::fs::remove_dir_all(&home);
    }
}
