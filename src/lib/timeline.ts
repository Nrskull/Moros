export interface TimelineEvent {
  detailImage?: string
  detailHtml?: string
  id: string
  startTime: number
  endTime: number
  title: string
  summary: string
  body: string
  tags: string[]
  worldview: string
}

export interface TimelineLayoutOptions {
  zoomFactor?: number
  trackHeight?: number
  eventHeight?: number
  minCardWidth?: number
  trackGap?: number
}

export interface PositionedTimelineEvent extends TimelineEvent {
  duration: number
  height: number
  isSpan: boolean
  trackIndex: number
  top: number
  width: number
  x: number
}

export interface TimelineLayout {
  end: number
  events: PositionedTimelineEvent[]
  origin: number
  totalHeight: number
  totalWidth: number
  trackCount: number
  zoomFactor: number
}

export interface TimelineTick {
  label: string
  value: number
  x: number
}

const DEFAULT_ZOOM_FACTOR = 26
const DEFAULT_TRACK_HEIGHT = 116
const DEFAULT_EVENT_HEIGHT = 84
const DEFAULT_MIN_CARD_WIDTH = 34
const DEFAULT_TRACK_GAP = 14
const SURFACE_PADDING = 64

function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((left, right) => {
    if (left.startTime !== right.startTime) return left.startTime - right.startTime
    if (left.endTime !== right.endTime) return left.endTime - right.endTime
    return left.id.localeCompare(right.id)
  })
}

export function formatTimelineUnit(value: number): string {
  return `第 ${value} 天`
}

export function formatTimelineRange(startTime: number, endTime: number): string {
  if (startTime === endTime) {
    return formatTimelineUnit(startTime)
  }

  return `${formatTimelineUnit(startTime)} 至 ${formatTimelineUnit(endTime)}`
}

export function createTimelineTicks(
  origin: number,
  end: number,
  zoomFactor: number,
  step = 4,
): TimelineTick[] {
  const ticks: TimelineTick[] = []

  for (let value = origin; value <= end; value += step) {
    ticks.push({
      value,
      label: formatTimelineUnit(value),
      x: (value - origin) * zoomFactor,
    })
  }

  if (ticks[ticks.length - 1]?.value !== end) {
    ticks.push({
      value: end,
      label: formatTimelineUnit(end),
      x: (end - origin) * zoomFactor,
    })
  }

  return ticks
}

export function createAdaptiveTimelineTicks(
  origin: number,
  end: number,
  zoomFactor: number,
  baseStep = 4,
  minLabelSpacingPx = 96,
): TimelineTick[] {
  let step = Math.max(1, baseStep)

  while (zoomFactor * step < minLabelSpacingPx) {
    step *= 2
  }

  const ticks = createTimelineTicks(origin, end, zoomFactor, step)
  const filteredTicks: TimelineTick[] = []

  for (const tick of ticks) {
    const previousTick = filteredTicks[filteredTicks.length - 1]

    if (!previousTick || tick.x - previousTick.x >= minLabelSpacingPx) {
      filteredTicks.push(tick)
      continue
    }

    if (tick.value === end) {
      filteredTicks[filteredTicks.length - 1] = tick
    }
  }

  return filteredTicks
}

export function createTimelineLayout(
  events: TimelineEvent[],
  options: TimelineLayoutOptions = {},
): TimelineLayout {
  const zoomFactor = options.zoomFactor ?? DEFAULT_ZOOM_FACTOR
  const trackHeight = options.trackHeight ?? DEFAULT_TRACK_HEIGHT
  const eventHeight = options.eventHeight ?? DEFAULT_EVENT_HEIGHT
  const minCardWidth = options.minCardWidth ?? DEFAULT_MIN_CARD_WIDTH
  const trackGap = options.trackGap ?? DEFAULT_TRACK_GAP

  if (events.length === 0) {
    return {
      origin: 0,
      end: 0,
      events: [],
      totalHeight: eventHeight,
      totalWidth: SURFACE_PADDING * 2,
      trackCount: 0,
      zoomFactor,
    }
  }

  const sortedEvents = sortTimelineEvents(events)
  const origin = Math.min(...sortedEvents.map((event) => event.startTime))
  const minVisualDuration = minCardWidth / zoomFactor
  const gapDuration = trackGap / zoomFactor
  const trackEndTimes: number[] = []

  const positionedEvents = sortedEvents.map<PositionedTimelineEvent>((event) => {
    const duration = Math.max(0, event.endTime - event.startTime)
    const visualDuration = Math.max(duration, minVisualDuration)
    const effectiveEnd = event.startTime + visualDuration + gapDuration

    let trackIndex = trackEndTimes.findIndex((trackEndTime) => event.startTime >= trackEndTime)

    if (trackIndex === -1) {
      trackIndex = trackEndTimes.length
      trackEndTimes.push(effectiveEnd)
    } else {
      trackEndTimes[trackIndex] = effectiveEnd
    }

    return {
      ...event,
      duration,
      height: eventHeight,
      isSpan: event.endTime > event.startTime,
      trackIndex,
      top: trackIndex * trackHeight,
      width: Math.max(duration * zoomFactor, minCardWidth),
      x: (event.startTime - origin) * zoomFactor,
    }
  })

  const end = Math.max(...positionedEvents.map((event) => Math.max(event.startTime, event.endTime)))
  const visualEnd = Math.max(
    ...positionedEvents.map((event) => event.startTime + Math.max(event.duration, minVisualDuration)),
  )

  return {
    origin,
    end,
    events: positionedEvents,
    totalHeight: trackEndTimes.length * trackHeight,
    totalWidth: Math.max((visualEnd - origin) * zoomFactor + SURFACE_PADDING, 720),
    trackCount: trackEndTimes.length,
    zoomFactor,
  }
}
