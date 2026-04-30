<script lang="ts">
  import { onMount } from 'svelte'
  import { slide } from 'svelte/transition'
  import WorldviewHero from './WorldviewHero.svelte'
  import {
    calculateCharacterAge,
    formatCharacterAge,
    sampleCharacterProfiles,
    sampleChronicleEntries,
    type CharacterAgeProfile,
    type ChronicleEntry,
    type ChronicleVisibility,
  } from './age-chronicle'
  import { buildChatHttpUrl, type ChatUser } from './chat-room'

  export let worldviewDescription = ''
  export let worldviewHasCover = true
  export let worldviewName = '未选择世界观'
  export let worldviewTags: string[] = []
  export let worldviewThemeStyle = ''
  export let worldviewTransitionKey = 'default'

  const colorPool = ['#a46245', '#4d7b95', '#7c6497', '#5a8b64', '#b06f8d', '#9a7a42']
  const CREATE_CHRONICLE_PANEL_ID = 'create'
  const AGE_CHRONICLE_CACHE_KEY_PREFIX = 'morosonder:age-chronicle:cache:v2'
  const AGE_CHRONICLE_VIEW_KEY_PREFIX = 'morosonder:age-chronicle:view:v2'

  interface AgeChronicleCapabilities {
    canCreateEntry: boolean
    canEditSharedStructure: boolean
    canManageEntry: boolean
  }

  interface AgeChronicleServerState {
    characterProfiles: CharacterAgeProfile[]
    chronicleEntries: ChronicleEntry[]
    nextCharacterIndex: number
  }

  interface AgeChronicleCachedState {
    state: AgeChronicleServerState
    updatedAt: number
  }

  interface AgeChronicleViewPreferences {
    hiddenCharacterIds: string[]
  }

  interface AgeChronicleApiResponse {
    authenticated?: boolean
    capabilities?: Partial<AgeChronicleCapabilities>
    currentUser?: ChatUser
    message?: string
    ok: boolean
    state?: unknown
    updatedAt?: number
  }

  let chronicleAccordionElement: HTMLDivElement | null = null
  let draggedCharacterId = ''
  let currentUser: ChatUser | null = null
  let capabilities = createEmptyCapabilities()
  let isStateLoading = true
  let isReadOnlyFallback = false
  let sharedSyncError = ''
  let accessKeyDraft = ''
  let authError = ''
  let isAuthChecking = false
  let isAuthPromptOpen = false
  let isSavingStructure = false
  let entryMutationTargetId = ''
  let loadedWorldviewName = ''
  let loadedViewPreferenceKey = ''

  let chronicleEntries: ChronicleEntry[] = cloneChronicleEntries(sampleChronicleEntries)
  let characterProfiles: CharacterAgeProfile[] = cloneCharacterProfiles(sampleCharacterProfiles)
  let hiddenCharacterIds: string[] = []
  let nextCharacterIndex = sampleCharacterProfiles.length

  let activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
  let draftChronicleYear = getNextChronicleYear(sampleChronicleEntries)
  let draftChronicleLabel = `新编年 ${draftChronicleYear}`
  let draftChronicleVisibility: ChronicleVisibility = 'private'

  let entryDraftLabel = ''
  let entryDraftYear = 0
  let entryDraftVisibility: ChronicleVisibility = 'private'

  let draftCharacterName = `新角色 ${nextCharacterIndex + 1}`
  let draftCharacterAnchorYear = sampleChronicleEntries[0]?.year ?? 0
  let draftCharacterAnchorAge = 16
  let draftCharacterColor = colorPool[nextCharacterIndex % colorPool.length]

  $: sortedChronicleEntries = [...chronicleEntries].sort((left, right) => {
    if (left.year !== right.year) {
      return left.year - right.year
    }

    return left.label.localeCompare(right.label, 'zh-Hans-CN')
  })

  $: visibleCharacterProfiles = characterProfiles.filter(
    (profile) => !hiddenCharacterIds.includes(profile.id),
  )

  $: canCreateChronicleEntry = !isReadOnlyFallback && capabilities.canCreateEntry
  $: canManageChronicleEntries = !isReadOnlyFallback && capabilities.canManageEntry
  $: canEditSharedStructure = !isReadOnlyFallback && capabilities.canEditSharedStructure

  $: if (loadedViewPreferenceKey !== '') {
    loadedViewPreferenceKey
    hiddenCharacterIds
    persistViewPreferences()
  }

  $: if (loadedWorldviewName !== '' && loadedWorldviewName !== worldviewName && !isStateLoading) {
    void loadSharedAgeChronicleState(worldviewName)
  }

  function cloneChronicleEntries(entries: ChronicleEntry[]): ChronicleEntry[] {
    return entries.map((entry) => ({ ...entry }))
  }

  function cloneCharacterProfiles(profiles: CharacterAgeProfile[]): CharacterAgeProfile[] {
    return profiles.map((profile) => ({ ...profile }))
  }

  function createEmptyCapabilities(): AgeChronicleCapabilities {
    return {
      canCreateEntry: false,
      canEditSharedStructure: false,
      canManageEntry: false,
    }
  }

  function getChronicleAnchorYear(entries: ChronicleEntry[]): number {
    if (entries.length === 0) {
      return 0
    }

    return [...entries].sort((left, right) => left.year - right.year)[0]?.year ?? 0
  }

  function normaliseWorldviewStorageName(name: string): string {
    const safeName = name.trim()
    return safeName === '' ? '未分类世界观' : safeName
  }

  function getViewerStorageSegment(): string {
    return currentUser?.id?.trim() || 'guest'
  }

  function getAgeChronicleCacheKey(targetWorldview = worldviewName): string {
    return `${AGE_CHRONICLE_CACHE_KEY_PREFIX}:${normaliseWorldviewStorageName(targetWorldview)}:${getViewerStorageSegment()}`
  }

  function getAgeChronicleViewPreferenceKey(targetWorldview = worldviewName): string {
    return `${AGE_CHRONICLE_VIEW_KEY_PREFIX}:${normaliseWorldviewStorageName(targetWorldview)}:${getViewerStorageSegment()}`
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function normaliseChronicleVisibility(value: unknown): ChronicleVisibility {
    return value === 'public' ? 'public' : 'private'
  }

  function sanitiseChronicleEntries(input: unknown): ChronicleEntry[] {
    if (!Array.isArray(input)) {
      return cloneChronicleEntries(sampleChronicleEntries)
    }

    return input.flatMap((entry): ChronicleEntry[] => {
      if (!isRecord(entry)) {
        return []
      }

      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const year = Number(entry.year)

      if (id === '' || !Number.isFinite(year)) {
        return []
      }

      const createdAt = Number(entry.createdAt)
      const updatedAt = Number(entry.updatedAt)
      const label = typeof entry.label === 'string' ? entry.label.trim() : ''
      const note = typeof entry.note === 'string' ? entry.note : ''
      const createdByUserId =
        typeof entry.createdByUserId === 'string' && entry.createdByUserId.trim() !== ''
          ? entry.createdByUserId.trim()
          : null

      return [
        {
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
          createdByUserId,
          id,
          label: label === '' ? `新编年 ${year}` : label,
          note,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : Number.isFinite(createdAt) ? createdAt : 0,
          visibility: normaliseChronicleVisibility(entry.visibility),
          year,
        },
      ]
    })
  }

  function sanitiseCharacterProfiles(input: unknown): CharacterAgeProfile[] {
    if (!Array.isArray(input)) {
      return cloneCharacterProfiles(sampleCharacterProfiles)
    }

    return input.flatMap((profile): CharacterAgeProfile[] => {
      if (!isRecord(profile)) {
        return []
      }

      const id = typeof profile.id === 'string' ? profile.id.trim() : ''
      const name = typeof profile.name === 'string' ? profile.name : ''
      const color = typeof profile.color === 'string' ? profile.color : colorPool[0]
      const anchorYear = Number(profile.anchorYear)
      const anchorAge = Number(profile.anchorAge)

      if (id === '' || !Number.isFinite(anchorYear) || !Number.isFinite(anchorAge)) {
        return []
      }

      return [
        {
          anchorAge: Math.max(0, anchorAge),
          anchorYear,
          color: color.trim() || colorPool[0],
          id,
          name: name.trim() || '未命名角色',
        },
      ]
    })
  }

  function sanitiseHiddenCharacterIds(input: unknown, profiles: CharacterAgeProfile[]): string[] {
    if (!Array.isArray(input)) {
      return []
    }

    const validIds = new Set(profiles.map((profile) => profile.id))
    return input.flatMap((profileId) =>
      typeof profileId === 'string' && validIds.has(profileId) ? [profileId] : [],
    )
  }

  function resolveNextStoredIndex(
    input: unknown,
    prefix: string,
    ids: string[],
    fallback: number,
  ): number {
    const customIndex = ids.reduce((maxValue, id) => {
      if (!id.startsWith(prefix)) {
        return maxValue
      }

      const parsed = Number.parseInt(id.slice(prefix.length), 10)
      return Number.isFinite(parsed) ? Math.max(maxValue, parsed) : maxValue
    }, fallback)

    const candidate = Number(input)
    return Number.isFinite(candidate) ? Math.max(customIndex, candidate) : customIndex
  }

  function sanitiseAgeChronicleCapabilities(input: unknown): AgeChronicleCapabilities {
    if (!isRecord(input)) {
      return createEmptyCapabilities()
    }

    return {
      canCreateEntry: input.canCreateEntry === true,
      canEditSharedStructure: input.canEditSharedStructure === true,
      canManageEntry: input.canManageEntry === true,
    }
  }

  function sanitiseAgeChronicleServerState(input: unknown): AgeChronicleServerState | null {
    if (!isRecord(input)) {
      return null
    }

    if (!Array.isArray(input.chronicleEntries) || !Array.isArray(input.characterProfiles)) {
      return null
    }

    const nextChronicleEntries = sanitiseChronicleEntries(input.chronicleEntries)
    const nextCharacterProfiles = sanitiseCharacterProfiles(input.characterProfiles)

    if (nextChronicleEntries.length === 0 && nextCharacterProfiles.length === 0) {
      return {
        characterProfiles: [],
        chronicleEntries: [],
        nextCharacterIndex: 0,
      }
    }

    return {
      characterProfiles: nextCharacterProfiles,
      chronicleEntries: nextChronicleEntries,
      nextCharacterIndex: resolveNextStoredIndex(
        input.nextCharacterIndex,
        'char_custom_',
        nextCharacterProfiles.map((profile) => profile.id),
        nextCharacterProfiles.length,
      ),
    }
  }

  function extractCompatAgeChronicleState(input: unknown): AgeChronicleServerState | null {
    if (!isRecord(input)) {
      return null
    }

    if (!Array.isArray(input.chronicleEntries) || !Array.isArray(input.characterProfiles)) {
      return null
    }

    const nextChronicleEntries = sanitiseChronicleEntries(input.chronicleEntries)
    const nextCharacterProfiles = sanitiseCharacterProfiles(input.characterProfiles)

    return {
      characterProfiles: nextCharacterProfiles,
      chronicleEntries: nextChronicleEntries,
      nextCharacterIndex: resolveNextStoredIndex(
        input.nextCharacterIndex,
        'char_custom_',
        nextCharacterProfiles.map((profile) => profile.id),
        nextCharacterProfiles.length,
      ),
    }
  }

  function createDefaultAgeChronicleState(): AgeChronicleServerState {
    return {
      characterProfiles: cloneCharacterProfiles(sampleCharacterProfiles),
      chronicleEntries: cloneChronicleEntries(sampleChronicleEntries),
      nextCharacterIndex: sampleCharacterProfiles.length,
    }
  }

  function readCachedAgeChronicleState(storageKey: string): AgeChronicleCachedState | null {
    if (typeof localStorage === 'undefined') {
      return null
    }

    try {
      const raw = localStorage.getItem(storageKey)

      if (raw === null) {
        return null
      }

      const parsed = JSON.parse(raw) as unknown

      if (isRecord(parsed) && 'state' in parsed) {
        const state = sanitiseAgeChronicleServerState(parsed.state)

        if (!state) {
          return null
        }

        return {
          state,
          updatedAt: Number.isFinite(Number(parsed.updatedAt)) ? Number(parsed.updatedAt) : 0,
        }
      }

      const compatState = extractCompatAgeChronicleState(parsed)

      if (!compatState) {
        return null
      }

      return {
        state: compatState,
        updatedAt: 0,
      }
    } catch {
      return null
    }
  }

  function writeCachedAgeChronicleState(
    storageKey: string,
    state: AgeChronicleServerState,
    updatedAt: number,
  ): void {
    if (typeof localStorage === 'undefined') {
      return
    }

    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          state,
          updatedAt,
        }),
      )
    } catch {
      // Ignore quota failures and keep the page usable.
    }
  }

  function readViewPreferences(
    storageKey: string,
    profiles: CharacterAgeProfile[],
  ): AgeChronicleViewPreferences {
    if (typeof localStorage === 'undefined') {
      return { hiddenCharacterIds: [] }
    }

    try {
      const raw = localStorage.getItem(storageKey)

      if (raw === null) {
        return { hiddenCharacterIds: [] }
      }

      const parsed = JSON.parse(raw) as unknown

      if (!isRecord(parsed)) {
        return { hiddenCharacterIds: [] }
      }

      return {
        hiddenCharacterIds: sanitiseHiddenCharacterIds(parsed.hiddenCharacterIds, profiles),
      }
    } catch {
      return { hiddenCharacterIds: [] }
    }
  }

  function persistViewPreferences(): void {
    if (typeof localStorage === 'undefined' || loadedViewPreferenceKey === '') {
      return
    }

    try {
      localStorage.setItem(
        loadedViewPreferenceKey,
        JSON.stringify({
          hiddenCharacterIds,
        }),
      )
    } catch {
      // Ignore quota failures and keep the page usable.
    }
  }

  function loadViewPreferences(targetWorldview: string, profiles: CharacterAgeProfile[]): void {
    const storageKey = getAgeChronicleViewPreferenceKey(targetWorldview)
    const preferences = readViewPreferences(storageKey, profiles)
    loadedViewPreferenceKey = storageKey
    hiddenCharacterIds = preferences.hiddenCharacterIds
  }

  function requestAuthPrompt(message = '共享年龄编年需要先输入访问密钥。'): void {
    authError = ''
    sharedSyncError = message
    isAuthPromptOpen = true
  }

  function syncCurrentUserFromPayload(payload: AgeChronicleApiResponse): void {
    if (payload.authenticated === true && payload.currentUser) {
      currentUser = payload.currentUser
      return
    }

    if (payload.authenticated === false) {
      currentUser = null
      capabilities = createEmptyCapabilities()
    }
  }

  function applyAgeChronicleState(
    state: AgeChronicleServerState,
    updatedAt: number,
    targetWorldview = worldviewName,
  ): void {
    chronicleEntries = cloneChronicleEntries(state.chronicleEntries)
    characterProfiles = cloneCharacterProfiles(state.characterProfiles)
    nextCharacterIndex = state.nextCharacterIndex
    loadedWorldviewName = targetWorldview
    loadViewPreferences(targetWorldview, state.characterProfiles)
    hiddenCharacterIds = sanitiseHiddenCharacterIds(hiddenCharacterIds, state.characterProfiles)
    resetChronicleDraft()
    resetCharacterDraft()

    if (activeChroniclePanelId !== CREATE_CHRONICLE_PANEL_ID) {
      const activeEntry = chronicleEntries.find((entry) => entry.id === activeChroniclePanelId)

      if (activeEntry) {
        primeEntryDraft(activeEntry)
      } else {
        activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
      }
    }

    writeCachedAgeChronicleState(getAgeChronicleCacheKey(targetWorldview), state, updatedAt)
  }

  function applyAgeChronicleResponse(
    payload: AgeChronicleApiResponse,
    targetWorldview = worldviewName,
  ): boolean {
    syncCurrentUserFromPayload(payload)
    const state = sanitiseAgeChronicleServerState(payload.state)

    if (!state) {
      return false
    }

    capabilities = sanitiseAgeChronicleCapabilities(payload.capabilities)
    isReadOnlyFallback = false
    applyAgeChronicleState(state, Number(payload.updatedAt ?? Date.now()), targetWorldview)
    return true
  }

  function applyCompatAgeChronicleFallback(
    payload: AgeChronicleApiResponse,
    targetWorldview = worldviewName,
  ): boolean {
    syncCurrentUserFromPayload(payload)
    const compatState = extractCompatAgeChronicleState(payload.state)

    if (!compatState) {
      return false
    }

    capabilities = createEmptyCapabilities()
    isReadOnlyFallback = true
    sharedSyncError = '当前年龄编年服务仍是旧版接口，页面已退回只读兼容模式。'
    applyAgeChronicleState(compatState, Number(payload.updatedAt ?? 0), targetWorldview)
    return true
  }

  async function requestAgeChronicleApi(
    pathname: string,
    init?: RequestInit,
  ): Promise<{
    payload: AgeChronicleApiResponse
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

    let payload: AgeChronicleApiResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as AgeChronicleApiResponse
    } catch {
      payload = {
        message: '年龄编年服务返回了无法解析的响应。',
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

  async function restoreSharedAuthSession(): Promise<void> {
    isAuthChecking = true

    try {
      const { payload } = await requestAgeChronicleApi('/auth/me', { method: 'GET' })

      if (payload.ok && payload.authenticated === true && payload.currentUser) {
        currentUser = payload.currentUser
      } else {
        currentUser = null
      }
    } catch {
      currentUser = null
    } finally {
      isAuthChecking = false
    }
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
      const { payload } = await requestAgeChronicleApi('/auth/access-key', {
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
      await loadSharedAgeChronicleState(worldviewName)
    } catch {
      authError = '访问密钥验证失败，请确认聊天服务已启动。'
    } finally {
      isAuthChecking = false
    }
  }

  async function loadSharedAgeChronicleState(targetWorldview = worldviewName): Promise<void> {
    const cacheKey = getAgeChronicleCacheKey(targetWorldview)
    const cachedState = readCachedAgeChronicleState(cacheKey)

    isStateLoading = true
    sharedSyncError = ''

    try {
      const requestUrl = `/age-chronicle/state?worldview=${encodeURIComponent(targetWorldview)}`
      const { payload } = await requestAgeChronicleApi(requestUrl, { method: 'GET' })

      if (payload.ok && applyAgeChronicleResponse(payload, targetWorldview)) {
        return
      }

      if (applyCompatAgeChronicleFallback(payload, targetWorldview)) {
        return
      }

      if (cachedState) {
        capabilities = createEmptyCapabilities()
        isReadOnlyFallback = true
        sharedSyncError = payload.message ?? '年龄编年服务暂时不可用，当前显示本地只读缓存。'
        applyAgeChronicleState(cachedState.state, cachedState.updatedAt, targetWorldview)
        return
      }

      capabilities = createEmptyCapabilities()
      isReadOnlyFallback = true
      sharedSyncError = payload.message ?? '年龄编年服务暂时不可用，当前显示默认只读内容。'
      applyAgeChronicleState(createDefaultAgeChronicleState(), 0, targetWorldview)
    } catch {
      if (cachedState) {
        capabilities = createEmptyCapabilities()
        isReadOnlyFallback = true
        sharedSyncError = '年龄编年服务暂时不可用，当前显示本地只读缓存。'
        applyAgeChronicleState(cachedState.state, cachedState.updatedAt, targetWorldview)
      } else {
        capabilities = createEmptyCapabilities()
        isReadOnlyFallback = true
        sharedSyncError = '年龄编年服务暂时不可用，当前显示默认只读内容。'
        applyAgeChronicleState(createDefaultAgeChronicleState(), 0, targetWorldview)
      }
    } finally {
      isStateLoading = false
    }
  }

  function createCharacterId(): string {
    nextCharacterIndex += 1
    return `char_custom_${nextCharacterIndex}`
  }

  function normaliseNumber(value: string | number, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function getNextChronicleYear(entries: ChronicleEntry[]): number {
    if (entries.length === 0) {
      return 0
    }

    return Math.max(...entries.map((entry) => entry.year)) + 1
  }

  function resetChronicleDraft(): void {
    draftChronicleYear = getNextChronicleYear(chronicleEntries)
    draftChronicleLabel = `新编年 ${draftChronicleYear}`
    draftChronicleVisibility = 'private'
  }

  function resetCharacterDraft(): void {
    draftCharacterName = `新角色 ${nextCharacterIndex + 1}`
    draftCharacterAnchorYear = getChronicleAnchorYear(chronicleEntries)
    draftCharacterAnchorAge = 16
    draftCharacterColor = colorPool[nextCharacterIndex % colorPool.length]
  }

  function primeEntryDraft(entry: ChronicleEntry): void {
    entryDraftLabel = entry.label
    entryDraftYear = entry.year
    entryDraftVisibility = entry.visibility
  }

  function openChroniclePanel(panelId: string): void {
    activeChroniclePanelId = panelId

    if (panelId === CREATE_CHRONICLE_PANEL_ID) {
      return
    }

    const entry = chronicleEntries.find((item) => item.id === panelId)

    if (entry) {
      primeEntryDraft(entry)
    }
  }

  function collapseChroniclePanels(): void {
    activeChroniclePanelId = ''
  }

  function handleWindowClick(event: MouseEvent): void {
    if (!chronicleAccordionElement) {
      return
    }

    const target = event.target

    if (!(target instanceof Node)) {
      return
    }

    if (!chronicleAccordionElement.contains(target)) {
      collapseChroniclePanels()
    }
  }

  async function saveChronicleDraft(): Promise<void> {
    if (!canCreateChronicleEntry) {
      requestAuthPrompt('创建编年节点需要先输入访问密钥。')
      return
    }

    const year = normaliseNumber(draftChronicleYear, getNextChronicleYear(chronicleEntries))
    const label = draftChronicleLabel.trim() || `新编年 ${year}`

    entryMutationTargetId = CREATE_CHRONICLE_PANEL_ID

    try {
      const { payload, status } = await requestAgeChronicleApi('/age-chronicle/entries', {
        body: JSON.stringify({
          label,
          visibility: draftChronicleVisibility,
          worldview: worldviewName,
          year,
        }),
        method: 'POST',
      })

      if (!payload.ok) {
        if (status === 401) {
          currentUser = null
          capabilities = createEmptyCapabilities()
          requestAuthPrompt(payload.message ?? '创建编年节点需要先输入访问密钥。')
          return
        }

        sharedSyncError = payload.message ?? '创建编年节点失败。'
        return
      }

      if (!applyAgeChronicleResponse(payload)) {
        sharedSyncError = '创建编年节点后收到的响应无效。'
        return
      }

      sharedSyncError = ''
      activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
      resetChronicleDraft()
    } catch {
      sharedSyncError = '创建编年节点失败，请确认聊天服务已启动。'
    } finally {
      entryMutationTargetId = ''
    }
  }

  async function saveChronicleEntryEdit(entryId: string): Promise<void> {
    if (!canManageChronicleEntries) {
      return
    }

    entryMutationTargetId = entryId

    try {
      const { payload, status } = await requestAgeChronicleApi(
        `/age-chronicle/entries/${encodeURIComponent(entryId)}`,
        {
          body: JSON.stringify({
            label: entryDraftLabel.trim() || `新编年 ${normaliseNumber(entryDraftYear, 0)}`,
            visibility: entryDraftVisibility,
            worldview: worldviewName,
            year: normaliseNumber(entryDraftYear, 0),
          }),
          method: 'PATCH',
        },
      )

      if (!payload.ok) {
        if (status === 401) {
          currentUser = null
          capabilities = createEmptyCapabilities()
          requestAuthPrompt(payload.message ?? '更新编年节点需要先输入访问密钥。')
          return
        }

        sharedSyncError = payload.message ?? '更新编年节点失败。'
        return
      }

      if (!applyAgeChronicleResponse(payload)) {
        sharedSyncError = '更新编年节点后收到的响应无效。'
        return
      }

      sharedSyncError = ''
      const updatedEntry = chronicleEntries.find((entry) => entry.id === entryId)

      if (updatedEntry) {
        primeEntryDraft(updatedEntry)
      }
    } catch {
      sharedSyncError = '更新编年节点失败，请确认聊天服务已启动。'
    } finally {
      entryMutationTargetId = ''
    }
  }

  async function removeChronicleEntry(entryId: string): Promise<void> {
    if (!canManageChronicleEntries) {
      return
    }

    entryMutationTargetId = entryId

    try {
      const { payload, status } = await requestAgeChronicleApi(
        `/age-chronicle/entries/${encodeURIComponent(entryId)}`,
        {
          body: JSON.stringify({
            delete: true,
            worldview: worldviewName,
          }),
          method: 'PATCH',
        },
      )

      if (!payload.ok) {
        if (status === 401) {
          currentUser = null
          capabilities = createEmptyCapabilities()
          requestAuthPrompt(payload.message ?? '删除编年节点需要先输入访问密钥。')
          return
        }

        sharedSyncError = payload.message ?? '删除编年节点失败。'
        return
      }

      if (!applyAgeChronicleResponse(payload)) {
        sharedSyncError = '删除编年节点后收到的响应无效。'
        return
      }

      sharedSyncError = ''
      if (activeChroniclePanelId === entryId) {
        activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
      }
    } catch {
      sharedSyncError = '删除编年节点失败，请确认聊天服务已启动。'
    } finally {
      entryMutationTargetId = ''
    }
  }

  async function saveSharedStructure(
    nextProfiles = characterProfiles,
    nextStructureIndex = nextCharacterIndex,
  ): Promise<boolean> {
    if (!canEditSharedStructure) {
      return false
    }

    if (!currentUser) {
      requestAuthPrompt('修改角色结构需要先输入访问密钥。')
      return false
    }

    isSavingStructure = true

    try {
      const { payload, status } = await requestAgeChronicleApi('/age-chronicle/state', {
        body: JSON.stringify({
          structure: {
            characterProfiles: nextProfiles,
            nextCharacterIndex: nextStructureIndex,
          },
          worldview: worldviewName,
        }),
        method: 'POST',
      })

      if (!payload.ok) {
        if (status === 401) {
          currentUser = null
          capabilities = createEmptyCapabilities()
          requestAuthPrompt(payload.message ?? '共享结构保存需要先输入访问密钥。')
          return false
        }

        sharedSyncError = payload.message ?? '共享角色结构保存失败。'
        return false
      }

      if (!applyAgeChronicleResponse(payload)) {
        sharedSyncError = '共享角色结构保存后收到的响应无效。'
        return false
      }

      sharedSyncError = ''
      return true
    } catch {
      sharedSyncError = '共享角色结构保存失败，请确认聊天服务已启动。'
      return false
    } finally {
      isSavingStructure = false
    }
  }

  async function addCharacterProfile(): Promise<void> {
    if (!canEditSharedStructure) {
      return
    }

    const nextIndex = nextCharacterIndex + 1
    const profile: CharacterAgeProfile = {
      anchorAge: Math.max(0, normaliseNumber(draftCharacterAnchorAge, 16)),
      anchorYear: normaliseNumber(draftCharacterAnchorYear, getChronicleAnchorYear(chronicleEntries)),
      color: draftCharacterColor.trim() || colorPool[nextIndex % colorPool.length],
      id: createCharacterId(),
      name: draftCharacterName.trim() || `新角色 ${nextIndex}`,
    }

    const saved = await saveSharedStructure([...characterProfiles, profile], nextCharacterIndex)

    if (saved) {
      resetCharacterDraft()
    }
  }

  async function removeCharacterProfile(profileId: string): Promise<void> {
    if (!canEditSharedStructure || characterProfiles.length <= 1) {
      return
    }

    const nextProfiles = characterProfiles.filter((profile) => profile.id !== profileId)
    await saveSharedStructure(nextProfiles, nextCharacterIndex)
  }

  function toggleCharacterVisibility(profileId: string): void {
    hiddenCharacterIds = hiddenCharacterIds.includes(profileId)
      ? hiddenCharacterIds.filter((id) => id !== profileId)
      : [...hiddenCharacterIds, profileId]
  }

  function handleCharacterDragStart(profileId: string): void {
    if (!canEditSharedStructure) {
      return
    }

    draggedCharacterId = profileId
  }

  async function handleCharacterDrop(targetId: string): Promise<void> {
    if (!canEditSharedStructure || draggedCharacterId === '' || draggedCharacterId === targetId) {
      return
    }

    const sourceIndex = characterProfiles.findIndex((profile) => profile.id === draggedCharacterId)
    const targetIndex = characterProfiles.findIndex((profile) => profile.id === targetId)

    if (sourceIndex === -1 || targetIndex === -1) {
      draggedCharacterId = ''
      return
    }

    const reorderedProfiles = [...characterProfiles]
    const [sourceProfile] = reorderedProfiles.splice(sourceIndex, 1)
    reorderedProfiles.splice(targetIndex, 0, sourceProfile)
    draggedCharacterId = ''
    await saveSharedStructure(reorderedProfiles, nextCharacterIndex)
  }

  function handleCharacterDragEnd(): void {
    draggedCharacterId = ''
  }

  function getAgeTone(color: string): string {
    return `${color}18`
  }

  function getChronicleVisibilityLabel(visibility: ChronicleVisibility): string {
    return visibility === 'public' ? '公开' : '私密'
  }

  function getChronicleVisibilityHint(entry: ChronicleEntry): string {
    if (entry.visibility === 'public') {
      return '所有可访问用户可见'
    }

    if (entry.createdByUserId && currentUser?.id === entry.createdByUserId) {
      return '仅你和管理员可见'
    }

    if (currentUser?.role === 'admin') {
      return '仅创建者和管理员可见'
    }

    return '仅创建者和管理员可见'
  }

  function formatMetaTimestamp(timestamp: number): string {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return '刚刚'
    }

    return new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
    }).format(new Date(timestamp))
  }

  onMount(() => {
    void (async () => {
      await restoreSharedAuthSession()
      await loadSharedAgeChronicleState(worldviewName)
    })()
  })
</script>

<svelte:window onclick={handleWindowClick} />

<section class="age-page">
  <WorldviewHero
    description={worldviewDescription}
    hasCover={worldviewHasCover}
    name={worldviewName}
    panelClass="age-hero"
    tags={worldviewTags}
    themeStyle={worldviewThemeStyle}
    transitionKey={worldviewTransitionKey}
  />

  <section class="age-workspace">
    <aside class="age-sidebar">
      <section class="age-panel">
        <div class="age-panel-head">
          <div>
            <p class="section-label">编年节点</p>
            <h3>自定义编年</h3>
          </div>
          <p class="age-panel-tip">节点按权限过滤显示。私密节点只对创建者和管理员可见。</p>
        </div>

        <div bind:this={chronicleAccordionElement} class="age-editor-list age-editor-list-accordion">
          <article
            class:is-expanded={activeChroniclePanelId === CREATE_CHRONICLE_PANEL_ID}
            class:is-collapsed={activeChroniclePanelId !== CREATE_CHRONICLE_PANEL_ID}
            class="age-editor-card age-editor-card-create"
          >
            <button
              aria-expanded={activeChroniclePanelId === CREATE_CHRONICLE_PANEL_ID}
              class="age-editor-toggle"
              type="button"
              onclick={() => openChroniclePanel(CREATE_CHRONICLE_PANEL_ID)}
            >
              <div class="age-editor-toggle-copy">
                <span class="age-editor-kicker">新增节点</span>
                <strong>{draftChronicleLabel || `新编年 ${draftChronicleYear}`}</strong>
              </div>
              <span class="age-editor-year">第 {draftChronicleYear} 年</span>
            </button>

            {#if activeChroniclePanelId === CREATE_CHRONICLE_PANEL_ID}
              <div class="age-editor-body" transition:slide={{ duration: 180 }}>
                {#if canCreateChronicleEntry}
                  <label class="age-field">
                    <span>标签</span>
                    <input bind:value={draftChronicleLabel} type="text" />
                  </label>

                  <label class="age-field">
                    <span>编年值</span>
                    <input bind:value={draftChronicleYear} type="number" />
                  </label>

                  <label class="age-field">
                    <span>可见性</span>
                    <select bind:value={draftChronicleVisibility}>
                      <option value="private">仅自己和管理员可见</option>
                      <option value="public">公开给所有可访问用户</option>
                    </select>
                  </label>

                  <div class="age-editor-actions">
                    <button class="toolbar-action" type="button" onclick={collapseChroniclePanels}>
                      收起
                    </button>
                    <button
                      class="toolbar-action toolbar-primary"
                      disabled={entryMutationTargetId === CREATE_CHRONICLE_PANEL_ID}
                      type="button"
                      onclick={() => void saveChronicleDraft()}
                    >
                      {entryMutationTargetId === CREATE_CHRONICLE_PANEL_ID ? '保存中…' : '保存节点'}
                    </button>
                  </div>
                {:else}
                  <div class="age-editor-lock-note">
                    <strong>{isReadOnlyFallback ? '当前为只读兼容模式' : '需要先登录'}</strong>
                    <p>
                      {#if isReadOnlyFallback}
                        当前页面只保留只读查看能力，暂不允许创建新节点。
                      {:else}
                        普通用户登录后可以新增节点，并选择公开或仅自己可见。
                      {/if}
                    </p>
                    {#if !isReadOnlyFallback}
                      <div class="age-editor-actions">
                        <button
                          class="toolbar-action toolbar-primary"
                          type="button"
                          onclick={() => requestAuthPrompt('创建编年节点需要先输入访问密钥。')}
                        >
                          输入密钥
                        </button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}
          </article>

          {#each sortedChronicleEntries as entry (entry.id)}
            <article
              class:is-expanded={activeChroniclePanelId === entry.id}
              class:is-collapsed={activeChroniclePanelId !== entry.id}
              class="age-editor-card age-editor-card-accordion"
            >
              <button
                aria-expanded={activeChroniclePanelId === entry.id}
                class="age-editor-toggle"
                type="button"
                onclick={() => openChroniclePanel(entry.id)}
              >
                <div class="age-editor-toggle-copy">
                  <span class="age-editor-year">第 {entry.year} 年</span>
                  <strong>{entry.label}</strong>
                </div>
                <span class={`age-entry-visibility is-${entry.visibility}`}>
                  {getChronicleVisibilityLabel(entry.visibility)}
                </span>
              </button>

              {#if activeChroniclePanelId === entry.id}
                <div class="age-editor-body" transition:slide={{ duration: 180 }}>
                  {#if canManageChronicleEntries}
                    <label class="age-field">
                      <span>标签</span>
                      <input bind:value={entryDraftLabel} type="text" />
                    </label>

                    <label class="age-field">
                      <span>编年值</span>
                      <input bind:value={entryDraftYear} type="number" />
                    </label>

                    <label class="age-field">
                      <span>可见性</span>
                      <select bind:value={entryDraftVisibility}>
                        <option value="private">仅创建者和管理员可见</option>
                        <option value="public">公开给所有可访问用户</option>
                      </select>
                    </label>

                    <div class="age-editor-meta">
                      <span>最近更新：{formatMetaTimestamp(entry.updatedAt)}</span>
                      <span>{getChronicleVisibilityHint(entry)}</span>
                    </div>

                    <div class="age-editor-actions">
                      <button class="toolbar-action" type="button" onclick={collapseChroniclePanels}>
                        收起
                      </button>
                      <button
                        class="age-remove"
                        disabled={entryMutationTargetId === entry.id}
                        type="button"
                        onclick={() => void removeChronicleEntry(entry.id)}
                      >
                        {entryMutationTargetId === entry.id ? '处理中…' : '删除'}
                      </button>
                      <button
                        class="toolbar-action toolbar-primary"
                        disabled={entryMutationTargetId === entry.id}
                        type="button"
                        onclick={() => void saveChronicleEntryEdit(entry.id)}
                      >
                        {entryMutationTargetId === entry.id ? '保存中…' : '保存修改'}
                      </button>
                    </div>
                  {:else}
                    <div class="age-entry-readonly-note">
                      <div class="age-editor-meta">
                        <span>{getChronicleVisibilityHint(entry)}</span>
                        <span>最近更新：{formatMetaTimestamp(entry.updatedAt)}</span>
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </section>

      <section class="age-panel">
        <div class="age-panel-head">
          <div>
            <p class="section-label">角色结构</p>
            <h3>角色列维护</h3>
          </div>
          <p class="age-panel-tip">角色顺序和角色列属于共享结构，本轮仅管理员可维护。</p>
        </div>

        <div class="age-editor-list">
          {#if canEditSharedStructure}
            <article class="age-editor-card age-editor-card-create">
              <label class="age-field">
                <span>角色名</span>
                <input bind:value={draftCharacterName} type="text" />
              </label>

              <div class="age-field-row">
                <label class="age-field">
                  <span>基准编年</span>
                  <input bind:value={draftCharacterAnchorYear} type="number" />
                </label>

                <label class="age-field">
                  <span>基准年龄</span>
                  <input bind:value={draftCharacterAnchorAge} min="0" type="number" />
                </label>
              </div>

              <label class="age-field">
                <span>角色颜色</span>
                <div class="age-color-row">
                  <input class="age-color-picker" bind:value={draftCharacterColor} type="color" />
                  <input bind:value={draftCharacterColor} type="text" />
                </div>
              </label>

              <div class="age-editor-actions">
                <button
                  class="toolbar-action toolbar-primary"
                  disabled={isSavingStructure}
                  type="button"
                  onclick={() => void addCharacterProfile()}
                >
                  {isSavingStructure ? '保存中…' : '添加角色'}
                </button>
              </div>
            </article>
          {:else}
            <article class="age-editor-card age-editor-card-create">
              <div class="age-editor-lock-note">
                <strong>{isReadOnlyFallback ? '当前为只读兼容模式' : '仅管理员可维护角色结构'}</strong>
                <p>
                  {#if isReadOnlyFallback}
                    当前无法写入共享角色结构，只保留查看和本地显示隐藏。
                  {:else}
                    普通用户仍可查看，并按本地偏好隐藏角色列。
                  {/if}
                </p>
              </div>
            </article>
          {/if}
        </div>
      </section>
    </aside>

    <section class="board age-board">
      <div class="board-head age-board-head">
        <div>
          <p class="section-label">编年视图</p>
          <h2>同一节点下的角色年龄对照</h2>
        </div>
        <div class="age-board-note-stack">
          <p class="board-note">年龄工具只保留节点、角色列和年龄对照，不再保存备注。</p>
          {#if sharedSyncError !== ''}
            <p class="board-note age-board-status">{sharedSyncError}</p>
          {/if}
          {#if isStateLoading}
            <p class="board-note age-board-status">正在载入年龄编年状态…</p>
          {/if}
        </div>
      </div>

      <div class="age-legend age-legend-interactive" aria-label="角色图例">
        {#each characterProfiles as profile (profile.id)}
          <article
            class:is-dragging={draggedCharacterId === profile.id}
            class:is-hidden={hiddenCharacterIds.includes(profile.id)}
            class="age-legend-item age-legend-card"
            draggable={canEditSharedStructure}
            style={`--legend-color:${profile.color}; --legend-tint:${getAgeTone(profile.color)};`}
            ondragend={handleCharacterDragEnd}
            ondragover={(event) => event.preventDefault()}
            ondragstart={() => handleCharacterDragStart(profile.id)}
            ondrop={() => void handleCharacterDrop(profile.id)}
          >
            <button class="age-legend-main" type="button" onclick={() => toggleCharacterVisibility(profile.id)}>
              <span aria-hidden="true" class="age-swatch"></span>
              <span class="age-legend-copy">
                <strong>{profile.name}</strong>
                <span>
                  {#if hiddenCharacterIds.includes(profile.id)}
                    已隐藏
                  {:else}
                    基准 {profile.anchorYear} / {profile.anchorAge} 岁
                  {/if}
                </span>
              </span>
            </button>

            {#if canEditSharedStructure}
              <button
                class="age-legend-delete"
                disabled={characterProfiles.length <= 1 || isSavingStructure}
                type="button"
                onclick={() => void removeCharacterProfile(profile.id)}
              >
                删除
              </button>
            {/if}
          </article>
        {/each}
      </div>

      {#if visibleCharacterProfiles.length === 0}
        <div class="age-empty-state">
          <strong>当前没有显示中的角色</strong>
          <p>点击上面的角色条重新显示，或由管理员先补充新的角色列。</p>
        </div>
      {:else if sortedChronicleEntries.length === 0}
        <div class="age-empty-state">
          <strong>当前没有你可见的编年节点</strong>
          <p>可以先新增一个公开或私密节点；未授权用户不会看到其他人的隐藏节点。</p>
        </div>
      {:else}
        <div class="age-matrix" style={`--column-count:${visibleCharacterProfiles.length};`}>
          <div class="age-row age-row-header">
            <div class="age-cell age-chronicle-head">编年节点</div>

            {#each visibleCharacterProfiles as profile (profile.id)}
              <div
                class="age-cell age-character-head"
                style={`--cell-color:${profile.color}; --cell-tint:${getAgeTone(profile.color)};`}
              >
                <strong>{profile.name}</strong>
                <span>基准 {profile.anchorYear} / {profile.anchorAge} 岁</span>
              </div>
            {/each}
          </div>

          {#each sortedChronicleEntries as entry (entry.id)}
            <div class="age-row">
              <div class="age-cell age-chronicle-cell">
                <strong>{entry.label}</strong>
                <span>第 {entry.year} 年 · {getChronicleVisibilityLabel(entry.visibility)}</span>
              </div>

              {#each visibleCharacterProfiles as profile (profile.id)}
                <div
                  class="age-cell age-value-cell"
                  style={`--cell-color:${profile.color}; --cell-tint:${getAgeTone(profile.color)};`}
                >
                  <div class="age-value-meta">
                    <strong>{formatCharacterAge(calculateCharacterAge(entry.year, profile))}</strong>
                    <span class="age-value-preview">{profile.name}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </section>

  {#if isAuthPromptOpen}
    <div class="chat-nickname-overlay">
      <form class="chat-nickname-dialog" onsubmit={handleAccessKeySubmit}>
        <div>
          <span class="section-label">共享同步</span>
          <h3>先输入访问密钥</h3>
          <p>年龄编年现在依赖共享服务；节点和角色结构会按权限写入后端。</p>
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
</section>
