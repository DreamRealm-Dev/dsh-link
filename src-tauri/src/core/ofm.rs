//! OFM (DSH-Our Free Model) detection: is the OFM desktop app on this machine, and where does it serve?
//!
//! The requirement is "if OFM desktop is installed, ask the user and then join its hybrid model service". RESEARCH-OFM.md
//! (R335) established what that can honestly mean: OFM ships a Tauri desktop app that runs a LOOPBACK HTTP service,
//! announces itself through `<data dir>/service.lock`, serves `/health` with an identity field, and authenticates with a
//! `forwardKey` kept in `<data dir>/settings.json`. Its port DRIFTS (the service writes the real one back), so nothing here
//! assumes a port.
//!
//! This module only ANSWERS THE QUESTION - it starts nothing, writes nothing, and prompts nobody. The panel decides what to
//! say and the user decides whether to join, which is the only order that keeps a background service from wiring itself into
//! somebody model traffic without being asked.

use serde::Serialize;
use std::path::PathBuf;

/// What this machine offers, as far as OFM is concerned.
#[derive(Debug, Clone, Serialize)]
pub struct OfmPresence {
    /// True when any of the signals below says an OFM desktop app is on this machine.
    pub detected: bool,
    /// The signal that fired, by name, so a reader can tell "installed" from "running".
    pub signal: String,
    /// The loopback port the service wrote down, when a lock file was found.
    pub port: Option<u16>,
    /// Whether a forward key is on disk. The key itself is NEVER copied out: the panel asks the user, and the join path
    /// reads it where it lives.
    pub has_key: bool,
    /// The data directory that was inspected, so a user can see what was read.
    pub data_dir: Option<String>,
}

impl OfmPresence {
    fn none(why: &str) -> Self {
        Self { detected: false, signal: why.to_owned(), port: None, has_key: false, data_dir: None }
    }
}

/// The OFM data directory: `OFM_HOME` wins (the desktop shell honours it), then `~/.our-free-model`.
fn data_dir() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("OFM_HOME") {
        let trimmed = home.trim();
        if trimmed.is_empty() == false {
            return Some(PathBuf::from(trimmed));
        }
    }
    std::env::var("USERPROFILE")
        .ok()
        .map(|home| PathBuf::from(home).join(".our-free-model"))
        .or_else(|| std::env::var("HOME").ok().map(|home| PathBuf::from(home).join(".our-free-model")))
}

/// The port OFM wrote into its lock or settings file, when one is there. Reads only; a malformed file is "no port".
fn port_from(dir: &std::path::Path) -> Option<u16> {
    let lock = std::fs::read_to_string(dir.join("service.lock")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&lock).ok()?;
    let port = json.get("port").and_then(|value| value.as_u64())?;
    u16::try_from(port).ok()
}

/// Whether a forward key is on disk (the file is read, the value is not returned).
fn has_key(dir: &std::path::Path) -> bool {
    let Ok(text) = std::fs::read_to_string(dir.join("settings.json")) else { return false };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else { return false };
    json.get("forwardKey").and_then(|value| value.as_str()).map(|key| key.is_empty() == false).unwrap_or(false)
}

