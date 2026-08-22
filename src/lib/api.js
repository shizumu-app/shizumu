import { getLocalDateStr } from "./utils.js";
// Detect if running inside Tauri
const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__;

// Fired after any mutation that could change inline `pageRef` labels —
// rename / move / fold / delete a trail, or reassign a page's lineage.
// The pageRef NodeView listens and re-resolves cached labels.
function emitTrailMutated() {
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("shizumu:trail-mutated")); } catch {}
  }
}

// Lazy-loaded invoke function (avoids top-level await)
let _invoke = null;

async function call(cmd, args) {
  if (!_invoke) {
    if (typeof window !== "undefined" && window.__VR_INVOKE__) {
      // VR harness installs a deterministic, pre-seeded invoke here.
      _invoke = window.__VR_INVOKE__;
    } else if (isTauri) {
      const core = await import("@tauri-apps/api/core");
      _invoke = core.invoke;
    } else {
      _invoke = createMockInvoke();
    }
  }
  return _invoke(cmd, args);
}

// In-memory mock for browser development
export function createMockInvoke() {
  const store = { pages: new Map(), lines: new Map() };

  function ensureToday() {
    const today = getLocalDateStr();
    const key = `${today}-1`;
    if (!store.pages.has(key)) {
      const page = {
        id: crypto.randomUUID(),
        date: today,
        page_number: 1,
        context: null,
        what_matters_now: null,
        what_shifted: null,
        what_shifted_complete: false,
        what_shifted_edited: false,
        voice_memo_path: null,
        voice_memo_transcript: null,
        parent_id: null,
        is_open: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.pages.set(key, page);
      store.lines.set(page.id, []);
    }
    return key;
  }

  return async (cmd, args = {}) => {
    switch (cmd) {
      case "get_or_create_today": {
        const key = ensureToday();
        const page = store.pages.get(key);
        return { page, lines: store.lines.get(page.id) || [] };
      }
      case "cleanup_orphan_pages": {
        return 0;
      }
      case "cleanup_empty_day_markers": {
        return 0;
      }
      case "save_line": {
        const line = {
          id: crypto.randomUUID(),
          page_id: args.pageId,
          position: (store.lines.get(args.pageId) || []).length + 1,
          text: args.input.text,
          state: args.input.state,
          margin_mark: false,
          is_commitment: false,
          commitment_confirmed: false,
          commitment_closed: false,
          commitment_context: null,
          pause_duration_ms: args.input.pause_duration_ms,
          created_at: new Date().toISOString(),
        };
        const lines = store.lines.get(args.pageId) || [];
        lines.push(line);
        store.lines.set(args.pageId, lines);
        return line;
      }
      case "get_page": {
        const key = `${args.date}-${args.pageNumber}`;
        const page = store.pages.get(key);
        if (!page) return null;
        return { page, lines: store.lines.get(page.id) || [] };
      }
      case "create_new_page": {
        let maxNum = 0;
        for (const [, p] of store.pages) {
          if (p.date === args.date) maxNum = Math.max(maxNum, p.page_number);
        }
        const page = {
          id: crypto.randomUUID(),
          date: args.date,
          page_number: maxNum + 1,
          context: null,
          what_matters_now: null,
          what_shifted: null,
          what_shifted_complete: false,
          what_shifted_edited: false,
          voice_memo_path: null,
          voice_memo_transcript: null,
          parent_id: null,
          is_open: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        store.pages.set(`${args.date}-${page.page_number}`, page);
        store.lines.set(page.id, []);
        return { page, lines: [] };
      }
      case "update_what_matters_now": {
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { p.what_matters_now = args.text; break; }
        }
        return null;
      }
      case "update_what_shifted": {
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) {
            const cleared = args.text == null || String(args.text).trim().length === 0;
            p.what_shifted = cleared ? null : args.text;
            p.what_shifted_complete = !cleared;
            break;
          }
        }
        return null;
      }
      case "get_adjacent_page":
        return null;
      case "get_page_count_for_date": {
        let count = 0;
        for (const p of store.pages.values()) {
          if (p.date === args.date) count++;
        }
        return count;
      }
      case "strike_line":
        return null;
      case "check_onboarding_complete":
        return store.onboardingComplete || false;
      case "mark_onboarding_complete":
        store.onboardingComplete = true;
        return null;
      case "get_setting":
        return store.settings?.[args.key] || null;
      case "set_setting":
        if (!store.settings) store.settings = {};
        store.settings[args.key] = args.value;
        return null;
      case "delete_all_data":
        store.pages.clear();
        store.lines.clear();
        store.onboardingComplete = false;
        store.settings = {};
        return null;
      case "get_open_focuses": {
        const open = [...store.pages.values()]
          .filter(p => p.is_open !== false)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return open.map(p => ({
          id: p.id, date: p.date, page_number: p.page_number,
          preview_lines: (store.lines.get(p.id) || []).slice(0, 3).map(l => l.text),
          what_matters_now: p.what_matters_now,
          what_shifted_complete: p.what_shifted_complete,
          is_open: p.is_open !== false,
          parent_id: p.parent_id || null,
          line_count: (store.lines.get(p.id) || []).length,
          created_at: p.created_at,
        }));
      }
      case "update_line_text": {
        for (const lines of store.lines.values()) {
          const line = lines.find(l => l.id === args.lineId);
          if (line) { line.text = args.text; break; }
        }
        return null;
      }
      case "create_block": {
        const block = {
          id: crypto.randomUUID(), page_id: args.pageId,
          block_type: args.blockType, name: args.name || null,
          position: 1, is_shared: false, created_at: new Date().toISOString(),
        };
        if (!store.blocks) store.blocks = new Map();
        store.blocks.set(block.id, { block, items: [] });
        return { block, items: [] };
      }
      case "add_block_item": {
        if (!store.blocks) store.blocks = new Map();
        const bwi = store.blocks.get(args.blockId);
        if (!bwi) return null;
        const item = {
          id: crypto.randomUUID(), block_id: args.blockId,
          text: args.text, state: "open",
          position: bwi.items.length + 1, created_at: new Date().toISOString(),
        };
        bwi.items.push(item);
        return item;
      }
      case "update_block_item_state": {
        if (!store.blocks) return null;
        for (const bwi of store.blocks.values()) {
          const item = bwi.items.find(i => i.id === args.itemId);
          if (item) { item.state = args.state; break; }
        }
        return null;
      }
      case "get_blocks_for_page": {
        if (!store.blocks) return [];
        return [...store.blocks.values()].filter(b => b.block.page_id === args.pageId);
      }
      case "save_page_content": {
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { p.content_json = args.contentJson; break; }
        }
        return null;
      }
      case "insert_line_at": {
        const pageLines = store.lines.get(args.pageId) || [];
        const newLine = {
          id: crypto.randomUUID(), page_id: args.pageId,
          position: args.position, text: args.text, state: "settled",
          margin_mark: false, is_commitment: false, commitment_confirmed: false,
          commitment_closed: false, commitment_context: null,
          pause_duration_ms: null, created_at: new Date().toISOString(),
        };
        // Shift positions
        pageLines.forEach(l => { if (l.position >= args.position) l.position++; });
        pageLines.push(newLine);
        pageLines.sort((a, b) => a.position - b.position);
        return newLine;
      }
      case "delete_line": {
        for (const [pid, lines] of store.lines) {
          const idx = lines.findIndex(l => l.id === args.lineId);
          if (idx >= 0) {
            const pos = lines[idx].position;
            lines.splice(idx, 1);
            lines.forEach(l => { if (l.position > pos) l.position--; });
            break;
          }
        }
        return null;
      }
      case "update_block_item_text": {
        if (store.blocks) {
          for (const bwi of store.blocks.values()) {
            const item = bwi.items.find(i => i.id === args.itemId);
            if (item) { item.text = args.text; break; }
          }
        }
        return null;
      }
      case "reorder_lines": {
        const lines = store.lines.get(args.pageId);
        if (lines) {
          args.lineIds.forEach((id, i) => {
            const line = lines.find(l => l.id === id);
            if (line) line.position = i + 1;
          });
          lines.sort((a, b) => a.position - b.position);
        }
        return null;
      }
      case "get_pins": {
        if (!store.pins) store.pins = [];
        return store.pins.filter(o => o.lineage_id === args.lineageId);
      }
      case "create_pin": {
        if (!store.pins) store.pins = [];
        const obj = {
          id: crypto.randomUUID(), lineage_id: args.lineageId,
          source_page_id: args.sourcePageId, object_type: args.objectType,
          title: args.title || null, content: args.content,
          status: "open", position: store.pins.length + 1,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        store.pins.push(obj);
        return obj;
      }
      case "update_pin_status": {
        if (store.pins) {
          const o = store.pins.find(x => x.id === args.id);
          if (o) { o.status = args.status; o.updated_at = new Date().toISOString(); }
        }
        return null;
      }
      case "update_pin_content": {
        if (store.pins) {
          const o = store.pins.find(x => x.id === args.id);
          if (o) { o.content = args.content; o.title = args.title; o.updated_at = new Date().toISOString(); }
        }
        return null;
      }
      case "delete_pin": {
        if (store.pins) {
          store.pins = store.pins.filter(x => x.id !== args.id);
        }
        return null;
      }
      case "reorder_pins": {
        // Apply 1-based positions in the order given. Caller is responsible
        // for keeping the id list scoped to one section.
        if (store.pins && Array.isArray(args.ids)) {
          const now = new Date().toISOString();
          args.ids.forEach((id, idx) => {
            const o = store.pins.find(x => x.id === id);
            if (o) { o.position = idx + 1; o.updated_at = now; }
          });
        }
        return null;
      }
      case "get_backlinks_for_pin": {
        // Mock walks every page's content_json for pinRef nodes targeting
        // the pin id and returns slim rows for any matches. Not
        // performance-sensitive — in-browser dev only.
        const out = [];
        const seen = new Set();
        for (const page of store.pages.values()) {
          if (!page.content_json) continue;
          let doc;
          try { doc = JSON.parse(page.content_json); } catch { continue; }
          let hit = false;
          (function walk(n) {
            if (!n) return;
            if (n.type === "pinRef" && n.attrs?.pinId === args.pinId) hit = true;
            if (Array.isArray(n.content)) for (const c of n.content) walk(c);
          })(doc);
          if (hit && !seen.has(page.id)) {
            seen.add(page.id);
            out.push({
              page_id: page.id,
              date: page.date,
              page_number: page.page_number,
              what_matters_now: page.what_matters_now,
              lineage_id: page.lineage_id || null,
              lineage_mode: null,
            });
          }
        }
        return out;
      }
      case "get_pin_for_reference": {
        const o = store.pins?.find(x => x.id === args.pinId);
        if (!o) return null;
        return {
          id: o.id,
          title: o.title || null,
          content: o.content || null,
          updated_at: o.updated_at || "",
          scope_label: o.lineage_id ? "trail" : "global",
        };
      }
      case "search_pins_for_mention": {
        const q = (args.query || "").toLowerCase();
        const cap = args.limit > 0 ? args.limit : 50;
        const rows = (store.pins || [])
          .filter(p => p.status !== "orphaned")
          .filter(p => !q
            || (p.title || "").toLowerCase().includes(q)
            || (p.content || "").toLowerCase().includes(q))
          .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
          .slice(0, cap)
          .map(p => ({
            id: p.id,
            title: p.title || null,
            content: p.content || null,
            updated_at: p.updated_at || "",
            scope_label: p.lineage_id ? "trail" : "global",
          }));
        return rows;
      }
      case "delete_focus": {
        const pid = args.pageId;
        store.lines.delete(pid);
        for (const [k, p] of store.pages) {
          if (p.id === pid) { store.pages.delete(k); break; }
        }
        return null;
      }
      case "get_inherited_shared_blocks": {
        // Walk lineage, collect shared blocks from ancestors
        if (!store.blocks) return [];
        const result = [];
        let currentId = null;
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { currentId = p.parent_id; break; }
        }
        while (currentId) {
          for (const bwi of (store.blocks ? store.blocks.values() : [])) {
            if (bwi.block.page_id === currentId && bwi.block.is_shared) {
              result.push(bwi);
            }
          }
          let next = null;
          for (const p of store.pages.values()) {
            if (p.id === currentId) { next = p.parent_id; break; }
          }
          currentId = next;
        }
        return result;
      }
      case "promote_block_to_shared": {
        if (!store.blocks) return null;
        const b = store.blocks.get(args.blockId);
        if (b) b.block.is_shared = true;
        return null;
      }
      case "check_and_add_session_marker":
        return null; // Mock: never adds markers (would need timestamp tracking)
      case "get_lineages": {
        if (!store.lineages) store.lineages = new Map();
        return [...store.lineages.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      case "create_lineage": {
        if (!store.lineages) store.lineages = new Map();
        // mode and parent_id are part of the Lineage contract (see
        // src-tauri/src/models.rs). Dropping mode here made continuous
        // trails unreachable in VR and browser dev: Page.svelte derives
        // `currentTrailMode = lin?.mode || "discrete"`, so a lineage
        // without one always read as discrete. Rust defaults mode to
        // "discrete" when the caller omits it; mirror that.
        const lin = {
          id: crypto.randomUUID(),
          name: args.name,
          created_at: new Date().toISOString(),
          mode: args.mode ?? "discrete",
          parent_id: args.parentId ?? null,
        };
        store.lineages.set(lin.id, lin);
        return lin;
      }
      case "rename_lineage": {
        if (!store.lineages) store.lineages = new Map();
        const trimmed = (args.newName ?? "").trim();
        if (!trimmed) return Promise.reject("lineage_name_empty");
        for (const lin of store.lineages.values()) {
          if (lin.id !== args.lineageId && lin.name === trimmed) {
            return Promise.reject("lineage_name_taken");
          }
        }
        const target = store.lineages.get(args.lineageId);
        if (!target) return Promise.reject("lineage_not_found");
        target.name = trimmed;
        return target;
      }
      case "set_lineage_parent": {
        if (!store.lineages) store.lineages = new Map();
        const target = store.lineages.get(args.lineageId);
        if (!target) return Promise.reject("lineage_not_found");
        if (args.newParentId === args.lineageId) return Promise.reject("cannot_self_parent");
        if (args.newParentId) {
          if (!store.lineages.get(args.newParentId)) return Promise.reject("parent_not_found");
          let cur = args.newParentId;
          while (cur) {
            if (cur === args.lineageId) return Promise.reject("cannot_move_under_descendant");
            cur = store.lineages.get(cur)?.parent_id ?? null;
          }
        }
        target.parent_id = args.newParentId ?? null;
        return target;
      }
      case "get_backlinks_for_page": {
        // Mock: scan every page's content_json for pageRef nodes targeting
        // the given id. Returns slim rows matching the Rust shape.
        if (!store.pages) store.pages = new Map();
        if (!store.lineages) store.lineages = new Map();
        const target = args.targetPageId;
        const out = [];
        for (const p of store.pages.values()) {
          if (p.id === target) continue;
          const raw = p.content_json;
          if (!raw) continue;
          let json;
          try { json = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { continue; }
          const targets = new Set();
          (function walk(n) {
            if (!n || typeof n !== "object") return;
            if (n.type === "pageRef" && n.attrs?.targetId) targets.add(n.attrs.targetId);
            if (Array.isArray(n.content)) n.content.forEach(walk);
          })(json);
          if (!targets.has(target)) continue;
          const lin = p.lineage_id ? store.lineages.get(p.lineage_id) : null;
          out.push({
            page_id: p.id,
            date: p.date,
            page_number: p.page_number,
            what_matters_now: p.what_matters_now ?? null,
            lineage_id: p.lineage_id ?? null,
            lineage_mode: lin?.mode ?? null,
            _ts: p.updated_at ?? p.created_at ?? "",
          });
        }
        out.sort((a, b) => b._ts.localeCompare(a._ts));
        return out.map(({ _ts, ...keep }) => keep);
      }
      case "get_page_for_mention": {
        if (!store.pages) store.pages = new Map();
        if (!store.lineages) store.lineages = new Map();
        const p = store.pages.get(args.pageId);
        if (!p) return null;
        const lin = p.lineage_id ? store.lineages.get(p.lineage_id) : null;
        return {
          page_id: p.id,
          date: p.date,
          page_number: p.page_number,
          what_matters_now: p.what_matters_now ?? null,
          lineage_id: p.lineage_id ?? null,
          lineage_mode: lin?.mode ?? null,
        };
      }
      case "search_pages_for_mention": {
        if (!store.pages) store.pages = new Map();
        if (!store.lineages) store.lineages = new Map();
        const trimmed = (args.query ?? "").trim().toLowerCase();
        const limit = args.limit > 0 ? args.limit : 50;
        const rows = [...store.pages.values()]
          .map((p) => {
            const lin = p.lineage_id ? store.lineages.get(p.lineage_id) : null;
            return {
              page_id: p.id,
              date: p.date,
              page_number: p.page_number,
              what_matters_now: p.what_matters_now ?? null,
              lineage_id: p.lineage_id ?? null,
              lineage_mode: lin?.mode ?? null,
              _name: lin?.name ?? "",
              _focus: (p.what_matters_now ?? "").toLowerCase(),
              _name_lc: (lin?.name ?? "").toLowerCase(),
              _ts: p.updated_at ?? p.created_at ?? "",
            };
          })
          .filter((r) => {
            if (!trimmed) return true;
            return r._focus.includes(trimmed) || r._name_lc.includes(trimmed);
          })
          .sort((a, b) => b._ts.localeCompare(a._ts))
          .slice(0, limit)
          .map(({ _name, _focus, _name_lc, _ts, ...keep }) => keep);
        return rows;
      }
      case "fold_lineage": {
        if (!store.lineages) store.lineages = new Map();
        if (args.sourceId === args.targetId) return Promise.reject("cannot_fold_into_self");
        const source = store.lineages.get(args.sourceId);
        const target = store.lineages.get(args.targetId);
        if (!source) return Promise.reject("lineage_not_found");
        if (!target) return Promise.reject("target_not_found");
        if (source.mode === "continuous" && target.mode === "continuous") {
          return Promise.reject("cannot_fold_continuous_into_continuous");
        }
        if (source.mode === "discrete" && target.mode === "continuous") {
          return Promise.reject("cannot_fold_discrete_into_continuous");
        }
        let pagesMoved = 0;
        let pinsMoved = 0;
        for (const p of store.pages.values()) {
          if (p.lineage_id === args.sourceId) {
            p.lineage_id = args.targetId;
            pagesMoved++;
          }
        }
        if (store.pins) {
          for (const pin of store.pins) {
            if (pin.lineage_id === args.sourceId) {
              pin.lineage_id = args.targetId;
              pinsMoved++;
            }
          }
        }
        for (const lin of store.lineages.values()) {
          if (lin.parent_id === args.sourceId) lin.parent_id = source.parent_id ?? null;
        }
        store.lineages.delete(args.sourceId);
        return { pages_moved: pagesMoved, pins_moved: pinsMoved };
      }
      case "set_focus_lineage": {
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { p.lineage_id = args.lineageId; break; }
        }
        if (store.pins) {
          for (const pin of store.pins) {
            if (pin.source_page_id === args.pageId) pin.lineage_id = args.lineageId;
          }
        }
        return null;
      }
      case "get_lineage_path": {
        const inLineage = [...store.pages.values()]
          .filter(p => p.lineage_id === args.lineageId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        return inLineage.map(p => ({
          id: p.id, date: p.date, page_number: p.page_number,
          preview_lines: [], what_matters_now: p.what_matters_now,
          what_shifted_complete: p.what_shifted_complete,
          is_open: p.is_open !== false, parent_id: p.parent_id || null,
          line_count: 0, created_at: p.created_at,
        }));
      }
      case "get_focus_picker_list": {
        const all = [...store.pages.values()]
          .filter(p => p.what_matters_now)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .slice(0, 100);
        return all.map(p => ({
          id: p.id, date: p.date, page_number: p.page_number,
          preview_lines: [], what_matters_now: p.what_matters_now,
          what_shifted_complete: p.what_shifted_complete,
          is_open: p.is_open !== false, parent_id: p.parent_id || null,
          line_count: 0, created_at: p.created_at,
        }));
      }
      case "set_focus_parent": {
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { p.parent_id = args.parentId; break; }
        }
        return null;
      }
      case "get_focus_lineage": {
        const chain = [];
        let current = null;
        for (const p of store.pages.values()) {
          if (p.id === args.pageId) { current = p; break; }
        }
        while (current) {
          chain.unshift({ id: current.id, date: current.date, page_number: current.page_number, preview_lines: [], what_matters_now: current.what_matters_now, what_shifted_complete: current.what_shifted_complete, is_open: current.is_open !== false, parent_id: current.parent_id || null, line_count: 0, created_at: current.created_at });
          if (!current.parent_id) break;
          let parent = null;
          for (const p of store.pages.values()) {
            if (p.id === current.parent_id) { parent = p; break; }
          }
          current = parent;
        }
        return chain;
      }
      case "get_focuses_for_date": {
        const focuses = [...store.pages.values()]
          .filter(p => p.date === args.date)
          .sort((a, b) => a.page_number - b.page_number);
        return focuses.map(p => ({
          id: p.id, date: p.date, page_number: p.page_number,
          preview_lines: (store.lines.get(p.id) || []).slice(0, 3).map(l => l.text),
          what_matters_now: p.what_matters_now,
          what_shifted_complete: p.what_shifted_complete,
          is_open: p.is_open !== false,
          parent_id: p.parent_id || null,
          line_count: (store.lines.get(p.id) || []).length,
          created_at: p.created_at,
        }));
      }
      case "get_trail_page_counts": {
        const counts = new Map();
        for (const p of store.pages.values()) {
          if (!p.lineage_id) continue;   // untrailed pages own no sidebar row
          counts.set(p.lineage_id, (counts.get(p.lineage_id) ?? 0) + 1);
        }
        return [...counts.entries()];
      }
      case "get_thread": {
        const sortKey = args.orderBy === "updated_at" ? "updated_at" : "date";
        const allPages = [...store.pages.values()]
          .sort((a, b) => {
            if (sortKey === "updated_at") {
              return (b.updated_at || "").localeCompare(a.updated_at || "");
            }
            return b.date.localeCompare(a.date) || b.page_number - a.page_number;
          })
          .slice(args.offset || 0, (args.offset || 0) + (args.limit || 20));
        return allPages.map(p => ({
          id: p.id,
          date: p.date,
          page_number: p.page_number,
          preview_lines: (store.lines.get(p.id) || []).slice(0, 3).map(l => l.text),
          what_matters_now: p.what_matters_now,
          what_shifted_complete: p.what_shifted_complete,
          line_count: (store.lines.get(p.id) || []).length,
          created_at: p.created_at,
          pin_count: 0,
          backlink_count: 0,
          updated_at: p.updated_at,
        }));
      }
      case "get_ground_data": {
        const allPages = [...store.pages.values()].sort((a, b) => a.date.localeCompare(b.date));
        const dates = [...new Set(allPages.map(p => p.date))];
        const shifts = allPages
          .filter(p => p.what_shifted)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 5)
          .map(p => ({ date: p.date, text: p.what_shifted }));
        return {
          first_write_date: dates[0] || null,
          total_pages: allPages.length,
          writing_dates: dates,
          recent_shifts: shifts,
        };
      }
      case "search_pages": {
        const q = (args.query || "").toLowerCase();
        const results = [];
        for (const p of store.pages.values()) {
          const pageLines = store.lines.get(p.id) || [];
          const text = pageLines.map(l => l.text).join(" ") + " " + (p.what_matters_now || "") + " " + (p.what_shifted || "");
          if (text.toLowerCase().includes(q)) {
            results.push({
              id: p.id, date: p.date, page_number: p.page_number,
              preview_lines: pageLines.slice(0, 3).map(l => l.text),
              what_matters_now: p.what_matters_now,
              what_shifted_complete: p.what_shifted_complete,
              line_count: pageLines.length,
              created_at: p.created_at,
            });
          }
        }
        return results;
      }
      case "check_encryption_status":
        return false;
      case "setup_encryption":
      case "unlock":
      case "lock":
        return null;
      case "get_lock_timeout":
        return null;
      case "set_lock_timeout":
        return null;
      case "export_pages_gui":
      case "backup_database_gui":
        return null;

      // ── v0.4 surface: browser-dev stubs ─────────────────────────────
      // These commands are backed by the Tauri/Rust layer (sync engine,
      // attachments, pin divergence, continuous-trail canonical docs).
      // The in-memory mock backs `npm run dev` without Tauri and isn't a
      // functional reimplementation of those subsystems — component and
      // flow tests mock `$lib/api` per-test (see src/lib/__tests__/api.test.js).
      // Returning shape-correct empties keeps browser-dev from crashing on
      // array iteration and silences the unknown-command warning. List-
      // shaped commands return [], everything else returns null (the prior
      // default contract).
      case "get_trail_pages":
      case "get_carry_forward_pins":
      case "attachment_list":
      case "sync_list_devices":
      case "sync_error_history":
        return [];
      // Numeric, not null: the storage panel formats this as bytes.
      case "attachment_local_bytes":
        return 0;
      case "attachment_add":
      case "attachment_open":
      case "attachment_set_sync":
      case "attachment_gc":
      // No blob store in mock mode, so nothing resolves to a local path.
      case "attachment_local_src":
      case "append_page_to_canonical":
      case "clone_page_for_new_day":
      case "get_canonical_trail_page":
      case "save_trail_content":
      case "save_page_content_with_pin_refresh":
      case "load_page_content_for_modal":
      case "delete_lineage":
      case "resolve_pin_divergence":
      case "update_pin_auto_insert":
      case "update_pin_scope":
      case "save_image_bytes":
      case "save_image_file":
      case "op_log_stats":
      case "sync_status":
      case "sync_flush_now":
      case "sync_quota":
      case "sync_setup":
      case "sync_enroll":
      case "sync_self_enroll":
      case "sync_init":
      case "sync_recover":
      case "sync_set_enabled":
      case "sync_set_relay_url":
      case "sync_switch_relay":
      case "sync_pause":
      case "sync_resume":
      case "sync_reset":
      case "sync_force_pull":
      case "sync_force_reupload":
      case "sync_replay_failed":
      case "sync_revoke_device":
      case "sync_generate_phrase":
      case "sync_relay_health":
      case "sync_redeem_license":
      case "pair_existing_start":
      case "pair_existing_fetch_sas":
      case "pair_existing_confirm":
      case "pair_new_join":
      case "pair_new_complete":
        return null;
      default:
        console.warn("Unknown command:", cmd);
        return null;
    }
  };
}

