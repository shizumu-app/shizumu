<script>
  // The launch could not open the writer's file (startup-gate.js says when
  // this shows). The app is running on an empty placeholder, so this screen
  // offers nothing to write into: words typed now would be lost at quit.
  // It says what happened, that the file was not touched, and where it is.

  /** @type {{ failure: { message: string, db_path: string } }} */
  let { failure } = $props();
</script>

<div class="startup-failure" role="alert">
  <div class="sf-center">
    <p class="app-name">shizumu</p>
    <p class="sf-line">your writing could not be opened.</p>
    <p class="sf-line soft">nothing was changed. the file is still here:</p>
    <p class="sf-path">{failure.db_path}</p>
    <p class="sf-line soft">copy it somewhere safe before trying anything else.</p>
    <p class="sf-detail">{failure.message}</p>
  </div>
</div>

<style>
  .startup-failure {
    width: 100%;
    align-self: stretch;
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--canvas-bg);
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
    box-sizing: border-box;
  }

  .sf-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 36rem;
    padding: 0 16px;
    text-align: center;
  }

  .app-name {
    font-family: "Lora", serif;
    font-size: 20px;
    color: var(--ink-soft);
    letter-spacing: 0.04em;
    margin: 0 0 36px;
    user-select: none;
  }

  .sf-line {
    font-family: "Lora", serif;
    font-size: 16px;
    color: var(--ink);
    margin: 0;
  }

  .sf-line.soft {
    color: var(--ink-soft);
  }

  .sf-path,
  .sf-detail {
    font-family: "DM Mono", monospace;
    font-size: 12px;
    color: var(--ink);
    margin: 0;
    word-break: break-all;
    user-select: text;
  }

  .sf-detail { margin-top: 24px;
    color: var(--ink-soft);
  }
</style>
