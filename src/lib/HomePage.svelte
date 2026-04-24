<script lang="ts">
  import { onMount } from 'svelte'

  let canvas: HTMLCanvasElement
  let width = 1200
  let height = 700
  let backgroundColor = '#f8f9fa'

  const chars = [' ', '.', ':', '-', '=', '+', '*', '#', '^', ':']
  const fontFamily = 'Georgia, serif'
  const fontSize = 16
  const lineHeight = 18

  function fbmLike(nx: number, ny: number, t: number) {
    const v1 = Math.sin(nx * 7.2 + t * 1.1) * Math.cos(ny * 6.4 - t * 0.9)
    const v2 = Math.sin((nx + ny) * 11.0 - t * 1.6) * Math.cos((nx - ny) * 8.3 + t * 1.2)
    const v3 = Math.sin(Math.sqrt((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 18.0 - t * 2.0)

    return v1 * 0.45 + v2 * 0.35 + v3 * 0.2
  }

  function gaussian(x: number, y: number, cx: number, cy: number, s: number) {
    const dx = x - cx
    const dy = y - cy

    return Math.exp(-(dx * dx + dy * dy) / (2 * s * s))
  }

  function rotate(x: number, y: number, angle: number) {
    const c = Math.cos(angle)
    const s = Math.sin(angle)

    return {
      x: x * c - y * s,
      y: x * s + y * c,
    }
  }

  function sampleField(nx: number, ny: number, t: number) {
    const cx = 0.5
    const cy = 0.5

    const dx = nx - cx
    const dy = ny - cy
    const r = Math.sqrt(dx * dx + dy * dy)
    const a = Math.atan2(dy, dx)
    const swirl = rotate(dx, dy, Math.sin(t * 0.7 + r * 8.0) * 0.6)

    const x1 = swirl.x + cx
    const y1 = swirl.y + cy

    const g1 = gaussian(
      x1,
      y1,
      0.34 + Math.sin(t * 0.8) * 0.08,
      0.42 + Math.cos(t * 0.6) * 0.06,
      0.14,
    )

    const g2 = gaussian(
      x1,
      y1,
      0.68 + Math.cos(t * 0.9 + 0.7) * 0.07,
      0.58 + Math.sin(t * 0.75 + 1.2) * 0.08,
      0.19,
    )

    const ring = Math.exp(-Math.pow(r - (0.22 + Math.sin(t * 0.9) * 0.03), 2) / 0.004)
    const noise = fbmLike(nx, ny, t)

    let v = g1 * 0.85 + g2 * 0.75 + ring * 0.35 + noise * 0.22
    v += Math.sin(a * 5.0 - t * 1.6 + r * 12.0) * 0.08

    return Math.max(0, Math.min(1, v))
  }

  function draw(ctx: CanvasRenderingContext2D, time: number) {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    const cols = Math.floor(width / 12)
    const rows = Math.floor(height / lineHeight)

    ctx.textBaseline = 'top'

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = col * 12
        const y = row * lineHeight
        const nx = col / Math.max(cols - 1, 1)
        const ny = row / Math.max(rows - 1, 1)
        const v = sampleField(nx, ny, time * 0.0015)
        const index = Math.min(chars.length - 1, Math.floor(v * chars.length))
        const ch = chars[index]
        const weightBand = row % 3
        const isItalic = col % 7 === 0
        const weight = weightBand === 0 ? 400 : weightBand === 1 ? 600 : 700
        const style = isItalic ? 'italic' : 'normal'
        const alpha = 0.18 + v * 0.82

        ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`
        ctx.fillText(ch, x, y)
      }
    }
  }

  onMount(() => {
    const ctx = canvas.getContext('2d')

    if (!ctx) {
      return
    }

    backgroundColor =
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f8f9fa'

    let frame = 0
    let raf = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1

      width = Math.floor(rect.width * scale)
      height = Math.floor(rect.height * scale)
      canvas.width = width
      canvas.height = height
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(scale, scale)
      width = Math.floor(rect.width)
      height = Math.floor(rect.height)
    }

    const loop = () => {
      frame += 1
      draw(ctx, frame)
      raf = requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    loop()

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  })
</script>

<section aria-label="首页 ASCII 动效" class="home-ascii-page">
  <canvas bind:this={canvas} class="ascii-bg"></canvas>
</section>

<style>
  .home-ascii-page {
    position: relative;
    width: 100%;
    min-height: 100vh;
    min-height: 100dvh;
    overflow: hidden;
  }

  .ascii-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