// Public API
export async function getOrCreateToday() {
  return call("get_or_create_today");
}

export async function getPage(date, pageNumber, pageId = null) {
  return call("get_page", { date, pageNumber, pageId });
}

export async function saveLine(pageId, input) {
  return call("save_line", { pageId, input });
}

export async function createNewPage(date) {
  return call("create_new_page", { date });
}

export async function clonePageForNewDay(sourcePageId, targetDate) {
  return call("clone_page_for_new_day", { sourcePageId, targetDate });
}

export async function cleanupOrphanPages() {
  return call("cleanup_orphan_pages");
}

export async function cleanupEmptyDayMarkers() {
  return call("cleanup_empty_day_markers");
}

export async function updateWhatMattersNow(pageId, text) {
  return call("update_what_matters_now", { pageId, text });
}

export async function updateWhatShifted(pageId, text) {
  return call("update_what_shifted", { pageId, text });
}

export async function getAdjacentPage(pageId, direction) {
  return call("get_adjacent_page", { pageId, direction });
}

export async function getPageCountForDate(date) {
  return call("get_page_count_for_date", { date });
}

export async function strikeLine(lineId, state) {
  return call("strike_line", { lineId, state });
}

export async function checkOnboardingComplete() {
  return call("check_onboarding_complete");
}

