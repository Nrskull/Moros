<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    buildChatWebSocketUrl,
    CHAT_MAX_MESSAGE_LENGTH,
    CHAT_NICKNAME_MAX_LENGTH,
    CHAT_STORAGE_NICKNAME_KEY,
    CHAT_STORAGE_SESSION_KEY,
    createChatSessionId,
    formatChatTimestamp,
    PUBLIC_CHAT_ROOM_ID,
    type ChatConnectionState,
    type ChatMember,
    type ChatMessage,
  } from './chat-room'

  interface ChatJoinedPayload {
    members: ChatMember[]
    messages: ChatMessage[]
    room: {
      id: string
      name: string
    }
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

  type ChatServerPayload =
    | ChatErrorPayload
    | ChatJoinedPayload
    | ChatMessagePayload
    | ChatPresencePayload

  const ROOM_PLACEHOLDER = {
    id: PUBLIC_CHAT_ROOM_ID,
    name: '公共聊天室',
  }

  let messageViewportElement: HTMLDivElement | null = null

  let socket: WebSocket | null = null
  let socketSerial = 0
  let reconnectTimer: number | null = null
  let shouldReconnect = false

  let room = ROOM_PLACEHOLDER
  let sessionId = ''
  let nickname = ''
  let nicknameDraft = ''
  let draftMessage = ''
  let connectionState: ChatConnectionState = 'disconnected'
  let connectionError = ''
  let messages: ChatMessage[] = []
  let members: ChatMember[] = []
  let unreadIncomingCount = 0
  let isNicknamePromptOpen = true

  function sanitiseNickname(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, CHAT_NICKNAME_MAX_LENGTH)
  }

  function isOwnMessage(message: ChatMessage): boolean {
    return message.kind === 'user' && message.sessionId === sessionId
  }

  function shouldShowMessageMeta(index: number): boolean {
    const current = messages[index]
    const previous = messages[index - 1]

    if (!current || current.kind === 'system') {
      return true
    }

    return !previous || previous.kind !== 'user' || previous.nickname !== current.nickname
  }

  function persistIdentity(): void {
    localStorage.setItem(CHAT_STORAGE_SESSION_KEY, sessionId)
    localStorage.setItem(CHAT_STORAGE_NICKNAME_KEY, nickname)
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
    if (payload.type === 'joined') {
      room = payload.room
      members = payload.members
      connectionState = 'connected'
      connectionError = ''
      isNicknamePromptOpen = false
      await mergeMessages(payload.messages, { forceScroll: messages.length === 0 })
      return
    }

    if (payload.type === 'message') {
      await mergeMessages([payload.message])
      return
    }

    if (payload.type === 'presence') {
      members = payload.members
      return
    }

    connectionError = payload.message
  }

  async function connectToChat(isReconnect = false): Promise<void> {
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
          afterSequence: messages.at(-1)?.sequence ?? 0,
          nickname,
          roomId: PUBLIC_CHAT_ROOM_ID,
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
    nicknameDraft = nickname
    isNicknamePromptOpen = true
  }

  function handleNicknameSubmit(event: SubmitEvent): void {
    event.preventDefault()
    submitNickname()
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
    nicknameDraft = nickname

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
  })

  onDestroy(() => {
    shouldReconnect = false
    clearReconnectTimer()
    closeSocket()
  })

  $: connectionLabel = getConnectionLabel(connectionState)
  $: canSend = draftMessage.trim() !== '' && connectionState === 'connected'
  $: latestMessageLabel =
    messages.length === 0
      ? '暂无消息'
      : `最近消息 ${formatChatTimestamp(messages[messages.length - 1].createdAt)}`
</script>

<section class="chat-page">
  <section class="board chat-board">
    <div class="board-head chat-board-head">
      <div>
        <h2>聊天室</h2>
        <p class="chat-board-note">
          当前接入的是默认公共聊天室，支持局域网内十人内文本即时聊天、消息历史、在线成员和自动重连。
        </p>
      </div>

      <div class="board-head-side">
        <div class="board-head-actions">
          <button class="toolbar-action" type="button" onclick={openNicknamePrompt}>
            {nickname === '' ? '输入昵称' : '更换昵称'}
          </button>
          <button
            class="toolbar-action"
            disabled={connectionState === 'connected' || nickname === ''}
            type="button"
            onclick={() => connectToChat(connectionState === 'reconnecting')}
          >
            重新连接
          </button>
        </div>

        <div class="chat-connection-indicator" data-state={connectionState}>
          <span class="chat-connection-dot" aria-hidden="true"></span>
          <strong>{connectionLabel}</strong>
          <span>{nickname === '' ? '等待输入昵称' : `昵称：${nickname}`}</span>
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
          <span>{members.length} 人在线</span>
        </div>

        <button class="chat-room-card is-active" type="button">
          <strong>{room.name}</strong>
          <span>{members.length} 人在线</span>
          <span>{latestMessageLabel}</span>
          <p>{messages.length === 0 ? '还没有消息，输入第一句开始。' : '单公共房间 MVP，后续可扩展多房间。'}</p>
        </button>
      </aside>

      <section class="chat-panel chat-message-panel">
        <div class="chat-message-head">
          <div>
            <span class="section-label">当前房间</span>
            <strong>{room.name}</strong>
          </div>
          <span>{messages.length} 条消息</span>
        </div>

        <div
          bind:this={messageViewportElement}
          class="chat-message-viewport"
          onscroll={handleMessageViewportScroll}
        >
          {#if messages.length === 0}
            <div class="chat-empty-state">
              <strong>聊天室还没有消息。</strong>
              <p>启动聊天服务并输入昵称后，就可以在这里开始即时对话。</p>
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
                  <article class:is-own={isOwnMessage(message)} class="chat-message-item">
                    {#if shouldShowMessageMeta(index)}
                      <div class="chat-message-meta">
                        <strong>{message.nickname}</strong>
                        <time datetime={new Date(message.createdAt).toISOString()}>
                          {formatChatTimestamp(message.createdAt)}
                        </time>
                      </div>
                    {/if}

                    <div class="chat-message-bubble">
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
          <label class="chat-composer-field">
            <span>输入消息</span>
            <textarea
              bind:value={draftMessage}
              maxlength={CHAT_MAX_MESSAGE_LENGTH}
              onkeydown={handleComposerKeydown}
              placeholder="输入消息，回车发送，Shift + Enter 换行"
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
</section>
