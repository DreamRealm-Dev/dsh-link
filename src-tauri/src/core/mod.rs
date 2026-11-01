//! Kernel integration: locating the DSH checkout, owning its on-disk profile,
//! holding its session credentials, proxying the window's traffic to the kernel, and
//! supervising the child process that serves both the official client and its API.

pub mod brand_art;
pub mod bridge;
// R331: the phone as an INPUT of the device net - a page posts what it captured, the host reads it back.
pub mod capture;
pub mod device_bridge;
pub mod frame;
pub mod liveness;
pub mod locator;
pub mod mobile;
// R374: is the OFM desktop app on this machine? (research-verified signals; nothing starts and nothing is written)
pub mod ofm;
pub mod pnpm;
pub mod profile;
pub mod proxy;
pub mod session;
pub mod sidebar_panel;
pub mod shellpage;
pub mod shellprefs;
pub mod supervisor;
pub mod update;
pub mod writerlock;