export async function markOnboardingComplete() {
  return call("mark_onboarding_complete");
}

export async function getThread(limit = 20, offset = 0, orderBy = "date") {
  return call("get_thread", { limit, offset, orderBy });
}

/**
 * Page count per trail, across the whole database.
 *
 * Deliberately NOT derived from getThread(): that list is capped, so tallying
 * lineage_id over it undercounts any trail whose pages fall outside the
 * window. Returns [lineage_id, count] pairs; trails with no pages are absent.
 */
export async function getTrailPageCounts() {
  return call("get_trail_page_counts", {});
}

export async function searchPages(query) {
  return call("search_pages", { query });
}

export async function getGroundData() {
  return call("get_ground_data");
}


export async function getSetting(key) {
  return call("get_setting", { key });
}

export async function setSetting(key, value) {
  return call("set_setting", { key, value });
}

export async function setCloseToTray(enabled) {
  return call("set_close_to_tray", { enabled });
}

export async function deleteAllData() {
  return call("delete_all_data");
}

export async function getOpenFocuses() {
  return call("get_open_focuses");
}

export async function updateLineText(lineId, text) {
  return call("update_line_text", { lineId, text });
}

export async function checkAndAddSessionMarker(pageId) {
  return call("check_and_add_session_marker", { pageId });
}

