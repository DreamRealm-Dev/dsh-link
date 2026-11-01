//! Child-process supervision for the DSH kernel.
//!
//! One kernel runs for the lifetime of one app instance. Readiness is decided in
//! three steps, because each one alone is insufficient:
//!
//! 1. The kernel announces itself on stdout with an authenticated URL carrying a
//!    launch token. The shell reads that line off a pipe.
//! 2. The shell exchanges the token for the signed session cookie and stores it.
//!    Until that succeeds no request can succeed — see [`super::session`].
//! 3. The shell polls the kernel's HTTP root until it answers *with* the cookie,
//!    which separates "bound but not yet serving" from "ready".
//!
//! Stdout is piped rather than redirected so the announcement can be watched;
//! both streams are copied into a boot log, because the kernel is a long-lived
//! background service whose output is the only diagnostic when it refuses to
//! start. The launch token is redacted out of that log: it is a live credential
//! and the log is rendered in the UI.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::Notify;

use super::liveness::Liveness;
use super::locator::{self, KernelLocation};
use super::profile::{self, ProfilePaths};
use super::session::{CredentialStore, KernelCredentials, parse_launch_token};

/// Loopback port the kernel listens on. Fixed so a restart reuses the address the
/// frontend already knows, and chosen away from the ports the other DSH
/// installations on this machine use.
pub const KERNEL_PORT: u16 = 31760;

/// How long the shell waits for the kernel's startup announcement. A cold start
/// materialises the whole web profile, so this is generous on purpose.
const ANNOUNCE_TIMEOUT: Duration = Duration::from_secs(180);

/// Post-announcement readiness poll: 60 x 500 ms.
const READY_ATTEMPTS: u32 = 60;
const READY_INTERVAL: Duration = Duration::from_millis(500);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// The kernel runs under Node, resolved from `PATH`. On Windows a `node` shim
/// resolves to `node.exe`, so the bare name is correct on both platforms.
const NODE_EXECUTABLE: &str = "node";

/// The directory the running executable sits in, where bundled resources live.
///
/// # Returns
///
/// `None` when the path cannot be read, in which case the bundled resources are
/// simply not found and the install keeps its inherited environment.
fn executable_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
}

/// Placeholder written into the boot log in place of a live launch token.
const TOKEN_PLACEHOLDER: &str = "<launch-token>";

/// How the kernel is doing, as the UI needs to show it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KernelPhase {
    /// Not started.
    Stopped,
    /// Launched; waiting for the announcement, the token exchange, or the first
    /// HTTP answer.
    Starting,
    /// Answering HTTP with a valid session; the frontend may call `/api`.
    Ready,
    /// Exited or refused to start.
    Failed,
}

/// One snapshot of the kernel, safe to serialise to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelStatus {
    pub phase: KernelPhase,
    pub pid: Option<u32>,
    pub port: u16,
    /// Kernel's declared version, read from its own manifest.
    pub version: Option<String>,
    /// Absolute path of the kernel checkout, for the diagnostics panel.
    pub root: String,
    /// Absolute `DSH_HOME` for this launch.
    pub home: String,
    /// Absolute path of the boot log.
    pub log: String,
    /// Present when `phase` is `Failed`.
    pub message: Option<String>,
}

/// The live child, the profile it was launched with, and its announcement signal.
struct Running {
    child: Child,
    paths: ProfilePaths,
    /// Signalled once stdout has been scanned, whether or not an announcement
    /// appeared in it.
    announced: Arc<Notify>,
}

/// What [`KernelSupervisor::begin_launch`] decided, so the caller can await the
/// right thing without holding the slot across an await point.
enum Launch {
    /// The kernel is already authenticated; nothing to wait for.
    AlreadyReady,
    /// Join a launch that is already in flight.
    Join(Arc<Notify>),
    /// Wait for this launch's own announcement.
    Spawned(Arc<Notify>),
}

