<script lang="ts">
  import { cardDeckIn, cardDeckOut } from './transitions'

  export let description = ''
  export let hasCover = true
  export let name = '未选择世界观'
  export let panelClass = ''
  export let tags: string[] = []
  export let themeStyle = ''
  export let transitionKey = 'default'

  $: heroPanelClass = `hero-panel hero-panel-worldview worldview-layer ${panelClass}`.trim()
</script>

<div class="worldview-stage worldview-stage-hero">
  {#each [{ description, hasCover, key: transitionKey, name, tags, themeStyle }] as scene (scene.key)}
    <section
      class:is-current={scene.key === transitionKey}
      class:is-plain={!scene.hasCover}
      class={heroPanelClass}
      style={scene.themeStyle}
      in:cardDeckIn
      out:cardDeckOut
    >
      <div class="hero-copy worldview-hero-copy">
        <p class="eyebrow">当前世界观</p>
        <h1>{scene.name}</h1>
        <p class="lede">{scene.description}</p>
        <div class="hero-pill-row" aria-label="当前世界观补充信息">
          {#each scene.tags as tag}
            <span>{tag}</span>
          {/each}
        </div>
      </div>
    </section>
  {/each}
</div>