export async function getFocusesForDate(date) {
  return call("get_focuses_for_date", { date });
}

export async function getFocusPickerList() {
  return call("get_focus_picker_list");
}

export async function setFocusParent(pageId, parentId) {
  return call("set_focus_parent", { pageId, parentId });
}

export async function getFocusLineage(pageId) {
  return call("get_focus_lineage", { pageId });
}

export async function createBlock(pageId, blockType, name = null) {
  return call("create_block", { pageId, blockType, name });
}

export async function addBlockItem(blockId, text) {
  return call("add_block_item", { blockId, text });
}

export async function updateBlockItemState(itemId, state) {
  return call("update_block_item_state", { itemId, state });
}

export async function getBlocksForPage(pageId) {
  return call("get_blocks_for_page", { pageId });
}

export async function promoteBlockToShared(blockId) {
  return call("promote_block_to_shared", { blockId });
}

export async function getInheritedSharedBlocks(pageId) {
  return call("get_inherited_shared_blocks", { pageId });
}

export async function deleteFocus(pageId) {
  return call("delete_focus", { pageId });
}

export async function getLineages() {
  return call("get_lineages");
}

export async function createLineage(name, mode = "discrete", parentId = null) {
  return call("create_lineage", { name, mode, parentId });
}

export async function setFocusLineage(pageId, lineageId) {
  const r = await call("set_focus_lineage", { pageId, lineageId });
  emitTrailMutated();
  return r;
}

