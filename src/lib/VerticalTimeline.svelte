<script lang="ts">
  import { slide } from 'svelte/transition'
  import {
    createVerticalTimelineLaneStyle,
    type VerticalTimelineBubble,
    type VerticalTimelineDayNode,
    type VerticalTimelineEventRecord,
    type VerticalTimelineLane,
    type VerticalTimelineMonthNode,
    type VerticalTimelineNodeKind,
    type VerticalTimelineYearNode,
  } from './vertical-timeline'

  export let activeEventId = ''
  export let editableEventIds: string[] = []
  export let editableNodeIds: string[] = []
  export let eventsById: Record<string, VerticalTimelineEventRecord> = {}
  export let lanes: VerticalTimelineLane[] = []
  export let manageableLaneIds: string[] = []
  export let onSelectEvent: (eventId: string, nodeId: string, laneId: string) => void = () => {}
  export let onSelectLane: (laneId: string) => void = () => {}
  export let onSelectNode: (nodeId: string, kind: VerticalTimelineNodeKind) => void = () => {}
  export let onSelectPlacement: (nodeId: string, laneId: string) => void = () => {}
  export let selectedLaneId = ''
  export let selectedNodeId = ''
  export let years: VerticalTimelineYearNode[] = []
  export let timeAxisLabel = '时间刻度'
  export let canManageLanes = false
  export let canManageStructure = false
  export let expansionResetKey = ''

  let expandedYears = new Set<string>()
  let expandedMonths = new Set<string>()
  let hasInitialisedExpansions = false
  let lastExpansionResetKey = ''

  $: editableEventIdSet = new Set(editableEventIds)
  $: editableNodeIdSet = new Set(editableNodeIds)
  $: manageableLaneIdSet = new Set(manageableLaneIds)

  $: if (expansionResetKey !== lastExpansionResetKey) {
    lastExpansionResetKey = expansionResetKey
    expandedYears = new Set()
    expandedMonths = new Set()
    hasInitialisedExpansions = false
  }

  $: if (!hasInitialisedExpansions && years.length > 0) {
    expandedYears = new Set(years.filter(yearHasVisibleEvent).map((year) => year.id))
    expandedMonths = new Set(
      years.flatMap((year) =>
        year.months
          .filter(monthHasVisibleEvent)
          .map((month) => createMonthExpansionKey(year.id, month.id)),
      ),
    )
    hasInitialisedExpansions = true
  }

  function createMonthExpansionKey(yearId: string, monthId: string): string {
    return `${yearId}::${monthId}`
  }

  function toggleYear(yearId: string): void {
    const next = new Set(expandedYears)

    if (next.has(yearId)) {
      next.delete(yearId)
    } else {
      next.add(yearId)
    }

    expandedYears = next
  }

  function toggleMonth(yearId: string, monthId: string): void {
    const key = createMonthExpansionKey(yearId, monthId)
    const next = new Set(expandedMonths)

    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }

    expandedMonths = next
  }

  function getBubble(
    bubblesByLane: Record<string, VerticalTimelineBubble | null>,
    laneId: string,
  ): VerticalTimelineBubble | null {
    return bubblesByLane[laneId] ?? null
  }

  function getEventRecord(eventId: string): VerticalTimelineEventRecord | null {
    return eventsById[eventId] ?? null
  }

  function getBubbleTitle(bubble: VerticalTimelineBubble): string {
    return getEventRecord(bubble.id)?.title ?? bubble.title
  }

  function nodeHasVisibleEvent(
    bubblesByLane: Record<string, VerticalTimelineBubble | null>,
  ): boolean {
    return lanes.some((lane) => bubblesByLane[lane.id] !== null)
  }

  function monthHasVisibleEvent(month: VerticalTimelineMonthNode): boolean {
    return (
      nodeHasVisibleEvent(month.bubblesByLane) ||
      month.days.some((day) => nodeHasVisibleEvent(day.bubblesByLane))
    )
  }

  function yearHasVisibleEvent(year: VerticalTimelineYearNode): boolean {
    return (
      nodeHasVisibleEvent(year.bubblesByLane) ||
      year.months.some((month) => monthHasVisibleEvent(month))
    )
  }

  function canEditNode(nodeId: string): boolean {
    return canManageStructure && editableNodeIdSet.has(nodeId)
  }

  function canCreateInLane(laneId: string): boolean {
    return manageableLaneIdSet.has(laneId)
  }

  function handleEventSelect(eventId: string, nodeId: string, laneId: string): void {
    activeEventId = eventId
    onSelectEvent(eventId, nodeId, laneId)
  }

  function handleEmptyPlacement(nodeId: string, laneId: string): void {
    activeEventId = ''
    onSelectPlacement(nodeId, laneId)
  }
