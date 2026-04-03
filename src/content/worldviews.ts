export interface WorldviewContent {
  coverImage?: string
  description: string
  name: string
  tags: string[]
}

export const worldviewContents: WorldviewContent[] = [
  {
    name: '莫名其妙',
    description: '旧城调查线围绕档案、河道与教堂遗址展开，阅读重点是线索回环和多线并进。',
    tags: ['旧城', '档案', '河道'],
  },
  {
    name: '铛铛铛铛',
    description: '盐港怪谈线更偏海岸异闻与潮汐仪式，节奏应该显得更冷、更潮、更有雾感。',
    tags: ['海岸', '灯塔', '潮汐'],
  },
]

const worldviewContentMap = new Map(worldviewContents.map((entry) => [entry.name, entry]))

export function getWorldviewContent(name: string): WorldviewContent {
  return (
    worldviewContentMap.get(name) ?? {
      name,
      description: '当前世界观尚未配置独立简介，后续可在 /src/content/ 配置文件中补充。',
      coverImage: '',
      tags: [],
    }
  )
}
