<svelte:options runes={false} />

<script lang="ts">
  import { buildChatHttpUrl } from './chat-room'

  interface ManagedWorldview {
    coverImage?: string
    createdAt: number
    createdByUserId: string | null
    description: string
    id: string
    isHidden: boolean
    name: string
    tags: string[]
    updatedAt: number
  }

  interface WorldviewListResponse {
    message?: string
    ok: boolean
    previousName?: string
    worldview?: ManagedWorldview | null
    worldviews?: ManagedWorldview[]
  }

  export let managedWorldviews: ManagedWorldview[] = []
  export let onRefresh: () => Promise<void> | void = () => {}
  export let onSaved: (payload: WorldviewListResponse) => Promise<void> | void = () => {}

  let draftWorldviewCoverImage = ''
  let draftWorldviewDescription = ''
  let draftWorldviewIsHidden = false
  let draftWorldviewName = ''
  let draftWorldviewTagsText = '#世界观'
  let editingManagedWorldviewId = ''
  let isWorldviewSaving = false
  let statusMessage = ''
  let worldviewManagementError = ''

  function serialiseTags(text: string): string[] {
    return text
      .split(/[\n,，]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
  }

  function formatTags(tags: string[]): string {
    return tags.join('，')
  }

  function resetWorldviewDraft(): void {
    editingManagedWorldviewId = ''
    draftWorldviewName = ''
    draftWorldviewDescription = ''
    draftWorldviewIsHidden = false
    draftWorldviewTagsText = '#世界观'
    draftWorldviewCoverImage = ''
    worldviewManagementError = ''
  }

  function startEditWorldview(worldview: ManagedWorldview): void {
    editingManagedWorldviewId = worldview.id
    draftWorldviewName = worldview.name
    draftWorldviewDescription = worldview.description
    draftWorldviewIsHidden = worldview.isHidden === true
    draftWorldviewTagsText = formatTags(worldview.tags)
    draftWorldviewCoverImage = worldview.coverImage ?? ''
    worldviewManagementError = ''
  }

  async function requestWorldviewApi(pathname: string, init?: RequestInit): Promise<WorldviewListResponse> {
    const headers = new Headers(init?.headers ?? {})

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(buildChatHttpUrl(pathname), {
      ...init,
      credentials: 'include',
      headers,
    })

    let payload: WorldviewListResponse = { ok: response.ok }

    try {
      payload = (await response.json()) as WorldviewListResponse
    } catch {
      payload = {
        message: '世界观服务返回了无法解析的响应。',
        ok: false,
      }
    }

    return {
      ...payload,
      ok: response.ok && payload.ok !== false,
    }
  }

  async function refreshWorldviews(): Promise<void> {
    statusMessage = '正在刷新世界观...'

    try {
      await onRefresh()
      statusMessage = ''
    } catch {
      statusMessage = '世界观列表刷新失败。'
    }
  }

  async function saveWorldviewDraft(): Promise<void> {
    const name = draftWorldviewName.trim()
    const description = draftWorldviewDescription.trim()
    const tags = serialiseTags(draftWorldviewTagsText)
    const coverImage = draftWorldviewCoverImage.trim()

    if (name === '') {
      worldviewManagementError = '世界观名称不能为空。'
      return
    }

    isWorldviewSaving = true
    statusMessage = ''
    worldviewManagementError = ''

    try {
      const payload = await requestWorldviewApi(
        editingManagedWorldviewId === ''
          ? '/worldviews'
          : `/worldviews/${encodeURIComponent(editingManagedWorldviewId)}`,
        {
          body: JSON.stringify({
            coverImage,
            description,
            isHidden: draftWorldviewIsHidden,
            name,
            tags,
          }),
          method: editingManagedWorldviewId === '' ? 'POST' : 'PATCH',
        },
      )

      if (!payload.ok || !payload.worldview) {
        worldviewManagementError = payload.message ?? '保存世界观失败。'
        return
      }

      await onSaved(payload)
      resetWorldviewDraft()
      statusMessage = '世界观已保存。'
    } catch {
      worldviewManagementError = '世界观服务暂时不可用。'
    } finally {
      isWorldviewSaving = false
    }
  }

  async function saveWorldviewHiddenState(nextIsHidden: boolean): Promise<void> {
    draftWorldviewIsHidden = nextIsHidden

    if (editingManagedWorldviewId === '') {
      return
    }

    const worldview = managedWorldviews.find((entry) => entry.id === editingManagedWorldviewId)

    if (!worldview) {
      worldviewManagementError = '请先选择一个世界观。'
      return
    }

    isWorldviewSaving = true
    statusMessage = nextIsHidden ? '正在隐藏世界观...' : '正在恢复世界观...'
    worldviewManagementError = ''

    try {
      const payload = await requestWorldviewApi(`/worldviews/${encodeURIComponent(worldview.id)}`, {
        body: JSON.stringify({
          coverImage: worldview.coverImage ?? '',
          description: worldview.description,
          isHidden: nextIsHidden,
          name: worldview.name,
          tags: worldview.tags,
        }),
        method: 'PATCH',
      })

      if (!payload.ok || !payload.worldview) {
        draftWorldviewIsHidden = worldview.isHidden === true
        worldviewManagementError = payload.message ?? '更新世界观隐藏状态失败。'
        statusMessage = ''
        return
      }

      await onSaved(payload)
      statusMessage = nextIsHidden ? '世界观已全局隐藏。' : '世界观已恢复显示。'
    } catch {
      draftWorldviewIsHidden = worldview.isHidden === true
      worldviewManagementError = '世界观服务暂时不可用。'
      statusMessage = ''
    } finally {
      isWorldviewSaving = false
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
      <h2>世界观管理</h2>
      <p>维护世界观名称、简介、标签与封面，并同步到时间线、角色和年龄工具。</p>
    </div>
    <div class="actions">
      <button class="toolbar-action" onclick={() => void refreshWorldviews()} type="button">刷新</button>
      <button class="toolbar-action" onclick={resetWorldviewDraft} type="button">新增世界观</button>
      <button class="toolbar-action" onclick={handleExit} type="button">返回</button>
    </div>
  </div>

  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="list-card">
        <div class="list-head">
          <strong>世界观列表</strong>
          <span>{managedWorldviews.length} 个</span>
        </div>

        {#if statusMessage !== ''}
          <div class="status-inline">{statusMessage}</div>
        {/if}

        <div class="worldview-list">
          {#each managedWorldviews as worldview (worldview.id)}
            <button
              class:selected={editingManagedWorldviewId === worldview.id}
              class="worldview-item"
              onclick={() => startEditWorldview(worldview)}
              type="button"
            >
              <div class="worldview-item-title">
                <strong>{worldview.name}</strong>
                {#if worldview.isHidden}
                  <small>已隐藏</small>
                {/if}
              </div>
              <span>{worldview.description || '暂无简介'}</span>
              <em>{worldview.tags.length > 0 ? worldview.tags.join(' · ') : '暂无标签'}</em>
            </button>
          {:else}
            <div class="empty-card">暂无可管理的世界观。</div>
          {/each}
        </div>
      </div>
    </aside>

    <section class="editor-card">
      <div class="editor-head">
        <div>
          <span class="eyebrow">{editingManagedWorldviewId === '' ? '新建' : '编辑'}</span>
          <h3>{editingManagedWorldviewId === '' ? '创建世界观' : '编辑世界观'}</h3>
        </div>
      </div>

      <form
        class="editor-form"
        onsubmit={(event) => {
          event.preventDefault()
          void saveWorldviewDraft()
        }}
      >
        <label>
          <span>世界观名称</span>
          <input bind:value={draftWorldviewName} maxlength="80" type="text" />
        </label>

        <label>
          <span>简介</span>
          <textarea bind:value={draftWorldviewDescription} rows="5"></textarea>
        </label>

        <label>
          <span>标签</span>
          <textarea
            bind:value={draftWorldviewTagsText}
            placeholder="#主线，#地点，#主题"
            rows="3"
          ></textarea>
        </label>

        <label>
          <span>配图地址</span>
          <input
            bind:value={draftWorldviewCoverImage}
            placeholder="/background.jpg"
            type="text"
          />
        </label>

        <label class="worldview-visibility-toggle">
          <input
            bind:checked={draftWorldviewIsHidden}
            disabled={isWorldviewSaving}
            onchange={(event) => void saveWorldviewHiddenState((event.currentTarget as HTMLInputElement).checked)}
            type="checkbox"
          />
          <span>
            <strong>全局隐藏该世界观</strong>
            <small>编辑已有世界观时会立即保存；隐藏后普通页面、切换菜单、时间线、日志、年龄工具等入口不再展示。</small>
          </span>
        </label>

        {#if worldviewManagementError !== ''}
          <div class="error-text">{worldviewManagementError}</div>
        {/if}

        <p class="field-tip">世界观保存后会立即同步到切换菜单，并驱动角色、年龄工具和垂直时间线读取新分区。</p>

        <div class="actions form-actions">
          {#if editingManagedWorldviewId !== ''}
            <button class="toolbar-action" onclick={resetWorldviewDraft} type="button">取消编辑</button>
          {/if}
          <button class="toolbar-action toolbar-primary" disabled={isWorldviewSaving} type="submit">
            {isWorldviewSaving ? '保存中...' : editingManagedWorldviewId === '' ? '保存世界观' : '更新世界观'}
          </button>
        </div>
      </form>
    </section>
  </div>
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
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .header h2,
  .editor-head h3 {
    margin: 2px 0 0;
  }

  .header p {
    margin: 6px 0 0;
    max-width: 680px;
    color: var(--muted);
    line-height: 1.6;
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

  .admin-sidebar,
  .editor-card,
  .list-card,
  .empty-card {
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--panel);
    box-shadow: var(--card-shadow);
  }

  .list-card,
  .editor-card,
  .empty-card {
    padding: 18px;
  }

  .admin-sidebar {
    border: none;
    background: transparent;
    box-shadow: none;
  }

  .editor-form,
  .worldview-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  .field-tip {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  input,
  textarea,
  .worldview-item {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 12px;
    font: inherit;
    background: var(--panel-strong);
    color: inherit;
  }

  textarea {
    min-height: 96px;
    resize: vertical;
  }

  .worldview-item {
    display: grid;
    gap: 6px;
    text-align: left;
    cursor: pointer;
  }

  .worldview-item-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .worldview-item-title small {
    flex: none;
    border: 1px solid var(--accent-border);
    border-radius: 999px;
    padding: 2px 7px;
    background: var(--accent-surface);
    color: var(--muted);
    font-size: 11px;
    line-height: 1.2;
  }

  .worldview-item.selected {
    border-color: var(--accent-border-strong);
    background: var(--accent-surface);
  }

  .worldview-item span,
  .worldview-item em {
    display: block;
    color: var(--muted);
    font-size: 12px;
    font-style: normal;
    line-height: 1.5;
  }

  .worldview-item span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .empty-card,
  .status-inline {
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }

  .error-text {
    color: #991b1b;
  }

  .worldview-visibility-toggle {
    flex-direction: row;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 12px;
    background: var(--panel-strong);
  }

  .worldview-visibility-toggle input {
    width: 18px;
    height: 18px;
    margin-top: 2px;
    padding: 0;
  }

  .worldview-visibility-toggle span {
    display: grid;
    gap: 3px;
    color: var(--text);
  }

  .worldview-visibility-toggle small {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .form-actions {
    justify-content: flex-end;
  }

  @media (max-width: 960px) {
    .admin-page {
      padding: 18px 12px 88px;
    }

    .header,
    .editor-head,
    .actions {
      align-items: flex-start;
      flex-direction: column;
    }

    .admin-layout {
      grid-template-columns: 1fr;
    }

    .form-actions {
      align-items: stretch;
    }
  }
</style>
