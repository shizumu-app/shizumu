use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub date: String,
    pub page_number: i64,
    pub context: Option<String>,
    pub what_matters_now: Option<String>,
    pub what_shifted: Option<String>,
    pub what_shifted_complete: bool,
    pub what_shifted_edited: bool,
    pub voice_memo_path: Option<String>,
    pub voice_memo_transcript: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub parent_id: Option<String>,
    pub is_open: bool,
    pub lineage_id: Option<String>,
    pub content_json: Option<String>,
    /// Yjs CRDT state for continuous-trail pages, v2 update encoding.
    /// NULL for discrete-trail pages (which use content_json directly)
    /// and for continuous pages that haven't been touched yet under
    /// the `enable_yjs` feature flag (phase 14.20).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yjs_state: Option<Vec<u8>>,
}

impl Page {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            date: row.get("date")?,
            page_number: row.get("page_number")?,
            context: row.get("context")?,
            what_matters_now: row.get("what_matters_now")?,
            what_shifted: row.get("what_shifted")?,
            what_shifted_complete: row.get("what_shifted_complete")?,
            what_shifted_edited: row.get("what_shifted_edited")?,
            voice_memo_path: row.get("voice_memo_path")?,
            voice_memo_transcript: row.get("voice_memo_transcript")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
            parent_id: row.get("parent_id")?,
            is_open: row.get("is_open")?,
            lineage_id: row.get("lineage_id")?,
            content_json: row.get("content_json")?,
            yjs_state: row.get("yjs_state").ok(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Lineage {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub mode: String,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FoldResult {
    pub pages_moved: i64,
    pub pins_moved: i64,
}

/// A row in the `@`-mention dropdown. Slim by design: enough for the
/// client-side label assembly (`buildMentionLabel`) and the navigation
/// click target. Pages without a lineage have `lineage_id` and
/// `lineage_mode` as None.
#[derive(Debug, Serialize, Deserialize)]
pub struct MentionRow {
    pub page_id: String,
    pub date: String,
    pub page_number: i64,
    pub what_matters_now: Option<String>,
    pub lineage_id: Option<String>,
    pub lineage_mode: Option<String>,
}

impl Lineage {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            created_at: row.get("created_at")?,
            mode: row.get("mode")?,
            parent_id: row.get("parent_id")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Line {
    pub id: String,
    pub page_id: String,
    pub position: i64,
    pub text: String,
    pub state: String,
    pub margin_mark: bool,
    pub is_commitment: bool,
    pub commitment_confirmed: bool,
    pub commitment_closed: bool,
    pub commitment_context: Option<String>,
    pub pause_duration_ms: Option<i64>,
    pub created_at: String,
}

impl Line {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            page_id: row.get("page_id")?,
            position: row.get("position")?,
            text: row.get("text")?,
            state: row.get("state")?,
            margin_mark: row.get("margin_mark")?,
            is_commitment: row.get("is_commitment")?,
            commitment_confirmed: row.get("commitment_confirmed")?,
            commitment_closed: row.get("commitment_closed")?,
            commitment_context: row.get("commitment_context")?,
            pause_duration_ms: row.get("pause_duration_ms")?,
            created_at: row.get("created_at")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionMarker {
    pub id: String,
    pub page_id: String,
    pub timestamp: String,
    pub label: Option<String>,
}

impl SessionMarker {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            page_id: row.get("page_id")?,
            timestamp: row.get("timestamp")?,
            label: row.get("label")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageWithLines {
    pub page: Page,
    pub lines: Vec<Line>,
    pub session_markers: Vec<SessionMarker>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageSummary {
    pub id: String,
    pub date: String,
    pub page_number: i64,
    pub preview_lines: Vec<String>,
    pub what_matters_now: Option<String>,
    pub what_shifted: Option<String>,
    pub what_shifted_complete: bool,
    pub is_open: bool,
    pub parent_id: Option<String>,
    pub lineage_id: Option<String>,
    pub line_count: i64,
    pub created_at: String,
    /// The page's full doc JSON, carried on every summary so THREAD view
    /// can render a continuous trail's expandable dayMarker list without a
    /// second round-trip. May be null.
    ///
    /// It says "on every summary" because that is what `get_thread` does —
    /// `content_json: page.content_json.clone()`, unconditional
    /// (commands.rs). This comment used to read "Populated for
    /// continuous-trail pages", which describes the REASON it exists
    /// rather than the rows it appears on, and reads as a condition that
    /// is not there.
    ///
    /// What a summary does NOT carry is `yjs_state` — that lives on
    /// `Page`, not here. So a summary is safe to render and unsafe to
    /// EDIT: binding a canvas to one would save with `yjs_state: None`,
    /// which `save_page_content_inner` COALESCEs into keeping the stale
    /// value, and the next open would bind that stale doc and discard the
    /// edit. Anything that puts a summary on a writable surface must
    /// re-fetch the page by address first.
    #[serde(default)]
    pub content_json: Option<String>,
    /// Number of open shared_objects rows pinned from this page.
    /// Used by Memory's "has pins" filter chip.
    #[serde(default)]
    pub pin_count: i64,
    /// Number of page_refs rows pointing at this page (incoming @-mentions).
    /// Used by Memory's "has backlinks" filter chip.
    #[serde(default)]
    pub backlink_count: i64,
    /// Last write timestamp; surfaced so Memory's "by recently edited"
    /// sort can compute correct groupings.
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroundData {
    pub first_write_date: Option<String>,
    pub total_pages: i64,
    pub writing_dates: Vec<String>,
    pub recent_shifts: Vec<ShiftEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShiftEntry {
    pub date: String,
    pub text: String,
    pub what_matters_now: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub page_id: String,
    pub block_type: String,
    pub name: Option<String>,
    pub position: i64,
    pub is_shared: bool,
    pub created_at: String,
}

impl Block {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            page_id: row.get("page_id")?,
            block_type: row.get("block_type")?,
            name: row.get("name")?,
            position: row.get("position")?,
            is_shared: row.get("is_shared")?,
            created_at: row.get("created_at")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlockItem {
    pub id: String,
    pub block_id: String,
    pub text: String,
    pub state: String,
    pub position: i64,
    pub created_at: String,
}

impl BlockItem {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            block_id: row.get("block_id")?,
            text: row.get("text")?,
            state: row.get("state")?,
            position: row.get("position")?,
            created_at: row.get("created_at")?,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlockWithItems {
    pub block: Block,
    pub items: Vec<BlockItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Pin {
    pub id: String,
    pub lineage_id: Option<String>,
    /// Nullable: orphaned pins (page deleted, content cached) carry NULL
    /// here. Schema 013 made the column nullable; the struct now matches.
    /// Reading non-Option<String> against a NULL row throws InvalidColumnType
    /// and aborts the whole query_map collect — taking down every pin in
    /// the all-trails fan-out, not just the orphan row.
    pub source_page_id: Option<String>,
    pub source_page_lineage_id: Option<String>,
    pub object_type: String,
    pub title: Option<String>,
    pub content: String,
    pub status: String,
    pub position: i64,
    pub auto_insert: bool,
    pub diverged: bool,
    pub created_at: String,
    pub updated_at: String,
}

impl Pin {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            lineage_id: row.get("lineage_id")?,
            source_page_id: row.get::<_, Option<String>>("source_page_id")?,
            source_page_lineage_id: None,
            object_type: row.get("object_type")?,
            title: row.get("title")?,
            content: row.get("content")?,
            status: row.get("status")?,
            position: row.get("position")?,
            auto_insert: row.get::<_, i64>("auto_insert").unwrap_or(0) != 0,
            diverged: row.get::<_, i64>("diverged").unwrap_or(0) != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }

    pub fn from_row_joined(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            lineage_id: row.get("lineage_id")?,
            source_page_id: row.get::<_, Option<String>>("source_page_id")?,
            source_page_lineage_id: row.get("source_page_lineage_id").ok(),
            object_type: row.get("object_type")?,
            title: row.get("title")?,
            content: row.get("content")?,
            status: row.get("status")?,
            position: row.get("position")?,
            auto_insert: row.get::<_, i64>("auto_insert").unwrap_or(0) != 0,
            diverged: row.get::<_, i64>("diverged").unwrap_or(0) != 0,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// Slim pin row returned by `get_pin_for_reference` and
/// `search_pins_for_mention`. Used by the pinRef extension's label resolver
/// and the @-mention popup's pins section — neither needs the full Pin
/// surface (status, position, source_page_id), only the addressable bits.
#[derive(Debug, Serialize, Deserialize)]
pub struct PinRefRow {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub updated_at: String,
    /// Human-readable scope label — either the owning trail's `name` or
    /// the literal string "global" when `lineage_id` is null.
    pub scope_label: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShukoninSession {
    pub id: String,
    pub page_id: String,
    pub intended_min: i64,
    pub actual_sec: i64,
    pub completed: bool,
    pub started_at: String,
    pub ended_at: String,
}

impl ShukoninSession {
    pub fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            page_id: row.get("page_id")?,
            intended_min: row.get("intended_min")?,
            actual_sec: row.get("actual_sec")?,
            completed: row.get("completed")?,
            started_at: row.get("started_at")?,
            ended_at: row.get("ended_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct SaveLineInput {
    pub text: String,
    pub state: String,
    pub pause_duration_ms: Option<i64>,
}
