//! Self-update from this project's GitHub releases.
//!
//! The shape follows the DSH EAC desktop updater, which is the reference for a
//! community install with no signing certificate and no vendor feed: the releases list
//! API answers, the newest release carrying an asset for this platform is picked, the
//! asset is downloaded with resume, and a detached helper waits for this process to
//! exit before it installs and relaunches. Nothing but the repository has to exist —
//! publishing a release on GitHub is the whole distribution step.
//!
//! Two of EAC's field lessons are built in rather than rediscovered: the releases
//! *list* is read instead of the single latest release, because a project publishes
//! assets for several shells and only some releases carry this platform's; and
//! prerelease identifiers are compared by semver's rules, because comparing them by
//! their first number ranks beta.2 above rc.1.
//!
//! Scope: a Windows install replaces itself through the bundled installer. On other
//! platforms the check still runs and reports, and the install step refuses with that
//! reason instead of pretending.

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::Value;

/// Repository the updater reads. Overridden per install for testing and for a fork.
const DEFAULT_REPO: &str = "DreamRealm-Dev/dsh-link";

/// GitHub's release API root.
const DEFAULT_API: &str = "https://api.github.com/repos";

/// How many releases to scan. The list is read newest first, so this is only a bound on
/// how far back a release with this platform's asset is searched.
const RELEASE_PAGE: u32 = 20;

/// One parsed semver version, with the prerelease identifiers kept separate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    core: [u64; 3],
    pre: Vec<String>,
}

impl Version {
    /// Parse a tag or a version string. A leading `v` is ignored, missing core segments
    /// count as zero, and anything after the build metadata marker is dropped.
    ///
    /// # Arguments
    ///
    /// * `text` - version text as published, for example `v0.2.1-alpha.1`.
    pub fn parse(text: &str) -> Version {
        let trimmed = text.trim().trim_start_matches(['v', 'V']);
        let without_build = trimmed.split('+').next().unwrap_or(trimmed);
        let (core, pre) = match without_build.split_once('-') {
            Some((core, pre)) => (core, pre),
            None => (without_build, ""),
        };
        let mut numbers = [0u64; 3];
        for (index, part) in core.split('.').take(3).enumerate() {
            numbers[index] = part.parse().unwrap_or(0);
        }
        Version {
            core: numbers,
            pre: if pre.is_empty() {
                Vec::new()
            } else {
                pre.split('.').map(str::to_owned).collect()
            },
        }
    }
}

/// Semver ordering, prerelease identifiers included.
///
/// # Arguments
///
/// * `a` - left version. * `b` - right version.
pub fn compare(a: &Version, b: &Version) -> Ordering {
    match a.core.cmp(&b.core) {
        Ordering::Equal => {}
        other => return other,
    }
    match (a.pre.is_empty(), b.pre.is_empty()) {
        // A release outranks any prerelease of the same core version.
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        (true, true) => return Ordering::Equal,
        (false, false) => {}
    }
    for index in 0..a.pre.len().max(b.pre.len()) {
        match (a.pre.get(index), b.pre.get(index)) {
            (None, None) => break,
            // Fewer identifiers ranks lower: alpha < alpha.1.
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left), Some(right)) => match compare_identifier(left, right) {
                Ordering::Equal => {}
                other => return other,
            },
        }
    }
    Ordering::Equal
}

/// One prerelease identifier: numeric identifiers compare numerically and always rank
/// below alphanumeric ones, which compare by ASCII.
fn compare_identifier(left: &str, right: &str) -> Ordering {
    match (
        left.chars().all(|c| c.is_ascii_digit()),
        right.chars().all(|c| c.is_ascii_digit()),
    ) {
        (true, true) => {
            let left = left.parse::<u64>().unwrap_or(0);
            let right = right.parse::<u64>().unwrap_or(0);
            left.cmp(&right)
        }
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        (false, false) => left.cmp(right),
    }
}

/// One downloadable release asset.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
}

/// A newer release with the asset this platform installs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Update {
    pub version: String,
    pub asset: UpdateAsset,
}

/// Rank one asset name for this platform; lower is preferred, `None` is unusable.
///
/// The preference order is the installer, then a portable build, then any other x64
/// executable, then a plain archive: an install that can replace itself in place should
/// not have to unpack anything. The last executable tier exists because naming is the
/// publisher's, not this code's — requiring the word "setup" is exactly the mistake the
/// DSH EAC updater had to fix when its own releases changed how they spelled it, and a
/// release that names its installer something else should still update.
fn asset_rank(name: &str) -> Option<u8> {
    let lowered = name.to_ascii_lowercase();
    if !lowered.contains("x64") {
        return None;
    }
    if lowered.ends_with(".exe") {
        if lowered.contains("setup") {
            return Some(0);
        }
        if lowered.contains("portable") {
            return Some(1);
        }
        return Some(2);
    }
    if lowered.ends_with(".zip") {
        return Some(3);
    }
    None
}

