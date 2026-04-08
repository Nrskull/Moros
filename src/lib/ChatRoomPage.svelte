<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    buildChatHttpUrl,
    buildChatWebSocketUrl,
    CHAT_CHARACTER_NAME_MAX_LENGTH,
    type ChatCharacterAttributes,
    type ChatCharacterCard,
    CHAT_MAX_MESSAGE_LENGTH,
    CHAT_NICKNAME_MAX_LENGTH,
    CHAT_ROOM_NAME_MAX_LENGTH,
    CHAT_STORAGE_NICKNAME_KEY,
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

  type ChatServerPayload =
    | ChatAuthRequiredPayload
    | ChatCharacterStatePayload
    | ChatErrorPayload
    | ChatJoinedPayload
    | ChatMessagePayload
    | ChatPresencePayload
    | ChatRoomsPayload

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
    name: '公共聊天室',
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
  let nicknameDraft = ''
  let accessKeyDraft = ''
  let draftMessage = ''
  let connectionState: ChatConnectionState = 'disconnected'
  let connectionError = ''
  let authError = ''
  let isAuthChecking = true
  let currentUser: ChatUser | null = null
  let characterCards: ChatCharacterCard[] = []
  let activeCharacterId: string | null = null
  let messages: ChatMessage[] = []
  let members: ChatMember[] = []
  let unreadIncomingCount = 0
  let isAuthPromptOpen = false
  let isNicknamePromptOpen = false
  let isCreateRoomPromptOpen = false
  let createRoomDraft = ''
  let createRoomError = ''
  let isCreateCharacterPromptOpen = false
  let createCharacterNameDraft = ''
  let createCharacterError = ''
  let createCharacterAttributesDraft: ChatCharacterAttributes = createEmptyCharacterAttributes()
  let isEditCharacterPromptOpen = false
  let editCharacterId = ''
  let editCharacterNameDraft = ''
  let editCharacterError = ''
  let editCharacterAttributesDraft: ChatCharacterAttributes = createEmptyCharacterAttributes()
  let isCharacterMenuOpen = false
  let roomList: ChatRoom[] = [ROOM_PLACEHOLDER]
  let activeCharacter: ChatCharacterCard | null = null

  function sanitiseNickname(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, CHAT_NICKNAME_MAX_LENGTH)
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

  function isOwnMessage(message: ChatMessage): boolean {
    return message.kind !== 'system' && message.sessionId === sessionId
  }

  function shouldShowMessageMeta(index: number): boolean {
    const current = messages[index]
    const previous = messages[index - 1]

    if (!current || current.kind !== 'user') {
      return true
    }

    return !previous || previous.kind !== 'user' || previous.nickname !== current.nickname
  }

  function persistIdentity(): void {
    localStorage.setItem(CHAT_STORAGE_SESSION_KEY, sessionId)
    localStorage.setItem(CHAT_STORAGE_NICKNAME_KEY, nickname)
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
        message: '聊天室认证服务返回了无法解析的响应。',
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
        return false
      }

      currentUser = payload.currentUser
      authError = ''
      return true
    } catch {
      authError = '身份校验失败，请确认聊天服务已启动。'
      currentUser = null
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
      accessKeyDraft = ''
      authError = ''
      isAuthPromptOpen = false

      if (nickname === '') {
        isNicknamePromptOpen = true
        return
      }

      shouldReconnect = true
      void connectToChat(messages.length > 0)
    } catch {
      authError = '访问密钥验证失败，请确认聊天服务已启动。'
    } finally {
      isAuthChecking = false
    }
  }

  function openAuthPrompt(): void {
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
      connectionState = 'disconnected'
      connectionError = payload.message
      isAuthPromptOpen = true
      isNicknamePromptOpen = false
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
      isNicknamePromptOpen = false
      isCreateRoomPromptOpen = false
      isCreateCharacterPromptOpen = false
      isEditCharacterPromptOpen = false
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
      createCharacterError = ''
      editCharacterError = ''
      isCreateCharacterPromptOpen = false
      isEditCharacterPromptOpen = false
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
      return
    }

    if (isEditCharacterPromptOpen) {
      if (socket?.readyState === WebSocket.OPEN && room.id !== '') {
        connectionState = 'connected'
      }
      editCharacterError = payload.message
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

    if (nickname === '') {
      isNicknamePromptOpen = true
      return
    }

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
        connectionError = '聊天室返回了无法解析的消息。'
      }
    })

    nextSocket.addEventListener('error', () => {
      if (socketSerial !== currentSerial) {
        return
      }

      connectionError = '聊天室连接失败，请确认聊天服务已启动。'
    })

    nextSocket.addEventListener('close', () => {
      if (socketSerial !== currentSerial) {
        return
      }

      socket = null

      if (!shouldReconnect || nickname === '') {
        connectionState = 'disconnected'
        return
      }

      scheduleReconnect()
    })
  }

  function submitNickname(): void {
    if (!currentUser) {
      isAuthPromptOpen = true
      return
    }

    const safeNickname = sanitiseNickname(nicknameDraft)

    if (safeNickname === '') {
      connectionError = '请输入昵称后再进入聊天室。'
      return
    }

    if (sessionId === '') {
      sessionId = createChatSessionId()
    }

    nickname = safeNickname
    nicknameDraft = safeNickname
    shouldReconnect = true
    persistIdentity()
    void connectToChat(messages.length > 0)
  }

  function openNicknamePrompt(): void {
    if (!currentUser) {
      isAuthPromptOpen = true
      return
    }

    nicknameDraft = nickname
    isNicknamePromptOpen = true
  }

  function openCreateRoomPrompt(): void {
    createRoomDraft = ''
    createRoomError = ''
    isCreateRoomPromptOpen = true
  }

  function openCreateCharacterPrompt(): void {
    isCharacterMenuOpen = false
    isEditCharacterPromptOpen = false
    createCharacterNameDraft = ''
    createCharacterAttributesDraft = createEmptyCharacterAttributes()
    createCharacterError = ''
    isCreateCharacterPromptOpen = true
  }

  function openEditCharacterPrompt(character: ChatCharacterCard): void {
    isCharacterMenuOpen = false
    isCreateCharacterPromptOpen = false
    editCharacterId = character.id
    editCharacterNameDraft = character.name
    editCharacterAttributesDraft = cloneCharacterAttributes(character.attributes)
    editCharacterError = ''
    isEditCharacterPromptOpen = true
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

  function handleNicknameSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitNickname()
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
      connectionError = '当前未连接聊天室，无法切换角色。'
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
      connectionError = '当前未连接聊天室，无法发送消息。'
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
      createRoomError = '当前未连接聊天室，无法创建房间。'
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
      createCharacterError = '当前未连接聊天室，无法创建角色卡。'
      return
    }

    createCharacterError = ''

    socket.send(
      JSON.stringify({
        attributes: createCharacterAttributesDraft,
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
      editCharacterError = '当前未连接聊天室，无法编辑角色卡。'
      return
    }

    editCharacterError = ''

    socket.send(
      JSON.stringify({
        attributes: editCharacterAttributesDraft,
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

  function getConnectionLabel(state: ChatConnectionState): string {
    if (state === 'connected') {
      return '已连接'
    }

    if (state === 'connecting') {
      return '连接中'
    }

    if (state === 'reconnecting') {
      return '重连中'
    }

    return '未连接'
  }

  onMount(() => {
    sessionId = localStorage.getItem(CHAT_STORAGE_SESSION_KEY) ?? ''
    nickname = sanitiseNickname(localStorage.getItem(CHAT_STORAGE_NICKNAME_KEY) ?? '')
    activeRoomId = localStorage.getItem(CHAT_STORAGE_ROOM_KEY)?.trim() || PUBLIC_CHAT_ROOM_ID
    nicknameDraft = nickname

    void (async () => {
      const hasAuthSession = await restoreAuthSession()

      if (!hasAuthSession) {
        isAuthPromptOpen = true
        isNicknamePromptOpen = false
        return
      }

      isAuthPromptOpen = false

      if (nickname === '') {
        isNicknamePromptOpen = true
        return
      }

      if (sessionId === '') {
        sessionId = createChatSessionId()
        persistIdentity()
      }

      shouldReconnect = true
      isNicknamePromptOpen = false
      void connectToChat()
    })()
  })

  onDestroy(() => {
    shouldReconnect = false
    clearReconnectTimer()
    closeSocket()
  })

  $: connectionLabel = getConnectionLabel(connectionState)
  $: canSend = draftMessage.trim() !== '' && connectionState === 'connected'
  $: roomList = rooms.length === 0 ? [ROOM_PLACEHOLDER] : rooms
  $: activeCharacter =
    activeCharacterId === null ? null : characterCards.find((entry) => entry.id === activeCharacterId) ?? null
</script>

<svelte:window onclick={handleWindowClick} />

<section class="chat-page">
  <section class="board chat-board">
    <div class="board-head chat-board-head">
      <div>
        <h2>聊天室</h2>
        <p class="chat-board-note">
          当前支持公共房间和自建房间，保留局域网内十人内文本即时聊天、消息历史、在线成员和自动重连。
        </p>
      </div>

      <div class="board-head-side">
        <div class="board-head-actions">
          <button class="toolbar-action" type="button" onclick={openAuthPrompt}>
            {currentUser ? '更换密钥' : '输入密钥'}
          </button>
          <button class="toolbar-action" type="button" onclick={openNicknamePrompt}>
            {nickname === '' ? '输入昵称' : '更换昵称'}
          </button>
          <button
            class="toolbar-action"
            disabled={connectionState === 'connected' || nickname === '' || !currentUser}
            type="button"
            onclick={() => connectToChat(connectionState === 'reconnecting')}
          >
            重新连接
          </button>
        </div>

        <div class="chat-connection-indicator" data-state={connectionState}>
          <span class="chat-connection-dot" aria-hidden="true"></span>
          <strong>{connectionLabel}</strong>
          <span>{currentUser ? `身份：${currentUser.displayName}` : isAuthChecking ? '身份校验中' : '等待输入密钥'}</span>
          <span>{nickname === '' ? '等待输入昵称' : `昵称：${nickname}`}</span>
          {#if currentUser}
            <span>{`账号：${currentUser.handle} / ${currentUser.role}`}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="chat-layout">
      <aside class="chat-panel chat-room-panel">
        <div class="chat-panel-head">
          <div>
            <span class="section-label">房间</span>
            <strong>聊天室列表</strong>
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

        <div class="chat-room-list">
          {#each roomList as entry (entry.id)}
            <button
              class:is-active={entry.id === activeRoomId}
              class="chat-room-card"
              type="button"
              onclick={() => switchRoom(entry.id)}
            >
              <div class="chat-room-card-meta">
                <strong>{entry.name}</strong>
                <span>{entry.memberCount} 人在线</span>
              </div>
              <span>
                {entry.latestMessageAt === null
                  ? '暂无消息'
                  : `最近消息 ${formatChatTimestamp(entry.latestMessageAt)}`}
              </span>
              <p>
                {entry.id === PUBLIC_CHAT_ROOM_ID
                  ? '默认公共聊天室，所有进入聊天室的用户都可见。'
                  : '自建文本聊天室，可即时切换并保留最近消息历史。'}
              </p>
            </button>
          {/each}
        </div>
      </aside>

      <section class="chat-panel chat-message-panel">
        <div class="chat-message-head">
          <div>
            <span class="section-label">当前房间</span>
            <strong>{room.name}</strong>
          </div>
          <span>{members.length} 人在线</span>
        </div>

        <div
          bind:this={messageViewportElement}
          class="chat-message-viewport"
          onscroll={handleMessageViewportScroll}
        >
          {#if messages.length === 0}
            <div class="chat-empty-state">
              <strong>聊天室还没有消息。</strong>
              <p>完成密钥验证并输入昵称后，就可以在这里开始即时对话。</p>
            </div>
          {:else}
            <div class="chat-message-list">
              {#each messages as message, index (message.sequence)}
                {#if message.kind === 'system'}
                  <div class="chat-system-message">
                    <span>{message.body}</span>
                    <time datetime={new Date(message.createdAt).toISOString()}>
                      {formatChatTimestamp(message.createdAt)}
                    </time>
                  </div>
                {:else}
                  <article
                    class:is-dice={message.kind === 'dice'}
                    class:is-own={isOwnMessage(message)}
                    class="chat-message-item"
                  >
                    {#if shouldShowMessageMeta(index)}
                      <div class="chat-message-meta">
                        <strong>{message.nickname}</strong>
                        <time datetime={new Date(message.createdAt).toISOString()}>
                          {formatChatTimestamp(message.createdAt)}
                        </time>
                      </div>
                    {/if}

                    <div class:chat-dice-bubble={message.kind === 'dice'} class="chat-message-bubble">
                      {#if message.kind === 'dice'}
                        <span class="chat-message-kind">检定结果</span>
                      {/if}
                      <p>{message.body}</p>
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

        <form class="chat-composer" onsubmit={handleMessageSubmit}>
          <div bind:this={characterMenuElement} class="chat-character-menu">
            <button
              aria-expanded={isCharacterMenuOpen}
              class="chat-character-trigger"
              disabled={connectionState !== 'connected'}
              type="button"
              onclick={toggleCharacterMenu}
            >
              <span>{activeCharacter ? `当前角色：${activeCharacter.name}` : '当前角色：未设置'}</span>
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
                        <span>{character.id === activeCharacterId ? '当前使用' : '切换到该角色'}</span>
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
            <span>输入消息</span>
            <textarea
              bind:value={draftMessage}
              maxlength={CHAT_MAX_MESSAGE_LENGTH}
              onkeydown={handleComposerKeydown}
              placeholder="输入消息，回车发送，Shift + Enter 换行；或输入 .ra力量 进行属性检定"
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
      </section>

      <aside class="chat-panel chat-member-panel">
        <div class="chat-panel-head">
          <div>
            <span class="section-label">在线成员</span>
            <strong>当前在线</strong>
          </div>
          <span>{members.length} 人</span>
        </div>

        <div class="chat-member-list">
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

    {#if connectionError !== ''}
      <div class="chat-error-banner">{connectionError}</div>
    {/if}
  </section>

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

  {#if isNicknamePromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog" onsubmit={handleNicknameSubmit}>
        <div>
          <span class="section-label">进入聊天室</span>
          <h3>先输入昵称</h3>
          <p>昵称会缓存在当前设备，下次进入可直接恢复并自动连接。</p>
        </div>

        <label class="chat-nickname-field">
          <span>昵称</span>
          <input bind:value={nicknameDraft} maxlength={CHAT_NICKNAME_MAX_LENGTH} placeholder="例如：KP / 阿泽 / 七月" type="text" />
        </label>

        {#if connectionError !== ''}
          <div class="chat-nickname-error">{connectionError}</div>
        {/if}

        <div class="chat-nickname-actions">
          {#if nickname !== ''}
            <button class="toolbar-action" type="button" onclick={() => (isNicknamePromptOpen = false)}>
              取消
            </button>
          {/if}
          <button class="toolbar-action toolbar-primary" type="submit">进入聊天室</button>
        </div>
      </form>
    </div>
  {/if}

  {#if isCreateRoomPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog" onsubmit={handleCreateRoomSubmit}>
        <div>
          <span class="section-label">新建房间</span>
          <h3>创建一个聊天室</h3>
          <p>创建后会自动进入该房间，其他在线用户也会立刻在房间列表里看到它。</p>
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

  {#if isCreateCharacterPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog chat-character-dialog" onsubmit={handleCreateCharacterSubmit}>
        <div>
          <span class="section-label">新建角色卡</span>
          <h3>创建 CoC 测试角色</h3>
          <p>保存后会自动切换到这张角色卡，你可以立刻在当前房间测试 `.ra力量` 之类的检定。</p>
        </div>

        <label class="chat-nickname-field">
          <span>角色名</span>
          <input bind:value={createCharacterNameDraft} maxlength={CHAT_CHARACTER_NAME_MAX_LENGTH} placeholder="例如：小玛丽" type="text" />
        </label>

        <div class="chat-character-grid">
          {#each ATTRIBUTE_FIELDS as field}
            <label class="chat-character-field">
              <span>{field.label}</span>
              <input
                max="100"
                min="0"
                oninput={(event) => handleCharacterAttributeInput(field.key, event)}
                type="number"
                value={createCharacterAttributesDraft[field.key]}
              />
            </label>
          {/each}
        </div>

        {#if createCharacterError !== ''}
          <div class="chat-nickname-error">{createCharacterError}</div>
        {/if}

        <div class="chat-nickname-actions">
          <button class="toolbar-action" type="button" onclick={() => (isCreateCharacterPromptOpen = false)}>
            取消
          </button>
          <button class="toolbar-action toolbar-primary" type="submit">创建角色卡</button>
        </div>
      </form>
    </div>
  {/if}

  {#if isEditCharacterPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog chat-character-dialog" onsubmit={handleEditCharacterSubmit}>
        <div>
          <span class="section-label">编辑角色卡</span>
          <h3>修改角色属性</h3>
          <p>这里才展开属性编辑。主界面只保留角色切换入口，不再常驻展示九项属性。</p>
        </div>

        <label class="chat-nickname-field">
          <span>角色名</span>
          <input bind:value={editCharacterNameDraft} maxlength={CHAT_CHARACTER_NAME_MAX_LENGTH} placeholder="例如：周明 / 林雾 / 宋澈" type="text" />
        </label>

        <div class="chat-character-grid">
          {#each ATTRIBUTE_FIELDS as field}
            <label class="chat-character-field">
              <span>{field.label}</span>
              <input
                max="100"
                min="0"
                oninput={(event) => handleEditCharacterAttributeInput(field.key, event)}
                type="number"
                value={editCharacterAttributesDraft[field.key]}
              />
            </label>
          {/each}
        </div>

        {#if editCharacterError !== ''}
          <div class="chat-nickname-error">{editCharacterError}</div>
        {/if}

        <div class="chat-nickname-actions">
          <button class="toolbar-action" type="button" onclick={() => (isEditCharacterPromptOpen = false)}>
            取消
          </button>
          <button class="toolbar-action toolbar-primary" type="submit">保存修改</button>
        </div>
      </form>
    </div>
  {/if}
</section>