</script>

<div class="w-full overflow-x-auto">
  <div class="min-w-[1120px]">
    <div class="sticky top-0 z-20 flex border-b border-slate-200/90 bg-white/95 backdrop-blur-sm">
      <div class="flex h-14 w-48 shrink-0 items-center border-r border-slate-300/80 pl-8">
        <span class="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
          {timeAxisLabel}
        </span>
      </div>

      <div class="flex flex-1 justify-start">
        {#each lanes as lane, index (lane.id)}
          <div
            class={`flex h-14 flex-1 basis-0 items-center border-r border-slate-200/70 px-3 min-w-0 max-w-[15vw] ${
              index === lanes.length - 1 ? 'border-r-0' : ''
            }`}
            style={createVerticalTimelineLaneStyle(lane)}
          >
            {#if canManageLanes}
              <button
                class="mx-auto flex w-full items-center justify-center rounded-2xl px-3 py-2 text-center font-bold transition-colors duration-150 hover:bg-slate-100/80"
                type="button"
                onclick={() => onSelectLane(lane.id)}
              >
                <span class="truncate" style="color: var(--lane-color)">{lane.name}</span>
              </button>
            {:else}
              <div class="mx-auto flex w-full items-center justify-center text-center font-bold">
                <span class="truncate" style="color: var(--lane-color)">{lane.name}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    <div class="flex flex-col pb-16">
      {#each years as year (year.id)}
        <div class="flex flex-col">
          <div class="flex">
            <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/40">
              {#if year.months.length > 0}
                <div class="flex h-full items-center gap-2 pl-4 pr-3">
                  <button
                    aria-expanded={expandedYears.has(year.id)}
                    class="flex h-full items-center gap-2 text-left"
                    type="button"
                    onclick={() => toggleYear(year.id)}
                  >
                    <span
                      class={`text-[10px] text-slate-400 transition-transform duration-150 ${
                        expandedYears.has(year.id) ? 'rotate-90' : ''
                      }`}
                    >
                      ▶
                    </span>
                  </button>

                  {#if canEditNode(year.id)}
                    <button
                      class="flex min-w-0 flex-1 items-center rounded-2xl px-3 py-2 text-left transition-colors duration-150 hover:bg-white/75"
                      type="button"
                      onclick={() => onSelectNode(year.id, 'year')}
                    >
                      <span class="truncate font-mono text-lg font-black text-slate-800">{year.label}</span>
                    </button>
                  {:else}
                    <div class="flex min-w-0 flex-1 items-center px-3 py-2 text-left">
                      <span class="truncate font-mono text-lg font-black text-slate-800">{year.label}</span>
                    </div>
                  {/if}
                </div>
              {:else}
                <div class="flex h-full items-center gap-2 pl-8 pr-3 text-left">
                  {#if canEditNode(year.id)}
                    <button
                      class="flex min-w-0 flex-1 items-center rounded-2xl px-3 py-2 transition-colors duration-150 hover:bg-white/75"
                      type="button"
                      onclick={() => onSelectNode(year.id, 'year')}
                    >
                      <span class="truncate font-mono text-lg font-black text-slate-800">{year.label}</span>
                    </button>
                  {:else}
                    <span class="font-mono text-lg font-black text-slate-800">{year.label}</span>
                  {/if}
                </div>
              {/if}
              <span class="absolute right-[-5px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-slate-600 ring-4 ring-white"></span>
            </div>

            <div class="flex flex-1 justify-start">
              {#each lanes as lane, index (lane.id)}
                {@const bubble = getBubble(year.bubblesByLane, lane.id)}
                <div
                  class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${
                    index === lanes.length - 1 ? 'border-r-0' : ''
                  }`}
                  style={createVerticalTimelineLaneStyle(lane)}
                >
                  <div class="flex h-full items-center px-2">
                    {#if bubble}
                      <button
                        class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                          activeEventId === bubble.id ? 'shadow-sm' : ''
                        }`}
                        style={`font-family: var(--font-display); color: var(--lane-color); background-color: var(--lane-color-soft); border-color: ${activeEventId === bubble.id ? 'var(--lane-color)' : 'var(--lane-color-strong)'};`}
                        type="button"
                        onclick={() => handleEventSelect(bubble.id, year.id, lane.id)}
                      >
                        <span class="block truncate">{getBubbleTitle(bubble)}</span>
                      </button>
                    {:else if canCreateInLane(lane.id)}
                      <button
                        class={`mx-auto h-10 w-full min-w-0 rounded-xl border border-dashed px-3 text-center text-sm font-medium transition-colors duration-150 ${
                          selectedLaneId === lane.id && selectedNodeId === year.id
                            ? ''
                            : 'border-slate-200 text-slate-300 hover:border-transparent'
                        }`}
                        style={selectedLaneId === lane.id && selectedNodeId === year.id ? 'color: var(--lane-color); background-color: var(--lane-color-soft); border-color: var(--lane-color);' : ''}
                        type="button"
                        onclick={() => handleEmptyPlacement(year.id, lane.id)}
                      >
                        ＋
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          {#if expandedYears.has(year.id)}
            <div transition:slide={{ duration: 180 }}>
              {#each year.months as month (month.id)}
                <div class="flex flex-col">
                  <div class="flex">
                    <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/20">
                      {#if month.days.length > 0}
                        <div class="flex h-full items-center gap-2 pl-10 pr-3">
                          <button
                            aria-expanded={expandedMonths.has(createMonthExpansionKey(year.id, month.id))}
                            class="flex h-full items-center gap-2 text-left"
                            type="button"
                            onclick={() => toggleMonth(year.id, month.id)}
                          >
                            <span
                              class={`text-[10px] text-slate-300 transition-transform duration-150 ${
                                expandedMonths.has(createMonthExpansionKey(year.id, month.id)) ? 'rotate-90' : ''
                              }`}
                            >
                              ▶
                            </span>
                          </button>

                          {#if canEditNode(month.id)}
                            <button
                              class="flex min-w-0 flex-1 items-center rounded-2xl px-3 py-2 text-left transition-colors duration-150 hover:bg-white/75"
                              type="button"
                              onclick={() => onSelectNode(month.id, 'month')}
                            >
                              <span class="truncate font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                            </button>
                          {:else}
                            <span class="font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                          {/if}
                        </div>
                      {:else}
                        <div class="flex h-full items-center gap-2 pl-14 pr-3 text-left">
                          {#if canEditNode(month.id)}
                            <button
                              class="flex min-w-0 flex-1 items-center rounded-2xl px-3 py-2 text-left transition-colors duration-150 hover:bg-white/75"
                              type="button"
                              onclick={() => onSelectNode(month.id, 'month')}
                            >
                              <span class="truncate font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                            </button>
                          {:else}
                            <span class="font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                          {/if}
                        </div>
                      {/if}
                      <span class="absolute right-[-4px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-slate-400 ring-4 ring-white"></span>
                    </div>

                    <div class="flex flex-1 justify-start">
                      {#each lanes as lane, index (lane.id)}
                        {@const bubble = getBubble(month.bubblesByLane, lane.id)}
                        <div
                          class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${
                            index === lanes.length - 1 ? 'border-r-0' : ''
                          }`}
                          style={createVerticalTimelineLaneStyle(lane)}
                        >
                          <div class="flex h-full items-center px-2">
                            {#if bubble}
                              <button
                                class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                                  activeEventId === bubble.id ? 'shadow-sm' : ''
                                }`}
                                style={`font-family: var(--font-display); color: var(--lane-color); background-color: var(--lane-color-soft); border-color: ${activeEventId === bubble.id ? 'var(--lane-color)' : 'var(--lane-color-strong)'};`}
                                type="button"
                                onclick={() => handleEventSelect(bubble.id, month.id, lane.id)}
                              >
                                <span class="block truncate">{getBubbleTitle(bubble)}</span>
                              </button>
                            {:else if canCreateInLane(lane.id)}
                              <button
                                class={`mx-auto h-10 w-full min-w-0 rounded-xl border border-dashed px-3 text-center text-sm font-medium transition-colors duration-150 ${
                                  selectedLaneId === lane.id && selectedNodeId === month.id
                                    ? ''
                                    : 'border-slate-200 text-slate-300 hover:border-transparent'
                                }`}
                                style={selectedLaneId === lane.id && selectedNodeId === month.id ? 'color: var(--lane-color); background-color: var(--lane-color-soft); border-color: var(--lane-color);' : ''}
                                type="button"
                                onclick={() => handleEmptyPlacement(month.id, lane.id)}
                              >
                                ＋
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>

                  {#if expandedMonths.has(createMonthExpansionKey(year.id, month.id))}
                    <div transition:slide={{ duration: 160 }}>
                      {#each month.days as day (day.id)}
                        <div class="flex">
                          <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/10">
                            <div class="flex h-full items-center gap-2 pl-20 pr-3 text-left">
                              {#if canEditNode(day.id)}
                                <button
                                  class="flex min-w-0 flex-1 items-center rounded-2xl px-3 py-2 text-left transition-colors duration-150 hover:bg-white/75"
                                  type="button"
                                  onclick={() => onSelectNode(day.id, 'day')}
                                >
                                  <span class="truncate font-mono text-sm font-medium text-gray-400">{day.label}</span>
                                </button>
                              {:else}
                                <span class="font-mono text-sm font-medium text-gray-400">{day.label}</span>
                              {/if}
                            </div>
                            <span class="absolute right-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-gray-400 ring-4 ring-white"></span>
                          </div>

                          <div class="flex flex-1 justify-start">
                            {#each lanes as lane, index (lane.id)}
                              {@const bubble = getBubble(day.bubblesByLane, lane.id)}
                              <div
                                class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${
                                  index === lanes.length - 1 ? 'border-r-0' : ''
                                }`}
                                style={createVerticalTimelineLaneStyle(lane)}
                              >
                                <div class="flex h-full items-center px-2">
                                  {#if bubble}
                                    <button
                                      class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                                        activeEventId === bubble.id ? 'shadow-sm' : ''
                                      }`}
                                      style={`font-family: var(--font-display); color: var(--lane-color); background-color: var(--lane-color-soft); border-color: ${activeEventId === bubble.id ? 'var(--lane-color)' : 'var(--lane-color-strong)'};`}
                                      type="button"
                                      onclick={() => handleEventSelect(bubble.id, day.id, lane.id)}
                                    >
                                      <span class="block truncate">{getBubbleTitle(bubble)}</span>
                                    </button>
                                  {:else if canCreateInLane(lane.id)}
                                    <button
                                      class={`mx-auto h-10 w-full min-w-0 rounded-xl border border-dashed px-3 text-center text-sm font-medium transition-colors duration-150 ${
                                        selectedLaneId === lane.id && selectedNodeId === day.id
                                          ? ''
                                          : 'border-slate-200 text-slate-300 hover:border-transparent'
                                      }`}
                                      style={selectedLaneId === lane.id && selectedNodeId === day.id ? 'color: var(--lane-color); background-color: var(--lane-color-soft); border-color: var(--lane-color);' : ''}
                                      type="button"
                                      onclick={() => handleEmptyPlacement(day.id, lane.id)}
                                    >
                                      ＋
                                    </button>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
