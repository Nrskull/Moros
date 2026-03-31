<script lang="ts">
  import BubbleMenu from '@tiptap/extension-bubble-menu'
  import Highlight from '@tiptap/extension-highlight'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { onDestroy, onMount, tick } from 'svelte'
  import type { TimelineEvent } from './timeline'

  interface EventDetailRecord extends TimelineEvent {
    detailImage?: string
    detailHtml?: string
    trackId?: string
  }

  export let event: EventDetailRecord | null = null
  export let worldviewName = '未选择世界观'
  export let onBack: () => void = () => {}
  export let onDelete: () => void = () => {}
  export let onSave: (draft: {
    bodyHtml: string
    bodyText: string
    detailImage?: string
    summary: string
    tags: string[]
    title: string
  }) => void = () => {}

  let syncedEventId = ''
  let draftTitle = ''
  let draftSummary = ''
  let draftBodyHtml = ''
  let draftTagsText = ''
  let draftImage = ''

  let editor: Editor | null = null
  let editorElement: HTMLDivElement | null = null
  let bubbleMenuElement: HTMLDivElement | null = null
  let imageFieldElement: HTMLInputElement | null = null
  let tagsFieldElement: HTMLTextAreaElement | null = null
  let editorRevision = 0
  let isApplyingExternalContent = false

  function escapeHtml(text: string): string {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }

  function normaliseEditorContent(content: string): string {
    const trimmed = content.trim()

    if (trimmed === '') {
      return '<p>这里还没有正文内容。</p>'
    }

    if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) {
      return trimmed
    }

    const paragraphs = trimmed
      .split(/\n{2,}/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => `<p>${escapeHtml(segment).replace(/\n/g, '<br />')}</p>`)

    return paragraphs.join('')
  }

  function serialiseTags(text: string): string[] {
    return text
      .split(/[\n,，]+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
  }

  function syncDraftFromEvent(record: EventDetailRecord | null): void {
    if (!record) {
      syncedEventId = ''
      draftTitle = ''
      draftSummary = ''
      draftBodyHtml = ''
      draftTagsText = ''
      draftImage = ''
      return
    }

    syncedEventId = record.id
    draftTitle = record.title
    draftSummary = record.summary
    draftBodyHtml = normaliseEditorContent(record.detailHtml ?? record.body)
    draftTagsText = record.tags.join('，')
    draftImage = record.detailImage ?? ''

    if (editor) {
      isApplyingExternalContent = true
      editor.commands.setContent(draftBodyHtml, { emitUpdate: false })
      editorRevision += 1
      isApplyingExternalContent = false
    }
  }

  $: if (event && event.id !== syncedEventId) {
    syncDraftFromEvent(event)
  } else if (!event && syncedEventId !== '') {
    syncDraftFromEvent(null)
  }

  async function initialiseEditor(): Promise<void> {
    await tick()

    if (!editorElement || !bubbleMenuElement) {
      return
    }

    editor?.destroy()
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          heading: {
            levels: [2, 3],
          },
        }),
        Highlight.configure({
          multicolor: true,
        }),
        BubbleMenu.configure({
          element: bubbleMenuElement,
          updateDelay: 50,
          options: {
            placement: 'top',
            offset: 12,
          },
          shouldShow: ({ editor, from, to }) => editor.isFocused && from !== to,
        }),
      ],
      content: draftBodyHtml || '<p>这里还没有正文内容。</p>',
      editorProps: {
        attributes: {
          class: 'detail-rich-editor__content',
          spellcheck: 'false',
        },
      },
      onBlur: () => {
        editorRevision += 1
      },
      onCreate: () => {
        editorRevision += 1
      },
      onFocus: () => {
        editorRevision += 1
      },
      onSelectionUpdate: () => {
        editorRevision += 1
      },
      onUpdate: ({ editor }) => {
        if (isApplyingExternalContent) {
          return
        }

        draftBodyHtml = editor.getHTML()
        editorRevision += 1
      },
    })
  }

  onMount(() => {
    void initialiseEditor()

    return () => {
      editor?.destroy()
      editor = null
    }
  })

  onDestroy(() => {
    editor?.destroy()
    editor = null
  })

  function focusTags(): void {
    tagsFieldElement?.focus()
  }

  function focusImage(): void {
    imageFieldElement?.focus()
  }

  function getPlainBodyText(): string {
    const text = editor?.getText().trim() ?? ''
    return text === '' ? '这里还没有正文内容。' : text
  }

  function saveDetailDraft(): void {
    onSave({
      title: draftTitle.trim() || '未命名事件',
      summary: draftSummary.trim(),
      bodyHtml: draftBodyHtml || '<p>这里还没有正文内容。</p>',
      bodyText: getPlainBodyText(),
      tags: serialiseTags(draftTagsText),
      detailImage: draftImage.trim() || undefined,
    })
  }

  function handleKeydown(event: KeyboardEvent): void {
    const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's'

    if (!isSave) {
      return
    }

    event.preventDefault()
    saveDetailDraft()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if event}
  <section class="detail-page">
    <div class="detail-page-head">
      <div>
        <p class="section-label">事件详情 / 沉浸写作</p>
        <h2>{worldviewName}</h2>
      </div>

      <div class="detail-page-actions">
        <button class="toolbar-action" type="button" onclick={onBack}>返回时间轴</button>
        <button class="toolbar-action" type="button" onclick={focusTags}>标签</button>
        <button class="toolbar-action" type="button" onclick={focusImage}>插图</button>
        <button class="toolbar-action" type="button" onclick={onDelete}>删除</button>
        <button class="toolbar-action toolbar-primary" type="button" onclick={saveDetailDraft}>
          保存内容
        </button>
      </div>
    </div>

    <article class="detail-editor detail-editor-rich">
      <label class="detail-title-field">
        <span class="detail-field-label">标题</span>
        <input bind:value={draftTitle} maxlength="80" type="text" />
      </label>

      <div class="detail-meta-grid">
        <label class="detail-field detail-field-plain">
          <span class="detail-field-label">摘要</span>
          <textarea bind:value={draftSummary} rows="3"></textarea>
        </label>

        <label class="detail-field detail-field-plain">
          <span class="detail-field-label">标签</span>
          <textarea bind:this={tagsFieldElement} bind:value={draftTagsText} rows="3"></textarea>
        </label>
      </div>

      <label class="detail-field detail-field-plain detail-field-image">
        <span class="detail-field-label">插图地址</span>
        <input bind:this={imageFieldElement} bind:value={draftImage} placeholder="/background.jpg" type="text" />
      </label>

      {#if draftImage.trim() !== ''}
        <figure class="detail-image-block">
          <img alt={`${draftTitle || event.title} 插图`} src={draftImage} />
        </figure>
      {/if}

      <section class="detail-field detail-field-body">
        <div class="detail-body-head">
          <span class="detail-field-label">正文</span>
          <p>格式操作只在划词后出现，保存按钮独立保留在页面级。</p>
        </div>

        <div class="detail-rich-editor">
          <div bind:this={bubbleMenuElement} class="detail-bubble-menu" aria-label="富文本格式菜单">
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('bold') ?? false)}
              class="detail-bubble-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleBold().run()}
            >
              粗体
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('italic') ?? false)}
              class="detail-bubble-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleItalic().run()}
            >
              斜体
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('highlight') ?? false)}
              class="detail-bubble-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHighlight({ color: '#fff1a8' }).run()}
            >
              高亮
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('heading', { level: 2 }) ?? false)}
              class="detail-bubble-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              标题 2
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('heading', { level: 3 }) ?? false)}
              class="detail-bubble-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              标题 3
            </button>
          </div>

          <div class="detail-rich-editor-shell">
            <div bind:this={editorElement} class="detail-rich-editor-mount"></div>
          </div>
        </div>
      </section>
    </article>
  </section>
{/if}
