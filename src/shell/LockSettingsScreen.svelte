<!--
  The phone's lock settings, pushed from settings' `lock` row.

  The lock is the account's (src-tauri/src/account_lock.rs): what is set,
  changed or turned off here, every paired device follows. What the screen
  offers in each state is lock-settings-model.js's answer; this file draws
  it. The rows are the laptop's choices; a form opens in place of them for
  the one that needs passphrases typed, and its submit is an action row,
  inert until the model says the form is ready.

  The fields are the shell's own `Field` in its secure state, the one the
  lock gate uses, so the 16px floor that keeps the phone from zooming
  applies here too.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import Field from "./ui/Field.svelte";
  import { CHOSEN } from "./settings-model.js";
  import { lockScreen } from "./lock-settings-model.js";

  /** @type {{
    on?: boolean,
    timeout?: number,
    busy?: boolean,
    error?: string | null,
    onBack?: (() => void) | null,
    onSubmit?: ((form: string, values: object) => void) | null,
    onTimeout?: ((minutes: number) => void) | null,
    onFormChange?: (() => void) | null,
  }} */
  let { on = false, timeout = 0, busy = false, error = null, onBack = null, onSubmit = null, onTimeout = null, onFormChange = null } = $props();

  let form = $state(/** @type {null|"setup"|"change"|"off"} */ (null));
  let current = $state("");
  let next = $state("");
  let confirm = $state("");
  const values = $derived({ current, next, confirm });
  const model = $derived(lockScreen({ on, timeout, form, values, busy, error }));

  // A form whose state went away (the lock changed on another device while
  // it was open) closes, and what was typed goes with it.
  $effect(() => {
    if (form && !model.form) close();
  });

  function open(id) {
    form = id;
    current = next = confirm = "";
    onFormChange?.();
  }
  function close() {
    form = null;
    current = next = confirm = "";
    onFormChange?.();
  }
  function bind(id) {
    return id === "current" ? current : id === "next" ? next : confirm;
  }
  function set(id, v) {
    if (id === "current") current = v;
    else if (id === "next") next = v;
    else confirm = v;
  }
</script>

<Screen>
  {#snippet nav()}
    <NavBar title={model.form ? model.form.title : "lock"} {onBack} />
  {/snippet}

  {#if model.form}
    {#each model.form.fields as f (f.id)}
      <Field label={f.label} placeholder={f.label} secure value={bind(f.id)} onInput={(v) => set(f.id, v)} />
    {/each}
    <RowGroup>
      <Row
        label={model.form.submit}
        kind="action"
        onSelect={model.form.ready && onSubmit ? () => onSubmit(model.form.id, { ...values }) : null}
      />
      <Row label="cancel" kind="action" onSelect={close} />
    </RowGroup>
    {#if model.form.hint}
      <Note tone="warm">{model.form.hint}</Note>
    {/if}
  {:else}
    <RowGroup>
      {#each model.rows as row (row.id)}
        {#if row.kind === "choice"}
          <Row
            label={row.label}
            value={row.chosen ? CHOSEN : ""}
            kind="choice"
            onSelect={onTimeout ? () => onTimeout(row.minutes) : null}
          />
        {:else}
          <Row label={row.label} kind="action" onSelect={() => open(row.id)} />
        {/if}
      {/each}
    </RowGroup>
    <Note>{model.note}</Note>
  {/if}
</Screen>
