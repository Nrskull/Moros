<script lang="ts">
  import Color from '@tiptap/extension-color'
  import Highlight from '@tiptap/extension-highlight'
  import { TextStyle } from '@tiptap/extension-text-style'
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
  let imageFieldElement: HTMLInputElement | null = null
  let tagsFieldElement: HTMLTextAreaElement | null = null
  let editorRevision = 0
  let isApplyingExternalContent = false
  let formatBrushState: {
    bold: boolean
    color: string | null
    headingLevel: 2 | 3 | null
    highlight: boolean
    highlightColor: string | null
    italic: boolean
  } | null = null

  const textColorPresets = [
    { label: '正文灰', value: '#27313d' },
    { label: '石板蓝', value: '#425468' },
    { label: '墨绿', value: '#406455' },
    { label: '棕红', value: '#8f5a54' },
  ]

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

    if (!editorElement) {
      return
    }

    editor?.destroy()
    editor = new Editor({
      element: editorElement,
      extensions: [
        TextStyle,
        Color.configure({
          types: ['textStyle'],
        }),
        StarterKit.configure({
          heading: {
            levels: [2, 3],
          },
        }),
        Highlight.configure({
          multicolor: true,
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

  function captureFormatBrush(): void {
    if (!editor) {
      return
    }

    const headingLevel = editor.isActive('heading', { level: 2 })
      ? 2
      : editor.isActive('heading', { level: 3 })
        ? 3
        : null
    const highlightAttributes = editor.getAttributes('highlight')
    const textStyleAttributes = editor.getAttributes('textStyle')

    formatBrushState = {
      bold: editor.isActive('bold'),
      color: typeof textStyleAttributes.color === 'string' ? textStyleAttributes.color : null,
      headingLevel,
      highlight: editor.isActive('highlight'),
      highlightColor:
        typeof highlightAttributes.color === 'string' ? highlightAttributes.color : '#fff1a8',
      italic: editor.isActive('italic'),
    }
  }

  function applyFormatBrush(): void {
    if (!editor || !formatBrushState) {
      return
    }

    const chain = editor
      .chain()
      .focus()
      .unsetBold()
      .unsetItalic()
      .unsetHighlight()
      .unsetColor()

    if (formatBrushState.headingLevel) {
      chain.setHeading({ level: formatBrushState.headingLevel })
    } else {
      chain.setParagraph()
    }

    if (formatBrushState.bold) {
      chain.setBold()
    }

    if (formatBrushState.italic) {
      chain.setItalic()
    }

    if (formatBrushState.highlight) {
      chain.setHighlight({ color: formatBrushState.highlightColor ?? '#fff1a8' })
    }

    if (formatBrushState.color) {
      chain.setColor(formatBrushState.color)
    }

    chain.run()
    formatBrushState = null
    editorRevision += 1
  }

  function toggleFormatBrush(): void {
    if (formatBrushState) {
      applyFormatBrush()
      return
    }

    captureFormatBrush()
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
          <p>格式工具固定停留在正文框上方，保存按钮独立保留在页面级。</p>
        </div>

        <div class="detail-rich-editor">
          <div class="detail-format-toolbar" aria-label="富文本格式菜单">
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('bold') ?? false)}
              class="detail-format-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleBold().run()}
            >
              粗体
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('italic') ?? false)}
              class="detail-format-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleItalic().run()}
            >
              斜体
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('highlight') ?? false)}
              class="detail-format-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHighlight({ color: '#fff1a8' }).run()}
            >
              高亮
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('heading', { level: 2 }) ?? false)}
              class="detail-format-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              标题 2
            </button>
            <button
              class:is-active={editorRevision >= 0 && (editor?.isActive('heading', { level: 3 }) ?? false)}
              class="detail-format-action"
              type="button"
              onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              标题 3
            </button>
            {#each textColorPresets as preset}
              <button
                class:is-active={
                  editorRevision >= 0 &&
                  ((editor?.getAttributes('textStyle').color as string | undefined) ?? '#27313d') ===
                    preset.value
                }
                class="detail-format-action"
                type="button"
                onclick={() => editor?.chain().focus().setColor(preset.value).run()}
              >
                {preset.label}
              </button>
            {/each}
            <button
              class:is-active={formatBrushState !== null}
              class="detail-format-action"
              type="button"
              onclick={toggleFormatBrush}
            >
              {formatBrushState ? '应用格式刷' : '格式刷'}
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
