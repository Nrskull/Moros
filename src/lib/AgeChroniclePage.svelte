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
  } from './age-chronicle'

  export let worldviewDescription = ''
  export let worldviewHasCover = true
  export let worldviewName = '未选择世界观'
  export let worldviewTags: string[] = []
  export let worldviewThemeStyle = ''
  export let worldviewTransitionKey = 'default'

  const colorPool = ['#a46245', '#4d7b95', '#7c6497', '#5a8b64', '#b06f8d', '#9a7a42']
  const CREATE_CHRONICLE_PANEL_ID = 'create'
  const DEFAULT_CHRONICLE_NOTE = '补充这一节点的事件背景或阶段说明。'
  const AGE_CHRONICLE_STORAGE_KEY_PREFIX = 'morosonder:age-chronicle:v1'
  const AGE_CELL_DESCRIPTION_PLACEHOLDER = '记录这一年的状态、事件或身份变化。'

  interface StoredAgeChronicleState {
    cellDescriptions: Record<string, string>
    characterProfiles: CharacterAgeProfile[]
    chronicleEntries: ChronicleEntry[]
    hiddenCharacterIds: string[]
    nextCharacterIndex: number
    nextChronicleIndex: number
  }

  let nextCharacterIndex = sampleCharacterProfiles.length
  let nextChronicleIndex = sampleChronicleEntries.length

  let chronicleAccordionElement: HTMLDivElement | null = null
  let draggedCharacterId = ''
  let loadedWorldviewStorageKey = ''
  let isStorageHydrated = false
  let isCellDescriptionPromptOpen = false
  let activeDescriptionProfileId = ''
  let activeDescriptionEntryId = ''
  let activeCellDescriptionDraft = ''

  let chronicleEntries: ChronicleEntry[] = sampleChronicleEntries.map((entry) => ({ ...entry }))
  let characterProfiles: CharacterAgeProfile[] = sampleCharacterProfiles.map((profile) => ({ ...profile }))
  let hiddenCharacterIds: string[] = []
  let cellDescriptions: Record<string, string> = {}

  let activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
  let draftChronicleYear = getNextChronicleYear(sampleChronicleEntries)
  let draftChronicleLabel = `新编年 ${draftChronicleYear}`
  let draftChronicleNote = DEFAULT_CHRONICLE_NOTE

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
  $: activeDescriptionProfile =
    activeDescriptionProfileId === ''
      ? null
      : characterProfiles.find((profile) => profile.id === activeDescriptionProfileId) ?? null
  $: activeDescriptionEntry =
    activeDescriptionEntryId === ''
      ? null
      : chronicleEntries.find((entry) => entry.id === activeDescriptionEntryId) ?? null

  function cloneChronicleEntries(entries: ChronicleEntry[]): ChronicleEntry[] {
    return entries.map((entry) => ({ ...entry }))
  }

  function cloneCharacterProfiles(profiles: CharacterAgeProfile[]): CharacterAgeProfile[] {
    return profiles.map((profile) => ({ ...profile }))
  }

  function createAgeCellDescriptionKey(profileId: string, entryId: string): string {
    return `${profileId}::${entryId}`
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

  function getAgeChronicleStorageKey(targetWorldview = worldviewName): string {
    return `${AGE_CHRONICLE_STORAGE_KEY_PREFIX}:${normaliseWorldviewStorageName(targetWorldview)}`
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  function sanitiseChronicleEntries(input: unknown): ChronicleEntry[] {
    if (!Array.isArray(input)) {
      return cloneChronicleEntries(sampleChronicleEntries)
    }

    const entries = input.flatMap((entry): ChronicleEntry[] => {
      if (!isRecord(entry)) {
        return []
      }

      const id = typeof entry.id === 'string' ? entry.id.trim() : ''
      const label = typeof entry.label === 'string' ? entry.label : ''
      const note = typeof entry.note === 'string' ? entry.note : ''
      const year = Number(entry.year)

      if (id === '' || !Number.isFinite(year)) {
        return []
      }

      return [
        {
          id,
          label: label.trim() || `新编年 ${year}`,
          note,
          year,
        },
      ]
    })

    return entries.length > 0 ? entries : cloneChronicleEntries(sampleChronicleEntries)
  }

  function sanitiseCharacterProfiles(input: unknown): CharacterAgeProfile[] {
    if (!Array.isArray(input)) {
      return cloneCharacterProfiles(sampleCharacterProfiles)
    }

    const profiles = input.flatMap((profile): CharacterAgeProfile[] => {
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
          id,
          anchorAge: Math.max(0, anchorAge),
          anchorYear,
          color: color.trim() || colorPool[0],
          name: name.trim() || '未命名角色',
        },
      ]
    })

    return profiles.length > 0 ? profiles : cloneCharacterProfiles(sampleCharacterProfiles)
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

  function sanitiseCellDescriptions(
    input: unknown,
    profiles: CharacterAgeProfile[],
    entries: ChronicleEntry[],
  ): Record<string, string> {
    if (!isRecord(input)) {
      return {}
    }

    const validProfileIds = new Set(profiles.map((profile) => profile.id))
    const validEntryIds = new Set(entries.map((entry) => entry.id))

    return Object.entries(input).reduce<Record<string, string>>((map, [key, value]) => {
      if (typeof value !== 'string') {
        return map
      }

      const [profileId, entryId] = key.split('::')

      if (!validProfileIds.has(profileId) || !validEntryIds.has(entryId)) {
        return map
      }

      if (value.trim() === '') {
        return map
      }

      map[key] = value
      return map
    }, {})
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

  function createDefaultStoredState(): StoredAgeChronicleState {
    return {
      cellDescriptions: {},
      characterProfiles: cloneCharacterProfiles(sampleCharacterProfiles),
      chronicleEntries: cloneChronicleEntries(sampleChronicleEntries),
      hiddenCharacterIds: [],
      nextCharacterIndex: sampleCharacterProfiles.length,
      nextChronicleIndex: sampleChronicleEntries.length,
    }
  }

  function readStoredAgeChronicleState(storageKey: string): StoredAgeChronicleState | null {
    if (typeof localStorage === 'undefined') {
      return null
    }

    try {
      const raw = localStorage.getItem(storageKey)

      if (raw === null) {
        return null
      }

      const parsed = JSON.parse(raw) as unknown

      if (!isRecord(parsed)) {
        return null
      }

      const nextChronicleEntries = sanitiseChronicleEntries(parsed.chronicleEntries)
      const nextCharacterProfiles = sanitiseCharacterProfiles(parsed.characterProfiles)

      return {
        cellDescriptions: sanitiseCellDescriptions(
          parsed.cellDescriptions,
          nextCharacterProfiles,
          nextChronicleEntries,
        ),
        characterProfiles: nextCharacterProfiles,
        chronicleEntries: nextChronicleEntries,
        hiddenCharacterIds: sanitiseHiddenCharacterIds(parsed.hiddenCharacterIds, nextCharacterProfiles),
        nextCharacterIndex: resolveNextStoredIndex(
          parsed.nextCharacterIndex,
          'char_custom_',
          nextCharacterProfiles.map((profile) => profile.id),
          sampleCharacterProfiles.length,
        ),
        nextChronicleIndex: resolveNextStoredIndex(
          parsed.nextChronicleIndex,
          'chronicle_custom_',
          nextChronicleEntries.map((entry) => entry.id),
          sampleChronicleEntries.length,
        ),
      }
    } catch {
      return null
    }
  }

  function applyStoredAgeChronicleState(state: StoredAgeChronicleState): void {
    chronicleEntries = cloneChronicleEntries(state.chronicleEntries)
    characterProfiles = cloneCharacterProfiles(state.characterProfiles)
    hiddenCharacterIds = [...state.hiddenCharacterIds]
    cellDescriptions = { ...state.cellDescriptions }
    nextCharacterIndex = state.nextCharacterIndex
    nextChronicleIndex = state.nextChronicleIndex
    activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
    resetChronicleDraft()
    resetCharacterDraft()
  }

  function loadAgeChronicleState(targetWorldview = worldviewName): void {
    const storageKey = getAgeChronicleStorageKey(targetWorldview)
    const storedState = readStoredAgeChronicleState(storageKey) ?? createDefaultStoredState()

    applyStoredAgeChronicleState(storedState)
    loadedWorldviewStorageKey = storageKey
    isStorageHydrated = true
  }

  function persistAgeChronicleState(): void {
    if (typeof localStorage === 'undefined' || !isStorageHydrated || loadedWorldviewStorageKey === '') {
      return
    }

    const payload: StoredAgeChronicleState = {
      cellDescriptions: { ...cellDescriptions },
      characterProfiles: cloneCharacterProfiles(characterProfiles),
      chronicleEntries: cloneChronicleEntries(chronicleEntries),
      hiddenCharacterIds: [...hiddenCharacterIds],
      nextCharacterIndex,
      nextChronicleIndex,
    }

    try {
      localStorage.setItem(loadedWorldviewStorageKey, JSON.stringify(payload))
    } catch {
      // Ignore quota or serialisation failures and keep the page usable.
    }
  }

  function createChronicleId(): string {
    nextChronicleIndex += 1
    return `chronicle_custom_${nextChronicleIndex}`
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
    draftChronicleNote = DEFAULT_CHRONICLE_NOTE
  }

  function resetCharacterDraft(): void {
    draftCharacterName = `新角色 ${nextCharacterIndex + 1}`
    draftCharacterAnchorYear = getChronicleAnchorYear(chronicleEntries)
    draftCharacterAnchorAge = 16
    draftCharacterColor = colorPool[nextCharacterIndex % colorPool.length]
  }

  function openChroniclePanel(panelId: string): void {
    activeChroniclePanelId = panelId
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

  function saveChronicleDraft(): void {
    const year = normaliseNumber(draftChronicleYear, getNextChronicleYear(chronicleEntries))
    const label = draftChronicleLabel.trim() || `新编年 ${year}`
    const note = draftChronicleNote.trim()

    chronicleEntries = [
      ...chronicleEntries,
      {
        id: createChronicleId(),
        label,
        note,
        year,
      },
    ]

    activeChroniclePanelId = CREATE_CHRONICLE_PANEL_ID
    resetChronicleDraft()
  }

  function updateChronicleEntry(entryId: string, field: 'label' | 'note' | 'year', value: string): void {
    chronicleEntries = chronicleEntries.map((entry) => {
      if (entry.id !== entryId) {
        return entry
      }

      if (field === 'year') {
        return {
          ...entry,
          year: normaliseNumber(value, entry.year),
        }
      }

      return {
        ...entry,
        [field]: value,
      }
    })
  }

  function addCharacterProfile(): void {
    const profile: CharacterAgeProfile = {
      id: createCharacterId(),
      name: draftCharacterName.trim() || `新角色 ${nextCharacterIndex}`,
      anchorYear: normaliseNumber(draftCharacterAnchorYear, getChronicleAnchorYear(chronicleEntries)),
      anchorAge: Math.max(0, normaliseNumber(draftCharacterAnchorAge, 16)),
      color: draftCharacterColor,
    }

    characterProfiles = [...characterProfiles, profile]
    resetCharacterDraft()
  }

  function removeChronicleEntry(entryId: string): void {
    if (chronicleEntries.length <= 1) {
      return
    }

    chronicleEntries = chronicleEntries.filter((entry) => entry.id !== entryId)
    cellDescriptions = Object.fromEntries(
      Object.entries(cellDescriptions).filter(([key]) => !key.endsWith(`::${entryId}`)),
    )

    if (activeChroniclePanelId === entryId) {
      collapseChroniclePanels()
    }

    if (activeDescriptionEntryId === entryId) {
      closeCellDescriptionPrompt()
    }

    resetChronicleDraft()
  }

  function removeCharacterProfile(profileId: string): void {
    if (characterProfiles.length <= 1) {
      return
    }

    characterProfiles = characterProfiles.filter((profile) => profile.id !== profileId)
    hiddenCharacterIds = hiddenCharacterIds.filter((id) => id !== profileId)
    cellDescriptions = Object.fromEntries(
      Object.entries(cellDescriptions).filter(([key]) => !key.startsWith(`${profileId}::`)),
    )

    if (activeDescriptionProfileId === profileId) {
      closeCellDescriptionPrompt()
    }
  }

  function toggleCharacterVisibility(profileId: string): void {
    hiddenCharacterIds = hiddenCharacterIds.includes(profileId)
      ? hiddenCharacterIds.filter((id) => id !== profileId)
      : [...hiddenCharacterIds, profileId]
  }

  function handleCharacterDragStart(profileId: string): void {
    draggedCharacterId = profileId
  }

  function handleCharacterDrop(targetId: string): void {
    if (draggedCharacterId === '' || draggedCharacterId === targetId) {
      return
    }

    const sourceIndex = characterProfiles.findIndex((profile) => profile.id === draggedCharacterId)
    const targetIndex = characterProfiles.findIndex((profile) => profile.id === targetId)

    if (sourceIndex === -1 || targetIndex === -1) {
      return
    }

    const reorderedProfiles = [...characterProfiles]
    const [sourceProfile] = reorderedProfiles.splice(sourceIndex, 1)
    reorderedProfiles.splice(targetIndex, 0, sourceProfile)
    characterProfiles = reorderedProfiles
    draggedCharacterId = ''
  }

  function handleCharacterDragEnd(): void {
    draggedCharacterId = ''
  }

  function getAgeTone(color: string): string {
    return `${color}18`
  }

  function getCellDescription(profileId: string, entryId: string): string {
    return cellDescriptions[createAgeCellDescriptionKey(profileId, entryId)] ?? ''
  }

  function updateCellDescription(profileId: string, entryId: string, value: string): void {
    const descriptionKey = createAgeCellDescriptionKey(profileId, entryId)
    const nextValue = value

    if (nextValue.trim() === '') {
      const nextDescriptions = { ...cellDescriptions }
      delete nextDescriptions[descriptionKey]
      cellDescriptions = nextDescriptions
      return
    }

    cellDescriptions = {
      ...cellDescriptions,
      [descriptionKey]: nextValue,
    }
  }

  function openCellDescriptionPrompt(profileId: string, entryId: string): void {
    activeDescriptionProfileId = profileId
    activeDescriptionEntryId = entryId
    activeCellDescriptionDraft = getCellDescription(profileId, entryId)
    isCellDescriptionPromptOpen = true
  }

  function closeCellDescriptionPrompt(): void {
    isCellDescriptionPromptOpen = false
    activeDescriptionProfileId = ''
    activeDescriptionEntryId = ''
    activeCellDescriptionDraft = ''
  }

  function saveCellDescriptionDraft(): void {
    if (activeDescriptionProfileId === '' || activeDescriptionEntryId === '') {
      return
    }

    updateCellDescription(activeDescriptionProfileId, activeDescriptionEntryId, activeCellDescriptionDraft)
    closeCellDescriptionPrompt()
  }

  onMount(() => {
    loadAgeChronicleState(worldviewName)
  })

  $: if (isStorageHydrated && loadedWorldviewStorageKey !== getAgeChronicleStorageKey(worldviewName)) {
    loadAgeChronicleState(worldviewName)
  }

  $: if (isStorageHydrated) {
    loadedWorldviewStorageKey
    chronicleEntries
    characterProfiles
    hiddenCharacterIds
    cellDescriptions
    nextChronicleIndex
    nextCharacterIndex
    persistAgeChronicleState()
  }
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
          <p class="age-panel-tip">顶部固定新增，历史节点点击展开，点外部统一收起。</p>
        </div>

        <div bind:this={chronicleAccordionElement} class="age-editor-list age-editor-list-accordion">
          <article
            class:is-expanded={activeChroniclePanelId === CREATE_CHRONICLE_PANEL_ID}
            class:is-collapsed={activeChroniclePanelId !== CREATE_CHRONICLE_PANEL_ID}
            class="age-editor-card age-editor-card-create"
          >
            <button
              class="age-editor-toggle"
              type="button"
              aria-expanded={activeChroniclePanelId === CREATE_CHRONICLE_PANEL_ID}
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
                <label class="age-field">
                  <span>标签</span>
                  <input bind:value={draftChronicleLabel} type="text" />
                </label>

                <label class="age-field">
                  <span>编年值</span>
                  <input bind:value={draftChronicleYear} type="number" />
                </label>

                <label class="age-field">
                  <span>备注</span>
                  <textarea bind:value={draftChronicleNote} rows="3"></textarea>
                </label>

                <div class="age-editor-actions">
                  <button class="toolbar-action" type="button" onclick={collapseChroniclePanels}>
                    收起
                  </button>
                  <button class="toolbar-action toolbar-primary" type="button" onclick={saveChronicleDraft}>
                    保存节点
                  </button>
                </div>
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
                class="age-editor-toggle"
                type="button"
                aria-expanded={activeChroniclePanelId === entry.id}
                onclick={() => openChroniclePanel(entry.id)}
              >
                <div class="age-editor-toggle-copy">
                  <span class="age-editor-year">第 {entry.year} 年</span>
                  <strong>{entry.label}</strong>
                </div>
                <span class="age-editor-hint">
                  {activeChroniclePanelId === entry.id ? '编辑中' : '点击展开'}
                </span>
              </button>

              {#if activeChroniclePanelId === entry.id}
                <div class="age-editor-body" transition:slide={{ duration: 180 }}>
                  <label class="age-field">
                    <span>标签</span>
                    <input
                      type="text"
                      value={entry.label}
                      oninput={(event) =>
                        updateChronicleEntry(
                          entry.id,
                          'label',
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                    />
                  </label>

                  <label class="age-field">
                    <span>编年值</span>
                    <input
                      type="number"
                      value={entry.year}
                      oninput={(event) =>
                        updateChronicleEntry(
                          entry.id,
                          'year',
                          (event.currentTarget as HTMLInputElement).value,
                        )}
                    />
                  </label>

                  <label class="age-field">
                    <span>备注</span>
                    <textarea
                      rows="3"
                      oninput={(event) =>
                        updateChronicleEntry(
                          entry.id,
                          'note',
                          (event.currentTarget as HTMLTextAreaElement).value,
                        )}
                    >{entry.note}</textarea>
                  </label>

                  <div class="age-editor-actions">
                    <button class="toolbar-action" type="button" onclick={collapseChroniclePanels}>
                      收起
                    </button>
                    <button
                      class="age-remove"
                      type="button"
                      onclick={() => removeChronicleEntry(entry.id)}
                      disabled={chronicleEntries.length <= 1}
                    >
                      删除
                    </button>
                  </div>
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </section>

      <section class="age-panel">
        <div class="age-panel-head">
          <div>
            <p class="section-label">角色录入</p>
            <h3>新增角色</h3>
          </div>
          <p class="age-panel-tip">角色确认添加后只保留在右侧图例区，通过图例控制显示、顺序和删除。</p>
        </div>

        <div class="age-editor-list">
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
              <button class="toolbar-action toolbar-primary" type="button" onclick={addCharacterProfile}>
                添加角色
              </button>
            </div>
          </article>
        </div>
      </section>
    </aside>

    <section class="board age-board">
      <div class="board-head age-board-head">
        <div>
          <p class="section-label">编年视图</p>
          <h2>同一节点下的角色年龄对照</h2>
        </div>
        <p class="board-note">
          点击角色条可切换显示，拖动可调整左右顺序，删除也在这里完成。
        </p>
      </div>

      <div class="age-legend age-legend-interactive" aria-label="角色图例">
        {#each characterProfiles as profile (profile.id)}
          <article
            class:is-dragging={draggedCharacterId === profile.id}
            class:is-hidden={hiddenCharacterIds.includes(profile.id)}
            class="age-legend-item age-legend-card"
            draggable="true"
            style={`--legend-color:${profile.color}; --legend-tint:${getAgeTone(profile.color)};`}
            ondragend={handleCharacterDragEnd}
            ondragover={(event) => event.preventDefault()}
            ondragstart={() => handleCharacterDragStart(profile.id)}
            ondrop={() => handleCharacterDrop(profile.id)}
          >
            <button class="age-legend-main" type="button" onclick={() => toggleCharacterVisibility(profile.id)}>
              <span class="age-swatch" aria-hidden="true"></span>
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

            <button
              class="age-legend-delete"
              type="button"
              onclick={() => removeCharacterProfile(profile.id)}
              disabled={characterProfiles.length <= 1}
            >
              删除
            </button>
          </article>
        {/each}
      </div>

      {#if visibleCharacterProfiles.length === 0}
        <div class="age-empty-state">
          <strong>当前没有显示中的角色</strong>
          <p>点击上面的角色条重新显示，或先在左侧添加新的角色。</p>
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
                <span>第 {entry.year} 年</span>
                {#if entry.note}
                  <p>{entry.note}</p>
                {/if}
              </div>

              {#each visibleCharacterProfiles as profile (profile.id)}
                {@const cellDescription = getCellDescription(profile.id, entry.id).trim()}
                <button
                  class="age-cell age-value-cell"
                  style={`--cell-color:${profile.color}; --cell-tint:${getAgeTone(profile.color)};`}
                  type="button"
                  onclick={() => openCellDescriptionPrompt(profile.id, entry.id)}
                >
                  <div class="age-value-meta">
                    <strong>{formatCharacterAge(calculateCharacterAge(entry.year, profile))}</strong>
                    <span class="age-value-preview">{cellDescription || profile.name}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </section>

  {#if isCellDescriptionPromptOpen && activeDescriptionProfile && activeDescriptionEntry}
    <div class="age-note-overlay">
      <button
        aria-label="关闭年度描述弹窗"
        class="age-note-dismiss"
        type="button"
        onclick={closeCellDescriptionPrompt}
      ></button>

      <div class="age-note-dialog" role="dialog" aria-modal="true" aria-labelledby="age-note-title">
        <div class="age-note-dialog-head">
          <div class="age-note-dialog-copy">
            <span class="section-label">年度描述</span>
            <h3 id="age-note-title">{activeDescriptionProfile.name} · {activeDescriptionEntry.label}</h3>
            <p>
              第 {activeDescriptionEntry.year} 年 ·
              {formatCharacterAge(calculateCharacterAge(activeDescriptionEntry.year, activeDescriptionProfile))}
            </p>
          </div>

          <button class="toolbar-action" type="button" onclick={closeCellDescriptionPrompt}>
            关闭
          </button>
        </div>

        <label class="age-field">
          <span>描述</span>
          <textarea
            bind:value={activeCellDescriptionDraft}
            placeholder={AGE_CELL_DESCRIPTION_PLACEHOLDER}
            rows="6"
          ></textarea>
        </label>

        <div class="age-note-dialog-actions">
          <button
            class="toolbar-action"
            type="button"
            onclick={() => {
              activeCellDescriptionDraft = ''
            }}
          >
            清空
          </button>
          <button class="toolbar-action toolbar-primary" type="button" onclick={saveCellDescriptionDraft}>
            保存描述
          </button>
        </div>
      </div>
    </div>
  {/if}
</section>