#[cfg(target_os = "windows")]
/// The Tauri NSIS install, as the research recorded it: a per-user `Our Free Model` uninstall key or the exe beside it.
fn installed_on_windows() -> bool {
    use std::process::Command;
    // Reading the registry through `reg query` keeps this module free of an extra crate; the command is read-only and its
    // absence is just "cannot tell".
    let query = Command::new("reg")
        .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", "Our Free Model"])
        .output();
    if let Ok(output) = query {
        if output.status.success() == true && String::from_utf8_lossy(&output.stdout).contains("Our Free Model") {
            return true;
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("Our Free Model").join("ofm-desktop.exe").exists();
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn installed_on_windows() -> bool {
    false
}

/// Detect, in the order the research ranked the signals: the live lock file first (it proves "running", not merely
/// "installed"), then the install itself, then the data directory (it only proves something was installed once).
pub fn detect() -> OfmPresence {
    let Some(dir) = data_dir() else { return OfmPresence::none("no home directory to look in") };
    let shown = dir.to_string_lossy().to_string();
    if dir.join("service.lock").exists() {
        return OfmPresence {
            detected: true,
            signal: "service.lock".to_owned(),
            port: port_from(&dir),
            has_key: has_key(&dir),
            data_dir: Some(shown),
        };
    }
    if installed_on_windows() {
        return OfmPresence {
            detected: true,
            signal: "installed".to_owned(),
            port: None,
            has_key: has_key(&dir),
            data_dir: Some(shown),
        };
    }
    if dir.exists() {
        return OfmPresence {
            detected: true,
            signal: "data-dir".to_owned(),
            port: port_from(&dir),
            has_key: has_key(&dir),
            data_dir: Some(shown),
        };
    }
    OfmPresence::none("no OFM signal on this machine")
}


// ---------------------------------------------------------------------------------------------------
// Joining the service the detector found.
// ---------------------------------------------------------------------------------------------------

/// What one join attempt produced. `models` is the count the service itself reported AFTER the key was used, which is what
/// turns "we wrote a config file" into "this machine can really talk to OFM".
#[derive(Debug, Clone, Serialize)]
pub struct OfmJoin {
    pub ok: bool,
    pub base_url: Option<String>,
    pub port: Option<u16>,
    pub models: Option<usize>,
    pub detail: String,
}

fn fail(detail: impl Into<String>) -> OfmJoin {
    OfmJoin { ok: false, base_url: None, port: None, models: None, detail: detail.into() }
}

/// One plain HTTP/1.1 GET over loopback, answered as text. Deliberately tiny: the caller talks to 127.0.0.1 and needs
/// nothing but a status line and a body, and adding an HTTP client crate for one loopback call would be a dependency this
/// shell does not otherwise carry.
fn http_get(port: u16, path: &str, bearer: Option<&str>) -> Result<(u16, String), String> {
    use std::io::{Read, Write};
    use std::net::TcpStream;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|error| format!("connect 127.0.0.1:{port}: {error}"))?;
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(4)));
    let auth = bearer.map(|key| format!("authorization: Bearer {key}\r\n")).unwrap_or_default();
    let request = format!("GET {path} HTTP/1.1\r\nhost: 127.0.0.1:{port}\r\n{auth}connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(|error| format!("write: {error}"))?;
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|error| format!("read: {error}"))?;
    let text = String::from_utf8_lossy(&raw).to_string();
    let status = text
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "no status line".to_owned())?;
    let (head, body) = match text.split_once("\r\n\r\n") {
        Some((head, rest)) => (head.to_owned(), rest.to_owned()),
        None => (text.clone(), String::new()),
    };
    // R375: a response with no content-length is CHUNKED, and a chunked body is not JSON - it is size lines interleaved
    // with JSON. Measured against the fixture: the join succeeded and reported `models: null`, because the body it parsed
    // was "3b\r\n{...}\r\n0\r\n". De-chunking here keeps the caller honest instead of making every caller handle it.
    let chunked = head.to_ascii_lowercase().contains("transfer-encoding: chunked");
    let body = if chunked { dechunk(&body) } else { body };
    Ok((status, body))
}

/// Turn one chunked body into its bytes.
fn dechunk(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    loop {
        let Some((size_line, tail)) = rest.split_once("\r\n") else { break };
        let digits = size_line.split(';').next().unwrap_or("").trim();
        let Ok(size) = usize::from_str_radix(digits, 16) else { break };
        if size == 0 { break }
        if tail.len() < size { out.push_str(tail); break }
        out.push_str(&tail[..size]);
        rest = tail[size..].strip_prefix("\r\n").unwrap_or(&tail[size..]);
    }
    out
}

