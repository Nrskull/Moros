import { cubicOut } from 'svelte/easing'
import type { TransitionConfig } from 'svelte/transition'

export function seaFogOut(
  node: Element,
  { delay = 0, duration = 400 }: { delay?: number; duration?: number } = {},
): TransitionConfig {
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t) => {
      const easedBlur = (1 - t) * 10
      const easedScale = 0.98 + t * 0.02

      return `opacity:${t}; filter: blur(${easedBlur}px); transform: scale(${easedScale});`
    },
  }
}

export function seaFogIn(
  node: Element,
  { delay = 160, duration = 360 }: { delay?: number; duration?: number } = {},
): TransitionConfig {
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t) => {
      const easedBlur = (1 - t) * 14
      const easedTranslate = (1 - t) * 10
      const easedScale = 0.992 + t * 0.008

      return `opacity:${t}; filter: blur(${easedBlur}px); transform: translateY(${easedTranslate}px) scale(${easedScale});`
    },
  }
}

export function cardDeckOut(
  node: Element,
  { delay = 0, duration = 420 }: { delay?: number; duration?: number } = {},
): TransitionConfig {
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t) => {
      const inverse = 1 - t
      const translateX = inverse * -26
      const translateY = inverse * 8
      const scale = 0.972 + t * 0.028
      const rotate = inverse * -1.4
      const blur = inverse * 8

      return `opacity:${t}; filter: blur(${blur}px); transform: translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotate}deg) scale(${scale});`
    },
  }
}

export function cardDeckIn(
  node: Element,
  { delay = 110, duration = 420 }: { delay?: number; duration?: number } = {},
): TransitionConfig {
  return {
    delay,
    duration,
    easing: cubicOut,
    css: (t) => {
      const inverse = 1 - t
      const translateX = inverse * 32
      const translateY = inverse * 12
      const scale = 0.982 + t * 0.018
      const rotate = inverse * 1.6
      const blur = inverse * 12

      return `opacity:${t}; filter: blur(${blur}px); transform: translate3d(${translateX}px, ${translateY}px, 0) rotate(${rotate}deg) scale(${scale});`
    },
  }
}
