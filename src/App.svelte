<script lang="ts">
  import { onMount } from 'svelte'
  import { spring } from 'svelte/motion'
  import { fade } from 'svelte/transition'
  import {
    worldviewContents,
    getWorldviewContent,
    type WorldviewContent,
  } from './content/worldviews'
  import AgeChroniclePage from './lib/AgeChroniclePage.svelte'
  import AdminCharacterPage from './lib/AdminCharacterPage.svelte'
  import ChatRoomPage from './lib/ChatRoomPage.svelte'
  import EventDetailPage from './lib/EventDetailPage.svelte'
  import HomePage from './lib/HomePage.svelte'
  import LogWorkbenchPage from './lib/LogWorkbenchPage.svelte'
  import TimelineAxis from './lib/TimelineAxis.svelte'
  import TimelineEventCard from './lib/TimelineEventCard.svelte'
  import VerticalTimelinePage from './lib/VerticalTimelinePage.svelte'
  import WorldviewHero from './lib/WorldviewHero.svelte'
  import { mockEvents } from './lib/mock-events'
  import { seaFogIn, seaFogOut } from './lib/transitions'
  import { confirmDialog, alertDialog } from './lib/dialog'
  import {
    buildAppRouteHref,
    parseAppRoute,
    type AppPage,
  } from './lib/app-router'
  import {
    createAdaptiveTimelineTicks,
    createTimelineLayout,
    type PositionedTimelineEvent,
    type TimelineEvent,
    type TimelineLayout,
  } from './lib/timeline'
  import {
    createWorldviewThemeStyle,
    getWorldviewTheme,
    type WorldviewTheme,
  } from './lib/worldview-themes'

  type ZoomDensityMode = 'overview' | 'compact' | 'detail'
  type DrawerMode = 'none' | 'event' | 'worldview'
  type EventEditorMode = 'create' | 'edit'
  type EventDragMode = 'move' | 'resize-end'
  type TimelineMode = 'view' | 'edit'
  type TagFilterMode = 'highlight' | 'hide'

  interface ZoomDensity {
    collapsedEventHeight: number
    collapsedTrackHeight: number
    expandedCardWidth: number
    expandedEventHeight: number
    minCardWidth: number
    minTickLabelSpacingPx: number
    mode: ZoomDensityMode
    showTrack: boolean
    tickBaseStep: number
  }

  interface TimelineTrack {
    color: string
    id: string
    label: string
  }

  interface EditableTimelineEvent extends TimelineEvent {
    trackId: string
  }

  interface RenderedTimelineEvent extends PositionedTimelineEvent {
    active: boolean
    bounceScale: number
    bounceY: number
    dragging: boolean
    editable: boolean
    expanded: boolean
    focused: boolean
    minimal: boolean
    muted: boolean
    renderedHeight: number
    renderedTop: number
    renderedWidth: number
    resizing: boolean
    trackColor: string
    trackId: string
    trackLabel: string
  }

  const axisHeight = 52
  const axisContentGap = 12
  const baseZoomFactor = 13
  const MINIMAL_CARD_WIDTH_THRESHOLD = 80
  const MINIMAL_ZOOM_THRESHOLD = 12
  const SNAP_DELAY = 120
  const EVENT_DRAG_THRESHOLD = 10
  const DEFAULT_WORLDVIEW_NAME = '未分类世界观'
  const FIXED_LAYOUT_SURFACE_PADDING = 64
  const TRACK_LEADING_GUTTER = 132
  const defaultTrackPalette = ['#d9e0e6', '#c8dce6', '#d5cae6', '#d1e3d3', '#e1d8e6', '#dde3e8']
  const defaultTrackLabels = ['公共线1', '公共线2', '其它线1', 'ho404线']
  const activeCardBounce = spring(0, { stiffness: 0.22, damping: 0.58 })
  const surfaceNudge = spring(0, { stiffness: 0.16, damping: 0.72 })

  function createTrackId(index: number): string {
    return `track_${index + 1}`
  }

  function getNextTrackLabel(existingTracks: TimelineTrack[]): string {
    const existingLabels = new Set(existingTracks.map((track) => track.label))
    const nextDefaultLabel = defaultTrackLabels.find((label) => !existingLabels.has(label))

    if (nextDefaultLabel) {
      return nextDefaultLabel
    }

    let extraIndex = 1
    while (existingLabels.has(`扩展线${extraIndex}`)) {
      extraIndex += 1
    }

    return `扩展线${extraIndex}`
  }

  function createDefaultTrack(index: number, existingTracks: TimelineTrack[] = []): TimelineTrack {
    return {
      id: createTrackId(index),
      label: getNextTrackLabel(existingTracks),
      color: defaultTrackPalette[index % defaultTrackPalette.length],
    }
  }

  function relabelTracks(tracks: TimelineTrack[]): TimelineTrack[] {
    return tracks
  }

  function sortEditableEvents(events: EditableTimelineEvent[]): EditableTimelineEvent[] {
    return [...events].sort((left, right) => {
      if (left.startTime !== right.startTime) return left.startTime - right.startTime
      if (left.endTime !== right.endTime) return left.endTime - right.endTime
      return left.id.localeCompare(right.id)
    })
  }

  function createInitialTimelineState(events: TimelineEvent[]): {
    events: EditableTimelineEvent[]
    tracks: TimelineTrack[]
  } {
    const worldviewList = [...new Set(events.map((event) => event.worldview))]
    const trackAssignments = new Map<string, number>()
    let maxTrackCount = 1

    worldviewList.forEach((worldview) => {
      const worldviewEvents = events.filter((event) => event.worldview === worldview)
      const worldviewLayout = createTimelineLayout(worldviewEvents, {
        minCardWidth: 98,
        trackHeight: 62,
        eventHeight: 40,
      })

      maxTrackCount = Math.max(maxTrackCount, worldviewLayout.trackCount)
      worldviewLayout.events.forEach((event) => {
        trackAssignments.set(event.id, event.trackIndex)
      })
    })

    const trackCount = Math.max(4, maxTrackCount)
    const tracks = Array.from({ length: trackCount }).reduce<TimelineTrack[]>((list, _, index) => {
      list.push(createDefaultTrack(index, list))
      return list
    }, [])

    return {
      tracks,
      events: events.map((event) => ({
        ...event,
        tags: [...event.tags],
        trackId: tracks[Math.min(trackAssignments.get(event.id) ?? 0, tracks.length - 1)].id,
      })),
    }
  }

  function createFixedTrackTimelineLayout(
    events: EditableTimelineEvent[],
    tracks: TimelineTrack[],
    options: {
      eventHeight: number
      minCardWidth: number
      trackHeight: number
      zoomFactor: number
    },
  ): TimelineLayout {
    const zoomFactor = options.zoomFactor
    const trackHeight = options.trackHeight
    const eventHeight = options.eventHeight
    const minCardWidth = options.minCardWidth
    const orderedEvents = sortEditableEvents(events)
    const trackCount = Math.max(1, tracks.length)

    if (orderedEvents.length === 0) {
      return {
        origin: 0,
        end: 0,
        events: [],
        totalHeight: trackCount * trackHeight,
        totalWidth: TRACK_LEADING_GUTTER + FIXED_LAYOUT_SURFACE_PADDING * 2,
        trackCount,
        zoomFactor,
      }
    }

    const origin = Math.min(...orderedEvents.map((event) => event.startTime))
    const trackIndexMap = new Map(tracks.map((track, index) => [track.id, index]))

    const positionedEvents = orderedEvents.map<PositionedTimelineEvent>((event) => {
      const duration = Math.max(0, event.endTime - event.startTime)
      const trackIndex = Math.min(trackIndexMap.get(event.trackId) ?? 0, trackCount - 1)
      const width = duration > 0 ? duration * zoomFactor : minCardWidth

      return {
        ...event,
        duration,
        height: eventHeight,
        isSpan: event.endTime > event.startTime,
        trackIndex,
        top: trackIndex * trackHeight,
        width,
        x: TRACK_LEADING_GUTTER + (event.startTime - origin) * zoomFactor,
      }
    })

    const end = Math.max(...positionedEvents.map((event) => Math.max(event.startTime, event.endTime)))
    const maxRight = Math.max(...positionedEvents.map((event) => event.x + event.width))

    return {
      origin,
      end,
      events: positionedEvents,
      totalHeight: trackCount * trackHeight,
      totalWidth: Math.max(maxRight + FIXED_LAYOUT_SURFACE_PADDING, TRACK_LEADING_GUTTER + 720),
      trackCount,
      zoomFactor,
    }
  }

  const initialTimelineState = createInitialTimelineState(mockEvents)

  let timelineScrollElement: HTMLDivElement | null = null
  let timelineSurfaceElement: HTMLDivElement | null = null
  let worldviewMenuElement: HTMLDivElement | null = null
  let tagFilterContainerElement: HTMLDivElement | null = null

  let timelineTracks: TimelineTrack[] = initialTimelineState.tracks
  let timelineEvents: EditableTimelineEvent[] = initialTimelineState.events
  let customWorldviews: WorldviewContent[] = []
  let selectedWorldview = timelineEvents[0]?.worldview ?? ''
  let isWorldviewMenuOpen = false
  let isTagFilterOpen = false
  let zoomLevel = 1
  let activePage: AppPage = 'home'
  let detailEventId = ''
  let routeWorldviewName: string | null = selectedWorldview || null
  let hasMountedRouter = false
  let timelineMode: TimelineMode = 'view'
  let tagFilterMode: TagFilterMode = 'highlight'
  let selectedTagFilters: string[] = []
  let activeEventId = ''
  let hoveredEventId = ''
  let isDragging = false
  let dragStartX = 0
  let dragStartScrollLeft = 0
  let dragDistance = 0
  let suppressClick = false
  let snapTimer: ReturnType<typeof setTimeout> | null = null

  let drawerMode: DrawerMode = 'none'
  let eventEditorMode: EventEditorMode = 'create'
  let editingEventId = ''

  let projectTitle = 'Morosonder'
  let boardHeading = '时间轴'
  let boardNote = '支持世界观切换、语义缩放、拖拽漫游、卡片拖拽改期，以及抽屉式事件编辑。'

  let draftWorldview = ''
  let draftTitle = ''
  let draftStartTime = 0
  let draftEndTime = 0
  let draftTrackId = timelineTracks[0]?.id ?? ''
  let draftDetailImage = ''
  let draftSummary = ''
  let draftBody = ''
  let draftTagsText = ''
  let draftWorldviewName = ''
  let draftWorldviewDescription = ''
  let draftWorldviewTagsText = ''
  let draftWorldviewCoverImage = ''

  let eventDragId = ''
  let eventDragMode: EventDragMode = 'move'
  let eventDragPointerId: number | null = null
  let eventDragStartX = 0
  let eventDragStartY = 0
  let eventDragOriginStartTime = 0
  let eventDragOriginEndTime = 0
  let eventDragOriginTrackId = ''
  let eventDragLastShift = 0
  let eventDragLastTrackId = ''
  let eventDragTarget: HTMLDivElement | null = null
  let isEventDragging = false

  function getZoomDensity(zoom: number): ZoomDensity {
    if (zoom <= 0.9) {
      return {
        mode: 'overview',
        collapsedTrackHeight: 42,
        collapsedEventHeight: 36,
        expandedEventHeight: 162,
        minCardWidth: 72,
        expandedCardWidth: 248,
        minTickLabelSpacingPx: 132,
        showTrack: false,
        tickBaseStep: 8,
      }
    }

    if (zoom >= 1.4) {
      return {
        mode: 'detail',
        collapsedTrackHeight: 56,
        collapsedEventHeight: 46,
        expandedEventHeight: 196,
        minCardWidth: 126,
        expandedCardWidth: 328,
        minTickLabelSpacingPx: 72,
        showTrack: true,
        tickBaseStep: 2,
      }
    }

    return {
      mode: 'compact',
      collapsedTrackHeight: 48,
      collapsedEventHeight: 40,
      expandedEventHeight: 180,
      minCardWidth: 98,
      expandedCardWidth: 280,
      minTickLabelSpacingPx: 96,
      showTrack: true,
      tickBaseStep: 4,
    }
  }

  function createEventId(): string {
    return `evt_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  }

  function normaliseTime(value: number | string, fallback: number): number {
    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      return fallback
    }

    return Math.max(0, Math.round(parsed))
  }

  function serialiseTags(text: string): string[] {
    return text
      .split(/[\n,，]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
  }

  function formatTags(tags: string[]): string {
    return tags.join('，')
  }

  function deriveSummary(summary: string, body: string, title: string): string {
    const trimmedSummary = summary.trim()
    if (trimmedSummary !== '') {
      return trimmedSummary
    }

    const source = body.trim() || `${title} 的内容仍待补充。`
    return source.length > 68 ? `${source.slice(0, 68)}…` : source
  }

  function matchesSelectedTags(event: { tags: string[] }): boolean {
    if (selectedTagFilters.length === 0) {
      return true
    }

    return selectedTagFilters.some((tag) => event.tags.includes(tag))
  }

  function toggleTagFilter(tag: string): void {
    selectedTagFilters = selectedTagFilters.includes(tag)
      ? selectedTagFilters.filter((item) => item !== tag)
      : [...selectedTagFilters, tag]
  }

  function clearTagFilters(): void {
    selectedTagFilters = []
  }

  function toggleWorldviewMenu(): void {
    isWorldviewMenuOpen = !isWorldviewMenuOpen
  }

  function toggleTagFilterPanel(): void {
    isTagFilterOpen = !isTagFilterOpen
  }

  function addTrack(): void {
    timelineTracks = relabelTracks([
      ...timelineTracks,
      createDefaultTrack(timelineTracks.length, timelineTracks),
    ])
  }

  function updateTrackColor(trackId: string, color: string): void {
    timelineTracks = timelineTracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            color,
          }
        : track,
    )
  }

  function getTrackTailEnd(
    worldview: string,
    trackId: string,
    excludedEventIds = new Set<string>(),
  ): number {
    return timelineEvents.reduce((max, event) => {
      if (
        event.worldview !== worldview ||
        event.trackId !== trackId ||
        excludedEventIds.has(event.id)
      ) {
        return max
      }

      return Math.max(max, event.endTime)
    }, 0)
  }

  async function removeTrack(trackId: string): Promise<void> {
    const trackIndex = timelineTracks.findIndex((track) => track.id === trackId)

    if (timelineMode !== 'edit' || trackIndex <= 0 || timelineTracks.length <= 1) {
      return
    }

    const removedTrack = timelineTracks[trackIndex]
    const previousTrack = timelineTracks[trackIndex - 1]
    const movedEvents = sortEditableEvents(timelineEvents.filter((event) => event.trackId === trackId))
    const allowDelete =
      typeof window === 'undefined' ||
      (await confirmDialog(
        `确认删除“${removedTrack.label}”吗？该轨道上的事件会被移动到“${previousTrack.label}”的末尾。`,
      ))

    if (!allowDelete) {
      return
    }

    const movedEventIds = new Set(movedEvents.map((event) => event.id))
    const worldviewTailMap = new Map<string, number>()
    const reassignedEvents = new Map<string, EditableTimelineEvent>()

    for (const movedEvent of movedEvents) {
      const currentTail =
        worldviewTailMap.get(movedEvent.worldview) ??
        getTrackTailEnd(movedEvent.worldview, previousTrack.id, movedEventIds)
      const duration = Math.max(0, movedEvent.endTime - movedEvent.startTime)
      const nextStartTime = currentTail
      const nextEndTime = nextStartTime + duration

      worldviewTailMap.set(movedEvent.worldview, nextEndTime)
      reassignedEvents.set(movedEvent.id, {
        ...movedEvent,
        trackId: previousTrack.id,
        startTime: nextStartTime,
        endTime: nextEndTime,
      })
    }

    timelineEvents = sortEditableEvents(
      timelineEvents.map((event) => reassignedEvents.get(event.id) ?? event),
    )
    timelineTracks = relabelTracks(timelineTracks.filter((track) => track.id !== trackId))
  }

  function resetDraft(): void {
    const activeSource = timelineEvents.find((event) => event.id === activeEventId)

    draftWorldview = selectedWorldview || worldviewOptions[0] || DEFAULT_WORLDVIEW_NAME
    draftTitle = ''
    draftStartTime = Math.max(0, layout.end)
    draftEndTime = draftStartTime
    draftTrackId = activeSource?.trackId ?? timelineTracks[0]?.id ?? ''
    draftDetailImage = ''
    draftSummary = ''
    draftBody = ''
    draftTagsText = '#待整理'
  }

  function resetWorldviewDraft(): void {
    draftWorldviewName = ''
    draftWorldviewDescription = ''
    draftWorldviewTagsText = '#世界观'
    draftWorldviewCoverImage = ''
  }

  function openCreateEvent(): void {
    eventEditorMode = 'create'
    editingEventId = ''
    resetDraft()
    drawerMode = 'event'
  }

  function openCreateWorldview(): void {
    resetWorldviewDraft()
    isWorldviewMenuOpen = false
    drawerMode = 'worldview'
    editingEventId = ''
  }

  function closeDrawer(): void {
    drawerMode = 'none'
    editingEventId = ''
  }

  async function saveWorldviewDraft(): Promise<void> {
    const name = draftWorldviewName.trim()
    const description = draftWorldviewDescription.trim()
    const tags = serialiseTags(draftWorldviewTagsText)
    const coverImage = draftWorldviewCoverImage.trim()

    if (name === '') {
      return
    }

    if (worldviewOptions.includes(name)) {
      if (typeof window !== 'undefined') {
        await alertDialog(`世界观“${name}”已经存在。`)
      }
      return
    }

    customWorldviews = [
      ...customWorldviews,
      {
        name,
        description: description || '这是一个新建世界观，简介尚待补充。',
        coverImage,
        tags,
      },
    ]
    selectedWorldview = name
    routeWorldviewName = name
    closeDrawer()
    replaceRouteFromState()
  }

  function saveDraftEvent(): void {
    const sourceEvent = timelineEvents.find((event) => event.id === editingEventId)
    const title = draftTitle.trim() || '未命名事件'
    const worldview = draftWorldview.trim() || selectedWorldview || DEFAULT_WORLDVIEW_NAME
    const startTime = normaliseTime(draftStartTime, 0)
    const endTime = Math.max(startTime, normaliseTime(draftEndTime, startTime))
    const trackId = timelineTracks.some((track) => track.id === draftTrackId)
      ? draftTrackId
      : timelineTracks[0]?.id ?? createDefaultTrack(0).id
    const body = draftBody.trim() || `${title} 的正文仍待整理。`
    const summary = deriveSummary(draftSummary, body, title)
    const tags = serialiseTags(draftTagsText)
    const eventId = editingEventId || createEventId()

    const nextEvent: EditableTimelineEvent = {
      id: eventId,
      worldview,
      title,
      startTime,
      endTime,
      trackId,
      detailImage: draftDetailImage.trim() || sourceEvent?.detailImage,
      detailHtml: sourceEvent?.detailHtml,
      summary,
      body,
      tags,
    }

    if (editingEventId !== '') {
      timelineEvents = timelineEvents.map((event) => (event.id === editingEventId ? nextEvent : event))
    } else {
      timelineEvents = [...timelineEvents, nextEvent]
    }

    selectedWorldview = worldview
    routeWorldviewName = worldview
    activeEventId = eventId
    hoveredEventId = eventId
    drawerMode = 'none'
    editingEventId = ''
    activeCardBounce.set(1, { hard: true })
    activeCardBounce.set(0)
    replaceRouteFromState()
  }

  async function deleteEvent(eventId: string): Promise<void> {
    const targetEvent = timelineEvents.find((event) => event.id === eventId)
    if (!targetEvent) {
      return
    }

    const allowDelete =
      typeof window === 'undefined' || (await confirmDialog(`确认删除“${targetEvent.title}”吗？`))

    if (!allowDelete) {
      return
    }

    timelineEvents = timelineEvents.filter((event) => event.id !== eventId)

    if (activeEventId === eventId) {
      activeEventId = ''
    }

    if (hoveredEventId === eventId) {
      hoveredEventId = ''
    }

    if (editingEventId === eventId) {
      closeDrawer()
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }

    if (drawerMode !== 'none') {
      closeDrawer()
      return
    }

    if (activePage === 'event-detail') {
      closeEventDetail()
      return
    }

    activeEventId = ''
    hoveredEventId = ''
  }

  function handleWindowClick(event: MouseEvent): void {
    const target = event.target

    if (!(target instanceof Node)) {
      return
    }

    if (isWorldviewMenuOpen && worldviewMenuElement && !worldviewMenuElement.contains(target)) {
      isWorldviewMenuOpen = false
    }

    if (isTagFilterOpen && tagFilterContainerElement && !tagFilterContainerElement.contains(target)) {
      isTagFilterOpen = false
    }
  }

  function resolveWorldviewContent(name: string): WorldviewContent {
    return customWorldviews.find((entry) => entry.name === name) ?? getWorldviewContent(name)
  }

  function resolveWorldviewTheme(name: string): WorldviewTheme {
    const baseTheme = getWorldviewTheme(name)
    const customWorldview = customWorldviews.find((entry) => entry.name === name)

    if (!customWorldview) {
      return baseTheme
    }

    const coverImage = customWorldview.coverImage?.trim() ?? ''

    return {
      ...baseTheme,
      coverImage,
      coverLabel: coverImage ? `${name} / 自定义封面` : baseTheme.coverLabel,
      description: customWorldview.description || baseTheme.description,
    }
  }

  function normaliseVisiblePage(page: AppPage): AppPage {
    return page === 'timeline' ? 'vertical-timeline' : page
  }

  function getRouteWorldviewName(targetPage: AppPage = activePage): string | null {
    if (['home', 'chat-room'].includes(normaliseVisiblePage(targetPage))) {
      return null
    }

    const worldviewName = selectedWorldview || worldviewOptions[0] || DEFAULT_WORLDVIEW_NAME
    return worldviewName.trim() === '' ? null : worldviewName
  }

  function getCurrentRouteHref(targetPage: AppPage = activePage, targetDetailEventId = detailEventId): string {
    return buildAppRouteHref({
      eventId: targetDetailEventId,
      page: normaliseVisiblePage(targetPage),
      worldviewName: getRouteWorldviewName(targetPage),
    })
  }

  function replaceRouteFromState(targetPage: AppPage = activePage, targetDetailEventId = detailEventId): void {
    if (typeof window === 'undefined') {
      return
    }

    const nextHref = getCurrentRouteHref(targetPage, targetDetailEventId)
    const currentHref = `${window.location.pathname}${window.location.search}`

    if (currentHref === nextHref) {
      return
    }

    window.history.replaceState({}, '', nextHref)
  }

  function pushRouteFromState(targetPage: AppPage = activePage, targetDetailEventId = detailEventId): void {
    if (typeof window === 'undefined') {
      return
    }

    const nextHref = getCurrentRouteHref(targetPage, targetDetailEventId)
    const currentHref = `${window.location.pathname}${window.location.search}`

    if (currentHref === nextHref) {
      return
    }

    window.history.pushState({}, '', nextHref)
  }

  function applyRoute(route: { eventId: string; page: AppPage; worldviewName: string | null }): void {
    const nextPage = normaliseVisiblePage(route.page)
    const detailEvent =
      nextPage === 'event-detail'
        ? timelineEvents.find((event) => event.id === route.eventId) ?? null
        : null

    activePage = nextPage
    detailEventId = nextPage === 'event-detail' ? route.eventId : ''
    routeWorldviewName = route.worldviewName ?? detailEvent?.worldview ?? null

    if (nextPage !== 'event-detail') {
      drawerMode = drawerMode === 'event' ? 'none' : drawerMode
    }

    if (['home', 'chat-room'].includes(nextPage)) {
      isWorldviewMenuOpen = false
      isTagFilterOpen = false
    }
  }

  function syncRouteWithLocation(replace = false): void {
    if (typeof window === 'undefined') {
      return
    }

    const route = parseAppRoute(window.location)
    applyRoute(route)

    if (replace) {
      replaceRouteFromState(route.page, route.eventId)
    }
  }

  function handleWindowPopState(): void {
    syncRouteWithLocation(false)
  }

  function navigateToPage(page: AppPage, options?: { replace?: boolean }): void {
    const nextPage = normaliseVisiblePage(page)
    activePage = nextPage

    if (nextPage !== 'event-detail') {
      detailEventId = ''
    }

    if (options?.replace) {
      replaceRouteFromState(nextPage, detailEventId)
      return
    }

    pushRouteFromState(nextPage, detailEventId)
  }

  function normaliseIntervalEnd(start: number, end: number): number {
    return end > start ? end : start + 1
  }

  function hasTrackOverlap(eventId: string): boolean {
    const targetEvent = timelineEvents.find((event) => event.id === eventId)

    if (!targetEvent) {
      return false
    }

    const targetEnd = normaliseIntervalEnd(targetEvent.startTime, targetEvent.endTime)

    return timelineEvents.some((event) => {
      if (
        event.id === targetEvent.id ||
        event.worldview !== targetEvent.worldview ||
        event.trackId !== targetEvent.trackId
      ) {
        return false
      }

      const currentEnd = normaliseIntervalEnd(event.startTime, event.endTime)
      return targetEvent.startTime < currentEnd && targetEnd > event.startTime
    })
  }

  $: configuredWorldviewNames = [...worldviewContents, ...customWorldviews].map((entry) => entry.name)
  $: worldviewOptions = [
    ...new Set([...configuredWorldviewNames, ...timelineEvents.map((event) => event.worldview)].filter(Boolean)),
  ]
  $: if (worldviewOptions.length === 0) {
    selectedWorldview = ''
    routeWorldviewName = null
    activeEventId = ''
    hoveredEventId = ''
  } else if (routeWorldviewName && worldviewOptions.includes(routeWorldviewName)) {
    selectedWorldview = routeWorldviewName
  } else if (!worldviewOptions.includes(selectedWorldview)) {
    selectedWorldview = worldviewOptions[0]
  }
  $: worldviewEvents =
    selectedWorldview === ''
      ? timelineEvents
      : timelineEvents.filter((event) => event.worldview === selectedWorldview)
  $: availableTags = [...new Set(worldviewEvents.flatMap((event) => event.tags))]
  $: {
    const nextSelectedTags = selectedTagFilters.filter((tag) => availableTags.includes(tag))
    if (nextSelectedTags.length !== selectedTagFilters.length) {
      selectedTagFilters = nextSelectedTags
    }
  }
  $: filteredTimelineEvents =
    tagFilterMode === 'hide' && selectedTagFilters.length > 0
      ? worldviewEvents.filter((event) => matchesSelectedTags(event))
      : worldviewEvents
  $: density = getZoomDensity(zoomLevel)
  $: zoomFactor = Math.round(baseZoomFactor * zoomLevel * 10) / 10
  $: layout = createFixedTrackTimelineLayout(filteredTimelineEvents, timelineTracks, {
    zoomFactor,
    trackHeight: density.collapsedTrackHeight,
    eventHeight: density.collapsedEventHeight,
    minCardWidth: density.minCardWidth,
  })
  $: ticks = createAdaptiveTimelineTicks(
    layout.origin,
    layout.end,
    layout.zoomFactor,
    density.tickBaseStep,
    density.minTickLabelSpacingPx,
  ).map((tick) => ({
    ...tick,
    x: tick.x + TRACK_LEADING_GUTTER,
  }))
  $: trackColorMap = new Map(timelineTracks.map((track) => [track.id, track.color]))
  $: trackLabelMap = new Map(timelineTracks.map((track) => [track.id, track.label]))
  $: timelineEventMap = new Map(timelineEvents.map((event) => [event.id, event]))
  $: canExpandEvents = timelineMode === 'view'
  $: surfaceBottomPadding = density.expandedEventHeight - density.collapsedEventHeight + 18
  $: surfaceWidth = layout.totalWidth + density.expandedCardWidth
  $: surfaceHeight = layout.totalHeight + axisHeight + axisContentGap + surfaceBottomPadding
  $: focusEventId = hoveredEventId || activeEventId
  $: renderedEvents = layout.events.map<RenderedTimelineEvent>((event) => {
    const sourceEvent = timelineEventMap.get(event.id)
    const active = activeEventId === event.id
    const expanded = canExpandEvents && active
    const focused = focusEventId === event.id
    const dragging = eventDragId === event.id && isEventDragging && eventDragMode === 'move'
    const resizing = eventDragId === event.id && isEventDragging && eventDragMode === 'resize-end'
    const tagMatched = matchesSelectedTags(sourceEvent ?? event)
    const mutedByFocus = focusEventId !== '' && focusEventId !== event.id
    const mutedByTags = tagFilterMode === 'highlight' && selectedTagFilters.length > 0 && !tagMatched
    const minimal =
      !expanded &&
      (density.mode === 'overview' ||
        zoomFactor < MINIMAL_ZOOM_THRESHOLD ||
        event.width < MINIMAL_CARD_WIDTH_THRESHOLD)

    return {
      ...(event as PositionedTimelineEvent),
      active,
      bounceScale: active ? 1 + $activeCardBounce * 0.02 : 1,
      bounceY: active ? $activeCardBounce * 10 : 0,
      dragging,
      editable: timelineMode === 'edit',
      expanded,
      focused,
      minimal,
      muted: mutedByFocus || mutedByTags,
      renderedHeight: expanded ? density.expandedEventHeight : density.collapsedEventHeight,
      renderedTop: event.top + axisHeight + axisContentGap,
      renderedWidth: expanded ? Math.max(event.duration * zoomFactor, density.expandedCardWidth) : event.width,
      resizing,
      trackColor: trackColorMap.get(sourceEvent?.trackId ?? timelineTracks[0]?.id ?? '') ?? '#d9e0e6',
      trackId: sourceEvent?.trackId ?? timelineTracks[0]?.id ?? '',
      trackLabel: trackLabelMap.get(sourceEvent?.trackId ?? timelineTracks[0]?.id ?? '') ?? '未分配轨道',
    }
  })
  $: activeWorldviewName = selectedWorldview || worldviewOptions[0] || DEFAULT_WORLDVIEW_NAME
  $: activeWorldviewContent = resolveWorldviewContent(activeWorldviewName)
  $: currentWorldviewTheme = resolveWorldviewTheme(activeWorldviewName)
  $: themeStyle = createWorldviewThemeStyle(currentWorldviewTheme)
  $: logWorldviewCards = worldviewOptions.map((worldview) => {
    const worldviewContent = resolveWorldviewContent(worldview)
    const worldviewTheme = resolveWorldviewTheme(worldview)

    return {
      description: worldviewContent.description,
      hasCover: worldviewTheme.coverImage !== '',
      name: worldview,
      tags: worldviewContent.tags,
      themeStyle: createWorldviewThemeStyle(worldviewTheme),
    }
  })
  $: modeDescription =
    timelineMode === 'edit'
      ? '当前使用固定轨道，可直接新增轨道并调整轨道颜色。'
      : '当前仍使用固定轨道浏览，缩放不会改变事件所在轨道。'
  $: if (!layout.events.some((event) => event.id === activeEventId)) {
    activeEventId = ''
  }
  $: if (!layout.events.some((event) => event.id === hoveredEventId)) {
    hoveredEventId = ''
  }
  $: if (timelineScrollElement && activePage === 'timeline') {
    density.tickBaseStep
    zoomLevel
    selectedWorldview
    timelineMode
    tagFilterMode
    selectedTagFilters.length
    scheduleSnap()
  }
  $: if (draftEndTime < draftStartTime) {
    draftEndTime = draftStartTime
  }
  $: if (!timelineTracks.some((track) => track.id === draftTrackId)) {
    draftTrackId = timelineTracks[0]?.id ?? ''
  }
  $: if (activePage !== 'timeline' && drawerMode === 'event') {
    closeDrawer()
  }
  $: if (
    activePage === 'event-detail' &&
    detailEventId !== '' &&
    !timelineEvents.some((event) => event.id === detailEventId)
  ) {
    navigateToPage('timeline', { replace: true })
  }
  $: if (
    hasMountedRouter &&
    !['home', 'chat-room'].includes(activePage) &&
    worldviewOptions.length > 0 &&
    routeWorldviewName !== selectedWorldview
  ) {
    routeWorldviewName = selectedWorldview
    replaceRouteFromState()
  }

  function toggleEvent(event: PositionedTimelineEvent): void {
    if (suppressClick) {
      suppressClick = false
      return
    }

    if (timelineMode === 'edit') {
      activeEventId = activeEventId === event.id ? '' : event.id
      hoveredEventId = event.id
      return
    }

    activeEventId = activeEventId === event.id ? '' : event.id
    activeCardBounce.set(1, { hard: true })
    activeCardBounce.set(0)
  }

  function openEventDetail(eventId: string): void {
    const sourceEvent = timelineEvents.find((event) => event.id === eventId)

    if (!sourceEvent) {
      return
    }

    selectedWorldview = sourceEvent.worldview
    routeWorldviewName = sourceEvent.worldview
    activeEventId = eventId
    hoveredEventId = eventId
    detailEventId = eventId
    drawerMode = 'none'
    navigateToPage('event-detail')
  }

  function closeEventDetail(): void {
    navigateToPage('timeline', { replace: true })
  }

  function saveDetailEvent(draft: {
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

    timelineEvents = timelineEvents.map((event) =>
      event.id === detailEventId
        ? {
            ...event,
            title: draft.title,
            summary: draft.summary.trim() || deriveSummary('', draft.bodyText, draft.title),
            body: draft.bodyText,
            detailHtml: draft.bodyHtml,
            tags: draft.tags,
            detailImage: draft.detailImage,
          }
        : event,
    )
  }

  function deleteFromDetailPage(): void {
    const targetId = detailEventId

    if (targetId === '') {
      return
    }

    deleteEvent(targetId)

    if (!timelineEvents.some((event) => event.id === targetId)) {
      navigateToPage('timeline', { replace: true })
    }
  }

  function changeWorldview(worldview: string): void {
    selectedWorldview = worldview
    routeWorldviewName = worldview
    isWorldviewMenuOpen = false
    isTagFilterOpen = false
    activeEventId = ''
    hoveredEventId = ''
    timelineScrollElement?.scrollTo({ left: 0, behavior: 'smooth' })

    if (activePage === 'event-detail') {
      navigateToPage('timeline')
      return
    }

    pushRouteFromState()
  }

  function changeTimelineMode(mode: TimelineMode): void {
    timelineMode = mode
    activeEventId = ''
    hoveredEventId = ''
  }

  function clearSnapTimer(): void {
    if (snapTimer) {
      clearTimeout(snapTimer)
      snapTimer = null
    }
  }

  function scheduleSnap(): void {
    clearSnapTimer()
    snapTimer = setTimeout(() => {
      snapToNearestTick()
    }, SNAP_DELAY)
  }

  function snapToNearestTick(): void {
    if (!timelineScrollElement || ticks.length === 0 || isDragging || isEventDragging) {
      return
    }

    const viewportCenter = timelineScrollElement.scrollLeft + timelineScrollElement.clientWidth / 2
    const nearestTick = ticks.reduce((closest, tick) => {
      if (!closest) {
        return tick
      }

      return Math.abs(tick.x - viewportCenter) < Math.abs(closest.x - viewportCenter) ? tick : closest
    }, ticks[0])

    const threshold = Math.max(36, density.minTickLabelSpacingPx * 0.45)
    if (Math.abs(nearestTick.x - viewportCenter) > threshold) {
      return
    }

    const targetLeft = nearestTick.x - timelineScrollElement.clientWidth / 2
    const maxLeft = Math.max(0, timelineScrollElement.scrollWidth - timelineScrollElement.clientWidth)
    const boundedLeft = Math.max(0, Math.min(targetLeft, maxLeft))

    timelineScrollElement.scrollTo({
      left: boundedLeft,
      behavior: 'smooth',
    })
  }

  function handleTimelinePointerDown(event: PointerEvent): void {
    if (!timelineScrollElement || event.button !== 0 || isEventDragging) {
      return
    }

    isDragging = true
    dragStartX = event.clientX
    dragStartScrollLeft = timelineScrollElement.scrollLeft
    dragDistance = 0
    clearSnapTimer()
    surfaceNudge.set(0, { hard: true })
    timelineScrollElement.setPointerCapture(event.pointerId)
  }

  function handleTimelinePointerMove(event: PointerEvent): void {
    if (!timelineScrollElement || !isDragging || isEventDragging) {
      return
    }

    const deltaX = event.clientX - dragStartX
    const nextScrollLeft = dragStartScrollLeft - deltaX
    const maxScrollLeft = Math.max(0, timelineScrollElement.scrollWidth - timelineScrollElement.clientWidth)

    dragDistance = Math.max(dragDistance, Math.abs(deltaX))

    if (nextScrollLeft < 0) {
      timelineScrollElement.scrollLeft = 0
      surfaceNudge.set(Math.min(-nextScrollLeft * 0.18, 24))
      return
    }

    if (nextScrollLeft > maxScrollLeft) {
      timelineScrollElement.scrollLeft = maxScrollLeft
      surfaceNudge.set(-Math.min((nextScrollLeft - maxScrollLeft) * 0.18, 24))
      return
    }

    timelineScrollElement.scrollLeft = nextScrollLeft
    surfaceNudge.set(0)
  }

  function finishTimelineDrag(pointerId?: number): void {
    if (!timelineScrollElement) {
      return
    }

    if (pointerId !== undefined && timelineScrollElement.hasPointerCapture(pointerId)) {
      timelineScrollElement.releasePointerCapture(pointerId)
    }

    const dragged = dragDistance > 6
    isDragging = false
    surfaceNudge.set(0)

    if (dragged) {
      suppressClick = true

      requestAnimationFrame(() => {
        suppressClick = false
      })
    }

    scheduleSnap()
  }

  function handleTimelinePointerUp(event: PointerEvent): void {
    finishTimelineDrag(event.pointerId)
  }

  function handleTimelinePointerCancel(event: PointerEvent): void {
    finishTimelineDrag(event.pointerId)
  }

  function handleTimelineScroll(): void {
    if (!isDragging && !isEventDragging) {
      scheduleSnap()
    }
  }

  function getTrackIdFromPointer(clientY: number, fallbackTrackId: string): string {
    if (!timelineSurfaceElement) {
      return fallbackTrackId
    }

    const surfaceRect = timelineSurfaceElement.getBoundingClientRect()
    const relativeY = clientY - surfaceRect.top - axisHeight - axisContentGap
    const trackIndex = Math.floor(relativeY / density.collapsedTrackHeight)
    const boundedTrackIndex = Math.max(0, Math.min(trackIndex, timelineTracks.length - 1))

    return timelineTracks[boundedTrackIndex]?.id ?? fallbackTrackId
  }

  function handleEventPointerDown(event: PointerEvent, eventId: string, mode: EventDragMode = 'move'): void {
    if (event.button !== 0 || (timelineMode !== 'edit' && mode === 'move')) {
      return
    }

    const sourceEvent = timelineEvents.find((item) => item.id === eventId)
    const target = event.currentTarget as HTMLDivElement | null

    if (!sourceEvent || !target) {
      return
    }

    eventDragId = eventId
    eventDragMode = mode
    eventDragPointerId = event.pointerId
    eventDragStartX = event.clientX
    eventDragStartY = event.clientY
    eventDragOriginStartTime = sourceEvent.startTime
    eventDragOriginEndTime = sourceEvent.endTime
    eventDragOriginTrackId = sourceEvent.trackId
    eventDragLastShift = 0
    eventDragLastTrackId = sourceEvent.trackId
    eventDragTarget = target
    isEventDragging = false
    clearSnapTimer()
    target.setPointerCapture(event.pointerId)
  }

  function handleEventPointerMove(event: PointerEvent): void {
    if (eventDragId === '' || eventDragPointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - eventDragStartX
    const deltaY = event.clientY - eventDragStartY

    if (Math.hypot(deltaX, deltaY) < EVENT_DRAG_THRESHOLD) {
      return
    }

    if (!isEventDragging) {
      isEventDragging = true
      activeEventId = eventDragId
      hoveredEventId = eventDragId
    }

    const shift = Math.round(deltaX / zoomFactor)

    if (eventDragMode === 'resize-end') {
      if (shift === eventDragLastShift) {
        return
      }

      eventDragLastShift = shift
      const nextEndTime = Math.max(eventDragOriginStartTime, eventDragOriginEndTime + shift)

      timelineEvents = timelineEvents.map((item) =>
        item.id === eventDragId
          ? {
              ...item,
              endTime: nextEndTime,
            }
          : item,
      )

      return
    }

    const duration = eventDragOriginEndTime - eventDragOriginStartTime
    const nextTrackId =
      timelineMode === 'edit'
        ? getTrackIdFromPointer(event.clientY, eventDragOriginTrackId)
        : eventDragOriginTrackId

    if (shift === eventDragLastShift && nextTrackId === eventDragLastTrackId) {
      return
    }

    eventDragLastShift = shift
    eventDragLastTrackId = nextTrackId

    const nextStartTime = Math.max(0, eventDragOriginStartTime + shift)
    const nextEndTime = nextStartTime + duration

    timelineEvents = timelineEvents.map((item) =>
      item.id === eventDragId
        ? {
            ...item,
            startTime: nextStartTime,
            endTime: nextEndTime,
            trackId: nextTrackId,
          }
        : item,
    )
  }

  function finishEventDrag(pointerId?: number): void {
    if (eventDragId === '') {
      return
    }

    if (pointerId !== undefined && eventDragTarget?.hasPointerCapture(pointerId)) {
      eventDragTarget.releasePointerCapture(pointerId)
    }

    const draggedEventId = eventDragId
    const shouldRevert = isEventDragging && hasTrackOverlap(draggedEventId)

    if (shouldRevert) {
      timelineEvents = timelineEvents.map((item) =>
        item.id === draggedEventId
          ? {
              ...item,
              startTime: eventDragOriginStartTime,
              endTime: eventDragOriginEndTime,
              trackId: eventDragOriginTrackId,
            }
          : item,
      )
    }

    if (isEventDragging) {
      suppressClick = true

      requestAnimationFrame(() => {
        suppressClick = false
      })

      activeEventId = ''
      hoveredEventId = ''
      activeCardBounce.set(1, { hard: true })
      activeCardBounce.set(0)
      scheduleSnap()
    }

    eventDragId = ''
    eventDragMode = 'move'
    eventDragPointerId = null
    eventDragTarget = null
    eventDragLastShift = 0
    eventDragLastTrackId = ''
    isEventDragging = false
  }

  function handleEventPointerUp(event: PointerEvent): void {
    finishEventDrag(event.pointerId)
  }

  function handleEventPointerCancel(event: PointerEvent): void {
    finishEventDrag(event.pointerId)
  }

  function handleWindowPointerUp(event: PointerEvent): void {
    if (isDragging) {
      finishTimelineDrag(event.pointerId)
    }

    if (eventDragId !== '') {
      finishEventDrag(event.pointerId)
    }
  }

  function handleWindowPointerCancel(event: PointerEvent): void {
    handleWindowPointerUp(event)
  }

  onMount(() => {
    syncRouteWithLocation(true)
    hasMountedRouter = true
  })
</script>

<svelte:head>
  <title>{projectTitle}</title>
  <meta
    name="description"
    content="Morosonder：面向 CoC 跑团的世界观、时间线、年龄工具、日志工坊与群聊网站。"
  />
</svelte:head>

<svelte:window
  onclick={handleWindowClick}
  onkeydown={handleWindowKeydown}
  onpopstate={handleWindowPopState}
  onpointercancel={handleWindowPointerCancel}
  onpointerup={handleWindowPointerUp}
/>

<main
  class={activePage === 'chat-room' ? 'min-w-0 !flex !h-screen !w-full !flex-col !overflow-hidden' : 'shell'}
  class:is-home={activePage === 'home'}
  style={themeStyle}
>
  {#if activePage !== 'chat-room'}
    <div class="topbar" class:is-home={activePage === 'home'}>
      <nav class="page-switcher" aria-label="页面切换">
        <button
          class:is-current={activePage === 'home'}
          class="page-switch"
          type="button"
          onclick={() => navigateToPage('home')}
        >
          首页
        </button>
        <button
          class:is-current={activePage === 'vertical-timeline'}
          class="page-switch"
          type="button"
          onclick={() => navigateToPage('vertical-timeline')}
        >
          时间线
        </button>
        <button
          class:is-current={activePage === 'age-chronicle'}
          class="page-switch"
          type="button"
          onclick={() => navigateToPage('age-chronicle')}
        >
          年龄工具
        </button>
        <button
          class:is-current={activePage === 'log-workbench'}
          class="page-switch"
          type="button"
          onclick={() => navigateToPage('log-workbench')}
        >
          日志展示
        </button>
        <button class="page-switch" type="button" onclick={() => navigateToPage('chat-room')}>
          群聊
        </button>
        {#if activePage === 'event-detail'}
          <button class:is-current={true} class="page-switch" type="button">
            事件详情
          </button>
        {/if}
      </nav>

      {#if !['home', 'chat-room'].includes(activePage)}
        <div bind:this={worldviewMenuElement} class="worldview-dropdown">
        <button
          aria-expanded={isWorldviewMenuOpen}
          class="worldview-dropdown-trigger"
          type="button"
          onclick={toggleWorldviewMenu}
        >
          <span class="worldview-dropdown-label">世界观</span>
          <strong>{activeWorldviewName}</strong>
        </button>

        {#if isWorldviewMenuOpen}
          <div
            class="worldview-dropdown-menu"
            in:seaFogIn={{ delay: 0, duration: 220 }}
            out:seaFogOut={{ duration: 180 }}
          >
            {#each worldviewOptions as worldview}
              {@const worldviewContent = resolveWorldviewContent(worldview)}
              <button
                class:is-current={selectedWorldview === worldview}
                class="worldview-dropdown-item"
                type="button"
                onclick={() => changeWorldview(worldview)}
              >
                <strong>{worldview}</strong>
                <span>{worldviewContent.description}</span>
              </button>
            {/each}

            <div class="worldview-dropdown-divider" aria-hidden="true"></div>
            <button class="worldview-dropdown-create" type="button" onclick={openCreateWorldview}>
              + 新增世界观
            </button>
          </div>
        {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div
    class={`page-scene-stack min-w-0 ${
      activePage === 'chat-room' ? '!flex !flex-1 !min-h-0 !items-stretch !overflow-hidden' : ''
    }`}
    class:is-home={activePage === 'home'}
  >
    {#key activePage}
      <div
        class={`page-scene min-w-0 ${
          activePage === 'chat-room' ? '!flex !h-full !flex-1 !min-h-0 !overflow-hidden' : ''
        }`}
        class:is-home={activePage === 'home'}
        in:fade={{ duration: 150 }}
        out:fade={{ duration: 150 }}
      >
    {#if activePage === 'home'}
      <HomePage />
    {:else if activePage === 'timeline'}
      <WorldviewHero
        description={activeWorldviewContent.description}
        hasCover={currentWorldviewTheme.coverImage !== ''}
        name={activeWorldviewName}
        tags={activeWorldviewContent.tags}
        themeStyle={themeStyle}
        transitionKey={activeWorldviewName}
      />

      <section class="board">
      <div class="board-head">
        <div>
          <h2>{boardHeading}</h2>
        </div>

        <div class="board-head-side">
          <div class="board-head-actions">
            <div class="mode-switcher" role="tablist" aria-label="时间轴模式切换">
              <button
                class:is-current={timelineMode === 'view'}
                class="mode-switch"
                type="button"
                onclick={() => changeTimelineMode('view')}
              >
                展示模式
              </button>
              <button
                class:is-current={timelineMode === 'edit'}
                class="mode-switch"
                type="button"
                onclick={() => changeTimelineMode('edit')}
              >
                编辑模式
              </button>
            </div>
            <button class="toolbar-action toolbar-primary" type="button" onclick={openCreateEvent}>
              新建事件
            </button>
          </div>
        </div>
      </div>

      <div class="board-toolbar">
        <div class="toolbar-stack">
          <label class="zoom-panel" for="timeline-zoom">
            <span class="toolbar-label">时间缩放</span>
            <div class="zoom-row">
              <span>紧凑</span>
              <input
                id="timeline-zoom"
                bind:value={zoomLevel}
                min="0.7"
                max="1.8"
                step="0.1"
                type="range"
              />
              <span>展开</span>
            </div>
          </label>

        </div>

        <div bind:this={tagFilterContainerElement} class="track-panel">
          <div class="track-panel-head">
            <div class="track-panel-actions">
              <button class="toolbar-action" type="button" onclick={toggleTagFilterPanel}>
                标签筛选 {selectedTagFilters.length > 0 ? `(${selectedTagFilters.length})` : ''}
              </button>
              {#if timelineMode === 'edit'}
                <button class="toolbar-action" type="button" onclick={addTrack}>新增轨道</button>
              {/if}
            </div>
          </div>

          {#if isTagFilterOpen}
            <div
              class="tag-filter-panel tag-filter-inline"
              in:seaFogIn={{ delay: 0, duration: 220 }}
              out:seaFogOut={{ duration: 180 }}
            >
              <div class="tag-filter-head">
                <span class="toolbar-label">标签筛选</span>
                <div class="tag-filter-actions">
                  <div class="tag-filter-mode" role="tablist" aria-label="标签筛选模式">
                    <button
                      class:is-current={tagFilterMode === 'highlight'}
                      class="tag-mode-switch"
                      type="button"
                      onclick={() => (tagFilterMode = 'highlight')}
                    >
                      高亮
                    </button>
                    <button
                      class:is-current={tagFilterMode === 'hide'}
                      class="tag-mode-switch"
                      type="button"
                      onclick={() => (tagFilterMode = 'hide')}
                    >
                      隐藏
                    </button>
                  </div>
                  <button class="toolbar-ghost" type="button" onclick={clearTagFilters}>清空</button>
                </div>
              </div>

              <div class="tag-filter-list" aria-label="标签多选筛选">
                {#each availableTags as tag}
                  <button
                    class:is-selected={selectedTagFilters.includes(tag)}
                    class="tag-filter-chip"
                    type="button"
                    onclick={() => toggleTagFilter(tag)}
                  >
                    {tag}
                  </button>
                {/each}

                {#if availableTags.length === 0}
                  <span class="empty-worldview">当前世界观暂无标签</span>
                {/if}
              </div>
            </div>
          {/if}

          {#if timelineMode === 'edit'}
            <div class="track-editor-list">
              {#each timelineTracks as track, index (track.id)}
                <div class="track-editor-item" style={`--track-color:${track.color};`}>
                  <span class="track-editor-name">{track.label}</span>
                  <div class="track-editor-controls">
                    <input
                      aria-label={`${track.label} 颜色`}
                      type="color"
                      value={track.color}
                      oninput={(event) =>
                        updateTrackColor(track.id, (event.currentTarget as HTMLInputElement).value)}
                    />
                    <button
                      class="track-delete"
                      type="button"
                      disabled={index === 0 || timelineTracks.length <= 1}
                      onclick={() => removeTrack(track.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="timeline-frame">
        <div
          bind:this={timelineScrollElement}
          aria-label="时间轴漫游区域"
          class:is-dragging={isDragging}
          class="timeline-scroll"
          role="group"
          onpointercancel={handleTimelinePointerCancel}
          onpointerdown={handleTimelinePointerDown}
          onpointermove={handleTimelinePointerMove}
          onpointerup={handleTimelinePointerUp}
          onscroll={handleTimelineScroll}
        >
          <div
            bind:this={timelineSurfaceElement}
            class:density-compact={density.mode === 'compact'}
            class:density-detail={density.mode === 'detail'}
            class:density-overview={density.mode === 'overview'}
            class:has-focus={focusEventId !== ''}
            class:is-edit-mode={timelineMode === 'edit'}
            class="timeline-surface"
            style={`width: ${surfaceWidth}px; height: ${surfaceHeight}px; --track-size: ${density.collapsedTrackHeight}px; --axis-height: ${axisHeight}px; --surface-nudge: ${$surfaceNudge}px;`}
          >
            <TimelineAxis densityMode={density.mode} {ticks} />

            <div class="timeline-track-bands" aria-hidden="true">
              {#each timelineTracks as track, index (track.id)}
                <div
                  class="timeline-track-band"
                  style={`top: ${axisHeight + axisContentGap + index * density.collapsedTrackHeight}px; height: ${density.collapsedTrackHeight}px; --track-band-color:${track.color};`}
                >
                  <span>{track.label}</span>
                </div>
              {/each}
            </div>

            {#each renderedEvents as event (event.id)}
              <TimelineEventCard
                active={event.active}
                bounceScale={event.bounceScale}
                bounceY={event.bounceY}
                dragging={event.dragging}
                editable={event.editable}
                event={event}
                expanded={event.expanded}
                focused={event.focused}
                height={event.renderedHeight}
                left={event.x}
                minimal={event.minimal}
                muted={event.muted}
                onBlurCard={() => (hoveredEventId = '')}
                onDeleteCard={() => deleteEvent(event.id)}
                onFocusCard={() => (hoveredEventId = event.id)}
                onMouseEnterCard={() => (hoveredEventId = event.id)}
                onMouseLeaveCard={() => (hoveredEventId = '')}
                onOpenDetailsCard={() => openEventDetail(event.id)}
                onPointerCancelCard={handleEventPointerCancel}
                onPointerDownCard={(pointerEvent) => handleEventPointerDown(pointerEvent, event.id)}
                onPointerMoveCard={handleEventPointerMove}
                onPointerUpCard={handleEventPointerUp}
                onResizePointerDownCard={(pointerEvent) =>
                  handleEventPointerDown(pointerEvent, event.id, 'resize-end')}
                onToggleCard={() => toggleEvent(event)}
                resizing={event.resizing}
                showActions={event.active}
                showDetailsEntry={event.expanded}
                showTrack={density.showTrack || timelineMode === 'edit'}
                trackColor={event.trackColor}
                trackLabel={event.trackLabel}
                top={event.renderedTop}
                width={event.renderedWidth}
              />
            {/each}
          </div>
        </div>
      </div>

      </section>

      {#if drawerMode === 'event'}
        <div class="drawer-backdrop">
        <button
          class="drawer-dismiss"
          type="button"
          aria-label="关闭抽屉"
          onclick={closeDrawer}
        ></button>
          <aside class="drawer-panel" aria-label="事件编辑抽屉">
          <div class="drawer-header">
            <div>
              <p class="section-label">事件编辑</p>
              <h3>{eventEditorMode === 'create' ? '新建事件' : '编辑事件'}</h3>
            </div>
            <button class="toolbar-action" type="button" onclick={closeDrawer}>
              关闭
            </button>
          </div>

          <div class="drawer-body">
            <form
              class="drawer-form"
              onsubmit={(event) => {
                event.preventDefault()
                saveDraftEvent()
              }}
            >
              <label class="drawer-field">
                <span>世界观</span>
                <input bind:value={draftWorldview} list="worldview-options" type="text" />
              </label>

              <label class="drawer-field">
                <span>标题</span>
                <input bind:value={draftTitle} maxlength="80" type="text" />
              </label>

              <div class="drawer-field-row">
                <label class="drawer-field">
                  <span>开始时间</span>
                  <input bind:value={draftStartTime} min="0" step="1" type="number" />
                </label>

                <label class="drawer-field">
                  <span>结束时间</span>
                  <input bind:value={draftEndTime} min="0" step="1" type="number" />
                </label>
              </div>

              <label class="drawer-field">
                <span>所在轨道</span>
                <select bind:value={draftTrackId}>
                  {#each timelineTracks as track}
                    <option value={track.id}>{track.label}</option>
                  {/each}
                </select>
              </label>

              <label class="drawer-field">
                <span>摘要</span>
                <textarea
                  bind:value={draftSummary}
                  placeholder="可留空，保存时会自动根据正文生成摘要。"
                  rows="3"
                ></textarea>
              </label>

              <label class="drawer-field">
                <span>正文</span>
                <textarea
                  bind:value={draftBody}
                  placeholder="这里先用富文本近似的多行正文承接 Phase 3，后续再接 Markdown 编辑器。"
                  rows="7"
                ></textarea>
              </label>

              <label class="drawer-field">
                <span>标签</span>
                <textarea
                  bind:value={draftTagsText}
                  placeholder="#主线，#角色，#线索"
                  rows="2"
                ></textarea>
              </label>

              <div class="drawer-footer">
                <button class="toolbar-action" type="button" onclick={closeDrawer}>
                  取消
                </button>
                <button class="toolbar-action toolbar-primary" type="submit">
                  保存事件
                </button>
              </div>
            </form>
          </div>
          </aside>
        </div>
      {/if}

      <datalist id="worldview-options">
      {#each worldviewOptions as worldview}
        <option value={worldview}></option>
      {/each}
      </datalist>
    {:else if activePage === 'vertical-timeline'}
      <VerticalTimelinePage
        worldviewDescription={activeWorldviewContent.description}
        worldviewHasCover={currentWorldviewTheme.coverImage !== ''}
        worldviewName={activeWorldviewName}
        worldviewTags={activeWorldviewContent.tags}
        worldviewThemeStyle={themeStyle}
        worldviewTransitionKey={activeWorldviewName}
      />
    {:else if activePage === 'age-chronicle'}
      <AgeChroniclePage
        worldviewDescription={activeWorldviewContent.description}
        worldviewHasCover={currentWorldviewTheme.coverImage !== ''}
        worldviewName={activeWorldviewName}
        worldviewTags={activeWorldviewContent.tags}
        worldviewThemeStyle={themeStyle}
        worldviewTransitionKey={activeWorldviewName}
      />
    {:else if activePage === 'log-workbench'}
      <LogWorkbenchPage
        initialWorldviewName={activeWorldviewName}
        worldviewCards={logWorldviewCards}
        worldviewDescription={activeWorldviewContent.description}
        worldviewHasCover={currentWorldviewTheme.coverImage !== ''}
        worldviewName={activeWorldviewName}
        worldviewTags={activeWorldviewContent.tags}
        worldviewThemeStyle={themeStyle}
        worldviewTransitionKey={activeWorldviewName}
      />
    {:else if activePage === 'admin-character'}
      <AdminCharacterPage worldviewOptions={worldviewOptions} />
    {:else if activePage === 'chat-room'}
      <ChatRoomPage onOpenAdminCharacterPage={() => navigateToPage('admin-character')} />
    {:else}
      <EventDetailPage
        event={timelineEvents.find((event) => event.id === detailEventId) ?? null}
        onBack={closeEventDetail}
        onDelete={deleteFromDetailPage}
        onSave={saveDetailEvent}
        worldviewName={activeWorldviewName}
      />
    {/if}
      </div>
    {/key}
  </div>

  {#if drawerMode === 'worldview'}
    <div class="drawer-backdrop">
      <button
        class="drawer-dismiss"
        type="button"
        aria-label="关闭抽屉"
        onclick={closeDrawer}
      ></button>
      <aside class="drawer-panel" aria-label="新增世界观抽屉">
        <div class="drawer-header">
          <div>
            <p class="section-label">世界观管理</p>
            <h3>新增世界观</h3>
          </div>
          <button class="toolbar-action" type="button" onclick={closeDrawer}>关闭</button>
        </div>

        <div class="drawer-body">
          <form
            class="drawer-form"
            onsubmit={(event) => {
              event.preventDefault()
              saveWorldviewDraft()
            }}
          >
            <label class="drawer-field">
              <span>世界观名称</span>
              <input bind:value={draftWorldviewName} maxlength="40" type="text" />
            </label>

            <label class="drawer-field">
              <span>简介</span>
              <textarea bind:value={draftWorldviewDescription} rows="4"></textarea>
            </label>

            <label class="drawer-field">
              <span>标签</span>
              <textarea
                bind:value={draftWorldviewTagsText}
                placeholder="#主线，#地点，#主题"
                rows="3"
              ></textarea>
            </label>

            <label class="drawer-field">
              <span>配图地址</span>
              <input
                bind:value={draftWorldviewCoverImage}
                placeholder="/background.jpg"
                type="text"
              />
            </label>

            <p class="drawer-hint">新增后会立即出现在顶部世界观下拉菜单，并同步用于时间轴与年龄编年页面。</p>

            <div class="drawer-footer">
              <button class="toolbar-action" type="button" onclick={closeDrawer}>
                取消
              </button>
              <button class="toolbar-action toolbar-primary" type="submit">保存世界观</button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  {/if}
</main>

{#if activePage === 'chat-room'}
  <button
    aria-label="返回首页"
    class="fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white/96 shadow-[0_14px_34px_rgba(15,23,42,0.12)] backdrop-blur transition hover:border-slate-300 hover:bg-white md:left-[18px] md:top-[18px]"
    type="button"
    onclick={() => navigateToPage('home')}
  >
    <img alt="" aria-hidden="true" class="h-5 w-5 object-contain" src="/home.svg" />
  </button>
{/if}
