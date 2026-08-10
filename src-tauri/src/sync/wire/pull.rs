//! Op pull — `GET /v1/users/<uid>/ops` (metadata list) and
//! `GET /v1/users/<uid>/blobs/<hash>` (ciphertext fetch) per spec §5.4.
//!
//! Both endpoints are signed under §5.1. The metadata response is a
//! JSON array with the documented per-op fields; the blob response
//! body is the raw ciphertext (or a 302 redirect to a presigned URL
//! when the relay's storage backend is S3 with `presigned_get`).
//!
//! We let `reqwest`'s default redirect policy follow the 302 for us;
//! the presigned URL is a one-off GET against the object store and
//! does not need our signed headers (the presigned-ness is the auth).

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{normalize_base_url, WireError};
use serde::Deserialize;
use std::time::Duration;

/// One entry in the GET /ops response. Matches spec §5.4
/// byte-for-byte; clients MUST ignore unknown JSON fields (forward
/// compatibility) so the struct is `#[serde(default)]`-friendly and
/// we don't reject responses that grow new fields.
#[derive(Debug, Clone, Deserialize)]
pub struct RemoteOp {
    pub user_seq: i64,
    pub blob_hash: String,
    pub blob_size: i64,
    pub doc_id_ct: String,
    pub op_kind: String,
    #[serde(default)]
    pub stream_id: i32,
    pub device_id: String,
    pub created_at: i64,
    /// Key epoch the op was encrypted under (key rotation). Defaults to 0
    /// (phrase-derived keyring) for pre-rotation relays/ops.
    #[serde(default)]
    pub epoch: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct GetOpsResponse {
    #[serde(default)]
    pub ops: Vec<RemoteOp>,
    #[serde(default)]
    pub has_more: bool,
}

fn build_client() -> Result<reqwest::blocking::Client, WireError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))
}

/// Pull op metadata. `since` advances the per-user cursor; `limit`
/// caps the batch (max 500 per spec, default 200). `stream` filters
/// by stream_id; pass None to read all streams.
pub fn get_ops(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    since: i64,
    limit: Option<i64>,
    stream: Option<i32>,
) -> Result<GetOpsResponse, WireError> {
    let client = build_client()?;
    let mut query = vec![format!("since={since}")];
    if let Some(l) = limit {
        query.push(format!("limit={l}"));
    }
    if let Some(s) = stream {
        query.push(format!("stream={s}"));
    }
    let path_with_query = format!("/v1/users/{user_id}/ops?{}", query.join("&"));

    let headers = sign_request(device_keys, "GET", &path_with_query, b"");
    let url = format!("{}{}", normalize_base_url(base_url), path_with_query);

    let resp = client
        .get(&url)
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    interpret_json_response(resp)
}

/// Fetch one ciphertext blob. Returns the raw bytes (the relay may
/// have streamed them directly or via a presigned redirect — either
/// way reqwest delivers the final body).
pub fn get_blob(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    hash_hex: &str,
) -> Result<Vec<u8>, WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/blobs/{hash_hex}");
    let headers = sign_request(device_keys, "GET", &path, b"");
    let url = format!("{}{}", normalize_base_url(base_url), path);

    let resp = client
        .get(&url)
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        resp.bytes()
            .map(|b| b.to_vec())
            .map_err(|e| WireError::Transport(e.to_string()))
    } else {
        Err(crate::sync::wire::extract_wire_error(resp))
    }
}

fn interpret_json_response<R: serde::de::DeserializeOwned>(
    resp: reqwest::blocking::Response,
) -> Result<R, WireError> {
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        let raw = resp
            .text()
            .map_err(|e| WireError::Transport(e.to_string()))?;
        return serde_json::from_str::<R>(&raw).map_err(|e| WireError::BadResponse(e.to_string()));
    }
    Err(crate::sync::wire::extract_wire_error(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    /// Happy path: GET /ops returns one op with all the documented
    /// fields. The query string includes since/limit/stream when
    /// supplied; signed headers are attached.
    #[test]
    fn get_ops_round_trips_query_and_response() {
        let server = MockServer::start();
        let dk = generate_device_keys();

        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/ops")
                .query_param("since", "0")
                .query_param("limit", "200")
                .query_param("stream", "1")
                .header_exists("X-Device-Id")
                .header_exists("X-Sig");
            then.status(200).json_body(serde_json::json!({
                "ops": [{
                    "user_seq": 7,
                    "blob_hash": "a".repeat(64),
                    "blob_size": 42,
                    "doc_id_ct": "ZG9j",
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "11111111-2222-3333-4444-555555555555",
                    "created_at": 1715000000000_i64
                }],
                "has_more": false
            }));
        });
        let resp = get_ops(&server.base_url(), &dk, "u", 0, Some(200), Some(1)).unwrap();
        mock.assert();
        assert_eq!(resp.ops.len(), 1);
        assert_eq!(resp.ops[0].user_seq, 7);
        assert_eq!(resp.ops[0].op_kind, "page_blob");
        assert!(!resp.has_more);
    }

    /// Unknown JSON fields on the response must be ignored (spec §4
    /// forward-compatibility rule). If a future relay grows a field
    /// in the GET /ops response, we keep working.
    #[test]
    fn get_ops_tolerates_unknown_response_fields() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(200).json_body(serde_json::json!({
                "ops": [{
                    "user_seq": 1,
                    "blob_hash": "f".repeat(64),
                    "blob_size": 0,
                    "doc_id_ct": "AAAA",
                    "op_kind": "page_blob",
                    "stream_id": 0,
                    "device_id": "dev",
                    "created_at": 1,
                    "future_field": "ignored by v0.4 client"
                }],
                "has_more": false,
                "tomorrows_field": [1,2,3]
            }));
        });
        let resp = get_ops(&server.base_url(), &dk, "u", 0, None, None).unwrap();
        assert_eq!(resp.ops.len(), 1);
    }

    /// 404 on /ops surfaces as a structured Wire error.
    #[test]
    fn get_ops_surfaces_404_as_wire_error() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/missing/ops");
            then.status(404).json_body(serde_json::json!({
                "error": {"code":"unknown_endpoint","message":"no such user"}
            }));
        });
        let err = get_ops(&server.base_url(), &dk, "missing", 0, None, None).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "unknown_endpoint");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// Happy path: GET /blobs/<hash> returns the raw ciphertext bytes.
    #[test]
    fn get_blob_returns_raw_bytes() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let hash = "a".repeat(64);
        let body = vec![0u8, 1, 2, 3, 4, 5];

        let mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/v1/users/u/blobs/{hash}"))
                .header_exists("X-Sig");
            then.status(200)
                .header("content-type", "application/octet-stream")
                .body(body.clone());
        });
        let got = get_blob(&server.base_url(), &dk, "u", &hash).unwrap();
        mock.assert();
        assert_eq!(got, body);
    }

    /// 404 blob_not_found surfaces as a structured Wire error so the
    /// pull pipeline can drop the op and continue.
    #[test]
    fn get_blob_surfaces_blob_not_found() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let hash = "f".repeat(64);
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{hash}"));
            then.status(404).json_body(serde_json::json!({
                "error": {"code":"blob_not_found","message":"no committed row"}
            }));
        });
        let err = get_blob(&server.base_url(), &dk, "u", &hash).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "blob_not_found");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }
}
