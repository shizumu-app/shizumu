<!--
  Playground — internal-only gallery of every ui/* component in every state.
  Loaded only when ?playground=1 is present and import.meta.env.DEV is true.
  Strip from prod builds via the dev-only gate in App.svelte.

  See docs/superpowers/specs/2026-05-12-design-system-v1.md.
-->
<script>
  import Button from "../lib/ui/Button.svelte";
  import Input from "../lib/ui/Input.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Card from "../lib/ui/Card.svelte";
  import Popover from "../lib/ui/Popover.svelte";
  import Modal from "../lib/ui/Modal.svelte";
  import SectionHeader from "../lib/ui/SectionHeader.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import Divider from "../lib/ui/Divider.svelte";
  import KeyHint from "../lib/ui/KeyHint.svelte";
  import SidebarShell from "../lib/ui/SidebarShell.svelte";
  import SidebarNavRow from "../lib/ui/SidebarNavRow.svelte";
  import Row from "../lib/ui/Row.svelte";
  import Toggle from "../lib/ui/Toggle.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";

  const tones = /** @type {const} */ (["cream", "white", "dark"]);
  const scales = /** @type {const} */ ([
    { label: "small", value: 0.875 },
    { label: "medium", value: 1.0 },
    { label: "large", value: 1.125 },
  ]);

  let currentTone = $state("cream");
  let currentScale = $state(1.0);
  let searchValue = $state("");
  let textValue = $state("");
  let popoverAnchor = $state(/** @type {HTMLElement | null} */ (null));
  let popoverOpen = $state(false);
  let modalOpen = $state(false);
  let chipActive = $state(false);
  let chipsRemovable = $state(["draft", "pinned", "work"]);
  let focusedCard = $state(0);
  let toggleA = $state(false);
  let toggleB = $state(true);
  let playgroundSearch = $state("");
  let segDemo = $state("pages");

  $effect(() => {
    document.documentElement.setAttribute("data-tone", currentTone);
  });
  $effect(() => {
    document.documentElement.style.setProperty("--ui-scale", String(currentScale));
  });
</script>

