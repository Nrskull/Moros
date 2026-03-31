export interface WorldviewTheme {
  accent: string
  accentSoft: string
  coverImage?: string
  coverLabel: string
  coverPosition: string
  description: string
  glow: string
  glowSoft: string
  surfaceEnd: string
  surfaceStart: string
}

const fallbackWorldviewTheme: WorldviewTheme = {
  accent: '#8894a0',
  accentSoft: 'rgba(136, 148, 160, 0.12)',
  coverImage: '/background.jpg',
  coverLabel: '默认封面',
  coverPosition: 'center center',
  description: '当前世界观尚未配置独立封面与说明，先用通用封面承接整体视觉氛围。',
  surfaceStart: '#f4f6f8',
  surfaceEnd: '#edf2f5',
  glow: 'rgba(186, 197, 209, 0.36)',
  glowSoft: 'rgba(216, 224, 232, 0.28)',
}

export const worldviewThemes: Record<string, WorldviewTheme> = {
  莫名其妙: {
    accent: '#7e8792',
    accentSoft: 'rgba(126, 135, 146, 0.12)',
    coverImage: '',
    coverLabel: '旧城 / 档案 / 河道',
    coverPosition: 'center 42%',
    description: '旧城调查线围绕档案、河道与教堂遗址展开，阅读重点是线索回环和多线并进。',
    surfaceStart: '#ffffff',
    surfaceEnd: '#f2f4f6',
    glow: 'rgba(206, 212, 219, 0.3)',
    glowSoft: 'rgba(226, 231, 235, 0.22)',
  },
  铛铛铛铛: {
    accent: '#4e6e88',
    accentSoft: 'rgba(78, 110, 136, 0.12)',
    coverImage: '/background.jpg',
    coverLabel: '海岸 / 灯塔 / 潮汐',
    coverPosition: 'center center',
    description: '盐港怪谈线更偏海岸异闻与潮汐仪式，节奏应该显得更冷、更潮、更有雾感。',
    surfaceStart: '#eef3f6',
    surfaceEnd: '#e3ebf1',
    glow: 'rgba(139, 177, 201, 0.34)',
    glowSoft: 'rgba(183, 202, 214, 0.24)',
  },
}

export function getWorldviewTheme(worldview: string): WorldviewTheme {
  return worldviewThemes[worldview] ?? fallbackWorldviewTheme
}

export function createWorldviewThemeStyle(theme: WorldviewTheme): string {
  const coverImageValue = theme.coverImage ? `url('${theme.coverImage}')` : 'none'

  return [
    `--accent:${theme.accent}`,
    `--accent-soft:${theme.accentSoft}`,
    `--theme-surface-start:${theme.surfaceStart}`,
    `--theme-surface-end:${theme.surfaceEnd}`,
    `--theme-glow:${theme.glow}`,
    `--theme-glow-soft:${theme.glowSoft}`,
    `--hero-image:${coverImageValue}`,
    `--hero-image-position:${theme.coverPosition}`,
  ].join('; ')
}