export async function appendPageToCanonical(sourcePageId, lineageId) {
  return call("append_page_to_canonical", { sourcePageId, lineageId });
}

export async function getCanonicalTrailPage(lineageId) {
  return call("get_canonical_trail_page", { lineageId });
}

export async function deleteLineage(lineageId, targetLineageId = null) {
  const r = await call("delete_lineage", { lineageId, targetLineageId });
  emitTrailMutated();
  return r;
}

export async function renameLineage(lineageId, newName) {
  const r = await call("rename_lineage", { lineageId, newName });
  emitTrailMutated();
  return r;
}

export async function setLineageParent(lineageId, newParentId) {
  const r = await call("set_lineage_parent", { lineageId, newParentId });
  emitTrailMutated();
  return r;
}

export async function foldLineage(sourceId, targetId) {
  const r = await call("fold_lineage", { sourceId, targetId });
  emitTrailMutated();
  return r;
}

export async function searchPagesForMention(query, limit = 50) {
  return call("search_pages_for_mention", { query, limit });
}

export async function getPageForMention(pageId) {
  return call("get_page_for_mention", { pageId });
}

export async function getBacklinksForPage(targetPageId) {
  return call("get_backlinks_for_page", { targetPageId });
}

/**
 * Pages that contain a `pinRef` pointing at `pinId`. Returns slim
 * MentionRow shapes the client uses to render labels. Used by the pin
 * modal's "referenced from" provenance line.
 */
