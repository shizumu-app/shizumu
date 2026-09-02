// Canonical TipTap extension lists. Single source of truth for what's
// registered with both the live editor (TipTapEditor.svelte) and the
// static renderer (doc-renderer.js).
//
// Two arrays:
//   READONLY_EXTENSIONS — every app node + schema needed to parse / render
//     a saved doc. No editing affordances (slash menu, mention search,
//     keymaps). Safe to pass to `generateHTML(doc, READONLY_EXTENSIONS)`
//     and to read-only editor mounts (ThreadPageView, SharedObjectsPanel
//     pin preview, future trail-map hover).
//   EDITING_EXTENSIONS — READONLY_EXTENSIONS + the editing-only plugins
//     (placeholder, slash, mention, block-movement). Used only by the
//     writable editor on PAGE.
//
// Adding a new node: add it to READONLY_EXTENSIONS. Adding a new editing
// affordance (a keymap, a suggestion plugin): add it to EDITING_ONLY.
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Collaboration } from "@tiptap/extension-collaboration";
import { XML_FRAGMENT_KEY } from "../yjs/page-doc.js";

import { UnifiedListExtensions } from "../extensions/unified-list.js";
import { PageRef } from "../extensions/page-ref.js";
import { PinRef } from "../extensions/pin-ref.js";
import { RecipeBlock } from "../extensions/recipe-block.js";
import { DecisionBlock } from "../extensions/decision-block.js";
import { Chart } from "../extensions/chart.js";
import { FindReplace } from "../extensions/find-replace.js";
import { DateSeparator } from "../extensions/date-separator.js";
import { DayMarker } from "../extensions/day-marker.js";
import { QABlock } from "../extensions/qa-block.js";
import { QAPair } from "../extensions/qa-pair.js";
import { PinId } from "../extensions/pin-id.js";
import { BlockTitle } from "../extensions/block-title.js";
import { BlockTypeChip } from "../extensions/block-type-chip.js";
import { TouchBlockHandle } from "../extensions/touch-block-handle.js";
import { BlockMovement } from "../extensions/block-movement.js";
import { BlockCopyKeymap } from "../extensions/block-copy-keymap.js";
import { BlockTabNoop } from "../extensions/block-tab-noop.js";
import { BlockEscExit } from "../extensions/block-esc-exit.js";
import { SelectionAccentDecorations } from "../extensions/selection-accent-decorations.js";
import { LocalImage } from "../extensions/local-image.js";
import { CodeBlockShizumu } from "../extensions/code-block.js";
import { Attachment } from "../extensions/attachment.js";
import { ShellTableView } from "../extensions/table-shell-view.js";
import { SlashCommands } from "../slash-commands.js";
import { MentionCommand } from "../extensions/mention-command.js";

// Read-only extension list. Pass to generateHTML or to an editable: false
// Editor. Includes every node the schema needs to parse a saved doc.
// Editing-only plugins (placeholder, slash, mention, block-movement) are
// excluded — they have no effect on rendering and adding them to a
// read-only mount just wastes init work.
export const READONLY_EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    // Disable bundled list extensions — replaced by UnifiedListExtensions.
    bulletList: false,
    orderedList: false,
    listItem: false,
    // Disable bundled code block — replaced by CodeBlockShizumu which
    // adds the header NodeView (language input + copy button).
    codeBlock: false,
  }),
  Table.configure({ resizable: false, View: ShellTableView }),
  Attachment,
  TableRow,
  TableHeader,
  TableCell,
  ...UnifiedListExtensions,
  PageRef,
  PinRef,
  RecipeBlock,
  DecisionBlock,
  Chart,
  DateSeparator,
  DayMarker,
  QABlock,
  QAPair,
  PinId,
  BlockTitle,
  LocalImage,
  CodeBlockShizumu,
  Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  BlockTypeChip,
  // Pin stays reachable from a read-only (past-day) page on touch — the
  // block-actions sheet's pin/title actions aren't readonly-gated (see
  // openBlockActionSheet in TipTapEditor.svelte), only copy/insert/delete
  // are.
  TouchBlockHandle,
];

