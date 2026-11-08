// When the laptop's focus field (WhatMattersNow.svelte) takes its `value`
// prop over the text it holds.
//
// Only when the prop CHANGED since the field last looked at it, or the page
// did. Until 0.8.2 the rule was "the prop differs from the last saved text",
// and Page.svelte does not patch `page.what_matters_now` when the field
// saves: the prop stayed the null the page was created with, so the first
// time `page` was replaced (a trail created from the header) the field read
// that same stale null as news, emptied itself, and Return saved "" over the
// focus the writer had just typed (J12.1 on the A16, 2026-11-07).

/** @param {{ pageId: string, value: string } | null} seen what the field last
 *  took: its page and its prop, "" for none.
 *  @param {string} pageId
 *  @param {string | null | undefined} value
 *  @returns {boolean} */
export function focusPropChanged(seen, pageId, value) {
  if (!seen) return true;
  if (seen.pageId !== pageId) return true;
  return seen.value !== (value || "");
}