/// Owns at most one kernel child process.
#[derive(Clone)]
pub struct KernelSupervisor {
    slot: Arc<Mutex<Option<Running>>>,
    root: Arc<PathBuf>,
    /// App config root; the kernel profile lives beneath it.
    config_root: Arc<PathBuf>,
    /// Session credentials, shared with the proxy.
    credentials: Arc<CredentialStore>,
    /// Window liveness signals, fed by the proxy and consumed by the recovery
    /// watchdog in `lib.rs`.
    liveness: Arc<Liveness>,
    /// Failure diagnosis for the current launch, computed once from the boot log
    /// and cleared when a new launch begins.
    diagnosis: Arc<Mutex<Option<String>>>,
    /// The authenticated URL from the most recent launch's stdout.
    launch_url: Arc<Mutex<Option<String>>>,
}

impl KernelSupervisor {
    /// Build a supervisor bound to a kernel checkout and an app config root.
    pub fn new(root: PathBuf, config_root: PathBuf) -> Self {
        Self {
            slot: Arc::new(Mutex::new(None)),
            root: Arc::new(root),
            config_root: Arc::new(config_root),
            credentials: Arc::new(CredentialStore::new()),
            liveness: Arc::new(Liveness::default()),
            diagnosis: Arc::new(Mutex::new(None)),
            launch_url: Arc::new(Mutex::new(None)),
        }
    }

    /// Session credentials, for the proxy router to attach.
    pub fn credentials(&self) -> Arc<CredentialStore> {
        Arc::clone(&self.credentials)
    }

    /// Window liveness signals, for the proxy to feed and the watchdog to read.
    pub fn liveness(&self) -> Arc<Liveness> {
        Arc::clone(&self.liveness)
    }

    /// The kernel's DSH_HOME for this install, which is where its settings,
    /// credentials and profile documents live. Available before the first launch,
    /// unlike the path in the status snapshot, which is empty until a child runs.
    pub fn home(&self) -> PathBuf {
        self.config_root.join("kernel-home")
    }

    /// The current launch's failure diagnosis, computed from the boot log at most
    /// once per launch. Failure states persist across status polls (the boot page
    /// samples every 750 ms), so the log tail must not be re-read per poll.
    fn diagnose_once(&self) -> Option<String> {
        let mut guard = Self::lock(&self.diagnosis);
        if guard.is_none() {
            *guard = diagnose(&self.log_path());
        }
        guard.clone()
    }

