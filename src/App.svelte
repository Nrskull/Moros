<script lang="ts">
  import { onMount } from 'svelte'
  import { spring } from 'svelte/motion'
  import { fade, fly } from 'svelte/transition'
  import {
    worldviewContents,
    getWorldviewContent,
    type WorldviewContent,
  } from './content/worldviews'
  import AgeChroniclePage from './lib/AgeChroniclePage.svelte'
  import AdminCharacterPage from './lib/AdminCharacterPage.svelte'
  import CharacterSheetPage from './lib/CharacterSheetPage.svelte'
  import ChatRoomPage from './lib/ChatRoomPage.svelte'
  import EventDetailPage from './lib/EventDetailPage.svelte'
  import HomePage from './lib/HomePage.svelte'
  import LogWorkbenchPage from './lib/LogWorkbenchPage.svelte'
  import TimelineAxis from './lib/TimelineAxis.svelte'
  import TimelineEventCard from './lib/TimelineEventCard.svelte'
  import ToolsOverviewPage from './lib/ToolsOverviewPage.svelte'
  import VerticalTimelinePage from './lib/VerticalTimelinePage.svelte'
  import WorldviewAdminPage from './lib/WorldviewAdminPage.svelte'
  import WorldviewHero from './lib/WorldviewHero.svelte'
  import { mockEvents } from './lib/mock-events'
  import { seaFogIn, seaFogOut } from './lib/transitions'
  import { confirmDialog, alertDialog } from './lib/dialog'
  import {
    buildChatHttpUrl,
    CHAT_STORAGE_ROOM_KEY,
    CHAT_STORAGE_SESSION_KEY,
    type ChatUser,
  } from './lib/chat-room'
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
  type DrawerMode = 'none' | 'event' | 'manage'
  type EventEditorMode = 'create' | 'edit'
  type EventDragMode = 'move' | 'resize-end'
  type AgreementLineKind = 'article' | 'body' | 'chapter' | 'meta'
  type NavigationItemId = 'chat-room' | 'home' | 'log-workbench' | 'tools-overview' | 'vertical-timeline'
  type TimelineMode = 'view' | 'edit'
  type ThemeMode = 'light' | 'dark'
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

  interface ChatAuthResponse {
    authenticated?: boolean
    currentUser?: ChatUser
    message?: string
    ok: boolean
  }

  interface ManagedWorldview extends WorldviewContent {
    createdAt: number
    createdByUserId: string | null
    id: string
    updatedAt: number
  }

  interface WorldviewListResponse {
    message?: string
    ok: boolean
    previousName?: string
    worldview?: ManagedWorldview | null
    worldviews?: ManagedWorldview[]
  }

  interface NavigationItem {
    icon: string
    id: NavigationItemId
    label: string
    page: AppPage
  }

  interface ChatMobileMenuItem {
    action: () => Promise<void> | void
    current?: boolean
    disabled?: boolean
    icon: string
    id: string
    label: string
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
  const THEME_MODE_STORAGE_KEY = 'morosonder-theme-mode'
  const USER_AGREEMENT_STORAGE_KEY = 'morosonder-user-agreement-accepted'
  const USER_AGREEMENT_PATH = '/userAgreement.md'
  const DARK_WORLDVIEW_THEME_STYLE = [
    '--theme-surface-start:#101824',
    '--theme-surface-end:#0c111a',
    '--theme-glow:rgba(83, 111, 145, 0.24)',
    '--theme-glow-soft:rgba(31, 42, 58, 0.32)',
  ].join('; ')
  const FIXED_LAYOUT_SURFACE_PADDING = 64
  const TRACK_LEADING_GUTTER = 132
  const defaultTrackPalette = ['#d9e0e6', '#c8dce6', '#d5cae6', '#d1e3d3', '#e1d8e6', '#dde3e8']
  const defaultTrackLabels = ['公共线1', '公共线2', '其它线1', 'ho404线']
  const navigationItems: NavigationItem[] = [
    { icon: '/home.svg', id: 'home', label: '首页', page: 'home' },
    { icon: '/timeline.svg', id: 'vertical-timeline', label: '时间线', page: 'vertical-timeline' },
    { icon: '/plugs.svg', id: 'tools-overview', label: '工具总览', page: 'tools-overview' },
    { icon: '/log.svg', id: 'log-workbench', label: '日志展示', page: 'log-workbench' },
    { icon: '/chat.svg', id: 'chat-room', label: '群聊', page: 'chat-room' },
  ]
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
  let manageMenuElement: HTMLDivElement | null = null
  let mobileMoreNavElement: HTMLDivElement | null = null
  let worldviewMenuElement: HTMLDivElement | null = null
  let tagFilterContainerElement: HTMLDivElement | null = null

  let timelineTracks: TimelineTrack[] = initialTimelineState.tracks
  let timelineEvents: EditableTimelineEvent[] = initialTimelineState.events
  let managedWorldviews: ManagedWorldview[] = []
  let selectedWorldview = timelineEvents[0]?.worldview ?? ''
  let isManageMenuOpen = false
  let isMobileMoreNavOpen = false
  let isWorldviewMenuOpen = false
  let isTagFilterOpen = false
  let zoomLevel = 1
  let activePage: AppPage = 'home'
  let detailEventId = ''
  let routeWorldviewName: string | null = selectedWorldview || null
  let hasMountedRouter = false
  let chatAuthUser: ChatUser | null = null
  let isChatAuthChecking = true
  let isChatLogoutPending = false
  let accessKeyDraft = ''
  let accessKeyError = ''
  let isAccessKeySubmitting = false
  let hasAcceptedUserAgreement = false
  let isUserAgreementLoading = true
  let userAgreementError = ''
  let userAgreementSignature = ''
  let userAgreementText = ''
  let chatLogoutSerial = 0
  let chatMobileMenuItems: ChatMobileMenuItem[] = []
  let timelineMode: TimelineMode = 'view'
  let themeMode: ThemeMode = 'light'
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
    isManageMenuOpen = false
    isMobileMoreNavOpen = false
    isWorldviewMenuOpen = !isWorldviewMenuOpen
  }

  function isCompactViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches
  }

  function toggleManageMenu(): void {
    isWorldviewMenuOpen = false
    isMobileMoreNavOpen = false
    isManageMenuOpen = !isManageMenuOpen
  }

  function openManagePanel(): void {
    if (isCompactViewport()) {
      isManageMenuOpen = false
      isWorldviewMenuOpen = false
      isMobileMoreNavOpen = false
      drawerMode = 'manage'
      editingEventId = ''
      return
    }

    toggleManageMenu()
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

  function openCreateEvent(): void {
    eventEditorMode = 'create'
    editingEventId = ''
    resetDraft()
    drawerMode = 'event'
  }

  function openWorldviewManager(): void {
    isWorldviewMenuOpen = false
    isManageMenuOpen = false
    drawerMode = 'none'
    editingEventId = ''
    navigateToPage('admin-worldview')
  }

  function closeDrawer(): void {
    drawerMode = 'none'
    editingEventId = ''
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

    if (isManageMenuOpen || isWorldviewMenuOpen || isMobileMoreNavOpen || isTagFilterOpen) {
      isManageMenuOpen = false
      isWorldviewMenuOpen = false
      isMobileMoreNavOpen = false
      isTagFilterOpen = false
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

    if (isManageMenuOpen && manageMenuElement && !manageMenuElement.contains(target)) {
      isManageMenuOpen = false
    }

    if (isTagFilterOpen && tagFilterContainerElement && !tagFilterContainerElement.contains(target)) {
      isTagFilterOpen = false
    }

    if (isMobileMoreNavOpen && mobileMoreNavElement && !mobileMoreNavElement.contains(target)) {
      isMobileMoreNavOpen = false
    }
  }

  async function requestChatAuth(pathname: string, init?: RequestInit): Promise<ChatAuthResponse> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: ChatAuthResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as ChatAuthResponse
    } catch {
      payload = {
        message: '群聊认证服务返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
    }
  }

  async function requestWorldviewApi(pathname: string, init?: RequestInit): Promise<WorldviewListResponse> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: WorldviewListResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as WorldviewListResponse
    } catch {
      payload = {
        message: '世界观服务返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
    }
  }

  async function loadManagedWorldviews(): Promise<void> {
    try {
      const payload = await requestWorldviewApi('/worldviews', { method: 'GET' })

      if (!payload.ok) {
        return
      }

      managedWorldviews = [...(payload.worldviews ?? [])]
    } catch {}
  }

  async function handleWorldviewSaved(payload: WorldviewListResponse): Promise<void> {
    if (!payload.worldview) {
      await loadManagedWorldviews()
      return
    }

    const savedWorldview = payload.worldview
    const previousName = payload.previousName ?? ''
    const existedBeforeSave = managedWorldviews.some((entry) => entry.id === savedWorldview.id)

    managedWorldviews = existedBeforeSave
      ? managedWorldviews.map((entry) => (entry.id === savedWorldview.id ? savedWorldview : entry))
      : [savedWorldview, ...managedWorldviews]
    managedWorldviews = [...managedWorldviews].sort((left, right) =>
      right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, 'zh-CN'))

    if (previousName !== '' && previousName !== savedWorldview.name) {
      timelineEvents = timelineEvents.map((event) =>
        event.worldview === previousName
          ? {
              ...event,
              worldview: savedWorldview.name,
            }
          : event,
      )

      if (selectedWorldview === previousName) {
        selectedWorldview = savedWorldview.name
      }

      if (routeWorldviewName === previousName) {
        routeWorldviewName = savedWorldview.name
      }

      if (draftWorldview === previousName) {
        draftWorldview = savedWorldview.name
      }
    } else if (!existedBeforeSave) {
      selectedWorldview = savedWorldview.name
      routeWorldviewName = savedWorldview.name
    }

    await loadManagedWorldviews()
  }

  async function restoreGlobalChatAuth(): Promise<void> {
    isChatAuthChecking = true

    try {
      const payload = await requestChatAuth('/auth/me', { method: 'GET' })
      chatAuthUser = payload.ok && payload.authenticated === true && payload.currentUser ? payload.currentUser : null

      if (chatAuthUser) {
        accessKeyError = ''
      }
    } catch {
      chatAuthUser = null
    } finally {
      isChatAuthChecking = false
    }
  }

  function createUserAgreementSignature(text: string): string {
    let hash = 0

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) | 0
    }

    return `${text.length}:${(hash >>> 0).toString(36)}`
  }

  function getAgreementLineKind(line: string): AgreementLineKind {
    const text = line.trim()

    if (/^第.+章/u.test(text)) {
      return 'chapter'
    }

    if (/^第.+条/u.test(text)) {
      return 'article'
    }

    if (/^(协议编号|生效日期)：/u.test(text)) {
      return 'meta'
    }

    return 'body'
  }

  function restoreUserAgreementState(signature = userAgreementSignature): void {
    if (signature === '' || typeof localStorage === 'undefined') {
      hasAcceptedUserAgreement = false
      return
    }

    hasAcceptedUserAgreement = localStorage.getItem(USER_AGREEMENT_STORAGE_KEY) === signature
  }

  function acceptUserAgreement(): void {
    if (userAgreementSignature === '') {
      return
    }

    hasAcceptedUserAgreement = true

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(USER_AGREEMENT_STORAGE_KEY, userAgreementSignature)
    }
  }

  async function loadUserAgreement(): Promise<void> {
    isUserAgreementLoading = true
    userAgreementError = ''

    try {
      const response = await fetch(USER_AGREEMENT_PATH, { cache: 'no-cache' })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const text = (await response.text()).trim()
      userAgreementText = text
      userAgreementSignature = createUserAgreementSignature(text)
      restoreUserAgreementState(userAgreementSignature)
    } catch {
      userAgreementText = ''
      userAgreementSignature = ''
      hasAcceptedUserAgreement = false
      userAgreementError = '用户协议加载失败，请刷新后重试。'
    } finally {
      isUserAgreementLoading = false
    }
  }

  async function handleAccessGateSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()

    const safeAccessKey = accessKeyDraft.trim()

    if (safeAccessKey === '') {
      accessKeyError = '请输入访问密钥。'
      return
    }

    isAccessKeySubmitting = true
    accessKeyError = ''

    try {
      const payload = await requestChatAuth('/auth/access-key', {
        body: JSON.stringify({ accessKey: safeAccessKey }),
        method: 'POST',
      })

      if (!payload.ok || !payload.currentUser) {
        accessKeyError = payload.message ?? '访问密钥验证失败。'
        return
      }

      chatAuthUser = payload.currentUser
      isChatAuthChecking = false
      accessKeyDraft = ''
      accessKeyError = ''
      await loadManagedWorldviews()
    } catch {
      accessKeyError = '访问密钥验证失败，请确认服务已启动。'
    } finally {
      isAccessKeySubmitting = false
    }
  }

  function clearStoredChatIdentity(): void {
    localStorage.removeItem(CHAT_STORAGE_SESSION_KEY)
    localStorage.removeItem(CHAT_STORAGE_ROOM_KEY)
  }

  function toggleMobileMoreNav(): void {
    isMobileMoreNavOpen = !isMobileMoreNavOpen
    isManageMenuOpen = false
    isWorldviewMenuOpen = false
  }

  function isThemeMode(value: string | null): value is ThemeMode {
    return value === 'light' || value === 'dark'
  }

  function syncDocumentThemeMode(mode: ThemeMode): void {
    if (typeof document === 'undefined') {
      return
    }

    document.documentElement.dataset.theme = mode
  }

  function restoreThemeMode(): void {
    if (typeof localStorage === 'undefined') {
      syncDocumentThemeMode(themeMode)
      return
    }

    const storedThemeMode = localStorage.getItem(THEME_MODE_STORAGE_KEY)
    themeMode = isThemeMode(storedThemeMode) ? storedThemeMode : 'light'
    syncDocumentThemeMode(themeMode)
  }

  function toggleThemeMode(): void {
    themeMode = themeMode === 'dark' ? 'light' : 'dark'
    syncDocumentThemeMode(themeMode)

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode)
    }
  }

  function applyThemeModeToWorldviewStyle(style: string): string {
    return themeMode === 'dark' ? `${style}; ${DARK_WORLDVIEW_THEME_STYLE}` : style
  }

  function handleChatAuthStateChange(nextUser: ChatUser | null): void {
    chatAuthUser = nextUser
    isChatAuthChecking = false

    if (nextUser) {
      accessKeyError = ''
    }
  }

  function getManagedWorldview(name: string): ManagedWorldview | undefined {
    return managedWorldviews.find((entry) => entry.name === name)
  }

  function getNavigationActiveId(page: AppPage): NavigationItemId {
    if (page === 'event-detail') {
      return 'vertical-timeline'
    }

    if (page === 'admin-character' || page === 'admin-worldview') {
      return 'chat-room'
    }

    if (page === 'age-chronicle' || page === 'character-sheet') {
      return 'tools-overview'
    }

    if (page === 'timeline') {
      return 'vertical-timeline'
    }

    if (
      page === 'home' ||
      page === 'vertical-timeline' ||
      page === 'tools-overview' ||
      page === 'log-workbench' ||
      page === 'chat-room'
    ) {
      return page
    }

    return 'home'
  }

  async function handleChatLogout(): Promise<void> {
    if (!chatAuthUser || isChatAuthChecking || isChatLogoutPending) {
      return
    }

    isManageMenuOpen = false
    isMobileMoreNavOpen = false
    isWorldviewMenuOpen = false
    if (drawerMode === 'manage') {
      closeDrawer()
    }
    isChatLogoutPending = true

    try {
      const payload = await requestChatAuth('/auth/logout', { method: 'POST' })

      if (!payload.ok) {
        await alertDialog(payload.message ?? '登出失败，请稍后重试。')
        return
      }

      chatAuthUser = null
      clearStoredChatIdentity()
      chatLogoutSerial += 1
      navigateToPage('chat-room')
    } catch {
      await alertDialog('登出失败，请确认聊天服务已启动。')
    } finally {
      isChatLogoutPending = false
    }
  }

  function resolveWorldviewContent(name: string): WorldviewContent {
    const storedWorldview = getManagedWorldview(name)
    const fallback = getWorldviewContent(name)

    if (!storedWorldview) {
      return fallback
    }

    return {
      ...fallback,
      coverImage: storedWorldview.coverImage || fallback.coverImage,
      description: storedWorldview.description || fallback.description,
      name: storedWorldview.name,
      tags: storedWorldview.tags.length > 0 ? storedWorldview.tags : fallback.tags,
    }
  }

  function resolveWorldviewTheme(name: string): WorldviewTheme {
    const baseTheme = getWorldviewTheme(name)
    const customWorldview = getManagedWorldview(name)

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

  function pageUsesWorldview(page: AppPage): boolean {
    return !['home', 'chat-room', 'admin-character', 'admin-worldview', 'tools-overview', 'character-sheet'].includes(
      normaliseVisiblePage(page),
    )
  }

  function getRouteWorldviewName(targetPage: AppPage = activePage): string | null {
    if (!pageUsesWorldview(targetPage)) {
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
    isManageMenuOpen = false
    isMobileMoreNavOpen = false
    isWorldviewMenuOpen = false

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

  $: configuredWorldviewNames = managedWorldviews.length > 0
    ? managedWorldviews.map((entry) => entry.name)
    : worldviewContents.map((entry) => entry.name)
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
  $: themeStyle = applyThemeModeToWorldviewStyle(createWorldviewThemeStyle(currentWorldviewTheme))
  $: themeToggleLabel = themeMode === 'dark' ? '切换日间模式' : '切换夜间模式'
  $: themeToggleIcon = themeMode === 'dark' ? '/day.svg' : '/night.svg'
  $: userAgreementLines = userAgreementText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => ({
      kind: getAgreementLineKind(line),
      text: line,
    }))
  $: chatMobileMenuItems = [
    ...navigationItems.map((item) => ({
      action: () => navigateToPage(item.page),
      current: getNavigationActiveId(activePage) === item.id,
      icon: item.icon,
      id: item.id,
      label: item.label,
    })),
    {
      action: toggleThemeMode,
      current: themeMode === 'dark',
      icon: themeToggleIcon,
      id: 'theme-mode',
      label: themeToggleLabel,
    },
    ...(chatAuthUser?.role === 'admin'
      ? [{
          action: openManagePanel,
          icon: '/manage.svg',
          id: 'manage',
          label: '管理',
        }]
      : []),
    {
      action: handleChatLogout,
      disabled: !chatAuthUser || isChatAuthChecking || isChatLogoutPending,
      icon: '/logout.svg',
      id: 'logout',
      label: chatAuthUser ? '登出' : '未登录群聊',
    },
  ]
  $: logWorldviewCards = worldviewOptions.map((worldview) => {
    const worldviewContent = resolveWorldviewContent(worldview)
    const worldviewTheme = resolveWorldviewTheme(worldview)

    return {
      description: worldviewContent.description,
      hasCover: worldviewTheme.coverImage !== '',
      name: worldview,
      tags: worldviewContent.tags,
      themeStyle: applyThemeModeToWorldviewStyle(createWorldviewThemeStyle(worldviewTheme)),
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
    pageUsesWorldview(activePage) &&
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
    isMobileMoreNavOpen = false
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
    restoreThemeMode()
    void loadUserAgreement()
    syncRouteWithLocation(true)
    hasMountedRouter = true
    void loadManagedWorldviews()
    void restoreGlobalChatAuth()
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
  class="shell"
  class:is-chat-room={activePage === 'chat-room'}
  class:is-access-gated={isChatAuthChecking || !chatAuthUser || !hasAcceptedUserAgreement}
  class:is-home={activePage === 'home'}
  style={themeStyle}
>
  {#if isChatAuthChecking}
    <section class="access-gate" aria-live="polite">
      <div class="access-gate-panel">
        <p class="section-label">访问校验</p>
        <h1>正在确认登录状态</h1>
      </div>
    </section>
  {:else if !chatAuthUser}
    <section class="access-gate" aria-label="密钥登录">
      <form class="access-gate-panel" onsubmit={handleAccessGateSubmit}>
        <div class="access-gate-copy">
          <p class="section-label">访问密钥</p>
          <h1>请输入访问密钥</h1>
        </div>

        <label class="access-gate-field">
          <span>密钥</span>
          <input
            bind:value={accessKeyDraft}
            autocomplete="current-password"
            disabled={isAccessKeySubmitting}
            placeholder="访问密钥"
            type="password"
          />
        </label>

        {#if accessKeyError !== ''}
          <div class="access-gate-error">{accessKeyError}</div>
        {/if}

        <button class="access-gate-action" disabled={isAccessKeySubmitting} type="submit">
          {isAccessKeySubmitting ? '正在验证' : '进入网站'}
        </button>
      </form>
    </section>
  {:else if !hasAcceptedUserAgreement}
    <section class="access-gate" aria-label="用户协议">
      <div class="access-gate-panel agreement-panel">
        <div class="access-gate-copy">
          <p class="section-label">用户协议</p>
          <h1>用户协议</h1>
        </div>

        <div class="agreement-content" aria-label="用户协议内容"></div>

        <button class="access-gate-action" type="button" onclick={acceptUserAgreement}>
          同意并进入
        </button>
      </div>
    </section>
  {:else}
  <nav class="side-nav" aria-label="页面切换">
    <div class="side-nav-group">
      {#each navigationItems as item (item.id)}
        <button
          aria-label={item.label}
          class:is-current={getNavigationActiveId(activePage) === item.id}
          class="side-nav-button"
          data-nav-id={item.id}
          title={item.label}
          type="button"
          onclick={() => navigateToPage(item.page)}
        >
          <img alt="" aria-hidden="true" class={`side-nav-icon side-nav-icon-${item.id}`} src={item.icon} />
        </button>
      {/each}
    </div>

    <div class="side-nav-separator" aria-hidden="true"></div>

    <div bind:this={mobileMoreNavElement} class="mobile-more-nav">
      <button
        aria-expanded={isMobileMoreNavOpen}
        aria-label="更多"
        class="side-nav-button side-nav-button-more"
        data-nav-id="more"
        title="更多"
        type="button"
        onclick={toggleMobileMoreNav}
      >
        <img alt="" aria-hidden="true" class="side-nav-icon side-nav-icon-more" src="/more.svg" />
      </button>

      {#if isMobileMoreNavOpen}
        <div class="mobile-more-menu">
          <button
            class="mobile-more-item"
            disabled={!chatAuthUser || isChatAuthChecking || isChatLogoutPending}
            type="button"
            onclick={handleChatLogout}
          >
            <img alt="" aria-hidden="true" src="/logout.svg" />
            <span>{chatAuthUser ? '登出' : '未登录群聊'}</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="side-nav-separator" aria-hidden="true"></div>

    <div bind:this={worldviewMenuElement} class="side-nav-worldview worldview-dropdown">
      <button
        aria-expanded={isWorldviewMenuOpen}
        aria-label="切换世界观"
        class="side-nav-button side-nav-button-worldview"
        data-nav-id="worldview"
        disabled={!pageUsesWorldview(activePage)}
        title={pageUsesWorldview(activePage) ? '切换世界观' : '当前页面不需要切换世界观'}
        type="button"
        onclick={toggleWorldviewMenu}
      >
        <img alt="" aria-hidden="true" class="side-nav-icon side-nav-icon-worldview" src="/switch.svg" />
      </button>

      {#if isWorldviewMenuOpen && pageUsesWorldview(activePage)}
        <div
          class="worldview-dropdown-menu side-nav-worldview-menu"
          in:fade={{ delay: 0, duration: 160 }}
          out:fade={{ duration: 120 }}
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
        </div>
      {/if}
    </div>

    {#if chatAuthUser?.role === 'admin'}
      <div class="side-nav-separator" aria-hidden="true"></div>

      <div bind:this={manageMenuElement} class="side-nav-manage worldview-dropdown">
        <button
          aria-expanded={isManageMenuOpen}
          aria-label="管理入口"
          class="side-nav-button side-nav-button-manage"
          data-nav-id="manage"
          title="管理"
          type="button"
          onclick={openManagePanel}
        >
          <img alt="" aria-hidden="true" class="side-nav-icon side-nav-icon-manage" src="/manage.svg" />
        </button>

        {#if isManageMenuOpen}
          <div
            class="worldview-dropdown-menu side-nav-manage-menu"
            in:fade={{ delay: 0, duration: 160 }}
            out:fade={{ duration: 120 }}
          >
            <button class="worldview-dropdown-item" type="button" onclick={() => navigateToPage('admin-character')}>
              <strong>角色后台</strong>
              <span>统一进入角色卡后台，不再从群聊侧栏分散进入。</span>
            </button>
            <button class="worldview-dropdown-item" type="button" onclick={openWorldviewManager}>
              <strong>世界观管理</strong>
              <span>新建世界观，或对已有世界观执行重命名与元数据维护。</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <div class="side-nav-separator" aria-hidden="true"></div>

    <button
      aria-label={themeToggleLabel}
      class:theme-is-dark={themeMode === 'dark'}
      class="side-nav-button side-nav-button-theme"
      data-nav-id="theme-mode"
      title={themeToggleLabel}
      type="button"
      onclick={toggleThemeMode}
    >
      <img alt="" aria-hidden="true" class="side-nav-icon side-nav-icon-theme" src={themeToggleIcon} />
    </button>

    <div class="side-nav-separator" aria-hidden="true"></div>

    <button
      aria-label="退出群聊登录"
      class="side-nav-button side-nav-button-logout"
      data-nav-id="logout"
      disabled={!chatAuthUser || isChatAuthChecking || isChatLogoutPending}
      title={chatAuthUser ? '登出' : '当前未登录群聊'}
      type="button"
      onclick={handleChatLogout}
    >
      <img alt="" aria-hidden="true" class="side-nav-icon side-nav-icon-logout" src="/logout.svg" />
    </button>
  </nav>

<div
  class={`page-scene-stack min-w-0 ${activePage === 'chat-room' ? '!h-full !w-full' : ''}`}
  class:is-chat-room={activePage === 'chat-room'}
  class:is-home={activePage === 'home'}
  style="display: grid; grid-template-columns: 100%; grid-template-rows: 100%; flex: 1; min-height: 0;"
>
  {#key activePage}
    {@const isThisPageHome = activePage === 'home'}
    
    <div
      class={`page-scene min-w-0 ${
        activePage === 'chat-room'
          ? '!m-0 !flex !h-full !w-full !max-w-none !flex-1 !min-h-0 !overflow-hidden !p-0'
          : 'overflow-x-hidden'
      }`}
      /* 2. 把 is-home 类绑定到快照变量上 */
      class:is-home={isThisPageHome} 
      style="grid-area: 1 / 1 / 2 / 2;"
      in:fly={{ y: 24, duration: 400, delay: 150 }}
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
    {:else if activePage === 'tools-overview'}
      <ToolsOverviewPage
        onOpenAgeChronicle={() => navigateToPage('age-chronicle')}
        onOpenCharacterSheet={() => navigateToPage('character-sheet')}
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
    {:else if activePage === 'character-sheet'}
      <CharacterSheetPage onBack={() => navigateToPage('tools-overview')} />
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
    {:else if activePage === 'admin-worldview'}
      <WorldviewAdminPage
        managedWorldviews={managedWorldviews}
        onRefresh={loadManagedWorldviews}
        onSaved={handleWorldviewSaved}
      />
    {:else if activePage === 'chat-room'}
      <ChatRoomPage
        authResetKey={chatLogoutSerial}
        mobileMenuItems={chatMobileMenuItems}
        onAuthStateChange={handleChatAuthStateChange}
        worldviewOptions={worldviewOptions}
      />
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

  {#if drawerMode === 'manage'}
    <div class="drawer-backdrop">
      <button
        class="drawer-dismiss"
        type="button"
        aria-label="关闭抽屉"
        onclick={closeDrawer}
      ></button>
      <aside class="drawer-panel" aria-label="管理入口抽屉">
        <div class="drawer-header">
          <div>
            <p class="section-label">管理入口</p>
            <h3>后台功能</h3>
          </div>
          <button class="toolbar-action" type="button" onclick={closeDrawer}>关闭</button>
        </div>

        <div class="drawer-body">
          <div class="drawer-form">
            <button
              class="worldview-dropdown-item"
              type="button"
              onclick={() => {
                closeDrawer()
                navigateToPage('admin-character')
              }}
            >
              <strong>角色后台</strong>
              <span>查看、筛选和维护全部角色卡。</span>
            </button>
            <button class="worldview-dropdown-item" type="button" onclick={openWorldviewManager}>
              <strong>世界观管理</strong>
              <span>新建世界观，或重命名已有世界观并同步数据库引用。</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  {/if}

  {/if}

  <footer class="site-record-footer">ICP备2026017057号-1</footer>
</main>
