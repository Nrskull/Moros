<svelte:options runes={false} />

<script lang="ts">
  import { onMount } from 'svelte'
  import { worldviewContents } from '../content/worldviews'
  import { buildChatHttpUrl, type ChatCharacterAttributes, type ChatCharacterCard, type ChatUser } from './chat-room'
  import { confirmDialog } from './dialog'

  export let worldviewOptions: string[] = []

  interface AdminCharacterRecord extends ChatCharacterCard {
    createdAt: number
    updatedAt: number
    user: ChatUser
  }

  interface AdminCharacterResponse {
    cards?: AdminCharacterRecord[]
    message?: string
    ok: boolean
    users?: ChatUser[]
  }

  const defaultColor = '#64748b'

  const emptyAttributes = (): ChatCharacterAttributes => ({
    appearance: 0,
    constitution: 0,
    dexterity: 0,
    education: 0,
    intelligence: 0,
    luck: 0,
    size: 0,
    strength: 0,
    willpower: 0,
  })

  let characters: AdminCharacterRecord[] = []
  let users: ChatUser[] = []
  let isAdmin = false
  let statusMessage = '正在验证权限...'
  let filterUserId = ''
  let filterWorldview = ''
  let isSaving = false
  let formError = ''
  let editingCharacterId = ''
  let formUserId = ''
  let availableWorldviewOptions: string[] = []
  let defaultWorldview = worldviewContents[0]?.name ?? ''
  let formWorldview = defaultWorldview
  let formName = ''
  let formColor = defaultColor
  let formPresentationMode: 'bubble' | 'kp-narration' = 'bubble'
  let formAvatarDataUrl = ''
  let formAttributes: ChatCharacterAttributes = emptyAttributes()
  let editingCharacter: AdminCharacterRecord | null = null
  let visibleCharacters: AdminCharacterRecord[] = []

  const attributeFields: Array<{ key: keyof ChatCharacterAttributes; label: string }> = [
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

  $: visibleCharacters = characters.filter((character) => {
    if (filterUserId !== '' && character.user.id !== filterUserId) {
      return false
    }

    if (filterWorldview !== '' && character.worldview !== filterWorldview) {
      return false
    }

    return true
  })
  $: editingCharacter = editingCharacterId === ''
    ? null
    : characters.find((entry) => entry.id === editingCharacterId) ?? null
  $: availableWorldviewOptions = [
    ...new Set(
      [...worldviewOptions, ...characters.map((character) => character.worldview), ...worldviewContents.map((worldview) => worldview.name)]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  $: defaultWorldview = availableWorldviewOptions[0] ?? ''
  $: if (filterWorldview !== '' && !availableWorldviewOptions.includes(filterWorldview)) {
    filterWorldview = ''
  }
  $: if (formWorldview === '' && defaultWorldview !== '') {
    formWorldview = defaultWorldview
  }

  onMount(async () => {
    await fetchCharacters()
  })

  function resetForm(): void {
    editingCharacterId = ''
    formUserId = users[0]?.id ?? ''
    formWorldview = defaultWorldview
    formName = ''
    formColor = defaultColor
    formPresentationMode = 'bubble'
    formAvatarDataUrl = ''
    formAttributes = emptyAttributes()
    formError = ''
  }

  function populateForm(character: AdminCharacterRecord): void {
    editingCharacterId = character.id
    formUserId = character.user.id
    formWorldview = character.worldview
    formName = character.name
    formColor = character.color
    formPresentationMode = character.presentationMode
    formAvatarDataUrl = character.avatarDataUrl ?? ''
    formAttributes = { ...character.attributes }
    formError = ''
  }

  async function requestAdminApi(pathname: string, init?: RequestInit): Promise<AdminCharacterResponse> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: AdminCharacterResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as AdminCharacterResponse
    } catch {
      payload = {
        message: '后台服务返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
    }
  }

  async function fetchCharacters(): Promise<void> {
    statusMessage = '正在加载角色卡...'

    try {
      const params = new URLSearchParams()

      if (filterUserId !== '') {
        params.set('userId', filterUserId)
      }

      if (filterWorldview !== '') {
        params.set('worldview', filterWorldview)
      }

      const query = params.toString()
      const payload = await requestAdminApi(`/admin/character-cards${query === '' ? '' : `?${query}`}`, {
        method: 'GET',
      })

      if (!payload.ok) {
        isAdmin = false
        statusMessage = payload.message ?? '无权访问：该页面仅管理员可见。'
        return
      }

      isAdmin = true
      characters = payload.cards ?? []
      users = payload.users ?? []
      statusMessage = ''

      if (formUserId === '' && users.length > 0) {
        formUserId = users[0].id
      }
    } catch {
      isAdmin = false
      statusMessage = '后台服务暂时不可用。'
    }
  }

  function handleAttributeInput(key: keyof ChatCharacterAttributes, event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null

    if (!target) {
      return
    }

    const parsed = Number.parseInt(target.value, 10)
    formAttributes = {
      ...formAttributes,
      [key]: Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 0,
    }
  }

  async function submitForm(event: SubmitEvent): Promise<void> {
    event.preventDefault()

    if (formUserId === '') {
      formError = '请选择角色归属用户。'
      return
    }

    if (formWorldview.trim() === '') {
      formError = '请选择角色所属世界观。'
      return
    }

    if (formName.trim() === '') {
      formError = '请输入角色名。'
      return
    }

    isSaving = true
    formError = ''

    const payload = {
      attributes: formAttributes,
      avatarDataUrl: formAvatarDataUrl.trim() === '' ? null : formAvatarDataUrl.trim(),
      color: formColor,
      name: formName.trim(),
      presentationMode: formPresentationMode,
      userId: formUserId,
      worldview: formWorldview,
    }

    try {
      const response = editingCharacterId === ''
        ? await requestAdminApi('/admin/character-cards', {
            body: JSON.stringify(payload),
            method: 'POST',
          })
        : await requestAdminApi(`/admin/character-cards/${encodeURIComponent(editingCharacterId)}`, {
            body: JSON.stringify(payload),
            method: 'PATCH',
          })

      if (!response.ok) {
        formError = response.message ?? '保存失败，请稍后再试。'
        return
      }

      await fetchCharacters()
      resetForm()
    } finally {
      isSaving = false
    }
  }

  async function deleteCharacter(character: AdminCharacterRecord): Promise<void> {
    const confirmed = await confirmDialog(`确认删除角色卡「${character.name}」吗？`)

    if (!confirmed) {
      return
    }

    isSaving = true
    formError = ''

    try {
      const response = await requestAdminApi(`/admin/character-cards/${encodeURIComponent(character.id)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        formError = response.message ?? '删除失败，请稍后再试。'
        return
      }

      await fetchCharacters()

      if (editingCharacterId === character.id) {
        resetForm()
      }
    } finally {
      isSaving = false
    }
  }

  function handleExit(): void {
    window.history.pushState({}, '', '/chat')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }
</script>

<div class="admin-page">
  <div class="header">
    <div>
      <span class="eyebrow">管理员后台</span>
      <h2>角色卡管理</h2>
      <p>角色卡与垂直时间轴轨道共用同一数据源。</p>
    </div>
    <div class="actions">
      <button class="toolbar-action" onclick={() => void fetchCharacters()} type="button">刷新</button>
      <button class="toolbar-action" onclick={() => { resetForm() }} type="button">新建角色卡</button>
      <button class="toolbar-action" onclick={handleExit} type="button">返回</button>
    </div>
  </div>

  {#if !isAdmin}
    <div class="status-card">{statusMessage}</div>
  {:else}
    <div class="admin-layout">
      <aside class="admin-sidebar">
        <div class="filter-card">
          <label>
            <span>按用户筛选</span>
            <select bind:value={filterUserId} onchange={() => void fetchCharacters()}>
              <option value="">全部用户</option>
              {#each users as user}
                <option value={user.id}>{user.displayName} · {user.handle}</option>
              {/each}
            </select>
          </label>

          <label>
            <span>按世界观筛选</span>
            <select bind:value={filterWorldview} onchange={() => void fetchCharacters()}>
              <option value="">全部世界观</option>
              {#each availableWorldviewOptions as worldview}
                <option value={worldview}>{worldview}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="list-card">
          <div class="list-head">
            <strong>角色列表</strong>
            <span>{visibleCharacters.length} 张</span>
          </div>

          {#if statusMessage !== ''}
            <div class="status-inline">{statusMessage}</div>
          {/if}

          <div class="character-list">
            {#each visibleCharacters as character (character.id)}
              <button class:selected={editingCharacterId === character.id} class="character-item" onclick={() => populateForm(character)} type="button">
                <span class="character-color" style={`background:${character.color};`}></span>
                <div>
                  <strong>{character.name}</strong>
                  <span>{character.worldview} · {character.user.displayName}</span>
                </div>
              </button>
            {/each}
          </div>
        </div>
      </aside>

      <section class="editor-card">
        <div class="editor-head">
          <div>
            <span class="eyebrow">{editingCharacterId === '' ? '新建' : '编辑'}</span>
            <h3>{editingCharacterId === '' ? '创建角色卡' : '编辑角色卡'}</h3>
          </div>
          {#if editingCharacter}
            <button class="danger-button" disabled={isSaving} onclick={() => void deleteCharacter(editingCharacter)} type="button">删除</button>
          {/if}
        </div>

        <form class="editor-form" onsubmit={submitForm}>
          <div class="grid two">
            <label>
              <span>归属用户</span>
              <select bind:value={formUserId}>
                {#each users as user}
                  <option value={user.id}>{user.displayName} · {user.handle}</option>
                {/each}
              </select>
            </label>

            <label>
              <span>世界观</span>
              <select bind:value={formWorldview} disabled={editingCharacterId !== ''}>
                {#each availableWorldviewOptions as worldview}
                  <option value={worldview}>{worldview}</option>
                {/each}
              </select>
              {#if editingCharacterId !== ''}
                <span class="field-tip">已有角色卡暂不允许直接切换世界观，避免把已挂接的垂直时间轴数据移丢。</span>
              {/if}
            </label>

            <label>
              <span>角色名</span>
              <input bind:value={formName} maxlength="32" placeholder="输入角色名" type="text" />
            </label>

            <label>
              <span>轨道颜色</span>
              <input bind:value={formColor} type="color" />
            </label>

            <label>
              <span>展示模式</span>
              <select bind:value={formPresentationMode}>
                <option value="bubble">普通气泡</option>
                <option value="kp-narration">KP 叙述</option>
              </select>
            </label>
          </div>

          <label>
            <span>头像 Data URL</span>
            <textarea bind:value={formAvatarDataUrl} placeholder="可留空；也可以粘贴 data:image/..." rows="3"></textarea>
          </label>

          <div class="grid three">
            {#each attributeFields as field}
              <label>
                <span>{field.label}</span>
                <input max="100" min="0" oninput={(event) => handleAttributeInput(field.key, event)} type="number" value={formAttributes[field.key]} />
              </label>
            {/each}
          </div>

          {#if formError !== ''}
            <div class="error-text">{formError}</div>
          {/if}

          <div class="actions">
            <button class="toolbar-action" onclick={resetForm} type="button">重置</button>
            <button class="toolbar-action toolbar-primary" disabled={isSaving} type="submit">{editingCharacterId === '' ? '创建角色卡' : '保存修改'}</button>
          </div>
        </form>
      </section>
    </div>
  {/if}
</div>

<style>
  .admin-page {
    min-height: 100%;
    padding: 24px;
    background: var(--color-bg-base);
    color: var(--color-text-base);
  }

  .header,
  .editor-head,
  .list-head,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .eyebrow {
    font-size: 12px;
    color: rgba(15, 23, 42, 0.56);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .admin-layout {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 20px;
    margin-top: 20px;
  }

  .admin-sidebar,
  .editor-card,
  .filter-card,
  .list-card,
  .status-card {
    border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.86);
    box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
  }

  .filter-card,
  .list-card,
  .editor-card,
  .status-card {
    padding: 18px;
  }

  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: 16px;
    border: none;
    background: transparent;
    box-shadow: none;
  }

  .editor-form,
  .filter-card,
  .character-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .grid {
    display: grid;
    gap: 14px;
  }

  .grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .grid.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  .field-tip {
    color: rgba(71, 85, 105, 0.82);
    font-size: 12px;
    line-height: 1.5;
  }

  input,
  select,
  textarea,
  .character-item {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 14px;
    padding: 10px 12px;
    font: inherit;
    background: rgba(255, 255, 255, 0.92);
    color: inherit;
  }

  .character-item {
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    cursor: pointer;
  }

  .character-item.selected {
    border-color: rgba(15, 23, 42, 0.55);
    background: rgba(226, 232, 240, 0.65);
  }

  .character-item span {
    display: block;
    font-size: 12px;
    color: rgba(51, 65, 85, 0.78);
  }

  .character-color {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    flex-shrink: 0;
  }

  .danger-button {
    border: 1px solid rgba(239, 68, 68, 0.35);
    border-radius: 999px;
    padding: 10px 14px;
    background: rgba(254, 226, 226, 0.88);
    color: #991b1b;
    cursor: pointer;
  }

  .error-text,
  .status-inline,
  .status-card {
    color: #991b1b;
  }

  @media (max-width: 960px) {
    .admin-layout {
      grid-template-columns: 1fr;
    }

    .grid.two,
    .grid.three {
      grid-template-columns: 1fr;
    }
  }
</style>