<div class="playground">
  <header class="pg-head">
    <div class="pg-title">
      <span class="pg-brand">shizumu</span>
      <span class="pg-tag">design-system playground</span>
    </div>
    <div class="pg-controls">
      <div class="pg-control-group">
        <span class="pg-label">theme</span>
        {#each tones as t (t)}
          <Chip label={t} active={currentTone === t} onClick={() => (currentTone = t)} />
        {/each}
      </div>
      <div class="pg-control-group">
        <span class="pg-label">scale</span>
        {#each scales as s (s.value)}
          <Chip label={s.label} active={currentScale === s.value} onClick={() => (currentScale = s.value)} />
        {/each}
      </div>
    </div>
  </header>

  <div class="pg-grid">
    <!-- Button -->
    <section class="pg-section">
      <SectionHeader label="button" />
      <div class="pg-row">
        <Button variant="ghost">ghost</Button>
        <Button variant="subtle">subtle</Button>
        <Button variant="accent">accent</Button>
        <Button variant="ghost" disabled>disabled</Button>
        <Button variant="subtle" loading>loading</Button>
      </div>
    </section>

    <!-- Input -->
    <section class="pg-section">
      <SectionHeader label="input" />
      <div class="pg-stack">
        <Input bind:value={textValue} placeholder="write here" ariaLabel="text input" />
        <Input bind:value={searchValue} placeholder="search…" variant="search" ariaLabel="search" onClear={() => (searchValue = "")} />
        <Input value="" placeholder="disabled" disabled ariaLabel="disabled" />
      </div>
    </section>

    <!-- Chip -->
    <section class="pg-section">
      <SectionHeader label="chip" />
      <div class="pg-row">
        <Chip label="neutral" />
        <Chip label="clickable" onClick={() => (chipActive = !chipActive)} active={chipActive} />
        <Chip label="accent" variant="accent" />
        <Chip label="accent · active" variant="accent" active onClick={() => {}} />
        {#each chipsRemovable as c (c)}
          <Chip
            label={c}
            removable
            onRemove={() => (chipsRemovable = chipsRemovable.filter((x) => x !== c))}
          />
        {/each}
      </div>
    </section>

    <!-- SegmentedControl -->
    <section class="pg-section">
      <SectionHeader label="segmented control" />
      <div class="pg-stack">
        <SegmentedControl
          ariaLabel="playground demo"
          options={[
            { value: "pages", label: "pages" },
            { value: "trail map", label: "trail map" },
            { value: "pins", label: "pins" },
          ]}
          bind:value={segDemo}
        />
        <span class="pg-label">selected: {segDemo}</span>
      </div>
    </section>

    <!-- Card -->
    <section class="pg-section">
      <SectionHeader label="card" count={4} />
      <div class="pg-cards">
        {#each [0, 1, 2, 3] as i (i)}
          <Card focused={focusedCard === i} accent={i === 2} dimmed={i === 3} onClick={() => (focusedCard = i)}>
            {#snippet meta()}
              <Chip label={i === 2 ? "continuous" : "discrete"} variant={i === 2 ? "accent" : "neutral"} />
              <span class="pg-meta-date">2026-05-14</span>
            {/snippet}
            <div class="pg-card-title">card row {i + 1}</div>
            <div class="pg-card-body">
              the rest sinks into place. no tags, no folders, no prompts.
            </div>
            {#snippet footer()}
              <span class="pg-card-footer">12 words · today</span>
            {/snippet}
          </Card>
        {/each}
      </div>
    </section>

    <!-- Popover + Modal -->
    <section class="pg-section">
      <SectionHeader label="floating" />
      <div class="pg-row">
        <button
          class="pg-anchor"
          bind:this={popoverAnchor}
          onclick={() => (popoverOpen = !popoverOpen)}
          type="button"
        >
          toggle popover
        </button>
        <Button variant="subtle" onClick={() => (modalOpen = true)}>open modal</Button>
      </div>
      <Popover anchor={popoverAnchor} open={popoverOpen} onClose={() => (popoverOpen = false)}>
        <div class="pg-popover-body">
          <div class="pg-popover-row">filter by · trail</div>
          <div class="pg-popover-row">filter by · pinned</div>
          <div class="pg-popover-row">filter by · backlinks</div>
        </div>
      </Popover>
      <Modal
        open={modalOpen}
        title="delete this page?"
        onClose={() => (modalOpen = false)}
      >
        once deleted, the page and its lineage history cannot be recovered.
        {#snippet actions()}
          <Button variant="subtle" onClick={() => (modalOpen = false)}>cancel</Button>
          <Button variant="accent" onClick={() => (modalOpen = false)}>delete</Button>
        {/snippet}
      </Modal>
    </section>

    <!-- SectionHeader -->
    <section class="pg-section">
      <SectionHeader label="section header" count={12} />
      <div class="pg-stack">
        <SectionHeader label="without count" />
        <SectionHeader label="with count" count={42} />
      </div>
    </section>

    <!-- Empty -->
    <section class="pg-section">
      <SectionHeader label="empty state" />
      <Empty hasActiveFilters>
        {#snippet title()}nothing matches{/snippet}
        {#snippet body()}adjust the filters or clear them all.{/snippet}
        {#snippet actions()}
          <Chip label="trail · work" removable onRemove={() => {}} />
          <Chip label="pinned" removable onRemove={() => {}} />
          <Button variant="subtle">clear all</Button>
        {/snippet}
      </Empty>
    </section>

    <!-- Divider -->
    <section class="pg-section">
      <SectionHeader label="divider" />
      <div class="pg-stack">
        <div>above</div>
        <Divider />
        <div>below</div>
        <Divider inset={2} />
        <div>inset 2rem</div>
      </div>
    </section>

    <!-- KeyHint -->
    <section class="pg-section">
      <SectionHeader label="key hint" />
      <div class="pg-row">
        <KeyHint keys={["esc"]} label="close" />
        <KeyHint keys={["↵"]} label="open" />
        <KeyHint keys={["⌘", "k"]} label="palette" />
        <KeyHint keys={["j"]} />
      </div>
    </section>

    <!-- SidebarShell — standard density -->
    <section class="pg-section">
      <SectionHeader label="sidebar shell · standard" />
      <div class="pg-shell-frame">
        <SidebarShell density="standard" sidebarMode="permanent">
          {#snippet sidebar()}
            <SectionHeader label="trails" count={3} />
            <SidebarNavRow active onClick={() => {}}>all trails</SidebarNavRow>
            <SidebarNavRow active accent count={4} onClick={() => {}}>project alpha</SidebarNavRow>
            <SidebarNavRow count={7} onClick={() => {}}>morning notes</SidebarNavRow>
            <SidebarNavRow indent={0.75} count={2} onClick={() => {}}>research</SidebarNavRow>
          {/snippet}
          {#snippet toolbar()}
            <Input variant="search" bind:value={playgroundSearch} placeholder="search…" ariaLabel="search" />
            <Chip label="filters ▾" onClick={() => {}} />
          {/snippet}
          <p>content body here</p>
        </SidebarShell>
      </div>
    </section>

    <!-- SidebarShell — compact density -->
    <section class="pg-section">
      <SectionHeader label="sidebar shell · compact" />
      <div class="pg-shell-frame">
        <SidebarShell density="compact" sidebarMode="permanent" sidebarWidth="11rem">
          {#snippet sidebar()}
            <SidebarNavRow active count={12} onClick={() => {}}>all</SidebarNavRow>
            <SidebarNavRow count={7} onClick={() => {}}>notes</SidebarNavRow>
            <SidebarNavRow count={5} onClick={() => {}}>boards</SidebarNavRow>
          {/snippet}
          <p>content body here</p>
        </SidebarShell>
      </div>
    </section>

    <!-- Row + Toggle -->
    <section class="pg-section">
      <SectionHeader label="row · toggle" />
      <div class="pg-stack">
        <Row>
          {#snippet children()}open last page{/snippet}
          {#snippet trailing()}
            <Toggle bind:checked={toggleA} label="open last page" />
          {/snippet}
        </Row>
        <Divider />
        <Row>
          {#snippet children()}dim past pages{/snippet}
          {#snippet trailing()}
            <Toggle bind:checked={toggleB} label="dim past pages" />
          {/snippet}
        </Row>
        <Row hidden>
          {#snippet children()}this row is hidden — should not appear{/snippet}
        </Row>
      </div>
    </section>
  </div>
</div>

<style>
  .playground {
    height: 100%;
    overflow-y: auto;
    background: var(--canvas-bg);
    color: var(--ink);
    padding: 2rem 2.5rem 6rem;
  }

  .pg-head {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-bottom: 1.5rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .pg-title {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .pg-brand {
    font-family: "Lora", serif;
    font-size: 1.5rem;
    color: var(--ink);
    opacity: 0.92;
  }

  .pg-tag {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
    opacity: 0.35;
  }

  .pg-controls {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .pg-control-group {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .pg-label {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: var(--ink);
    opacity: 0.35;
    margin-right: 0.25rem;
  }

  .pg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 2rem;
    max-width: 80rem;
  }

  .pg-section {
    min-width: 0;
  }

  .pg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .pg-stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .pg-cards {
    display: flex;
    flex-direction: column;
  }

  .pg-meta-date {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    color: var(--ink);
    opacity: 0.35;
  }

  .pg-card-title {
    font-family: "Lora", serif;
    font-size: 1rem;
    color: var(--ink);
    opacity: 0.92;
    margin-bottom: 0.125rem;
  }

  .pg-card-body {
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    opacity: 0.55;
  }

  .pg-card-footer {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.35;
  }

  .pg-anchor {
    appearance: none;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 0.375rem;
    padding: 0.25rem 0.5rem;
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.75;
    cursor: pointer;
  }

  .pg-popover-body {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .pg-popover-row {
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.75;
    padding: 0.375rem 0.5rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  .pg-popover-row:hover {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    opacity: 0.92;
  }

  .pg-shell-frame {
    height: 20rem;
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: 0.5rem;
    overflow: hidden;
  }
</style>
