<!--
  ChartFormTimeline — title + drag-reorderable event rows. Each event
  has a date, a label, a milestone toggle, and a remove button. Drag
  the handle on the left to reorder events; native HTML5 drag-and-drop.
-->
<script>
  import Button from "../../lib/ui/Button.svelte";

  /** @type {{
    source: { title: string, events: any[] },
    onChange: (next: any) => void,
  }} */
  let { source, onChange } = $props();

  let dragIndex = $state(-1);
  let dragOverIndex = $state(-1);

  function setTitle(title) {
    onChange({ ...source, title });
  }
  function addEvent() {
    onChange({
      ...source,
      events: [...(source.events || []), { date: "", label: "", kind: "event" }],
    });
  }
  function updateEvent(i, patch) {
    const events = [...source.events];
    events[i] = { ...events[i], ...patch };
    onChange({ ...source, events });
  }
  function removeEvent(i) {
    onChange({ ...source, events: source.events.filter((_, idx) => idx !== i) });
  }
  function toggleMilestone(i) {
    const e = source.events[i];
    updateEvent(i, { kind: e.kind === "milestone" ? "event" : "milestone" });
  }

  function onDragStart(i, e) {
    dragIndex = i;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(i));
  }
  function onDragOver(i, e) {
    e.preventDefault();
    dragOverIndex = i;
  }
  function onDrop(i, e) {
    e.preventDefault();
    if (dragIndex < 0 || dragIndex === i) {
      dragIndex = -1;
      dragOverIndex = -1;
      return;
    }
    const events = [...source.events];
    const [moved] = events.splice(dragIndex, 1);
    events.splice(i, 0, moved);
    dragIndex = -1;
    dragOverIndex = -1;
    onChange({ ...source, events });
  }
  function onDragEnd() {
    dragIndex = -1;
    dragOverIndex = -1;
  }
</script>

<div class="form">
  <div class="form-section">
    <div class="form-label">title</div>
    <input
      class="title-input selectable"
      type="text"
      placeholder="optional"
      value={source.title || ""}
      oninput={(e) => setTitle(e.target.value)}
      spellcheck="false"
    />
  </div>

  <div class="form-section">
    <div class="form-label">events</div>
    <ul class="event-list">
      {#each source.events || [] as ev, i (i)}
        <li
          class="event-row"
          class:drag-over={dragOverIndex === i && dragIndex !== i}
          ondragover={(e) => onDragOver(i, e)}
          ondrop={(e) => onDrop(i, e)}
          ondragend={onDragEnd}
        >
          <span
            class="drag-handle"
            draggable="true"
            ondragstart={(e) => onDragStart(i, e)}
            aria-label="drag to reorder"
            title="drag to reorder"
          >⋮⋮</span>
          <input
            class="event-input event-date selectable"
            class:missing={!(ev.date || "").trim()}
            type="text"
            placeholder="date"
            value={ev.date}
            oninput={(e) => updateEvent(i, { date: e.target.value })}
            spellcheck="false"
          />
          <input
            class="event-input event-label selectable"
            type="text"
            placeholder="event"
            value={ev.label}
            oninput={(e) => updateEvent(i, { label: e.target.value })}
            spellcheck="false"
          />
          <button
            type="button"
            class="milestone-btn"
            class:active={ev.kind === "milestone"}
            title={ev.kind === "milestone" ? "milestone (click to demote)" : "regular (click to make milestone)"}
            onclick={() => toggleMilestone(i)}
          >{ev.kind === "milestone" ? "★" : "◇"}</button>
          <button class="event-remove" onclick={() => removeEvent(i)} aria-label="remove event" title="remove">×</button>
        </li>
      {/each}
    </ul>
    <Button variant="subtle" onClick={addEvent}>+ add event</Button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 1rem; }
  .form-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .form-label {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    opacity: 0.55;
  }
  .title-input {
    appearance: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    padding: 0.4375rem 0.5rem;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    outline: none;
  }
  .event-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .event-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem;
    border-radius: 0.375rem;
    transition: background 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .event-row.drag-over {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }
  .drag-handle {
    cursor: grab;
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    opacity: 0.45;
    padding: 0 0.25rem;
    user-select: none;
    color: var(--ink);
  }
  .drag-handle:active { cursor: grabbing; }
  .event-input {
    appearance: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.25rem;
    padding: 0.25rem 0.375rem;
    font-family: "Lora", serif;
    font-size: 0.8125rem;
    color: var(--ink);
    outline: none;
  }
  .event-date { width: 6rem; flex-shrink: 0; }
  .event-date.missing {
    border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent);
    background: color-mix(in srgb, var(--warm-accent) 5%, transparent);
  }
  .event-label { flex: 1; min-width: 0; }
  .milestone-btn {
    appearance: none;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: 0.25rem;
    padding: 0.125rem 0.4375rem;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.55;
    cursor: pointer;
  }
  .milestone-btn:hover { opacity: 0.92; }
  .milestone-btn.active {
    color: var(--warm-accent);
    opacity: 0.92;
    border-color: color-mix(in srgb, var(--warm-accent) 25%, transparent);
    background: color-mix(in srgb, var(--warm-accent) 8%, transparent);
  }
  .event-remove {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--ink);
    opacity: 0.35;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
  }
  .event-remove:hover { opacity: 0.85; }
</style>