export async function getBacklinksForPin(pinId) {
  return call("get_backlinks_for_pin", { pinId });
}

export async function getLineagePath(lineageId) {
  return call("get_lineage_path", { lineageId });
}

export async function getTrailPages(lineageId) {
  return call("get_trail_pages", { lineageId });
}

export async function insertLineAt(pageId, position, text) {
  return call("insert_line_at", { pageId, position, text });
}

export async function deleteLine(lineId) {
  return call("delete_line", { lineId });
}

export async function updateBlockItemText(itemId, text) {
  return call("update_block_item_text", { itemId, text });
}

export async function reorderLines(pageId, lineIds) {
  return call("reorder_lines", { pageId, lineIds });
}

/// Save the TipTap JSON for a page.
///
/// When `yjsState` is provided (continuous-trail pages with the
/// `enable_yjs` flag on), it's persisted into `pages.yjs_state` AND
/// the sync engine emits a `page_yjs` op instead of `page_blob`.
/// When omitted (discrete pages, flag off, or any legacy caller),
/// the existing `page_blob` shape is preserved — wire-compatible
/// with v0.3 peers.
///
/// @param {string} pageId
/// @param {string} contentJson
/// @param {Uint8Array | number[] | null} [yjsState]
export async function savePageContent(pageId, contentJson, yjsState = null) {
  return call("save_page_content", {
    pageId,
    contentJson,
    yjsState: yjsState ? Array.from(yjsState) : null,
  });
}

export async function loadPageContentForModal(pageId) {
  return call("load_page_content_for_modal", { pageId });
}

/// Same shape as savePageContent but also refreshes the pin-ref
/// index after writing. Used by the panel when pin content edits
/// land via the SharedObjectsPanel modal.
export async function savePageContentWithPinRefresh(pageId, contentJson, yjsState = null) {
  return call("save_page_content_with_pin_refresh", {
    pageId,
    contentJson,
    yjsState: yjsState ? Array.from(yjsState) : null,
  });
}

export async function saveTrailContent(lineageId, pageId, contentJson) {
  return call("save_trail_content", { lineageId, pageId, contentJson });
}

export async function getPins(lineageId) {
  return call("get_pins", { lineageId });
}

// Every pin mutation fires `shizumu:trail-mutated` so the pinRef extension's
// labelCache (src/lib/extensions/pin-ref.js) drops its cached row. Without
// this, a rename/scope/delete on a pin leaves every other open reference
// rendering the stale title (or stale link-to-deleted) until full reload.
export async function createPin(lineageId, sourcePageId, objectType, content, title = null) {
  const r = await call("create_pin", { lineageId, sourcePageId, objectType, content, title });
  emitTrailMutated();
  return r;
}

export async function updatePinStatus(id, status) {
  const r = await call("update_pin_status", { id, status });
  emitTrailMutated();
  return r;
}

export async function updatePinContent(id, content, title = null) {
  const r = await call("update_pin_content", { id, content, title });
  emitTrailMutated();
  return r;
}

export async function updatePinScope(id, lineageId) {
  const r = await call("update_pin_scope", { id, lineageId });
  emitTrailMutated();
  return r;
}

export async function deletePin(id) {
  const r = await call("delete_pin", { id });
  emitTrailMutated();
  return r;
}

export async function updatePinAutoInsert(id, autoInsert) {
  const r = await call("update_pin_auto_insert", { id, autoInsert });
  emitTrailMutated();
  return r;
}

/**
 * Resolve a pin by id for the pinRef extension's label cache. Returns a slim
 * row { id, title, content, updated_at, scope_label } or null when the pin
 * no longer exists.
 */
export async function getPinForReference(pinId) {
  return call("get_pin_for_reference", { pinId });
}

