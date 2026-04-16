<script lang="ts">
  import EventDetailPage from './EventDetailPage.svelte'
  import VerticalTimeline from './VerticalTimeline.svelte'
  import {
    verticalTimelineSampleEvents,
    verticalTimelineSampleLanes,
    verticalTimelineSampleYears,
    type VerticalTimelineEventRecord,
    type VerticalTimelineYearNode,
  } from './vertical-timeline-sample'

  let activeEventId = ''
  let detailEventId = ''
  let events: VerticalTimelineEventRecord[] = verticalTimelineSampleEvents.map((event) => ({
    ...event,
    tags: [...event.tags],
  }))
  let years: VerticalTimelineYearNode[] = verticalTimelineSampleYears.map(cloneYearNode)

  function cloneYearNode(year: VerticalTimelineYearNode): VerticalTimelineYearNode {
    return {
      ...year,
      bubblesByLane: { ...year.bubblesByLane },
      months: year.months.map((month) => ({
        ...month,
        bubblesByLane: { ...month.bubblesByLane },
        days: month.days.map((day) => ({
          ...day,
          bubblesByLane: { ...day.bubblesByLane },
        })),
      })),
    }
  }

  function clearBubbleRecord<T extends { bubblesByLane: Record<string, { id: string; title: string } | null> }>(
    row: T,
    eventId: string,
  ): T {
    const bubblesByLane = Object.fromEntries(
      Object.entries(row.bubblesByLane).map(([laneId, bubble]) => [
        laneId,
        bubble?.id === eventId ? null : bubble,
      ]),
    )

    return {
      ...row,
      bubblesByLane,
    }
  }

  $: eventsById = Object.fromEntries(events.map((event) => [event.id, event]))
  $: detailEvent = detailEventId === '' ? null : (eventsById[detailEventId] ?? null)

  $: if (activeEventId !== '' && !eventsById[activeEventId]) {
    activeEventId = ''
  }

  $: if (detailEventId !== '' && !eventsById[detailEventId]) {
    detailEventId = ''
  }

  function deriveSummary(bodyText: string, title: string): string {
    const trimmed = bodyText.trim().replace(/\s+/g, ' ')

    if (trimmed === '') {
      return `${title} 的预览内容暂未填写。`
    }

    return trimmed.slice(0, 72)
  }

  function openEventDetail(eventId: string): void {
    if (!eventsById[eventId]) {
      return
    }

    activeEventId = eventId
    detailEventId = eventId
  }

  function closeEventDetail(): void {
    detailEventId = ''
  }

  function saveDetailDraft(draft: {
    bodyHtml: string
    bodyText: string
    detailImage?: string
    summary: string
    tags: string[]
    title: string
  }): void {
    if (detailEventId === '') {
      return
    }

    events = events.map((event) =>
      event.id === detailEventId
        ? {
            ...event,
            body: draft.bodyText,
            detailHtml: draft.bodyHtml,
            detailImage: draft.detailImage,
            summary: draft.summary.trim() || deriveSummary(draft.bodyText, draft.title),
            tags: draft.tags,
            title: draft.title.trim() || event.title,
          }
        : event,
    )
  }

  function deleteDetailEvent(): void {
    if (detailEventId === '') {
      return
    }

    const targetId = detailEventId
    events = events.filter((event) => event.id !== targetId)
    years = years.map((year) => ({
      ...clearBubbleRecord(year, targetId),
      months: year.months.map((month) => ({
        ...clearBubbleRecord(month, targetId),
        days: month.days.map((day) => clearBubbleRecord(day, targetId)),
      })),
    }))
    detailEventId = ''

    if (activeEventId === targetId) {
      activeEventId = ''
    }
  }
</script>

{#if detailEvent}
  <EventDetailPage
    event={detailEvent}
    onBack={closeEventDetail}
    onDelete={deleteDetailEvent}
    onSave={saveDetailDraft}
    worldviewName="垂直时间轴演示"
  />
{:else}
  <section class="flex w-full flex-col gap-6">
    <section class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/80 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div class="flex flex-col gap-3 border-b border-slate-200/80 px-8 py-7">
        <span class="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-400">
          Vertical Timeline Demo
        </span>
        <div class="flex flex-col gap-2">
          <h2 class="m-0 font-[var(--font-display)] text-[clamp(1.8rem,3vw,2.5rem)] leading-[1.05] text-slate-900">
            垂直泳道时间轴
          </h2>
          <p class="m-0 max-w-3xl text-sm leading-6 text-slate-500">
            点击任意事件标签会展开内容预览；展开态可继续进入详情编辑页，沿用现有事件详情编辑能力。
          </p>
        </div>
      </div>

      <div class="px-5 py-5 sm:px-6">
        <VerticalTimeline
          bind:activeEventId
          eventsById={eventsById}
          lanes={verticalTimelineSampleLanes}
          onOpenDetail={openEventDetail}
          timeAxisLabel="时间刻度"
          years={years}
        />
      </div>
    </section>
  </section>
{/if}
