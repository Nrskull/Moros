<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    buildChatHttpUrl,
    buildChatWebSocketUrl,
    CHAT_CHARACTER_NAME_MAX_LENGTH,
    type ChatCharacterAttributes,
    type ChatCharacterCard,
    CHAT_MAX_MESSAGE_LENGTH,
    CHAT_ROOM_NAME_MAX_LENGTH,
    CHAT_STORAGE_ROOM_KEY,
    CHAT_STORAGE_SESSION_KEY,
    createChatSessionId,
    formatChatTimestamp,
    PUBLIC_CHAT_ROOM_ID,
    type ChatConnectionState,
    type ChatMember,
    type ChatMessage,
    type ChatRoom,
    type ChatUser,
  } from './chat-room'

  type AttributeKey = keyof ChatCharacterAttributes

  interface ChatJoinedPayload {
    activeCharacterId: string | null
    characterCards: ChatCharacterCard[]
    currentUser: ChatUser
    members: ChatMember[]
    messages: ChatMessage[]
    room: ChatRoom
    rooms: ChatRoom[]
    sessionId: string
    type: 'joined'
  }

  interface ChatMessagePayload {
    message: ChatMessage
    type: 'message'
  }

  interface ChatPresencePayload {
    members: ChatMember[]
    roomId: string
    type: 'presence'
  }

  interface ChatErrorPayload {
    message: string
    type: 'error'
  }

  interface ChatAuthRequiredPayload {
    message: string
    type: 'auth_required'
  }

  interface ChatRoomsPayload {
    rooms: ChatRoom[]
    type: 'rooms'
  }

  interface ChatCharacterStatePayload {
    activeCharacterId: string | null
    characterCards: ChatCharacterCard[]
    currentUser: ChatUser
    type: 'character_state'
  }

  interface ChatRoomPermission {
    roomId: string
    userIds: string[]
  }

  interface ChatRoomPermissionsStatePayload {
    manageableUsers: ChatUser[]
    roomPermissions: ChatRoomPermission[]
    type: 'room_permissions_state'
  }

  interface ChatRoomHistoryClearedPayload {
    roomId: string
    type: 'room_history_cleared'
  }

  interface ChatSystemRenderItem {
    body: string
    createdAt: number
    id: string
    type: 'system'
  }

  interface ChatNarrationRenderItem {
    body: string
    createdAt: number
    id: string
    isRulingTone: boolean
    type: 'narration'
  }

  interface ChatMessageRenderGroup {
    groupKey: string
    id: string
    isOwn: boolean
    messages: ChatMessage[]
    speakerAvatar: string
    speakerName: string
    type: 'group'
  }

  type ChatServerPayload =
    | ChatAuthRequiredPayload
    | ChatCharacterStatePayload
    | ChatErrorPayload
    | ChatJoinedPayload
    | ChatMessagePayload
    | ChatPresencePayload
    | ChatRoomHistoryClearedPayload
    | ChatRoomPermissionsStatePayload
    | ChatRoomsPayload

  type ChatRenderItem = ChatMessageRenderGroup | ChatNarrationRenderItem | ChatSystemRenderItem

  interface ChatAuthResponse {
    authenticated?: boolean
    currentUser?: ChatUser
    expiresAt?: number
    message?: string
    ok: boolean
    retryAfterMs?: number
  }

  const ROOM_PLACEHOLDER: ChatRoom = {
    createdAt: 0,
    id: PUBLIC_CHAT_ROOM_ID,
    latestMessageAt: null,
    memberCount: 0,
    name: '公共群聊',
  }

  const ATTRIBUTE_FIELDS: Array<{ key: AttributeKey; label: string }> = [
    { key: 'strength', label: '力量' },
    { key: 'dexterity', label: '敏捷' },
    { key: 'intelligence', label: '智力' },
    { key: 'luck', label: '幸运' },
    { key: 'size', label: '体型' },
    { key: 'constitution', label: '体质' },
    { key: 'education', label: '教育' },
    { key: 'appearance', label: '外貌' },
    { key: 'willpower', label: '意志' },
  ]

  const AVATAR_CROP_VIEWPORT_SIZE = 220
  const AVATAR_CROP_OUTPUT_SIZE = 320

  let characterMenuElement: HTMLDivElement | null = null
  let messageViewportElement: HTMLDivElement | null = null

  let socket: WebSocket | null = null
  let socketSerial = 0
  let reconnectTimer: number | null = null
  let shouldReconnect = false

  let room = ROOM_PLACEHOLDER
  let rooms: ChatRoom[] = [ROOM_PLACEHOLDER]
  let activeRoomId = PUBLIC_CHAT_ROOM_ID
  let sessionId = ''
  let nickname = ''
  let accessKeyDraft = ''
  let draftMessage = ''
  let connectionState: ChatConnectionState = 'disconnected'
  let connectionError = ''
  let authError = ''
  let isAuthChecking = true
  let currentUser: ChatUser | null = null
  let isAdminUser = false
  let characterCards: ChatCharacterCard[] = []
  let activeCharacterId: string | null = null
  let messages: ChatMessage[] = []
  let members: ChatMember[] = []
  let manageableUsers: ChatUser[] = []
  let roomPermissions: ChatRoomPermission[] = []
  let unreadIncomingCount = 0
  let isAuthPromptOpen = false
  let isCreateRoomPromptOpen = false
  let isLeftDrawerOpen = false
  let isRightDrawerOpen = false
  let createRoomDraft = ''
  let createRoomError = ''
  let isRoomPermissionsPromptOpen = false
  let roomPermissionsRoomId = ''
  let roomPermissionsDraftUserIds: string[] = []
  let roomPermissionsError = ''
  let isCreateCharacterPromptOpen = false
  let createCharacterNameDraft = ''
  let createCharacterError = ''
  let createCharacterAttributesDraft: ChatCharacterAttributes = createEmptyCharacterAttributes()
  let createCharacterAvatarInputElement: HTMLInputElement | null = null
  let createCharacterAvatarDataUrl = ''
  let isEditCharacterPromptOpen = false
  let editCharacterId = ''
  let editCharacterNameDraft = ''
  let editCharacterError = ''
  let editCharacterAttributesDraft: ChatCharacterAttributes = createEmptyCharacterAttributes()
  let editCharacterAvatarInputElement: HTMLInputElement | null = null
  let editCharacterAvatarDataUrl = ''
  let isCharacterMenuOpen = false
  let closeCharacterEditorOnNextState = false
  let isAvatarCropPromptOpen = false
  let avatarCropTarget: 'create' | 'edit' = 'create'
  let avatarCropSourceDataUrl = ''
  let avatarCropNaturalWidth = 0
  let avatarCropNaturalHeight = 0
  let avatarCropSurfaceWidth = AVATAR_CROP_VIEWPORT_SIZE
  let avatarCropViewportSize = AVATAR_CROP_VIEWPORT_SIZE
  let avatarCropZoom = 1
  let avatarCropOffsetX = 0
  let avatarCropOffsetY = 0
  let avatarCropPreviewWidth = 0
  let avatarCropPreviewHeight = 0
  let avatarCropPreviewTransform = 'translate(-50%, -50%)'
  let avatarCropError = ''
  let avatarCropPointerId: number | null = null
  let avatarCropPointerOriginX = 0
  let avatarCropPointerOriginY = 0
  let avatarCropOriginOffsetX = 0
  let avatarCropOriginOffsetY = 0
  let roomList: ChatRoom[] = [ROOM_PLACEHOLDER]
  let activeCharacter: ChatCharacterCard | null = null
  let renderedMessages: ChatRenderItem[] = []

  $: avatarCropViewportSize =
    avatarCropSurfaceWidth > 0 ? avatarCropSurfaceWidth : AVATAR_CROP_VIEWPORT_SIZE

  $: {
    const baseScale =
      avatarCropNaturalWidth <= 0 || avatarCropNaturalHeight <= 0
        ? 1
        : Math.max(
            avatarCropViewportSize / avatarCropNaturalWidth,
            avatarCropViewportSize / avatarCropNaturalHeight,
          )
    const scale = baseScale * avatarCropZoom

    avatarCropPreviewWidth = avatarCropNaturalWidth * scale
    avatarCropPreviewHeight = avatarCropNaturalHeight * scale
    avatarCropPreviewTransform = `translate(calc(-50% + ${avatarCropOffsetX}px), calc(-50% + ${avatarCropOffsetY}px))`
  }

  function sanitiseNickname(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 24)
  }

  function resolveChatNicknameFromUser(user: ChatUser | null): string {
    const preferredName = user?.displayName?.trim() || user?.handle?.trim() || ''
    return sanitiseNickname(preferredName)
  }

  function sanitiseRoomName(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, CHAT_ROOM_NAME_MAX_LENGTH)
  }

  function sanitiseCharacterName(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, CHAT_CHARACTER_NAME_MAX_LENGTH)
  }

  function normaliseAttributeDraft(value: string): number {
    const parsed = Number.parseInt(value.trim(), 10)

    if (!Number.isFinite(parsed)) {
      return 0
    }

    return Math.min(100, Math.max(0, parsed))
  }

  function createEmptyCharacterAttributes(): ChatCharacterAttributes {
    return {
      appearance: 0,
      constitution: 0,
      dexterity: 0,
      education: 0,
      intelligence: 0,
      luck: 0,
      size: 0,
      strength: 0,
      willpower: 0,
    }
  }

  function cloneCharacterAttributes(attributes: ChatCharacterAttributes): ChatCharacterAttributes {
    return {
      appearance: attributes.appearance,
      constitution: attributes.constitution,
      dexterity: attributes.dexterity,
      education: attributes.education,
      intelligence: attributes.intelligence,
      luck: attributes.luck,
      size: attributes.size,
      strength: attributes.strength,
      willpower: attributes.willpower,
    }
  }

  $: isAdminUser = currentUser?.role === 'admin'

  function getAllowedUserIdsForRoom(roomId: string, entries: ChatRoomPermission[] = roomPermissions): string[] {
    return entries.find((entry) => entry.roomId === roomId)?.userIds ?? []
  }

  function openRoomPermissionsPrompt(roomEntry: ChatRoom, event?: MouseEvent): void {
    event?.stopPropagation()

    if (!isAdminUser) {
      return
    }

    closeMobileDrawers()
    roomPermissionsRoomId = roomEntry.id
    roomPermissionsDraftUserIds = [...getAllowedUserIdsForRoom(roomEntry.id)]
    roomPermissionsError = ''
    isRoomPermissionsPromptOpen = true
  }

  function closeRoomPermissionsPrompt(): void {
    isRoomPermissionsPromptOpen = false
    roomPermissionsRoomId = ''
    roomPermissionsDraftUserIds = []
    roomPermissionsError = ''
  }

  function handleRoomPermissionsToggle(userId: string, event: Event): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    if (target.checked) {
      if (!roomPermissionsDraftUserIds.includes(userId)) {
        roomPermissionsDraftUserIds = [...roomPermissionsDraftUserIds, userId]
      }
      return
    }

    roomPermissionsDraftUserIds = roomPermissionsDraftUserIds.filter((entry) => entry !== userId)
  }

  function handleRoomPermissionsSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitRoomPermissions()
  }

  function submitRoomPermissions(): void {
    if (roomPermissionsRoomId === '') {
      roomPermissionsError = '目标房间不存在。'
      return
    }

    if (!isAdminUser) {
      roomPermissionsError = '只有管理员可以修改房间权限。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      roomPermissionsError = '当前未连接群聊，无法更新房间权限。'
      return
    }

    roomPermissionsError = ''

    socket.send(
      JSON.stringify({
        roomId: roomPermissionsRoomId,
        type: 'update_room_permissions',
        userIds: roomPermissionsDraftUserIds,
      }),
    )
  }

  function clearRoomHistory(): void {
    if (roomPermissionsRoomId === '') {
      roomPermissionsError = '目标房间不存在。'
      return
    }

    if (!isAdminUser) {
      roomPermissionsError = '只有管理员可以清空聊天记录。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      roomPermissionsError = '当前未连接群聊，无法清空聊天记录。'
      return
    }

    const selectedRoom = roomList.find((entry) => entry.id === roomPermissionsRoomId)
    const roomName = selectedRoom?.name ?? '当前房间'
    const confirmed = window.confirm(`确定要清空「${roomName}」的全部聊天记录吗？该操作不可撤销。`)

    if (!confirmed) {
      return
    }

    roomPermissionsError = ''
    socket.send(
      JSON.stringify({
        roomId: roomPermissionsRoomId,
        type: 'clear_room_history',
      }),
    )
  }

  function handleRoomCardKeydown(roomId: string, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    switchRoom(roomId)
  }

  function closeCharacterSheet(): void {
    isCreateCharacterPromptOpen = false
    isEditCharacterPromptOpen = false
    closeCharacterEditorOnNextState = false
    createCharacterError = ''
    editCharacterError = ''
    clearCreateCharacterAvatar()
    clearEditCharacterAvatar()
  }

  function getCharacterSheetHeading(): string {
    return isCreateCharacterPromptOpen ? '创建角色卡' : '编辑角色卡'
  }

  function getCharacterSheetDescription(): string {
    if (isCreateCharacterPromptOpen) {
      return '保存后会自动切换到新角色，你可以立刻回到群聊继续发言和检定。'
    }

    return '这里负责编辑角色名、头像和九项属性。保存后，新发出的消息会使用新的角色快照。'
  }

  function getActiveCharacterDraftName(): string {
    return isCreateCharacterPromptOpen ? createCharacterNameDraft : editCharacterNameDraft
  }

  function getActiveCharacterAvatarDataUrl(): string {
    return isCreateCharacterPromptOpen ? createCharacterAvatarDataUrl : editCharacterAvatarDataUrl
  }

  function getActiveCharacterAttributesDraft(): ChatCharacterAttributes {
    return isCreateCharacterPromptOpen ? createCharacterAttributesDraft : editCharacterAttributesDraft
  }

  function getAvatarCropBaseScale(): number {
    if (avatarCropNaturalWidth <= 0 || avatarCropNaturalHeight <= 0) {
      return 1
    }

    return Math.max(
      avatarCropViewportSize / avatarCropNaturalWidth,
      avatarCropViewportSize / avatarCropNaturalHeight,
    )
  }

  function getAvatarCropDisplayMetrics(zoom = avatarCropZoom): {
    height: number
    width: number
  } {
    const scale = getAvatarCropBaseScale() * zoom

    return {
      height: avatarCropNaturalHeight * scale,
      width: avatarCropNaturalWidth * scale,
    }
  }

  function clampAvatarCropOffsets(offsetX: number, offsetY: number, zoom = avatarCropZoom): {
    x: number
    y: number
  } {
    const { width, height } = getAvatarCropDisplayMetrics(zoom)
    const limitX = Math.max(0, (width - avatarCropViewportSize) / 2)
    const limitY = Math.max(0, (height - avatarCropViewportSize) / 2)

    return {
      x: Math.min(limitX, Math.max(-limitX, offsetX)),
      y: Math.min(limitY, Math.max(-limitY, offsetY)),
    }
  }

  function setAvatarCropOffsets(offsetX: number, offsetY: number, zoom = avatarCropZoom): void {
    const nextOffsets = clampAvatarCropOffsets(offsetX, offsetY, zoom)
    avatarCropOffsetX = nextOffsets.x
    avatarCropOffsetY = nextOffsets.y
  }

  function resetAvatarCropState(): void {
    avatarCropSourceDataUrl = ''
    avatarCropNaturalWidth = 0
    avatarCropNaturalHeight = 0
    avatarCropSurfaceWidth = AVATAR_CROP_VIEWPORT_SIZE
    avatarCropZoom = 1
    avatarCropOffsetX = 0
    avatarCropOffsetY = 0
    avatarCropError = ''
    avatarCropPointerId = null
  }

  function closeAvatarCropPrompt(): void {
    isAvatarCropPromptOpen = false
    resetAvatarCropState()
  }

  function loadImageMetadata(dataUrl: string): Promise<{ height: number; width: number }> {
    return new Promise((resolve, reject) => {
      const image = new Image()

      image.addEventListener('load', () => {
        resolve({
          height: image.naturalHeight,
          width: image.naturalWidth,
        })
      })

      image.addEventListener('error', () => {
        reject(new Error('IMAGE_LOAD_FAILED'))
      })

      image.src = dataUrl
    })
  }

  async function openAvatarCropPrompt(target: 'create' | 'edit', dataUrl: string): Promise<void> {
    const imageMetadata = await loadImageMetadata(dataUrl)

    avatarCropTarget = target
    avatarCropSourceDataUrl = dataUrl
    avatarCropNaturalWidth = imageMetadata.width
    avatarCropNaturalHeight = imageMetadata.height
    avatarCropZoom = 1
    avatarCropOffsetX = 0
    avatarCropOffsetY = 0
    avatarCropError = ''
    avatarCropPointerId = null
    isAvatarCropPromptOpen = true
  }

  function handleAvatarCropZoomInput(event: Event): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const nextZoom = Number.parseFloat(target.value)
    avatarCropZoom = Number.isFinite(nextZoom) ? nextZoom : 1
    setAvatarCropOffsets(avatarCropOffsetX, avatarCropOffsetY)
  }

  function handleAvatarCropPointerDown(event: PointerEvent): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) {
      return
    }

    avatarCropPointerId = event.pointerId
    avatarCropPointerOriginX = event.clientX
    avatarCropPointerOriginY = event.clientY
    avatarCropOriginOffsetX = avatarCropOffsetX
    avatarCropOriginOffsetY = avatarCropOffsetY
    target.setPointerCapture(event.pointerId)
  }

  function handleAvatarCropPointerMove(event: PointerEvent): void {
    if (avatarCropPointerId !== event.pointerId) {
      return
    }

    setAvatarCropOffsets(
      avatarCropOriginOffsetX + event.clientX - avatarCropPointerOriginX,
      avatarCropOriginOffsetY + event.clientY - avatarCropPointerOriginY,
    )
  }

  function handleAvatarCropPointerUp(event: PointerEvent): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLElement) || avatarCropPointerId !== event.pointerId) {
      return
    }

    target.releasePointerCapture(event.pointerId)
    avatarCropPointerId = null
  }

  async function renderCroppedAvatarDataUrl(): Promise<string> {
    const image = new Image()

    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve())
      image.addEventListener('error', () => reject(new Error('IMAGE_LOAD_FAILED')))
      image.src = avatarCropSourceDataUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_CROP_OUTPUT_SIZE
    canvas.height = AVATAR_CROP_OUTPUT_SIZE

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('CANVAS_CONTEXT_UNAVAILABLE')
    }

    const scaleRatio = AVATAR_CROP_OUTPUT_SIZE / avatarCropViewportSize
    const { width, height } = getAvatarCropDisplayMetrics()
    const drawWidth = width * scaleRatio
    const drawHeight = height * scaleRatio
    const drawX = AVATAR_CROP_OUTPUT_SIZE / 2 - drawWidth / 2 + avatarCropOffsetX * scaleRatio
    const drawY = AVATAR_CROP_OUTPUT_SIZE / 2 - drawHeight / 2 + avatarCropOffsetY * scaleRatio

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight)

    return canvas.toDataURL('image/png')
  }

  async function confirmAvatarCrop(): Promise<void> {
    try {
      const nextAvatarDataUrl = await renderCroppedAvatarDataUrl()

      if (avatarCropTarget === 'create') {
        createCharacterAvatarDataUrl = nextAvatarDataUrl
        createCharacterError = ''
      } else {
        editCharacterAvatarDataUrl = nextAvatarDataUrl
        editCharacterError = ''
      }

      closeAvatarCropPrompt()
    } catch {
      avatarCropError = '头像裁切失败，请重新上传后再试。'
    }
  }

  function isOwnMessage(message: ChatMessage): boolean {
    if (message.kind === 'system') {
      return false
    }

    if (currentUser?.id && message.userId) {
      return message.userId === currentUser.id
    }

    return message.sessionId === sessionId
  }

  function getMessageSpeakerName(message: ChatMessage): string {
    const safeSpeakerName = message.speakerName.trim()

    if (safeSpeakerName !== '') {
      return safeSpeakerName
    }

    return message.nickname.trim() || '未设置角色'
  }

  function getMessageSpeakerAvatar(message: ChatMessage): string {
    return message.speakerAvatarDataUrl ?? ''
  }

  function getMessageDisplayMode(message: ChatMessage): 'bubble' | 'kp-narration' {
    return message.speakerDisplayMode === 'kp-narration' ? 'kp-narration' : 'bubble'
  }

  function getSpeakerInitial(name: string): string {
    return name.trim().charAt(0) || '角'
  }

  function syncMessageIndent(node: HTMLElement): void {
    const computedStyle = window.getComputedStyle(node)
    const lineHeight = Number.parseFloat(computedStyle.lineHeight)

    if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
      node.classList.remove('is-indent-active')
      return
    }

    const contentHeight = node.getBoundingClientRect().height
    node.classList.toggle('is-indent-active', contentHeight > lineHeight * 1.5)
  }

  function autoIndentMessage(node: HTMLElement): { destroy: () => void } {
    const resizeObserver = new ResizeObserver(() => {
      syncMessageIndent(node)
    })

    resizeObserver.observe(node)

    if (node.parentElement) {
      resizeObserver.observe(node.parentElement)
    }

    requestAnimationFrame(() => {
      syncMessageIndent(node)
    })

    return {
      destroy() {
        resizeObserver.disconnect()
      },
    }
  }

  function isKpNarrationCharacter(character: ChatCharacterCard | null): boolean {
    return character?.presentationMode === 'kp-narration'
  }

  function getMessageGroupKey(message: ChatMessage | undefined): string | null {
    if (!message || message.kind === 'system') {
      return null
    }

    return `${message.userId ?? message.sessionId ?? 'anonymous'}::${message.speakerCharacterId ?? ''}::${getMessageSpeakerName(message)}::${getMessageSpeakerAvatar(message)}`
  }

  function buildRenderedMessages(input: ChatMessage[]): ChatRenderItem[] {
    const nextItems: ChatRenderItem[] = []
    let activeGroup: ChatMessageRenderGroup | null = null

    for (const message of input) {
      if (message.kind === 'system') {
        activeGroup = null
        nextItems.push({
          body: message.body,
          createdAt: message.createdAt,
          id: `system_${message.sequence}`,
          type: 'system',
        })
        continue
      }

      if (getMessageDisplayMode(message) === 'kp-narration') {
        activeGroup = null
        nextItems.push({
          body: message.body,
          createdAt: message.createdAt,
          id: `narration_${message.sequence}`,
          isRulingTone: message.kind === 'dice',
          type: 'narration',
        })
        continue
      }

      const groupKey = getMessageGroupKey(message)

      if (!groupKey) {
        continue
      }

      if (!activeGroup || activeGroup.groupKey !== groupKey) {
        activeGroup = {
          groupKey,
          id: `group_${message.sequence}`,
          isOwn: isOwnMessage(message),
          messages: [message],
          speakerAvatar: getMessageSpeakerAvatar(message),
          speakerName: getMessageSpeakerName(message),
          type: 'group',
        }
        nextItems.push(activeGroup)
        continue
      }

      activeGroup.messages.push(message)
    }

    return nextItems
  }

  function persistIdentity(): void {
    localStorage.setItem(CHAT_STORAGE_SESSION_KEY, sessionId)
  }

  function persistActiveRoom(): void {
    localStorage.setItem(CHAT_STORAGE_ROOM_KEY, activeRoomId)
  }

  async function requestAuth(pathname: string, init?: RequestInit): Promise<ChatAuthResponse> {
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

    if (!response.ok) {
      return {
        ...payload,
        ok: false,
      }
    }

    return {
      ...payload,
      ok: true,
    }
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) {
      return
    }

    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function isViewportNearBottom(): boolean {
    if (!messageViewportElement) {
      return true
    }

    const remaining =
      messageViewportElement.scrollHeight -
      messageViewportElement.scrollTop -
      messageViewportElement.clientHeight

    return remaining < 96
  }

  async function scrollMessagesToBottom(behavior: ScrollBehavior = 'smooth'): Promise<void> {
    await tick()

    if (!messageViewportElement) {
      return
    }

    messageViewportElement.scrollTo({
      behavior,
      top: messageViewportElement.scrollHeight,
    })
  }

  async function mergeMessages(incoming: ChatMessage[], options?: { forceScroll?: boolean }): Promise<void> {
    if (incoming.length === 0) {
      return
    }

    const shouldAutoScroll =
      options?.forceScroll === true ||
      isViewportNearBottom() ||
      incoming.some((message) => isOwnMessage(message))

    const nextMessages = [...messages]
    const knownSequences = new Set(messages.map((message) => message.sequence))
    let addedCount = 0
    let addedExternalCount = 0

    for (const message of incoming) {
      if (knownSequences.has(message.sequence)) {
        continue
      }

      knownSequences.add(message.sequence)
      nextMessages.push(message)
      addedCount += 1

      if (!isOwnMessage(message)) {
        addedExternalCount += 1
      }
    }

    if (addedCount === 0) {
      return
    }

    messages = nextMessages.sort((left, right) => left.sequence - right.sequence)

    if (shouldAutoScroll) {
      unreadIncomingCount = 0
      await scrollMessagesToBottom(options?.forceScroll ? 'auto' : 'smooth')
      return
    }

    unreadIncomingCount += addedExternalCount
  }

  function normaliseMessages(incoming: ChatMessage[]): ChatMessage[] {
    const messagesBySequence = new Map<number, ChatMessage>()

    for (const message of incoming) {
      messagesBySequence.set(message.sequence, message)
    }

    return [...messagesBySequence.values()].sort((left, right) => left.sequence - right.sequence)
  }

  async function replaceMessages(incoming: ChatMessage[]): Promise<void> {
    messages = normaliseMessages(incoming)
    unreadIncomingCount = 0
    await scrollMessagesToBottom('auto')
  }

  function applyCharacterState(payload: {
    activeCharacterId: string | null
    characterCards: ChatCharacterCard[]
    currentUser: ChatUser
  }): void {
    currentUser = payload.currentUser
    characterCards = payload.characterCards
    activeCharacterId = payload.activeCharacterId
  }

  function updateCharacterAttribute(key: AttributeKey, value: string): void {
    createCharacterAttributesDraft = {
      ...createCharacterAttributesDraft,
      [key]: normaliseAttributeDraft(value),
    }
  }

  function handleCharacterAttributeInput(key: AttributeKey, event: Event): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    updateCharacterAttribute(key, target.value)
  }

  function handleEditCharacterAttributeInput(key: AttributeKey, event: Event): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    editCharacterAttributesDraft = {
      ...editCharacterAttributesDraft,
      [key]: normaliseAttributeDraft(target.value),
    }
  }

  function handleCharacterNameInput(event: Event): void {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    if (isCreateCharacterPromptOpen) {
      createCharacterNameDraft = target.value
      return
    }

    editCharacterNameDraft = target.value
  }

  function clearCreateCharacterAvatar(): void {
    createCharacterAvatarDataUrl = ''

    if (createCharacterAvatarInputElement) {
      createCharacterAvatarInputElement.value = ''
    }
  }

  function clearEditCharacterAvatar(): void {
    editCharacterAvatarDataUrl = ''

    if (editCharacterAvatarInputElement) {
      editCharacterAvatarInputElement.value = ''
    }
  }

  function triggerCreateCharacterAvatarPicker(): void {
    createCharacterAvatarInputElement?.click()
  }

  function triggerEditCharacterAvatarPicker(): void {
    editCharacterAvatarInputElement?.click()
  }

  function readAvatarFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.addEventListener('load', () => {
        const result = typeof reader.result === 'string' ? reader.result : ''

        if (result === '') {
          reject(new Error('EMPTY_RESULT'))
          return
        }

        resolve(result)
      })

      reader.addEventListener('error', () => {
        reject(new Error('READ_FAILED'))
      })

      reader.readAsDataURL(file)
    })
  }

  async function handleCreateCharacterAvatarChange(event: Event): Promise<void> {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const file = target.files?.[0] ?? null

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      createCharacterError = '请选择图片文件作为角色头像。'
      return
    }

    try {
      const avatarDataUrl = await readAvatarFileAsDataUrl(file)
      await openAvatarCropPrompt('create', avatarDataUrl)
      createCharacterError = ''
    } catch {
      createCharacterError = '头像读取失败，请换一张图片后重试。'
    } finally {
      target.value = ''
    }
  }

  async function handleEditCharacterAvatarChange(event: Event): Promise<void> {
    const target = event.currentTarget

    if (!(target instanceof HTMLInputElement)) {
      return
    }

    const file = target.files?.[0] ?? null

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      editCharacterError = '请选择图片文件作为角色头像。'
      return
    }

    try {
      const avatarDataUrl = await readAvatarFileAsDataUrl(file)
      await openAvatarCropPrompt('edit', avatarDataUrl)
      editCharacterError = ''
    } catch {
      editCharacterError = '头像读取失败，请换一张图片后重试。'
    } finally {
      target.value = ''
    }
  }

  function handleWindowClick(event: MouseEvent): void {
    if (!isCharacterMenuOpen || !characterMenuElement) {
      return
    }

    const target = event.target

    if (!(target instanceof Node)) {
      return
    }

    if (!characterMenuElement.contains(target)) {
      isCharacterMenuOpen = false
    }
  }

  async function restoreAuthSession(): Promise<boolean> {
    isAuthChecking = true

    try {
      const payload = await requestAuth('/auth/me', { method: 'GET' })

      if (!payload.ok || payload.authenticated !== true || !payload.currentUser) {
        currentUser = null
        manageableUsers = []
        roomPermissions = []
        return false
      }

      currentUser = payload.currentUser
      authError = ''
      return true
    } catch {
      authError = '身份校验失败，请确认聊天服务已启动。'
      currentUser = null
      manageableUsers = []
      roomPermissions = []
      return false
    } finally {
      isAuthChecking = false
    }
  }

  async function submitAccessKey(): Promise<void> {
    const safeAccessKey = accessKeyDraft.trim()

    if (safeAccessKey === '') {
      authError = '请输入访问密钥后再继续。'
      return
    }

    isAuthChecking = true
    authError = ''

    try {
      const payload = await requestAuth('/auth/access-key', {
        body: JSON.stringify({ accessKey: safeAccessKey }),
        method: 'POST',
      })

      if (!payload.ok || !payload.currentUser) {
        authError =
          payload.retryAfterMs && payload.retryAfterMs > 0
            ? `${payload.message ?? '密钥验证次数过多，请稍后再试。'}`
            : payload.message ?? '访问密钥无效或已失效。'
        return
      }

      currentUser = payload.currentUser
      nickname = resolveChatNicknameFromUser(payload.currentUser)
      manageableUsers = []
      roomPermissions = []
      accessKeyDraft = ''
      authError = ''
      isAuthPromptOpen = false

      if (sessionId === '') {
        sessionId = createChatSessionId()
      }

      persistIdentity()
      shouldReconnect = true
      void connectToChat(messages.length > 0)
    } catch {
      authError = '访问密钥验证失败，请确认聊天服务已启动。'
    } finally {
      isAuthChecking = false
    }
  }

  function openAuthPrompt(): void {
    closeMobileDrawers()
    accessKeyDraft = ''
    authError = ''
    isAuthPromptOpen = true
  }

  function scheduleReconnect(): void {
    clearReconnectTimer()
    connectionState = 'reconnecting'
    reconnectTimer = window.setTimeout(() => {
      void connectToChat(true)
    }, 1600)
  }

  function closeSocket(): void {
    socketSerial += 1
    const currentSocket = socket
    socket = null
    currentSocket?.close()
  }

  async function handleServerPayload(payload: ChatServerPayload): Promise<void> {
    if (payload.type === 'auth_required') {
      shouldReconnect = false
      currentUser = null
      nickname = ''
      manageableUsers = []
      roomPermissions = []
      connectionState = 'disconnected'
      connectionError = payload.message
      isAuthPromptOpen = true
      closeSocket()
      return
    }

    if (payload.type === 'joined') {
      const isSameRoom = room.id === payload.room.id
      room = payload.room
      rooms = payload.rooms.length > 0 ? payload.rooms : [payload.room]
      activeRoomId = payload.room.id
      applyCharacterState(payload)
      members = payload.members
      connectionState = 'connected'
      connectionError = ''
      createRoomError = ''
      createCharacterError = ''
      editCharacterError = ''
      roomPermissionsError = ''
      isCreateRoomPromptOpen = false
      clearCreateCharacterAvatar()
      clearEditCharacterAvatar()
      isCharacterMenuOpen = false
      persistActiveRoom()

      if (isSameRoom) {
        await mergeMessages(payload.messages, { forceScroll: messages.length === 0 })
      } else {
        await replaceMessages(payload.messages)
      }
      return
    }

    if (payload.type === 'character_state') {
      applyCharacterState(payload)
      if (closeCharacterEditorOnNextState) {
        closeCharacterEditorOnNextState = false
        closeCharacterSheet()
      }
      createCharacterError = ''
      editCharacterError = ''
      isCharacterMenuOpen = false
      return
    }

    if (payload.type === 'message') {
      await mergeMessages([payload.message])
      return
    }

    if (payload.type === 'presence') {
      if (payload.roomId === room.id) {
        members = payload.members
      }

      rooms = rooms.map((entry) =>
        entry.id === payload.roomId
          ? {
              ...entry,
              memberCount: payload.members.length,
            }
          : entry,
      )
      room = rooms.find((entry) => entry.id === activeRoomId) ?? room
      return
    }

    if (payload.type === 'rooms') {
      rooms = payload.rooms.length > 0 ? payload.rooms : [ROOM_PLACEHOLDER]
      room = rooms.find((entry) => entry.id === activeRoomId) ?? room
      return
    }

    if (payload.type === 'room_permissions_state') {
      manageableUsers = payload.manageableUsers
      roomPermissions = payload.roomPermissions

      if (isRoomPermissionsPromptOpen && roomPermissionsRoomId !== '') {
        roomPermissionsDraftUserIds = [...getAllowedUserIdsForRoom(roomPermissionsRoomId, payload.roomPermissions)]
        roomPermissionsError = ''
      }

      return
    }

    if (payload.type === 'room_history_cleared') {
      rooms = rooms.map((entry) =>
        entry.id === payload.roomId
          ? {
              ...entry,
              latestMessageAt: null,
            }
          : entry,
      )
      room = rooms.find((entry) => entry.id === activeRoomId) ?? room

      if (payload.roomId === activeRoomId) {
        messages = []
        unreadIncomingCount = 0
      }

      if (isRoomPermissionsPromptOpen && roomPermissionsRoomId === payload.roomId) {
        closeRoomPermissionsPrompt()
      }

      return
    }

    if (isCreateRoomPromptOpen) {
      if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
        connectionState = 'connected'
      }
      createRoomError = payload.message
      return
    }

    if (isCreateCharacterPromptOpen) {
      if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
        connectionState = 'connected'
      }
      createCharacterError = payload.message
      closeCharacterEditorOnNextState = false
      return
    }

    if (isEditCharacterPromptOpen) {
      if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
        connectionState = 'connected'
      }
      editCharacterError = payload.message
      closeCharacterEditorOnNextState = false
      return
    }

    if (isRoomPermissionsPromptOpen) {
      if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
        connectionState = 'connected'
      }
      roomPermissionsError = payload.message
      return
    }

    if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
      connectionState = 'connected'
    }
    connectionError = payload.message
  }

  async function connectToChat(isReconnect = false): Promise<void> {
    if (!currentUser) {
      isAuthPromptOpen = true
      return
    }

    const resolvedNickname = resolveChatNicknameFromUser(currentUser)

    if (resolvedNickname === '') {
      connectionError = '当前账号缺少可用昵称，请检查用户配置。'
      return
    }

    nickname = resolvedNickname

    clearReconnectTimer()

    const previousSocket = socket
    socketSerial += 1
    const currentSerial = socketSerial

    socket = null
    previousSocket?.close()

    connectionState = isReconnect ? 'reconnecting' : 'connecting'
    connectionError = ''

    const nextSocket = new WebSocket(buildChatWebSocketUrl())
    socket = nextSocket

    nextSocket.addEventListener('open', () => {
      if (socketSerial !== currentSerial) {
        nextSocket.close()
        return
      }

      nextSocket.send(
        JSON.stringify({
          afterSequence: room.id === activeRoomId ? messages.at(-1)?.sequence ?? 0 : 0,
          nickname,
          roomId: activeRoomId,
          sessionId,
          type: 'join',
        }),
      )
    })

    nextSocket.addEventListener('message', async (event) => {
      if (socketSerial !== currentSerial) {
        return
      }

      try {
        const payload = JSON.parse(event.data as string) as ChatServerPayload
        await handleServerPayload(payload)
      } catch {
        connectionError = '群聊返回了无法解析的消息。'
      }
    })

    nextSocket.addEventListener('error', () => {
      if (socketSerial !== currentSerial) {
        return
      }

      connectionError = '群聊连接失败，请确认聊天服务已启动。'
    })

    nextSocket.addEventListener('close', () => {
      if (socketSerial !== currentSerial) {
        return
      }

      socket = null

      if (!shouldReconnect || !currentUser) {
        connectionState = 'disconnected'
        return
      }

      scheduleReconnect()
    })
  }

  function openCreateRoomPrompt(): void {
    closeMobileDrawers()
    createRoomDraft = ''
    createRoomError = ''
    isCreateRoomPromptOpen = true
  }

  function openCreateCharacterPrompt(): void {
    closeMobileDrawers()
    isCharacterMenuOpen = false
    isEditCharacterPromptOpen = false
    closeCharacterEditorOnNextState = false
    clearCreateCharacterAvatar()
    createCharacterNameDraft = ''
    createCharacterAttributesDraft = createEmptyCharacterAttributes()
    createCharacterError = ''
    isCreateCharacterPromptOpen = true
  }

  function openEditCharacterPrompt(character: ChatCharacterCard): void {
    closeMobileDrawers()
    isCharacterMenuOpen = false
    isCreateCharacterPromptOpen = false
    closeCharacterEditorOnNextState = false
    clearEditCharacterAvatar()
    editCharacterId = character.id
    editCharacterNameDraft = character.name
    editCharacterAttributesDraft = cloneCharacterAttributes(character.attributes)
    editCharacterAvatarDataUrl = character.avatarDataUrl ?? ''
    editCharacterError = ''
    isEditCharacterPromptOpen = true
  }

  function closeCreateCharacterPrompt(): void {
    closeCharacterSheet()
  }

  function closeEditCharacterPrompt(): void {
    closeCharacterSheet()
  }

  function toggleCharacterMenu(): void {
    isCharacterMenuOpen = !isCharacterMenuOpen
  }

  function handleCreateRoomSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitCreateRoom()
  }

  function handleCreateCharacterSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitCreateCharacter()
  }

  function handleEditCharacterSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitEditCharacter()
  }

  function handleAccessKeySubmit(event: SubmitEvent): void {
    event.preventDefault()
    void submitAccessKey()
  }

  function handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()
    void sendMessage()
  }

  function handleMessageSubmit(event: SubmitEvent): void {
    event.preventDefault()
    void sendMessage()
  }

  function switchActiveCharacter(nextCharacterId: string): void {
    const safeCharacterId = nextCharacterId.trim()

    if (safeCharacterId === '' || safeCharacterId === activeCharacterId) {
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      connectionError = '当前未连接群聊，无法切换角色。'
      return
    }

    isCharacterMenuOpen = false

    socket.send(
      JSON.stringify({
        characterId: safeCharacterId,
        type: 'switch_character',
      }),
    )
  }

  async function sendMessage(): Promise<void> {
    const messageBody = draftMessage.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH)

    if (messageBody === '') {
      connectionError = '消息不能为空。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      connectionError = '当前未连接群聊，无法发送消息。'
      return
    }

    socket.send(
      JSON.stringify({
        body: messageBody,
        roomId: room.id,
        type: 'send_message',
      }),
    )

    draftMessage = ''
    connectionError = ''
    await scrollMessagesToBottom()
  }

  function switchRoom(nextRoomId: string): void {
    const targetRoomId = nextRoomId.trim()

    if (targetRoomId === '' || targetRoomId === activeRoomId) {
      return
    }

    closeMobileDrawers()
    activeRoomId = targetRoomId
    persistActiveRoom()
    unreadIncomingCount = 0
    createRoomError = ''
    connectionError = ''

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      void connectToChat(false)
      return
    }

    connectionState = 'connecting'
    messages = []
    members = []

    socket.send(
      JSON.stringify({
        afterSequence: 0,
        nickname,
        roomId: targetRoomId,
        sessionId,
        type: 'join',
      }),
    )
  }

  function submitCreateRoom(): void {
    const roomName = sanitiseRoomName(createRoomDraft)

    if (roomName === '') {
      createRoomError = '请输入房间名称后再创建。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      createRoomError = '当前未连接群聊，无法创建房间。'
      return
    }

    connectionState = 'connecting'
    createRoomError = ''
    createRoomDraft = roomName

    socket.send(
      JSON.stringify({
        name: roomName,
        type: 'create_room',
      }),
    )
  }

  function submitCreateCharacter(): void {
    const characterName = sanitiseCharacterName(createCharacterNameDraft)

    if (characterName === '') {
      createCharacterError = '请输入角色卡名称后再创建。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      createCharacterError = '当前未连接群聊，无法创建角色卡。'
      return
    }

    createCharacterError = ''
    closeCharacterEditorOnNextState = true

    socket.send(
      JSON.stringify({
        attributes: createCharacterAttributesDraft,
        avatarDataUrl: createCharacterAvatarDataUrl || null,
        name: characterName,
        type: 'create_character_card',
      }),
    )
  }

  function submitEditCharacter(): void {
    const characterName = sanitiseCharacterName(editCharacterNameDraft)

    if (editCharacterId === '') {
      editCharacterError = '目标角色卡不存在。'
      return
    }

    if (characterName === '') {
      editCharacterError = '请输入角色卡名称后再保存。'
      return
    }

    if (!socket || socket.readyState !== WebSocket.OPEN || connectionState !== 'connected') {
      editCharacterError = '当前未连接群聊，无法编辑角色卡。'
      return
    }

    editCharacterError = ''
    closeCharacterEditorOnNextState = true

    socket.send(
      JSON.stringify({
        attributes: editCharacterAttributesDraft,
        avatarDataUrl: editCharacterAvatarDataUrl || null,
        characterId: editCharacterId,
        name: characterName,
        type: 'update_character_card',
      }),
    )
  }

  function handleMessageViewportScroll(): void {
    if (!isViewportNearBottom()) {
      return
    }

    unreadIncomingCount = 0
  }

  onMount(() => {
    sessionId = localStorage.getItem(CHAT_STORAGE_SESSION_KEY) ?? ''
    activeRoomId = localStorage.getItem(CHAT_STORAGE_ROOM_KEY)?.trim() || PUBLIC_CHAT_ROOM_ID

    void (async () => {
      const hasAuthSession = await restoreAuthSession()

      if (!hasAuthSession) {
        isAuthPromptOpen = true
        return
      }

      isAuthPromptOpen = false
      nickname = resolveChatNicknameFromUser(currentUser)

      if (sessionId === '') {
        sessionId = createChatSessionId()
        persistIdentity()
      }

      shouldReconnect = true
      void connectToChat()
    })()
  })

  onDestroy(() => {
    shouldReconnect = false
    clearReconnectTimer()
    closeSocket()
    clearCreateCharacterAvatar()
    clearEditCharacterAvatar()
  })

  $: canSend = draftMessage.trim() !== '' && connectionState === 'connected'
  $: roomList = rooms.length === 0 ? [ROOM_PLACEHOLDER] : rooms
  $: activeCharacter =
    activeCharacterId === null ? null : characterCards.find((entry) => entry.id === activeCharacterId) ?? null
  $: renderedMessages = buildRenderedMessages(messages)

  function toggleLeftDrawer(): void {
    isLeftDrawerOpen = !isLeftDrawerOpen
    if (isLeftDrawerOpen) {
      isRightDrawerOpen = false
    }
  }

  function toggleRightDrawer(): void {
    isRightDrawerOpen = !isRightDrawerOpen
    if (isRightDrawerOpen) {
      isLeftDrawerOpen = false
    }
  }

  function closeMobileDrawers(): void {
    isLeftDrawerOpen = false
    isRightDrawerOpen = false
  }
