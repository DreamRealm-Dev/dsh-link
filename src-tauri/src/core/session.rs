//! Kernel session credentials.
//!
//! DSH 0.2.x authenticates *every* route, `/api` included. At startup the kernel
//! prints one line to stdout:
//!
//! ```text
//! dsh web: http://127.0.0.1:31760/?token=<launch token>
//! ```
//!
//! Presenting that token on `GET /` returns `303` plus a signed, `HttpOnly`,
//! `SameSite=Strict` cookie bound to the request authority. Every later request
//! must carry the cookie. A browser cannot add it: `Cookie` is a forbidden fetch
//! header, and the cookie is unreadable from JavaScript. So the shell performs
//! the exchange, keeps the cookie, and attaches it on the frontend's behalf — see
//! [`super::proxy`].

use std::sync::RwLock;

/// The credential material the shell holds for one kernel launch.
#[derive(Debug, Clone)]
pub struct KernelCredentials {
    /// Kernel origin, without a token.
    pub base: String,
    /// Signed session cookie, ready to send in a `Cookie` header.
    pub cookie: String,
}

/// Holds the current credentials, replaced on every kernel launch.
#[derive(Debug, Default)]
pub struct CredentialStore {
    inner: RwLock<Option<KernelCredentials>>,
}

impl CredentialStore {
    /// An empty store, which is the state before the first launch.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record credentials for a running kernel.
    pub fn set(&self, credentials: KernelCredentials) {
        *self.inner.write().unwrap_or_else(|error| error.into_inner()) = Some(credentials);
    }

    /// Clear credentials, which must happen whenever the kernel stops: a cookie
    /// for a dead process is worse than none, because it produces a 401 that
    /// looks like a credential problem.
    pub fn clear(&self) {
        *self.inner.write().unwrap_or_else(|error| error.into_inner()) = None;
    }

    /// Current credentials, if the kernel is authenticated.
    pub fn get(&self) -> Option<KernelCredentials> {
        self.inner
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
}

/// Extract the launch token from the kernel's startup line.
///
/// The kernel prints exactly one such line, but its format is the CLI's, so this
/// matches on the query parameter rather than the whole line.
///
/// # Arguments
///
/// `chunk` - one line of the kernel's stdout, without its trailing newline.
///
/// # Returns
///
/// The token, or `None` when the line is not the startup announcement.
pub fn parse_launch_token(chunk: &str) -> Option<String> {
    let url = chunk.split_whitespace().find(|token| token.contains("://"))?;
    let query = url.split_once('?')?.1;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == "token")
        .map(|(_, value)| value.to_owned())
}

/// Exchange a launch token for the signed session cookie.
///
/// # Arguments
///
/// * `base` - kernel origin.
/// * `token` - launch token from the kernel's stdout.
///
/// # Returns
///
/// The `Cookie` header value, or a message explaining why the exchange failed.
///
/// # Errors
///
/// Returns a message when the kernel does not answer the exchange, answers with
/// a status other than the expected `303`, or omits the cookie.
pub async fn exchange(base: &str, token: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("build auth client: {error}"))?;

    let url = format!(
        "{base}/?token={}",
        urlencode(token)
    );
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("token exchange request failed: {error}"))?;

    if response.status() != reqwest::StatusCode::SEE_OTHER {
        return Err(format!(
            "token exchange expected 303, got {}",
            response.status().as_u16()
        ));
    }

    let set_cookie = response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "token exchange returned no cookie".to_owned())?;

    let pair = set_cookie.split(';').next().unwrap_or_default().trim();
    if pair.is_empty() || !pair.contains('=') {
        return Err("token exchange returned an unusable cookie".to_owned());
    }
    Ok(pair.to_owned())
}

/// Percent-encode a token for use in a query string.
///
/// Launch tokens are base64url and need no escaping in practice, but encoding is
/// still correct for the query component and costs nothing.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
