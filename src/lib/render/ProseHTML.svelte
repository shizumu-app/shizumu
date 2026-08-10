<!--
  ProseHTML — render a TipTap doc as static HTML inside a `.prose` wrapper.

  Single safety net: callers can't forget the `.prose` class (which carries
  every node-shape CSS rule in src/styles/prose.css). Pass either `doc`
  (JSON / string from the Rust side) or pre-rendered `html` (escape hatch).

  Example:
    <ProseHTML doc={summary.content_json} maxNodes={8} cacheKey={key} />
-->
<script>
  import { renderDocHTML } from "./doc-renderer.js";
  import { hydrateBlobImages } from "./blob-image-hydrate.js";

  /** @type {{
    doc?: any,
    html?: string,
    maxNodes?: number,
    cacheKey?: string,
    class?: string,
  }} */
  let { doc, html, maxNodes, cacheKey, class: extraClass = "" } = $props();

  let rendered = $derived(html ?? renderDocHTML(doc, { maxNodes, cacheKey }));

  let containerEl = $state(null);

  // Attachment images serialize to `<img data-blob-hash>` with no src —
  // the blob's path is only knowable at runtime. Fill it in whenever the
  // rendered HTML changes.
  $effect(() => {
    rendered;
    if (containerEl) hydrateBlobImages(containerEl);
  });
</script>

<div class="prose {extraClass}" bind:this={containerEl}>
  {@html rendered}
</div>