</script>

<svelte:window onclick={handleWindowClick} />

<section class="chat-page !flex !h-full !w-full !min-h-0 !flex-1 !overflow-hidden">
  <section class="board chat-board !m-0 !flex !h-full !w-full !min-h-0 !flex-1 !flex-col !overflow-hidden">
    <div class="flex h-14 shrink-0 items-center justify-between md:hidden">
      <button aria-label="打开房间列表" class="toolbar-action flex-shrink-0" type="button" onclick={toggleLeftDrawer}>
        房间
      </button>
      <strong class="min-w-0 flex-1 truncate text-center">{room.name}</strong>
      <button aria-label="打开在线成员列表" class="toolbar-action flex-shrink-0" type="button" onclick={toggleRightDrawer}>
        成员
      </button>
    </div>

    {#if isLeftDrawerOpen || isRightDrawerOpen}
      <button
        aria-label="关闭侧边栏"
        class="fixed inset-0 z-[45] md:hidden"
        style="background: rgba(15, 23, 42, 0.34);"
        type="button"
        onclick={closeMobileDrawers}
      ></button>
    {/if}

    <div class="chat-layout !flex !min-h-0 !flex-1 !overflow-hidden">
      <aside
        class={`chat-panel chat-room-panel fixed inset-y-0 left-0 z-50 !flex !flex-col !overflow-hidden transition-transform duration-300 ${
          isLeftDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        } w-[80vw] max-w-80 md:relative md:inset-auto md:z-auto md:!h-full md:!w-72 md:!shrink-0 md:!translate-x-0`}
      >
        <div class="chat-panel-head">
          <div>
            <span class="section-label">房间</span>
            <strong>群聊列表</strong>
          </div>
          <div class="chat-panel-head-actions">
            <span>{roomList.length} 个房间</span>
            <button
              class="toolbar-action"
              disabled={connectionState !== 'connected'}
              type="button"
              onclick={openCreateRoomPrompt}
            >
              新建房间
            </button>
          </div>
        </div>

        <div class="chat-room-list !flex-1">
          {#each roomList as entry (entry.id)}
            <div
              class:is-active={entry.id === activeRoomId}
              class="chat-room-card"
            >
              <div class="chat-room-card-head">
                <div class="chat-room-card-meta">
                  <strong>{entry.name}</strong>
                  <span>{entry.memberCount} 人在线</span>
                </div>
                {#if isAdminUser}
                  <button
                    aria-label={`管理 ${entry.name} 的可见权限`}
                    class="chat-room-card-action"
                    type="button"
                    onclick={(event) => openRoomPermissionsPrompt(entry, event)}
                  >
                    权限
                  </button>
                {/if}
              </div>

              <div
                aria-label={`进入 ${entry.name}`}
                class="chat-room-card-main"
                onkeydown={(event) => handleRoomCardKeydown(entry.id, event)}
                onclick={() => switchRoom(entry.id)}
                role="button"
                tabindex="0"
              >
                <span>
                  {entry.latestMessageAt === null
                    ? '暂无消息'
                    : `最近消息 ${formatChatTimestamp(entry.latestMessageAt)}`}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </aside>

      <section class="chat-panel chat-message-panel !flex !h-full !min-h-0 !flex-1 !flex-col !overflow-hidden border-x border-gray-200">
        {#if isCreateCharacterPromptOpen || isEditCharacterPromptOpen}
          {@const activeCharacterDraft = getActiveCharacterAttributesDraft()}
          <div class="chat-character-sheet-page !flex-1">
            <div class="chat-character-sheet-head">
              <div>
                <span class="section-label">角色子页</span>
                <strong>{getCharacterSheetHeading()}</strong>
                <p>{getCharacterSheetDescription()}</p>
              </div>
              <button class="toolbar-action" type="button" onclick={closeCharacterSheet}>
                返回群聊
              </button>
            </div>

            <form
              class="chat-character-sheet-form"
              onsubmit={isCreateCharacterPromptOpen ? handleCreateCharacterSubmit : handleEditCharacterSubmit}
            >
              <label class="chat-nickname-field">
                <span>角色名</span>
                <input
                  maxlength={CHAT_CHARACTER_NAME_MAX_LENGTH}
                  oninput={handleCharacterNameInput}
                  placeholder="例如：周明 / 林雾 / 宋澈"
                  type="text"
                  value={isCreateCharacterPromptOpen ? createCharacterNameDraft : editCharacterNameDraft}
                />
              </label>

              <div class="chat-character-avatar-block">
                <div>
                  <span class="section-label">角色头像</span>
                  <p>支持简单移动和裁切。保存后，后续发送的聊天消息会使用新的头像快照。</p>
                </div>

                <div class="chat-character-avatar-row">
                  <button
                    class="chat-character-avatar-picker"
                    type="button"
                    onclick={isCreateCharacterPromptOpen ? triggerCreateCharacterAvatarPicker : triggerEditCharacterAvatarPicker}
                  >
                    {#if getActiveCharacterAvatarDataUrl() !== ''}
                      <img alt="角色头像预览" src={getActiveCharacterAvatarDataUrl()} />
                    {:else}
                      <div class="chat-character-avatar-placeholder">
                        <strong>+</strong>
                        <span>选择头像并裁切</span>
                      </div>
                    {/if}
                  </button>

                  <div class="chat-character-avatar-copy">
                    <strong>{getActiveCharacterDraftName() === '' ? '先设置角色信息' : getActiveCharacterDraftName()}</strong>
                    <span>头像裁切是客户端即时完成的。你可以拖动画面调整构图，再保存到角色卡。</span>
                  </div>
                </div>

                {#if isCreateCharacterPromptOpen}
                  <input
                    bind:this={createCharacterAvatarInputElement}
                    accept="image/*"
                    class="chat-character-avatar-input"
                    onchange={handleCreateCharacterAvatarChange}
                    type="file"
                  />
                {:else}
                  <input
                    bind:this={editCharacterAvatarInputElement}
                    accept="image/*"
                    class="chat-character-avatar-input"
                    onchange={handleEditCharacterAvatarChange}
                    type="file"
                  />
                {/if}
              </div>

              <div class="chat-character-grid">
                {#each ATTRIBUTE_FIELDS as field}
                  <label class="chat-character-field">
                    <span>{field.label}</span>
                    <input
                      max="100"
                      min="0"
                      oninput={(event) =>
                        isCreateCharacterPromptOpen
                          ? handleCharacterAttributeInput(field.key, event)
                          : handleEditCharacterAttributeInput(field.key, event)}
                      type="number"
                      value={activeCharacterDraft[field.key]}
                    />
                  </label>
                {/each}
              </div>

              {#if isCreateCharacterPromptOpen && createCharacterError !== ''}
                <div class="chat-nickname-error">{createCharacterError}</div>
              {/if}

              {#if isEditCharacterPromptOpen && editCharacterError !== ''}
                <div class="chat-nickname-error">{editCharacterError}</div>
              {/if}

              <div class="chat-character-sheet-actions">
                <button class="toolbar-action" type="button" onclick={closeCharacterSheet}>
                  取消
                </button>
                <button class="toolbar-action toolbar-primary" type="submit">
                  {isCreateCharacterPromptOpen ? '创建角色卡' : '保存修改'}
                </button>
              </div>
            </form>
          </div>
        {:else}
          <div class="chat-message-head hidden flex-shrink-0 md:flex">
            <div>
              <span class="section-label">当前房间</span>
              <strong>{room.name}</strong>
            </div>
            <span>{members.length} 人在线</span>
          </div>

          <div
            bind:this={messageViewportElement}
            class="chat-message-viewport !flex-1 !overflow-y-auto !p-4"
            onscroll={handleMessageViewportScroll}
          >
            {#if messages.length === 0}
              <div class="chat-empty-state">
                <div aria-hidden="true" class="chat-empty-state-icon">
                  <svg fill="none" viewBox="0 0 48 48">
                    <rect x="10" y="12" width="28" height="20" rx="10"></rect>
                    <path d="M18 32v6l8-6"></path>
                  </svg>
                </div>
                <strong>  群聊还没有消息。</strong>
                <p>破坏一片空白会让你快乐吗？</p>
              </div>
            {:else}
              <div class="chat-message-list !p-0">
                {#each renderedMessages as item (item.id)}
                  {#if item.type === 'system'}
                    <div class="chat-system-message">
                      <span>{item.body}</span>
                      <time datetime={new Date(item.createdAt).toISOString()}>
                        {formatChatTimestamp(item.createdAt)}
                      </time>
                    </div>
                  {:else if item.type === 'narration'}
                    <div class:has-ruling-tone={item.isRulingTone} class="chat-message-narration">
                      <p use:autoIndentMessage class="chat-message-text">{item.body}</p>
                    </div>
                  {:else}
                    <article class:is-own={item.isOwn} class="chat-message-group">
                      <div class="chat-message-avatar-slot">
                        <div class="chat-message-avatar">
                          {#if item.speakerAvatar !== ''}
                            <img alt={`${item.speakerName} 头像`} src={item.speakerAvatar} />
                          {:else}
                            <span>{getSpeakerInitial(item.speakerName)}</span>
                          {/if}
                        </div>
                      </div>

                      <div class="chat-message-column">
                        <div class="chat-message-meta">
                          <strong>{item.speakerName}</strong>
                          <time datetime={new Date(item.messages[0].createdAt).toISOString()}>
                            {formatChatTimestamp(item.messages[0].createdAt)}
                          </time>
                        </div>

                        <div class="chat-message-bubble-list">
                          {#each item.messages as message (message.sequence)}
                            <div class:chat-dice-bubble={message.kind === 'dice'} class="chat-message-bubble">
                              {#if message.kind === 'dice'}
                                <span class="chat-message-kind">检定结果</span>
                              {/if}
                              <p use:autoIndentMessage class="chat-message-text">{message.body}</p>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </article>
                  {/if}
                {/each}
              </div>
            {/if}
          </div>

          {#if unreadIncomingCount > 0}
            <button class="chat-new-message-chip" type="button" onclick={() => scrollMessagesToBottom()}>
              有 {unreadIncomingCount} 条新消息
            </button>
          {/if}

          <form class="chat-composer !shrink-0 !p-4" onsubmit={handleMessageSubmit}>
            <div bind:this={characterMenuElement} class="chat-character-menu">
              <button
                aria-expanded={isCharacterMenuOpen}
                class="chat-character-trigger"
                disabled={connectionState !== 'connected'}
                type="button"
                onclick={toggleCharacterMenu}
              >
                <span>
                  {activeCharacter
                    ? `当前角色：${activeCharacter.name}${isKpNarrationCharacter(activeCharacter) ? ' · KP旁白' : ''}`
                    : '当前角色：未设置'}
                </span>
                <span aria-hidden="true">{isCharacterMenuOpen ? '▴' : '▾'}</span>
              </button>

              {#if isCharacterMenuOpen}
                <div class="chat-character-dropdown">
                  {#if characterCards.length === 0}
                    <div class="chat-character-empty">当前还没有角色卡。</div>
                  {:else}
                    {#each characterCards as character (character.id)}
                      <div class="chat-character-option">
                        <button
                          class:is-active={character.id === activeCharacterId}
                          class="chat-character-option-main"
                          type="button"
                          onclick={() => switchActiveCharacter(character.id)}
                        >
                          <strong>{character.name}</strong>
                          <span>
                            {character.id === activeCharacterId
                              ? isKpNarrationCharacter(character)
                                ? '当前使用 / KP旁白模式'
                                : '当前使用'
                              : isKpNarrationCharacter(character)
                                ? '切换到 KP 旁白模式'
                                : '切换到该角色'}
                          </span>
                        </button>

                        <button
                          aria-label={`编辑角色 ${character.name}`}
                          class="chat-character-option-edit"
                          type="button"
                          onclick={() => openEditCharacterPrompt(character)}
                        >
                          ⚙
                        </button>
                      </div>
                    {/each}
                  {/if}

                  <div class="chat-character-dropdown-footer">
                    <button class="chat-character-create" type="button" onclick={openCreateCharacterPrompt}>
                      + 新建角色卡
                    </button>
                  </div>
                </div>
              {/if}
            </div>

            <label class="chat-composer-field">
              <textarea
                bind:value={draftMessage}
                maxlength={CHAT_MAX_MESSAGE_LENGTH}
                onkeydown={handleComposerKeydown}
                placeholder="Shift + Enter 换行"
                rows="3"
              ></textarea>
            </label>

            <div class="chat-composer-actions">
              <span>{draftMessage.trim().length}/{CHAT_MAX_MESSAGE_LENGTH}</span>
              <button class="toolbar-action toolbar-primary" disabled={!canSend} type="submit">
                发送
              </button>
            </div>
          </form>
        {/if}
      </section>

      <aside
        class={`chat-panel chat-member-panel fixed inset-y-0 right-0 z-50 !flex !flex-col !overflow-hidden transition-transform duration-300 ${
          isRightDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        } w-[80vw] max-w-72 md:relative md:inset-auto md:z-auto md:!h-full md:!w-60 md:!shrink-0 md:!translate-x-0`}
      >
        <div class="chat-panel-head">
          <div>
            <span class="section-label">在线成员</span>
            <strong>当前在线</strong>
          </div>
          <span>{members.length} 人</span>
        </div>

        <div class="chat-member-list !flex-1">
          {#if members.length === 0}
            <div class="chat-empty-inline">当前还没有在线成员。</div>
          {:else}
            {#each members as member (member.sessionId)}
              <div class="chat-member-item">
                <strong>{member.nickname}</strong>
                <span>{member.sessionId === sessionId ? '你' : '在线中'}</span>
              </div>
            {/each}
          {/if}
        </div>
      </aside>
    </div>
  </section>

  <div class="pointer-events-none fixed bottom-4 right-4 z-30 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
    {#if connectionError !== ''}
      <div class="chat-error-banner pointer-events-auto max-w-sm">{connectionError}</div>
    {/if}

    <div class="pointer-events-auto rounded-xl border border-slate-200 bg-white/94 p-1.5 shadow-[0_14px_28px_rgba(15,23,42,0.1)] backdrop-blur">
      <button
        class="inline-flex min-h-8 items-center justify-center rounded-lg bg-slate-900 px-3 py-1.5 text-[0.75rem] font-medium text-white transition hover:bg-slate-700"
        type="button"
        onclick={openAuthPrompt}
      >
        {currentUser ? '更换密钥' : '输入密钥'}
      </button>
    </div>
  </div>

  {#if isAuthPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog" onsubmit={handleAccessKeySubmit}>
        <div>
          <span class="section-label">身份验证</span>
          <h3>先输入访问密钥</h3>
          <p>密钥只需要输入一次。验证成功后，当前设备会保留登录态，后续直接恢复，不需要重复输入。</p>
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
          {#if currentUser}
            <button class="toolbar-action" type="button" onclick={() => (isAuthPromptOpen = false)}>
              取消
            </button>
          {/if}
          <button class="toolbar-action toolbar-primary" disabled={isAuthChecking} type="submit">
            {isAuthChecking ? '验证中…' : '验证并继续'}
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if isCreateRoomPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog" onsubmit={handleCreateRoomSubmit}>
        <div>
          <span class="section-label">新建房间</span>
          <h3>创建一个群聊</h3>
          <p>创建后会自动进入该房间；管理员可以继续为普通用户分配可见权限。</p>
        </div>

        <label class="chat-nickname-field">
          <span>房间名称</span>
          <input bind:value={createRoomDraft} maxlength={CHAT_ROOM_NAME_MAX_LENGTH} placeholder="例如：测试 / 设定讨论 / 剧情闲聊" type="text" />
        </label>

        {#if createRoomError !== ''}
          <div class="chat-nickname-error">{createRoomError}</div>
        {/if}

        <div class="chat-nickname-actions">
          <button class="toolbar-action" type="button" onclick={() => (isCreateRoomPromptOpen = false)}>
            取消
          </button>
          <button class="toolbar-action toolbar-primary" type="submit">创建并进入</button>
        </div>
      </form>
    </div>
  {/if}

  {#if isRoomPermissionsPromptOpen}
    {@const selectedRoom = roomList.find((entry) => entry.id === roomPermissionsRoomId) ?? null}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog chat-room-permissions-dialog" onsubmit={handleRoomPermissionsSubmit}>
        <div>
          <span class="section-label">房间权限</span>
          <h3>{selectedRoom ? `管理「${selectedRoom.name}」的可见用户` : '管理房间可见权限'}</h3>
          <p>未被勾选的用户将直接看不到这个房间，也没有进入入口。</p>
        </div>

        <div class="chat-room-permissions-list">
          {#if manageableUsers.length === 0}
            <div class="chat-empty-inline">当前没有可分配的普通用户。</div>
          {:else}
            {#each manageableUsers as user (user.id)}
              <label class="chat-room-permissions-user">
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.handle}</span>
                </div>
                <input
                  checked={roomPermissionsDraftUserIds.includes(user.id)}
                  onchange={(event) => handleRoomPermissionsToggle(user.id, event)}
                  type="checkbox"
                />
              </label>
            {/each}
          {/if}
        </div>

        {#if roomPermissionsError !== ''}
          <div class="chat-nickname-error">{roomPermissionsError}</div>
        {/if}

        <div class="chat-nickname-actions">
          <button class="toolbar-action" type="button" onclick={clearRoomHistory}>
            清空记录
          </button>
          <button class="toolbar-action" type="button" onclick={closeRoomPermissionsPrompt}>
            关闭
          </button>
          <button class="toolbar-action toolbar-primary" type="submit">
            保存权限
          </button>
        </div>
      </form>
    </div>
  {/if}

  {#if isAvatarCropPromptOpen}
    <div class="chat-nickname-overlay">
      <div class="chat-nickname-dialog chat-avatar-crop-dialog">
        <div>
          <span class="section-label">头像裁切</span>
          <h3>调整头像位置</h3>
          <p>拖动画面决定取景，滑块用于微调放大倍率。</p>
        </div>

        <div
          aria-label="头像裁切画布"
          bind:clientWidth={avatarCropSurfaceWidth}
          class="chat-avatar-crop-surface"
          onpointercancel={handleAvatarCropPointerUp}
          onpointerdown={handleAvatarCropPointerDown}
          onpointermove={handleAvatarCropPointerMove}
          onpointerup={handleAvatarCropPointerUp}
          role="application"
        >
          {#if avatarCropSourceDataUrl !== ''}
            <img
              alt="待裁切头像"
              src={avatarCropSourceDataUrl}
              style:height={`${avatarCropPreviewHeight}px`}
              style:transform={avatarCropPreviewTransform}
              style:width={`${avatarCropPreviewWidth}px`}
            />
          {/if}
          <div class="chat-avatar-crop-frame" aria-hidden="true"></div>
        </div>

        <label class="chat-avatar-crop-zoom">
          <span>缩放</span>
          <input
            max="2.8"
            min="1"
            oninput={handleAvatarCropZoomInput}
            step="0.01"
            type="range"
            value={avatarCropZoom}
          />
        </label>

        {#if avatarCropError !== ''}
          <div class="chat-nickname-error">{avatarCropError}</div>
        {/if}

        <div class="chat-nickname-actions">
          <button class="toolbar-action" type="button" onclick={closeAvatarCropPrompt}>
            取消
          </button>
          <button class="toolbar-action toolbar-primary" type="button" onclick={() => void confirmAvatarCrop()}>
            应用裁切
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