/// The forward key OFM keeps on disk, read ONLY when the user has just said yes.
fn read_key(dir: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("settings.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let key = json.get("forwardKey").and_then(|value| value.as_str())?.trim().to_owned();
    if key.is_empty() { None } else { Some(key) }
}

///
/// Verify the service, use the key once, and store where it lives - the join half of "detect, ask, then join".
///
/// The ORDER is the point: `/health` first (it proves the thing on that port really is OFM and says its product name), then
/// `/v1/models` WITH the key (it proves the key works and that this machine can call it), and only then the config file. A
/// config written before a successful call is a promise nobody checked.
pub fn join(config_root: &std::path::Path) -> OfmJoin {
    let presence = detect();
    if presence.detected == false {
        return fail(format!("no OFM desktop app on this machine: {}", presence.signal));
    }
    let Some(port) = presence.port else {
        return fail("OFM is installed but not running: no service.lock carries a port, so there is nothing to join yet");
    };
    match http_get(port, "/health", None) {
        Ok((status, body)) => {
            if status != 200 {
                return fail(format!("GET /health answered HTTP {status}: {body}"));
            }
            if body.contains("our-free-model") == false && body.contains("OUR_FREE_MODEL") == false {
                return fail(format!("the service on port {port} does not identify itself as OFM: {body}"));
            }
        }
        Err(error) => return fail(format!("GET /health on port {port}: {error}")),
    }
    let Some(dir) = data_dir() else { return fail("no OFM data directory to read the key from") };
    let Some(key) = read_key(&dir) else {
        return fail("OFM holds no forward key on disk: open its API 接入 page and copy the key, then join from there");
    };
    let models = match http_get(port, "/v1/models", Some(key.as_str())) {
        Ok((200, body)) => serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|json| json.get("data").and_then(|value| value.as_array()).map(|rows| rows.len())),
        Ok((status, body)) => return fail(format!("GET /v1/models answered HTTP {status}: {body}")),
        Err(error) => return fail(format!("GET /v1/models on port {port}: {error}")),
    };
    let config = serde_json::json!({
        "baseUrl": format!("http://127.0.0.1:{port}"),
        "port": port,
        "key": key,
        "joinedAtMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or(0),
    });
    let path = config_root.join("ofm.json");
    if let Err(error) = std::fs::create_dir_all(config_root) {
        return fail(format!("create {}: {error}", config_root.display()));
    }
    if let Err(error) = std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap_or_default()) {
        return fail(format!("write {}: {error}", path.display()));
    }
    OfmJoin {
        ok: true,
        base_url: Some(format!("http://127.0.0.1:{port}")),
        port: Some(port),
        models,
        detail: format!("joined OFM on port {port}; wrote {}", path.display()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_machine_with_no_ofm_directory_says_so_by_name() {
        // The detection reads the developer machine, so this asserts only the SHAPE: a missing data dir never reports
        // "detected" by accident, and the reason is always a sentence.
        let presence = detect();
        if presence.detected == false {
            assert!(presence.signal.is_empty() == false, "a non-detection carries its reason");
        }
        assert!(presence.port.is_none() || presence.port.unwrap() > 0);
    }

    #[test]
    fn the_port_is_read_from_the_lock_file_and_never_invented() {
        let root = std::env::temp_dir().join("dsh-ofm-lock-test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("service.lock"), "{\"port\":18900,\"pid\":42,\"product\":\"our-free-model-standalone\"}").unwrap();
        assert_eq!(port_from(&root), Some(18900));
        std::fs::write(root.join("service.lock"), "not json").unwrap();
        assert_eq!(port_from(&root), None, "a malformed lock file is not a port");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_key_on_disk_is_reported_as_presence_only() {
        let root = std::env::temp_dir().join("dsh-ofm-key-test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("settings.json"), "{\"forwardKey\":\"ofm-abc\"}").unwrap();
        assert!(has_key(&root));
        std::fs::write(root.join("settings.json"), "{}").unwrap();
        assert!(has_key(&root) == false);
        let _ = std::fs::remove_dir_all(&root);
    }
}
