<script lang="ts">
  import { slide, fade } from 'svelte/transition'

  interface Props {
    title?: string
    message: string
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    danger?: boolean
    onClose: (result: boolean) => void
  }

  let {
    title = '提示',
    message,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = true,
    danger = false,
    onClose,
  }: Props = $props()

  let visible = $state(true)

  function handleResult(result: boolean) {
    visible = false
    setTimeout(() => {
      onClose(result)
    }, 200) // 等待退出动画完成
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-0"
    onclick={() => (showCancel ? handleResult(false) : null)}
  >
    <div
      class="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
      transition:fade={{ duration: 150 }}
    ></div>

    <div
      class="relative w-full max-w-sm transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all border border-slate-100"
      onclick={(e) => e.stopPropagation()}
      transition:slide={{ duration: 200, axis: 'y' }}
    >
      <h3 class="mb-3 text-lg font-bold leading-6 text-slate-900">
        {title}
      </h3>
      <p class="mb-8 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
        {message}
      </p>

      <div class="flex justify-end gap-3">
        {#if showCancel}
          <button
            class="inline-flex justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:ring-offset-2"
            type="button"
            onclick={() => handleResult(false)}
          >
            {cancelText}
          </button>
        {/if}
        <button
          class="inline-flex justify-center rounded-xl border border-transparent px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 {danger ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-slate-800 hover:bg-slate-900 focus:ring-slate-800'}"
          style={danger ? 'background-color: #dc2626' : 'background-color: #1e293b'}
          type="button"
          onclick={() => handleResult(true)}
        >
          {confirmText || '确定'}
        </button>
      </div>
    </div>
  </div>
{/if}
