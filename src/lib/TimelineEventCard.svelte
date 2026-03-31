<script lang="ts">
  import { slide } from 'svelte/transition'
  import { formatTimelineRange, type PositionedTimelineEvent } from './timeline'

  export let event: PositionedTimelineEvent
  export let active = false
  export let bounceScale = 1
  export let bounceY = 0
  export let dragging = false
  export let editable = false
  export let expanded = false
  export let focused = false
  export let height = 0
  export let left = 0
  export let minimal = false
  export let muted = false
  export let resizing = false
  export let showActions = false
  export let showDetailsEntry = false
  export let showTrack = true
  export let top = 0
  export let trackColor = '#d9e0e6'
  export let trackLabel = '未分配轨道'
  export let width = 0
  export let onBlurCard: () => void = () => {}
  export let onDeleteCard: () => void = () => {}
  export let onFocusCard: () => void = () => {}
  export let onMouseEnterCard: () => void = () => {}
  export let onMouseLeaveCard: () => void = () => {}
  export let onOpenDetailsCard: () => void = () => {}
  export let onPointerCancelCard: (event: PointerEvent) => void = () => {}
  export let onPointerDownCard: (event: PointerEvent) => void = () => {}
  export let onPointerMoveCard: (event: PointerEvent) => void = () => {}
  export let onPointerUpCard: (event: PointerEvent) => void = () => {}
  export let onResizePointerDownCard: (event: PointerEvent) => void = () => {}
  export let onToggleCard: () => void = () => {}

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    onToggleCard()
  }

  function handleDeleteClick(event: MouseEvent): void {
    event.stopPropagation()
    onDeleteCard()
  }

  function handleOpenDetailsClick(event: MouseEvent): void {
    event.stopPropagation()
    onOpenDetailsCard()
  }

  function handlePointerDown(event: PointerEvent): void {
    event.stopPropagation()
    onPointerDownCard(event)
  }

  function handlePointerMove(event: PointerEvent): void {
    event.stopPropagation()
    onPointerMoveCard(event)
  }

  function handlePointerUp(event: PointerEvent): void {
    event.stopPropagation()
    onPointerUpCard(event)
  }

  function handlePointerCancel(event: PointerEvent): void {
    event.stopPropagation()
    onPointerCancelCard(event)
  }

  function handleResizePointerDown(event: PointerEvent): void {
    event.stopPropagation()
    onResizePointerDownCard(event)
  }
</script>

<div
  class:is-focused={focused}
  class:is-minimal={minimal}
  class:is-muted={muted}
  class:is-active={active}
  class:is-dragging={dragging}
  class:is-editable={editable}
  class:is-expanded={expanded}
  class:is-resizing={resizing}
  class:is-span={event.isSpan}
  class="timeline-event"
  style={`left: ${left}px; top: ${top}px; width: ${width}px; height: ${height}px; --event-bounce-y: ${bounceY}px; --event-bounce-scale: ${bounceScale}; --event-track-color: ${trackColor};`}
  tabindex="0"
  role="button"
  aria-pressed={active}
  aria-expanded={expanded}
  aria-grabbed={dragging || resizing}
  onblur={onBlurCard}
  onclick={onToggleCard}
  onfocus={onFocusCard}
  onkeydown={handleKeydown}
  onmouseenter={onMouseEnterCard}
  onmouseleave={onMouseLeaveCard}
  onpointercancel={handlePointerCancel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
>
  {#if showActions}
    <div class="event-actions" aria-label="事件操作">
      {#if showDetailsEntry}
        <button
          class="event-action"
          type="button"
          onpointerdown={(event) => event.stopPropagation()}
          onclick={handleOpenDetailsClick}
        >
          编辑详情
        </button>
      {/if}
      <button
        class="event-action is-danger"
        type="button"
        onpointerdown={(event) => event.stopPropagation()}
        onclick={handleDeleteClick}
      >
        删除
      </button>
    </div>
  {/if}

  {#if expanded}
    <span class="event-meta">
      <span class="event-range">{formatTimelineRange(event.startTime, event.endTime)}</span>
      {#if showTrack || active}
        <span class="event-track">{trackLabel}</span>
      {/if}
    </span>
  {/if}

  <strong class="event-title" title={event.title}>{event.title}</strong>

  {#if expanded}
    <span class="event-summary">{event.summary}</span>
  {/if}

  {#if expanded}
    <span class="event-details" transition:slide={{ duration: 220 }}>
      <span class="event-body">{event.body}</span>

      <span class="event-tags" aria-label="事件标签">
        {#each event.tags as tag}
          <span>{tag}</span>
        {/each}
      </span>
    </span>
  {/if}

  {#if editable}
    <button
      aria-label="拖动调整结束时间"
      class="event-resize-handle"
      type="button"
      onpointerdown={handleResizePointerDown}
    ></button>
  {/if}
</div>
