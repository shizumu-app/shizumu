<script>
  import { onMount, tick } from "svelte";
  import { fade } from "svelte/transition";
  import {
    getLineages,
    createLineage,
    deleteLineage,
    renameLineage,
    setLineageParent,
    foldLineage,
  } from "../lib/api.js";
  import { buildTreeList, isItemVisible, getDescendantIds } from "../lib/trail-utils.js";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";
  import BottomSheet from "../lib/ui/BottomSheet.svelte";
  import TriggerChip from "../lib/ui/TriggerChip.svelte";
  import Icon from "../lib/ui/Icon.svelte";

  // Map server-side typed error codes to display copy.
  const ERROR_COPY = {
    lineage_name_empty: "name cannot be empty",
    lineage_name_taken: (name) => `a trail named "${name}" already exists`,
    lineage_not_found: "trail no longer exists",
    parent_not_found: "target trail no longer exists",
    target_not_found: "target trail no longer exists",
    cannot_self_parent: "cannot move under itself",
    cannot_move_under_descendant: "cannot move under its own descendant",
    cannot_fold_into_self: "cannot fold into itself",
    cannot_fold_into_descendant: "cannot fold into its own descendant",
    cannot_fold_continuous_into_continuous:
      "both trails own a single living document. delete one first or move pages individually.",
    cannot_fold_discrete_into_continuous:
      "cannot fold a discrete trail into a continuous one",
  };

  function formatError(err, ctx = {}) {
    const code = typeof err === "string" ? err : err?.message ?? String(err);
    const entry = ERROR_COPY[code];
    if (typeof entry === "function") return entry(ctx.name ?? "");
    if (typeof entry === "string") return entry;
    return code;
  }

  /** @type {{ pageId: string, lineageId: string | null, readonly: boolean, onLineageChange: (lineageId: string | null) => void, compact?: boolean }} */
  let { pageId, lineageId = null, readonly = false, onLineageChange = () => {}, compact = false } = $props();

  let lineages = $state([]);
  let isOpen = $state(false);
  let filterText = $state("");
  let currentLineage = $state(null);
  let selectedParent = $state(null);
  let showNestPicker = $state(false);
  let newTrailMode = $state("discrete");

  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });

  onMount(async () => {
    try {
      lineages = await getLineages();
      if (lineageId) {
        currentLineage = lineages.find(l => l.id === lineageId) || null;
      }
    } catch { lineages = []; }
  });

  $effect(() => {
    if (!lineageId) {
      currentLineage = null;
      return;
    }
    if (lineages.length > 0) {
      const found = lineages.find(l => l.id === lineageId);
      if (found) {
        currentLineage = found;
        return;
      }
    }
    // Cache miss — the page just got assigned to a lineage that wasn't in
    // our list (most often: a fresh trail or subtrail created via @ in the
    // editor, or by another component). Refetch and re-resolve.
    getLineages()
      .then((lins) => {
        lineages = lins;
        currentLineage = lins.find((l) => l.id === lineageId) || null;
      })
      .catch(() => {
        // leave currentLineage as-is; user can refresh manually.
      });
  });

  // Expand/collapse state (session-scoped)
  let expandedIds = $state(new Set());

  function toggleExpand(id, e) {
    e.stopPropagation();
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedIds = next;
  }

  // Get breadcrumb path for a lineage (e.g. "product › export api")
  function getBreadcrumb(lineage) {
    if (!lineage?.parent_id) return lineage?.name || "";
    const parts = [lineage.name];
    let current = lineage;
    while (current.parent_id) {
      const parent = lineages.find(l => l.id === current.parent_id);
      if (!parent) break;
      parts.unshift(parent.name);
      current = parent;
    }
    return parts.join(" › ");
  }

  // Root-level lineages for "nest under" picker
  let nestableLineages = $derived(lineages.filter(l => true)); // all lineages can be parents

  let treeList = $derived(buildTreeList(lineages));

  let filtered = $derived(
    filterText.length > 0
      ? treeList.filter(l => l.name.toLowerCase().includes(filterText.toLowerCase()))
      : treeList.filter(l => isItemVisible(l, lineages, expandedIds))
  );

  async function selectLineage(lineage) {
    isOpen = false;
    filterText = "";
    onLineageChange(lineage.id);
  }

  async function confirmCreateNew() {
    const name = filterText.trim();
    if (name.length === 0) return;
    try {
      const newLineage = await createLineage(name, newTrailMode, selectedParent?.id || null);
      lineages = [newLineage, ...lineages];
      showNestPicker = false;
      selectedParent = null;
      newTrailMode = "discrete";
      await selectLineage(newLineage);
    } catch (err) {
      console.error("Failed to create lineage:", err);
    }
  }

  // Action menu state (one panel at a time across the whole selector).
  let actionMenuFor = $state(null);
  let renamingTrail = $state(null);
  let renameValue = $state("");
  let renameError = $state("");
  let movingTrail = $state(null);
  let moveTargetParentId = $state(null);
  let foldingTrail = $state(null);
  let foldTargetId = $state(null);

  let deletingTrail = $state(null);
  let deleteMode = $state("unlink"); // "unlink" or "move"
  let moveTargetId = $state(null);

  function closeAllPanels() {
    actionMenuFor = null;
    renamingTrail = null;
    renameValue = "";
    renameError = "";
    movingTrail = null;
    moveTargetParentId = null;
    foldingTrail = null;
    foldTargetId = null;
    deletingTrail = null;
    deleteMode = "unlink";
    moveTargetId = null;
  }

  function toggleActionMenu(lineage, e) {
    e.stopPropagation();
    actionMenuFor = actionMenuFor === lineage.id ? null : lineage.id;
  }

  async function startRename(lineage) {
    closeAllPanels();
    renamingTrail = lineage;
    renameValue = lineage.name;
    renameError = "";
    await tick();
  }

  function cancelRename() {
    renamingTrail = null;
    renameValue = "";
    renameError = "";
  }

  async function confirmRename() {
    if (!renamingTrail) return;
    const trimmed = renameValue.trim();
    if (trimmed === renamingTrail.name) {
      cancelRename();
      return;
    }
    try {
      const updated = await renameLineage(renamingTrail.id, trimmed);
      lineages = lineages.map((l) => (l.id === updated.id ? { ...l, ...updated } : l));
      if (currentLineage?.id === updated.id) currentLineage = { ...currentLineage, ...updated };
      cancelRename();
    } catch (err) {
      renameError = formatError(err, { name: trimmed });
    }
  }

  function renameKeydown(e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function startMove(lineage) {
    closeAllPanels();
    movingTrail = lineage;
    moveTargetParentId = lineage.parent_id ?? null;
  }

  function cancelMove() {
    movingTrail = null;
    moveTargetParentId = null;
  }

  async function confirmMove() {
    if (!movingTrail) return;
    try {
      const updated = await setLineageParent(movingTrail.id, moveTargetParentId);
      lineages = lineages.map((l) => (l.id === updated.id ? { ...l, ...updated } : l));
      cancelMove();
    } catch (err) {
      console.error("move failed:", formatError(err));
      cancelMove();
    }
  }

  function startFold(lineage) {
    closeAllPanels();
    foldingTrail = lineage;
    foldTargetId = null;
  }

  function cancelFold() {
    foldingTrail = null;
    foldTargetId = null;
  }

  async function confirmFold() {
    if (!foldingTrail || !foldTargetId) return;
    try {
      const result = await foldLineage(foldingTrail.id, foldTargetId);
      lineages = lineages.filter((l) => l.id !== foldingTrail.id);
      if (currentLineage?.id === foldingTrail.id) {
        currentLineage = null;
        onLineageChange(foldTargetId);
      }
      console.info(
        `folded — ${result.pages_moved} page(s), ${result.pins_moved} pin(s)`,
      );
      cancelFold();
    } catch (err) {
      console.error("fold failed:", formatError(err));
      cancelFold();
    }
  }

  // Eligibility helpers for the move/fold target pickers.
  function moveTargets(lineage) {
    if (!lineage) return [];
    const blocked = new Set([lineage.id, ...getDescendantIds(lineage.id, lineages)]);
    return lineages.filter((l) => !blocked.has(l.id));
  }

  function foldTargets(lineage) {
    if (!lineage) return [];
    const blocked = new Set([lineage.id, ...getDescendantIds(lineage.id, lineages)]);
    return lineages.filter((l) => {
      if (blocked.has(l.id)) return false;
      // mode compatibility — refuse discrete→continuous, continuous→continuous
      if (lineage.mode === "discrete" && l.mode === "continuous") return false;
      if (lineage.mode === "continuous" && l.mode === "continuous") return false;
      return true;
    });
  }

  function startDelete(lineage) {
    closeAllPanels();
    deletingTrail = lineage;
    deleteMode = "unlink";
    moveTargetId = null;
  }

  function cancelDelete() {
    deletingTrail = null;
    deleteMode = "unlink";
    moveTargetId = null;
  }

  async function confirmDelete() {
    if (!deletingTrail) return;
    const targetId = deleteMode === "move" ? moveTargetId : null;
    try {
      await deleteLineage(deletingTrail.id, targetId);
      lineages = lineages.filter(l => l.id !== deletingTrail.id);
      if (currentLineage?.id === deletingTrail.id) {
        currentLineage = null;
        onLineageChange(null);
      }
      cancelDelete();
    } catch (err) {
      console.error("Failed to delete trail:", err);
    }
  }

  async function clearLineage() {
    isOpen = false;
    onLineageChange(null);
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      if (renamingTrail) { cancelRename(); }
      else if (movingTrail) { cancelMove(); }
      else if (foldingTrail) { cancelFold(); }
      else if (deletingTrail) { cancelDelete(); }
      else if (actionMenuFor) { actionMenuFor = null; }
      else if (showNestPicker) { showNestPicker = false; }
      else { isOpen = false; filterText = ""; }
    }
    if (e.key === "Enter" && filterText.trim().length > 0 && filtered.length === 0 && lineages.length > 0) {
      e.preventDefault();
      confirmCreateNew();
    }
  }
