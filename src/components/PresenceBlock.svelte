<script>
  import { formatLocalDate } from "../lib/utils.js";

  /** @type {{ writingDates: string[], firstDate: string | null }} */
  let { writingDates = [], firstDate = null } = $props();

  let days = $derived(computeDays());

  function computeDays() {
    if (!firstDate) return [];

    const start = new Date(firstDate + "T12:00:00");
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const dateSet = new Set(writingDates);
    const result = [];

    const current = new Date(start);
    while (current <= today) {
      // Format in local time so comparison with writingDates (also local) works
      // across non-UTC timezones; toISOString() would offset by a day.
      const dateStr = formatLocalDate(current);
      result.push({
        date: dateStr,
        wrote: dateSet.has(dateStr),
      });
      current.setDate(current.getDate() + 1);
    }

    return result;
  }

  let daysWritten = $derived(days.filter(d => d.wrote).length);
  let gaps = $derived(days.length - daysWritten);
</script>

<div class="presence">
  <p class="presence-label label">presence</p>

  <div class="grid">
    {#each days as day}
      <div
        class="square"
        class:filled={day.wrote}
        title={day.date}
      ></div>
    {/each}
  </div>

  <p class="presence-stats label">
    {daysWritten} day{daysWritten !== 1 ? 's' : ''} · {gaps} gap{gaps !== 1 ? 's' : ''}
  </p>
</div>

<style>
  /* Calendar cells stay bespoke — the per-day square grid is its own
     primitive. Per the spec, intensity uses the opacity-ladder:
       empty → 0.06 (faint enough to read as "no activity")
       filled → 0.25 (one ladder rung above; calm contrast). */
  .presence {
    padding: 1.5rem 0;
  }

  .presence-label {
    opacity: 0.35;
    margin-bottom: 1rem;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1875rem;
  }

  .square {
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 0.125rem;
    background-color: color-mix(in srgb, var(--ink) 6%, transparent);
    transition: opacity var(--motion-fast);
  }

  .square.filled {
    background-color: var(--ink);
    opacity: 0.25;
  }

  .presence-stats {
    opacity: 0.35;
    margin-top: 0.75rem;
  }
</style>
