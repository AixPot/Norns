<script lang="ts">
 import source from './assets/norns-wordmark.svg?raw';
 let {height=24}: {height?:number} = $props();
 // Keep the approved source intact; the wrapper owns the single accessible name.
 const decorative = source.replace('role="img" aria-label="Norns"', 'aria-hidden="true" focusable="false"');
</script>
<span class="norns-wordmark" role="img" aria-label="Norns" style:--wordmark-height={`${height}px`} style:width={`${height * 3.42}px`}>{@html decorative}</span>
<style>
 .norns-wordmark{display:inline-flex;align-items:center;flex-shrink:0;vertical-align:middle;height:1.55em;font-size:inherit;margin:0;color:inherit}
 .norns-wordmark :global(svg){display:block;width:100%;height:var(--wordmark-height)}
</style>