    /// Lock a mutex, recovering from a poisoned lock.
    ///
    /// A panic while holding these locks cannot have left the child half-owned, so
    /// taking the inner value is safer than propagating the panic into every later
    /// status read.
    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|error| error.into_inner())
    }

    /// Read the current status, reaping an exited child first.
    pub fn status(&self) -> KernelStatus {
        let mut guard = Self::lock(&self.slot);

        let exited = match guard.as_mut() {
            Some(running) => match running.child.try_wait() {
                Ok(Some(exit)) => Some(exit.to_string()),
                Ok(None) => None,
                Err(_) => Some("unknown status".to_owned()),
            },
            None => None,
        };
        let Some(code) = exited else {
            return match guard.as_ref() {
                Some(running) => {
                    let phase = if self.credentials.get().is_some() {
                        KernelPhase::Ready
                    } else {
                        KernelPhase::Starting
                    };
                    self.status_for(phase, Some(running.child.id()), &running.paths, None)
                }
                None => self.status_for(KernelPhase::Stopped, None, &EMPTY_PATHS, None),
            };
        };

        // A child that exited invalidates the session: its cookie is dead, and a
        // stale one would turn the next launch's 401 into a credential problem.
        self.credentials.clear();
        let paths = guard
            .take()
            .map(|running| running.paths)
            .unwrap_or_else(|| EMPTY_PATHS.clone());
        let mut message = format!("kernel exited with {code}; see {}", paths.log.display());
        if let Some(diagnosis) = self.diagnose_once() {
            message.push_str("\n诊断：");
            message.push_str(&diagnosis);
        }
        self.status_for(KernelPhase::Failed, None, &paths, Some(message))
    }

    /// Start the kernel if it is not already running, and wait until it is ready.
    ///
    /// # Errors
    ///
    /// Returns a user-facing message naming the boot log when the checkout is not
    /// built, the child cannot be spawned, it exits during startup, it never
    /// announces itself, the token exchange fails, or it never serves.
    pub async fn ensure_running(&self) -> Result<KernelStatus, String> {
        let root = match locator::locate(&self.root) {
            KernelLocation::Ready(root) => root,
            other => return Err(other.describe()),
        };

        // The launch decision is made under the lock but nothing awaits while it
        // is held: a `MutexGuard` is not `Send`, and Tauri requires the returned
        // future to be one.
        let readiness = match self.begin_launch(&root)? {
            Launch::AlreadyReady => return Ok(self.status()),
            Launch::Join(existing) => existing,
            Launch::Spawned(fresh) => fresh,
        };

        self.await_ready(readiness).await.map_err(|error| {
            let mut message = error;
            if let Some(diagnosis) = self.diagnose_once() {
                message.push_str("\n诊断：");
                message.push_str(&diagnosis);
            }
            message
        })
    }

    /// Decide what `ensure_running` should do about the child, spawning one when
    /// the slot is empty or holds an exited child.
    ///
    /// # Errors
    ///
    /// Returns a message when the profile cannot be prepared or the child cannot
    /// be spawned.
    fn begin_launch(&self, root: &Path) -> Result<Launch, String> {
        let mut guard = Self::lock(&self.slot);
        if let Some(running) = guard.as_mut() {
            if running.child.try_wait().ok().flatten().is_none() {
                if self.credentials.get().is_some() {
                    return Ok(Launch::AlreadyReady);
                }
                // A launch is already in flight: join it rather than starting a
                // second child on the same port.
                return Ok(Launch::Join(Arc::clone(&running.announced)));
            }
            // The previous child is gone; drop it so the port is released before
            // the replacement binds.
            self.credentials.clear();
            guard.take();
            // Windows can land a kill long after the API reports it, and a
            // replacement bound inside that gap dies with EADDRINUSE — a failure
            // that reads as a kernel bug rather than a scheduling artifact. Hold
            // off until the port is bindable; after a bounded wait, proceed anyway
            // and let the kernel's own bind error name the occupant. (Same lesson,
            // same fix window as Deepseek Harness EAC's boot supervisor; see
            // THIRD-PARTY-NOTICES.md.) The lock is dropped across the wait because
            // it can last seconds, and the slot is re-decided afterwards in case
            // another launch slipped in meanwhile.
            drop(guard);
            wait_for_port_free(KERNEL_PORT);
            let mut guard = Self::lock(&self.slot);
            if let Some(running) = guard.as_mut() {
                if running.child.try_wait().ok().flatten().is_none() {
                    return Ok(if self.credentials.get().is_some() {
                        Launch::AlreadyReady
                    } else {
                        Launch::Join(Arc::clone(&running.announced))
                    });
                }
                guard.take();
            }
            return self.launch_child(root, guard);
        }

        self.launch_child(root, guard)
    }

    /// Spawn the kernel child, register it in the slot, and start its log reader.
    ///
    /// Split from [`Self::begin_launch`] because the relaunch path has to release
    /// and re-acquire the slot lock across the port wait, so the tail of the
    /// procedure must be callable with either guard.
    fn launch_child(&self, root: &Path, mut guard: MutexGuard<'_, Option<Running>>) -> Result<Launch, String> {
        let paths = profile::ensure(&self.config_root)?;
        // Nothing of ours is writing yet, which is what makes this safe: the child does not
        // exist. See core::writerlock for what an empty lock would otherwise cost.
        let recovered = super::writerlock::release_stale(&paths.profiles);
        let log_file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&paths.log)
            .map_err(|error| format!("open boot log {}: {error}", paths.log.display()))?;
        let log_err = log_file
            .try_clone()
            .map_err(|error| format!("clone boot log handle: {error}"))?;
        // Written before the child is spawned, so a launch that recovered something says so
        // above the kernel's own first line, in the log the failure states already point at.
        {
            use std::io::Write as _;
            for report in &recovered {
                eprintln!("[supervisor] {}", report.line);
                let _ = writeln!(&log_file, "{}", report.line);
            }
        }

        // `dsh web` boots the shipped web profile. Launcher flags must precede the
        // first token the launcher does not recognise, so `--patch` goes first and
        // the web app's own flags follow it.
        let entry = locator::cli_entry(root);
        let overlay = paths.overlay.clone();
        let home = paths.home.clone();
        // The bundled pnpm: a generated overlay names it for the plugin manager, and the
        // child's PATH carries the same shim for every other caller. Both go before the
        // web app's own flags, because the launcher only accepts `--patch` ahead of the
        // first token it does not recognise.
        let pnpm = super::pnpm::prepare(&self.config_root, executable_dir());
        let runtime_overlay = pnpm
            .as_ref()
            .and_then(|runtime| runtime.write_overlay(&home));
        let mut command = Command::new(NODE_EXECUTABLE);
        command
            .current_dir(&root)
            .arg("--import")
            .arg("tsx/esm")
            .arg(&entry)
            .arg("web")
            .arg("--patch")
            .arg(&overlay);
        if let Some(path) = &runtime_overlay {
            command.arg("--patch").arg(path);
        }
        command
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(KERNEL_PORT.to_string())
            .arg("--no-open")
            .env("DSH_HOME", &home)
            // The shell renders approval and question prompts itself, so the kernel
            // must not block a session behind an interactive prompt.
            .env("DSH_PERMISSION_MODE", "danger-full-access")
            // Leftovers from other DSH installs and Node tooling leak straight into
            // the kernel: a global NODE_OPTIONS adds a second preloader to the boot,
            // ELECTRON_RUN_AS_NODE flips Node's mode, and a stale DSH_WEB_URL makes
            // the web surface advertise a dead address. (Same scrub the DSH EAC
            // desktop performs before spawning; see THIRD-PARTY-NOTICES.md.)
            .env_remove("NODE_OPTIONS")
            .env_remove("ELECTRON_RUN_AS_NODE")
            .env_remove("DSH_WEB_URL")
            .env_remove("DSH_SESSION_ID")
            // Keep escape sequences out of the captured log.
            .env("NO_COLOR", "1")
            .env("FORCE_COLOR", "0");
        if let Some(runtime) = pnpm.as_ref() {
            if let Some(path) = runtime.child_path() {
                command.env("PATH", path);
            }
        }
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log_err))
            .spawn()
            .map_err(|error| format!("spawn kernel ({NODE_EXECUTABLE}): {error}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "the kernel child was spawned without a stdout pipe".to_owned())?;

        // The reader thread and the readiness wait both need the announcement
        // signal, so the child slot records one handle and the caller keeps the other.
        let announced = Arc::new(Notify::new());
        *Self::lock(&self.launch_url) = None;
        *Self::lock(&self.diagnosis) = None;
        self.spawn_log_reader(
            stdout,
            paths.log.clone(),
            Arc::clone(&announced),
            Arc::clone(&self.launch_url),
        );

        let readiness = Arc::clone(&announced);
        *guard = Some(Running {
            child,
            paths,
            announced,
        });

        Ok(Launch::Spawned(readiness))
    }

    /// Wait for the announcement, exchange the token, then poll until the kernel
    /// serves HTTP.
    ///
    /// # Arguments
    ///
    /// * `announced` - signalled once stdout has been scanned.
    async fn await_ready(&self, announced: Arc<Notify>) -> Result<KernelStatus, String> {
        let log = self.log_path();
        let signalled = tokio::time::timeout(ANNOUNCE_TIMEOUT, announced.notified())
            .await
            .is_ok();
        if !signalled {
            return Err(format!(
                "kernel did not announce itself within {}s; see {}",
                ANNOUNCE_TIMEOUT.as_secs(),
                log.display()
            ));
        }

        let Some(launch) = Self::lock(&self.launch_url).clone() else {
            return Err(format!(
                "kernel started but printed no authenticated URL; see {}",
                log.display()
            ));
        };
        let Some(token) = parse_launch_token(&launch) else {
            return Err(format!(
                "kernel announced a URL without a launch token; see {}",
                log.display()
            ));
        };

        let base = format!("http://127.0.0.1:{KERNEL_PORT}");
        let cookie = super::session::exchange(&base, &token)
            .await
            .map_err(|error| format!("{error}; see {}", log.display()))?;
        self.credentials.set(KernelCredentials {
            base: base.clone(),
            cookie,
        });

        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(PROBE_TIMEOUT)
            .build()
            .map_err(|error| format!("build probe client: {error}"))?;
        for _ in 0..READY_ATTEMPTS {
            if let Some(exit) = self.exited_child() {
                return Err(format!(
                    "kernel exited during startup ({exit}); see {}",
                    log.display()
                ));
            }
            // The probe carries the session cookie: an unauthenticated 401 would
            // otherwise be indistinguishable from a kernel still starting.
            let cookie = self
                .credentials
                .get()
                .map(|credentials| credentials.cookie)
                .unwrap_or_default();
            let served = client
                .get(&base)
                .header(reqwest::header::COOKIE, cookie)
                .send()
                .await
                .is_ok_and(|response| response.status().is_success());
            if served {
                return Ok(self.status());
            }
            tokio::time::sleep(READY_INTERVAL).await;
        }
        Err(format!("kernel did not serve {base}; see {}", log.display()))
    }

    /// Terminate every child synchronously; called from Tauri's exit event.
    ///
    /// Managed state destructors are not guaranteed to run on every exit path, so
    /// this is the reliable cleanup route.
    pub fn stop_all_sync(&self) {
        self.credentials.clear();
        if let Some(mut running) = Self::lock(&self.slot).take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }

    /// Copy the kernel's stdout into the boot log and watch for its announcement.
    ///
    /// This runs on a dedicated thread because it is a blocking read; a blocking
    /// task would occupy a runtime worker for the kernel's whole lifetime.
    ///
    /// # Arguments
    ///
    /// * `stdout` - the child's piped stdout.
    /// * `log_path` - where to append each line.
    /// * `announced` - signalled once the stream has been scanned.
    /// * `seen_url` - where the announcement is published for the token exchange.
    fn spawn_log_reader(
        &self,
        stdout: ChildStdout,
        log_path: PathBuf,
        announced: Arc<Notify>,
        seen_url: Arc<Mutex<Option<String>>>,
    ) {
        std::thread::spawn(move || {
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if Self::lock(&seen_url).is_none() {
                    if let Some(token) = parse_launch_token(&line) {
                        let url = line
                            .split_whitespace()
                            .find(|word| word.contains("://"))
                            .unwrap_or_default()
                            .to_owned();
                        *Self::lock(&seen_url) = Some(url);
                        announced.notify_waiters();
                        append(&mut log, &line.replace(&token, TOKEN_PLACEHOLDER));
                        continue;
                    }
                }
                append(&mut log, &line);
            }
            // A stream that ends without an announcement is exactly the condition
            // the caller's timeout would otherwise wait out.
            announced.notify_waiters();
        });
    }

    /// Where the boot log lives for the current launch, or for the next one.
    fn log_path(&self) -> PathBuf {
        match Self::lock(&self.slot).as_ref() {
            Some(running) => running.paths.log.clone(),
            None => self.config_root.join("kernel-home").join("boot.log"),
        }
    }

    /// The child's exit status, if it has exited.
    fn exited_child(&self) -> Option<String> {
        match Self::lock(&self.slot).as_mut() {
            Some(running) => running
                .child
                .try_wait()
                .ok()
                .flatten()
                .map(|exit| exit.to_string()),
            None => None,
        }
    }

    fn status_for(
        &self,
        phase: KernelPhase,
        pid: Option<u32>,
        paths: &ProfilePaths,
        message: Option<String>,
    ) -> KernelStatus {
        KernelStatus {
            phase,
            pid,
            port: KERNEL_PORT,
            version: locator::kernel_version(&self.root),
            root: self.root.display().to_string(),
            home: paths.home.display().to_string(),
            log: paths.log.display().to_string(),
            message,
        }
    }
}

