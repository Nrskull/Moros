<script lang="ts">
  export let onBack: () => void = () => {}
</script>

<section class="board tool-placeholder-page">
  <div class="board-head">
    <div>
      <span class="section-label">工具</span>
      <h2>车卡</h2>
      <p class="board-note">该工具页面暂时留空，后续在这里接入角色卡相关功能。</p>
    </div>

    <div class="board-head-actions">
      <button class="toolbar-action" type="button" onclick={onBack}>返回工具总览</button>
    </div>
  </div>

  <div class="tool-placeholder-empty">
    <strong>车卡工具尚未实现</strong>
    <span>当前仅保留页面入口和路由。</span>
  </div>
</section>