/**
 * Substring-search pins for the @-mention popup's pins section. `lineageId`
 * scopes results to the current trail's CTE + globals. `query=""` returns
 * the most recently edited rows up to `limit`.
 */
export async function searchPinsForMention(query, limit = 50, lineageId = null) {
  return call("search_pins_for_mention", { query, limit, lineageId });
}

/**
 * Persist the order of pins within one scope section. `ids` must list every
 * pin in the section in the desired order; the backend writes 1-based
 * `position` values atomically. Callers are responsible for keeping the
 * passed-in IDs homogeneous in scope + object_type (the panel only allows
 * drag-reorder within one section, so this naturally holds).
 */
export async function reorderPins(ids) {
  const r = await call("reorder_pins", { ids });
  emitTrailMutated();
  return r;
}

export async function resolvePinDivergence(pinId, action, newContent = null) {
  return call("resolve_pin_divergence", { pinId, action, newContent });
}

export async function getCarryForwardPins(lineageId) {
  return call("get_carry_forward_pins", { lineageId });
}

// Encryption + lock
export async function checkEncryptionStatus() {
  return call("check_encryption_status");
}

export async function setupEncryption(passphrase) {
  return call("setup_encryption", { passphrase });
}

export async function unlock(passphrase) {
  return call("unlock", { passphrase });
}

export async function lockApp() {
  return call("lock");
}

export async function getLockTimeout() {
  return call("get_lock_timeout");
}

export async function setLockTimeout(minutes) {
  return call("set_lock_timeout", { minutes });
}

// Export + backup (GUI)
export async function exportPagesGui(format = "md", from = null, to = null) {
  return call("export_pages_gui", { format, from, to });
}

export async function backupDatabaseGui() {
  return call("backup_database_gui");
}

// Image storage
export async function saveImageFile(srcPath) {
  return call("save_image_file", { srcPath });
}

export async function saveImageBytes(bytes, ext) {
  return call("save_image_bytes", { bytes: Array.from(bytes), ext });
}

// Notifications
//
// Wraps the Tauri notification plugin with a one-time inline rationale
// shown BEFORE the OS permission prompt fires on Android 13+. The
// rationale is a small confirm() so users know what shizumu is about
// to ask for. Decision is persisted via the existing setting store.
export async function sendNotification(title, body) {
  if (!isTauri) return;
  try {
    const {
      sendNotification: notify,
      isPermissionGranted,
      requestPermission,
    } = await import("@tauri-apps/plugin-notification");

    let granted = false;
    try { granted = await isPermissionGranted(); } catch {}
    if (!granted) {
      // Check whether the user has already seen our rationale. If yes
      // and they declined, stay silent. If yes and they accepted,
      // request directly. If never seen, show rationale first.
      let seen = false;
      try { seen = (await getSetting("notif_rationale_seen")) === "true"; } catch {}
      if (!seen) {
        const ok = typeof window !== "undefined" && window.confirm
          ? window.confirm("shizumu will send a soft notification when exports finish or sync needs attention. tap allow when prompted next.")
          : true;
        try { await setSetting("notif_rationale_seen", "true"); } catch {}
        if (!ok) return;
      }
      let res = "default";
      try { res = await requestPermission(); } catch {}
      if (res !== "granted") return;
    }
    notify({ title, body });
  } catch {}
}

// ===== sync engine (phase 14) =====
// Five thin wrappers over the Tauri commands in commands.rs. The
// engine stays silent unless syncEnable(true) is called AFTER a
// successful syncSetup + syncEnroll round-trip.

export async function syncGeneratePhrase() {
  return call("sync_generate_phrase");
}

/** Re-reveal the recovery phrase stored on this device. Returns the 24 words,
 *  or null on a paired device (which never holds the phrase). */
export async function syncRevealPhrase() {
  return call("sync_reveal_phrase");
}

export async function syncSetup(phrase, relayUrl) {
  return call("sync_setup", { phrase, relayUrl });
}

export async function syncEnroll(enrollmentToken, deviceLabel) {
  return call("sync_enroll", { enrollmentToken, deviceLabel });
}

export async function syncSelfEnroll(phrase, relayUrl, deviceLabel) {
  return call("sync_self_enroll", { phrase, relayUrl, deviceLabel });
}

export async function syncInit(phrase, relayUrl, deviceLabel) {
  return call("sync_init", { phrase, relayUrl, deviceLabel });
}

/** Attach this device to the account a known recovery phrase already
 *  belongs to, on a multi_user relay. `syncInit` creates; this finds. */
export async function syncRecover(phrase, relayUrl, deviceLabel) {
  return call("sync_recover", { phrase, relayUrl, deviceLabel });
}

export async function syncSetEnabled(enabled) {
  return call("sync_set_enabled", { enabled });
}

/// Explicit re-upload: clear cached ciphertext, reset the pull
/// cursor, and re-trigger backfill. The next worker tick re-encrypts
/// and re-uploads every committed / pending_upload op. Use sparingly
/// — same-phrase re-enroll no longer does this implicitly.
export async function syncForceReupload() {
  return call("sync_force_reupload");
}

export async function syncStatus() {
  return call("sync_status");
}

/// Blocking upload pass, run inline on the Rust side right now instead of
/// waiting for the worker thread's next scheduled tick. Called from the
/// app's `visibilitychange` / `pagehide` handlers — on Android the worker
/// thread can be frozen the instant the app backgrounds, so a debounced
/// `wake_after` flag it may never get scheduled to notice is not enough;
/// this is the last chance to get pending writes out before that happens.
/// Fire-and-forget from the caller's side (no UI is awaiting this), but
/// the promise itself always resolves — the Rust command never throws,
/// even when sync is off or unconfigured (see sync_flush_now's doc
/// comment in commands.rs).
export async function syncFlushNow() {
  return call("sync_flush_now");
}

/// Last N sync errors (default 20, clamped 1..=50 server-side) for
/// the status-pill popover. Each entry is { at_ms, kind, message }
/// where kind is one of quota / rate_limit / decrypt / network /
/// auth / other (bucketed in config.rs).
export async function syncErrorHistory(limit) {
  return call("sync_error_history", { limit });
}

