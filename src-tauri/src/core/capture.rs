//! The phone as an INPUT of the device net: bytes a page captured, written where the bridge can read them.
//!
//! Measured need (R330): the phone own WebView can already capture audio (`getUserMedia({audio:true})` answers
//! `{ok:true}` once the app holds RECORD_AUDIO and the manifest declares MODIFY_AUDIO_SETTINGS), but there was nowhere to
//! PUT the result: `fs.write` is not implemented on Android and the device net only reads. This route is that place, and
//! it is deliberately narrow - a page on this origin POSTs bytes, they land in ONE directory under the bridge roots, and
//! the host reads them back with the `fs.read` / `fs.list` it already has.
//!
//! It is not a general upload surface: the body is capped, the file name is generated here (never taken from the caller),
//! and the directory is fixed. A page cannot choose where its bytes land.

use axum::body::Bytes;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokio::sync::oneshot;

/// One capture a bridge op is waiting for. The page posts the bytes, this route answers the waiter, and the op returns
/// the same `{path, bytes, sha256}` the page saw - so a host and a page can never disagree about what landed.
pub type Waiter = oneshot::Sender<Result<serde_json::Value, String>>;

fn waiters() -> &'static Mutex<HashMap<String, Waiter>> {
    static WAITERS: OnceLock<Mutex<HashMap<String, Waiter>>> = OnceLock::new();
    WAITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Register a waiter for `id`. Dropping the receiver leaves nothing behind: the entry is removed on answer or timeout.
pub fn register(id: &str, waiter: Waiter) {
    if let Ok(mut map) = waiters().lock() {
        map.insert(id.to_owned(), waiter);
    }
}

/// Drop a waiter that timed out, so a late POST finds nobody and just writes its file.
pub fn forget(id: &str) {
    if let Ok(mut map) = waiters().lock() {
        map.remove(id);
    }
}

fn answer(id: &str, value: Result<serde_json::Value, String>) {
    let waiter = waiters().lock().ok().and_then(|mut map| map.remove(id));
    if let Some(waiter) = waiter {
        let _ = waiter.send(value);
    }
}

/// Where the page posts what it captured.
pub const CAPTURE_PATH: &str = "/__shell/capture";

/// Ceiling on one capture. Two minutes of speech in a container codec is far below this; anything above it is not a
/// page capture, it is somebody using the route as storage.
const MAX_CAPTURE_BYTES: usize = 8 * 1024 * 1024;

/// The directory captures land in. On Android it is inside the shell own `/sdcard` root, so the host that paired with
/// this device reads it with the same grant that lists everything else; on a desktop build it is the shell data dir
/// (the route exists there too, for the same reason the bridge does: one code path).
fn capture_dir() -> PathBuf {
    #[cfg(target_os = "android")]
    {
        PathBuf::from("/storage/emulated/0/DCIM/DSH-Link")
    }
    #[cfg(not(target_os = "android"))]
    {
        std::env::temp_dir().join("dsh-link-capture")
    }
}

/// The extension the caller says its container has, from a fixed set. An unknown or missing one is `bin`.
fn extension_for(header: Option<&str>) -> &'static str {
    match header.map(|value| value.trim().to_ascii_lowercase()) {
        Some(kind) if kind == "audio/webm" || kind == "webm" => "webm",
        Some(kind) if kind == "audio/ogg" || kind == "ogg" => "ogg",
        Some(kind) if kind == "audio/wav" || kind == "wav" => "wav",
        Some(kind) if kind == "image/png" || kind == "png" => "png",
        Some(kind) if kind == "image/jpeg" || kind == "jpeg" || kind == "jpg" => "jpg",
        _ => "bin",
    }
}

/// `POST /__shell/capture` - write the body to the capture directory and answer with where it went.
///
/// The answer is the whole point: `{ path, bytes }` is what a bridge op hands back, and the host then reads that path
/// with the device net it already has. `header` names the container (`x-dsh-capture-kind`), and `x-dsh-capture-sha256`
/// rides along untouched so a caller can compare the file it read back against what the page says it posted.
pub async fn store_capture(headers: HeaderMap, body: Bytes) -> Response {
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "ok": false, "error": "empty capture" }))).into_response();
    }
    if body.len() > MAX_CAPTURE_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({ "ok": false, "error": format!("capture is {} bytes, over the {} byte ceiling", body.len(), MAX_CAPTURE_BYTES) })),
        )
            .into_response();
    }
    let kind = headers.get("x-dsh-capture-kind").and_then(|value| value.to_str().ok());
    let digest = headers.get("x-dsh-capture-sha256").and_then(|value| value.to_str().ok()).map(str::to_owned);
    let directory = capture_dir();
    if let Err(error) = std::fs::create_dir_all(&directory) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": format!("create {}: {error}", directory.display()) })),
        )
            .into_response();
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let path = directory.join(format!("capture-{stamp}.{}", extension_for(kind)));
    if let Err(error) = std::fs::write(&path, &body) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": format!("write {}: {error}", path.display()) })),
        )
            .into_response();
    }
    // The answer says what landed, in the same shape the bridge op answers with, so a page and a host can both read it.
    let landed = json!({
        "ok": true,
        "path": path.to_string_lossy(),
        "bytes": body.len(),
        "sha256": digest,
        "kind": extension_for(kind),
    });
    // A capture a bridge op is waiting for: answer IT with exactly what landed, so the host that asked and the page
    // that produced never disagree. A POST with no waiter is still a valid capture (a person pressed record on the
    // phone); it just does not answer anybody.
    if let Some(id) = headers.get("x-dsh-capture-id").and_then(|value| value.to_str().ok()) {
        if id.is_empty() == false {
            answer(id, Ok(landed.clone()));
        }
    }
    (StatusCode::OK, Json(landed)).into_response()
}
