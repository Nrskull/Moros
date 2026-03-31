<script lang="ts">
  import type { TimelineTick } from './timeline'

  export let ticks: TimelineTick[] = []
  export let densityMode: 'overview' | 'compact' | 'detail' = 'compact'
</script>

{#each ticks as tick}
  <div
    class:density-overview={densityMode === 'overview'}
    class="timeline-tick"
    style={`left: ${tick.x}px;`}
  >
    <span>{tick.label}</span>
  </div>
{/each}
