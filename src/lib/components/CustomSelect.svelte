<svelte:options runes={false} />
<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte'

  export let value: string = ''
  export let placeholder: string = '请选择'
  export let options: Array<{ value: string; label: string }> | Array<string> = []
  export let ariaLabel: string = ''
  export let className: string = ''
  
  // Provide callbacks directly to mimic native inputs if needed
  export let onchange: ((value: string) => void) | undefined = undefined
  export let oninput: ((value: string) => void) | undefined = undefined

  let isOpen = false
  let menuElement: HTMLUListElement | null = null
  let buttonElement: HTMLButtonElement | null = null

  const dispatch = createEventDispatcher<{
    change: { value: string }
    input: { value: string }
  }>()

  function toggle(event: Event) {
    event.stopPropagation()
    isOpen = !isOpen
  }

  function handleSelect(optionValue: string, event: Event) {
    event.stopPropagation()
    value = optionValue
    isOpen = false
    
    // Dispatch svelte 4 custom events
    dispatch('change', { value })
    dispatch('input', { value })
    
    // Call direct svelte 5 callbacks if provided
    if (onchange) onchange(value)
    if (oninput) oninput(value)
  }

  function handleGlobalClick(event: MouseEvent) {
    if (isOpen && buttonElement && menuElement) {
      const target = event.target as Node
      if (!buttonElement.contains(target) && !menuElement.contains(target)) {
        isOpen = false
      }
    }
  }

  onMount(() => {
    window.addEventListener('click', handleGlobalClick)
    return () => {
      window.removeEventListener('click', handleGlobalClick)
    }
  })

  $: normalizedOptions = options.map(opt => {
    return typeof opt === 'string' ? { value: opt, label: opt } : opt
  })

  $: selectedLabel = normalizedOptions.find(opt => opt.value === value)?.label || placeholder
</script>

<div class={`custom-select-container ${className}`}>
  <button
    bind:this={buttonElement}
    aria-expanded={isOpen}
    aria-haspopup="listbox"
    aria-label={ariaLabel}
    class="custom-select-trigger"
    type="button"
    onclick={toggle}
  >
    <span class="custom-select-value">
      {#if selectedLabel.includes('▼')}
        {selectedLabel.replace('▼', '')}<span style="font-size: 0.65em; margin-left: 0.5px; opacity: 0.8; vertical-align: middle;">▼</span>
      {:else}
        {selectedLabel}
      {/if}
    </span>
  </button>

  {#if isOpen}
    <ul bind:this={menuElement} class="custom-select-menu" role="listbox">
      {#if placeholder}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li 
          aria-selected={value === ''}
          class="custom-select-option is-placeholder"
          role="option"
          onclick={(e) => handleSelect('', e)}
        >
          {#if placeholder.includes('▼')}
            {placeholder.replace('▼', '')}<span style="font-size: 0.65em; margin-left: 0.5px; opacity: 0.8; vertical-align: middle;">▼</span>
          {:else}
            {placeholder}
          {/if}
        </li>
      {/if}
      
      {#each normalizedOptions as option}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          aria-selected={value === option.value}
          class:is-selected={value === option.value}
          class="custom-select-option"
          role="option"
          onclick={(e) => handleSelect(option.value, e)}
        >
          {#if option.label.includes('▼')}
            {option.label.replace('▼', '')}<span style="font-size: 0.65em; margin-left: 0.5px; opacity: 0.8; vertical-align: middle;">▼</span>
          {:else}
            {option.label}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .custom-select-container {
    position: relative;
    display: inline-block;
    font: inherit;
  }

  .custom-select-trigger {
    width: 100%;
    margin: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    outline: none;
    cursor: pointer;
    text-align: left;
    display: flex;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .custom-select-trigger:focus,
  .custom-select-trigger:focus-visible {
    outline: none;
  }

  .custom-select-menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 100%;
    margin: 4px 0 0 0;
    padding: 6px 0;
    list-style: none;
    background: var(--panel-strong, #ffffff);
    border: 1px solid var(--accent-border-strong, #c5ced8);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(16, 24, 40, 0.08);
    max-height: 240px;
    overflow-y: auto;
    font-size: 0.9em;
  }

  .custom-select-option {
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text, #27313d);
    white-space: nowrap;
    transition: background-color 0.15s, color 0.15s;
  }

  .custom-select-option.is-placeholder {
    color: var(--muted, #677282);
  }

  .custom-select-option:hover {
    background-color: var(--accent-surface-strong, #f0f2f5);
  }

  .custom-select-option.is-selected {
    font-weight: 500;
    background-color: var(--accent-soft, #eef2f5);
    color: var(--text, #27313d);
  }
</style>
