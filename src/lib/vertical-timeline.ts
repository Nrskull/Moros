import type { TimelineEvent } from './timeline'

export type VerticalTimelineNodeKind = 'year' | 'month' | 'day'

export interface VerticalTimelineLane {
  color: string
  id: string
  name: string
}

export interface VerticalTimelineBubble {
  id: string
  title: string
}

export interface VerticalTimelineEventRecord extends TimelineEvent {
  laneId: string
  nodeId: string
}

export interface VerticalTimelineDayNode {
  bubblesByLane: Record<string, VerticalTimelineBubble | null>
  id: string
  label: string
}

export interface VerticalTimelineMonthNode {
  bubblesByLane: Record<string, VerticalTimelineBubble | null>
  days: VerticalTimelineDayNode[]
  id: string
  label: string
}

export interface VerticalTimelineYearNode {
  bubblesByLane: Record<string, VerticalTimelineBubble | null>
  id: string
  label: string
  months: VerticalTimelineMonthNode[]
}

export interface VerticalTimelineState {
  events: VerticalTimelineEventRecord[]
  lanes: VerticalTimelineLane[]
  years: VerticalTimelineYearNode[]
}

export interface VerticalTimelineNodeRef {
  id: string
  kind: VerticalTimelineNodeKind
  label: string
  parentMonthId: string | null
  parentYearId: string | null
}

export interface VerticalTimelineResolvedNode {
  day: VerticalTimelineDayNode | null
  kind: VerticalTimelineNodeKind
  month: VerticalTimelineMonthNode | null
  year: VerticalTimelineYearNode
}

export function cloneVerticalTimelineBubble(
  bubble: VerticalTimelineBubble | null,
): VerticalTimelineBubble | null {
  return bubble ? { ...bubble } : null
}

export function cloneVerticalTimelineBubbles(
  bubblesByLane: Record<string, VerticalTimelineBubble | null>,
): Record<string, VerticalTimelineBubble | null> {
  return Object.fromEntries(
    Object.entries(bubblesByLane).map(([laneId, bubble]) => [laneId, cloneVerticalTimelineBubble(bubble)]),
  )
}

export function cloneVerticalTimelineDay(day: VerticalTimelineDayNode): VerticalTimelineDayNode {
  return {
    ...day,
    bubblesByLane: cloneVerticalTimelineBubbles(day.bubblesByLane),
  }
}

export function cloneVerticalTimelineMonth(
  month: VerticalTimelineMonthNode,
): VerticalTimelineMonthNode {
  return {
    ...month,
    bubblesByLane: cloneVerticalTimelineBubbles(month.bubblesByLane),
    days: month.days.map(cloneVerticalTimelineDay),
  }
}

export function cloneVerticalTimelineYear(year: VerticalTimelineYearNode): VerticalTimelineYearNode {
  return {
    ...year,
    bubblesByLane: cloneVerticalTimelineBubbles(year.bubblesByLane),
    months: year.months.map(cloneVerticalTimelineMonth),
  }
}

export function cloneVerticalTimelineState(
  state: VerticalTimelineState,
): VerticalTimelineState {
  return {
    events: state.events.map((event) => ({
      ...event,
      tags: [...event.tags],
    })),
    lanes: state.lanes.map((lane) => ({ ...lane })),
    years: state.years.map(cloneVerticalTimelineYear),
  }
}

export function createEmptyBubblesByLane(
  lanes: Array<Pick<VerticalTimelineLane, 'id'>>,
): Record<string, VerticalTimelineBubble | null> {
  return Object.fromEntries(lanes.map((lane) => [lane.id, null]))
}

function syncBubbleKeys(
  bubblesByLane: Record<string, VerticalTimelineBubble | null>,
  laneIds: string[],
): Record<string, VerticalTimelineBubble | null> {
  return Object.fromEntries(
    laneIds.map((laneId) => [
      laneId,
      cloneVerticalTimelineBubble(bubblesByLane[laneId] ?? null),
    ]),
  )
}

export function syncVerticalTimelineYearsWithLanes(
  years: VerticalTimelineYearNode[],
  lanes: Array<Pick<VerticalTimelineLane, 'id'>>,
): VerticalTimelineYearNode[] {
  const laneIds = lanes.map((lane) => lane.id)

  return years.map((year) => ({
    ...year,
    bubblesByLane: syncBubbleKeys(year.bubblesByLane, laneIds),
    months: year.months.map((month) => ({
      ...month,
      bubblesByLane: syncBubbleKeys(month.bubblesByLane, laneIds),
      days: month.days.map((day) => ({
        ...day,
        bubblesByLane: syncBubbleKeys(day.bubblesByLane, laneIds),
      })),
    })),
  }))
}

export function findVerticalTimelineNode(
  years: VerticalTimelineYearNode[],
  nodeId: string,
): VerticalTimelineResolvedNode | null {
  for (const year of years) {
    if (year.id === nodeId) {
      return {
        day: null,
        kind: 'year',
        month: null,
        year,
      }
    }

    for (const month of year.months) {
      if (month.id === nodeId) {
        return {
          day: null,
          kind: 'month',
          month,
          year,
        }
      }

      for (const day of month.days) {
        if (day.id === nodeId) {
          return {
            day,
            kind: 'day',
            month,
            year,
          }
        }
      }
    }
  }

  return null
}