/// Snapshot of the op-log engine state (phase 13.9). Surfaced in
/// the sync settings panel so operators can verify backfill ran +
/// see how many ops are pending upload (local_only state).
export async function opLogStats() {
  return call("op_log_stats");
}

/// Re-run merge for op_log rows that previously bounced. Returns
/// the count of rows whose merge_error was cleared on this pass.
export async function syncReplayFailed() {
  return call("sync_replay_failed");
}

// ===== sync ops surface (phase 14.22) =====

/// Pause the sync engine — the worker keeps polling but each tick
/// short-circuits when enabled=false. Mirrors `syncSetEnabled(false)`
/// under a clearer name for the settings UI.
export async function syncPause() {
  return call("sync_pause");
}

/// Resume the sync engine.
export async function syncResume() {
  return call("sync_resume");
}

/// Reset the pull cursor to 0 and run a sync tick immediately.
/// Returns the post-tick status snapshot. Used by recovery-phrase
/// re-enrollment on a new device — without this the user waits up
/// to 30s for the next worker poll before seeing their old state.
export async function syncForcePull() {
  return call("sync_force_pull");
}

/// Update the relay URL. The next sync tick uses the new value.
export async function syncSetRelayUrl(url) {
  return call("sync_set_relay_url", { url });
}

/// Revoke a paired device by id. After 204 the target device's worker
/// starts getting 401 device_revoked. Self-revoke (passing this
/// device's own id) is allowed.
export async function syncRevokeDevice(targetDeviceId) {
  return call("sync_revoke_device", { targetDeviceId });
}

/// List devices on this user's account. Returns rows of
/// { id, label, created_at, revoked_at }. Frontend filters revoked.
export async function listDevices() {
  return call("sync_list_devices");
}

/// Alias for syncRevokeDevice matching the device-management UI naming.
export async function revokeDevice(deviceId) {
  return call("sync_revoke_device", { targetDeviceId: deviceId });
}

/// Disconnect from the relay and clear all sync state. Pages,
/// lineages, pins, and the op_log are preserved; the user can
/// re-enroll later (same or different phrase).
export async function syncReset() {
  return call("sync_reset");
}

/// Storage quota readout for the current user. Returns
/// { used, cap, tier }. `cap` is null on uncapped / self-hosted
/// relays — the UI renders that as the infinity branch.
export async function syncQuota() {
  return call("sync_quota");
}

/// Register or update the email address for web access at shizumu.app.
/// The relay sends a verification email on success. On failure, rejects
/// with the relay error code string: "email_unavailable", "bad_password",
/// "bad_email", or "mail_failed".
export async function syncSetAccountEmail(email, password) {
  return call("sync_set_account_email", { email, password });
}

/// Fetch this account's current email address and verification status.
/// Returns { email: string|null, verified: bool }.
export async function syncAccountEmailStatus() {
  return call("sync_account_email_status");
}

/// Redeem a license key. On success the relay upgrades the account tier.
/// On failure, rejects with the relay error code string:
/// "unknown_key", "already_bound", "inactive", or "bad_body".
export async function syncRedeemLicense(licenseKey) {
  return call("sync_redeem_license", { licenseKey });
}

/// Probe the relay's /healthz endpoint before persisting keys. Runs
/// through reqwest in Rust (not browser fetch) to bypass the CORS
/// rejection on tauri://localhost → http://relay.host.
export async function syncRelayHealth(relayUrl) {
  return call("sync_relay_health", { relayUrl });
}

/// Switch to a different relay URL. Clears cached ciphertext + cursor
/// so the new relay receives fresh uploads. Keeps keys/identity. The
/// user still needs to re-enroll on the new relay.
export async function syncSwitchRelay(newUrl) {
  return call("sync_switch_relay", { newUrl });
}

// ===== pairing (phase 14.15) =====

export async function pairExistingStart(ttlSeconds = 300) {
  return call("pair_existing_start", { ttlSeconds });
}

export async function pairExistingFetchSas(pairToken, attempts = 40) {
  return call("pair_existing_fetch_sas", { pairToken, attempts });
}

export async function pairExistingConfirm(args) {
  // args: { pairToken, ephemeralPubB64, newDeviceLabel, newDeviceSignPubB64, newDeviceId }
  return call("pair_existing_confirm", args);
}

export async function pairNewJoin(qrPayload) {
  return call("pair_new_join", { qrPayload });
}

export async function pairNewComplete(qrPayload, deviceLabel, pollAttempts = 120) {
  return call("pair_new_complete", { qrPayload, deviceLabel, pollAttempts });
}

// ===== attachments (v0.4) =====

/** Returns { blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at }. */
export async function attachmentAdd(sourcePath, sync = false) {
  return call("attachment_add", { sourcePath, sync });
}

/** Add an attachment from bytes read in the WebView (works on Android/iOS/web,
 *  where the picker returns a content:// URI the Rust fs layer can't read). */
export async function attachmentAddBytes(bytes, filename, mimeType, sync = false) {
  return call("attachment_add_bytes", { bytes: Array.from(bytes), filename, mimeType, sync });
}

/** `filename` is the attachment's original name (read off the node attrs by
 *  the caller). Only Android's opener path uses it — content-addressed
 *  blobs have no extension, so it's what names the staged share copy and
 *  picks its MIME type — but it's required on every platform so the
 *  frontend can't forget it. */
export async function attachmentOpen(blobHash, filename) {
  return call("attachment_open", { blobHash, filename });
}

export async function attachmentSetSync(blobHash, sync) {
  return call("attachment_set_sync", { blobHash, sync });
}

export async function attachmentList() {
  return call("attachment_list");
}

export async function attachmentGc() {
  return call("attachment_gc");
}

/** Bytes this device is actually holding — not the relay-side synced total. */
export async function attachmentLocalBytes() {
  return call("attachment_local_bytes");
}

/** Absolute path of a blob on this device, or null if it isn't here. */
export async function attachmentLocalSrc(blobHash) {
  return call("attachment_local_src", { blobHash });
}
