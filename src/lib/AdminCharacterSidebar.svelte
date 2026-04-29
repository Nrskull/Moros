<svelte:options runes={false} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { ChatCharacterCard, ChatUser } from './chat-room'

  type AdminCharacterSidebarRecord = ChatCharacterCard & { user: ChatUser }

  export let characters: AdminCharacterSidebarRecord[] = []
  export let users: ChatUser[] = []
  export let worldviewOptions: string[] = []
  export let filterUserId = ''
  export let filterWorldview = ''
  export let selectedCharacterId = ''
  export let showFilters = true
  export let statusMessage = ''
  export let listTitle = '角色列表'
  export let itemCountSuffix = '张'
  export let emptyMessage = '暂无可管理的角色卡。'
  export let allUsersLabel = '全部用户'
  export let allWorldviewsLabel = '全部世界观'
  export let getCharacterDescription: (character: AdminCharacterSidebarRecord) => string = (character) =>
    `${character.worldview} · ${character.user.displayName}`

  const dispatch = createEventDispatcher<{
    filterchange: {
      filterUserId: string
      filterWorldview: string
      source: 'user' | 'worldview'
    }
    selectcharacter: {
      characterId: string
    }
  }>()

  function handleUserFilterChange(event: Event): void {
    const nextFilterUserId = (event.currentTarget as HTMLSelectElement | null)?.value ?? ''

    dispatch('filterchange', {
      filterUserId: nextFilterUserId,
      filterWorldview,
      source: 'user',
    })
  }

  function handleWorldviewFilterChange(event: Event): void {
    const nextFilterWorldview = (event.currentTarget as HTMLSelectElement | null)?.value ?? ''

    dispatch('filterchange', {
      filterUserId,
      filterWorldview: nextFilterWorldview,
      source: 'worldview',
    })
  }

  function selectCharacter(characterId: string): void {
    dispatch('selectcharacter', { characterId })
  }
</script>

<aside class="admin-sidebar">
  {#if showFilters}
    <div class="filter-card">
      <label>
        <span>按用户筛选</span>
        <select onchange={handleUserFilterChange} value={filterUserId}>
          <option value="">{allUsersLabel}</option>
          {#each users as user}
            <option value={user.id}>{user.displayName} · {user.handle}</option>
          {/each}
        </select>
      </label>

      <label>
        <span>按世界观筛选</span>
        <select onchange={handleWorldviewFilterChange} value={filterWorldview}>
          <option value="">{allWorldviewsLabel}</option>
          {#each worldviewOptions as worldview}
            <option value={worldview}>{worldview}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}

  <div class="list-card">
    <div class="list-head">
      <strong>{listTitle}</strong>
      <span>{characters.length} {itemCountSuffix}</span>
    </div>

    {#if statusMessage !== ''}
      <div class="status-inline">{statusMessage}</div>
    {/if}

    <div class="character-list">
      {#each characters as character (character.id)}
        <button
          class:selected={selectedCharacterId === character.id}
          class="character-item"
          onclick={() => selectCharacter(character.id)}
          type="button"
        >
          <span class="character-color" style={`background:${character.color};`}></span>
          <div>
            <strong>{character.name}</strong>
            <span>{getCharacterDescription(character)}</span>
          </div>
        </button>
      {:else}
        <div class="empty-card">{emptyMessage}</div>
      {/each}
    </div>
  </div>
</aside>

<style>
  .admin-sidebar {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .filter-card,
  .list-card,
  .empty-card {
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--panel);
    box-shadow: var(--card-shadow);
  }

  .filter-card,
  .list-card,
  .empty-card {
    padding: 18px;
  }

  .filter-card,
  .character-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  select,
  .character-item {
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 12px;
    font: inherit;
    background: var(--panel-strong);
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
    border-color: var(--accent-border-strong);
    background: var(--accent-surface);
  }

  .character-item span,
  .status-inline,
  .empty-card {
    display: block;
    color: var(--muted);
    font-size: 12px;
  }

  .character-color {
    width: 14px;
    height: 14px;
    border-radius: 999px;
    flex-shrink: 0;
  }
</style>