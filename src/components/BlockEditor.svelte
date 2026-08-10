<script>
  import { addBlockItem, updateBlockItemState, updateBlockItemText } from "../lib/api.js";

  /** @type {{ block: any, items: Array<any>, readonly: boolean }} */
  let { block, items = [], readonly = false } = $props();

  let localItems = $state([]);
  let newItemText = $state("");
  let isEditingName = $state(false);
  let editName = $state("");

  // Editing state
  let editingItemId = $state(null);
  let editingItemText = $state("");
  let editingCellId = $state(null);
  let editingCellCol = $state(null);
  let editingCellText = $state("");
  let cellInputEl = $state(null);
  let itemInputEl = $state(null);

  // Table-specific state
  let columns = $state([]);
  let newColumnName = $state("");

  $effect(() => {
    localItems = [...items];
    // Parse table columns from block name (stored as JSON array)
    if (block.block_type === "table" && block.name) {
      try {
        const parsed = JSON.parse(block.name);
        if (Array.isArray(parsed)) columns = parsed;
      } catch {
        columns = block.name ? [block.name] : ["column 1"];
      }
    }
  });

  function isTable() {
    return block.block_type === "table";
  }

  function blockLabel() {
    if (isTable()) return "table";
    if (block.name && !isTable()) return block.name;
    return block.block_type;
  }

  // Name editing
  function startEditName() {
    if (readonly) return;
    isEditingName = true;
    editName = isTable() ? "" : (block.name || block.block_type);
  }

  function finishEditName() {
    isEditingName = false;
    if (editName.trim().length > 0 && !isTable()) {
      block.name = editName.trim();
      // TODO: persist name change to backend
    }
  }

  // List items (commitments, schema)
  async function handleAddItem() {
    const text = newItemText.trim();
    if (text.length === 0) return;
    try {
      const item = await addBlockItem(block.id, text);
      if (item) localItems = [...localItems, item];
      newItemText = "";
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  }

  function handleNewItemKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddItem();
    }
  }

  async function toggleItem(item) {
    if (readonly) return;
    const newState = item.state === "open" ? getClosedState() : "open";
    try {
      await updateBlockItemState(item.id, newState);
      localItems = localItems.map(i =>
        i.id === item.id ? { ...i, state: newState } : i
      );
    } catch (err) {
      console.error("Failed to toggle item:", err);
    }
  }

  function getClosedState() {
    if (block.block_type === "schema") return "resolved";
    return "closed";
  }

  function isItemDone(item) {
    return item.state !== "open";
  }

  // Item text editing (commitments/schema)
  function startEditItem(item) {
    if (readonly) return;
    editingItemId = item.id;
    editingItemText = item.text;
    requestAnimationFrame(() => {
      if (itemInputEl) itemInputEl.focus();
    });
  }

  async function finishEditItem(item) {
    editingItemId = null;
    const trimmed = editingItemText.trim();
    if (trimmed.length === 0 || trimmed === item.text) return;
    try {
      await updateBlockItemText(item.id, trimmed);
      localItems = localItems.map(i => i.id === item.id ? { ...i, text: trimmed } : i);
    } catch (err) {
      console.error("Failed to update item text:", err);
    }
  }

  // Table cell editing
  function startEditCell(item, col) {
    if (readonly) return;
    editingCellId = item.id;
    editingCellCol = col;
    const cells = getRowCells(item);
    editingCellText = cells[col] || "";
    requestAnimationFrame(() => {
      if (cellInputEl) cellInputEl.focus();
    });
  }

  async function finishEditCell(item) {
    const cellId = editingCellId;
    const col = editingCellCol;
    editingCellId = null;
    editingCellCol = null;
    const cells = getRowCells(item);
    cells[col] = editingCellText;
    const newText = JSON.stringify(cells);
    try {
      await updateBlockItemText(item.id, newText);
      localItems = localItems.map(i => i.id === item.id ? { ...i, text: newText } : i);
    } catch (err) {
      console.error("Failed to update cell:", err);
    }
  }

  function handleCellKeydown(e, item, colIndex) {
    if (e.key === "Enter") {
      e.preventDefault();
      finishEditCell(item);
    }
    if (e.key === "Tab") {
      e.preventDefault();
      finishEditCell(item);
      // Move to next cell
      if (colIndex < columns.length - 1) {
        requestAnimationFrame(() => startEditCell(item, columns[colIndex + 1]));
      }
    }
    if (e.key === "Escape") {
      editingCellId = null;
      editingCellCol = null;
    }
  }

  // Table: parse row data from item.text as JSON
  function getRowCells(item) {
    try {
      const parsed = JSON.parse(item.text);
      if (typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
    // Fallback: first column gets the text
    if (columns.length > 0) {
      const obj = {};
      obj[columns[0]] = item.text;
      return obj;
    }
    return {};
  }

  async function addTableRow() {
    const rowData = {};
    columns.forEach(c => { rowData[c] = ""; });
    try {
      const item = await addBlockItem(block.id, JSON.stringify(rowData));
      if (item) localItems = [...localItems, item];
    } catch (err) {
      console.error("Failed to add table row:", err);
    }
  }

  function addColumn() {
    const name = newColumnName.trim() || `column ${columns.length + 1}`;
    columns = [...columns, name];
    newColumnName = "";
    // Update block name with new columns
    block.name = JSON.stringify(columns);
    // TODO: persist to backend
  }
</script>

<div class="block-editor" class:shared={block.is_shared}>
  <!-- Block header -->
  <div class="block-header">
    {#if isEditingName && !isTable()}
      <input
        class="name-edit label"
        type="text"
        bind:value={editName}
        onblur={finishEditName}
        onkeydown={(e) => { if (e.key === "Enter") finishEditName(); if (e.key === "Escape") { isEditingName = false; } }}
        spellcheck="false"
      />
    {:else}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="block-type label"
        class:editable-name={!readonly && !isTable()}
        onclick={!readonly && !isTable() ? startEditName : undefined}
      >
        {blockLabel()}
      </span>
    {/if}
    {#if block.is_shared}
      <span class="block-shared label">shared</span>
    {/if}
  </div>

  {#if isTable()}
    <!-- TABLE RENDERING -->
    <div class="table-container">
      {#if columns.length > 0}
        <div class="table-grid" style="grid-template-columns: repeat({columns.length}, 1fr);">
          <!-- Column headers -->
          {#each columns as col}
            <div class="table-header label">{col}</div>
          {/each}

          <!-- Rows -->
          {#each localItems as item (item.id)}
            {@const cells = getRowCells(item)}
            {#each columns as col, ci}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="table-cell" onclick={(e) => { e.stopPropagation(); startEditCell(item, col); }}>
                {#if editingCellId === item.id && editingCellCol === col}
                  <input
                    bind:this={cellInputEl}
                    type="text"
                    class="cell-input selectable"
                    bind:value={editingCellText}
                    onblur={() => finishEditCell(item)}
                    onkeydown={(e) => handleCellKeydown(e, item, ci)}
                  />
                {:else}
                  <span class="cell-text">{cells[col] || "\u00a0"}</span>
                {/if}
              </div>
            {/each}
          {/each}
        </div>
      {:else}
        <p class="table-empty label">add columns to start</p>
      {/if}

      {#if !readonly}
        <div class="table-actions">
          <button class="table-action-btn label" onclick={(e) => { e.stopPropagation(); addTableRow(); }}>+ row</button>
          <div class="add-column">
            <input
              type="text"
              class="column-input label selectable"
              placeholder="+ column name"
              bind:value={newColumnName}
              onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); addColumn(); } }}
              spellcheck="false"
            />
          </div>
        </div>
      {/if}
    </div>

  {:else}
    <!-- LIST RENDERING (commitments, schema) -->
    <div class="block-items">
      {#each localItems as item (item.id)}
        <div class="block-item" class:done={isItemDone(item)}>
          <button
            class="item-toggle"
            onclick={() => toggleItem(item)}
            disabled={readonly}
            aria-label={isItemDone(item) ? "reopen" : "complete"}
          >
            {#if isItemDone(item)}●{:else}○{/if}
          </button>
          {#if editingItemId === item.id}
          <input
            bind:this={itemInputEl}
            type="text"
            class="item-edit-input selectable"
            bind:value={editingItemText}
            onblur={() => finishEditItem(item)}
            onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); finishEditItem(item); } if (e.key === "Escape") editingItemId = null; }}
          />
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span class="item-text" class:struck={isItemDone(item)} onclick={(e) => { e.stopPropagation(); startEditItem(item); }}>{item.text}</span>
        {/if}
        </div>
      {/each}
    </div>

    {#if !readonly}
      <div class="block-add">
        <input
          type="text"
          class="add-input selectable"
          placeholder="+ add item"
          bind:value={newItemText}
          onkeydown={handleNewItemKeydown}
          spellcheck="false"
        />
      </div>
    {/if}
  {/if}
</div>

<style>
  .block-editor {
    padding: 8px 0;
    margin: 4px 0;
  }

  .block-editor.shared {
    border-left: 2px solid color-mix(in srgb, var(--warm-accent) 30%, transparent);
    padding-left: 12px;
  }

  .block-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .block-type {
    opacity: 0.45;
    text-transform: lowercase;
  }

  .editable-name {
    cursor: pointer;
    transition: opacity 150ms ease;
  }

  .editable-name:hover {
    opacity: 0.7;
  }

  .name-edit {
    background: transparent;
    border: none;
    outline: none;
    font-family: "Inter", sans-serif;
    font-weight: 400;
    font-size: 12px;
    color: var(--ink);
    opacity: 0.6;
    padding: 0;
  }

  .block-shared {
    opacity: 0.3;
    font-size: 10px;
    color: var(--warm-accent);
  }

  /* List items */
  .block-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .block-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .item-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 10px;
    color: var(--ink);
    opacity: 0.4;
    padding: 0;
    width: 14px;
    text-align: center;
    transition: opacity 150ms ease;
  }

  .item-toggle:hover:not(:disabled) {
    opacity: 0.8;
  }

  .item-toggle:disabled {
    cursor: default;
  }

  .item-text {
    font-family: "Lora", serif;
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink);
    opacity: 0.8;
    cursor: text;
  }

  .item-edit-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Lora", serif;
    font-size: 15px;
    line-height: 1.6;
    color: var(--ink);
    padding: 0;
    caret-color: var(--warm-accent);
  }

  .item-text.struck {
    text-decoration: line-through;
    opacity: 0.4;
  }

  .block-add {
    margin-top: 4px;
  }

  .add-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Lora", serif;
    font-size: 14px;
    color: var(--ink);
    opacity: 0.5;
    padding: 4px 0 4px 22px;
  }

  .add-input::placeholder {
    color: var(--ink);
    opacity: 0.3;
  }

  /* Table */
  .table-container {
    overflow-x: auto;
  }

  .table-grid {
    display: grid;
    gap: 1px;
    background: color-mix(in srgb, var(--horizon) 30%, transparent);
    border-radius: 4px;
    overflow: hidden;
  }

  .table-header {
    background: color-mix(in srgb, var(--ink) 4%, var(--canvas-bg));
    padding: 4px 8px;
    opacity: 0.5;
    font-weight: 400;
    font-size: 11px;
  }

  .table-cell {
    background: var(--canvas-bg);
    padding: 3px 8px;
  }

  .table-cell {
    cursor: text;
  }

  .cell-text {
    font-family: "Lora", serif;
    font-size: 14px;
    line-height: 1.4;
    color: var(--ink);
    opacity: 0.8;
  }

  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-family: "Lora", serif;
    font-size: 14px;
    line-height: 1.4;
    color: var(--ink);
    padding: 0;
    caret-color: var(--warm-accent);
  }

  .table-empty {
    opacity: 0.3;
    padding: 8px 0;
  }

  .table-actions {
    display: flex;
    gap: 16px;
    align-items: center;
    margin-top: 8px;
  }

  .table-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.35;
    padding: 4px 0;
    transition: opacity 150ms ease;
  }

  .table-action-btn:hover {
    opacity: 0.6;
  }

  .column-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--ink);
    opacity: 0.4;
    padding: 4px 0;
    width: 120px;
  }

  .column-input::placeholder {
    color: var(--ink);
    opacity: 0.3;
  }
</style>
