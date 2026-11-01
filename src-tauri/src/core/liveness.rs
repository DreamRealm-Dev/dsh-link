//! Liveness signals for the window, observed where the shell cannot be lied to: the
//! proxy.
//!
//! Tauri 2.12 / wry 0.57 expose no render-process-gone event, so a crashed WebView2
//! renderer is invisible to the shell — the window just goes dark while the kernel
//! keeps serving. The proxy, however, sees the traffic a living page cannot stop
//! making: the official client holds its event sockets open for its whole lifetime
//! and issues HTTP calls whenever it renders anything. A page with no open socket
//! and no request for a sustained stretch is therefore dead, whatever the reason.
//!
//! The recovery cycle that consumes these signals lives in `lib.rs` and follows the
//! shape proven by Deepseek Harness EAC's renderer recovery state machine (MIT,
//! see THIRD-PARTY-NOTICES.md): retry in place, escalate to the shell's own
//! recovery page, then rate-limit the whole cycle instead of retrying forever.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A page counts as lost after this long with no socket and no request. Comfortably
/// longer than the official client's own reconnect backoff, so a network flap that
/// blips both signals is not mistaken for a crash.
pub const STALE_AFTER_MS: u64 = 60_000;

/// Window liveness as seen from the proxy.
#[derive(Default)]
pub struct Liveness {
    /// WebSocket relays currently open between the window and the kernel.
    ws_live: AtomicUsize,
    /// Milliseconds since the last request of any kind, for a coarse idle clock.
    last_request_ms: AtomicU64,
    /// Set once the page has ever held a socket. The boot page opens none, so the
    /// watchdog must not reload a window that has not reached the client yet.
    ever_connected: AtomicBool,
}

impl Liveness {
    /// Record any proxied request as a sign of life.
    pub fn touch_request(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_millis() as u64)
            .unwrap_or(0);
        self.last_request_ms.store(now, Ordering::Relaxed);
    }

    /// Record a relay opening: the page reached the official client.
    pub fn ws_opened(&self) {
        self.ever_connected.store(true, Ordering::Relaxed);
        self.ws_live.fetch_add(1, Ordering::Relaxed);
    }

    /// Record a relay closing, whatever the reason.
    pub fn ws_closed(&self) {
        let previous = self.ws_live.fetch_sub(1, Ordering::Relaxed);
        if previous == 0 {
            // A close racing an open must not drive the counter below zero, or the
            // page would look dead forever.
            self.ws_live.store(0, Ordering::Relaxed);
        }
    }

    /// Whether a page that once lived has now gone quiet on every channel.
    pub fn window_stale(&self) -> bool {
        if !self.ever_connected.load(Ordering::Relaxed) || self.ws_live.load(Ordering::Relaxed) > 0 {
            return false;
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_millis() as u64)
            .unwrap_or(0);
        let last = self.last_request_ms.load(Ordering::Relaxed);
        now.saturating_sub(last) > STALE_AFTER_MS
    }
}