</script>

<div class="lineage-selector">
  {#if readonly}
    {#if currentLineage}
      <span class="lineage-badge label">{isPhone ? currentLineage.name : getBreadcrumb(currentLineage)}</span>
    {/if}
  {:else}
    <TriggerChip
      active={!!currentLineage}
      onClick={() => isOpen = !isOpen}
      ariaLabel={currentLineage ? `change trail (${getBreadcrumb(currentLineage)})` : "pick trail"}
    >
      {#if currentLineage}
        {isPhone ? currentLineage.name : getBreadcrumb(currentLineage)}{#if currentLineage.mode === "continuous"} <span class="mode-icon"><Icon name="loop" size={13} /></span>{/if}
      {:else if compact}
        + trail
      {:else}
        trail (optional)
      {/if}
      <!-- Compact + untrailed reads as a quiet "+ trail" invitation with no
           chevron (nothing to open into yet, visually); every other state
           (trailed, or the desktop non-compact trigger) keeps the caret.
           The snippet itself is always declared — nesting the `{#snippet}`
           inside an `{#if}` doesn't reliably register `trailing` as a prop
           on TriggerChip, so the condition lives inside the snippet body
           instead. -->
      {#snippet trailing()}
        {#if !(compact && !currentLineage)}
          <span class="caret"><Icon name="chevron-right" /></span>
        {/if}
      {/snippet}
    </TriggerChip>

    {#snippet dropdownBody()}
      <input
        type="text"
        class="lineage-search selectable"
        placeholder="search or create..."
        bind:value={filterText}
        onkeydown={handleKeydown}
        spellcheck="false"
        autofocus
      />

        <div class="lineage-list">
          {#if currentLineage && filterText.trim().length === 0}
            <button class="lineage-option no-trail" onclick={clearLineage}>
              <span class="lineage-option-name">no trail</span>
              <span class="no-trail-hint label">detach</span>
            </button>
          {/if}
          {#each filtered.slice(0, 15) as lineage (lineage.id)}
            <div class="lineage-row" class:menu-open={actionMenuFor === lineage.id}>
              <div class="lineage-row-head">
                <button
                  class="lineage-option"
                  class:is-parent={lineage._hasChildren}
                  class:is-child={lineage._depth > 0}
                  class:is-current={currentLineage?.id === lineage.id}
                  style="padding-left: {14 + (lineage._depth || 0) * 16}px"
                  onclick={() => selectLineage(lineage)}
                >
                  {#if lineage._hasChildren}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span class="tree-chevron" onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); }} onclick={(e) => toggleExpand(lineage.id, e)}>
                      <Icon name={expandedIds.has(lineage.id) ? "chevron-down" : "chevron-right"} size={11} />
                    </span>
                  {:else}
                    <!-- Reserve chevron width so leaf trails (no chevron)
                         align vertically with sibling parent trails (with
                         chevron) at the same depth. Without this spacer
                         "v1" sat 12px left of "v0.*". -->
                    <span class="tree-chevron-spacer" aria-hidden="true"></span>
                  {/if}
                  {#if renamingTrail?.id === lineage.id}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      type="text"
                      class="rename-input"
                      bind:value={renameValue}
                      onkeydown={renameKeydown}
                      onblur={confirmRename}
                      onclick={(e) => e.stopPropagation()}
                      onmousedown={(e) => e.stopPropagation()}
                      autofocus
                      spellcheck="false"
                    />
                  {:else}
                    <span class="lineage-option-name">{lineage.name}</span>
                  {/if}
                  {#if lineage.mode === "continuous"}<span class="mode-icon-small"><Icon name="loop" size={11} /></span>{/if}
                  {#if lineage._hasChildren}
                    <span class="child-count">{treeList.filter(l => l.parent_id === lineage.id).length}</span>
                  {/if}
                </button>
                {#if lineage.name !== "main" && !renamingTrail}
                  <button
                    class="trail-actions label"
                    aria-label="trail actions"
                    onmousedown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onclick={(e) => toggleActionMenu(lineage, e)}
                  >⋮</button>
                {/if}
              </div>
              {#if renameError && renamingTrail?.id === lineage.id}
                <div class="row-error label">{renameError}</div>
              {/if}
              {#if actionMenuFor === lineage.id}
                <div class="row-actions">
                  <button class="row-action label" onclick={(e) => { e.stopPropagation(); startRename(lineage); }}>rename</button>
                  <button class="row-action label" onclick={(e) => { e.stopPropagation(); startMove(lineage); }}>move under…</button>
                  <button class="row-action label" onclick={(e) => { e.stopPropagation(); startFold(lineage); }}>fold into…</button>
                  <button class="row-action label danger" onclick={(e) => { e.stopPropagation(); startDelete(lineage); }}>delete</button>
                </div>
              {/if}
            </div>
          {/each}

          {#if filterText.trim().length > 0 && filtered.length === 0}
            <div class="create-inline">
              <p class="create-hint">most writing needs no trail — trail a thread once it proves it continues.</p>
              <button class="create-line" onclick={confirmCreateNew}>
                + create "{filterText.trim()}"
              </button>
              <div class="mode-toggle">
                <button class="mode-opt label" class:active={newTrailMode === "discrete"} onclick={() => newTrailMode = "discrete"}>discrete</button>
                <button class="mode-opt label" class:active={newTrailMode === "continuous"} onclick={() => newTrailMode = "continuous"}>continuous</button>
              </div>
              <p class="mode-explainer">
                {newTrailMode === "discrete"
                  ? "a page per day. yesterday closes, today is new."
                  : "one living document. it grows as long as you choose."}
              </p>
              {#if lineages.length > 0}
                {#if selectedParent}
                  <button class="nest-under" onclick={() => { showNestPicker = !showNestPicker; }}>
                    └ under: <span class="nest-val">{selectedParent.name}</span>
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <span class="nest-rm" onclick={(e) => { e.stopPropagation(); selectedParent = null; }}>×</span>
                  </button>
                {:else if !showNestPicker}
                  <button class="nest-under" onclick={() => showNestPicker = true}>
                    └ nest under...
                  </button>
                {/if}
                {#if showNestPicker}
                  {#each nestableLineages as parent (parent.id)}
                    <button
                      class="nest-pick"
                      class:selected={selectedParent?.id === parent.id}
                      onclick={() => { selectedParent = parent; showNestPicker = false; }}
                    >
                      {parent.name}
                    </button>
                  {/each}
                {/if}
              {/if}
            </div>
          {/if}

          {#if movingTrail}
            <div class="action-panel">
              <p class="action-title label">move "{movingTrail.name}" under…</p>
              <div class="move-target-list">
                <button
                  class="move-target-option"
                  class:selected={moveTargetParentId === null}
                  onclick={() => moveTargetParentId = null}
                >(top level)</button>
                {#each moveTargets(movingTrail) as target (target.id)}
                  <button
                    class="move-target-option"
                    class:selected={moveTargetParentId === target.id}
                    onclick={() => moveTargetParentId = target.id}
                  >{getBreadcrumb(target)}</button>
                {/each}
              </div>
              <div class="action-buttons">
                <button class="action-cancel label" onclick={cancelMove}>cancel</button>
                <button
                  class="action-confirm label"
                  disabled={moveTargetParentId === (movingTrail.parent_id ?? null)}
                  onclick={confirmMove}
                >move</button>
              </div>
            </div>
          {/if}

          {#if foldingTrail}
            <div class="action-panel">
              <p class="action-title label">fold "{foldingTrail.name}" into…</p>
              <div class="move-target-list">
                {#each foldTargets(foldingTrail) as target (target.id)}
                  <button
                    class="move-target-option"
                    class:selected={foldTargetId === target.id}
                    onclick={() => foldTargetId = target.id}
                  >{getBreadcrumb(target)}{#if target.mode === "continuous"} <span class="mode-icon-small"><Icon name="loop" size={11} /></span>{/if}</button>
                {/each}
                {#if foldTargets(foldingTrail).length === 0}
                  <div class="row-error label">no compatible trails to fold into</div>
                {/if}
              </div>
              <div class="action-buttons">
                <button class="action-cancel label" onclick={cancelFold}>cancel</button>
                <button
                  class="action-confirm label danger"
                  disabled={!foldTargetId}
                  onclick={confirmFold}
                >fold and delete</button>
              </div>
            </div>
          {/if}

          {#if deletingTrail}
            <div class="delete-panel">
              <p class="delete-title label">delete "{deletingTrail.name}"?</p>

              <label class="delete-radio">
                <input type="radio" name="delete-mode" value="unlink" bind:group={deleteMode} />
                <span>unlink pages</span>
                <span class="delete-hint label">pages keep content, lose trail</span>
              </label>

              <label class="delete-radio">
                <input type="radio" name="delete-mode" value="move" bind:group={deleteMode} />
                <span>move pages to</span>
              </label>

              {#if deleteMode === "move"}
                <div class="move-target-list">
                  {#each lineages.filter(l => l.id !== deletingTrail.id) as target (target.id)}
                    <button
                      class="move-target-option"
                      class:selected={moveTargetId === target.id}
                      onclick={() => moveTargetId = target.id}
                    >
                      {target.name}
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="delete-actions">
                <button class="delete-cancel label" onclick={cancelDelete}>cancel</button>
                <button
                  class="delete-confirm label"
                  disabled={deleteMode === "move" && !moveTargetId}
                  onclick={confirmDelete}
                >delete</button>
              </div>
            </div>
          {/if}
        </div>
    {/snippet}

    {#if isOpen && isPhone}
      <BottomSheet open={true} onClose={() => { isOpen = false; filterText = ""; }} title="trail">
        <div class="lineage-sheet">{@render dropdownBody()}</div>
      </BottomSheet>
    {:else if isOpen}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="lineage-overlay" onclick={() => { isOpen = false; filterText = ""; }}></div>
      <div class="lineage-dropdown" transition:fade={{ duration: 100 }}>
        {@render dropdownBody()}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* All sizing routed through rem so this picker tracks --ui-scale.
     Transitions normalized to 180ms cubic-bezier(0.2, 0, 0, 1); opacities
     pinned to the ladder (0.25 / 0.35 / 0.55 / 0.75 / 0.92). The dropdown
     keeps its bespoke layout — it has its own search, tree, rename input,
     and per-row action menu that don't map cleanly to ui/Popover. */
  .mode-icon {
    opacity: 0.25;
    display: inline-flex;
    margin-left: 0.125rem;
  }

  .mode-icon-small {
    opacity: 0.25;
    display: inline-flex;
    margin-left: 0.1875rem;
  }

  .mode-toggle {
    display: flex;
    gap: 0.25rem;
    padding: 0.25rem 0.875rem;
  }

  .mode-opt {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.25;
    padding: 0.125rem 0.5rem;
    border-radius: 0.1875rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .mode-opt.active {
    opacity: 0.55;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .mode-opt:hover {
    opacity: 0.55;
  }

  .lineage-overlay {
    position: fixed;
    inset: 0;
    z-index: 49;
  }

  .lineage-selector {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    position: relative;
    padding: 0.25rem 0;
  }

  .caret {
    font-size: 0.6875rem;
    opacity: 0.55;
  }

  .lineage-badge {
    opacity: 0.35;
    color: var(--warm-accent);
  }

  .lineage-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    /* On narrow screens the min-width was forcing horizontal overflow
       even with the max-width cap. Clamp min-width to the viewport so
       the dropdown never demands more space than the screen has. */
    min-width: min(20rem, calc(100vw - 2rem));
    max-width: calc(100vw - 2rem);
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border-radius: 0.5rem;
    padding: 0.375rem 0;
    z-index: 50;
  }

  /* Phone: dropdown content rendered inside the BottomSheet. Reset the
     popover-only constraints; comfy padding + taller list. */
  .lineage-sheet {
    width: 100%;
    padding: 0;
  }
  .lineage-sheet :global(.lineage-search) {
    font-size: 1rem;
    padding: 0.875rem 0.75rem;
  }
  .lineage-sheet :global(.lineage-list) {
    max-height: 60dvh;
  }
  .lineage-sheet :global(.lineage-option) {
    font-size: 0.9375rem;
    padding: 0.75rem 0.75rem;
    min-height: 3rem;
  }
  /* iOS zooms the viewport on any focused input under 16px — 1rem avoids it. */
  .lineage-sheet :global(.rename-input) {
    font-size: 1rem;
  }
  /* Roomier reach for the move/fold/delete target lists on a phone; the
     desktop dropdown keeps the compact 6.25rem cap. */
  .lineage-sheet :global(.move-target-list) {
    max-height: 40dvh;
  }

  .lineage-search {
    width: 100%;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.875rem;
    color: var(--ink);
    padding: 0.625rem 0.875rem;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .lineage-search:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 12%, transparent);
  }

  .lineage-search::placeholder {
    color: var(--ink);
    opacity: 0.25;
  }

  .lineage-list {
    max-height: 15rem;
    overflow-y: auto;
    padding: 0.25rem 0;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink) 10%, transparent) transparent;
  }
  .lineage-list::-webkit-scrollbar {
    width: 0.25rem;
  }
  .lineage-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .lineage-list::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--ink) 10%, transparent);
    border-radius: 0.25rem;
  }
  .lineage-list::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--ink) 18%, transparent);
  }

  .lineage-option {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    /* Clearer than the old 0.55 wash so trail names are easy to read, and
       tighter vertical padding so the list is denser (more trails visible
       at once). */
    opacity: 0.78;
    padding: 0.3125rem 0.875rem;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }

  .lineage-option:hover {
    /* Warm-accent highlight — the one consistent orange used by the header
       chips, the memory mode toggle, and the sync pill — instead of a grey
       ink wash, so the dropdown reads as the same family. */
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 1;
  }
  /* The current trail reads orange persistently (its "active" state), like a
     selected chip. */
  .lineage-option.is-current {
    color: var(--warm-accent);
    opacity: 1;
  }

  .lineage-option.is-parent {
    opacity: 0.92;
  }

  .lineage-option.is-child {
    font-size: 0.8125rem;
    opacity: 0.68;
  }

  .lineage-option.is-child::before {
    content: "·";
    color: var(--warm-accent);
    opacity: 0.35;
    font-size: 1rem;
    line-height: 1;
    margin-right: 0.125rem;
  }

  .lineage-option.is-child:hover {
    opacity: 1;
  }

  .lineage-option-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .child-count {
    font-family: "Inter", sans-serif;
    font-size: 0.625rem;
    color: var(--warm-accent);
    opacity: 0.55;
    flex-shrink: 0;
  }

  .tree-chevron {
    width: 1.5rem;
    height: 1.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.625rem;
    flex-shrink: 0;
    opacity: 0.35;
    cursor: pointer;
    line-height: 1;
    border-radius: 0.375rem;
    margin: -0.125rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .tree-chevron-spacer {
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
    display: inline-block;
    margin: -0.125rem 0;
  }

  .tree-chevron:hover {
    opacity: 0.55;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  /* "no trail" row at the top of the picker when a trail is currently selected. */
  .no-trail {
    border-bottom: 1px dashed color-mix(in srgb, var(--ink) 6%, transparent);
    margin-bottom: 0.125rem;
  }
  .no-trail .lineage-option-name {
    font-style: italic;
    opacity: 0.75;
  }
  .no-trail-hint {
    flex-shrink: 0;
    font-size: 0.625rem;
    opacity: 0.35;
    letter-spacing: 0.02em;
  }

  /* Delete panel */
  .delete-panel {
    padding: 0.75rem 0.875rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .delete-title {
    opacity: 0.55;
    margin-bottom: 0.625rem;
    color: var(--warm-accent);
  }
  .delete-radio {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.25rem 0;
    cursor: pointer;
  }
  .delete-radio input[type="radio"] {
    accent-color: var(--warm-accent);
    margin: 0;
  }
  .delete-hint {
    opacity: 0.35;
    font-size: 0.625rem;
  }
  .move-target-list {
    margin: 0.375rem 0 0.375rem 1.375rem;
    max-height: 6.25rem;
    overflow-y: auto;
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--ink) 10%, transparent) transparent;
  }
  .move-target-option {
    display: block;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: "Lora", serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.3125rem 0.625rem;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .move-target-option:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.75;
  }
  .move-target-option.selected {
    color: var(--warm-accent);
    opacity: 0.92;
  }
  .delete-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.625rem;
  }
  .delete-cancel {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.35;
    padding: 0.25rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .delete-cancel:hover { opacity: 0.75; }
  .delete-confirm {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--warm-accent);
    opacity: 0.55;
    padding: 0.25rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .delete-confirm:hover:not(:disabled) { opacity: 0.92; }
  .delete-confirm:disabled { opacity: 0.25; cursor: default; }

  /* Row + actions menu */
  .lineage-row {
    position: relative;
  }
  .lineage-row.menu-open {
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
  /* Flex-contains the option button plus the sibling "…" trigger — the
     trigger used to be a span nested inside the option button (hover-only,
     no real touch affordance); it's now a true sibling button so it can be
     focused, sized, and tapped on its own. */
  .lineage-row-head {
    display: flex;
    align-items: stretch;
  }
  .lineage-row-head .lineage-option {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .trail-actions {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    appearance: none;
    background: none;
    border: none;
    /* Vertical kebab: the standard "more actions" glyph. Sized up from the
       old 0.875rem horizontal ellipsis, which read as stray punctuation. */
    font-size: 1.125rem;
    line-height: 1;
    color: var(--ink);
    opacity: 0.3;
    cursor: pointer;
    padding: 0 0.375rem;
    border-radius: var(--radius-sm);
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }
  .trail-actions:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .lineage-row-head:hover .trail-actions { opacity: 0.55; }
  .trail-actions:hover {
    opacity: 0.92 !important;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0.875rem 0.5rem 0.875rem;
    border-bottom: 1px dashed color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .row-action {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    white-space: nowrap;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1),
                background 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .row-action:hover {
    opacity: 0.92;
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .row-action.danger { color: var(--warm-accent); }
  .row-action.danger:hover {
    background: var(--warm-accent-soft);
  }

  /* Touch: the "…" trigger is always visible (no hover to reveal it on a
     finger), and every action row/panel control grows to a thumb-sized
     target. Desktop dropdown sizing above is left untouched. */
  @media (pointer: coarse) {
    .trail-actions {
      opacity: 0.45;
      font-size: 1.25rem;
      min-width: max(var(--touch-target), 44px);
      min-height: max(var(--touch-target), 44px);
    }
    .row-actions {
      flex-direction: column;
      align-items: stretch;
    }
    .row-action {
      min-height: max(var(--touch-target), 44px);
      font-size: 0.9375rem;
      text-align: left;
      padding: 0 var(--space-4);
    }
    .row-action:not(.danger):active {
      background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
    }
    .move-target-option,
    .nest-pick,
    .mode-opt,
    .delete-radio,
    .delete-cancel,
    .delete-confirm,
    .action-cancel,
    .action-confirm {
      min-height: max(var(--touch-target), 44px);
      font-size: 0.875rem;
    }
    .delete-cancel,
    .delete-confirm,
    .action-cancel,
    .action-confirm {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 var(--space-3);
    }
    .nest-rm {
      position: relative;
    }
    .nest-rm::before {
      /* Invisible 44px hit area centered on the glyph (Chip.svelte pattern). */
      content: "";
      position: absolute;
      inset: 50% auto auto 50%;
      width: 44px;
      height: 44px;
      transform: translate(-50%, -50%);
    }
  }
  .row-error {
    padding: 0.25rem 0.875rem 0.375rem 1.75rem;
    font-size: 0.625rem;
    color: var(--warm-accent);
    opacity: 0.75;
  }
  .rename-input {
    flex: 1;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    outline: none;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    min-width: 0;
    transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .rename-input:focus {
    border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent);
  }

  /* Generic action panel (move, fold) — mirrors .delete-panel */
  .action-panel {
    padding: 0.75rem 0.875rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
  }
  .action-title {
    opacity: 0.55;
    margin-bottom: 0.625rem;
    color: var(--warm-accent);
  }
  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.625rem;
  }
  .action-cancel {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.35;
    padding: 0.25rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .action-cancel:hover { opacity: 0.75; }
  .action-confirm {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.55;
    padding: 0.25rem 0;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .action-confirm:hover:not(:disabled) { opacity: 0.92; }
  .action-confirm:disabled { opacity: 0.25; cursor: default; }
  .action-confirm.danger { color: var(--warm-accent); }

  /* Create inline */
  .create-inline {
    border-top: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    padding: 0.25rem 0;
  }
  /* Counter-pressure: trails are the exception, not the default file system. */
  .create-hint {
    margin: 0;
    padding: 0.375rem 0.875rem 0.25rem;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.6875rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.4;
  }
  .mode-explainer {
    margin: 0;
    padding: 0 0.875rem 0.375rem;
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 0.6875rem;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.4;
  }
  .create-line {
    display: block; width: 100%;
    background: none; border: none; cursor: pointer; text-align: left;
    font-family: "Lora", serif; font-size: 0.875rem;
    color: var(--warm-accent); opacity: 0.75;
    padding: 0.5rem 0.875rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .create-line:hover { opacity: 0.92; }
  .nest-under {
    display: block; width: 100%;
    background: none; border: none; cursor: pointer; text-align: left;
    font-family: "Inter", sans-serif; font-size: 0.6875rem;
    color: var(--ink); opacity: 0.35;
    padding: 0.125rem 0.875rem 0.375rem 1.5rem;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .nest-under:hover { opacity: 0.55; }
  .nest-val { color: var(--warm-accent); font-style: italic; }
  .nest-rm { font-size: 0.625rem; opacity: 0.55; margin-left: 0.25rem; }
  .nest-rm:hover { opacity: 0.92; }
  .nest-pick {
    display: block; width: 100%;
    background: none; border: none; cursor: pointer; text-align: left;
    font-family: "Lora", serif; font-size: 0.75rem;
    color: var(--ink); opacity: 0.35;
    padding: 0.3125rem 0.875rem 0.3125rem 2rem;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .nest-pick:hover { opacity: 0.55; background: color-mix(in srgb, var(--ink) 4%, transparent); }
  .nest-pick.selected { color: var(--warm-accent); opacity: 0.75; }
</style>
