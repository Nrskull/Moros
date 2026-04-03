<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { slide } from 'svelte/transition'
  import {
    CHARACTER_COLOR_POOL,
    createEditedLogFilename,
    ensureCharacterColors,
    normaliseLogNickname,
    parseSealDiceStandardLog,
    serialiseSealDiceStandardLog,
    stripReplyPrefixFromLogMessage,
    type EditableLogEntry,
    type SealDiceStandardLog,
  } from './log-workbench'

  type LogWorkbenchView = 'edit' | 'overview' | 'play'

  interface CharacterControl {
    color: string
    count: number
    key: string
    name: string
    visible: boolean
  }

  interface LogWorldviewCard {
    description: string
    hasCover: boolean
    name: string
    tags: string[]
    themeStyle: string
  }

  interface StoredLogRecord {
    characterColors: Record<string, string>
    characterVisibility: Record<string, boolean>
    createdAt: number
    entries: EditableLogEntry[]
    id: string
    primaryCharacter: string
    sequenceNumber: number
    sourceFilename: string
    sourceLabel: string
    sourceLog: SealDiceStandardLog
    title: string
    updatedAt: number
    worldview: string
  }

  interface TextPageRange {
    end: number
    start: number
  }

  export let initialWorldviewName = ''
  export let worldviewCards: LogWorldviewCard[] = []
  export let worldviewDescription = ''
  export let worldviewHasCover = true
  export let worldviewName = '未选择世界观'
  export let worldviewTags: string[] = []
  export let worldviewThemeStyle = ''
  export let worldviewTransitionKey = 'default'

  const SAMPLE_LOG_PATH = '/logs/test/sealdice-standard-log.json'
  const SAMPLE_FILE_NAME = 'sealdice-standard-log.json'
  const PAGE_SIZE_OPTIONS = [12, 24, 40]

  let fileInputElement: HTMLInputElement | null = null
  let editPaneElement: HTMLDivElement | null = null
  let playbackTextViewportElement: HTMLDivElement | null = null
  let playbackMeasureElement: HTMLParagraphElement | null = null
  let playbackTextElement: HTMLParagraphElement | null = null

  let view: LogWorkbenchView = 'overview'
  let expandedWorldview = ''
  let uploadTargetWorldview = ''
  let uploadPrimaryCharacterDrafts: Record<string, string> = {}
  let logRecords: StoredLogRecord[] = []
  let activeLogId = ''

  let sourceFilename = SAMPLE_FILE_NAME
  let sourceLabel = '示例日志'
  let sourceLog: SealDiceStandardLog | null = null
  let entries: EditableLogEntry[] = []
  let characterColors: Record<string, string> = {}
  let characterVisibility: Record<string, boolean> = {}
  let characterNameDrafts: Record<string, string> = {}
  let loadError = ''
  let isLoadingSample = false
  let currentPage = 1
  let pageSize = PAGE_SIZE_OPTIONS[1]
  let serialisedLogText = ''
  let downloadFilename = createEditedLogFilename(SAMPLE_FILE_NAME)
  let downloadUrl = ''
  let hasSeededSample = false
  let isCharacterManagerOpen = false
  let isDisplaySettingsOpen = false
  let isBodyOnlyMode = false
  let pageJumpDraft = '1'

  let playbackIndex = 0
  let playbackSpeed = 1
  let isPlaying = false
  let isReviewOpen = false
  let playbackText = ''
  let playbackAdvanceTimer: number | null = null
  let playbackTypeTimer: number | null = null
  let playbackFingerprint = ''
  let playbackCursor = 0
  let playbackCursorEntryId = ''
  let playbackPageRanges: TextPageRange[] = []
  let playbackPageIndex = 0
  let playbackMeasureVersion = 0
  let paginationRefreshTicket = 0

  function autosize(node: HTMLTextAreaElement, _value: string) {
    const resize = () => {
      node.style.height = '0px'
      node.style.height = `${Math.max(node.scrollHeight, 52)}px`
    }

    requestAnimationFrame(resize)
    node.addEventListener('input', resize)

    return {
      update() {
        requestAnimationFrame(resize)
      },
      destroy() {
        node.removeEventListener('input', resize)
      },
    }
  }

  function observePlaybackViewport(node: HTMLDivElement) {
    if (typeof ResizeObserver === 'undefined') {
      return {
        destroy() {},
      }
    }

    const observer = new ResizeObserver(() => {
      playbackMeasureVersion += 1
    })

    observer.observe(node)

    return {
      destroy() {
        observer.disconnect()
      },
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  function formatRecordTimestamp(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: '2-digit',
    }).format(new Date(timestamp))
  }

  function createFallbackWorldviewCard(): LogWorldviewCard {
    return {
      description: worldviewDescription,
      hasCover: worldviewHasCover,
      name: worldviewName,
      tags: worldviewTags,
      themeStyle: worldviewThemeStyle,
    }
  }

  function cloneEntries(list: EditableLogEntry[]): EditableLogEntry[] {
    return list.map((entry) => ({ ...entry }))
  }

  function cloneSourceLog(source: SealDiceStandardLog): SealDiceStandardLog {
    return JSON.parse(JSON.stringify(source)) as SealDiceStandardLog
  }

  function getCharacterKeys(list: EditableLogEntry[]): string[] {
    const seen = new Set<string>()
    const keys: string[] = []

    for (const entry of list) {
      if (seen.has(entry.speakerKey)) {
        continue
      }

      seen.add(entry.speakerKey)
      keys.push(entry.speakerKey)
    }

    return keys
  }

  function ensureCharacterVisibility(
    keys: string[],
    current: Record<string, boolean>,
  ): Record<string, boolean> {
    const next: Record<string, boolean> = {}

    for (const key of keys) {
      next[key] = current[key] ?? true
    }

    return next
  }

  function buildCharacterControls(
    list: EditableLogEntry[],
    colors: Record<string, string>,
    visibility: Record<string, boolean>,
  ): CharacterControl[] {
    const counts = new Map<string, number>()
    const names = new Map<string, string>()

    for (const entry of list) {
      counts.set(entry.speakerKey, (counts.get(entry.speakerKey) ?? 0) + 1)
      names.set(entry.speakerKey, normaliseLogNickname(entry.nickname))
    }

    return [...counts.entries()].map(([key, count]) => ({
      color: colors[key] ?? CHARACTER_COLOR_POOL[0],
      count,
      key,
      name: names.get(key) ?? '未命名角色',
      visible: visibility[key] ?? true,
    }))
  }

  function derivePrimaryCharacter(list: EditableLogEntry[]): string {
    const counts = new Map<string, number>()

    for (const entry of list) {
      const safeName = normaliseLogNickname(entry.nickname)
      const isLikelyDirector = ['kp', 'kp.', 'keeper', '骰娘', 'system'].includes(safeName.toLowerCase())

      if (isLikelyDirector) {
        continue
      }

      counts.set(safeName, (counts.get(safeName) ?? 0) + 1)
    }

    const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1])
    return sorted[0]?.[0] ?? list[0]?.nickname ?? '主要角色'
  }

  function isNarrativeBodyEntry(entry: EditableLogEntry): boolean {
    return !entry.isOoc && !entry.hasCqImage
  }

  function getNextLogSequence(worldview: string, primaryCharacter: string): number {
    return (
      logRecords
        .filter(
          (record) =>
            record.worldview === worldview &&
            normaliseLogNickname(record.primaryCharacter) === normaliseLogNickname(primaryCharacter),
        )
        .reduce((max, record) => Math.max(max, record.sequenceNumber), 0) + 1
    )
  }

  function createLogRecordId(): string {
    return `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function createStoredLogRecord(options: {
    filename: string
    label: string
    parsed: {
      entries: EditableLogEntry[]
      source: SealDiceStandardLog
    }
    primaryCharacter: string
    worldview: string
  }): StoredLogRecord {
    const safePrimaryCharacter = normaliseLogNickname(options.primaryCharacter)
    const sequenceNumber = getNextLogSequence(options.worldview, safePrimaryCharacter)
    const initialEntries = cloneEntries(options.parsed.entries)
    const characterKeys = getCharacterKeys(initialEntries)
    const initialColors = ensureCharacterColors(characterKeys, {})
    const initialVisibility = ensureCharacterVisibility(characterKeys, {})
    const now = Date.now()

    return {
      characterColors: initialColors,
      characterVisibility: initialVisibility,
      createdAt: now,
      entries: initialEntries,
      id: createLogRecordId(),
      primaryCharacter: safePrimaryCharacter,
      sequenceNumber,
      sourceFilename: options.filename,
      sourceLabel: options.label,
      sourceLog: cloneSourceLog(options.parsed.source),
      title: `${options.worldview} - ${safePrimaryCharacter} - ${sequenceNumber}`,
      updatedAt: now,
      worldview: options.worldview,
    }
  }

  function persistActiveRecord(): void {
    if (activeLogId === '' || sourceLog === null) {
      return
    }

    logRecords = logRecords.map((record) =>
      record.id === activeLogId
        ? {
            ...record,
            characterColors: { ...characterColors },
            characterVisibility: { ...characterVisibility },
            entries: cloneEntries(entries),
            sourceFilename,
            sourceLabel,
            sourceLog: cloneSourceLog(sourceLog!),
            updatedAt: Date.now(),
          }
        : record,
    )
  }

  function applyRecordToWorkspace(record: StoredLogRecord): void {
    activeLogId = record.id
    sourceFilename = record.sourceFilename
    sourceLabel = record.sourceLabel
    sourceLog = cloneSourceLog(record.sourceLog)
    entries = cloneEntries(record.entries)
    characterColors = { ...record.characterColors }
    characterVisibility = { ...record.characterVisibility }
    characterNameDrafts = {}
    currentPage = 1
    pageJumpDraft = '1'
    isBodyOnlyMode = false
    isCharacterManagerOpen = false
    isDisplaySettingsOpen = false
    playbackIndex = 0
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackText = ''
    playbackPageRanges = []
    playbackPageIndex = 0
    isReviewOpen = false
    stopPlayback()
  }

  function openLogView(recordId: string, nextView: LogWorkbenchView): void {
    const record = logRecords.find((item) => item.id === recordId)

    if (!record) {
      return
    }

    applyRecordToWorkspace(record)
    view = nextView
  }

  function returnToOverview(): void {
    stopPlayback()
    view = 'overview'
    activeLogId = ''
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackPageRanges = []
    playbackPageIndex = 0
    playbackText = ''
    isReviewOpen = false
  }

  function updateUploadPrimaryCharacter(worldview: string, value: string): void {
    uploadPrimaryCharacterDrafts = {
      ...uploadPrimaryCharacterDrafts,
      [worldview]: value,
    }
  }

  function openUploaderForWorldview(worldview: string): void {
    const primaryCharacter = (uploadPrimaryCharacterDrafts[worldview] ?? '').trim()

    if (primaryCharacter === '') {
      expandedWorldview = worldview
      loadError = '新增 log 前必须填写主要角色名，名称会自动生成。'
      return
    }

    uploadTargetWorldview = worldview
    loadError = ''
    fileInputElement?.click()
  }

  async function createRecordFromText(options: {
    filename: string
    label: string
    primaryCharacter: string
    text: string
    worldview: string
  }): Promise<StoredLogRecord> {
    const parsed = parseSealDiceStandardLog(options.text)

    return createStoredLogRecord({
      filename: options.filename,
      label: options.label,
      parsed,
      primaryCharacter: options.primaryCharacter,
      worldview: options.worldview,
    })
  }

  async function handleFileSelection(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]

    if (!file) {
      return
    }

    try {
      const worldview = uploadTargetWorldview || expandedWorldview || logWorldviewCards[0]?.name || worldviewName
      const primaryCharacter = (uploadPrimaryCharacterDrafts[worldview] ?? '').trim()

      if (primaryCharacter === '') {
        throw new Error('上传前需要先填写主要角色名。')
      }

      const text = await file.text()
      const record = await createRecordFromText({
        filename: file.name,
        label: '上传文件',
        primaryCharacter,
        text,
        worldview,
      })

      logRecords = [record, ...logRecords]
      uploadPrimaryCharacterDrafts = {
        ...uploadPrimaryCharacterDrafts,
        [worldview]: '',
      }
      expandedWorldview = worldview
      loadError = ''
      openLogView(record.id, 'edit')
    } catch (error) {
      loadError = error instanceof Error ? error.message : '上传文件解析失败。'
    } finally {
      uploadTargetWorldview = ''
      input.value = ''
    }
  }

  async function seedSampleLog(): Promise<void> {
    if (hasSeededSample || logWorldviewCards.length === 0) {
      return
    }

    hasSeededSample = true
    isLoadingSample = true

    try {
      const response = await fetch(SAMPLE_LOG_PATH)

      if (!response.ok) {
        throw new Error(`示例日志读取失败：${response.status}`)
      }

      const text = await response.text()
      const parsed = parseSealDiceStandardLog(text)
      const worldview = expandedWorldview || initialWorldviewName || logWorldviewCards[0]?.name || worldviewName
      const primaryCharacter = derivePrimaryCharacter(parsed.entries)
      const record = createStoredLogRecord({
        filename: SAMPLE_FILE_NAME,
        label: '示例日志',
        parsed,
        primaryCharacter,
        worldview,
      })

      logRecords = [record]
      loadError = ''
    } catch (error) {
      loadError = error instanceof Error ? error.message : '示例日志读取失败。'
    } finally {
      isLoadingSample = false
    }
  }

  function removeLogRecord(recordId: string): void {
    const record = logRecords.find((item) => item.id === recordId)

    if (!record) {
      return
    }

    const shouldDelete = window.confirm(`确认删除“${record.title}”吗？此操作只会删除当前页面内的运行时记录。`)

    if (!shouldDelete) {
      return
    }

    logRecords = logRecords.filter((item) => item.id !== recordId)

    if (recordId === activeLogId) {
      returnToOverview()
    }
  }

  function updateEntryNickname(entryId: string, value: string): void {
    entries = entries.map((entry) =>
      entry.entryId === entryId
        ? {
            ...entry,
            nickname: value,
          }
        : entry,
    )
    persistActiveRecord()
  }

  function normaliseEntryNickname(entryId: string): void {
    entries = entries.map((entry) =>
      entry.entryId === entryId
        ? {
            ...entry,
            nickname: normaliseLogNickname(entry.nickname),
          }
        : entry,
    )
    persistActiveRecord()
  }

  function updateEntryMessage(entryId: string, value: string): void {
    entries = entries.map((entry) =>
      entry.entryId === entryId
        ? {
            ...entry,
            message: value,
          }
        : entry,
    )
    persistActiveRecord()
  }

  function updateCharacterColor(speakerKey: string, color: string): void {
    characterColors = {
      ...characterColors,
      [speakerKey]: color,
    }
    persistActiveRecord()
  }

  function updateCharacterVisibility(speakerKey: string, visible: boolean): void {
    characterVisibility = {
      ...characterVisibility,
      [speakerKey]: visible,
    }
    persistActiveRecord()
  }

  function updateCharacterDraft(speakerKey: string, value: string): void {
    characterNameDrafts = {
      ...characterNameDrafts,
      [speakerKey]: value,
    }
  }

  function commitCharacterRename(speakerKey: string): void {
    const currentName =
      entries.find((entry) => entry.speakerKey === speakerKey)?.nickname ?? '未命名角色'
    const draft = characterNameDrafts[speakerKey] ?? currentName
    const nextName = normaliseLogNickname(draft)

    const nextDrafts = { ...characterNameDrafts }
    delete nextDrafts[speakerKey]
    characterNameDrafts = nextDrafts

    if (nextName === currentName) {
      return
    }

    entries = entries.map((entry) =>
      entry.speakerKey === speakerKey
        ? {
            ...entry,
            nickname: nextName,
          }
        : entry,
    )

    persistActiveRecord()
  }

  function getCharacterColor(entryOrKey: Pick<EditableLogEntry, 'speakerKey'> | string): string {
    const speakerKey = typeof entryOrKey === 'string' ? entryOrKey : entryOrKey.speakerKey
    return characterColors[speakerKey] ?? CHARACTER_COLOR_POOL[0]
  }

  function toggleEntryKeep(entryId: string, keep: boolean): void {
    entries = entries.map((entry) =>
      entry.entryId === entryId
        ? {
            ...entry,
            keep,
          }
        : entry,
    )
    persistActiveRecord()
  }

  function scrollEditPaneToTop(): void {
    requestAnimationFrame(() => {
      editPaneElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function changeEditPage(nextPage: number): void {
    currentPage = clamp(nextPage, 1, totalPages)
    pageJumpDraft = String(currentPage)
    scrollEditPaneToTop()
  }

  function updateEditPageSize(value: string): void {
    const nextPageSize = Number(value)

    if (!PAGE_SIZE_OPTIONS.includes(nextPageSize)) {
      return
    }

    pageSize = nextPageSize
    changeEditPage(1)
  }

  function jumpToEditPage(): void {
    const parsed = Number(pageJumpDraft)

    if (!Number.isFinite(parsed)) {
      pageJumpDraft = String(currentPage)
      return
    }

    changeEditPage(Math.round(parsed))
  }

  function handlePageJumpKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    jumpToEditPage()
  }

  function isEntryModified(entry: EditableLogEntry): boolean {
    if (!sourceLog) {
      return false
    }

    const sourceItem = sourceLog.items[entry.sourceIndex]
    const sourceMessage =
      typeof sourceItem?.message === 'string' ? stripReplyPrefixFromLogMessage(sourceItem.message) : ''
    const sourceNickname =
      typeof sourceItem?.nickname === 'string' ? normaliseLogNickname(sourceItem.nickname) : '未命名角色'

    return entry.message !== sourceMessage || normaliseLogNickname(entry.nickname) !== sourceNickname
  }

  function clearPlaybackTimers(): void {
    if (playbackAdvanceTimer !== null) {
      window.clearTimeout(playbackAdvanceTimer)
      playbackAdvanceTimer = null
    }

    if (playbackTypeTimer !== null) {
      window.clearInterval(playbackTypeTimer)
      playbackTypeTimer = null
    }
  }

  function stopPlayback(): void {
    isPlaying = false
    clearPlaybackTimers()
  }

  function updateDownloadUrl(serialisedText: string): void {
    if (downloadUrl !== '') {
      URL.revokeObjectURL(downloadUrl)
      downloadUrl = ''
    }

    if (serialisedText === '') {
      return
    }

    downloadUrl = URL.createObjectURL(
      new Blob([serialisedText], { type: 'application/json;charset=utf-8' }),
    )
  }

  function updatePlaybackSpeed(value: string): void {
    const nextSpeed = Number(value)
    playbackSpeed = Number.isFinite(nextSpeed) && nextSpeed > 0 ? nextSpeed : 1
  }

  function stepPlayback(delta: number): void {
    if (playableEntries.length === 0) {
      return
    }

    stopPlayback()
    isReviewOpen = false
    playbackIndex = clamp(playbackIndex + delta, 0, Math.max(playableEntries.length - 1, 0))
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackPageIndex = 0
    playbackText = ''
  }

  function toggleReview(): void {
    isReviewOpen = !isReviewOpen

    if (isReviewOpen) {
      stopPlayback()
    }
  }

  function stepPlaybackPage(delta: number): void {
    if (!activePlaybackEntry || playbackPageCount <= 1) {
      return
    }

    stopPlayback()
    isReviewOpen = false
    playbackCursorEntryId = activePlaybackEntry.entryId
    playbackPageIndex = clamp(playbackPageIndex + delta, 0, playbackPageCount - 1)
    syncPausedPlaybackPage(false)
  }

  function resetPlayback(): void {
    stopPlayback()
    playbackIndex = 0
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackPageIndex = 0
    playbackText = ''
    isReviewOpen = false
  }

  function getPlaybackRanges(message: string): TextPageRange[] {
    return playbackPageRanges.length > 0 ? playbackPageRanges : [{ start: 0, end: message.length }]
  }

  function getPreferredBreakIndex(text: string): number {
    const breakCharacters = ['\n', '。', '！', '？', '；', '，', '、', ' ', '.', '!', '?', ';', ',']

    for (const character of breakCharacters) {
      const index = text.lastIndexOf(character)

      if (index >= Math.floor(text.length * 0.58)) {
        return index + 1
      }
    }

    return -1
  }

  function syncPlaybackMeasureStyle(): void {
    if (!playbackMeasureElement || !playbackTextElement) {
      return
    }

    const computed = window.getComputedStyle(playbackTextElement)
    playbackMeasureElement.style.font = computed.font
    playbackMeasureElement.style.fontFamily = computed.fontFamily
    playbackMeasureElement.style.fontSize = computed.fontSize
    playbackMeasureElement.style.fontWeight = computed.fontWeight
    playbackMeasureElement.style.fontStretch = computed.fontStretch
    playbackMeasureElement.style.fontStyle = computed.fontStyle
    playbackMeasureElement.style.lineHeight = computed.lineHeight
    playbackMeasureElement.style.letterSpacing = computed.letterSpacing
    playbackMeasureElement.style.wordSpacing = computed.wordSpacing
    playbackMeasureElement.style.whiteSpace = computed.whiteSpace
    playbackMeasureElement.style.wordBreak = computed.wordBreak
    playbackMeasureElement.style.overflowWrap = computed.overflowWrap
    playbackMeasureElement.style.textTransform = computed.textTransform
    playbackMeasureElement.style.textIndent = computed.textIndent
    playbackMeasureElement.style.boxSizing = computed.boxSizing
  }

  function measureTextPages(message: string): TextPageRange[] {
    if (!playbackMeasureElement || !playbackTextViewportElement || !playbackTextElement) {
      return [{ start: 0, end: message.length }]
    }

    const maxHeight = playbackTextViewportElement.clientHeight
    const maxWidth = playbackTextViewportElement.clientWidth

    if (maxHeight <= 0 || maxWidth <= 0 || message === '') {
      return [{ start: 0, end: message.length }]
    }

    syncPlaybackMeasureStyle()
    playbackMeasureElement.style.width = `${maxWidth}px`

    const pages: TextPageRange[] = []
    let start = 0

    while (start < message.length) {
      const remainingText = message.slice(start)
      playbackMeasureElement.textContent = remainingText

      if (playbackMeasureElement.scrollHeight <= maxHeight + 1) {
        pages.push({ start, end: message.length })
        break
      }

      let low = start + 1
      let high = message.length
      let best = start + 1

      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        playbackMeasureElement.textContent = message.slice(start, middle)

        if (playbackMeasureElement.scrollHeight <= maxHeight + 1) {
          best = middle
          low = middle + 1
        } else {
          high = middle - 1
        }
      }

      let end = best
      const preferredBreak = getPreferredBreakIndex(message.slice(start, best))

      if (preferredBreak > 0 && start + preferredBreak < message.length) {
        end = start + preferredBreak
      }

      if (end <= start) {
        end = Math.min(start + 1, message.length)
      }

      pages.push({ start, end })
      start = end
    }

    return pages.length > 0 ? pages : [{ start: 0, end: message.length }]
  }

  function updatePlaybackTextFromCursor(message: string, cursor: number): void {
    const ranges = getPlaybackRanges(message)

    if (cursor <= 0) {
      playbackPageIndex = 0
      playbackText = ''
      return
    }

    const rangeIndex = ranges.findIndex((range) => cursor <= range.end)
    const safeIndex = rangeIndex === -1 ? ranges.length - 1 : rangeIndex
    const range = ranges[safeIndex]

    playbackPageIndex = safeIndex
    playbackText = message.slice(range.start, Math.max(range.start, cursor))
  }

  function syncPausedPlaybackPage(resetPage = false): void {
    if (!activePlaybackEntry) {
      playbackText = ''
      return
    }

    const ranges = getPlaybackRanges(activePlaybackEntry.message)

    if (resetPage) {
      playbackPageIndex = 0
    }

    playbackPageIndex = clamp(playbackPageIndex, 0, Math.max(ranges.length - 1, 0))
    const range = ranges[playbackPageIndex] ?? ranges[0]
    playbackText = activePlaybackEntry.message.slice(range.start, range.end)
  }

  async function refreshPlaybackPagination(): Promise<void> {
    if (view !== 'play' || !activePlaybackEntry) {
      playbackPageRanges = []
      playbackPageIndex = 0
      return
    }

    const ticket = ++paginationRefreshTicket
    await tick()

    if (ticket !== paginationRefreshTicket || !activePlaybackEntry) {
      return
    }

    playbackPageRanges = measureTextPages(activePlaybackEntry.message)

    if (isPlaying) {
      updatePlaybackTextFromCursor(activePlaybackEntry.message, playbackCursor)
    } else {
      const shouldResetPage = playbackCursorEntryId !== activePlaybackEntry.entryId
      playbackCursorEntryId = activePlaybackEntry.entryId
      syncPausedPlaybackPage(shouldResetPage)
    }
  }

  function startTypewriter(message: string, startCursor = 0): void {
    clearPlaybackTimers()
    playbackCursor = startCursor
    playbackCursorEntryId = activePlaybackEntry?.entryId ?? ''
    updatePlaybackTextFromCursor(message, startCursor)

    if (message === '') {
      if (isPlaying && playbackIndex < playableEntries.length - 1) {
        playbackAdvanceTimer = window.setTimeout(() => {
          playbackCursor = 0
          playbackCursorEntryId = ''
          playbackIndex += 1
        }, Math.max(180, Math.round(420 / playbackSpeed)))
      } else if (isPlaying) {
        stopPlayback()
      }

      return
    }

    let cursor = startCursor
    const step = Math.max(1, Math.floor(playbackSpeed))
    const tickDuration = Math.max(12, Math.round(28 / playbackSpeed))

    playbackTypeTimer = window.setInterval(() => {
      cursor = Math.min(message.length, cursor + step)
      playbackCursor = cursor
      updatePlaybackTextFromCursor(message, cursor)

      if (cursor >= message.length) {
        if (playbackTypeTimer !== null) {
          window.clearInterval(playbackTypeTimer)
          playbackTypeTimer = null
        }

        if (isPlaying) {
          if (playbackIndex >= playableEntries.length - 1) {
            stopPlayback()
            syncPausedPlaybackPage(false)
            return
          }

          playbackAdvanceTimer = window.setTimeout(() => {
            playbackCursor = 0
            playbackCursorEntryId = ''
            playbackPageIndex = 0
            playbackIndex += 1
          }, Math.max(220, Math.round(520 / playbackSpeed)))
        }
      }
    }, tickDuration)
  }

  function togglePlayback(): void {
    if (!activePlaybackEntry) {
      return
    }

    if (isPlaying) {
      stopPlayback()
      syncPausedPlaybackPage(false)
      return
    }

    isReviewOpen = false
    isPlaying = true
  }

  onMount(() => {
    void seedSampleLog()
  })

  onDestroy(() => {
    stopPlayback()

    if (downloadUrl !== '') {
      URL.revokeObjectURL(downloadUrl)
    }
  })

  $: fallbackWorldviewCard = createFallbackWorldviewCard()
  $: worldviewTransitionKey
  $: logWorldviewCards = worldviewCards.length > 0 ? worldviewCards : [fallbackWorldviewCard]
  $: if (expandedWorldview !== '' && !logWorldviewCards.some((card) => card.name === expandedWorldview)) {
    expandedWorldview = ''
  }

  $: worldviewDirectory = logWorldviewCards.map((card) => ({
    ...card,
    logs: logRecords
      .filter((record) => record.worldview === card.name)
      .sort((left, right) => right.updatedAt - left.updatedAt),
  }))

  $: activeLogRecord = logRecords.find((record) => record.id === activeLogId) ?? null
  $: characterKeys = getCharacterKeys(entries)

  $: {
    const nextColors = ensureCharacterColors(characterKeys, characterColors)
    const shouldUpdateColors =
      Object.keys(nextColors).length !== Object.keys(characterColors).length ||
      characterKeys.some((key) => characterColors[key] !== nextColors[key])

    if (shouldUpdateColors) {
      characterColors = nextColors
      persistActiveRecord()
    }
  }

  $: {
    const nextVisibility = ensureCharacterVisibility(characterKeys, characterVisibility)
    const shouldUpdateVisibility =
      Object.keys(nextVisibility).length !== Object.keys(characterVisibility).length ||
      characterKeys.some((key) => characterVisibility[key] !== nextVisibility[key])

    if (shouldUpdateVisibility) {
      characterVisibility = nextVisibility
      persistActiveRecord()
    }
  }

  $: characterControls = buildCharacterControls(entries, characterColors, characterVisibility)
  $: visibleEntries = entries.filter((entry) => characterVisibility[entry.speakerKey] !== false)
  $: displayEntries = isBodyOnlyMode ? visibleEntries.filter(isNarrativeBodyEntry) : visibleEntries
  $: retainedEntries = entries.filter((entry) => entry.keep)
  $: retainedVisibleEntries = visibleEntries.filter((entry) => entry.keep)
  $: totalEntries = entries.length
  $: visibleEntryCount = displayEntries.length
  $: totalPages = Math.max(1, Math.ceil(displayEntries.length / pageSize))
  $: {
    const nextCurrentPage = clamp(currentPage, 1, totalPages)

    if (nextCurrentPage !== currentPage) {
      currentPage = nextCurrentPage
      pageJumpDraft = String(nextCurrentPage)
    }
  }
  $: pageStart = (currentPage - 1) * pageSize
  $: pageEntries = displayEntries.slice(pageStart, pageStart + pageSize)
  $: modifiedEntryCount = entries.reduce((count, entry) => count + Number(isEntryModified(entry)), 0)
  $: serialisedData = sourceLog ? serialiseSealDiceStandardLog(sourceLog, entries) : null
  $: serialisedLogText = serialisedData ? JSON.stringify(serialisedData, null, 2) : ''
  $: downloadFilename = createEditedLogFilename(sourceFilename)
  $: updateDownloadUrl(serialisedLogText)
  $: playableEntries = retainedVisibleEntries
  $: playbackIndex = clamp(playbackIndex, 0, Math.max(playableEntries.length - 1, 0))
  $: activePlaybackEntry = playableEntries[playbackIndex] ?? null
  $: reviewEntries = playableEntries.slice(Math.max(0, playbackIndex - 9), playbackIndex + 1).reverse()
  $: playbackPageCount = Math.max(playbackPageRanges.length, 1)
  $: playbackSignature = `${view}:${isPlaying}:${playbackIndex}:${playbackSpeed}:${activePlaybackEntry?.entryId ?? ''}`
  $: playbackPaginationKey = `${view}:${activePlaybackEntry?.entryId ?? ''}:${playbackMeasureVersion}`

  $: if (view === 'play' && activePlaybackEntry) {
    playbackPaginationKey
    void refreshPlaybackPagination()
  }

  $: if (view !== 'play') {
    stopPlayback()
    playbackFingerprint = ''
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackText = ''
    isReviewOpen = false
    playbackPageRanges = []
    playbackPageIndex = 0
  }

  $: if (view === 'play' && activePlaybackEntry) {
    if (!isPlaying) {
      clearPlaybackTimers()
      playbackFingerprint = ''

      if (playbackCursorEntryId !== activePlaybackEntry.entryId) {
        playbackCursor = 0
        playbackCursorEntryId = activePlaybackEntry.entryId
      }

      if (playbackPageRanges.length > 0) {
        syncPausedPlaybackPage(playbackCursor === 0)
      }
    } else if (playbackSignature !== playbackFingerprint) {
      playbackFingerprint = playbackSignature
      const startCursor = playbackCursorEntryId === activePlaybackEntry.entryId ? playbackCursor : 0
      startTypewriter(activePlaybackEntry.message, startCursor)
    }
  }

  $: if (view === 'play' && !activePlaybackEntry) {
    stopPlayback()
    playbackText = ''
    playbackCursor = 0
    playbackCursorEntryId = ''
    playbackPageRanges = []
    playbackPageIndex = 0
  }

  $: if (activeLogId !== '' && !logRecords.some((record) => record.id === activeLogId)) {
    returnToOverview()
  }
</script>

<section class="log-page">
  <section class="board log-board">
    <div class="board-head">
      <div>
        {#if view !== 'edit'}
          <!-- <h2>{view === 'overview' ? 'log展示页' : 'log播放页'}</h2> -->
        {/if}
        <p class:log-board-note-quiet={view === 'edit'} class="log-board-note">
          {#if view === 'overview'}
            主入口按世界观排列各个 log 目录。展开世界观后可查看已有记录，并从最下面一行直接新增上传 log。
          {:else if activeLogRecord && view === 'edit'}
            当前日志：{activeLogRecord.title}
          {:else if activeLogRecord}
            当前日志：{activeLogRecord.title}。
          {:else}
            请选择一个 log 记录后再进入对应子页面。
          {/if}
        </p>
      </div>

      {#if view === 'overview' || view === 'edit'}
        <div class="board-head-side">
          <div class="board-head-actions">
            {#if view === 'overview'}
              <button class="toolbar-action" type="button" onclick={seedSampleLog}>
                {isLoadingSample ? '正在读取示例…' : '载入示例记录'}
              </button>
            {:else}
              <button class="toolbar-action" type="button" onclick={returnToOverview}>返回展示页</button>

              <div class="mode-switcher" role="tablist" aria-label="日志子页面模式切换">
                <button
                  class="mode-switch is-current"
                  type="button"
                  onclick={() => (view = 'edit')}
                >
                  编辑
                </button>
                <button
                  class="mode-switch"
                  type="button"
                  onclick={() => (view = 'play')}
                >
                  播放
                </button>
              </div>

              {#if downloadUrl !== ''}
                <a class="toolbar-action toolbar-primary log-download-link" download={downloadFilename} href={downloadUrl}>
                  下载修改版
                </a>
              {:else}
                <button class="toolbar-action toolbar-primary" disabled type="button">下载修改版</button>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <input
      bind:this={fileInputElement}
      accept=".json,application/json"
      class="log-file-input"
      onchange={handleFileSelection}
      type="file"
    />

    {#if loadError !== ''}
      <div class="log-error-banner">{loadError}</div>
    {/if}

    {#if view === 'overview'}
      <div class="log-worldview-grid">
        {#each worldviewDirectory as worldview}
          <article class:is-expanded={expandedWorldview === worldview.name} class="log-worldview-card" style={worldview.themeStyle}>
            <section class:is-plain={!worldview.hasCover} class="log-worldview-stage">
              <button
                aria-expanded={expandedWorldview === worldview.name}
                class="log-worldview-summary"
                type="button"
                onclick={() => {
                  expandedWorldview = expandedWorldview === worldview.name ? '' : worldview.name
                }}
              >
                <div class="log-worldview-copy">
                  <span class="section-label">世界观目录</span>
                  <strong>{worldview.name}</strong>
                  <p>{worldview.description}</p>
                </div>

                <div class="log-worldview-meta">
                  <div class="log-worldview-count">
                    <strong>{worldview.logs.length}</strong>
                    <span>份 log</span>
                  </div>
                  <span class="log-worldview-toggle">{expandedWorldview === worldview.name ? '收起' : '展开'}</span>
                </div>
              </button>
            </section>

            {#if expandedWorldview === worldview.name}
              <div
                class="log-worldview-panel"
                in:slide={{ duration: 260 }}
                out:slide={{ duration: 180 }}
              >
                <div class="log-worldview-list">
                  {#if worldview.logs.length === 0}
                    <div class="log-empty-inline">当前世界观下还没有 log 记录，直接从底部上传第一份即可。</div>
                  {:else}
                    {#each worldview.logs as record}
                      <article class="log-record-item">
                        <div class="log-record-copy">
                          <strong>{record.title}</strong>
                          <p>
                            主要角色：{record.primaryCharacter} · {record.entries.length} 条发言 · 最后更新 {formatRecordTimestamp(record.updatedAt)}
                          </p>
                        </div>

                        <div class="log-record-actions">
                          <button class="toolbar-action" type="button" onclick={() => openLogView(record.id, 'edit')}>
                            编辑
                          </button>
                          <button class="toolbar-action" type="button" onclick={() => openLogView(record.id, 'play')}>
                            打开播放页
                          </button>
                          <button class="toolbar-action" type="button" onclick={() => removeLogRecord(record.id)}>
                            删除
                          </button>
                        </div>
                      </article>
                    {/each}
                  {/if}

                  <div class="log-upload-row">
                    <div class="log-upload-copy">
                      <strong>新增上传 log</strong>
                      <p>无需手动填写 log 名称，但必须先填写主要角色名，系统会自动生成“世界观 - 主要角色 - 编号”。</p>
                    </div>

                    <div class="log-upload-form">
                      <input
                        class="log-name-input"
                        maxlength="40"
                        oninput={(event) =>
                          updateUploadPrimaryCharacter(
                            worldview.name,
                            (event.currentTarget as HTMLInputElement).value,
                          )}
                        placeholder="主要角色名"
                        type="text"
                        value={uploadPrimaryCharacterDrafts[worldview.name] ?? ''}
                      />
                      <button class="toolbar-action toolbar-primary" type="button" onclick={() => openUploaderForWorldview(worldview.name)}>
                        新增上传 log
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {:else if activeLogRecord}
      {#if view === 'edit'}
        <div class="log-workbench-grid">
          <div bind:this={editPaneElement} class="log-pane log-main-pane">
            <div class="log-pane-head">
              <div class="log-pane-summary">
                <span>
                  第 {currentPage} 页 / 共 {totalPages} 页 · 当前显示 {visibleEntryCount} 条 · 保留导出 {retainedEntries.length} 条
                </span>
              </div>

              <div class="log-pagination-bar">
                <button
                  class="toolbar-action"
                  disabled={currentPage <= 1}
                  type="button"
                  onclick={() => changeEditPage(currentPage - 1)}
                >
                  上一页
                </button>
                <button
                  class="toolbar-action"
                  disabled={currentPage >= totalPages}
                  type="button"
                  onclick={() => changeEditPage(currentPage + 1)}
                >
                  下一页
                </button>
              </div>
            </div>

            {#if pageEntries.length === 0}
              <div class="log-empty-state">
                <strong>当前没有可编辑的日志条目。</strong>
                <p>你可能把所有角色都隐藏了，或者当前筛选条件下没有可显示的正文条目。</p>
              </div>
            {:else}
              <div class="log-entry-list">
                {#each pageEntries as entry (entry.entryId)}
                  <article
                    class:is-excluded={!entry.keep}
                    class="log-entry-row"
                    style={`--speaker-color:${getCharacterColor(entry)};`}
                  >
                    <input
                      class="log-name-input log-name-inline"
                      maxlength="40"
                      onblur={() => normaliseEntryNickname(entry.entryId)}
                      oninput={(event) =>
                        updateEntryNickname(
                          entry.entryId,
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                      placeholder="角色名"
                      type="text"
                      value={entry.nickname}
                    />

                    <textarea
                      class="log-message-input log-message-inline"
                      oninput={(event) =>
                        updateEntryMessage(
                          entry.entryId,
                          (event.currentTarget as HTMLTextAreaElement).value,
                        )}
                      placeholder="发言正文"
                      rows="2"
                      use:autosize={entry.message}
                    >{entry.message}</textarea>

                    <label class="log-entry-keep-toggle" title={entry.keep ? '保留此条日志' : '不保留此条日志'}>
                      <input
                        aria-label="是否保留该条日志"
                        checked={entry.keep}
                        onchange={(event) =>
                          toggleEntryKeep(entry.entryId, (event.currentTarget as HTMLInputElement).checked)}
                        type="checkbox"
                      />
                    </label>
                  </article>
                {/each}
              </div>

              <div class="log-pagination-footer">
                <button
                  class="toolbar-action"
                  disabled={currentPage <= 1}
                  type="button"
                  onclick={() => changeEditPage(currentPage - 1)}
                >
                  上一页
                </button>
                <span>第 {currentPage} 页 / 共 {totalPages} 页</span>
                <button
                  class="toolbar-action"
                  disabled={currentPage >= totalPages}
                  type="button"
                  onclick={() => changeEditPage(currentPage + 1)}
                >
                  下一页
                </button>
              </div>
            {/if}
          </div>

          <aside class="log-side-column">
            <section class="log-pane log-side-card">
              <button
                aria-expanded={isDisplaySettingsOpen}
                class="log-side-accordion"
                type="button"
                onclick={() => (isDisplaySettingsOpen = !isDisplaySettingsOpen)}
              >
                <div>
                  <strong>显示设置</strong>
                  <span>控制编辑区的显示密度、每页条数和页码跳转。</span>
                </div>
                <span>{isDisplaySettingsOpen ? '收起' : '展开'}</span>
              </button>

              {#if isDisplaySettingsOpen}
                <div class="log-display-settings">
                  <label class="log-display-toggle">
                    <input
                      checked={isBodyOnlyMode}
                      onchange={(event) => (isBodyOnlyMode = (event.currentTarget as HTMLInputElement).checked)}
                      type="checkbox"
                    />
                    <span>仅显示正文</span>
                  </label>

                  <label class="log-page-size">
                    <span>每页显示</span>
                    <select onchange={(event) => updateEditPageSize((event.currentTarget as HTMLSelectElement).value)} value={pageSize}>
                      {#each PAGE_SIZE_OPTIONS as option}
                        <option value={option}>{option} 条</option>
                      {/each}
                    </select>
                  </label>

                  <div class="log-page-jump-setting">
                    <label class="log-progress-field">
                      <span>跳转页码</span>
                      <input
                        max={totalPages}
                        min="1"
                        oninput={(event) => (pageJumpDraft = (event.currentTarget as HTMLInputElement).value)}
                        onkeydown={handlePageJumpKeydown}
                        type="number"
                        value={pageJumpDraft}
                      />
                    </label>

                    <button class="toolbar-action" type="button" onclick={jumpToEditPage}>跳转</button>
                  </div>
                </div>
              {/if}
            </section>

            <section class="log-pane log-side-card">
              <button
                aria-expanded={isCharacterManagerOpen}
                class="log-side-accordion"
                type="button"
                onclick={() => (isCharacterManagerOpen = !isCharacterManagerOpen)}
              >
                <div>
                  <strong>角色管理</strong>
                  <span>右侧统一改名、改色，并决定是否显示该角色的发言。</span>
                </div>
                <span>{isCharacterManagerOpen ? '收起' : '展开'}</span>
              </button>

              {#if isCharacterManagerOpen}
                <div class="log-character-list">
                  {#if characterControls.length === 0}
                    <div class="log-empty-inline">载入日志后，这里会列出所有已识别的角色。</div>
                  {:else}
                    {#each characterControls as character}
                      <div class="log-character-row" style={`--character-color:${character.color};`}>
                        <input
                          aria-label={`${character.name} 颜色`}
                          class="log-character-color"
                          oninput={(event) =>
                            updateCharacterColor(
                              character.key,
                              (event.currentTarget as HTMLInputElement).value,
                            )}
                          type="color"
                          value={character.color}
                        />

                        <div class="log-character-copy">
                          <input
                            class="log-character-name-input"
                            maxlength="40"
                            onblur={() => commitCharacterRename(character.key)}
                            oninput={(event) =>
                              updateCharacterDraft(
                                character.key,
                                (event.currentTarget as HTMLInputElement).value,
                              )}
                            placeholder="角色名"
                            type="text"
                            value={characterNameDrafts[character.key] ?? character.name}
                          />
                          <span>{character.count} 条发言</span>
                        </div>

                        <label class="log-character-visibility">
                          <input
                            checked={character.visible}
                            onchange={(event) =>
                              updateCharacterVisibility(
                                character.key,
                                (event.currentTarget as HTMLInputElement).checked,
                              )}
                            type="checkbox"
                          />
                          <span>显示</span>
                        </label>
                      </div>
                    {/each}
                  {/if}
                </div>
              {/if}
            </section>
          </aside>
        </div>
      {:else}
        <div class="log-playback-pane">
          <div class="log-playback-toolbar">
            <div class="log-playback-toolbar-row">
              <div class="log-playback-actions">
                <button class="toolbar-action" type="button" onclick={() => stepPlayback(-1)}>上一条</button>
                <button class="toolbar-action toolbar-primary" type="button" onclick={togglePlayback}>
                  {isPlaying ? '暂停' : '播放'}
                </button>
                <button class="toolbar-action" type="button" onclick={() => stepPlayback(1)}>下一条</button>
                <button class="toolbar-action" type="button" onclick={toggleReview}>
                  {isReviewOpen ? '收起回顾' : '回顾'}
                </button>
                <button class="toolbar-action" type="button" onclick={resetPlayback}>回到开头</button>
                <label class="log-speed-field log-speed-inline">
                  <span>倍速</span>
                  <select
                    onchange={(event) => updatePlaybackSpeed((event.currentTarget as HTMLSelectElement).value)}
                    value={String(playbackSpeed)}
                  >
                    <option value="0.5">0.5x</option>
                    <option value="1">1x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                    <option value="3">3x</option>
                  </select>
                </label>
              </div>

              <div class="log-view-actions">
                <button class="toolbar-action" type="button" onclick={returnToOverview}>返回展示页</button>

                <div class="mode-switcher" role="tablist" aria-label="日志子页面模式切换">
                  <button
                    class="mode-switch"
                    type="button"
                    onclick={() => (view = 'edit')}
                  >
                    编辑
                  </button>
                  <button
                    class="mode-switch is-current"
                    type="button"
                    onclick={() => (view = 'play')}
                  >
                    播放
                  </button>
                </div>

                {#if downloadUrl !== ''}
                  <a class="toolbar-action toolbar-primary log-download-link" download={downloadFilename} href={downloadUrl}>
                    下载修改版
                  </a>
                {:else}
                  <button class="toolbar-action toolbar-primary" disabled type="button">下载修改版</button>
                {/if}
              </div>
            </div>
          </div>

          {#if activePlaybackEntry}
            <!-- <div class="log-page-jump-bar">
              <button
                class="toolbar-action"
                disabled={playbackPageIndex <= 0}
                type="button"
                onclick={() => stepPlaybackPage(-1)}
              >
                上一页正文
              </button>
              <span>正文第 {playbackPageIndex + 1} 页 / 共 {playbackPageCount} 页</span>
              <button
                class="toolbar-action"
                disabled={playbackPageIndex >= playbackPageCount - 1}
                type="button"
                onclick={() => stepPlaybackPage(1)}
              >
                下一页正文
              </button>
            </div> -->

            <div class="log-playback-screen" style={`--speaker-color:${getCharacterColor(activePlaybackEntry)};`}>
              <div class="log-playback-stage-mark">
                <span>{normaliseLogNickname(activePlaybackEntry.nickname)}</span>
                <strong>{playbackIndex + 1} / {playableEntries.length}</strong>
              </div>

              <div class="log-playback-caption">
                <div class="log-playback-caption-head">
                  <p class="log-playback-speaker">{normaliseLogNickname(activePlaybackEntry.nickname)}</p>
                  <span>正文第 {playbackPageIndex + 1} 页 / 共 {playbackPageCount} 页</span>
                </div>

                <div bind:this={playbackTextViewportElement} class="log-playback-text-viewport" use:observePlaybackViewport>
                  <p bind:this={playbackTextElement} class="log-playback-text">{playbackText}</p>
                </div>
              </div>
            </div>

            <p bind:this={playbackMeasureElement} aria-hidden="true" class="log-playback-text-measure"></p>


            {#if isReviewOpen}
              <section class="log-review-panel">
                <div class="log-review-head">
                  <strong>最近 10 条回顾</strong>
                  <span>打开回顾时播放会自动暂停。</span>
                </div>

                <div class="log-review-list">
                  {#each reviewEntries as entry (entry.entryId)}
                    <article class="log-review-item" style={`--speaker-color:${getCharacterColor(entry)};`}>
                      <strong>{normaliseLogNickname(entry.nickname)}</strong>
                      <p>{entry.message}</p>
                    </article>
                  {/each}
                </div>
              </section>
            {/if}
          {:else}
            <div class="log-empty-state">
              <strong>当前没有可播放的日志条目。</strong>
              <p>先回到展示页选择一个日志，或者在编辑页重新打开某些角色的显示开关。</p>
            </div>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="log-empty-state">
        <strong>当前没有激活的 log 记录。</strong>
        <p>回到展示页，从某个世界观卡片中选择要编辑或播放的 log。</p>
      </div>
    {/if}
  </section>
</section>