/// Pick the release to install from a GitHub releases payload.
///
/// The list is scanned in the order GitHub returns it, newest first, and the first
/// release that is newer than the running version *and* carries an asset for this
/// platform wins. A release with no usable asset is skipped rather than ending the
/// scan: a project publishes assets for several shells, and only some releases carry
/// this one.
///
/// # Arguments
///
/// * `current` - the running version.
/// * `releases` - the parsed JSON body of the releases list endpoint.
pub fn pick_update(current: &str, releases: &Value) -> Option<Update> {
    let running = Version::parse(current);
    for release in releases.as_array()? {
        if release.get("draft").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(tag) = release.get("tag_name").and_then(Value::as_str) else {
            continue;
        };
        if compare(&Version::parse(tag), &running) != Ordering::Greater {
            continue;
        }
        let Some(assets) = release.get("assets").and_then(Value::as_array) else {
            continue;
        };
        let best = assets
            .iter()
            .filter_map(|asset| {
                let name = asset.get("name").and_then(Value::as_str)?;
                let rank = asset_rank(name)?;
                let url = asset.get("browser_download_url").and_then(Value::as_str)?;
                Some((
                    rank,
                    UpdateAsset {
                        name: name.to_owned(),
                        url: url.to_owned(),
                        size: asset.get("size").and_then(Value::as_u64).unwrap_or(0),
                    },
                ))
            })
            .min_by_key(|(rank, _)| *rank);
        if let Some((_, asset)) = best {
            return Some(Update {
                version: Version::parse(tag).core.iter().map(u64::to_string).collect::<Vec<_>>().join("."),
                asset,
            });
        }
    }
    None
}

/// What the updater is doing, as the tray and the log report it.
///
/// The installing half of this type is driven by the tray item, and a mobile build has no tray
/// (see the reserved surface in core::mobile): the command-line check still runs and still
/// reports these phases, so only the desktop-only constructions of them are dead there.
#[cfg_attr(mobile, allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdatePhase {
    Idle,
    Checking,
    UpToDate,
    Available(String),
    Downloading { version: String, percent: u64 },
    Installing(String),
    Failed(String),
}

impl UpdatePhase {
    /// One line for the tray tooltip and the log.
    pub fn describe(&self) -> String {
        match self {
            UpdatePhase::Idle => "更新：未检查".to_owned(),
            UpdatePhase::Checking => "更新：正在检查".to_owned(),
            UpdatePhase::UpToDate => "更新：已是最新".to_owned(),
            UpdatePhase::Available(version) => format!("更新：发现 {version}"),
            UpdatePhase::Downloading { version, percent } => {
                format!("更新：正在下载 {version}（{percent}%）")
            }
            UpdatePhase::Installing(version) => format!("更新：正在安装 {version}"),
            UpdatePhase::Failed(why) => format!("更新：失败（{why}）"),
        }
    }
}

/// Shared update state and the operations that move it.
#[derive(Clone)]
pub struct Updater {
    state: Arc<Mutex<UpdatePhase>>,
    current: Arc<String>,
}

/// The download-and-install operations are reachable from the tray item only, which is a
/// desktop surface: on a mobile build `check` is the whole of the updater that anything calls.
#[cfg_attr(mobile, allow(dead_code))]
impl Updater {
    /// Build an updater for the running version.
    ///
    /// # Arguments
    ///
    /// * `current` - the version this build reports.
    pub fn new(current: &str) -> Updater {
        Updater {
            state: Arc::new(Mutex::new(UpdatePhase::Idle)),
            current: Arc::new(current.to_owned()),
        }
    }

