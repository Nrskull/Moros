<script lang="ts">
  import { slide } from 'svelte/transition'
  import type {
    VerticalTimelineBubble,
    VerticalTimelineEventRecord,
    VerticalTimelineLane,
    VerticalTimelineYearNode,
  } from './vertical-timeline-sample'

  export let activeEventId = ''
  export let eventsById: Record<string, VerticalTimelineEventRecord> = {}
  export let lanes: VerticalTimelineLane[] = []
  export let onOpenDetail: (eventId: string) => void = () => {}
  export let years: VerticalTimelineYearNode[] = []
  export let timeAxisLabel = '时间刻度'

  let expandedYears = new Set<string>()
  let expandedMonths = new Set<string>()
  let hasInitialisedExpansions = false

  $: if (!hasInitialisedExpansions && years.length > 0) {
    expandedYears = new Set(years.map((year) => year.id))
    expandedMonths = new Set()
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

  function getPreviewText(event: VerticalTimelineEventRecord): string {
    const summary = event.summary.trim()

    if (summary !== '') {
      return summary
    }

    const body = event.body.trim()
    return body === '' ? '当前还没有可预览的正文内容。' : body
  }

  function getRowPreview(
    bubblesByLane: Record<string, VerticalTimelineBubble | null>,
    currentActiveId: string,
  ): { bubble: VerticalTimelineBubble; event: VerticalTimelineEventRecord; laneId: string } | null {
    for (const lane of lanes) {
      const bubble = getBubble(bubblesByLane, lane.id)

      if (!bubble || bubble.id !== currentActiveId) {
        continue
      }

      const event = getEventRecord(bubble.id)

      if (!event) {
        return null
      }

      return {
        bubble,
        event,
        laneId: lane.id,
      }
    }

    return null
  }

  function toggleEventPreview(eventId: string): void {
    activeEventId = activeEventId === eventId ? '' : eventId
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
            class={`flex h-14 flex-1 basis-0 items-center border-r border-slate-200/70 px-3 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
          >
            <div class="mx-auto flex w-full items-center justify-center text-center font-bold">
              <span class={`truncate ${lane.textClass}`}>{lane.name}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <div class="flex flex-col pb-16">
      {#each years as year (year.id)}
        {@const yearPreview = getRowPreview(year.bubblesByLane, activeEventId)}
        <div class="flex flex-col">
          <div class="flex">
            <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/40">
              {#if year.months.length > 0}
                <button
                  aria-expanded={expandedYears.has(year.id)}
                  class="flex h-full w-full items-center gap-2 pl-8 text-left"
                  type="button"
                  onclick={() => toggleYear(year.id)}
                >
                  <span
                    class={`text-[10px] text-slate-400 transition-transform duration-150 ${expandedYears.has(year.id) ? 'rotate-90' : ''}`}
                  >
                    ▶
                  </span>
                  <span class="font-mono text-lg font-black text-slate-800">{year.label}</span>
                </button>
              {:else}
                <div class="flex h-full items-center gap-2 pl-8 text-left">
                  <span class="w-[10px] shrink-0"></span>
                  <span class="font-mono text-lg font-black text-slate-800">{year.label}</span>
                </div>
              {/if}
              <span class="absolute right-[-5px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-slate-600 ring-4 ring-white"></span>
            </div>

            <div class="flex flex-1 justify-start">
              {#each lanes as lane, index (lane.id)}
                {@const bubble = getBubble(year.bubblesByLane, lane.id)}
                <div
                  class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                >
                  <div class="flex h-full items-center px-2">
                    {#if bubble}
                      <button
                        class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${lane.bubbleClass || 'bg-slate-100 text-slate-800'} ${lane.bubbleBorderClass || 'border-slate-300'}`}
                        type="button"
                        onclick={() => toggleEventPreview(bubble.id)}
                      >
                        <span class="block truncate">{getBubbleTitle(bubble)}</span>
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          {#if yearPreview}
            <div class="flex">
              <div class="w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/5"></div>
              <div class="flex flex-1 justify-start">
                {#each lanes as lane, index (lane.id)}
                  <div
                    class={`min-h-[6.5rem] flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                  >
                    <div class="flex h-full items-start px-2 py-2">
                      {#if yearPreview.laneId === lane.id}
                        <div class="mx-auto flex w-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
                          <div class="flex items-start justify-between gap-3">
                            <strong class={`text-sm leading-5 ${lane.textClass}`}>{yearPreview.event.title}</strong>
                            <button
                              class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100"
                              type="button"
                              onclick={() => onOpenDetail(yearPreview.event.id)}
                            >
                              编辑详情
                            </button>
                          </div>
                          <p class="max-h-16 overflow-hidden text-xs leading-5 text-slate-500">
                            {getPreviewText(yearPreview.event)}
                          </p>
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if expandedYears.has(year.id)}
            <div transition:slide={{ duration: 180 }}>
              {#each year.months as month (month.id)}
                {@const monthPreview = getRowPreview(month.bubblesByLane, activeEventId)}
                <div class="flex flex-col">
                  <div class="flex">
                    <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/20">
                      {#if month.days.length > 0}
                        <button
                          aria-expanded={expandedMonths.has(createMonthExpansionKey(year.id, month.id))}
                          class="flex h-full w-full items-center gap-2 pl-14 text-left"
                          type="button"
                          onclick={() => toggleMonth(year.id, month.id)}
                        >
                          <span
                            class={`text-[10px] text-slate-300 transition-transform duration-150 ${expandedMonths.has(createMonthExpansionKey(year.id, month.id)) ? 'rotate-90' : ''}`}
                          >
                            ▶
                          </span>
                          <span class="font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                        </button>
                      {:else}
                        <div class="flex h-full items-center gap-2 pl-14 text-left">
                          <span class="w-[10px] shrink-0"></span>
                          <span class="font-mono text-sm font-semibold text-slate-500">{month.label}</span>
                        </div>
                      {/if}
                      <span class="absolute right-[-4px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-slate-400 ring-4 ring-white"></span>
                    </div>

                    <div class="flex flex-1 justify-start">
                      {#each lanes as lane, index (lane.id)}
                        {@const bubble = getBubble(month.bubblesByLane, lane.id)}
                        <div
                          class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                        >
                          <div class="flex h-full items-center px-2">
                            {#if bubble}
                              <button
                                class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${lane.bubbleClass || 'bg-slate-100 text-slate-800'} ${lane.bubbleBorderClass || 'border-slate-300'}`}
                                type="button"
                                onclick={() => toggleEventPreview(bubble.id)}
                              >
                                <span class="block truncate">{getBubbleTitle(bubble)}</span>
                              </button>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                  </div>

                  {#if monthPreview}
                    <div class="flex">
                      <div class="w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/5"></div>
                      <div class="flex flex-1 justify-start">
                        {#each lanes as lane, index (lane.id)}
                          <div
                            class={`min-h-[6.5rem] flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                          >
                            <div class="flex h-full items-start px-2 py-2">
                              {#if monthPreview.laneId === lane.id}
                                <div class="mx-auto flex w-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
                                  <div class="flex items-start justify-between gap-3">
                                    <strong class={`text-sm leading-5 ${lane.textClass}`}>{monthPreview.event.title}</strong>
                                    <button
                                      class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100"
                                      type="button"
                                      onclick={() => onOpenDetail(monthPreview.event.id)}
                                    >
                                      编辑详情
                                    </button>
                                  </div>
                                  <p class="max-h-16 overflow-hidden text-xs leading-5 text-slate-500">
                                    {getPreviewText(monthPreview.event)}
                                  </p>
                                </div>
                              {/if}
                            </div>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if expandedMonths.has(createMonthExpansionKey(year.id, month.id))}
                    <div transition:slide={{ duration: 160 }}>
                      {#each month.days as day (day.id)}
                        {@const dayPreview = getRowPreview(day.bubblesByLane, activeEventId)}
                        <div class="flex">
                          <div class="relative h-14 w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/10">
                            <div class="flex h-full items-center gap-2 pl-20 text-left">
                              <span class="w-1.5 shrink-0"></span>
                              <span class="font-mono text-sm font-medium text-gray-400">{day.label}</span>
                            </div>
                            <span class="absolute right-[-4px] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-gray-400 ring-4 ring-white"></span>
                          </div>

                          <div class="flex flex-1 justify-start">
                            {#each lanes as lane, index (lane.id)}
                              {@const bubble = getBubble(day.bubblesByLane, lane.id)}
                              <div
                                class={`h-14 flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                              >
                                <div class="flex h-full items-center px-2">
                                  {#if bubble}
                                    <button
                                      class={`mx-auto h-10 w-full min-w-0 rounded-xl border px-3 text-center text-sm font-medium transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${lane.bubbleClass || 'bg-slate-100 text-slate-800'} ${lane.bubbleBorderClass || 'border-slate-300'}`}
                                      type="button"
                                      onclick={() => toggleEventPreview(bubble.id)}
                                    >
                                      <span class="block truncate">{getBubbleTitle(bubble)}</span>
                                    </button>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>

                        {#if dayPreview}
                          <div class="flex">
                            <div class="w-48 shrink-0 border-r border-slate-300/80 bg-slate-50/5"></div>
                            <div class="flex flex-1 justify-start">
                              {#each lanes as lane, index (lane.id)}
                                <div
                                  class={`min-h-[6.5rem] flex-1 basis-0 border-r border-slate-200/70 min-w-0 max-w-[15vw] ${index === lanes.length - 1 ? 'border-r-0' : ''}`}
                                >
                                  <div class="flex h-full items-start px-2 py-2">
                                    {#if dayPreview.laneId === lane.id}
                                      <div class="mx-auto flex w-full flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm">
                                        <div class="flex items-start justify-between gap-3">
                                          <strong class={`text-sm leading-5 ${lane.textClass}`}>{dayPreview.event.title}</strong>
                                          <button
                                            class="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100"
                                            type="button"
                                            onclick={() => onOpenDetail(dayPreview.event.id)}
                                          >
                                            编辑详情
                                          </button>
                                        </div>
                                        <p class="max-h-16 overflow-hidden text-xs leading-5 text-slate-500">
                                          {getPreviewText(dayPreview.event)}
                                        </p>
                                      </div>
                                    {/if}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
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
