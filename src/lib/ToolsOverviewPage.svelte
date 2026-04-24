<script lang="ts">
  export let onOpenAgeChronicle: () => void = () => {}
  export let onOpenCharacterSheet: () => void = () => {}
</script>

<section class="board tools-overview">
  <div class="board-head">
    <div>
      <span class="section-label">工具</span>
      <h2>工具总览</h2>
      <p class="board-note">集中放置偏辅助性的页面入口。</p>
    </div>
  </div>

  <div class="tools-overview-grid">
    <button class="tool-overview-card" type="button" onclick={onOpenAgeChronicle}>
      <span class="tool-overview-kicker">已启用</span>
      <strong>年龄工具</strong>
      <p>查看角色年龄编年，并维护每个年龄格的备注。</p>
    </button>

    <button class="tool-overview-card" type="button" onclick={onOpenCharacterSheet}>
      <span class="tool-overview-kicker">占位</span>
      <strong>车卡</strong>
      <p>角色卡工具入口，功能暂时留空。</p>
    </button>
  </div>
</section>