export function flattenVerticalTimelineNodes(
  years: VerticalTimelineYearNode[],
): VerticalTimelineNodeRef[] {
  return years.flatMap<VerticalTimelineNodeRef>((year) => [
    {
      id: year.id,
      kind: 'year',
      label: year.label,
      parentMonthId: null,
      parentYearId: null,
    },
    ...year.months.flatMap<VerticalTimelineNodeRef>((month) => [
      {
        id: month.id,
        kind: 'month',
        label: month.label,
        parentMonthId: null,
        parentYearId: year.id,
      },
      ...month.days.map((day): VerticalTimelineNodeRef => ({
        id: day.id,
        kind: 'day',
        label: day.label,
        parentMonthId: month.id,
        parentYearId: year.id,
      })),
    ]),
  ])
}

export function createVerticalTimelineNodeOptionLabel(
  node: VerticalTimelineNodeRef,
): string {
  if (node.kind === 'year') {
    return `年 · ${node.label}`
  }

  if (node.kind === 'month') {
    return `月 · ${node.label}`
  }

  return `日 · ${node.label}`
}

export function getVerticalTimelineBubble(
  node: Pick<VerticalTimelineYearNode | VerticalTimelineMonthNode | VerticalTimelineDayNode, 'bubblesByLane'>,
  laneId: string,
): VerticalTimelineBubble | null {
  return node.bubblesByLane[laneId] ?? null
}

export function getVerticalTimelineBubbleAtNode(
  years: VerticalTimelineYearNode[],
  nodeId: string,
  laneId: string,
): VerticalTimelineBubble | null {
  const node = findVerticalTimelineNode(years, nodeId)

  if (!node) {
    return null
  }

  if (node.kind === 'year') {
    return getVerticalTimelineBubble(node.year, laneId)
  }

  if (node.kind === 'month' && node.month) {
    return getVerticalTimelineBubble(node.month, laneId)
  }

  if (node.kind === 'day' && node.day) {
    return getVerticalTimelineBubble(node.day, laneId)
  }

  return null
}

export function setVerticalTimelineBubbleAtNode(
  years: VerticalTimelineYearNode[],
  nodeId: string,
  laneId: string,
  bubble: VerticalTimelineBubble | null,
): VerticalTimelineYearNode[] {
  return years.map((year) => {
    if (year.id === nodeId) {
      return {
        ...year,
        bubblesByLane: {
          ...year.bubblesByLane,
          [laneId]: cloneVerticalTimelineBubble(bubble),
        },
      }
    }

    return {
      ...year,
      months: year.months.map((month) => {
        if (month.id === nodeId) {
          return {
            ...month,
            bubblesByLane: {
              ...month.bubblesByLane,
              [laneId]: cloneVerticalTimelineBubble(bubble),
            },
          }
        }

        return {
          ...month,
          days: month.days.map((day) =>
            day.id === nodeId
              ? {
                  ...day,
                  bubblesByLane: {
                    ...day.bubblesByLane,
                    [laneId]: cloneVerticalTimelineBubble(bubble),
                  },
                }
              : day,
          ),
        }
      }),
    }
  })
}

export function clearVerticalTimelineEventFromYears(
  years: VerticalTimelineYearNode[],
  eventId: string,
): VerticalTimelineYearNode[] {
  const clearBubbleMap = (
    bubblesByLane: Record<string, VerticalTimelineBubble | null>,
  ): Record<string, VerticalTimelineBubble | null> =>
    Object.fromEntries(
      Object.entries(bubblesByLane).map(([laneId, bubble]) => [
        laneId,
        bubble?.id === eventId ? null : cloneVerticalTimelineBubble(bubble),
      ]),
    )

  return years.map((year) => ({
    ...year,
    bubblesByLane: clearBubbleMap(year.bubblesByLane),
    months: year.months.map((month) => ({
      ...month,
      bubblesByLane: clearBubbleMap(month.bubblesByLane),
      days: month.days.map((day) => ({
        ...day,
        bubblesByLane: clearBubbleMap(day.bubblesByLane),
      })),
    })),
  }))
}

export function deriveVerticalTimelineSummary(bodyText: string, title: string): string {
  const trimmed = bodyText.trim().replace(/\s+/g, ' ')

  if (trimmed === '') {
    return `${title} 的预览内容暂未填写。`
  }

  return trimmed.slice(0, 72)
}

export function parseVerticalTimelinePointValue(label: string): number {
  const digits = label.replace(/[^\d]+/g, '')
  const parsed = Number(digits)

  return Number.isFinite(parsed) ? parsed : 0
}

export function createVerticalTimelineId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalised = hex.trim().replace('#', '')
  const fullHex =
    normalised.length === 3
      ? normalised
          .split('')
          .map((segment) => `${segment}${segment}`)
          .join('')
      : normalised

  if (!/^[\da-f]{6}$/iu.test(fullHex)) {
    return `rgba(148, 163, 184, ${alpha})`
  }

  const red = Number.parseInt(fullHex.slice(0, 2), 16)
  const green = Number.parseInt(fullHex.slice(2, 4), 16)
  const blue = Number.parseInt(fullHex.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function createVerticalTimelineLaneStyle(lane: VerticalTimelineLane): string {
  return [
    `--lane-color:${lane.color}`,
    `--lane-color-soft:${hexToRgba(lane.color, 0.12)}`,
    `--lane-color-strong:${hexToRgba(lane.color, 0.2)}`,
  ].join('; ')
}
