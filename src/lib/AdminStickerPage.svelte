<svelte:options runes={false} />

<script lang="ts">
  import { onMount } from 'svelte'
  import AdminCharacterSidebar from './AdminCharacterSidebar.svelte'
  import {
    buildChatHttpUrl,
    type ChatCharacterAttributes,
    type ChatCharacterCard,
    type ChatSticker,
    type ChatUser,
  } from './chat-room'
  import { confirmDialog } from './dialog'

  export let worldviewOptions: string[] = []

  interface AdminStickerCharacter extends ChatCharacterCard {
    createdAt: number
    updatedAt: number
    user: ChatUser
  }

  interface AdminStickerResponse {
    characters?: AdminStickerCharacter[]
    copied?: number
    createdCount?: number
    message?: string
    ok: boolean
    sticker?: ChatSticker | null
    stickers?: ChatSticker[]
    updatedCount?: number
  }

  const MAX_STICKER_FILE_BYTES = 2 * 1024 * 1024
  const STICKER_THUMB_VARIANT = 'thumb'
  const STICKER_UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

  let characters: AdminStickerCharacter[] = []
  let stickers: ChatSticker[] = []
  let nameDrafts: Record<string, string> = {}
  let users: ChatUser[] = []
  let filterUserId = ''
  let filterWorldview = ''
  let selectedCharacterId = ''
  let selectedStickerIds: string[] = []
  let copyTargetCharacterIds: string[] = []
  let isAdmin = false
  let statusMessage = '正在验证权限...'
  let formError = ''
  let isSaving = false
  let uploadName = ''
  let uploadFile: File | null = null
  let uploadInputElement: HTMLInputElement | null = null
  let availableWorldviewOptions: string[] = []
  let visibleCharacters: AdminStickerCharacter[] = []
  let visibleStickers: ChatSticker[] = []
  let selectedCharacter: AdminStickerCharacter | null = null
  let hasAutoSelectedInitialCharacter = false

  $: users = Array.from(new Map(characters.map((character) => [character.user.id, character.user])).values())
  $: availableWorldviewOptions = [
    ...new Set(
      [...worldviewOptions, ...characters.map((character) => character.worldview)]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  $: visibleCharacters = characters.filter((character) => {
    if (filterUserId !== '' && character.user.id !== filterUserId) {
      return false
    }

    if (filterWorldview !== '' && character.worldview !== filterWorldview) {
      return false
    }

    return true
  })
  $: selectedCharacter = visibleCharacters.find((character) => character.id === selectedCharacterId) ?? null
  $: visibleStickers = selectedCharacterId === ''
    ? []
    : stickers.filter((sticker) => sticker.characterId === selectedCharacterId)
  $: if (filterUserId !== '' && !users.some((user) => user.id === filterUserId)) {
    filterUserId = ''
  }
  $: if (filterWorldview !== '' && !availableWorldviewOptions.includes(filterWorldview)) {
    filterWorldview = ''
  }
  $: if (selectedCharacterId !== '' && !visibleCharacters.some((character) => character.id === selectedCharacterId)) {
    selectedCharacterId = ''
    selectedStickerIds = []
    copyTargetCharacterIds = []
    formError = ''
  }
  $: {
    const nextSelectedStickerIds = selectedStickerIds.filter((id) =>
      visibleStickers.some((sticker) => sticker.id === id),
    )

    if (nextSelectedStickerIds.length !== selectedStickerIds.length) {
      selectedStickerIds = nextSelectedStickerIds
    }
  }
  $: {
    const nextCopyTargetCharacterIds = copyTargetCharacterIds.filter((id) =>
      id !== selectedCharacterId && characters.some((character) => character.id === id),
    )

    if (nextCopyTargetCharacterIds.length !== copyTargetCharacterIds.length) {
      copyTargetCharacterIds = nextCopyTargetCharacterIds
    }
  }

  onMount(() => {
    void fetchStickers()
  })

  function formatFileSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) {
      return '0KB'
    }

    return `${Math.ceil(size / 1024)}KB`
  }

  function getStickerImageUrl(sticker: ChatSticker, variant = STICKER_THUMB_VARIANT): string {
    const relativeUrl = sticker.fileUrl || `/stickers/${encodeURIComponent(sticker.id)}/file`
    const separator = relativeUrl.includes('?') ? '&' : '?'
    return buildChatHttpUrl(`${relativeUrl}${separator}variant=${encodeURIComponent(variant)}`)
  }

  function createEmptyAttributes(): ChatCharacterAttributes {
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

  function getCharacterStickerCount(characterId: string): number {
    return stickers.filter((sticker) => sticker.characterId === characterId && sticker.status === 'active').length
  }

  function normaliseCharacterList(list: AdminStickerCharacter[] | undefined): AdminStickerCharacter[] {
    return (list ?? []).map((character) => ({
      ...character,
      attributes: character.attributes ?? createEmptyAttributes(),
    }))
  }

  async function requestAdminApi(pathname: string, init?: RequestInit): Promise<AdminStickerResponse> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: AdminStickerResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as AdminStickerResponse
    } catch {
      payload = {
        message: '表情包后台返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
    }
  }

  async function fetchStickers(): Promise<void> {
    statusMessage = '正在加载表情包...'

    try {
      const payload = await requestAdminApi('/admin/stickers', { method: 'GET' })

      if (!payload.ok) {
        isAdmin = false
        statusMessage = payload.message ?? '无权访问：该页面仅管理员可见。'
        return
      }

      isAdmin = true
      characters = normaliseCharacterList(payload.characters)
      stickers = payload.stickers ?? []
      nameDrafts = Object.fromEntries(stickers.map((sticker) => [sticker.id, sticker.name]))
      statusMessage = ''

      if (!hasAutoSelectedInitialCharacter && selectedCharacterId === '' && characters.length > 0) {
        selectedCharacterId = characters[0].id
        hasAutoSelectedInitialCharacter = true
      }
    } catch {
      isAdmin = false
      statusMessage = '表情包后台暂时不可用。'
    }
  }

  function selectCharacter(characterId: string): void {
    selectedCharacterId = characterId
    selectedStickerIds = []
    copyTargetCharacterIds = []
    formError = ''
  }

  function isStickerSelected(stickerId: string): boolean {
    return selectedStickerIds.includes(stickerId)
  }

  function toggleStickerSelection(stickerId: string, selected: boolean): void {
    selectedStickerIds = selected
      ? [...new Set([...selectedStickerIds, stickerId])]
      : selectedStickerIds.filter((id) => id !== stickerId)
  }

  function toggleAllVisibleStickers(selected: boolean): void {
    selectedStickerIds = selected ? visibleStickers.map((sticker) => sticker.id) : []
  }

  function toggleCopyTarget(characterId: string, selected: boolean): void {
    copyTargetCharacterIds = selected
      ? [...new Set([...copyTargetCharacterIds, characterId])]
      : copyTargetCharacterIds.filter((id) => id !== characterId)
  }

  function handleUploadFileChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null
    const file = target?.files?.[0] ?? null

    uploadFile = file

    if (!file) {
      return
    }

    if (!STICKER_UPLOAD_MIME_TYPES.includes(file.type)) {
      formError = '仅支持 JPG、PNG 或 WebP 静态图片。'
      uploadFile = null
      return
    }

    if (file.size > MAX_STICKER_FILE_BYTES) {
      formError = '表情图片原始文件不能超过 2MB。'
      uploadFile = null
      return
    }

    if (uploadName.trim() === '') {
      uploadName = file.name.replace(/\.[^.]+$/u, '').slice(0, 48)
    }

    formError = ''
  }

  async function uploadSticker(event: SubmitEvent): Promise<void> {
    event.preventDefault()

    const name = uploadName.replace(/\s+/g, ' ').trim()

    if (selectedCharacterId === '') {
      formError = '请选择表情归属角色卡。'
      return
    }

    if (name === '') {
      formError = '请输入表情名称。'
      return
    }

    if (!uploadFile) {
      formError = '请选择要上传的 JPG、PNG 或 WebP 图片。'
      return
    }

    if (!STICKER_UPLOAD_MIME_TYPES.includes(uploadFile.type)) {
      formError = '仅支持 JPG、PNG 或 WebP 静态图片。'
      return
    }

    if (uploadFile.size > MAX_STICKER_FILE_BYTES) {
      formError = '表情图片原始文件不能超过 2MB。'
      return
    }

    isSaving = true
    formError = ''

    try {
      const response = await fetch(
        buildChatHttpUrl(
          `/admin/stickers?characterId=${encodeURIComponent(selectedCharacterId)}&name=${encodeURIComponent(name)}`,
        ),
        {
          body: uploadFile,
          credentials: 'include',
          headers: {
            'Content-Type': uploadFile.type,
          },
          method: 'POST',
        },
      )
      const payload = (await response.json()) as AdminStickerResponse

      if (!response.ok || payload.ok === false) {
        formError = payload.message ?? '表情包上传失败。'
        return
      }

      uploadName = ''
      uploadFile = null

      if (uploadInputElement) {
        uploadInputElement.value = ''
      }

      await fetchStickers()
    } catch {
      formError = '表情包上传失败，请稍后重试。'
    } finally {
      isSaving = false
    }
  }

  async function updateSticker(sticker: ChatSticker, status = sticker.status): Promise<void> {
    const name = (nameDrafts[sticker.id] ?? sticker.name).replace(/\s+/g, ' ').trim()

    if (name === '') {
      formError = '表情名称不能为空。'
      return
    }

    isSaving = true
    formError = ''

    try {
      const payload = await requestAdminApi(`/admin/stickers/${encodeURIComponent(sticker.id)}`, {
        body: JSON.stringify({ name, status }),
        method: 'PATCH',
      })

      if (!payload.ok) {
        formError = payload.message ?? '表情包保存失败。'
        return
      }

      await fetchStickers()
    } finally {
      isSaving = false
    }
  }

  async function copySelectedStickers(): Promise<void> {
    if (selectedStickerIds.length === 0) {
      formError = '请选择要复制的表情包。'
      return
    }

    if (copyTargetCharacterIds.length === 0) {
      formError = '请选择复制目标角色卡。'
      return
    }

    isSaving = true
    formError = ''

    try {
      const payload = await requestAdminApi('/admin/stickers/copy', {
        body: JSON.stringify({
          stickerIds: selectedStickerIds,
          targetCharacterIds: copyTargetCharacterIds,
        }),
        method: 'POST',
      })

      if (!payload.ok) {
        formError = payload.message ?? '表情包复制失败。'
        return
      }

      stickers = payload.stickers ?? stickers
      nameDrafts = Object.fromEntries(stickers.map((sticker) => [sticker.id, sticker.name]))
      statusMessage = `已复制 ${payload.copied ?? 0} 个表情关联。`
      selectedStickerIds = []
      copyTargetCharacterIds = []
    } catch {
      formError = '表情包复制失败，请稍后重试。'
    } finally {
      isSaving = false
    }
  }

  async function disableSticker(sticker: ChatSticker): Promise<void> {
    const confirmed = await confirmDialog(`停用「${sticker.characterName ?? '角色'}」的表情「${sticker.name}」吗？历史消息仍可显示这张图片。`)

    if (!confirmed) {
      return
    }

    isSaving = true
    formError = ''

    try {
      const payload = await requestAdminApi(`/admin/stickers/${encodeURIComponent(sticker.id)}`, {
        method: 'DELETE',
      })

      if (!payload.ok) {
        formError = payload.message ?? '表情包停用失败。'
        return
      }

      await fetchStickers()
    } finally {
      isSaving = false
    }
  }

  function handleExit(): void {
    window.history.pushState({}, '', '/chat')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  function handleSidebarFilterChange(
    event: CustomEvent<{ filterUserId: string; filterWorldview: string }>,
  ): void {
    filterUserId = event.detail.filterUserId
    filterWorldview = event.detail.filterWorldview
  }

  function handleSidebarCharacterSelect(event: CustomEvent<{ characterId: string }>): void {
    selectCharacter(event.detail.characterId)
  }

  function describeCharacter(character: ChatCharacterCard & { user: ChatUser }): string {
    return `${character.worldview} · ${character.user.displayName} · ${getCharacterStickerCount(character.id)} 个`
  }
</script>

<div class="admin-page">
  <div class="header">
    <div>
      <span class="eyebrow">管理员后台</span>
      <h2>表情包管理</h2>
      <p>按角色卡隔离表情库，复制只复用图片资产，不重复保存图片文件。</p>
    </div>
    <div class="actions">
      <button class="toolbar-action" onclick={() => void fetchStickers()} type="button">刷新</button>
      <button class="toolbar-action" onclick={handleExit} type="button">返回</button>
    </div>
  </div>

  {#if !isAdmin}
    <div class="status-card">{statusMessage}</div>
  {:else}
    <div class="admin-layout">
      <div class="admin-sidebar">
        <form class="upload-card" onsubmit={uploadSticker}>
          <div class="list-head">
            <strong>上传到当前角色</strong>
            <span>JPG / PNG / WebP · 2MB</span>
          </div>

          {#if selectedCharacter}
            <div class="upload-target-note">
              当前角色：{selectedCharacter.name} · {selectedCharacter.worldview} · {selectedCharacter.user.displayName}
            </div>
          {:else}
            <div class="upload-target-note">先从下方角色列表中选择一个角色，再上传表情。</div>
          {/if}

          <label>
            <span>表情名称</span>
            <input bind:value={uploadName} maxlength="48" placeholder="输入表情名称" type="text" />
          </label>

          <label>
            <span>图片文件</span>
            <input
              bind:this={uploadInputElement}
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              onchange={handleUploadFileChange}
              type="file"
            />
          </label>

          {#if uploadFile}
            <div class="upload-file-note">{uploadFile.name} · {formatFileSize(uploadFile.size)}</div>
          {/if}

          <button class="toolbar-action toolbar-primary" disabled={isSaving || selectedCharacterId === ''} type="submit">
            上传表情
          </button>
        </form>

        <AdminCharacterSidebar
          characters={visibleCharacters}
          emptyMessage="当前筛选下暂无可管理的角色卡。"
          filterUserId={filterUserId}
          filterWorldview={filterWorldview}
          getCharacterDescription={describeCharacter}
          listTitle="角色卡"
          on:filterchange={handleSidebarFilterChange}
          on:selectcharacter={handleSidebarCharacterSelect}
          selectedCharacterId={selectedCharacterId}
          statusMessage={statusMessage}
          users={users}
          worldviewOptions={availableWorldviewOptions}
        />
      </div>

      <section class="editor-card">
        <div class="editor-head">
          <div>
            <span class="eyebrow">{selectedCharacter?.worldview ?? '角色表情库'}</span>
            <h3>{selectedCharacter ? `${selectedCharacter.name} 的表情包` : '请选择角色卡'}</h3>
          </div>
          <span class="count-pill">{visibleStickers.length} 个</span>
        </div>

        {#if statusMessage !== ''}
          <div class="status-inline">{statusMessage}</div>
        {/if}

        {#if formError !== ''}
          <div class="error-text">{formError}</div>
        {/if}

        <div class="bulk-card">
          <div class="bulk-head">
            <label class="bulk-check">
              <input
                checked={visibleStickers.length > 0 && selectedStickerIds.length === visibleStickers.length}
                onchange={(event) => toggleAllVisibleStickers((event.currentTarget as HTMLInputElement).checked)}
                type="checkbox"
              />
              <span>已选择 {selectedStickerIds.length} 个</span>
            </label>
            <button
              class="toolbar-action"
              disabled={isSaving || selectedStickerIds.length === 0 || copyTargetCharacterIds.length === 0}
              onclick={() => void copySelectedStickers()}
              type="button"
            >
              复制到所选角色
            </button>
          </div>

          <div class="copy-target-grid">
            {#each visibleCharacters.filter((character) => character.id !== selectedCharacterId) as character (character.id)}
              <label class="copy-target">
                <input
                  checked={copyTargetCharacterIds.includes(character.id)}
                  onchange={(event) => toggleCopyTarget(character.id, (event.currentTarget as HTMLInputElement).checked)}
                  type="checkbox"
                />
                <span>{character.name}</span>
              </label>
            {:else}
              <div class="empty-inline">没有其它可复制目标。</div>
            {/each}
          </div>
        </div>

        {#if visibleStickers.length === 0}
          <div class="empty-card">当前角色卡暂无表情包。</div>
        {:else}
          <div class="sticker-admin-grid">
            {#each visibleStickers as sticker (sticker.id)}
              <article class:disabled={sticker.status !== 'active'} class:selected={isStickerSelected(sticker.id)} class="sticker-admin-card">
                <label class="sticker-select">
                  <input
                    checked={isStickerSelected(sticker.id)}
                    onchange={(event) => toggleStickerSelection(sticker.id, (event.currentTarget as HTMLInputElement).checked)}
                    type="checkbox"
                  />
                  <span>选择</span>
                </label>

                <div class="sticker-preview">
                  <img
                    alt={sticker.name}
                    decoding="async"
                    height={sticker.height}
                    loading="lazy"
                    src={getStickerImageUrl(sticker)}
                    width={sticker.width}
                  />
                </div>

                <div class="sticker-admin-meta">
                  <input bind:value={nameDrafts[sticker.id]} maxlength="48" type="text" />
                  <span>{sticker.width}x{sticker.height} · {formatFileSize(sticker.sizeBytes)}</span>
                  <em class:active={sticker.status === 'active'}>
                    {sticker.status === 'active' ? '已启用' : '已停用'}
                  </em>
                </div>

                <div class="sticker-admin-actions">
                  <button
                    class="toolbar-action"
                    disabled={isSaving}
                    onclick={() => void updateSticker(sticker)}
                    type="button"
                  >
                    保存
                  </button>
                  {#if sticker.status === 'active'}
                    <button
                      class="toolbar-action"
                      disabled={isSaving}
                      onclick={() => void disableSticker(sticker)}
                      type="button"
                    >
                      停用
                    </button>
                  {:else}
                    <button
                      class="toolbar-action"
                      disabled={isSaving}
                      onclick={() => void updateSticker(sticker, 'active')}
                      type="button"
                    >
                      启用
                    </button>
                  {/if}
                </div>
              </article>
            {/each}
          </div>
        {/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .admin-page {
    min-height: 100%;
    padding: 24px;
    background: transparent;
    color: var(--text);
  }

  .header,
  .editor-head,
  .list-head,
  .actions,
  .sticker-admin-actions,
  .bulk-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .eyebrow {
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .admin-layout {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 20px;
    margin-top: 20px;
  }

  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .editor-card,
  .status-card,
  .empty-card,
  .bulk-card,
  .sticker-admin-card {
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--panel);
    box-shadow: var(--card-shadow);
  }

  .upload-card,
  .upload-card,
  .editor-card,
  .status-card,
  .empty-card,
  .bulk-card {
    padding: 18px;
  }

  .upload-card,
  .bulk-card {
    display: grid;
    gap: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  input,
  input[type='file'] {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 12px;
    background: var(--panel-strong);
    color: inherit;
    font: inherit;
  }

  .upload-target-note,
  .upload-file-note,
  .status-inline,
  .count-pill,
  .empty-inline,
  .sticker-admin-meta span {
    color: var(--muted);
    font-size: 12px;
  }

  .error-text,
  .status-card {
    margin: 10px 0;
    color: #991b1b;
  }

  .bulk-check,
  .copy-target,
  .sticker-select {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .copy-target-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .copy-target {
    padding: 0.42rem 0.62rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel-strong);
    font-size: 12px;
  }

  .sticker-admin-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 14px;
    margin-top: 16px;
  }

  .sticker-admin-card {
    display: grid;
    gap: 12px;
    padding: 14px;
  }

  .sticker-admin-card.selected {
    border-color: var(--accent-border-strong);
  }

  .sticker-admin-card.disabled {
    opacity: 0.68;
  }

  .sticker-select {
    justify-content: flex-start;
    color: var(--muted);
    font-size: 12px;
  }

  .sticker-preview {
    display: grid;
    place-items: center;
    min-height: 128px;
    border-radius: 14px;
    background: var(--panel-strong);
  }

  .sticker-preview img {
    max-width: 112px;
    max-height: 112px;
    object-fit: contain;
  }

  .sticker-admin-meta {
    display: grid;
    gap: 6px;
  }

  .sticker-admin-meta em {
    width: fit-content;
    padding: 0.22rem 0.5rem;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    color: var(--muted);
    font-style: normal;
    font-size: 12px;
  }

  .sticker-admin-meta em.active {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--text);
  }

  @media (max-width: 960px) {
    .admin-layout {
      grid-template-columns: 1fr;
    }

    .header,
    .editor-head,
    .bulk-head {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
