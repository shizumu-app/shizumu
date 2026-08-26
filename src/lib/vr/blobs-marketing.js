// The bitmaps a marketing scene's attachment nodes resolve to.
//
// The seeded mock has no blob store — api.js answers `attachment_local_src`
// with null — so an `attachment` node renders "image not on this device"
// unless the scene supplies the bytes itself. `mk-evidence` does, through
// createSeededInvoke's `blobs` option (see seed.js). Every baselined VR
// scene leaves that option alone, so nothing here can move a baseline.
//
// `?inline` makes Vite hand back a data URI rather than a URL, which keeps
// the file out of `public/` — a marketing asset copied into the shipped app
// bundle to make a screenshot render is the wrong trade. This module is only
// ever reached through the dynamic import in scenes.js's `mk-evidence`,
// itself inside bootstrap.js's DEV/VITE_VR gate, so a production build never
// pulls the base64 in.
//
// The image is not stock art: it is a real screenshot of the empty-table
// gutter offering `delete` alone, shot from `mk-evidence-subject` by
// `marketing/launch/screenshots/2026-08-26/_capture/capture-evidence.mjs`.
// Re-shoot it with that script rather than editing it by hand.
import evidenceEmptyTable from "../../../marketing/launch/screenshots/2026-08-26/_capture/assets/evidence-empty-table.png?inline";
import { EVIDENCE_BLOB_HASH } from "./fixtures-marketing.js";

export const MARKETING_BLOBS = {
  [EVIDENCE_BLOB_HASH]: evidenceEmptyTable,
};
