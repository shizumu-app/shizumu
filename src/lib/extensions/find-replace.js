import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * `find-replace` — in-page substring search with inline match highlights and
 * a single "active" match (the one Enter would replace / scroll to).
 *
 * The plugin owns:
 *   - `query`     : current search string (substring, case-insensitive)
 *   - `matches`   : array of { from, to } absolute doc positions
 *   - `activeIdx` : index into `matches` for the currently-focused match
 *
 * The host (FindBar.svelte) talks to the plugin through three commands
 * exposed on the editor:
 *   - editor.commands.setFindQuery(query: string)
 *   - editor.commands.nextFindMatch() / prevFindMatch()
 *   - editor.commands.replaceCurrentMatch(replacement: string)
 *   - editor.commands.replaceAllMatches(replacement: string)
 *
 * It also broadcasts state via a custom DOM event `shizumu:find-state` so
 * the FindBar can update its match count without polling.
 */

const FindReplaceKey = new PluginKey("findReplace");

/** Walk the doc to collect all substring match ranges. Case-insensitive. */
function collectMatches(doc, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const matches = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || "";
    const haystack = text.toLowerCase();
    let i = 0;
    while (i <= haystack.length - q.length) {
      const found = haystack.indexOf(q, i);
      if (found === -1) break;
      matches.push({ from: pos + found, to: pos + found + q.length });
      i = found + q.length;
    }
  });
  return matches;
}

function decorationsFor(matches, activeIdx) {
  if (matches.length === 0) return DecorationSet.empty;
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIdx ? "find-match find-match-active" : "find-match",
    }),
  );
  return DecorationSet.empty.add(null, decos); // null doc — DecorationSet will accept positions directly
}

function broadcast(view, state) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("shizumu:find-state", {
      detail: {
        query: state.query,
        total: state.matches.length,
        activeIdx: state.activeIdx,
      },
    }),
  );
}

export const FindReplace = Extension.create({
  name: "findReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: FindReplaceKey,
        state: {
          init() {
            return { query: "", matches: [], activeIdx: -1 };
          },
          apply(tr, prev) {
            const meta = tr.getMeta(FindReplaceKey);
            if (meta) {
              if ("query" in meta) {
                const matches = collectMatches(tr.doc, meta.query);
                return {
                  query: meta.query,
                  matches,
                  activeIdx: matches.length > 0 ? 0 : -1,
                };
              }
              if ("activeIdx" in meta) {
                return { ...prev, activeIdx: meta.activeIdx };
              }
            }
            // Doc changed: re-collect matches at new positions.
            if (tr.docChanged && prev.query) {
              const matches = collectMatches(tr.doc, prev.query);
              let activeIdx = prev.activeIdx;
              if (activeIdx >= matches.length) activeIdx = matches.length - 1;
              if (matches.length === 0) activeIdx = -1;
              return { query: prev.query, matches, activeIdx };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const s = FindReplaceKey.getState(state);
            if (!s || s.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) =>
                Decoration.inline(m.from, m.to, {
                  class: i === s.activeIdx ? "find-match find-match-active" : "find-match",
                }),
              ),
            );
          },
        },
        view(view) {
          // Initial broadcast so a freshly-opened FindBar sees state.
          const s = FindReplaceKey.getState(view.state);
          if (s) broadcast(view, s);
          return {
            update(view, _prev) {
              const s = FindReplaceKey.getState(view.state);
              if (s) broadcast(view, s);
            },
          };
        },
      }),
    ];
  },

  addCommands() {
    return {
      setFindQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(FindReplaceKey, { query });
            dispatch(tr);
          }
          return true;
        },

      nextFindMatch:
        () =>
        ({ state, tr, dispatch, view }) => {
          const s = FindReplaceKey.getState(state);
          if (!s || s.matches.length === 0) return false;
          const next = (s.activeIdx + 1) % s.matches.length;
          if (dispatch) {
            tr.setMeta(FindReplaceKey, { activeIdx: next });
            dispatch(tr);
            scrollToMatch(view, s.matches[next]);
          }
          return true;
        },

      prevFindMatch:
        () =>
        ({ state, tr, dispatch, view }) => {
          const s = FindReplaceKey.getState(state);
          if (!s || s.matches.length === 0) return false;
          const prev = (s.activeIdx - 1 + s.matches.length) % s.matches.length;
          if (dispatch) {
            tr.setMeta(FindReplaceKey, { activeIdx: prev });
            dispatch(tr);
            scrollToMatch(view, s.matches[prev]);
          }
          return true;
        },

      replaceCurrentMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = FindReplaceKey.getState(state);
          if (!s || s.matches.length === 0 || s.activeIdx < 0) return false;
          const m = s.matches[s.activeIdx];
          if (dispatch) {
            tr.replaceWith(m.from, m.to, state.schema.text(replacement));
            // After replace, matches will be recomputed on the next tick
            // via the docChanged branch in `apply`. The activeIdx may
            // shift if the replacement changes the match count.
            dispatch(tr);
          }
          return true;
        },

      replaceAllMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const s = FindReplaceKey.getState(state);
          if (!s || s.matches.length === 0) return false;
          if (dispatch) {
            // Walk backwards so earlier match positions don't shift mid-replace.
            for (let i = s.matches.length - 1; i >= 0; i--) {
              const m = s.matches[i];
              tr.replaceWith(m.from, m.to, state.schema.text(replacement));
            }
            tr.setMeta(FindReplaceKey, { query: s.query });
            dispatch(tr);
          }
          return true;
        },
    };
  },
});

function scrollToMatch(view, match) {
  if (!match) return;
  try {
    const dom = view.domAtPos(match.from);
    const el =
      dom?.node?.nodeType === 1
        ? dom.node
        : dom?.node?.parentElement;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } catch {}
}