    /// The current phase.
    pub fn phase(&self) -> UpdatePhase {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    /// Replace the phase.
    ///
    /// # Arguments
    ///
    /// * `phase` - the phase to record.
    pub fn set(&self, phase: UpdatePhase) {
        let described = phase.describe();
        *self.state.lock().unwrap_or_else(|error| error.into_inner()) = phase;
        eprintln!("[update] {described}");
    }

    /// The repository to read, from `DSH_LINK_UPDATE_REPO` or the built-in default.
    fn repo() -> String {
        std::env::var("DSH_LINK_UPDATE_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_owned())
    }

    /// The release API root, overridable so a check can be exercised without publishing.
    fn api_root() -> String {
        std::env::var("DSH_LINK_UPDATE_API").unwrap_or_else(|_| DEFAULT_API.to_owned())
    }

    /// Ask GitHub for this project's releases.
    ///
    /// # Errors
    ///
    /// Any transport or status failure, and a body that is not the JSON this expects.
    pub async fn check(&self) -> Result<Option<Update>, String> {
        self.set(UpdatePhase::Checking);
        let url = format!(
            "{}/{}/releases?per_page={RELEASE_PAGE}",
            Self::api_root(),
            Self::repo()
        );
        let client = reqwest::Client::builder()
            .build()
            .map_err(|error| format!("build update client: {error}"))?;
        let response = client
            .get(url)
            .header(reqwest::header::USER_AGENT, "dsh-link")
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .send()
            .await
            .map_err(|error| format!("release request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("release request answered {status}"));
        }
        let body = response
            .text()
            .await
            .map_err(|error| format!("read release list: {error}"))?;
        let parsed: Value =
            serde_json::from_str(&body).map_err(|error| format!("parse release list: {error}"))?;
        Ok(pick_update(&self.current, &parsed))
    }

    /// Download an asset into `directory`, reporting progress through the phase.
    ///
    /// A partial file from an interrupted run is resumed with a range request, which is
    /// what makes a large installer survive a dropped connection.
    ///
    /// # Arguments
    ///
    /// * `update` - the release to fetch.
    /// * `directory` - where the asset is written.
    pub async fn download(&self, update: &Update, directory: &Path) -> Result<PathBuf, String> {
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("create {}: {error}", directory.display()))?;
        let destination = directory.join(&update.asset.name);
        let already = std::fs::metadata(&destination)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let client = reqwest::Client::builder()
            .build()
            .map_err(|error| format!("build download client: {error}"))?;
        let mut request = client
            .get(&update.asset.url)
            .header(reqwest::header::USER_AGENT, "dsh-link");
        if already > 0 && update.asset.size > already {
            request = request.header(reqwest::header::RANGE, format!("bytes={already}-"));
        } else if already > 0 {
            let _ = std::fs::remove_file(&destination);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("asset request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("asset request answered {status}"));
        }
        let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT;
        let mut written = if resumed { already } else { 0 };
        let total = if update.asset.size > 0 {
            update.asset.size
        } else {
            response.content_length().unwrap_or(0)
        };
        let mut options = std::fs::OpenOptions::new();
        options.create(true).write(true);
        if resumed {
            options.append(true);
        } else {
            options.truncate(true);
        }
        let mut file = options
            .open(&destination)
            .map_err(|error| format!("open {}: {error}", destination.display()))?;
        use std::io::Write;
        let mut stream = response.bytes_stream();
        let mut last_reported = u64::MAX;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("asset stream failed: {error}"))?;
            file.write_all(&chunk)
                .map_err(|error| format!("write {}: {error}", destination.display()))?;
            written += chunk.len() as u64;
            let percent = if total > 0 { written * 100 / total } else { 0 };
            if percent != last_reported {
                last_reported = percent;
                self.set(UpdatePhase::Downloading {
                    version: update.version.clone(),
                    percent,
                });
            }
        }
        file.flush()
            .map_err(|error| format!("flush {}: {error}", destination.display()))?;
        Ok(destination)
    }

    /// Install a downloaded asset and relaunch, leaving this process to exit.
    ///
    /// The helper waits for this process id to disappear before it runs the installer,
    /// because an installer cannot replace the files of a running application; it then
    /// starts the application again and deletes itself. Windows only: another platform
    /// gets the reason rather than a silent no-op.
    ///
    /// # Arguments
    ///
    /// * `installer` - the downloaded asset.
    /// * `directory` - where the helper script is written.
    /// * `executable` - the executable to relaunch.
    pub fn apply(&self, installer: &Path, directory: &Path, executable: &Path) -> Result<(), String> {
        if !cfg!(windows) {
            return Err("self-install is implemented for Windows installs only".to_owned());
        }
        if !installer
            .extension()
            .map(|extension| extension.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
        {
            return Err(format!(
                "{} is not an installer this build can run",
                installer.display()
            ));
        }
        let script = directory.join("dsh-link-update.cmd");
        let pid = std::process::id();
        let document = format!(
            "@echo off\r\n\
             rem Written by DSH Link: install once the application has exited.\r\n\
             :wait\r\n\
             tasklist /FI \"PID eq {pid}\" | find \"{pid}\" >nul && (timeout /t 1 /nobreak >nul & goto wait)\r\n\
             \"{}\" /S\r\n\
             start \"\" \"{}\"\r\n\
             del \"%~f0\"\r\n",
            installer.display(),
            executable.display()
        );
        std::fs::write(&script, document).map_err(|error| format!("write {}: {error}", script.display()))?;
        std::process::Command::new("cmd")
            .args(["/d", "/s", "/c", "start", "", "/min"])
            .arg(&script)
            .spawn()
            .map_err(|error| format!("start update helper: {error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn releases(body: &str) -> Value {
        serde_json::from_str(body).expect("fixture json")
    }

    #[test]
    fn orders_core_versions() {
        assert_eq!(compare(&Version::parse("0.2.0"), &Version::parse("v0.1.9")), Ordering::Greater);
        assert_eq!(compare(&Version::parse("1.0.0"), &Version::parse("1.0")), Ordering::Equal);
        assert_eq!(compare(&Version::parse("1.0.0+build.5"), &Version::parse("1.0.0")), Ordering::Equal);
    }

    #[test]
    fn ranks_releases_above_prereleases_and_orders_identifiers() {
        assert_eq!(compare(&Version::parse("1.0.0"), &Version::parse("1.0.0-rc.1")), Ordering::Greater);
        assert_eq!(compare(&Version::parse("1.0.0-beta.2"), &Version::parse("1.0.0-rc.1")), Ordering::Less);
        assert_eq!(compare(&Version::parse("1.0.0-rc.10"), &Version::parse("1.0.0-rc.2")), Ordering::Greater);
        assert_eq!(compare(&Version::parse("1.0.0-alpha.1"), &Version::parse("1.0.0-alpha")), Ordering::Greater);
        assert_eq!(compare(&Version::parse("1.0.0-1"), &Version::parse("1.0.0-alpha")), Ordering::Less);
    }

    #[test]
    fn picks_the_newest_release_that_carries_this_platform() {
        let body = r#"[
          {"tag_name":"v0.3.0","draft":false,"assets":[{"name":"DSH-Link-0.3.0-arm64.dmg","browser_download_url":"https://example.invalid/mac","size":10}]},
          {"tag_name":"v0.2.0","draft":false,"assets":[
            {"name":"DSH-Link-0.2.0-portable-x64.exe","browser_download_url":"https://example.invalid/portable","size":20},
            {"name":"DSH-Link-0.2.0-Setup-x64.exe","browser_download_url":"https://example.invalid/setup","size":30}]},
          {"tag_name":"v0.1.0","draft":false,"assets":[{"name":"DSH-Link-0.1.0-Setup-x64.exe","browser_download_url":"https://example.invalid/old","size":40}]}
        ]"#;
        let picked = pick_update("0.1.0", &releases(body)).expect("an update");
        assert_eq!(picked.version, "0.2.0");
        assert_eq!(picked.asset.name, "DSH-Link-0.2.0-Setup-x64.exe");
    }

    #[test]
    fn reports_nothing_when_the_running_version_is_current() {
        let body = r#"[{"tag_name":"v0.1.0","draft":false,"assets":[{"name":"Setup-x64.exe","browser_download_url":"https://example.invalid/setup","size":1}]}]"#;
        assert_eq!(pick_update("0.1.0", &releases(body)), None);
        assert!(pick_update("0.1.0", &releases("[]")).is_none());
    }

    #[test]
    fn accepts_an_installer_that_does_not_say_setup() {
        let body = r#"[{"tag_name":"v0.2.0","draft":false,"assets":[
          {"name":"DeepSeek.Harness-0.2.0-x64.exe","browser_download_url":"https://example.invalid/plain","size":5},
          {"name":"DSH-Link-0.2.0-Setup-x64.exe","browser_download_url":"https://example.invalid/setup","size":6}]}]"#;
        let picked = pick_update("0.1.0", &releases(body)).expect("an update");
        assert_eq!(picked.asset.name, "DSH-Link-0.2.0-Setup-x64.exe");
        let only_plain = r#"[{"tag_name":"v0.2.0","draft":false,"assets":[
          {"name":"DeepSeek.Harness-0.2.0-x64.exe","browser_download_url":"https://example.invalid/plain","size":5}]}]"#;
        assert_eq!(
            pick_update("0.1.0", &releases(only_plain)).map(|update| update.asset.name).as_deref(),
            Some("DeepSeek.Harness-0.2.0-x64.exe")
        );
    }

    #[test]
    fn skips_drafts_and_releases_without_a_usable_asset() {
        let body = r#"[
          {"tag_name":"v9.9.9","draft":true,"assets":[{"name":"Setup-x64.exe","browser_download_url":"https://example.invalid/x","size":1}]},
          {"tag_name":"v9.0.0","draft":false,"assets":[{"name":"DSH-Link-9.0.0-linux.tar.gz","browser_download_url":"https://example.invalid/y","size":1}]}
        ]"#;
        assert_eq!(pick_update("0.1.0", &releases(body)), None);
    }

    #[test]
    fn describes_every_phase_in_the_tooltip() {
        for phase in [
            UpdatePhase::Idle,
            UpdatePhase::Checking,
            UpdatePhase::UpToDate,
            UpdatePhase::Available("0.2.0".to_owned()),
            UpdatePhase::Downloading { version: "0.2.0".to_owned(), percent: 42 },
            UpdatePhase::Installing("0.2.0".to_owned()),
            UpdatePhase::Failed("no network".to_owned()),
        ] {
            assert!(!phase.describe().is_empty());
        }
    }
}