// Factory for the writable editor's extension list. Takes the editor-only
// callbacks that PAGE wires in (slash menu, mention onCreate, pageRef
// onNavigate, placeholder text) so the call site stays declarative.
//
// Why a factory: SlashCommands and MentionCommand bind closures over PAGE
// state at construction time; they can't be module-level constants.
export function buildEditingExtensions({
  placeholder = "write one thought, then return",
  onCreateSubtrail = () => {},
  getCurrentLineage = () => null,
  onPageRefNavigate = () => {},
  onPinRefNavigate = () => {},
  onChartOpen = () => {},
  collaborationDoc = null,
  floatingChrome = true,
} = {}) {
  // When `collaborationDoc` (a Y.Doc) is supplied — continuous-trail
  // pages with the enable_yjs flag on — the Collaboration extension
  // takes over document state. We disable StarterKit's history because
  // Collaboration ships its own (which knows how to undo only the
  // local user's edits, not concurrent peers').
  const starter = StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: false,
    orderedList: false,
    listItem: false,
    codeBlock: false,
    ...(collaborationDoc ? { history: false } : {}),
  });
  const extensions = [
    starter,
    Table.configure({ resizable: true, View: ShellTableView }),
    Attachment,
    TableRow,
    TableHeader,
    TableCell,
    ...UnifiedListExtensions,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") return "heading";
        // Code blocks have their own header (language input + copy button);
        // the canvas placeholder ("one thought, then return") leaking into
        // an empty <pre><code> reads as a typo from the language field.
        if (node.type.name === "codeBlock") return "";
        return placeholder;
      },
    }),
    // The three floating surfaces, and the one seam that turns them off.
    //
    // The mobile shell's spec (§3, 2026-08-22) states one rule: editor
    // chrome exists in exactly two places, the bottom slot and the gutter
    // handle on the active block — "No bubble menu, no floating
    // slash/mention menu, no floating `+` widget." The bubble menu already
    // obeyed, because it is markup in TipTapEditor.svelte and the shell
    // does not render that file. These three are EXTENSIONS, registered
    // here, so the shell inherited them by sharing this factory and the
    // rule had no producer at all.
    //
    // It was not cosmetic. The floating slash menu dismisses on any
    // pointerdown outside itself, on `document` in CAPTURE phase, and
    // exitSuggestion zeroes the plugin's range/query before the shell's
    // own suggestion chip handler runs — so a chip acting on `/outline`
    // deleted nothing and converted the whole line.
    //
    // `floatingChrome: false` does NOT drop all three, and the first shape
    // of this seam — which did — was unusable. SlashCommands and
    // MentionCommand are not menus that happen to live in an extension;
    // each IS the @tiptap/suggestion plugin whose state (active, range,
    // query) is the only producer of a live `/` or `@` session. The shell's
    // own chip strip is derived entirely from that state, read back through
    // SlashCommandsPluginKey / MentionCommandPluginKey. Removing the
    // extensions removed the state machine along with the renderer, and
    // traded a doubled menu for no menu at all.
    //
    // So the plugins stay and their renderers go: `floatingMenu: false`
    // (slash-commands.js, mention-command.js) swaps the floating-DOM
    // renderer for handlers that build nothing. TouchBlockHandle, below,
    // is the one of the three that really is free to omit — the shell has
    // its own gutter handle, and nothing listens for the
    // `shizumu-block-insert` event this one fires.
    //
    // Named for what it controls rather than for a host, because a host
    // name here would have to be kept in step with hosts this file cannot
    // see. Desktop keeps every floating surface by default; passing false
    // is a positive claim that the caller renders its own chrome.
    SlashCommands.configure({ floatingMenu: floatingChrome }),
    MentionCommand.configure({
      onCreate: onCreateSubtrail,
      getCurrentLineage,
      floatingMenu: floatingChrome,
    }),
    PageRef.configure({
      onNavigate: onPageRefNavigate,
    }),
    PinRef.configure({
      onNavigate: onPinRefNavigate,
    }),
    RecipeBlock,
    DecisionBlock,
    DateSeparator,
    DayMarker,
    QABlock,
    QAPair,
    PinId,
    BlockTitle,
    BlockMovement,
    BlockCopyKeymap,
    BlockTabNoop,
    BlockEscExit,
    SelectionAccentDecorations,
    BlockTypeChip,
    // The genuinely free one — see the note above. Omitted, not disabled.
    ...(floatingChrome ? [TouchBlockHandle] : []),
    LocalImage,
    Chart.configure({
      onOpen: onChartOpen,
    }),
    CodeBlockShizumu,
    FindReplace,
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
  ];
  if (collaborationDoc) {
    extensions.push(
      Collaboration.configure({
        document: collaborationDoc,
        // Must match XML_FRAGMENT_KEY in src/lib/yjs/page-doc.js, or
        // the editor mounts empty against the wrong fragment slot.
        fragment: collaborationDoc.get(XML_FRAGMENT_KEY),
      }),
    );
  }
  return extensions;
}
