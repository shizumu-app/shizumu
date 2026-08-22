use std::fmt;

/// On-wire identifier for an op envelope.
///
/// Known kinds are exposed as `const` strings so callers can use them
/// directly. The `OpKind` newtype validates the wire format against
/// `^[a-z][a-z0-9_]{0,31}$` — the same regex the relay enforces — so
/// future kinds received from peers running a higher protocol version
/// round-trip cleanly through v0.3's local-only path without being
/// dropped.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct OpKind(String);

impl OpKind {
    pub const PAGE_BLOB: &'static str = "page_blob";
    pub const PAGE_YJS: &'static str = "page_yjs";
    pub const LINEAGE_OP: &'static str = "lineage_op";
    pub const PIN_OP: &'static str = "pin_op";
    pub const SETTING_OP: &'static str = "setting_op";
    pub const TOMBSTONE: &'static str = "tombstone";
    pub const SNAPSHOT: &'static str = "snapshot";

    pub fn new(s: impl Into<String>) -> Result<Self, OpKindError> {
        let s = s.into();
        if !is_valid_op_kind(&s) {
            return Err(OpKindError::Invalid(s));
        }
        Ok(Self(s))
    }

    pub fn page_blob() -> Self {
        Self(Self::PAGE_BLOB.to_string())
    }
    pub fn page_yjs() -> Self {
        Self(Self::PAGE_YJS.to_string())
    }
    pub fn lineage_op() -> Self {
        Self(Self::LINEAGE_OP.to_string())
    }
    pub fn pin_op() -> Self {
        Self(Self::PIN_OP.to_string())
    }
    pub fn setting_op() -> Self {
        Self(Self::SETTING_OP.to_string())
    }
    pub fn tombstone() -> Self {
        Self(Self::TOMBSTONE.to_string())
    }
    pub fn snapshot() -> Self {
        Self(Self::SNAPSHOT.to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for OpKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpKindError {
    Invalid(String),
}

impl fmt::Display for OpKindError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Invalid(s) => write!(
                f,
                "invalid op kind {s:?} — must match ^[a-z][a-z0-9_]{{0,31}}$"
            ),
        }
    }
}

impl std::error::Error for OpKindError {}

fn is_valid_op_kind(s: &str) -> bool {
    if s.is_empty() || s.len() > 32 {
        return false;
    }
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() {
        return false;
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_kinds_round_trip() {
        for s in [
            OpKind::PAGE_BLOB,
            OpKind::PAGE_YJS,
            OpKind::LINEAGE_OP,
            OpKind::PIN_OP,
            OpKind::SETTING_OP,
            OpKind::TOMBSTONE,
            OpKind::SNAPSHOT,
        ] {
            let parsed = OpKind::new(s).expect("known kind must parse");
            assert_eq!(parsed.as_str(), s);
        }
    }

    #[test]
    fn accepts_unknown_but_well_formed_kind() {
        // Forward-compat: v0.4 may introduce kinds we don't know yet.
        // They must still round-trip if they fit the wire format.
        let k = OpKind::new("future_kind_v2").expect("must accept");
        assert_eq!(k.as_str(), "future_kind_v2");
    }

    #[test]
    fn rejects_invalid_formats() {
        for bad in [
            "",
            "PageBlob",     // uppercase
            "1_page",       // leading digit
            "_page",        // leading underscore
            "page-blob",    // hyphen
            "page blob",    // space
            "page.blob",    // dot
            &"a".repeat(33), // too long
        ] {
            assert!(
                OpKind::new(bad).is_err(),
                "should reject: {bad:?}"
            );
        }
    }

    #[test]
    fn accepts_max_length_kind() {
        let k = "a".to_string() + &"a".repeat(31); // 32 chars
        assert_eq!(k.len(), 32);
        assert!(OpKind::new(&k).is_ok());
    }
}
