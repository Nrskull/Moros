<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cardDeckIn, cardDeckOut } from './transitions'
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

  let nextCharacterIndex = sampleCharacterProfiles.length
  let nextChronicleIndex = sampleChronicleEntries.length

  let chronicleAccordionElement: HTMLDivElement | null = null
  let draggedCharacterId = ''

  let chronicleEntries: ChronicleEntry[] = sampleChronicleEntries.map((entry) => ({ ...entry }))
  let characterProfiles: CharacterAgeProfile[] = sampleCharacterProfiles.map((profile) => ({ ...profile }))
  let hiddenCharacterIds: string[] = []

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
    draftCharacterAnchorYear = sortedChronicleEntries[0]?.year ?? 0
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
      anchorYear: normaliseNumber(draftCharacterAnchorYear, sortedChronicleEntries[0]?.year ?? 0),
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

    if (activeChroniclePanelId === entryId) {
      collapseChroniclePanels()
    }

    resetChronicleDraft()
  }

  function removeCharacterProfile(profileId: string): void {
    if (characterProfiles.length <= 1) {
      return
    }

    characterProfiles = characterProfiles.filter((profile) => profile.id !== profileId)
    hiddenCharacterIds = hiddenCharacterIds.filter((id) => id !== profileId)
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
</script>

<svelte:window onclick={handleWindowClick} />

<section class="age-page">
  <div class="worldview-stage worldview-stage-hero">
    {#each [
      {
        description: worldviewDescription,
        hasCover: worldviewHasCover,
        key: worldviewTransitionKey,
        name: worldviewName,
        tags: worldviewTags,
        themeStyle: worldviewThemeStyle,
      },
    ] as scene (scene.key)}
      <section
        class:is-current={scene.key === worldviewTransitionKey}
        class:is-plain={!scene.hasCover}
        class="hero-panel hero-panel-worldview age-hero worldview-layer"
        style={scene.themeStyle}
        in:cardDeckIn
        out:cardDeckOut
      >
        <div class="hero-copy worldview-hero-copy">
          <p class="eyebrow">当前世界观 / 角色年龄编年</p>
          <h1>{scene.name}</h1>
          <p class="lede">
            {scene.description} 当前页面按自定义编年节点记录角色年龄，并根据“基准编年 + 基准年龄”自动推算。
          </p>
          <div class="hero-pill-row" aria-label="角色年龄页补充信息">
            {#each scene.tags as tag}
              <span>{tag}</span>
            {/each}
          </div>
        </div>
      </section>
    {/each}
  </div>

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
                <div
                  class="age-cell age-value-cell"
                  style={`--cell-color:${profile.color}; --cell-tint:${getAgeTone(profile.color)};`}
                >
                  <strong>{formatCharacterAge(calculateCharacterAge(entry.year, profile))}</strong>
                  <span>{profile.name}</span>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </section>
</section>
