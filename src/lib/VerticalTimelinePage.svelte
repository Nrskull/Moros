<script lang="ts">
  import { onMount } from 'svelte'
  import EventDetailPage from './EventDetailPage.svelte'
  import VerticalTimeline from './VerticalTimeline.svelte'
  import WorldviewHero from './WorldviewHero.svelte'
  import { confirmDialog } from './dialog'
  import { buildChatHttpUrl, type ChatUser } from './chat-room'
  import { createVerticalTimelineSampleState } from './vertical-timeline-sample'
  import {
    cloneVerticalTimelineState,
    createVerticalTimelineNodeOptionLabel,
    flattenVerticalTimelineNodes,
    getVerticalTimelineBubbleAtNode,
    setVerticalTimelineBubbleAtNode,
    syncVerticalTimelineYearsWithLanes,
    type VerticalTimelineBubble,
    type VerticalTimelineEventRecord,
    type VerticalTimelineLane,
    type VerticalTimelineNodeKind,
    type VerticalTimelineNodeRef,
    type VerticalTimelineState,
    type VerticalTimelineYearNode,
  } from './vertical-timeline'

  export let worldviewDescription = ''
  export let worldviewHasCover = true
  export let worldviewName = '未选择世界观'
  export let worldviewTags: string[] = []
  export let worldviewThemeStyle = ''
  export let worldviewTransitionKey = 'default'

  interface VerticalTimelineCapabilities {
    canCreateEvent: boolean
    canManageLanePermissions: boolean
    canManageLanes: boolean
    canManageStructure: boolean
  }

  interface VerticalTimelineViewerPermissions {
    editableEventIds: string[]
    editableNodeIds: string[]
    manageableLaneIds: string[]
  }

  interface VerticalTimelineLanePermission {
    laneId: string
    userIds: string[]
  }

  interface VerticalTimelineApiResponse {
    authenticated?: boolean
    capabilities?: Partial<VerticalTimelineCapabilities>
    currentUser?: ChatUser
    lanePermissions?: unknown
    manageableUsers?: unknown
    message?: string
    ok: boolean
    permissions?: Partial<VerticalTimelineViewerPermissions> | unknown
    state?: unknown
    updatedAt?: number
  }

  type VerticalTimelineDialogMode =
    | 'none'
    | 'create-node'
    | 'edit-node'
    | 'create-event'
    | 'edit-event'
    | 'create-lane'
    | 'edit-lane'
    | 'lane-permissions'

  interface VerticalTimelineDialogContext {
    eventId: string
    laneId: string
    nodeId: string
    nodeKind: VerticalTimelineNodeKind
  }

  const defaultLaneColor = '#64748b'

  let currentUser: ChatUser | null = null
  let capabilities = createEmptyCapabilities()
  let permissions = createEmptyViewerPermissions()
  let manageableUsers: ChatUser[] = []
  let lanePermissions: VerticalTimelineLanePermission[] = []
  let isStateLoading = true
  let isAuthChecking = false
  let isAuthPromptOpen = false
  let authError = ''
  let sharedSyncError = ''
  let accessKeyDraft = ''
  let loadedWorldviewName = ''
  let mutationTarget = ''

  let activeEventId = ''
  let detailEventId = ''
  let lanes: VerticalTimelineLane[] = []
  let years: VerticalTimelineYearNode[] = []
  let events: VerticalTimelineEventRecord[] = []

  let selectedNodeId = ''
  let selectedLaneId = ''
  let nodeDraftKind: VerticalTimelineNodeKind = 'year'
  let nodeDraftParentId = ''
  let nodeDraftLabel = ''
  let editingNodeLabel = ''

  let eventDraftTitle = ''
  let eventDraftSummary = ''
  let eventDraftBody = ''
  let eventDraftTagsText = ''
  let eventDraftImage = ''
  let editingEventId = ''

  let laneDraftName = ''
  let laneDraftColor = defaultLaneColor
  let editingLaneId = ''
  let editingLaneName = ''
  let editingLaneColor = defaultLaneColor
  let lanePermissionEditorId = ''

  let dialogMode: VerticalTimelineDialogMode = 'none'
  let dialogTargetId = ''
  let dialogInitialContext = createEmptyDialogContext()

  $: nodeOptions = flattenVerticalTimelineNodes(years)
  $: eventsById = Object.fromEntries(events.map((event) => [event.id, event]))
  $: detailEvent = detailEventId === '' ? null : (eventsById[detailEventId] ?? null)
  $: selectedNode = nodeOptions.find((node) => node.id === selectedNodeId) ?? null
  $: selectedLane = lanes.find((lane) => lane.id === selectedLaneId) ?? null
  $: editableEvent = editingEventId === '' ? null : (eventsById[editingEventId] ?? null)
  $: dialogNode = dialogTargetId === '' ? null : (nodeOptions.find((node) => node.id === dialogTargetId) ?? null)
  $: dialogLane = dialogTargetId === '' ? null : (lanes.find((lane) => lane.id === dialogTargetId) ?? null)
  $: dialogEvent = dialogTargetId === '' ? null : (eventsById[dialogTargetId] ?? null)
  $: manageableLanes = lanes.filter((lane) => permissions.manageableLaneIds.includes(lane.id))
  $: monthParentOptions = nodeOptions.filter((node) => node.kind === 'year')
  $: dayParentOptions = nodeOptions.filter((node) => node.kind === 'month')
  $: selectedLanePermissionUserIds =
    lanePermissionEditorId === ''
      ? []
      : lanePermissions.find((entry) => entry.laneId === lanePermissionEditorId)?.userIds ?? []
  $: canEditSelectedNode = selectedNodeId !== '' && permissions.editableNodeIds.includes(selectedNodeId)
  $: canDeleteSelectedNode = selectedNodeId !== '' && currentUser?.role === 'admin'
  $: canEditSelectedEvent =
    editingEventId !== '' && permissions.editableEventIds.includes(editingEventId)
  $: canSaveEvent =
    capabilities.canCreateEvent &&
    selectedNodeId !== '' &&
    selectedLaneId !== '' &&
    permissions.manageableLaneIds.includes(selectedLaneId)
  $: expansionResetKey = `${loadedWorldviewName}:${currentUser?.id ?? 'guest'}`
  $: viewerCapabilityLabel = capabilities.canManageLanes
    ? '管理员权限已启用'
    : currentUser
      ? '按角色授权编辑'
      : '未登录'
  $: if (detailEventId !== '' && !eventsById[detailEventId]) {
    detailEventId = ''
  }

  $: if (loadedWorldviewName !== '' && loadedWorldviewName !== worldviewName && !isStateLoading) {
    void loadVerticalTimelineState(worldviewName)
  }

  function createEmptyCapabilities(): VerticalTimelineCapabilities {
    return {
      canCreateEvent: false,
      canManageLanePermissions: false,
      canManageLanes: false,
      canManageStructure: false,
    }
  }

  function createEmptyViewerPermissions(): VerticalTimelineViewerPermissions {
    return {
      editableEventIds: [],
      editableNodeIds: [],
      manageableLaneIds: [],
    }
  }

  function createEmptyDialogContext(): VerticalTimelineDialogContext {
    return {
      eventId: '',
      laneId: '',
      nodeId: '',
      nodeKind: 'year',
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function sanitiseCapabilities(input: unknown): VerticalTimelineCapabilities {
    if (!isRecord(input)) {
      return createEmptyCapabilities()
    }

    return {
      canCreateEvent: input.canCreateEvent === true,
      canManageLanePermissions: input.canManageLanePermissions === true,
      canManageLanes: input.canManageLanes === true,
      canManageStructure: input.canManageStructure === true,
    }
  }

  function sanitiseViewerPermissions(
    input: unknown,
    nextLanes: VerticalTimelineLane[],
    nextEvents: VerticalTimelineEventRecord[],
    nextNodes: VerticalTimelineNodeRef[],
  ): VerticalTimelineViewerPermissions {
    if (!isRecord(input)) {
      return createEmptyViewerPermissions()
    }

    const laneIdSet = new Set(nextLanes.map((lane) => lane.id))
    const eventIdSet = new Set(nextEvents.map((event) => event.id))
    const nodeIdSet = new Set(nextNodes.map((node) => node.id))

    return {
      editableEventIds: Array.isArray(input.editableEventIds)
        ? input.editableEventIds.flatMap((value) =>
            typeof value === 'string' && eventIdSet.has(value) ? [value] : [],
          )
        : [],
      editableNodeIds: Array.isArray(input.editableNodeIds)
        ? input.editableNodeIds.flatMap((value) =>
            typeof value === 'string' && nodeIdSet.has(value) ? [value] : [],
          )
        : [],
      manageableLaneIds: Array.isArray(input.manageableLaneIds)
        ? input.manageableLaneIds.flatMap((value) =>
            typeof value === 'string' && laneIdSet.has(value) ? [value] : [],
          )
        : [],
    }
  }

  function sanitiseManageableUsers(input: unknown): ChatUser[] {
    if (!Array.isArray(input)) {
      return []
    }

    return input.flatMap((user) => {
      if (!isRecord(user)) {
        return []
      }

      const id = typeof user.id === 'string' ? user.id.trim() : ''
      const displayName = typeof user.displayName === 'string' ? user.displayName.trim() : ''
      const handle = typeof user.handle === 'string' ? user.handle.trim() : ''

      if (id === '' || displayName === '' || handle === '') {
        return []
      }

      return [
        {
          displayName,
          handle,
          id,
          role: typeof user.role === 'string' ? user.role : 'member',
          status: typeof user.status === 'string' ? user.status : 'active',
        },
      ]
    })
  }

  function sanitiseLanePermissions(
    input: unknown,
    nextLanes: VerticalTimelineLane[],
    nextUsers: ChatUser[],
  ): VerticalTimelineLanePermission[] {
    if (!Array.isArray(input)) {
      return []
    }

    const laneIdSet = new Set(nextLanes.map((lane) => lane.id))
    const userIdSet = new Set(nextUsers.map((user) => user.id))

    return input.flatMap((entry) => {
      if (!isRecord(entry)) {
        return []
      }

      const laneId = typeof entry.laneId === 'string' ? entry.laneId.trim() : ''

      if (laneId === '' || !laneIdSet.has(laneId)) {
        return []
      }

      return [
        {
          laneId,
          userIds: Array.isArray(entry.userIds)
            ? entry.userIds.flatMap((userId) =>
                typeof userId === 'string' && userIdSet.has(userId) ? [userId] : [],
              )
            : [],
        },
      ]
    })
  }

  function sanitiseColor(value: unknown, fallback = defaultLaneColor): string {
    const color = typeof value === 'string' ? value.trim() : ''
    return /^#[\da-f]{3,8}$/iu.test(color) ? color : fallback
  }

  function sanitiseState(input: unknown, targetWorldview = worldviewName): VerticalTimelineState | null {
    if (
      !isRecord(input) ||
      !Array.isArray(input.lanes) ||
      !Array.isArray(input.years) ||
      !Array.isArray(input.events)
    ) {
      return null
    }

    const nextLanes = input.lanes.flatMap((lane): VerticalTimelineLane[] => {
      if (!isRecord(lane)) {
        return []
      }

      const id = typeof lane.id === 'string' ? lane.id.trim() : ''
      const name = typeof lane.name === 'string' ? lane.name.trim() : ''

      if (id === '' || name === '') {
        return []
      }

      return [
        {
          color: sanitiseColor(lane.color),
          id,
          name,
        },
      ]
    })

    const sanitiseBubbleMap = (
      value: unknown,
    ): Record<string, VerticalTimelineBubble | null> =>
      Object.fromEntries(
        nextLanes.map((lane) => {
          const candidate = isRecord(value) ? value[lane.id] : null

          if (!isRecord(candidate)) {
            return [lane.id, null]
          }

          const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''

          if (id === '') {
            return [lane.id, null]
          }

          return [
            lane.id,
            {
              id,
              title:
                typeof candidate.title === 'string' && candidate.title.trim() !== ''
                  ? candidate.title.trim()
                  : '未命名事件',
            },
          ]
        }),
      )

    const nextYears = input.years.flatMap((year): VerticalTimelineYearNode[] => {
      if (!isRecord(year)) {
        return []
      }

      const yearId = typeof year.id === 'string' ? year.id.trim() : ''
      const yearLabel = typeof year.label === 'string' ? year.label.trim() : ''

      if (yearId === '' || yearLabel === '') {
        return []
      }

      const months = Array.isArray(year.months)
        ? year.months.flatMap((month) => {
            if (!isRecord(month)) {
              return []
            }

            const monthId = typeof month.id === 'string' ? month.id.trim() : ''
            const monthLabel = typeof month.label === 'string' ? month.label.trim() : ''

            if (monthId === '' || monthLabel === '') {
              return []
            }

            const days = Array.isArray(month.days)
              ? month.days.flatMap((day) => {
                  if (!isRecord(day)) {
                    return []
                  }

                  const dayId = typeof day.id === 'string' ? day.id.trim() : ''
                  const dayLabel = typeof day.label === 'string' ? day.label.trim() : ''

                  if (dayId === '' || dayLabel === '') {
                    return []
                  }

                  return [
                    {
                      bubblesByLane: sanitiseBubbleMap(day.bubblesByLane),
                      id: dayId,
                      label: dayLabel,
                    },
                  ]
                })
              : []

            return [
              {
                bubblesByLane: sanitiseBubbleMap(month.bubblesByLane),
                days,
                id: monthId,
                label: monthLabel,
              },
            ]
          })
        : []

      return [
        {
          bubblesByLane: sanitiseBubbleMap(year.bubblesByLane),
          id: yearId,
          label: yearLabel,
          months,
        },
      ]
    })

    const safeYears = syncVerticalTimelineYearsWithLanes(nextYears, nextLanes)
    const nodeIdSet = new Set(flattenVerticalTimelineNodes(safeYears).map((node) => node.id))
    const laneIdSet = new Set(nextLanes.map((lane) => lane.id))

    const nextEvents = input.events.flatMap((event): VerticalTimelineEventRecord[] => {
      if (!isRecord(event)) {
        return []
      }

      const id = typeof event.id === 'string' ? event.id.trim() : ''
      const nodeId = typeof event.nodeId === 'string' ? event.nodeId.trim() : ''
      const laneId = typeof event.laneId === 'string' ? event.laneId.trim() : ''
      const title = typeof event.title === 'string' ? event.title.trim() : ''

      if (id === '' || nodeId === '' || laneId === '' || title === '') {
        return []
      }

      if (!nodeIdSet.has(nodeId) || !laneIdSet.has(laneId)) {
        return []
      }

      return [
        {
          body: typeof event.body === 'string' ? event.body : '',
          detailHtml: typeof event.detailHtml === 'string' ? event.detailHtml : undefined,
          detailImage: typeof event.detailImage === 'string' ? event.detailImage : undefined,
          endTime: Number.isFinite(Number(event.endTime)) ? Number(event.endTime) : 0,
          id,
          laneId,
          nodeId,
          startTime: Number.isFinite(Number(event.startTime)) ? Number(event.startTime) : 0,
          summary: typeof event.summary === 'string' ? event.summary : '',
          tags: Array.isArray(event.tags)
            ? event.tags.flatMap((tag) =>
                typeof tag === 'string' && tag.trim() !== '' ? [tag.trim()] : [],
              )
            : [],
          title,
          worldview:
            typeof event.worldview === 'string' && event.worldview.trim() !== ''
              ? event.worldview.trim()
              : targetWorldview,
        },
      ]
    })

    const eventsById = new Map(nextEvents.map((event) => [event.id, event]))
    let syncedYears = safeYears

    for (const event of nextEvents) {
      const bubble = getVerticalTimelineBubbleAtNode(syncedYears, event.nodeId, event.laneId)

      if (!bubble || bubble.id === event.id) {
        syncedYears = setVerticalTimelineBubbleAtNode(syncedYears, event.nodeId, event.laneId, {
          id: event.id,
          title: event.title,
        })
      }
    }

    for (const node of flattenVerticalTimelineNodes(syncedYears)) {
      for (const lane of nextLanes) {
        const bubble = getVerticalTimelineBubbleAtNode(syncedYears, node.id, lane.id)

        if (!bubble) {
          continue
        }

        const sourceEvent = eventsById.get(bubble.id)

        if (!sourceEvent || sourceEvent.nodeId !== node.id || sourceEvent.laneId !== lane.id) {
          syncedYears = setVerticalTimelineBubbleAtNode(syncedYears, node.id, lane.id, null)
        }
      }
    }

    return {
      events: nextEvents,
      lanes: nextLanes,
      years: syncedYears,
    }
  }

  function createFallbackState(targetWorldview = worldviewName): VerticalTimelineState {
    return cloneVerticalTimelineState(createVerticalTimelineSampleState(targetWorldview))
  }

  function syncCurrentUserFromPayload(payload: VerticalTimelineApiResponse): void {
    if (payload.authenticated === true && payload.currentUser) {
      currentUser = payload.currentUser
      return
    }

    if (payload.authenticated === false) {
      currentUser = null
      capabilities = createEmptyCapabilities()
      permissions = createEmptyViewerPermissions()
    }
  }

  function resetNodeDraft(node: VerticalTimelineNodeRef | null = selectedNode): void {
    if (node?.kind === 'year') {
      nodeDraftKind = 'month'
      nodeDraftParentId = node.id
    } else if (node?.kind === 'month') {
      nodeDraftKind = 'day'
      nodeDraftParentId = node.id
    } else if (node?.kind === 'day' && node.parentMonthId) {
      nodeDraftKind = 'day'
      nodeDraftParentId = node.parentMonthId
    } else {
      nodeDraftKind = 'year'
      nodeDraftParentId = ''
    }

    nodeDraftLabel = ''
    editingNodeLabel = node?.label ?? ''
  }

  function resetEventDraft(): void {
    editingEventId = ''
    eventDraftTitle = ''
    eventDraftSummary = ''
    eventDraftBody = ''
    eventDraftTagsText = ''
    eventDraftImage = ''
  }

  function primeEventDraft(event: VerticalTimelineEventRecord): void {
    editingEventId = event.id
    selectedLaneId = event.laneId
    selectedNodeId = event.nodeId
    eventDraftTitle = event.title
    eventDraftSummary = event.summary
    eventDraftBody = event.body
    eventDraftTagsText = event.tags.join(', ')
    eventDraftImage = event.detailImage ?? ''
  }

  function resetLaneDraft(): void {
    laneDraftName = ''
    laneDraftColor = defaultLaneColor
  }

  function primeLaneDraft(laneId: string): void {
    const lane = lanes.find((entry) => entry.id === laneId)

    if (!lane) {
      editingLaneId = ''
      editingLaneName = ''
      editingLaneColor = defaultLaneColor
      return
    }

    editingLaneId = lane.id
    editingLaneName = lane.name
    editingLaneColor = lane.color
    lanePermissionEditorId = lane.id
  }

  function ensureLanePermissionEntry(laneId: string): void {
    if (laneId === '' || lanePermissions.some((entry) => entry.laneId === laneId)) {
      return
    }

    lanePermissions = [...lanePermissions, { laneId, userIds: [] }]
  }

  function closeDialog(): void {
    dialogMode = 'none'
    dialogTargetId = ''
    dialogInitialContext = createEmptyDialogContext()
  }

  function syncSelectionState(nextState: VerticalTimelineState): void {
    const nextNodeOptions = flattenVerticalTimelineNodes(nextState.years)
    const nextManageableLanes = nextState.lanes.filter((lane) =>
      permissions.manageableLaneIds.includes(lane.id),
    )

    if (!nextNodeOptions.some((node) => node.id === selectedNodeId)) {
      selectedNodeId = ''
    }

    if (!nextManageableLanes.some((lane) => lane.id === selectedLaneId)) {
      selectedLaneId = ''
    }

    if (editingEventId !== '') {
      const nextEditingEvent = nextState.events.find((event) => event.id === editingEventId) ?? null

      if (nextEditingEvent) {
        eventDraftTitle = nextEditingEvent.title
        eventDraftSummary = nextEditingEvent.summary
        eventDraftBody = nextEditingEvent.body
        eventDraftTagsText = nextEditingEvent.tags.join(', ')
        eventDraftImage = nextEditingEvent.detailImage ?? ''
      } else {
        resetEventDraft()
        if (dialogMode === 'edit-event') {
          closeDialog()
        }
      }
    }

    if (!nextState.lanes.some((lane) => lane.id === editingLaneId)) {
      editingLaneId = ''
      editingLaneName = ''
      editingLaneColor = defaultLaneColor
      if (dialogMode === 'edit-lane') {
        closeDialog()
      }
    }

    if (!nextState.lanes.some((lane) => lane.id === lanePermissionEditorId)) {
      lanePermissionEditorId = nextState.lanes[0]?.id ?? ''
      if (dialogMode === 'lane-permissions' && lanePermissionEditorId === '') {
        closeDialog()
      }
    }

    if (dialogMode === 'edit-node' && !nextNodeOptions.some((node) => node.id === dialogTargetId)) {
      closeDialog()
    }

    if (dialogMode === 'edit-node') {
      const node = nextNodeOptions.find((entry) => entry.id === dialogTargetId) ?? null
      editingNodeLabel = node?.label ?? editingNodeLabel
    }

    if (dialogMode === 'lane-permissions' && lanePermissionEditorId !== '') {
      ensureLanePermissionEntry(lanePermissionEditorId)
      dialogTargetId = lanePermissionEditorId
    }

    resetNodeDraft(nextNodeOptions.find((node) => node.id === selectedNodeId) ?? null)
  }

  function applyTimelineState(nextState: VerticalTimelineState, targetWorldview = worldviewName): void {
    lanes = nextState.lanes.map((lane) => ({ ...lane }))
    years = nextState.years.map((year) => ({
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
    }))
    events = nextState.events.map((event) => ({
      ...event,
      tags: [...event.tags],
    }))
    loadedWorldviewName = targetWorldview
    syncSelectionState(nextState)
  }

  function applyTimelineResponse(
    payload: VerticalTimelineApiResponse,
    targetWorldview = worldviewName,
  ): boolean {
    syncCurrentUserFromPayload(payload)
    const nextUsers = sanitiseManageableUsers(payload.manageableUsers)
    const nextState = sanitiseState(payload.state, targetWorldview)

    if (!nextState) {
      return false
    }

    const nextNodes = flattenVerticalTimelineNodes(nextState.years)
    manageableUsers = nextUsers
    capabilities = sanitiseCapabilities(payload.capabilities)
    permissions = sanitiseViewerPermissions(
      payload.permissions,
      nextState.lanes,
      nextState.events,
      nextNodes,
    )
    lanePermissions = sanitiseLanePermissions(payload.lanePermissions, nextState.lanes, nextUsers)
    applyTimelineState(nextState, targetWorldview)
    return true
  }

  async function requestTimelineApi(
    pathname: string,
    init?: RequestInit,
  ): Promise<{
    payload: VerticalTimelineApiResponse
    status: number
  }> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: VerticalTimelineApiResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as VerticalTimelineApiResponse
    } catch {
      payload = {
        message: '垂直时间轴服务返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      payload: {
        ...payload,
        ok: response.ok && payload.ok !== false,
      },
      status: response.status,
    }
  }

  function requestAuthPrompt(message = '共享垂直时间轴需要先输入访问密钥。'): void {
    authError = ''
    sharedSyncError = message
    isAuthPromptOpen = true
  }

  async function handleAccessKeySubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault()

    const accessKey = accessKeyDraft.trim()

    if (accessKey === '') {
      authError = '请输入访问密钥。'
      return
    }

    isAuthChecking = true
    authError = ''

    try {
      const { payload } = await requestTimelineApi('/auth/access-key', {
        body: JSON.stringify({ accessKey }),
        method: 'POST',
      })

      if (!payload.ok || !payload.currentUser) {
        authError = payload.message ?? '访问密钥验证失败。'
        return
      }

      currentUser = payload.currentUser
      accessKeyDraft = ''
      authError = ''
      isAuthPromptOpen = false
      await loadVerticalTimelineState(worldviewName)
    } catch {
      authError = '访问密钥验证失败，请确认聊天服务已启动。'
    } finally {
      isAuthChecking = false
    }
  }

  async function loadVerticalTimelineState(targetWorldview = worldviewName): Promise<void> {
    isStateLoading = true
    sharedSyncError = ''

    try {
      const requestUrl = `/vertical-timeline/state?worldview=${encodeURIComponent(targetWorldview)}`
      const { payload } = await requestTimelineApi(requestUrl, { method: 'GET' })

      if (payload.ok && applyTimelineResponse(payload, targetWorldview)) {
        return
      }

      capabilities = createEmptyCapabilities()
      permissions = createEmptyViewerPermissions()
      lanePermissions = []
      manageableUsers = []
      sharedSyncError = payload.message ?? '垂直时间轴服务暂时不可用，当前显示默认只读内容。'
      applyTimelineState(createFallbackState(targetWorldview), targetWorldview)
    } catch {
      capabilities = createEmptyCapabilities()
      permissions = createEmptyViewerPermissions()
      lanePermissions = []
      manageableUsers = []
      sharedSyncError = '垂直时间轴服务暂时不可用，当前显示默认只读内容。'
      applyTimelineState(createFallbackState(targetWorldview), targetWorldview)
    } finally {
      isStateLoading = false
    }
  }

  async function submitTimelineMutation(
    pathname: string,
    init: RequestInit,
    authPromptMessage: string,
    mutationKey: string,
  ): Promise<boolean> {
    mutationTarget = mutationKey
    sharedSyncError = ''

    try {
      const { payload, status } = await requestTimelineApi(pathname, init)

      if (payload.ok && applyTimelineResponse(payload, worldviewName)) {
        return true
      }

      if (status === 401) {
        currentUser = null
        capabilities = createEmptyCapabilities()
        permissions = createEmptyViewerPermissions()
        requestAuthPrompt(payload.message ?? authPromptMessage)
        return false
      }

      sharedSyncError = payload.message ?? '保存失败，请稍后再试。'
      return false
    } catch {
      sharedSyncError = '共享垂直时间轴服务暂时不可用，请稍后再试。'
      return false
    } finally {
      mutationTarget = ''
    }
  }

  function serialiseTags(text: string): string[] {
    return text
      .split(/[\n,，]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
  }

  function formatNodeLabel(node: VerticalTimelineNodeRef | null): string {
    return node ? createVerticalTimelineNodeOptionLabel(node) : '未选择'
  }

  function openEventDetail(eventId: string): void {
    if (!eventsById[eventId]) {
      return
    }

    closeDialog()
    activeEventId = eventId
    detailEventId = eventId
  }

  function closeEventDetail(): void {
    detailEventId = ''
  }

  async function saveDetailDraft(draft: {
    bodyHtml: string
    bodyText: string
    detailImage?: string
    summary: string
    tags: string[]
    title: string
  }): Promise<void> {
    if (detailEventId === '') {
      return
    }

    await submitTimelineMutation(
      `/vertical-timeline/events/${encodeURIComponent(detailEventId)}`,
      {
        body: JSON.stringify({
          body: draft.bodyText,
          detailHtml: draft.bodyHtml,
          detailImage: draft.detailImage ?? '',
          summary: draft.summary,
          tags: draft.tags,
          title: draft.title,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '编辑事件详情需要先输入访问密钥。',
      `event:detail:${detailEventId}`,
    )
  }

  async function deleteEvent(eventId: string): Promise<void> {
    if (!eventsById[eventId] || !(await confirmDialog('确认删除这个事件吗？'))) {
      return
    }

    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/events/${encodeURIComponent(eventId)}`,
      {
        body: JSON.stringify({
          delete: true,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '删除事件需要先输入访问密钥。',
      `event:delete:${eventId}`,
    )

    if (!succeeded) {
      return
    }

    if (detailEventId === eventId) {
      detailEventId = ''
    }

    if (activeEventId === eventId) {
      activeEventId = ''
    }

    if (dialogMode === 'edit-event' && dialogTargetId === eventId) {
      closeDialog()
    }
  }

  function openCreateNodeDialog(baseNodeId = selectedNodeId): void {
    if (!capabilities.canManageStructure) {
      requestAuthPrompt('创建时间点需要先输入访问密钥。')
      return
    }

    const baseNode = nodeOptions.find((node) => node.id === baseNodeId) ?? selectedNode ?? null
    resetNodeDraft(baseNode)
    dialogMode = 'create-node'
    dialogTargetId = ''
    dialogInitialContext = {
      eventId: '',
      laneId: selectedLaneId,
      nodeId: baseNode?.id ?? '',
      nodeKind: baseNode?.kind ?? 'year',
    }
  }

  function openEditNodeDialog(nodeId: string, kind?: VerticalTimelineNodeKind): void {
    if (!permissions.editableNodeIds.includes(nodeId)) {
      return
    }

    const node =
      nodeOptions.find((entry) => entry.id === nodeId && (kind ? entry.kind === kind : true)) ?? null

    if (!node) {
      return
    }

    selectedNodeId = node.id
    editingNodeLabel = node.label
    dialogMode = 'edit-node'
    dialogTargetId = node.id
    dialogInitialContext = {
      eventId: '',
      laneId: selectedLaneId,
      nodeId: node.id,
      nodeKind: node.kind,
    }
  }

  function openCreateEventDialog(nodeId = selectedNodeId, laneId = selectedLaneId): void {
    if (!capabilities.canCreateEvent) {
      requestAuthPrompt('创建事件需要先输入访问密钥。')
      return
    }

    const nextNodeId = nodeId || nodeOptions[0]?.id || ''
    const nextLaneId = laneId || manageableLanes[0]?.id || ''

    if (nextNodeId === '' || nextLaneId === '') {
      sharedSyncError = '请先确认时间点和可编辑角色都已存在。'
      return
    }

    if (!permissions.manageableLaneIds.includes(nextLaneId)) {
      sharedSyncError = '当前账号没有在该角色下创建事件的权限。'
      return
    }

    selectedNodeId = nextNodeId
    selectedLaneId = nextLaneId
    activeEventId = ''
    resetEventDraft()
    dialogMode = 'create-event'
    dialogTargetId = ''
    dialogInitialContext = {
      eventId: '',
      laneId: nextLaneId,
      nodeId: nextNodeId,
      nodeKind: nodeOptions.find((node) => node.id === nextNodeId)?.kind ?? 'year',
    }
  }

  function openEditEventDialog(eventId: string, nodeId?: string, laneId?: string): void {
    const event = eventsById[eventId]

    if (!event || !permissions.editableEventIds.includes(eventId)) {
      return
    }

    primeEventDraft(event)
    selectedNodeId = nodeId ?? event.nodeId
    selectedLaneId = laneId ?? event.laneId
    activeEventId = eventId
    dialogMode = 'edit-event'
    dialogTargetId = event.id
    dialogInitialContext = {
      eventId: event.id,
      laneId: event.laneId,
      nodeId: event.nodeId,
      nodeKind: nodeOptions.find((node) => node.id === event.nodeId)?.kind ?? 'year',
    }
  }

  function openCreateLaneDialog(): void {
    if (!capabilities.canManageLanes) {
      requestAuthPrompt('创建角色卡需要先输入访问密钥。')
      return
    }

    resetLaneDraft()
    dialogMode = 'create-lane'
    dialogTargetId = ''
    dialogInitialContext = createEmptyDialogContext()
  }

  function openEditLaneDialog(laneId: string): void {
    if (!capabilities.canManageLanes) {
      return
    }

    primeLaneDraft(laneId)
    dialogMode = 'edit-lane'
    dialogTargetId = laneId
    dialogInitialContext = {
      eventId: '',
      laneId,
      nodeId: selectedNodeId,
      nodeKind: selectedNode?.kind ?? 'year',
    }
  }

  function openLanePermissionsDialog(laneId = selectedLaneId): void {
    if (!capabilities.canManageLanePermissions) {
      requestAuthPrompt('修改角色权限需要先输入访问密钥。')
      return
    }

    const nextLaneId = laneId || lanes[0]?.id || ''

    if (nextLaneId === '') {
      sharedSyncError = '当前还没有可管理的角色卡。'
      return
    }

    primeLaneDraft(nextLaneId)
    ensureLanePermissionEntry(nextLaneId)
    dialogMode = 'lane-permissions'
    dialogTargetId = nextLaneId
    dialogInitialContext = {
      eventId: '',
      laneId: nextLaneId,
      nodeId: selectedNodeId,
      nodeKind: selectedNode?.kind ?? 'year',
    }
  }

  function handleSelectPlacement(nodeId: string, laneId: string): void {
    selectedNodeId = nodeId
    selectedLaneId = laneId
    openCreateEventDialog(nodeId, laneId)
  }

  function handleSelectNode(nodeId: string, kind: VerticalTimelineNodeKind): void {
    selectedNodeId = nodeId
    openEditNodeDialog(nodeId, kind)
  }

  function handleSelectLane(laneId: string): void {
    selectedLaneId = laneId

    if (capabilities.canManageLanes) {
      openEditLaneDialog(laneId)
    }
  }

  function handleSelectEvent(eventId: string, nodeId: string, laneId: string): void {
    selectedNodeId = nodeId
    selectedLaneId = laneId
    openEditEventDialog(eventId, nodeId, laneId)
  }

  async function createTimePoint(): Promise<void> {
    if (!capabilities.canManageStructure) {
      requestAuthPrompt('创建时间点需要先输入访问密钥。')
      return
    }

    const label = nodeDraftLabel.trim()

    if (label === '') {
      sharedSyncError = '请填写时间点标签。'
      return
    }

    if (nodeDraftKind !== 'year' && nodeDraftParentId === '') {
      sharedSyncError = '请先选择上级时间点。'
      return
    }

    const succeeded = await submitTimelineMutation(
      '/vertical-timeline/time-points',
      {
        body: JSON.stringify({
          kind: nodeDraftKind,
          label,
          parentId: nodeDraftKind === 'year' ? '' : nodeDraftParentId,
          worldview: worldviewName,
        }),
        method: 'POST',
      },
      '创建时间点需要先输入访问密钥。',
      `timepoint:create:${nodeDraftKind}`,
    )

    if (succeeded) {
      closeDialog()
      nodeDraftLabel = ''
    }
  }

  async function saveSelectedNode(): Promise<void> {
    if (!canEditSelectedNode || selectedNodeId === '') {
      return
    }

    const label = editingNodeLabel.trim()

    if (label === '') {
      sharedSyncError = '时间点标签不能为空。'
      return
    }

    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/time-points/${encodeURIComponent(selectedNodeId)}`,
      {
        body: JSON.stringify({
          label,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '修改时间点需要先输入访问密钥。',
      `timepoint:${selectedNodeId}`,
    )

    if (succeeded) {
      closeDialog()
    }
  }

  async function deleteSelectedNode(): Promise<void> {
    if (!canDeleteSelectedNode || selectedNodeId === '') {
      sharedSyncError = '只有管理员可以删除时间点。'
      return
    }

    if (!(await confirmDialog('删除这个时间点会同时移除下属时间点和相关事件，确认继续吗？'))) {
      return
    }

    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/time-points/${encodeURIComponent(selectedNodeId)}`,
      {
        body: JSON.stringify({
          delete: true,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '删除时间点需要先输入访问密钥。',
      `timepoint:delete:${selectedNodeId}`,
    )

    if (succeeded) {
      closeDialog()
    }
  }

  async function saveEventDraft(): Promise<void> {
    if (!canSaveEvent) {
      requestAuthPrompt('保存事件需要先输入访问密钥。')
      return
    }

    const title = eventDraftTitle.trim()

    if (title === '') {
      sharedSyncError = '事件标题不能为空。'
      return
    }

    const payload = {
      body: eventDraftBody,
      detailImage: eventDraftImage.trim(),
      laneId: selectedLaneId,
      nodeId: selectedNodeId,
      summary: eventDraftSummary.trim(),
      tags: serialiseTags(eventDraftTagsText),
      title,
      worldview: worldviewName,
    }

    if (editingEventId !== '') {
      const succeeded = await submitTimelineMutation(
        `/vertical-timeline/events/${encodeURIComponent(editingEventId)}`,
        {
          body: JSON.stringify(payload),
          method: 'PATCH',
        },
        '保存事件需要先输入访问密钥。',
        `event:${editingEventId}`,
      )

      if (succeeded) {
        activeEventId = editingEventId
        closeDialog()
      }
      return
    }

    const mutationLaneId = selectedLaneId
    const mutationNodeId = selectedNodeId
    const succeeded = await submitTimelineMutation(
      '/vertical-timeline/events',
      {
        body: JSON.stringify(payload),
        method: 'POST',
      },
      '创建事件需要先输入访问密钥。',
      `event:create:${selectedNodeId}:${selectedLaneId}`,
    )

    if (succeeded) {
      const createdEvent =
        events.find(
          (event) =>
            event.nodeId === mutationNodeId &&
            event.laneId === mutationLaneId &&
            event.title === title,
        ) ?? null

      if (createdEvent) {
        activeEventId = createdEvent.id
      }

      closeDialog()
    }
  }

  async function createLane(): Promise<void> {
    if (!capabilities.canManageLanes) {
      requestAuthPrompt('创建角色卡需要先输入访问密钥。')
      return
    }

    const name = laneDraftName.trim()

    if (name === '') {
      sharedSyncError = '角色名不能为空。'
      return
    }

    const succeeded = await submitTimelineMutation(
      '/vertical-timeline/lanes',
      {
        body: JSON.stringify({
          color: laneDraftColor,
          name,
          worldview: worldviewName,
        }),
        method: 'POST',
      },
      '创建角色卡需要先输入访问密钥。',
      'lane:create',
    )

    if (succeeded) {
      closeDialog()
      resetLaneDraft()
    }
  }

  async function saveLaneDraft(): Promise<void> {
    if (!capabilities.canManageLanes || editingLaneId === '') {
      return
    }

    const name = editingLaneName.trim()

    if (name === '') {
      sharedSyncError = '角色名不能为空。'
      return
    }

    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/lanes/${encodeURIComponent(editingLaneId)}`,
      {
        body: JSON.stringify({
          color: editingLaneColor,
          name,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '修改角色卡需要先输入访问密钥。',
      `lane:${editingLaneId}`,
    )

    if (succeeded) {
      closeDialog()
    }
  }

  async function deleteLaneDraft(): Promise<void> {
    if (!capabilities.canManageLanes || editingLaneId === '') {
      return
    }

    if (!(await confirmDialog('删除角色卡会移除该角色下的事件与授权，确认继续吗？'))) {
      return
    }

    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/lanes/${encodeURIComponent(editingLaneId)}`,
      {
        body: JSON.stringify({
          delete: true,
          worldview: worldviewName,
        }),
        method: 'PATCH',
      },
      '删除角色卡需要先输入访问密钥。',
      `lane:delete:${editingLaneId}`,
    )

    if (succeeded) {
      closeDialog()
    }
  }

  async function saveLanePermissions(laneId: string): Promise<void> {
    if (!capabilities.canManageLanePermissions) {
      return
    }

    const selectedUserIds = selectedLanePermissionUserIds
    const succeeded = await submitTimelineMutation(
      `/vertical-timeline/lanes/${encodeURIComponent(laneId)}/permissions`,
      {
        body: JSON.stringify({
          userIds: selectedUserIds,
          worldview: worldviewName,
        }),
        method: 'PUT',
      },
      '修改角色权限需要先输入访问密钥。',
      `lane:permissions:${laneId}`,
    )

    if (succeeded) {
      closeDialog()
    }
  }

  function toggleLanePermissionUser(userId: string): void {
    if (lanePermissionEditorId === '') {
      return
    }

    ensureLanePermissionEntry(lanePermissionEditorId)
    lanePermissions = lanePermissions.map((entry) =>
      entry.laneId === lanePermissionEditorId
        ? {
            ...entry,
            userIds: entry.userIds.includes(userId)
              ? entry.userIds.filter((value) => value !== userId)
              : [...entry.userIds, userId],
          }
        : entry,
    )
  }

  onMount(() => {
    void loadVerticalTimelineState(worldviewName)
  })
</script>

{#if detailEvent}
  <EventDetailPage
    event={detailEvent}
    onBack={closeEventDetail}
    onDelete={() => void deleteEvent(detailEvent.id)}
    onSave={(draft) => void saveDetailDraft(draft)}
    worldviewName={worldviewName}
  />
{:else}
  <WorldviewHero
    description={worldviewDescription}
    hasCover={worldviewHasCover}
    name={worldviewName}
    tags={worldviewTags}
    themeStyle={worldviewThemeStyle}
    transitionKey={worldviewTransitionKey}
  />

  <section class="mt-6 space-y-6">
    <section class="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/80 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div class="flex flex-col gap-5 border-b border-slate-200/80 px-8 py-7">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div class="flex flex-col gap-2">
            <span class="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-400">
              Soy un fue, un cronista, un historiador.
            </span>
            <div class="flex flex-col gap-2">
              <h2 class="m-0 font-[var(--font-display)] text-[clamp(1.8rem,3vw,2.5rem)] leading-[1.05] text-slate-900">
                时间轴
              </h2>
            </div>
          </div>

          <div class="flex flex-col items-start gap-2 text-sm text-slate-500">
            <div class="flex flex-wrap gap-2">
              <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                {currentUser ? `${currentUser.displayName} · ${currentUser.role}` : '未登录'}
              </span>
              <span class="rounded-full border border-slate-200 bg-white px-3 py-1">
                {viewerCapabilityLabel}
              </span>
              {#if currentUser}
                <span class="rounded-full border border-slate-200 bg-white px-3 py-1">
                  可操作角色 {permissions.manageableLaneIds.length}
                </span>
              {/if}
            </div>

            <div class="flex flex-wrap gap-2">
              {#if !currentUser}
                <button
                  class="toolbar-action toolbar-primary"
                  type="button"
                  onclick={() => requestAuthPrompt('垂直时间轴共享编辑需要先输入访问密钥。')}
                >
                  输入密钥
                </button>
              {/if}

              {#if capabilities.canManageStructure}
                <button class="toolbar-action" type="button" onclick={() => openCreateNodeDialog()}>
                  新增时间点
                </button>
              {/if}

              {#if capabilities.canCreateEvent}
                <button class="toolbar-action" type="button" onclick={() => openCreateEventDialog()}>
                  新增事件
                </button>
              {/if}

              {#if capabilities.canManageLanes}
                <button class="toolbar-action" type="button" onclick={openCreateLaneDialog}>
                  新增角色卡
                </button>
              {/if}

              {#if capabilities.canManageLanePermissions}
                <button class="toolbar-action" type="button" onclick={() => openLanePermissionsDialog()}>
                  角色权限
                </button>
              {/if}
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/70 px-4 py-4 text-sm text-slate-600">
          <span>当前时间点：{formatNodeLabel(selectedNode)}</span>
          <span>当前角色：{selectedLane?.name ?? '未选择'}</span>
          <span>可见角色：{lanes.length}</span>
          <span>事件数：{events.length}</span>
        </div>

        {#if sharedSyncError !== ''}
          <p class="m-0 rounded-2xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
            {sharedSyncError}
          </p>
        {/if}

        {#if isStateLoading}
          <p class="m-0 text-sm text-slate-400">正在载入垂直时间轴状态…</p>
        {/if}
      </div>

      <div class="px-5 py-5 sm:px-6">
        {#if lanes.length === 0}
          <div class="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
            <strong class="block text-slate-800">当前没有可见的角色卡</strong>
            <p class="mt-2 text-sm leading-6 text-slate-500">
              {#if currentUser}
                请联系管理员为你分配角色权限，或由管理员先创建新的角色卡。
              {:else}
                登录后你才能看到自己有权限的角色卡。
              {/if}
            </p>
          </div>
        {:else}
          <VerticalTimeline
            bind:activeEventId
            canManageLanes={capabilities.canManageLanes}
            canManageStructure={capabilities.canManageStructure}
            editableEventIds={permissions.editableEventIds}
            editableNodeIds={permissions.editableNodeIds}
            {expansionResetKey}
            {eventsById}
            {lanes}
            manageableLaneIds={permissions.manageableLaneIds}
            onSelectEvent={handleSelectEvent}
            onSelectLane={handleSelectLane}
            onSelectNode={handleSelectNode}
            onSelectPlacement={handleSelectPlacement}
            selectedLaneId={selectedLaneId}
            selectedNodeId={selectedNodeId}
            timeAxisLabel="时间刻度"
            {years}
          />
        {/if}
      </div>
    </section>
  </section>
{/if}

{#if dialogMode !== 'none'}
  <div
    aria-hidden="true"
    class="chat-nickname-overlay"
    onclick={closeDialog}
    onkeydown={(event) => {
      if (event.key === 'Escape') {
        closeDialog()
      }
    }}
    role="presentation"
    tabindex="-1"
  >
    <div
      aria-modal="true"
      class="chat-nickname-dialog max-h-[85vh] overflow-y-auto"
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          closeDialog()
        }
      }}
      role="dialog"
      style="width:min(100%, 760px)"
      tabindex="0"
      onclick={(event) => event.stopPropagation()}
    >
      {#if dialogMode === 'create-node'}
        <div class="grid gap-5">
          <div>
            <span class="section-label">时间点</span>
            <h3>新增时间点</h3>
            <p>按当前选中位置快速补充年份、月份或日期节点。</p>
          </div>

          <div class="grid gap-4">
            <label class="grid gap-2 text-sm text-slate-500">
              <span>新增类型</span>
              <select bind:value={nodeDraftKind} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800">
                <option value="year">年份</option>
                <option value="month">月份</option>
                <option value="day">日期</option>
              </select>
            </label>

            {#if nodeDraftKind === 'month'}
              <label class="grid gap-2 text-sm text-slate-500">
                <span>所属年份</span>
                <select bind:value={nodeDraftParentId} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800">
                  {#each monthParentOptions as option}
                    <option value={option.id}>{option.label}</option>
                  {/each}
                </select>
              </label>
            {/if}

            {#if nodeDraftKind === 'day'}
              <label class="grid gap-2 text-sm text-slate-500">
                <span>所属月份</span>
                <select bind:value={nodeDraftParentId} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800">
                  {#each dayParentOptions as option}
                    <option value={option.id}>{option.label}</option>
                  {/each}
                </select>
              </label>
            {/if}

            <label class="grid gap-2 text-sm text-slate-500">
              <span>标签</span>
              <input bind:value={nodeDraftLabel} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
            </label>
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
            <button
              class="toolbar-action toolbar-primary"
              disabled={mutationTarget.startsWith('timepoint:create:')}
              type="button"
              onclick={() => void createTimePoint()}
            >
              {mutationTarget.startsWith('timepoint:create:') ? '保存中…' : '新增时间点'}
            </button>
          </div>
        </div>
      {:else if dialogMode === 'edit-node' && dialogNode}
        <div class="grid gap-5">
          <div>
            <span class="section-label">时间点</span>
            <h3>编辑时间点</h3>
            <p>当前节点：{createVerticalTimelineNodeOptionLabel(dialogNode)}</p>
          </div>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>标签</span>
            <input bind:value={editingNodeLabel} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
          </label>

          {#if !canDeleteSelectedNode}
            <p class="m-0 text-sm leading-6 text-slate-500">
              普通用户可以修改已授权时间点的标签，但不能删除时间点。
            </p>
          {/if}

          <div class="flex flex-wrap justify-between gap-2">
            <div class="flex flex-wrap gap-2">
              {#if canDeleteSelectedNode}
                <button
                  class="toolbar-action"
                  disabled={mutationTarget === `timepoint:delete:${selectedNodeId}`}
                  type="button"
                  onclick={() => void deleteSelectedNode()}
                >
                  {mutationTarget === `timepoint:delete:${selectedNodeId}` ? '删除中…' : '删除时间点'}
                </button>
              {/if}
            </div>

            <div class="flex flex-wrap gap-2">
              <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
              <button
                class="toolbar-action toolbar-primary"
                disabled={mutationTarget === `timepoint:${selectedNodeId}`}
                type="button"
                onclick={() => void saveSelectedNode()}
              >
                {mutationTarget === `timepoint:${selectedNodeId}` ? '保存中…' : '保存标签'}
              </button>
            </div>
          </div>
        </div>
      {:else if dialogMode === 'create-event' || (dialogMode === 'edit-event' && editableEvent)}
        <div class="grid gap-5">
          <div>
            <span class="section-label">事件</span>
            <h3>{dialogMode === 'create-event' ? '新增事件' : '编辑事件'}</h3>
            <p>
              时间点：{formatNodeLabel(selectedNode)} · 轨道：{selectedLane?.name ?? '未选择'}
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <label class="grid gap-2 text-sm text-slate-500">
              <span>目标轨道</span>
              <select bind:value={selectedLaneId} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800">
                {#each manageableLanes as lane}
                  <option value={lane.id}>{lane.name}</option>
                {/each}
              </select>
            </label>

            <label class="grid gap-2 text-sm text-slate-500">
              <span>目标时间点</span>
              <select bind:value={selectedNodeId} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800">
                {#each nodeOptions as option}
                  <option value={option.id}>{createVerticalTimelineNodeOptionLabel(option)}</option>
                {/each}
              </select>
            </label>
          </div>

          <div class="grid gap-4">
            <label class="grid gap-2 text-sm text-slate-500">
              <span>标题</span>
              <input bind:value={eventDraftTitle} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
            </label>

            <label class="grid gap-2 text-sm text-slate-500">
              <span>摘要</span>
              <textarea bind:value={eventDraftSummary} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" rows="3"></textarea>
            </label>

            <label class="grid gap-2 text-sm text-slate-500">
              <span>正文</span>
              <textarea bind:value={eventDraftBody} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" rows="5"></textarea>
            </label>

            <label class="grid gap-2 text-sm text-slate-500">
              <span>标签</span>
              <textarea bind:value={eventDraftTagsText} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" rows="2"></textarea>
            </label>

            <label class="grid gap-2 text-sm text-slate-500">
              <span>插图地址</span>
              <input bind:value={eventDraftImage} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
            </label>
          </div>

          <div class="flex flex-wrap justify-between gap-2">
            <div class="flex flex-wrap gap-2">
              {#if editableEvent}
                <button
                  class="toolbar-action"
                  disabled={mutationTarget === `event:delete:${editableEvent.id}`}
                  type="button"
                  onclick={() => void deleteEvent(editableEvent.id)}
                >
                  {mutationTarget === `event:delete:${editableEvent.id}` ? '删除中…' : '删除事件'}
                </button>
              {/if}
            </div>

            <div class="flex flex-wrap gap-2">
              {#if editableEvent}
                <button class="toolbar-action" type="button" onclick={() => openEventDetail(editableEvent.id)}>
                  编辑详情
                </button>
              {/if}
              <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
              <button
                class="toolbar-action toolbar-primary"
                disabled={!canSaveEvent || mutationTarget === (editingEventId !== '' ? `event:${editingEventId}` : `event:create:${selectedNodeId}:${selectedLaneId}`)}
                type="button"
                onclick={() => void saveEventDraft()}
              >
                {#if editingEventId !== ''}
                  {mutationTarget === `event:${editingEventId}` ? '保存中…' : '保存事件'}
                {:else}
                  {mutationTarget === `event:create:${selectedNodeId}:${selectedLaneId}` ? '创建中…' : '创建事件'}
                {/if}
              </button>
            </div>
          </div>
        </div>
      {:else if dialogMode === 'create-lane'}
        <div class="grid gap-5">
          <div>
            <span class="section-label">角色卡</span>
            <h3>新增角色卡</h3>
            <p>创建后可再分配哪些用户拥有该角色的编辑权限。</p>
          </div>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>角色名</span>
            <input bind:value={laneDraftName} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
          </label>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>颜色</span>
            <div class="flex items-center gap-3">
              <input bind:value={laneDraftColor} class="h-11 w-16 rounded-2xl border border-slate-200 bg-white p-2" type="color" />
              <input bind:value={laneDraftColor} class="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
            </div>
          </label>

          <div class="flex flex-wrap justify-end gap-2">
            <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
            <button
              class="toolbar-action toolbar-primary"
              disabled={mutationTarget === 'lane:create'}
              type="button"
              onclick={() => void createLane()}
            >
              {mutationTarget === 'lane:create' ? '创建中…' : '新增角色卡'}
            </button>
          </div>
        </div>
      {:else if dialogMode === 'edit-lane' && dialogLane}
        <div class="grid gap-5">
          <div>
            <span class="section-label">角色卡</span>
            <h3>编辑角色卡</h3>
            <p>当前角色：{dialogLane.name}</p>
          </div>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>角色名</span>
            <input bind:value={editingLaneName} class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
          </label>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>颜色</span>
            <div class="flex items-center gap-3">
              <input bind:value={editingLaneColor} class="h-11 w-16 rounded-2xl border border-slate-200 bg-white p-2" type="color" />
              <input bind:value={editingLaneColor} class="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800" type="text" />
            </div>
          </label>

          <div class="flex flex-wrap justify-between gap-2">
            <div class="flex flex-wrap gap-2">
              <button
                class="toolbar-action"
                disabled={mutationTarget === `lane:delete:${dialogLane.id}`}
                type="button"
                onclick={() => void deleteLaneDraft()}
              >
                {mutationTarget === `lane:delete:${dialogLane.id}` ? '删除中…' : '删除角色卡'}
              </button>
            </div>

            <div class="flex flex-wrap gap-2">
              {#if capabilities.canManageLanePermissions}
                <button class="toolbar-action" type="button" onclick={() => openLanePermissionsDialog(dialogLane.id)}>
                  角色权限
                </button>
              {/if}
              <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
              <button
                class="toolbar-action toolbar-primary"
                disabled={mutationTarget === `lane:${dialogLane.id}`}
                type="button"
                onclick={() => void saveLaneDraft()}
              >
                {mutationTarget === `lane:${dialogLane.id}` ? '保存中…' : '保存角色卡'}
              </button>
            </div>
          </div>
        </div>
      {:else if dialogMode === 'lane-permissions'}
        <div class="grid gap-5">
          <div>
            <span class="section-label">角色权限</span>
            <h3>分配可编辑用户</h3>
            <p>只有被勾选的用户能看到并修改该角色下的事件。</p>
          </div>

          <label class="grid gap-2 text-sm text-slate-500">
            <span>目标角色</span>
            <select
              bind:value={lanePermissionEditorId}
              class="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-800"
              onchange={() => {
                dialogTargetId = lanePermissionEditorId
                ensureLanePermissionEntry(lanePermissionEditorId)
              }}
            >
              {#each lanes as lane}
                <option value={lane.id}>{lane.name}</option>
              {/each}
            </select>
          </label>

          <div class="grid gap-2 rounded-[22px] border border-slate-200 bg-slate-50/70 p-3">
            {#each manageableUsers as user (user.id)}
              <label class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                <input
                  checked={selectedLanePermissionUserIds.includes(user.id)}
                  type="checkbox"
                  onchange={() => toggleLanePermissionUser(user.id)}
                />
                <span>{user.displayName} · {user.handle}</span>
              </label>
            {/each}

            {#if manageableUsers.length === 0}
              <p class="m-0 text-sm text-slate-500">当前没有可分配的普通用户。</p>
            {/if}
          </div>

          <div class="flex flex-wrap justify-end gap-2">
            <button class="toolbar-action" type="button" onclick={closeDialog}>取消</button>
            <button
              class="toolbar-action toolbar-primary"
              disabled={lanePermissionEditorId === '' || mutationTarget === `lane:permissions:${lanePermissionEditorId}`}
              type="button"
              onclick={() => void saveLanePermissions(lanePermissionEditorId)}
            >
              {mutationTarget === `lane:permissions:${lanePermissionEditorId}` ? '保存中…' : '保存权限'}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if isAuthPromptOpen}
  <div class="chat-nickname-overlay">
    <form class="chat-nickname-dialog" onsubmit={handleAccessKeySubmit}>
      <div>
        <span class="section-label">共享同步</span>
        <h3>先输入访问密钥</h3>
        <p>垂直时间轴的增删改和轨道权限控制都依赖共享服务；登录后才会按用户权限开放可编辑区域。</p>
      </div>

      <label class="chat-nickname-field">
        <span>访问密钥</span>
        <input
          bind:value={accessKeyDraft}
          autocomplete="off"
          placeholder="输入管理员分发的访问密钥"
          spellcheck="false"
          type="password"
        />
      </label>

      {#if authError !== ''}
        <div class="chat-nickname-error">{authError}</div>
      {/if}

      <div class="chat-nickname-actions">
        <button class="toolbar-action" type="button" onclick={() => (isAuthPromptOpen = false)}>
          稍后再说
        </button>
        <button class="toolbar-action toolbar-primary" disabled={isAuthChecking} type="submit">
          {isAuthChecking ? '验证中…' : '验证并继续'}
        </button>
      </div>
    </form>
  </div>
{/if}
