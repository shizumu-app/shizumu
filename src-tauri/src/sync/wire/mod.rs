//! Wire protocol client — talks to a shizumu-relay over HTTPS.
//!
//! Built on `reqwest::blocking` because every endpoint we care about
//! in phase 14 is a one-shot non-latency-critical call; the blocking
//! client keeps call sites synchronous and avoids spreading async
//! coloring through `commands.rs`. SSE (§5.6 `GET .../live`) will
//! need an async path in 14.7; revisit then.

pub mod account;
pub mod attachment_blob;
pub mod attachment_object;
pub mod billing;
pub mod devices;
pub mod enroll;
pub mod epochs;
pub mod live;
pub mod pair;
pub mod pull;
pub mod quota;
pub mod upload;

use serde::Deserialize;

/// The error envelope every non-2xx response carries, per spec §5.0.
/// The `code` field is the stable programmatic key; `message` is a
/// diagnostic string that may change between relay versions.
#[derive(Debug, Clone, Deserialize)]
pub struct WireErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct WireErrorEnvelope {
    pub error: WireErrorBody,
}

/// Shared error type for every signed endpoint. Mirrors the variants
/// enroll uses but lives here so 14.6+'s upload / pull endpoints can
/// reuse the same surface.
#[derive(Debug)]
pub enum WireError {
    Transport(String),
    Wire { status: u16, body: WireErrorBody },
    UnexpectedStatus { status: u16, body: String },
    BadResponse(String),
    /// Relay returned 429 Too Many Requests, or 503 Service Unavailable
    /// (e.g. attachment upload slots busy, or a relay restarting /
    /// briefly unreachable behind a proxy). Both are transient,
    /// caller-should-back-off-and-retry conditions, so they share this
    /// variant. The optional duration carries the `Retry-After` header
    /// if the relay sent one; the worker honours it as the next-attempt
    /// delay instead of its exponential default. Per spec §13 row "429"
    /// and the relay's attachment-upload concurrency limit for 503.
    Throttled {
        retry_after: Option<std::time::Duration>,
    },
}

impl std::fmt::Display for WireError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WireError::Transport(s) => write!(f, "transport: {s}"),
            WireError::Wire { status, body } => {
                write!(f, "relay returned {status} {}: {}", body.code, body.message)
            }
            WireError::UnexpectedStatus { status, body } => {
                write!(f, "relay returned {status} (unparseable body): {body}")
            }
            WireError::BadResponse(s) => write!(f, "malformed response: {s}"),
            WireError::Throttled { retry_after } => match retry_after {
                Some(d) => write!(f, "relay throttled, retry after {}s", d.as_secs()),
                None => write!(f, "relay throttled"),
            },
        }
    }
}

impl std::error::Error for WireError {}

/// Parse `Retry-After` from a reqwest response into a Duration.
/// Supports the integer-seconds form ("60") since that's all the
/// relay spec mandates; HTTP-date form is accepted by the standard
/// but we don't see it in practice for short throttles.
pub fn parse_retry_after(resp: &reqwest::blocking::Response) -> Option<std::time::Duration> {
    let raw = resp.headers().get("retry-after")?.to_str().ok()?;
    let secs: u64 = raw.trim().parse().ok()?;
    Some(std::time::Duration::from_secs(secs))
}

/// Centralised non-2xx → WireError conversion. Consumes the response.
/// Branches on 429 and 503 first (both become Throttled with optional
/// Retry-After) so the worker can honour the relay's pacing hint instead
/// of doubling its own exponential delay. All other statuses fall
/// through to the envelope-or-string parse.
///
/// 503 is folded in unconditionally rather than gated on a specific
/// error code (e.g. the relay's `upload_slots_busy`): every 503 this
/// client can see — busy upload slots, a relay mid-restart, a proxy
/// with no upstream — is retryable the same way, so there is no case
/// worth telling apart at this layer. `WireError::Wire` still carries
/// the body's `code` for callers that branch on it (see
/// `sync_set_account_email` / `sync_redeem_license` in commands.rs),
/// but none of those business-validation codes (e.g. `bad_password`,
/// `unknown_key`) are ever paired with a 503 status, so folding 503 into
/// Throttled here does not erase any distinction a caller relies on.
///
/// The two halves are factored out because one module reads the error
/// body under its own bound: `attachment_object` runs on a client whose
/// whole-request deadline is sized for a 100 MB transfer, so `resp.text()`
/// there would let a hostile relay stream an error body at full line rate
/// for over an hour. It reuses the pieces below rather than restating
/// them, so which statuses skip the body entirely — and how a body that
/// does get read is parsed — cannot drift between the two paths.
pub fn extract_wire_error(resp: reqwest::blocking::Response) -> WireError {
    if let Some(throttled) = throttled_status(&resp) {
        return throttled;
    }
    let status = resp.status().as_u16();
    let body_text = resp.text().unwrap_or_default();
    wire_error_from_body(status, body_text)
}

/// The statuses whose body is never worth reading: both mean "come back
/// later", and the only thing worth carrying out of the response is the
/// `Retry-After` header.
pub(crate) fn throttled_status(resp: &reqwest::blocking::Response) -> Option<WireError> {
    let status = resp.status().as_u16();
    if status == 429 || status == 503 {
        return Some(WireError::Throttled {
            retry_after: parse_retry_after(resp),
        });
    }
    None
}

/// Envelope-or-raw-string, once, for every caller that has a status and
/// a body in hand however it got them.
pub(crate) fn wire_error_from_body(status: u16, body_text: String) -> WireError {
    match serde_json::from_str::<WireErrorEnvelope>(&body_text) {
        Ok(env) => WireError::Wire {
            status,
            body: env.error,
        },
        Err(_) => WireError::UnexpectedStatus {
            status,
            body: body_text,
        },
    }
}

/// Build a relay base URL from the user-configured value, stripping a
/// trailing slash so callers can concat `/v1/...` paths safely.
pub fn normalize_base_url(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_base_url_strips_trailing_slashes() {
        assert_eq!(normalize_base_url("https://r.example/"), "https://r.example");
        assert_eq!(normalize_base_url("https://r.example"), "https://r.example");
        assert_eq!(normalize_base_url("https://r.example///"), "https://r.example");
    }
}