/// Append one line to the boot log, ignoring an unwritable log rather than
/// killing the kernel: losing diagnostics must not take the session down.
fn append(log: &mut Option<std::fs::File>, line: &str) {
    if let Some(file) = log.as_mut() {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

/// Block until the kernel port is bindable, at most ten seconds.
///
/// Runs only on the relaunch path, where the caller has just torn a child down and
/// the runtime worker can absorb the wait the same way it absorbs the spawn.
fn wait_for_port_free(port: u16) {
    for _ in 0..20 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

/// Read the last `max_bytes` of the boot log, lossily decoded.
///
/// The kernel is chatty on failure and the interesting lines sit at the end; the
/// head is repeated boot banners (the same observation the DSH EAC desktop made
/// when it trimmed its kernel log to a tail — see THIRD-PARTY-NOTICES.md).
fn read_log_tail(log: &Path, max_bytes: u64) -> String {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut file) = std::fs::File::open(log) else {
        return String::new();
    };
    let Ok(length) = file.metadata().map(|metadata| metadata.len()) else {
        return String::new();
    };
    if file
        .seek(SeekFrom::Start(length.saturating_sub(max_bytes)))
        .is_err()
    {
        return String::new();
    }
    let mut bytes = Vec::new();
    let _ = file.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Attribute a kernel boot failure to a cause the user can act on.
///
/// The patterns below have stable meaning across kernel builds; several mirror the
/// boot-failure attribution the DSH EAC desktop ships (duplicate loader entries,
/// double module instances, pnpm build-script locks, session encoding clashes —
/// see THIRD-PARTY-NOTICES.md). No match means the raw log line stands.
fn diagnose(log: &Path) -> Option<String> {
    const TAIL_BYTES: u64 = 40_000;
    let tail = read_log_tail(log, TAIL_BYTES);
    let lower = tail.to_ascii_lowercase();

    // First quoted string after `needle` (module names arrive single-quoted).
    let quoted_after = |needle: &str| -> Option<String> {
        let position = lower.find(needle)?;
        let rest = &tail[position + needle.len()..];
        let start = rest.find('\'')? + 1;
        let remainder = &rest[start..];
        let end = remainder.find('\'')?;
        Some(remainder[..end].to_owned())
    };

    if lower.contains("duplicate loader entry") {
        Some(
            "插件条目重复登记：某插件在 cordis patch 里的行与它的 bundle 自带行冲突，整棵插件树被拒绝。\
             回忆最近安装或升级的插件，用官方插件管理页停用它，或清理 profiles/web/cordis.patch.yml 里的重复行。"
                .to_owned(),
        )
    } else if lower.contains("is already registered") {
        Some(
            "作用域重复注册：同一核心包被解析成两个模块实例（常见于 pnpm 把依赖 hoist 进 profile 的 \
             node_modules 遮蔽了内核副本）。重装最近安装的插件，或删除 profiles/web/node_modules 后重启。"
                .to_owned(),
        )
    } else if lower.contains("err_module_not_found") || lower.contains("cannot find module") {
        let module = quoted_after("cannot find module")
            .or_else(|| quoted_after("err_module_not_found"))
            .map(|name| format!("（{name}）"))
            .unwrap_or_default();
        Some(format!(
            "模块缺失{module}：包不完整或依赖损坏，多为安装/升级中断的残留。重装出错的包，\
             必要时重新执行 npm run core:build。"
        ))
    } else if lower.contains("encodingmismatch") || lower.contains("encoding mismatch") {
        Some(
            "会话编码冲突：同一会话目录同时存在 zstd 与明文两种物理编码，0.2.x 内核拒载。\
             把相反编码的会话文件改名归档（明文副本是 zstd 的旧前缀，不要删除）。"
                .to_owned(),
        )
    } else if lower.contains("flat-file layout") || lower.contains("legacylayout") {
        Some(
            "旧版会话布局：0.2.x 内核拒载 flat-file 会话目录。使用新会话，或把该目录迁移到项目/会话子目录。"
                .to_owned(),
        )
    } else if lower.contains("eaddrinuse") || lower.contains("address already in use") {
        Some(
            "端口 31760 被占用：本机可能还有另一个 DSH 实例（官方客户端、其他壳或裸内核）在运行，先结束它。"
                .to_owned(),
        )
    } else if lower.contains("ignored_builds") || lower.contains("ignored builds") {
        Some(
            "pnpm 封锁了依赖构建脚本：以 CI=true 重新执行 dsh plugin add，或运行 pnpm approve-builds。\
             注意 pnpm 退出码非 0 时 bundles 条目不会自动登记，需核对 profiles/web/package.json。"
                .to_owned(),
        )
    } else if lower.contains("incompatible with dsh") {
        Some(
            "插件与内核版本不兼容：按日志提示用 dsh plugin allow-version 授予精确版本豁免，或改用兼容的插件版本。"
                .to_owned(),
        )
    } else {
        None
    }
}

/// Stand-in paths used before any launch, so `status` reports the conventional
/// locations instead of empty strings.
static EMPTY_PATHS: std::sync::LazyLock<ProfilePaths> = std::sync::LazyLock::new(|| ProfilePaths {
    home: PathBuf::new(),
    overlay: PathBuf::new(),
    log: PathBuf::new(),
    settings: PathBuf::new(),
    presets: PathBuf::new(),
    profiles: PathBuf::new(),
});

#[cfg(test)]
mod tests {
    use super::diagnose;

    /// Write `body` as a boot log and return the attributed diagnosis. Each call
    /// uses its own file: the tests run in parallel and must not share state.
    fn attributed(name: &str, body: &str) -> Option<String> {
        let directory = std::env::temp_dir().join("dsh-link-diagnose-test");
        std::fs::create_dir_all(&directory).unwrap();
        let log = directory.join(format!("{name}.log"));
        std::fs::write(&log, body).unwrap();
        diagnose(&log)
    }

    #[test]
    fn attributes_known_failures() {
        for (index, (log, expected)) in [
            ("… duplicate loader entry id: dsh-pet …", "重复登记"),
            ("… prompt section \"deployment:persona\" is already registered …", "重复注册"),
            ("Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'dsh-pet' …", "dsh-pet"),
            ("… session artifact uses 'none' … encodingMismatch …", "编码冲突"),
            ("… listen EADDRINUSE: address already in use 127.0.0.1:31760 …", "被占用"),
            ("… [ERR_PNPM_IGNORED_BUILDS] Ignored build scripts …", "构建脚本"),
            ("… plugin is incompatible with dsh 0.2.1-alpha.1 …", "版本不兼容"),
        ]
        .into_iter()
        .enumerate()
        {
            let diagnosis = attributed(&format!("known-{index}"), log)
                .unwrap_or_else(|| panic!("no diagnosis for {log}"));
            assert!(diagnosis.contains(expected), "`{diagnosis}` lacks `{expected}`");
        }
    }

    #[test]
    fn unknown_failures_have_no_diagnosis() {
        assert_eq!(attributed("unknown", "kernel started and everything was fine"), None);
        assert_eq!(attributed("empty", ""), None);
    }

    #[test]
    fn reads_only_the_tail() {
        // 60KB of noise *after* the failure line: the line sits at offset 0, well
        // before the 40KB tail window that starts near the end of a ~60KB file.
        let noise = "x".repeat(60_000);
        let diagnosis = attributed("tail", &format!("duplicate loader entry id: dsh-pet\n{noise}\n"));
        assert!(diagnosis.is_none());
    }
}
